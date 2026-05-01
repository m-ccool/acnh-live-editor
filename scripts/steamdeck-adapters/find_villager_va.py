#!/usr/bin/env python3
"""One-shot scanner: finds villager2 array by looking for rare-species pairs at NHSE stride."""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
import acnh_memory_reader as r

STRIDE = 0x13230
RARE = {1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
        21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34}

pid, dbase = r._find_ryujinx_pid_and_dram_base()
print(f'pid={pid} dram_base=0x{dbase:x}', flush=True)

found = []
for chunk_start in range(0xAF000000, 0xB3000000, 0x200000):
    try:
        data = r._read_switch_va(pid, dbase, chunk_start, 0x200000)
    except Exception:
        continue
    for i in range(0, len(data) - STRIDE * 2 - 4, 4):
        sp1 = data[i]
        if sp1 not in RARE:
            continue
        if i + STRIDE + 3 >= len(data):
            continue
        sp2 = data[i + STRIDE]
        if sp2 not in RARE:
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
        if len(found) >= 3:
            break
    if len(found) >= 3:
        break

if not found:
    print('NO MATCH FOUND', flush=True)
