# ACNH Live Editor

Offline-first Animal Crossing: New Horizons live editor for local inventory work, bridge connectivity, and catalog lookup.

## MVP Completion Checklist

- [ ] Split the frontend monolith in [public/app.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/public/app.js) and [public/styles.css](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/public/styles.css) into smaller feature-focused modules.
- [ ] Shrink [server.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/server.js) by moving routes and service logic into separate backend modules.
- [ ] Add a small smoke-test harness for `/api/status`, `/api/items/search`, `/api/music/library`, and the bridge handshake using [scripts/bridge-test-client.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/scripts/bridge-test-client.js).
- [ ] Harden the external-data path in [modules/nookipediaCatalog.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/modules/nookipediaCatalog.js) and the music/catalog fetch logic in [server.js](C:/Users/mccoo/OneDrive/Developer/acnh-live-editor/server.js).
- [ ] Decide the client direction: either remove unused `react` / `react-dom` dependencies or commit to a real React build path.
- [ ] Expand docs for `.env`, bridge startup, and catalog sync flows.

## Codex-Optimized Execution Order

This order is optimized for lower Codex context cost, faster iterations, and smaller diffs, not strictly product-risk order.

1. Split the frontend monolith first.
2. Split `server.js` second.
3. Expand this README and add a short runbook for env vars, bridge startup, and catalog sync.
4. Add smoke tests around the current API and bridge contract.
5. Harden the external-data path and scrape/fetch fallbacks.
6. Resolve the React dependency direction.

## Current Working Note

The original scan priority list has been reordered for Codex efficiency. The former item `2` is now the first task in the working sequence.
