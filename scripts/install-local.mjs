#!/usr/bin/env node
import { packageVsix, run, version, vscodeProfile } from './vsix.mjs';

const release = version();
const profile = vscodeProfile();

console.log(`redline: building the extension ${release}`);
run('npm', ['run', 'build']);

const vsix = packageVsix(release);
run('code', [...profile, '--install-extension', vsix, '--force']);
console.log(
  `redline: installed ${vsix}${profile.length ? ` into profile "${profile[1]}"` : ''}. Reload VS Code windows to pick it up.`
);
