// MIT. Source-owned OPENFEMA launcher within the original managed Applications lifecycle.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { openFemaApplication, prepareOpenFemaApplication, openFemaStartup, OPENFEMA_READY_SCHEMA } from './application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'openfema-public-assistance',
  order: 1000,
  catalog({ common }) {
    return [openFemaApplication(common)];
  },
  async prepare(type, settings, context) {
    const original = await prepareOpenFemaApplication(settings, context);
    return { ...original, createDirectories: original.createDirectories ?? [] };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'openfema-workspace';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + OPENFEMA_READY_SCHEMA + '",')) return null;
      return () => openFemaStartup(request, text);
    });
  },
};
