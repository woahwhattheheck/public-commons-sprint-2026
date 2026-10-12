// MIT. sheets Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { sheetsApplication, prepareSheetsApplication, sheetsStartup } from "../application-sheets.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "sheets", order: 210,
  catalog({ common, field }) { return [sheetsApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareSheetsApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "sheets-source"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.sheets-authoring-startup.v1\",")) return null;
      return () => sheetsStartup(request, text);
    });
  },
};
