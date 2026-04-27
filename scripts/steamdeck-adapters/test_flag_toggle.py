#!/usr/bin/env python3
"""
Test: write cherry x5 to BOTH canonical AND mirror slot13,
restore slot14 to golden axe x1, then toggle the inventory flag.
If display updates slot13 to x5, we've found the re-snapshot trigger.
"""
import sys, struct, time
sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

pid  = r._find_ryujinx_pid()
base = r._find_dram_base(pid)

CANON_BASE  = 0xafb1e6e0
MIRROR_BASE = 0xafb88c20
FLAG_VA     = 0xafb1e784
FLAG_VA2    = 0xafb88cc4

# Slot VAs
CANON_SLOT13  = CANON_BASE  + 12*8   # 0xafb1e740
MIRROR_SLOT13 = MIRROR_BASE + 12*8   # 0xafb88c80
CANON_SLOT14  = CANON_BASE  + 13*8   # 0xafb1e748
MIRROR_SLOT14 = MIRROR_BASE + 13*8   # 0xafb88c88

print("PID=%d  DRAM_BASE=%s" % (pid, hex(base)))
print()

# --- Print current state ---
for label, va in [("canon_slot13", CANON_SLOT13), ("mirror_slot13", MIRROR_SLOT13),
                  ("canon_slot14", CANON_SLOT14), ("mirror_slot14", MIRROR_SLOT14)]:
    raw = r._read_switch_va(pid, base, va, 8)
    print("BEFORE %s VA=%s  %s" % (label, hex(va), raw.hex()))

# --- Restore slot14: golden axe x1 to BOTH arrays ---
axe_x1 = struct.pack("<HBBHH", 0x2591, 0, 0, 1, 0)
r._write_switch_va(pid, base, CANON_SLOT14, axe_x1)
r._write_switch_va(pid, base, MIRROR_SLOT14, axe_x1)
print("\nRestored slot14 to golden_axe x1 in both canonical and mirror")

# --- Write cherry x5 to BOTH slot13 arrays ---
cherry_x5 = struct.pack("<HBBHH", 0x08ef, 0, 0, 5, 0)
r._write_switch_va(pid, base, CANON_SLOT13, cherry_x5)
r._write_switch_va(pid, base, MIRROR_SLOT13, cherry_x5)
print("Wrote cherry x5 to canonical slot13 (%s)" % hex(CANON_SLOT13))
print("Wrote cherry x5 to mirror slot13   (%s)" % hex(MIRROR_SLOT13))

time.sleep(0.05)

# --- Toggle flag: ff (close) then 01 (open) on both canonical and mirror ---
print("\nToggling canonical flag %s: ff -> 01" % hex(FLAG_VA))
r._write_switch_va(pid, base, FLAG_VA, bytes([0xff]))
time.sleep(0.016)
r._write_switch_va(pid, base, FLAG_VA, bytes([0x01]))

print("Toggling mirror flag   %s: ff -> 01" % hex(FLAG_VA2))
r._write_switch_va(pid, base, FLAG_VA2, bytes([0xff]))
time.sleep(0.016)
r._write_switch_va(pid, base, FLAG_VA2, bytes([0x01]))

time.sleep(0.1)

# --- Verify all writes held ---
print()
for label, va in [("canon_slot13", CANON_SLOT13), ("mirror_slot13", MIRROR_SLOT13),
                  ("canon_slot14", CANON_SLOT14), ("mirror_slot14", MIRROR_SLOT14)]:
    raw = r._read_switch_va(pid, base, va, 8)
    print("AFTER  %s VA=%s  %s" % (label, hex(va), raw.hex()))

print()
print("If display shows cherry x5 at slot13 -> flag toggle refreshes from canon+mirror.")
print("If display stays at x2 -> display reads from a separate frozen snapshot buffer.")
