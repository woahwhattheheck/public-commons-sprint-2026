// MIT. Original clinical-trials-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { clinicalTrialsWorkspaceTools } from "../catalog/clinicaltrials-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "clinical-trials-workspaces", family: "clinicalTrialsWorkspaces",
  title: "clinical trials workspaces merchant", order: 330, catalogOrder: 300,
  configKey: "clinicalTrialsWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "clinicalTrialsWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../clinicaltrials-workspace.mjs")).readClinicalTrialsWorkspaceConfiguration(hostPath(value)) },
  tools: clinicalTrialsWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_clinicaltrials_",
      "text": "For ClinicalTrials, attach the declared existing console and use its original capture, NCT, source SHA and integer revision. Read the original complete study and official PRS reports before retaining a review or modernization decision. Save the exact action UUID and payload before mutation; inspect that same operation after an interrupted reply. Portable receiving preserves original studies, reviews and source editions in a new receiver; inspect its actual operation/export inventory before continuation. Prepare declared native files and receive their complete SHA-pinned bytes through retained downloads. Closing this attachment drains its own reads and leaves the original Python console owner open.",
      "order": 30
    }
  ],
  load: () => import("../clinicaltrials-workspace.mjs"),
  create: (module, config) => new module.MerchantClinicalTrialsWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeClinicalTrialsWorkspaceMerchant(options)
});
