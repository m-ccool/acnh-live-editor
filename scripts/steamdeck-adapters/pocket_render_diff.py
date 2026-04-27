#!/usr/bin/env python3
"""
Two-stage differential scan to find the pocket render copy.

Stage A (run with pocket OPEN):
  - Writes cherry x6 to canonical slot 2
  - Scans all memory for cherry x6
  - Saves hit list to /tmp/stage_a.txt

Stage B (run after close+reopen pocket, canonical still x6):
  - Scans all memory for cherry x6
  - Saves hit list to /tmp/stage_b.txt

Diff: addresses in B but not A = render/display copies populated at pocket-open.

Usage:
  python3 pocket_render_diff.py a   # before close/reopen
  python3 pocket_render_diff.py b   # after close/reopen
  python3 pocket_render_diff.py diff  # print the diff

ORIGINAL CONTENT BELOW (REPLACED):
"""
__REPLACED__ = True
import sys, struct
sys.path.insert(0, "scripts/steamdeck-adapters")
import acnh_memory_reader as r

TARGET_COUNT = 6
SEARCH_BYTES = b'\xef\x08\x00\x00'

def scan_all():
    pid = r._find_ryujinx_pid()
    dram_base = r._find_dram_base(pid)
    regions = r._parse_maps(pid)
    print(f"PID={pid}  DRAM_BASE={hex(dram_base)}  regions={len(regions)}")
    CHUNK = 1024 * 1024
    hits = []
    mem_path = f"/proc/{pid}/mem"
    with open(mem_path, "rb") as f:
        for (start, end, perms, label) in regions:
            size = end - start
            offset = 0
            while offset < size:
                chunk_size = min(CHUNK, size - offset)
                try:
                    f.seek(start + offset)
                    data = f.read(chunk_size)
                except OSError:
                    offset += chunk_size
                    continue
                pos = 0
                while True:
                    idx = data.find(SEARCH_BYTES, pos)
                    if idx == -1:
                        break
                    if idx + 8 <= len(data):
                        item_id, f0, f1, count, uses = struct.unpack_from("<HBBHH", data, idx)
                        if count == TARGET_COUNT:
                            host_addr = start + offset + idx
                            ctx_s = max(0, idx - 16)
                            ctx_e = min(len(data), idx + 32)
                            ctx = data[ctx_s:ctx_e].hex()
                            hits.append((host_addr, label, ctx))
                    pos = idx + 1
                offset += chunk_size
    return hits, dram_base

def write_canonical_x6():
    pid = r._find_ryujinx_pid()
    base = r._find_dram_base(pid)
    data = struct.pack("<HBBHH", 0x08ef, 0, 0, TARGET_COUNT, 0)
    r._write_switch_va(pid, base, 0xafb1e6e8, data)
    readback = r._read_switch_va(pid, base, 0xafb1e6e8, 8)
    print(f"canonical slot2 = {readback.hex()}  (expect ef08000006000000)")

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "a"
    if mode == "a":
        print("=== STAGE A: Writing cherry x6 to canonical, scanning pocket OPEN ===")
        write_canonical_x6()
        hits, dbase = scan_all()
        with open("/tmp/stage_a.txt", "w") as out:
            for h, label, ctx in hits:
                out.write(f"{hex(h)} {label} {ctx}\n")
        print(f"\nStage A: {len(hits)} hits saved to /tmp/stage_a.txt")
        for h, label, ctx in hits:
            print(f"  {hex(h)}  {label}  ctx={ctx}")
        print("\nNow CLOSE the pocket and REOPEN it, then run: python3 pocket_render_diff.py b")
    elif mode == "b":
        print("=== STAGE B: Scanning after close+reopen pocket ===")
        hits, dbase = scan_all()
        with open("/tmp/stage_b.txt", "w") as out:
            for h, label, ctx in hits:
                out.write(f"{hex(h)} {label} {ctx}\n")
        print(f"\nStage B: {len(hits)} hits saved to /tmp/stage_b.txt")
        for h, label, ctx in hits:
            print(f"  {hex(h)}  {label}  ctx={ctx}")
        print("\nNow run: python3 pocket_render_diff.py diff")
    elif mode == "diff":
        print("=== DIFF: Stage B minus Stage A (render copies) ===")
        with open("/tmp/stage_a.txt") as f:
            a_addrs = set(line.split()[0] for line in f)
        with open("/tmp/stage_b.txt") as f:
            b_lines = [line.strip() for line in f if line.strip()]
        print(f"Stage A: {len(a_addrs)} hits  Stage B: {len(b_lines)} hits")
        print("\n--- NEW in B (render copies populated at pocket-open) ---")
        for line in b_lines:
            if line.split()[0] not in a_addrs:
                print(" ", line)
        print("\n--- IN BOTH (live logic copies) ---")
        for line in b_lines:
            if line.split()[0] in a_addrs:
                print(" ", line)

# ORIGINAL FILE CONTENT (pocket_render_diff.py formerly captured DRAM diffs):
__ORIGINAL__ = """
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
