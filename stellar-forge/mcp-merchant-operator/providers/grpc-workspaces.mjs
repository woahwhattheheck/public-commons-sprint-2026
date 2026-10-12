// MIT. Original grpc-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { grpcWorkspaceTools } from "../catalog/grpc-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "grpc-workspaces", family: "grpcWorkspaces",
  title: "grpc workspaces merchant", order: 380, catalogOrder: 370,
  configKey: "grpcWorkspaces", summary: true, dependencies: [],
  concurrentTools: Object.freeze(['merchant_grpc_cancel_call', 'merchant_grpc_stop', 'merchant_grpc_release_stop', 'merchant_grpc_release_close']), shutdown: 'provider',
  maxRequestBytes: 2097152,
  configuration: { input: "grpcWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../grpc-workspace.mjs")).readGrpcWorkspaceConfiguration(hostPath(value)) },
  tools: grpcWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_grpc_",
      "text": "For gRPC merchants, inspect host-declared workspaces and capture or receive an original protobuf closure. Read its exact revision, method schemas and complete plan before saving with baseRevision. Review the selected native channel, retain a stable operationId for each intentional unary call or preparation, and recover that same native attempt after an interrupted reply. Page every retained attempt with its original snapshot. Stop the direct merchant before staging into its own SF82 store; use merchant_grpc_release controls with the observed generation and instance. Customer exports contain all seven original files; inspect the manifest and use download-grpc to resume and restore the native client directory. Revision exports retain complete source for another original workspace.",
      "order": 120
    }
  ],
  load: () => import("../grpc-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantGrpcWorkspaces(config, options.grpc),
  initialize: async options => (await import('../config.mjs')).initializeGrpcWorkspaceMerchant(options)
});
