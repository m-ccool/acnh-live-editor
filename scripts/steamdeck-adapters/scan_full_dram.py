#!/usr/bin/env python3
"""Quick targeted scan: find sp=4 (Bob/Cat) hits in DRAM, print first 30."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from acnh_memory_reader import _find_ryujinx_pid, _find_dram_base, _VILLAGER2_SIZE

pid  = _find_ryujinx_pid()
dram = _find_dram_base(pid)
print(f"PID={pid}  DRAM=0x{dram:x}  STRIDE=0x{_VILLAGER2_SIZE:x}", flush=True)

DRAM_END = dram + 0x100000000
mem_fd = open(f"/proc/{pid}/mem", "rb")

hits_cat   = []  # sp=4 (Cat = Bob)
hits_tiger = []  # sp=33 (Tiger = Rolf)

chunk_size = 0x400000  # 4MB
scanned    = 0
failed     = 0

cur = dram
while cur < DRAM_END:
    read_size = min(chunk_size, DRAM_END - cur)
    try:
        mem_fd.seek(cur)
        data = mem_fd.read(read_size)
        scanned += 1
    except Exception as ex:
        failed += 1
        if failed <= 3:
            print(f"  READ FAIL at host=0x{cur:x} sva=0x{cur-dram+0x80000000:x}: {ex}", flush=True)
        cur += chunk_size
        continue

    for i in range(0, len(data) - 3, 4):
        sp, vr = data[i], data[i+1]
        if sp == 4 and vr == 0:
            hits_cat.append(cur + i)
        elif sp == 33 and vr == 0:
            hits_tiger.append(cur + i)

    cur += chunk_size
    if scanned % 64 == 0:
        pct = (cur - dram) * 100 // 0x100000000
        print(f"  progress: {pct}%  cat_hits={len(hits_cat)}  tiger_hits={len(hits_tiger)}  failed={failed}", flush=True)

mem_fd.close()
print(f"\nScan complete: {scanned} chunks OK, {failed} failed", flush=True)

def to_sva(h):
    return h - dram + 0x80000000

print(f"\nCat (sp=4,vr=0) hits: {len(hits_cat)}")
for h in hits_cat[:30]:
    print(f"  host=0x{h:x}  sva=0x{to_sva(h):x}")

print(f"\nTiger (sp=33,vr=0) hits: {len(hits_tiger)}")
for h in hits_tiger[:30]:
    print(f"  host=0x{h:x}  sva=0x{to_sva(h):x}")

# Check stride alignment
print("\nChecking stride-aligned Bob+Rolf pairs...")
tiger_set = set(hits_tiger)
for bh in hits_cat:
    for n in range(-12, 13):
        rh = bh + n * _VILLAGER2_SIZE
        if rh in tiger_set:
            print(f"  PAIR: Bob sva=0x{to_sva(bh):x}  Rolf sva=0x{to_sva(rh):x}  delta_slots={n}  array_base_sva=0x{to_sva(min(bh,rh)):x}", flush=True)

print("Done.", flush=True)
