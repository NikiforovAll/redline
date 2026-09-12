---
name: redline-annotate
description: Open the current diff as a review round in VS Code, then end the turn. Attaches only notes you already wrote; runs no analysis of its own. Use when the user asks to review changes in VS Code, send a diff for review, or start a Redline review round. For a guided walkthrough of the changes use redline-tour instead.
disable-model-invocation: true
---

# redline-annotate

Post one round and stop. Do not read the diff to write new notes; that is `redline-tour`.

Read `${CLAUDE_PLUGIN_ROOT}/reference/ROUND.md` first: it resolves the source from `$ARGUMENTS`, sets the title, and carries the `request_review` call and its stop rules.

## Attach notes

- `notes` only from text that already exists in this session: a summary you gave the user, a plan step, a commit message, a rationale you stated while editing. Map each such statement to its file, or to its hunk when you know the lines.
- Nothing written yet: send no `notes`. Do not open files or read the diff to produce them.
- Shape every note you do send by `${CLAUDE_PLUGIN_ROOT}/reference/NOTES.md`: read it before writing the first one.
