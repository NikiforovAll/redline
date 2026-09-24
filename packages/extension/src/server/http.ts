import { randomBytes } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AddNotesResult, Anchor, Note, RequestReview, RequestReviewResult, ReviewEvent, Source } from '@redline/protocol';
import { SourceUnavailableError } from '../diff/index.ts';
import { memoryPersistence, ReviewStore, type RefreshOutcome, type StoredRound } from '../review/store.ts';
import { roundMessage } from '../review/view-model.ts';
import {
  lockFilePath,
  normalizeWorkspacePath,
  removeLockFile,
  writeLockFile
} from './lock.js';

export interface ServerHooks {
  onRoundCreated?: (round: StoredRound) => void | Promise<void>;
  /** A request on the source of an existing round, or on its id; the hook rebuilds the snapshot and reports what the store did. Without it a source request opens a round and an id request fails. */
  onRoundRefresh?: (round: StoredRound, request: RequestReview) => RefreshOutcome | Promise<RefreshOutcome>;
  onThreadResolved?: (threadId: string) => void;
  onThreadReplied?: (threadId: string) => void;
  /** Note threads posted over `POST /rounds/{id}/notes`; the editor has no widgets for them yet. */
  onNotesAdded?: (roundId: string, threadIds: string[]) => void;
  /** A reviewer thread seeded over `/debug/threads`; the editor has no widget for it yet. */
  onThreadSeeded?: (threadId: string) => void;
  /** A round dropped over `/debug/rounds/drop` without the editor's confirmation; the hook removes it from the store and the editor. */
  onRoundDropped?: (roundId: string) => void | Promise<void>;
}

export interface StartServerOptions {
  workspaceFolders: string[];
  version: string;
  app?: string;
  appName?: string;
  store?: ReviewStore;
  hooks?: ServerHooks;
}

export interface RunningServer {
  port: number;
  token: string;
  lockPath: string;
  store: ReviewStore;
  /** `delivered` is the number of open SSE streams, one per attached agent, the event was written to. */
  emit: (event: ReviewEvent) => { id: string; delivered: number };
  /** Pings `/ping` over a new connection, the way the MCP server does from another process. Resolves to the failure reason, or undefined when the server answers. */
  probe: (timeoutMs?: number) => Promise<string | undefined>;
  close: () => Promise<void>;
}

function isSource(value: unknown): value is Source {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'worktree' || kind === 'range' || kind === 'patch' || kind === 'files';
}

function isAnchor(value: unknown): value is Anchor {
  if (!value || typeof value !== 'object') return false;
  const anchor = value as Partial<Anchor>;
  return typeof anchor.file === 'string' && (anchor.side === 'left' || anchor.side === 'right');
}

function isNotes(value: unknown): value is Note[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((note) => typeof note?.file === 'string' && Number.isInteger(note.line) && note.line >= 1 && typeof note.body === 'string')
  );
}

const REPLAY_LIMIT = 200;

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text)
  });
  res.end(text);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > 1_000_000) {
      throw new Error('body too large');
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  if (options.workspaceFolders.length === 0) {
    throw new Error('redline: cannot start server without a workspace folder');
  }
  const token = randomBytes(32).toString('hex');
  const folders = options.workspaceFolders.map(normalizeWorkspacePath);

  const clients = new Set<ServerResponse>();
  const recent: { seq: number; id: string; event: ReviewEvent }[] = [];
  const instanceId = randomBytes(6).toString('hex');
  let nextSeq = 1;

  const frame = (id: string, event: ReviewEvent): string =>
    `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;

  const emit = (event: ReviewEvent): { id: string; delivered: number } => {
    const seq = nextSeq++;
    const id = `${instanceId}-${seq}`;
    recent.push({ seq, id, event });
    if (recent.length > REPLAY_LIMIT) recent.shift();
    const text = frame(id, event);
    for (const res of clients) res.write(text);
    return { id, delivered: clients.size };
  };

  const openStream = (req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    });
    res.write(': redline event stream\n\n');
    const header = req.headers['last-event-id'];
    const last = String(Array.isArray(header) ? header[0] : (header ?? ''));
    const [lastInstance, lastSeq] = last.split('-');
    if (lastInstance === instanceId && Number(lastSeq) > 0) {
      for (const item of recent) {
        if (item.seq > Number(lastSeq)) res.write(frame(item.id, item.event));
      }
    }
    clients.add(res);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
    keepAlive.unref?.();
    const drop = (): void => {
      clearInterval(keepAlive);
      clients.delete(res);
    };
    res.on('close', drop);
    res.on('error', drop);
  };

  const store = options.store ?? new ReviewStore(memoryPersistence());

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const raw = req.url ?? '/';
    const queryStart = raw.indexOf('?');
    const url = queryStart === -1 ? raw : raw.slice(0, queryStart);
    const query = new URLSearchParams(queryStart === -1 ? '' : raw.slice(queryStart + 1));
    const segments = url.split('/').filter((part) => part.length > 0);

    if (req.method === 'GET' && url === '/ping') {
      send(res, 200, {
        ok: true,
        version: options.version,
        app: options.app,
        appName: options.appName,
        workspaceFolders: folders
      });
      return;
    }
    if (req.method === 'GET' && url === '/events') {
      openStream(req, res);
      return;
    }
    if (req.method === 'POST' && url === '/debug/emit') {
      const body = await readJsonBody(req);
      send(res, 200, { ok: true, ...emit(body as ReviewEvent) });
      return;
    }
    if (req.method === 'POST' && url === '/debug/threads') {
      const body = (await readJsonBody(req)) as { roundId?: unknown; anchor?: unknown; body?: unknown };
      const text = typeof body?.body === 'string' ? body.body.trim() : '';
      if (typeof body?.roundId !== 'string' || !isAnchor(body.anchor) || text.length === 0) {
        send(res, 400, { error: 'redline: debug/threads needs roundId, an anchor with file and side, and a body' });
        return;
      }
      if (!store.round(body.roundId)) {
        send(res, 404, { error: `redline: unknown round ${body.roundId}` });
        return;
      }
      const thread = store.addThread(body.roundId, body.anchor, 'human', text);
      options.hooks?.onThreadSeeded?.(thread.id);
      send(res, 200, thread);
      return;
    }
    if (req.method === 'POST' && url === '/debug/rounds/drop') {
      const body = (await readJsonBody(req)) as { roundId?: unknown };
      if (typeof body?.roundId !== 'string' || !store.round(body.roundId)) {
        send(res, 404, { error: `redline: unknown round ${String(body?.roundId)}` });
        return;
      }
      if (options.hooks?.onRoundDropped) await options.hooks.onRoundDropped(body.roundId);
      else store.removeRound(body.roundId);
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url === '/rounds') {
      const body = (await readJsonBody(req)) as RequestReview;
      const byId = typeof body?.roundId === 'string';
      const existing = byId ? store.round(body.roundId) : isSource(body?.source) ? store.findOpenRound(body.source) : undefined;
      if (byId && !existing) {
        send(res, 404, { error: `redline: unknown round ${body.roundId}` });
        return;
      }
      if (existing && options.hooks?.onRoundRefresh) {
        const outcome = await options.hooks.onRoundRefresh(existing, body);
        const result: RequestReviewResult = { ...store.summary(existing.id), outcome, message: roundMessage(existing, outcome) };
        send(res, 200, result);
        return;
      }
      if (!isSource(body?.source)) {
        send(res, 400, {
          error: 'redline: request_review needs a roundId, or a source of kind worktree, range, patch or files'
        });
        return;
      }
      const round = store.createRound({
        source: body.source,
        title: body.title,
        notes: body.notes
      });
      await options.hooks?.onRoundCreated?.(round);
      const opened = store.round(round.id) ?? round;
      const result: RequestReviewResult = { ...store.summary(round.id), outcome: 'opened', message: roundMessage(opened, 'opened') };
      send(res, 200, result);
      return;
    }
    if (req.method === 'GET' && url === '/rounds') {
      send(res, 200, store.summaries());
      return;
    }
    if (req.method === 'GET' && url === '/pending') {
      send(res, 200, store.pending());
      return;
    }
    if (req.method === 'GET' && segments[0] === 'rounds' && segments.length === 2) {
      const round = store.round(decodeURIComponent(segments[1]));
      if (!round) {
        send(res, 404, { error: `redline: unknown round ${segments[1]}` });
        return;
      }
      send(res, 200, store.wireRound(round.id));
      return;
    }
    if (req.method === 'POST' && segments[0] === 'rounds' && segments.length === 3 && segments[2] === 'notes') {
      const round = store.round(decodeURIComponent(segments[1]));
      if (!round) {
        send(res, 404, { error: `redline: unknown round ${segments[1]}` });
        return;
      }
      const body = (await readJsonBody(req).catch(() => null)) as { notes?: unknown } | null;
      if (!isNotes(body?.notes)) {
        send(res, 400, { error: 'redline: add_notes needs notes, a non-empty array of {file, line, body}' });
        return;
      }
      const threadIds = store.addNotes(round.id, body.notes);
      options.hooks?.onNotesAdded?.(round.id, threadIds);
      const result: AddNotesResult = { ...store.summary(round.id), threadIds };
      send(res, 200, result);
      return;
    }
    if (
      req.method === 'GET' &&
      segments[0] === 'rounds' &&
      segments.length === 3 &&
      segments[2] === 'review'
    ) {
      const round = store.round(decodeURIComponent(segments[1]));
      if (!round) {
        send(res, 404, { error: `redline: unknown round ${segments[1]}` });
        return;
      }
      const threads = (query.get('threads') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      send(res, 200, store.renderReview(round.id, { threads, peek: query.get('peek') === '1' }));
      return;
    }
    if (req.method === 'POST' && segments[0] === 'threads' && segments.length === 3) {
      const threadId = decodeURIComponent(segments[1]);
      if (!store.thread(threadId)) {
        send(res, 404, { error: `redline: unknown thread ${threadId}` });
        return;
      }
      const payload = (await readJsonBody(req).catch(() => null)) as { body?: unknown } | null;
      const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
      if (segments[2] === 'resolve') {
        if (body.length > 0) store.addComment(threadId, 'claude', body);
        const resolved = store.setResolved(threadId, true);
        options.hooks?.onThreadResolved?.(threadId);
        send(res, 200, resolved);
        return;
      }
      if (segments[2] === 'comments') {
        if (body.length === 0) {
          send(res, 400, { error: 'redline: reply body must be a non-empty string' });
          return;
        }
        const thread = store.addComment(threadId, 'claude', body);
        options.hooks?.onThreadReplied?.(threadId);
        send(res, 200, thread);
        return;
      }
    }
    send(res, 404, { error: 'not found' });
  };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${token}`) {
      send(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    handle(req, res).catch((err: Error) => {
      if (res.headersSent) return;
      if (err instanceof SourceUnavailableError) {
        send(res, 422, {
          code: 'no_source',
          reason: err.reason,
          detail: err.message
        });
        return;
      }
      send(res, 500, { error: err.message });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const port = (server.address() as AddressInfo).port;
  const lockPath = lockFilePath();
  writeLockFile(lockPath, {
    port,
    token,
    workspaceFolders: folders,
    pid: process.pid,
    appPid: Number(process.env.VSCODE_PID) || process.ppid,
    app: options.app,
    version: options.version,
    startedAt: new Date().toISOString()
  });

  let closed = false;
  let lost: string | undefined;
  server.on('error', (err: NodeJS.ErrnoException) => {
    lost = err.code ?? err.message;
  });
  server.on('close', () => {
    if (!closed) lost = 'listener closed';
  });

  const probe = (timeoutMs = 3000): Promise<string | undefined> => {
    if (lost) return Promise.resolve(lost);
    return new Promise((resolve) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/ping',
          agent: false,
          headers: { authorization: `Bearer ${token}` },
          timeout: timeoutMs
        },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200 ? undefined : `ping returned ${res.statusCode}`);
        }
      );
      req.on('timeout', () => req.destroy(new Error(`no answer in ${timeoutMs}ms`)));
      req.on('error', (err: NodeJS.ErrnoException) => resolve(err.code ?? err.message));
      req.end();
    });
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    removeLockFile(lockPath);
    for (const res of clients) res.end();
    clients.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { port, token, lockPath, store, emit, probe, close };
}
