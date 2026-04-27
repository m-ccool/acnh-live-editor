#!/usr/bin/env python3
"""
Full DRAM scan for cherry 'ef 08' bytes.
Scans the physical DRAM region directly (host: dram_base to dram_base+4GB).
Canonical/mirror now hold cherry x5; stale cherry x2 hits = display buffer.
"""
import sys, os

sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

pid  = r._find_ryujinx_pid()
base = r._find_dram_base(pid)

# Find actual DRAM size from /proc/pid/maps
DRAM_SIZE = 0x100000000  # default 4GB
for start, end, perms, label in r._parse_maps(pid):
    if start == base and (end - start) >= 0x80000000:
        DRAM_SIZE = end - start
        break

CHERRY_ID  = bytes([0xef, 0x08])
CHERRY_X2  = bytes([0xef, 0x08, 0x00, 0x00, 0x02])
CHERRY_X5  = bytes([0xef, 0x08, 0x00, 0x00, 0x05])

CHUNK = 0x100000  # 1MB chunks

mem_path = "/proc/%d/mem" % pid

print("PID=%d  DRAM_BASE=%s  DRAM_SIZE=%s" % (pid, hex(base), hex(DRAM_SIZE)))
print("Scanning full DRAM: %s - %s" % (hex(base), hex(base + DRAM_SIZE)))
print()

hits_x2    = []
hits_x5    = []
hits_other = []

with open(mem_path, "rb", 0) as f:
    host = base
    while host < base + DRAM_SIZE:
        try:
            f.seek(host)
            chunk = f.read(CHUNK)
        except OSError:
            host += CHUNK
            continue
        if not chunk:
            host += CHUNK
            continue
        off = 0
        while True:
            idx = chunk.find(CHERRY_ID, off)
            if idx == -1:
                break
            physical = (host - base) + idx
            ctx = chunk[max(0, idx-8):idx+24]
            if chunk[idx:idx+5] == CHERRY_X2:
                hits_x2.append((physical, ctx))
            elif chunk[idx:idx+5] == CHERRY_X5:
                hits_x5.append((physical, ctx))
            else:
                hits_other.append((physical, ctx))
            off = idx + 1
        host += CHUNK

print("=== Cherry x2 (STALE display buffer hits) ===")
for phys, ctx in hits_x2:
    print("  phys_offset %s  ctx: %s" % (hex(phys), ctx.hex()))

print()
print("=== Cherry x5 (canonical/mirror) ===")
for phys, ctx in hits_x5:
    print("  phys_offset %s  ctx: %s" % (hex(phys), ctx.hex()))

print()
print("=== Other 'ef 08' hits: %d ===" % len(hits_other))
for phys, ctx in hits_other[:10]:
    print("  phys_offset %s  ctx: %s" % (hex(phys), ctx.hex()))
