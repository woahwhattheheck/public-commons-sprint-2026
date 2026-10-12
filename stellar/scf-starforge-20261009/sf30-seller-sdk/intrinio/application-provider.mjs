// MIT. Source-owned Intrinio catalog, preparation and original startup observer.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { intrinioApplication, prepareIntrinioApplication, intrinioApplicationStartup } from './managed-application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'intrinio', order: 1050,
  catalog({ common }) { return [intrinioApplication(common)]; },
  async prepare(type, settings, context) {
    return prepareIntrinioApplication(settings, {
      inputPath: context.inputPath, runtimeDirectory: context.runtimeDirectory,
    });
  },
  resourceKey(type, settings, { hash }) {
    return hash({ family: 'python-workspace', directory: settings.workspaceDirectory });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'intrinio' &&
      Array.isArray(request.args) && request.args[0] === 'serve' && request.args.includes('--managed-selection');
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.intrinio-operator-startup.v1",')) return null;
      return () => intrinioApplicationStartup(request, text, context);
    });
  },
};
