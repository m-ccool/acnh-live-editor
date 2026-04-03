# ACNH Live Editor

ACNH Live Editor is an offline-first web app for experimenting with Animal Crossing: New Horizons inventory editing, bridge connectivity, and item catalog lookup in a local development workflow.

## Overview

The project currently combines:

- A small Node/Express server for API routes, catalog access, music metadata, and bridge status.
- A browser-based client for inventory editing, player controls, diagnostics, and UI state.
- Supporting scripts for catalog import, Nookipedia sync, and bridge simulation.

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
- `npm run import:catalogue`: rebuild `data/items.json` from imported catalogue data
- `npm run sync:nookipedia`: fetch and cache the live Nookipedia catalog
- `npm run bridge:test-client`: run the bridge simulator against the local bridge listener
- `npm run bridge:steamdeck`: run the Steam Deck bridge client

## Steam Deck Bridge Client

Start local app on your PC:

```bash
npm run dev
```

Then run the bridge client on Steam Deck:

```bash
BRIDGE_TARGET_HOST=192.168.1.25 BRIDGE_TARGET_PORT=32840 node scripts/steamdeck-bridge-client.js
```

Optional environment variables:

- `BRIDGE_TARGET_HOST`, `BRIDGE_TARGET_PORT`: PC bridge listener endpoint.
- `BRIDGE_DEVICE_NAME`: label shown in `/api/status`.
- `BRIDGE_HEARTBEAT_MS`: heartbeat interval (default `5000`).
- `BRIDGE_COMMAND_TIMEOUT_MS`: timeout for adapter commands (default `4000`).
- `RYUJINX_PROCESS_MATCH`: process matcher for auto status probe (default `Ryujinx`).
- `RYUJINX_STATUS_CMD`: optional status command that must output JSON.
- `RYUJINX_READ_INVENTORY_CMD`: optional command for live read. Must output JSON array or `{ "slots": [...] }`.
- `RYUJINX_WRITE_INVENTORY_CMD`: optional command for live write. Receives request JSON on stdin and should output JSON.
- `BRIDGE_INVENTORY_FILE`: optional fallback slot JSON file.
- `BRIDGE_PERSIST_INVENTORY=1`: persist fallback slot writes to `BRIDGE_INVENTORY_FILE`.

Adapter behavior:

- If `RYUJINX_READ_INVENTORY_CMD` is set, `read_inventory` uses that command.
- If `RYUJINX_WRITE_INVENTORY_CMD` is set, `write_inventory_slot` uses that command.
- Otherwise the client uses in-memory/file fallback slot state.

### Next-Step Wiring (Ready To Run)

This repo now includes adapter scripts:

- `scripts/steamdeck-adapters/read-inventory.js`
- `scripts/steamdeck-adapters/write-inventory-slot.js`

Use them immediately as command adapters:

```bash
BRIDGE_TARGET_HOST=192.168.1.25 \
BRIDGE_TARGET_PORT=32840 \
BRIDGE_INVENTORY_FILE=/home/deck/acnh-live-editor/data/steamdeck-inventory.json \
RYUJINX_READ_INVENTORY_CMD="node scripts/steamdeck-adapters/read-inventory.js" \
RYUJINX_WRITE_INVENTORY_CMD="node scripts/steamdeck-adapters/write-inventory-slot.js" \
node scripts/steamdeck-bridge-client.js
```

With this setup, your bridge reads and writes live through adapter commands over stdin/stdout JSON. You can later replace adapter internals with direct Ryujinx memory tooling while keeping the same bridge env contract.

## Development Notes

- The frontend is currently served directly from `public/` without a build step.
- The backend is centered around `server.js` plus helper modules in `modules/`.
- The catalog can run from local data only, or augment itself with cached/live Nookipedia data.

## Architecture Snapshot

- [server.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/server.js): Express entrypoint and API composition
- [public/app.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/public/app.js): main client behavior and UI state
- [modules/bridgeService.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/modules/bridgeService.js): bridge socket server and request lifecycle
- [modules/nookipediaCatalog.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/modules/nookipediaCatalog.js): catalog sync, caching, and diagnostics

## MVP Roadmap

### Codex-Optimized Execution Order

This order is optimized for smaller diffs, lower context cost, and faster Codex iterations.

1. Split the frontend monolith first.
2. Split `server.js` second.
3. Expand docs and maintain a short runbook for env vars, bridge startup, and catalog sync.
4. Add smoke tests around the current API and bridge contract.
5. Harden the external-data path and scrape/fetch fallbacks.
6. Resolve the React dependency direction.

### MVP Completion Checklist

- [ ] Split the frontend monolith in [public/app.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/public/app.js) and [public/styles.css](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/public/styles.css) into smaller feature-focused modules.
- [ ] Shrink [server.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/server.js) by moving routes and service logic into separate backend modules.
- [ ] Add a small smoke-test harness for `/api/status`, `/api/items/search`, `/api/music/library`, and the bridge handshake using [scripts/bridge-test-client.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/scripts/bridge-test-client.js).
- [ ] Harden the external-data path in [modules/nookipediaCatalog.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/modules/nookipediaCatalog.js) and the music/catalog fetch logic in [server.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/server.js).
- [ ] Decide the client direction: either remove unused `react` / `react-dom` dependencies or commit to a real React build path.
- [ ] Keep the README/runbook current as the MVP scope gets completed.

## Status

The current working sequence has already been reordered for Codex efficiency. The frontend split is the active next step.
