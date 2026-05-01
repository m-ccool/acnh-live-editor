#!/usr/bin/env python3
"""
Search DRAM for villager name strings in UTF-16LE.
Bob  = 42 00 6F 00 62 00 [00 00]
Rolf = 52 00 6F 00 6C 00 66 00 [00 00]
For each Rolf hit, print 32 bytes of context and check for Bob
at offsets 0x13230 (NHSE stride) in both directions.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from acnh_memory_reader import _find_ryujinx_pid, _find_dram_base

pid    = _find_ryujinx_pid()
dram   = _find_dram_base(pid)
STRIDE = 0x13230
DRAM_END = dram + 0x100000000
print(f"PID={pid}  DRAM=0x{dram:x}  STRIDE=0x{STRIDE:x}", flush=True)

BOB_UTF16  = b'B\x00o\x00b\x00\x00\x00'          # "Bob\0"
ROLF_UTF16 = b'R\x00o\x00l\x00f\x00\x00\x00'     # "Rolf\0"
# Also search for just the name without null terminator in case it's not null-terminated
BOB_BASE   = b'B\x00o\x00b\x00'
ROLF_BASE  = b'R\x00o\x00l\x00f\x00'

CHUNK    = 0x400000  # 4 MB
OVERLAP  = max(len(ROLF_UTF16), STRIDE + 4)  # keep overlap for cross-boundary + stride check

def to_sva(h):
    return h - dram + 0x80000000

mem_fd  = open(f"/proc/{pid}/mem", "rb")
rolf_hits  = []
bob_hits   = []
scanned = 0
failed  = 0

cur = dram
while cur < DRAM_END:
    read_end  = min(cur + CHUNK + len(ROLF_BASE), DRAM_END)
    read_size = read_end - cur
    try:
        mem_fd.seek(cur)
        data = mem_fd.read(read_size)
        scanned += 1
    except Exception as ex:
        failed += 1
        if failed <= 5:
            print(f"  READ FAIL 0x{cur:x}: {ex}", flush=True)
        cur += CHUNK
        continue

    # Search for Rolf
    off = 0
    while True:
        idx = data.find(ROLF_BASE, off)
        if idx < 0:
            break
        host_va = cur + idx
        sva     = to_sva(host_va)
        # Read 32 bytes context around the hit
        try:
            mem_fd.seek(host_va - 16)
            ctx = mem_fd.read(64)
            ctx_hex = ctx.hex()
        except Exception:
            ctx_hex = "?"
        print(f"ROLF_NAME  sva=0x{sva:x}  ctx[-16..+48]={ctx_hex}", flush=True)
        rolf_hits.append(host_va)
        off = idx + 1

    # Search for Bob
    off = 0
    while True:
        idx = data.find(BOB_BASE, off)
        if idx < 0:
            break
        host_va = cur + idx
        sva     = to_sva(host_va)
        bob_hits.append(host_va)
        off = idx + 1

    cur += CHUNK
    if scanned % 64 == 0:
        pct = (cur - dram) * 100 // 0x100000000
        print(f"  progress: {pct}%  rolf_hits={len(rolf_hits)}  bob_hits={len(bob_hits)}  failed={failed}", flush=True)

mem_fd.close()
print(f"\nDone. chunks={scanned} failed={failed}", flush=True)
print(f"Rolf name hits: {len(rolf_hits)}", flush=True)
print(f"Bob  name hits: {len(bob_hits)}", flush=True)

# Cross-check: for each Rolf hit, is there a Bob hit at ±STRIDE?
print("\n--- Stride-pair candidates ---", flush=True)
bob_set = set(bob_hits)
for rh in rolf_hits:
    for delta in (STRIDE, -STRIDE):
        bh = rh + delta
        # Check within 32 bytes (name may not align exactly with struct start)
        found = False
        for off in range(-32, 33):
            if bh + off in bob_set:
                print(f"PAIR  rolf_sva=0x{to_sva(rh):x}  bob_sva=0x{to_sva(bh+off):x}  name_offset_diff={off}", flush=True)
                found = True
                break
        if not found:
            # Check approximate: bob within ±256 bytes of stride position
            near = [b for b in bob_hits if abs(b - bh) < 256]
            if near:
                print(f"NEAR  rolf_sva=0x{to_sva(rh):x}  nearest_bob_sva=0x{to_sva(near[0]):x}  diff={near[0]-bh:+d}", flush=True)

