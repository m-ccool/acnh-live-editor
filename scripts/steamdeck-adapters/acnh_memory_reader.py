#!/usr/bin/env python3
import json
import os
import socket
import sys
from datetime import datetime, timezone


def send_botbase_command(sock: socket.socket, command: str) -> str:
    wire = (command.strip() + "\r\n").encode("utf-8")
    sock.sendall(wire)

    chunks = []
    while True:
        chunk = sock.recv(4096)
        if not chunk:
            break
        chunks.append(chunk)
        if b"\n" in chunk:
            break

    if not chunks:
        raise RuntimeError(f"No response for command: {command}")

    text = b"".join(chunks).decode("utf-8", errors="replace").strip()
    return text


def parse_hex_payload(text: str) -> bytes:
    value = text.strip()
    if value.lower().startswith("0x"):
        value = value[2:]
    value = "".join(value.split())

    if len(value) % 2 != 0:
        raise ValueError("Expected even-length hex payload")

    try:
        return bytes.fromhex(value)
    except ValueError as exc:
        raise ValueError(f"Invalid hex payload: {text}") from exc


def decode_text_field(raw: bytes, encoding: str) -> str:
    if not raw:
        return ""

    text = raw.decode(encoding, errors="ignore")
    text = text.replace("\x00", "").strip()
    return text


def decode_int_field(raw: bytes) -> int:
    if not raw:
        return 0

    if len(raw) not in (1, 2, 4, 8):
        raise ValueError(f"Unsupported integer byte-size: {len(raw)}")

    return int.from_bytes(raw, byteorder="little", signed=False)


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def read_game_data(sock: socket.socket):
    # These botbase command strings must be provided by the user/tooling for the current game version.
    name_cmd = require_env("ACNH_PLAYER_NAME_CMD")
    town_cmd = require_env("ACNH_PLAYER_TOWN_CMD")
    wallet_cmd = require_env("ACNH_PLAYER_WALLET_CMD")
    bank_cmd = require_env("ACNH_PLAYER_BANK_CMD")
    miles_cmd = require_env("ACNH_PLAYER_MILES_CMD")

    name_encoding = os.environ.get("ACNH_PLAYER_NAME_ENCODING", "utf-16le")
    town_encoding = os.environ.get("ACNH_PLAYER_TOWN_ENCODING", "utf-16le")

    name_raw = parse_hex_payload(send_botbase_command(sock, name_cmd))
    town_raw = parse_hex_payload(send_botbase_command(sock, town_cmd))
    wallet_raw = parse_hex_payload(send_botbase_command(sock, wallet_cmd))
    bank_raw = parse_hex_payload(send_botbase_command(sock, bank_cmd))
    miles_raw = parse_hex_payload(send_botbase_command(sock, miles_cmd))

    payload = {
        "player": {
            "name": decode_text_field(name_raw, name_encoding),
            "town": decode_text_field(town_raw, town_encoding),
            "wallet": decode_int_field(wallet_raw),
            "bank": decode_int_field(bank_raw),
            "miles": decode_int_field(miles_raw),
            "avatar": os.environ.get("ACNH_PLAYER_AVATAR", "/assets/items/Bob_NH.png"),
        },
        "slots": [],
        "source": "live-botbase",
        "lastGameSaveAt": datetime.now(timezone.utc).isoformat(),
        "lastGameDataFilePath": None,
    }

    print(json.dumps(payload))


def read_inventory(sock: socket.socket):
    # Optional support can be added by providing a command that outputs JSON directly.
    custom_cmd = os.environ.get("ACNH_INVENTORY_JSON_CMD", "").strip()
    if not custom_cmd:
        print(json.dumps({"slots": [], "source": "live-botbase"}))
        return

    text = send_botbase_command(sock, custom_cmd)
    parsed = json.loads(text)
    slots = parsed if isinstance(parsed, list) else parsed.get("slots", [])
    print(json.dumps({"slots": slots, "source": "live-botbase"}))


def write_inventory_slot(_sock: socket.socket):
    # Bridge write path requires game/version-specific offsets; keep explicit for now.
    request = json.loads(sys.stdin.read().strip() or "{}")
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else request
    print(json.dumps({"slot": payload, "source": "live-botbase"}))


def main():
    if len(sys.argv) < 2:
        raise RuntimeError("Usage: acnh_memory_reader.py <read_game_data|read_inventory|write_inventory_slot>")

    command = sys.argv[1].strip()
    host = os.environ.get("ACNH_BOTBASE_HOST", "127.0.0.1")
    timeout_seconds = float(os.environ.get("ACNH_BOTBASE_TIMEOUT_SECONDS", "2.0"))
    ports_text = os.environ.get("ACNH_BOTBASE_PORTS", "").strip()
    if ports_text:
        ports = [int(part.strip()) for part in ports_text.split(",") if part.strip()]
    else:
        ports = [int(os.environ.get("ACNH_BOTBASE_PORT", "6000")), 6001]

    # Preserve order while removing duplicates.
    seen = set()
    ports = [port for port in ports if not (port in seen or seen.add(port))]

    sock = None
    last_error = None
    connected_endpoint = None

    for port in ports:
        candidate = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        candidate.settimeout(timeout_seconds)
        try:
            candidate.connect((host, port))
            sock = candidate
            connected_endpoint = f"{host}:{port}"
            break
        except Exception as exc:
            last_error = exc
            try:
                candidate.close()
            except Exception:
                pass

    if sock is None:
        attempted = ", ".join([f"{host}:{port}" for port in ports])
        raise RuntimeError(
            f"Unable to connect to botbase endpoint(s): {attempted}. "
            f"Last error: {last_error}. Ensure sys-botbase is running and the game exposes botbase."
        )

    try:

        if command == "read_game_data":
            read_game_data(sock)
            return 0

        if command == "read_inventory":
            read_inventory(sock)
            return 0

        if command == "write_inventory_slot":
            write_inventory_slot(sock)
            return 0

        raise RuntimeError(f"Unsupported command: {command}")
    finally:
        try:
            if sock:
                sock.close()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        sys.stderr.write(f"acnh_memory_reader failed: {exc}\n")
        raise SystemExit(1)
