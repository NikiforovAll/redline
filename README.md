# redline

redline is a spike for an agent review loop. Claude Code collects the changes it just made, opens them as a multi-file diff in VS Code with its own notes attached, and waits. You read the diff, leave comments on the lines you care about, and click Submit. Claude wakes with those comments and edits the code. The repo holds four packages: `packages/extension`, a VS Code extension that renders the review round and collects comment threads; `packages/mcp`, published to npm as `@nikiforovall/redline-mcp` (bin `redline-mcp`), holding the MCP server, the review monitor, and the lock-file discovery both sides share; `packages/claude-plugin`, the Claude Code plugin itself — the `/redline-annotate` skill, the monitor registration, and a launcher that finds the server in a checkout, on PATH, or through npx; and `packages/protocol`, the shared TypeScript types.

## Install

Plugin, from Claude Code:

```
/plugin marketplace add nikiforovall/redline
/plugin install redline@redline
```

Extension, from a shell with `code` on PATH and `gh` signed in to the repo:

```sh
node ~/.claude/plugins/cache/redline/redline/<version>/scripts/install-extension.mjs [--profile <name>]
```

The plugin does nothing without the extension. Rerun the script to update it; a plugin update does not update the extension.

## Develop

```sh
npm install
npm run build
npm test
npm run install:local [-- --profile <name>]   # build, package, and install the extension into VS Code
claude --plugin-dir packages/claude-plugin     # load the plugin from source
npm link -w @nikiforovall/redline-mcp          # let an installed plugin run the server from this checkout
```

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers the edit loops (F5 dev host, `--plugin-dir`) and the real-install paths (`.vsix`, local directory marketplace) for each half. [docs/PUBLISHING.md](docs/PUBLISHING.md) covers versioning, `npm run release`, and what changes when the repo goes public.
