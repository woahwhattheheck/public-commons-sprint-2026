# ClinicalTrials registry workspace

This operator retains an entire ClinicalTrials.gov v2 cohort, reviews whole study records, prepares an explicit native dataset, and delivers the original source and review history through the existing Starforge publisher and customer workflow.

The same original NDJSON/XML workspace owns the source files, mapping, builds, query engine, comparisons and lease. The browser, CLI and attached merchant MCP operate that one workspace. PRS validation, reviewed modernization and typed reconciliation use the shared clinicaltrials/prs implementation.

## Managed application

Choose **ClinicalTrials registry** in the existing **Applications** workspace to
review the original private workspace and selected Python, start its console,
attach the same MCP connection, and stop or reopen its retained work. The
[complete managed operating guide](MANAGED_APPLICATION.md) covers source/runtime
selection, PRS readiness, customer handover and the existing CLI controls.

## Open the operator

~~~sh
starforge clinicaltrials --workspace /private/registry init
starforge clinicaltrials --workspace /private/registry serve \
  --port 0 --console-url-file /private/registry-console.url
~~~

The console URL is a private loopback capability. Its connection file contains exactly the raw URL plus a newline and has mode0600. The serving process removes only its own unchanged connection file when it closes. A host can attach the original merchant MCP source and ClinicalTrials tools using this same URL; it acquires no second Python workspace lease.

Direct entry:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/clinicaltrials/cli.mjs \
  --workspace /private/registry status
~~~

The Node command selects the running Node executable for the original dataset engine. Python defaults to python3; SF30_XML_PYTHON selects an existing Python runtime. The shared PRS leaf uses lxml for the complete official XSD closure. The operator reports the actual PRS dependency status.

The installed `dataset-clinicaltrials` alias selects this same command.
[requirements.txt](requirements.txt) includes the original PRS
`lxml>=5.4,<7` declaration. Use the interpreter selected by
`SF30_XML_PYTHON` to install that file in its own environment; the
[merchant runtime guide](../../distribution/RUNTIME.md#clinicaltrials-registry-and-prs-python-dependency)
provides the complete installed-source commands.

The [attached ClinicalTrials MCP operator](../../../../stellar-forge/mcp-merchant-operator/CLINICALTRIALS_WORKSPACE.md)
provides the same retained study, source, review, PRS, publisher and customer-file
operations through the original running console. Its complete command-line
client is also available as `starforge merchant-mcp clinicaltrials`.


## Capture a complete original cohort

A source selection is an explicit JSON object:

~~~json
{
  "name": "Daiichi Sankyo results portfolio",
  "query": {
    "query.lead": "Daiichi Sankyo",
    "aggFilters": "results:with",
    "sort": "LastUpdatePostDate:desc"
  },
  "pageSize": 50,
  "markupFormat": "markdown",
  "maxStudies": 100000,
  "maxBytes": 268435456
}
~~~

~~~sh
starforge clinicaltrials --workspace /private/registry configure --file cohort.json
starforge clinicaltrials --workspace /private/registry capture start
starforge clinicaltrials --workspace /private/registry capture page
starforge clinicaltrials --workspace /private/registry capture pause
starforge clinicaltrials --workspace /private/registry capture resume
starforge clinicaltrials --workspace /private/registry capture complete
~~~

The browser provides the same save, start, next-page, complete, pause and resume controls. Each advance requests one real provider page. Pause stops before the next request and keeps the original opaque token. Resuming checks the provider data edition before continuing.

The original API contract is retained in contracts/ and its complete source manifest. Full study records are requested by omitting fields. The query, filters, sort and markup remain identical throughout a token chain. The initial request asks for totalCount; subsequent requests carry the original nextPageToken. An empty studies array can still have a next token, so only an absent token ends the chain. The complete count is checked against the original total when supplied.

The operator retains each original response before parsing it, its HTTP receipt, the exact request URL, and the resulting whole-study NDJSON. It checks the API data timestamp before capture, on resume, and at completion. If that edition changes or a page repeats an NCT identifier/token, the retained capture shows the concrete source issue and keeps the original pages available. A new source selection can be started while those earlier records remain retained.

The configured capacity is a complete-source limit. A capture that reaches it remains reviewable and can be replaced with a narrower cohort or a larger supported capacity. It is not published as a complete selection.

Official references:

- [ClinicalTrials.gov v2 OpenAPI](https://clinicaltrials.gov/api/oas/v2)
- [ClinicalTrials.gov data API](https://clinicaltrials.gov/data-api/api)
- [NLM: public study access through the API](https://www.nlm.nih.gov/pubs/techbull/ja25/ja25_clinical_trials_screen-scraping.html)

## Review full study records

The whole-study page lists NCT ID, title, sponsor, status, last update and result availability. Opening a study exposes every retained top-level section, the original page reference and the exact complete JSON. The display formatter preserves original numeric lexemes.

Review decisions have three dispositions: ready, follow-up, and exclude from the selected downstream delivery. Every decision records its reviewer, note and source SHA256. These decisions are separate from registry field values and remain available in the complete export.

~~~sh
starforge clinicaltrials --workspace /private/registry studies --limit 50
starforge clinicaltrials --workspace /private/registry study \
  --capture capture-ORIGINAL-UUID --id NCT03529110
~~~

Whole-study comparison uses the same NCT identifier in two retained captures and reports exact nested field additions, removals and changes. It preserves array occurrence paths and original values. Dataset comparison separately uses the reviewed native projection and its explicit key columns.

## Map and query through the original dataset engine

Load the registry review mapping, review its columns, and build the completed cohort:

~~~sh
starforge clinicaltrials --workspace /private/registry mapping default
starforge clinicaltrials --workspace /private/registry build
starforge clinicaltrials --workspace /private/registry query \
  --params '{"limit":"100","sort":"nct_id"}'
~~~

The browser supports exact JSON path arrays, scalar/JSON/state modes, explicit native types, nullable values, missing-value rules, keys, filters, ranges and sort columns. It can add the state columns required by an optional mapping. The complete original field inventory includes every observed path and its source types, coverage and lexical samples.

The default mapping exposes NCT ID, title, status, lead sponsor, study type, last update, enrollment and results availability. Optional scalar fields carry separate state columns. Dates remain the exact source strings; a partial date is not converted to an invented day. IDs remain strings. Numeric conversion occurs only for an explicitly selected valid native type.

All query filters and continuation cursors are handled by the original SF30 dataset engine. The operator saves the initial replay separately from the exact last accepted page and its next cursor. A customer export keeps those values in query.json. A continuation must use the original cursor with the same selection.

The native mapping format remains stellar-forge.ndjson-mapping.v1; complete details are in the original [NDJSON guide](../ndjson/README.md).

## Review PRS input with the original schema engine

Import an actual operator-selected Protocol or Results XML file. The original bytes, schema inspection, upload intent, legacy occurrences and source schema hashes are retained.

~~~sh
starforge clinicaltrials --workspace /private/registry prs import \
  --file protocol.xml --schema protocol
starforge clinicaltrials --workspace /private/registry prs inspect \
  --document ORIGINAL_XML_SHA256
~~~

Prepare a complete reviewed request file with documentId, decisions, reviewer and rationale. Each modernization decision selects an elementId from the original inspection and an action of keep, remove or replace, with its reason. Replacement values are explicit source-specific native fields. The original engine rejects conflicting replacements.

~~~sh
starforge clinicaltrials --workspace /private/registry prs plan --file reviewed-decisions.json
starforge clinicaltrials --workspace /private/registry prs apply --file selected-plan.json
~~~

The plan binds the original XML, original schemas, exact decisions and candidate identity. Applying it retains the candidate XML with the original comparison and plan. Independently edited candidate XML can also be retained and compared through prs.candidate.

Typed reconciliation accepts a documentId, captureId and an explicit plan containing studyLinks, reviewer, rationale, optional fieldIds and reviewed finding decisions. Each study link carries its PRS studyIndex, original nctId and matching reason. The controller supplies the exact full API study JSON and captured source provenance to the original PRS engine.

The current NLM notice identifies thirteen deprecated elements that are accepted but ignored and may be removed in a future schema. Review uses their exact occurrence locations, so a contact field with the same short name elsewhere is preserved. The original engine reports actual full/partial/list/delete behavior described by the supplied XSD alongside validation findings.

- [Original PRS engine and action contract](prs/API.md)
- [NLM September22,2026 modernization notice](https://www.nlm.nih.gov/pubs/techbull/so26/so26_ctg_prs_api.html)
- [Original Protocol schema](https://cdn.clinicaltrials.gov/documents/xsd/prs/ProtocolRecordSchema.xsd)
- [Original Results schema](https://cdn.clinicaltrials.gov/documents/xsd/prs/RRSUploadSchema.xsd)

## Prepare merchant and customer delivery

In Query & merchant, save the actual public origin, resource path and original payment terms. The original native offer compiler validates them against the reviewed dataset before saving. Export the active complete edition:

~~~sh
starforge clinicaltrials --workspace /private/registry export
~~~

The customer directory includes:

- dataset.csv and dataset.json, with the original native snapshot;
- original whole-study source, mapping, native build and capture manifests;
- all original provider response/version receipts;
- study decisions, original/candidate PRS XML, frozen modernization plans and full reconciliation reports;
- official contracts and their original byte identities;
- query.json, preserving initial replay and exact continuation separately;
- native-project.zip, the original NDJSON source/mapping/build packet;
- clinicaltrials-workspace.zip, complete portable registry/source/review history;
- seller.json, openapi.json and the generated original customer SDK when merchant terms were configured;
- RECEIVING.md and source.json.

The source descriptor remains stellar-forge.clinicaltrials-source.v1. Its sourceFiles manifest passes the exact raw source and review closure through the existing generic SF82 dataset release. The shared publisher prepares the adjacent CSV/config/seller/source files; it does not change this provider's source identity.

Publisher & buyer exposes the original retained drafts, typed preview and cursors, version CAS, release staging/activation/rollback, owned runtime, reviewed customer offer, retained buyer session, original account/export operations and all seven customer file kinds. Source capture, private publisher state and native customer intents remain with their existing controllers.

For a stopped unpaid customer page, the original continuation retains the prior page and attempt. The UI shows the original reason and explicit Continue unpaid page action, submitting the original attempt digest to the maintained buyer engine. Normal recovery remains available on that same session.

## Receive and reopen

Initialize a new directory and receive the portable file:

~~~sh
starforge clinicaltrials --workspace /private/received-registry init
starforge clinicaltrials --workspace /private/received-registry restore \
  --file clinicaltrials-workspace.zip
starforge clinicaltrials --workspace /private/received-registry status
starforge clinicaltrials --workspace /private/received-registry serve --port 0
~~~

Receiving checks every declared file, original response/token chain and complete count, reconstructs the original NDJSON sources and mappings, and rebuilds native dataset snapshots through the maintained packet engine. Study decisions, PRS XML and complete original plans/reports reopen with those exact source identities. The portable packet excludes the running console capability, mutable account configuration and live process state.

The original source packet can also be received by the NDJSON command. The complete ClinicalTrials packet supplies the extra registry and review context.

## Request continuity and one workspace owner

All new HTTP mutations use POST /api/clinical/action with:

~~~json
{
  "action": "capture.advance",
  "payload": {"captureId": "capture-ORIGINAL-UUID"},
  "expectedRevision": 4,
  "requestId": "ORIGINAL-CANONICAL-UUID"
}
~~~

Responses contain state and result. A completed same request returns its retained outcome. A request UUID cannot be reused with different action/payload. The browser keeps an uncertain request and reads GET /api/clinical/operation?requestId=... before continuing. Original source-engine mutations are reflected in the Clinical revision. A process-interrupted operation stays in the ledger while the operator reviews current records and makes a new explicit continuation.

Raw PRS and portable uploads use their dedicated authenticated routes, an original request UUID, integer expected revision and exact body SHA binding. Original file names are metadata; a remote caller cannot choose a server filesystem path.

The Python model supports Workspace(directory, create=False), state(), act(), close(), native source operations and retained read/download helpers. OperatorServer(workspace,port) borrows that model; closing the listener does not close a host-owned workspace. The CLI owns and closes its workspace after the listener and original publisher drain.

The original lease serializes all mutable source, review and publisher actions. The publisher bridge owns one original Node publisher; an HTTP client reconnects to that same operation instead of launching a second one.

## License

MIT, consistent with the existing Starforge seller toolkit and shared source engines.

## Retained PRS upload previews and exact study bytes

The full PRS implementation is the source-owned `clinicaltrials/prs/` leaf. Its original XSD closure, modernization profile, correlated record links and source-based upload semantics remain authoritative. `study().json` contains the retained UTF-8 study bytes, including the original record terminator, and reproduces `sourceSha256`. The text shown for a PRS document uses the encoding reported by that same original inspector; the downloadable XML retains its exact bytes.

`prs.preview` accepts `{baseDocumentId,incomingDocumentId,reviewer,rules?}`. Both documents must already belong to this workspace and use the same selected Protocol or Results schema. The original `preview_upload` composes the reviewed full/partial/list-delete operation. The controller retains both inputs, the composed candidate and a separate immutable preview report with all source operations, unresolved units and original-to-candidate changes. A candidate can equal an existing document byte-for-byte; its preview still has its own retained report.

Read the result through `GET /api/clinical/prs-preview?previewId=ID`; `state.prsPreviews` lists the saved reports. `GET /api/clinical/prs-catalog` returns the complete original 185-field profile, including typed XML/API routes and the explicit record/group identity requirements. The browser exposes both reads and the full reviewed preview form. CLI equivalents are `prs preview --file reviewed-preview.json`, `prs preview-read --document ID`, and `prs catalog`.

Portable receiving includes `prsPreviews` and exact `prs/preview-ID.json` files with the original XML, modernization plans and reconciliation reports. Customer sourceFiles retains the same closure for native SF82 publication. New workspaces can receive older packets without previews.

The native dataset's declared column order is part of its snapshot. Customer export preserves that order when changing the adjacent CSV filename to `dataset.csv`; general metadata canonicalization does not reorder the dataset's columns. Failed provider-version response bytes remain retained with their validation outcome, while a completed capture still requires consistent original validated start/resume/finish editions.
