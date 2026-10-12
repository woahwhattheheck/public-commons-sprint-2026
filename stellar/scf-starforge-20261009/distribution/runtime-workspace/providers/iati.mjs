// MIT. iati Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { iatiApplication, prepareIatiApplication, iatiStartup } from "../application-iati.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "iati", order: 165,
  catalog({ common, field }) { return [iatiApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const prepared = await prepareIatiApplication(settings, {
      inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
    });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "dataset-iati"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.iati-workspace-launch.v1\",")) return null;
      return () => iatiStartup(request, text);
    });
  },
};
