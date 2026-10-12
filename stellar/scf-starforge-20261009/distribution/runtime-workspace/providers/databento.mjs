// MIT. databento Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { databentoApplication, prepareDatabentoApplication, databentoStartup } from "../application-databento.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "databento", order: 40,
  catalog({ common, field }) { return [databentoApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    let selectedResourceKey;
    const original = await prepareDatabentoApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories); selectedResourceKey = original.resourceKey;
    return { args, inputs, createDirectories,
      ...(selectedResourceKey ? { resourceKey: selectedResourceKey } : {}) };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "databento-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.databento-workspace-startup.v1\",")) return null;
      return () => databentoStartup(request, text);
    });
  },
};
