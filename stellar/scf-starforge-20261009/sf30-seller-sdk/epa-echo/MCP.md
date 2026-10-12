# EPA ECHO merchant tools and original file receiving

This adapter connects the original merchant MCP host to an already running EPA ECHO facility-portfolio workspace. Staff and agents operate the same source reports, portfolio history, immutable editions, review records, dataset publishers and customer files. The host selects the original workspace UUID and its private session reference.

The source-owned provider is `epa-echo-workspaces`, with configuration family `echoWorkspaces`. The distribution contribution registers its lazy descriptor. The original merchant host supplies dispatch, authentication, operation logging and retained downloads.

## Start the original operator workspace

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/workspace.mjs \
  --workspace /absolute/private/epa-echo \
  --inbox /absolute/private/original-sf88-inbox \
  --release-runtime /absolute/private/merchant-runtime.json \
  --startup-format json
```

The startup record has schema `stellar-forge.epa-echo-workspace-startup.v1` and status `EPA_ECHO_READY`. It reports the original workspace UUID, source directory, private inbox and selected runtime file. Its private URL carries the browser session capability in the fragment. Preserve the URL in a private file owned by the current host user; the browser exchanges it for the normal Authorization header and removes it from the address bar.

The `--inbox` and `--release-runtime` settings are optional. The native SF82 normalizer interprets the selected runtime JSON with `port`, `facilitator` and `allowLocalFacilitator`. A configured publisher remains the original workspace-owned publisher. The managed Applications launcher reopens the same workspace through its saved UUID and current private startup URL record.

## Select host-owned workspace and package references

Create an owned mode-0600 connection JSON:

```json
{
  "schema": "stellar-forge.epa-echo-workspace-connection.v1",
  "workspaces": {
    "portfolio": {
      "label": "Original facility portfolio",
      "workspaceId": "REPLACE_WITH_ORIGINAL_WORKSPACE_UUID",
      "consoleUrlFile": "./epa-echo-session-url.txt",
      "sourcePackages": {
        "dc_facilities": {
          "path": "./original-epa-source.json",
          "sha256": "REPLACE_WITH_EXACT_ORIGINAL_FILE_SHA256",
          "label": "Selected original EPA source"
        }
      },
      "workspacePackages": {
        "partner_workspace": {
          "path": "./original-workspace-package.json",
          "sha256": "REPLACE_WITH_EXACT_ORIGINAL_FILE_SHA256",
          "label": "Original workspace receiving package"
        }
      }
    }
  }
}
```

Choose exactly one session reference for each alias:

| Reference | Value |
|---|---|
| `consoleUrlFile` | Private file containing the current original loopback session URL |
| `consoleUrlEnv` | Name of the host environment variable containing that URL |
| `applicationUrlFile` | The original managed Applications URL record for this exact workspace UUID |

The adapter authenticates the original schema and workspace identity before each new console operation. A port change is accommodated by updating the same selected session reference. Package aliases remain pinned to their original file SHA256; the host reviews a new file before changing that selection.

Initialize the original merchant host once:

```js
import {initializeEchoWorkspaceMerchant} from './stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/merchant-setup.mjs';
const result = await initializeEchoWorkspaceMerchant({
  directory: '/absolute/private/epa-merchant',
  connection: '/absolute/private/echo-connection.json',
  name: 'Facility portfolio operations'
});
```

The result names the original `merchant-mcp.json` configuration and selected workspace aliases. Start it through the maintained merchant MCP launcher. Trusted JavaScript integrations can supply `providerOptions: {echo: {environment, fetchImpl}}` to `startMerchantMcp`; this uses the original generic registry injection seam.

## Full operator tools

There are 35 product tools. Read the current schema before selecting actual table names or field filters.

| Tool family | Original operation |
|---|---|
| `merchant_echo_workspaces`, `schema`, `view` | Host aliases, original source contract, current revision and retained working records |
| `merchant_echo_editions`, `edition`, `rows` | Full immutable edition archive and actual schema-defined rows |
| `merchant_echo_facility`, `search` | Full selected facility detail and paged retained original search result |
| `merchant_echo_received_workspace` | Original received state, editions and file manifest |
| `merchant_echo_files`, `file_read`, `file_release` | Exact original file metadata and retained SHA256-bound chunks |
| `merchant_echo_portfolio_save`, `portfolio_archive` | Facility selection, customer/owner instructions and retained history |
| `merchant_echo_facility_search` | Original provider query and retained source result |
| `merchant_echo_capture_start`, `capture_resume`, `capture_pause`, `capture_import` | Complete report acquisition, same-capture continuation and original package import |
| `merchant_echo_edition_select`, `edition_compare` | Original edition selection and complete source changes |
| `merchant_echo_review_save` | Source-linked decision, owner, due date and review history |
| `merchant_echo_dataset_prepare`, `dataset_query` | Original SF30 preparation and exact fields/filter/sort/cursor query |
| `merchant_echo_release_prepare`, `release_inspect`, `release_activate`, `release_start`, `release_stop`, `release_rollback` | Original publisher selection, generation and runtime lifecycle |
| `merchant_echo_buyer_inspect`, `buyer_receive` | Ordered original SF88 outcomes and complete SF100 customer files |
| `merchant_echo_export_create`, `workspace_export`, `workspace_receive` | Edition exports and complete original workspace receiving |

Every action takes `workspace`, `operationId`, `expectedRevision` and its declared action fields. Retain the exact request before submission. After an unknown response, read the original view and repeat the same request. The original journal checks its action/payload identity before current-revision admission. A changed payload is a separately reviewed operation.

The full edition archive uses an explicit offset, limit and retained revision. Continue following pages with the returned revision. A concurrent workspace change returns the current view for review before starting the page sequence again.

`capture.import` accepts `sourcePackage`, a configured pinned alias. `workspace.receive` accepts `workspacePackage` in the same manner. The adapter reads the actual selected private file (up to the shared 256-MiB serialized package limit), verifies its hash and submits that original bundle to the console. The original importer separately enforces its decoded-object and encoded-package ceilings. It keeps the request identity in its response even when the HTTP result is uncertain.

## Original source and regulatory data

The installed source schema declares the actual facility, permit, compliance, quarterly, inspection, enforcement, metadata and source-field tables. FRS identifiers, source program names, permit crossreferences and original program reporting dates stay attached to their original responses. An empty source value remains empty or null as supplied. Staff review records the team's decision alongside the source; the provider's dated reporting fields remain separately visible.

Dataset queries use the original engine:

- `fields=column_a,column_b` chooses declared fields.
- `where_COLUMN=value` applies equality.
- `gt_`, `gte_`, `lt_` and `lte_` use the original typed column ordering.
- `sort=COLUMN` or `sort=-COLUMN` chooses ascending or descending order.
- `limit` and the exact returned `nextCursor` continue the original selection.

Use the declared ISO date fields for chronological filtering. Original `MM/DD/YYYY` display dates are retained source strings. The original engine enforces its filter, range, sort and total parameter limits.

## Receive complete original files

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/mcp-client.mjs tools \
  --url http://127.0.0.1:PORT/mcp --workspace portfolio --token-env MERCHANT_TOKEN
```

The same client offers `call` and `action` using one private request JSON. `action` reads:

```json
{
  "action": "workspace.export",
  "payload": {},
  "operationId": "KEEP_THE_ORIGINAL_OPERATION_ID",
  "expectedRevision": 12
}
```

Select a retained export ID from the returned original view:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/mcp-client.mjs download \
  --url http://127.0.0.1:PORT/mcp --workspace portfolio --token-env MERCHANT_TOKEN \
  --kind export --id ORIGINAL_EXPORT_ID --workspace-id ORIGINAL_WORKSPACE_UUID \
  --out /absolute/private/received-original-workspace
```

File selectors are:

| Kind | Selection |
|---|---|
| `source` | Original immutable edition ID; optional `--page` and `--wire true` |
| `export` | Original saved export ID, including the complete workspace package |
| `receipt` | Original customer receipt, preserving all five native customer files |
| `workspace` | Original received-workspace ID; optional exact `--path` from its file manifest |

The five customer filenames are `dataset.csv`, `dataset.jsonl`, `review.html`, `delivery.json` and `manifest.json`. Their original intent order and dataset metadata travel in `echo-transfer.json`.

A received-workspace file transfer records every original relative path with a collision-free local filename. The complete `workspace.export` package is available as one original file when a large collection would exceed the 65-KB receiving index. Original source and working files remain available individually through their manifest paths.

Downloads bind the authenticated workspace UUID, original file selection and complete manifest SHA256. They use the maintained locked download journal. A listener restart on a new port resumes the same original file; an older URL-based checkpoint is adopted only after the original locked loader checks the full saved manifest and selected bytes. `--manifest-sha256` can require a reviewed transfer index.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/mcp-client.mjs reopen \
  --out /absolute/private/received-original-workspace \
  --manifest-sha256 REVIEWED_TRANSFER_SHA256
```

Offline reopen hashes every completed original file. Interrupted chunks remain in the same receiving directory for continuation.

The provider closes by draining its pending calls and retained reads. A failed close keeps the original read owner available for the same close continuation. The existing browser workspace continues to own its writer and original publisher lifecycle.
