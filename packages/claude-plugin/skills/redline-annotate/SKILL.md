---
name: redline-annotate
description: Open the current diff as a Redline review round in VS Code with the notes you already wrote, then listen for the review.
disable-model-invocation: true
---

# redline-annotate

Post one round, then invoke the `redline:redline-connect` skill. Attach only notes already written; the diff walkthrough is `redline-tour`.

Read `${CLAUDE_PLUGIN_ROOT}/reference/ROUND.md` first: it resolves the source from `$ARGUMENTS`, sets the title, and carries the `request_review` call and its stop rules.

## Attach notes

- `notes` only from text that already exists in this session: a summary you gave the user, a plan step, a commit message, a rationale you stated while editing. Map each such statement to its file, or to its hunk when you know the lines.
- Nothing written yet: post the round without `notes`.
- Shape every note you do send by `${CLAUDE_PLUGIN_ROOT}/reference/NOTES.md`: read it before writing the first one.
