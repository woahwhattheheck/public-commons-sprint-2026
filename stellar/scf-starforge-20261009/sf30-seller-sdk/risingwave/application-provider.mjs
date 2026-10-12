// MIT. Source-owned RisingWave workbench provider for the original Applications lifecycle.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { risingwaveApplication, prepareRisingWaveApplication, validateRisingWaveApplicationSettings,
  verifyRisingWaveApplicationLaunch, risingwaveApplicationStartup } from './managed-application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'risingwave',
  order: 1000,
  catalog({ common }) { return [risingwaveApplication(common)]; },
  prepare(_type, settings, context) { return prepareRisingWaveApplication(settings, context); },
  validateSettings: validateRisingWaveApplicationSettings,
  matchRequest(request) { return !request.pythonCommand && request.command === 'risingwave-workspace'; },
  verifyLaunch: verifyRisingWaveApplicationLaunch,
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"risingwaveWorkspace":')) return null;
      return () => risingwaveApplicationStartup(request, text, directory, context);
    });
  },
};
