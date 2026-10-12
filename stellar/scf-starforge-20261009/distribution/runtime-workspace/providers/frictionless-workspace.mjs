// MIT. Frictionless source onboarding in the saved Applications lifecycle.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { frictionlessAgentApplication, prepareFrictionlessAgentApplication, frictionlessAgentStartup } from '../application-frictionless-workspace.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'frictionless-agent',
  order: 1060,
  catalog({ common }) { return [frictionlessAgentApplication(common)]; },
  async prepare(_type, settings, { inputPath, runtimeDirectory }) {
    const selected = await prepareFrictionlessAgentApplication(settings, inputPath, runtimeDirectory);
    return { args: selected.args, inputs: selected.inputs, createDirectories: [] };
  },
  resourceKey(_type, settings, { hash }) {
    return hash({ family: 'merchant-mcp', directory: settings.configurationFile });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'frictionless-agent';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.frictionless-agent-workspace-startup.v1",')) return null;
      return () => frictionlessAgentStartup(request, text);
    });
  },
};
