// MIT. openapi Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { openApiApplication, prepareOpenApiApplication, openApiStartup } from "../application-openapi.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "openapi", order: 410,
  catalog({ common, field }) { return [openApiApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    let openapi;
    const prepared = await prepareOpenApiApplication(settings, {
      ...context, inputPath, applicationEnvironment, runtimeDirectory,
    });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    createDirectories.push(...prepared.createDirectories); openapi = prepared.openapi;
    return { args, inputs, createDirectories,
      ...(openapi ? { openapi } : {}) };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "openapi-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (request.args.includes('--managed-launch-sha256')) {
        if (!text.startsWith('{"schema":"stellar-forge.openapi-workspace-startup.v1",')) return null;
        return () => openApiStartup(request, directory, text, context);
      }
      return text.startsWith('API merchant workspace: ') ? text.slice('API merchant workspace: '.length) : null;
    });
  },
};
