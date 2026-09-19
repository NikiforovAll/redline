---
name: release
description: Cut a redline release from this checkout: bump, build, test, commit, then push the tag that makes the Release workflow publish npm, marketplace, and GitHub release, after one confirmation.
argument-hint: `patch` (default), `minor`, `major`, or `X.Y.Z`; `--plugin` bumps the plugin too; `--dry-run` stops before anything is committed or pushed.
disable-model-invocation: true
---

# release

Ship the extension and the server under one version. The laptop bumps, checks, commits, and pushes the tag `v<version>`; the Release workflow (`.github/workflows/release.yml`) packages the vsix and publishes `@nikiforovall/redline-mcp` to npm, the extension to the VS Code marketplace, and the `.vsix` to a GitHub release. Nothing is packaged or published from the laptop. The plugin has its own version and only pins the server; `docs/PUBLISHING.md`, section "Two versions", has the reasons.

`$ARGUMENTS` is the bump level (`patch` when empty, `minor`, `major`) or an explicit `X.Y.Z`, plus flags: `--plugin` also moves the plugin to its next patch so installed plugins pick up the new pin; `--dry-run` ends the run after the checks with the bump left in the working tree.

## Preflight

Stop at the first failure and report the line that failed.

- The branch is `main` and `git -C <root> status --porcelain` is empty, or lists only the Bump files already at `<version>` from an earlier run that stopped before publishing; then skip Bump.
- `gh auth status` reports a login.
- `npm run check:versions` prints one version: extension, server, and `pin.json` agree before anything moves.
- `<version>` is that printed version plus the bump level, or the explicit one, which must be higher.
- `npm view @nikiforovall/redline-mcp@<version> version` fails and `git -C <root> ls-remote --tags origin v<version>` prints nothing: neither the registry nor the remote has the version yet.

## Bump

Edit the `"version"` line in each file with the Edit tool. `npm version` rewrites the manifests in expanded JSON and produces a 40-line diff, so it stays out of this step.

1. `packages/extension/package.json` and `packages/mcp/package.json` to `<version>`.
2. `packages/claude-plugin/scripts/pin.json` so `@nikiforovall/redline-mcp` is `<version>`.
3. `npm install --package-lock-only` so the lockfile carries the new versions.
4. With `--plugin`, `version` in `packages/claude-plugin/.claude-plugin/plugin.json` to its next patch.

Done when `git -C <root> diff --stat` lists the two manifests, the lockfile, `pin.json`, and with `--plugin` `plugin.json`, each with one changed line, and `npm run check:versions` prints `<version>`.

## Check

`<log>` is a file in the session scratchpad directory; the test output is long and only its summary lines matter.

```sh
npm run build
npm test > "<log>" 2>&1; echo "npm test exit $?"; rg '^ℹ (pass|fail) ' "<log>"
```

Done when the test exit is `0` with three `fail 0` lines. With `--dry-run`, report and stop here.

## Confirm

Show the bump diff stat and the test summary, then ask one question with `AskUserQuestion`: push `v<version>` now, or stop. Skip the question when the user's request already says to publish. Nothing so far has left the machine. Everything after is irreversible: the tag triggers the workflow, and npm never accepts a version twice.

## Publish

```sh
git -C <root> add -A && git -C <root> commit -m "chore: release v<version>"
git -C <root> push origin main
git -C <root> tag -a v<version> -m v<version> && git -C <root> push origin v<version>
gh run list --workflow Release --limit 1 --json databaseId,headBranch,status
gh run watch <id> --exit-status --interval 15
```

Run them in order and stop at the first non-zero exit. The run list can lag the push by a few seconds; its `headBranch` must be the tag before watching. Every publish step in the workflow skips a version that already exists, so a failed run is fixed by fixing the cause and `gh run rerun <id>`, never by a new tag.

Done when the run is green and these three agree with `<version>`; the registry and the marketplace index a minute or two after the run, so retry them with a pause between attempts:

```sh
npm view @nikiforovall/redline-mcp version
npx vsce show nikiforovall.redline-extension --json | rg '"version": "<version>"'
gh release view v<version> --json assets -q '.assets[].name'
```

## Report

One line per artifact: npm version, marketplace version, release URL, plugin version and whether it moved. Then how users get it: the extension from the marketplace (VS Code updates it on its own); the server on the next plugin bump unless `--plugin` shipped it now.
