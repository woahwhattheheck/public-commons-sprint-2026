// MIT. baserow Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { baserowApplication, prepareBaserowApplication, baserowStartup } from "../application-baserow.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "baserow", order: 330,
  catalog({ common, field }) { return [baserowApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const prepared = await prepareBaserowApplication(settings, { inputPath, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    createDirectories.push(...prepared.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "baserow-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.baserow-authoring-startup.v1\",")) return null;
      return () => baserowStartup(request, text);
    });
  },
};
