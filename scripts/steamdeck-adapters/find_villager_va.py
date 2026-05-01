#!/usr/bin/env python3
"""Find villager array base: look for 3+ different non-null valid villagers consecutively."""
import sys, os
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
import acnh_memory_reader as r

STRIDE = 0x13230
VALID_SPECIES = set(range(1, 35))  # 1-34, skip 0 (null/Anteater) and >= 35

pid = r._find_ryujinx_pid()
dbase = r._find_dram_base(pid)
print(f'pid={pid} dram_base=0x{dbase:x}', flush=True)

best_va = None
best_count = 0

for chunk_start in range(0xAF000000, 0xB3000000, 0x200000):
    try:
        data = r._read_switch_va(pid, dbase, chunk_start, 0x200000)
    except Exception:
        continue

    for i in range(0, len(data) - STRIDE * 10 - 4, 4):
        # Count how many of the first 10 slots have valid non-null catalog villagers
        count = 0
        species_seen = set()
        for s in range(10):
            off = i + s * STRIDE
            if off + 3 >= len(data):
                break
            sp = data[off]
            vr = data[off + 1]
            p  = data[off + 2]
            if sp in VALID_SPECIES and p <= 8:
                cat = r._VILLAGER_CATALOG.get((sp, vr))
                if cat is not None:
                    count += 1
                    species_seen.add(sp)
        if count >= 3 and len(species_seen) >= 2:
            va = chunk_start + i
            if count > best_count:
                best_count = count
                best_va = va
                names = []
                for s in range(10):
                    off = i + s * STRIDE
                    sp = data[off]; vr = data[off+1]
                    cat = r._VILLAGER_CATALOG.get((sp, vr))
                    names.append(cat[0] if cat else (f'sp{sp}' if sp < 35 else 'empty'))
                print(f'BEST so far: va=0x{va:x} count={count} {names}', flush=True)

if best_va:
    print(f'\n=== Best match: 0x{best_va:x} (valid slots: {best_count}) ===', flush=True)
    for s in range(10):
        slot_va = best_va + s * STRIDE
        v = r._read_one_villager(pid, dbase, slot_va, s + 1)
        print(f'  slot {s+1}: {"EMPTY" if v.get("empty") else v.get("name") or v.get("internalId")}', flush=True)
else:
    print('NO GOOD MATCH FOUND', flush=True)


