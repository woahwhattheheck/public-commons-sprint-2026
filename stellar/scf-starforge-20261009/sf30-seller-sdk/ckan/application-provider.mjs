// MIT. Original CKAN merchant application in the source-owned Applications registry.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup }
  from '../../distribution/runtime-workspace/application-provider.mjs';
import { ckanAgentApplication, prepareCkanAgentApplication, ckanAgentStartup }
  from '../../distribution/runtime-workspace/application-ckan.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'ckan',
  order: 1000,
  catalog({ common }) { return [ckanAgentApplication(common)]; },
  prepare(type, settings, context) {
    return prepareCkanAgentApplication(settings, context);
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'ckan-agent' && request.args?.[0] === 'serve';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.ckan-agent-startup.v1",')) return null;
      return () => ckanAgentStartup(request, text, context);
    });
  },
};
