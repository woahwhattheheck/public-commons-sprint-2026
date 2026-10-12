// MIT. Buyer receiving Applications registration over the original native workspace.
import {
  APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup,
} from '../application-provider.mjs';
import {
  buyerRunbookApplication, prepareBuyerRunbookApplication,
  buyerRunbookStartup, BUYER_RUNBOOK_LAUNCH_SCHEMA,
} from '../application-buyer-runbook.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'buyer-runbook', order: 345,
  catalog({ common }) { return [buyerRunbookApplication(common)]; },
  async prepare(type, settings, context) {
    const prepared = await prepareBuyerRunbookApplication(settings, {
      inputPath: context.inputPath, runtimeDirectory: context.runtimeDirectory,
    });
    return {
      args: prepared.args, inputs: prepared.inputs,
      createDirectories: prepared.createDirectories,
      buyerRunbook: prepared.identity,
    };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'buyer-runbook' &&
      Array.isArray(request.args) && request.args[0] === 'workspace';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + BUYER_RUNBOOK_LAUNCH_SCHEMA + '",')) return null;
      return () => buyerRunbookStartup(request, text);
    });
  },
};
