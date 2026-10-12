# Captured OpenSearch datasets

Turn an existing, completed OpenSearch capture into a runnable, versioned dataset service. The operator can query its saved rows, publish another captured edition, export a typed client, select an older edition, stop the service, and reopen the retained state.

The product uses the existing Starforge dataset query engine, version store, seller runtime, operator workspace, and client generator. Every prepared edition carries the exact original OpenSearch result and the original edition identity. The named mode is **CAPTURED_EDITION**: requests query the rows present in that captured result.

## Start with an existing package

Requirements: Node.js 24 or later, Linux with the original util-linux `flock` executable, and this complete Starforge source tree. The dataset writer uses its existing kernel file lock. The package and version directories belong to the operator and should be writable only by that operator.

From `stellar/scf-starforge-20261009/sf30-seller-sdk`, the common entry is `node dataset-cli.mjs opensearch-captured ...`. The direct `node opensearch/captured-dataset.mjs ...` commands below expose the same product operations.

~~~bash
node opensearch/captured-dataset.mjs inspect \
  --package /absolute/path/captured-package

node opensearch/captured-dataset.mjs serve \
  --package /absolute/path/captured-package \
  --release /absolute/path/captured-release \
  --port 0 \
  --workspace-port 0 \
  --client-out /absolute/path/client-edition-one \
  --client-id captured-edition-one
~~~

The command prints:

| Field | Use |
|---|---|
| `mode` | `CAPTURED_EDITION`, the declared saved-data mode |
| `source` | Original workspace, source profile, edition, capture query, result SHA-256, row count, and source metadata |
| `seller` | The local original dataset seller address |
| `operator` | The private operator workspace URL, including its local access token |
| `versions` | Current snapshot, revision, and retained editions |
| `client` | The complete generated client and its original completion manifest |

Open the printed operator URL. Its existing interface supports field selection, filters, numeric ranges, ordering, pagination, saved-query export, and snapshot selection. The operator controls refresh and rollback through the original authenticated local service.

The seller keeps the public origin and payment terms chosen for this captured service. With no facilitator configured, the original seller advertises its normal payment challenge; the authenticated local operator can inspect and query the saved data. The receiving workflow builds the exported client's typed request locally. For a configured paid seller, pass `--facilitator HTTPS_FACILITATOR_URL` to `serve`. The option is validated and forwarded to the original SF82 dataset release, which selects the existing HTTP facilitator client and native seller verification/query/settlement path. The payment terms remain the original selected terms. The local receiving command leaves this optional facilitator setting unset.

Keep the printed operator URL private. Its token grants access to the local operator surface. Stopping and reopening creates fresh live control state while preserving the version history.

Press Ctrl+C to close the operator and seller. The command waits for active client exports and drains the original services before the writer lock is released. Start the same command again with the same package and release paths to reopen the current retained version. Omit `--client-out` and `--client-id` when an additional export is not needed.

## Prepare a package from an original capture

Use the original OpenSearch workspace, its source-profile SHA-256, and a completed edition ID. The public payment file is a JSON object containing the original seller payment fields: `scheme`, `network`, `amount`, `asset`, and `payTo`.

~~~bash
node opensearch/captured-dataset.mjs prepare \
  --workspace /absolute/path/original-opensearch-workspace \
  --profile ORIGINAL_SOURCE_PROFILE_SHA256 \
  --edition ORIGINAL_COMPLETED_EDITION_ID \
  --out /absolute/path/captured-package \
  --state /absolute/path/captured-versions \
  --payment /absolute/path/public-payment-terms.json \
  --origin https://your-public-seller.example \
  --path /captured-results
~~~

Choose a new package directory and a separate version directory. Preparation reads the selected original result from the existing workspace and writes eight immutable files:

| File | Contents |
|---|---|
| `dataset.csv` | The captured hits projected into the original CSV query engine |
| `dataset.json` | Declared columns, filters, ranges, sorting, and bounded native query configuration |
| `seller.json` | Public origin, original seller offer, query contract, and snapshot selector |
| `binding.json` | The selected original version directory, initial snapshot, and query-contract hash |
| `source.json` | Captured mode, original identities, query and result provenance, projection, and source-file descriptors |
| `capture/result.json` | The exact original retained OpenSearch response bytes |
| `capture/edition.json` | The original edition and result identity |
| `capture/projection.json` | The explicit mapping from original source fields into query columns |

An identical preparation can reopen its first completed package. A conflicting file is preserved and reported, so an operator can select a new output directory. Inspection verifies the native package and recomputes the dataset projection from the exact original hits.

### The saved query contract

Every dataset includes these source-preserving columns:

| Column | Native type | Meaning |
|---|---|---|
| `rank` | integer | One-based row order in the original completed capture |
| `document_index` | string | Original OpenSearch index |
| `document_id` | string | Original document ID |
| `score_json` | string | Original score encoded as JSON |
| `source_json` | string | Complete original source object encoded as JSON |
| `sort_json` | string | Original hit's sort values encoded as JSON |
| `exact_integer_paths_json` | string | Original parser's exact-integer metadata encoded as JSON |

The capture's total, truncation flag, original query inputs, cluster/source metadata, result digest, and capture time remain in `source.json` and the original response. A captured result with six rows produces a six-row dataset; any larger total reported by OpenSearch remains separate source metadata.

To expose additional source fields as directly queryable columns, pass `--projection /absolute/path/projection-options.json`. Its object accepts:

| Property | Value |
|---|---|
| `projection` | Array of mappings with `field`, `name`, `type`, optional `nullable`, and optional `encoding: "json"` |
| `filters` | Array of declared column names available for equality filtering |
| `ranges` | Array of declared numeric column names available for range queries |
| `sorts` | Array of declared column names available for ordering |

Projection types are `string`, `integer`, `number`, and `boolean`. JSON encoding retains a structured source field as a JSON string. Native integer columns require safe exact JavaScript integers; the original response bytes and exact-integer metadata remain available for values requiring their original representation.

Use the same projection and public seller terms for every edition published into a version store. Its original binding checks the workspace, source profile, dataset contract, and seller bytes before publication. A contract change belongs in a separate version store.

The receiving workflow's `projection.json` records its actual selected mappings. It derives them only from fields in the retained source responses and keeps both original response files alongside the result.

## Publish another completed capture

Prepare the second edition with the same `--state`, public terms, origin, path, and projection, using a new package directory.

Keep the existing service running and inspect its current state:

~~~bash
node opensearch/captured-dataset.mjs status \
  --state /absolute/path/captured-versions
~~~

Use the returned current snapshot and revision in the original compare-and-swap publication:

~~~bash
node opensearch/captured-dataset.mjs publish \
  --package /absolute/path/second-captured-package \
  --expect CURRENT_SNAPSHOT_SHA256 \
  --expect-revision CURRENT_REVISION
~~~

Publication selects the second dataset through the original running writer. Existing requests and continuation cursors retain the engine's original snapshot behavior. The public query and offer contract stays the same.

The built-in initial policy retains up to eight versions with a one-day minimum age and a 512 MiB retained-source budget. These are the original engine's retention settings; they do not allocate that amount of memory or disk in advance. Actual receiving declarations should account for the retained files and the running process.

A conflicting current snapshot or revision returns the original conflict. Read the state again and decide which captured edition should become current.

## Query and return to an earlier edition

The operator UI exposes the original field and query contract. Select a retained snapshot and page through its rows. Exports carry the selected snapshot so the request remains tied to that saved edition.

To return to an earlier version from the command line:

~~~bash
node opensearch/captured-dataset.mjs activate \
  --state /absolute/path/captured-versions \
  --snapshot RETAINED_SNAPSHOT_SHA256 \
  --expect CURRENT_SNAPSHOT_SHA256 \
  --expect-revision CURRENT_REVISION
~~~

The same action is available in the operator workspace. It uses the original version ledger and preserves the other retained edition.

The receiving customer workflow exercises the actual seven-row and six-row OpenSearch captures, pages their native dataset results, applies a numeric range and reverse order, exports both clients, selects the seven-row edition again, and closes the process. A separate Node process then reopens the same state, queries both snapshots, and verifies the retained source and client bytes.

## Generated customer client

Each export contains the original five client files plus its completion manifest:

- `seller-client.mjs`
- `seller-client.d.mts`
- `seller-openapi.json`
- `package.json`
- `README.md`
- `client-export.json`

The manifest records the exact original OpenAPI digest, file hashes, and the selected export ID. The client can construct a typed request with an explicit `snapshot` query argument without opening a network connection. The receiving output includes a constructed request recipe for each edition.

Keep a completed export directory intact. Reusing its ID and path verifies its exact retained source; choose a new directory and export ID for a different original API description.

The original private query workspace also exports the observed query result. This gives an operator the saved rows and a public request recipe for the same selected dataset snapshot.

## Move or restore a delivery

A prepared package binds an absolute version-store directory. Use the supported receiving action to create a new package with a different declared state location:

~~~bash
node opensearch/captured-dataset.mjs rebind \
  --package /absolute/path/original-captured-package \
  --state /new/absolute/path/captured-versions \
  --out /new/absolute/path/receiving-package
~~~

Rebinding changes only the declared receiving version path in the new immutable package. It preserves the original captured response, projection, query contract, and public seller terms.

For a complete running history, stop the original seller cleanly, preserve the entire version directory, and copy it intact to the new declared location. Preserve both immutable capture packages and both client directories. Rebind each capture package to that same new version directory and use a new staged release directory. The original version ledger retains its current selection and history.

If the receiving version directory is empty, serving a rebound package initializes that selected edition through the original writer. A second captured package can then be published with the same original compare-and-swap operation.

## Complete receiving command

`receiving/run-captured-dataset.py` assembles the original saved source archive together with the declared captured-product source and the original dataset workspace assets. It holds the existing receiver lock across two child processes and preserves the original live checkpoint.

~~~bash
python3 -B opensearch/receiving/run-captured-dataset.py \
  --directory /absolute/path/original-receiver \
  --output /absolute/path/captured-product \
  --archive /absolute/path/original-source-runtime.zip \
  --expected-archive-sha256 ORIGINAL_SOURCE_ARCHIVE_SHA256 \
  --selection /absolute/path/captured-customer-selection.json \
  --source-root /absolute/path/complete-source-tree \
  --source-manifest /absolute/path/captured-source-selection.json \
  --runtime-root /absolute/path/reproducible-runtime \
  --node /absolute/path/node \
  --flock /absolute/path/flock
~~~

The customer selection uses schema `stellar-forge.opensearch-captured-customer.v1` and retains the original operation, workspace, source profile, original live-report digest, base edition/result/package, and completed upgrade-capture request IDs.

The separate source selection uses schema `stellar-forge.opensearch-captured-source-selection.v1`. Its `files` map contains the exact byte length, SHA-256, and mode of the twelve core maintained files listed in the bootstrap plus any explicitly selected common CLI and OpenSearch guide resources. A changed file already present in the base archive also declares `replacesSha256`, the exact retained original preimage; the base archive and its manifest remain intact. Keeping the input identity separate from the source edition allows an explicitly recorded source repair to continue the same captured customer history.

The output contains:

- `editions/`: both immutable capture packages with their original responses.
- `versions/` and `release/`: the original native version store and staged dataset seller.
- `clients/`: complete original client exports and locally constructed request recipes.
- `queries/`: actual native query observations, retained separately for each process attempt.
- `operator/`: the original interface assets used by the customer workflow.
- `source/`: a complete portable source ZIP and its exact assembly record.
- `captured-dataset-journey.json`: completed customer stages and fresh-process results.
- `receiving-run.json`: original inputs, source edition, child outcomes, and closure state.

The native driver installs the retained local transport boundary before product imports. It permits only listeners owned by that process and the exact original `flock` descriptor-lock invocation for its declared version directory. The bootstrap starts no upstream bridge. This receiving mode operates the original captured data and the original dataset runtime entirely on the receiving computer.
