#!/usr/bin/env python3
"""
Register ACNH Live Editor in Steam library with icon.
Modifies Steam's shortcuts.vdf directly to add or update the app entry.
"""

import sys
import os
import struct
from pathlib import Path

def read_vdf(filepath):
    """Read a binary VDF shortcuts file."""
    with open(filepath, 'rb') as f:
        return f.read()

def write_vdf(filepath, data):
    """Write a binary VDF shortcuts file."""
    # Backup the original
    backup = filepath.with_suffix('.vdf.bak')
    if filepath.exists():
        import shutil
        shutil.copy2(filepath, backup)
    
    with open(filepath, 'wb') as f:
        f.write(data)

def parse_vdf_binary(data):
    """Parse binary VDF format (simplified for shortcuts)."""
    # This is a complex binary format; we'll use a workaround approach
    # by calling Python's vdf library if available, or using a manual approach
    try:
        import vdf
        from io import BytesIO
        return vdf.load(BytesIO(data))
    except ImportError:
        print("[warn] vdf library not available; attempting manual vdf handling", file=sys.stderr)
        return None

def create_vdf_entry(app_name, exe_path, start_dir, icon_path):
    """
    Create a VDF shortcut entry in the binary format.
    This uses the vdf library if available.
    """
    entry = {
        'AppName': app_name,
        'Exe': exe_path,
        'StartDir': start_dir,
        'icon': icon_path,
        'ShortcutPath': '',
        'LaunchOptions': '',
        'IsHidden': 0,
        'AllowDesktopConfig': 1,
        'AllowOverlay': 1,
        'openvr': 0,
        'Devkit': 0,
        'DevkitGameID': '',
        'LastPlayTime': 0,
        'FlatpakAppID': '',
        'tags': {}
    }
    return entry

def register_app_with_vdf_library():
    """Register app using the vdf library."""
    try:
        import vdf
        from io import BytesIO
    except ImportError:
        return False
    
    steam_path = Path.home() / '.steam' / 'root'
    user_id = '1036279535'
    shortcuts_path = steam_path / 'userdata' / user_id / 'config' / 'shortcuts.vdf'
    
    if not shortcuts_path.exists():
        print(f"[error] shortcuts.vdf not found at {shortcuts_path}", file=sys.stderr)
        return False
    
    try:
        # Read existing shortcuts
        with open(shortcuts_path, 'rb') as f:
            shortcuts = vdf.load(f)
        
        # Find or create shortcuts key
        if 'shortcuts' not in shortcuts:
            shortcuts['shortcuts'] = {}
        
        # Create new entry
        new_entry = create_vdf_entry(
            app_name='acnh-live-editor',
            exe_path='/home/deck/acnh-live-editor/scripts/steamdeck-launch-app.sh',
            start_dir='/home/deck/acnh-live-editor',
            icon_path='/home/deck/acnh-live-editor/public/assets/icons/Apple_NL_Icon.png'
        )
        
        # Find next index
        indices = [int(k) for k in shortcuts['shortcuts'].keys() if k.isdigit()]
        next_index = str(max(indices) + 1) if indices else '0'
        
        # Add or update entry
        shortcuts['shortcuts'][next_index] = new_entry
        
        # Write back in binary format
        with open(shortcuts_path, 'wb') as f:
            vdf.dump(shortcuts, f, pretty=False)
        
        print(f"[ok] Registered ACNH Live Editor at index {next_index}")
        print(f"[ok] Icon set to: {new_entry['icon']}")
        return True
        
    except Exception as e:
        print(f"[error] Failed to register app: {e}", file=sys.stderr)
        return False

def main():
    """Main entry point."""
    
    # Check if vdf library is available
    try:
        import vdf
        print("[ok] vdf library found")
        success = register_app_with_vdf_library()
        
        if success:
            print("[ok] App registered successfully!")
            print("[info] Steam will reload the library on next start")
            return 0
        else:
            print("[error] Failed to register app", file=sys.stderr)
            return 1
            
    except ImportError:
        print("[error] vdf library not found", file=sys.stderr)
        print("[info] Install with: pip3 install vdf", file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
