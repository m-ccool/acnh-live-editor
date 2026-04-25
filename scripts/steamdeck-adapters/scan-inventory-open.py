#!/usr/bin/env python3
"""
Scan DRAM while inventory is OPEN to find any UI-only buffer copies.
Finds both exact copies AND copies where only 1-2 slots differ (UI may lag).
Run this WHILE the in-game inventory screen is open.
"""
import importlib.util, json, os, pathlib, sys, struct

ITEM_SIZE = 8
POCKET_PAGE = ITEM_SIZE * 20
POCKET_SLOTS = 20

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
sys.stderr.write(f"PID={pid} dram={hex(dram_base)} slot1_va={hex(slot1_va)}\n")
sys.stderr.write(f"Page bytes: {page_data.hex()}\n")
sys.stderr.flush()

# Extract item IDs from each slot to use as partial match anchor
item_ids = []
for i in range(POCKET_SLOTS):
    off = i * ITEM_SIZE
    item_id = struct.unpack_from('<H', page_data, off)[0]
    item_ids.append(item_id)

# Non-null item IDs for anchored search
non_null = [(i, page_data[i*ITEM_SIZE:(i+1)*ITEM_SIZE]) for i in range(POCKET_SLOTS)
            if item_ids[i] != 0x0000 and item_ids[i] != 0x7FFE]

sys.stderr.write(f"Non-null slots to anchor search: {[(hex(item_ids[s]), hex(s*ITEM_SIZE)) for s,_ in non_null[:5]]}\n")
sys.stderr.flush()

DRAM_SIZE = 0x100000000
CHUNK_SIZE = 0x4000000  # 64 MB

def count_matching_slots(candidate, reference):
    match = 0
    for i in range(POCKET_SLOTS):
        off = i * ITEM_SIZE
        if candidate[off:off+ITEM_SIZE] == reference[off:off+ITEM_SIZE]:
            match += 1
    return match

copies = []  # {switchVA, deltaFromSlot1, matchingSlots, exact}
seen_vas = set()
total_chunks = DRAM_SIZE // CHUNK_SIZE

# Use first non-null item as anchor pattern
if non_null:
    anchor_slot_idx, anchor_bytes = non_null[0]
    anchor_offset_in_page = anchor_slot_idx * ITEM_SIZE
else:
    # Fall back to full page exact scan
    anchor_bytes = page_data
    anchor_offset_in_page = 0

sys.stderr.write(f"Anchor: slot {anchor_slot_idx} bytes {anchor_bytes.hex()} at page+{hex(anchor_offset_in_page)}\n")
sys.stderr.flush()

with open(f"/proc/{pid}/mem", "rb") as f:
    for chunk_idx in range(total_chunks):
        host_addr = dram_base + chunk_idx * CHUNK_SIZE
        try:
            f.seek(host_addr)
            chunk_data = f.read(CHUNK_SIZE)
        except Exception:
            continue

        # Find all occurrences of the anchor bytes in this chunk
        search_from = 0
        while True:
            idx = chunk_data.find(anchor_bytes, search_from)
            if idx == -1:
                break
            # This hit is at anchor_offset_in_page within the candidate page
            page_start_in_chunk = idx - anchor_offset_in_page
            if page_start_in_chunk < 0 or page_start_in_chunk + POCKET_PAGE > len(chunk_data):
                search_from = idx + ITEM_SIZE
                continue
            candidate = chunk_data[page_start_in_chunk:page_start_in_chunk + POCKET_PAGE]
            switch_va = (host_addr + page_start_in_chunk) - dram_base
            if switch_va not in seen_vas:
                seen_vas.add(switch_va)
                matching = count_matching_slots(candidate, page_data)
                if matching >= 10:  # at least half match
                    delta = switch_va - slot1_va
                    copies.append({
                        "switchVA": hex(switch_va),
                        "deltaFromSlot1": hex(delta),
                        "matchingSlots": matching,
                        "exact": candidate == page_data,
                    })
            search_from = idx + ITEM_SIZE

        if chunk_idx % 8 == 0:
            pct = int(chunk_idx / total_chunks * 100)
            sys.stderr.write(f"  {pct}% ({chunk_idx}/{total_chunks} chunks, {len(copies)} candidates so far)\n")
            sys.stderr.flush()

print(json.dumps({"copies": sorted(copies, key=lambda x: int(x["switchVA"], 16))[:40], "total": len(copies)}))
