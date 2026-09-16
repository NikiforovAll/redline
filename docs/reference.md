# Reference

## Skills

Claude Code skills from the `redline` plugin. Invoke them as `/redline:<name>`.

| Skill              | Does                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redline-tour`     | Opens the current diff as a round with a numbered walkthrough: Claude picks the parts a reader must understand and notes each one, in reading order. Then invokes `redline-connect`. Takes an optional [source](/guide#source) or a round id from **Copy round id**. |
| `redline-annotate` | Opens the current diff as a round with only the notes Claude already wrote in this session, or none. Then invokes `redline-connect`. Same source argument.                                                          |
| `redline-connect`  | Attaches the session to submits from VS Code. Confirms the monitor when one runs, else fetches submitted comments once. `redline-connect listen` polls for up to 5 minutes per call, three calls per turn. Use it from the Claude Code VS Code extension, which runs no monitors. |

`redline-tour` and `redline-annotate` run only when you type them. `redline-connect` can also be invoked by Claude, and the two round skills invoke it.

## Commands and shortcuts

Every chord starts with the leader `Ctrl+Alt+R` (`Cmd+Alt+R` on macOS). Press the leader, release, then the key.

| Command                           | Keys                    | Does                                                                                                                                         |
| --------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Redline: Open latest round        | `Ctrl+Alt+R O`          | Opens the newest round as a multi-file diff.                                                                                                 |
| Redline: Open review round        | `Ctrl+Alt+R H`          | Picks a round from history and opens it.                                                                                                     |
| Redline: Submit review            | `Ctrl+Alt+R S`          | Sends every open thread with your comment in the active round. Asks which round when more than one is open.                                  |
| Redline: Next note                | `Ctrl+Alt+]`            | Jumps to the next note in tour order. No leader.                                                                                             |
| Redline: Previous note            | `Ctrl+Alt+[`            | Jumps to the previous note. No leader.                                                                                                       |
| Send to Agent                     | `Ctrl+Alt+R Enter`      | Sends the thread under the cursor now, without submitting the round. The thread needs your comment first.                                   |
| Mark resolved / Reopen thread     | `Ctrl+Alt+R R`          | Toggles resolved on the thread under the cursor.                                                                                             |
| Edit comment / Delete comment     |                         | On your own comments, in the comment's title bar. Edit opens the text in place; Save or Cancel finish it. Neither changes what Claude already fetched, and neither reopens or re-queues the thread. Deleting the last comment removes the thread. |
| Redline: Toggle Redline view      | `Ctrl+Alt+R V`          | Shows or hides the Redline view in the secondary sidebar.                                                                                     |
| Redline: Compare…                 | `Ctrl+Alt+R C`          | Picks what to review, then what to compare it against, and opens or refreshes that round with no notes. Working tree and index are pickable. |
| Redline: Refresh round            |                         | Rebuilds the round's diff from its source and moves your threads to the new lines. Threads whose lines are gone become detached.             |
| Redline: Copy round id            |                         | Copies the round's id, such as `r3`, to the clipboard. Paste it as the argument of `/redline:redline-tour` or `/redline:redline-annotate` to target that round. |
| Redline: Drop review round        |                         | Removes one round from the view and storage.                                                                                                 |
| Redline: Drop all review rounds   |                         | Removes every round.                                                                                                                         |
| Reload view                       |                         | Reloads the round view.                                                                                                                      |
| Redline: Get started              |                         | Opens the **Get started with Redline** walkthrough. It opens on its own once, when the extension does not find the Claude Code plugin.       |
| Redline: Install the Claude Code plugin |                   | Runs the marketplace add and plugin install in a terminal. Also the button on the first walkthrough step.                                    |
| Redline: Check the Claude Code plugin |                     | Re-reads Claude Code's plugin registry and updates the walkthrough step.                                                                     |
| Redline: Reset onboarding         |                         | Forgets that the walkthrough was shown and opens it again.                                                                                   |

Thread commands act on the thread nearest the cursor in the active diff, else on the note you last stepped to. Rebind any of them under **Keyboard Shortcuts** by searching `redline`.

### Where the buttons are

- **Round view** (the **Redline** panel): Compare, Submit review, previous and next note, and Drop all in the title bar. Open latest round, Refresh round, Copy round id, Reload view, and Drop review round in the `...` menu. Each round row has Submit, Refresh round, and Open inline, and Copy round id and Drop review round on right-click. The Files row lists the round's scope with the same status letters and colors as Source Control (A, M, D, R, and B for binary) and each file's note count; click a file to open its diff. The Notes row has Delete resolved notes and Delete all notes on right-click. Each note row has Send to Agent, Mark resolved or Reopen note, Copy note id, Copy note as Markdown, and Delete note on right-click; select several notes with Ctrl or Shift to resolve, reopen, or delete them together.
- **Thread title bar**: Send to Agent, Mark resolved or Reopen thread.
- **Comment title bar**, on your comments only: Edit comment, Delete comment.
- **Thread footer**: Comment, and Send to Agent, which saves the reply you are typing and sends it.

## Settings

| Setting          | Values             | Default  | Does                                                                                                                                                                 |
| ---------------- | ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redline.avatar` | `github`, `none`   | `github` | Identity on your comments. `github` shows the login and avatar of the GitHub account VS Code is signed in with; nothing is fetched until a session exists. `none` shows the OS user name with the built-in icon. |

## MCP tools

The plugin registers an MCP server named `redline`. Claude calls these; you rarely type them, but they explain what Claude is doing.

| Tool              | Arguments                                                        | Does                                                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request_review`  | `source` or `roundId`, `title?`, `notes?`                        | Opens a round in the VS Code window with this folder open, or refreshes the open round of the same `worktree` or `range` source. With `roundId`, refreshes that round from its stored source, so notes land in a round you opened with **Compare…**. Returns `Opened`, `Refreshed`, or `Kept` with the source label and counts. Notes on files outside the diff are dropped and reported. |
| `add_notes`       | `roundId`, `notes`                                               | Posts notes under an existing round, each as a thread on the diff as it stands. No rebuild, no submit, no new round; use it for a remark you ask Claude to leave. |
| `get_review`      | `roundId?`, `threads?`, `wait?` (seconds, max 300)              | Returns the submitted comments of a round as markdown and marks them delivered. Without `roundId`, the newest round with undelivered comments. With `wait`, blocks until a submit or the timeout.                                                          |
| `list_reviews`    |                                                                  | Lists the rounds of this window, newest first, with file count, open threads, state, and source.                                                                                                                                                          |
| `resolve_comment` | `threadId`, `body?`                                              | Closes a thread with a one-line note on what changed. VS Code shows the thread as resolved.                                                                                                                                                              |
| `reply_comment`   | `threadId`, `body`                                               | Posts a reply and leaves the thread open for the reviewer.                                                                                                                                                                                                 |
| `redline_ping`    |                                                                  | Finds the window and returns its port, app, version, workspace folders, and a `monitor` field: `armed` when a submit will wake this session on its own, `absent` or `unknown` otherwise.                                                                    |

`source` is one of:

```json
{ "kind": "worktree", "scope": "staged" | "unstaged" | "all" }
{ "kind": "range", "from": "main", "to": "HEAD" | "worktree" | "index" }
{ "kind": "patch", "text": "<unified diff>" }
{ "kind": "files", "pairs": [{ "left": "a.ts", "right": "b.ts" }] }
```

A note is `{ file, line, body }`: one comment thread on the diff. `line` is on the new side, and the thread snaps to the first changed line of the hunk that contains it. `body` is markdown; the Comments panel previews its first line. Relative links resolve against the workspace root and `#L<line>` opens the file at that line.

### Window selection

The extension writes one lock file per VS Code window under `~/.redline/` (`REDLINE_HOME` overrides the directory). The MCP server picks the window whose workspace folder contains Claude Code's working directory. With the same folder open in VS Code stable and Insiders, it prefers the window Claude Code runs in; from a plain terminal, set `REDLINE_VSCODE_APP=vscode-insiders` in the MCP server environment to target Insiders. The `request_review` result names the app it posted to.

## Error text

Every tool result that starts with `redline:` names something for you to fix. Claude prints it verbatim and stops instead of retrying.

| Text starts with                                                                 | Fix                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redline: no VS Code window has this folder open with the redline extension`     | Open the folder Claude Code runs in as a workspace folder in VS Code, with the extension [installed](/guide#extension) and enabled. Check the Redline panel exists in that window. Then ask Claude to retry. |
| `redline: the VS Code window for <folder> is not answering (stale lock)`         | The window closed without cleanup or the extension crashed. Run **Developer: Reload Window** in that VS Code window, then retry.                                                                          |
| `redline: this folder is not a git repository`                                   | Claude Code runs outside a repository. Start it inside one, or pass a source that needs no git: a patch file or `--files`.                                                                                |
| `redline: the requested revision does not exist`                                 | The ref in the source argument is unknown to git. Check the branch or commit name.                                                                                                                       |
| `redline: git could not produce the diff (<git's line>)`                         | Git failed for another reason; the parenthesis carries its first line. Fix that, then retry.                                                                                                             |
| `redline: reply_comment needs body`                                              | Claude called the tool with the wrong argument shape. Ask it to retry; no action on your side.                                                                                                            |

Two messages come from VS Code instead of Claude:

| Message                                                            | Meaning                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `Redline: submitted N comments. Queued; /redline:redline-connect in Claude Code picks it up.` | No session is listening. Run `/redline:redline-connect` in Claude Code, in the same folder, to fetch them.          |
| `Redline: nothing to send in <source>. Only open threads with your comment are sent.` | Write a comment in a thread first. Claude's notes alone are not sent back.                                          |
