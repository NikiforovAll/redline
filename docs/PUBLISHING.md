# Publishing

redline ships three artifacts from one private repo, on one version:

- **The Claude Code plugin** (`packages/claude-plugin`). Installed with `/plugin marketplace add nikiforovall/redline` and `/plugin install redline@redline`. Claude Code copies the plugin directory from git at install time; there is no upload step. It contains no server code, only `scripts/launch.mjs`, which finds the server.
- **The MCP server** (`packages/mcp`). Published to npm as `@nikiforovall/redline-mcp` with a `redline-mcp` bin. The launcher runs `npx -y @nikiforovall/redline-mcp@<version>` unless a global install or a checkout is found first. **Publishing is deferred**; until it happens, fresh plugin installs fail at the npx step and only linked or global installs work.
- **The VS Code extension** (`packages/extension`). Shipped as a `.vsix` attached to a GitHub release tagged `vX.Y.Z`. The public VS Code marketplace is not used while the repo is private.

`@redline/protocol` is a private workspace package and is not published.

## One version, three manifests

`packages/extension/package.json`, `packages/mcp/package.json`, and `packages/claude-plugin/.claude-plugin/plugin.json` must carry the same `version`. The launcher pins npx to the plugin's version, the install script matches the extension to the plugin by release tag, and `npm run release` refuses to run when the extension and plugin differ. Bump all three by hand; there is no version command yet.

## Publishing the MCP server

When the source is allowed to go public:

```sh
npm login                                    # as nikiforovall; the package lives under that user scope
npm publish -w @nikiforovall/redline-mcp     # publishConfig.access is already public
```

The `@redline` scope on npm belongs to someone else, so the package is scoped to your user instead; the bin stays `redline-mcp`. The `files` allowlist ships `src/` only. Publish the server before or together with the plugin version that pins it, never after: a plugin at `0.0.2` whose npx target does not exist yet is broken for everyone without a global install.

## Release steps

From the repo root, on a clean `main`:

```sh
# 1. bump "version" in packages/extension/package.json, packages/mcp/package.json,
#    and packages/claude-plugin/.claude-plugin/plugin.json
npm run build
npm test
git add -A && git commit -m "chore: release vX.Y.Z"
git push
npm publish -w @nikiforovall/redline-mcp   # once publishing is no longer deferred
npm run release -- --publish  # build, test, package dist/redline-extension-X.Y.Z.vsix, gh release create vX.Y.Z
```

`npm run release` without `--publish` stops after packaging, so you can inspect the `.vsix` first. `--publish` runs `gh release create vX.Y.Z <vsix> --generate-notes`, which also creates the tag. The plugin needs nothing more: the pushed commit is what a marketplace install copies, and the version in `plugin.json` is what `claude plugin update` compares.

## What users run

Plugin:

```
/plugin marketplace add nikiforovall/redline
/plugin install redline@redline
```

Extension, from a shell with `code` on PATH and `gh` authenticated against the repo:

```sh
node ~/.claude/plugins/cache/redline/redline/<version>/scripts/install-extension.mjs [--profile <name>] [--insiders]
```

It reads the installed version from `code --list-extensions --show-versions`, the latest from `gh release view`, exits when they match, and otherwise downloads the `.vsix` and runs `code --install-extension --force`. `--insiders` targets VS Code Insiders through `code-insiders` instead. `REDLINE_REPO` overrides the `owner/name` read from `plugin.json`; `REDLINE_VSCODE_PROFILE` and `REDLINE_VSCODE_INSIDERS=1` are the environment forms of the two flags. Updating the plugin does not update the extension; the user reruns this script.

## Going public later

All three are shaped so a public release is a swap, not a rewrite:

- **Extension on the VS Code marketplace.** `vsce publish` from `packages/extension` with a publisher token. `install-extension.mjs` becomes unnecessary and VS Code takes over updates.
- **MCP server on npm.** Already wired; publishing it is the only step. The launcher's npx branch starts working the moment the version exists on the registry.
- **Plugin.** Unchanged; a public repo installs through the same marketplace commands.
