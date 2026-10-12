// MIT. nocodb Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { nocodbApplication, prepareNocoDBApplication, nocodbStartup } from "../application-nocodb.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "nocodb", order: 220,
  catalog({ common, field }) { return [nocodbApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareNocoDBApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "nocodb-source"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.nocodb-authoring-startup.v1\",")) return null;
      return () => nocodbStartup(request, text);
    });
  },
};
