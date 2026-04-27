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
matches = []

for (start, end, perms, label) in maps:
    # Only scan anonymous (no label) regions — skip named files AND (deleted) doublemapper/DRAM
    stripped = label.strip() if label else ""
    if stripped:
        continue
    size = end - start
    # Skip tiny or enormous regions; render heap objects are in small-medium anonymous regions
    if size < 40 or size > 128 * 1024 * 1024:
        continue

    try:
        with open(mem_path, "rb") as f:
            f.seek(start)
            data = f.read(size)
    except Exception:
        continue

    offset = 0
    while True:
        pos = data.find(fingerprint, offset)
        if pos == -1:
            break
        host = start + pos
        # slot 3 starts at pos; slot 2 at pos-8; slot 1 at pos-16
        slot2_offset = pos - 8
        if slot2_offset >= 0:
            slot2_bytes = data[slot2_offset:slot2_offset+8]
            item_id = struct.unpack_from("<H", slot2_bytes, 0)[0]
            count = struct.unpack_from("<H", slot2_bytes, 4)[0]
            # Check preceding 16 bytes (slot 1)
            slot1_bytes = data[pos-16:pos-8] if pos >= 16 else b"\x00"*8
            matches.append({
                "host": host,
                "label": label,
                "slot1": slot1_bytes.hex() if len(slot1_bytes)==8 else "??",
                "slot2": slot2_bytes.hex(),
                "item_id": item_id,
                "count": count,
            })
        offset = pos + 1

print(f"\nFound {len(matches)} fingerprint matches:")
for i, m in enumerate(matches):
    flag = " *** CHERRY ***" if m["item_id"] == 0x08ef else ""
    print(f"  [{i}] host_slot3={hex(m['host'])}  label={repr(m['label'])}")
    print(f"       slot1={m['slot1']}  slot2={m['slot2']}  id={hex(m['item_id'])} count={m['count']}{flag}")

# --- Write mode ---
if "--write" in sys.argv:
    cherry_matches = [m for m in matches if m["item_id"] == 0x08ef]
    print(f"\n=== WRITE MODE: {len(cherry_matches)} cherry slot-2 candidates ===")
    test_data = struct.pack("<HBBHH", 0x08ef, 0, 0, 99, 0)  # cherry x99
    for m in cherry_matches:
        slot2_host = m["host"] - 8
        print(f"Writing x99 to host={hex(slot2_host)} (was {m['slot2']})...")
        try:
            with open(mem_path, "r+b") as f:
                f.seek(slot2_host)
                f.write(test_data)
            print("  OK. Take screenshot now, then press Enter to restore...")
            input()
            with open(mem_path, "r+b") as f:
                f.seek(slot2_host)
                f.write(bytes.fromhex(m["slot2"]))
            print("  Restored.\n")
        except OSError as e:
            print(f"  FAILED: {e}\n")

# --- Restore mode ---
if "--restore" in sys.argv:
    cherry_matches = [m for m in matches if m["item_id"] == 0x08ef]
    print(f"\n=== RESTORE MODE: restoring {len(cherry_matches)} slots to canonical ===")
    for m in cherry_matches:
        slot2_host = m["host"] - 8
        try:
            with open(mem_path, "r+b") as f:
                f.seek(slot2_host)
                f.write(canonical_slot2)
            print(f"  host={hex(slot2_host)} restored to {canonical_slot2.hex()}")
        except OSError as e:
            print(f"  host={hex(slot2_host)} FAILED: {e}")
