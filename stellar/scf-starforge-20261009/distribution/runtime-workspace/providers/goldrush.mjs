// MIT. goldrush Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { join } from "node:path";
import { readJSON, need, json } from "../storage.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "goldrush", order: 470,
  catalog({ common, field }) { return [{ id: 'goldrush', command: 'goldrush',
    requiredSource: 'stellar/scf-starforge-20261009/sf30-seller-sdk/examples/goldrush-stellar-pilot/workbench.mjs',
    title: 'GoldRush wallet research', terminal: true,
    description: 'Reopen the original wallet, saved requests, source comparisons and notes. Execution uses its original buyer and connected terminal.',
    fields: [field('stateDirectory', 'Initialized GoldRush workspace', 'path', true),
      field('referenceFile', 'Original observation manifest'),
      field('terminalPython', 'Terminal Python executable', 'path', false,
        'Defaults to /usr/bin/python3; uses the existing managed PTY.'), ...common] }]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    await path('stateDirectory', 'directory', false, true);
    const configFile = join(settings.stateDirectory, 'workbench.json');
    inputs.push(await inputPath(configFile, 'file'));
    const original = await readJSON(configFile);
    need(original.schema === 'stellar-forge.goldrush-workbench.v1' &&
      typeof original.id === 'string' && typeof original.release === 'string' &&
      typeof original.buyerState === 'string' && typeof original.inbox === 'string' &&
      !(original.workspace && original.profile), 'APPLICATION_GOLDRUSH_BINDING_CHANGED');
    inputs.push(await inputPath(original.release, 'directory'));
    for (const key of ['buyerState', 'inbox'])
      inputs.push(await inputPath(original[key], 'directory', false, true));
    if (original.workspace) inputs.push(await inputPath(original.workspace, 'directory', false, true));
    if (original.profile) inputs.push(await inputPath(original.profile, 'file'));
    const reference = settings.referenceFile ?? original.referenceFile;
    if (reference) inputs.push(await inputPath(reference, 'file'));
    args.push('workbench', '--state', settings.stateDirectory);
    option('--reference-file', settings.referenceFile);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "goldrush" && request.args?.[0] === 'workbench'; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      try {
        const ready = JSON.parse(text), stateIndex = request.args.indexOf('--state');
        if (ready.status === 'GOLDRUSH_WORKBENCH_READY' && stateIndex >= 0 &&
            ready.state === request.args[stateIndex + 1] && typeof ready.url === 'string') return ready.url;
      } catch {}
      return null;
    });
  },
};
