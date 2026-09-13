import { createInterface } from 'node:readline';
import { attachSnapshot, memoryPersistence, refreshSnapshot, ReviewStore, startServer } from '../out/server.mjs';

const version = process.env.REDLINE_VERSION ?? '0.0.1-proto';
const repoRoot = process.env.REDLINE_REPO_ROOT ?? process.cwd();
const store = new ReviewStore(memoryPersistence());

const server = await startServer({
  workspaceFolders: [repoRoot],
  version,
  store,
  hooks: {
    onRoundCreated: async (round) => {
      const attached = await attachSnapshot(store, round, repoRoot);
      console.error(`proto-server: round ${round.id} has ${attached.files.length} file(s)`);
    },
    onRoundRefresh: (round, request) => refreshSnapshot(store, round, repoRoot, request)
  }
});

const emitPath = new URL('proto-emit.mjs', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');

console.log(
  JSON.stringify({ port: server.port, token: server.token, lockPath: server.lockPath }, null, 2)
);
console.log('trigger an event with:');
console.log(
  `  node ${emitPath} '{"type":"review_submitted","roundId":"r3","commentCount":3,"fileCount":2,"sourceLabel":"unstaged changes"}'`
);
console.log('stand in for the editor by typing one JSON command per line on stdin:');
console.log('  {"cmd":"thread","roundId":"r1","anchor":{"file":"src/app.ts","side":"right","newLine":2},"body":"rename this"}');
console.log('  {"cmd":"reply","threadId":"t-1234","body":"keep the guard"}');
console.log('  {"cmd":"send","threadId":"t-1234"}');
console.log('  {"cmd":"submit","roundId":"r1"}');

function run(command) {
  switch (command.cmd) {
    case 'thread':
      return store.addThread(
        command.roundId,
        command.anchor,
        command.author ?? 'human',
        command.body
      );
    case 'reply':
      return store.addComment(command.threadId, command.author ?? 'human', command.body);
    case 'send': {
      const thread = store.markSent(command.threadId);
      const eventId = server.emit({
        type: 'thread_sent',
        roundId: thread.roundId,
        threadId: thread.id,
        file: thread.anchor.file,
        line: thread.anchor.newLine ?? thread.anchor.oldLine ?? 1
      });
      return { threadId: thread.id, roundId: thread.roundId, eventId };
    }
    case 'submit': {
      const result = store.markSubmitted(command.roundId);
      const eventId = server.emit({
        type: 'review_submitted',
        roundId: result.roundId,
        commentCount: result.commentCount,
        fileCount: result.fileCount,
        sourceLabel: result.sourceLabel
      });
      return { ...result, eventId };
    }
    default:
      throw new Error(`unknown cmd ${String(command.cmd)}`);
  }
}

const stdin = createInterface({ input: process.stdin });
stdin.on('line', (line) => {
  const text = line.trim();
  if (text.length === 0) return;
  try {
    console.log(JSON.stringify(run(JSON.parse(text))));
  } catch (err) {
    console.error(`proto-server: ${err.message}`);
  }
});

const shutdown = () => {
  stdin.close();
  server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
