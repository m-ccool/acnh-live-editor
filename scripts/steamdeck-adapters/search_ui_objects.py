#!/usr/bin/env python3
"""Search open-pocket DRAM dump for known item IDs in the UI object region."""
import struct, os

BIN = os.path.expanduser("~/acnh-live-editor/test-results/pocket-diff/open_new_low.bin")
BASE_VA = 0xaf800000

# Known item IDs from live slot reads
KNOWN = {
    0x0d8a: "empty can",
    0x08ef: "cherry",
    0x217e: "golden shovel",
    0x2182: "golden slingshot",
    0x125f: "vaulting pole",
    0x2155: "golden watering can",
    0x1ff3: "golden net",
    0x2591: "golden axe",
    0x16db: "NMT",
    0x0a40: "clump of weeds",
    0x0842: "1000 bells",
    0x0875: "52000 bells",
    0xfffe: "null/empty",
}

# Search range: 0xaf9a2600 - 0xaf9a6000 (within low bin)
SEARCH_START = 0xaf9a2600 - BASE_VA
SEARCH_END   = 0xaf9a8000 - BASE_VA

with open(BIN, "rb") as f:
    data = f.read()

print(f"Binary: {len(data)} bytes, VA range {hex(BASE_VA)} - {hex(BASE_VA+len(data))}")
print(f"Searching {hex(BASE_VA+SEARCH_START)} - {hex(BASE_VA+SEARCH_END)}\n")

region = data[SEARCH_START:SEARCH_END]
hits = []
for off in range(0, len(region) - 1):
    val = struct.unpack_from("<H", region, off)[0]
    if val in KNOWN:
        abs_off = SEARCH_START + off
        va = BASE_VA + abs_off
        ctx = data[abs_off:abs_off+16]
        hits.append((va, val, KNOWN[val], ctx))

# Print
print(f"Found {len(hits)} item ID hits:\n")
for va, vid, name, ctx in hits:
    print(f"  VA {hex(va)}  id={hex(vid)} ({name:24s})  ctx: {ctx.hex()}")
