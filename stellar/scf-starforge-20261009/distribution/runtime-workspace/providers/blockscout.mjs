// MIT. blockscout Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { blockscoutApplication, prepareBlockscoutApplication, blockscoutStartup } from "../application-blockscout.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "blockscout", order: 140,
  catalog({ common, field }) { return [blockscoutApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareBlockscoutApplication(settings, inputPath);
    args.push(...original.args); inputs.push(...original.inputs);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "blockscout"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.blockscout-startup.v1\",")) return null;
      return () => blockscoutStartup(request, text);
    });
  },
};
