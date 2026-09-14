# Guide

## Install

Both halves are needed: the VS Code extension renders rounds, the Claude Code plugin gives Claude the skills and the MCP server. Start with the extension; it installs the plugin for you.

### Extension

Search for **Claude Code Redline** in the Extensions view and install it, or:

```sh
code --install-extension nikiforovall.redline-extension
```

VS Code updates the extension on its own.

### Plugin

When the extension does not find the plugin, it opens a **Get started with Redline** walkthrough. The first step has an **Install plugin** button that runs the install in a terminal and completes once the plugin appears in Claude Code's registry. Reopen the walkthrough any time with **Redline: Get started**.

By hand, from Claude Code:

```
/plugin marketplace add nikiforovall/redline
/plugin install redline@redline
```

Either way this adds the skills `/redline:redline-tour`, `/redline:redline-annotate`, and `/redline:redline-connect`, and the `redline` MCP server. Start a new Claude Code session to load them.

## A review round

A round is a diff opened in VS Code like a pull request, with Claude's notes attached as comment threads on the lines. Claude can start one in two modes, review or tour, and you can start one yourself.

### Review mode

Ask Claude to review a diff, for example with `/code-review`, or let it finish a change. Then type:

```
/redline:redline-annotate
```

Claude opens the diff as a round and posts the review it just wrote as threads on the lines it talks about. It reports one line, such as `Opened unstaged changes (3 files, 5 notes)`, then waits for your submit.

### Tour mode

After Claude makes a change you want to understand, type:

```
/redline:redline-tour
```

Claude reads its diff and decides where a reader should start. Usually that is the entry point or the type everything else depends on, then the callers, then the tests. It picks the hunks you need to understand, skips the mechanical ones, and posts one numbered note per stop with what the hunk does and why the change needs it. `Ctrl+Alt+]` and `Ctrl+Alt+[` step through the stops, and the Redline panel lists them in order.

Every stop is a normal thread. Reply on one to ask about that hunk, submit, and Claude answers there. Anything Claude noticed while writing the tour, such as a risk or a better approach, goes in its chat reply rather than on the diff, so the tour stays a tour.

### Source

Both skills take an optional source: `staged`, `unstaged`, `all`, a ref or range such as `main`, `a..b`, or `main..worktree`, a `.patch` file, or `--files <left> <right>`. Without one, Claude uses its own changes.

### You start: Compare

In VS Code, open the **Redline** view (secondary sidebar, toggle it with `Ctrl+Alt+B`) and click **Compare…**, or press `Ctrl+Alt+R C`. Two quick picks follow, in the order GitLens uses. The first asks what to review: **Working tree**, **Index**, `HEAD`, a branch, a remote branch, or a tag; you can also type a commit hash or any revision, checked before you can choose it. The second asks what to compare it against, with the default branch preselected, so **Working tree** then Enter twice reviews your uncommitted work against `main`. A branch as base gives the pull-request view, only what the branch added since it forked. Picking a pair with no differences shows a message and opens nothing.

The round opens without notes. To have Claude walk you through it, type `/redline:redline-tour` in Claude Code with no argument: it targets the newest round in the view, whatever pair you picked, and adds its title and numbered notes there instead of opening a second round. For an older round, right-click it, choose **Copy round id**, and paste the id after the command. Or write your threads first, submit, then in Claude Code type:

```
/redline:redline-connect
```

Claude fetches the submitted comments and works through them. When Claude Code runs a monitor for this session, submits reach it on their own and the skill only confirms it is listening. Without one, `/redline:redline-connect listen` polls for submits, see [Terminal or VS Code extension](#terminal-or-vs-code-extension).

### The round view

The round opens as a multi-file diff tab named after its source, such as `Redline: unstaged changes`. Notes appear as read-only comment threads on the right side of each hunk. The **Redline** panel lists every round, newest first, as `unstaged changes · 3 files · 2 open`. Expand a round to see Claude's title when it sent one, when the round was opened, refreshed, or submitted, and a **Notes** group with one row per note with its file and line. Click a note row to jump to it. `Ctrl+Alt+]` and `Ctrl+Alt+[` step through the notes in tour order. A step opens the note's file as a single diff in one preview tab, so the multi-file tab stays where you left it.

### One round per source

A source has one round. When Claude calls `request_review` again on the source of an open round, for example after it edits in response to your comments, the round refreshes in place: the diff is rebuilt from the working tree, your threads move to the lines they were about, and the round returns to open. Click **Refresh round** on the round row, or run `Redline: Refresh round`, to rebuild it yourself without waiting for Claude.

A thread whose line is gone from the diff becomes **detached**. It stays in the panel as `src/store.ts:120 · detached`, open or resolved, and its widget moves to the last line the diff still reaches, labelled `(new, detached)`, so the question and its answer survive the fix that removed the line. Click it to open the file's diff on that widget. Submit still sends open detached threads, and Claude sees them marked `(detached)` with their last context. When the line comes back, the thread re-attaches on the next refresh.

A refresh that finds no diff, usually because the work was committed, changes nothing: Claude reports `Kept unstaged changes: nothing uncommitted to refresh from` and you keep the round as it was. Drop it when you are done. A range such as `main..HEAD` is its own round. Patches and `--files` always open a new round.

### Writing threads

Hover a changed line and click **+** to start a thread. Reply inside a note to answer Claude on that hunk. Redline sends only threads that hold a comment of yours.

The thread title bar has **Send to Agent**, which sends this one thread now without submitting the round, and **Mark resolved**, which becomes **Reopen thread** on a resolved thread. Their shortcuts act on the thread nearest the cursor in the active diff, or on the note you last stepped to.

### Submit

Click **Submit review** in the round view title bar or press `Ctrl+Alt+R S`. Submit sends every open thread with your comment. VS Code confirms `Redline: sent 3 comments in 2 files to Claude`. When no Claude Code session is listening, VS Code queues the comments and the message tells you to run `/redline:redline-connect`.

### Terminal or VS Code extension

Run Claude Code in a terminal. There the plugin registers a monitor, so a submit wakes the session on its own and Claude answers without you touching the chat.

The Claude Code VS Code extension runs no plugin monitors. A submit cannot wake a session in the chat panel, and `redline_ping` reports `monitor: absent` there. Pull instead:

```
/redline:redline-connect listen
```

Claude polls for submits for up to five minutes per call, three calls per turn, then asks you to run it again. Plain `/redline:redline-connect` fetches what is queued once. Polling works, but the session is busy while it waits, so keep review sessions in a terminal.

### What Claude receives

One markdown document per fetch:

````markdown
# Review: unstaged changes, 2 comments in 2 files

Done thread (change landed, or declined with a reason): resolve_comment(id). Reviewer's turn (question, proposal, answer): reply_comment(id), thread stays open.

## src/app.ts

### :2 right  [t-97a96a8e]
```diff
-export function greet(name: string) {
+export function greet(name: string, punctuation = "!") {
```
**you:** Make punctuation required; the default hides call sites that forgot it.
````

Claude works through the threads in file order. Each thread ends in one of two ways. When the change landed, or Claude declined it and said why, Claude closes the thread with `resolve_comment` and a one-line note, and VS Code shows it as resolved. When Claude has a question or a proposal instead, it posts that with `reply_comment` and the thread stays open for you. Claude never edits or deletes a comment you wrote. It finishes with a summary per thread and calls `request_review` again on the same source, which refreshes the round with its edits.
