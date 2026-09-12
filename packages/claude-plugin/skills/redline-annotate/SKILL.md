---
name: redline-annotate
description: Open the current diff as a review round in VS Code with your notes attached, then end the turn. Use when the user asks to review changes in VS Code, send a diff for review, or start an redline review round.
---

# redline-annotate

Post one round and stop: build a `source`, attach notes, call `request_review`, end the turn. Acting on the reviewer's comments is not this skill's job — the redline monitor wakes you with a line that says which tool to call, and the tool descriptions carry the rest.

## Pick the source

Argument given: `$ARGUMENTS`. Resolve in this order and say which reading you used.

1. Path to an existing `.patch` or `.diff` file: `{kind: "patch", text: <file contents>}`.
2. `staged`, `unstaged`, or `all`: `{kind: "worktree", scope: <arg>}`.
3. Contains `..` or `...`: `{kind: "range", from, to}` split on the operator.
4. `--files <a> <b>`: `{kind: "files", pairs: [{left: a, right: b}]}`.
5. A ref that `git rev-parse --verify <arg>^{commit}` accepts: a branch or an older commit means `{kind: "range", from: <arg>, to: "HEAD"}`; a single commit the user wants on its own means `from: <arg>~1, to: <arg>`. Prefer the branch reading when unsure.
6. Anything else: ask once, then use `all`.

No argument:

1. Run `git status --porcelain`. Empty tree: say there is nothing to review and stop.
2. All of your changes this session are unstaged and nothing is staged: `scope: "unstaged"`.
3. You staged your changes and nothing else is unstaged: `scope: "staged"`.
4. Otherwise, or when you cannot tell what you changed: `scope: "all"`.

## Attach notes

- `title`: the user's original task, under 80 characters.
- One per-file `summary`, one sentence, always.
- Per-hunk `rationale` only when the reason is not visible in the diff: a workaround, a trade-off, an outside constraint. Never restate the change.
- Plain text, no markdown headings.

## Call request_review

Call `request_review({source, title, notes})`. Report the round id and file count in one line, then end the turn. Do not call `get_review` and do not poll.

If the tool returns a "no VS Code window" error, print its remediation text verbatim and stop.

If `request_review` returns any result whose text starts with `redline: `, report that text to the user verbatim, do not retry, and end the turn.

## Never

- Never author, edit, or delete human comments.
- Never call `request_review` in a loop or from a hook.
