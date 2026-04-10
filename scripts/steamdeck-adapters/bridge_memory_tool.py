#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone


PLAYER_HINT_KEYS = {"name", "town", "wallet", "bank", "miles", "avatar"}


def resolve_inventory_path():
    if os.environ.get("BRIDGE_ENABLE_FILE_FALLBACK", "0") != "1":
        return None

    env_path = os.environ.get("BRIDGE_INVENTORY_FILE")
    if env_path:
        return Path(env_path).expanduser().resolve()
    return None


def resolve_player_path() -> Path:
    env_path = os.environ.get("BRIDGE_PLAYER_FILE")
    if env_path:
        return Path(env_path).expanduser().resolve()

    repo_root = Path(__file__).resolve().parents[2]
    return (repo_root / "data" / "player-state.json").resolve()


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


def run_json_command(command: str, payload: dict, label: str):
    proc = subprocess.run(
        ["sh", "-lc", command],
        input=json.dumps(payload) + "\n",
        text=True,
        capture_output=True,
        timeout=int(os.environ.get("BRIDGE_COMMAND_TIMEOUT_SECONDS", "5")),
        check=False,
    )

    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip()
        raise ValueError(f"{label} failed with exit {proc.returncode}: {stderr or 'no stderr'}")

    output = (proc.stdout or "").strip()
    if not output:
        raise ValueError(f"{label} returned empty output")

    try:
        return json.loads(output)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{label} must output valid JSON: {exc}") from exc


def normalize_player(value):
    if not isinstance(value, dict):
        return None

    def to_int(v, default=0):
        try:
            return int(v)
        except (TypeError, ValueError):
            return default

    name = str(value.get("name") or "").strip()
    town = str(value.get("town") or "").strip()
    avatar = str(value.get("avatar") or "").strip() or "/assets/items/Bob_NH.png"

    return {
        "name": name,
        "town": town,
        "wallet": to_int(value.get("wallet", 0)),
        "bank": to_int(value.get("bank", 0)),
        "miles": to_int(value.get("miles", 0)),
        "avatar": avatar,
    }


def detect_latest_ryujinx_save_file():
    roots = get_save_roots()

    latest_path = None
    latest_mtime = 0.0

    for root in roots:
        if not root.exists() or not root.is_dir():
            continue

        try:
            for candidate in root.rglob("*"):
                if not candidate.is_file():
                    continue
                mtime = candidate.stat().st_mtime
                if mtime > latest_mtime:
                    latest_mtime = mtime
                    latest_path = candidate
        except Exception:
            continue

    if not latest_path:
        return {
            "lastGameDataFilePath": None,
            "lastGameSaveAt": None,
        }

    last_save_at = datetime.fromtimestamp(latest_mtime, tz=timezone.utc).isoformat()
    return {
        "lastGameDataFilePath": str(latest_path),
        "lastGameSaveAt": last_save_at,
    }


def get_save_roots():
    roots = []

    env_roots = os.environ.get("RYUJINX_SAVE_SCAN_ROOTS", "").strip()
    if env_roots:
        roots.extend([Path(p).expanduser() for p in env_roots.split(":") if p.strip()])

    home = Path.home()
    roots.extend([
        home / ".config" / "Ryujinx" / "bis" / "user" / "save",
        home / ".var" / "app" / "org.ryujinx.Ryujinx" / "config" / "Ryujinx" / "bis" / "user" / "save",
        home / "Emulation" / "saves" / "ryujinx",
    ])

    return roots


def find_latest_live_game_json_payload():
    latest = None

    for root in get_save_roots():
        if not root.exists() or not root.is_dir():
            continue

        try:
            for candidate in root.rglob("*.json"):
                if not candidate.is_file():
                    continue

                try:
                    parsed = json.loads(candidate.read_text(encoding="utf-8"))
                except Exception:
                    continue

                player = extract_player_payload(parsed)
                slots = extract_slots_payload(parsed)

                if not player and not slots:
                    continue

                mtime = candidate.stat().st_mtime
                if latest is None or mtime > latest["mtime"]:
                    latest = {
                        "mtime": mtime,
                        "path": candidate,
                        "player": player,
                        "slots": slots,
                    }
        except Exception:
            continue

    if not latest:
        return None

    return {
        "player": latest["player"],
        "slots": latest["slots"],
        "source": "live-save-json",
        "lastGameDataFilePath": str(latest["path"]),
        "lastGameSaveAt": datetime.fromtimestamp(latest["mtime"], tz=timezone.utc).isoformat(),
    }


def extract_player_payload(value):
    if isinstance(value, dict):
        if looks_like_player_dict(value):
            normalized = normalize_player(value)
            if normalized:
                return normalized

        for nested in value.values():
            found = extract_player_payload(nested)
            if found:
                return found
        return None

    if isinstance(value, list):
        for nested in value:
            found = extract_player_payload(nested)
            if found:
                return found

    return None


def looks_like_player_dict(value):
    if not isinstance(value, dict):
        return False

    lowered = {str(key).strip().lower() for key in value.keys()}
    key_hits = lowered & PLAYER_HINT_KEYS
    return ("name" in lowered or "town" in lowered) and len(key_hits) >= 2


def extract_slots_payload(value):
    if isinstance(value, dict):
        raw_slots = value.get("slots")
        if isinstance(raw_slots, list):
            normalized = [slot for slot in (normalize_slot(entry) for entry in raw_slots) if slot]
            if normalized:
                return normalized

        for nested in value.values():
            found = extract_slots_payload(nested)
            if found:
                return found
        return []

    if isinstance(value, list):
        normalized = [slot for slot in (normalize_slot(entry) for entry in value) if slot]
        if normalized:
            return normalized

        for nested in value:
            found = extract_slots_payload(nested)
            if found:
                return found

    return []


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
    if path is None:
        return []

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
    if path is None:
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(slots, indent=2) + "\n", encoding="utf-8")


def cmd_read_inventory(path: Path):
    live_cmd = os.environ.get("RYUJINX_LIVE_READ_INVENTORY_CMD")
    if live_cmd:
        payload = run_json_command(live_cmd, {"command": "read_inventory"}, "RYUJINX_LIVE_READ_INVENTORY_CMD")
        source = payload if isinstance(payload, list) else payload.get("slots")
        if not isinstance(source, list):
            raise ValueError("RYUJINX_LIVE_READ_INVENTORY_CMD output must be list or object with slots")
        slots = [slot for slot in (normalize_slot(entry) for entry in source) if slot]
        print(json.dumps({"slots": slots, "source": "live-memory"}))
        return

    slots = load_slots(path)
    print(json.dumps({"slots": slots, "source": "adapter-memory" if path is None else "bridge-memory-tool"}))


def cmd_write_inventory_slot(path: Path):
    request = parse_stdin_json()
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else request

    slot_payload = normalize_slot(payload)
    if not slot_payload:
        raise ValueError("payload.slot must be a positive integer")

    live_cmd = os.environ.get("RYUJINX_LIVE_WRITE_INVENTORY_CMD")
    if live_cmd:
        result = run_json_command(
            live_cmd,
            {"command": "write_inventory_slot", "payload": slot_payload},
            "RYUJINX_LIVE_WRITE_INVENTORY_CMD",
        )
        if isinstance(result, dict) and isinstance(result.get("slot"), dict):
            normalized_slot = normalize_slot(result.get("slot")) or slot_payload
            response_slots = result.get("slots")
            if isinstance(response_slots, list):
                response_slots = [slot for slot in (normalize_slot(entry) for entry in response_slots) if slot]
            print(json.dumps({"slot": normalized_slot, "slots": response_slots, "source": "live-memory"}))
            return

        print(json.dumps({"slot": slot_payload, "source": "live-memory"}))
        return

    slots = load_slots(path)
    index = next((i for i, entry in enumerate(slots) if entry.get("slot") == slot_payload["slot"]), -1)

    if index >= 0:
        slots[index] = slot_payload
    else:
        slots.append(slot_payload)

    slots.sort(key=lambda x: x.get("slot", 0))
    save_slots(path, slots)
    source = "adapter-memory" if path is None else "bridge-memory-tool"
    print(json.dumps({"slot": slot_payload, "slots": slots, "source": source}))


def cmd_read_game_data(player_path: Path, inventory_path: Path):
    live_cmd = os.environ.get("RYUJINX_LIVE_READ_GAME_DATA_CMD")
    if live_cmd:
        payload = run_json_command(live_cmd, {"command": "read_game_data"}, "RYUJINX_LIVE_READ_GAME_DATA_CMD")
        if not isinstance(payload, dict):
            raise ValueError("RYUJINX_LIVE_READ_GAME_DATA_CMD must output a JSON object")

        player_source = payload.get("player") if isinstance(payload.get("player"), dict) else payload
        player = normalize_player(player_source)
        if not player:
            raise ValueError("RYUJINX_LIVE_READ_GAME_DATA_CMD must include player object fields")

        slots = payload.get("slots")
        if not isinstance(slots, list):
            slots = []
        slots = [slot for slot in (normalize_slot(entry) for entry in slots) if slot]

        response = {
            "player": player,
            "slots": slots,
            "source": payload.get("source") or "live-memory",
            "lastGameSaveAt": payload.get("lastGameSaveAt"),
            "lastGameDataFilePath": payload.get("lastGameDataFilePath"),
        }

        if not response["lastGameDataFilePath"] or not response["lastGameSaveAt"]:
            response.update(detect_latest_ryujinx_save_file())

        print(json.dumps(response))
        return

    live_json_payload = find_latest_live_game_json_payload()
    if live_json_payload and (live_json_payload.get("player") or live_json_payload.get("slots")):
        print(json.dumps(live_json_payload))
        return

    player = None

    if player_path.exists():
        try:
            parsed = json.loads(player_path.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                player = normalize_player(parsed)
        except Exception as exc:
            raise ValueError(f"failed to parse player file: {exc}") from exc

    slots = load_slots(inventory_path)

    has_fallback_data = bool(player) or bool(slots)
    source = "bridge-memory-tool" if has_fallback_data else "unavailable"

    response = {
        "player": player,
        "slots": slots,
        "source": source,
        "unavailable": not has_fallback_data,
    }
    response.update(detect_latest_ryujinx_save_file())
    print(json.dumps(response))


def print_help():
    sys.stdout.write(
        "Usage: bridge_memory_tool.py <command>\n"
        "Commands:\n"
        "  read_inventory      Read slots and output JSON object with slots array\n"
        "  write_inventory_slot Read stdin JSON and write one slot\n"
        "  read_game_data      Read player + inventory payload for UI sync\n"
        "\n"
        "Environment:\n"
        "  BRIDGE_INVENTORY_FILE  Optional path to inventory JSON file\n"
        "  BRIDGE_ENABLE_FILE_FALLBACK Set to 1 and BRIDGE_INVENTORY_FILE to persist fallback slots\n"
        "  BRIDGE_PLAYER_FILE     Optional path to player JSON file\n"
        "  RYUJINX_LIVE_READ_INVENTORY_CMD  Optional live memory read command\n"
        "  RYUJINX_LIVE_WRITE_INVENTORY_CMD Optional live memory write command\n"
        "  RYUJINX_LIVE_READ_GAME_DATA_CMD  Optional live game-data read command\n"
    )


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print_help()
        return 0

    command = args[0]
    inventory_path = resolve_inventory_path()

    if command == "read_inventory":
        cmd_read_inventory(inventory_path)
        return 0

    if command == "write_inventory_slot":
        cmd_write_inventory_slot(inventory_path)
        return 0

    if command == "read_game_data":
        cmd_read_game_data(resolve_player_path(), inventory_path)
        return 0

    raise ValueError(f"unsupported command: {command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        sys.stderr.write(f"bridge_memory_tool failed: {exc}\n")
        raise SystemExit(1)
