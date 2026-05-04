##Chat Agent Task Outline


Current Agent Tasks in Chat:

- Read villagers from decrypted main.dat save file (Rolf+Bob confirmed) | progress: 100% DONE















Completed Agent Tasks in Chat:































































































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

- Windows UI address: `http://10.0.0.25:3000`
- Steam Deck bridge target host: `10.0.0.25` (set explicitly in `.steamdeck-bridge.env` as `BRIDGE_TARGET_HOST=10.0.0.25`)
- Steam Deck bridge target port: `32840`

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
