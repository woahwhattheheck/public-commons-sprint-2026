// MIT. n8n Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { n8nApplication, prepareN8nApplication, n8nStartup } from "../application-n8n.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "n8n", order: 100,
  catalog({ common, field }) { return [n8nApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareN8nApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "n8n-merchant"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.n8n-merchant-launch.v1\",")) return null;
      return () => n8nStartup(request, text, context);
    });
  },
};
