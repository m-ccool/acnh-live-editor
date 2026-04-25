#!/usr/bin/env python3
"""
Isolated backend regression check for the live-memory inventory writer.

Runs offline (no Ryujinx, no /proc/<pid>/mem). Monkey-patches the memory I/O
helpers in acnh_memory_reader so we can assert that _write_slot_procmem issues
exactly ONE _write_switch_va call per slot at the canonical pocket VA.

History (do NOT regress):
- 84bdeef -> f0411c6 -> bdba385 introduced page-scanning "duplicate/similar
  page" mirror writes that stomped unrelated memory and broke live render.
- 4a297c2 added a targeted slot+0x6A540 dual-write theorising the in-game
  pocket UI rendered from a slot-1 mirror. Tested live on 2026-04-25 with
  bridge connected; pocket UI did NOT refresh. Dual-write reverted.
- This guard pins the writer to a single canonical write and bans both the
  page-scanning helpers and the slot-1 mirror constant from re-appearing.

Exit code 0 on pass, 1 on failure. Run from the repo root:
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

    # Single canonical write per slot. Pulse and dirty-flag regressions removed.
    _check(
        len(writes) == 1,
        f"slot {slot}: expected exactly 1 canonical write, got {len(writes)} -> "
        f"{[hex(va) for va, _ in writes]}",
    )
    write_va, write_data = writes[0]
    _check(
        write_va == expected_va,
        f"slot {slot}: expected canonical write VA {hex(expected_va)}, got {hex(write_va)}",
    )
    _check(
        len(write_data) == reader._ITEM_SIZE,
        f"slot {slot}: canonical write expected {reader._ITEM_SIZE} bytes, got {len(write_data)}",
    )
    _check(
        result.get("slot") == slot,
        f"slot {slot}: returned slot mismatch -> {result}",
    )

    forbidden_result_attrs = (
        "mirrorWritten",
        "patchedSlot1Mirror",
        "patchedDuplicatePages",
        "patchedSimilarPages",
    )
    for attr in forbidden_result_attrs:
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
        "_SAVE_SLOT1_INVENTORY_DELTA",
    )
    for attr in forbidden_module_attrs:
        _check(
            not hasattr(reader, attr),
            f"acnh_memory_reader must not export removed regression symbol {attr!r}",
        )

    run_case(slot=1, expected_va=SLOT1_VA)
    run_case(slot=2, expected_va=SLOT1_VA + reader._ITEM_SIZE)
    run_case(slot=20, expected_va=SLOT1_VA + 19 * reader._ITEM_SIZE)
    slot21_va = SLOT1_VA - ((20 * reader._ITEM_SIZE) + 0x18)
    run_case(slot=21, expected_va=slot21_va)
    run_case(slot=40, expected_va=slot21_va + 19 * reader._ITEM_SIZE)

    print("PASS: single canonical write per slot; no mirror/scan regressions present")


if __name__ == "__main__":
    main()
