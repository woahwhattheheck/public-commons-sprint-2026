// MIT. odata Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { odataApplication, prepareODataApplication, odataStartup } from "../../../sf30-seller-sdk/odata/live/applications.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "odata", order: 180,
  catalog({ common, field }) { return [odataApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareODataApplication(settings, { ...context, inputPath, selectedExecutable, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "dataset" && request.args?.[0] === 'odata'; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.odata-workspace-startup.v1\",")) return null;
      return () => odataStartup(request, directory, text, context);
    });
  },
};
