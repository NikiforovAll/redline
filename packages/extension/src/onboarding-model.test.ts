import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { join } from 'node:path';
import {
  claudeConfigDir,
  hasMarketplace,
  hasPlugin,
  installPluginCommandLine,
  installedPluginsPath,
  isPluginInstalled
} from './onboarding-model.ts';

describe('hasPlugin', () => {
  it('finds the plugin in a v2 registry', () => {
    const registry = JSON.stringify({
      version: 2,
      plugins: { 'redline@redline': [{ scope: 'user', version: '0.1.0' }] }
    });
    assert.equal(hasPlugin(registry), true);
  });

  it('treats an empty install list as not installed', () => {
    assert.equal(hasPlugin(JSON.stringify({ plugins: { 'redline@redline': [] } })), false);
  });

  it('ignores other plugins and malformed files', () => {
    assert.equal(hasPlugin(JSON.stringify({ plugins: { 'other@redline': [{}] } })), false);
    assert.equal(hasPlugin('{not json'), false);
    assert.equal(hasPlugin(''), false);
  });
});

describe('registry location', () => {
  it('honors CLAUDE_CONFIG_DIR', () => {
    assert.equal(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/me'), '/cfg');
    assert.equal(claudeConfigDir({}, '/home/me'), join('/home/me', '.claude'));
    assert.equal(installedPluginsPath('/cfg'), join('/cfg', 'plugins', 'installed_plugins.json'));
  });

  it('reports a missing registry as not installed', async () => {
    assert.equal(await isPluginInstalled(join(import.meta.dirname, 'missing.json')), false);
  });
});

describe('hasMarketplace', () => {
  it('finds the redline marketplace by name regardless of its source', () => {
    const registry = JSON.stringify({
      redline: { source: { source: 'directory', path: 'C:\\dev\\arev' } }
    });
    assert.equal(hasMarketplace(registry), true);
    assert.equal(hasMarketplace(JSON.stringify({ other: {} })), false);
    assert.equal(hasMarketplace('nope'), false);
  });
});

describe('installPluginCommandLine', () => {
  it('chains both steps for pwsh and bash', () => {
    assert.equal(
      installPluginCommandLine('C:\\Program Files\\PowerShell\\7\\pwsh.exe', false),
      'claude plugin marketplace add nikiforovall/redline; claude plugin install redline@redline'
    );
    assert.equal(installPluginCommandLine('/bin/zsh', false), installPluginCommandLine('pwsh.exe', false));
  });

  it('uses & for cmd', () => {
    assert.equal(
      installPluginCommandLine('C:\\Windows\\System32\\cmd.exe', false),
      'claude plugin marketplace add nikiforovall/redline & claude plugin install redline@redline'
    );
  });

  it('skips the marketplace step when it is already known', () => {
    assert.equal(installPluginCommandLine('/bin/bash', true), 'claude plugin install redline@redline');
  });
});
