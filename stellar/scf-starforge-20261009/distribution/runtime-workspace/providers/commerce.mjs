// MIT. commerce Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { realpath, access } from "node:fs/promises";
import { constants } from "node:fs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "commerce", order: 510,
  catalog({ common, field }) { return [{ id: 'commerce', command: 'commerce-console', title: 'Commerce session', terminal: true,
    description: 'Reopen an initialized original commerce session. Its buyer approval remains in the connected original terminal.',
    fields: [field('directory', 'Initialized commerce session', 'path', true), field('finalityNode', 'Finality Node executable'),
      field('recoveryConfig', 'Private recovery configuration'), field('terminalPython', 'Terminal Python executable', 'path', false,
        'Defaults to /usr/bin/python3; the same managed worker uses the Python standard library PTY.'), ...common] }]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    await path('directory', 'directory', false, true); await path('recoveryConfig', 'file');
    const finalityNode = settings.finalityNode ? await realpath(settings.finalityNode) : null;
    if (finalityNode) { inputs.push(await inputPath(finalityNode, 'file')); await access(finalityNode, constants.X_OK); }
    args.push('start'); option('--directory', settings.directory);
    option('--finality-node', finalityNode ?? undefined); option('--recovery-config', settings.recoveryConfig);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "commerce-console"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      return text.startsWith('Commerce workspace: ') ? text.slice('Commerce workspace: '.length) : null;
    });
  },
};
