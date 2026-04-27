#!/usr/bin/env python3
"""
Scan full 4GB DRAM for cherry x3 (the value shown on screen).
This finds the actual render object the game draws from.
Current state: canonical=x7, display_buffer=x9, screen=x3.
"""
import sys
sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

pid  = r._find_ryujinx_pid()
base = r._find_dram_base(pid)

CHERRY_ID = bytes([0xef, 0x08])
CHERRY_X3 = bytes([0xef, 0x08, 0x00, 0x00, 0x03])  # canonical 8-byte format

# Known VAs to skip
SKIP_VAS = {
    0xafb1e6e8,   # canonical slot2
    0xafb88c28,   # mirror slot2
    0x24915f90,   # display_buffer slot2
    0xafb1e740,   # canonical slot13
    0xafb88c80,   # mirror slot13
    0x24915fe8,   # display_buffer slot13
    0xb44c52d8,   # 5th array slot
}

CHUNK = 0x100000
mem_path = "/proc/%d/mem" % pid

# Get actual DRAM size
DRAM_SIZE = 0x100000000
for start, end, perms, label in r._parse_maps(pid):
    if start == base and (end - start) >= 0x80000000:
        DRAM_SIZE = end - start
        break

print("Scanning for cherry x3 pattern 'ef0800000300' in full DRAM...")
print("  canonical slot2=%s, display_buf slot2=%s" % (
    hex(base + 0xafb1e6e8), hex(base + 0x24915f90)))
print()

hits = []
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
            phys = (host - base) + idx
            if phys not in SKIP_VAS:
                ctx = chunk[max(0, idx-8):idx+24]
                # Focus on x3 specifically
                if len(chunk) > idx + 5 and chunk[idx+4] == 3 and chunk[idx+5] == 0:
                    hits.append(("cherry_x3", phys, ctx))
                elif len(chunk) > idx + 4 and chunk[idx:idx+5] not in (CHERRY_X3,):
                    # Check for other small count (1-9) patterns
                    cnt_lo = chunk[idx+4] if len(chunk) > idx+4 else 0
                    cnt_hi = chunk[idx+5] if len(chunk) > idx+5 else 0
                    if 1 <= cnt_lo <= 9 and cnt_hi == 0 and chunk[idx+2:idx+4] in (b'\x00\x00', b'\xff\xff'):
                        hits.append(("cherry_x%d" % cnt_lo, phys, ctx))
            off = idx + 1
        host += CHUNK

print("=== Cherry x3+ hits (non-canonical/mirror/display) ===")
x3_hits = [(t,p,c) for t,p,c in hits if t == "cherry_x3"]
print(f"Total cherry x3 hits: {len(x3_hits)}")
for tag, phys, ctx in x3_hits[:30]:
    print("  phys=%s  ctx: %s  [%s]" % (hex(phys), ctx.hex(), tag))

print()
other_hits = [(t,p,c) for t,p,c in hits if t != "cherry_x3"]
print(f"Other cherry x1-9 hits: {len(other_hits)}")
for tag, phys, ctx in other_hits[:20]:
    print("  phys=%s  ctx: %s  [%s]" % (hex(phys), ctx.hex(), tag))
