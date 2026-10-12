# SensorThings observation operator

This selected Merchant Workspace package carries the original SensorThings source workspace, source-owned merchant provider, command-line client, private managed application, native publisher and customer receiving. It uses the maintained distribution builder and the same saved writer throughout capture, review, publication and handoff.

The selection is `sensorthings-operator`. Its contribution is `sensorthings`; its original provider is `sensorthings-workspaces`. The installed package manifest retains the exact source commit, recipe, contribution and complete file identities.

## Install and open the selected product

Receive the selected archive through the existing installation and runtime workflow. Use the archive's actual SHA-256 and the original runtime profile. Select the native dependencies and the original `schema`, `openapi` and `mcp` feature groups, plus the operator support required by that profile. Keep the selected Node executable, Python and Linux `flock` identity in the runtime receipt.

```sh
starforge source
starforge registrations --source sensorthings
starforge merchant-providers inspect sensorthings-workspaces
starforge runtime-profile catalog
starforge doctor --native --feature schema --feature openapi --feature mcp
```

The original Runtime workspace owns installation preparation, run/inspect, source selection and the READY runtime. Attach that returned runtime to Applications. Save the SensorThings application against its actual existing workspace, source inbox and buyer workspace. Review Start, Start and Open use the original managed application. Stop and subsequent Start retain the same workspace UUID and operation journal. The source-owned Applications provider and browser assets belong to the same SensorThings contribution.

When an operator owns the listener directly, use the included original command with a private directory and session-file parent:

```sh
umask 077
starforge sensorthings serve \
  --workspace /absolute/private/observations \
  --source-inbox /absolute/private/source-inbox \
  --buyer-workspace /absolute/private/buyer-inbox \
  --port 8467 \
  --session-file /absolute/private/sensorthings-session.url
```

Retain the original startup record privately. It reports schema `stellar-forge.sensorthings-workspace-startup.v1`, the persistent `workspaceId`, origin, private URL and process identity. The running application owns its writer. Use the Desk or connected client while it runs; one-shot direct commands acquire the original writer themselves.

## Bind the original merchant and agent client

The complete configuration instructions are included at:

- `source/stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/DISTRIBUTION.md`
- `source/stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/SENSORTHINGS.md`
- `source/stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/RECEIVING.md`

Use the actual observed workspace UUID and exactly one private reference: `consoleUrlFile`, `consoleUrlEnv` or the returned managed `applicationUrlFile`. The initializer keeps the original configuration and client registration create-only, verifies their exact bytes on reopen and retains interrupted original initialization state.

```sh
starforge sensorthings-setup connection --options /absolute/private/connection-options.json
starforge merchant-providers init sensorthings-workspaces --options /absolute/private/merchant-options.json
starforge sensorthings connect --config /absolute/private/connection.json \
  --alias observations --tool merchant_sensorthings_view
```

Use the returned `merchant-client.json` through the client's normal MCP configuration. This registration runs the selected installed original merchant subprocess. Connection files contain references and the persistent UUID; private session values stay in their existing owner files or environment. Reopening a saved application may change its listening port, while the provider rereads the reference and verifies the UUID.

The native tools include workspace/schema/view reads, catalog and source-edition rows, complete capture pages and attempts, source comparisons, original actions and operation recovery, publisher/release/customer reads and manifest-selected file receiving. Every mutation retains its actual `operationId`, `expectedRevision`, action and complete payload. Recover an uncertain action by reading that same operation before continuing its exact request.

## Receive and review the original source edition

Place the original complete source-edition archive in the configured private source inbox. Keep its actual filename, byte count and SHA-256 from the original export receipt. The `edition.import` action receives those exact bytes through the source-owned importer. The edition's content identity and source objects survive, while the receiving workspace has its own persistent identity and review history.

The source schema advertises the complete action payloads. A connected import file has this shape, with actual returned values in place of the labelled placeholders:

```json
{
  "operationId": "an-original-retained-operation-id",
  "expectedRevision": 0,
  "action": "edition.import",
  "payload": {
    "filename": "the-original-source.ndjson.gz",
    "expectedSha256": "the-original-64-character-sha256",
    "expectedBytes": 123
  }
}
```

Here `expectedRevision`, the operation ID and every archive field come from the selected real receiving operation. The numbers above describe the input shape. Invoke it with `merchant_sensorthings_action` using the original `connect` command and a private JSON input file.

Read the complete retained edition and its observation, component and entity tables. Page capture journals with the actual first-page revision and require that revision on subsequent pages. The source supports explicit page partitions for tasks, pages, issues, attempts and parents; it preserves the provider's opaque continuation links.

A receiving review records the actual reviewer, decision, note and acknowledged source issues. Original source reviews travel as evidence. Review the selected edition locally before creating a native dataset. A source or analysis comparison uses the original left/right edition identities; retain both complete selections and the resulting comparison files.

## Preserve observation meaning

An observation retains its original result type, exact value representation, quality metadata, null/missing distinctions, units, multidimensional component order and location/entity references. Phenomenon time, result time and valid time remain separate source fields. The original provider URLs, request outcomes, page hashes and source terms stay attached to the edition.

The Hamburg charging-point source uses categorical observations. Review its status strings as categories and retain null unit fields. A categorical stream's map and event sequence have different meaning from a numeric time series. Numeric diagrams require a selected numeric source stream with its original units and time semantics. Any added analysis must bind the original selected source edition and its actual coverage.

## Native publication and customer operation

The original `dataset.prepare` action turns a locally reviewed SensorThings edition and selected table into the native SF30 dataset package. Its exact source closure, dataset configuration and receipt travel together. Use `dataset.query` against that saved package to inspect the declared query and returned snapshot.

A merchant release uses the same dataset, selected origin/path and the merchant's actual payment terms. The original publisher owns preparation, SF82 stage/selection, activation, start, stop and rollback. Use a running original listener for release start so its child lifetime remains owned. The selected release generation controls the operation; a reused operation keeps its retained result.

The original SF88 buyer inbox and SF100 receiver retain request terms, signed attempts, result bytes and receiving outputs. The SensorThings `buyer.inspect` and `buyer.receive` actions select those actual inbox intent IDs. The publisher's existing buyer workflow provides review, execution, status, recovery, accounting and export against its retained snapshot. Follow the saved native approval and payment configuration for that operator.

This product explicitly retains the original dynamically loaded dataset, Socrata publisher, SF82, SF88 and SF100 modules. Those modules provide the existing engine contracts used by the SensorThings source. The source selection binds them even where the original call uses a dynamic import.

## Complete file and portable receiving

Use `merchant_sensorthings_files` to select the original source, edition, dataset, comparison, transfer, publisher or received-buyer files. Retain the returned manifest and each original selector/hash before downloading. A source-edition export includes the immutable original source objects, complete edition and original review evidence.

```sh
starforge sensorthings inspect-download --config /absolute/private/connection.json \
  --alias observations --selection /absolute/private/original-selection.json

starforge sensorthings download --config /absolute/private/connection.json \
  --alias observations --selection /absolute/private/original-selection.json \
  --directory /absolute/private/received-artifacts --progress
```

The original downloader keeps its own manifest, completed files and partial prefix. Resume with the same selection and receiving directory. Its held read identity belongs to the current client process; a later process resumes the same selector, hash and offset through a fresh native read. Keep the original filename and exact complete bytes in the receiving package.

For the next operator, include the selected source archive and manifest, reviewed source-edition archive and receipt, selected dataset and comparison outputs, actual customer receiving files, and the original operating guide. The new operator imports the original source archive into its own selected private workspace, reviews that evidence and reopens its own saved application. Existing seller, buyer/payment and unfinished capture operations remain with their original persisted owners and transfer through their native operating procedures.

## Restart and delivery acceptance

The complete installed receiving operation records the actual selected package/runtime and follows these connected user outcomes:

1. Open the saved original application and confirm its persistent workspace identity.
2. Receive the original retained source edition with every source hash and original review evidence.
3. Read complete rows, perform the explicit receiving review and compare the selected later edition.
4. Prepare and query the original native dataset; operate the merchant/customer workflow using the selected real terms and inbox.
5. Receive the manifest-selected complete files, then repeat the same download through its existing recovery journal.
6. Stop and reopen the same application, retaining its workspace, source and operation identity.
7. Receive the selected portable source in another private workspace, confirm the same edition/object identities and record that receiver's review.

Use the source owner's existing Hamburg capture and returned source-edition packets for this operation. Its original acquisition scope, timestamps, issues and completed page count remain the source authority. The grant and customer delivery link the actual installed operation and selected output identities after that continuation completes.

## Build and continue this selected source

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/original-checkout --ref SELECTED_COMMIT \
  --selection sensorthings-operator --out /absolute/sensorthings-release

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/original-checkout --out /absolute/sensorthings-release --resume
```

An offline build uses the same selected existing Git objects with `--offline`. The original builder reports the actual source and archive identities. A resumed build inherits its retained recipe; a different selected product uses a separate output. Keep the original runtime lock, selected package and private customer workspace available through updates and receiving.
