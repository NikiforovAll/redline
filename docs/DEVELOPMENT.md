# Local development

redline has two halves that install into two different hosts: a VS Code extension and a Claude Code plugin. Each half has a fast path for editing and a real-install path for trying the whole loop as a user would. Nothing here needs npm publish, a GitHub release, or `npm link`.

## Prerequisites

- Node 22 or newer and npm; the tests run TypeScript files through `node --test`, which needs 22. The repo is an npm workspace; run `npm install` once at the root.
- VS Code with the `code` command on PATH (in VS Code: **Shell Command: Install 'code' command in PATH**).
- Claude Code.
- The GitHub CLI (`gh`) only for [publishing](PUBLISHING.md).

```sh
npm install
npm run build     # protocol (tsc), extension (esbuild)
npm test          # extension, mcp, and plugin launcher suites
```

Shortcuts for each half, detailed below:

```sh
npm run install:local [-- --profile <name>]   # build, package, and install the extension into VS Code
claude --plugin-dir packages/claude-plugin     # load the plugin from source
npm link -w @nikiforovall/redline-mcp          # let an installed plugin run the server from this checkout
```

## The docs site

`docs/` is a VitePress site, published to GitHub Pages by `.github/workflows/pages.yml` on every push to `main` that touches it. `PUBLISHING.md` is excluded from the site.

```sh
npm run docs:dev       # live preview
npm run docs:build     # what the workflow runs; output in docs/.vitepress/dist
```

## Packages

| Package | What it is | Installs into |
| --- | --- | --- |
| `packages/extension` | The VS Code extension: renders a review round as a multi-file diff, collects comment threads, hosts the local socket the MCP server talks to. | VS Code |
| `packages/mcp` | The MCP server, the review monitor, and lock-file discovery. Published to npm as `@nikiforovall/redline-mcp` with a `redline-mcp` bin. | npm (global or npx cache) |
| `packages/claude-plugin` | The Claude Code plugin: the `/redline-annotate`, `/redline-tour`, and `/redline-connect` skills, the monitor registration, and `scripts/launch.mjs`, which finds the server. | Claude Code |
| `packages/protocol` | Shared TypeScript types. | build-time only |

## The extension

**Edit loop: F5.** Open the repo in VS Code and run the **Run redline extension** launch configuration. It starts the esbuild watch task and an Extension Development Host with `packages/extension` loaded. Edits rebuild on save; reload the host window to pick them up. Use this while changing extension code.

**Real install: `npm run install:local`.** Builds, packages `dist/redline-extension-<version>.vsix` with `vsce`, and runs `code --install-extension --force`. This is what a user gets from a release, minus the download. Use it to try the loop from a normal VS Code window.

```sh
npm run install:local                       # default profile
npm run install:local -- --profile dotnet   # a named VS Code profile
npm run install:local -- --insiders         # VS Code Insiders (code-insiders on PATH)
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
2. `redline-mcp` on PATH: `npm link` here, or a user's `npm i -g @nikiforovall/redline-mcp`. It runs `redline-mcp --version` first and warns when that differs from the version in `scripts/pin.json`, since a global install is whatever the user installed.
3. `npx -y @nikiforovall/redline-mcp@<pin.json version>`: a fresh install with nothing else set up. Downloads once into the npm cache. Until the package is published this branch fails, and Claude Code shows the npx error.

Claude Code started from the desktop app can have a shorter PATH than your shell. If the launcher reports `via npx` when you expected the link, that is why; start Claude from a terminal or install globally with the same npm that is on that PATH.

**Same folder open in stable and Insiders.** Each window writes its own lock with `app` (`vscode` or `vscode-insiders`) and `appPid`, the pid of its main process. The MCP server picks the window Claude Code runs in: `VSCODE_PID`, which every child of a window inherits, matches `appPid` exactly; failing that the app is taken from `REDLINE_VSCODE_APP` or from an Insiders integrated terminal (`TERM_PROGRAM_VERSION` ends in `-insider`); failing that the newest window wins. From a plain terminal or tmux, set `REDLINE_VSCODE_APP=vscode-insiders` in the MCP server environment to target Insiders. The `request_review` result names the app it posted to.

To poke the server alone over stdio:

```sh
redline-mcp server              # through the link
node packages/mcp/src/cli.mjs server
```

## Smoke test

1. `npm run install:local`, then open a git repo in VS Code with the extension active.
2. In that repo, start Claude Code with the plugin (either path above) and ask it to call `redline_ping`. Without a matching VS Code window it returns the fixed `redline: no VS Code window ...` text; with one it returns the window's port.
3. Run `/redline-annotate` to open the diff as is, or `/redline-tour` for a numbered walkthrough. The diff opens in VS Code; comment, click Submit, and the session wakes with the comments.

The [guide](https://nikiforovall.blog/redline/guide) has the longer walk-through.

## Playground

`npm run playground -- --insiders` puts you in front of a seeded round without hunting for a repo with changes. It builds a small git repository under `.playground/todo/` from `scripts/playground/fixture/todo/` (`before/` is the baseline commit, `after/` the uncommitted edits), opens it in VS Code, waits for the extension's lock file, and posts a round with tour notes plus three reviewer comments from `scenario.json`. Comments and notes anchor by a `match` line, so editing the fixture files does not break them. Then start Claude Code in `.playground/todo`, run `/redline:redline-connect`, submit from VS Code, and ask for the change.

Flags follow `install:local`: `--insiders`, `--profile <name>`. `--reset` rebuilds the repository, `--no-seed` skips the reviewer comments, `--scenario <name>` picks another fixture folder. Seeding uses `POST /debug/threads` on the extension's server, which exists for this harness only.
