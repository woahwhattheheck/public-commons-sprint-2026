// MIT. Source-owned Applications lifecycle for the complete publisher workspace.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { now } from '../storage.mjs';
import { PUBLISHER_STARTUP, publisherApplication, preparePublisherApplication,
  publisherStartup, savePublisherApplicationConnection } from '../application-360giving.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'ndjson-360giving', order: 165,
  catalog({ common }) { return [publisherApplication(common)]; },
  async prepare(type, settings, context) {
    return preparePublisherApplication(settings, context);
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'dataset-360giving-workspace';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + PUBLISHER_STARTUP + '",')) return null;
      return async () => {
        const startup = await publisherStartup(request, text);
        if (!startup) return null;
        const workspaceId = startup.original.workspaceId;
        const connectionFile = await savePublisherApplicationConnection(request, directory, {
          schema: 'stellar-forge.application-url.v1', applicationId: request.applicationId,
          operationId: directory.split('/').at(-1), command: request.command,
          source: 'original-command-stdout', observedAt: now(), url: startup.url,
          workspaceId, original: startup.original,
        });
        return { ...startup, workspaceId, connectionFile };
      };
    });
  },
};
