#!/usr/bin/env python3
"""Find current dynamic inventory VA and derive villager array search range."""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
import acnh_memory_reader as r

pid = r._find_ryujinx_pid()
dbase = r._find_dram_base(pid)
print(f'pid={pid} dram_base=0x{dbase:x}')

# Find the dynamic inventory VA using the reader's calibration
inv_offsets = r._find_expected_player_snapshot(pid, dbase, 20, 20)
if inv_offsets:
    slot1_va = inv_offsets.get('slot1') or inv_offsets.get('inventory_va')
    print(f'inventory VA anchor: {slot1_va}')
    if slot1_va:
        print(f'  = 0x{slot1_va:x}')
else:
    print('inventory calibration returned nothing')

# Also check the scan results from _read_all_slots_procmem to see slot1 va
try:
    slots = r._read_all_slots_procmem(pid, dbase)
    if slots:
        print(f'slots read ok, count={len(slots)}')
except Exception as e:
    print(f'read_all_slots failed: {e}')
