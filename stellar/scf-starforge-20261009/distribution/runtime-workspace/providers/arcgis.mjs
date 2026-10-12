// MIT. arcgis Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { arcgisAgentApplication, prepareArcgisAgentApplication, arcgisAgentStartup } from "../application-arcgis.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "arcgis", order: 260,
  catalog({ common, field }) { return [arcgisAgentApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareArcgisAgentApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
    return { args, inputs, createDirectories };
  },
  resourceKey(type, settings, { hash }) { return hash({ family: 'merchant-mcp', directory: settings.configurationFile }); },
  matchRequest(request) { return !request.pythonCommand && request.command === "arcgis-agent"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.arcgis-agent-workspace-startup.v1\",")) return null;
      return () => arcgisAgentStartup(request, text);
    });
  },
};
