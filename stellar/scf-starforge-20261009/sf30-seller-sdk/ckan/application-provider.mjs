// MIT. CKAN registration over the original merchant browser and agent service.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { ckanAgentApplication, prepareCkanAgentApplication, ckanAgentStartup } from '../../distribution/runtime-workspace/application-ckan.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'ckan-agent', order: 1030,
  catalog({ common }) { return [ckanAgentApplication(common)]; },
  async prepare(type, settings, context) {
    return prepareCkanAgentApplication(settings, {
      inputPath: context.inputPath, runtimeDirectory: context.runtimeDirectory,
    });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'ckan-agent' &&
      Array.isArray(request.args) && request.args[0] === 'serve';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.ckan-agent-startup.v1",')) return null;
      return () => ckanAgentStartup(request, text, context);
    });
  },
};
