// MIT. Source-owned Utility entry in the original Applications lifecycle.
import {
  APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup,
} from '../../distribution/runtime-workspace/application-provider.mjs';
import {
  utilityEnergyApplication, prepareUtilityApplication, utilityEnergyStartup,
} from './managed-application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'utility-energy', order: 185,
  catalog({ common }) { return [utilityEnergyApplication(common)]; },
  prepare(type, settings, context) { return prepareUtilityApplication(settings, context); },
  resourceKey(type, settings, { hash }) {
    // Utility uses the original NDJSON Workspace and its exact database.
    return hash({ family: 'ndjson', directory: settings.workspaceDirectory });
  },
  matchRequest(request) { return !request.pythonCommand && request.command === 'utility-energy'; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{')) return null;
      let value;
      try { value = JSON.parse(text); } catch { return null; }
      if (value?.schema !== 'stellar-forge.utility-workspace-launch.v1') return null;
      return () => utilityEnergyStartup(request, text);
    });
  },
};
