#!/usr/bin/env python3
"""
Scan ALL readable host memory regions in Ryujinx for cherry 'ef 08' bytes.
Uses /proc/pid/maps to enumerate every rw region (DRAM + all doublemapper chunks).
This finds the actual render/display object no matter which host region it lives in.
"""
import sys, os

sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

pid  = r._find_ryujinx_pid()
base = r._find_dram_base(pid)

CHERRY_ID  = bytes([0xef, 0x08])
CHUNK = 0x100000  # 1MB

# Values we know have cherry and want to track (as phys offsets from DRAM_BASE)
KNOWN_PHYS = {
    0x24915f90,   # display_buffer slot2 (cherry x9 written)
    0xafb1e6e8,   # canonical slot2 (cherry x7 written)
    0xafb88c28,   # mirror slot2
    0x24915fe8,   # display_buffer slot13 (cherry x9 written)
    0xafb1e740,   # canonical slot13 (cherry x5)
    0xafb88c80,   # mirror slot13
}

mem_path = "/proc/%d/mem" % pid
regions  = r._parse_maps(pid)

print(f"PID={pid}  DRAM_BASE={hex(base)}")
print(f"Scanning {len(regions)} rw regions (ALL Ryujinx memory)")
print()

cherry_hits = []   # (host_addr, ctx_bytes)

for start, end, perms, label in regions:
    host = start
    while host < end:
        chunk_size = min(CHUNK, end - host)
        try:
            with open(mem_path, "rb", 0) as f:
                f.seek(host)
                chunk = f.read(chunk_size)
        except OSError:
            host += chunk_size
            continue
        if not chunk:
            host += chunk_size
            continue
        off = 0
        while True:
            idx = chunk.find(CHERRY_ID, off)
            if idx == -1:
                break
            match_host = host + idx
            # Small-count canonical: count in bytes [4:6] = 1-9 (LE) AND flags [2:4]=00
            cnt_lo  = chunk[idx+4] if len(chunk) > idx+4 else 255
            cnt_hi  = chunk[idx+5] if len(chunk) > idx+5 else 255
            flags   = chunk[idx+2:idx+4] if len(chunk) > idx+3 else b''
            if 1 <= cnt_lo <= 9 and cnt_hi == 0 and flags == b'\x00\x00':
                # Calculate "phys_offset" relative to DRAM_BASE for comparison
                dram_phys = match_host - base  # only valid if in DRAM
                if dram_phys not in KNOWN_PHYS:
                    ctx = chunk[max(0, idx-8):idx+24]
                    cherry_hits.append((match_host, cnt_lo, ctx, start, label))
            off = idx + 1
        host += chunk_size

print(f"=== Cherry x1-9 hits (OUTSIDE known canonical/mirror/display VAs) ===")
print(f"Total: {len(cherry_hits)}")
for match_host, cnt, ctx, region_start, label in cherry_hits[:40]:
    dram_rel = match_host - base
    print(f"  host={hex(match_host)}  dram_rel={hex(dram_rel)}  count={cnt}  region={hex(region_start)} {label}")
    print(f"    ctx: {ctx.hex()}")

