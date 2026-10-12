// MIT. coingecko Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { coingeckoApplication, prepareCoingeckoApplication, coingeckoStartup } from "../application-coingecko.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "coingecko", order: 10,
  catalog({ common, field }) { return [coingeckoApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareCoingeckoApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "coingecko"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.coingecko-managed-launch.v1\",")) return null;
      return () => coingeckoStartup(request, text, directory);
    });
  },
};
