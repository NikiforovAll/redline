---
layout: home

hero:
  name: Redline
  text: Code review for Claude Code and VS Code
  tagline: A two-way code review between you and Claude Code, inside VS Code. Claude posts its review of a diff as comment threads on the lines. You answer, add your own, and submit. Claude works through every thread, edits the code, and replies in place.
  image:
    src: /review-interactive-demo.png
    alt: A review round in VS Code with a reviewer question, Claude's reply, and the Claude Code session that woke on submit
  actions:
    - theme: brand
      text: Get started
      link: /guide
    - theme: alt
      text: Reference
      link: /reference
    - theme: alt
      text: View on GitHub
      link: https://github.com/nikiforovall/redline

features:
  - title: Review mode
    details: Claude reads the diff and posts its findings as comment threads on the exact lines. It reads like a pull request review, without the pull request.
  - title: Tour mode
    details: Claude walks you through its own change as numbered stops on the diff. Step through them with one shortcut and read the code the way the author meant it to be read.
  - title: You review back
    details: The round opens as a native VS Code multi-diff. Reply inside Claude's threads or start your own with the built-in Comments panel.
  - title: Every thread gets an answer
    details: Submit hands every thread back to the waiting session. Claude lands the change and resolves the thread with a note, or asks a question and waits for you.
  - title: Any diff, either start
    details: Claude's own changes, a branch, a range, or a patch. Ask Claude to open a round, or review the working tree yourself and Claude picks it up with /redline-connect.
  - title: Local only
    details: The two halves talk over localhost. No account and no telemetry.
---

## Two ways to use it

**Review.** Ask Claude to review a diff, then type `/redline:redline-annotate`. The findings land as threads on the lines they are about. You answer each one, add your own, and submit. Claude fixes what you agreed on and replies where you asked a question.

<video src="/demo-generate-review.mp4" autoplay muted loop playsinline controls style="width: 100%; border-radius: 8px;"></video>

*A code review becomes a round: `/redline:redline-annotate` posts the findings, a reply wakes the session, and the fix lands in the thread.*

**Tour.** After Claude makes a change, type `/redline:redline-tour`. Claude picks the parts of the diff you need to understand and posts a numbered note on each, in reading order rather than file order. `Ctrl+Alt+]` steps to the next stop. It is the fastest way to catch up on a change you did not write, and every stop is a thread you can question.

## How it works

Redline has two halves. A VS Code extension renders review rounds and collects your comment threads. A Claude Code plugin adds an MCP server that finds the VS Code window with the same folder open, posts a round, and hands your comments back when you submit. The plugin also adds the skills that open a round and reconnect to one.

<video src="/demo-after-review.mp4" autoplay muted loop playsinline controls style="width: 100%; border-radius: 8px;"></video>

*After a submit: every thread carries Claude's answer, resolved threads collapse, and the round stays open for the next pass.*

![A review round: the diff with agent notes and a comment thread, the Comments panel, and the Review Rounds tree](/review-demo.png)

## Install

Plugin, from Claude Code:

```
/plugin marketplace add nikiforovall/redline
/plugin install redline@redline
```

Extension: download `redline-extension-<version>.vsix` from the [latest release](https://github.com/nikiforovall/redline/releases/latest), then in VS Code run **Extensions: Install from VSIX...** or `code --install-extension <file>.vsix`.

Then read the [guide](/guide) for one round end to end.
