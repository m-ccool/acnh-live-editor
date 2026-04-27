#!/usr/bin/env python3
"""
Exhaustive cherry scan: find ALL occurrences of ef 08 (cherry item_id LE)
in ALL rw regions, regardless of surrounding byte format.
Reports 16 bytes of context and interprets count at various offsets.
Goal: find the render struct format (4-byte, 8-byte, 12-byte, etc.)
"""
import sys
import struct

sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

pid = r._find_ryujinx_pid()
dram_base = r._find_dram_base(pid)
print(f"PID={pid}  DRAM_BASE={hex(dram_base)}")

regions = r._parse_maps(pid)
print(f"Scanning {len(regions)} rw regions for ef 08...\n")

CHUNK = 1024 * 1024
TARGET = b'\xef\x08'

# Known canonical mirror addresses to skip (host addrs)
SKIP_HOSTS = set()
# canonical mirrors are at dram offsets: 0xafb1e6e8, 0x80afb1e6e8, 0xe128f1e6e8
for rel in [0xafb1e6e8, 0x80afb1e6e8, 0xe128f1e6e8,
            0xafb88c28, 0x80afb88c28, 0xe128f88c28]:
    SKIP_HOSTS.add(dram_base + rel)

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

                host_addr = start + offset + idx
                if host_addr not in SKIP_HOSTS:
                    ctx_s = max(0, idx - 8)
                    ctx_e = min(len(data), idx + 24)
                    ctx = data[ctx_s:ctx_e]

                    # Try interpreting count at various offsets from ef08:
                    # offset +2 as u16 (4-byte compact struct)
                    count_u16_at2 = struct.unpack_from("<H", data, idx+2)[0] if idx+2+2 <= len(data) else None
                    # offset +4 as u16 (8-byte canonical struct, after 2 flag bytes)
                    count_u16_at4 = struct.unpack_from("<H", data, idx+4)[0] if idx+4+2 <= len(data) else None
                    # offset +4 as u32
                    count_u32_at4 = struct.unpack_from("<I", data, idx+4)[0] if idx+4+4 <= len(data) else None

                    # Only report if at least one count in range 1-9 (cherry test values)
                    interesting = (
                        (count_u16_at2 is not None and 1 <= count_u16_at2 <= 9) or
                        (count_u16_at4 is not None and 1 <= count_u16_at4 <= 9) or
                        (count_u32_at4 is not None and 1 <= count_u32_at4 <= 9)
                    )
                    if interesting:
                        hits.append((host_addr, label, ctx,
                                     count_u16_at2, count_u16_at4, count_u32_at4))

                pos = idx + 2  # ef08 is 2 bytes

            offset += chunk_size

# Sort by count values to group meaningful hits
hits.sort(key=lambda x: (x[3] if x[3] and 1<=x[3]<=9 else 99, x[0]))

print(f"=== All ef08 hits with count 1-9 at offset +2 or +4 ===")
print(f"Total: {len(hits)}\n")
for host, label, ctx, c2, c4, c4u32 in hits:
    rel = host - dram_base
    print(f"  host={hex(host)}  rel={hex(rel)}  region={label}")
    print(f"    ctx: {ctx.hex()}")
    print(f"    count@+2(u16)={c2}  count@+4(u16)={c4}  count@+4(u32)={c4u32}")
