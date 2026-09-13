import * as vscode from 'vscode';
import { dirname } from 'node:path';
import {
  PLUGIN_ID,
  installPluginCommandLine,
  installedPluginsPath,
  isMarketplaceKnown,
  isPluginInstalled
} from './onboarding-model.ts';

export const WALKTHROUGH_ID = 'nikiforovall.redline-extension#redline.gettingStarted';

const PLUGIN_INSTALLED_CONTEXT = 'redline.pluginInstalled';
const ONBOARDING_SHOWN_KEY = 'redline.onboardingShown';
const TERMINAL_NAME = 'Redline setup';

export class Onboarding {
  private installed = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  register(): void {
    const { subscriptions } = this.context;
    subscriptions.push(
      vscode.commands.registerCommand('redline.openWalkthrough', () => this.openWalkthrough()),
      vscode.commands.registerCommand('redline.installPlugin', () => this.installPlugin()),
      vscode.commands.registerCommand('redline.checkPlugin', () => this.checkPlugin(true)),
      vscode.commands.registerCommand('redline.resetOnboarding', async () => {
        await this.context.globalState.update(ONBOARDING_SHOWN_KEY, undefined);
        await this.openWalkthrough();
      })
    );

    const registry = installedPluginsPath();
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(dirname(registry)), 'installed_plugins.json')
    );
    subscriptions.push(
      watcher,
      watcher.onDidChange(() => this.checkPlugin()),
      watcher.onDidCreate(() => this.checkPlugin()),
      watcher.onDidDelete(() => this.checkPlugin()),
      vscode.window.onDidCloseTerminal((terminal) => {
        if (terminal.name === TERMINAL_NAME) void this.checkPlugin();
      })
    );
  }

  async start(): Promise<void> {
    await this.checkPlugin();
    if (this.installed || this.context.globalState.get<boolean>(ONBOARDING_SHOWN_KEY)) return;
    await this.context.globalState.update(ONBOARDING_SHOWN_KEY, true);
    await this.openWalkthrough();
  }

  private async checkPlugin(report = false): Promise<boolean> {
    this.installed = await isPluginInstalled();
    await vscode.commands.executeCommand('setContext', PLUGIN_INSTALLED_CONTEXT, this.installed);
    if (report) {
      void vscode.window.showInformationMessage(
        this.installed
          ? `Redline: the Claude Code plugin ${PLUGIN_ID} is installed.`
          : `Redline: the Claude Code plugin ${PLUGIN_ID} is not installed.`
      );
    }
    return this.installed;
  }

  private openWalkthrough(): Thenable<unknown> {
    return vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID, false);
  }

  private async installPlugin(): Promise<void> {
    const marketplaceKnown = await isMarketplaceKnown();
    const terminal = vscode.window.createTerminal({ name: TERMINAL_NAME });
    terminal.show();
    terminal.sendText(installPluginCommandLine(vscode.env.shell, marketplaceKnown), true);
  }
}
