// MIT. Both accounting desks share the original workspace, command and writer lease.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { cryptoworthApplication, prepareCryptoworthApplication, cryptoworthStartup } from '../application-cryptoworth.mjs';
import { runbooksApplication } from '../application-runbooks.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'cryptoworth', order: 255,
  catalog({ common }) { return [cryptoworthApplication(common), runbooksApplication(common)]; },
  async prepare(type, settings, context) {
    return prepareCryptoworthApplication(settings, context.inputPath, context.runtimeDirectory, { desk: type.id });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'merchant-accounting-workspace';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.accounting-workspace-startup.v1",')) return null;
      const desk = request.args[request.args.indexOf('--desk') + 1];
      return () => cryptoworthStartup(request, text, { desk });
    });
  },
};
