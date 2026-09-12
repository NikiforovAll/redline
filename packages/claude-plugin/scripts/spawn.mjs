import { isAbsolute } from 'node:path';

const win = process.platform === 'win32';

// Node refuses to spawn .cmd shims (npx, npm link bins, code) without a shell, and shell: true
// concatenates arguments unescaped. Quote them ourselves and hand one line to cmd.exe.
const quote = (arg) => (/[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg);

export function command(file, args) {
  if (!win || isAbsolute(file)) return [file, args, {}];
  return [
    'cmd.exe',
    ['/d', '/s', '/c', `"${[file, ...args].map(quote).join(' ')}"`],
    { windowsVerbatimArguments: true }
  ];
}

export function vscodeCli() {
  const insiders =
    process.argv.includes('--insiders') || /^(1|true)$/i.test(process.env.REDLINE_VSCODE_INSIDERS ?? '');
  return insiders ? 'code-insiders' : 'code';
}

export function vscodeProfile() {
  const index = process.argv.indexOf('--profile');
  const name = index === -1 ? process.env.REDLINE_VSCODE_PROFILE : process.argv[index + 1];
  return name ? ['--profile', name] : [];
}
