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

# Minimum DRAM region size in bytes to identify Ryujinx's flat Switch DRAM mapping.
_MIN_DRAM_SIZE = 512 * 1024 * 1024   # 512 MB; real is 4 GB but partial maps work too

BOTBASE_FALLBACK_PORTS = [6000, 6001]


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
    for proc_dir in glob.glob("/proc/[0-9]*"):
        try:
            cmdline = open(proc_dir + "/cmdline", "rb").read().decode("utf-8", "ignore").replace("\x00", " ")
            # Match the actual Ryujinx binary, not launchers or config browsers.
            if "/Applications/publish/Ryujinx" in cmdline or (
                "ryujinx" in cmdline.lower() and
                "dolphin" not in cmdline.lower() and
                ".config/Ryujinx" not in cmdline
            ):
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


def _decode_utf16le_safe(data: bytes) -> str:
    try:
        return data.decode("utf-16le", errors="ignore").split("\x00")[0].strip()
    except Exception:
        return ""


def _is_plausible_text(value: str) -> bool:
    if not value:
        return False
    if len(value) > 12:
        return False
    printable = sum(1 for ch in value if ch.isprintable())
    return printable == len(value)


def _score_dram_candidate(pid: int, dram_base: int, offsets: dict):
    score = 0
    details = {}

    for field in ("name", "town"):
        try:
            raw = _read_switch_va(pid, dram_base, offsets[field], 16)
            text = _decode_utf16le_safe(raw)
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

    return score, details


def _candidate_dram_bases(pid: int, offsets: dict):
    candidates = []
    seen = set()
    for start, end, perms, label in _parse_maps(pid):
        if start in seen:
            continue
        seen.add(start)
        score, details = _score_dram_candidate(pid, start, offsets)
        size = end - start
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
    if candidates and candidates[0]["score"] >= 5:
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


def _decode_utf16le(data: bytes) -> str:
    text = data.decode("utf-16le", errors="ignore")
    return text.split("\x00")[0].strip()


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


# ---------------------------------------------------------------------------
# Command handlers — proc_mem mode
# ---------------------------------------------------------------------------

def read_game_data_procmem():
    _check_ptrace_scope()
    pid = _find_ryujinx_pid()
    dram_base = _find_dram_base(pid)
    offs = _get_offsets()

    name  = _decode_utf16le(_read_switch_va(pid, dram_base, offs["name"],   16))
    town  = _decode_utf16le(_read_switch_va(pid, dram_base, offs["town"],   16))
    wallet = _read_uint32(_read_switch_va(pid, dram_base, offs["wallet"],    4))
    bank   = _read_uint32(_read_switch_va(pid, dram_base, offs["bank"],      4))
    miles  = _read_uint32(_read_switch_va(pid, dram_base, offs["miles"],     4))

    payload = {
        "player": {
            "name":   name,
            "town":   town,
            "wallet": wallet,
            "bank":   bank,
            "miles":  miles,
            "avatar": os.environ.get("ACNH_PLAYER_AVATAR", "/assets/items/Bob_NH.png"),
        },
        "slots": [],
        "source": "live-procmem",
        "ryujinxPid": pid,
        "dramBase": hex(dram_base),
        "lastGameSaveAt": datetime.now(timezone.utc).isoformat(),
        "lastGameDataFilePath": None,
    }
    print(json.dumps(payload))


def read_inventory_procmem():
    # Inventory reads require per-slot Switch VAs; return empty list for now.
    # The bridge still shows game data; this enables full slot reads later.
    print(json.dumps({"slots": [], "source": "live-procmem"}))


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
        "source": "live-botbase",
        "lastGameSaveAt": datetime.now(timezone.utc).isoformat(),
        "lastGameDataFilePath": None,
    }))


def read_inventory_botbase(sock):
    custom_cmd = os.environ.get("ACNH_INVENTORY_JSON_CMD", "").strip()
    if not custom_cmd:
        print(json.dumps({"slots": [], "source": "live-botbase"}))
        return
    text = _send_botbase_command(sock, custom_cmd)
    parsed = json.loads(text)
    slots = parsed if isinstance(parsed, list) else parsed.get("slots", [])
    print(json.dumps({"slots": slots, "source": "live-botbase"}))


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
            payload = request.get("payload") if isinstance(request.get("payload"), dict) else request
            print(json.dumps({"slot": payload, "source": "live-procmem"}))
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
                print(json.dumps({"slot": payload, "source": "live-botbase"}))
                return 0
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
