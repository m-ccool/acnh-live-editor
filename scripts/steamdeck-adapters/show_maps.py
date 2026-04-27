#!/usr/bin/env python3
"""Show all large rw mappings for Ryujinx to find the full Switch VA space allocation."""
import sys
sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

pid = r._find_ryujinx_pid()
print(f"PID={pid}")
print()
print("All rw regions >= 256MB:")
print(f"{'start':18s}  {'end':18s}  {'size':12s}  label")
for start, end, perms, label in r._parse_maps(pid):
    size = end - start
    if size >= 0x10000000:   # >= 256MB
        print(f"  {hex(start):16s}  {hex(end):16s}  {hex(size):10s}  {label}")

# Also: find the region containing Switch VA 0x213e000000 offset
print()
print("Looking for region that would contain switch VA 0x213e000000...")
target_offset = 0x213e000000
for start, end, perms, label in r._parse_maps(pid):
    size = end - start
    if size > target_offset:   # large enough to contain the offset
        print(f"  Candidate: {hex(start)}-{hex(end)} size={hex(size)} label={label}")
        print(f"    Host addr for switch VA 0x213e000000: {hex(start + target_offset)}")
