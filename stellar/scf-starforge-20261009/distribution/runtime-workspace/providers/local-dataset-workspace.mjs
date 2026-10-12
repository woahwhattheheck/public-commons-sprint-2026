// MIT. Local dataset receiving in the saved Applications lifecycle.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { localDatasetAgentApplication, prepareLocalDatasetAgentApplication, localDatasetAgentStartup } from '../application-local-dataset.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'local-dataset-agent',
  order: 1050,
  catalog({ common }) { return [localDatasetAgentApplication(common)]; },
  async prepare(_type, settings, { inputPath, runtimeDirectory }) {
    const selected = await prepareLocalDatasetAgentApplication(settings, inputPath, runtimeDirectory);
    return { args: selected.args, inputs: selected.inputs, createDirectories: [] };
  },
  resourceKey(_type, settings, { hash }) {
    return hash({ family: 'merchant-mcp', directory: settings.configurationFile });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'local-dataset-agent';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.local-dataset-agent-workspace-startup.v1",')) return null;
      return () => localDatasetAgentStartup(request, text);
    });
  },
};
