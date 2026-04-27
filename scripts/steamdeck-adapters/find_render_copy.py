#!/usr/bin/env python3
"""
Find the pocket UI render copy by scanning anonymous non-DRAM regions
for the 4-item fingerprint (canonical slots 3-6: golden shovel, slingshot,
vaulting pole, watering can — stable tool items).

Usage:
  python3 find_render_copy.py          -- scan and report
  python3 find_render_copy.py --write  -- write cherry x99 to slot-2 of found array
  python3 find_render_copy.py --restore -- restore slot-2 to canonical value
"""
import sys, struct, time
sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

pid = r._find_ryujinx_pid()
dram_base = r._find_dram_base(pid)
print(f"PID={pid}  DRAM_BASE={hex(dram_base)}")

def read_switch_va(va, size=8):
    return r._read_switch_va(pid, dram_base, va, size)

def write_switch_va(va, data):
    r._write_switch_va(pid, dram_base, va, data)

# --- Read canonical slots 3-6 as 32-byte fingerprint ---
CANONICAL_SLOT1_VA = 0xafb1e6e0
fingerprint_va = CANONICAL_SLOT1_VA + 2 * 8  # slot 3 = index 2
fingerprint = read_switch_va(fingerprint_va, 32)
print(f"Fingerprint (canonical slots 3-6): {fingerprint.hex()}")

# Also read slot 2 (canonical) to know expected cherry value at render copy
slot2_va = CANONICAL_SLOT1_VA + 1 * 8
canonical_slot2 = read_switch_va(slot2_va, 8)
print(f"Canonical slot 2: {canonical_slot2.hex()}")

# --- Scan all rw anonymous non-DRAM regions ---
maps = r._parse_maps(pid)
print(f"\nScanning {len(maps)} rw regions for fingerprint...")

mem_path = f"/proc/{pid}/mem"
DRAM_SIZE = 0x100000000  # 4 GB
CHERRY_X7 = struct.pack("<HBBHH", 0x08ef, 0, 0, 7, 0)   # ef 08 00 00 07 00 00 00
CHERRY_X6 = struct.pack("<HBBHH", 0x08ef, 0, 0, 6, 0)   # ef 08 00 00 06 00 00 00 (=canonical)
DRAM_HOST_START = dram_base
DRAM_HOST_END = dram_base + 0x100000000  # 4GB

cherry7_hosts = []
cherry6_hosts = []
raw_fprint_hosts = []

mem_path = f"/proc/{pid}/mem"
CHUNK = 64 * 1024 * 1024  # 64MB chunks

for (start, end, perms, label) in maps:
    stripped = label.strip() if label else ""
    size = end - start
    if size < 8:
        continue

    # Decide which regions to scan:
    is_anon = (stripped == "")                          # anonymous heap
    is_dram = (stripped == "(deleted)"                   # DRAM identity mapping
               and start >= DRAM_HOST_START and end <= DRAM_HOST_END)

    if not (is_anon or is_dram):
        continue
    # Skip enormous anonymous regions (> 512MB)
    if is_anon and size > 512 * 1024 * 1024:
        continue

    # Read in chunks to avoid huge allocations
    pos = start
    while pos < end:
        chunk_end = min(pos + CHUNK, end)
        chunk_size = chunk_end - pos
        try:
            with open(mem_path, "rb") as f:
                f.seek(pos)
                data = f.read(chunk_size)
        except Exception:
            pos = chunk_end
            continue

        # Search for cherry×7 (stale render copy candidate)
        offset = 0
        while True:
            idx = data.find(CHERRY_X7, offset)
            if idx == -1:
                break
            cherry7_hosts.append(pos + idx)
            offset = idx + 1

        # Search for cherry×6 (= canonical — if render copy is live-updated)
        if is_anon:  # DRAM already has canonical; only interesting in other regions
            offset = 0
            while True:
                idx = data.find(CHERRY_X6, offset)
                if idx == -1:
                    break
                cherry6_hosts.append(pos + idx)
                offset = idx + 1

        # Search for the 32-byte fingerprint (exact 8-byte slot format)
        offset = 0
        while True:
            idx = data.find(fingerprint, offset)
            if idx == -1:
                break
            raw_fprint_hosts.append({"host": pos + idx, "label": stripped,
                                     "slot2": data[idx-8:idx].hex() if idx >= 8 else "??"})
            offset = idx + 1

        pos = chunk_end

GOLDEN_SHOVEL_ID_BYTES = GOLDEN_SHOVEL_ID = (0x217e).to_bytes(2, "little")

print(f"\n=== Cherry x7 hits (stale render copy candidates): {len(cherry7_hosts)} ===")
for h in cherry7_hosts[:20]:
    dram_rel = h - dram_base if DRAM_HOST_START <= h < DRAM_HOST_END else None
    rel = f"  Switch VA {hex(dram_rel)}" if dram_rel is not None else ""
    print(f"  host={hex(h)}{rel}")

# Narrow candidates: check each cherry×7 for golden shovel at various stride offsets
# (render copy may use 8/12/16/24-byte per-slot structs)
print(f"\n=== Checking cherry×7 hits for golden shovel neighbor ===")
slot2_candidates = []
for h in cherry7_hosts:
    try:
        with open(mem_path, "rb") as f:
            f.seek(h - 32)
            ctx = f.read(160)  # read context around cherry hit
    except Exception:
        continue
    cherry_pos = 32  # cherry×7 is at ctx[32]
    for stride in range(8, 97, 4):
        ahead = cherry_pos + stride
        if ahead + 2 <= len(ctx) and ctx[ahead:ahead+2] == GOLDEN_SHOVEL_ID_BYTES:
            slot2_candidates.append({"host": h, "stride": stride, "ctx": ctx[cherry_pos:cherry_pos+stride+8].hex()})
            print(f"  host={hex(h)}  stride={stride}  next={ctx[ahead:ahead+8].hex()}")
            break  # only report first matching stride per cherry hit

print(f"\n=== {len(slot2_candidates)} golden-shovel-neighbor cherry candidates ===")

if "--write" in sys.argv and slot2_candidates:
    import time
    test_data = struct.pack("<HBBHH", 0x08ef, 0, 0, 99, 0)  # cherry x99
    orig_data = struct.pack("<HBBHH", 0x08ef, 0, 0, 7, 0)
    print(f"\nWill write cherry×99 to {len(slot2_candidates)} candidate(s), auto-restore after 3s each...")
    for c in slot2_candidates[:10]:
        h = c["host"]
        try:
            with open(mem_path, "r+b") as f:
                f.seek(h)
                f.write(test_data)
            print(f"  wrote ×99 to host={hex(h)}")
            time.sleep(3.0)
            with open(mem_path, "r+b") as f:
                f.seek(h)
                f.write(orig_data)
            print(f"  restored ×7\n")
        except OSError as e:
            print(f"  FAILED: {e}")

print(f"\n=== Cherry x6 hits in anon regions (live-render candidate): {len(cherry6_hosts)} ===")
for h in cherry6_hosts[:20]:
    print(f"  host={hex(h)}")

print(f"\n=== 32-byte fingerprint matches: {len(raw_fprint_hosts)} ===")
for m in raw_fprint_hosts[:10]:
    print(f"  host_slot3={hex(m['host'])}  slot2={m['slot2']}")

