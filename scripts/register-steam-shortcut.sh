#!/bin/bash
set -e

echo "[*] ACNH Live Editor — Steam Library Auto-Registration"
echo ""

# Verify we're on Steam Deck
if ! grep -q "SteamOS" /etc/os-release 2>/dev/null; then
    echo "[warn] Not running on SteamOS; this script is optimized for Steam Deck"
fi

# Check if vdf library is available
if ! python3 -c "import vdf" 2>/dev/null; then
    echo "[*] Installing vdf library..."
    
    # Try pip first (preferred method on Steam Deck)
    if command -v pip3 &>/dev/null; then
        pip3 install --user vdf
        echo "[ok] vdf library installed via pip3"
    elif command -v pacman &>/dev/null; then
        # Fallback to pacman (requires sudo, won't work in user context)
        echo "[warn] vdf not in pip3; pacman requires sudo"
        echo "[info] Try: sudo pacman -S python-vdf"
        exit 1
    else
        echo "[error] No package manager found; cannot install vdf"
        exit 1
    fi
fi

echo "[*] Registering app in Steam library..."

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Run the Python registration script
if python3 "$SCRIPT_DIR/register-steam-shortcut.py"; then
    echo ""
    echo "[ok] Registration complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Close Steam completely (if running)"
    echo "  2. Reopen Steam — your app will appear in the library"
    echo "  3. Click to launch!"
    echo ""
else
    echo "[error] Registration failed"
    exit 1
fi
