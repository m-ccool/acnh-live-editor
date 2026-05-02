#!/usr/bin/env python3
"""
Narrow scan ±32MB around the confirmed inventory VA (0xAFB1E6E0).
Finds every [4,0] (Cat/Bob) + [33,0] (Tiger/Rolf) pair at STRIDE offset
WITHOUT personality filter — then dumps 32 bytes of context so we can
read the actual struct layout from live memory.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from acnh_memory_reader import _find_ryujinx_pid, _find_dram_base, _VILLAGER2_SIZE

pid    = _find_ryujinx_pid()
dram   = _find_dram_base(pid)
STRIDE = _VILLAGER2_SIZE  # 0x13230
print(f"PID={pid}  DRAM=0x{dram:x}  STRIDE=0x{STRIDE:x}", flush=True)

# Known good landmark: inventory is confirmed at Switch VA 0xAFB1E6E0
INVENTORY_SVA = 0xAFB1E6E0
WINDOW        = 0x2000000   # ±32MB
SCAN_START    = INVENTORY_SVA - WINDOW
SCAN_END      = INVENTORY_SVA + WINDOW
DRAM_END      = dram + 0x100000000
CHUNK         = 0x400000    # 4MB

def to_sva(h):
    return h - dram + 0x80000000

def host(sva):
    return dram + (sva - 0x80000000)

mem_fd  = open(f"/proc/{pid}/mem", "rb")
matches = 0
failed  = 0

def read_at(fd, host_va, size):
    fd.seek(host_va)
    return fd.read(size)

print(f"Scanning 0x{SCAN_START:x} - 0x{SCAN_END:x}  ({(SCAN_END-SCAN_START)//0x100000}MB)", flush=True)

cur_sva = SCAN_START
while cur_sva < SCAN_END:
    chunk_host = host(cur_sva)
    read_size  = min(CHUNK, host(SCAN_END) - chunk_host)
    try:
        mem_fd.seek(chunk_host)
        data = mem_fd.read(read_size)
    except Exception as ex:
        failed += 1
        if failed <= 5:
            print(f"  READ FAIL sva=0x{cur_sva:x}: {ex}", flush=True)
        cur_sva += CHUNK
        continue

    dlen = len(data)
    for i in range(0, dlen - 3, 4):
        sp = data[i]
        vr = data[i + 1]
        if sp == 4 and vr == 0:
            bob_host = chunk_host + i
            for delta in (STRIDE, -STRIDE):
                rolf_host = bob_host + delta
                rolf_sva  = to_sva(rolf_host)
                if rolf_sva < SCAN_START or rolf_sva >= SCAN_END:
                    continue
                try:
                    rbytes = read_at(mem_fd, rolf_host, 4)
                except Exception:
                    continue
                if rbytes[0] == 33 and rbytes[1] == 0:
                    # Dump 32 bytes of context for both Bob and Rolf structs
                    try:
                        bob_ctx  = read_at(mem_fd, bob_host,  32).hex()
                        rolf_ctx = read_at(mem_fd, rolf_host, 32).hex()
                    except Exception:
                        bob_ctx = rolf_ctx = "?"
                    d = '+1' if delta > 0 else '-1'
                    print(
                        f"MATCH delta={d}  bob_sva=0x{to_sva(bob_host):x}  rolf_sva=0x{rolf_sva:x}",
                        flush=True
                    )
                    print(f"  bob_ctx[0..32]:  {bob_ctx}", flush=True)
                    print(f"  rolf_ctx[0..32]: {rolf_ctx}", flush=True)
                    matches += 1

    cur_sva += CHUNK

mem_fd.close()
print(f"\nDone. matches={matches}  failed={failed}", flush=True)

