// MIT. Source-owned Datasette Applications provider.
import {APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup} from '../application-provider.mjs';
import {datasetteApplication, prepareDatasetteApplication, datasetteStartup} from '../application-datasette.mjs';
export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'datasette', order: 1090, appendPort: false,
  catalog({common}) {return [datasetteApplication(common)];},
  async prepare(_type, settings, {inputPath, runtimeDirectory}) {
    const {args, inputs, createDirectories} = await prepareDatasetteApplication(settings, inputPath, runtimeDirectory);
    return {args, inputs, createDirectories};
  },
  resourceKey(_type, settings, {hash}) {return hash({family: 'datasette', directory: settings.workspaceDirectory});},
  matchRequest(request) {return !request.pythonCommand && request.command === 'datasette-application' && request.args?.[0] === 'serve';},
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{')) return null;
      return () => datasetteStartup(request, text);
    });
  },
};
