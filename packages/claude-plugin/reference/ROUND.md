# Posting a round

## Pick the source

Argument `r` followed by digits is a round id, as **Copy round id** in VS Code puts on the clipboard: that round is the target. Find it in `list_reviews` (missing: say so and stop), pass its id as `roundId` with no `source`, and read the diff of its stored `source` as below.

Any other argument: resolve in this order and say which reading you used.

1. Path to an existing `.patch` or `.diff` file: `{kind: "patch", text: <file contents>}`.
2. `staged`, `unstaged`, or `all`: `{kind: "worktree", scope: <arg>}`.
3. `a..b`: `{kind: "range", from: "a", to: "b"}`. `a...b`: `from: "a...", to: "b"`; the dots on `from` keep the three-dot form. `to` may be `worktree` (files on disk, untracked included) or `index` (staged files) to compare a ref against uncommitted work, for example `main..worktree`.
4. `--files <a> <b>`: `{kind: "files", pairs: [{left: a, right: b}]}`.
5. A ref that `git rev-parse --verify <arg>^{commit}` accepts: a branch or an older commit means `{kind: "range", from: <arg>, to: "HEAD"}`; a single commit the user wants on its own means `from: <arg>~1, to: <arg>`. Prefer the branch reading when unsure.
6. Anything else: ask once, then use `all`.

No argument:

1. Call `list_reviews`. Newest round has a `worktree` or `range` source, submitted or not: that round is the target. Pass its id as `roundId`, no `source`, and read its diff as below. The reviewer opened it with **Compare…** and expects the notes there.
2. Otherwise run `git status --porcelain`. Empty tree: say there is nothing to review and stop.
3. All of your changes this session are unstaged and nothing is staged: `scope: "unstaged"`.
4. You staged your changes and nothing else is unstaged: `scope: "staged"`.
5. Otherwise, or when you cannot tell what you changed: `scope: "all"`.

## Read the diff of a targeted round

A `worktree` source is `git diff` for `unstaged`, `git diff --cached` for `staged`, both plus untracked files for `all`. The `from` and `to` of a `range` are redline spellings, not plain git arguments:

- `from` ending in dots is three-dot: `git diff <from><to>`. Otherwise `git diff <from>..<to>`.
- `to: "worktree"`: `git diff <from>` plus untracked files.
- `to: "index"`: `git diff --cached <from>`.

## Title

`title`: the user's original task, under 80 characters.

## Call request_review

Call `request_review({source, title, notes})` once, or `request_review({roundId, title, notes})` for a targeted round. Report its first sentence, the source label and file count, in one line, then invoke the `redline:redline-connect` skill.

A result whose text starts with `redline: ` is a remediation for the user: print it verbatim and end the turn.

## One round per source

A worktree scope or range that already has a round refreshes that round instead of opening another: the diff is rebuilt, the reviewer's threads move to the new lines, and threads whose lines are gone stay listed as detached. A `Kept` result means the diff is empty, usually because the work was committed; the round stays as the reviewer last saw it. After you edit in response to a review, call `request_review` again on the same source so the reviewer sees the result; notes are optional there. Patches and file pairs always open a new round.
