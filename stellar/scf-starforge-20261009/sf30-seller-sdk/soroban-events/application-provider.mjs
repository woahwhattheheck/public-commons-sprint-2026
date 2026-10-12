// MIT. Source-owned Soroban event application registration.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup }
  from '../../distribution/runtime-workspace/application-provider.mjs';
import {
  sorobanEventsApplication, prepareSorobanEventsApplication,
  sorobanEventsStartup, SOROBAN_EVENTS_READY_SCHEMA,
} from './application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'soroban-contract-events',
  order: 1080,
  catalog({ common }) { return [sorobanEventsApplication(common)]; },
  async prepare(type, settings, context) {
    const original = await prepareSorobanEventsApplication(settings, context);
    return { ...original, createDirectories: original.createDirectories ?? [] };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'soroban-events-workspace';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + SOROBAN_EVENTS_READY_SCHEMA + '",')) return null;
      return () => sorobanEventsStartup(request, text);
    });
  },
};
