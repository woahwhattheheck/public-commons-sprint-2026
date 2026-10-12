// MIT. Source-owned QuestDB workbench provider for the original Applications lifecycle.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { questdbApplication, prepareQuestDbApplication, validateQuestDbApplicationSettings,
  verifyQuestDbApplicationLaunch, questdbApplicationStartup } from './managed-application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'questdb',
  order: 1000,
  catalog({ common }) { return [questdbApplication(common)]; },
  prepare(_type, settings, context) { return prepareQuestDbApplication(settings, context); },
  validateSettings: validateQuestDbApplicationSettings,
  matchRequest(request) { return !request.pythonCommand && request.command === 'questdb-workspace'; },
  verifyLaunch: verifyQuestDbApplicationLaunch,
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"questdbWorkspace":')) return null;
      return () => questdbApplicationStartup(request, text, directory, context);
    });
  },
};
