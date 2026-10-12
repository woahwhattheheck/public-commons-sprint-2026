// MIT. dataset Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { need } from "../storage.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "dataset", order: 420,
  catalog({ common, field }) { return [{ id: 'dataset', command: 'dataset-workspace', title: 'Dataset preview', terminal: false,
    description: 'Open an original dataset file or retained dataset state with its native query and preview controls.',
    fields: [field('datasetFile', 'Dataset file'), field('stateDirectory', 'Retained dataset state'), field('catalogDirectory', 'Catalog directory'),
      field('resource', 'Resource URL', 'text'), ...common] }]; },
  validateSettings(type, settings) {
    need(Boolean(settings.datasetFile) !== Boolean(settings.stateDirectory),
      'APPLICATION_DATASET_SELECTION_REQUIRED', 'Choose exactly one original dataset file or retained state');
  },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    await path('datasetFile', 'file'); await path('stateDirectory', 'directory', false, true);
    await path('catalogDirectory', 'directory', false, true);
    option('--dataset', settings.datasetFile); option('--state', settings.stateDirectory);
    option('--catalog', settings.catalogDirectory); option('--resource', settings.resource);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "dataset-workspace" && !request.args?.includes('--stellar-expert'); },
  createObserver(request, directory, context) {
    let datasetMarker = false;
    return observeApplicationStartup(request, directory, text => {
      if (text.startsWith('Dataset workspace —')) datasetMarker = true;
      else if (datasetMarker && text.startsWith('http://')) { datasetMarker = false; return text; }
      return null;
    });
  },
};
