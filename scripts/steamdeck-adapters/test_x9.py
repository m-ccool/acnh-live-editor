#!/usr/bin/env python3
"""
Test writing to the 0x7f41cc... anonymous heap entries that contain cherry x7.
These are candidates for the pocket UI render objects.
Writes cherry x99 briefly to each, restores after a short pause.
Use screenshot to see which one updates the on-screen display.
"""
import sys, struct, time

sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

# All cherry x7 hosts from scan_x_any in the 0x7f41cc region
CHERRY_X7_HOSTS = [
    0x7f41cc0957bc,
    0x7f41cc0c5594,
    0x7f41cc2897f4,
    0x7f41cc333b80,
    0x7f41cc40b198,
    0x7f41cc4d9a30,
    0x7f41cc52e408,
    0x7f41cc5cf894,
    0x7f41cc687b8c,
    0x7f41cc6a3080,
]

pid = r._find_ryujinx_pid()
print(f"PID={pid}")
mem_path = f"/proc/{pid}/mem"

# Also include the 0x7f3fc8 hit (count=7, same ctx pattern)
CHERRY_X7_HOSTS += [0x7f3fc802d3d4]

TEST_DATA = struct.pack("<HBBHH", 0x08ef, 0, 0, 99, 0)  # cherry x99
ORIG_DATA = struct.pack("<HBBHH", 0x08ef, 0, 0, 7, 0)   # cherry x7

print(f"Testing {len(CHERRY_X7_HOSTS)} addresses...")
print("Writing cherry x99 to each, sleeping 0.5s, restoring x7\n")

for host in CHERRY_X7_HOSTS:
    print(f"Testing host={hex(host)}")
    try:
        with open(mem_path, "r+b") as f:
            # Read original
            f.seek(host)
            orig = f.read(8)
            item_id, f0, f1, count, uses = struct.unpack("<HBBHH", orig)
            print(f"  read: {orig.hex()}  id={hex(item_id)} count={count}")
            
            # Write test value
            f.seek(host)
            f.write(TEST_DATA)
        print(f"  -> wrote cherry x99")
        time.sleep(1.0)
        
        # Restore
        with open(mem_path, "r+b") as f:
            f.seek(host)
            f.write(ORIG_DATA)
        print(f"  -> restored x7\n")
    except OSError as e:
        print(f"  FAILED: {e}\n")
