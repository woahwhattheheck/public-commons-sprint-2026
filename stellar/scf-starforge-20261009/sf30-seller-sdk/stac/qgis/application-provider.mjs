// SPDX-License-Identifier: MIT
import {APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup} from '../../../distribution/runtime-workspace/application-provider.mjs';
import {qgisAnalystApplication, prepareQgisAnalystApplication, verifyQgisAnalystLaunch, qgisAnalystStartup} from './application.mjs';
export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'stac-qgis-analyst', order: 1070,
  catalog({common}) { return [qgisAnalystApplication(common)]; },
  prepare(type, settings, context) { return prepareQgisAnalystApplication(settings, context); },
  matchRequest(request) { return !request.pythonCommand && request.command === 'stac-qgis-analyst'; },
  verifyLaunch(request) { return verifyQgisAnalystLaunch(request); },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"starforge.stac-qgis-analyst-startup.v1",')) return null;
      return () => qgisAnalystStartup(request, text);
    }, {lineLimit: 32768});
  },
};
