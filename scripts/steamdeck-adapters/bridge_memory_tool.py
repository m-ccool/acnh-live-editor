#!/usr/bin/env python3
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path


COMMAND_ENV_BY_ACTION = {
    "read_inventory": "RYUJINX_LIVE_READ_INVENTORY_CMD",
    "write_inventory_slot": "RYUJINX_LIVE_WRITE_INVENTORY_CMD",
    "read_game_data": "RYUJINX_LIVE_READ_GAME_DATA_CMD",
    "write_game_data": "RYUJINX_LIVE_WRITE_GAME_DATA_CMD",
}

SAVE_SYNC_ENV_BY_ACTION = {
    "write_inventory_slot": "RYUJINX_SAVE_WRITE_INVENTORY_CMD",
}


def resolve_live_command(action: str) -> str:
    env_var = COMMAND_ENV_BY_ACTION[action]
    explicit = os.environ.get(env_var, "").strip()
    if explicit:
        return explicit

    reader_path = Path(__file__).with_name("acnh_memory_reader.py")
    if reader_path.exists() and reader_path.is_file():
        return f"python3 {shlex.quote(str(reader_path))} {action}"

    return ""


def resolve_node_bin() -> str:
    candidates = []

    explicit = os.environ.get("NODE_BIN", "").strip()
    if explicit:
        candidates.append(explicit)

    for value in (
        "/usr/bin/node",
        "/usr/local/bin/node",
    ):
        candidates.append(value)

    nvm_root = Path.home() / ".nvm" / "versions" / "node"
    if nvm_root.exists() and nvm_root.is_dir():
        for candidate in sorted(nvm_root.glob("*/bin/node")):
            candidates.append(str(candidate))

    seen = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        if Path(candidate).exists() and os.access(candidate, os.X_OK):
            return candidate

    return ""


def resolve_save_sync_command(action: str) -> str:
    env_var = SAVE_SYNC_ENV_BY_ACTION.get(action)
    if not env_var:
        return ""

    explicit = os.environ.get(env_var, "").strip()
    if explicit:
        return explicit

    repo_root = Path(__file__).resolve().parents[2]
    if action == "write_inventory_slot":
        script_path = repo_root / "scripts" / "steamdeck-adapters" / "write-inventory-slot.js"
        if script_path.exists() and script_path.is_file():
            node_bin = resolve_node_bin()
            if node_bin:
                return f"{shlex.quote(node_bin)} {shlex.quote(str(script_path))}"

    return ""



def read_stdin_object() -> dict:
    text = sys.stdin.read().strip()
    if not text:
        return {}

    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"stdin must contain valid JSON: {exc}") from exc

    if not isinstance(value, dict):
        raise ValueError("stdin JSON must be an object")

    return value


def run_json_command(command: str, payload: dict, label: str):
    timeout_seconds_raw = os.environ.get("BRIDGE_COMMAND_TIMEOUT_SECONDS", "").strip()
    if timeout_seconds_raw:
        timeout_seconds = max(1, int(timeout_seconds_raw))
    else:
        timeout_ms_raw = os.environ.get("BRIDGE_COMMAND_TIMEOUT_MS", "").strip()
        if timeout_ms_raw:
            timeout_seconds = max(1, int(timeout_ms_raw) // 1000)
        else:
            timeout_seconds = 12

    proc = subprocess.run(
        ["sh", "-lc", command],
        input=json.dumps(payload) + "\n",
        text=True,
        capture_output=True,
        timeout=timeout_seconds,
        check=False,
    )

    stderr_text = (proc.stderr or "").strip()
    if proc.returncode != 0:
        raise ValueError(f"{label} failed with exit {proc.returncode}: {stderr_text or 'no stderr'}")

    output = (proc.stdout or "").strip()
    if not output:
        raise ValueError(f"{label} returned empty output")

    try:
        return json.loads(output)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{label} must output valid JSON: {exc}") from exc


def normalize_slot(entry):
    if not isinstance(entry, dict):
        return None

    try:
        slot = int(entry.get("slot", 0))
    except (TypeError, ValueError):
        return None

    if slot < 1 or slot > 40:
        return None

    return {
        "slot": slot,
        "itemId": normalize_text(entry.get("itemId")) or None,
        "count": clamp_int(entry.get("count"), 0, 0xFFFF),
        "uses": clamp_int(entry.get("uses"), 0, 0xFFFF),
        "flag0": clamp_int(entry.get("flag0"), 0, 0xFF),
        "flag1": clamp_int(entry.get("flag1"), 0, 0xFF),
    }


def normalize_slots(value):
    if isinstance(value, list):
        source = value
    elif isinstance(value, dict) and isinstance(value.get("slots"), list):
        source = value["slots"]
    else:
        source = []

    return [slot for slot in (normalize_slot(entry) for entry in source) if slot]


def normalize_player(value):
    if not isinstance(value, dict):
        return None

    return {
        "name": normalize_text(value.get("name")) or "",
        "town": normalize_text(value.get("town")) or "",
        "wallet": clamp_int(value.get("wallet"), 0, 999999999),
        "bank": clamp_int(value.get("bank"), 0, 999999999),
        "miles": clamp_int(value.get("miles"), 0, 999999999),
        "avatar": normalize_text(value.get("avatar")) or "/assets/items/Bob_NH.png",
    }


def clamp_int(value, minimum, maximum):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return minimum

    return max(minimum, min(maximum, parsed))


def normalize_text(value):
    return str(value or "").strip()


def cmd_read_inventory():
    command = resolve_live_command("read_inventory")
    if not command:
        raise ValueError("No live inventory reader is configured")

    output = run_json_command(command, {"command": "read_inventory"}, "RYUJINX_LIVE_READ_INVENTORY_CMD")
    print(json.dumps({
        "slots": normalize_slots(output),
        "source": normalize_text(output.get("source") if isinstance(output, dict) else "") or "live-memory",
        "backend": normalize_text(output.get("backend") if isinstance(output, dict) else "") or None,
        "lastGameSaveAt": normalize_text(output.get("lastGameSaveAt") if isinstance(output, dict) else "") or None,
        "lastGameDataFilePath": normalize_text(output.get("lastGameDataFilePath") if isinstance(output, dict) else "") or None,
    }))


def cmd_write_inventory_slot():
    command = resolve_live_command("write_inventory_slot")
    if not command:
        raise ValueError("No live inventory writer is configured")

    request = read_stdin_object()
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else request
    slot_payload = normalize_slot(payload)
    if not slot_payload:
        raise ValueError("payload.slot must be an integer from 1 to 40")

    output = run_json_command(
        command,
        {"command": "write_inventory_slot", "payload": slot_payload},
        "RYUJINX_LIVE_WRITE_INVENTORY_CMD",
    )

    save_sync_output = None
    save_sync_command = resolve_save_sync_command("write_inventory_slot")
    if save_sync_command:
        try:
            save_sync_output = run_json_command(
                save_sync_command,
                {"command": "write_inventory_slot", "payload": slot_payload},
                "RYUJINX_SAVE_WRITE_INVENTORY_CMD",
            )
        except ValueError as exc:
            raise ValueError(f"Live inventory write succeeded but save-file persistence failed: {exc}") from exc

    response_slot = None
    if isinstance(output, dict):
        response_slot = normalize_slot(output.get("slot"))

    slots = normalize_slots(output)
    response = {
        "slot": response_slot or slot_payload,
        "source": normalize_text(output.get("source") if isinstance(output, dict) else "") or "live-memory",
        "backend": normalize_text(output.get("backend") if isinstance(output, dict) else "") or None,
    }

    if slots:
        response["slots"] = slots

    if isinstance(save_sync_output, dict):
        response["lastGameSaveAt"] = normalize_text(save_sync_output.get("lastGameSaveAt")) or None
        response["lastGameDataFilePath"] = normalize_text(save_sync_output.get("lastGameDataFilePath")) or None
        response["saveSyncSource"] = normalize_text(save_sync_output.get("source")) or None

    print(json.dumps(response))


def cmd_read_game_data():
    command = resolve_live_command("read_game_data")
    if not command:
        raise ValueError("No live game-data reader is configured")

    output = run_json_command(command, {"command": "read_game_data"}, "RYUJINX_LIVE_READ_GAME_DATA_CMD")
    if not isinstance(output, dict):
        raise ValueError("RYUJINX_LIVE_READ_GAME_DATA_CMD must output a JSON object")

    player = normalize_player(output.get("player"))
    unavailable = output.get("unavailable") is True

    if not player and not unavailable:
        raise ValueError("RYUJINX_LIVE_READ_GAME_DATA_CMD must include a player object or unavailable=true")

    print(json.dumps({
        "player": player,
        "slots": normalize_slots(output),
        "source": normalize_text(output.get("source")) or ("unavailable" if unavailable else "live-memory"),
        "backend": normalize_text(output.get("backend")) or None,
        "unavailable": unavailable,
        "lastGameSaveAt": normalize_text(output.get("lastGameSaveAt")) or None,
        "lastGameDataFilePath": normalize_text(output.get("lastGameDataFilePath")) or None,
    }))


def cmd_write_game_data():
    command = resolve_live_command("write_game_data")
    if not command:
        raise ValueError("No live game-data writer is configured")

    request = read_stdin_object()
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else request
    player_payload = normalize_player(payload.get("player") if isinstance(payload.get("player"), dict) else payload)
    if not player_payload:
        raise ValueError("payload.player must be an object")

    output = run_json_command(
        command,
        {"command": "write_game_data", "payload": {"player": player_payload}},
        "RYUJINX_LIVE_WRITE_GAME_DATA_CMD",
    )

    if not isinstance(output, dict):
        raise ValueError("RYUJINX_LIVE_WRITE_GAME_DATA_CMD must output a JSON object")

    player = normalize_player(output.get("player"))
    if not player:
        raise ValueError("RYUJINX_LIVE_WRITE_GAME_DATA_CMD must include a player object")

    print(json.dumps({
        "player": player,
        "slots": normalize_slots(output),
        "source": normalize_text(output.get("source")) or "live-memory",
        "backend": normalize_text(output.get("backend")) or None,
        "lastGameSaveAt": normalize_text(output.get("lastGameSaveAt")) or None,
        "lastGameDataFilePath": normalize_text(output.get("lastGameDataFilePath")) or None,
    }))


def print_help():
    sys.stdout.write(
        "Usage: bridge_memory_tool.py <command>\n"
        "Commands:\n"
        "  read_inventory\n"
        "  write_inventory_slot\n"
        "  read_game_data\n"
        "  write_game_data\n"
        "\n"
        "Behavior:\n"
        "  Delegates directly to the live ACNH reader.\n"
        "  No fake bridge-memory/file fallback is used in MVP mode.\n"
    )


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print_help()
        return 0

    command = args[0]
    if command == "read_inventory":
        cmd_read_inventory()
        return 0
    if command == "write_inventory_slot":
        cmd_write_inventory_slot()
        return 0
    if command == "read_game_data":
        cmd_read_game_data()
        return 0
    if command == "write_game_data":
        cmd_write_game_data()
        return 0

    raise ValueError(f"unsupported command: {command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        sys.stderr.write(f"bridge_memory_tool failed: {exc}\n")
        raise SystemExit(1)
