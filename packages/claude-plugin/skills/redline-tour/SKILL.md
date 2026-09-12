---
name: redline-tour
description: Open the current diff as a review round in VS Code with a numbered walkthrough of the changes attached, then end the turn. Use when the user asks to explain, walk through, or tour the changes in VS Code. To open the diff without new notes use redline-annotate.
disable-model-invocation: true
---

# redline-tour

Post one round with a guided tour and stop.

Read `${CLAUDE_PLUGIN_ROOT}/reference/ROUND.md` first: it resolves the source from `$ARGUMENTS`, sets the title, and carries the `request_review` call and its stop rules. Read `${CLAUDE_PLUGIN_ROOT}/reference/NOTES.md` before writing the first note.

## Write the tour

Read the diff for the chosen source before writing anything.

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
