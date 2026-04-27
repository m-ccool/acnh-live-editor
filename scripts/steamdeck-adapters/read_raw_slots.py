import sys, struct
sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r
pid = r._find_ryujinx_pid()
base = r._find_dram_base(pid)

ARRAYS = {
    "canonical   ": 0xafb1e6e0,
    "mirror+6A540": 0xafb88c20,
    "fourth 0xbb8": 0xafbb8260,
}
SLOTS_TO_SHOW = [2, 7, 13, 14]

for label, arr_base in ARRAYS.items():
    print("--- %s (base %s) ---" % (label, hex(arr_base)))
    for s in SLOTS_TO_SHOW:
        va = arr_base + (s-1)*8
        try:
            raw = r._read_switch_va(pid, base, va, 8)
            item_id = struct.unpack_from("<H", raw, 0)[0]
            count   = struct.unpack_from("<H", raw, 4)[0]
            uses    = struct.unpack_from("<H", raw, 6)[0]
            print("  slot%02d VA=%s  item=%s cnt=%d uses=%d  raw=%s" % (s, hex(va), hex(item_id), count, uses, raw.hex()))
        except Exception as e:
            print("  slot%02d VA=%s  ERROR: %s" % (s, hex(va), e))
    print()
