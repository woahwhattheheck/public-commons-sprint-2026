// MIT. Additive customer Analysis provider; Applications retains the operation.
import { dirname } from 'node:path';
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { need } from '../storage.mjs';
import { datasetteAnalysisApplication, prepareDatasetteAnalysisApplication,
  datasetteAnalysisResource, datasetteAnalysisStartup } from '../application-datasette-analysis.mjs';
import { parseDatasetteAnalysisCommand, resolveDatasetteAnalysisCommand } from '../../../sf30-seller-sdk/datasette-analysis/cli.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'datasette-analysis',
  order: 111,
  appendPort: false,
  catalog({ common }) { return [datasetteAnalysisApplication(common)]; },
  prepare(type, settings, context) { return prepareDatasetteAnalysisApplication(settings, context); },
  resourceKey(type, settings) { return datasetteAnalysisResource(settings); },
  matchRequest(request) { return !request.pythonCommand && request.command === 'datasette-analysis'; },
  async prepareChild(request, directory, originalArgs, environment) {
    const { selection } = parseDatasetteAnalysisCommand(request.args);
    need(selection.root === dirname(dirname(directory)) && selection.expectedBindingSha256,
      'DATASETTE_ANALYSIS_MANAGED_SELECTION_CHANGED');
    const command = await resolveDatasetteAnalysisCommand(request.args, { leaseFd: 3 });
    return { executable: command.executable, args: command.args,
      options: { cwd: command.cwd, shell: false, env: environment, stdio: ['ignore', 'pipe', 'pipe', 3] } };
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{') || !text.includes('"stellar-forge.datasette-operator.v1"')) return null;
      return () => datasetteAnalysisStartup(request, text, context);
    });
  },
};
