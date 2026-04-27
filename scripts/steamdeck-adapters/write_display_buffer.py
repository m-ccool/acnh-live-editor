#!/usr/bin/env python3
"""
Locate the pocket UI display buffer dynamically and sync it from canonical.

The display buffer is a heap copy of inventory created at pocket-open time.
It uses the SAME 8-byte slot format as canonical.
Writing to it immediately refreshes the on-screen pocket display.

Usage:
    python3 write_display_buffer.py          -- auto-find + sync canonical→display
    python3 write_display_buffer.py --find   -- just print display buffer VA
    python3 write_display_buffer.py --read   -- print display buffer slots 1-20
"""
import sys, struct

sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

CANONICAL_SLOT1_VA = 0xafb1e6e0
SLOT_SIZE          = 8
NUM_SLOTS          = 40

# Display buffer lives in low heap; scan this range (512MB, fast)
SCAN_START = 0x20000000
SCAN_END   = 0x30000000
CHUNK_SIZE = 0x100000   # 1MB


def pack_item(item_id, flag0, flag1, count, uses):
    return struct.pack("<HBBHH", item_id, flag0, flag1, count, uses)


def read_canonical(pid, base):
    """Read all 40 canonical slots. Returns list of raw 8-byte entries."""
    slots = []
    for i in range(NUM_SLOTS):
        va  = CANONICAL_SLOT1_VA + i * SLOT_SIZE
        raw = r._read_switch_va(pid, base, va, 8)
        slots.append(raw)
    return slots


def find_display_buffer(pid, base, canonical_slots):
    """
    Scan DRAM heap range for a run of bytes matching canonical slots 1-4.
    Returns the Switch VA of slot 1, or None if not found.
    """
    needle = b"".join(canonical_slots[:4])   # 32 bytes fingerprint
    mem_path = f"/proc/{pid}/mem"

    with open(mem_path, "rb", 0) as f:
        host = base + SCAN_START
        end  = base + SCAN_END
        buf  = b""
        pos  = host
        while pos < end:
            try:
                f.seek(pos)
                chunk = f.read(CHUNK_SIZE)
            except OSError:
                pos += CHUNK_SIZE
                buf  = b""
                continue
            if not chunk:
                pos += CHUNK_SIZE
                continue
            # Carry over tail from previous chunk to catch cross-boundary matches
            search = buf[-len(needle):] + chunk
            offset = 0
            while True:
                idx = search.find(needle, offset)
                if idx == -1:
                    break
                # Compute absolute host address of this match
                match_host = pos - len(buf[-len(needle):]) + idx
                switch_va  = match_host - base
                # Skip canonical and mirror addresses
                if switch_va not in (CANONICAL_SLOT1_VA, CANONICAL_SLOT1_VA + 0x6A540):
                    return switch_va
                offset = idx + 1
            buf = chunk
            pos += CHUNK_SIZE
    return None


def read_display(pid, base, disp_va, count=20):
    slots = []
    for i in range(count):
        va  = disp_va + i * SLOT_SIZE
        raw = r._read_switch_va(pid, base, va, 8)
        item_id, f0, f1, cnt, uses = struct.unpack("<HBBHH", raw)
        slots.append((va, raw, item_id, f0, f1, cnt, uses))
    return slots


def sync_canonical_to_display(pid, base, canonical_slots, disp_va):
    """Write all 40 canonical slots to the display buffer."""
    for i, raw in enumerate(canonical_slots):
        va = disp_va + i * SLOT_SIZE
        r._write_switch_va(pid, base, va, raw)


# --- main ---
pid  = r._find_ryujinx_pid()
base = r._find_dram_base(pid)
print(f"PID={pid}  DRAM_BASE={hex(base)}")

mode = sys.argv[1] if len(sys.argv) > 1 else "--sync"

canonical_slots = read_canonical(pid, base)
print(f"Canonical slot1={canonical_slots[0].hex()}  slot2={canonical_slots[1].hex()}")

print(f"Scanning {hex(SCAN_START)}-{hex(SCAN_END)} for display buffer...")
disp_va = find_display_buffer(pid, base, canonical_slots)
if disp_va is None:
    print("ERROR: display buffer not found. Is the pocket open?")
    sys.exit(1)
print(f"Display buffer found: Switch VA = {hex(disp_va)}")

if mode == "--find":
    sys.exit(0)

if mode == "--read":
    print("\n=== Display buffer slots 1-20 ===")
    for va, raw, item_id, f0, f1, cnt, uses in read_display(pid, base, disp_va):
        print(f"  VA={hex(va)}  {raw.hex()}  item=0x{item_id:04x} count={cnt} uses={uses}")
    sys.exit(0)

# Default: --sync  (canonical → display)
print("Syncing all 40 canonical slots → display buffer...")
sync_canonical_to_display(pid, base, canonical_slots, disp_va)
# Verify first few
verify = read_display(pid, base, disp_va, count=4)
print("\n=== Verified display slots 1-4 after sync ===")
for va, raw, item_id, f0, f1, cnt, uses in verify:
    print(f"  VA={hex(va)}  {raw.hex()}  item=0x{item_id:04x} count={cnt} uses={uses}")
print("\nDONE — display buffer synced. Screenshot to verify.")
