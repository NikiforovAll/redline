# Publishing

redline ships three artifacts from one private repo:

- **The Claude Code plugin** (`packages/claude-plugin`). Installed with `/plugin marketplace add nikiforovall/redline` and `/plugin install redline@redline`. Claude Code copies the plugin directory from git at install time; there is no upload step. It contains no server code, only `scripts/launch.mjs`, which finds the server.
- **The MCP server** (`packages/mcp`). Published to npm as `@nikiforovall/redline-mcp` with a `redline-mcp` bin. The launcher runs `npx -y @nikiforovall/redline-mcp@<version>` unless a global install or a checkout is found first. **Publishing is deferred**; until it happens, fresh plugin installs fail at the npx step and only linked or global installs work.
- **The VS Code extension** (`packages/extension`). Shipped as a `.vsix` attached to a GitHub release tagged `vX.Y.Z`. The public VS Code marketplace is not used while the repo is private.

`@redline/protocol` is a private workspace package and is not published.

## Two versions

The extension and the server ship together: `packages/extension/package.json` and `packages/mcp/package.json` carry the same `version`, the release tag is `v<that version>`, and the plugin's `scripts/pin.json` names it as the npx target. `npm run release` refuses to run when the three disagree.

The plugin has its own `version` in `plugin.json`. Bump it only when plugin files change, `pin.json` included, since `claude plugin update` refreshes an installed copy on a version bump alone. A server release that leaves the plugin version alone reaches installed plugins on their next bump; until then their launcher still runs the previous pinned server, which the extension has to tolerate.

## Publishing the MCP server

When the source is allowed to go public:

```sh
npm login                                    # as nikiforovall; the package lives under that user scope
npm publish -w @nikiforovall/redline-mcp     # publishConfig.access is already public
```

The `@redline` scope on npm belongs to someone else, so the package is scoped to your user instead; the bin stays `redline-mcp`. The `files` allowlist ships `src/` and `LICENSE` only. Publish the server before the commit that pins it is pushed, never after: a `pin.json` whose npx target does not exist yet is broken for everyone without a global install.

## Release steps

`/release` in Claude Code runs the whole sequence from this checkout and asks once before anything leaves the machine. It takes `patch` (default), `minor`, `major`, or an explicit `X.Y.Z`; `--plugin` also bumps the plugin's patch version so installed plugins pick up the new pin; `--dry-run` stops after the npm dry run and the vsix. The skill is `.claude/skills/release/SKILL.md`; by hand, from the repo root on a clean `main`:

```sh
npm version X.Y.Z -w redline-extension -w @nikiforovall/redline-mcp --no-git-tag-version
# then set the version in packages/claude-plugin/scripts/pin.json,
# and bump plugin.json only if the plugin should ship the new pin now
npm run build
npm test
npm publish -w @nikiforovall/redline-mcp   # first, so a failed publish leaves nothing in history
git add -A && git commit -m "chore: release vX.Y.Z"
git push
npm run release -- --publish  # build, test, package dist/redline-extension-X.Y.Z.vsix, gh release create vX.Y.Z
```

`npm run release` without `--publish` stops after packaging, so you can inspect the `.vsix` first. `--publish` runs `gh release create vX.Y.Z <vsix> --generate-notes`, which also creates the tag. The plugin needs nothing more: the pushed commit is what a marketplace install copies, and the version in `plugin.json` is what `claude plugin update` compares, so an existing install only sees the new pin after that version moves.

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

It reads the installed version from `code --list-extensions --show-versions` and the wanted one from the plugin's `scripts/pin.json`, so the extension always matches the server the launcher runs. When they differ it downloads that release's `.vsix` with `gh release download` and runs `code --install-extension --force`. `--insiders` targets VS Code Insiders through `code-insiders` instead. `REDLINE_REPO` overrides the `owner/name` read from `plugin.json`; `REDLINE_VSCODE_PROFILE` and `REDLINE_VSCODE_INSIDERS=1` are the environment forms of the two flags. Updating the plugin does not update the extension; the user reruns this script.

## Going public later

All three are shaped so a public release is a swap, not a rewrite:

- **Extension on the VS Code marketplace.** `vsce publish` from `packages/extension` with a publisher token. `install-extension.mjs` becomes unnecessary and VS Code takes over updates.
- **MCP server on npm.** Already wired; publishing it is the only step. The launcher's npx branch starts working the moment the version exists on the registry.
- **Plugin.** Unchanged; a public repo installs through the same marketplace commands.
