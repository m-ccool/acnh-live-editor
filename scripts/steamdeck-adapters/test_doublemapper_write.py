#!/usr/bin/env python3
"""
Test whether a doublemapper region address is writable via /proc/pid/mem.
Usage: python3 test_doublemapper_write.py <host_addr_hex>
Pass a host address returned by scan_dram_cherry.py from a non-DRAM region.
"""
import sys
import os
import struct

sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

if len(sys.argv) < 2:
    print("Usage: python3 test_doublemapper_write.py <host_addr_hex>")
    sys.exit(1)

host_addr = int(sys.argv[1], 16)
pid = r._find_ryujinx_pid()
print(f"PID={pid}, host_addr={hex(host_addr)}")

mem_path = f"/proc/{pid}/mem"

# Step 1: read current 8 bytes
try:
    with open(mem_path, "rb") as f:
        f.seek(host_addr)
        orig = f.read(8)
    print(f"Read OK: {orig.hex()}")
    orig_id, orig_f0, orig_f1, orig_count, orig_uses = struct.unpack("<HBBHH", orig)
    print(f"  item_id={hex(orig_id)} flag0={orig_f0} flag1={orig_f1} count={orig_count} uses={orig_uses}")
except Exception as e:
    print(f"Read FAILED: {e}")
    sys.exit(1)

# Step 2: try writing a marker (same item, count+100)
test_data = struct.pack("<HBBHH", orig_id, orig_f0, orig_f1, min(orig_count + 100, 9999), orig_uses)
print(f"\nWriting test data (count+100): {test_data.hex()}")
try:
    with open(mem_path, "r+b") as f:
        f.seek(host_addr)
        f.write(test_data)
    print("Write OK (no exception)")
except OSError as e:
    print(f"Write FAILED: {e}")
    print("Region is READ-ONLY or protected.")
    sys.exit(1)

# Step 3: readback to confirm write took
import time; time.sleep(0.05)
try:
    with open(mem_path, "rb") as f:
        f.seek(host_addr)
        readback = f.read(8)
    print(f"Readback: {readback.hex()}")
    if readback == test_data:
        print("CONFIRMED WRITABLE: readback matches test data")
    else:
        print(f"Readback mismatch — wrote {test_data.hex()}, got {readback.hex()}")
except Exception as e:
    print(f"Readback failed: {e}")

# Step 4: restore original
print(f"\nRestoring original: {orig.hex()}")
try:
    with open(mem_path, "r+b") as f:
        f.seek(host_addr)
        f.write(orig)
    print("Restored OK")
except Exception as e:
    print(f"Restore FAILED: {e}")
