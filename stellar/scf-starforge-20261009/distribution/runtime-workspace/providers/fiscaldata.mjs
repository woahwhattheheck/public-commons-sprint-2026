// MIT. fiscaldata Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { fiscalDataApplication, prepareFiscalDataApplication, fiscalDataStartup } from "../application-fiscaldata.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "fiscaldata", order: 30,
  catalog({ common, field }) { return [fiscalDataApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    let selectedResourceKey;
    const original = await prepareFiscalDataApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories); selectedResourceKey = original.resourceKey;
    return { args, inputs, createDirectories,
      ...(selectedResourceKey ? { resourceKey: selectedResourceKey } : {}) };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "fiscaldata"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.fiscaldata-application-startup.v1\",")) return null;
      return () => fiscalDataStartup(request, text);
    }, { lineLimit: 32768 });
  },
};
