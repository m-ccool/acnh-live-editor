#!/usr/bin/env python3
"""
Diagnostic: find ALL locations of Cat-species (sp=4) and Tiger-species (sp=33)
at 4-byte alignment in the ±32MB window around inventory VA.
Also checks full 4GB for Cat+Tiger pair at ANY offset (not just stride).
Reveals actual stride/offset between Bob and Rolf structs.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from acnh_memory_reader import _find_ryujinx_pid, _find_dram_base

pid    = _find_ryujinx_pid()
dram   = _find_dram_base(pid)
DRAM_END = dram + 0x100000000
print(f"PID={pid}  DRAM=0x{dram:x}", flush=True)

# Phase 1: narrow window around inventory
INVENTORY_SVA = 0xAFB1E6E0
WINDOW        = 0x4000000   # ±64MB (wider now)
SCAN_START    = INVENTORY_SVA - WINDOW
SCAN_END      = INVENTORY_SVA + WINDOW

CHUNK = 0x400000

def to_sva(h):
    return h - dram + 0x80000000

def host(sva):
    return dram + (sva - 0x80000000)

mem_fd = open(f"/proc/{pid}/mem", "rb")

print(f"\n=== Phase 1: species scan 0x{SCAN_START:x}-0x{SCAN_END:x} ===", flush=True)
cat_hits   = []
tiger_hits = []

cur_sva = SCAN_START
while cur_sva < SCAN_END:
    chunk_host = host(cur_sva)
    read_size  = min(CHUNK, host(SCAN_END) - chunk_host)
    try:
        mem_fd.seek(chunk_host)
        data = mem_fd.read(read_size)
    except Exception:
        cur_sva += CHUNK
        continue
    for i in range(0, len(data) - 1, 4):
        sp = data[i]
        vr = data[i + 1]
        if sp == 4 and vr == 0:
            cat_hits.append(cur_sva + i)
        elif sp == 33 and vr == 0:
            tiger_hits.append(cur_sva + i)
    cur_sva += CHUNK

print(f"Cat   [04,00] hits at 4-byte align: {len(cat_hits)}", flush=True)
print(f"Tiger [33,00] hits at 4-byte align: {len(tiger_hits)}", flush=True)

if cat_hits and tiger_hits:
    # Show first 5 of each with context
    print("\n-- First 5 Cat hits --", flush=True)
    for sva in cat_hits[:5]:
        try:
            ctx = mem_fd.read(16)
            mem_fd.seek(host(sva))
            ctx = mem_fd.read(16).hex()
        except Exception:
            ctx = "?"
        print(f"  sva=0x{sva:x}  bytes={ctx}", flush=True)
    print("\n-- First 5 Tiger hits --", flush=True)
    for sva in tiger_hits[:5]:
        try:
            mem_fd.seek(host(sva))
            ctx = mem_fd.read(16).hex()
        except Exception:
            ctx = "?"
        print(f"  sva=0x{sva:x}  bytes={ctx}", flush=True)

    # Phase 2: find offset between closest Cat and Tiger
    print("\n-- Cat vs Tiger offsets (first 20 pairs) --", flush=True)
    count = 0
    for ch in cat_hits:
        for th in tiger_hits:
            diff = th - ch
            if 0x5000 < abs(diff) < 0x20000:  # plausible struct range
                print(f"  cat=0x{ch:x}  tiger=0x{th:x}  diff=0x{diff:x}  ({diff})", flush=True)
                count += 1
                if count >= 20:
                    break
        if count >= 20:
            break
else:
    print("NOTE: No Cat or Tiger hits in window — villager array is outside ±64MB of inventory", flush=True)

mem_fd.close()
print("\nDone.", flush=True)

