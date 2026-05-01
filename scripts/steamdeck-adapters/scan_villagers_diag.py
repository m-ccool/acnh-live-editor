#!/usr/bin/env python3
"""
Villager array scanner diagnostic.
Prints every candidate VA found in the 128MB scan window with its score and slot contents.
Usage: python3 scan_villagers_diag.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from acnh_memory_reader import (
    _find_ryujinx_pid, _get_dram_base,
    _VILLAGER2_SIZE, _VILLAGER_CATALOG,
    _score_villager_candidate, _read_switch_va,
)

pid   = _find_ryujinx_pid()
dram  = _get_dram_base(pid)
print(f"PID={pid}  DRAM=0x{dram:x}", flush=True)

scan_start = 0xAF000000
scan_size  = 0x8000000   # 128 MB
chunk_size = 0x200000    # 2 MB

candidates = []
for chunk_off in range(0, scan_size, chunk_size):
    va = scan_start + chunk_off
    try:
        data = _read_switch_va(pid, dram, va, chunk_size)
    except Exception:
        continue
    for i in range(0, len(data) - _VILLAGER2_SIZE * 3 - 4, 4):
        ok = 0
        for s in range(3):
            off = i + s * _VILLAGER2_SIZE
            if off + 3 >= len(data):
                break
            sp, vr, p = data[off], data[off+1], data[off+2]
            if sp > 35 or vr > 20 or p > 8:
                break
            ok += 1
        if ok < 3:
            continue
        ch = sum(1 for s in range(3)
                 if _VILLAGER_CATALOG.get((data[i + s*_VILLAGER2_SIZE],
                                           data[i + s*_VILLAGER2_SIZE + 1])) is not None)
        if ch < 2:
            continue
        nz = sum(1 for s in range(3) if data[i + s*_VILLAGER2_SIZE] > 0)
        if nz < 2:
            continue
        candidates.append(va + i)

print(f"Candidates found: {len(candidates)}", flush=True)
for cva in candidates:
    score, slist = _score_villager_candidate(pid, dram, cva)
    occupied = [sv for sv in slist if sv is not None]
    names    = [_VILLAGER_CATALOG.get(sv, (f"sp{sv[0]}v{sv[1]}", "?"))[0] for sv in occupied]
    print(f"  VA=0x{cva:x}  score={score:4d}  slots={names}", flush=True)

print("Done.", flush=True)
