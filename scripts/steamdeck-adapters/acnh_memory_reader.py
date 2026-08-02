#!/usr/bin/env python3
"""
ACNH live memory reader for Ryujinx on Linux.

Primary mode  : proc_mem  — reads /proc/<pid>/mem directly (no botbase needed).
Fallback mode : botbase   — connects to a sys-botbase socket on port 6000/6001.

proc_mem mode requires ptrace_scope=0:
    sudo sysctl -w kernel.yama.ptrace_scope=0

Pass --scan to dump the DRAM region map and exit (useful for calibration).

Key env vars (proc_mem mode):
    ACNH_RYUJINX_PID              — override PID auto-detection
    ACNH_GAME_VERSION             — e.g. "2.0.7" (default)
    ACNH_DRAM_OFFSET              — force host-process base address (hex)
    ACNH_PLAYER_NAME_OFFSET       — absolute Switch VA for player name (hex)
    ACNH_PLAYER_TOWN_OFFSET       — absolute Switch VA for island name (hex)
    ACNH_PLAYER_WALLET_OFFSET     — absolute Switch VA for wallet bells (hex)
    ACNH_PLAYER_BANK_OFFSET       — absolute Switch VA for bank bells (hex)
    ACNH_PLAYER_MILES_OFFSET      — absolute Switch VA for nook miles (hex)
    ACNH_PLAYER_AVATAR            — avatar image path returned in payload
"""
import glob
import json
import os
import struct
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# ---------------------------------------------------------------------------
# Default ACNH 2.0.7 absolute Switch virtual addresses (single-player island).
# Source: GBatemp cheat database (pocket slot 1 = 0xAFB1E6E0) plus NHSE offsets.
# PlayerSave layout (relative to struct base ~0xAFBC6400 area):
#   +0x000  name    16 bytes UTF-16LE (8 chars)
#   +0x200  town    16 bytes UTF-16LE (8 chars)
#   +0x110  wallet  uint32 LE
#   +0x114  bank    uint32 LE
#   +0x118  miles   uint32 LE
# These defaults are approximate; calibrate with --scan if needed.
# ---------------------------------------------------------------------------
_DEFAULT_OFFSETS = {
    "2.0.7": {
        "name":   0xAFAF2CA0,
        "town":   0xAFAF2C84,
        "wallet": 0xAFB1E798,
        "bank":   0xAFB43114,
        "miles":  0xAFAF9150,
    }
}

_ITEM_NONE = 0xFFFE
_ITEM_SIZE = 8


def _read_ryujinx_clock():
    config_path = Path(os.environ.get(
        "RYUJINX_CONFIG_PATH",
        Path.home() / ".config" / "Ryujinx" / "Config.json",
    ))

    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        if config.get("match_system_time") is True:
            game_now = datetime.now().astimezone()
        else:
            time_zone = ZoneInfo(str(config["system_time_zone"]))
            offset_seconds = int(config.get("system_time_offset", 0))
            game_now = datetime.now(timezone.utc).astimezone(time_zone) + timedelta(seconds=offset_seconds)
    except (FileNotFoundError, KeyError, TypeError, ValueError, json.JSONDecodeError, ZoneInfoNotFoundError):
        return "", ""

    return game_now.strftime("%Y-%m-%d"), game_now.strftime("%H:%M")
_DEFAULT_INVENTORY_OFFSETS = {
    "2.0.7": {
        "slot1": 0xAFB1E6E0,
        "slot21": 0xAFB1E6E0 - ((20 * _ITEM_SIZE) + 0x18),
    }
}

_ITEM_INDEX = None

BOTBASE_FALLBACK_PORTS = [6000, 6001]

_DEFAULT_PLAYER_TEXT_BYTES = 20
_ENCRYPTION_CONSTANT = 0x80E32B11
_SHIFT_BASE = 3
_DEFAULT_EXPECTED_PLAYER = {
    "name": "b",
    "town": "the island",
    "wallet": 9046,
    "bank": 999922002,
    "miles": 9999999,
}
_PLAYER_FROM_SLOT1_LAYOUT_DELTAS = [
    {
        # Layout 20 from ryujinx-save.js, anchored from working slot 1 (pockets2).
        "name": -0x2BA40,
        "town": -0x2BA5C,
        "wallet": 0xB8,
        "bank": 0x24A34,
        "miles": -0x25590,
    },
    {
        # Layout 30 from ryujinx-save.js, anchored from working slot 1 (pockets2).
        "name": -0x2BA40,
        "town": -0x2BA5C,
        "wallet": 0xB8,
        "bank": 0x2D5D4,
        "miles": -0x25590,
    },
]


# ---------------------------------------------------------------------------
# Proc-mem helpers
# ---------------------------------------------------------------------------

def _check_ptrace_scope():
    scope_path = "/proc/sys/kernel/yama/ptrace_scope"
    try:
        scope = int(open(scope_path).read().strip())
    except Exception:
        scope = -1  # unknown, proceed and let open() fail naturally
    if scope > 0:
        raise RuntimeError(
            f"ptrace_scope={scope}: direct memory reads are blocked.\n"
            "Run this ONCE to enable (resets on reboot):\n"
            "    sudo sysctl -w kernel.yama.ptrace_scope=0\n"
            "Or add to /etc/sysctl.d/99-ptrace.conf:\n"
            "    kernel.yama.ptrace_scope = 0"
        )


def _find_ryujinx_pid() -> int:
    override = os.environ.get("ACNH_RYUJINX_PID", "").strip()
    if override:
        return int(override, 0)

    import glob

    def _looks_like_ryujinx_process(proc_dir: str, cmdline: str) -> bool:
        cmdline_lc = cmdline.lower()

        # Prefer checking the real executable path when available.
        exe_path = ""
        try:
            exe_path = os.readlink(proc_dir + "/exe")
        except Exception:
            exe_path = ""

        exe_name = os.path.basename(exe_path).lower()
        if exe_name in {"ryujinx", "ryujinx.headless"}:
            return True

        # Token-based fallback for launcher styles where exe is not directly Ryujinx.
        tokens = [tok for tok in cmdline_lc.split() if tok]
        if any(tok.endswith("/ryujinx") or tok.endswith("/ryujinx.headless") for tok in tokens):
            return True
        if any(tok in {"ryujinx", "ryujinx.headless"} for tok in tokens):
            return True

        # Avoid false positives from shell/client scripts that mention 'ryujinx'.
        return False

    for proc_dir in glob.glob("/proc/[0-9]*"):
        try:
            cmdline = open(proc_dir + "/cmdline", "rb").read().decode("utf-8", "ignore").replace("\x00", " ")
            if _looks_like_ryujinx_process(proc_dir, cmdline):
                return int(proc_dir.split("/")[-1])
        except Exception:
            pass
    raise RuntimeError(
        "Ryujinx process not found. Is ACNH running in Ryujinx?\n"
        "Override with: export ACNH_RYUJINX_PID=<pid>"
    )


def _parse_maps(pid: int):
    """
    Returns list of (start, end, perms, label) for readable rw regions.
    """
    regions = []
    try:
        with open(f"/proc/{pid}/maps", "r") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) < 2:
                    continue
                perms = parts[1]
                if "r" not in perms or "w" not in perms:
                    continue
                addrs = parts[0].split("-")
                if len(addrs) != 2:
                    continue
                start = int(addrs[0], 16)
                end = int(addrs[1], 16)
                label = parts[-1] if len(parts) >= 6 else ""
                regions.append((start, end, perms, label))
    except PermissionError as exc:
        raise RuntimeError(
            f"Cannot read /proc/{pid}/maps: {exc}\n"
            "Ensure ptrace_scope=0:  sudo sysctl -w kernel.yama.ptrace_scope=0"
        ) from exc
    return regions


def _clean_player_text(text: str) -> str:
    cleaned = text.split("\x00")[0].strip()
    cleaned = "".join(ch for ch in cleaned if ch.isprintable() and ch not in {"\ufffd", "\uffff", "\ufeff"})
    return cleaned.strip()


def _decode_utf16le_safe(data: bytes) -> str:
    try:
        return _clean_player_text(data.decode("utf-16le", errors="ignore"))
    except Exception:
        return ""


def _read_player_text_field(pid: int, dram_base: int, switch_va: int, requested_size: int) -> str:
    read_size = max(2, requested_size)
    raw = _read_switch_va(pid, dram_base, switch_va, read_size)
    return _decode_utf16le_safe(raw)


def _is_clean_player_text(value: str) -> bool:
    value = str(value or "").strip()
    if not value:
        return False
    return _is_plausible_text(value)


def _rotate_right(value: int, shift: int) -> int:
    shift = shift % 32
    return ((value >> shift) | ((value << (32 - shift)) & 0xFFFFFFFF)) & 0xFFFFFFFF


def _rotate_left(value: int, shift: int) -> int:
    shift = shift % 32
    return ((value << shift) | (value >> (32 - shift))) & 0xFFFFFFFF


def _calculate_encrypted_checksum(value: int) -> int:
    byte_sum = (value + (value >> 16) + (value >> 24) + (value >> 8)) & 0xFFFFFFFF
    return (byte_sum - 0x2D) & 0xFF


def _try_read_encrypted_int(pid: int, dram_base: int, switch_va: int):
    raw = _read_switch_va(pid, dram_base, switch_va, 8)
    encrypted = struct.unpack_from("<I", raw, 0)[0]
    adjust = struct.unpack_from("<H", raw, 4)[0]
    shift = raw[6]
    checksum = raw[7]
    if checksum != _calculate_encrypted_checksum(encrypted):
        return None
    rotated = _rotate_right(encrypted, shift + _SHIFT_BASE)
    return (rotated + _ENCRYPTION_CONSTANT - adjust) & 0xFFFFFFFF


def _read_player_number_field(pid: int, dram_base: int, switch_va: int):
    encrypted = _try_read_encrypted_int(pid, dram_base, switch_va)
    if encrypted is not None:
        return encrypted, True
    plain = _read_uint32(_read_switch_va(pid, dram_base, switch_va, 4))
    return plain, False


def _write_player_text_field(pid: int, dram_base: int, switch_va: int, text: str, field_bytes: int):
    clean = _clean_player_text(str(text or ""))
    encoded = clean.encode("utf-16le")
    max_bytes = max(2, field_bytes) & ~1
    encoded = encoded[:max_bytes]
    payload = encoded.ljust(field_bytes, b'\x00')
    _write_switch_va(pid, dram_base, switch_va, payload)
    # Also write to the save slot-1 mirror so the in-game UI reflects the change.
    try:
        _write_switch_va(pid, dram_base, switch_va + _SAVE_SLOT1_INVENTORY_DELTA, payload)
    except RuntimeError:
        pass


def _write_player_number_field(pid: int, dram_base: int, switch_va: int, value: int):
    raw = _read_switch_va(pid, dram_base, switch_va, 8)
    encrypted = struct.unpack_from("<I", raw, 0)[0]
    adjust = struct.unpack_from("<H", raw, 4)[0]
    shift = raw[6]
    checksum = raw[7]

    if checksum != _calculate_encrypted_checksum(encrypted):
        raise RuntimeError(f"Player field at {hex(switch_va)} is not checksum-valid encrypted data")

    adjusted = (int(value) + adjust - _ENCRYPTION_CONSTANT) & 0xFFFFFFFF
    next_encrypted = _rotate_left(adjusted, shift + _SHIFT_BASE)
    payload = struct.pack("<IHB", next_encrypted, adjust, shift) + bytes([_calculate_encrypted_checksum(next_encrypted)])
    _write_switch_va(pid, dram_base, switch_va, payload)


def _read_player_snapshot(pid: int, dram_base: int, offsets: dict, name_bytes: int, town_bytes: int) -> dict:
    name = _read_player_text_field(pid, dram_base, offsets["name"], name_bytes)
    town = _read_player_text_field(pid, dram_base, offsets["town"], town_bytes)
    wallet, wallet_encrypted = _read_player_number_field(pid, dram_base, offsets["wallet"])
    bank, bank_encrypted = _read_player_number_field(pid, dram_base, offsets["bank"])
    miles, miles_encrypted = _read_player_number_field(pid, dram_base, offsets["miles"])
    return {
        "offsets": dict(offsets),
        "name": name,
        "town": town,
        "wallet": wallet,
        "bank": bank,
        "miles": miles,
        "encryptedHits": int(wallet_encrypted) + int(bank_encrypted) + int(miles_encrypted),
    }


def _score_player_snapshot(snapshot: dict) -> int:
    score = 0
    if _is_clean_player_text(snapshot["name"]):
        score += 8
    if _is_clean_player_text(snapshot["town"]):
        score += 8
    if _is_clean_player_text(snapshot["name"]) and _is_clean_player_text(snapshot["town"]):
        score += 6
    encrypted_hits = int(snapshot.get("encryptedHits", 0))
    if encrypted_hits == 0:
        # Wallet/bank/miles should be checksum-valid encrypted fields in live data.
        score -= 20
    else:
        score += encrypted_hits * 8

    wallet = snapshot["wallet"]
    bank = snapshot["bank"]
    miles = snapshot["miles"]
    if 0 <= wallet <= 999999999:
        score += 2
    if 0 <= bank <= 999999999:
        score += 2
    if 0 <= miles <= 999999999:
        score += 2
    return score


def _offsets_from_inventory_anchor(inventory_offsets: dict, delta_adjust: int = 0) -> dict:
    slot1 = inventory_offsets["slot1"]
    deltas = _PLAYER_FROM_SLOT1_LAYOUT_DELTAS[delta_adjust]
    return {
        "name": slot1 + deltas["name"],
        "town": slot1 + deltas["town"],
        "wallet": slot1 + deltas["wallet"],
        "bank": slot1 + deltas["bank"],
        "miles": slot1 + deltas["miles"],
    }


def _offsets_with_struct_delta(offsets: dict, delta: int) -> dict:
    return {
        "name": offsets["name"] + delta,
        "town": offsets["town"] + delta,
        "wallet": offsets["wallet"] + delta,
        "bank": offsets["bank"] + delta,
        "miles": offsets["miles"] + delta,
    }


def _calibrate_player_snapshot(pid: int, dram_base: int, offsets: dict, name_bytes: int, town_bytes: int):
    baseline = _read_player_snapshot(pid, dram_base, offsets, name_bytes, town_bytes)

    if (
        _is_clean_player_text(baseline["name"])
        and _is_clean_player_text(baseline["town"])
        and int(baseline.get("encryptedHits", 0)) == 3
    ):
        return baseline

    best = baseline
    best_score = _score_player_snapshot(baseline)

    # Also try save-layout-style name/town positions against the same struct base.
    save_style_offsets = {
        "name": offsets["name"] + 0x20,
        "town": offsets["name"] + 0x04,
        "wallet": offsets["wallet"],
        "bank": offsets["bank"],
        "miles": offsets["miles"],
    }
    try:
        save_style = _read_player_snapshot(pid, dram_base, save_style_offsets, name_bytes, town_bytes)
        save_style_score = _score_player_snapshot(save_style)
        if save_style_score > best_score:
            best = save_style
            best_score = save_style_score
    except Exception:
        pass

    # Inventory is already reading correctly, so anchor player fields to slot1.
    try:
        inventory_offsets = _get_inventory_offsets()
        for layout_index in range(len(_PLAYER_FROM_SLOT1_LAYOUT_DELTAS)):
            base_offsets = _offsets_from_inventory_anchor(inventory_offsets, layout_index)
            for delta in range(-0x2000, 0x2002, 2):
                candidate_offsets = _offsets_with_struct_delta(base_offsets, delta)
                try:
                    candidate = _read_player_snapshot(pid, dram_base, candidate_offsets, name_bytes, town_bytes)
                except Exception:
                    continue
                score = _score_player_snapshot(candidate)
                if score > best_score:
                    best = candidate
                    best_score = score
    except Exception:
        pass

    return best


def _get_expected_player() -> dict:
    def pick_text(env_key: str, default: str) -> str:
        return str(os.environ.get(env_key, default)).strip()

    def pick_int(env_key: str, default: int) -> int:
        raw = os.environ.get(env_key, "").strip()
        if not raw:
            return default
        return int(raw, 0)

    return {
        "name": pick_text("ACNH_EXPECTED_PLAYER_NAME", _DEFAULT_EXPECTED_PLAYER["name"]),
        "town": pick_text("ACNH_EXPECTED_PLAYER_TOWN", _DEFAULT_EXPECTED_PLAYER["town"]),
        "wallet": pick_int("ACNH_EXPECTED_PLAYER_WALLET", _DEFAULT_EXPECTED_PLAYER["wallet"]),
        "bank": pick_int("ACNH_EXPECTED_PLAYER_BANK", _DEFAULT_EXPECTED_PLAYER["bank"]),
        "miles": pick_int("ACNH_EXPECTED_PLAYER_MILES", _DEFAULT_EXPECTED_PLAYER["miles"]),
    }


def _iter_pattern_matches(pid: int, dram_base: int, start_va: int, end_va: int, pattern: bytes, chunk_size: int = 0x40000):
    overlap = max(0, len(pattern) - 1)
    cursor = start_va
    tail = b""
    while cursor < end_va:
        size = min(chunk_size, end_va - cursor)
        try:
            chunk = _read_switch_va(pid, dram_base, cursor, size)
        except RuntimeError:
            # Skip unreadable chunks (unmapped or guard pages) and keep scanning.
            tail = b""
            cursor += size
            continue
        haystack = tail + chunk
        search_from = 0
        while True:
            idx = haystack.find(pattern, search_from)
            if idx < 0:
                break
            yield (cursor - len(tail)) + idx
            search_from = idx + 1
        if overlap:
            tail = haystack[-overlap:]
        else:
            tail = b""
        cursor += size


def _score_snapshot_against_expected(snapshot: dict, expected: dict) -> int:
    score = _score_player_snapshot(snapshot)
    if snapshot["town"].strip().lower() == expected["town"].strip().lower():
        score += 100
    if snapshot["name"].strip() == expected["name"].strip():
        score += 50
    if snapshot["wallet"] == expected["wallet"]:
        score += 40
    if snapshot["bank"] == expected["bank"]:
        score += 40
    if snapshot["miles"] == expected["miles"]:
        score += 40
    return score


def _find_expected_player_snapshot(pid: int, dram_base: int, name_bytes: int, town_bytes: int):
    expected = _get_expected_player()
    inventory_offsets = _get_inventory_offsets()
    slot1 = inventory_offsets["slot1"]
    search_start = max(0, slot1 - 0x400000)
    search_end = slot1 + 0x400000
    town_pattern = expected["town"].encode("utf-16le")

    best = None
    best_score = -10**9
    seen_towns = set()

    candidate_relative_layouts = [
        {"name_delta": 0x1C, "wallet_delta": 0x2BB14, "bank_delta": 0x50490, "miles_delta": 0x64CC},
        {"name_delta": 0x1C, "wallet_delta": 0x2BB14, "bank_delta": 0x59030, "miles_delta": 0x64CC},
        {"name_delta": -0x200, "wallet_delta": -0xF0, "bank_delta": -0xEC, "miles_delta": -0xE8},
    ]

    try:
        for town_va in _iter_pattern_matches(pid, dram_base, search_start, search_end, town_pattern):
            if town_va in seen_towns:
                continue
            seen_towns.add(town_va)
            for layout in candidate_relative_layouts:
                offsets = {
                    "town": town_va,
                    "name": town_va + layout["name_delta"],
                    "wallet": town_va + layout["wallet_delta"],
                    "bank": town_va + layout["bank_delta"],
                    "miles": town_va + layout["miles_delta"],
                }
                try:
                    snapshot = _read_player_snapshot(pid, dram_base, offsets, name_bytes, town_bytes)
                except Exception:
                    continue
                score = _score_snapshot_against_expected(snapshot, expected)
                if score > best_score:
                    best = snapshot
                    best_score = score
    except Exception:
        return None

    return best


def _is_plausible_text(value: str) -> bool:
    value = str(value or "").strip()
    if not value:
        return False
    if len(value) > 12:
        return False
    if set(value).issubset({"ÿ", "þ", "ý", "�"}):
        return False
    if len(value) > 1 and len(set(value)) == 1:
        return False
    printable = sum(1 for ch in value if ch.isprintable())
    return printable == len(value)


def _score_inventory_sample(pid: int, dram_base: int, inventory_offsets: dict):
    score = 0
    sampled = 0
    empties = 0
    high_count = 0
    bad_item_id = 0

    for slot in range(1, 11):
        try:
            raw = _read_switch_va(pid, dram_base, _slot_switch_va(slot, inventory_offsets), _ITEM_SIZE)
        except RuntimeError:
            continue

        sampled += 1
        item_id = struct.unpack_from("<H", raw, 0)[0]
        count = struct.unpack_from("<H", raw, 4)[0]
        uses = struct.unpack_from("<H", raw, 6)[0]

        if item_id == _ITEM_NONE:
            empties += 1
            score += 1
        elif item_id <= 0x8000:
            score += 2
        else:
            bad_item_id += 1
            score -= 2

        if count <= 999:
            score += 1
        elif count >= 10000:
            high_count += 1
            score -= 2

        if uses >= 10000:
            score -= 1

    details = {
        "sampledSlots": sampled,
        "emptySlots": empties,
        "highCountSlots": high_count,
        "badItemIdSlots": bad_item_id,
    }
    return score, details


def _score_dram_candidate(pid: int, dram_base: int, offsets: dict):
    score = 0
    details = {}

    for field in ("name", "town"):
        try:
            text = _read_player_text_field(pid, dram_base, offsets[field], _DEFAULT_PLAYER_TEXT_BYTES)
            details[field] = text
            if _is_plausible_text(text):
                score += 3
        except RuntimeError as exc:
            details[field] = f"ERR:{exc}"

    for field in ("wallet", "bank", "miles"):
        try:
            raw = _read_switch_va(pid, dram_base, offsets[field], 4)
            value = _read_uint32(raw)
            details[field] = value
            if 0 <= value <= 999999999:
                score += 1
        except RuntimeError as exc:
            details[field] = f"ERR:{exc}"

    try:
        inventory_offsets = _get_inventory_offsets()
        inv_score, inv_details = _score_inventory_sample(pid, dram_base, inventory_offsets)
        score += inv_score
        details["inventory"] = inv_details
    except Exception as exc:
        details["inventory"] = f"ERR:{exc}"

    return score, details


def _candidate_dram_bases(pid: int, offsets: dict):
    candidates = []
    seen = set()
    for start, end, perms, label in _parse_maps(pid):
        if start in seen:
            continue
        seen.add(start)
        size = end - start
        label_lc = str(label or "").lower()
        # Restrict scoring to likely DRAM regions; small anonymous rw regions are noisy.
        if "memfd" not in label_lc and "doublemapper" not in label_lc and size < (512 * 1024 * 1024):
            continue
        score, details = _score_dram_candidate(pid, start, offsets)
        candidates.append({
            "base": start,
            "score": score,
            "size": size,
            "perms": perms,
            "label": label,
            "details": details,
        })

    candidates.sort(key=lambda entry: (entry["score"], entry["size"]), reverse=True)
    return candidates


def _find_dram_base(pid: int) -> int:
    """
    Locate Ryujinx's flat DRAM region: the largest rw memfd:doublemapper region
    that is large enough to represent Switch RAM.  Returns the host base address.
    """
    override = os.environ.get("ACNH_DRAM_OFFSET", "").strip()
    if override:
        return int(override, 16)

    offsets = _get_offsets()
    candidates = _candidate_dram_bases(pid, offsets)
    if candidates and candidates[0]["score"] >= 12:
        return candidates[0]["base"]

    if candidates:
        top = candidates[0]
        raise RuntimeError(
            "Could not confidently determine Ryujinx DRAM base. "
            f"Best candidate was {hex(top['base'])} with score {top['score']}. "
            "Run --scan to inspect candidates or set ACNH_DRAM_OFFSET manually."
        )

    raise RuntimeError(
        f"Could not find writable regions in /proc/{pid}/maps. "
        "Run --scan to inspect mappings or set ACNH_DRAM_OFFSET manually."
    )


def _mem_read(pid: int, host_addr: int, size: int) -> bytes:
    mem_path = f"/proc/{pid}/mem"
    try:
        with open(mem_path, "rb") as fh:
            fh.seek(host_addr)
            data = fh.read(size)
    except PermissionError as exc:
        raise RuntimeError(
            f"Cannot read {mem_path}: {exc}\n"
            "Run: sudo sysctl -w kernel.yama.ptrace_scope=0"
        ) from exc
    except OSError as exc:
        raise RuntimeError(f"Memory read failed at {hex(host_addr)}: {exc}") from exc
    if len(data) != size:
        raise RuntimeError(
            f"Short read at {hex(host_addr)}: expected {size} bytes, got {len(data)}"
        )
    return data


def _switch_va_to_host(dram_base: int, switch_va: int) -> int:
    """Flat memory manager: host_addr = dram_base + switch_va."""
    return dram_base + switch_va


def _read_switch_va(pid: int, dram_base: int, switch_va: int, size: int) -> bytes:
    return _mem_read(pid, _switch_va_to_host(dram_base, switch_va), size)


def _write_switch_va(pid: int, dram_base: int, switch_va: int, data: bytes):
    mem_path = f"/proc/{pid}/mem"
    host_addr = _switch_va_to_host(dram_base, switch_va)
    try:
        with open(mem_path, "r+b", buffering=0) as fh:
            fh.seek(host_addr)
            written = fh.write(data)
    except PermissionError as exc:
        raise RuntimeError(
            f"Cannot write {mem_path}: {exc}\n"
            "Run: sudo sysctl -w kernel.yama.ptrace_scope=0"
        ) from exc
    except OSError as exc:
        raise RuntimeError(f"Memory write failed at {hex(host_addr)}: {exc}") from exc
    if written != len(data):
        raise RuntimeError(
            f"Short write at {hex(host_addr)}: expected {len(data)} bytes, wrote {written}"
        )


def _decode_utf16le(data: bytes) -> str:
    return _decode_utf16le_safe(data)


def _read_uint32(data: bytes) -> int:
    return struct.unpack_from("<I", data)[0]


def _get_offsets() -> dict:
    version = os.environ.get("ACNH_GAME_VERSION", "2.0.7").strip()
    defaults = _DEFAULT_OFFSETS.get(version, _DEFAULT_OFFSETS["2.0.7"])

    def pick(env_key, default):
        val = os.environ.get(env_key, "").strip()
        return int(val, 16) if val else default

    return {
        "name":   pick("ACNH_PLAYER_NAME_OFFSET",   defaults["name"]),
        "town":   pick("ACNH_PLAYER_TOWN_OFFSET",   defaults["town"]),
        "wallet": pick("ACNH_PLAYER_WALLET_OFFSET", defaults["wallet"]),
        "bank":   pick("ACNH_PLAYER_BANK_OFFSET",   defaults["bank"]),
        "miles":  pick("ACNH_PLAYER_MILES_OFFSET",  defaults["miles"]),
    }


def _get_inventory_offsets() -> dict:
    version = os.environ.get("ACNH_GAME_VERSION", "2.0.7").strip()
    defaults = _DEFAULT_INVENTORY_OFFSETS.get(version, _DEFAULT_INVENTORY_OFFSETS["2.0.7"])

    def pick(env_key, default):
        val = os.environ.get(env_key, "").strip()
        return int(val, 16) if val else default

    return {
        "slot1": pick("ACNH_INVENTORY_SLOT1_OFFSET", defaults["slot1"]),
        "slot21": pick("ACNH_INVENTORY_SLOT21_OFFSET", defaults["slot21"]),
    }


def _slot_switch_va(slot: int, offsets: dict) -> int:
    if slot < 1 or slot > 40:
        raise ValueError(f"slot out of range: {slot}")
    if slot <= 20:
        return offsets["slot1"] + ((slot - 1) * _ITEM_SIZE)
    return offsets["slot21"] + ((slot - 21) * _ITEM_SIZE)


def _empty_slot(slot: int) -> dict:
    return {
        "slot": slot,
        "itemId": None,
        "count": 0,
        "uses": 0,
        "flag0": 0,
        "flag1": 0,
    }


def _format_fallback_item_id(item_id: int) -> str:
    return f"0x{item_id:04X}"


def _normalize_live_item_lookup(value):
    text = str(value or "").strip().lower().replace("_", " ")
    text = " ".join(text.split())
    if text.startswith("64px-"):
        text = text[5:].strip()
    elif text.startswith("64px "):
        text = text[5:].strip()
    return text


def _load_item_index():
    global _ITEM_INDEX
    if _ITEM_INDEX is not None:
        return _ITEM_INDEX

    by_internal_id = {}
    by_name = {}
    names_path = Path(__file__).resolve().parents[2] / "data" / "item-names-en.txt"

    if names_path.exists():
        lines = names_path.read_text(encoding="utf-8").splitlines()
        for i, line in enumerate(lines):
            name = line.strip()
            if not name:
                continue
            by_internal_id[i] = name
            normalized = _normalize_live_item_lookup(name)
            if normalized:
                by_name[normalized] = i

    _ITEM_INDEX = {
        "by_internal_id": by_internal_id,
        "by_name": by_name,
    }
    return _ITEM_INDEX


def _normalize_slot_payload(value):
    if not isinstance(value, dict):
        return None
    try:
        slot = int(value.get("slot", 0))
    except (TypeError, ValueError):
        return None
    if slot < 1 or slot > 40:
        return None

    def to_u16(raw):
        try:
            return max(0, min(0xFFFF, int(raw)))
        except (TypeError, ValueError):
            return 0

    def to_u8(raw):
        try:
            return max(0, min(0xFF, int(raw)))
        except (TypeError, ValueError):
            return 0

    item_id = value.get("itemId")
    item_id = str(item_id).strip() if item_id is not None else None
    if item_id == "":
        item_id = None

    return {
        "slot": slot,
        "itemId": item_id,
        "count": to_u16(value.get("count", 0)),
        "uses": to_u16(value.get("uses", 0)),
        "flag0": to_u8(value.get("flag0", 0)),
        "flag1": to_u8(value.get("flag1", 0)),
    }


def _resolve_item_id(raw_item_id):
    if raw_item_id is None:
        return _ITEM_NONE
    text = str(raw_item_id).strip()
    if not text:
        return _ITEM_NONE
    if text.lower().startswith("0x"):
        return int(text, 16)

    index = _load_item_index()
    internal_id = index["by_name"].get(_normalize_live_item_lookup(text))
    if isinstance(internal_id, int):
        return internal_id

    raise RuntimeError(f"Unknown ACNH item id: {text}")


def _decode_slot(raw: bytes, slot: int) -> dict:
    item_id = struct.unpack_from("<H", raw, 0)[0]
    flag0 = raw[2]
    flag1 = raw[3]
    count = struct.unpack_from("<H", raw, 4)[0]
    uses = struct.unpack_from("<H", raw, 6)[0]
    hex_value = f"{item_id:08X}"

    if item_id == _ITEM_NONE:
        return _empty_slot(slot)

    index = _load_item_index()
    item_name = index["by_internal_id"].get(item_id) or _format_fallback_item_id(item_id)
    return {
        "slot": slot,
        "itemId": item_name,
        "hex": hex_value,
        "count": count,
        "uses": uses,
        "flag0": flag0,
        "flag1": flag1,
    }


def _encode_slot(slot_payload: dict) -> bytes:
    item_id = _resolve_item_id(slot_payload.get("itemId"))
    if item_id == _ITEM_NONE:
        return struct.pack("<HBBHH", _ITEM_NONE, 0, 0, 0, 0)
    return struct.pack(
        "<HBBHH",
        item_id & 0xFFFF,
        slot_payload.get("flag0", 0) & 0xFF,
        slot_payload.get("flag1", 0) & 0xFF,
        slot_payload.get("count", 0) & 0xFFFF,
        slot_payload.get("uses", 0) & 0xFFFF,
    )


def _read_all_slots_procmem(pid: int, dram_base: int):
    offsets = _get_inventory_offsets()
    slots = []
    for slot in range(1, 41):
        raw = _read_switch_va(pid, dram_base, _slot_switch_va(slot, offsets), _ITEM_SIZE)
        slots.append(_decode_slot(raw, slot))
    return slots


def _write_slot_procmem(pid: int, dram_base: int, slot_payload: dict):
    offsets = _get_inventory_offsets()
    raw = _encode_slot(slot_payload)
    slot_va = _slot_switch_va(slot_payload["slot"], offsets)

    _write_switch_va(pid, dram_base, slot_va, raw)

    refreshed = _read_switch_va(pid, dram_base, slot_va, _ITEM_SIZE)
    return _decode_slot(refreshed, slot_payload["slot"])


def read_game_data_procmem():
    _check_ptrace_scope()
    pid = _find_ryujinx_pid()
    dram_base = _find_dram_base(pid)
    offs = _get_offsets()
    name_bytes = max(2, int(os.environ.get("ACNH_PLAYER_NAME_BYTES", str(_DEFAULT_PLAYER_TEXT_BYTES))))
    town_bytes = max(2, int(os.environ.get("ACNH_PLAYER_TOWN_BYTES", str(_DEFAULT_PLAYER_TEXT_BYTES))))
    snapshot = _calibrate_player_snapshot(pid, dram_base, offs, name_bytes, town_bytes)
    expected = _get_expected_player()
    if _score_snapshot_against_expected(snapshot, expected) < 120:
        expected_snapshot = _find_expected_player_snapshot(pid, dram_base, name_bytes, town_bytes)
        if expected_snapshot is not None:
            expected_score = _score_snapshot_against_expected(expected_snapshot, expected)
            if expected_score > _score_snapshot_against_expected(snapshot, expected):
                snapshot = expected_snapshot
    name = snapshot["name"]
    town = snapshot["town"]
    wallet = snapshot["wallet"]
    bank = snapshot["bank"]
    miles = snapshot["miles"]
    game_date, game_time = _read_ryujinx_clock()

    payload = {
        "player": {
            "name":   name,
            "town":   town,
            "wallet": wallet,
            "bank":   bank,
            "miles":  miles,
            "avatar": os.environ.get("ACNH_PLAYER_AVATAR", ""),
            "gameDate": game_date,
            "gameTime": game_time,
        },
        "slots": _read_all_slots_procmem(pid, dram_base),
        "source": "live-memory",
        "backend": "procmem",
        "ryujinxPid": pid,
        "dramBase": hex(dram_base),
        "lastGameSaveAt": datetime.now(timezone.utc).isoformat(),
        "lastGameDataFilePath": None,
    }
    print(json.dumps(payload))


def read_inventory_procmem():
    _check_ptrace_scope()
    pid = _find_ryujinx_pid()
    dram_base = _find_dram_base(pid)
    print(json.dumps({
        "slots": _read_all_slots_procmem(pid, dram_base),
        "source": "live-memory",
        "backend": "procmem",
        "ryujinxPid": pid,
        "dramBase": hex(dram_base),
    }))


def write_inventory_slot_procmem(request):
    _check_ptrace_scope()
    pid = _find_ryujinx_pid()
    dram_base = _find_dram_base(pid)
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else request
    slot_payload = _normalize_slot_payload(payload)
    if not slot_payload:
        raise RuntimeError("payload.slot must be an integer from 1 to 40")

    written = _write_slot_procmem(pid, dram_base, slot_payload)
    print(json.dumps({
        "slot": written,
        "slots": _read_all_slots_procmem(pid, dram_base),
        "source": "live-memory",
        "backend": "procmem",
        "ryujinxPid": pid,
        "dramBase": hex(dram_base),
    }))


def write_game_data_procmem(request):
    _check_ptrace_scope()
    pid = _find_ryujinx_pid()
    dram_base = _find_dram_base(pid)
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else request
    player_payload = payload.get("player") if isinstance(payload.get("player"), dict) else payload
    if not isinstance(player_payload, dict):
        raise RuntimeError("payload.player must be an object")

    offs = _get_offsets()
    name_bytes = max(2, int(os.environ.get("ACNH_PLAYER_NAME_BYTES", str(_DEFAULT_PLAYER_TEXT_BYTES))))
    town_bytes = max(2, int(os.environ.get("ACNH_PLAYER_TOWN_BYTES", str(_DEFAULT_PLAYER_TEXT_BYTES))))
    snapshot = _calibrate_player_snapshot(pid, dram_base, offs, name_bytes, town_bytes)
    offsets = snapshot["offsets"]

    wallet = max(0, min(999999999, int(player_payload.get("wallet", snapshot["wallet"]))))
    bank = max(0, min(999999999, int(player_payload.get("bank", snapshot["bank"]))))
    miles = max(0, min(999999999, int(player_payload.get("miles", snapshot["miles"]))))

    # NAME/TOWN WRITES DISABLED: these hit the save-checksum-protected buffer.
    # ACNH validates the save checksum on load; writing without recalculating the
    # checksum causes the anti-tamper to place Empty Cans on all floor tiles.
    # Wallet/bank/miles are safe because they live in the runtime struct (not save buf).
    # if "name" in player_payload and player_payload["name"] is not None:
    #     _write_player_text_field(pid, dram_base, offsets["name"], str(player_payload["name"]), name_bytes)
    # if "town" in player_payload and player_payload["town"] is not None:
    #     _write_player_text_field(pid, dram_base, offsets["town"], str(player_payload["town"]), town_bytes)

    _write_player_number_field(pid, dram_base, offsets["wallet"], wallet)
    _write_player_number_field(pid, dram_base, offsets["bank"], bank)
    _write_player_number_field(pid, dram_base, offsets["miles"], miles)

    refreshed = _calibrate_player_snapshot(pid, dram_base, offsets, name_bytes, town_bytes)
    print(json.dumps({
        "player": {
            "name": refreshed["name"],
            "town": refreshed["town"],
            "wallet": refreshed["wallet"],
            "bank": refreshed["bank"],
            "miles": refreshed["miles"],
            "avatar": os.environ.get("ACNH_PLAYER_AVATAR", ""),
        },
        "slots": _read_all_slots_procmem(pid, dram_base),
        "source": "live-memory",
        "backend": "procmem",
        "ryujinxPid": pid,
        "dramBase": hex(dram_base),
        "lastGameSaveAt": datetime.now(timezone.utc).isoformat(),
        "lastGameDataFilePath": None,
    }))


def cmd_scan():
    """Diagnostic: print DRAM region map and sample values at default offsets."""
    try:
        _check_ptrace_scope()
    except RuntimeError as exc:
        print(f"[scan] {exc}", file=sys.stderr)
        return 1

    pid = _find_ryujinx_pid()
    print(f"[scan] Ryujinx PID: {pid}", file=sys.stderr)

    regions = _parse_maps(pid)
    print(f"[scan] Total rw regions: {len(regions)}", file=sys.stderr)
    print("[scan] Largest rw regions overall:", file=sys.stderr)
    for (s, e, p, l) in sorted(regions, key=lambda r: r[1] - r[0], reverse=True)[:8]:
        size_mb = (e - s) / 1024 / 1024
        print(f"  {hex(s)}-{hex(e)}  {size_mb:.1f}MB  {p}  {l}", file=sys.stderr)
    print("[scan] Largest rw memfd regions:", file=sys.stderr)
    memfd_regions = sorted(
        [(s, e, p, l) for s, e, p, l in regions if "memfd" in l],
        key=lambda r: r[1] - r[0], reverse=True
    )[:5]
    for (s, e, p, l) in memfd_regions:
        size_mb = (e - s) / 1024 / 1024
        print(f"  {hex(s)}-{hex(e)}  {size_mb:.1f}MB  {p}  {l}", file=sys.stderr)

    offs = _get_offsets()
    candidates = _candidate_dram_bases(pid, offs)
    if not candidates:
        print("[scan] No candidate DRAM bases found", file=sys.stderr)
        return 1

    print("[scan] Top candidate bases:", file=sys.stderr)
    for entry in candidates[:8]:
        size_mb = entry["size"] / 1024 / 1024
        details = entry["details"]
        print(
            f"  base={hex(entry['base'])} score={entry['score']} size={size_mb:.1f}MB "
            f"perms={entry['perms']} label={entry['label']} "
            f"name={details.get('name')!r} town={details.get('town')!r} "
            f"wallet={details.get('wallet')} bank={details.get('bank')} miles={details.get('miles')}",
            file=sys.stderr,
        )

    best = candidates[0]
    print(f"[scan] Best candidate base: {hex(best['base'])} (score {best['score']})", file=sys.stderr)

    try:
        name_bytes = max(2, int(os.environ.get("ACNH_PLAYER_NAME_BYTES", str(_DEFAULT_PLAYER_TEXT_BYTES))))
        town_bytes = max(2, int(os.environ.get("ACNH_PLAYER_TOWN_BYTES", str(_DEFAULT_PLAYER_TEXT_BYTES))))
        snapshot = _calibrate_player_snapshot(pid, best["base"], offs, name_bytes, town_bytes)
        expected = _get_expected_player()
        expected_snapshot = _find_expected_player_snapshot(pid, best["base"], name_bytes, town_bytes)
        if expected_snapshot is not None:
            expected_score = _score_snapshot_against_expected(expected_snapshot, expected)
            current_score = _score_snapshot_against_expected(snapshot, expected)
            if expected_score > current_score:
                snapshot = expected_snapshot
        print(
            f"[scan] Calibrated player snapshot: "
            f"name={snapshot['name']!r} town={snapshot['town']!r} "
            f"wallet={snapshot['wallet']} bank={snapshot['bank']} miles={snapshot['miles']} "
            f"encryptedHits={snapshot.get('encryptedHits', 0)} "
            f"offsets={{name:{hex(snapshot['offsets']['name'])}, town:{hex(snapshot['offsets']['town'])}, "
            f"wallet:{hex(snapshot['offsets']['wallet'])}, bank:{hex(snapshot['offsets']['bank'])}, miles:{hex(snapshot['offsets']['miles'])}}}",
            file=sys.stderr,
        )
    except Exception as exc:
        print(f"[scan] Calibrated player snapshot failed: {exc}", file=sys.stderr)

    return 0


# ---------------------------------------------------------------------------
# Villager reader (procmem)
# ---------------------------------------------------------------------------

# NHSE Villager2 struct layout (v1.5+):
#   +0x00  species        uint8  (VillagerSpecies enum: 0-34, see below)
#   +0x01  variant        uint8  (0-based villager index within species)
#   +0x02  personality    uint8  (VillagerPersonality enum: 0=Lazy,1=Jock,2=Cranky,3=Smug,4=Normal,5=Peppy,6=Snooty,7=Uchi)
#   +0x04  GSaveMemory[0..7] each 0x5F0 bytes:
#            +0x04  TownName  10x UTF-16LE
#            +0x1C  PlayerID  uint32
#            +0x20  PlayerName 10x UTF-16LE
#            +0x42  Friendship uint8
#   Catchphrase: +0x10794 (= 0x10768 + 0x2C), 12x UTF-16LE chars (24 bytes)
#   MovingOut flag: +0x1267A bit 1
#   BirthType: +0x12678
#   SIZE = 0x13230

_VILLAGER2_SIZE = 0x13230
_VILLAGER2_CATCHPHRASE_OFF = 0x10768 + 0x2C   # 24 bytes (12 UTF-16LE)
_VILLAGER2_MOVETYPE_OFF    = 0x1267A
_VILLAGER2_BIRTHTYPE_OFF   = 0x12678
_VILLAGER2_GSAVE0_OFF      = 0x4               # GSaveMemory[0] base
_GSAVE_SIZE                = 0x5F0
_GSAVE_TOWNNAME_OFF        = 0x04              # 10x UTF-16LE
_GSAVE_PLAYERNAME_OFF      = 0x20              # 10x UTF-16LE
_GSAVE_FRIENDSHIP_OFF      = 0x42             # uint8
# EventFlagsSave (NnpcMemoryFlags) — confirmed from NHSE Villager2.cs GetEventFlagsSave()
_VILLAGER2_FLAGS_OFF       = 0x1267C          # ushort[256] array; NHSE defines 81 named entries (0x050 max)
_VILLAGER2_FLAGS_COUNT     = 81               # Covers all NHSE-named flags (index 0..80)

# Villager2 sub-struct offsets — confirmed from NHSE Villager2.cs / VillagerItem.cs (2.0.7)
_VILLAGER2_WEAR_OFF        = 0x1094c   # WearStockList: 24 × VillagerItem(0x2C)
_VILLAGER2_WEAR_COUNT      = 24
_VILLAGER2_FTR_OFF         = 0x10d6c   # FtrStockList: 32 × VillagerItem(0x2C)
_VILLAGER2_FTR_COUNT       = 32
_VILLAGER_ITEM_SIZE        = 0x2C      # VillagerItem.SIZE = Item(0x8) + 9×uint32
_VILLAGER2_ROOM_OFF        = 0x12880   # GSaveRoomFloorWall, size 0x24
_VILLAGER2_DIY_HOUR_OFF    = 0x13151   # DIYEndHour  (byte)
_VILLAGER2_DIY_MIN_OFF     = 0x13152   # DIYEndMinute (byte)
_VILLAGER2_DIY_SEC_OFF     = 0x13153   # DIYEndSecond (byte)
_VILLAGER2_DIY_RECIPE_OFF  = 0x13154   # DIYRecipeIndex (uint16 LE)

# Offset of the 10-slot villager array within decrypted main.dat
# Confirmed via ryujinx-save Node.js decrypt + "cha"/"cardio" catchphrase search.
_VILLAGER2_ARRAY_FILE_OFFSET = 0x120

# VillagerHouse2 array offset in decrypted main.dat
# Confirmed from NHSE MainSaveOffsets20.cs: NpcHouseList = GSaveLandStart(0x110) + 0x44F7FC
_NPC_HOUSE_LIST_OFF        = 0x44F90C
_VH2_SIZE                  = 0x12E8           # VillagerHouse2.SIZE
# VillagerHouse1 field offsets (embedded in VillagerHouse2, from NHSE VillagerHouse1.cs)
_VH_HOUSE_LEVEL_OFF        = 0x00  # uint32
_VH_HOUSE_STATUS_OFF       = 0x04  # uint32
_VH_WALL_UID_OFF           = 0x08  # uint16
_VH_ROOF_UID_OFF           = 0x0A  # uint16
_VH_DOOR_UID_OFF           = 0x0C  # uint16
_VH_ORDER_WALL_UID_OFF     = 0x0E  # uint16
_VH_ORDER_ROOF_UID_OFF     = 0x10  # uint16
_VH_ORDER_DOOR_UID_OFF     = 0x12  # uint16
_VH_NPC1_OFF               = 0x1C4  # sbyte
_VH_NPC2_OFF               = 0x1C5  # sbyte
_VH_DOOR_DECO_OFF          = 0x1C8  # Item (8 bytes)
_VH_BUILD_PLAYER_OFF       = 0x1D0  # sbyte

# ---------------------------------------------------------------------------
# Save-file decryption helpers (Ryujinx XorShift128 + AES-CTR via openssl)
# ---------------------------------------------------------------------------

_XS_MERSENNE = 0x6C078965


def _xs128_init(seed: int):
    """Initialise XorShift128 state from a single 32-bit seed (Mersenne init)."""
    a = (_XS_MERSENNE * ((seed ^ (seed >> 30)) & 0xFFFFFFFF) + 1) & 0xFFFFFFFF
    b = (_XS_MERSENNE * ((a ^ (a >> 30)) & 0xFFFFFFFF) + 2) & 0xFFFFFFFF
    c = (_XS_MERSENNE * ((b ^ (b >> 30)) & 0xFFFFFFFF) + 3) & 0xFFFFFFFF
    d = (_XS_MERSENNE * ((c ^ (c >> 30)) & 0xFFFFFFFF) + 4) & 0xFFFFFFFF
    return [a, b, c, d]


def _xs128_next(s: list) -> int:
    a, b, c, d = s
    t = a
    a = b; b = c; c = d
    t ^= (t << 11) & 0xFFFFFFFF
    t ^= (t >> 8) & 0xFFFFFFFF
    d = (t ^ d ^ (d >> 19)) & 0xFFFFFFFF
    s[:] = [a, b, c, d]
    return d


def _derive_save_key_counter(header_bytes: bytes):
    """Derive AES key and initial counter from a Ryujinx save header (0x300 bytes)."""
    imp = [struct.unpack_from('<I', header_bytes, o)[0] for o in range(0x100, 0x300, 4)]

    def get_param(idx: int) -> bytes:
        state = _xs128_init(imp[imp[idx] & 0x7F])
        params = imp[imp[idx + 1] & 0x7F] & 0x7F
        roll_count = (params & 0xF) + 1
        for _ in range(roll_count):
            _xs128_next(state)
            _xs128_next(state)
        result = bytearray(16)
        for i in range(16):
            result[i] = (_xs128_next(state) >> 24) & 0xFF
        return bytes(result)

    return get_param(0), get_param(2)   # (key, counter)


def _aes_ctr_decrypt(data: bytes, key: bytes, counter: bytes) -> bytes:
    """Decrypt *data* with AES-128-CTR using the openssl CLI (no Python crypto lib needed)."""
    result = subprocess.run(
        ['openssl', 'enc', '-aes-128-ctr', '-nosalt', '-nopad',
         '-K', key.hex(), '-iv', counter.hex()],
        input=data, capture_output=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f'openssl AES-CTR decrypt failed: {result.stderr.decode()}')
    return result.stdout


def _find_main_save_file():
    """Return (main_dat_path, header_path, mtime) for the newest ACNH main.dat, or None."""
    home = os.path.expanduser('~')
    xdg = os.environ.get('XDG_CONFIG_HOME')
    config_home = os.path.realpath(xdg) if xdg else os.path.join(home, '.config')
    search_roots = [
        os.path.join(config_home, 'Ryujinx', 'bis', 'user', 'save'),
        os.path.join(home, '.var', 'app', 'org.ryujinx.Ryujinx', 'config',
                     'Ryujinx', 'bis', 'user', 'save'),
    ]
    best = None
    for root in search_roots:
        if not os.path.isdir(root):
            continue
        for main_dat in glob.glob(os.path.join(root, '**', 'main.dat'), recursive=True):
            hdr = os.path.join(os.path.dirname(main_dat), 'mainHeader.dat')
            if not os.path.exists(hdr):
                continue
            mtime = os.path.getmtime(main_dat)
            if best is None or mtime > best[2]:
                best = (main_dat, hdr, mtime)
    return best

_VILLAGER_SPECIES_NAMES = {
    0:  ('Anteater', 'ant'),   1:  ('Bear', 'bea'),       2:  ('Bird', 'brd'),
    3:  ('Bull', 'bul'),       4:  ('Cat', 'cat'),         5:  ('Cub', 'cbr'),
    6:  ('Chicken', 'chn'),    7:  ('Cow', 'cow'),         8:  ('Frog', 'crd'),
    9:  ('Deer', 'der'),       10: ('Dog', 'dog'),         11: ('Duck', 'duk'),
    12: ('Elephant', 'elp'),   13: ('Eagle', 'flg'),       14: ('Goat', 'goa'),
    15: ('Gorilla', 'gor'),    16: ('Hamster', 'ham'),     17: ('Hippo', 'hip'),
    18: ('Horse', 'hrs'),      19: ('Koala', 'kal'),       20: ('Kangaroo', 'kgr'),
    21: ('Lion', 'lon'),       22: ('Monkey', 'mnk'),      23: ('Mouse', 'mus'),
    24: ('Octopus', 'ocp'),    25: ('Ostrich', 'ost'),     26: ('Penguin', 'pbr'),
    27: ('Pig', 'pgn'),        28: ('Pig', 'pig'),         29: ('Rabbit', 'rbt'),
    30: ('Rhino', 'rhn'),      31: ('Sheep', 'shp'),       32: ('Squirrel', 'squ'),
    33: ('Tiger', 'tig'),      34: ('Wolf', 'wol'),        35: ('None', 'non'),
}

_VILLAGER_PERSONALITY_NAMES = ['Lazy', 'Jock', 'Cranky', 'Smug', 'Normal', 'Peppy', 'Snooty', 'Uchi']

# Canonical villager names indexed by (species_code, variant) for well-known villagers.
# Source: NHSE VillagerUtil + Nookipedia. Only villagers present in NH are listed.
_VILLAGER_CATALOG = {
    # Cats (species 4)
    (4,  0): ('Bob',       'cat00'), (4,  1): ('Tom',       'cat01'),
    (4,  2): ('Mitzi',     'cat02'), (4,  3): ('Rosie',     'cat03'),
    (4,  4): ('Olivia',    'cat04'), (4,  5): ('Kiki',      'cat05'),
    (4,  6): ('Kabuki',    'cat06'), (4,  7): ('Kid Cat',   'cat07'),
    (4,  8): ('Monique',   'cat08'), (4,  9): ('Tabby',     'cat09'),
    (4, 10): ('Stinky',    'cat10'), (4, 11): ('Purrl',     'cat11'),
    (4, 12): ('Merry',     'cat12'), (4, 13): ('Kitty',     'cat13'),
    (4, 14): ('Tom',       'cat14'), (4, 15): ('Ankha',     'cat15'),
    (4, 16): ('Lolly',     'cat16'), (4, 17): ('Felicity',  'cat17'),
    (4, 18): ('Merry',     'cat18'), (4, 19): ('Tangy',     'cat19'),
    # Tigers (species 33)
    (33, 0): ('Rolf',      'tig00'), (33, 1): ('Tiger',     'tig01'),
    (33, 2): ('Leonardo',  'tig02'), (33, 3): ('Claudia',   'tig03'),
    (33, 4): ('Bianca',    'tig04'),
    # Dogs (species 10)
    (10, 0): ('Biskit',    'dog00'), (10, 1): ('Portia',    'dog01'),
    (10, 2): ('Walker',    'dog02'), (10, 3): ('Butch',     'dog03'),
    (10, 4): ('Maddie',    'dog04'), (10, 5): ('Bea',       'dog05'),
    (10, 6): ('Lucky',     'dog06'), (10, 7): ('Shep',      'dog07'),
    # Bears (species 1)
    (1,  0): ('Nate',      'bea00'), (1,  1): ('Teddy',     'bea01'),
    (1,  2): ('Pinky',     'bea02'), (1,  3): ('Pudge',     'bea03'),
    (1,  4): ('Ursala',    'bea04'), (1,  5): ('Groucho',   'bea05'),
    (1,  6): ('Tutu',      'bea06'), (1,  7): ('Vladimir',  'bea07'),
    (1,  8): ('Charlise',  'bea08'), (1,  9): ('Olive',     'bea09'),
    (1, 10): ('Beardo',    'bea10'),
    # Cubs (species 5)
    (5,  0): ('Pudge',     'cbr00'), (5,  1): ('Cub',       'cbr01'),
    (5,  2): ('Kody',      'cbr02'), (5,  3): ('Pekoe',     'cbr03'),
    (5,  4): ('Stitches',  'cbr04'), (5,  5): ('Murphy',    'cbr05'),
    (5,  6): ('Poncho',    'cbr06'), (5,  7): ('Barold',    'cbr07'),
    # Rabbits (species 29)
    (29, 0): ('Bunnie',    'rbt00'), (29, 1): ('Dotty',     'rbt01'),
    (29, 2): ('Carmen',    'rbt02'), (29, 3): ('Pippy',     'rbt03'),
    (29, 4): ('Tiffany',   'rbt04'), (29, 5): ('Genji',     'rbt05'),
    (29, 6): ('Ruby',      'rbt06'), (29, 7): ('Doc',       'rbt07'),
    (29, 8): ('Claude',    'rbt08'), (29, 9): ('Gabi',      'rbt09'),
    (29,10): ('Mira',      'rbt10'), (29,11): ('Toby',      'rbt11'),
    # Frogs (species 8)
    (8,  0): ('Cousteau',  'crd00'), (8,  1): ('Frobert',   'crd01'),
    (8,  2): ('Camofrog',  'crd02'), (8,  3): ('Drift',     'crd03'),
    (8,  4): ('Gigi',      'crd04'), (8,  5): ('Raddle',    'crd05'),
    (8,  6): ('Lily',      'crd06'), (8,  7): ('Ribbot',    'crd07'),
    (8,  8): ('Jeremiah',  'crd08'), (8,  9): ('Diva',      'crd09'),
    (8, 10): ('Henry',     'crd10'),
    # Penguins (species 26)
    (26, 0): ('Roald',     'pbr00'), (26, 1): ('Cube',      'pbr01'),
    (26, 2): ('Friga',     'pbr02'), (26, 3): ('Gwen',      'pbr03'),
    (26, 4): ('Hopper',    'pbr04'), (26, 5): ('Aurora',    'pbr05'),
    (26, 6): ('Boomer',    'pbr06'), (26, 7): ('Sprinkle',  'pbr07'),
    # Squirrels (species 32)
    (32, 0): ('Agent S',   'squ00'), (32, 1): ('Peanut',    'squ01'),
    (32, 2): ('Static',    'squ02'), (32, 3): ('Mint',      'squ03'),
    (32, 4): ('Filbert',   'squ04'), (32, 5): ('Hazel',     'squ05'),
    (32, 6): ('Pecan',     'squ06'), (32, 7): ('Marshal',   'squ07'),
    (32, 8): ('Nibbles',   'squ08'), (32, 9): ('Sally',     'squ09'),
    # Wolves (species 34)
    (34, 0): ('Fang',      'wol00'), (34, 1): ('Wolfgang',  'wol01'),
    (34, 2): ('Whitney',   'wol02'), (34, 3): ('Freya',     'wol03'),
    (34, 4): ('Skye',      'wol04'), (34, 5): ('Dobie',     'wol05'),
    (34, 6): ('Kyle',      'wol06'),
    # Ducks (species 11)
    (11, 0): ('Bill',      'duk00'), (11, 1): ('Freckles',  'duk01'),
    (11, 2): ('Mallary',   'duk02'), (11, 3): ('Weber',     'duk03'),
    (11, 4): ('Miranda',   'duk04'), (11, 5): ('Pompom',    'duk05'),
    (11, 6): ('Molly',     'duk06'), (11, 7): ('Derwin',    'duk07'),
    # Horses (species 18)
    (18, 0): ('Buck',      'hrs00'), (18, 1): ('Victoria',  'hrs01'),
    (18, 2): ('Savannah',  'hrs02'), (18, 3): ('Elmer',     'hrs03'),
    (18, 4): ('Roscoe',    'hrs04'), (18, 5): ('Winnie',    'hrs05'),
    (18, 6): ('Ed',        'hrs06'), (18, 7): ('Cleo',      'hrs07'),
    # Eagles (species 13)
    (13, 0): ('Apollo',    'flg00'), (13, 1): ('Amelia',    'flg01'),
    (13, 2): ('Keaton',    'flg02'), (13, 3): ('Buzz',      'flg03'),
    # Elephants (species 12)
    (12, 0): ('Dizzy',     'elp00'), (12, 1): ('Big Top',   'elp01'),
    (12, 2): ('Eloise',    'elp02'), (12, 3): ('Axel',      'elp03'),
    (12, 4): ('Opal',      'elp04'), (12, 5): ('Tucker',    'elp05'),
    # Hamsters (species 16)
    (16, 0): ('Hamphrey',  'ham00'), (16, 1): ('Apple',     'ham01'),
    (16, 2): ('Clay',      'ham02'), (16, 3): ('Graham',    'ham03'),
    (16, 4): ('Rodeo',     'ham04'),
    # Deer (species 9)
    (9,  0): ('Bam',       'der00'), (9,  1): ('Fauna',     'der01'),
    (9,  2): ('Zell',      'der02'), (9,  3): ('Chelsea',   'der03'),
    (9,  4): ('Bruce',     'der04'), (9,  5): ('Deirdre',   'der05'),
    (9,  6): ('Diana',     'der06'), (9,  7): ('Erik',      'der07'),
    # Monkeys (species 22)
    (22, 0): ('Shari',     'mnk00'), (22, 1): ('Flip',      'mnk01'),
    (22, 2): ('Deli',      'mnk02'), (22, 3): ('Louie',     'mnk03'),
    # Octopus (species 24)
    (24, 0): ('Octavian',  'ocp00'), (24, 1): ('Marina',    'ocp01'),
    (24, 2): ('Zucker',    'ocp02'),
    # Gorillas (species 15)
    (15, 0): ('Peewee',    'gor00'), (15, 1): ('Boone',     'gor01'),
    (15, 2): ('Violet',    'gor02'), (15, 3): ('Boyd',      'gor03'),
    (15, 4): ('Caesar',    'gor04'), (15, 5): ('Hans',      'gor05'),
    # Hippos (species 17)
    (17, 0): ('Rocco',     'hip00'), (17, 1): ('Bubbles',   'hip01'),
    (17, 2): ('Bertha',    'hip02'), (17, 3): ('Biff',      'hip03'),
    (17, 4): ('Harry',     'hip04'), (17, 5): ('Bitty',     'hip05'),
    # Sheep (species 31)
    (31, 0): ('Baabara',   'shp00'), (31, 1): ('Eunice',    'shp01'),
    (31, 2): ('Timbra',    'shp02'), (31, 3): ('Vesta',     'shp03'),
    (31, 4): ('Wendy',     'shp04'), (31, 5): ('Frita',     'shp05'),
    (31, 6): ('Stella',    'shp06'), (31, 7): ('Cashmere',  'shp07'),
    # Mice (species 23)
    (23, 0): ('Bettina',   'mus00'), (23, 1): ('Dora',      'mus01'),
    (23, 2): ('Candi',     'mus02'), (23, 3): ('Broccolo',  'mus03'),
    (23, 4): ('Moose',     'mus04'), (23, 5): ('Limberg',   'mus05'),
    (23, 6): ('Samson',    'mus06'), (23, 7): ('Rod',       'mus07'),
    # Birds (species 2)
    (2,  0): ('Robin',     'brd00'), (2,  1): ('Jacques',   'brd01'),
    (2,  2): ('Piper',     'brd02'), (2,  3): ('Anchovy',   'brd03'),
    (2,  4): ('Twiggy',    'brd04'), (2,  5): ('Jitters',   'brd05'),
    (2,  6): ('Peck',      'brd06'), (2,  7): ('Sparro',    'brd07'),
    # Anteaters (species 0)
    (0,  0): ('Anabelle',  'ant00'), (0,  1): ('Cyrano',    'ant01'),
    (0,  2): ('Antonio',   'ant02'), (0,  3): ('Annalisa',  'ant03'),
    (0,  4): ('Olaf',      'ant04'),
    # Bulls (species 3)
    (3,  0): ('Rodeo',     'bul00'), (3,  1): ('Stu',       'bul02'),
    (3,  2): ('T-Bone',    'bul03'), (3,  3): ('Vic',       'bul04'),
    # Chickens (species 6)
    (6,  0): ('Ava',       'chn00'), (6,  1): ('Brenda',    'chn01'),
    (6,  2): ('Goose',     'chn02'), (6,  3): ('Plucky',    'chn03'),
    (6,  4): ('Knox',      'chn04'), (6,  5): ('Becky',     'chn05'),
    # Cows (species 7)
    (7,  0): ('Naomi',     'cow00'), (7,  1): ('Patty',     'cow01'),
    (7,  2): ('Norma',     'cow02'), (7,  3): ('Tipper',    'cow03'),
    # Goats (species 14)
    (14, 0): ('Velma',     'goa00'), (14, 1): ('Chevre',    'goa01'),
    (14, 2): ('Billy',     'goa02'), (14, 3): ('Gruff',     'goa03'),
    (14, 4): ('Nan',       'goa04'), (14, 5): ('Pashmina',  'goa05'),
    # Kangaroos (species 20)
    (20, 0): ('Astrid',    'kgr00'), (20, 1): ('Mathilda',  'kgr01'),
    (20, 2): ('Carrie',    'kgr02'), (20, 3): ('Marcy',     'kgr03'),
    (20, 4): ('Kitt',      'kgr04'), (20, 5): ('Walt',      'kgr05'),
    # Koalas (species 19)
    (19, 0): ('Sydney',    'kal00'), (19, 1): ('Melba',     'kal01'),
    (19, 2): ('Ozzie',     'kal02'), (19, 3): ('Yuka',      'kal03'),
    (19, 4): ('Canberra',  'kal04'), (19, 5): ('Lyman',     'kal06'),
    # Lions (species 21)
    (21, 0): ('Mott',      'lon00'), (21, 1): ('Bud',       'lon01'),
    (21, 2): ('Elvis',     'lon02'), (21, 3): ('Lionel',    'lon03'),
    # Ostriches (species 25)
    (25, 0): ('Blanche',   'ost00'), (25, 1): ('Julia',     'ost01'),
    (25, 2): ('Gladys',    'ost02'), (25, 3): ('Phil',      'ost03'),
    (25, 4): ('Phoebe',    'ost04'),
    # Pigs (species 27 / 28)
    (27, 0): ('Pancetti',  'pgn00'), (27, 1): ('Agnes',     'pgn01'),
    (27, 2): ('Rasher',    'pgn02'), (27, 3): ('Curly',     'pgn03'),
    (27, 4): ('Truffles',  'pgn04'), (27, 5): ('Chops',     'pgn05'),
    (27, 6): ('Croque',    'pgn06'), (27, 7): ('Boris',     'pgn07'),
    # Rhinos (species 30)
    (30, 0): ('Tank',      'rhn00'), (30, 1): ('Spike',     'rhn01'),
    (30, 2): ('Hornsby',   'rhn02'), (30, 3): ('Rhonda',    'rhn03'),
    # Ostrich continued
}

# Fixed personality per internalId, sourced from NHSE VillagerUtil + Nookipedia.
# The personality byte at save-file offset +0x02 does not map to VillagerPersonality enum;
# use this table instead when reading from main.dat.
# 0=Lazy 1=Jock 2=Cranky 3=Smug 4=Normal 5=Peppy 6=Snooty 7=Uchi
_VILLAGER_FIXED_PERSONALITY = {
    # Cats
    'cat00': 0,  'cat01': 2,  'cat02': 4,  'cat03': 5,  'cat04': 6,
    'cat05': 4,  'cat06': 2,  'cat07': 1,  'cat08': 6,  'cat09': 5,
    'cat10': 1,  'cat11': 6,  'cat12': 5,  'cat13': 6,  'cat14': 2,
    'cat15': 6,  'cat16': 4,  'cat17': 5,  'cat18': 5,  'cat19': 5,
    # Tigers
    'tig00': 2,  'tig01': 1,  'tig02': 3,  'tig03': 6,  'tig04': 4,
    # Dogs
    'dog00': 0,  'dog01': 6,  'dog02': 0,  'dog03': 2,  'dog04': 4,
    'dog05': 4,  'dog06': 0,  'dog07': 3,
    # Bears
    'bea00': 0,  'bea01': 1,  'bea02': 4,  'bea03': 0,  'bea04': 7,
    'bea05': 2,  'bea06': 5,  'bea07': 2,  'bea08': 7,  'bea09': 4,
    'bea10': 3,
    # Cubs
    'cbr00': 0,  'cbr01': 0,  'cbr02': 1,  'cbr03': 4,  'cbr04': 0,
    'cbr05': 2,  'cbr06': 1,  'cbr07': 2,
    # Rabbits
    'rbt00': 5,  'rbt01': 5,  'rbt02': 5,  'rbt03': 5,  'rbt04': 6,
    'rbt05': 1,  'rbt06': 5,  'rbt07': 0,  'rbt08': 0,  'rbt09': 5,
    'rbt10': 7,  'rbt11': 3,
    # Frogs
    'crd00': 1,  'crd01': 1,  'crd02': 2,  'crd03': 1,  'crd04': 6,
    'crd05': 0,  'crd06': 4,  'crd07': 1,  'crd08': 0,  'crd09': 7,
    'crd10': 3,
    # Penguins
    'pbr00': 1,  'pbr01': 0,  'pbr02': 6,  'pbr03': 6,  'pbr04': 2,
    'pbr05': 4,  'pbr06': 0,  'pbr07': 4,
    # Squirrels
    'squ00': 5,  'squ01': 5,  'squ02': 2,  'squ03': 4,  'squ04': 0,
    'squ05': 7,  'squ06': 6,  'squ07': 3,  'squ08': 5,  'squ09': 4,
    # Wolves
    'wol00': 2,  'wol01': 2,  'wol02': 6,  'wol03': 6,  'wol04': 4,
    'wol05': 2,  'wol06': 3,
    # Ducks
    'duk00': 1,  'duk01': 5,  'duk02': 6,  'duk03': 0,  'duk04': 6,
    'duk05': 5,  'duk06': 4,  'duk07': 0,
    # Horses
    'hrs00': 1,  'hrs01': 5,  'hrs02': 4,  'hrs03': 0,  'hrs04': 2,
    'hrs05': 5,  'hrs06': 3,  'hrs07': 6,
    # Eagles
    'flg00': 2,  'flg01': 6,  'flg02': 3,  'flg03': 2,
    # Elephants
    'elp00': 0,  'elp01': 1,  'elp02': 6,  'elp03': 1,  'elp04': 6,
    'elp05': 0,
    # Hamsters
    'ham00': 2,  'ham01': 5,  'ham02': 0,  'ham03': 3,  'ham04': 1,
    # Deer
    'der00': 1,  'der01': 4,  'der02': 3,  'der03': 4,  'der04': 2,
    'der05': 7,  'der06': 6,  'der07': 0,
    # Monkeys
    'mnk00': 7,  'mnk01': 1,  'mnk02': 0,  'mnk03': 1,
    # Octopus
    'ocp00': 2,  'ocp01': 4,  'ocp02': 0,
    # Gorillas
    'gor00': 2,  'gor01': 1,  'gor02': 6,  'gor03': 2,  'gor04': 3,
    'gor05': 3,
    # Hippos
    'hip00': 2,  'hip01': 5,  'hip02': 4,  'hip03': 1,  'hip04': 2,
    'hip05': 6,
    # Sheep
    'shp00': 6,  'shp01': 4,  'shp02': 6,  'shp03': 4,  'shp04': 5,
    'shp05': 7,  'shp06': 4,  'shp07': 6,
    # Mice
    'mus00': 4,  'mus01': 4,  'mus02': 5,  'mus03': 2,  'mus04': 1,
    'mus05': 2,  'mus06': 1,  'mus07': 1,
    # Birds
    'brd00': 4,  'brd01': 3,  'brd02': 5,  'brd03': 0,  'brd04': 5,
    'brd05': 1,  'brd06': 1,  'brd07': 1,
    # Anteaters
    'ant00': 5,  'ant01': 2,  'ant02': 1,  'ant03': 4,  'ant04': 3,
    # Bulls
    'bul00': 1,  'bul02': 0,  'bul03': 2,  'bul04': 2,
    # Chickens
    'chn00': 4,  'chn01': 4,  'chn02': 1,  'chn03': 5,  'chn04': 2,
    'chn05': 6,
    # Cows
    'cow00': 6,  'cow01': 5,  'cow02': 4,  'cow03': 6,
    # Goats
    'goa00': 4,  'goa01': 4,  'goa02': 1,  'goa03': 2,  'goa04': 4,
    'goa05': 4,
    # Kangaroos
    'kgr00': 6,  'kgr01': 7,  'kgr02': 4,  'kgr03': 4,  'kgr04': 4,
    'kgr05': 2,
    # Koalas
    'kal00': 4,  'kal01': 4,  'kal02': 0,  'kal03': 6,  'kal04': 7,
    'kal06': 1,
    # Lions
    'lon00': 1,  'lon01': 1,  'lon02': 2,  'lon03': 3,
    # Ostriches
    'ost00': 6,  'ost01': 6,  'ost02': 4,  'ost03': 3,  'ost04': 5,
    # Pigs
    'pgn00': 6,  'pgn01': 7,  'pgn02': 2,  'pgn03': 1,  'pgn04': 5,
    'pgn05': 3,  'pgn06': 2,  'pgn07': 2,
    # Rhinos
    'rhn00': 1,  'rhn01': 2,  'rhn02': 0,  'rhn03': 4,
}

# Friendship tier thresholds
_FRIENDSHIP_TIERS = [
    (200, 'BFF'),
    (150, 'Close Friend'),
    (100, 'Best Friend'),
    (60,  'Good Friend'),
    (30,  'Friend'),
    (1,   'Acquaintance'),
    (0,   'Stranger'),
]


def _read_utf16le(data, max_chars=16):
    """Decode UTF-16LE bytes, stopping at null terminator."""
    chars = []
    for i in range(0, min(len(data) - 1, max_chars * 2), 2):
        cp = struct.unpack_from('<H', data, i)[0]
        if cp == 0:
            break
        try:
            chars.append(chr(cp))
        except (ValueError, OverflowError):
            chars.append('?')
    return ''.join(chars).strip()


def _friendship_tier(points):
    for threshold, label in _FRIENDSHIP_TIERS:
        if points >= threshold:
            return label
    return 'Stranger'


def _score_villager_candidate(pid, dram_base, base_va):
    """
    Score a candidate Villager2 array base VA.
    Higher is better. Returns (score, species_list).
    Penalises arrays where all occupied slots share the same species.
    Rewards diversity and presence of Tiger (sp=33) or Cat (sp=4).
    """
    species_list = []
    for slot in range(10):
        slot_va = base_va + slot * _VILLAGER2_SIZE
        try:
            hdr = _read_switch_va(pid, dram_base, slot_va, 3)
        except Exception:
            species_list.append(None)
            continue
        sp, vr, p = hdr[0], hdr[1], hdr[2]
        if sp >= 35 or vr > 20 or p > 8:
            species_list.append(None)
        else:
            species_list.append((sp, vr))

    occupied = [(sp, vr) for sp, vr in (x for x in species_list if x is not None)]
    if not occupied:
        return -1, species_list

    catalog_hits   = sum(1 for sv in occupied if _VILLAGER_CATALOG.get(sv) is not None)
    unique_species = len(set(sv[0] for sv in occupied))
    has_tiger      = any(sv[0] == 33 for sv in occupied)
    has_cat        = any(sv[0] == 4  for sv in occupied)
    all_same       = (unique_species == 1 and len(occupied) > 1)

    score = catalog_hits * 3 + unique_species * 5
    if has_tiger: score += 20
    if has_cat:   score += 20
    if all_same:  score -= 50   # heavy penalty for repeated-species false positives
    return score, species_list


def _find_villager_array_procmem(pid, dram_base):
    """
    Dynamically locate the Villager2 array base VA by scanning live DRAM.
    Checks env override ACNH_VILLAGER_ARRAY_VA first.
    Collects ALL candidates in the scan window, scores each on species
    diversity + Tiger/Cat presence, and returns the best-scoring VA.
    Returns base VA of first villager slot, or None if not found.
    """
    override = os.environ.get('ACNH_VILLAGER_ARRAY_VA', '').strip()
    if override:
        return int(override, 16) if override.startswith('0x') else int(override)

    # Scan 128MB around the known player area for consecutive villager slots.
    # Two consecutive villager2 structs must both start with valid species (0-34).
    scan_start = 0xAF000000
    scan_size  = 0x8000000   # 128MB
    chunk_size = 0x200000    # 2MB

    candidates = []  # list of (chunk_va + i) for each passing candidate
    # If we find a candidate containing both Tiger (sp=33) AND Cat (sp=4) we can
    # stop immediately — that is the real villager array.
    _EARLY_EXIT_SPECIES = {4, 33}  # Cat, Tiger

    for chunk_off in range(0, scan_size, chunk_size):
        va = scan_start + chunk_off
        try:
            data = _read_switch_va(pid, dram_base, va, chunk_size)
        except Exception:
            continue
        for i in range(0, len(data) - _VILLAGER2_SIZE * 3 - 4, 4):
            # Require 3 consecutive valid slots to reduce false positives
            valid_count = 0
            for s in range(3):
                off = i + s * _VILLAGER2_SIZE
                if off + 3 >= len(data):
                    break
                sp  = data[off]
                vr  = data[off + 1]
                p   = data[off + 2]
                if sp > 35 or vr > 20 or p > 8:
                    break
                valid_count += 1
            if valid_count < 3:
                continue
            # Require at least 2 of the 3 to be known catalog entries
            catalog_hits = sum(
                1 for s in range(3)
                if _VILLAGER_CATALOG.get((data[i + s * _VILLAGER2_SIZE], data[i + s * _VILLAGER2_SIZE + 1])) is not None
            )
            if catalog_hits < 2:
                continue
            # Require at least 2 of the 3 to have non-zero species (excludes null memory)
            non_zero_species = sum(
                1 for s in range(3) if data[i + s * _VILLAGER2_SIZE] > 0
            )
            if non_zero_species < 2:
                continue
            candidate_va = va + i
            candidates.append(candidate_va)
            # Early exit: if this candidate already contains both Tiger (sp=33)
            # and Cat (sp=4) across its 10 slots, it's the real villager array.
            slot_species = set()
            for s in range(10):
                slot_off = candidate_va - va + s * _VILLAGER2_SIZE
                if slot_off + 1 < len(data):
                    slot_species.add(data[slot_off])
            if _EARLY_EXIT_SPECIES.issubset(slot_species):
                return candidate_va

    if not candidates:
        return None

    # Score every candidate and return the best
    best_va    = None
    best_score = -1
    for cva in candidates:
        score, _ = _score_villager_candidate(pid, dram_base, cva)
        if score > best_score:
            best_score = score
            best_va    = cva
    return best_va


# ---------------------------------------------------------------------------
# VillagerItem helpers (furniture / clothes lists)
# ---------------------------------------------------------------------------

def _read_villager_items_from_bytes(data: bytes, base: int, count: int) -> list:
    """Read `count` VillagerItem(0x2C) entries from save bytes starting at `base`."""
    items = []
    for i in range(count):
        off = base + i * _VILLAGER_ITEM_SIZE
        item_id = struct.unpack_from('<H', data, off)[0]
        flag0   = struct.unpack_from('<H', data, off + 2)[0]
        flag1   = struct.unpack_from('<H', data, off + 4)[0]
        items.append({'itemId': f'0x{item_id:04X}', 'flag0': flag0, 'flag1': flag1})
    return items


def _read_villager_items_from_mem(pid, dram_base, va: int, count: int) -> list:
    """Read `count` VillagerItem(0x2C) entries from live Ryujinx memory at Switch VA `va`."""
    items = []
    for i in range(count):
        try:
            raw = _read_switch_va(pid, dram_base, va + i * _VILLAGER_ITEM_SIZE, _VILLAGER_ITEM_SIZE)
            item_id = struct.unpack_from('<H', raw)[0]
            flag0   = struct.unpack_from('<H', raw, 2)[0]
            flag1   = struct.unpack_from('<H', raw, 4)[0]
            items.append({'itemId': f'0x{item_id:04X}', 'flag0': flag0, 'flag1': flag1})
        except Exception:
            items.append({'itemId': '0xFFFE', 'flag0': 0, 'flag1': 0})
    return items


def _read_one_villager(pid, dram_base, slot_va, slot_index):
    """Read a single Villager2 struct from live memory and return a dict."""
    try:
        hdr = _read_switch_va(pid, dram_base, slot_va, 4)
    except Exception:
        return {'slot': slot_index, 'empty': True, 'error': 'read_failed'}

    species_id  = hdr[0]
    variant     = hdr[1]
    personality = hdr[2]

    # Treat species >= 35 as empty/invalid (35='Non', 0xFE/0xFF = uninitialized)
    if species_id >= 35:
        return {'slot': slot_index, 'empty': True}

    # Resolve name from catalog
    catalog_entry = _VILLAGER_CATALOG.get((species_id, variant))
    display_name = catalog_entry[0] if catalog_entry else None
    internal_id  = catalog_entry[1] if catalog_entry else f'sp{species_id}v{variant}'

    species_label = _VILLAGER_SPECIES_NAMES.get(species_id, ('Unknown', 'unk'))[0]
    personality_label = _VILLAGER_PERSONALITY_NAMES[personality] if personality < len(_VILLAGER_PERSONALITY_NAMES) else f'?{personality}'
    # Gender: personalities 0-3 = Male, 4-7 = Female  (NHSE: (personality/4)&1)
    gender = 'F' if personality >= 4 else 'M'

    # Catchphrase
    try:
        cp_raw = _read_switch_va(pid, dram_base, slot_va + _VILLAGER2_CATCHPHRASE_OFF, 24)
        catchphrase = _read_utf16le(cp_raw, 12)
    except Exception:
        catchphrase = ''

    # Friendship from GSaveMemory[0]
    gsave0_base = slot_va + _VILLAGER2_GSAVE0_OFF
    try:
        friendship_raw = _read_switch_va(pid, dram_base, gsave0_base + _GSAVE_FRIENDSHIP_OFF, 1)
        friendship = friendship_raw[0]
    except Exception:
        friendship = 0

    # Player/town name from GSaveMemory[0]
    try:
        tname_raw = _read_switch_va(pid, dram_base, gsave0_base + _GSAVE_TOWNNAME_OFF, 20)
        town_name = _read_utf16le(tname_raw, 10)
    except Exception:
        town_name = ''

    try:
        pname_raw = _read_switch_va(pid, dram_base, gsave0_base + _GSAVE_PLAYERNAME_OFF, 20)
        player_name = _read_utf16le(pname_raw, 10)
    except Exception:
        player_name = ''

    # Moving out
    try:
        mt_raw = _read_switch_va(pid, dram_base, slot_va + _VILLAGER2_MOVETYPE_OFF, 1)
        moving_out = bool(mt_raw[0] & 0x02)
    except Exception:
        moving_out = False

    # Flags (EventFlagsSave) — ushort[18] at Villager2+0x1267C
    try:
        flags_raw = _read_switch_va(pid, dram_base, slot_va + _VILLAGER2_FLAGS_OFF, _VILLAGER2_FLAGS_COUNT * 2)
        flags = list(struct.unpack_from(f'<{_VILLAGER2_FLAGS_COUNT}H', flags_raw))
    except Exception:
        flags = []

    # Image URL: acnhcdn.com public CDN — no auth required
    img_url = f'https://acnhcdn.com/latest/NpcIcon/{display_name}.png' if display_name else None

    # Furniture (FtrStockList: 32 × VillagerItem at slot_va+0x10d6c)
    try:
        furniture = _read_villager_items_from_mem(pid, dram_base, slot_va + _VILLAGER2_FTR_OFF, _VILLAGER2_FTR_COUNT)
    except Exception:
        furniture = []

    # Clothes (WearStockList: 24 × VillagerItem at slot_va+0x1094c)
    try:
        clothes = _read_villager_items_from_mem(pid, dram_base, slot_va + _VILLAGER2_WEAR_OFF, _VILLAGER2_WEAR_COUNT)
    except Exception:
        clothes = []

    # Room (GSaveRoomFloorWall at slot_va+0x12880)
    try:
        room_raw = _read_switch_va(pid, dram_base, slot_va + _VILLAGER2_ROOM_OFF, 0x24)
        room = {
            'accentWallDesignId': struct.unpack_from('<H', room_raw, 0x18)[0],
            'accentWallDirection': room_raw[0x1e],
            'wallDesignId':        struct.unpack_from('<H', room_raw, 0x1a)[0],
            'wallInfoBit':         room_raw[0x1f],
            'floorDesignId':       struct.unpack_from('<H', room_raw, 0x1c)[0],
            'floorDirection':      room_raw[0x20],
        }
    except Exception:
        room = {}

    # DIY crafting timer
    try:
        diy_raw = _read_switch_va(pid, dram_base, slot_va + _VILLAGER2_DIY_HOUR_OFF, 6)
        diy_hour, diy_min, diy_sec = diy_raw[0], diy_raw[1], diy_raw[2]
        diy_recipe = struct.unpack_from('<H', diy_raw, 3)[0]
        diy = {
            'isCrafting':    bool(diy_recipe),
            'craftingUntil': f'{diy_hour:02d}:{diy_min:02d}:{diy_sec:02d}' if diy_recipe else '',
            'recipeIndex':   diy_recipe,
        }
    except Exception:
        diy = {}

    # Player memory (GSaveMemory[0..7])
    try:
        playerMemory = []
        for pi in range(8):
            gb = gsave0_base + pi * _GSAVE_SIZE
            try:
                pname_r = _read_switch_va(pid, dram_base, gb + _GSAVE_PLAYERNAME_OFF, 20)
                tname_r = _read_switch_va(pid, dram_base, gb + _GSAVE_TOWNNAME_OFF,   20)
                fs_r    = _read_switch_va(pid, dram_base, gb + _GSAVE_FRIENDSHIP_OFF,  1)
                playerMemory.append({
                    'playerName': _read_utf16le(pname_r, 10),
                    'townName':   _read_utf16le(tname_r, 10),
                    'friendship': fs_r[0],
                })
            except Exception:
                playerMemory.append({'playerName': '', 'townName': '', 'friendship': 0})
    except Exception:
        playerMemory = []

    return {
        'slot':         slot_index,
        'empty':        False,
        'name':         display_name,
        'internalId':   internal_id,
        'species':      species_id,
        'speciesName':  species_label,
        'variant':      variant,
        'personality':  personality,
        'personalityName': personality_label,
        'gender':       gender,
        'catchphrase':  catchphrase,
        'friendship':   friendship,
        'friendshipTier': _friendship_tier(friendship),
        'playerName':   player_name,
        'townName':     town_name,
        'movingOut':    moving_out,
        'flags':        flags,
        'house':        {},
        'imageUrl':     img_url,
        'furniture':    furniture,
        'clothes':      clothes,
        'room':         room,
        'diy':          diy,
        'designs':      [],
        'playerMemory': playerMemory,
    }


def _read_one_villager_from_save(data: bytes, slot_index: int) -> dict:
    """Read one villager slot from decrypted main.dat bytes."""
    off = _VILLAGER2_ARRAY_FILE_OFFSET + slot_index * _VILLAGER2_SIZE
    species_id = data[off]
    variant    = data[off + 1]

    if species_id >= 35:
        return {'slot': slot_index + 1, 'empty': True}

    catalog_entry   = _VILLAGER_CATALOG.get((species_id, variant))
    display_name    = catalog_entry[0] if catalog_entry else None
    internal_id     = catalog_entry[1] if catalog_entry else f'sp{species_id}v{variant}'
    species_label   = _VILLAGER_SPECIES_NAMES.get(species_id, ('Unknown', 'unk'))[0]

    # Use the fixed-personality catalog; the byte at save offset +0x02 is not the
    # VillagerPersonality enum in the main.dat format.
    personality = _VILLAGER_FIXED_PERSONALITY.get(internal_id)
    if personality is None:
        personality = data[off + 2]   # fall back to raw byte if villager not in catalog
    personality_label = _VILLAGER_PERSONALITY_NAMES[personality] if personality < len(_VILLAGER_PERSONALITY_NAMES) else f'?{personality}'
    gender = 'F' if personality >= 4 else 'M'

    cp_off      = off + _VILLAGER2_CATCHPHRASE_OFF
    catchphrase = _read_utf16le(data[cp_off: cp_off + 24], 12)

    # Flags (EventFlagsSave) — ushort[18] at Villager2+0x1267C
    flags_base = off + _VILLAGER2_FLAGS_OFF
    flags = list(struct.unpack_from(f'<{_VILLAGER2_FLAGS_COUNT}H', data, flags_base))

    # House data (VillagerHouse2) — separate block in decrypted main.dat
    # Confirmed offsets: MainSaveOffsets20.cs NpcHouseList + VillagerHouse1.cs field layout
    house_off = _NPC_HOUSE_LIST_OFF + slot_index * _VH2_SIZE
    try:
        house = {
            'extension':         'nhvh2',
            'houseLevel':        struct.unpack_from('<I', data, house_off + _VH_HOUSE_LEVEL_OFF)[0],
            'houseStatus':       struct.unpack_from('<I', data, house_off + _VH_HOUSE_STATUS_OFF)[0],
            'wallUniqueId':      struct.unpack_from('<H', data, house_off + _VH_WALL_UID_OFF)[0],
            'roofUniqueId':      struct.unpack_from('<H', data, house_off + _VH_ROOF_UID_OFF)[0],
            'doorUniqueId':      struct.unpack_from('<H', data, house_off + _VH_DOOR_UID_OFF)[0],
            'orderWallUniqueId': struct.unpack_from('<H', data, house_off + _VH_ORDER_WALL_UID_OFF)[0],
            'orderRoofUniqueId': struct.unpack_from('<H', data, house_off + _VH_ORDER_ROOF_UID_OFF)[0],
            'orderDoorUniqueId': struct.unpack_from('<H', data, house_off + _VH_ORDER_DOOR_UID_OFF)[0],
            'npc1':              struct.unpack_from('<b', data, house_off + _VH_NPC1_OFF)[0],
            'npc2':              struct.unpack_from('<b', data, house_off + _VH_NPC2_OFF)[0],
            'buildPlayer':       struct.unpack_from('<b', data, house_off + _VH_BUILD_PLAYER_OFF)[0],
            'doorDecoItemName':  '0x{:04X}:0x{:04X}'.format(
                struct.unpack_from('<H', data, house_off + _VH_DOOR_DECO_OFF)[0],
                struct.unpack_from('<H', data, house_off + _VH_DOOR_DECO_OFF + 4)[0],
            ),
        }
    except Exception:
        house = {}

    img_url = f'https://acnhcdn.com/latest/NpcIcon/{display_name}.png' if display_name else None

    # Furniture (FtrStockList: 32 × VillagerItem at off+0x10d6c)
    try:
        furniture = _read_villager_items_from_bytes(data, off + _VILLAGER2_FTR_OFF, _VILLAGER2_FTR_COUNT)
    except Exception:
        furniture = []

    # Clothes (WearStockList: 24 × VillagerItem at off+0x1094c)
    try:
        clothes = _read_villager_items_from_bytes(data, off + _VILLAGER2_WEAR_OFF, _VILLAGER2_WEAR_COUNT)
    except Exception:
        clothes = []

    # Room (GSaveRoomFloorWall at off+0x12880, size 0x24)
    try:
        r = off + _VILLAGER2_ROOM_OFF
        room = {
            'accentWallDesignId': struct.unpack_from('<H', data, r + 0x18)[0],
            'accentWallDirection': data[r + 0x1e],
            'wallDesignId':        struct.unpack_from('<H', data, r + 0x1a)[0],
            'wallInfoBit':         data[r + 0x1f],
            'floorDesignId':       struct.unpack_from('<H', data, r + 0x1c)[0],
            'floorDirection':      data[r + 0x20],
        }
    except Exception:
        room = {}

    # DIY crafting timer (bytes at off+0x13151..0x13155)
    try:
        diy_hour   = data[off + _VILLAGER2_DIY_HOUR_OFF]
        diy_min    = data[off + _VILLAGER2_DIY_MIN_OFF]
        diy_sec    = data[off + _VILLAGER2_DIY_SEC_OFF]
        diy_recipe = struct.unpack_from('<H', data, off + _VILLAGER2_DIY_RECIPE_OFF)[0]
        diy = {
            'isCrafting':    bool(diy_recipe),
            'craftingUntil': f'{diy_hour:02d}:{diy_min:02d}:{diy_sec:02d}' if diy_recipe else '',
            'recipeIndex':   diy_recipe,
        }
    except Exception:
        diy = {}

    # Player memory (GSaveMemory[0..7] — friendship per player slot)
    try:
        playerMemory = []
        for pi in range(8):
            gb = off + _VILLAGER2_GSAVE0_OFF + pi * _GSAVE_SIZE
            pname = _read_utf16le(data[gb + _GSAVE_PLAYERNAME_OFF: gb + _GSAVE_PLAYERNAME_OFF + 20], 10)
            tname = _read_utf16le(data[gb + _GSAVE_TOWNNAME_OFF:   gb + _GSAVE_TOWNNAME_OFF + 20],   10)
            fs_val = data[gb + _GSAVE_FRIENDSHIP_OFF]
            playerMemory.append({'playerName': pname, 'townName': tname, 'friendship': fs_val})
    except Exception:
        playerMemory = []

    return {
        'slot':            slot_index + 1,
        'empty':           False,
        'name':            display_name,
        'internalId':      internal_id,
        'species':         species_id,
        'speciesName':     species_label,
        'variant':         variant,
        'personality':     personality,
        'personalityName': personality_label,
        'gender':          gender,
        'catchphrase':     catchphrase,
        'friendship':      0,
        'friendshipTier':  'Live only',
        'playerName':      '',
        'townName':        '',
        'movingOut':       False,
        'flags':           flags,
        'house':           house,
        'imageUrl':        img_url,
        'furniture':       furniture,
        'clothes':         clothes,
        'room':            room,
        'diy':             diy,
        'designs':         [],
        'playerMemory':    playerMemory,
    }


def read_villagers_from_save():
    """Read all 10 villager slots from the decrypted Ryujinx main.dat save file."""
    save_info = _find_main_save_file()
    if not save_info:
        print(json.dumps({
            'ok': False,
            'error': 'main.dat save file not found in Ryujinx save directories.',
            'villagers': [],
            'source': 'save-file',
        }))
        return

    main_dat_path, header_path, mtime = save_info
    with open(header_path, 'rb') as f:
        header_bytes = f.read()
    with open(main_dat_path, 'rb') as f:
        encrypted_data = f.read()

    key, counter = _derive_save_key_counter(header_bytes)
    decrypted = _aes_ctr_decrypt(encrypted_data, key, counter)

    villagers = [_read_one_villager_from_save(decrypted, i) for i in range(10)]

    print(json.dumps({
        'ok': True,
        'villagers': villagers,
        'source': 'save-file',
        'saveFile': main_dat_path,
        'savedAt': datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat(),
    }))


def read_villagers_procmem():
    """Read all 10 villager slots from live Ryujinx memory, falling back to save file."""
    _check_ptrace_scope()
    pid = _find_ryujinx_pid()
    dram_base = _find_dram_base(pid)

    array_base = _find_villager_array_procmem(pid, dram_base)
    if array_base is None:
        # DRAM scan failed — fall back to the on-disk save file.
        read_villagers_from_save()
        return

    villagers = []
    for i in range(10):
        slot_va = array_base + i * _VILLAGER2_SIZE
        villagers.append(_read_one_villager(pid, dram_base, slot_va, i + 1))

    print(json.dumps({
        'ok': True,
        'villagers': villagers,
        'arrayBaseVa': hex(array_base),
        'source': 'live-memory',
        'backend': 'procmem',
        'ryujinxPid': pid,
    }))


# ---------------------------------------------------------------------------
# Botbase fallback (socket protocol)
# ---------------------------------------------------------------------------

def _send_botbase_command(sock, command: str) -> str:
    wire = (command.strip() + "\r\n").encode("utf-8")
    sock.sendall(wire)
    chunks = []
    while True:
        chunk = sock.recv(4096)
        if not chunk:
            break
        chunks.append(chunk)
        if b"\n" in chunk:
            break
    if not chunks:
        raise RuntimeError(f"No response for command: {command}")
    return b"".join(chunks).decode("utf-8", errors="replace").strip()


def _parse_hex_payload(text: str) -> bytes:
    value = text.strip()
    if value.lower().startswith("0x"):
        value = value[2:]
    value = "".join(value.split())
    if len(value) % 2 != 0:
        raise ValueError("Expected even-length hex payload")
    return bytes.fromhex(value)


def _try_botbase_connection():
    ports_text = os.environ.get("ACNH_BOTBASE_PORTS", "").strip()
    if ports_text:
        ports = [int(p.strip()) for p in ports_text.split(",") if p.strip()]
    else:
        default_port = int(os.environ.get("ACNH_BOTBASE_PORT", "6000"))
        ports = list(dict.fromkeys([default_port] + BOTBASE_FALLBACK_PORTS))

    host = os.environ.get("ACNH_BOTBASE_HOST", "127.0.0.1")
    timeout = float(os.environ.get("ACNH_BOTBASE_TIMEOUT_SECONDS", "2.0"))
    last_error = None
    for port in ports:
        import socket as _socket
        s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
        s.settimeout(timeout)
        try:
            s.connect((host, port))
            return s
        except Exception as exc:
            last_error = exc
            try:
                s.close()
            except Exception:
                pass
    raise RuntimeError(
        f"No botbase endpoint reachable at {host} ports {ports}. "
        f"Last error: {last_error}."
    )


def read_game_data_botbase(sock):
    def req(env_key):
        val = os.environ.get(env_key, "").strip()
        if not val:
            raise RuntimeError(f"Missing required env var for botbase mode: {env_key}")
        return val

    name_encoding = os.environ.get("ACNH_PLAYER_NAME_ENCODING", "utf-16le")
    town_encoding = os.environ.get("ACNH_PLAYER_TOWN_ENCODING", "utf-16le")

    name_raw   = _parse_hex_payload(_send_botbase_command(sock, req("ACNH_PLAYER_NAME_CMD")))
    town_raw   = _parse_hex_payload(_send_botbase_command(sock, req("ACNH_PLAYER_TOWN_CMD")))
    wallet_raw = _parse_hex_payload(_send_botbase_command(sock, req("ACNH_PLAYER_WALLET_CMD")))
    bank_raw   = _parse_hex_payload(_send_botbase_command(sock, req("ACNH_PLAYER_BANK_CMD")))
    miles_raw  = _parse_hex_payload(_send_botbase_command(sock, req("ACNH_PLAYER_MILES_CMD")))

    def to_str(raw, enc):
        return raw.decode(enc, errors="ignore").replace("\x00", "").strip()

    def to_int(raw):
        return int.from_bytes(raw[:4], "little") if len(raw) >= 4 else 0

    print(json.dumps({
        "player": {
            "name":   to_str(name_raw, name_encoding),
            "town":   to_str(town_raw, town_encoding),
            "wallet": to_int(wallet_raw),
            "bank":   to_int(bank_raw),
            "miles":  to_int(miles_raw),
            "avatar": os.environ.get("ACNH_PLAYER_AVATAR", ""),
        },
        "slots": [],
        "source": "live-memory",
        "backend": "botbase",
        "lastGameSaveAt": datetime.now(timezone.utc).isoformat(),
        "lastGameDataFilePath": None,
    }))


def read_inventory_botbase(sock):
    custom_cmd = os.environ.get("ACNH_INVENTORY_JSON_CMD", "").strip()
    if not custom_cmd:
        print(json.dumps({"slots": [], "source": "live-memory", "backend": "botbase"}))
        return
    text = _send_botbase_command(sock, custom_cmd)
    parsed = json.loads(text)
    slots = parsed if isinstance(parsed, list) else parsed.get("slots", [])
    print(json.dumps({"slots": slots, "source": "live-memory", "backend": "botbase"}))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    args = sys.argv[1:]
    if not args or "--help" in args or "-h" in args:
        print(__doc__)
        return 0

    if "--scan" in args:
        return cmd_scan()

    command = args[0].strip()
    mode = os.environ.get("ACNH_READER_MODE", "auto").strip().lower()

    # auto: try proc_mem first; fall back to botbase if scope is blocked
    use_procmem = False
    if mode in ("auto", "procmem"):
        try:
            _check_ptrace_scope()
            use_procmem = True
        except RuntimeError:
            if mode == "procmem":
                raise  # explicit procmem mode: fail loudly
            # mode=auto: fall through to botbase

    if use_procmem:
        if command == "read_game_data":
            read_game_data_procmem()
            return 0
        if command == "read_inventory":
            read_inventory_procmem()
            return 0
        if command == "write_inventory_slot":
            request = json.loads(sys.stdin.read().strip() or "{}")
            write_inventory_slot_procmem(request)
            return 0
        if command == "write_game_data":
            request = json.loads(sys.stdin.read().strip() or "{}")
            write_game_data_procmem(request)
            return 0
        if command == "read_villagers":
            read_villagers_from_save()
            return 0
        if command == "read_villagers_procmem":
            read_villagers_procmem()
            return 0
        if command == "read_villagers_save":
            read_villagers_from_save()
            return 0
        raise RuntimeError(f"Unsupported command: {command}")
    else:
        sock = _try_botbase_connection()
        try:
            if command == "read_game_data":
                read_game_data_botbase(sock)
                return 0
            if command == "read_inventory":
                read_inventory_botbase(sock)
                return 0
            if command == "write_inventory_slot":
                request = json.loads(sys.stdin.read().strip() or "{}")
                payload = request.get("payload") if isinstance(request.get("payload"), dict) else request
                print(json.dumps({"slot": payload, "source": "live-memory", "backend": "botbase"}))
                return 0
            if command == "write_game_data":
                raise RuntimeError("write_game_data is not supported in botbase mode")
            raise RuntimeError(f"Unsupported command: {command}")
        finally:
            try:
                sock.close()
            except Exception:
                pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        sys.stderr.write(f"acnh_memory_reader failed: {exc}\n")
        raise SystemExit(1)
