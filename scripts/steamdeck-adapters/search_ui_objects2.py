#!/usr/bin/env python3
"""
Search open-pocket DRAM snapshot for cherry item ID bytes (ef 08)
in and around the UI object region to discover the display struct format.
"""
import struct, os

BIN  = os.path.expanduser("~/acnh-live-editor/test-results/pocket-diff/open_new_low.bin")
BASE = 0xaf800000

SEARCH_START = 0xaf9a0000 - BASE
SEARCH_END   = 0xaf9d0000 - BASE  # 192KB window

with open(BIN, "rb") as f:
    data = f.read()

region = data[SEARCH_START:SEARCH_END]
target = bytes([0xef, 0x08])

print("Searching %s - %s for 'ef 08':" % (hex(0xaf9a0000), hex(0xaf9d0000)))
print()

for i in range(len(region) - 1):
    if region[i:i+2] == target:
        va = 0xaf9a0000 + i
        ctx = region[max(0, i-16):i+32]
        print("VA %s" % hex(va))
        print("  ctx[-16..+32]: %s" % ctx.hex())
        nearby = region[max(0, i-16):i+16]
        for j, b in enumerate(nearby):
            if b == 0x02:
                print("    0x02 at offset %+d from hit" % (j - 16))
        print()

import sys; sys.exit(0)
"""DEAD CODE BELOW — original search preserved for reference"""
BASE_LOW = 0

BASE_LOW = 0xaf800000
BASE_MID = 0xafb00000

BIN_LOW = os.path.expanduser("~/acnh-live-editor/test-results/pocket-diff/open_new_low.bin")
BIN_MID = os.path.expanduser("~/acnh-live-editor/test-results/pocket-diff/open_new_mid.bin")

# Full 8-byte canonical slot raw values (from live read)
CANONICAL = {
    "slot01_empty_can":        bytes.fromhex("8a0d000000000000"),
    "slot02_cherry_x2":        bytes.fromhex("ef08000002000000"),
    "slot03_golden_shovel":    bytes.fromhex("7e21000000000900"),
    "slot04_golden_slingshot": bytes.fromhex("8221000000000000"),
    "slot05_vaulting_pole":    bytes.fromhex("5f12000000000000"),
    "slot06_golden_wcan":      bytes.fromhex("5521000000000000"),
    "slot07_golden_net":       bytes.fromhex("f31f000000000000"),
    "slot09_52kbells":         bytes.fromhex("7508000000000000"),
    "slot14_golden_axe_x1":    bytes.fromhex("9125000001000000"),
}

# Also search for just item_id u16 LE values
ITEM_IDS = {
    0x0d8a: "empty_can",
    0x08ef: "cherry",
    0x217e: "golden_shovel",
    0x2182: "golden_slingshot",
    0x125f: "vaulting_pole",
    0x2155: "golden_wcan",
    0x1ff3: "golden_net",
    0x2591: "golden_axe",
    0x0875: "52kbells",
    0x16db: "NMT",
    0x0a40: "weeds",
}

def search_bin(path, base_va, label):
    print(f"\n=== {label} (base {hex(base_va)}) ===")
    with open(path, "rb") as f:
        data = f.read()

    # Search for full 8-byte canonical matches
    print("--- Full 8-byte canonical slot matches ---")
    for name, pattern in CANONICAL.items():
        off = 0
        while True:
            idx = data.find(pattern, off)
            if idx == -1:
                break
            va = base_va + idx
            print(f"  {name}: VA {hex(va)}  (offset {hex(idx)})")
            # Print 32 bytes context
            ctx = data[max(0,idx-8):idx+24]
            print(f"    context[-8..+24]: {ctx.hex()}")
            off = idx + 1

    # Search for u16 item IDs (2-byte LE) only in interesting ranges
    print("\n--- Item ID u16 hits (entire binary) ---")
    from collections import defaultdict
    hits = defaultdict(list)
    for off in range(0, len(data) - 1):
        val = struct.unpack_from("<H", data, off)[0]
        if val in ITEM_IDS:
            va = base_va + off
            hits[ITEM_IDS[val]].append(va)
    for name, vas in sorted(hits.items()):
        count = len(vas)
        if count <= 10:
            print(f"  {name}: {count} hits @ {[hex(v) for v in vas]}")
        else:
            print(f"  {name}: {count} hits (too many, skipping)")

search_bin(BIN_LOW, BASE_LOW, "LOW open")
search_bin(BIN_MID, BASE_MID, "MID open")
