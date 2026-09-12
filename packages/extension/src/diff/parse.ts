export type DiffLineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  noNewline?: boolean;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type ParsedStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ParsedFile {
  oldPath: string | null;
  newPath: string | null;
  status: ParsedStatus;
  binary: boolean;
  hunks: Hunk[];
}

const HUNK_HEADER = /^@@+ (-\d+(?:,\d+)?) (\+\d+(?:,\d+)?) @@/;

function unquote(raw: string): string {
  if (!raw.startsWith('"')) {
    return raw;
  }
  const body = raw.slice(1, -1);
  return body.replace(/\\(.)/g, (_m, ch: string) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case '"':
        return '"';
      case '\\':
        return '\\';
      default:
        return ch;
    }
  });
}

function stripPrefix(raw: string): string | null {
  const value = unquote(raw.trim());
  if (value === '/dev/null') {
    return null;
  }
  if (/^[abciow]\//.test(value)) {
    return value.slice(2);
  }
  return value;
}

function splitGitHeader(rest: string): [string, string] | null {
  if (rest.startsWith('"')) {
    let i = 1;
    while (i < rest.length) {
      if (rest[i] === '\\') {
        i += 2;
        continue;
      }
      if (rest[i] === '"') {
        break;
      }
      i += 1;
    }
    return [rest.slice(0, i + 1), rest.slice(i + 2)];
  }
  const parts = rest.split(' ');
  for (let i = 1; i < parts.length; i += 1) {
    const left = parts.slice(0, i).join(' ');
    const right = parts.slice(i).join(' ');
    if (left.slice(2) === right.slice(2)) {
      return [left, right];
    }
  }
  const half = Math.floor(parts.length / 2);
  return [parts.slice(0, half).join(' '), parts.slice(half).join(' ')];
}

function parseRange(text: string): { start: number; lines: number } {
  const [startText, linesText] = text.slice(1).split(',');
  const lines = linesText === undefined ? 1 : Number(linesText);
  return { start: Number(startText), lines };
}

export function parsePatch(text: string): ParsedFile[] {
  const lines = text.split('\n');
  const files: ParsedFile[] = [];
  let file: ParsedFile | null = null;
  let hunk: Hunk | null = null;

  const startFile = (): ParsedFile => {
    const next: ParsedFile = { oldPath: null, newPath: null, status: 'modified', binary: false, hunks: [] };
    files.push(next);
    return next;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      file = startFile();
      hunk = null;
      const pair = splitGitHeader(line.slice('diff --git '.length));
      if (pair) {
        file.oldPath = stripPrefix(pair[0]);
        file.newPath = stripPrefix(pair[1]);
      }
      continue;
    }
    if (line.startsWith('diff --no-index')) {
      file = startFile();
      hunk = null;
      continue;
    }
    if (!file) {
      if (line.startsWith('--- ')) {
        file = startFile();
        hunk = null;
      } else {
        continue;
      }
    }
    if (line.startsWith('new file mode')) {
      file.status = 'added';
      file.oldPath = null;
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      file.status = 'deleted';
      file.newPath = null;
      continue;
    }
    if (line.startsWith('rename from ')) {
      file.status = 'renamed';
      file.oldPath = unquote(line.slice('rename from '.length));
      continue;
    }
    if (line.startsWith('rename to ')) {
      file.status = 'renamed';
      file.newPath = unquote(line.slice('rename to '.length));
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.binary = true;
      continue;
    }
    if (line.startsWith('--- ')) {
      const path = stripPrefix(line.slice(4));
      if (path === null) {
        file.status = 'added';
      }
      if (path !== null && file.status !== 'renamed') {
        file.oldPath = path;
      }
      hunk = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const path = stripPrefix(line.slice(4));
      if (path === null) {
        file.status = 'deleted';
      }
      if (path !== null && file.status !== 'renamed') {
        file.newPath = path;
      }
      hunk = null;
      continue;
    }
    const header = HUNK_HEADER.exec(line);
    if (header) {
      const oldRange = parseRange(header[1]);
      const newRange = parseRange(header[2]);
      hunk = {
        oldStart: oldRange.start,
        oldLines: oldRange.lines,
        newStart: newRange.start,
        newLines: newRange.lines,
        lines: []
      };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      continue;
    }
    if (line.startsWith('\\')) {
      const last = hunk.lines[hunk.lines.length - 1];
      if (last) {
        last.noNewline = true;
      }
      continue;
    }
    if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', content: line.slice(1) });
      continue;
    }
    if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'del', content: line.slice(1) });
      continue;
    }
    if (line.startsWith(' ')) {
      hunk.lines.push({ kind: 'context', content: line.slice(1) });
      continue;
    }
    if (line === '') {
      const consumed = hunk.lines.reduce(
        (acc, entry) => ({
          old: acc.old + (entry.kind === 'add' ? 0 : 1),
          next: acc.next + (entry.kind === 'del' ? 0 : 1)
        }),
        { old: 0, next: 0 }
      );
      if (consumed.old < hunk.oldLines || consumed.next < hunk.newLines) {
        hunk.lines.push({ kind: 'context', content: '' });
      }
      continue;
    }
    hunk = null;
  }

  return files;
}

export function sideFromHunks(hunks: Hunk[], side: 'left' | 'right'): string {
  const kept: DiffLineKind[] = side === 'left' ? ['context', 'del'] : ['context', 'add'];
  const out: string[] = [];
  let endsWithNewline = true;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (kept.includes(line.kind)) {
        out.push(line.content);
        endsWithNewline = line.noNewline !== true;
      }
    }
  }
  if (out.length === 0) {
    return '';
  }
  return endsWithNewline ? `${out.join('\n')}\n` : out.join('\n');
}
