# MongoDB merchant workspace

An industrial browser application over the native MongoDB merchant store. The CLI and browser use the same immutable source/plan revisions, aggregation compiler, BSON parameter binder, package generator and original seller/buyer lifecycle.

## Open

Install the native MongoDB adapter dependencies described in [the MongoDB guide](../README.md). Use Node 22.16 or newer and Linux for the native retained store's file lock. Set the database URI in the environment named by the source's `connection.uriEnv`; the URI value remains in the local process.

Create a workspace from the original source and merchant-plan files:

```sh
node workspace/server.mjs \
  --state /private/mongo-merchant \
  --source /private/source.json \
  --plan /private/merchant-plan.json
```

Open the exact browser URL printed by the terminal. A random fragment token authorizes this local session. Reopen the same saved source and plan after removing the original import files:

```sh
node workspace/server.mjs --state /private/mongo-merchant
```

Use a new private directory to import another certificate profile. The browser displays the retained certificate filename; the native importer copies the chosen CA into the revision and every prepared package.

## Operator workflow

1. **Data source.** Review the retained database, URI environment name and TLS policy. Inspect the saved source to read real collection definitions, sampled field paths, BSON type counts, missing-field counts, sample values, and index availability. The catalogue records its sample method, server/driver versions, topology and capture time.
2. **Named reports.** Choose the collection, fixed aggregation pipeline, public output columns, read concern, row/byte limits and timeout. Define typed inputs and reference each as `$$sf30_parameterName`. The original binder supplies values as aggregation variables containing `$literal`. The complete source/report editors preserve supported pipeline and parameter options.
3. **Merchant routes.** Bind each HTTP route to a named report. Supply every input description and an explicit public example. Retain all payment choices, route overrides and complete `extra` objects. Atomic amounts stay strings throughout editing, compilation and buyer preparation.
4. **Review and run.** Compile the draft to inspect the exact original offer. Save before executing. Run a fixed saved pipeline against the actual configured MongoDB source; inspect canonical Extended JSON values, observed column types, missing fields, truncation and the native read/session metadata. Download the complete returned result.
5. **Seller packages.** Prepare the selected native revision, download individual original files or the complete standard `.tar.gz`, and start that package's local seller. Open its original operations console. Select a route, payment choice, intent and exact inputs to prepare the original buyer review from the running seller's current offer.

The provided HPD examples use official public building-in-project records. Their production-event totals, recorded BBLs and source coverage remain distinct measures. The native guide and data importer explain their source semantics.

## Revisions and concurrent authoring

Saving commits the full source and merchant plan together through the native Linux file lock and expected revision check. An independent CLI or another browser can advance the same workspace. A history refresh displays that newer head while retaining this tab's original expected revision; saving an older draft returns a conflict until the operator reloads or explicitly reconciles the draft.

The browser retains unsaved tab edits and unapplied JSON in session storage. Reopening a tab at the same revision restores them. If the native head has advanced, the saved tab draft remains available through **Restore tab draft**. Historical versions can be opened for inspection and saved as a new current revision.

Source inspection, query execution and export use saved revisions. The saved query result includes the exact revision, request inputs and native result. Each prepared package is immutable and revalidated before it is started or downloaded.

## Native query and buyer behavior

Canonical Extended JSON preserves ObjectId, Int64, Decimal128, Date, binary and nested BSON values. An integer such as `900719925474099312` is displayed as its exact `$numberLong` string. Missing projected fields remain distinguishable from explicit BSON null.

Snapshot reads require a replica set or sharded server. The UI also supports the original majority and local read concerns. Sampling describes observed documents; the native catalogue reports the actual sampling method and per-field coverage.

Starting a local merchant calls `startMongoSeller` with the selected package's original `source.json` and `service.json`. The browser uses the original default challenge-only seller mode. Facilitator/signer configuration and payment execution use the existing native merchant/operator workflows described in the parent guide. The live seller mode is shown beside its origin.

Buyer preparation reads the running original seller's health and offers, binds the exact inputs, checks the selected package's route and payment terms, and delegates to the original SF88 preparation function. Its download contains:

- The original buyer configuration and selected live offer.
- The exact JSON request body for a body-bearing route.
- The retained file manifest and a `relocate.mjs` helper.
- A short operator guide.

After moving the buyer package, `node relocate.mjs` checks the retained files and writes `review.local.json`. It changes only the local request-body path. The public resource, method, intent, selected offer and expected payment terms stay the same. Use the original SF88 review/execution commands with the operator's existing settings.

Stopping the merchant drains and closes its original seller, operations console and database source. Closing the workspace also closes its owned merchant.

## Retained files

The native workspace owns `workspace.json`, `revisions/` and the authoring lock. Browser material lives under its `browser/` directory:

| Directory | Retained material |
| --- | --- |
| `catalogues/` | Native schema samples linked to their saved revision |
| `results/` | Original query inputs, revision and complete native result |
| `packages/` | Original prepared source/service/OpenAPI/client packages |
| `package-links/` | Revision and manifest identity for each package |
| `buyers/` | Original offer, exact request body, buyer configuration and relocator |

Files and directories use private permissions. Downloads are selected from verified package manifests; they cannot request arbitrary local paths. The server binds to `127.0.0.1`, checks the exact Host and Origin, requires the fragment-derived bearer token for every API request, and applies a local-only content policy. No external browser asset is required.

## API surface

The browser calls a small local interface whose data operations compose the native modules:

| Operation | Native implementation |
| --- | --- |
| Bootstrap / history / open revision | `openMongoWorkspace`, `listMongoWorkspaceRevisions` |
| Save source and plan | `saveMongoWorkspacePlan` with expected revision |
| Review public offers | `validateMongoSource`, `compileMongoMerchantPlan` |
| Inspect current database | `inspectMongoWorkspace` |
| Execute saved report | `previewMongoWorkspace` |
| Prepare / reopen package | `prepareMongoWorkspace`, `verifyPreparedMongoSeller` |
| Start / stop merchant | `startMongoSeller` and its original `close` |
| Prepare buyer | `readMongoBuyerOffer`, `prepareMongoBuyer` |

The browser uses the existing query compiler, payment protocol, seller contract and plan store.
