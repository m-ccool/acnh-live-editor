#!/usr/bin/env python3
"""
Dirty-flag investigation tool.

Captures a window of bytes around the ACNH inventory region from a live
Ryujinx /proc/<pid>/mem and writes it to test-results/.  Run twice with
different --label values, then diff to find addresses that change between
states (e.g. pocket menu CLOSED vs OPEN).

Workflow (run on the deck):
    # 1. With pocket menu CLOSED in-game:
    python3 scripts/steamdeck-adapters/pocket_render_diff.py --label closed

    # 2. Open pocket menu in-game (physical step), then:
    python3 scripts/steamdeck-adapters/pocket_render_diff.py --label open

    # 3. Diff:
    python3 scripts/steamdeck-adapters/pocket_render_diff.py --diff closed open

The diff prints every Switch VA whose byte changed, grouped by 8-byte aligned
runs.  Anything that flips ONLY when the menu opens is a candidate refresh /
dirty flag the in-game UI watches.

Test item suggested by user: "Candy machine (Blue)" written to slot 14 between
the closed and open captures so any item-specific UI buffers also surface.
"""
import argparse
import os
import sys
from pathlib import Path

ADAPTER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ADAPTER_DIR))

import acnh_memory_reader as reader  # noqa: E402

REPO_ROOT = ADAPTER_DIR.parents[1]
OUTPUT_DIR = REPO_ROOT / "test-results" / "pocket-diff"

# Window: cover both inventory pages plus +/- 0x80000 to catch any
# nearby UI mirror buffer.  ACNH 2.0.7 slot1 VA = 0xAFB1E6E0.
# Override with --va / --size at the command line for wider scans.
WINDOW_BASE_VA = 0xAFB00000
WINDOW_SIZE = 0x200000  # 2 MiB default

# Known ACNH 2.0.7 VA regions for address annotation in diff output.
_REGIONS = [
    (0xAFB1E6E0, 0xAFB1E6E0 + 20 * 8,           "pocket-slots-1-20-canonical"),
    (0xAFB1E6E0 - (20 * 8 + 0x18), 0xAFB1E6E0,  "pocket-slots-21-40-canonical"),
    (0xAFB1E6E0 + 0x6A540, 0xAFB1E6E0 + 0x6A540 + 20 * 8, "slot1-mirror-+0x6A540"),
    (0xAFBC6400, 0xAFBC6700,                       "player-save-struct"),
]

def _annotate_va(va: int) -> str:
    """Return a region label if the VA falls in a known range, else ''."""
    for start, end, label in _REGIONS:
        if start <= va < end:
            slot = (va - start) // 8 + 1
            return f" [{label} slot~{slot}]"
    return ""


def _capture(label: str, base_va: int, size: int) -> Path:
    reader._check_ptrace_scope()
    pid = reader._find_ryujinx_pid()
    dram_base = reader._find_dram_base(pid)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"{label}.bin"

    data = reader._read_switch_va(pid, dram_base, base_va, size)
    out_path.write_bytes(data)
    print(f"captured {len(data)} bytes from VA {hex(base_va)} -> {out_path}")
    return out_path


def _diff(label_a: str, label_b: str, base_va: int = WINDOW_BASE_VA) -> None:
    a = (OUTPUT_DIR / f"{label_a}.bin").read_bytes()
    b = (OUTPUT_DIR / f"{label_b}.bin").read_bytes()
    if len(a) != len(b):
        print(f"size mismatch: {label_a}={len(a)} vs {label_b}={len(b)}", file=sys.stderr)
        sys.exit(1)

    diffs = []
    run_start = None
    for i in range(len(a)):
        if a[i] != b[i]:
            if run_start is None:
                run_start = i
        else:
            if run_start is not None:
                diffs.append((run_start, i))
                run_start = None
    if run_start is not None:
        diffs.append((run_start, len(a)))

    print(f"{len(diffs)} differing runs ({label_a} vs {label_b}):")
    for start, end in diffs[:200]:
        va = base_va + start
        size = end - start
        before = a[start:end].hex()
        after = b[start:end].hex()
        label = _annotate_va(va)
        print(f"  VA {hex(va):>12} +{size:<5} | {before} -> {after}{label}")
    if len(diffs) > 200:
        print(f"  ...{len(diffs) - 200} more runs truncated")


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--label", help="capture and save as <label>.bin")
    group.add_argument(
        "--diff",
        nargs=2,
        metavar=("A", "B"),
        help="diff two previously captured labels",
    )
    parser.add_argument(
        "--va",
        default=hex(WINDOW_BASE_VA),
        help=f"start VA for capture (hex, default {hex(WINDOW_BASE_VA)})",
    )
    parser.add_argument(
        "--size",
        default=hex(WINDOW_SIZE),
        help=f"scan size in bytes (hex, default {hex(WINDOW_SIZE)})",
    )
    args = parser.parse_args()
    base_va = int(args.va, 16)
    size = int(args.size, 16)

    if args.label:
        _capture(args.label, base_va, size)
    else:
        _diff(args.diff[0], args.diff[1], base_va)


if __name__ == "__main__":
    main()
