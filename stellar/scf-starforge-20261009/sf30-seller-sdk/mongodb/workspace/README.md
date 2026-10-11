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

## Dataset publication and recurring refresh

The **Dataset publisher** tab takes a saved report through the maintained MongoDB
publisher, the original CSV dataset loader, the original retained version store,
and the existing publication scheduler. It uses the same immutable merchant
revision as the authoring workspace.

1. **Create a publication.** Select a saved merchant route and a fixed dataset
   resource path. The publication retains that route's source revision, public
   origin, description, service name, and every inherited or route-specific
   payment choice, including exact string amounts and option extensions.
2. **Save an extraction plan.** Set exact report inputs, public columns and scalar
   types, optional equality/range/sort capabilities, stable source ordering and
   extraction limits. Each plan is immutable. The UI retains an unsaved plan in
   session storage separately from the main source draft.
3. **Extract the complete report.** The native publisher exhausts the reviewed
   aggregation in one native source session and awaits the original CSV writer.
   The live report's response-row limit does not truncate this extraction.
   Authored pipeline limits remain part of the report. Exceeding any extraction
   budget produces a failed run, with the current published dataset preserved.
   The UI follows the original run identifier through completion or cancellation.
4. **Review and publish.** Inspect a candidate page and its exact source read,
   schema, row count and retained snapshot. Enter a reviewer and review note.
   Initial publication creates the native dataset store; subsequent publication
   compares the displayed current snapshot and target revision before the
   original writer activates the candidate.
5. **Start the dataset seller.** The workbench generates the original seller
   configuration from the native dataset query capabilities, retaining every
   merchant payment option. The seller advertises the original optional snapshot
   selector. Its developer explorer, current mode and retained versions are
   available in the same tab. A still-retained version can be explicitly
   activated against the displayed current target.
6. **Configure recurring publication.** Select the current published extraction
   as the baseline, set the interval and row criteria, and save the original
   schedule policy. Enable it or run one explicit refresh. The maintained
   scheduler owns the extraction, review, source/target binding, recovery and
   publication history; unchanged data retains the current version.
7. **Prepare the buyer handoff.** Select an extraction, inspect a first-page
   query, and load the running seller's current offer. Choose the payment
   alternative and buyer intent. The original SF88 preparation pins the
   selected retained snapshot. Download the native review and original offer
   together, or download the candidate CSV, dataset configuration and extraction
   manifest individually.

CSV column names must use the original dataset naming rules. Alias an unsupported
MongoDB field in the fixed aggregation before publishing it. The extraction
order can still use a declared source column that is omitted from the public CSV.
String projection preserves exact Int64/Decimal128 text and canonical Extended
JSON for structured BSON. Integer projection requires safe integers. Missing
fields require an explicit source projection; nullable empty CSV cells represent
null, so the original publisher rejects a real empty string in a nullable column.

The workbench uses the original schedule controls directly. Reopening restores
every publication's source revision, plans, runs, enabled policies and explicitly
started dataset sellers. Dataset sellers start before their schedules resume.
Stopping a dataset seller pauses future refreshes and drains that seller; closing
the whole workbench closes its original native lifetimes while retaining enabled
policies for the next launch.

To configure native dataset payment processing with the existing facilitator:

    node workspace/server.mjs --state /private/mongo-merchant \
      --dataset-facilitator https://facilitator.example

Local facilitator development additionally requires
--allow-local-dataset-facilitator. Supply the same facilitator option on each
launch. Embedding applications can supply the original datasetNativeFactory
function to startMongoWorkbench. The browser displays the seller's actual
CHALLENGE_ONLY or NATIVE_X402 mode. Buyer execution uses the existing SF88
operator flow.

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

Dataset publications add private publication-links/ and publications/ directories.
Each publication contains the original publisher database, plans and runs, the
native dataset version directory, retained seller configuration and service intent.
Original dataset buyer handoffs are retained in dataset-buyers/.

The publication endpoints remain behind the same local session authorization:

| Operation | Native implementation |
| --- | --- |
| Create / reopen publication | openMongoPublisher bound to the retained MongoDB revision |
| Save plan / extract / inspect / review / publish / reconcile | Original publisher methods and native MongoDB streaming driver |
| Start / stop dataset seller | openDatasetVersions and startVersionedDatasetSeller |
| Retained-version activation | Original datasetControl with expected snapshot and revision |
| Configure / enable / run / pause / continue refresh | Original openPostgresSchedule shared publication scheduler |
| Inspect / prepare dataset buyer | readDatasetBuyerOffer and prepareDatasetBuyer from the original SF88 handoff |

Candidate CSV downloads stream the verified original file. Dataset configuration
and extraction manifests use the same retained run. Clients cannot provide a
filesystem source path, target path, facilitator, driver or executable through a
publication request. Native facilitator setup belongs to the launch configuration.
