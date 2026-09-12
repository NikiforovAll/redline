# Local development

redline has two halves that install into two different hosts: a VS Code extension and a Claude Code plugin. Each half has a fast path for editing and a real-install path for trying the whole loop as a user would. Nothing here needs npm publish, a GitHub release, or `npm link`.

## Prerequisites

- Node 18 or newer and npm. The repo is an npm workspace; run `npm install` once at the root.
- VS Code with the `code` command on PATH (in VS Code: **Shell Command: Install 'code' command in PATH**).
- Claude Code.
- The GitHub CLI (`gh`) only for [publishing](PUBLISHING.md).

```sh
npm install
npm run build     # protocol (tsc), extension (esbuild)
npm test          # extension, mcp, and plugin launcher suites
```

## Packages

| Package | What it is | Installs into |
| --- | --- | --- |
| `packages/extension` | The VS Code extension: renders a review round as a multi-file diff, collects comment threads, hosts the local socket the MCP server talks to. | VS Code |
| `packages/mcp` | The MCP server, the review monitor, and lock-file discovery. Published to npm as `@nikiforovall/redline-mcp` with a `redline-mcp` bin. | npm (global or npx cache) |
| `packages/claude-plugin` | The Claude Code plugin: the `/redline-annotate` and `/redline-tour` skills, the monitor registration, and `scripts/launch.mjs`, which finds the server. | Claude Code |
| `packages/protocol` | Shared TypeScript types. | build-time only |

## The extension

**Edit loop: F5.** Open the repo in VS Code and run the **Run redline extension** launch configuration. It starts the esbuild watch task and an Extension Development Host with `packages/extension` loaded. Edits rebuild on save; reload the host window to pick them up. Use this while changing extension code.

**Real install: `npm run install:local`.** Builds, packages `dist/redline-extension-<version>.vsix` with `vsce`, and runs `code --install-extension --force`. This is what a user gets from a release, minus the download. Use it to try the loop from a normal VS Code window.

```sh
npm run install:local                       # default profile
npm run install:local -- --profile dotnet   # a named VS Code profile
```

Reload open VS Code windows afterwards. The install is idempotent: rerun it after every change you want to try outside the dev host. To remove it:

```sh
code [--profile <name>] --uninstall-extension nikiforovall.redline-extension
```

## The plugin

**Edit loop: `--plugin-dir`.** Load the plugin straight from the checkout:

```sh
claude --plugin-dir packages/claude-plugin
```

`scripts/launch.mjs` sees `packages/mcp/src` beside it and runs the server and monitor from source, so edits to `packages/mcp` apply on the next Claude session with no build or link step. The skill and manifests are read from the checkout too.

**Real install: a directory marketplace plus `npm link`.** The repo root is a plugin marketplace, and Claude Code accepts a local path as a marketplace source:

```sh
npm link -w @nikiforovall/redline-mcp                      # puts a redline-mcp bin on PATH, pointing at packages/mcp
claude plugin marketplace add C:/Users/<you>/dev/redline
claude plugin install redline@redline
```

This copies `packages/claude-plugin` into `~/.claude/plugins/cache/redline/redline/<version>/`. Nothing else from the repo comes along, so the copied launcher has no checkout beside it and looks for `redline-mcp` on PATH, which the link provides. That is the same shape a GitHub install produces for a user with a global install, which makes it the right way to check the plugin as a user would see it. Edits to `packages/mcp` apply on the next session through the link. Edits to the plugin itself need the copy refreshed, and `claude plugin update` only acts on a version bump, so reinstall:

```sh
claude plugin uninstall redline@redline
claude plugin install redline@redline       # restart Claude Code to apply
```

Do not run both at once for the same session: `--plugin-dir` and the installed plugin register the same MCP server name and the same skill.

## The MCP server

`scripts/launch.mjs` is the plugin's only entrypoint for both the MCP server and the monitor. It resolves the server in this order and says which branch it took on stderr:

1. `packages/mcp/src` beside the plugin: a checkout under `--plugin-dir`.
2. `redline-mcp` on PATH: `npm link` here, or a user's `npm i -g @nikiforovall/redline-mcp`. It runs `redline-mcp --version` first and warns when that differs from `plugin.json`, since a global install is whatever the user installed.
3. `npx -y @nikiforovall/redline-mcp@<plugin.json version>`: a fresh install with nothing else set up. Downloads once into the npm cache. Until the package is published this branch fails, and Claude Code shows the npx error.

Claude Code started from the desktop app can have a shorter PATH than your shell. If the launcher reports `via npx` when you expected the link, that is why; start Claude from a terminal or install globally with the same npm that is on that PATH.

To poke the server alone over stdio:

```sh
redline-mcp server              # through the link
node packages/mcp/src/cli.mjs server
```

## Smoke test

1. `npm run install:local`, then open a git repo in VS Code with the extension active.
2. In that repo, start Claude Code with the plugin (either path above) and ask it to call `redline_ping`. Without a matching VS Code window it returns the fixed `redline: no VS Code window ...` text; with one it returns the window's port.
3. Run `/redline-annotate` to open the diff as is, or `/redline-tour` for a numbered walkthrough. The diff opens in VS Code; comment, click Submit, and the session wakes with the comments.

`_plans/arev-spike/demo.md` has the longer walk-through.
