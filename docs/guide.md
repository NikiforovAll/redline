# Guide

## Install

Both halves are needed. The plugin does nothing without the extension.

### Plugin

From Claude Code:

```
/plugin marketplace add nikiforovall/redline
/plugin install redline@redline
```

This adds the skills `/redline:redline-tour`, `/redline:redline-annotate`, and `/redline:redline-connect`, and the `redline` MCP server. Start a new Claude Code session to load them.

### Extension

Download `redline-extension-<version>.vsix` from the [latest release](https://github.com/nikiforovall/redline/releases/latest) and install it with **Extensions: Install from VSIX...** in VS Code, or:

```sh
code --install-extension redline-extension-<version>.vsix
```

Reload open VS Code windows afterwards. Updating the plugin does not update the extension.

## A review round

A round is a diff opened in VS Code like a pull request, with Claude's notes attached as comment threads on the lines. Claude can start one in two modes, review or tour, and you can start one yourself.

### Review mode

Ask Claude to review a diff, for example with `/code-review`, or let it finish a change. Then type:

```
/redline:redline-annotate
```

Claude opens the diff as a round and posts the review it just wrote as threads on the lines it talks about. It reports one line, such as `Opened round r1 (unstaged changes, 3 files, 5 notes)`, then waits for your submit.

### Tour mode

After Claude makes a change you want to understand, type:

```
/redline:redline-tour
```

Claude reads its diff and decides where a reader should start. Usually that is the entry point or the type everything else depends on, then the callers, then the tests. It picks the hunks you need to understand, skips the mechanical ones, and posts one numbered note per stop with what the hunk does and why the change needs it. `Ctrl+Alt+]` and `Ctrl+Alt+[` step through the stops, and the Redline panel lists them in order.

Every stop is a normal thread. Reply on one to ask about that hunk, submit, and Claude answers there. Anything Claude noticed while writing the tour, such as a risk or a better approach, goes in its chat reply rather than on the diff, so the tour stays a tour.

### Source

Both skills take an optional source: `staged`, `unstaged`, `all`, a ref or range such as `main` or `a..b`, a `.patch` file, or `--files <left> <right>`. Without one, Claude uses its own changes.

### You start: Review working tree

In VS Code, open the **Redline** panel (bottom panel, next to Terminal) and click **Review working tree**, or run `Redline: Review working tree` from the Command Palette. The round opens without notes. Write your threads, submit, then in Claude Code type:

```
/redline:redline-connect
```

Claude fetches the submitted comments and works through them. When Claude Code runs a monitor for this session, submits reach it on their own and the skill only confirms it is listening. Without one, `/redline:redline-connect listen` polls for submits for a while.

### The round view

The round opens as a multi-file diff tab named after the round. Notes appear as read-only comment threads on the right side of each hunk. The **Redline** panel lists every round, newest first. Expand a round to see its source, when it was opened or submitted, and one row per note with its file and line. Click a note row to jump to it. `Ctrl+Alt+]` and `Ctrl+Alt+[` step through the notes in tour order.

### Writing threads

Hover a changed line and click **+** to start a thread. Reply inside a note to answer Claude on that hunk. Redline sends only threads that hold a comment of yours.

The thread title bar has **Send to Agent**, which sends this one thread now without submitting the round, and **Mark resolved**, which becomes **Reopen thread** on a resolved thread. Their shortcuts act on the thread nearest the cursor in the active diff, or on the note you last stepped to.

### Submit

Click **Submit review** in the round view title bar, in the Comments panel title bar, or press `Ctrl+Alt+R S`. Submit sends every open thread with your comment. VS Code confirms `Redline: sent 3 comments in 2 files to Claude`. When no Claude Code session is listening, VS Code queues the comments and the message tells you to run `/redline:redline-connect`.

### What Claude receives

One markdown document per fetch:

````markdown
# Review r1: unstaged changes, 2 comments in 2 files

Done thread (change landed, or declined with a reason): resolve_comment(id). Reviewer's turn (question, proposal, answer): reply_comment(id), thread stays open.

## src/app.ts

### :2 right  [t-97a96a8e]
```diff
-export function greet(name: string) {
+export function greet(name: string, punctuation = "!") {
```
**you:** Make punctuation required; the default hides call sites that forgot it.
````

Claude works through the threads in file order. Each thread ends in one of two ways. When the change landed, or Claude declined it and said why, Claude closes the thread with `resolve_comment` and a one-line note, and VS Code shows it as resolved. When Claude has a question or a proposal instead, it posts that with `reply_comment` and the thread stays open for you. Claude never edits or deletes a comment you wrote. It finishes with a summary per thread and offers a new round on the same source.
