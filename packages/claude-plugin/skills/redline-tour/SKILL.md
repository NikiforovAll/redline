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
2. Pick the stops. A stop is one note on one hunk the reader must understand to follow the change. A file whose role needs a sentence gets it in the body of its first stop. You choose which parts matter; a file with only mechanical hunks such as renames, imports, or formatting gets no stop at all. A short tour that lands on the right places beats one that covers everything.
3. Number every note with a bold bracketed prefix on the first line of its `body`: `**[<n>/<total>]** `. The reader follows the numbers through the Comments panel.

Example for a three-note tour:

```
**[1/3]** Adds the `Quote` type the parser and printer both read.
**[2/3]** Parser emits `Quote` for lines that start with a marker.
**[3/3]** Printer renders `Quote` as an indented block.
```

When you report the round, add the note count to the line.
