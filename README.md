# ACNH Live Editor

ACNH Live Editor is an offline-first web app for experimenting with Animal Crossing: New Horizons inventory editing, bridge connectivity, and item catalog lookup in a local development workflow.

## Overview

The project currently combines:

- A small Node/Express server for API routes, catalog access, music metadata, and bridge status.
- A browser-based client for inventory editing, player controls, diagnostics, and UI state.
- Supporting scripts for catalog import, Nookipedia sync, and Steam Deck bridge launch.

## Current Features

- Local inventory editing UI with slot selection and item assignment.
- Bridge status reporting and inventory read/write endpoints.
- Local starter catalog plus cached/live Nookipedia catalog support.
- Music library loading with fallback behavior.
- Offline shell support through a service worker.

## Tech Stack

- Node.js
- Express
- Vanilla HTML, CSS, and JavaScript
- Local JSON data files
- Optional Nookipedia API integration

## Project Structure

```text
.
|-- data/                  Local item data and cached remote catalog data
|-- imports/               Source import artifacts
|-- modules/               Backend services
|-- public/                Static client assets
|-- scripts/               Utility and sync scripts
|-- server.js              Main server entrypoint
```

## Requirements

- Node.js 18+
- npm
- Optional `NOOKIPEDIA_API_KEY` for live catalog sync

## Getting Started

```bash
npm install
npm run dev
```

The app starts on `http://localhost:3000` by default.

### Standard Startup (PowerShell)

Use this command set to stop any existing local server first, then start a fresh dev server:

```powershell
$ports = 3000, 32840
foreach ($port in $ports) {
  $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  if ($pids) { $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
}
cd C:\Users\mccoo\OneDrive\Developer\acnh-live-editor
npm run dev
```

The floating debug button in the existing Windows UI now runs this same local restart flow from the page, then waits for the app to come back before reloading.

## Environment Variables

Create a local `.env` file if needed.

```env
PORT=3000
BRIDGE_HOST=0.0.0.0
BRIDGE_PORT=32840
BRIDGE_REQUEST_TIMEOUT_MS=5000
NOOKIPEDIA_API_KEY=
NOOKIPEDIA_ACCEPT_VERSION=1.7.0
```

## Troubleshooting

- If catalog diagnostics show `State: Offline (offline)` with `Last error: Nookipedia API key is not configured.`, define `NOOKIPEDIA_API_KEY` in `.env` and restart `npm run dev`.
- If you launch the server from another working directory (for example via a process manager), make sure the app can still read `<repo>/.env`; the server now resolves `.env` from the project root.
- If diagnostics show `API: HTTP 403`, the key is being sent but rejected by Nookipedia (invalid/revoked/not approved for the requested version).

## Available Scripts

- `npm run dev`: start the local server
- `npm run start`: start the local server
- `npm run verify:bridge-backend`: run isolated backend-only bridge verification on non-primary ports
- `npm run import:catalogue`: rebuild `data/items.json` from imported catalogue data
- `npm run sync:nookipedia`: fetch and cache the live Nookipedia catalog
- `npm run bridge:steamdeck`: run the Steam Deck bridge client

## Steam Deck Bridge Client

Start local app on your PC:

```bash
npm run dev
```

For this repo's current bridge setup, the Windows UI is at `http://10.0.0.25:3000`.

Then run the bridge client on Steam Deck after `.steamdeck-bridge.env` is in place:

```bash
bash scripts/steamdeck-run-bridge.sh
```

New bridge launch (simple session start):

```bash
cd ~/acnh-live-editor
git checkout dev
git pull --ff-only origin dev
bash scripts/steamdeck-run-bridge.sh
```

### One-Click Deck Launcher (No Re-Typing In Konsole)

This repo now includes a single run file for Deck testing:

- `scripts/steamdeck-run-bridge.sh`

And an installer that creates a clickable Desktop icon:

- `scripts/install-steamdeck-launcher.sh`

Setup on Steam Deck once:

```bash
cd ~/acnh-live-editor
cp -n .steamdeck-bridge.env.example .steamdeck-bridge.env
nano .steamdeck-bridge.env
bash scripts/install-steamdeck-launcher.sh
```

Daily restart block on Steam Deck (clear existing client, refresh launcher, launch):

```bash
cd ~/acnh-live-editor
pkill -f "node .*scripts/steamdeck-bridge-client.js" || true
pkill -f "bash .*scripts/steamdeck-run-bridge.sh" || true
bash scripts/install-steamdeck-launcher.sh
bash scripts/steamdeck-run-bridge.sh
```

After that, you can also double-click the `ACNH Live Bridge` icon on Desktop.

What you should see on launch:

- A short Steam Deck connector startup banner from `scripts/steamdeck-run-bridge.sh`.
- A themed status panel from `scripts/steamdeck-bridge-client.js`.
- The panel status transitions from `CONNECTING` to `CONNECTED` when the bridge socket is live.
- If the PC bridge is unavailable, the Deck client stays open and retries automatically.

### Hazard Checks (Required For MVP Run Validation)

Run these checks before treating a run as valid:

- Visual check: in the Deck bridge panel, status must reach `CONNECTED` and remain stable (not loop `CLOSED`/`ERROR`).
- Backend check: on Windows UI (`http://10.0.0.25:3000`), `/api/bridge/status` must report the Deck device and bridge connection.
- Live data check: `/api/bridge/read-game-data` must return a real `player` payload from live memory.
- Fail-closed check: if any check fails, treat bridge data as unavailable/error and do not accept fallback/test data as live truth.

If it keeps retrying and does not connect:

1. On PC, start the app server (`npm run dev`) and confirm bridge port `32840` is open.
2. On Steam Deck, verify `.steamdeck-bridge.env` contains `BRIDGE_TARGET_HOST=10.0.0.25` and `BRIDGE_TARGET_PORT=32840`.
3. On Steam Deck, run the daily restart block above.
4. Relaunch `ACNH Live Bridge` and watch the panel detail line for connection errors.

Notes:

- Default icon is `public/assets/icons/Apple_NL_Icon.png`.
- `scripts/steamdeck-run-bridge.sh` sets the live adapter commands to:
  - `python3 scripts/steamdeck-adapters/bridge_memory_tool.py read_inventory`
  - `python3 scripts/steamdeck-adapters/bridge_memory_tool.py write_inventory_slot`
  - `python3 scripts/steamdeck-adapters/bridge_memory_tool.py read_game_data`
- `bridge_memory_tool.py` delegates to `acnh_memory_reader.py` unless you explicitly override `RYUJINX_LIVE_*`.

Optional environment variables:

- `BRIDGE_TARGET_HOST`, `BRIDGE_TARGET_PORT`: PC bridge listener endpoint. The confirmed current values are `10.0.0.25` and `32840`.
- `BRIDGE_DEVICE_NAME`: label shown in `/api/status`.
- `BRIDGE_HEARTBEAT_MS`: heartbeat interval (default `5000`).
- `BRIDGE_RECONNECT_DELAY_MS`: reconnect delay (default `3000`).
- `BRIDGE_COMMAND_TIMEOUT_MS`: timeout for adapter commands (default `5000`).
- `RYUJINX_PROCESS_MATCH`: process matcher for auto status probe (default `Ryujinx`).
- `RYUJINX_STRICT_PROCESS_CHECK`: require emulator-process matches only (default `1`).
- `ACNH_READER_MODE`: live reader mode passed through the launcher (default `procmem`).
- `RYUJINX_STATUS_CMD`: optional status command that must output JSON.
- `RYUJINX_READ_INVENTORY_CMD`: optional command for live read. Must output JSON array or `{ "slots": [...] }`.
- `RYUJINX_WRITE_INVENTORY_CMD`: optional command for live write. Receives request JSON on stdin and should output JSON.
- `RYUJINX_READ_GAME_DATA_CMD`: optional command for live player+inventory read. Must output JSON object with `player` and optionally `slots`.

Advanced live-reader overrides used by `bridge_memory_tool.py`:

- `RYUJINX_LIVE_READ_INVENTORY_CMD`
- `RYUJINX_LIVE_WRITE_INVENTORY_CMD`
- `RYUJINX_LIVE_READ_GAME_DATA_CMD`

Command contract for each `RYUJINX_LIVE_*` command:

- Receives one JSON object on stdin with a `command` field.
- Must print one JSON object to stdout.
- `read_inventory`: output array of slots or `{ "slots": [...] }`.
- `write_inventory_slot`: output `{ "slot": {...}, "slots"?: [...] }`.
- `read_game_data`: output `{ "player": {"name","town","wallet","bank","miles","avatar"}, "slots"?: [...], "source"?: "..." }`.

Adapter behavior:

- If `RYUJINX_READ_INVENTORY_CMD` is set, `read_inventory` uses that command.
- If `RYUJINX_WRITE_INVENTORY_CMD` is set, `write_inventory_slot` uses that command.
- If `RYUJINX_READ_GAME_DATA_CMD` is set, `read_game_data` uses that command.
- `scripts/steamdeck-run-bridge.sh` sets all three commands to `bridge_memory_tool.py` by default.
- `bridge_memory_tool.py` delegates directly to the live ACNH reader.
- No fake bridge-memory or file fallback is used in MVP mode.

### Updating This On Steam Deck

### Branch Policy For Bridge Testing

Moving forward:

- Run all new bridge and MVP test work on `dev` first.
- Promote tested changes to `master` only after they are confirmed working.
- Keep Steam Deck and Windows repos on the same branch during a test cycle to avoid mismatch.

#### Pre-Test Session Start (run every session before bridge testing)

**Windows (PowerShell):**

```powershell
cd C:\Users\mccoo\OneDrive\Developer\acnh-live-editor
git checkout dev
git pull --ff-only origin dev
git rev-parse HEAD
```

**Steam Deck (Konsole):**

```bash
cd ~/acnh-live-editor
git checkout dev
git pull --ff-only origin dev
git rev-parse HEAD
```

Both commands must print the same commit hash. If they differ, sync the lagging machine before testing.

After `dev` validation passes and you are ready to publish stable bridge behavior:

```bash
cd ~/acnh-live-editor
git checkout master
git pull --ff-only origin master
git merge --ff-only dev
git push origin master
```

Do you have to run `git pull`?

- Yes, if your Steam Deck repo is a git clone and you want the latest script changes from your remote branch.
- No, if you manually copied the updated files to Steam Deck by another method (for example `scp`, Syncthing, or a ZIP copy).

Typical update flow on Steam Deck (git clone setup, test branch `dev`):

```bash
cd ~/acnh-live-editor
git status --short
git checkout dev
git pull --ff-only origin dev
bash scripts/install-steamdeck-launcher.sh
```

Why rerun the launcher installer after pull:

- It refreshes the Desktop/application launcher entry and keeps the one-click setup aligned with the current scripts.

### Next-Step Wiring (Live Memory)

Confirmed current MVP bridge path:

- Windows UI: `http://10.0.0.25:3000`
- Steam Deck bridge target: `10.0.0.25:32840`
- Steam Deck launcher entry point: `bash scripts/steamdeck-run-bridge.sh`
- Live reader chain: `steamdeck-bridge-client.js` -> `bridge_memory_tool.py` -> `acnh_memory_reader.py`

Scope guard for Steam Deck MVP:

- Live bridge backend is memory (`acnh_memory_reader.py`) via `bridge_memory_tool.py`.
- `.../games/01006f8002326000/cache/cpu/0` is Ryujinx CPU cache and not the live bridge read/write backend.

## Development Notes

- The frontend is currently served directly from `public/` without a build step.
- The backend is centered around `server.js` plus helper modules in `modules/`.
- The catalog can run from local data only, or augment itself with cached/live Nookipedia data.

## Architecture Snapshot

- [server.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/server.js): Express entrypoint and API composition
- [public/app.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/public/app.js): main client behavior and UI state
- [modules/bridgeService.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/modules/bridgeService.js): bridge socket server and request lifecycle
- [modules/nookipediaCatalog.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/modules/nookipediaCatalog.js): catalog sync, caching, and diagnostics

## Repo Runbook

### Objective

- Keep MVP focused on reliable live bridge reads/writes between Steam Deck Ryujinx memory and the existing Windows UI.

### MVP Now

- Active bridge chain: `scripts/steamdeck-run-bridge.sh` -> `scripts/steamdeck-bridge-client.js` -> `scripts/steamdeck-adapters/bridge_memory_tool.py` -> `scripts/steamdeck-adapters/acnh_memory_reader.py`.
- Runtime target: Windows UI at `http://10.0.0.25:3000` and Steam Deck bridge target `10.0.0.25:32840`.

### Completed

- Steam Deck launcher + bridge run scripts are wired.
- Bridge status/read endpoints are active in the app backend.
- UI panels render bridge/game-data payloads.
- Live inventory write from Windows UI through bridge into Ryujinx memory confirmed functional (`84bdeef`, 2026-04-23). Save persists; in-game display refresh is a pinned bug (see Known Bugs).
- Inventory slot editing UI fully wired: click slot → item modal → assign item + count → Apply writes to live memory.
- Player data editing modal fully wired: wallet, bank bells, nook miles, player name, and town all write live through bridge into Ryujinx procmem (text fields via UTF-16LE write, confirmed 2026-04-27).
- Stack count badge styled and positioned over item icon in inventory slots.
- Player name and town live-write confirmed end-to-end: bridge write path (`write_game_data` via `RYUJINX_WRITE_GAME_DATA_CMD`) wired into `bridge_memory_tool.py` → `acnh_memory_reader.py` → Ryujinx procmem UTF-16LE write. `ok: true` confirmed 2026-04-27.

### Upcoming

- Player field expansion: passport description, birthday, skin tone editing (deferred until name/town write utility was confirmed — now unblocked).
- Complete unresolved MVP checklist and return TODO items below.

### Blocked

- Live RAM readback into the existing Windows UI is confirmed for inventory and player data on Steam Deck Ryujinx.
- Direct live inventory write confirmation from the Windows UI into active ACNH memory still needs final validation.

### Response Schema

- Enforcement is centralized in `AGENTS.md`.
- Follow `AGENTS.md` for the required response gate and command response schema.

## MVP Roadmap

### Codex-Optimized Execution Order

This order is optimized for smaller diffs, lower context cost, and faster Codex iterations.

1. Split the frontend monolith first.
2. Split `server.js` second.
3. Expand docs and maintain a short runbook for env vars, bridge startup, and catalog sync.
4. Harden the external-data path and scrape/fetch fallbacks.
5. Resolve the React dependency direction.

### MVP Completion Checklist

- [ ] Split the frontend monolith in [public/app.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/public/app.js) and [public/styles.css](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/public/styles.css) into smaller feature-focused modules.
- [ ] Shrink [server.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/server.js) by moving routes and service logic into separate backend modules.
- [ ] Harden the external-data path in [modules/nookipediaCatalog.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/modules/nookipediaCatalog.js) and the music/catalog fetch logic in [server.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/server.js).
- [ ] Decide the client direction: either remove unused `react` / `react-dom` dependencies or commit to a real React build path.
- [ ] Keep the README/runbook current as the MVP scope gets completed.

### Known Bugs

#### BUG-001: In-game pocket UI does not refresh after live inventory write

- **Status:** Pinned — do not re-investigate without a new approach.
- **Symptom:** After a live memory write to the canonical inventory slot VA, the in-game pocket menu does not visually refresh until the player closes and reopens the pocket.
- **Write first confirmed functional:** commit `84bdeef` (2026-04-23) — "Show pending inventory write + patch memory writer". Save data persists correctly.
- **First fix attempt:** commit `4a297c2` (2026-04-25) — "fix: dual-write slot-0 + slot-1 mirror for live in-game pocket render". Immediately reverted at `1db1e96` (proven not to work).
- **Multi-day investigation (2026-04-25 → 2026-04-27):** pulse-write, dirty-flag toggle, display buffer writer, DRAM scan, render-copy scan, focused cherry-pattern scans — all failed.
- **Root cause:** The game's render buffer VA could not be reliably identified. The game immediately overwrites attempted display-buffer writes.
- **Accepted state:** Write to canonical memory is the MVP goal and is working. Visual refresh is a UX gap, not a data-loss issue.

### Return TODOs

- [ ] Fix the refresh-item glitch.
- [ ] Write items into game successfully.
- [ ] Remove clipboard buttons.
- [ ] Add interaction flow: hold item to copy, tap empty slot to assign, double tap already assigned slot to overwrite.
- [ ] On overwrite intent, show a soft red overlay on the pocket on first click so the user knows overwrite is about to happen.
- [ ] Begin the framework for import mods.
- [ ] Add an `Edit Skin` button on Edit Player.
- [ ] Add an `Edit Skin` button on Villager Edit.

## MVP Outline Status

Confirmed in this repo:

- Scope is pinned to bridge reliability, correct IP usage, Steam Deck connectivity, and Ryujinx live-memory reads/writes feeding the existing Windows UI.
- Branch workflow for new testing is `dev` first, then promote to `master` after working validation.
- The Windows UI bridge address is `http://10.0.0.25:3000`.
- The Steam Deck bridge target is `10.0.0.25:32840`.
- The active live bridge chain is `scripts/steamdeck-run-bridge.sh` -> `scripts/steamdeck-bridge-client.js` -> `scripts/steamdeck-adapters/bridge_memory_tool.py` -> `scripts/steamdeck-adapters/acnh_memory_reader.py`.
- Direct live RAM readback from the Ryujinx process into the Windows UI is confirmed for player data and inventory data.
- Backend verification data is isolated from the primary UI and bridge path.
- Enforcement and fail-closed data policy are defined in `AGENTS.md`.

Confirmed in this session:

- Direct live inventory write from the Windows UI through the bridge into ACNH memory on Steam Deck is confirmed working (commit `84bdeef`, 2026-04-23). Canonical slot VA write is functional; save persists on game close.
- Player data editing (wallet, bank bells, nook miles) writes live through the bridge. Player name and town update local state; live-write support for text fields depends on bridge adapter capability.

Pinned bug:

- BUG-001: In-game pocket display does not refresh after a live write. Canonical memory write is confirmed correct. See Known Bugs section above.

## Shortest Path To Live UI Readback

1. Do not create or push a new branch unless the user explicitly asks for a branch-based workflow or pull request path.
2. Commit and push the current local bridge changes on `dev` before updating Steam Deck. If you use GitHub Desktop, confirm the commit exists and `Push origin` has completed before pulling on Deck.
3. On Steam Deck, run `python3 scripts/steamdeck-adapters/bridge_memory_tool.py read_game_data` and confirm it returns JSON with a real `player` object from live memory.
4. If that command does not return live data, calibrate the reader in `.steamdeck-bridge.env` with the confirmed Ryujinx process and memory offsets needed by `acnh_memory_reader.py`.
5. Once local live reads work on Steam Deck, run `bash scripts/steamdeck-run-bridge.sh` and confirm the Deck client connects to `10.0.0.25:32840`.
6. On Windows, request `/api/bridge/read-game-data` from the app backend and confirm it returns the same live player payload coming from the Deck.
7. After backend readback is confirmed, refresh the existing UI and confirm the player and inventory panels render that returned live payload without UI code changes.
8. Keep both repos on `dev` while validating new work. Before any `master` commit or promotion, ensure local `dev` is up to date with `origin/dev`.
9. Switch both repos to `master` only after the validated promotion is explicitly requested and pushed.
