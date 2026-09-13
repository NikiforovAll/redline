import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PLUGIN_ID = 'redline@redline';
export const MARKETPLACE_SOURCE = 'nikiforovall/redline';

export const MARKETPLACE_NAME = PLUGIN_ID.split('@')[1];

export const ADD_MARKETPLACE_COMMAND = `claude plugin marketplace add ${MARKETPLACE_SOURCE}`;
export const INSTALL_PLUGIN_COMMAND = `claude plugin install ${PLUGIN_ID}`;

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.CLAUDE_CONFIG_DIR || join(home, '.claude');
}

export function installedPluginsPath(configDir = claudeConfigDir()): string {
  return join(configDir, 'plugins', 'installed_plugins.json');
}

export function hasPlugin(registry: string, pluginId = PLUGIN_ID): boolean {
  try {
    const parsed = JSON.parse(registry) as { plugins?: Record<string, unknown> };
    const entry = parsed.plugins?.[pluginId];
    return Array.isArray(entry) ? entry.length > 0 : entry != null;
  } catch {
    return false;
  }
}

export async function isPluginInstalled(path = installedPluginsPath()): Promise<boolean> {
  try {
    return hasPlugin(await readFile(path, 'utf8'));
  } catch {
    return false;
  }
}

export function knownMarketplacesPath(configDir = claudeConfigDir()): string {
  return join(configDir, 'plugins', 'known_marketplaces.json');
}

export function hasMarketplace(registry: string, name = MARKETPLACE_NAME): boolean {
  try {
    const parsed = JSON.parse(registry) as Record<string, unknown>;
    return parsed[name] != null;
  } catch {
    return false;
  }
}

export async function isMarketplaceKnown(path = knownMarketplacesPath()): Promise<boolean> {
  try {
    return hasMarketplace(await readFile(path, 'utf8'));
  } catch {
    return false;
  }
}

export function installPluginCommandLine(shell: string, marketplaceKnown: boolean): string {
  const separator = /cmd(\.exe)?$/i.test(shell) ? ' & ' : '; ';
  const steps = marketplaceKnown
    ? [INSTALL_PLUGIN_COMMAND]
    : [ADD_MARKETPLACE_COMMAND, INSTALL_PLUGIN_COMMAND];
  return steps.join(separator);
}
