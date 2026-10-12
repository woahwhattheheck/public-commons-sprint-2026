// MIT. usgs-facility-events Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { facilityApplication, prepareFacilityApplication, facilityStartup } from '../application-usgs-facilities.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'usgs-facility-events', order: 1000,
  catalog({ common }) { return [facilityApplication(common)]; },
  async prepare(type, settings, context) {
    return prepareFacilityApplication(settings, context.inputPath, context.runtimeDirectory);
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'usgs-facility-events';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.facility-operations-startup.v1",')) return null;
      return () => facilityStartup(request, text);
    });
  },
};
