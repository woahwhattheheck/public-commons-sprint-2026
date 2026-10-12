// MIT. tenderly Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { tenderlyApplication, prepareTenderlyApplication, tenderlyStartup } from "../application-tenderly.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "tenderly", order: 370,
  catalog({ common, field }) { return [tenderlyApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareTenderlyApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "tenderly-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.tenderly-workspace-startup.v1\",")) return null;
      return () => tenderlyStartup(request, text);
    });
  },
};
