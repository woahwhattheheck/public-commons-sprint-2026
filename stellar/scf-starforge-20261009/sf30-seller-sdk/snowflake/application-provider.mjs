// MIT. Source-owned Snowflake provider over the original Applications lifecycle.
import {
  APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup,
} from '../../distribution/runtime-workspace/application-provider.mjs';
import {
  snowflakeApplication, prepareSnowflakeApplication, snowflakeStartup,
  verifySnowflakeApplicationLaunch,
} from './application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'snowflake', order: 1040,
  catalog({ common }) { return [snowflakeApplication(common)]; },
  prepare(type, settings, context) { return prepareSnowflakeApplication(settings, context); },
  matchRequest(request) { return !request.pythonCommand && request.command === 'snowflake-workspace'; },
  verifyLaunch(request) { return verifySnowflakeApplicationLaunch(request); },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.snowflake-workspace-startup.v1",')) return null;
      return () => snowflakeStartup(request, text);
    });
  },
};
