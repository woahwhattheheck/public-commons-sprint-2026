// MIT. Three original imagery hosts in the source-owned Applications registry.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { now } from '../storage.mjs';
import { stacApplications, prepareStacApplication, stacStartup,
  saveStacApplicationConnection } from '../application-stac.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'stac', order: 1000,
  catalog({ common }) { return stacApplications(common); },
  async prepare(type, settings, context) {
    const original = await prepareStacApplication(type.id, settings, context);
    Object.assign(settings, original.settings);
    return { args: original.args, inputs: original.inputs,
      createDirectories: original.createDirectories, resourceKey: original.resourceKey };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'stac' &&
      ['serve', 'eoapi-serve', 'prescient-serve'].includes(request.args?.[0]);
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.stac-managed-startup.v1",')) return null;
      return async () => {
        const startup = await stacStartup(request, text);
        if (!startup) return null;
        const workspaceId = startup.original.workspaceId;
        const connectionFile = await saveStacApplicationConnection(request, directory, {
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
