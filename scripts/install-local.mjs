#!/usr/bin/env node
import { packageVsix, run, version, vscodeCli, vscodeProfile } from './vsix.mjs';

const release = version();
const profile = vscodeProfile();
const code = vscodeCli();

console.log(`redline: building the extension ${release}`);
run('npm', ['run', 'build']);

const vsix = packageVsix(release);
run(code, [...profile, '--install-extension', vsix, '--force']);
console.log(
  `redline: installed ${vsix} via ${code}${profile.length ? ` into profile "${profile[1]}"` : ''}. Reload VS Code windows to pick it up.`
);
