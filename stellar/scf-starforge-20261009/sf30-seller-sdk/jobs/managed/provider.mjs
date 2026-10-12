// MIT. Source-owned Applications registration for the original complete merchant.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from
  '../../../distribution/runtime-workspace/application-provider.mjs';
import {
  JOB_MERCHANT_APPLICATION_ID, jobMerchantApplication, validateJobMerchantSettings,
  prepareJobMerchantApplication, verifyJobMerchantLaunch, prepareJobMerchantChild, jobMerchantStartup,
} from './application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: JOB_MERCHANT_APPLICATION_ID, order: 111,
  appendPort: false,
  catalog(context) { return [jobMerchantApplication(context)]; },
  validateSettings(type, settings) { validateJobMerchantSettings(settings); },
  prepare(type, settings, context) { return prepareJobMerchantApplication(settings, context); },
  verifyLaunch(request) { return verifyJobMerchantLaunch(request); },
  prepareChild(request, directory, originalArgs, environment) {
    return prepareJobMerchantChild(request, directory, originalArgs, environment);
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'jobs' && request.args?.[0] === 'serve';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.job-service-launch.v1",')) return null;
      return () => jobMerchantStartup(request, text, directory);
    });
  },
};
