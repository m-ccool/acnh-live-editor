"""Find doublemapper regions and inventory UI buffer offset in Ryujinx."""
import re, glob, struct, sys, json

def find_ryujinx_pid():
    for d in glob.glob("/proc/[0-9]*"):
        try:
            cmd = open(d+"/cmdline","rb").read().decode("utf-8","ignore")
            if "ryujinx" in cmd.lower():
                return int(d.split("/")[-1])
        except:
            pass
    raise RuntimeError("Ryujinx not found")

def get_all_rw_regions(pid):
    regions = []
    for line in open(f"/proc/{pid}/maps"):
        m = re.match(r"([0-9a-f]+)-([0-9a-f]+) (rw\S*)", line)
        if not m:
            continue
        a, b = int(m.group(1),16), int(m.group(2),16)
        regions.append((a, b, b-a, line.strip()))
    return regions

pid = find_ryujinx_pid()
regions = get_all_rw_regions(pid)
large = [(a,b,sz,info) for a,b,sz,info in regions if sz >= 0x10000000]

print(f"PID: {pid}")
print(f"Large rw regions (>= 256MB): {len(large)}")
for a,b,sz,info in large:
    print(f"  {hex(a)}-{hex(b)}  size={hex(sz)}  {info[info.rfind(' ')+1:]}")

# DRAM is the largest; doublemapper mirror is likely the 2nd largest or at fixed offset
if len(large) >= 2:
    large_sorted = sorted(large, key=lambda x: x[2], reverse=True)
    primary_base = large_sorted[0][0]
    mirror_base = large_sorted[1][0]
    delta = mirror_base - primary_base
    print(f"\nLargest region base:  {hex(primary_base)}")
    print(f"2nd largest region:   {hex(mirror_base)}")
    print(f"Delta (mirror-primary): {hex(delta)}")

    # Verify by reading slot1 from both regions
    slot1_va = 0xAFB1E6E0
    POCKET = 20 * 8

    try:
        with open(f"/proc/{pid}/mem", "rb") as f:
            f.seek(primary_base + slot1_va)
            data_primary = f.read(16)
        print(f"\nSlot1 @ primary+VA:  {data_primary.hex()}")
    except Exception as e:
        print(f"Primary read error: {e}")

    try:
        with open(f"/proc/{pid}/mem", "rb") as f:
            f.seek(mirror_base + slot1_va)
            data_mirror = f.read(16)
        print(f"Slot1 @ mirror+VA:   {data_mirror.hex()}")
    except Exception as e:
        print(f"Mirror read error: {e}")
