// MIT. duckdb-agent Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { duckdbAgentApplication, prepareDuckDBAgentApplication, duckdbAgentStartup, DUCKDB_AGENT_STARTUP_SCHEMA } from '../application-duckdb-agent.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'duckdb-agent', order: 270,
  catalog({ common }) { return [duckdbAgentApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, runtimeDirectory } = context;
    const { args, inputs, createDirectories } = applicationPreparation(settings, inputPath);
    const original = await prepareDuckDBAgentApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
    return { args, inputs, createDirectories };
  },
  resourceKey(type, settings, { hash }) { return hash({ family: 'native-mcp', directory: settings.nativeDirectory }); },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'mcp-native' && request.args?.includes('--duckdb-description');
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + DUCKDB_AGENT_STARTUP_SCHEMA + '",')) return null;
      return () => duckdbAgentStartup(request, text);
    });
  },
};
