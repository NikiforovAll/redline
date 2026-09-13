# Security

## Reporting

Report a vulnerability through [GitHub private vulnerability reporting](https://github.com/nikiforovall/redline/security/advisories/new). Do not open a public issue for it. Expect an acknowledgement within a week.

## What Redline exposes

The extension starts an HTTP server on `127.0.0.1` on a random port for each VS Code window. Every request needs a bearer token that the extension generates at startup and writes, with the port, to a lock file under `~/.redline/` in the user's home directory. The MCP server that Claude Code runs reads that file to find the window. Nothing listens on other interfaces, and nothing is sent off the machine except the optional GitHub avatar request, which `redline.avatar: none` turns off.

A report is in scope when it lets a process without access to the lock file reach the server, lets a review round read or write files outside the workspace, or lets a comment or note execute anything. Supported version: the latest release.
