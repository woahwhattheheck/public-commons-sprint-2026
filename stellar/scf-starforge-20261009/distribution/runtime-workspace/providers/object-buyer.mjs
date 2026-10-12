// MIT. object-buyer Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { join } from "node:path";
import { absolute, readJSON, need, json } from "../storage.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "object-buyer", order: 460,
  catalog({ common, field }) { return [{ id: 'object-buyer', command: 'buyer-object-workspace', requiredSource: 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-workspace/server.mjs',
    title: 'Object buyer workspace', terminal: true,
    description: 'Reopen original object sessions, received products, verified downloads and analysis. Every new acquisition retains its original explicit terminal approval.',
    fields: [field('stateDirectory', 'Original private object buyer state', 'path', true), field('profileFile', 'Original product profile'),
      field('operatorSettings', 'Original operator settings file'), field('analysisPython', 'Analysis Python executable'),
      field('terminalPython', 'Terminal Python executable', 'path', false, 'Defaults to /usr/bin/python3; the original managed worker supplies the terminal.'), ...common] }]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    await path('stateDirectory', 'directory', false, true);
    await path('profileFile', 'file'); await path('operatorSettings', 'file');
    const savedSettings = join(settings.stateDirectory, 'received', 'operator-settings.json');
    const original = await readJSON(savedSettings, true);
    if (original) {
      need(typeof original.path === 'string' && (!settings.operatorSettings || settings.operatorSettings === original.path),
        'APPLICATION_OBJECT_OPERATOR_CHANGED', 'Reopen this object workspace with its original operator settings path');
      absolute(original.path); inputs.push(await inputPath(savedSettings, 'file'));
    }
    let analysisPython;
    if (settings.analysisPython) {
      const selected = await selectedExecutable(settings.analysisPython);
      analysisPython = selected.executable; inputs.push(...selected.inputs);
    }
    option('--state', settings.stateDirectory); option('--profile', settings.profileFile);
    option('--operator-settings', settings.operatorSettings); option('--analysis-python', analysisPython);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "buyer-object-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      return text.startsWith('Object buyer workspace: ') ? text.slice('Object buyer workspace: '.length) : null;
    });
  },
};
