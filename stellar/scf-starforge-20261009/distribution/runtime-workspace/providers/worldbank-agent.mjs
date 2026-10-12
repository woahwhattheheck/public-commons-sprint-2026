// MIT. World Bank Applications registration over the original browser and agent launcher.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { worldbankAgentApplication, prepareWorldBankAgentApplication,
  worldbankAgentStartup } from '../application-worldbank.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'worldbank-agent', order: 365,
  catalog({ common }) { return [worldbankAgentApplication(common)]; },
  async prepare(type, settings, { inputPath, runtimeDirectory }) {
    const original = await prepareWorldBankAgentApplication(settings, { inputPath, runtimeDirectory });
    return { args: original.args, inputs: original.inputs, createDirectories: [] };
  },
  resourceKey(type, settings, { hash }) {
    return hash({ family: 'merchant-mcp', directory: settings.configurationFile });
  },
  matchRequest(request) { return !request.pythonCommand && request.command === 'worldbank-agent'; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.worldbank-agent-startup.v1",')) return null;
      return () => worldbankAgentStartup(request, text);
    });
  },
};
