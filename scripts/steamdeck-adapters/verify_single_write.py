#!/usr/bin/env python3
"""
Isolated backend regression check for the live-memory inventory writer.

Runs offline (no Ryujinx, no /proc/<pid>/mem). Monkey-patches the memory I/O
helpers in acnh_memory_reader so we can assert that _write_slot_procmem issues
exactly ONE _write_switch_va call to the canonical pocket slot VA.

Why: prior commits 84bdeef -> f0411c6 -> bdba385 layered duplicate-page,
similar-page, and +0x6A540 "save slot 1 mirror" writes on top of the canonical
write. Those mirror writes stomped unrelated memory and broke the live in-game
pocket render until the player closed and reopened the menu. This script is
the regression guard so that path stays single-write.

Exit code 0 on pass, 1 on failure. Designed to run from the repo root:
    python3 scripts/steamdeck-adapters/verify_single_write.py
"""
import sys
from pathlib import Path

ADAPTER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ADAPTER_DIR))

import acnh_memory_reader as reader  # noqa: E402


FAKE_PID = 999999
FAKE_DRAM_BASE = 0x1000_0000_0000
SLOT1_VA = 0xAFB1E6E0  # canonical ACNH 2.0.7 pocket slot 1


def _check(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}", file=sys.stderr)
        sys.exit(1)


def _patch_io(writes: list, reads: list):
    def fake_read(pid, dram_base, switch_va, size):
        reads.append((switch_va, size))
        # Return a deterministic 8-byte slot blob (item id 0xFFFE = empty).
        return b"\xFE\xFF\x00\x00\x00\x00\x00\x00"

    def fake_write(pid, dram_base, switch_va, data):
        writes.append((switch_va, bytes(data)))

    reader._read_switch_va = fake_read
    reader._write_switch_va = fake_write


def run_case(slot: int, expected_va: int) -> None:
    writes: list = []
    reads: list = []
    _patch_io(writes, reads)

    payload = {
        "slot": slot,
        "itemId": "Apple",
        "count": 1,
        "uses": 0,
        "flag0": 0,
        "flag1": 0,
    }

    result = reader._write_slot_procmem(FAKE_PID, FAKE_DRAM_BASE, payload)

    _check(
        len(writes) == 1,
        f"slot {slot}: expected exactly 1 write, got {len(writes)} -> "
        f"{[hex(va) for va, _ in writes]}",
    )
    write_va, write_data = writes[0]
    _check(
        write_va == expected_va,
        f"slot {slot}: expected write VA {hex(expected_va)}, got {hex(write_va)}",
    )
    _check(
        len(write_data) == reader._ITEM_SIZE,
        f"slot {slot}: expected {reader._ITEM_SIZE}-byte write, got {len(write_data)}",
    )
    _check(
        result.get("slot") == slot,
        f"slot {slot}: returned slot mismatch -> {result}",
    )

    forbidden_attrs = (
        "patchedSlot1Mirror",
        "patchedDuplicatePages",
        "patchedSimilarPages",
    )
    for attr in forbidden_attrs:
        _check(
            attr not in result,
            f"slot {slot}: result must not contain regression attribute {attr!r}",
        )


def main() -> None:
    forbidden_module_attrs = (
        "_SAVE_SLOT1_INVENTORY_DELTA",
        "_iter_duplicate_page_matches",
        "_iter_similar_page_matches",
        "_pocket_page_switch_va",
        "_count_matching_slots",
        "_POCKET_MIRROR_SEARCH_RADIUS",
        "_POCKET_MIRROR_MIN_MATCHING_SLOTS",
    )
    for attr in forbidden_module_attrs:
        _check(
            not hasattr(reader, attr),
            f"acnh_memory_reader must not export regression symbol {attr!r}",
        )

    run_case(slot=1, expected_va=SLOT1_VA)
    run_case(slot=2, expected_va=SLOT1_VA + reader._ITEM_SIZE)
    run_case(slot=20, expected_va=SLOT1_VA + 19 * reader._ITEM_SIZE)
    # Slot 21 lives on the slot21 page anchor.
    slot21_va = SLOT1_VA - ((20 * reader._ITEM_SIZE) + 0x18)
    run_case(slot=21, expected_va=slot21_va)
    run_case(slot=40, expected_va=slot21_va + 19 * reader._ITEM_SIZE)

    print("verify_single_write: PASS (single canonical write per slot)")


if __name__ == "__main__":
    main()
