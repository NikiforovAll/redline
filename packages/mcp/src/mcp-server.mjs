#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { discover, DISCOVER_NO_LOCK, DISCOVER_STALE_LOCK } from './discover.mjs';
import { CONNECT_TEXT, monitorArmed, plural, sleep, WAIT_MAX_S } from './wake.mjs';
import { VERSION } from './version.mjs';

const WAIT_POLL_MS = Number(process.env.REDLINE_WAIT_POLL_MS) || 2000;
const MONITOR_GRACE_MS = Number(process.env.REDLINE_MONITOR_GRACE_MS ?? 3000);

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
    'One of {kind:"worktree",scope:"staged"|"unstaged"|"all"}, {kind:"range",from,to}, {kind:"patch",text}, {kind:"files",pairs:[{left,right}]}. A range `to` of "worktree" or "index" compares the ref in `from` against the files on disk or the staged files.',
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
  description: 'One comment thread on the diff. The Comments panel previews the first line of body, so that line must stand alone.',
  properties: {
    file: { type: 'string', description: 'Path as the diff names it, relative to the workspace root.' },
    line: { type: 'integer', minimum: 1, description: 'A line number on the new side of the diff. The thread snaps to the first changed line of the hunk that contains it.' },
    body: { type: 'string', description: 'Markdown. First line is the one-sentence caption; a blank line, then any explanation.' }
  },
  required: ['file', 'line', 'body']
};

const TOOLS = [
  {
    name: 'request_review',
    description:
      'Open a diff as a review round in VS Code, or refresh the open round on the same worktree scope or range so the reviewer sees the current diff with their threads carried over. ' +
      'With roundId instead of source, refresh that round (a round the reviewer opened with Compare, or one from list_reviews) from its stored source and attach the title and notes to it. Returns at once; invoke the redline-connect skill next. ' +
      'To add notes to a round that is already open, call add_notes.',
    inputSchema: {
      type: 'object',
      properties: {
        source: SOURCE_SCHEMA,
        roundId: { type: 'string', description: 'An existing round id from list_reviews. Replaces source.' },
        title: { type: 'string' },
        notes: { type: 'array', items: NOTE_SCHEMA }
      }
    }
  },
  {
    name: 'add_notes',
    description:
      'Post notes under an existing round: a remark the user asked for, a follow-up on a file, a pointer to a line. Each note becomes a thread the reviewer sees in the diff as it stands. ' +
      'roundId is the one request_review returned, the one the user gives, or one from list_reviews. Nothing else changes: no diff rebuild, no submit, no new round.',
    inputSchema: {
      type: 'object',
      properties: {
        roundId: { type: 'string', description: 'An existing round id, such as r3.' },
        notes: { type: 'array', items: NOTE_SCHEMA, minItems: 1 }
      },
      required: ['roundId', 'notes']
    }
  },
  {
    name: 'get_review',
    description:
      'Fetch the reviewer comments for a round as markdown and mark them delivered. Defaults to the newest round with undelivered comments. ' +
      `With wait (seconds, max ${WAIT_MAX_S}) it blocks until the reviewer submits that round, or without roundId until any round has undelivered comments, then returns them; on timeout it says so and you call it again. ` +
      'Then work through every thread in payload order; each one ends in one of two states. ' +
      'Done: the change landed in the code, or you declined it with the reason. Close it with resolve_comment(threadId, body) and a one-line note. ' +
      "Reviewer's turn: the comment is unclear, you want a yes before changing code, or you answered a question. Post with reply_comment(threadId, body) and leave the thread open. " +
      'Never author, edit, or delete a human comment. ' +
      'Finish by summarising what changed per thread, then call request_review again on the same source so the round refreshes with your edits; notes are optional there. ' +
      'On a round you have worked before, pass peek: true. It returns one index line per thread plus only the comments you have not seen, no diff context and no history, and marks those threads delivered like a full read. ' +
      'Act from the index when the new comments stand on their own; call get_review({roundId, threads: [id]}) only for a thread that needs its context or history.',
    inputSchema: {
      type: 'object',
      properties: {
        roundId: { type: 'string' },
        threads: { type: 'array', items: { type: 'string' } },
        peek: { type: 'boolean', description: 'Return a compact index of the undelivered threads instead of the full threads.' },
        wait: { type: 'integer', minimum: 0, maximum: WAIT_MAX_S }
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
      "Close a done thread: the change landed, or you declined it with the reason. One call per thread, after its edit. A thread that is the reviewer's turn takes reply_comment instead. " +
      'body (markdown, one or two sentences) is the closing note on what changed.',
    inputSchema: {
      type: 'object',
      properties: { threadId: { type: 'string' }, body: { type: 'string' } },
      required: ['threadId']
    }
  },
  {
    name: 'reply_comment',
    description:
      "Post to one thread and hand the turn to the reviewer: a clarifying question, a proposal waiting for a yes, an answer to their question. Markdown, one to three sentences. " +
      'The thread stays open until they resolve it or reply.',
    inputSchema: {
      type: 'object',
      properties: { threadId: { type: 'string' }, body: { type: 'string' } },
      required: ['threadId', 'body']
    }
  },
  {
    name: 'redline_ping',
    description:
      'Find the VS Code window for this directory and ping the redline extension server. ' +
      'The result\'s monitor field says whether a redline monitor wakes this session on submit: armed, absent, or unknown.',
    inputSchema: { type: 'object', properties: {} }
  }
];

async function call(pathname, init = {}, found) {
  found ??= await discover(process.cwd());
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

async function pendingHint(found) {
  try {
    const pending = await call('/pending', {}, found);
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

async function withHint(text, found) {
  const hint = await pendingHint(found);
  return { content: [{ type: 'text', text: hint ? `${text}\n\n${hint}` : text }] };
}

// Seen in the wild: a model passing text where the schema says body.
function commentBody(args) {
  const value = typeof args.body === 'string' ? args.body : typeof args.text === 'string' ? args.text : '';
  return value.trim();
}

// With a roundId: that round's submit. Without: any round holding undelivered comments, so a
// round fetched earlier never satisfies the wait again.
async function waitForSubmit(roundId, seconds) {
  const deadline = Date.now() + seconds * 1000;
  const window = await discover(process.cwd());
  for (;;) {
    if (roundId) {
      const round = await call(`/rounds/${encodeURIComponent(roundId)}`, {}, window);
      if (round.submittedAt) return round.id;
    } else {
      const pending = await call('/pending', {}, window);
      if (pending[0]) return pending[0].roundId;
    }
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(WAIT_POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

function droppedNotesText(summary) {
  const unmatched = summary.unmatchedNoteFiles ?? [];
  return unmatched.length > 0
    ? ` Notes on ${unmatched.length} file(s) were dropped because the diff does not contain them: ${unmatched.join(', ')}. ` +
        `Tell the user, and widen the source (scope "all", or a range) if they belong in the review.`
    : '';
}

const handlers = {
  async request_review(args) {
    const window = await discover(process.cwd());
    const summary = await call(
      '/rounds',
      {
        method: 'POST',
        body: JSON.stringify({ roundId: args.roundId, source: args.source, title: args.title, notes: args.notes })
      },
      window
    );
    return withHint(
      `${summary.message}.${droppedNotesText(summary)} ` +
        `Waiting for review in ${window.ping.appName ?? 'VS Code'}. ${CONNECT_TEXT}`,
      window
    );
  },

  async add_notes(args) {
    const window = await discover(process.cwd());
    const summary = await call(
      `/rounds/${encodeURIComponent(String(args.roundId))}/notes`,
      { method: 'POST', body: JSON.stringify({ notes: args.notes }) },
      window
    );
    return withHint(`Posted ${plural(summary.threadIds.length, 'note')} to ${summary.id} (${summary.sourceLabel}).${droppedNotesText(summary)}`, window);
  },

  async get_review(args) {
    let roundId = args.roundId;
    const wait = Math.min(WAIT_MAX_S, Math.max(0, Number(args.wait) || 0));
    if (wait > 0) {
      roundId = await waitForSubmit(roundId, wait);
      if (!roundId) {
        return {
          content: [
            {
              type: 'text',
              text: `No review submitted within ${wait}s. Call get_review again with wait to keep waiting.`
            }
          ]
        };
      }
    }
    if (!roundId) {
      const pending = await call('/pending');
      roundId = pending[0]?.roundId;
      if (!roundId) {
        return { content: [{ type: 'text', text: 'No undelivered review feedback.' }] };
      }
    }
    const params = new URLSearchParams();
    if (Array.isArray(args.threads) && args.threads.length > 0) params.set('threads', args.threads.join(','));
    if (args.peek) params.set('peek', '1');
    const query = params.toString();
    const review = await call(`/rounds/${encodeURIComponent(roundId)}/review${query ? `?${query}` : ''}`);
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
                (round.title ? `  ${round.title}` : '') +
                (round.source.kind === 'worktree' || round.source.kind === 'range' ? `  source=${JSON.stringify(round.source)}` : '')
            )
            .join('\n');
    return withHint(text);
  },

  async resolve_comment(args) {
    const body = commentBody(args);
    const thread = await call(`/threads/${encodeURIComponent(args.threadId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body ? { body } : {})
    });
    return withHint(`Resolved ${thread.id}.`);
  },

  async reply_comment(args) {
    const body = commentBody(args);
    if (!body) {
      throw new Error('redline: reply_comment needs body, a non-empty markdown string. Pass it as {threadId, body}.');
    }
    const thread = await call(`/threads/${encodeURIComponent(args.threadId)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body })
    });
    return withHint(`Replied in ${thread.id}.`);
  },

  async redline_ping() {
    const { port, ping } = await discover(process.cwd());
    // The monitor starts on skill invoke, so its first heartbeat can land after this call begins.
    let armed = monitorArmed();
    const deadline = Date.now() + MONITOR_GRACE_MS;
    while (armed === false && Date.now() < deadline) {
      await sleep(200);
      armed = monitorArmed();
    }
    const monitor = armed === true ? 'armed' : armed === false ? 'absent' : 'unknown';
    return withHint(JSON.stringify({ port, monitor, ...ping }));
  }
};

const server = new Server(
  { name: 'redline', version: VERSION },
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
