#!/usr/bin/env python3
"""
Raw search for Bob (Cat sp=4, var=0) and Rolf (Tiger sp=33, var=0) in DRAM.
Scans all readable /proc/<pid>/maps regions and prints every offset where
bytes [sp=4,vr=0] or [sp=33,vr=0] appear at 4-byte alignment,
then checks if a second known villager is at ±stride offsets nearby.
"""
import os, sys, struct
sys.path.insert(0, os.path.dirname(__file__))
from acnh_memory_reader import _find_ryujinx_pid, _find_dram_base, _VILLAGER2_SIZE

TARGETS = {
    (4,  0): 'Bob (Cat)',
    (33, 0): 'Rolf (Tiger)',
}
STRIDE = _VILLAGER2_SIZE  # 0x13230

pid  = _find_ryujinx_pid()
dram = _find_dram_base(pid)
print(f"PID={pid}  DRAM=0x{dram:x}  STRIDE=0x{STRIDE:x}", flush=True)

# Read /proc/<pid>/maps to find candidate regions
maps = []
try:
    with open(f"/proc/{pid}/maps", "r") as f:
        for line in f:
            parts = line.split()
            if len(parts) < 2 or 'r' not in parts[1]:
                continue
            start_s, end_s = parts[0].split('-')
            start, end = int(start_s, 16), int(end_s, 16)
            size = end - start
            # Skip tiny regions (vdso/vsyscall noise)
            if size < 0x10000:
                continue
            maps.append((start, end, size))
except Exception as e:
    print(f"maps read error: {e}", flush=True)
    sys.exit(1)

print(f"Candidate regions: {len(maps)}", flush=True)

mem_fd = open(f"/proc/{pid}/mem", "rb")

hits_bob  = []
hits_rolf = []

for (reg_start, reg_end, reg_size) in maps:
    chunk_size = min(reg_size, 0x400000)  # 4 MB chunks
    for off in range(0, reg_size, chunk_size):
        abs_start = reg_start + off
        read_size = min(chunk_size, reg_end - abs_start)
        if read_size <= 0:
            break
        try:
            mem_fd.seek(abs_start)
            data = mem_fd.read(read_size)
        except Exception:
            continue
        for i in range(0, len(data) - 3, 4):
            sp, vr = data[i], data[i+1]
            if (sp, vr) == (4, 0):
                hits_bob.append(abs_start + i)
            elif (sp, vr) == (33, 0):
                hits_rolf.append(abs_start + i)

mem_fd.close()

# Convert host VA → Switch VA
def to_sva(host_va):
    return host_va - dram + 0x80000000

print(f"\nBob (sp=4,vr=0) hits: {len(hits_bob)}")
for h in hits_bob[:20]:
    sva = to_sva(h)
    print(f"  host=0x{h:x}  switchVA=0x{sva:x}")

print(f"\nRolf (sp=33,vr=0) hits: {len(hits_rolf)}")
for h in hits_rolf[:20]:
    sva = to_sva(h)
    print(f"  host=0x{h:x}  switchVA=0x{sva:x}")

# Look for Bob+Rolf at the same stride
print("\nChecking stride alignment between Bob and Rolf hits...")
bob_set  = set(hits_bob)
rolf_set = set(hits_rolf)
found = []
for bh in hits_bob:
    for n in range(-12, 13):
        rh = bh + n * STRIDE
        if rh in rolf_set:
            sva_b = to_sva(bh)
            sva_r = to_sva(rh)
            array_base = min(bh, rh) - max(0, min(abs(n), 0)) * STRIDE
            print(f"  MATCH: Bob=0x{sva_b:x}  Rolf=0x{sva_r:x}  slot_delta={n}  array_base~0x{to_sva(min(bh,rh)):x}")
            found.append((bh, rh))

if not found:
    print("  No stride-aligned pair found in scan window.")

print("\nDone.", flush=True)
