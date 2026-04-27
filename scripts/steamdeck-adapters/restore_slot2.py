#!/usr/bin/env python3
"""Restore canonical+mirror slot 2 to cherry x2."""
import sys
import struct
sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

pid = r._find_ryujinx_pid()
base = r._find_dram_base(pid)
print(f"PID={pid}, DRAM_BASE={hex(base)}")

# cherry x2: item_id=0x08ef, flag0=0, flag1=0, count=2, uses=0
data = struct.pack("<HBBHH", 0x08ef, 0, 0, 2, 0)

# canonical slot 2 = 0xafb1e6e0 + 1*8 = 0xafb1e6e8
r._write_switch_va(pid, base, 0xafb1e6e8, data)
readback = r._read_switch_va(pid, base, 0xafb1e6e8, 8)
print(f"canonical slot2 = {readback.hex()}  (expect ef08000002000000)")

# mirror slot 2 = 0xafb88c20 + 1*8 = 0xafb88c28
r._write_switch_va(pid, base, 0xafb88c28, data)
readback2 = r._read_switch_va(pid, base, 0xafb88c28, 8)
print(f"mirror   slot2 = {readback2.hex()}  (expect ef08000002000000)")

print("Done — slot 2 restored to cherry x2")
