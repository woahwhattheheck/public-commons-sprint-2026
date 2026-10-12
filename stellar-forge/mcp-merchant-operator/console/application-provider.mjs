// MIT. Product-owned Applications registration for the original merchant console.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import { merchantConsoleApplication, prepareMerchantConsoleApplication,
  merchantConsoleStartup, MERCHANT_CONSOLE_APPLICATION_STARTUP } from './application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'merchant-console', order: 1060,
  catalog({ common }) { return [merchantConsoleApplication(common)]; },
  prepare(type, settings, context) { return prepareMerchantConsoleApplication(settings, context); },
  resourceKey(type, settings, { hash }) {
    return hash({ family: 'merchant-mcp', directory: settings.configurationFile });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'merchant-mcp' &&
      request.args?.[0] === 'serve' && request.args.includes('--managed-console-selection');
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + MERCHANT_CONSOLE_APPLICATION_STARTUP + '",')) return null;
      return () => merchantConsoleStartup(request, text, context);
    }, { lineLimit: 32768 });
  },
};
