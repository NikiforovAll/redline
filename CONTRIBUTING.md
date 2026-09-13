# Contributing

Bug reports and pull requests are welcome. For anything larger than a fix, open an issue first so the shape is agreed before the code exists.

## Setup

Node 18 or newer, VS Code with the `code` command on PATH, and Claude Code. Then:

```sh
npm install
npm run build
npm test
```

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers each package, how to run the extension from source, how to load the plugin from the checkout, and a smoke test that walks one review round end to end.

## Pull requests

- One change per pull request, with the tests that show it works. The three suites run with `npm test`; the extension also has `npm run typecheck -w redline-extension`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`. The release notes are generated from them.
- Do not bump versions. The extension and the MCP server share one version and the plugin pins it; [docs/PUBLISHING.md](docs/PUBLISHING.md) explains the rule and the release flow, which maintainers run.
- Protocol changes touch `packages/protocol` first, then both sides that speak it, in one pull request.

## Reporting a bug

Include the VS Code and Claude Code versions, the extension version from the Extensions view, the plugin version from `claude plugin list`, your OS, and what `redline_ping` returns in the Claude Code session. Security issues go through [SECURITY.md](SECURITY.md) instead of the issue tracker.
