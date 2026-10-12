// MIT. grantsgov Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { grantsgovApplication, prepareGrantsgovApplication, grantsgovStartup } from "../application-grantsgov.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "grantsgov", order: 350,
  catalog({ common, field }) { return [grantsgovApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const prepared = await prepareGrantsgovApplication(settings, { inputPath, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    createDirectories.push(...prepared.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "grantsgov"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.grantsgov-workspace-startup.v1\",")) return null;
      return () => grantsgovStartup(request, text);
    });
  },
};
