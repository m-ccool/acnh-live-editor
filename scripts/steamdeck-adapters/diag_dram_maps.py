#!/usr/bin/env python3
"""Diagnostic: show DRAM-overlapping /proc/maps regions and test reads."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from acnh_memory_reader import _find_ryujinx_pid, _find_dram_base

pid  = _find_ryujinx_pid()
dram = _find_dram_base(pid)
DRAM_END = dram + 0x100000000
print(f"PID={pid}  DRAM=0x{dram:x}  DRAM_END=0x{DRAM_END:x}", flush=True)

dram_maps = []
with open(f"/proc/{pid}/maps") as f:
    for line in f:
        parts = line.split()
        if len(parts) < 2 or 'r' not in parts[1]:
            continue
        s, e = parts[0].split('-')
        s, e = int(s, 16), int(e, 16)
        if s < DRAM_END and e > dram:
            perm = parts[1]
            label = parts[-1] if len(parts) > 4 else ''
            dram_maps.append((s, e, perm, label))
            print(f"  0x{s:x}-0x{e:x}  size=0x{e-s:x}  {perm}  {label}", flush=True)

print(f"Total DRAM regions: {len(dram_maps)}", flush=True)

# Try reading a small chunk from each region
mem_fd = open(f"/proc/{pid}/mem", "rb")
for (s, e, perm, label) in dram_maps:
    test_off = s
    try:
        mem_fd.seek(test_off)
        chunk = mem_fd.read(min(64, e - s))
        sva = test_off - dram + 0x80000000
        print(f"  READ OK  host=0x{test_off:x}  sva=0x{sva:x}  bytes={chunk[:16].hex()}", flush=True)
    except Exception as ex:
        print(f"  READ FAIL host=0x{test_off:x}  err={ex}", flush=True)
mem_fd.close()
print("Done.", flush=True)
