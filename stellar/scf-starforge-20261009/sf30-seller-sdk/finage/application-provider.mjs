// MIT. Finage Applications registration over its original native workspace.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { finageApplication, prepareFinageApplication, finageStartup } from './application-lifecycle.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'finage',
  order: 1040,
  catalog({ common }) { return [finageApplication(common)]; },
  async prepare(type, settings, context) {
    return prepareFinageApplication(settings, {
      inputPath: context.inputPath,
      runtimeDirectory: context.runtimeDirectory,
    });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'finage-workspace' &&
      Array.isArray(request.args) && request.args[0] === 'managed';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.finage-workspace-startup.v1",')) return null;
      return () => finageStartup(request, text);
    });
  },
};
