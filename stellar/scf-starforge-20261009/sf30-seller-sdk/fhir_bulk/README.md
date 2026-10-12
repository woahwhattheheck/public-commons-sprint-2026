# FHIR Bulk Data source and customer workbench

Open a selected FHIR provider, retain its complete original export, review resource fields, build the original SF30 dataset, and deliver both customer data and an editable workspace. The same private workspace is used by the browser and command line.

The workbench supports the published [HL7 Bulk Data STU2](https://hl7.org/fhir/uv/bulkdata/STU2/export.html) and [STU3](https://hl7.org/fhir/uv/bulkdata/STU3/en/export.html) contracts. Source parsing and receiving use Python 3.10 or newer. The native dataset, merchant, buyer and optional SMART assertion signer use Node.js 22 or newer. The ordinary browser, public source, projection and challenge service need no new Python or npm packages. The optional payment service uses the existing official x402 dependency installation.

## Open the operator

From the original SF30 SDK directory:

```sh
node dataset-cli.mjs fhir-bulk serve --workspace /absolute/private/fhir-workspace
```

The startup record contains a private loopback URL. Open that complete link in the browser. Its original capability token remains in the URL fragment and local authorization header. A second CLI process must wait until this workspace's server closes; the maintained workspace has one native owner lease.

An installed SDK uses the same dataset dispatcher:

```sh
starforge dataset fhir-bulk serve --workspace /absolute/private/fhir-workspace
```

The operator provides Connections, Exports, Sources, Mapping, Query, Compare and Delivery. Start with the published SMART source profile or a selected authorized provider. The source classification, publisher and reference URL stay with every retained source and its merchant lineage.

The full rendered workflow and complete browser receiving command are in [BROWSER_RECEIVING.md](BROWSER_RECEIVING.md). Integrators can use [HTTP_API.md](HTTP_API.md) for every request, response and original method.

## Select the complete native request

Create a connection, then retain its actual CapabilityStatement, SMART discovery and original Group pages. Group selection uses the returned literal identifier. System, all-patient and selected-Group export scopes remain distinct.

Save the entire export definition before starting it. The definition retains:

- Explicit resource types, or the provider's full selected authorized scope when the type list is empty.
- Original modification bounds, root element selection and complete resource-type filters.
- Selected associated data and, for POST requests, explicit Patient references.
- Strict or deliberately selected lenient handling.
- Selected STU3 organized output, partial manifests and separate export-status preference.
- Source, file-count and original-line byte budgets.

No clinical filter or patient reduction is added. A modification bound describes the provider's resource modification clock. Clinical dates inside an Observation remain original resource fields. Repeated filters for one resource type preserve the native request's OR behavior.

The operator displays the generated method, complete URL, headers and optional FHIR Parameters body. Connection credentials are supplied separately at process startup.

### Local authentication profiles

Start a server or CLI command with a selected absolute private profile file:

```sh
node dataset-cli.mjs fhir-bulk serve \
  --workspace /absolute/private/fhir-workspace \
  --credentials-file /absolute/private/fhir-credentials.json
```

A profile file is an owner-readable regular file, mode 0600 on POSIX. It uses this shape:

```json
{
  "schema": "stellar-forge.fhir-bulk-credentials.v1",
  "profiles": {
    "registered-provider": {
      "type": "bearer",
      "origins": ["https://selected-provider.example"],
      "token": "EXISTING_AUTHORIZED_ACCESS_TOKEN"
    }
  }
}
```

SMART Backend Services profiles instead contain `type: "smart_backend"`, explicit `origins`, `clientId`, `tokenEndpoint`, the registered `privateJwk`, `kid`, `algorithm: "RS384"` or `"ES384"`, and the selected `scope`. An optional registered `jwksUrl` can accompany the assertion. The signer creates the original asymmetric client assertion, exchanges it at the selected endpoint and retains the short-lived token only in process memory. Its standard contract is documented by [SMART Backend Services](https://hl7.org/fhir/smart-app-launch/STU2.2/backend-services.html) and [asymmetric client authentication](https://hl7.org/fhir/smart-app-launch/STU2.2/client-confidential-asymmetric.html).

The public profile list contains names, types and reviewed origins. A source ZIP or workspace ZIP carries the profile reference; the receiving host supplies its own authorized private file. An output file with `requiresAccessToken: false` receives no profile authorization. An authenticated redirect must remain within the reviewed origins.

## Run and recover the same operation

Choose and retain the operation UUID before the first request. The browser does this before POST and retains the exact pending request through reload. CLI callers pass the same original UUID each time:

```sh
node dataset-cli.mjs fhir-bulk run \
  --workspace /absolute/private/fhir-workspace \
  --export ORIGINAL_SAVED_EXPORT_ID \
  --operation ORIGINAL_OPERATION_UUID
```

`run` follows the provider's next permitted poll and receives all advertised output, error and deletion files. Its default continuation window is one hour; `--max-wait-seconds` sets an explicit operating window. `advance` performs one exact next step. Both emit the complete retained operation; exit 75 means it can be reopened and continued. Progress is written separately to stderr.

Every native HTTP step records its request identity, response metadata and exact wire bytes before changing operation state. Complete files are reused. A partial file can continue only from its original offset with the accepted validator and encoding; an incompatible full response starts a new complete attempt. Native Retry-After values and polling backoff are retained.

If the initial request's Content-Location is lost, reopen the original operation and receive the actual provider status URL with a reason. The operator continues that same saved request. The CLI command is:

```sh
node dataset-cli.mjs fhir-bulk adopt-status \
  --workspace /absolute/private/fhir-workspace \
  --operation ORIGINAL_OPERATION_UUID \
  --status-url https://selected-provider.example/original-status-location \
  --reason "Received the original job location from the provider's retained request"
```

Pausing automatic browser progress retains the provider job. The explicit Cancel control is a separate saved native DELETE request with its own UUID.

## Review original FHIR resources

The Sources desk retains the completed manifest chain, output/error/deleted files, original protocol responses and the complete source ZIP. Open a resource to see its exact original NDJSON line, including its line ending. The original file plus one-based physical line identifies the occurrence. Resource type, logical ID, version, references, original outcomes and delete instructions are shown separately.

FHIR numeric tokens stay exact. Nested objects, empty property names, arrays, missing fields and explicit nulls remain distinguishable. Narrative HTML is displayed as source text.

STU3 organized output retains the Parameters headers, their group references and continuation relationships. Source inventory distinguishes these headers from the exported resources. OperationOutcome severity/code/diagnostics and transaction-Bundle DELETE entries remain original records. A completed export can include provider outcomes; inspect those retained files with the selected resources.

Use Source members to retrieve any exact file, or export the full source ZIP. The native intake accepts that complete packet so its request, manifests, classifications and original byte identities travel with the resources.

## Build a reviewed native dataset

Select one original resource type and create the editable default mapping. The default columns preserve resource type/ID, optional version and modification value, the original record identity and the full resource JSON. Source identities are used as keys only when the complete selected source has nonempty, unique IDs.

Each column explicitly chooses an original object-key path, array index or `*` selection, a multiplicity policy, encoding, type, nullability and missing-value behavior. JSON-cell encoding preserves the original lexical values. Conversion to a native number or integer is a separate reviewed choice and must fit the original SF30 type contract.

Preview the projection, save the full mapping, and build. The existing XML SourceFormat host invokes the original SF30 native engine; this workbench supplies the FHIR parser and projection callbacks. Every saved build retains the source ID, mapping ID, exact CSV/config bytes, complete column review and native snapshot.

Query uses the original scalar URL parameters:

- `fields` selects declared output columns.
- `where_COLUMN` uses exact equality on an enabled filter.
- `gt_`, `gte_`, `lt_` and `lte_` use explicitly enabled ranges.
- `sort` selects one enabled column, optionally with a leading minus.
- `limit` and the unchanged `page.nextCursor` receive the next native page.

The cursor belongs to the exact native snapshot, field selection, filters and ordering. The browser saves its complete query result for receiving.

## Compare and compose source editions

A comparison requires the same reviewed mapping and its complete key. It compares every mapped cell. Including a capture-specific record identity makes provenance changes visible; omit that column through the mapping controls when the intended comparison is resource-value changes. Full original file/line custody remains in the source packet and Sources desk.

A complete initial export can be composed with a reviewed ordered sequence of modification exports from the same native scope. The workbench verifies the selected resource/filter scope and continuous modification coverage, applies actual resources as upserts and applies explicit unambiguous native DELETE instructions. It retains every original capture unchanged.

Conflicting occurrences of the same logical resource require an explicit source/file/line selection. Composition does not infer deletion from absence, patient membership history or a changed selected Group. The original full export, every individual delta and the resulting retained resource state stay separately available.

## Merchant and customer receiving

Delivery has three distinct artifacts.

| Artifact | Content and receiving |
|---|---|
| Merchant dataset | `data.csv`, `dataset.json`, `fhir-bulk-lineage.json`; exact native files, reviewed scope/mapping family, source classification and composition lineage |
| Dataset packet | The original six-member source-backed customer ZIP; complete source, mapping and review, rebuilt through the original native engine |
| Editable workspace | All original connections, discoveries, Groups, exports, operation results, sources, mappings, builds, comparisons and compositions; original files and complete editable receiving |

The merchant adapter uses the existing SF30 seller compiler, dataset version store and native control channel. Prepare a release from the exported merchant directory and the operator's selected public payment terms:

```sh
node dataset-cli.mjs fhir-bulk merchant --help
node dataset-cli.mjs fhir-bulk customer --help
```

The merchant command exposes preparation, inspect, serve, status, publish, activate and collect. Publication uses the current native snapshot and revision guard, preserving the same original family, resource route and terms.

The customer command reads the original live seller offer and prepares the original SF88 configuration for the selected snapshot and first-page query. It preserves the offer/config identity and reopens the exact saved file. Subsequent buyer init/run/recover/export/deliver/accounting/finalize commands use the original SF88 dataset workflow. Each customer's normal operator policy, account and signer configuration remains in that maintained workflow.

### Receive a complete dataset

```sh
node dataset-cli.mjs fhir-bulk packet-import \
  --workspace /absolute/private/received-dataset \
  --file /absolute/source-backed-dataset.zip
```

The original parser and native engine reconstruct the dataset, then compare the declared CSV/config/snapshot identities. Open this same workspace with `serve` to inspect or query it.

### Receive a complete editable workspace

```sh
node dataset-cli.mjs fhir-bulk workspace-import \
  --workspace /absolute/private/received-workspace \
  --file /absolute/editable-workspace.zip
```

The receiver first validates every archive member and the complete reference graph. It reconstructs native sources, mappings, builds and comparisons, retains original operation files and records completed receiving steps. Reopen the same receiving directory and pass the identical archive after interruption. A different archive cannot take over an incomplete receiving operation.

Receiving does not copy executable SQLite schema from an archive. Source indexes and native datasets are reconstructed through the installed original implementation. Credentials, runtime tokens, caches and locks stay outside the transferable workspace content.

## Operate the full unchanged public source

The [SMART Bulk Data server](https://github.com/smart-on-fhir/bulk-data-server) publishes the original sample endpoint and Synthea data description. The operating driver retains that publisher classification and obtains the current original Group list. Unless a literal `--group-id` is supplied, it explicitly selects the populated person Group with the smallest published quantity and then its literal ID; it records the complete selection and receives all Patient and Observation resources requested for that Group.

```sh
python3 /absolute/sf30-seller-sdk/fhir_bulk/operate_receiving.py \
  --source-root /absolute/sf30-seller-sdk \
  --workspace /absolute/private/smart-fhir-workspace \
  --output /absolute/private/smart-fhir-receiving
```

The driver performs native discovery, full export, a subsequent modification export, retained-resource composition, reviewed Patient projection, all native query pages, keyed comparison, original seller/402/SF88 preparation, version publication, source-backed customer receiving and whole editable workspace receiving/reopen. Its native compared mapping omits capture-specific record_id and retains the complete resource JSON. The local seller uses the original SDK example's declared onboarding terms, which are included in the receiving result.

`OPERATED_FHIR_BULK.json` contains the actual selected connection/Group, original operation/source IDs, native mapping/build/comparison IDs, merchant/customer directories, both transferable packets, source identities and complete receiving outcomes. The driver also retains `RECEIVING_JOURNEY.json` before each native phase. Continue the same command, workspace and output after interruption. Its output directory has its own native process lease.

The browser driver opens that same completed workspace and exercises the full rendered operating path:

```sh
node /absolute/sf30-seller-sdk/fhir_bulk/operate_browser.mjs \
  --receiving /absolute/private/smart-fhir-receiving/OPERATED_FHIR_BULK.json \
  --out /absolute/private/smart-fhir-browser \
  --source /absolute/sf30-seller-sdk/fhir_bulk
```

Use an existing Playwright installation and installed Chromium. Its full invocation, optional runtime overrides and receiving output are documented in [BROWSER_RECEIVING.md](BROWSER_RECEIVING.md). The native operation closes its workspace before browser receiving starts.

## Command reference

Every command accepts `--workspace ABSOLUTE_DIRECTORY` before or after the command. Use `--help` for its exact flags. JSON input commands accept an absolute `--file` path or `-` for stdin.

| Area | Commands |
|---|---|
| Workspace and provider | init, state, catalogue, auth-profiles, connection-save, connection, discover, discovery, groups, group-page |
| Native exports | export-save, export, advance, run, operation, adopt-status, cancel |
| Exact originals | source-add, source, source-members, source-rows, source-row, source-packet, source-member |
| Reviewed native data | mapping, preview, plan-save, plan, build, build-review, query |
| Observed editions | compare, changes, changes-export, compose |
| Complete delivery | dataset-export, packet-export, packet-import, workspace-export, workspace-import, serve |
| Existing commercial runtime | merchant, customer |

## Source and license

This extension and the maintained SF30/SF88 composition use the repository's MIT license. The unchanged SMART sample server identifies Boston Children's Hospital's Apache 2.0 license in its [original license file](https://github.com/smart-on-fhir/bulk-data-server/blob/master/LICENSE). Its sample resources remain classified with their publisher and original endpoint in each capture.

Protocol design references are the linked permanent HL7 Bulk Data and SMART publications. `SOURCE_INDEX.json` identifies those sources and the original native module pins used for this implementation. Exact operating results identify their own complete source file bytes.

## Receive preserved files for the original accepted export

A complete original source packet can finish its existing accepted operation when
the files were preserved through another authorized receiving surface. Retain
the original provider manifest chain, exact NDJSON bytes, original request and
status URLs, and actual file-custody records in the source packet. The ordinary
`source-add` command validates the complete source and returns its content ID.

```sh
starforge fhir-bulk source-add --workspace /absolute/fhir-workspace --file /absolute/original-capture.zip
starforge fhir-bulk receive-capture --workspace /absolute/fhir-workspace --operation ORIGINAL_OPERATION_ID --source ORIGINAL_SOURCE_ID --reason 'Receive the preserved complete original export files'
starforge fhir-bulk operation --workspace /absolute/fhir-workspace --id ORIGINAL_OPERATION_ID
```

Use the returned original IDs. This receiving action checks the accepted provider
job, exact connection and export definition, full manifest chain, all original
file identities, and the reviewed byte budget. It preserves earlier HTTP receipts
and any prior failure while recording the actual retained-file receiving. The
native operation becomes complete with the same operation ID and exact source ID;
its ordinary `run` then reopens that completion. The complete editable workspace
archive includes this operation, every source member, and its receiving history.

The HTTP equivalent is `POST /api/operations/:id/receive-capture` with
`{"sourceId":"ORIGINAL_SOURCE_ID","reason":"Reviewed receiving reason"}`.
The response is the original operation object. `captureReceivings` identifies the
retained source, source manifest hashes, original file byte counts and receiving
time. Files identify their exact source packet members through
`retainedSource: {sourceId, member}`.

Whole-workspace `state.receives` also exposes each saved `workspaceId` alongside
its `archiveSha256`. A connected receiver uses that native association to
reconcile a workspace import whose final response was interrupted.
