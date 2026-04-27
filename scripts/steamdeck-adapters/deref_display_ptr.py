#!/usr/bin/env python3
"""
Dereference the 5-byte host-pointer stored in game DRAM at VA 0xaf9a2fdc.
The diff showed this value appears when the pocket opens, pointing to UI heap objects.
These are C++ heap allocations at HOST addresses (not Switch VAs).
"""
import sys, struct
sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

pid  = r._find_ryujinx_pid()
base = r._find_dram_base(pid)

POINTER_REGION_VA = 0xaf9a0000   # VA range that had pointers in the open-pocket diff
POINTER_REGION_END = 0xaf9d0000

CHERRY_ID = bytes([0xef, 0x08])

mem_path = "/proc/%d/mem" % pid

# --- Step 1: Read the pointer area from game DRAM and find 5-byte values ---
print("=== Reading pointer region 0xaf9a0000-0xaf9d0000 ===")
print("Looking for 5-byte LE host pointers (0x20... range) near item data...")
print()

# Read the region
region_raw = r._read_switch_va(pid, base, POINTER_REGION_VA, POINTER_REGION_END - POINTER_REGION_VA)

# The diff showed a 5-byte value at specific offsets within this region
# Known interesting VA: 0xaf9a2fdc (from diff)
# VA - POINTER_REGION_VA = 0xaf9a2fdc - 0xaf9a0000 = 0x2fdc
target_offsets = [0x2fdc, 0x2fe0, 0x2fe4, 0x2fe8, 0x2fec, 0x2ff0]
print("Values at known diff offsets:")
for off in target_offsets:
    if off + 8 <= len(region_raw):
        raw = region_raw[off:off+8]
        # Read as 5-byte LE host pointer
        v5 = int.from_bytes(raw[:5], 'little')
        v8 = int.from_bytes(raw[:8], 'little')
        print(f"  VA {hex(POINTER_REGION_VA + off)}: {raw.hex()}  5b={hex(v5)}  8b={hex(v8)}")
print()

# --- Step 2: Scan the region for ALL 5-byte pointers in the 0x21-0x22 range (Ryujinx heap range) ---
print("Scanning for 5-byte pointers to Ryujinx heap (0x2100000000-0x2200000000)...")
found_ptrs = []
for i in range(0, len(region_raw) - 5, 1):
    b5 = int.from_bytes(region_raw[i:i+5], 'little')
    if 0x2100000000 <= b5 < 0x2200000000:
        va = POINTER_REGION_VA + i
        ctx = region_raw[max(0,i-4):i+12]
        found_ptrs.append((va, b5, ctx))

print(f"Found {len(found_ptrs)} potential heap pointers")
for va, ptr, ctx in found_ptrs[:20]:
    print(f"  VA={hex(va)}  ptr={hex(ptr)}  ctx={ctx.hex()}")
print()

# --- Step 3: Dereference the found pointers and search for cherry ---
print("Dereferencing pointers and searching for cherry (ef 08)...")
DEREF_SIZE = 0x200   # 512 bytes around each pointer target
cherry_found = []

with open(mem_path, "rb", 0) as f:
    for va, ptr, ctx in found_ptrs[:50]:   # limit to first 50
        try:
            f.seek(ptr - 0x80)   # read 128 bytes before the pointed address too
            data = f.read(DEREF_SIZE + 0x80)
            if CHERRY_ID in data:
                idx = data.find(CHERRY_ID)
                context = data[max(0,idx-8):idx+24]
                cherry_found.append((va, ptr, idx - 0x80, context))
        except OSError:
            pass

print(f"Found {len(cherry_found)} cherry hits via pointer dereference:")
for src_va, ptr, offset, ctx in cherry_found:
    host_cherry = ptr + offset
    print(f"  Pointer at VA={hex(src_va)} → host={hex(ptr)}")
    print(f"    Cherry at host={hex(host_cherry)} (offset {offset}): {ctx.hex()}")
    print()

if not cherry_found:
    print("No cherry found via pointer dereference.")
    print("Try reading the exact 5-byte pointer at VA 0xaf9a2fdc directly:")
    off = 0x2fdc
    raw = region_raw[off:off+8]
    v5 = int.from_bytes(raw[:5], 'little')
    print(f"  Raw: {raw.hex()} → ptr={hex(v5)}")
    try:
        with open(mem_path, "rb", 0) as f:
            f.seek(v5)
            data = f.read(512)
            print(f"  Content at ptr: {data[:64].hex()}")
    except Exception as e:
        print(f"  Read failed: {e}")
