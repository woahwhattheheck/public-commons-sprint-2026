// MIT. Source-owned ClinicalTrials entry in the original Applications lifecycle.
import {
  APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup,
} from '../../distribution/runtime-workspace/application-provider.mjs';
import {
  clinicalTrialsApplication, prepareClinicalTrialsApplication, clinicalTrialsStartup,
} from './managed-application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'clinicaltrials', order: 175,
  catalog({ common }) { return [clinicalTrialsApplication(common)]; },
  prepare(type, settings, context) { return prepareClinicalTrialsApplication(settings, context); },
  resourceKey(type, settings, { hash }) {
    // ClinicalTrials uses the original NDJSON Workspace and its exact database.
    return hash({ family: 'ndjson', directory: settings.workspaceDirectory });
  },
  matchRequest(request) { return !request.pythonCommand && request.command === 'clinicaltrials'; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{')) return null;
      let value;
      try { value = JSON.parse(text); } catch { return null; }
      if (value?.schema !== 'stellar-forge.clinicaltrials-workspace-launch.v1') return null;
      return () => clinicalTrialsStartup(request, text);
    });
  },
};
