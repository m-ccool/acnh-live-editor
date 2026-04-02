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

## Available Scripts

- `npm run dev`: start the local server
- `npm run start`: start the local server
- `npm run import:catalogue`: rebuild `data/items.json` from imported catalogue data
- `npm run sync:nookipedia`: fetch and cache the live Nookipedia catalog
- `npm run bridge:test-client`: run the bridge simulator against the local bridge listener

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
