// MIT. Original support merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { supportTools } from "../catalog/support.mjs";
import {MAX_COMMISSIONING_BYTES} from "../../../stellar/scf-starforge-20261009/sf74-merchant-support-console/commissioning.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "support", family: "support",
  title: "support merchant", order: 130, catalogOrder: 70,
  configKey: "support", summary: true, dependencies: [],
  maxRequestBytes: 2 * MAX_COMMISSIONING_BYTES + 1024 * 1024,
  configuration: { input: "supportConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../config.mjs")).readSupportConfiguration(hostPath(value)) },
  tools: supportTools,
  instructions: [
    {prefix:'merchant_case_package_',order:297,text:'Use the original saved case and complete package owner. Export preserves the captured case history and every retained native source bundle, including unassigned attachments. Keep one operation ID, actor and exact body; inspect status then resume that same request after interruption. Remote sources are host-configured original Handoffs aliases. Completed receiving opens the same local case and preserves later receiver edits. File readers retain the original manifest and native byte identities.'},
    {prefix:'merchant_case_commercial',order:296,text:'Use the original saved case and retained SF97 plan source. Preserve exact request UUID, actor, revision and full input after an interrupted quote write. Preview before saving an edition; record actual customer responses against its complete SHA. Quotation acceptance preserves implementation and service receiving. Read bounded customer files at their original saved revision, or export the complete original case for another operator.'},
    {prefix:"merchant_service_",order:285,text:"Use the original saved case for versioned service terms and reports. Inspect the current case and original merchant_support_service_snapshot before capture. Keep the exact requestId, expectedRevision and body across a lost change response; replay returns its original result after later case edits. Reports select exact terms history, retained captures and reviewed exclusions. Download the complete case export for staff receiving."},
    {prefix:"merchant_case_implementation",order:295,
      text:"Reopen the original case and implementation revision. Prepare from its saved SF77 workorder sources; use one retained request ID and exact payload for recovery. Receiving binds the task definition and original delivery files. Page original history and export the complete case for another operator."},
    {
      "prefix": "merchant_support_",
      "text": "For support observation, inspect host profiles and the current configuration revision, start explicitly and retain the owned watcher instance. Recover notifications using their original event IDs and attempt counts.",
      "order": 280
    },
    {
      "prefix": "merchant_case",
      "text": "With a configured support connection, inspect source aliases or incidents, import exact original captures, and reopen the original case before changing owner terms. Case writes use its current revision; workorder and export use that exact saved revision. Inspect support export status after an interrupted reply.",
      "order": 290
    }
  ],
  load: () => import("../support.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantSupport(config, { environment: options?.environment })
});
