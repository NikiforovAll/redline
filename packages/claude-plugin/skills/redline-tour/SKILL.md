---
name: redline-tour
description: Open the current diff as a Redline review round in VS Code with a numbered walkthrough attached, then listen for the review.
disable-model-invocation: true
---

# redline-tour

Post one round with a guided tour, then invoke the `redline:redline-connect` skill.

Read `${CLAUDE_PLUGIN_ROOT}/reference/ROUND.md` first: it resolves the source from `$ARGUMENTS`, sets the title, and carries the `request_review` call and its stop rules. Read `${CLAUDE_PLUGIN_ROOT}/reference/NOTES.md` before writing the first note.

## Write the tour

Read the diff for the chosen source before writing anything.

A tour note is a guide's caption: it tells the reader what the hunk does and why the change needs it, in the voice of the author walking someone through their own work. Every note in `notes` is a numbered stop on the tour; the numbered sequence is the complete list. Anything else you noticed while reading the diff, such as a bug, a risk, an open question, or a better approach, goes in your chat reply under a "Noticed" line after the round report, where the user decides what to do with it.

1. Decide the reading order. Start where the change begins for a reader: the entry point, the type or contract that everything else depends on, then callers, then tests. Not file order, not diff order.
2. Number every note with a bold bracketed prefix on its `summary`: `**[<n>/<total>]** `. Per-file summaries and per-hunk summaries count in one sequence. The reader follows the numbers through the Comments panel.
3. Every changed file gets a per-file `summary` on what it contributes to the change.
4. A per-hunk `summary` for each hunk a reader must understand; skip mechanical hunks such as renames, imports, or formatting.

Example for a three-note tour:

```
**[1/3]** Adds the `Quote` type the parser and printer both read.
**[2/3]** Parser emits `Quote` for lines that start with a marker.
**[3/3]** Printer renders `Quote` as an indented block.
```

When you report the round, add the note count to the line.
