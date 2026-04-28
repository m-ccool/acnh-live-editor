#!/usr/bin/env python3
"""
ACNH Save Backup Manager
Handles create/list/restore/delete of save file backups.

Commands:
  list_backups
  create_backup [--label "My label"]
  restore_backup --id <backup_id>
  delete_backup  --id <backup_id>

Save directories backed up:
  ~/.config/Ryujinx/bis/user/save/0000000000000002  (both slots)
  ~/.config/Ryujinx/bis/user/save/0000000000000003  (both slots)

Backups are stored in ~/acnh-live-editor/data/save-backups/<id>/
Each backup contains:
  slot2_0/  slot2_1/  slot3_0/  slot3_1/  manifest.json
"""
import argparse
import datetime
import json
import os
import shutil
import sys
import uuid

SAVE_ROOT = os.path.expanduser("~/.config/Ryujinx/bis/user/save")
SAVE_DIR_2 = os.path.join(SAVE_ROOT, "0000000000000002")
SAVE_DIR_3 = os.path.join(SAVE_ROOT, "0000000000000003")
BACKUP_ROOT = os.path.expanduser("~/acnh-live-editor/data/save-backups")

SLOT_MAP = {
    "slot2_0": (SAVE_DIR_2, "0"),
    "slot2_1": (SAVE_DIR_2, "1"),
    "slot3_0": (SAVE_DIR_3, "0"),
    "slot3_1": (SAVE_DIR_3, "1"),
}


def _slot_path(save_dir, slot):
    """Return path to a slot subdirectory, handling nested 0/ layout."""
    base = os.path.join(save_dir, slot)
    # save dir 3 has an extra 0/ subdirectory
    nested = os.path.join(base, "0")
    if os.path.isdir(nested):
        return nested
    return base


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


def _main_dat_mtime(backup_id):
    """Return ISO timestamp of the main.dat inside the backup (slot2_0 copy)."""
    dat = os.path.join(_backup_dir(backup_id), "slot2_0", "main.dat")
    if os.path.isfile(dat):
        return datetime.datetime.utcfromtimestamp(os.path.getmtime(dat)).isoformat() + "Z"
    return None


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
        })
    print(json.dumps({"ok": True, "backups": backups}))


def cmd_create_backup(label=""):
    os.makedirs(BACKUP_ROOT, exist_ok=True)
    backup_id = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ") + "_" + uuid.uuid4().hex[:6]
    backup_dir = _backup_dir(backup_id)
    os.makedirs(backup_dir, exist_ok=True)

    total_bytes = 0
    save_date_hint = None

    for slot_key, (save_dir, slot) in SLOT_MAP.items():
        src = _slot_path(save_dir, slot)
        dst = os.path.join(backup_dir, slot_key)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
            main_dat = os.path.join(dst, "main.dat")
            if os.path.isfile(main_dat):
                total_bytes += os.path.getsize(main_dat)
                if save_date_hint is None:
                    mtime = os.path.getmtime(main_dat)
                    save_date_hint = datetime.datetime.utcfromtimestamp(mtime).isoformat() + "Z"

    manifest = {
        "id": backup_id,
        "label": label or "",
        "createdAt": datetime.datetime.utcnow().isoformat() + "Z",
        "saveDateHint": save_date_hint or "",
        "sizeBytes": total_bytes,
    }
    with open(_manifest_path(backup_id), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(json.dumps({"ok": True, "backup": manifest}))


def cmd_restore_backup(backup_id):
    backup_dir = _backup_dir(backup_id)
    if not os.path.isdir(backup_dir):
        print(json.dumps({"ok": False, "error": f"Backup not found: {backup_id}"}))
        sys.exit(1)

    manifest = _read_manifest(backup_id)
    if manifest is None:
        print(json.dumps({"ok": False, "error": f"Backup manifest missing: {backup_id}"}))
        sys.exit(1)

    restored = []
    for slot_key, (save_dir, slot) in SLOT_MAP.items():
        src = os.path.join(backup_dir, slot_key)
        if not os.path.isdir(src):
            continue

        dst_base = os.path.join(save_dir, slot)
        # For save dir 3 which has nested 0/ layout
        nested = os.path.join(dst_base, "0")
        dst = nested if os.path.isdir(nested) or (
            save_dir == SAVE_DIR_3 and os.path.isdir(dst_base)
        ) else dst_base

        # Ensure destination exists
        os.makedirs(dst, exist_ok=True)

        # Copy all files from backup slot into destination
        for item in os.scandir(src):
            src_item = item.path
            dst_item = os.path.join(dst, item.name)
            if item.is_dir():
                if os.path.isdir(dst_item):
                    shutil.rmtree(dst_item)
                shutil.copytree(src_item, dst_item)
            else:
                shutil.copy2(src_item, dst_item)

        restored.append(slot_key)

    print(json.dumps({"ok": True, "restoredSlots": restored, "backup": manifest}))


def cmd_delete_backup(backup_id):
    backup_dir = _backup_dir(backup_id)
    if not os.path.isdir(backup_dir):
        print(json.dumps({"ok": False, "error": f"Backup not found: {backup_id}"}))
        sys.exit(1)

    manifest = _read_manifest(backup_id)
    shutil.rmtree(backup_dir)
    print(json.dumps({"ok": True, "deleted": backup_id, "label": (manifest or {}).get("label", "")}))


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

    args = parser.parse_args()

    if args.cmd == "list_backups":
        cmd_list_backups()
    elif args.cmd == "create_backup":
        cmd_create_backup(label=args.label)
    elif args.cmd == "restore_backup":
        cmd_restore_backup(backup_id=args.id)
    elif args.cmd == "delete_backup":
        cmd_delete_backup(backup_id=args.id)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
