#!/usr/bin/env python3
"""Scan all readable Ryujinx memory for exact copies of the inventory page."""
import importlib.util, json, os, pathlib, sys

ITEM_SIZE = 8
POCKET_PAGE = ITEM_SIZE * 20

repo = pathlib.Path(os.environ.get("ACNH_REPO_DIR", pathlib.Path(__file__).parent))
module_path = repo / "acnh_memory_reader.py"
if not module_path.exists():
    module_path = pathlib.Path.home() / "acnh-live-editor/scripts/steamdeck-adapters/acnh_memory_reader.py"
spec = importlib.util.spec_from_file_location("acnh_memory_reader", module_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

pid = mod._find_ryujinx_pid()
dram_base = mod._find_dram_base(pid)
inv = mod._get_inventory_offsets()
slot1_va = inv["slot1"]

page_data = mod._read_switch_va(pid, dram_base, slot1_va, POCKET_PAGE)
sys.stderr.write(f"PID={pid} dram={hex(dram_base)} slot1_va={hex(slot1_va)} first8={page_data[:8].hex()}\n")
sys.stderr.flush()

# Scan ONLY the Switch DRAM region (4 GB at dram_base) using 64 MB chunks.
# This is ~64 iterations instead of scanning all host rw regions.
DRAM_SIZE = 0x100000000       # 4 GB
CHUNK_SIZE = 0x4000000        # 64 MB
dram_end_host = dram_base + DRAM_SIZE

copies = []
total_chunks = DRAM_SIZE // CHUNK_SIZE
with open(f"/proc/{pid}/mem", "rb") as f:
    for chunk_idx in range(total_chunks):
        host_addr = dram_base + chunk_idx * CHUNK_SIZE
        try:
            f.seek(host_addr)
            chunk_data = f.read(CHUNK_SIZE)
        except Exception:
            sys.stderr.write(f"  chunk {chunk_idx}: read error\n")
            sys.stderr.flush()
            continue
        # Search for every occurrence of page_data in this chunk
        search_start = 0
        while True:
            idx = chunk_data.find(page_data, search_start)
            if idx == -1:
                break
            # Align to POCKET_PAGE boundary from the start of the chunk
            host_match = host_addr + idx
            switch_va = host_match - dram_base
            delta = host_match - (dram_base + slot1_va)
            copies.append({
                "switchVA": hex(switch_va),
                "deltaFromSlot1": hex(delta),
            })
            search_start = idx + POCKET_PAGE
        if chunk_idx % 8 == 0:
            pct = int(chunk_idx / total_chunks * 100)
            sys.stderr.write(f"  {pct}% ({chunk_idx}/{total_chunks} chunks, {len(copies)} copies so far)\n")
            sys.stderr.flush()

print(json.dumps({"copies": copies[:40], "total": len(copies)}))
