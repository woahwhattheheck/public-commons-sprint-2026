// MIT. Original ckan-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { ckanWorkspaceTools } from "../catalog/ckan-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "ckan-workspaces", family: "ckanWorkspaces",
  title: "ckan workspaces merchant", order: 290, catalogOrder: 240,
  configKey: "ckanWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "ckanWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../ckan-workspace.mjs")).readCkanWorkspaceConfiguration(hostPath(value)) },
  tools: ckanWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_ckan_",
      "text": "For CKAN authoring, list host-declared workspaces and open the original saved project. Read its current operation before every mutation and pass that exact expectedOperationId. Capture, source review, publication, export and staging return the original operation ID immediately; inspect its saved completion before continuing. After a lost reply read the same native state. Stage into the project store bound to this operator, then use the original merchant inspect, compare, activate and start tools. Customer downloads retain the original file hash and byte offset. For DCAT migration use the same workspace: inspect a dcat-catalog input SHA256, import it, prepare a saved review and page its validation/conservation/field changes. Preserve declared 3.0 originals unless normalization is explicitly selected. Edited candidates are separate imported catalogs, with exact typed source-to-target mappings; large mapping arrays use a dcat-mappings input and its digest. READY and NEEDS_CORRECTION both retain complete reviews. Receive complete report/catalog/candidate files with the original SHA256-pinned reader; bind review/candidate hashes and the active release for cutover or rollback. Export and receive the original whole workspace to carry all catalog editions and decisions. SCF_DCAT_PYTHON selects the original pinned GSA environment. Semantic validation uses merchant_ckan_dcat_semantic_* in that same owner. Inspect host-declared dcat-semantic context/shapes/ontology/attachment inputs and import an immutable profile with explicit baseIRI/contextMode and original audit/source files. Bind profileSha256 plus the exact retained catalog or migration candidate SHA256 when starting a native run. Follow its original operation/runId; inspect nullable conformance, graph/class presence, target-coverage qualifications, complete findings and original artifact files separately from JSON-schema acceptance. Page findings and use semantic_file_read for full original graph/provenance/SHACL reports. Append a review using exact runSha256 and the latest reviewSha256 or explicit null; semantic review never selects the active catalog. Whole workspace export/receive carries all original profiles/runs/decisions. Close the owned model to release its original lease.",
      "order": 340
    }
  ],
  load: () => import("../ckan-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantCkanWorkspaces(config, options),
  initialize: async options => (await import('../config.mjs')).initializeCkanWorkspaceMerchant(options)
});
