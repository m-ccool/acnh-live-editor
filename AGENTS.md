# Repository Agent Rules

These rules are mandatory for any agent working in this repository.

## Scope

- Active scope is bridge reliability, correct IP usage, Steam Deck connectivity, Ryujinx live-memory reads/writes, and getting that data to the existing Windows UI.
- Do not expand scope into redesigns, refactors, feature cleanup, music, catalog, or unrelated MVP ideas unless the user explicitly asks.
- Primary runtime target for user-directed validation is the Windows UI at `http://10.0.0.25:3000`; do not switch to isolated test endpoints unless the user explicitly requests backend-only verification.

## Assumptions

- Do not make unverified assumptions about the user's goals, preferred UX, desired files, environment state, emulator state, or acceptable tradeoffs.
- Do not replace or simplify the UI shell unless the user explicitly requests UI changes.
- When a fact is not confirmed by the user, the repo, or direct tool output, call it unconfirmed.
- When a missing fact would materially affect code edits, ask one concise question instead of guessing.

## Confirmed Repo Facts

- Windows UI address: `http://10.0.0.25:3000`
- Steam Deck bridge target host: `10.0.0.25`
- Steam Deck bridge target port: `32840`

## Work Style

- Preserve existing UI unless explicitly told otherwise.
- Prefer the smallest targeted bridge fix over broader cleanup.
- Verify facts with repo reads or command output before changing behavior.
- Keep responses and code changes tightly scoped to the current user request.
- Do not change files, code paths, response formats, or tooling outside the exact requested change.
- No opportunistic edits: if it was not requested, do not modify it.
- When providing commands or scripts, always use plain copy-paste code blocks.
- Keep code blocks clean and runnable with no inline commentary inside the block.
- When providing runnable commands, always provide explicit step-by-step run instructions.
- Always provide the full command text with no placeholders omitted.
- If a command requires a specific directory, always include an explicit `cd` to that directory before the command.
- Use this command response schema for runnable commands:
	1. Step N title line
	2. One fenced code block containing only runnable commands
	3. First line in the block must be `cd` to the required directory when directory context matters
	4. No inline commentary inside code blocks
- For every technical response, run a drift check against README MVP sections before answering:
	1. `MVP Outline Status`
	2. `Shortest Path To Live UI Readback`
	3. Reject additions that are not required to advance those sections or the active user request
- Compliance gate: if a response would violate these formatting rules, stop and ask one concise clarification question instead of proceeding.
- Any automated backend verification data must run on isolated non-primary ports.
- Automated backend verification data must not appear in the user UI or debug panels.
- Automated backend verification data exists for development only and must not be treated as live bridge data.
- User UI and debug panels must never show test data under any circumstance.
