# NocoDB source workspace

This is the local operating application for turning a real NocoDB table or view into a reviewed, reusable data source. The operator selects actual native fields, captures their complete original responses, checks every row, saves a reviewed source version, and hands that version to the existing Stellar Forge publisher. Published editions, buyers and merchant releases continue through their original applications.

The workspace supplies both a browser and an equivalent CLI. It keeps its source data and operating state private on the host. The browser receives a connection alias and its readiness; the NocoDB token stays in the host environment.

## Product workflow

1. Open an existing source workspace, or initialize one with a private dataset destination.
2. Choose a host-declared read connection and inspect the real base/table metadata. Alternatively, import an existing complete source packet.
3. Choose actual scalar field IDs, explicit output types and a stable provider order containing every native identity field.
4. Request one complete original capture. The original reader retains the opening metadata and count, all consecutive pages, and the closing count and metadata.
5. Review actual value counts and samples. Save the exact projection as a draft, then validate every row through the original source reader.
6. Record a reviewer and change note. Freeze and select the reviewed source version.
7. Open the original publisher to prepare and review its public dataset, publish an edition and use the existing buyer/MCP workflows.
8. Review the exact published run against its original merchant terms, prepare its deployment package and operate it through the original SF82 release console.

Selecting a source version changes the input for a future publisher plan. Existing plans, candidates, publications, buyer pins and release history keep the source they already retained.

The source files are implemented here. Their actual provider/browser/publication acceptance is supplied by the single joined NocoDB native consumer on the receiving host; the presence of this guide is not a runtime result.

## Install and launch

Use Node 24 with its built-in SQLite module, Linux and util-linux `flock`. This component is part of the complete Stellar Forge source distribution. Keep the original publisher, dataset, SF82 and other relative-import dependencies with it. Copying only the `workspace/` directory is insufficient.

From the complete source root:

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs --help
~~~

Initialize a private workspace:

~~~bash
mkdir -m 700 /absolute/private/nocodb
node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs init \
  --directory /absolute/private/nocodb/film-source
~~~

The default dataset destination is `film-source/dataset`. To use another original host-local dataset destination, supply `--target /absolute/private/datasets/film` at initialization. The destination cannot overlap the source workspace except for that default dataset directory. It becomes an immutable workspace setting.

Open the browser:

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs serve \
  --directory /absolute/private/nocodb/film-source \
  --connections /absolute/private/nocodb/connections.json \
  --port 8461
~~~

Open the complete private URL printed by the process. The token is in its fragment, is removed from the displayed address after load and is used only for this local process. The server binds `127.0.0.1`; it checks the exact host/origin and rejects cross-site requests. Close the process normally with SIGINT or SIGTERM when finished. It drains its own pending work and closes its own publisher and release consoles before releasing the original kernel lock.

Only one owning source process can open a workspace at once. Additional browser tabs use that same process. A CLI command requiring the source lock should run after its browser process closes.

Initialization records `INIT.json` before creating the SQLite state. Repeating initialization with the same retained directory/dataset binding completes an interrupted original initialization without resetting saved work. An existing unrelated directory or a changed dataset binding is refused. A normal reopen uses `serve` without `--create`.

## Private read connections

Create a mode-0600 JSON file in a private directory. The example below shows a reference to an existing read token; it contains no token value.

~~~json
{
  "operations": {
    "label": "Operations NocoDB",
    "server": "https://nocodb.example",
    "tokenEnv": "NOCODB_READ_TOKEN",
    "pageSize": 100,
    "maxRows": 1000000,
    "maxPages": 10000,
    "maxCaptureBytes": 67108864,
    "timeoutMs": 300000,
    "requestIntervalMs": 250
  }
}
~~~

The existing authorized host launcher supplies `NOCODB_READ_TOKEN` in the environment. Do not put its value in the JSON file, a URL, a saved draft, a request argument, the browser or a published source package. The browser displays only the alias, label, fixed server and whether the referenced environment value is present. Presence does not imply successful authentication; the original metadata/capture response provides that result.

The fixed server may include the deployment's existing reverse-proxy path. URL credentials, query strings and fragments are rejected. HTTPS is the normal connection. A loopback HTTP instance is supported; an existing non-loopback private HTTP host requires the explicit `allowHttp: true` setting in this private host file.

All original limits remain enforced:

| Setting | Supported values |
| --- | --- |
| Page size | 1–1,000 |
| Maximum response page | 1 KiB–16 MiB |
| Maximum retained provider bytes | 1 KiB–256 MiB |
| Maximum pages | 1–10,000 |
| Maximum rows | 1–1,000,000 |
| Overall capture timeout | 100 ms–1 hour |
| Interval between provider requests | 200–30,000 ms |

The normal defaults come from the original NocoDB declaration. The workspace does not add a parallel HTTP client, an automatic retry loop or a token-refresh mechanism. Expired scope, authentication, provider plan, request limits and rate responses remain distinct retained errors. A provider request ID and Retry-After, when returned, remain available in the original capture failure record.

## Discover and capture a live source

In **Capture source**, select the declared connection, enter the actual base and table IDs, and optionally enter the actual view ID and exact provider filter. **Inspect actual metadata** requests only that table's metadata using the original reader. No row order is invented for discovery. The empty order is accepted only for this metadata operation; every capture and source selection still requires real, nonempty stable order.

The metadata result shows the actual field IDs and provider types. Choose the fields to capture and their aliases. Structured and linked families without a complete scalar representation are not offered as ordinary scalar projections. Formula, Lookup, Rollup and similar scalar-capable families still require explicit output typing and complete runtime value validation.

Use **Stable provider order** to include each unique identity field. The native generated ID field is suggested when metadata exposes it. External-source primary keys can have ordinary-looking native types; NocoDB's actual `records.id_fields` determines their identity role. Such keys belong in the source order and are represented through `$recordId`, rather than being requested as ordinary `fields`. If a declared ordinary field turns out to be a native primary key, the original capture rejects it and the operator can correct the explicit selection for a new observation.

A complete capture checks:

- The exact server, API v3, base, table, view and filter.
- The actual field IDs/types and requested projection.
- The explicit provider sort, consecutive continuation pages and applied page size.
- Unique native row identities, including every observed identity-field ID in the order.
- Every configured public scalar value.
- Opening count, complete unique row count and closing count.
- Opening and closing selected schema identity.

The original table read is paginated. Matching counts and schema do not make it a provider database transaction; a complete capture preserves the actual observation interval and the original `atomicSourceSnapshot: false` value.

A failed capture retains its received files under its original request. It does not acquire a complete manifest. **Retained files** in the operations list opens its original failure details, received member list and recovery explanation.

### Equivalent CLI

First inspect the actual table:

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs discover \
  --directory /absolute/private/nocodb/film-source \
  --connections /absolute/private/nocodb/connections.json \
  --connection operations --base ACTUAL_BASE_ID --table ACTUAL_TABLE_ID \
  --request ORIGINAL_OPERATION_UUID
~~~

Save a private acquisition JSON containing `discoveryId`, `connectionAlias`, `sourceOrder` and `queries`. Use the IDs and types actually returned by discovery. The query structure is the original [NocoDB source declaration](./declaration.mjs), not a second workspace schema.

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs capture \
  --directory /absolute/private/nocodb/film-source \
  --connections /absolute/private/nocodb/connections.json \
  --selection /absolute/private/nocodb/acquisition.json \
  --title "Film source" --expected-revision 0 \
  --request ORIGINAL_CAPTURE_UUID
~~~

The returned capture record and draft revision identify the retained observation. Retain the UUID printed before the operation and use the original receipt if the transport response is lost.

## Import the real capture already acquired by another host

The source workspace can consume a frozen original NocoDB source and its complete capture without issuing any provider request.

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs import-source \
  --directory /absolute/private/nocodb/film-source \
  --source /absolute/private/provider/film-source.json \
  --title "Original film observation" --expected-revision 0 \
  --request ORIGINAL_IMPORT_UUID
~~~

The source file must already use the original capture connection and match its manifest SHA256. The importer calls the original source/capture readers, verifies every retained response and binds the source selection before adopting it. It does not convert arbitrary JSON rows into NocoDB response pages or invent a GET receipt.

For a receiving host or browser upload, create a portable packet:

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs packet \
  --source /absolute/private/provider/film-source.json \
  --out /absolute/private/receiving/film-source-packet.json
~~~

The packet contains the original manifest bytes and every original response file, each with its byte count and SHA256. Its source connection is relative to the portable capture. It contains no token value and does not need the original host's absolute paths. Retain it privately according to the actual data's access scope.

The browser's **Import an existing complete observation** accepts that packet. The same CLI supports `import --packet FILE`. Importing creates local custody and a draft; it does not mark the imported projection as reviewed, publish a dataset or activate a merchant.

Packets are bounded by the original 256 MiB provider-byte limit and a 528 MiB JSON transport limit. Base64 and parsing require additional host memory and temporary storage. Plan the complete receiving operation for its actual packet, capture, publisher and export footprint; a large packet should not be sent to a host provisioned only for the raw database size.

A saved source version can be downloaded as a complete packet from **Saved versions**, or exported with:

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs export \
  --directory /absolute/private/nocodb/film-source --version 1 \
  --out /absolute/private/receiving/reviewed-film-v1.json
~~~

The receiving workspace verifies and imports it into its own local paths. Its reviewer makes an explicit receiving review before saving a new local version; imported reviewer text is retained as source-package metadata, not automatically converted into a new local acceptance.

The [original provider-input guide](./PROVIDER_INPUT.md) covers the exact upstream Sakila database intake. That input becomes an operational NocoDB observation only when an actual NocoDB instance reads it and returns the original API responses.

## Review exact fields and values

**Review columns** displays the actual selected fields, their provider types, full-row value counts and a few original examples. Numeric examples are labeled number tokens and display their original JSON text. Numeric-looking strings remain strings.

The original capture binds the exact union of selected field IDs/types, server, base, table, view, filter and source order. Editing a saved source can change aliases, scalar representation and null policy while retaining that union. It cannot silently rebind a capture to fewer returned fields or a different provider order. The original publisher's dataset columns can choose a public subset, and its extraction order can choose the output row ordering.

A source may contain up to 32 queries, with at most 64 explicitly mapped columns per query. A field can appear in several queries with different reviewed scalar representations, but it cannot be repeated under two aliases inside one query. Removing a query or unselecting a field is accepted only if the complete original captured field union remains represented across the remaining queries.

| Choice | Result |
| --- | --- |
| Native string | Requires an actual provider JSON string. |
| Native boolean | Requires an actual provider JSON boolean. |
| Native integer | Requires a safe integer with exact native numeric representation. |
| Native number | Requires a finite number whose value survives the original exact representation check. |
| Number text | Preserves the original JSON numeric token as a string. It does not parse numeric-looking strings. |
| Identity text | Uses the original native record identity as explicit text through `$recordId`. |
| Allow null | Accepts an actual null according to the original projection. Missing fields are still an error. |
| Empty as null | Requires nullable output; the original value and CSV constraints are still validated. |

Use **Save draft** to retain the projection against the current draft revision. Use **Validate every row** to run all configured queries through the original source reader. This checks every configured value; the browser table is a limited sample of the complete result. A failed validation leaves the draft available for correction.

Changing an unsaved field, query, title or null rule invalidates the displayed preview. Opening an older capture or version as a draft creates an unsaved selection until it is saved. The browser does not substitute a stale preview for new edits.

## Freeze and select a reviewed version

Enter the reviewer and a concrete change note, then choose **Freeze and select source version**. The server requires:

- The current saved draft revision.
- A complete preview of that same draft and its exact hash.
- The expected currently selected source version.
- The original complete capture and source-selection match.

It saves a numbered immutable source version and selects it using the existing workspace's `current-source.json`. The actual version file is also retained at `versions/<request UUID>/source.json`. The saved version records its exact source hash, original capture hash, field/schema selection, reviewer and note.

The selection pointer and SQLite state reconcile on reopen using the same retained request. A changed source file outside this operator is preserved and refused; it is not silently overwritten as if it were the selected original.

**Compare saved versions** shows field-by-field alias/type/null differences and whether the observation, source selection and projection are the same. Selecting an older version prepares that original source for a future plan. It does not rewind any existing public dataset or collection.

## Publisher and merchant operation

In **Publish & operate**, open the original publisher. It uses:

- Publisher directory: `<source workspace>/publisher`.
- Source file: `<source workspace>/current-source.json`.
- Dataset directory: the original target selected at workspace initialization.

The original source driver captures the exact reviewed source into each saved plan. Its dataset column subset, extraction order, candidate review, version publication, buyer request and merchant MCP remain the original implementations.

After publishing, **Refresh original publications** lists the actual retained runs and the source versions matching their source hash. Choose the published run and its matching source version. Enter the actual merchant terms in the original `origin/path/payment` shape, then review the package.

The authoring bridge verifies that the run's original plan source hash and capture manifest match the selected reviewed version. It then calls the existing NocoDB deployment functions. A reviewed package includes the original dataset bytes/config, merchant configuration, source description and dataset-store binding. Preparation reuses that actual published candidate and performs no NocoDB extraction.

**Stage in original release store** writes the retained release ID using the original SF82 functions. **Open original release controls** opens the original release console for compare, activation, run, stop, restart, rollback and customer receiving. The release console's own generation/digest/runtime checks remain authoritative.

Changing the selected release does not by itself claim that the running merchant changed. The release console shows both selected and actually running state. The source workspace does not add a second merchant process manager, payment collector or dataset-version writer.

The CLI offers `deployment-status`, `deployment-review`, `deployment-prepare`, `deployment-stage`, `deployment-package`, `deployment-file`, `deployment-compare` and the long-running `deployment-console`. JSON input files use the corresponding original model method fields. The browser supplies the normal sequence without requiring an operator to assemble these request objects by hand.

See the original [deployment guide](./DEPLOYMENT.md) for merchant receiving and native release details, and [Applications](./APPLICATIONS.md) for the separately composed managed application launcher.

## Interrupted responses, tabs and process recovery

Every mutation uses a UUID that is durably recorded with its canonical input before the operation starts. Reusing that ID with different input is rejected. The completed original result is returned on an identical replay.

The browser retains a small request marker before POST. It does not retain source rows or token values in browser storage. Complete source packets remain in the selected file/in-memory upload until the server takes custody. If a response is lost:

1. Keep the displayed request UUID.
2. Choose **Check original receipt**.
3. If the original process still runs, let that original operation complete.
4. If it was interrupted, choose **Resume retained request**.
5. If the request never reached the workspace, reselect the exact same packet bytes when needed and retry the identical request.
6. If the operation recorded a failure, acknowledge it and review its original retained files before making a new request.

The browser keeps the request marker through failed receipt/status/view refreshes. A committed operation cannot become a new UUID merely because a later GET failed. Each retained marker is keyed by its request, so separate tabs do not clear another tab's pending work.

Draft edits and source selection use expected revisions. Controls that can change their input are frozen while an operation or uncertain response is pending. A stale window receives a current-revision conflict and must reload; it cannot silently overwrite another window's saved draft.

CLI equivalents:

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs operation \
  --directory /absolute/private/nocodb/film-source --request ORIGINAL_OPERATION_UUID

node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs resume \
  --directory /absolute/private/nocodb/film-source --request ORIGINAL_OPERATION_UUID

node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs attempt \
  --directory /absolute/private/nocodb/film-source --request ORIGINAL_CAPTURE_UUID
~~~

Local interrupted imports can finish from their retained packet. A capture resumes only if its original complete manifest is already durable; otherwise its original partial files stay retained and a new explicit observation is required. Reopening never requests another provider page automatically.

Uncertain release commands are reconciled by reading the original release state. They are not blindly submitted a second time. A recovered console-start receipt observes current process ownership; it does not infer that an ended process is still running.

## Retained state and receiving

| Path | Purpose |
| --- | --- |
| `INIT.json` | Original directory/dataset initialization binding. |
| `sources.sqlite` | Drafts, captures, previews, reviewed versions and UUID operations. |
| `inputs/` | Original import packets, metadata receipts and selected capture configurations. |
| `captures/<UUID>/` | Complete original NocoDB manifest and response bytes. |
| `captures/.pending-<UUID>/` | The same in-progress or failed original capture/import. |
| `previews/<UUID>/` | The exact source configuration used for complete row validation. |
| `versions/<UUID>/source.json` | Immutable reviewed source-version file. |
| `current-source.json` | Selected original source for future publisher plans. |
| `publisher/` | Original retained publisher, plans, runs and buyer workflow. |
| `dataset/` or selected target | Original public dataset-version store. |
| `deployments/` | Original prepared merchant packages and SF82 release store. |

Stop the owning process before taking a whole-workspace filesystem backup. Retain the complete workspace and its separately selected dataset target together. Credential references can be recreated on the receiving host through its own authorized host environment; do not include token values in a source deliverable. The complete reviewed packet is a portable source handoff, not a replacement for the full publisher/release operating history.

Managed launching verifies the immutable settings, actual workspace/SQLite identities, private connections-file hash and nine-file source closure. The source file and reviewed selection are deliberately mutable operating state, not a reason to invent another workspace or launch identity. The existing Applications adapter consumes this original managed-launch contract.

## Native consumer interface

The joined receiving operation can call the same original model directly:

~~~js
import { openNocoDBAuthoring } from './workspace/model.mjs';
import { serveNocoDBAuthoring } from './workspace/server.mjs';

const workspace = await openNocoDBAuthoring({
  directory: absolutePrivateWorkspace,
  create: true,
  targetDirectory: originalDatasetDirectory,
});

const imported = await workspace.importSource({
  sourceFile: originalFrozenSourceFile,
  title: sourceTitle,
  expectedDraftRevision: 0,
  requestId: importRequestUuid,
});

const service = await serveNocoDBAuthoring({ workspace, port: 0 });
// Open service.url in the original receiving browser.
// Validate the imported draft and freeze its reviewed version there.
// service.close() closes this same model and any console it owns.
~~~

`importSource` returns `{capture, draftSaved, draftRevision}`; the capture includes its original manifest hash, row count, full selection and imported draft. `status().draft` is `{captureId,title,queries}`.

`preview({draftRevision,requestId})` returns an ID and a complete `reports` map keyed by the original query names. Each report includes the original extraction result and at most 25 sample rows.

`saveVersion({draftRevision,previewId,reviewer,note,expectedSelectedVersion,requestId})` returns `{version,selectedVersion,sourceFile,sourceSha256}`. `version.sourceFile` is the immutable version file; the top-level `sourceFile` is the managed current-source path. `version.observationSha256` is the exact original capture-manifest hash.

`openPublisher({expectedSelectedVersion,requestId})` returns the original `publisherDirectory`, `targetDirectory`, source hash and running console URL. Close the authoring process before another owner opens that same publisher/MCP directory. Preserve the original file hashes, queries and capture selection throughout the receiving operation.

The native consumer reuses the already completed provider capture. A different publication order or public dataset subset comes from the original publisher plan, without another provider observation or a fabricated newer capture.

