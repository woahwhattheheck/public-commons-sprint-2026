// MIT. api-pass Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { apiPassWorkspaceApplication, prepareApiPassWorkspaceApplication, apiPassWorkspaceStartup, verifyApiPassWorkspaceLaunch } from "../../../sf101-merchant-receiver/api-access/workspace/application.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "api-pass", order: 130,
  catalog({ common, field }) { return [apiPassWorkspaceApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    let apiPassWorkspace;
    const original = await prepareApiPassWorkspaceApplication(settings, { runtimeDirectory, inputPath, selectedExecutable });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
    apiPassWorkspace = original.identity;
    return { args, inputs, createDirectories,
      ...(apiPassWorkspace ? { apiPassWorkspace } : {}) };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "api-pass-workspace"; },
  verifyLaunch: verifyApiPassWorkspaceLaunch,
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.sf101.api-pass-workspace-launch.v1\",")) return null;
      return () => apiPassWorkspaceStartup(request, directory, text, context);
    });
  },
};
