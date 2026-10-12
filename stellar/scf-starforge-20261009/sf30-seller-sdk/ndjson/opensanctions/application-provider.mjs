// MIT. Source-owned registration in the maintained Applications registry.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../../distribution/runtime-workspace/application-provider.mjs';
import { opensanctionsApplication, prepareOpenSanctionsApplication, opensanctionsStartup, OPENSANCTIONS_STARTUP } from './managed.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'opensanctions', order: 161,
  catalog({ common }) { return [opensanctionsApplication(common)]; },
  prepare(type, settings, context) { return prepareOpenSanctionsApplication(settings, context); },
  resourceKey(type, settings, { hash }) {
    return hash({ family: 'ndjson', directory: settings.workspaceDirectory });
  },
  matchRequest(request) { return !request.pythonCommand && request.command === 'source-monitoring'; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + OPENSANCTIONS_STARTUP + '",')) return null;
      return () => opensanctionsStartup(request, text);
    });
  },
};
