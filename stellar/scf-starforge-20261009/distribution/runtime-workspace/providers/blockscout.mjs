// MIT. blockscout Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { blockscoutApplication, prepareBlockscoutApplication, blockscoutStartup } from "../application-blockscout.mjs";

import { blockscoutConnectionApplication, prepareBlockscoutConnectionApplication,
  blockscoutConnectionStartup } from '../application-blockscout-connection.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "blockscout", order: 140,
  catalog({ common, field }) { return [blockscoutApplication(common), blockscoutConnectionApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = type.id === 'blockscout-connections'
      ? await prepareBlockscoutConnectionApplication(settings, inputPath)
      : await prepareBlockscoutApplication(settings, inputPath);
    args.push(...original.args); inputs.push(...original.inputs);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && ["blockscout", "blockscout-connections"].includes(request.command); },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (request.command === "blockscout-connections") {
        if (!text.startsWith('{"schema":"stellar-forge.blockscout-connection-workspace-startup.v1",')) return null;
        return () => blockscoutConnectionStartup(request, text);
      }
      if (!text.startsWith("{\"schema\":\"stellar-forge.blockscout-startup.v1\",")) return null;
      return () => blockscoutStartup(request, text);
    });
  },
};
