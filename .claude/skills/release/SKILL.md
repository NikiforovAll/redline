---
name: release
description: Cut a redline release from this checkout: bump, build, test, publish the server to npm and the vsix to a GitHub release after one confirmation.
argument-hint: `patch` (default), `minor`, `major`, or `X.Y.Z`; `--plugin` bumps the plugin too; `--dry-run` stops before anything is committed or published.
disable-model-invocation: true
---

# release

Ship the extension and the server under one version: `@nikiforovall/redline-mcp` on npm and the `.vsix` on a GitHub release tagged `v<version>`. The plugin has its own version and only pins the server; `docs/PUBLISHING.md`, section "Two versions", has the reasons.

`$ARGUMENTS` is the bump level (`patch` when empty, `minor`, `major`) or an explicit `X.Y.Z`, plus flags: `--plugin` also moves the plugin to its next patch so installed plugins pick up the new pin; `--dry-run` ends the run after the checks with the bump left in the working tree.

## Preflight

Stop at the first failure and report the line that failed.

- The branch is `main` and `git -C <root> status --porcelain` is empty, or lists only the Bump files already at `<version>` from an earlier run that stopped before publishing; then skip Bump.
- `npm whoami` prints `nikiforovall`; `gh auth status` reports a login.
- `npm run check:versions` prints one version: extension, server, and `pin.json` agree before anything moves.
- `<version>` is that printed version plus the bump level, or the explicit one, which must be higher.
- `npm view @nikiforovall/redline-mcp@<version> version` fails: the version is not on the registry yet.

## Bump

1. `npm version <version> -w redline-extension -w @nikiforovall/redline-mcp --no-git-tag-version`.
2. Edit `packages/claude-plugin/scripts/pin.json` so `@nikiforovall/redline-mcp` is `<version>`.
3. With `--plugin`, edit `version` in `packages/claude-plugin/.claude-plugin/plugin.json` to its next patch.

Done when `git -C <root> diff --stat` lists the two manifests, the lockfile, `pin.json`, and with `--plugin` `plugin.json`, nothing else.

## Check

`<log>` is a file in the session scratchpad directory; the test output is long and only its summary lines matter.

```sh
npm run build
npm test > "<log>" 2>&1; echo "npm test exit $?"; rg '^ℹ (pass|fail) ' "<log>"
npm publish -w @nikiforovall/redline-mcp --dry-run
npm run release
```

Done when the test exit is `0` with three `fail 0` lines, the dry run prints no `npm warn publish` line, and `dist/redline-extension-<version>.vsix` exists. With `--dry-run`, report and stop here.

## Confirm

Show the dry-run file list and the vsix size, then ask one question with `AskUserQuestion`: publish `<version>` now, or stop. Nothing so far has left the machine. Everything after is irreversible: npm never accepts a version twice, and the release creates a tag.

## Publish

`pin.json` names `<version>`, so the npm package must exist before the pinning commit is pushed. Publishing first also keeps a failed publish out of history: the bump stays an uncommitted working-tree change that a rerun of `/release <version>` picks up.

```sh
npm publish -w @nikiforovall/redline-mcp
git -C <root> add -A && git -C <root> commit -m "chore: release v<version>"
git -C <root> push origin main
npm run release -- --publish
```

Run them in order and stop at the first non-zero exit. After a failure past the first command, report what already landed (registry, commit, push) so the user knows where to resume.

Done when `npm view @nikiforovall/redline-mcp version` prints `<version>`, `gh release view v<version> --json assets -q '.assets[].name'` lists the vsix, and `git -C <root> log origin/main -1 --oneline` is the release commit.

## Report

One line per artifact: npm version and file count, release URL, plugin version and whether it moved. Then how users get it: the extension through `install-extension.mjs` or the vsix; the server on the next plugin bump unless `--plugin` shipped it now.
