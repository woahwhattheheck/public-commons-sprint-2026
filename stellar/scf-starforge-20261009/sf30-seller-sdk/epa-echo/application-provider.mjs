// MIT. Source-owned EPA ECHO launcher within the original managed Applications lifecycle.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { echoApplication, prepareEchoApplication, echoStartup, ECHO_READY_SCHEMA } from './application-launch.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'epa-echo-portfolios',
  order: 1000,
  catalog({ common }) {
    return [echoApplication(common)];
  },
  async prepare(type, settings, context) {
    const original = await prepareEchoApplication(settings, context);
    return { ...original, createDirectories: original.createDirectories ?? [] };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'epa-echo-workspace';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + ECHO_READY_SCHEMA + '",')) return null;
      return () => echoStartup(request, text);
    });
  },
};
