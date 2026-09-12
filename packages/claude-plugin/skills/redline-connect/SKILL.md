---
name: redline-connect
description: Attach this session to the reviewer's Redline submits. Invoke after request_review, when VS Code says "No agent is connected", or when the user asks to pick up a review.
argument-hint: "[listen]"
---

# redline-connect

Attach only; rounds come from `redline-annotate` or `redline-tour`. Never call `get_review` with `wait` unless `$ARGUMENTS` is `listen`.

1. Call `redline_ping`. On an error, print its text verbatim and stop.
2. Branch on its `monitor` field:
   - `armed`: say "Listening for Redline submits." and end the turn. The monitor wakes this session with the exact `get_review` call to make; make that call and nothing more.
   - `absent` or `unknown`: call `get_review()` once and act on the result. Then:
     - `$ARGUMENTS` is `listen`: call `get_review({wait: 300})`; act on comments and wait again. On the timeout text, wait again at most three times in one turn, then say "Still listening; run /redline:redline-connect listen to keep waiting." and end the turn.
     - otherwise: say "No monitor here. Submits arrive when you run /redline:redline-connect, or /redline:redline-connect listen to poll for them." and end the turn.
