// MIT. directus Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { directusApplication, prepareDirectusApplication, directusStartup } from '../application-directus.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'directus', order: 1010,
  catalog({ common }) { return [directusApplication(common)]; },
  async prepare(type, settings, context) {
    return prepareDirectusApplication(settings, { inputPath: context.inputPath, runtimeDirectory: context.runtimeDirectory });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'directus-workspace';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.directus-operator-launch.v1",')) return null;
      return () => directusStartup(request, text);
    }, { lineLimit: 32768 });
  },
};
