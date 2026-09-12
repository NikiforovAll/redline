export const REDLINE_SCHEME = 'redline';

export type UriSide = 'left' | 'right';

export interface ParsedRedlineUri {
  roundId: string;
  side: UriSide;
  path: string;
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function toUri(roundId: string, side: UriSide, path: string): string {
  const normalized = normalize(path);
  const query = new URLSearchParams({ round: roundId, side, path: normalized });
  const encoded = normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${REDLINE_SCHEME}:/${encoded}?${query.toString()}`;
}

export function parseQuery(raw: string): ParsedRedlineUri | null {
  const query = new URLSearchParams(raw);
  const roundId = query.get('round');
  const side = query.get('side');
  const path = query.get('path');
  if (!roundId || (side !== 'left' && side !== 'right') || path === null) {
    return null;
  }
  return { roundId, side, path: normalize(path) };
}

export function parseUri(uri: string): ParsedRedlineUri | null {
  if (!uri.startsWith(`${REDLINE_SCHEME}:`)) {
    return null;
  }
  const queryStart = uri.indexOf('?');
  if (queryStart === -1) {
    return null;
  }
  return parseQuery(uri.slice(queryStart + 1));
}
