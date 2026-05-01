#!/usr/bin/env python3
"""
Inline scan: for every [4,0] (Bob/Cat) at 4-byte alignment, immediately
read at +STRIDE and -STRIDE to check for [33,0] (Rolf/Tiger).
No hit lists — O(1) memory, fast, no false-positive explosion.
Also checks the reverse: every [33,0] → look at +/-STRIDE for [4,0].
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from acnh_memory_reader import _find_ryujinx_pid, _find_dram_base, _VILLAGER2_SIZE

pid    = _find_ryujinx_pid()
dram   = _find_dram_base(pid)
STRIDE = _VILLAGER2_SIZE  # 0x13230
print(f"PID={pid}  DRAM=0x{dram:x}  STRIDE=0x{STRIDE:x}", flush=True)

DRAM_END   = dram + 0x100000000
# Overlap each chunk by STRIDE so cross-boundary pairs are not missed
CHUNK      = 0x400000  # 4 MB
OVERLAP    = STRIDE

def to_sva(h):
    return h - dram + 0x80000000

mem_fd  = open(f"/proc/{pid}/mem", "rb")
matches = []
scanned = 0
failed  = 0

def read_at(fd, host_va, size):
    fd.seek(host_va)
    return fd.read(size)

cur = dram
while cur < DRAM_END:
    read_size = min(CHUNK, DRAM_END - cur)
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

    dlen = len(data)
    for i in range(0, dlen - 3, 4):
        sp = data[i]
        vr = data[i + 1]
        if sp == 4 and vr == 0:
            # Bob candidate — check for Rolf at +STRIDE and -STRIDE
            bob_host = cur + i
            for delta in (STRIDE, -STRIDE):
                rolf_host = bob_host + delta
                if rolf_host < dram or rolf_host + 4 > DRAM_END:
                    continue
                try:
                    rbytes = read_at(mem_fd, rolf_host, 4)
                except Exception:
                    continue
                if rbytes[0] == 33 and rbytes[1] == 0:
                    slot = -1 if delta < 0 else 0
                    rolf_slot = 0 if delta < 0 else 1
                    base = min(bob_host, rolf_host)
                    print(
                        f"MATCH  bob_sva=0x{to_sva(bob_host):x} [{data[i]:02x}{data[i+1]:02x}{data[i+2]:02x}{data[i+3]:02x}]"
                        f"  rolf_sva=0x{to_sva(rolf_host):x} [{rbytes[0]:02x}{rbytes[1]:02x}{rbytes[2]:02x}{rbytes[3]:02x}]"
                        f"  base_sva=0x{to_sva(base):x}  delta={'+'if delta>0 else ''}{delta//STRIDE}",
                        flush=True
                    )
                    matches.append((bob_host, rolf_host))

    cur += CHUNK
    if scanned % 64 == 0:
        pct = (cur - dram) * 100 // 0x100000000
        print(f"  progress: {pct}%  matches={len(matches)}  failed={failed}", flush=True)

mem_fd.close()
print(f"\nDone. chunks={scanned} failed={failed} matches={len(matches)}", flush=True)
