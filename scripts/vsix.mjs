import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from '../packages/claude-plugin/scripts/spawn.mjs';

export { vscodeCli, vscodeProfile } from '../packages/claude-plugin/scripts/spawn.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(repoRoot, 'dist');

const readJson = (...parts) => JSON.parse(readFileSync(join(repoRoot, ...parts), 'utf8'));

export function run(file, args, cwd = repoRoot) {
  const [cmd, argv, extra] = command(file, args);
  execFileSync(cmd, argv, { cwd, stdio: 'inherit', ...extra });
}

const MCP = '@nikiforovall/redline-mcp';

/** The extension and the server ship together under one version; the plugin has its own and only pins the server. */
export function version() {
  const found = {
    extension: readJson('packages', 'extension', 'package.json').version,
    mcp: readJson('packages', 'mcp', 'package.json').version,
    'plugin pin': readJson('packages', 'claude-plugin', 'scripts', 'pin.json')[MCP]
  };
  const versions = new Set(Object.values(found));
  if (versions.size !== 1) {
    const list = Object.entries(found).map(([name, v]) => `${name} ${v}`).join(', ');
    console.error(`redline: versions differ (${list}). Set all three to the same version.`);
    process.exit(1);
  }
  return found.extension;
}

export function packageVsix(version) {
  const vsix = join(dist, `redline-extension-${version}.vsix`);
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  run('vsce', ['package', '--no-dependencies', '--out', vsix], join(repoRoot, 'packages', 'extension'));
  return vsix;
}
