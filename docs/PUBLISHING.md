# Publishing

redline ships three artifacts from one repo:

- **The Claude Code plugin** (`packages/claude-plugin`). Installed with `/plugin marketplace add nikiforovall/redline` and `/plugin install redline@redline`. Claude Code copies the plugin directory from git at install time; there is no upload step. It contains no server code, only `scripts/launch.mjs`, which finds the server.
- **The MCP server** (`packages/mcp`). Published to npm as `@nikiforovall/redline-mcp` with a `redline-mcp` bin. The launcher runs `npx -y @nikiforovall/redline-mcp@<version>` unless a global install or a checkout is found first. Until the first release exists on the registry, fresh plugin installs fail at the npx step and only linked or global installs work.
- **The VS Code extension** (`packages/extension`). Published to the VS Code marketplace as `nikiforovall.redline-extension`, with the same `.vsix` attached to the GitHub release tagged `vX.Y.Z` for offline installs.

All three publish from one GitHub Actions run, `.github/workflows/release.yml`, which starts when a `v*` tag is pushed. The laptop never holds a publish token.

`@redline/protocol` is a private workspace package and is not published.

## Two versions

The extension and the server ship together: `packages/extension/package.json` and `packages/mcp/package.json` carry the same `version`, the release tag is `v<that version>`, and the plugin's `scripts/pin.json` names it as the npx target. `npm run release` refuses to run when the three disagree.

The plugin has its own `version` in `plugin.json`. Bump it only when plugin files change, `pin.json` included, since `claude plugin update` refreshes an installed copy on a version bump alone. A server release that leaves the plugin version alone reaches installed plugins on their next bump; until then their launcher still runs the previous pinned server, which the extension has to tolerate.

## Release steps

`/release` in Claude Code runs the whole sequence from this checkout and asks once before anything leaves the machine. It takes `patch` (default), `minor`, `major`, or an explicit `X.Y.Z`; `--plugin` also bumps the plugin's patch version so installed plugins pick up the new pin; `--dry-run` stops after the npm dry run and the vsix. The skill is `.claude/skills/release/SKILL.md`; by hand, from the repo root on a clean `main`:

```sh
npm version X.Y.Z -w redline-extension -w @nikiforovall/redline-mcp --no-git-tag-version
# then set the version in packages/claude-plugin/scripts/pin.json,
# and bump plugin.json only if the plugin should ship the new pin now
npm run build
npm test
git add -A && git commit -m "chore: release vX.Y.Z"
git push
npm run release -- --tag      # build, test, package dist/redline-extension-X.Y.Z.vsix, push the tag vX.Y.Z
gh run watch --exit-status
```

`npm run release` without `--tag` stops after packaging, so you can inspect the `.vsix` first. The pushed tag starts the Release workflow, which in order publishes the server to npm, the extension to the marketplace, and creates the GitHub release with the vsix. Every step skips a version that already exists, so a failed run is fixed by fixing the cause and `gh run rerun <id>`, never by a second tag. The workflow refuses a tag that differs from the package versions.

The plugin needs nothing more: the pushed commit is what a marketplace install copies, and the version in `plugin.json` is what `claude plugin update` compares, so an existing install only sees the new pin after that version moves.

## What the workflow needs

The job runs in the GitHub environment `release`, so approvals and secrets can be scoped to it.

- **npm**: secret `NPM_TOKEN`, a granular access token with publish rights on `@nikiforovall/redline-mcp`. The `@redline` scope on npm belongs to someone else, so the package is scoped to the user; the bin stays `redline-mcp`. The `files` allowlist ships `src/` and `LICENSE` only. Once the package exists, npm trusted publishing can replace the token.
- **Marketplace**: secret `VSCE_PAT`, an Azure DevOps personal access token created for **All accessible organizations** with the **Marketplace: Manage** scope. A single-organization token reads as anonymous at the marketplace (TF400813). For 0.1.0 `vsce publish` timed out at `/_apis/gallery` after three minutes on every run, so the step is `continue-on-error` and the release went up by hand: **New extension** on marketplace.visualstudio.com/manage/publishers/nikiforovall with the `.vsix` from the GitHub release. Try the workflow first on the next release; if it times out again, upload by hand and ask VSMarketplace@microsoft.com why the API path stalls for this publisher. Display names are unique across the whole marketplace, which is why the extension is listed as Claude Code Redline. Azure DevOps retires global PATs on 2026-12-01; the replacement is a user-assigned managed identity with a federated credential for this repo and environment, signed in through `azure/login` with the variables `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`, then `vsce publish --azure-credential`. The identity exists and the login works; what remains is adding it as a Contributor on the `nikiforovall` publisher, whose Members page currently refuses to add anyone. The member id is what `.github/workflows/marketplace-identity.yml` prints when run by hand, not the identity's client or object id.
- **GitHub release**: the job's own token, with `contents: write`.

## What users run

Plugin:

```
/plugin marketplace add nikiforovall/redline
/plugin install redline@redline
```

Extension: search for Claude Code Redline in the Extensions view, or `code --install-extension nikiforovall.redline-extension`. VS Code updates it from then on. The plugin ships a script that installs the version the plugin pins, for a machine where the extension must match a specific server:

```sh
node ~/.claude/plugins/cache/redline/redline/<version>/scripts/install-extension.mjs [--profile <name>] [--insiders]
```

It reads the installed version from `code --list-extensions --show-versions` and the wanted one from the plugin's `scripts/pin.json`. When they differ it runs `code --install-extension nikiforovall.redline-extension@<version> --force`, and falls back to the release's `.vsix` through `gh release download` when the marketplace has no such version. `--insiders` targets VS Code Insiders through `code-insiders` instead. `REDLINE_REPO` overrides the `owner/name` read from `plugin.json`; `REDLINE_VSCODE_PROFILE` and `REDLINE_VSCODE_INSIDERS=1` are the environment forms of the two flags.
