// MIT. grant-workspace Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { grantApplication, prepareGrantApplication, grantStartup } from "../application-grant.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "grant-workspace", order: 340,
  catalog({ common, field }) { return [grantApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const prepared = await prepareGrantApplication(settings, { inputPath, selectedExecutable, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    createDirectories.push(...prepared.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "grant-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.sf47.workspace-launch.v1\",")) return null;
      return () => grantStartup(request, text);
    });
  },
};
