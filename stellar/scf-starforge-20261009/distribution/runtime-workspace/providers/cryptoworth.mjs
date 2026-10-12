// MIT. Cryptoworth registration preserves the original accounting workspace and lease.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { cryptoworthApplication, prepareCryptoworthApplication, cryptoworthStartup } from '../application-cryptoworth.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'cryptoworth', order: 255,
  catalog({ common }) { return [cryptoworthApplication(common)]; },
  async prepare(type, settings, context) {
    return prepareCryptoworthApplication(settings, context.inputPath, context.runtimeDirectory);
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'merchant-accounting-workspace' &&
      !(Array.isArray(request.args) && request.args.includes('--managed-launch-sha256'));
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.accounting-workspace-startup.v1",')) return null;
      return () => cryptoworthStartup(request, text);
    });
  },
};
