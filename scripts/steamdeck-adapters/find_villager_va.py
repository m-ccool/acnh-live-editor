#!/usr/bin/env python3
"""
find_villager_va.py — Locate live Villager2 structs in Ryujinx DRAM.

Approach 1 (SysBot pointer chain):
  Follow VillagerListJumps from SysBot.ACNHOrders/Bot/ACNHMobileSpawner/OffsetHelper.cs
  Pointer chain from Switch heap base 0x80000000:
    [[[[heap+0x59E6A60]+0x38]+0xE0]+0x1EC]+0x17A  = villager list base
  VillagerListUnitSize = 0x1C; each unit[0..9] starts with an 8-byte ptr to Villager2 struct.

Approach 2 (static offset from confirmed inventory VA):
  SysBot: InventoryOffset=0xB27BB758, VillagerAddress=0xB10504E0
  Relative gap = 0x1776278; apply to our confirmed inventory VA 0xAFB1E6E0.

Approach 3 (species pair scan ±96 MB around inventory):
  Scan for Bob(sp=4)+Rolf(sp=33) exactly NHSE stride 0x13230 apart,
  validated by catchphrase field containing ASCII UTF-16LE text.

Villager2 struct layout (NHSE Villager2.cs):
  [0x00]     byte  Species
  [0x01]     byte  Variant
  [0x02]     byte  Personality
  [0x10794]  UTF-16LE CatchPhrase (12 chars, 24 bytes)

Species: Bob(Cat)=4  Rolf(Tiger)=33
Personality: Lazy=0  Cranky=2

Usage:
  python3 find_villager_va.py              # read-only discovery
  python3 find_villager_va.py --write      # write sentinel catchphrases then rescan full DRAM
  python3 find_villager_va.py --restore    # restore originals saved by --write
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from acnh_memory_reader import (
    _find_ryujinx_pid,
    _find_dram_base,
    _read_switch_va,
    _write_switch_va,
)

# ---------------------------------------------------------------------------
# Constants from SysBot.ACNHOrders OffsetHelper.cs
# ---------------------------------------------------------------------------
_VILLAGER_LIST_JUMPS = [0x59E6A60, 0x38, 0xE0, 0x1EC, 0x17A]
_VILLAGER_UNIT_SIZE  = 0x1C   # spacing between list entries (each starts with 8-byte ptr)

# Static offset delta: SysBot InventoryOffset - SysBot VillagerAddress
_SYSBOT_INV   = 0xB27BB758
_SYSBOT_VILL  = 0xB10504E0
_STATIC_DELTA = _SYSBOT_INV - _SYSBOT_VILL   # 0x1776278

# Our confirmed inventory VA (ACNH v2.0.7, single-player slot 1)
_INVENTORY_SVA = 0xAFB1E6E0

# NHSE Villager2 struct field offsets
_CATCHPHRASE_OFF = 0x10794   # UTF-16LE, 12 chars = 24 bytes
_CATCHPHRASE_LEN = 24

# Species IDs
_SPECIES_BOB  = 4    # Cat
_SPECIES_ROLF = 33   # Tiger

# Sentinel catchphrases for --write mode (exactly 12 UTF-16 chars, null-padded)
_SENTINEL_BOB  = "SRCH_BOB_00\x00"
_SENTINEL_ROLF = "SRCH_ROLF_0\x00"

# Backup file for original catchphrase bytes
_BACKUP_FILE = os.path.join(os.path.dirname(__file__), "_catchphrase_backup.bin")

# Default catchphrases (ACNH v2.0.7) used in full-DRAM fallback scan
_DEFAULT_CP_BOB  = "pthhpth"
_DEFAULT_CP_ROLF = "shorty"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_valid_sva(v: int) -> bool:
    return 0x80000000 <= v < 0x180000000

def _read_ptr(pid: int, dram_base: int, switch_va: int):
    """Read 8-byte little-endian pointer from switch_va; return None on any error."""
    try:
        raw = _read_switch_va(pid, dram_base, switch_va, 8)
        if len(raw) < 8:
            return None
        return struct.unpack_from("<Q", raw)[0]
    except Exception:
        return None

def _utf16le_decode(b: bytes) -> str:
    try:
        return b.decode("utf-16-le").rstrip("\x00")
    except Exception:
        return repr(b)

def _describe_villager(species: int, variant: int, personality: int) -> str:
    sp_names  = {4: "Cat/Bob", 33: "Tiger/Rolf"}
    pers_names = {0: "Lazy", 1: "Jock", 2: "Cranky", 3: "Smug",
                  4: "Peppy", 5: "Normal", 6: "Snooty", 7: "Uchi"}
    return (f"{sp_names.get(species, f'sp={species}')}  "
            f"var={variant}  {pers_names.get(personality, f'pers={personality}')}")

def _is_valid_catchphrase(b: bytes) -> bool:
    """Check that UTF-16LE bytes look like a real catchphrase (printable ASCII)."""
    if len(b) < 4:
        return False
    for i in range(0, min(8, len(b)), 2):
        c = struct.unpack_from("<H", b, i)[0]
        if c == 0:
            return True
        if c < 0x20 or c > 0x7E:
            return False
    return True

# ---------------------------------------------------------------------------
# Approach 1: follow SysBot VillagerListJumps pointer chain
# ---------------------------------------------------------------------------

def approach1_pointer_chain(pid: int, dram_base: int) -> list:
    print("\n=== Approach 1: SysBot VillagerListJumps pointer chain ===", flush=True)
    jumps = _VILLAGER_LIST_JUMPS
    cur_sva = 0x80000000 + jumps[0]
    print(f"  heap_base + 0x{jumps[0]:x}  = sva=0x{cur_sva:x}", flush=True)

    for step_idx, offset in enumerate(jumps[1:], start=1):
        ptr = _read_ptr(pid, dram_base, cur_sva)
        if ptr is None or not _is_valid_sva(ptr):
            print(f"  step {step_idx}: read ptr at 0x{cur_sva:x} => 0x{ptr if ptr else 0:x}  INVALID — chain broken", flush=True)
            return []
        next_sva = ptr + offset
        print(f"  step {step_idx}: *0x{cur_sva:x} = 0x{ptr:x}  + 0x{offset:x} => 0x{next_sva:x}", flush=True)
        cur_sva = next_sva

    list_base_sva = cur_sva
    print(f"  villager list base sva = 0x{list_base_sva:x}", flush=True)

    found_vas = []
    for slot in range(10):
        entry_sva = list_base_sva + slot * _VILLAGER_UNIT_SIZE
        struct_ptr = _read_ptr(pid, dram_base, entry_sva)
        if struct_ptr is None or not _is_valid_sva(struct_ptr):
            print(f"  slot[{slot}] entry_sva=0x{entry_sva:x}  ptr=0x{struct_ptr if struct_ptr else 0:x}  (invalid)", flush=True)
            continue
        try:
            hdr = _read_switch_va(pid, dram_base, struct_ptr, 4)
            sp, vr, pe = hdr[0], hdr[1], hdr[2]
            cp_raw = _read_switch_va(pid, dram_base, struct_ptr + _CATCHPHRASE_OFF, _CATCHPHRASE_LEN)
            cp = _utf16le_decode(cp_raw)
            print(f"  slot[{slot}] ptr=0x{struct_ptr:x}  {_describe_villager(sp, vr, pe)}  cp='{cp}'", flush=True)
            found_vas.append(struct_ptr)
        except Exception as e:
            print(f"  slot[{slot}] ptr=0x{struct_ptr:x}  error: {e}", flush=True)

    return found_vas

# ---------------------------------------------------------------------------
# Approach 2: static offset from confirmed inventory VA
# ---------------------------------------------------------------------------

def approach2_static_offset(pid: int, dram_base: int) -> list:
    print("\n=== Approach 2: static offset from confirmed inventory VA ===", flush=True)
    our_vill_sva = _INVENTORY_SVA - _STATIC_DELTA
    print(f"  delta=0x{_STATIC_DELTA:x}  => VillagerArray sva=0x{our_vill_sva:x}", flush=True)

    STRIDE = 0x13230
    found_vas = []

    for slot in range(10):
        slot_sva = our_vill_sva + slot * STRIDE
        try:
            hdr = _read_switch_va(pid, dram_base, slot_sva, 4)
            sp, vr, pe = hdr[0], hdr[1], hdr[2]
            cp_raw = _read_switch_va(pid, dram_base, slot_sva + _CATCHPHRASE_OFF, _CATCHPHRASE_LEN)
            cp = _utf16le_decode(cp_raw)
            print(f"  slot[{slot}] sva=0x{slot_sva:x}  {_describe_villager(sp, vr, pe)}  cp='{cp}'", flush=True)
            if sp in (_SPECIES_BOB, _SPECIES_ROLF):
                found_vas.append(slot_sva)
        except Exception as e:
            print(f"  slot[{slot}] sva=0x{slot_sva:x}  error: {e}", flush=True)

    return found_vas

# ---------------------------------------------------------------------------
# Approach 3: species pair scan ±96 MB around inventory VA
# ---------------------------------------------------------------------------

def approach3_species_pair_scan(pid: int, dram_base: int) -> list:
    print("\n=== Approach 3: species pair scan ±96 MB around inventory ===", flush=True)

    STRIDE     = 0x13230
    WINDOW     = 0x6000000
    inv_host   = dram_base + (_INVENTORY_SVA - 0x80000000)
    scan_start = max(dram_base, inv_host - WINDOW)
    scan_end   = min(dram_base + 0x100000000, inv_host + WINDOW)
    chunk_size = 1 * 1024 * 1024

    print(f"  scanning host 0x{scan_start:x}–0x{scan_end:x}  ({(scan_end-scan_start)//1024//1024} MB)", flush=True)

    found_vas = []
    try:
        with open(f"/proc/{pid}/mem", "rb") as mem:
            pos = scan_start
            while pos < scan_end:
                end = min(pos + chunk_size, scan_end)
                mem.seek(pos)
                chunk = mem.read(end - pos)
                if not chunk:
                    pos = end
                    continue

                for off in range(0, len(chunk) - STRIDE - _CATCHPHRASE_OFF - _CATCHPHRASE_LEN, 4):
                    if chunk[off] != _SPECIES_BOB:
                        continue
                    rolf_off = off + STRIDE
                    if rolf_off + 4 > len(chunk):
                        continue
                    if chunk[rolf_off] != _SPECIES_ROLF:
                        continue
                    cp_bob_off  = off       + _CATCHPHRASE_OFF
                    cp_rolf_off = rolf_off  + _CATCHPHRASE_OFF
                    if cp_rolf_off + _CATCHPHRASE_LEN > len(chunk):
                        continue
                    cp_b = chunk[cp_bob_off  : cp_bob_off  + _CATCHPHRASE_LEN]
                    cp_r = chunk[cp_rolf_off : cp_rolf_off + _CATCHPHRASE_LEN]
                    if not _is_valid_catchphrase(cp_b) or not _is_valid_catchphrase(cp_r):
                        continue
                    bob_sva  = 0x80000000 + (pos + off - dram_base)
                    rolf_sva = bob_sva + STRIDE
                    print(f"  PAIR  Bob  sva=0x{bob_sva:x}  cp='{_utf16le_decode(cp_b)}'", flush=True)
                    print(f"        Rolf sva=0x{rolf_sva:x}  cp='{_utf16le_decode(cp_r)}'", flush=True)
                    found_vas.append(bob_sva)

                pos = end
    except Exception as e:
        print(f"  scan error: {e}", flush=True)

    if not found_vas:
        print("  no confirmed pairs found", flush=True)
    return found_vas

# ---------------------------------------------------------------------------
# Write sentinel catchphrases (--write mode)
# ---------------------------------------------------------------------------

def write_sentinels(pid: int, dram_base: int, bob_sva: int, rolf_sva: int):
    print("\n=== Writing sentinel catchphrases ===", flush=True)
    bob_cp_sva  = bob_sva  + _CATCHPHRASE_OFF
    rolf_cp_sva = rolf_sva + _CATCHPHRASE_OFF

    orig_bob  = _read_switch_va(pid, dram_base, bob_cp_sva,  _CATCHPHRASE_LEN)
    orig_rolf = _read_switch_va(pid, dram_base, rolf_cp_sva, _CATCHPHRASE_LEN)
    print(f"  Bob  original cp: '{_utf16le_decode(orig_bob)}'", flush=True)
    print(f"  Rolf original cp: '{_utf16le_decode(orig_rolf)}'", flush=True)

    with open(_BACKUP_FILE, "wb") as f:
        f.write(struct.pack("<QQ", bob_cp_sva, rolf_cp_sva))
        f.write(orig_bob)
        f.write(orig_rolf)
    print(f"  Originals saved to {_BACKUP_FILE}", flush=True)

    bob_bytes  = _SENTINEL_BOB.encode("utf-16-le")[:_CATCHPHRASE_LEN].ljust(_CATCHPHRASE_LEN, b"\x00")
    rolf_bytes = _SENTINEL_ROLF.encode("utf-16-le")[:_CATCHPHRASE_LEN].ljust(_CATCHPHRASE_LEN, b"\x00")
    _write_switch_va(pid, dram_base, bob_cp_sva,  bob_bytes)
    _write_switch_va(pid, dram_base, rolf_cp_sva, rolf_bytes)

    rb = _read_switch_va(pid, dram_base, bob_cp_sva,  _CATCHPHRASE_LEN)
    rr = _read_switch_va(pid, dram_base, rolf_cp_sva, _CATCHPHRASE_LEN)
    print(f"  Bob  sentinel readback: '{_utf16le_decode(rb)}'", flush=True)
    print(f"  Rolf sentinel readback: '{_utf16le_decode(rr)}'", flush=True)

# ---------------------------------------------------------------------------
# Restore original catchphrases (--restore mode)
# ---------------------------------------------------------------------------

def restore_catchphrases(pid: int, dram_base: int):
    if not os.path.exists(_BACKUP_FILE):
        print("ERROR: no backup file found; cannot restore", flush=True)
        sys.exit(1)
    with open(_BACKUP_FILE, "rb") as f:
        bob_cp_sva, rolf_cp_sva = struct.unpack("<QQ", f.read(16))
        orig_bob  = f.read(_CATCHPHRASE_LEN)
        orig_rolf = f.read(_CATCHPHRASE_LEN)
    _write_switch_va(pid, dram_base, bob_cp_sva,  orig_bob)
    _write_switch_va(pid, dram_base, rolf_cp_sva, orig_rolf)
    rb = _read_switch_va(pid, dram_base, bob_cp_sva,  _CATCHPHRASE_LEN)
    rr = _read_switch_va(pid, dram_base, rolf_cp_sva, _CATCHPHRASE_LEN)
    print(f"Restored — Bob cp='{_utf16le_decode(rb)}'  Rolf cp='{_utf16le_decode(rr)}'", flush=True)
    os.remove(_BACKUP_FILE)

# ---------------------------------------------------------------------------
# Full-DRAM sentinel scan (used after --write to confirm struct VA)
# ---------------------------------------------------------------------------

def scan_for_sentinels(pid: int, dram_base: int) -> list:
    print("\n=== Scanning full DRAM for sentinel strings ===", flush=True)
    targets = [
        (_SENTINEL_BOB.encode("utf-16-le").rstrip(b"\x00"),  "Bob-sentinel"),
        (_SENTINEL_ROLF.encode("utf-16-le").rstrip(b"\x00"), "Rolf-sentinel"),
    ]
    found = []
    dram_end   = dram_base + 0x100000000
    chunk_size = 4 * 1024 * 1024

    with open(f"/proc/{pid}/mem", "rb") as mem:
        pos = dram_base
        while pos < dram_end:
            end = min(pos + chunk_size, dram_end)
            mem.seek(pos)
            chunk = mem.read(end - pos)
            if not chunk:
                pos = end
                continue
            for pattern, label in targets:
                idx = 0
                while True:
                    hit = chunk.find(pattern, idx)
                    if hit < 0:
                        break
                    sva = 0x80000000 + (pos + hit - dram_base)
                    struct_sva = sva - _CATCHPHRASE_OFF
                    print(f"  {label} cp_sva=0x{sva:x}  struct_base=0x{struct_sva:x}", flush=True)
                    found.append((struct_sva, label))
                    idx = hit + 1
            pos = end

    if not found:
        print("  no sentinel matches found in DRAM", flush=True)
    return found

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    mode_write   = "--write"   in sys.argv
    mode_restore = "--restore" in sys.argv

    pid       = _find_ryujinx_pid()
    dram_base = _find_dram_base(pid)
    print(f"PID={pid}  DRAM_BASE=0x{dram_base:x}", flush=True)

    if mode_restore:
        restore_catchphrases(pid, dram_base)
        return

    # --- Discovery ---
    candidate_bob_va  = None
    candidate_rolf_va = None

    a1_vas = approach1_pointer_chain(pid, dram_base)
    for v in a1_vas:
        try:
            sp = _read_switch_va(pid, dram_base, v, 1)[0]
            if sp == _SPECIES_BOB  and candidate_bob_va  is None:
                candidate_bob_va  = v
            if sp == _SPECIES_ROLF and candidate_rolf_va is None:
                candidate_rolf_va = v
        except Exception:
            pass

    if not (candidate_bob_va and candidate_rolf_va):
        a2_vas = approach2_static_offset(pid, dram_base)
        for v in a2_vas:
            try:
                sp = _read_switch_va(pid, dram_base, v, 1)[0]
                if sp == _SPECIES_BOB  and candidate_bob_va  is None:
                    candidate_bob_va  = v
                if sp == _SPECIES_ROLF and candidate_rolf_va is None:
                    candidate_rolf_va = v
            except Exception:
                pass

    if not (candidate_bob_va and candidate_rolf_va):
        a3_vas = approach3_species_pair_scan(pid, dram_base)
        for v in a3_vas:
            if candidate_bob_va is None:
                candidate_bob_va  = v
            elif candidate_rolf_va is None:
                candidate_rolf_va = v + 0x13230

    print(f"\n=== Summary ===", flush=True)
    print(f"  Bob  VA: {'0x%x' % candidate_bob_va  if candidate_bob_va  else 'NOT FOUND'}", flush=True)
    print(f"  Rolf VA: {'0x%x' % candidate_rolf_va if candidate_rolf_va else 'NOT FOUND'}", flush=True)

    if mode_write:
        if candidate_bob_va and candidate_rolf_va:
            write_sentinels(pid, dram_base, candidate_bob_va, candidate_rolf_va)
            scan_for_sentinels(pid, dram_base)
        else:
            print("\n  VAs not confirmed by chain/static — falling back to default catchphrase scan...", flush=True)
            for name, cp_str in [("Bob",  _DEFAULT_CP_BOB), ("Rolf", _DEFAULT_CP_ROLF)]:
                pattern = cp_str.encode("utf-16-le")
                dram_end   = dram_base + 0x100000000
                chunk_size = 4 * 1024 * 1024
                with open(f"/proc/{pid}/mem", "rb") as mem:
                    pos = dram_base
                    hits = 0
                    while pos < dram_end and hits < 5:
                        end = min(pos + chunk_size, dram_end)
                        mem.seek(pos)
                        chunk = mem.read(end - pos)
                        if not chunk:
                            pos = end
                            continue
                        idx = 0
                        while hits < 5:
                            hit = chunk.find(pattern, idx)
                            if hit < 0:
                                break
                            sva = 0x80000000 + (pos + hit - dram_base)
                            print(f"  {name} default cp '{cp_str}' hit sva=0x{sva:x}  struct_base=0x{sva - _CATCHPHRASE_OFF:x}", flush=True)
                            hits += 1
                            idx = hit + 1
                        pos = end
                    if hits == 0:
                        print(f"  {name} default cp '{cp_str}' — no hits in DRAM", flush=True)

    print("\nDone.", flush=True)


if __name__ == "__main__":
    main()


