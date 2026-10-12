# Census address operations for agents and Applications

Operate the existing Census geocoder through one saved workspace, one merchant MCP owner and the original browser. The same source captures, match reviews, editions, publisher, SF82 releases and SF88 customer sessions remain available from both surfaces.

The [Census source guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/README.md) defines the official request, match, coordinate and provenance contracts. This guide connects that original application to the installed merchant and managed Applications interfaces.

## Prepare the existing workspace

Initialize a new private source workspace once, or keep the directory of the workspace you already use:

~~~sh
starforge dataset geocoder --workspace /absolute/private/census-operations init
~~~

Use canonical host paths. The connection JSON and input files must be owned private files; workspace, recording, buyer and export directories must be owned private directories. A reopened workspace retains its native UUID. Do not run the initializer over an existing workspace.

Create a private connection file such as /absolute/private/census-connection.json:

~~~json
{
  "schema": "stellar-forge.census-geocoder-workspace-connection.v1",
  "workspaces": {
    "addresses": {
      "label": "Address operations",
      "directory": "/absolute/private/census-operations",
      "imports": {
        "input": {
          "kind": "addresses",
          "label": "Reviewed address list",
          "file": "/absolute/private/input.csv",
          "header": false
        }
      },
      "merchants": {},
      "buyerWorkspaces": {},
      "runtime": {
        "port": 0
      }
    }
  }
}
~~~

The address file uses the original five-field CSV: ID, street, city, state and ZIP. The adapter reads that exact host file at batch creation; a large address list is not sent in an MCP argument. With header:true, the original source parser handles its header. Names in imports, merchants and buyerWorkspaces are host aliases used in subsequent calls.

A host with an existing native capture can add an import with kind:"recording" and directory pointing to that original captured-response directory. It must contain the complete capture.json, submitted/input files, original HTTP metadata and response bodies required by the native recording reader. Import validates those bytes and issues no provider request.

To build a paid edition, add a named merchant entry with label, origin, path and payment. The payment value is the complete original SF30 public payment object for that route. Copy the intended reviewed terms without translating the asset, network, recipient, atomic amount, timeout or optional payment fields. The original seller compiler validates it during edition creation. The status tool displays the full declared profile before it is selected. An edition created without a profile is usable for source review and query; a paid publisher draft requires an edition that includes its original seller.

To receive customer pages, add a buyerWorkspaces entry with label and the canonical directory of an already configured SF88 operator workspace. Follow the [native signer setup](../../stellar/scf-starforge-20261009/sf103-native-buyer-signer/README.md) and [operator buyer guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/README.md) for the existing account and approval workflow. The adapter uses that workspace by alias and does not accept private keys in tool arguments.

The optional runtime fields are port, facilitator and allowLocalFacilitator. Use the original HTTPS facilitator address, or explicitly enable an http://127.0.0.1 facilitator on the same host. These settings are passed to the original release stage. They do not alter the edition's public payment terms.

Initialize the merchant host once:

~~~sh
starforge merchant-mcp init-census-geocoder-workspaces \
  --dir /absolute/private/census-agent \
  --connection /absolute/private/census-connection.json \
  --name "Census address operations"
~~~

This creates the normal merchant-mcp.json, release store and customer export directory. An existing merchant configuration can instead add censusGeocoderWorkspaceConnection with the path to the same private connection file.

## Open the browser and agent together

Configure the selected MCP token environment variable in the existing host environment or private managed environment JSON. Keep its value out of command arguments.

~~~sh
starforge census-geocoder-agent inspect \
  --config /absolute/private/census-agent/merchant-mcp.json \
  --workspace addresses

starforge census-geocoder-agent serve \
  --config /absolute/private/census-agent/merchant-mcp.json \
  --workspace addresses \
  --port 0 --mcp-port 0 --token-env MCP_ACCESS_TOKEN
~~~

Inspection binds the exact merchant/connection files and the stable original geocoder workspace UUID. It does not open a publisher, browser or network request. Serve rechecks that binding, opens the original workspace once and prints one native startup JSON containing the actual private browser URL, authenticated MCP endpoint and original identity. The optional expected-binding-sha256 flag accepts the digest from inspection.

The original browser uses its private fragment token; the MCP endpoint uses the configured bearer token. Both operate the same in-memory workspace object. Use the browser's existing panels for discovery, batch capture, match selection, native query, publication and customer receiving. Every source or customer result remains in the same retained directory.

For an agent-only host, the ordinary merchant-mcp serve or merchant-mcp-stdio entrypoints expose these tools from the same configuration. A buyer run still needs the original operator terminal.

## Managed Applications

Choose **Census address operations** in the installed runtime's Applications screen. Select the merchant configuration and geocoder workspace alias, local browser port, MCP port and token environment name. The existing private environment file may supply credentials. The terminal Python executable defaults to /usr/bin/python3.

Review retains the exact merchant/connection bytes, installed launcher/configuration source and original workspace directory. Start verifies the binding again and records the actual browser/MCP listeners and stable workspace UUID. The standard Open, Output, terminal input, Stop and recovery controls apply.

This application uses the existing managed PTY. When SF88 requests purchase approval, review its original output and type the exact approval line into the saved application's terminal. The adapter does not supply approval or retry a payment automatically.

Applications prevents a second managed launch of the same merchant configuration. The native geocoder writer lease also prevents another source owner from opening its directory. Closing only the borrowed browser leaves the MCP-owned workspace available. Stopping the application drains the original publisher and customer work and closes both listeners. A later reviewed start reopens the retained source, edition and customer IDs.

The [managed Applications guide](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/APPLICATIONS.md) covers the same review/save/start/stop commands for CLI operators.

The existing `census-geocoder-mcp` contribution declares the source-owned [Census application provider](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/providers/census-geocoder.mjs). It delegates catalog, preparation, shared merchant-configuration ownership and startup observation to this same native workflow. The [provider guide](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/APPLICATION_PROVIDERS.md) explains how the maintained distribution retains those original bytes. After receiving a release with this contribution, reopen the original Applications host and review its current source before starting the saved application.

## Complete source-to-customer workflow

All calls below are MCP tool calls. Every payload uses workspace:"addresses". Keep the original returned IDs and digests; placeholders in the examples mean those returned values.

1. Call merchant_census_geocoder_status with {} to inspect the declared inputs, full public merchant profiles and buyer aliases. Call merchant_census_geocoder_open with {"workspace":"addresses"}. Retain instanceId and native.id. Repeating open in the same process returns that original owner.

2. For a new provider capture, call merchant_census_geocoder_discovery with action:"benchmarks". Select a returned benchmark ID. For geography requests, call action:"vintages" with payload containing its discoveryId and benchmark. Use the actual retained metadata rather than assuming a current benchmark/vintage.

3. Call merchant_census_geocoder_batch with action:"create" and payload containing sourceImport, label, discoveryId, benchmark, returnType, and the original vintage/vintagesId when the chosen return type requires them. The native parser retains the original and submitted CSV bytes before any HTTP request. Capture with action:"capture", payload:{"batchId":"RETURNED_BATCH_UUID"}. Inspect that exact batch and its retained attempt after the response.

4. To adopt a previously captured official response instead, call merchant_census_geocoder_import with sourceImport naming the recording. The native import validates its original HTTP identities and hashes and returns the retained batch/attempt. Reusing the same successful recording preserves its import identity.

5. Use merchant_census_geocoder_batch action:"inspect" with payload containing id, attemptId, status, offset and limit. Native statuses are all, Match, No_Match, Tie, Exact and Non_Exact. Inspect match counts and rows before selecting an edition. The response identifies the exact responseSha256.

6. Call merchant_census_geocoder_review with batchId, attemptId, responseSha256 and the explicit plan. The native plan supports name, columns, statuses, matchTypes, excludedIds, filters, ranges, sorts, defaultLimit, maxLimit and note. record_id and match_status remain required. The same response cannot silently substitute a different attempt.

7. Call merchant_census_geocoder_edition with reviewId and the named merchant profile when publishing. Retain its original edition ID. The same review and terms return the retained edition. Query it with merchant_census_geocoder_query using id and the original URL query string. The native dataset owns projections, typed filters, sorting and cursor behavior.

8. Call merchant_census_geocoder_publisher with action:"publisher.prepareEdition", payload:{"id":"EDITION_UUID"}. This opens the workspace's original publisher and prepares the exact edition directory. Retain the native draft ID and snapshot. Preview the selected draft, then stage its SF82 release with the exact draftId, a release id and label. The original stage uses this host's configured runtime.

9. Inspect and activate that release using its current generation, then start the selected generation. For the first edition, the original prepare step establishes the initial retained dataset version. The listener must be running before live publication review. Call publisher.reviewDraft and publisher.publish with the exact draftId, expectedSnapshot and expectedRevision from the current original publisher state. Later editions use the same retained publication compare-and-swap.

10. Review the actual merchant offer with publisher.buyer.review. Prepare the selected acceptance using publisher.buyer.prepare and its original review, intentId, acceptIndex and offerSha256. Read the returned buyer-config file for the actual request and terms. Create publisher.buyer.session using the retained buyerId, declared buyerWorkspace and explicit maxPages/maxTotalAtomic/maxRows/maxPageBytes.

11. Run publisher.buyer.run with that original session ID. Use the existing SF88 terminal review and approval. Read the retained run result; use buyer.recover, buyer.account and buyer.export against the SAME session. An uncertain or paid attempt is reconciled through those original APIs. An explicit unpaid continuation requires the original retryUnpaid and expectedAttemptSha256 fields.

12. Export the complete edition and original customer files, close the workspace with its current instanceId, then reopen the same directory. Verify the original batch, review, edition, draft, generation and buyer session remain selected. No successful source capture or purchase is repeated by reopening.

The publisher tool returns the original publisher result envelope inside its result field, together with the updated geocoder state. In particular, the native publisher's own {result,state} is preserved. Source actions similarly retain their original return values. Read these actual envelopes instead of substituting guessed IDs.

## Tool reference

| Tool suffix after merchant_census_geocoder_ | Original operation |
| --- | --- |
| status | Declared inputs and public profiles, or paginated retained history |
| open | Open or explicitly initialize the original source workspace |
| close | Close the current instance after draining owned work |
| discovery | Actual benchmark/vintage HTTP capture |
| batch | Exact CSV intake, capture, match inspection and attempt history |
| import | Validate and adopt a complete original recording |
| review | Save response-bound match and column decisions |
| edition | Create or reuse the original typed edition and seller |
| query | Original dataset query, projection and cursor |
| export | Complete native edition export and reopen validation |
| file | Retained chunks from source, edition or buyer files |
| file_release | Release an unfinished retained file snapshot |
| publisher | Existing draft, release, buyer and accounting actions |
| cancel | Cancel the actual Census metadata/batch request |
| browser | Open or close the borrowed original browser |

History uses offset/limit and returns totals and nextOffset for each source collection. The default page has 50 records and the maximum is 100. Batch summaries include the latest 20 attempts and an explicit attemptsTotal; use batch action:"history" for the remaining original attempt records. Match inspection retains the native maximum of 250 rows per page.

Publisher action values are the original fully qualified names:

| Action | Payload fields |
| --- | --- |
| publisher.open / publisher.status / publisher.collect | None |
| publisher.prepareEdition | id |
| publisher.preview | target, query |
| publisher.reviewDraft / publisher.publish | draftId, expectedSnapshot, expectedRevision |
| publisher.activateSnapshot | snapshot, expectedSnapshot, expectedRevision |
| publisher.release.stage | draftId, id, label |
| publisher.release.inspect | id |
| publisher.release.activate | id, expectedGeneration |
| publisher.release.rollback / publisher.release.start | expectedGeneration |
| publisher.release.stop | None |
| publisher.buyer.review | snapshot, query |
| publisher.buyer.prepare | review, intentId, acceptIndex, offerSha256 |
| publisher.buyer.session | buyerId, buyerWorkspace, maxPages, maxTotalAtomic, maxRows, maxPageBytes |
| publisher.buyer.run | id, retryUnpaid, expectedAttemptSha256 |
| publisher.buyer.recover / publisher.buyer.account / publisher.buyer.export | id |

The native operation decides which optional fields are applicable. Undeclared fields and host-path substitutions are rejected by the adapter.

## Receive a complete edition

The recipient command receives the entire original edition through the existing authenticated merchant file calls. It writes the exact edition.json, dataset.csv, dataset.json, review, provenance, submitted/input CSV, actual Census response and HTTP metadata, the retained discovery/capture records, and seller.json when that edition has merchant terms. Native strings such as geography codes remain unchanged. No new export is generated on the source host.

Keep the original Census application open. Use its actual MCP URL and token environment, the declared workspace alias, and the edition UUID returned by the existing workspace. Inspect first to read the original workspace UUID, dataset snapshot, complete member list and manifest SHA-256:

~~~sh
starforge census-geocoder-download inspect \
  --url MCP_URL --workspace addresses --edition EDITION_UUID
~~~

Receive the reviewed edition using those returned identities:

~~~sh
starforge census-geocoder-download download \
  --url MCP_URL --workspace addresses --edition EDITION_UUID \
  --workspace-id WORKSPACE_UUID --manifest-sha256 MANIFEST_SHA256 \
  --out /absolute/private/received-edition
~~~

The default token variable is MCP_ACCESS_TOKEN; --token-env selects the existing host variable. Credentials remain outside command values. The source selection must refer to a complete edition in the currently open original workspace. Inspection pages the actual retained edition history, so an older edition remains selectable after the first hundred records.

The receiver delegates private directory ownership, nested files, complete file hashes and durable partial prefixes to the maintained retained-download engine. Each invocation reads the same original manifest. Its checkpoint is bound to the original workspace UUID, alias, edition UUID, review, operation and dataset snapshot. A later MCP process or port can serve the same retained workspace without invalidating that checkpoint. A different workspace, edition, manifest or member digest is rejected before it is mixed into the saved download.

After an interruption, run the same download command with the same directory and reviewed identities. Use the current actual MCP URL if the original application has reopened. Completed members are checked and reused; partial members continue after the original verified byte prefix. --chunk-bytes may select a value from 1 to 196608. Progress goes to stderr and the complete result goes to stdout. SIGINT and SIGTERM retain the partial directory for this same continuation.

Reopen and query the received edition locally:

~~~sh
starforge census-geocoder-download reopen \
  --dir /absolute/private/received-edition \
  --workspace-id WORKSPACE_UUID --edition EDITION_UUID \
  --manifest-sha256 MANIFEST_SHA256

starforge census-geocoder-download query \
  --dir /absolute/private/received-edition \
  --query 'fields=record_id,match_status&limit=25'
~~~

Reopen retains the existing receiving lease while it checks the original checkpoint, exact manifest and every member, then calls the native reopenEdition implementation. Query uses that same completed selection and original dataset handler. Its response preserves the native typed fields, filters, ordering, snapshot and cursor. A native query error is returned with its original status/body and makes the CLI exit unsuccessfully. Both local commands work without a merchant connection or token.

The received directory is also a normal portable Census edition. The existing command remains available:

~~~sh
starforge dataset geocoder reopen --directory /absolute/private/received-edition
~~~

### Typed client

The existing Census contribution exports the client as ./merchant/mcp/census-geocoder/download with its paired TypeScript declaration. It provides inspectCensusGeocoderEdition, downloadCensusGeocoderEdition, reopenCensusGeocoderDownload and queryCensusGeocoderDownload. From the installed distribution root:

~~~js
import {
  inspectCensusGeocoderEdition,
  downloadCensusGeocoderEdition,
  queryCensusGeocoderDownload,
} from './source/stellar-forge/mcp-merchant-operator/census-geocoder-download.mjs';

const remote = {
  url: process.env.CENSUS_MCP_URL,
  workspace: 'addresses',
  editionId: process.env.CENSUS_EDITION_ID,
};
const inspected = await inspectCensusGeocoderEdition(remote);
const received = await downloadCensusGeocoderEdition({
  ...remote,
  directory: '/absolute/private/received-edition',
  expectedWorkspaceId: inspected.workspaceId,
  expectedManifestSha256: inspected.manifestSha256,
  onProgress: value => process.stderr.write(JSON.stringify(value) + '\n'),
});
const page = await queryCensusGeocoderDownload({
  directory: received.directory,
  expectedWorkspaceId: inspected.workspaceId,
  expectedEditionId: inspected.editionId,
  expectedManifestSha256: inspected.manifestSha256,
  query: 'fields=record_id,match_status&limit=25',
});
console.log(page.response);
~~~

Remote SDK calls also accept the original embedded native file client through client:{endpoint,call}, in place of url. They use the same existing merchant tool names and authenticated/native results. AbortSignal and async progress callbacks retain the shared engine's ordinary partial-file behavior. Applications continues to own the source workspace; receiving releases its retained file reads and local directory lease.

The native limits remain explicit: a four-MiB edition manifest, at most 512 members, and 64MiB per original member. The SDK preserves the same required files and seller selection. The original native validator remains authoritative for the received dataset and provenance.

## Receiving and recovery

merchant_census_geocoder_export writes the complete native edition under the merchant's existing customer export root. Its original edition.json enumerates all dataset, schema, review, seller and source files with sizes and digests. The original reopen command validates the received directory:

~~~sh
starforge dataset geocoder reopen --directory /absolute/private/received-edition
~~~

For remote file receiving, call merchant_census_geocoder_file with kind:"edition-file", the edition UUID and an exact filename from that manifest; edition.json itself is also available. Continue each file with its returned readId, expectedSha256 and nextOffset. The original retained-file protocol verifies the copied snapshot and releases it at EOF. Keep the returned byte size and digest when writing the received file; explicitly release an unfinished read with file_release.

The same file tool exposes input and response by batch UUID, dataset/provenance/seller/manifest by edition UUID, and draft-csv, draft-review, buyer-config, session-manifest, session-csv, session-jsonl and session-review using the original publisher record UUID. Complete customer accounting and export remain in the original buyer session.

Source cancellation is restricted to the actual metadata or batch capture. Shutdown cancels those source requests, retains their original attempt/response state, and drains already accepted publication, buyer and file operations. It does not kill a payment worker or retry it. A request accepted before shutdown but not yet sent is cancelled before dispatch.

If shutdown reports an incomplete native close, the original seller handle and workspace writer lease remain owned. Status retains that process instance and the close error. Retry merchant_census_geocoder_close with the same workspace and instanceId, or retry close() on the same embedded owner. New source, publisher and buyer operations remain closed to admission until disposal succeeds. Reopen the writer only after the completed close.

A completed native capture is reused on an ordinary capture call. retry:true is accepted only for an incomplete original capture, after the operator reviews its state. Retained response bytes and HTTP identity are reconciled by the original workspace when reopened. An existing paid or uncertain buyer attempt uses the original SF88 recovery path.

Public exports are ./merchant/mcp/census-geocoder and ./merchant/mcp/census-geocoder/server. The maintained distribution includes these source modules and the existing Census browser assets; it uses the same cumulative package and installed runtime.

## Customer CSV intake and joined result receiving

The same managed application and MCP workspace now accept an original business CSV with arbitrary customer columns. Add a host import such as:

~~~json
{
  "kind":"customer-addresses",
  "label":"Customer locations",
  "file":"/absolute/private/customer-locations.csv",
  "header":true
}
~~~

Declare it under the existing workspaces.ALIASES.imports map. header defaults to true for customer-addresses; the existing addresses kind keeps its original false default. The adapter reads the owned host file with its exact UTF-8 bytes, including a BOM if present. It accepts neither an arbitrary input path nor signing material in a tool call.

Use merchant_census_geocoder_customer with this action sequence:

| Action | Payload and result |
| --- | --- |
| source | sourceImport and optional label; retains the complete original customer file and returns sourceId as result.id |
| preview | sourceId, explicit plan, optional offset/limit/filter; returns the current reviewSha256, row exceptions and ready summary |
| mapping | Same sourceId/plan plus expectedReviewSha256; retains a READY or REVIEW_REQUIRED immutable mapping |
| inspect | mappingId, or sourceId alone; mapping row results are paginated; full mapping JSON remains available through file reads |
| batch | mappingId, expectedReviewSha256, label and the original discovery/benchmark/vintage selection; returns the original native batch and binding |
| bind | mappingId, expectedReviewSha256 and batchId; attaches only identical already-submitted ordered addresses, without another Census request |

The complete plan and CLI examples are in the native Census guide's **Customer CSV mapping and result delivery** section. Plan columns are zero-based original column positions. Decision row numbers are one-based original data records. IDs can come from an explicit source column or stable row-000001 values. All unselected customer fields and duplicated business IDs remain in the original source; row corrections and exclusions require visible reasons.

The native parser reports address exceptions. No invalid or duplicated row is automatically discarded. Preview responses have bounded rows/cell text and next offsets; original source and full mapping are available through merchant_census_geocoder_file kinds customer-input, customer-mapping and customer-submitted. These use source UUID, mapping UUID and mapping UUID respectively. Existing retained readId, expectedSha256, offset and file_release semantics remain unchanged.

After the original completed capture and match review, pass mappingId to merchant_census_geocoder_edition with the original reviewId and optional public merchant profile. The mapping must already be bound to that review's exact batch. The edition contains all original customer rows, exact mapping/binding files, and joined CSV/JSON results. EXCLUDED input rows retain null provider results, and the original match-review selection is a separate flag. The public native dataset and its payment terms still use the original reviewed geocoder columns.

Receive the complete joined edition through the already maintained receiver:

~~~sh
starforge census-geocoder-download inspect \
  --url http://127.0.0.1:PORT/mcp --workspace addresses --edition EDITION_UUID
starforge census-geocoder-download download \
  --url http://127.0.0.1:PORT/mcp --workspace addresses --edition EDITION_UUID \
  --manifest-sha256 EXACT_INSPECTED_SHA256 --out /absolute/private/customer-edition
starforge census-geocoder-download reopen --dir /absolute/private/customer-edition
starforge census-geocoder-download query --dir /absolute/private/customer-edition --query 'limit=10'
~~~

Use the original configured MCP token environment variable. The receiver already retains every declared edition member, so customer-input.csv, customer-mapping.json, customer-binding.json and customer-results.csv/json follow the same partial-prefix recovery and exact native reopen. Query uses the original dataset handler; the full customer join is in the received CSV/JSON files. No source request, publication or payment is repeated by downloading.

The native browser's **Customer CSV mapping** panel acts on this same workspace. The existing managed application configuration, original PTY approval, writer lease, browser ownership and shutdown retry behavior are unchanged. Operators can retain a mapping through MCP, reopen it in the browser, finish the native batch/review/merchant workflow, and receive the same customer edition locally.

