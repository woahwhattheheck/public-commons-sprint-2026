// MIT. Census Applications registration over the original managed native workspace.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import {
  censusGeocoderApplication, prepareCensusGeocoderApplication, censusGeocoderStartup,
} from '../application-census-geocoder.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'census-geocoder',
  order: 261,
  catalog({ common }) { return [censusGeocoderApplication(common)]; },
  async prepare(type, settings, context) {
    const original = await prepareCensusGeocoderApplication(
      settings, context.inputPath, context.runtimeDirectory);
    return { ...original, createDirectories: original.createDirectories ?? [] };
  },
  resourceKey(type, settings, { hash }) {
    return hash({ family: 'merchant-mcp', directory: settings.configurationFile });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'census-geocoder-agent';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.census-geocoder-agent-workspace-startup.v1",')) return null;
      return () => censusGeocoderStartup(request, text);
    });
  },
};
