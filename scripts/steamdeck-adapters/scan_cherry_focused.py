#!/usr/bin/env python3
"""
Targeted scan: find ALL occurrences of cherry (0x08ef) with count=2 or count=3
across ALL rw regions. Sorted by count to separate x2 (canonical) from x3 (render).
"""
import sys
import struct

sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

pid = r._find_ryujinx_pid()
dram_base = r._find_dram_base(pid)
print(f"PID={pid}  DRAM_BASE={hex(dram_base)}")

regions = r._parse_maps(pid)
print(f"Scanning {len(regions)} rw regions for cherry x2/x3...\n")

CHUNK = 1024 * 1024
TARGET = b'\xef\x08\x00\x00'  # cherry, flag0=0, flag1=0

hits = []
mem_path = f"/proc/{pid}/mem"

with open(mem_path, "rb") as f:
    for (start, end, perms, label) in regions:
        size = end - start
        offset = 0
        while offset < size:
            chunk_size = min(CHUNK, size - offset)
            try:
                f.seek(start + offset)
                data = f.read(chunk_size)
            except OSError:
                offset += chunk_size
                continue

            pos = 0
            while True:
                idx = data.find(TARGET, pos)
                if idx == -1:
                    break
                if idx + 8 <= len(data):
                    item_id, f0, f1, count, uses = struct.unpack_from("<HBBHH", data, idx)
                    if count in (2, 3):
                        host_addr = start + offset + idx
                        ctx_s = max(0, idx - 8)
                        ctx_e = min(len(data), idx + 16)
                        ctx = data[ctx_s:ctx_e].hex()
                        hits.append((count, host_addr, label, ctx))
                pos = idx + 1

            offset += chunk_size

hits.sort(key=lambda x: (x[0], x[1]))

print("=== cherry x2 hits ===")
for count, host, label, ctx in hits:
    if count == 2:
        rel = host - dram_base
        print(f"  host={hex(host)}  dram_rel={hex(rel)}  region={label}")
        print(f"    ctx: {ctx}")

print("\n=== cherry x3 hits ===")
for count, host, label, ctx in hits:
    if count == 3:
        rel = host - dram_base
        print(f"  host={hex(host)}  dram_rel={hex(rel)}  region={label}")
        print(f"    ctx: {ctx}")

print(f"\nTotal x2: {sum(1 for c,_,_,_ in hits if c==2)}  Total x3: {sum(1 for c,_,_,_ in hits if c==3)}")
