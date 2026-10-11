# Allium retained operator workspace

This application turns the original Allium Explorer integration into a retained operator workflow. It uses the original saved-query transport, typed dataset loader, version store, runnable seller and dataset publishing application. It does not add an Allium HTTP client, query engine, payment engine or publisher.

The six sections cover the complete working sequence: product and projection, source acquisition, typed result exploration, merchant and buyer operation, and full history and handoff. The application binds to `127.0.0.1`; its private operator URL carries a session token in the fragment. Open that complete URL on the machine running the process.

## Create and operate

Use Node 22 or later on Linux with the existing merchant dependencies and util-linux `flock`. The maintained merchant distribution exposes `starforge allium-workspace`; directly from the source tree, use:

```sh
node stellar/scf-starforge-20261009/partners/allium-explorer-pilot/workspace/cli.mjs create \
  --workspace /private/allium-product \
  --product /private/approved-allium-product.json \
  --name "Allium Stellar data"

node stellar/scf-starforge-20261009/partners/allium-explorer-pilot/workspace/cli.mjs serve \
  --workspace /private/allium-product --port 8447
```

`create` reserves a new private directory and retains the original product JSON. `serve` prints the private browser URL and owns the workspace until shutdown. A second process cannot open the same workspace while that owner is active. Read and operate through its existing browser or HTTP API. SIGINT and SIGTERM close the browser host, the original publisher and its owned merchant; no background merchant is left behind by the CLI.

Set the environment variable named by the saved product's `apiKeyEnv` in the host process before starting the server if you intend to execute a query. Its value is not accepted as a browser input and is never included in the workspace or export. The readiness indicator reports only the environment variable name and whether it is present.

An imported result and all local dataset operations work without an Allium key.

## Product revisions and source limits

Start with the original [`../examples/product.json`](../examples/product.json). Set the approved saved-query ID, exact string parameters, source table, public field projection and native query capabilities. The structured editor and complete JSON editor operate on the same document. JSON fields such as the compute profile and explicit origin remain available in the full editor.

The original compiler defines the limits: at most 32 projected fields, 16 bounded string parameters, 250,000 acquired rows, 1 MiB per provider JSON response, and 1,000 rows per native page. The chosen product may set smaller limits. The original seller can advertise at most 32 query parameters; this workspace uses one slot for its optional snapshot selector, so a product using all 32 slots must release one before merchant configuration.

Keep precision-sensitive provider values as strings. The original projection rejects unsafe numeric integers. A nullable CSV string cannot distinguish an empty string from null, and the original loader enforces that rule.

Saving creates an immutable product revision containing the exact JSON text, its SHA-256, the compiled product, parent revision, note and creation time. Saving compares the browser's base head with the retained head; a concurrent revision is shown without replacing a dirty draft. A historical restore creates a new head and leaves earlier products, acquisitions and merchant snapshots intact.

Local drafts and the exact pending operation payload use the existing IndexedDB draft store. Its transaction must complete before a retained mutation is sent. Large source imports do not pass through sessionStorage. The browser reports storage failure and keeps the edited document in memory; restore storage or download/copy the source before leaving that page.

## Acquire one source explicitly

### Import an existing Allium result

Choose a saved product revision and the complete original JSON envelope:

```json
{
  "sql": "the saved query's actual SQL",
  "meta": { "columns": [{ "name": "column_name", "data_type": "provider type" }] },
  "data": [],
  "queried_at": "2026-10-11T00:00:00Z"
}
```

The envelope above describes the shape, not a substitute data source. Import the actual approved result and give its source or custody reference in the operation note. The workspace retains every original byte before asking the original `stageResults` implementation to project and load it. Rejected input remains in its acquisition with the original error, rather than becoming a published dataset.

The staged source records the provider query and run identity, source table, query timestamp, complete result hash, SQL hash, CSV hash, row count, row-limit status and exact native dataset snapshot. Undeclared columns stay in the private original result and are excluded from the exposed dataset. Downloads return the complete original result, projected CSV, original dataset configuration or source manifest.

### Run and recover a saved query

**Start saved query** performs the original one-time `beginRun` operation using that saved revision. It may consume the operator's Allium credits. No recurring query or automatic polling is configured.

The acquisition is retained before calling the original engine. That engine saves its `submitting` record before the one provider POST. A repeated browser request with the same operation ID returns the retained acquisition and cannot submit another query.

**Read status & collect completed result** uses original `collectRun`: one status read, then a result fetch only after a successful status, with original on-disk result caching and staging recovery. A staged run is returned from its retained native dataset.

If a response is interrupted after submission, the existing native record shows `submitting` or `submission_unknown`. Find the actual run ID in the approved Allium query history and use **Attach existing run ID**. This calls original `recoverRun`, never another run POST. If the process stopped before the original provider directory was created, **Submit prepared acquisition** is available; the host verifies that no native run directory exists before invoking the first submission. An existing native directory cannot be replayed through that action.

The host follows the documented Allium origin. The CLI's explicit `--allow-loopback-provider` option is for a deliberately supplied local contract host; it does not redirect production provider requests automatically.

## Explore and publish

**Explore results** uses the original loader, admission and query handler against the selected retained acquisition. Pass the native query string: fields, limit, declared equality/range filters, sort and cursor. The next-page control keeps the exact previous filters and ordering while adding the returned cursor. Exact strings are displayed unchanged.

In **Merchant & buyers**, select a completed acquisition, provide the canonical advertised HTTPS origin, fixed path and actual public payment terms. Amount is an atomic-unit string; there is no conversion from USD or display units. Initial native retention settings are optional. Merchant initialization creates the original version store, and the generated original seller config advertises its optional snapshot selector.

Start the configured merchant on a chosen local port, or use port 0. Without a facilitator it runs in the original `CHALLENGE_ONLY` mode. To enable the existing native settlement path, supply the original HTTPS facilitator. A loopback facilitator requires the explicit local option. This workspace never creates a wallet, signer or buyer payment authorization.

**Publish selected completed acquisition** passes the original dataset configuration to native `versions.refresh` with the displayed current snapshot and native revision. **Activate** uses original retained-version activation with the same comparison. A changed public field/type/query contract follows the original engine's separate-route requirement. Existing cursors and protected snapshots keep native retention behavior. **Collect expired native snapshots** calls the original collector explicitly.

The workspace retains all completed Allium acquisitions even after the native merchant's configured retention removes an old public snapshot. A prior source can be inspected or explicitly published again from its retained configuration if its contract is still compatible.

## Original publisher and customer handoff

**Open publishing & buyer session** starts the existing dataset publishing application against this exact merchant and native store. Its actual private link opens in another tab. The session is owned by this workspace and is closed before merchant shutdown or export.

**Review selected source in publisher** passes the selected acquisition's exact CSV through the original publisher upload endpoint, records its Allium acquisition/product/result/snapshot provenance using the original candidate metadata operation, and selects the resulting candidate. The operation ID reconciles an already retained candidate after a lost response. The original publisher's source byte budget and published schema still apply. For a larger source accepted by the new Allium acquisition configuration, the direct native publication action uses that configuration and its own native refresh checks.

Inside the original publisher, review the source, run a first-page query against the chosen published snapshot, load the actual merchant's offer and prepare its original SF88 buyer configuration. The original UI retains candidate notes and revisions, publication history, query selection and buyer configurations. These records belong to the same complete export.

The buyer configuration contains the selected public resource, exact snapshot, request and advertised terms. It is preparation for the existing buyer plan/approval/invoke workflow. It does not execute an Allium query or authorize a payment. The provider key and private merchant control token are absent.

## Full portable export and reopen

Use **Stop owned runtime & download full workspace** in the browser. The host closes its original publisher and merchant, obtains the original native store locks, and captures the complete retained workspace. It exports completed files only, excluding runtime control descriptors, sockets, locks and unfinished staging directories.

Each portable file has its relative path, byte length, SHA-256 and exact base64 content. The archive also has a manifest digest, workspace ID and source directory. It includes product text and history, original acquisitions, native datasets and versions, merchant terms/configuration history, publisher candidate records and prepared buyer files.

The offline CLI uses the same model:

```sh
starforge allium-workspace export --workspace /private/allium-product \
  --out /private/allium-product.allium-workspace.json

starforge allium-workspace import --workspace /private/reopened-allium-product \
  --bundle /private/allium-product.allium-workspace.json

starforge allium-workspace serve --workspace /private/reopened-allium-product
```

Stop the existing workspace server before the offline `status` or `export` command; use its browser export while the server owns the directory. Export files and import destinations are create-only.

Import verifies every file identity and the original typed dataset snapshots before exposing a usable workspace. It retains original file hashes in the export manifest. The original publisher's one known absolute `datasetDirectory` binding is changed to the new merchant directory, and the import origin and original workspace hash are recorded. Other native source and buyer content remain exact. Runtime state opens stopped; start the merchant explicitly with the appropriate host configuration and credentials.

## Source and operating boundaries

The authoritative provider contract is documented at [Run saved query](https://docs.allium.so/api/explorer/run-query), [Read run status](https://docs.allium.so/api/explorer/fetch-query-run-status), and [Fetch completed results](https://docs.allium.so/api/explorer/fetch-query-run-results). Saved queries use `X-API-KEY`; customer payment and delivery use the original Stellar merchant after acquisition. Availability of Stellar indexed data does not establish that Allium itself accepts Stellar payments.

Original implementation entry points are `../explorer.mjs`, `sf30-seller-sdk/dataset-handler.mjs`, `sf30-seller-sdk/dataset-refresh/{versions.mjs,service.mjs,workspace.mjs,workspace-state.mjs,buyer-handoff.mjs}` and the original SF88 buyer. This component has no dependency installation or CI workflow. Its complete source belongs to the maintained merchant distribution's same cumulative build.
