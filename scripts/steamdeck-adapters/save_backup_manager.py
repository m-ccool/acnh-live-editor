#!/usr/bin/env python3
"""
ACNH Save Backup Manager
Handles create/list/restore/delete of save file backups.

Commands:
  list_backups
  create_backup [--label "My label"]
  restore_backup --id <backup_id>
  delete_backup  --id <backup_id>
  update_label   --id <backup_id> --label "New label"

Save directories backed up:
    ~/.config/Ryujinx/bis/user/save/0000000000000003  (both slots)

Backups are stored in ~/acnh-live-editor/data/save-backups/<id>/
Each backup contains:
    slot3_0/  slot3_1/  manifest.json
"""
import argparse
import datetime
import json
import os
import shutil
import sys
import uuid

SAVE_ROOT = os.path.expanduser("~/.config/Ryujinx/bis/user/save")
ACTIVE_SAVE_ID = "0000000000000003"
ACTIVE_SAVE_DIR = os.path.join(SAVE_ROOT, ACTIVE_SAVE_ID)
BACKUP_ROOT = os.path.expanduser("~/acnh-live-editor/data/save-backups")

SLOT_MAP = {
    "slot3_0": (ACTIVE_SAVE_DIR, "0"),
    "slot3_1": (ACTIVE_SAVE_DIR, "1"),
}

REQUIRED_SLOT_FILES = ("main.dat", "mainHeader.dat")


def _slot_path(save_dir, slot):
    """Return path to a slot subdirectory, handling nested 0/ layout."""
    base = os.path.join(save_dir, slot)
    nested = os.path.join(base, "0")
    if os.path.isdir(nested):
        return nested
    return base


def _require_game_closed():
    proc_root = "/proc"
    if not os.path.isdir(proc_root):
        return

    for entry in os.scandir(proc_root):
        if not entry.name.isdigit():
            continue
        try:
            with open(os.path.join(entry.path, "comm"), "r", encoding="utf-8") as f:
                if f.read().strip().lower() == "ryujinx":
                    raise RuntimeError("Ryujinx must be closed before managing save backups")
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue


def _validate_slot(path, label):
    if not os.path.isdir(path):
        raise RuntimeError(f"{label} is missing")
    missing = [name for name in REQUIRED_SLOT_FILES if not os.path.isfile(os.path.join(path, name))]
    if missing:
        raise RuntimeError(f"{label} is incomplete: missing {', '.join(missing)}")


def _directory_size(path):
    return sum(
        os.path.getsize(os.path.join(root, filename))
        for root, _, filenames in os.walk(path)
        for filename in filenames
    )


def _backup_dir(backup_id):
    return os.path.join(BACKUP_ROOT, backup_id)


def _manifest_path(backup_id):
    return os.path.join(_backup_dir(backup_id), "manifest.json")


def _read_manifest(backup_id):
    path = _manifest_path(backup_id)
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def cmd_list_backups():
    os.makedirs(BACKUP_ROOT, exist_ok=True)
    backups = []
    for entry in sorted(os.scandir(BACKUP_ROOT), key=lambda e: e.name):
        if not entry.is_dir():
            continue
        manifest = _read_manifest(entry.name)
        if manifest is None:
            continue
        backups.append({
            "id": entry.name,
            "label": manifest.get("label", ""),
            "createdAt": manifest.get("createdAt", ""),
            "saveDateHint": manifest.get("saveDateHint", ""),
            "sizeBytes": manifest.get("sizeBytes", 0),
            "saveId": manifest.get("saveId", ""),
        })
    print(json.dumps({"ok": True, "backups": backups}))


def cmd_create_backup(label=""):
    _require_game_closed()
    os.makedirs(BACKUP_ROOT, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    backup_id = now.strftime("%Y%m%dT%H%M%SZ") + "_" + uuid.uuid4().hex[:6]
    backup_dir = _backup_dir(backup_id)
    staging_dir = backup_dir + ".staging"
    os.makedirs(staging_dir)

    total_bytes = 0
    save_timestamps = []

    try:
        for slot_key, (save_dir, slot) in SLOT_MAP.items():
            src = _slot_path(save_dir, slot)
            _validate_slot(src, f"Active save {slot}")
            dst = os.path.join(staging_dir, slot_key)
            shutil.copytree(src, dst)
            _validate_slot(dst, f"Backup {slot_key}")
            total_bytes += _directory_size(dst)
            main_dat = os.path.join(dst, "main.dat")
            save_timestamps.append(os.path.getmtime(main_dat))

        manifest = {
            "id": backup_id,
            "label": label or "",
            "createdAt": now.isoformat().replace("+00:00", "Z"),
            "saveDateHint": datetime.datetime.fromtimestamp(
                max(save_timestamps), datetime.timezone.utc
            ).isoformat().replace("+00:00", "Z"),
            "sizeBytes": total_bytes,
            "saveId": ACTIVE_SAVE_ID,
        }
        with open(os.path.join(staging_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        os.replace(staging_dir, backup_dir)
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise

    print(json.dumps({"ok": True, "backup": manifest}))


def cmd_restore_backup(backup_id):
    _require_game_closed()
    backup_dir = _backup_dir(backup_id)
    if not os.path.isdir(backup_dir):
        print(json.dumps({"ok": False, "error": f"Backup not found: {backup_id}"}))
        sys.exit(1)

    manifest = _read_manifest(backup_id)
    if manifest is None:
        print(json.dumps({"ok": False, "error": f"Backup manifest missing: {backup_id}"}))
        sys.exit(1)

    restore_sources = []
    for slot_key, (save_dir, slot) in SLOT_MAP.items():
        src = os.path.join(backup_dir, slot_key)
        _validate_slot(src, f"Backup {slot_key}")
        restore_sources.append((slot_key, save_dir, slot, src))

    restored = []
    rollback_paths = []
    try:
        for slot_key, save_dir, slot, src in restore_sources:
            dst = _slot_path(save_dir, slot)
            staging = dst + ".restore-" + uuid.uuid4().hex
            rollback = dst + ".rollback-" + uuid.uuid4().hex
            shutil.copytree(src, staging)
            _validate_slot(staging, f"Staged {slot_key}")
            os.replace(dst, rollback)
            rollback_paths.append((dst, rollback))
            os.replace(staging, dst)
            restored.append(slot_key)
    except Exception:
        for dst, rollback in reversed(rollback_paths):
            if os.path.isdir(dst):
                shutil.rmtree(dst)
            os.replace(rollback, dst)
        raise
    else:
        for _, rollback in rollback_paths:
            shutil.rmtree(rollback)

    print(json.dumps({"ok": True, "restoredSlots": restored, "backup": manifest}))


def cmd_delete_backup(backup_id):
    backup_dir = _backup_dir(backup_id)
    if not os.path.isdir(backup_dir):
        print(json.dumps({"ok": False, "error": f"Backup not found: {backup_id}"}))
        sys.exit(1)

    manifest = _read_manifest(backup_id)
    shutil.rmtree(backup_dir)
    print(json.dumps({"ok": True, "deleted": backup_id, "label": (manifest or {}).get("label", "")}))


def cmd_update_label(backup_id, label):
    manifest_path = _manifest_path(backup_id)
    if not os.path.isfile(manifest_path):
        print(json.dumps({"ok": False, "error": f"Backup not found: {backup_id}"}))
        sys.exit(1)

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    manifest["label"] = label[:80]

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(json.dumps({"ok": True, "id": backup_id, "label": manifest["label"]}))


def main():
    parser = argparse.ArgumentParser(description="ACNH Save Backup Manager")
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("list_backups")

    p_create = sub.add_parser("create_backup")
    p_create.add_argument("--label", default="")

    p_restore = sub.add_parser("restore_backup")
    p_restore.add_argument("--id", required=True)

    p_delete = sub.add_parser("delete_backup")
    p_delete.add_argument("--id", required=True)

    p_label = sub.add_parser("update_label")
    p_label.add_argument("--id", required=True)
    p_label.add_argument("--label", required=True)

    args = parser.parse_args()

    if args.cmd == "list_backups":
        cmd_list_backups()
    elif args.cmd == "create_backup":
        cmd_create_backup(label=args.label)
    elif args.cmd == "restore_backup":
        cmd_restore_backup(backup_id=args.id)
    elif args.cmd == "delete_backup":
        cmd_delete_backup(backup_id=args.id)
    elif args.cmd == "update_label":
        cmd_update_label(backup_id=args.id, label=args.label)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)
