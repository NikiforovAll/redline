#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { discover, DISCOVER_NO_LOCK, DISCOVER_STALE_LOCK } from './discover.mjs';

export const NO_SOURCE = 'no_source';

export function noWindowText(cwd) {
  return (
    `redline: no VS Code window has this folder open with the redline extension. ` +
    `Open ${cwd} in VS Code (extension active), then retry. Do not retry automatically.`
  );
}

export function staleWindowText(folder) {
  return (
    `redline: the VS Code window for ${folder} is not answering (stale lock). ` +
    `Reload that window (Developer: Reload Window), then retry.`
  );
}

const NO_SOURCE_REASONS = {
  not_a_repo: 'this folder is not a git repository',
  unknown_revision: 'the requested revision does not exist',
  git_failed: 'git could not produce the diff'
};

export function noSourceText(reason, detail) {
  const known = NO_SOURCE_REASONS[reason];
  const summary = known ?? 'the diff could not be built';
  const trailer = known && reason !== 'git_failed' ? '' : detail ? ` (${firstLine(detail)})` : '';
  return (
    `redline: ${summary}${trailer}. ` +
    `Pass an explicit source (patch or file pairs) or run from a git repository.`
  );
}

function firstLine(detail) {
  const line = String(detail)
    .split('\n')
    .map((each) => each.trim())
    .find((each) => each.length > 0);
  return (line ?? '').replace(/^(warning|fatal|error):\s*/i, '').replace(/\.$/, '');
}

function toolError(err) {
  let text;
  if (err?.code === DISCOVER_NO_LOCK) {
    text = noWindowText(err.cwd ?? process.cwd());
  } else if (err?.code === DISCOVER_STALE_LOCK) {
    text = staleWindowText(err.folder ?? err.cwd ?? process.cwd());
  } else if (err?.code === NO_SOURCE) {
    text = noSourceText(err.reason, err.detail);
  } else {
    text = err?.message ?? String(err);
  }
  return { isError: true, content: [{ type: 'text', text }] };
}

const SOURCE_SCHEMA = {
  type: 'object',
  description:
    'One of {kind:"worktree",scope:"staged"|"unstaged"|"all"}, {kind:"range",from,to}, {kind:"patch",text}, {kind:"files",pairs:[{left,right}]}.',
  properties: {
    kind: { type: 'string', enum: ['worktree', 'range', 'patch', 'files'] },
    scope: { type: 'string', enum: ['staged', 'unstaged', 'all'] },
    from: { type: 'string' },
    to: { type: 'string' },
    text: { type: 'string' },
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { left: { type: 'string' }, right: { type: 'string' } },
        required: ['left', 'right']
      }
    }
  },
  required: ['kind']
};

const NOTE_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    summary: { type: 'string' },
    hunks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          newRange: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          summary: { type: 'string' },
          rationale: { type: 'string' }
        },
        required: ['newRange', 'summary']
      }
    }
  },
  required: ['file']
};

const TOOLS = [
  {
    name: 'request_review',
    description:
      'Open a diff as a review round in VS Code. Returns at once; the redline monitor wakes this session when the reviewer submits.',
    inputSchema: {
      type: 'object',
      properties: {
        source: SOURCE_SCHEMA,
        title: { type: 'string' },
        notes: { type: 'array', items: NOTE_SCHEMA }
      },
      required: ['source']
    }
  },
  {
    name: 'get_review',
    description:
      'Fetch the reviewer comments for a round as markdown and mark them delivered. Defaults to the newest round with undelivered comments. ' +
      'Then address every thread in payload order: edit the code, or answer in prose when no edit is warranted, and call resolve_comment(threadId) for each thread you addressed. ' +
      'Leave a thread open only when it needs the user to answer. Never author, edit, or delete a human comment. ' +
      'Finish by summarising what changed per thread and offering a new round with the same source; do not open one unasked.',
    inputSchema: {
      type: 'object',
      properties: {
        roundId: { type: 'string' },
        threads: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'list_reviews',
    description: 'List the review rounds of this VS Code window, newest first.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'resolve_comment',
    description:
      'Mark one review thread resolved once you have addressed it. Call it once per thread you handled after get_review, not in bulk before the edits.',
    inputSchema: {
      type: 'object',
      properties: { threadId: { type: 'string' } },
      required: ['threadId']
    }
  },
  {
    name: 'redline_ping',
    description: 'Find the VS Code window for this directory and ping the redline extension server.',
    inputSchema: { type: 'object', properties: {} }
  }
];

async function call(pathname, init = {}) {
  const found = await discover(process.cwd());
  const res = await fetch(`http://127.0.0.1:${found.port}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${found.token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {})
    },
    signal: AbortSignal.timeout(30000)
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    if (res.status === 422 && body?.code === NO_SOURCE) {
      const err = new Error(body.detail ?? 'redline: the diff could not be built');
      err.code = NO_SOURCE;
      err.reason = body.reason;
      err.detail = body.detail;
      throw err;
    }
    throw new Error(body?.error ?? `redline: ${pathname} returned ${res.status}`);
  }
  return body;
}

async function pendingHint() {
  try {
    const pending = await call('/pending');
    if (!Array.isArray(pending) || pending.length === 0) return null;
    const first = pending[0];
    return (
      `Undelivered review feedback: round ${first.roundId} has ${first.threadIds.length} ` +
      `comments (${first.fileCount} files). Call get_review("${first.roundId}").`
    );
  } catch {
    return null;
  }
}

async function withHint(text) {
  const hint = await pendingHint();
  return { content: [{ type: 'text', text: hint ? `${text}\n\n${hint}` : text }] };
}

const handlers = {
  async request_review(args) {
    const summary = await call('/rounds', {
      method: 'POST',
      body: JSON.stringify({ source: args.source, title: args.title, notes: args.notes })
    });
    return withHint(
      `Opened round ${summary.id} (${summary.sourceLabel}, ${summary.fileCount} files). ` +
        'Waiting for review in VS Code.'
    );
  },

  async get_review(args) {
    let roundId = args.roundId;
    if (!roundId) {
      const pending = await call('/pending');
      roundId = pending[0]?.roundId;
      if (!roundId) {
        return { content: [{ type: 'text', text: 'No undelivered review feedback.' }] };
      }
    }
    const threads = Array.isArray(args.threads) && args.threads.length > 0
      ? `?threads=${args.threads.map(encodeURIComponent).join(',')}`
      : '';
    const review = await call(`/rounds/${encodeURIComponent(roundId)}/review${threads}`);
    return { content: [{ type: 'text', text: review.markdown }] };
  },

  async list_reviews() {
    const rounds = await call('/rounds');
    const text =
      rounds.length === 0
        ? 'No review rounds yet.'
        : rounds
            .map(
              (round) =>
                `${round.id}  ${round.sourceLabel}  ${round.fileCount} files  ` +
                `${round.openThreads} open  ${round.submittedAt ? 'submitted' : 'in review'}` +
                (round.title ? `  ${round.title}` : '')
            )
            .join('\n');
    return withHint(text);
  },

  async resolve_comment(args) {
    const thread = await call(`/threads/${encodeURIComponent(args.threadId)}/resolve`, {
      method: 'POST'
    });
    return withHint(`Resolved ${thread.id}.`);
  },

  async redline_ping() {
    const { port, ping } = await discover(process.cwd());
    return withHint(JSON.stringify({ port, ...ping }));
  }
};

const server = new Server(
  { name: 'redline', version: '0.0.1' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const handler = handlers[request.params.name];
  if (!handler) {
    return { isError: true, content: [{ type: 'text', text: `redline: unknown tool ${request.params.name}` }] };
  }
  try {
    return await handler(request.params.arguments ?? {});
  } catch (err) {
    return toolError(err);
  }
});

await server.connect(new StdioServerTransport());
