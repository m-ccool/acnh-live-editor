#!/usr/bin/env python3
import sys
from pathlib import Path

ADAPTER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ADAPTER_DIR))

import acnh_memory_reader as reader


def verify_slot(slot, expected_va):
    writes = []

    def fake_read(pid, dram_base, switch_va, size):
        return b"\xFE\xFF\x00\x00\x00\x00\x00\x00"

    def fake_write(pid, dram_base, switch_va, data):
        writes.append((switch_va, bytes(data)))

    reader._read_switch_va = fake_read
    reader._write_switch_va = fake_write
    reader._write_slot_procmem(1, 0, {
        "slot": slot,
        "itemId": "Apple",
        "count": 0,
        "uses": 0,
        "flag0": 0,
        "flag1": 0,
    })

    if writes != [(expected_va, writes[0][1])] or len(writes[0][1]) != reader._ITEM_SIZE:
        raise AssertionError(f"slot {slot}: expected one canonical 8-byte write, got {writes}")


def main():
    forbidden = (
        "_SAVE_SLOT1_INVENTORY_DELTA",
        "_iter_duplicate_page_matches",
        "_iter_similar_page_matches",
    )
    for name in forbidden:
        if hasattr(reader, name):
            raise AssertionError(f"forbidden mirror-write symbol returned: {name}")

    slot1 = 0xAFB1E6E0
    slot21 = slot1 - ((20 * reader._ITEM_SIZE) + 0x18)
    for slot, expected_va in ((1, slot1), (20, slot1 + 19 * 8), (21, slot21), (40, slot21 + 19 * 8)):
        verify_slot(slot, expected_va)

    print("verify_single_write: PASS")


if __name__ == "__main__":
    main()