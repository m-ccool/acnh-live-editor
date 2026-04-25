import importlib.util, pathlib, json
path = pathlib.Path('scripts/steamdeck-adapters/acnh_memory_reader.py')
spec = importlib.util.spec_from_file_location('acnh_memory_reader', path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
pid = mod._find_ryujinx_pid()
db = mod._find_dram_base(pid)
offsets = mod._get_inventory_offsets()
payload = {'slot': 3, 'itemId': 'golden shovel', 'count': 0, 'uses': 9, 'flag0': 0, 'flag1': 0}
result = mod._write_slot_procmem(pid, db, payload)
print(json.dumps(result))
