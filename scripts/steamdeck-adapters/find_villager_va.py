#!/usr/bin/env python3
"""One-shot scanner: finds villager2 array by looking for rare-species pairs at NHSE stride."""
import sys, os
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
import acnh_memory_reader as r

STRIDE = 0x13230
RARE = set(range(1, 35))  # species 1-34 (skip 0=Anteater to avoid null memory, skip 35=Non)

pid = r._find_ryujinx_pid()
dbase = r._find_dram_base(pid)
print(f'pid={pid} dram_base=0x{dbase:x}', flush=True)

found = []
for chunk_start in range(0xAF000000, 0xB3000000, 0x200000):
    try:
        data = r._read_switch_va(pid, dbase, chunk_start, 0x200000)
    except Exception:
        continue
    for i in range(0, len(data) - STRIDE * 3 - 4, 4):
        sp1 = data[i]
        if sp1 not in RARE:
            continue
        if i + STRIDE + 3 >= len(data):
            continue
        sp2 = data[i + STRIDE]
        if sp2 not in RARE:
            continue
        if sp1 == sp2:
            continue
        p1 = data[i + 2]
        p2 = data[i + STRIDE + 2]
        if p1 > 8 or p2 > 8:
            continue
        cat1 = r._VILLAGER_CATALOG.get((sp1, data[i + 1]))
        cat2 = r._VILLAGER_CATALOG.get((sp2, data[i + STRIDE + 1]))
        if cat1 is None or cat2 is None:
            continue
        va = chunk_start + i
        print(f'MATCH va=0x{va:x} [{cat1[0]}/{sp1}] + [{cat2[0]}/{sp2}] p={p1},{p2}', flush=True)
        found.append(va)
        if len(found) >= 10:
            break
    if len(found) >= 10:
        break

if not found:
    print('NO MATCH FOUND', flush=True)
else:
    # Read all 10 slots using the reader for each match
    os.environ['ACNH_VILLAGER_ARRAY_VA'] = '0'  # disable env override in reader
    for test_va in found[:3]:
        print(f'\n--- Full read at 0x{test_va:x} ---', flush=True)
        villagers = []
        for slot_idx in range(1, 11):
            slot_va = test_va + (slot_idx - 1) * STRIDE
            v = r._read_one_villager(pid, dbase, slot_va, slot_idx)
            villagers.append(v)
            empty = v.get('empty', False)
            name = v.get('name') or v.get('internalId', '?')
            print(f'  slot {slot_idx}: {"EMPTY" if empty else name}', flush=True)

