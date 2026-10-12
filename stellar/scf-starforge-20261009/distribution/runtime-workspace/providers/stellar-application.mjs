// MIT. stellar-application Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { cheesecakeApplication, prepareCheesecakeApplication, cheesecakeStartup } from "../application-cheesecake.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "stellar-application", order: 170,
  catalog({ common, field }) { return [cheesecakeApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    let stellarApplication, selectedResourceKey;
    const original = await prepareCheesecakeApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs); selectedResourceKey = original.resourceKey;
    stellarApplication = original.identity;
    return { args, inputs, createDirectories,
      ...(stellarApplication ? { stellarApplication } : {}),
      ...(selectedResourceKey ? { resourceKey: selectedResourceKey } : {}) };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "stellar-application"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.application-installed-startup.v1\",")) return null;
      return () => cheesecakeStartup(request, text);
    });
  },
};
