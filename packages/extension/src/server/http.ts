import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestReview, ReviewEvent } from '@redline/protocol';
import { SourceUnavailableError } from '../diff/index.ts';
import { memoryPersistence, ReviewStore, type StoredRound } from '../review/store.ts';
import {
  lockFilePath,
  normalizeWorkspacePath,
  removeLockFile,
  writeLockFile
} from './lock.js';

export interface ServerHooks {
  onRoundCreated?: (round: StoredRound) => void | Promise<void>;
  onThreadResolved?: (threadId: string) => void;
  onThreadReplied?: (threadId: string) => void;
}

export interface StartServerOptions {
  workspaceFolders: string[];
  version: string;
  store?: ReviewStore;
  hooks?: ServerHooks;
}

export interface RunningServer {
  port: number;
  token: string;
  lockPath: string;
  store: ReviewStore;
  emit: (event: ReviewEvent) => string;
  close: () => Promise<void>;
}

function isSource(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'worktree' || kind === 'range' || kind === 'patch' || kind === 'files';
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

  const emit = (event: ReviewEvent): string => {
    const seq = nextSeq++;
    const id = `${instanceId}-${seq}`;
    recent.push({ seq, id, event });
    if (recent.length > REPLAY_LIMIT) recent.shift();
    const text = frame(id, event);
    for (const res of clients) res.write(text);
    return id;
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
      send(res, 200, { ok: true, version: options.version, workspaceFolders: folders });
      return;
    }
    if (req.method === 'GET' && url === '/events') {
      openStream(req, res);
      return;
    }
    if (req.method === 'POST' && url === '/debug/emit') {
      const body = await readJsonBody(req);
      send(res, 200, { ok: true, id: emit(body as ReviewEvent) });
      return;
    }
    if (req.method === 'POST' && url === '/rounds') {
      const body = (await readJsonBody(req)) as RequestReview;
      if (!isSource(body?.source)) {
        send(res, 400, { error: 'redline: request_review needs a source of kind worktree, range, patch or files' });
        return;
      }
      const round = store.createRound({
        source: body.source,
        title: body.title,
        notes: body.notes
      });
      await options.hooks?.onRoundCreated?.(round);
      send(res, 200, store.summary(round.id));
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
      send(res, 200, store.renderReview(round.id, threads));
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
    version: options.version,
    startedAt: new Date().toISOString()
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    removeLockFile(lockPath);
    for (const res of clients) res.end();
    clients.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { port, token, lockPath, store, emit, close };
}
