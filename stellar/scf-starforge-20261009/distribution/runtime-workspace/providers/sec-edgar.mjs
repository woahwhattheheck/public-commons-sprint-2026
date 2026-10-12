// MIT. sec-edgar Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { secEdgarApplication, prepareSecEdgarApplication, secEdgarStartup } from "../application-sec-edgar.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "sec-edgar", order: 190,
  catalog({ common, field }) { return [secEdgarApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareSecEdgarApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "sec-edgar" && request.args?.[0] === 'workspace'; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.sec-edgar-workspace-startup.v1\",")) return null;
      return () => secEdgarStartup(request, directory, text, context);
    });
  },
};
