// MIT. superset Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { supersetApplication, prepareSupersetApplication, supersetStartup } from '../application-superset.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'superset', order: 1010,
  catalog({ common }) { return [supersetApplication(common)]; },
  async prepare(type, settings, context) {
    return prepareSupersetApplication(settings, { inputPath: context.inputPath, runtimeDirectory: context.runtimeDirectory });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'superset-workspace';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.superset-operator-launch.v1",')) return null;
      return () => supersetStartup(request, text);
    }, { lineLimit: 32768 });
  },
};
