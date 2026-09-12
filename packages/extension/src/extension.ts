import * as vscode from 'vscode';
import type { ReviewEvent } from '@redline/protocol';
import { ReviewStore, type Persistence, type StoreState } from './review/store.ts';
import { ReviewUi } from './review/ui.ts';
import { RoundView } from './review/view.ts';
import { startServer, type RunningServer } from './server/index.ts';

const STATE_KEY = 'redline.store';

let server: RunningServer | undefined;
let starting: Promise<void> | undefined;

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
    drop: (roundId) => ui.dropRound(roundId)
  });

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

  starting = startServer({
    workspaceFolders: folders,
    version,
    app: vscode.env.uriScheme,
    appName: vscode.env.appName,
    store,
    hooks: {
      onRoundCreated: (round) => ui.materialize(round),
      onThreadResolved: (threadId) => ui.refreshThread(threadId),
      onThreadReplied: (threadId) => {
        ui.refreshThread(threadId);
        ui.expandThread(threadId);
      }
    }
  }).then(
    (running) => {
      server = running;
    },
    (err: unknown) => {
      void vscode.window.showErrorMessage(
        `Redline: could not start the review server (${String(err)}).`
      );
    }
  );
}

export async function deactivate(): Promise<void> {
  await starting;
  starting = undefined;
  await server?.close();
  server = undefined;
}
