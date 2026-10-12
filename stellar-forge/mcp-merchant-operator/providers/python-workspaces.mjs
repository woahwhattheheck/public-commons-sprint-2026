// MIT. Original python-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { pythonWorkspaceTools } from "../catalog/python-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "python-workspaces", family: "pythonWorkspaces",
  title: "python workspaces merchant", order: 150, catalogOrder: 90,
  configKey: "pythonWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "pythonWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../python-workspace.mjs")).readPythonWorkspaceConfiguration(hostPath(value)) },
  tools: pythonWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_python_",
      "text": "For Python authoring, list declared aliases and explicitly open the original saved model. Read revision/declaration/source before editing with the expected head. Retain preview operationId and inspect the same original job after an interrupted reply. Stage a saved revision, review its native digest and current generation, and explicitly activate/start/restart. Only this model handle can cancel its previews or stop its managed seller. Customer exports reuse original saved files; portable exports retain source, native release history and clients. Resume chunk downloads with the same file SHA256 and offset.",
      "order": 350
    }
  ],
  load: () => import("../python-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantPythonWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializePythonWorkspaceMerchant(options)
});
