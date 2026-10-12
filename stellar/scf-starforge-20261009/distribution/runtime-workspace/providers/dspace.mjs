// MIT. dspace Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { dspaceApplication, prepareDspaceApplication, dspaceStartup } from '../application-dspace.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'dspace', order: 1010,
  catalog({ common }) { return [dspaceApplication(common)]; },
  async prepare(type, settings, context) {
    return prepareDspaceApplication(settings, { inputPath: context.inputPath, runtimeDirectory: context.runtimeDirectory });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'dspace-workspace';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.dspace-operator-launch.v1",')) return null;
      return () => dspaceStartup(request, text);
    }, { lineLimit: 32768 });
  },
};
