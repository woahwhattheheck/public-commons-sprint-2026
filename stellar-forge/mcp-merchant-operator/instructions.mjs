// MIT. Original operator guidance scoped to this process's advertised tools.
const sections = [
  {
    "prefix": "merchant_grpc_",
    "text": "For gRPC merchants, inspect host-declared workspaces and capture or receive an original protobuf closure. Read its exact revision, method schemas and complete plan before saving with baseRevision. Review the selected native channel, retain a stable operationId for each intentional unary call or preparation, and recover that same native attempt after an interrupted reply. Page every retained attempt with its original snapshot. Stop the direct merchant before staging into its own SF82 store; use merchant_grpc_release controls with the observed generation and instance. Customer exports contain all seven original files; inspect the manifest and use download-grpc to resume and restore the native client directory. Revision exports retain complete source for another original workspace."
  },
  {
    "prefix": "merchant_mpp_",
    "text": "For native MPP, inspect merchant_mpp_consoles and status, retain a customer review from the original contract using a declared customer alias, then configure its exact review SHA256 and revision. Preview the exact offer/query/body before prepare and retain the original purchaseId and job ID. The existing console host runs original terminal approval, SF36 reservation, native MPP signing and SF86 accounting. Read original job/purchase state after interruption; retry preparation or resume the same saved purchase. Original response retrieval and handoff export use SHA-pinned chunks; merchant_mpp_export plus the maintained download-mpp receiver retains complete original files across MCP restart."
  },
  {
    "prefix": "merchant_arcgis_",
    "text": "For ArcGIS source merchants, inspect merchant_arcgis_status and open the host-declared workspace. It borrows the existing MerchantPublisher and its one refresh scheduler; the browser uses the same original workbench. Inspect declared file bytes and SHA256 before uploading an alias. Prepare a source from selected host connection/profile and exact original inputs; retain workbenchId and request UUID for every change, then inspect the same saved request after a lost response. Complete capture before mapping an immutable source edition, and select it against the current source revision. Use merchant_publisher_* for the original plan, extraction, candidate review, publication, buyer preparation and refresh schedule. Export only a published run, stage with the host runtime, then use original merchant release digest/generation controls to inspect, select and start. Read all seven saved deployment files through exact hashes and offsets. Closing a borrowed browser leaves the publisher and scheduler open; closing its owner drains the workbench and retained reads before releasing the publisher. No source or deployment step purchases data."
  },
  {
    "prefix": "merchant_buyer_expense_",
    "text": "For buyer expenses, open only a declared workspace and ledger alias. Inspect the current original revision and retain an exact requestId/payload before each change. Recover merchant_buyer_expense_request after an interrupted reply before retrying that same request. Capture and accept original statement editions, supply exact allocations and explicit outstanding dispositions, then use current period review before close. Reopen preserves issued editions. Export a project at its reviewed revision and use the existing manifest-pinned download and trusted receive commands."
  },
  {
    "prefix": "merchant_worldbank_",
    "text": "For World Bank workspaces, list declared aliases and open the original model. Save a source selection with its exact revision. Start or resume the same original capture ID, inspect its retained job until COMPLETE, and preserve its capture SHA256 for comparison, review and export. Original imported page receipts and handover packages require a host alias and inspected source hash. Merchant preparation uses a host profile; native publisher revisions, release generations and buyer intent/session IDs govern the full lifecycle. Browser and agent share the same model. Read original files in SHA-pinned chunks or use download-worldbank for durable complete receiving. Reopen the same original directory after interruption."
  },
  {
    "prefix": "merchant_woo_",
    "text": "For Woo stores, inspect merchant_woo_stores and merchant_woo_store_status, select an actual order from merchant_woo_queue, then read its current original order. Inspect a host-declared native receipt, retain its recordSha256 and a stable reviewId, then review or resume that same native source. Release only with the exact review SHA256 and selected confirmOrder; after interruption use live review_status before another explicit release. For refunds, inspect the original accounting export and current Woo refund snapshot, then prepare the selected verified adjustment UUID with its exact export hash, explicit Woo amount and currency. Apply only the saved prepared review hash with the selected confirmOrder. Refund recovery reads the same original order without a POST; REFUND_SAVED_JOURNAL_PENDING requires explicit same-ID apply to reconcile its existing native child. Preserve all original operation IDs, and use export/status plus SHA-pinned file chunks for complete handoff. Full Woo refund status can affect download access."
  },
  {
    "prefix": "merchant_facilitator",
    "text": "For a retained facilitator change, use merchant_facilitators and merchant_facilitator_review, inspect every generated native payment alternative, then stage the exact reviewId. Its complete review remains in merchant_inspect/compare and must match at native startup. After a lost stage reply inspect the proposed release ID."
  },
  {
    "prefix": null,
    "text": "Use merchant_sources, stage, inspect and compare to prepare a release. Activate with the current generation and exact digest. Start or restart explicitly."
  },
  {
    "prefix": "merchant_discovery_",
    "text": "Use merchant_discovery_status and review before applying the returned reviewId to publish or withdraw offers; after an interrupted apply, inspect current discovery instead of replaying it."
  },
  {
    "prefix": "merchant_cache_",
    "text": "Cache invalidation requires the current owned instance and an explicit route or all:true."
  },
  {
    "prefix": "merchant_fleet_",
    "text": "For a configured fleet, inspect merchant_fleet_plan and start with its digest; stage/review/prepare/activate uses the original exact candidate and revision. Keep draining sessions until fleet_status reports canRetire, then retire their exact child instance. Rollback uses a fresh retained-revision review; stop/restart uses this process-owned managerId. After a lost response inspect current status before another change."
  },
  {
    "prefix": null,
    "text": "Only this MCP process can stop its owned runtimes."
  },
  {
    "prefix": "merchant_support_",
    "text": "For support observation, inspect host profiles and the current configuration revision, start explicitly and retain the owned watcher instance. Recover notifications using their original event IDs and attempt counts."
  },
  {
    "prefix": "merchant_case",
    "text": "With a configured support connection, inspect source aliases or incidents, import exact original captures, and reopen the original case before changing owner terms. Case writes use its current revision; workorder and export use that exact saved revision. Inspect support export status after an interrupted reply."
  },
  {
    "prefix": "merchant_coingecko_",
    "text": "For CoinGecko research, list host-declared workspaces and open their original browser/model. Save complete requests and collections with stable opId, current project revision and current record version for updates. Inspect original host inputs and pin their SHA256 before importing full source bytes. Page every original capture, snapshot and comparison row; retain their source basis and exact numeric values. Provider plans use the original compiler and complete deployment download. Prepare native purchases from the current exact merchant challenge and inspect the same job before explicitly executing it. Preserve native SF31/SF36/SF88 identities, budgets and attempts. Recover an uncertain write with merchant_coingecko_operation and the same opId; use currentJob or inspect for present native action availability. Full project handovers restore through original source aliases or retained export IDs, with historical jobs archived. Download complete original files with their SHA256, readId and byte offset; close only the current owned instance."
  },
  {
    "prefix": "merchant_opencage_",
    "text": "For OpenCage work, list declared aliases and open the same saved workspace and browser. query_review returns the exact normalized source/terms review; capture retains one stable request id. Import exact host-declared HTTP observations to reconcile an incomplete native attempt. Inspect request/candidates and select with the original response SHA256 and current decision revision. Export that same decision, open its read-only customer viewer and receive every original manifest file with SHA-pinned chunks. Package current or explicitly proposed terms, inspect the saved package and release diff, then stage/activate/start or rollback through the original generation. Adopt an existing Buyer intent using its configured client alias and actual selected package. Keep source, capture, decision, package and Buyer identities through lost replies; close only the owned workspace/customer instances."
  },
  {
    "prefix": "merchant_tenderly_",
    "text": "For Tenderly merchants, list declared workspace aliases and open their original browser/model. Review and save a profile, open it, issue the exact request with the original id, subject and expiry in Unix milliseconds, then start its seller explicitly. Browser and MCP share the original profile, operation generation and provider observations. Read a saved simulation with provider_lookup; default reopens retained observations and refresh explicitly reads the provider again. Review a MATCHED observation before provider_recover. Keep the original lookup ID, observation ID and expected generation after a lost response. Merchant and provider responses use exact file-read selection, SHA256 and resumable chunks. Stop the merchant before selecting another profile; close drains only this owned instance."
  },
  {
    "prefix": "merchant_sheets_",
    "text": "For Sheets authoring, list host-declared workspaces and explicitly open the original source model and its borrowed browser. Browser and agent edits share the same original draft revision, capture and source-version IDs. Inspect declared input hashes or choose an existing Google connection and exact tab/range. Save the explicit projection, preview the same draft revision, then review and save its source version against the current selection. Retain the original request UUID and inspect/resume that same operation after an uncertain reply; never repeat an uncertain Google read under a fresh ID. Open the original publisher explicitly. Only currentPublisher reports its live URL; a historical receipt may contain an expired URL. Private source packets use their original version, verified SHA256 and retained chunk-read identity. Closing drains this owned browser/model/publisher and releases its native lease; reopen the same directory through its alias and reconcile original receipts."
  },
  {
    "prefix": "merchant_ckan_",
    "text": "For CKAN authoring, list host-declared workspaces and open the original saved project. Read its current operation before every mutation and pass that exact expectedOperationId. Capture, source review, publication, export and staging return the original operation ID immediately; inspect its saved completion before continuing. After a lost reply read the same native state. Stage into the project store bound to this operator, then use the original merchant inspect, compare, activate and start tools. Customer downloads retain the original file hash and byte offset. Close the owned model to release its original lease."
  },
  {
    "prefix": "merchant_python_",
    "text": "For Python authoring, list declared aliases and explicitly open the original saved model. Read revision/declaration/source before editing with the expected head. Retain preview operationId and inspect the same original job after an interrupted reply. Stage a saved revision, review its native digest and current generation, and explicitly activate/start/restart. Only this model handle can cancel its previews or stop its managed seller. Customer exports reuse original saved files; portable exports retain source, native release history and clients. Resume chunk downloads with the same file SHA256 and offset."
  },
  {
    "prefix": "merchant_receiving_",
    "text": "For receiving, inspect host source aliases, open the original saved workspace, and retain prepare/import/review IDs with exact source and plan digests. Read saved review status before retrying; replay uses the original capture. Close receiving to hand the same directory to its browser."
  },
  {
    "prefix": null,
    "text": "Customer client export reads original metadata and retains its completion receipt. After a lost response, inspect merchant_client_export_status; legacy exports require explicit adoption of the inspected complete files digest. File delivery reads the original five payloads and receipt without running the seller or generated code."
  },
  {
    "prefix": "merchant_accounting_",
    "text": "For accounting, list declared sources and explicitly open their original workspace. Review a recovery request before importing its retained preview, follow jobs and refresh the current revision, then capture and inspect the original report. File retrieval returns SHA-pinned chunks of the saved response or original report/archive; it never purchases again. Close the accounting workspace to release its original lease."
  },
  {
    "prefix": "merchant_publish",
    "text": "For a publisher connection, list merchant_publishers and explicitly open its declared workspace; saved enabled refreshes resume. Inspect native source, plan, candidate and target before review/publication. Use original run UUIDs, review IDs and schedule revisions; reopen buyer files by the recorded handoff UUID. Close only the exact owned publisher instance."
  },
  {
    "prefix": "merchant_pricing_",
    "text": "For pricing, inspect declared aliases and open the original SF97 model. Capture seller and native observations through merchant_pricing_source; use captureSha256 to page the same source. Save merchant pricing reviews with the current original revision and a stable requestId. Repricing starts from a saved version and complete ordered options: preview explicit atomic edits, retain its exact reviewSha256, and save with the current price-decision revision. Inspect the saved manifest after an interrupted reply. Stage a retained original API package by its decision and review hash, then use the original release digest/generation controls for activation and startup. Each alias reports whether its staging store is this operator release store. Download original files through SHA-pinned chunks."
  },
  {
    "prefix": "merchant_fiscaldata_",
    "text": "For Fiscal Data, list declared workspaces and explicitly open the original model. Review exact source revisions, fields, units, scales and stock-series notes before building native CSV editions. The browser and MCP share the same model and host operator identity. Keep original request IDs, reviewed offer digests and release generations. Checkpoint drains the original source model into a complete retained source/review package; receive only into an empty closed declared alias and resume unfinished captures explicitly. Source pages, native delivery archives and portable packages use SHA-pinned retained chunks. The original publisher, SF82 seller and SF88 buyer own every payment and approval."
  },
  {
    "prefix": "merchant_opensearch_",
    "text": "For OpenSearch, inspect merchant_opensearch_status and open only a host-declared workspace. Read the original draft or relevance-set revision before saving or judging, and retain its original requestId. Capture, preparation and native relevance evaluation use that same operation journal. After an interrupted response inspect merchant_opensearch_operation with the original request ID. Read the saved edition, compare actual query scope and judgments, then promote the selected evaluated variant into an original merchant draft for preparation. Full native results, reports, CSV and customer files use original SHA-pinned retained reads; resume with the same readId, file hash and byte offset. Close releases this process-owned workspace and temporary reads."
  },
  {
    "prefix": "merchant_har_",
    "text": "For captured API sources, use merchant_har_workspaces, status and files to select the existing SF61 console and exact input hash. Ingest or adopt the original source, page every native group and review, then retain the complete decision document. Keep the immutable source selection and revision through native source, merchant preview and save. Later captures select the exact previous saved review; merchant_har_plan reuses the browser unchanged-route carry. Copy or receive the whole original source and use retained export manifests and SHA-pinned chunks after an interrupted reply. Closing HAR access drains only its calls and temporary reads; the existing source consoles retain their lifetimes."
  },
  {
    "prefix": null,
    "text": "Payment verification and settlement remain in the original seller and configured facilitator."
  }
];

export function merchantInstructions(tools) {
  const names = tools.map(value => value.name);
  const selected = sections.filter(section => section.prefix === null || names.some(name => name.startsWith(section.prefix)));
  const result = selected.map(section => section.text);
  if (names.includes('merchant_opensearch_deployment_status'))
    result.push('OpenSearch deployment tools operate the original workspace deployment journal and store. Inspect the current original generation and digest before stage, activate, start, restart or rollback, and reconcile the same original request ID after interruption. Read generated customers through the original per-alias manifest, file, archive and handover tools.');
  if (names.includes('merchant_opensearch_deployment_adopt_client'))
    result.push('For an interrupted OpenSearch client export, inspect its original filesSha256 and use deployment_adopt_client with that exact exportId and expectedFilesSha256. Resume the original retained file reads.');
  return result.join(' ');
}
