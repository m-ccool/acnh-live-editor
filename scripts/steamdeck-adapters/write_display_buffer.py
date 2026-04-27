#!/usr/bin/env python3
"""
Write directly to the pocket UI display buffer to force live refresh.
Display buffer slot 1 = phys_offset 0x24915f88 (Switch VA 0x24915f88).
Same 8-byte format as canonical: struct.pack("<HBBHH", item_id, flag0, flag1, count, uses)
"""
import sys, struct

sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

DISPLAY_SLOT1_VA = 0x24915f88   # found by full DRAM scan
SLOT_SIZE        = 8

def display_va(slot: int) -> int:
    """slot is 1-based"""
    return DISPLAY_SLOT1_VA + (slot - 1) * SLOT_SIZE

def pack_item(item_id: int, flag0: int, flag1: int, count: int, uses: int) -> bytes:
    return struct.pack("<HBBHH", item_id, flag0, flag1, count, uses)

def read_slot(pid, base, slot):
    va = display_va(slot)
    raw = r._read_switch_va(pid, base, va, 8)
    item_id, flag0, flag1, count, uses = struct.unpack("<HBBHH", raw)
    return item_id, flag0, flag1, count, uses, raw

pid  = r._find_ryujinx_pid()
base = r._find_dram_base(pid)
print(f"PID={pid}  DRAM_BASE={hex(base)}")
print(f"Display slot 1 VA = {hex(DISPLAY_SLOT1_VA)}")
print()

# --- Read current display slots 1-15 ---
print("=== Current display buffer (slots 1-15) ===")
for s in range(1, 16):
    item_id, f0, f1, count, uses, raw = read_slot(pid, base, s)
    print(f"  slot {s:2d}: VA={hex(display_va(s))}  raw={raw.hex()}  "
          f"item=0x{item_id:04x} f0={f0} f1={f1} count={count} uses={uses}")
print()

# --- Write cherry x3 to display slot 2 (was x2) to test live refresh ---
CHERRY_ID = 0x08ef
TEST_SLOT  = 2
old_va     = display_va(TEST_SLOT)
old_raw    = r._read_switch_va(pid, base, old_va, 8)
print(f"BEFORE slot {TEST_SLOT}: {old_raw.hex()}")

new_data = pack_item(CHERRY_ID, 0, 0, 3, 0)   # cherry x3 — visually distinct from x2
r._write_switch_va(pid, base, old_va, new_data)
verify = r._read_switch_va(pid, base, old_va, 8)
print(f"AFTER  slot {TEST_SLOT}: {verify.hex()}  (expected {new_data.hex()})")
print()
print("WRITTEN cherry x3 to DISPLAY slot 2.")
print("Take a screenshot and check if the pocket shows cherry x3 now.")
