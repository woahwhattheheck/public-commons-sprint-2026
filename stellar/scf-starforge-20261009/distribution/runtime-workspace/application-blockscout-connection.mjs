// MIT. Applications registration for the original standalone connection desk.
import { join } from 'node:path';
import { applicationField, applicationPrivateUrl } from './application-provider.mjs';
import { absolute, plain, need, regular, readJSON, digest } from './storage.mjs';
async function inspectConnectionWorkspace(directory) {
  const original = await import('../../partners/blockscout-stellar-pro-api/connection-workspace/model.mjs');
  return original.inspectConnectionWorkspace(directory);
}

const STARTUP = 'stellar-forge.blockscout-connection-workspace-startup.v1';
export function blockscoutConnectionApplication(common) {
  return {
    id: 'blockscout-connections', command: 'blockscout-connections',
    title: 'Blockscout connection setup', terminal: false,
    requiredSource: 'stellar/scf-starforge-20261009/partners/blockscout-stellar-pro-api/connection-workspace/cli.mjs',
    description: 'Review an existing plan or complete connection bundle, receive a private merchant package, and use the original Applications launcher.',
    fields: [
      applicationField('workspaceDirectory', 'Private connection workspace', 'path', true,
        'Select an empty new directory or reopen this same saved connection desk.'),
      applicationField('applicationsDirectory', 'Existing Applications workspace', 'path', false,
        'Optional original runtime workspace owning the installed merchant runtimes.'),
      ...common,
    ],
  };
}
export async function prepareBlockscoutConnectionApplication(settings, inputPath) {
  const selected = await inputPath(settings.workspaceDirectory, 'directory', true, true);
  const inputs = [selected], args = ['serve', '--workspace', settings.workspaceDirectory];
  if (selected.exists) {
    let config;
    try { config = await inspectConnectionWorkspace(settings.workspaceDirectory); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const { readdir } = await import('node:fs/promises');
      need((await readdir(settings.workspaceDirectory)).length === 0,
        'APPLICATION_BLOCKSCOUT_CONNECTION_WORKSPACE_REQUIRED',
        'Select an empty directory or the original saved connection workspace.');
    }
    if (config) {
      const record = await inputPath(join(settings.workspaceDirectory, 'connection-workspace.json'), 'file');
      need(record.sha256 === config.configSha256, 'APPLICATION_BLOCKSCOUT_CONNECTION_WORKSPACE_CHANGED', undefined, 409);
      inputs.push(record);
      args.push('--expected-workspace-id', config.workspaceId, '--expected-config-sha256', config.configSha256);
    }
  }
  if (settings.applicationsDirectory) {
    need(settings.applicationsDirectory !== settings.workspaceDirectory,
      'APPLICATION_BLOCKSCOUT_CONNECTION_BINDING_INVALID');
    inputs.push(await inputPath(settings.applicationsDirectory, 'directory', false, true));
    const file = join(settings.applicationsDirectory, 'workspace.json');
    const record = await inputPath(file, 'file'), value = await readJSON(file);
    need(value.schema === 'stellar-forge.runtime-workspace.v1' && value.directory === settings.applicationsDirectory &&
      typeof value.workspaceId === 'string', 'APPLICATION_BLOCKSCOUT_CONNECTION_BINDING_INVALID');
    need(digest(await regular(file, 16384)) === record.sha256,
      'APPLICATION_BLOCKSCOUT_CONNECTION_BINDING_CHANGED', undefined, 409);
    inputs.push(record); args.push('--applications', settings.applicationsDirectory);
  }
  return { args, inputs, createDirectories: [] };
}
function argument(request, name, optional = false) {
  need(Array.isArray(request.args) && request.args[0] === 'serve', 'APPLICATION_BLOCKSCOUT_CONNECTION_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (!positions.length && optional) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_BLOCKSCOUT_CONNECTION_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
export async function blockscoutConnectionStartup(request, line) {
  if (request.command !== 'blockscout-connections' || typeof line !== 'string' || line.length > 16384) return null;
  let value; try { value = JSON.parse(line); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'BLOCKSCOUT_CONNECTION_WORKSPACE_RUNNING') return null;
  const directory = absolute(argument(request, '--workspace')), config = await inspectConnectionWorkspace(directory);
  need(value.directory === directory && value.workspaceId === config.workspaceId &&
    value.configSha256 === config.configSha256,
    'APPLICATION_BLOCKSCOUT_CONNECTION_STARTUP_CHANGED');
  const id = argument(request, '--expected-workspace-id', true), sha = argument(request, '--expected-config-sha256', true);
  need((id === undefined || id === config.workspaceId) && (sha === undefined || sha === config.configSha256),
    'APPLICATION_BLOCKSCOUT_CONNECTION_STARTUP_CHANGED');
  const href = applicationPrivateUrl(value.controlUrl);
  need(href, 'APPLICATION_BLOCKSCOUT_CONNECTION_STARTUP_CHANGED');
  const url = new URL(href);
  need(url.hostname === '127.0.0.1' && url.pathname === '/' && !url.search && /^[a-f0-9]{64}$/.test(url.hash.slice(1)),
    'APPLICATION_BLOCKSCOUT_CONNECTION_STARTUP_CHANGED');
  return { url: url.href, workspaceId: config.workspaceId,
    original: { schema: STARTUP, directory, workspaceId: config.workspaceId, configSha256: config.configSha256 } };
}
