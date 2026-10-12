// MIT. atlas Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { atlasApplication, prepareAtlasApplication, atlasStartup } from "../application-atlas.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "atlas", order: 90,
  catalog({ common, field }) { return [atlasApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareAtlasApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "atlas"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.sf61.atlas-launch.v1\",")) return null;
      return () => atlasStartup(request, text);
    });
  },
};
