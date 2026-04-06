#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path


def resolve_inventory_path() -> Path:
    env_path = os.environ.get("BRIDGE_INVENTORY_FILE")
    if env_path:
        return Path(env_path).expanduser().resolve()

    # Keep default inventory storage stable regardless of the shell's cwd.
    repo_root = Path(__file__).resolve().parents[2]
    return (repo_root / "data" / "steamdeck-inventory.json").resolve()


def parse_stdin_json() -> dict:
    text = sys.stdin.read().strip()
    if not text:
        return {}

    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"stdin must contain valid JSON: {exc}") from exc

    if isinstance(value, dict):
        return value

    raise ValueError("stdin JSON must be an object")


def normalize_slot(entry):
    if not isinstance(entry, dict):
        return None

    try:
        slot = int(entry.get("slot", 0))
    except (TypeError, ValueError):
        return None

    if slot < 1:
        return None

    def to_int(value, default=0):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    item_id = entry.get("itemId")
    item_id = str(item_id) if item_id is not None and str(item_id) != "" else None

    return {
        "slot": slot,
        "itemId": item_id,
        "count": to_int(entry.get("count", 0)),
        "uses": to_int(entry.get("uses", 0)),
        "flag0": to_int(entry.get("flag0", 0)),
        "flag1": to_int(entry.get("flag1", 0)),
    }


def load_slots(path: Path):
    if not path.exists():
        return []

    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"failed to parse inventory file: {exc}") from exc

    if isinstance(parsed, list):
        source = parsed
    elif isinstance(parsed, dict) and isinstance(parsed.get("slots"), list):
        source = parsed["slots"]
    else:
        source = []

    return [slot for slot in (normalize_slot(entry) for entry in source) if slot]


def save_slots(path: Path, slots):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(slots, indent=2) + "\n", encoding="utf-8")


def cmd_read_inventory(path: Path):
    slots = load_slots(path)
    print(json.dumps({"slots": slots}))


def cmd_write_inventory_slot(path: Path):
    request = parse_stdin_json()
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else request

    slot_payload = normalize_slot(payload)
    if not slot_payload:
        raise ValueError("payload.slot must be a positive integer")

    slots = load_slots(path)
    index = next((i for i, entry in enumerate(slots) if entry.get("slot") == slot_payload["slot"]), -1)

    if index >= 0:
        slots[index] = slot_payload
    else:
        slots.append(slot_payload)

    slots.sort(key=lambda x: x.get("slot", 0))
    save_slots(path, slots)
    print(json.dumps({"slot": slot_payload, "slots": slots}))


def print_help():
    sys.stdout.write(
        "Usage: bridge_memory_tool.py <command>\n"
        "Commands:\n"
        "  read_inventory      Read slots and output JSON object with slots array\n"
        "  write_inventory_slot Read stdin JSON and write one slot\n"
        "\n"
        "Environment:\n"
        "  BRIDGE_INVENTORY_FILE  Optional path to inventory JSON file\n"
    )


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print_help()
        return 0

    command = args[0]
    path = resolve_inventory_path()

    if command == "read_inventory":
        cmd_read_inventory(path)
        return 0

    if command == "write_inventory_slot":
        cmd_write_inventory_slot(path)
        return 0

    raise ValueError(f"unsupported command: {command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        sys.stderr.write(f"bridge_memory_tool failed: {exc}\n")
        raise SystemExit(1)
