---
name: local-install
description: Install the redline extension and Claude Code plugin from this checkout. Defaults to VS Code Insiders, default profile.
argument-hint: `--stable` targets `code` instead of `code-insiders`; `--profile <name>` picks a named VS Code profile; `vsix` or `plugin` installs that half alone.
disable-model-invocation: true
---

# local-install

Install both halves from the checkout, verify each, and name the restarts.

`$ARGUMENTS`: `--stable` targets `code` instead of `code-insiders`; `--profile <name>` picks a named VS Code profile; `vsix` or `plugin` installs that half alone.

## Extension

```sh
npm run install:local -- --insiders [--profile <name>]
```

Drop `--insiders` for `--stable`. A non-zero exit on differing versions (extension, server, or the plugin's `scripts/pin.json`) ends the run: report the script's line and stop.

Done when `code-insiders [--profile <name>] --list-extensions --show-versions` lists `nikiforovall.redline-extension@<version>` with the version from `packages/extension/package.json`.

## Plugin

The install is a copy under `~/.claude/plugins/cache/redline/redline/<version>/`, and `claude plugin update` refreshes it only on a version bump, so a plugin edit reaches Claude Code through uninstall plus install. Background in `docs/DEVELOPMENT.md`, section "The plugin".

1. `claude plugin marketplace list` shows a `redline` marketplace whose source is this checkout; otherwise `claude plugin marketplace add <repo root>`.
2. `which redline-mcp` finds a bin; otherwise `npm link -w @nikiforovall/redline-mcp`. The cached launcher has no checkout beside it and reaches the server through this bin.
3. `claude plugin uninstall redline@redline` when `claude plugin list` shows it, then `claude plugin install redline@redline`.

Done when the cache directory above holds `skills/` and `reference/` whose files match `packages/claude-plugin`.

## Report

One line per half installed: version, target CLI and profile for the extension, cache path for the plugin. Then the restarts, since neither host reloads live: reload the VS Code windows with the extension, and start a new Claude Code session.
