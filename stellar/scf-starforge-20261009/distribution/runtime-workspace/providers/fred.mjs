// MIT. fred Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { fredApplication, prepareFredApplication, fredStartup } from "../application-fred.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "fred", order: 360,
  catalog({ common, field }) { return [fredApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareFredApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "fred"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{') || !text.includes('"schema":"stellar-forge.fred-workspace-startup.v1"')) return null;
      return () => fredStartup(request, text);
    });
  },
};
