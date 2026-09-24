import * as vscode from 'vscode';
import type { ReviewEvent } from '@redline/protocol';
import { ReviewStore, type Persistence, type StoreState } from './review/store.ts';
import { ReviewUi } from './review/ui.ts';
import { RoundView } from './review/view.ts';
import { startServer, type RunningServer, type StartServerOptions } from './server/index.ts';
import { Onboarding } from './onboarding.ts';

const STATE_KEY = 'redline.store';
const PROBE_INTERVAL_MS = 10_000;
const PROBE_FAILURES_BEFORE_RESTART = 2;

let server: RunningServer | undefined;
let starting: Promise<void> | undefined;
let watchdog: ReturnType<typeof setInterval> | undefined;

function workspacePersistence(context: vscode.ExtensionContext): Persistence {
  return {
    load: () => context.workspaceState.get<StoreState>(STATE_KEY),
    save: (state) => {
      void context.workspaceState.update(STATE_KEY, state);
    }
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const version: string = context.extension.packageJSON.version;
  const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  const store = new ReviewStore(workspacePersistence(context));

  const emit = (event: ReviewEvent): boolean => (server?.emit(event).delivered ?? 0) > 0;
  const ui = new ReviewUi(store, folders[0], {
    emitSubmitted: (payload) => emit({ type: 'review_submitted', ...payload }),
    emitThreadSent: (payload) => emit({ type: 'thread_sent', ...payload })
  }, context.extensionUri);
  ui.register(context);
  new RoundView(store, ui.navigator).register(context, {
    submit: (roundId) => ui.submit(undefined, roundId),
    drop: (roundId) => ui.dropRound(roundId),
    refresh: (roundId) => ui.refreshFromSource(roundId),
    copy: (roundId) => ui.copyRoundId(roundId)
  });

  void ui.navigator.closeStaleMultiDiffTabs();

  const onboarding = new Onboarding(context);
  onboarding.register();
  void onboarding.start();

  context.subscriptions.push(
    vscode.commands.registerCommand('redline.clearRounds', async () => {
      const count = store.rounds().length;
      const pick = await vscode.window.showWarningMessage(
        `Redline: discard ${count} review ${count === 1 ? 'round' : 'rounds'} and their comments?`,
        { modal: true },
        'Discard'
      );
      if (pick !== 'Discard') return;
      store.clear();
      ui.rebuildThreads();
      void vscode.window.showInformationMessage('Redline: review rounds cleared.');
    })
  );

  if (folders.length === 0) {
    void vscode.window.showWarningMessage(
      'Redline: open a folder for the review server to start.'
    );
    return;
  }

  const log = vscode.window.createOutputChannel('Redline', { log: true });
  context.subscriptions.push(log);

  const options: StartServerOptions = {
    workspaceFolders: folders,
    version,
    app: vscode.env.uriScheme,
    appName: vscode.env.appName,
    store,
    hooks: {
      onRoundCreated: (round) => ui.materialize(round),
      onRoundRefresh: (round, request) => ui.refresh(round, request),
      onThreadResolved: (threadId) => ui.refreshThread(threadId),
      onThreadReplied: (threadId) => {
        ui.refreshThread(threadId);
        ui.expandThread(threadId);
      },
      onThreadSeeded: (threadId) => ui.showThread(threadId),
      onNotesAdded: (_roundId, threadIds) => {
        for (const threadId of threadIds) ui.showThread(threadId);
      },
      onRoundDropped: (roundId) => ui.removeRound(roundId)
    }
  };

  const start = (): Promise<void> =>
    startServer(options).then(
      (running) => {
        server = running;
        log.info(`Review server listening on 127.0.0.1:${running.port} (${running.lockPath}).`);
      },
      (err: unknown) => {
        log.error(`Could not start the review server: ${String(err)}`);
        void vscode.window.showErrorMessage(
          `Redline: could not start the review server (${String(err)}).`
        );
      }
    );
  starting = start();

  // Seen on Windows: the listener stops taking new connections while the host and open streams stay alive, and the lock keeps pointing at it.
  let failures = 0;
  let restarting = false;
  watchdog = setInterval(() => {
    if (!server || restarting) return;
    const current = server;
    void current.probe().then(async (reason) => {
      if (!reason) {
        failures = 0;
        return;
      }
      failures++;
      log.warn(`Review server did not answer its own ping (${reason}), ${failures}/${PROBE_FAILURES_BEFORE_RESTART}.`);
      if (failures < PROBE_FAILURES_BEFORE_RESTART || server !== current) return;
      failures = 0;
      restarting = true;
      try {
        server = undefined;
        await current.close();
        if (!watchdog) return;
        starting = start();
        await starting;
      } finally {
        restarting = false;
      }
    });
  }, PROBE_INTERVAL_MS);
}

export async function deactivate(): Promise<void> {
  clearInterval(watchdog);
  watchdog = undefined;
  await starting;
  starting = undefined;
  await server?.close();
  server = undefined;
}
