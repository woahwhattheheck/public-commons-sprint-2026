# Retained data publication through merchant MCP

Operate the original PostgreSQL, SQLite, MySQL or Google Sheets publisher through the maintained merchant MCP service. The same saved plans, extraction runs, typed candidates, reviews, version writer, recurring policy and buyer files remain available after the MCP host restarts. The adapter uses the original publisher and scheduler instances under their existing workspace lease.

## Start from the public SQLite example

The original [SQLite example producer](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/create-example.mjs) creates a fictional four-product catalog on the operator's own host. It supplies a runnable source without a database daemon or a customer database. Use Linux, Node 22.16 or newer and util-linux `flock`. From a source checkout, choose a new absolute directory and run:

```sh
SCF_DEMO=/absolute/path/to/new-catalog-demo
mkdir -m 700 "$SCF_DEMO"
node stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/create-example.mjs \
  --directory "$SCF_DEMO/source"
node stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/publisher/cli.mjs init \
  --workspace "$SCF_DEMO/publisher" \
  --source "$SCF_DEMO/source/source.json" --state "$SCF_DEMO/dataset"
cat > "$SCF_DEMO/publisher-connection.json" <<'JSON'
{
  "schema": "stellar-forge.merchant-publisher-connection.v1",
  "workspaces": {
    "catalog": {
      "label": "Public example catalog",
      "kind": "sqlite",
      "directory": "publisher"
    }
  }
}
JSON
chmod 600 "$SCF_DEMO/publisher-connection.json"
node stellar-forge/mcp-merchant-operator/serve.mjs init-publishers \
  --dir "$SCF_DEMO/mcp" --connection "$SCF_DEMO/publisher-connection.json" \
  --name "Public catalog publications"
node stellar-forge/mcp-merchant-operator/stdio.mjs \
  --config "$SCF_DEMO/mcp/merchant-mcp.json"
```

Configure the final stdio command as the MCP client's subprocess. The original publisher `init` command has already released its workspace lease. Open alias `catalog`, inspect its source and use the returned hash in a saved plan with these exact public example fields:

| Plan field | Public example value |
| --- | --- |
| `query` | `catalog` |
| `input` | `{"region":"north","after_id":"0"}` |
| `dataset.columns` | `{"id":"integer","title":"string","region":"string","price_cents":"integer"}` |
| `dataset.filters`, `ranges`, `sorts` | `[]`, `[]`, `["id"]` |
| `dataset.defaultLimit`, `maxLimit` | `3`, `100` |
| `extraction.order` | `[{"column":"id","direction":"asc"}]` |
| `extraction.maxRows`, `maxBytes`, `maxRowBytes`, `timeoutMs` | `100`, `1048576`, `65536`, `30000` |

Give the plan and dataset meaningful names and use the save/extract/review/publish sequence below. The original north-region query returns products 1, 3 and 4; its approved projection excludes `internal_note`. The first publication uses `initialize: true` because the chosen dataset directory is absent.

The producer's `service.json` contains explicitly unverified example payment terms. Use those only for the original challenge-only demonstration, or configure the seller with the merchant's actual terms before an approved native purchase. The buyer and recurring sections below then operate this same retained workspace, target and saved run. Keep the generated source, publisher and MCP directories together; reopen their existing paths to continue instead of running either initialization again.

## Connect an existing publisher

Use the original [PostgreSQL publisher](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/README.md), [SQLite publisher](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/publisher/README.md) [MySQL publisher](../../stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/publisher/README.md) or [Sheets publisher](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/README.md) to create a private workspace bound to its approved source and dataset target. An empty newly created workspace is supported; the first MCP publication can initialize its absent target.

For example, the maintained PostgreSQL entrypoint creates the original workspace and opens its browser:

```sh
starforge postgres-publisher serve \
  --workspace /private/inventory-publications --create \
  --source /private/inventory-postgres/source.json \
  --state /private/inventory-dataset
```

Use `sqlite-publisher`, `mysql-publisher` or `sheets-publisher` for the corresponding original source. Stop that publisher browser before opening the same workspace through MCP. Its original kernel lock gives one process ownership; the separate versioned dataset seller can continue serving customers.

Create a private publisher connection JSON file:

```json
{
  "schema": "stellar-forge.merchant-publisher-connection.v1",
  "workspaces": {
    "inventory": {
      "label": "Inventory data product",
      "kind": "postgres",
      "directory": "/private/inventory-publications",
      "seller": "http://127.0.0.1:8423",
      "resource": "https://merchant.example/data"
    }
  }
}
```

`kind` is `postgres`, `sqlite`, `mysql` or `sheets` and must match the retained workspace. Paths resolve relative to this connection file. Up to 32 aliases can refer to distinct private workspaces. The optional `seller` and `resource` pair binds the existing seller's local address and exact public HTTPS resource for buyer preparation. It does not start that seller or a public proxy. Omit both while preparing a target whose seller has not yet been configured.

Create the original MCP host configuration without an unrelated API release:

```sh
starforge merchant-mcp init-publishers \
  --dir /private/inventory-mcp \
  --connection /private/publisher-connection.json \
  --name "Inventory publications"
```

For an existing merchant MCP host, add `"publisherConnection": "/private/publisher-connection.json"` to its existing `merchant-mcp.json`. Its release, fleet, support and other configured operations stay in that same host. Restart the provider to read changed host configuration.

Launch using the existing authenticated HTTP or [stdio host](STDIO.md):

```sh
starforge merchant-mcp serve --config /private/inventory-mcp/merchant-mcp.json
# Or use the existing subprocess entrypoint:
starforge merchant-mcp-stdio --config /private/inventory-mcp/merchant-mcp.json
```

The HTTP command reads its existing `MCP_ACCESS_TOKEN` environment variable; the stdio host owns its private loopback bearer. Provide source credential environment variables and private renewable connection references to that same host process. No source credential, connection file, executable module or arbitrary filesystem path is an MCP tool argument.

Source-checkout users invoke `node stellar-forge/mcp-merchant-operator/serve.mjs` and `stdio.mjs` with the same arguments. The original whole merchant MCP and SF30 distribution selections include this adapter and its native publisher dependencies. PostgreSQL and MySQL workspaces use their existing `postgres` and `mysql` dependency groups; SQLite and Sheets use the original Node runtime.

## Google Sheets publications

The original [Sheets source and publisher](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/README.md) are a supported host-declared source family. The MCP adapter opens `openSheetsPublisher` and its existing workspace, with the same retained source captures, typed candidates, reviews, version writer, recurring policy and buyer handoffs. The original [renewable Google connection](../../stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/auth/README.md) supplies credentials privately when a live source requests another observation.

### Prepare the source on the merchant host

Use the Sheets source workflow to select the actual workbook, stable tab identity, A1 range, headers, public columns, scalar types and formula policy. Retained connected `CellData` captures and live Google sources are both supported. Keep the workbook ID, full capture, client file and account connection outside published application source and customer exports.

For a live source, connect the merchant's registered Desktop client and review its Google-returned account through the original connection window:

```sh
starforge sheets-source auth connect \
  --client /private/google/desktop-client.json \
  --directory /private/google/merchant-connection
starforge sheets-source use-connection \
  --source /private/sheets/reviewed-source.json \
  --connection /private/google/merchant-connection \
  --out /private/sheets/live-source.json
starforge sheets-publisher serve \
  --workspace /private/sheets/publications --create \
  --source /private/sheets/live-source.json \
  --state /private/sheets/dataset
```

`use-connection` creates a new declaration with the reviewed workbook/range/projection and an absolute private `oauthDirectory` reference. Use that declaration when initializing the new live publisher. Existing environment-token sources continue to use their configured environment variable in the MCP host process. An already-created publisher retains its original configured source and directory; reopen those paths rather than initializing it again.

Stop the publisher browser after source review so the MCP host can acquire that same original workspace lease. Declare it in the host's existing publisher connection file:

```json
{
  "schema": "stellar-forge.merchant-publisher-connection.v1",
  "workspaces": {
    "sheet_catalog": {
      "label": "Reviewed Sheet catalog",
      "kind": "sheets",
      "directory": "/private/sheets/publications"
    }
  }
}
```

Use `merchant-mcp init-publishers` or the existing host's `publisherConnection` configuration as above. The declared kind must match `stellar-forge.sheets-publisher-workspace.v1`. Sheets adds no npm dependency. The same Linux, Node and `flock` requirements apply. Account connection and renewal remain in the original private credential directory; the agent selects only the declared publisher alias.

### Inspect and publish the approved range

Call `merchant_publisher_open` with `{"publisher":"sheet_catalog"}`, then `merchant_publisher_source`. The source response retains its exact hash, connection kind, named ranges, stable tab ID, public column types, null/formula handling and any captured observation. A Sheets query selects a previously approved named range. Its parameter object is empty.

For a source matching the original public `example-source.json` projection, the plan is:

```json
{
  "publisher": "sheet_catalog",
  "plan": {
    "title": "Reviewed Sheet catalog",
    "query": "catalog",
    "sourceHash": "THE_ACTUAL_SOURCE_SHA256",
    "input": {},
    "dataset": {
      "name": "Sheet catalog",
      "columns": {
        "sku": "string",
        "label": "string",
        "units_available": "integer",
        "unit_price": "number",
        "enabled": "boolean",
        "serial_id": "string",
        "stock_value": "number"
      },
      "filters": ["enabled"],
      "ranges": [],
      "sorts": ["sku"],
      "defaultLimit": 25,
      "maxLimit": 100
    },
    "extraction": {
      "maxRows": 500,
      "maxBytes": 8388608,
      "maxRowBytes": 65536,
      "timeoutMs": 30000,
      "order": [{"column":"sku","direction":"asc"}]
    }
  }
}
```

Replace the source hash and projection with the actual inspected source before saving. Formula output is included only where the source explicitly permits effective values. Text identifiers keep their original text; an identifier already stored by Google as a rounded number cannot regain lost digits through a type conversion.

Continue through the same plan-save, extraction UUID, candidate inspection, review and publication tools below. `merchant_publisher_inspect` returns the original typed rows and the selected range's native observation: source/manifest hashes, receipt time, byte count, formula-cell count and original one-response semantics. Local capture filenames are omitted from the MCP view while the original files remain with their native runs. Review the exact candidate digest and current target before publication. The seller and buyer sections apply unchanged to this same dataset.

### Refresh and reopen the same publication

| Approved source | Meaning of a later extraction or scheduled occurrence |
| --- | --- |
| Retained connected capture | Reads the exact observation copied into the immutable plan. It does not obtain a newer Google response. A newly approved capture requires a newly reviewed source plan. |
| Live Google source with `oauthDirectory` | The original source resolves the merchant's saved connection and reads a fresh range observation for that extraction. Each run retains that actual response and its hashes. |
| Live Google source with `accessTokenEnv` | Reads a fresh range using the original host environment credential. Credential lifetime remains the host operator's responsibility. |

An enabled saved policy resumes when the MCP alias opens. Keep the original interval, row-change limits, responsible reviewer and `onError` behavior appropriate to the selected source. A reconnect or renewal serves the same live plan through its stable private connection reference. It does not rewrite an already-retained capture or previously published edition.

After a credential error, inspect the original connection with `starforge sheets-source auth status --directory /private/google/merchant-connection`; use its existing reconnect flow where requested. Retained extraction state and the last published dataset remain available while the source is repaired. Resume the original schedule occurrence or run only as indicated by its current saved state.

Close the exact returned `instanceId`, then reopen the same alias after a host restart. Original plan/run IDs, both older and current candidates, retained editions, schedule history and saved buyer configuration remain in the original workspace. `merchant_publisher_buyer_read` reopens its exact existing handoff without another provider request or purchase.

## Save, extract, review and publish

Start with `merchant_publishers`, then call `merchant_publisher_open` with the declared alias. Opening acquires the original workspace lease and starts the original scheduler in its saved state, just as the native browser server does. An enabled saved policy resumes; a paused policy stays paused. Reopening an already-open alias returns the same process instance.

Use `merchant_publisher_source` to inspect the exact source hash, approved query names, source projections and typed parameter definitions (including the original Sheets range and formula policy). Use `merchant_publisher_status` to inspect saved plans/runs and `merchant_publisher_target` for the actual current dataset contract, snapshot, revision and retained versions.

`merchant_publisher_plan_save` accepts the original plan. Select a query that exists in the inspected source; match its parameter names and intentionally select the columns to publish. This illustrative inventory plan uses exact text for large IDs and decimals:

```json
{
  "publisher": "inventory",
  "plan": {
    "title": "Approved inventory",
    "query": "inventory",
    "sourceHash": "THE_ACTUAL_SOURCE_SHA256",
    "input": { "region": "north" },
    "dataset": {
      "name": "Inventory",
      "columns": {
        "id": "string",
        "seq": "integer",
        "title": "string",
        "amount": "string",
        "active": "boolean",
        "note": { "type": "string", "nullable": true }
      },
      "filters": ["active"],
      "ranges": [],
      "sorts": ["seq"],
      "defaultLimit": 3,
      "maxLimit": 25
    },
    "extraction": {
      "maxRows": 50000,
      "maxBytes": 16777216,
      "maxRowBytes": 1048576,
      "timeoutMs": 30000,
      "order": [{ "column": "seq", "direction": "asc" }]
    }
  }
}
```

Replace the example source hash, query, fields, names and limits with the actual inspected source and target. The native driver validates the source hash, source-specific transaction/extraction options, ordering and original CSV scalar contract. Saving retains its approved source bytes; older plans keep their original bindings.

1. Call `merchant_publisher_extract` with the saved plan's `id` as `planId`, its exact `data.digest` as `planDigest`, and a new lowercase UUID as `runId`. The response returns immediately while the original extraction runs. Retrying that same UUID/plan returns the same retained run.
2. Call `merchant_publisher_inspect` for that run. The original candidate preview retains precise strings, typed numbers, Boolean and null values. The candidate's `candidateDigest`, row count, source/plan hashes and native transaction metadata remain with the run.
3. Read `merchant_publisher_target` and inspect the intended change. Call `merchant_publisher_review` with the run, exact candidate digest, responsible reviewer, meaningful note, and current `expectedSnapshot`/`expectedRevision`. For an absent target, explicitly choose `initialize: true` instead.
4. Call `merchant_publisher_publish` using the original review's `data.review.id` as `reviewId`. The original version writer checks the review, target revision, dataset contract, retention and capacity rules. Inspect the returned native state before continuing.

Plan save and review retain original native records. If a reply is lost, inspect those records before creating another plan or review. Extraction UUIDs and schedule request UUIDs provide native operation identity; changing an ID requests a different operation.

## Original seller and buyer handoff

A first publication initializes the target version store. Start its original versioned seller with the merchant's actual terms and snapshot selection:

```sh
starforge dataset-refresh configure \
  --state /private/inventory-dataset --payment /private/inventory-payment.json \
  --origin https://merchant.example --path /data --snapshot-selection \
  --out /private/inventory-seller.json
starforge dataset-refresh serve \
  --state /private/inventory-dataset --seller /private/inventory-seller.json --port 8423
```

The existing facilitator options select native payment operation; the original default remains challenge-only. The maintained seller and HTTPS deployment instructions govern its public availability. If necessary, add the seller/resource pair to the host connection and restart MCP so the publisher opens with the actual advertised resource.

Call `merchant_publisher_buyer_offer` with the candidate run and a first-page query such as `limit=3`. The original target preview and seller health/offers readers verify its snapshot selector and return every advertised payment alternative, exact resource and `offerSha256`.

Choose the actual `acceptIndex` and a unique buyer `intentId`, then call `merchant_publisher_buyer_prepare` with that same run/query and offer digest. The original preparation reloads the offer, refuses changed terms and retains the exact SF88 configuration. The result includes `configText`, `configSha256`, `handoffId`, the original event ID and selected snapshot.

Save those exact `configText` bytes as the customer's buyer JSON and use the existing [SF88 dataset acquisition](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/DATASETS.md) and [native signer setup](../../stellar/scf-starforge-20261009/sf103-native-buyer-signer/README.md) to review, configure, approve, execute and recover the purchase. Preparation itself does not sign, execute or approve spending.

After restart, `merchant_publisher_buyer_read` accepts the same alias, run UUID and handoff UUID. It loads the original private file and verifies it against the original publisher event digest. This returns the same bytes without another offer request, preparation or payment. Handoff UUIDs are also visible in the existing paged publisher event history. The adapter creates no second file registry or receipt store.

## Recurring maintenance

The [original publication policy](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/SCHEDULES.md) operates the same publisher instance. Use the current published extraction and actual running target to configure it through `merchant_publisher_schedule_save`.

The `policy` object uses the native fields: current control `revision`, `referenceRun`, `planDigest`, `expectedSnapshot`, `expectedRevision`, `intervalSeconds`, `minimumRows`, `maximumRows`, `maximumDropPercent` (integer or null), `onError` (`pause` or `next-interval`), `reviewer` and `note`. Saving records an immutable policy and leaves it paused.

| Tool | Result |
| --- | --- |
| `merchant_publisher_schedule` | Current policy/control revision, active/pending occurrence and paged history. |
| `merchant_publisher_schedule_enable` | Bind the displayed control revision and actual target snapshot/revision, then enable the saved interval. |
| `merchant_publisher_schedule_pause` | Stop future intervals; an already accepted refresh drains through the native publisher. |
| `merchant_publisher_schedule_run` | Start one original occurrence with the current revision and explicit `requestId` UUID; inspect that same occurrence for completion. |
| `merchant_publisher_schedule_continue` | Explicitly continue the retained pending occurrence after inspecting the current outcome and target. |

The native scheduler retains the original run UUID before extraction, preserves committed candidates through restart, leaves identical snapshots unchanged, and keeps the last good dataset available when a query or policy check fails. Manual source/target changes retain the original review and rebind behavior. The adapter adds no separate timer, queue, extractor or publication writer.

## Reopen, cancellation and shutdown

| Native situation | MCP operation |
| --- | --- |
| Extraction still running | Inspect its original run/progress; `merchant_publisher_cancel` requests cancellation of that exact active extraction. |
| Committed candidate after interruption | `merchant_publisher_recover` uses the original candidate and recovery operation. |
| Publication outcome uncertain | Recover and inspect the actual current target before another explicit publication; continue the retained schedule occurrence where applicable. |
| Stale target/review/control revision | Read current native state and use its actual identities for the next intended change. |
| Finished session | Close the exact `instanceId` returned by open/status. Saved plans, runs, reviews, policy and handoffs remain. |

The native controller keeps asynchronous extraction/refresh ownership after a tool returns. On close, the adapter immediately stops future intervals through the original scheduler, waits for its in-flight reads and that scheduler's accepted work, and closes the original publisher through their existing drain/cancellation methods. A host shutdown closes all publisher instances it owns. The kernel lease releases; a new MCP process can open the same directories, or the original publisher browser/CLI can take them over.

Directory paths and SQLite file locations stay in host configuration. MCP views preserve original hashes and source/operation identity while omitting those local paths. Public candidate rows and their native schema are returned unchanged. Original publisher storage, source, conflict and recovery codes remain actionable in errors.

