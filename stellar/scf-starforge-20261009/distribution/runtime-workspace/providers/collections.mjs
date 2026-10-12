// MIT. collections Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { collectionsApplication, prepareCollectionsApplication, collectionsStartup } from "../application-collections.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "collections", order: 320,
  catalog({ common, field }) { return [collectionsApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const prepared = await prepareCollectionsApplication(settings, { inputPath, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    createDirectories.push(...prepared.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "buyer-collections-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      return collectionsStartup(request, text);
    });
  },
};
