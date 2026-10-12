// MIT. xml Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "xml", order: 400,
  catalog({ common, field }) { return [{ id: 'xml', command: 'dataset', requiredSource: 'stellar/scf-starforge-20261009/sf30-seller-sdk/xml/cli.mjs',
    title: 'XML dataset onboarding', terminal: false,
    description: 'Reopen an initialized XML workspace with its original sources, mappings, native datasets, comparison and portable editions.',
    fields: [field('workspaceDirectory', 'Initialized XML workspace', 'path', true), ...common] }]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    await path('workspaceDirectory', 'directory', false, true);
    args.push('xml', '--workspace', settings.workspaceDirectory, 'serve');
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "dataset" && request.args?.[0] === 'xml'; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      const match = text.match(/"console"\s*:\s*"([^"]+)"/);
      return match ? match[1] : null;
    });
  },
};
