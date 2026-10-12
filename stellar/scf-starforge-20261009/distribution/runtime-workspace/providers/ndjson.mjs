// MIT. ndjson Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { ndjsonApplication, prepareNdjsonApplication, ndjsonStartup } from "../application-ndjson.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "ndjson", order: 160,
  catalog({ common, field }) { return [ndjsonApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const prepared = await prepareNdjsonApplication(settings, {
      inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
    });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "dataset-ndjson"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.ndjson-workspace-launch.v1\",")) return null;
      return () => ndjsonStartup(request, text);
    });
  },
};
