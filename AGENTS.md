## BEFORE TEST, ENSURE ENVRONMENT IS READY - ENSURE ALL BELOW ARE ADHERED TO AS ABSOLUTE RULES OF OPERATION.
- refer to agents.md and readme.me
- clean up any pending changes relating to your work (other agents are working in the background)
- Turn on any listeners available within the project, debugs, consoles, and webview terminals, are utilized in the most efficent manner possible - do not prompt user when agent is capable
- create roadmap for issue, operation, result, next steps per mvp (or address bug)
- unsure Ui, Steamdeck, and Git all push/pulled updated correctly



























































































# Repository Agent Rules

These rules are mandatory for any agent working in this repository.

## Contract Precedence

Apply this order exactly:

1. User request
2. AGENTS guardrails
3. README MVP sections
4. Implementation details

## Mandatory Response Gate

Before any technical answer, include or explicitly check:

1. Scope status
2. README MVP section touched
3. Excluded items and why

This response gate is required in every technical answer.

## README Binding

- Every technical response must cite the exact README heading being followed.
- Drift-check each technical response against:
	1. `MVP Outline Status`
	2. `Shortest Path To Live UI Readback`
- Reject additions that do not advance those sections or the active user request.
- Reject technical answers that do not cite README headings.

## README Edit Permission

- README edits are not auto-approved.
- Do not edit `README.md` unless the user explicitly requests a README change in the active conversation.
- If a README change is needed for MVP safety/run accuracy and was not explicitly requested, stop and ask one concise approval question before editing.

## Scope

- Active scope: bridge reliability, correct IP usage, Steam Deck connectivity, Ryujinx live-memory reads/writes, and data flow to the existing Windows UI.
- Do not expand scope into redesigns, refactors, cleanup, music, catalog, or unrelated MVP ideas unless explicitly requested.
- Primary validation target is the Windows UI at `http://10.0.0.25:3000`; do not switch to isolated endpoints unless explicitly requested for backend-only verification.

## Confirmed Repo Facts

- Windows UI address: `http://10.0.0.110:3000`
- Steam Deck bridge target host: `10.0.0.110`
- Steam Deck bridge target port: `32840`
- Steam Deck SSH: `deck@10.0.0.233:22`, key `C:/Users/mccoo/.ssh/id_ed25519_steamdeck`
- Bridge target host on the deck is configured in `~/acnh-live-editor/.steamdeck-bridge.env` (`BRIDGE_TARGET_HOST`); when the Windows IP changes, update that file and `systemctl --user restart acnh-bridge.service` instead of asking the user.

## Verification Discipline

- Do not make unverified assumptions about user goals, UX changes, environment state, emulator state, or acceptable tradeoffs.
- Do not replace or simplify the UI shell unless explicitly requested.
- When a fact is not confirmed by user, repo, or direct tool output, call it unconfirmed.
- When a missing fact materially affects edits, ask one concise question instead of guessing.
- Do not use conditional phrasing for facts already established in context; state established facts directly.
- Use the Windows UI browser window as the primary validation surface when it is available, inspect rendered outputs there directly, and only send live tests to the running game or project when the user has explicitly authorized the test and the intended live effect has been stated in the work log or response.

## Work Integrity

- Preserve existing UI unless explicitly told otherwise.
- Prefer the smallest targeted bridge fix over broader cleanup.
- Verify facts with repo reads or command output before changing behavior.
- Keep changes tightly scoped to the exact request.
- No opportunistic edits: if it was not requested, do not modify it.
- Do not change files, paths, response formats, or tooling outside the exact requested change.
- Do not add or modify agent rules unless explicitly requested.
- When a requested local environment or tool update can be executed safely and directly from the current machine, perform it instead of handing the step back to the user.
- Before telling the user to update Steam Deck or another machine from git, ensure the required local code changes are actually committed and pushed. If the user works through GitHub Desktop, explicitly note that GitHub Desktop must show the commit/push completed before the remote machine pulls.

## Do Not Hand Work Back To The User

- NEVER tell the user to do something the agent can perform directly with the tools available in this session (SSH to the deck, edit files, restart services, run scripts, fetch URLs, capture screenshots, push/pull git, update env files, etc.).
- If a step is technically executable from the agent's environment, the agent runs it. The user is only asked when the action requires physical hardware interaction (e.g. opening the in-game menu on the Switch handheld, plugging in a controller) or explicit human authorization for a destructive/irreversible change.
- Optimize for resolution time: prefer doing the action and reporting the result over describing the action and waiting.

## Never Overcomplicate

- Pick the shortest path that resolves the user's request. One file edit beats a refactor; one shell command beats a script; reading one file beats running ten searches.
- Do not introduce abstractions, helpers, options, branches, or wrappers that were not requested.
- Do not chain hypothetical "what if" steps into a single response. Resolve the current step, observe the result, then act on the next step.
- If two approaches both satisfy the request, take the one with fewer moving parts.

## Command Response Schema

- Always provide explicit step-by-step run instructions.
- If using acronyms, always describe it in perenthesis
- One step title + one fenced code block per step.
- Commands must be plain copy-paste runnable.
- First line must be `cd` when directory context matters.
- No inline commentary inside code blocks.
- Always provide full command text with no placeholders omitted.

## Prompt Follow-Up Questions

- When concluding a prompt, end with exactly three numbered follow-up questions using `1.`, `2.`, `3.` formatting.
- These questions must help the user reply quickly with the next troubleshooting or implementation direction.
- Keep the questions concise and action-oriented so the user can answer by number when iterating on prompts.

## Fail-Closed Live Data Policy

- No synthetic, temporary, substitute, or fake data in UI/debug/runtime responses.
- If real data is unavailable, return unavailable/error; never substitute.
- Automated backend verification data must run only on isolated non-primary ports.
- Automated backend verification data must never appear in UI or debug panels.
- Automated backend verification data is development-only and never live bridge truth.
- Reject any output that uses synthetic/temp/test data as UI/debug truth.

## Automatic Request Contract (Complex Requests)

For complex requests, apply this contract automatically without requiring user attachment:

1. Objective (one exact outcome)
2. Scope (in-scope + explicit exclusions)
3. README binding (`MVP Outline Status`, `Shortest Path To Live UI Readback`)
4. Data policy (fail-closed, no substitution)
5. Change constraints (allowed/forbidden files)
6. Acceptance checks (explicit checks + expected outcomes)
7. Stop condition (ask one concise question when a missing fact materially affects edits)

## Governance Commit Template

For governance/rule changes, use this commit structure:

- Subject: `Consolidate agent governance into AGENTS contract`
- Body bullets:
	- single enforcement source in `AGENTS.md`
	- precedence, response gate, README binding, fail-closed policy
	- removed duplicate policy surfaces
	- README runbook/schema alignment

## Compliance Gate

- If an answer would violate scope, formatting, data policy, or README binding, stop and ask one concise clarification question instead of proceeding.

## Agent Deploy Responsibility (dev branch)

- The `dev` branch exists so the chat agent owns the full deploy loop end-to-end. The user does not perform git pushes or Steam Deck pulls manually.
- At the end of EVERY response that produced or could produce a code, config, or script change in the workspace, the agent MUST execute the following sequence in order, without prompting the user:
	1. `git status` (Windows) — confirm clean working tree or stage intended changes only.
	2. `git add` + `git commit` for the in-scope changes (skip if nothing to commit).
	3. `git push origin dev` from Windows.
	4. SSH to Steam Deck (`deck@10.0.0.233`, key `C:/Users/mccoo/.ssh/id_ed25519_steamdeck`) and run `cd ~/acnh-live-editor && git pull origin dev && systemctl --user restart acnh-bridge.service`.
	5. Verify bridge restart with `systemctl --user is-active acnh-bridge.service` and tail `~/.acnh-live-bridge.log` for the latest startup line.
- Before AND after the push/pull, the agent MUST also clean redundancies and any drafts/stashes on both machines:
	- Windows: `git stash list` → drop any stale entries the user has not pinned; remove untracked `__pycache__/`, stray `.pyc`, and runtime cache files that are not part of the change.
	- Steam Deck: `git stash drop` for all stale stashes; remove `__pycache__/`, `*.pyc`, and any `.save` backup files left by editors.
- If any deploy step fails, the agent MUST report the exact failing command and output in that same response and STOP — do not silently continue.
- Pure question-answering responses with no file changes are exempt from steps 2–5 but must still report whether a clean state was confirmed.
