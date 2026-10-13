# Airtable / NetSuite provider source intake

This additive intake prepares complete selected provider exports for the existing migration acceptance application. Airtable supplies the candidate source; a separately retained NetSuite SuiteQL result supplies the expected comparison. The original application owns source retention, plan compilation, native dlt execution, acceptance, history and receiving.

## Complete review and native application

Open `index.html` through the product's existing local source server to review full populations, edit a complete mapping, retain attributed approval and reopen unfinished work. [OPERATING.md](OPERATING.md) documents the complete original Workspace receiving command and existing-Page browser course. The collector below supplies the same retained input; it adds no independent writer.

## Installed paths

Place this directory at products/migration-acceptance/adaptations/airtable-netsuite/. The exact JSON reader remains at the existing workbench/vendor/dlt/vendor/sling/vendor/stellar-expert/exact-json.mjs path. sha256.mjs carries the complete existing MIT implementation and license. provider-input.mjs is synchronous and browser compatible; it uses no Node globals. Browser composition must serve both local modules and the existing exact JSON import at their actual relative paths.

Node 24 runs the read-only collector and disk preparation commands. The original application provisions its own pinned CPython/dlt/DuckDB runtime. There is no provider write command in this contribution.

## Complete operation

1. Use the existing authorized provider session to retain the actual base schema and NetSuite Records Catalog selection. Review the exact table IDs, business keys, SuiteQL fields and permissions, parameter values, unique ordering and population boundaries.
2. Copy configuration.template.json and mapping.template.json into the private case. Complete them using the actual reviewed source. Capture all related selected tables; include inactive rows when the selected business population requires them. Retain any filter or exclusion explicitly.
3. Supply AIRTABLE_READ_TOKEN and NETSUITE_READ_TOKEN only in the executing process environment. The collector does not acquire tokens, create integrations or retain authorization headers.
4. Run:
   node capture-providers.mjs /private/case/configuration.json /private/case/provider-capture
5. Prepare the original input files:
   node prepare-provider.mjs /private/case/provider-capture/capture.json /private/case/mapping.json /private/case/prepared
6. Receive every complete prepared source through the existing application's source.retain operation. Keep its actual request IDs, source IDs and expected revisions in the original case journal. Supply the returned IDs by exact path to bindProviderPipeline, or run:
   node prepare-provider.mjs /private/case/provider-capture/capture.json /private/case/mapping.json /private/case/prepared --source-ids /private/case/actual-source-ids.json
7. Pass pipeline-input.json to the existing plan.compile flow. The retained resources use a local DuckDB replace baseline. The existing operator owns native runtime preparation, extraction, normalization, load, independent full-table comparison, acceptance and full handoff.
8. Inspect projection.json: both population counts, all mapped columns, omitted-cell policies, full row provenance and every relationship orphan are present. Acceptance requires business review of these outcomes alongside the original native result. A list export does not establish deletion; a complete observed interval is not automatically an atomic cross-provider snapshot.
9. Keep capture.json, mapping.json, PREPARED.json, all original page files, full native operation history and independent receiving source in the same private delivery.

## Capture continuation

The collector retains configuration and operation identity before requesting pages. A successful response is retained in full before the cursor advances. A subsequent invocation with identical configuration reuses each exact saved response and continues the same operation. It never silently replaces a page with a later response. Provider errors are separately retained, and HTTP 429 uses provider Retry-After plus Airtable's documented 30-second minimum. Calls are serial and Airtable calls are spaced at least 250 ms. Four attempts are the maximum for one request; a longer provider delay exits for a later same-operation continuation.

capture.lock is an exclusive local writer marker. If a process dies, inspect its retained PID/operation with the original host owner, confirm that process has exited, then remove only that stale lock. Other source files remain unchanged. There is no automatic stale-lock eviction.

If a cursor has expired, the selected schema changes, totalResults changes, a duplicate stable key appears or pagination cannot finish, preserve that attempt and create an explicitly new capture operation and directory. The existing incomplete attempt remains source history. Do not splice new responses into its old page chain.

A completed capture reopens without provider credentials or network requests. For a later full export, use a new operation/directory. --previous compares matching provider selections and emits added IDs and IDs not observed in the following scope; it neither labels them deleted nor issues deletions.

## Source and matching contract

MAPPING.md describes the full contract. Business identifiers are supplied explicitly; record IDs and large integer values retain exact lexical identity. Independent expected files are projected only from SuiteQL pages. A deliberate comparison difference remains a difference. No shared transformation output is copied over it.

The adapter supports exact text, BIGINT, DECIMAL, boolean, date and timezone-bearing timestamp columns. It expands Airtable linked-record arrays into a separately selected native relation table without changing their order. Other complex cell values remain in the original raw response and require an explicit following reviewed projection; the scalar mapper rejects them.

The example directory is an authored, self-contained converter example. Its account/table/query identifiers and records are demonstrative configuration; it is not a customer account. It includes a retained balance difference, an integer larger than JavaScript's safe integer limit, omitted checkbox values and a three-row relationship. These files can exercise the complete original application locally without implying provider access.

## Integration API

prepareProviderMigration({capture,mapping}) returns:
- manifest: schema airtable-netsuite.prepared.v1, operationId, mappingId, complete files[] descriptors, tables[], relationship results and consistency.
- files[]: complete {path,content,bytes,sha256}, using UTF-8 content.
- inputs/<table>.json: full candidate array for the original native JSON resource.
- expected/<table>.json: original dlthub.expected-table.v1 typed values from independent NetSuite rows.
- capture.json, mapping.json and projection.json: full source and transformation custody.

bindProviderPipeline(prepared, sourceIds, {title,pipelineName,datasetName}) reopens the complete source/mapping and verifies the manifest before producing dlthub.pipeline-input.v1. sourceIds maps each actual source/expected path to its distinct original retained source ID. It does not write the application or execute native operations.

inspectCapture(capture) validates complete original page chains and selected schema. compareCapturePopulations({before,after}) compares later complete captures only when the full account/query/scope configuration matches apart from capture operation metadata.

## Publication

Reusable code and authored examples may travel in the existing public product. Actual tokens, account identifiers, customer exports, business mappings, native workspace and results belong in the original authorized private customer delivery.
