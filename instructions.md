# ACNH Live Editor — Agent Contract

> This file is the **single source of truth** for any Copilot or AI agent working in this repo.
> It supersedes inline comments, ad-hoc instructions, and prior session memory.
> Every response must be traceable to a section in this file.

---

## 1. Project Identity

**App Name:** ACNH Live Editor
**Type:** Animal Crossing: New Horizons live memory editor — item catalog, villager data, and inventory read/write via Steam Deck bridge
**Owner:** Solo full-stack developer (freelance, 12+ yrs, systems admin background)
**Repo:** `m-ccool/acnh-live-editor` (GitHub, branch `dev`)
**Primary validation target:** `http://10.0.0.233:3000` (Steam Deck LAN UI)

---

## 2. Tech Stack (Canonical)

| Layer | Tech | Notes |
|---|---|---|
| Backend | Node.js 18+ / Express | `server.js` — entrypoint and API route composition |
| Frontend | Vanilla HTML, CSS, JavaScript | No framework, no build step |
| Bridge | Node.js socket server | `modules/bridgeService.js` — request lifecycle |
| Memory chain | Python | `scripts/steamdeck-adapters/` — Steam Deck memory reads/writes |
| Catalog | Nookipedia API (optional) | `modules/nookipediaCatalog.js` — requires `NOOKIPEDIA_API_KEY` in `.env` |
| Data | Local JSON files | `data/` — item data and cached catalog data |
| PWA | Static assets | `public/` served directly — mobile-first responsive |

---

## 3. Architecture (Canonical File Map)

| File | Role |
|---|---|
| `server.js` | Express entrypoint and API route composition |
| `modules/bridgeService.js` | Bridge socket server and request lifecycle |
| `modules/nookipediaCatalog.js` | Nookipedia catalog sync, caching, and diagnostics |
| `modules/catalogApi.js` | Catalog access layer |
| `modules/itemCatalog.js` | Catalog access layer |
| `modules/apiRouter.js` | Express route definitions |
| `modules/localIp.js` | Local IP resolution utility |
| `modules/musicLibrary.js` | Music library module |
| `public/app.js` | Main client behavior and UI state machine |
| `public/app-core.js` | Core client module |
| `public/app-music.js` | Music client module |
| `public/app-workspaces.js` | Workspace client module |
| `public/styles.css` | All UI styling — mobile-first |
| `public/index.html` | App shell |
| `scripts/steamdeck-bridge-client.js` | Bridge client — Steam Deck side |
| `scripts/steamdeck-adapters/bridge_memory_tool.py` | Memory tool relay |
| `scripts/steamdeck-adapters/acnh_memory_reader.py` | ACNH Ryujinx memory reader |

### Bridge Chain (read/write path)
```
steamdeck-run-bridge.sh
  → steamdeck-bridge-client.js
    → bridge_memory_tool.py
      → acnh_memory_reader.py
```

---

## 4. Design Philosophy

This is a **mobile-first responsive PWA** targeting phone, tablet, desktop, and Steam Deck.

- Mobile-first UI and UX is non-negotiable for all interface decisions.
- Layout, typography, spacing, and touch targets must be validated at mobile widths first.
- Component sizing and responsive breakpoints must degrade gracefully from large to small screens.
- No frontend build pipeline — edits to `public/` take effect immediately on reload.

---

## 5. Environment and Network Facts (Confirmed)

| Fact | Value |
|---|---|
| Canonical UI address | `http://10.0.0.233:3000` |
| App port | `3000` |
| Bridge port | `32840` |
| Steam Deck IP | `10.0.0.233` |
| Steam Deck SSH user | `deck` |
| Steam Deck SSH key | `C:/Users/mccoo/.ssh/id_ed25519_steamdeck` |
| Bridge target host | `127.0.0.1` (set in `.steamdeck-bridge.env`) |
| Bridge target port | `32840` |
| Node on Steam Deck | `/home/deck/.nvm/versions/node/v24.14.1/bin/node` |
| Bridge systemd service | `~/.config/systemd/user/acnh-live-bridge.service` |
| Bridge status | Same-Deck: `127.0.0.1:32840` |

- `.steamdeck-bridge.env` is gitignored — must be set directly on Steam Deck; do not commit it.
- Catalog state is `Offline` until `NOOKIPEDIA_API_KEY` is set in `.env`.
- Steam Deck is the only supported runtime host: it serves the UI at `http://10.0.0.233:3000` and hosts the bridge locally at `127.0.0.1:32840`. Windows is not a UI or bridge host.

---

## 6. Branch Policy

| Branch | Purpose |
|---|---|
| `dev` | Active development and bridge testing |
| `master` | Stable, confirmed bridge behavior only |

- Fast-forward merges only (`--ff-only`); no merge commits.
- All new bridge/MVP work goes to `dev` first; promote to `master` only after confirmed working.
- Both Windows and Steam Deck repos must be on the same branch and same commit hash during a test cycle.

---

## 7. Build and Dev

**Start server (Steam Deck):**

```bash
cd ~/acnh-live-editor
bash scripts/steamdeck-launch-app.sh
```

---

## 8. Agent Operating Rules

### Must always
- Read the relevant files before suggesting any change
- Produce complete, copy-paste-runnable files — no partials, no `// ... rest of code`
- Cite the section of this file that authorizes the change
- Confirm bugs fixed by running a test or reading corrected output before declaring resolved
- End every technical answer with exactly 3 numbered follow-up questions
- Apply one step title + one fenced code block per step in command responses
- Expand acronyms in parentheses on first use in a response
- Use the Steam Deck UI at `http://10.0.0.233:3000` as the primary validation surface

### Must never
- Expand scope beyond the active request — no redesigns, refactors, cleanup, or unrelated MVP ideas
- Push, pull, or sync git without explicit user confirmation in the active conversation
- Substitute fake, synthetic, temporary, or demo data as UI or debug truth
- Edit `README.md` without explicit user request
- Make assumptions about environment state, emulator state, or acceptable tradeoffs — state unconfirmed facts as unconfirmed
- Replace or simplify the UI shell unless explicitly requested
- Add or modify agent rules unless explicitly requested
- Use conditional phrasing for facts already established in context

### Change discipline
- Smallest targeted change that satisfies the request
- Preserve existing UI, component APIs, and data structures unless explicitly told otherwise
- No opportunistic edits: if it was not requested, do not modify it
- If a change requires touching >3 unrelated files, stop and confirm scope first
- Verify facts with repo reads or command output before changing behavior

### Post-edit cleanup (silent)
After every code edit, silently run a cleanup pass on all modified files:
- Remove dead code, unused variables, orphaned functions
- Fix broken references left by refactors
- Remove leftover stubs and stale TODO comments
- Collapse redundant state or logic introduced during iterative edits
- Batch cleanup into the same commit as the feature — no separate cleanup commits
- Do NOT notify the user; execute silently

---

## 9. Response Contract

### Mandatory response gate
Before any technical answer, explicitly check:
1. Scope status — is this in active scope?
2. README MVP section touched
3. Excluded items and why

### Automatic request contract (complex requests)
Apply this automatically without requiring user attachment:
1. **Objective** — one exact outcome
2. **Scope** — in-scope items + explicit exclusions
3. **README binding** — `MVP Outline Status`, `Shortest Path To Live UI Readback`
4. **Data policy** — fail-closed, no substitution
5. **Change constraints** — allowed/forbidden files
6. **Acceptance checks** — explicit checks + expected outcomes
7. **Stop condition** — ask one concise question when a missing fact materially affects edits

### Fail-closed live data policy
- No synthetic, temporary, substitute, or fake data in UI/debug/runtime responses
- If real data is unavailable, return unavailable/error; never substitute
- Automated backend verification data must run only on isolated non-primary ports
- Automated backend verification data must never appear in UI or debug panels
- Reject any output that uses synthetic/temp/test data as UI/debug truth

### Bug/Issue confirmation gate
- Do NOT prompt the user to proceed to the next task until the prior bug or issue is confirmed resolved
- Confirm resolution by directly running the test and verifying correct output before declaring fixed
- If the prior bug cannot be self-tested (requires live hardware), explicitly state that and ask the user to confirm
- Never assume a fix worked just because code was committed — execute the test, observe the result, report the result

### Git push/pull gate
- Do NOT prompt the user to `git push`, `git pull`, or sync any machine unless the user has explicitly confirmed code is ready
- If a push or pull step is required to complete the task, stop and ask one concise approval question
- Never bundle a push or pull step silently inside a multi-step command block
- Before telling the user to update Steam Deck from git, ensure the required local changes are committed and pushed

### Compliance gate
If an answer would violate scope, formatting, data policy, or README binding, stop and ask one concise clarification question instead of proceeding.

---

## 10. Governance Commit Template

For governance/rule changes, use this commit structure:

- **Subject:** `Consolidate agent governance into instructions contract`
- **Body bullets:**
  - single enforcement source in `instructions.md`
  - precedence, response gate, README binding, fail-closed policy
  - removed duplicate policy surfaces
  - README runbook/schema alignment

---

## 11. Session Kickoff (Copy-Paste Template)

```
## Session — ACNH Live Editor

Branch: dev
Last commit: [describe]
State: [what is working / what is broken]
Bridge status: [connected / disconnected / untested]

This session goal: [one sentence]

Constraints:
- Do NOT redesign existing UI
- Do NOT add dependencies without justification
- Preserve existing data structures and API shapes
- Primary validation target: http://10.0.0.233:3000
```

---

## 12. Agent Task Log

*(Append completed agent tasks below as a running log.)*
