---
name: redline-annotate
description: Open the current diff as a Redline review round in VS Code with the notes you already wrote, then listen for the review.
disable-model-invocation: true
---

# redline-annotate

Post one round, then invoke the `redline:redline-connect` skill. Attach only notes already written; the diff walkthrough is `redline-tour`.

Read `${CLAUDE_PLUGIN_ROOT}/reference/ROUND.md` first: it resolves the source from `$ARGUMENTS`, sets the title, and carries the `request_review` call and its stop rules.

## Attach notes

- `notes` come from two places: text that already exists and inferred in this session, and text the user asks you to post, in their words. Map each note to its file, or to its hunk when you know the lines.
- Nothing to attach: post the round without `notes`. To add a note later, call `add_notes` with the round id.
- Shape every note you do send by `${CLAUDE_PLUGIN_ROOT}/reference/NOTES.md`: read it before writing the first one. Findings that arrive with a category and a severity keep them; its Labels section has the shape.
