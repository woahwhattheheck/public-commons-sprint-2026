// MIT. postgres-workspace Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "postgres-workspace", order: 450,
  catalog({ common, field }) { return [{ id: 'postgres', command: 'postgres-workspace', title: 'PostgreSQL merchant authoring', terminal: false,
    description: 'Inspect the original database source, review its paid query contract and prepare the original merchant release.',
    fields: [field('sourceFile', 'Original PostgreSQL source', 'path', true), field('outputDirectory', 'Private merchant output directory', 'path', true),
      field('releaseStore', 'Existing release store'), ...common] }]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    await path('sourceFile', 'file'); await path('outputDirectory', 'directory', true, true);
    await path('releaseStore', 'directory', false, true);
    option('--source', settings.sourceFile); option('--output', settings.outputDirectory); option('--release-store', settings.releaseStore);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "postgres-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      const match = text.match(new RegExp('"workspace"\\s*:\\s*"([^"]+)"'));
      return match ? match[1] : null;
    });
  },
};
