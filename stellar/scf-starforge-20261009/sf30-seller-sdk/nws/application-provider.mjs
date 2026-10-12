// MIT. Source-owned NWS launcher within the original managed Applications lifecycle.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { nwsApplication, prepareNwsApplication, nwsStartup, NWS_READY_SCHEMA } from '../../distribution/runtime-workspace/application-nws.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'nws-site-weather',
  order: 1000,
  catalog({ common }) {
    return [nwsApplication(common)];
  },
  async prepare(type, settings, context) {
    const original = await prepareNwsApplication(settings, context);
    return { ...original, createDirectories: original.createDirectories ?? [] };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'nws-workspace';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + NWS_READY_SCHEMA + '",')) return null;
      return () => nwsStartup(request, text);
    });
  },
};
