# Posting a round

## Pick the source

Argument given: resolve in this order and say which reading you used.

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

## Title

`title`: the user's original task, under 80 characters.

## Call request_review

Call `request_review({source, title, notes})` once. Report the round id and file count in one line, then invoke the `redline:redline-connect` skill.

A result whose text starts with `redline: ` is a remediation for the user: print it verbatim and end the turn.
