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
import json
import os
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

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
        "name":   0xAFBC6400,
        "town":   0xAFBC6600,
        "wallet": 0xAFBC6510,
        "bank":   0xAFBC6514,
        "miles":  0xAFBC6518,
    }
}

_ITEM_NONE = 0xFFFE
_ITEM_SIZE = 8
# Ryujinx loads save slot 0/ and save slot 1/ into consecutive Switch VA memory.
# The in-game pocket UI renders from the slot-1 copy which sits 0x6A540 bytes
# above the slot-0 inventory VA.  Both copies must be written for the pocket
# display to refresh immediately without a menu close/reopen.
_SAVE_SLOT1_INVENTORY_DELTA = 0x6A540
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
    "wallet": 10146,
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

        # Keep explicit known path fallback for existing Steam Deck setup.
        if "/applications/publish/ryujinx" in cmdline_lc:
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

    # Only trust the fast path when the numeric fields are also write-safe.
    if (
        _is_clean_player_text(baseline["name"])
        and _is_clean_player_text(baseline["town"])
        and int(baseline.get("encryptedHits", 0)) == 3
    ):
        return baseline

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
    # Write the canonical 8-byte pocket slot (slot-0, game-engine copy), then
    # patch the slot-1 display copy so the in-game pocket UI refreshes live.
    # Ryujinx holds both save slots in consecutive Switch VA memory; the pocket
    # menu renders from the slot-1 copy at slot_va + _SAVE_SLOT1_INVENTORY_DELTA.
    # Writing only slot_va leaves the display stale until close/reopen.
    offsets = _get_inventory_offsets()
    raw = _encode_slot(slot_payload)
    slot_va = _slot_switch_va(slot_payload["slot"], offsets)

    _write_switch_va(pid, dram_base, slot_va, raw)

    # Patch the slot-1 display copy for live UI refresh.
    mirror_va = slot_va + _SAVE_SLOT1_INVENTORY_DELTA
    mirror_written = False
    try:
        _write_switch_va(pid, dram_base, mirror_va, raw)
        mirror_written = True
    except RuntimeError:
        pass  # mirror region not mapped — single write only

    refreshed = _read_switch_va(pid, dram_base, slot_va, _ITEM_SIZE)
    result = _decode_slot(refreshed, slot_payload["slot"])
    result["mirrorWritten"] = mirror_written
    return result


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

    payload = {
        "player": {
            "name":   name,
            "town":   town,
            "wallet": wallet,
            "bank":   bank,
            "miles":  miles,
            "avatar": os.environ.get("ACNH_PLAYER_AVATAR", "/assets/items/Bob_NH.png"),
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
            "avatar": os.environ.get("ACNH_PLAYER_AVATAR", "/assets/items/Bob_NH.png"),
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
            "avatar": os.environ.get("ACNH_PLAYER_AVATAR", "/assets/items/Bob_NH.png"),
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
