// MIT. Source-owned COOPS launcher within the original managed Applications lifecycle.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { coopsApplication, prepareCoopsApplication, coopsStartup, COOPS_READY_SCHEMA } from './application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'coops-coastal-sources',
  order: 1000,
  catalog({ common }) {
    return [coopsApplication(common)];
  },
  async prepare(type, settings, context) {
    const original = await prepareCoopsApplication(settings, context);
    return { ...original, createDirectories: original.createDirectories ?? [] };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'coops-workspace';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + COOPS_READY_SCHEMA + '",')) return null;
      return () => coopsStartup(request, text);
    });
  },
};
