#!/usr/bin/env python3
"""
Isolated backend regression check for the live-memory inventory writer.

Runs offline (no Ryujinx, no /proc/<pid>/mem). Monkey-patches the memory I/O
helpers in acnh_memory_reader so we can assert that _write_slot_procmem issues
exactly TWO _write_switch_va calls per slot:
  1. canonical slot VA (game-engine copy / slot-0)
  2. slot VA + _SAVE_SLOT1_INVENTORY_DELTA (in-game UI display copy / slot-1)

Both writes are required for the in-game pocket UI to refresh live.  This guard
also verifies that the forbidden page-scanning helpers (duplicate page, similar
page) are not re-introduced: those helpers stomped unrelated memory in commits
84bdeef -> f0411c6 -> bdba385 and broke the live render.

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
        len(writes) == 2,
        f"slot {slot}: expected exactly 2 writes (canonical + mirror), got {len(writes)} -> "
        f"{[hex(va) for va, _ in writes]}",
    )
    write_va, write_data = writes[0]
    _check(
        write_va == expected_va,
        f"slot {slot}: expected canonical write VA {hex(expected_va)}, got {hex(write_va)}",
    )
    mirror_va, mirror_data = writes[1]
    expected_mirror_va = expected_va + reader._SAVE_SLOT1_INVENTORY_DELTA
    _check(
        mirror_va == expected_mirror_va,
        f"slot {slot}: expected mirror write VA {hex(expected_mirror_va)}, got {hex(mirror_va)}",
    )
    _check(
        len(write_data) == reader._ITEM_SIZE,
        f"slot {slot}: canonical write expected {reader._ITEM_SIZE} bytes, got {len(write_data)}",
    )
    _check(
        write_data == mirror_data,
        f"slot {slot}: canonical and mirror write data must be identical",
    )
    _check(
        result.get("slot") == slot,
        f"slot {slot}: returned slot mismatch -> {result}",
    )
    _check(
        result.get("mirrorWritten") is True,
        f"slot {slot}: result must contain mirrorWritten=True -> {result}",
    )

    forbidden_attrs = (
        "patchedSlot1Mirror",
        "patchedDuplicatePages",
        "patchedSimilarPages",
    )
    for attr in forbidden_attrs:
        _check(
            attr not in result,
            f"slot {slot}: result must not contain removed regression attribute {attr!r}",
        )


def main() -> None:
    forbidden_module_attrs = (
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
            f"acnh_memory_reader must not export scanning regression symbol {attr!r}",
        )

    # Verify the targeted delta constant is present.
    _check(
        hasattr(reader, "_SAVE_SLOT1_INVENTORY_DELTA"),
        "acnh_memory_reader must export _SAVE_SLOT1_INVENTORY_DELTA",
    )

    run_case(slot=1, expected_va=SLOT1_VA)
    run_case(slot=2, expected_va=SLOT1_VA + reader._ITEM_SIZE)
    run_case(slot=20, expected_va=SLOT1_VA + 19 * reader._ITEM_SIZE)
    # Slot 21 lives on the slot21 page anchor.
    slot21_va = SLOT1_VA - ((20 * reader._ITEM_SIZE) + 0x18)
    run_case(slot=21, expected_va=slot21_va)
    run_case(slot=40, expected_va=slot21_va + 19 * reader._ITEM_SIZE)

    print("verify_single_write: PASS (canonical + slot-1 mirror dual write per slot)")


if __name__ == "__main__":
    main()

