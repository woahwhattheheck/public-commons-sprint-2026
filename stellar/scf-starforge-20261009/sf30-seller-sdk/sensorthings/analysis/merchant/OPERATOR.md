# Reviewed publication delivery

This desk delivers an **existing approved SensorThings analysis publication and its complete original project export** through the maintained SF30 file seller, SF88 buyer readers and SF47 Operations receiver. It opens on the same SensorThings workspace, at **/analysis/merchant/**, from the **Publication delivery** link in Observation analysis.

The five pages cover publication selection, native offers, original saved-output receiving, request recovery and complete project handover. The original source acquisition, analytical calculations, human review, Helgoland application and publication remain in [Observation analysis](../../ANALYSIS.md). This extension adds the delivery workflow to those records.

## 1. Open the installed workspace

Use the existing complete Merchant distribution with the SensorThings contribution selected. The contribution adds:

| Installed surface | Purpose |
| --- | --- |
| sensorthings-analysis-delivery | Open the same host or operate an existing authenticated workspace |
| sensorthings-analysis-delivery-native | Attach the continuation to an explicitly yielded existing Chromium page |
| ./sensorthings/analysis/merchant | Typed client, host configuration and original native continuation |
| ./sensorthings/analysis/merchant/client | Browser-compatible authenticated client |
| ./sensorthings/analysis/merchant/native | Existing-page continuation |
| /analysis/merchant/ | Complete operator desk |

A source checkout can run the same files with Node. The root SensorThings distribution supplies the original seller, buyer, project receiver and their dependencies. Keep the whole distribution; copying this directory alone omits those original engines.

The original host already holds its workspace lease. If that Desk is running, use its private link and current workspace UUID. When the original host has stopped, start the same retained workspace with its selected private session file:

~~~sh
node analysis/merchant/cli.mjs serve \
  --workspace /absolute/original/workspace \
  --expected-workspace-id ORIGINAL_UUID \
  --session-file /absolute/private/operator.url \
  --source-inbox /absolute/private/source-inbox \
  --buyer-workspace /absolute/original/buyer-inbox \
  --merchant-runtime /absolute/private/merchant-runtime.json \
  --port ORIGINAL_HOST_PORT
~~~

This command delegates the existing analysis launcher, listener, store and shutdown owner. It does not open another writer alongside an active Desk. Its startup JSON contains the original origin, UUID and session-file path. The bearer fragment stays in the private session file. Open the private link through the existing operator, then choose Publication delivery.

Directories and original private files use the retained host ownership and mode checks. Use the selected full paths; keep the original workspace, source inbox, buyer Inbox and receiving directories distinct. The browser never chooses a native executable, credentials file or buyer workspace.

## 2. Configure delivery on the host

The optional runtime file uses [runtime.schema.json](runtime.schema.json). [runtime.example.json](runtime.example.json) is a template; replace its host reference with the actual retained Operations connection or omit that field.

~~~json
{
  "schema": "stellar-forge.sensorthings-analysis-merchant-runtime.v1",
  "port": 0,
  "maxInFlight": 4,
  "drainGraceMs": 60000,
  "nativeFactoryModule": null
}
~~~

The native seller listens on loopback. The **public HTTPS origin and fixed route prefix** are explicit terms in each reviewed offer. Configure the existing host's public routing to that listener through its normal deployment. A prepared catalog does not establish reachable public routing.

Without a configured native payment factory, the actual original service is **CHALLENGE_ONLY**. It can show the native payment challenge but cannot settle a purchase. The UI displays that actual mode separately from an offer being prepared.

For a configured native seller, the host may provide:

~~~json
{
  "path": "/absolute/reviewed/host/seller-factory.mjs",
  "sha256": "EXACT_MODULE_SHA256",
  "bytes": 1234,
  "exportName": "createConfiguredFactory"
}
~~~

This object is the optional **nativeFactoryModule** value. The numbers and identity must come from the actual reviewed host module. Its named export receives the host environment and AbortSignal, and returns the existing native seller factory expected by SF30. The loader checks the selected module's exact bytes before and after import and binds the module cache to that SHA. The selected module's dependencies and credential provisioning remain those of the existing native deployment. This descriptor identifies the chosen host module; it does not certify every transitive dependency or a successful payment.

For optional SF47 association, **operationsAccessFile** names the original private access URL file. Its contents use the existing **URL#access=TOKEN** format. The API origin may be HTTPS, or the original loopback HTTP service. The token is read on the host; it is not copied into the publication, native catalog, browser settings, action payloads or portable project.

Runtime settings are selected when the original workspace host opens. Restart that same host to change them. Browser actions can select an offer and an existing Operations case, not a different host credential or executable.

## 3. Select the original approved publication

On **Select publication**:

1. Select the existing analysis project and immutable publication.
2. Inspect its source edition, saved analysis version, publication SHA and accepted source review.
3. Select a completed **original project export** that contains this exact publication.
4. Enter the native service title, public origin, fixed versioned route prefix, description, release/attribution statement and reason.
5. Enter the actual native payment scheme, Stellar network, asset, atomic amount string, recipient, timeout and optional extra fields.
6. Select any desired original publication companions by their exact names.
7. Choose **Prepare native offer**.

If the project has no suitable export, **Export current complete project** invokes the original project exporter with its own retained request. The full archive includes the project's original source objects, saved editions and versions, reviews, publications, files and selected delivery history. It is broader than a single brief. Inspect that full scope when selecting what is being offered.

The backend binds the publication, original export request/result, source review and complete archive. A changed review or mismatching archive stops preparation. It does not manufacture a new publication or silently substitute a later source.

Every offer contains **project.ndjson.gz**, the complete original project archive. Optional companions add original publication files. The maintained response-asset limits apply to complete files: **16 MiB per asset and 64 MiB across offered routes**. The operator sees those limits from the installed native constants. If the full project exceeds them, retain it and use its original complete receiving route. The desk does not truncate streams, ZIP members, citations or history to produce a smaller paid asset.

## 4. Operate the original native offer and buyer review

On **Native offers**, inspect the retained native configuration, route URLs, catalog, source binding and full file inventory. Preparing an offer runs the existing response-asset compiler, native bundle builder and catalog exporter. The retained bundle is checked against the configuration derived from the exact original publication and reviewed terms.

**Start selected native service** is an explicit action in the existing long-running host. Its result records the actual local listener and mode. **Stop and drain original service** closes that same live service. Closing the whole original workspace host also drains services it owns. A historical start record is retained after the host stops; it does not mean that a listener still exists.

**Prepare original SF88 review** selects one catalog route and payment option, with the original buyer intent and response destination. It uses the maintained buyer's preparation function. It does not enqueue, execute, retry or finalize a purchase. The existing buyer operator receives those exact files and owns any authorized purchase.

When the original configured Inbox already contains the selected outcomes, **Export selected original Inbox records** reads those records and their verified responses. It preserves the selected original intent IDs. A durable attempt marker precedes capture. After an interrupted capture, the same operation inspects the saved file; if that file is unavailable, it reports the unresolved original attempt instead of making another observation.

Download an offer or buyer-preparation record from **Original files**. Names, selectors, byte counts and SHA256 values are shown. The browser validates downloaded bytes before making the file available.

## 5. Receive actual saved output

Use **Receive original output** on the selected receiving workspace. Its host-bound source inbox must contain three complete existing files:

| File | Native authority |
| --- | --- |
| Catalog | Original SF30 compiled file offers and payment options |
| Handoff | Saved SF88 Inbox export with the original job, request and payment/output observations |
| Response | Actual saved complete project archive returned by that native job |

Select the three files and inspect them. Then select the exact catalog row, payment option, receivable native job, delivered publication and attributed receiving decision. The original buyer reader binds the request, listing, selected payment terms and output SHA/byte count. A generic HTTP success or an unrelated archive does not satisfy this join.

The project preview verifies the archive hash and manifest identity. It explicitly reports that full member receiving is still pending. **Receive and record this selection** invokes the original project importer, which verifies every retained object, file and citation before adoption. It then records the receiving decision against that exact original publication and native job.

A receiving decision can be **received** or **changes_requested**. Both retain the exact source and reason. File receiving does not silently perform a scientific review, merchant order acceptance, payment or settlement.

### Optional original SF47 case

Choose **Read original Operations cases**, then enter an actual returned case ID. **Load selected original case** shows its current version, existing deployments and purchase associations. Select the original buyer deployment and, if appropriate, an existing purchase; otherwise let the maintained buyer receiver create or match the purchase.

Preview the complete selection again. The commit binds the original origin, case version and native preview SHA. Receiving then performs the original transactions in order:

1. **buyer.receive** for the selected original job.
2. **source.add** for the frozen analysis receiving review.
3. **purchase.observe** linking that source to the original purchase while retaining its independent order and payment observations.

Each native command body and request ID is saved before dispatch. An uncertain reply is recovered through that same command. The first final Operations observation is also frozen before the local receiving file is published. A later unrelated case edit does not change the historical receiving result or force another transaction.

## 6. Recover the original request

The browser retains each exact request body, destination and workspace UUID before dispatch. Its journal and drafts are scoped to **origin plus UUID**. The bearer token stays in memory and is not saved with these records. Closing and reopening the desk does not dispatch a request.

On **Requests & recovery**:

- **Read original result** reads the original operation.
- **Send exact original request** sends the same saved body when appropriate; it does not choose another operation ID.
- **Continue original delivery request** creates an attributed continuation referencing the original local operation and request SHA. The original payload and durable phase IDs remain unchanged.
- **Imported operation history** is readable evidence from another workspace. It cannot authorize a local seller, Inbox capture or Operations mutation.

Resolve the actual original failure before continuing. Missing retained captures, changed source bytes, conflicting immutable files, stale case reviews and lost service starts have different meanings. The API reports those distinctions. A changed operator decision uses a new explicitly reviewed request while keeping the unresolved original history.

A completed operation's request SHA identifies its canonical action and payload. Its result SHA identifies the original stored JSON bytes. These are separate from the byte hash of a browser's exact raw request file.

## 7. Full project export, independent receiving and reopen

On **Project handover**, select the existing project and choose **Export complete project and delivery history**. The original exporter freezes the selected project state, original source files, publications, delivery records and original operation histories. The full archive remains editable through the original importer.

Receive that archive into a separately selected existing workspace through the same page's **Receive a complete project** form. The receiving archive is checked before publication. Existing local project heads and local review authority are preserved; imported histories stay attributed to their original workspaces.

After receiving, reopen the publication and delivery record, inspect their exact files and original receiving history, and continue through the original analysis workspace. A new offer from that receiving workspace requires its actual local source review. Historical offers and evidence remain inspectable without replaying their original execution.

Keep the complete project archive, original source/customer files and native receiving records together when delivering the work. The application does not place runtime bearer tokens or native credential files in that archive. The private host configuration stays with its operator.

## 8. Connected CLI and complete downloads

All connected commands require the actual original workspace UUID and a private URL file. The CLI reads the token itself.

~~~sh
node analysis/merchant/cli.mjs overview \
  --url-file /absolute/private/operator.url --workspace-id ORIGINAL_UUID

node analysis/merchant/cli.mjs record --id ORIGINAL_RECORD_ID \
  --url-file /absolute/private/operator.url --workspace-id ORIGINAL_UUID

node analysis/merchant/cli.mjs operation --id ORIGINAL_OPERATION_ID \
  --url-file /absolute/private/operator.url --workspace-id ORIGINAL_UUID

node analysis/merchant/cli.mjs action --request /absolute/private/original-request.json \
  --url-file /absolute/private/operator.url --workspace-id ORIGINAL_UUID
~~~

Keep the exact action JSON before the last command. The CLI sends those same bytes and does not generate an operation ID, review, payment or publication.

For complete large files, use the existing SensorThings native downloader. Its private connection configuration uses the original schema, alias, UUID and consoleUrlFile. A selection file can contain:

~~~json
{"kind":"analysis","id":"ORIGINAL_RECORD_OR_EXPORT_ID"}
~~~

~~~sh
node analysis/merchant/cli.mjs inspect-download \
  --config /absolute/private/connections.json --alias ORIGINAL_ALIAS \
  --selection /absolute/private/selection.json

node analysis/merchant/cli.mjs download \
  --config /absolute/private/connections.json --alias ORIGINAL_ALIAS \
  --selection /absolute/private/selection.json \
  --directory /absolute/private/original-download \
  --export-id EXACT_INSPECTED_FILE_SET_ID \
  --expected-manifest-sha256 EXACT_INSPECTED_MANIFEST_SHA256 \
  --progress
~~~

Reopen that same download directory after interruption. The original retained downloader preserves its checkpoints and read handles. The final **sensorthings-download.json** binds each numbered local file to its original name, exact selector, bytes and SHA. Use those selectors when matching files; a sanitized local basename is not an original source identity.

The UI's direct download bound is 256 MiB. The native downloader retains its own full-file capacities and streams data. The seller's smaller 16/64 MiB offer limits are a separate native contract.

## 9. Original native continuation

[NATIVE_RUN.md](NATIVE_RUN.md) describes the complete existing-page caller and exact input schemas. It can prepare an offer and review, pause for the original buyer outcome, then continue the same input/control directory through real receiving, full download, complete export and independent reopen.

The caller owns its control journal and browser requests. The original source, buyer, seller host and receiving workspaces keep their existing execution ownership. The source handoff must supply actual UUIDs, publication/export identities, retained files and the original buyer result. Sample configuration values are placeholders, never evidence of a completed provider capture or payment.

## Source and implementation references

The source-of-truth contracts are [API.md](API.md), the unchanged native [response-asset compiler](../../../response-asset.mjs), original [SensorThings downloader](../../download.mjs), original [project transfer](../transfer.mjs) and original [SF88 saved Inbox reader](../../../../sf88-operator-buyer-cli/operations-handoff/customer.mjs). The [distribution guide](../../DISTRIBUTION.md) describes installation through the maintained source selection.

Authored adapter code is MIT. Original SensorThings, Helgoland, analytical source, buyer records and supplied release terms retain their original provenance and licenses.
