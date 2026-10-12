// MIT. Full original SF88 dataset receiving in the existing Applications lifecycle.
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, regular, plain, need } from './storage.mjs';
import { datasetWorkspaceSelection, matchDatasetWorkspaceLaunch, datasetWorkspaceUrl } from '../../sf88-operator-buyer-cli/dataset-workspace/launch.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/';
const field = (name, label, required = false, description = '') => ({ name, label, type: 'path', required, description });
export function datasetBuyerApplication(common = []) {
  return {
    id: 'dataset-buyer', command: 'buyer-dataset-workspace',
    requiredSource: SOURCE + 'dataset-workspace/server.mjs',
    title: 'Dataset buyer', terminal: true,
    description: 'Receive an original dataset offer, review and continue its native acquisition, reopen delivered rows and files, and use the original analysis workspace.',
    fields: [
      field('stateDirectory', 'Private customer workspace', true,
        'An existing workspace, or one new folder inside an existing private parent.'),
      field('profileFile', 'Existing dataset session profile', false,
        'Optional original profile naming retained acquisition sessions and their data rooms.'),
      field('operatorSettings', 'Private buyer operator settings', false,
        'Use the original operator preset when preparing a new acquisition. Retained datasets can open without it.'),
      field('analysisPython', 'Analysis Python executable', false,
        'Optional original Python interpreter. Select an analysis directory with it; the installed source is selected automatically.'),
      field('analysisDirectory', 'Private analysis workspace', false,
        'An existing original analytical workspace or a new directory in an existing private parent.'),
      field('terminalPython', 'Terminal Python executable', false,
        'Defaults to /usr/bin/python3. The original managed terminal carries native per-page approval.'),
      ...common,
    ],
  };
}

export async function prepareDatasetBuyerApplication(settings, { inputPath, selectedExecutable, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function' && typeof selectedExecutable === 'function',
    'APPLICATION_DATASET_ORIGINAL_INPUTS_REQUIRED');
  need(Boolean(settings.analysisPython) === Boolean(settings.analysisDirectory),
    'APPLICATION_DATASET_ANALYSIS_PAIR_REQUIRED', 'Select both the original Python executable and analytical directory.');
  // The caller already verifies the complete source at application review/start.
  // Read the same original profile/binding here without hashing the whole package twice.
  const runtime = await inspectMerchantRuntime(runtimeDirectory, { load: false, source: false });
  const inputs = [], createDirectories = [], args = [];
  const select = async (value, kind = 'directory', missing = false, privateOnly = false) => {
    const item = await inputPath(value, kind, missing, privateOnly); inputs.push(item); return item;
  };
  const state = await select(settings.stateDirectory, 'directory', true, true);
  if (!state.exists) createDirectories.push(state.path);
  args.push('--state', state.path);

  if (settings.profileFile) {
    const profileFile = await select(settings.profileFile, 'file');
    let profile;
    try { profile = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(profileFile.path, 262144))); }
    catch { need(false, 'APPLICATION_DATASET_PROFILE_INVALID', 'Choose the original dataset customer session profile.'); }
    need(plain(profile) && profile.schema === 'stellar-forge.sf88.dataset-workspace.v1' &&
      Array.isArray(profile.sessions) && profile.sessions.length <= 64,
      'APPLICATION_DATASET_PROFILE_INVALID');
    for (const session of profile.sessions) {
      need(plain(session) && typeof session.session === 'string' && typeof session.room === 'string',
        'APPLICATION_DATASET_PROFILE_INVALID');
      const acquisition = await select(session.session, 'directory', false, true);
      await select(join(acquisition.path, 'session.json'), 'file');
      // The original SF100 room may not exist until its first delivery.
      // Pin an existing directory; its exact future path is already in the profile.
      const room = absolute(session.room);
      let exists = true;
      try { await lstat(room); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
      if (exists) await select(room, 'directory', false, true);
      else inputs.push({ path: room, kind: 'dataset-room', exists: false });
    }
    args.push('--profile', profileFile.path);
  }
  if (settings.operatorSettings) {
    const operator = await select(settings.operatorSettings, 'file');
    args.push('--operator-settings', operator.path);
  }
  if (settings.analysisPython) {
    const selected = await selectedExecutable(settings.analysisPython);
    inputs.push(...selected.inputs);
    const analysis = await select(settings.analysisDirectory, 'directory', true, true);
    await select(join(runtime.sourceRoot, SOURCE, 'python/stellar_forge_buyer/analysis_workspace.py'), 'file');
    args.push('--analysis-python', selected.executable, '--analysis-checkout', runtime.sourceRoot,
      '--analysis-directory', analysis.path);
  }

  // The original printed prefix remains compatible with already installed editions.
  // New editions explicitly select the native structured announcement, so a failed
  // structured binding cannot fall back to a weaker later human-readable line.
  const launchFile = join(runtime.sourceRoot, SOURCE, 'dataset-workspace/launch.mjs');
  let structured = true;
  try { await lstat(launchFile); }
  catch (error) { if (error.code !== 'ENOENT') throw error; structured = false; }
  if (structured) {
    await select(launchFile, 'file');
    args.push('--startup-format', 'json');
  }
  return { args, inputs, createDirectories };
}

export function datasetBuyerStartup(request, text) {
  if (request.command !== 'buyer-dataset-workspace' || !Array.isArray(request.args)) return null;
  const flags = new Map(), allowed = new Set(['--state', '--profile', '--operator-settings', '--port',
    '--analysis-python', '--analysis-checkout', '--analysis-directory', '--startup-format']);
  for (let index = 0; index < request.args.length; index += 2) {
    const flag = request.args[index], value = request.args[index + 1];
    if (!allowed.has(flag) || flags.has(flag) || typeof value !== 'string' || !value) return null;
    flags.set(flag, value);
  }
  if (!flags.has('--state')) return null;
  const analysisKeys = ['--analysis-python', '--analysis-checkout', '--analysis-directory'];
  const analysis = analysisKeys.some(key => flags.has(key));
  if (analysis && !analysisKeys.every(key => flags.has(key))) return null;
  let expected;
  try {
    expected = datasetWorkspaceSelection({
      stateDirectory: flags.get('--state'), profilePath: flags.get('--profile') ?? null,
      operatorSettings: flags.get('--operator-settings') ?? null,
      analysis: analysis ? { python: flags.get('--analysis-python'), checkout: flags.get('--analysis-checkout'),
        directory: flags.get('--analysis-directory') } : null,
    });
  } catch { return null; }
  const port = flags.has('--port') ? Number(flags.get('--port')) : 8439;
  if (!Number.isInteger(port) || port < 0 || port > 65535) return null;
  if (flags.has('--startup-format')) {
    if (flags.get('--startup-format') !== 'json') return null;
    try { return matchDatasetWorkspaceLaunch(JSON.parse(text), expected, port); }
    catch { return null; }
  }
  const prefix = 'Dataset customer workspace: ';
  return text.startsWith(prefix) ? datasetWorkspaceUrl(text.slice(prefix.length), port) : null;
}

