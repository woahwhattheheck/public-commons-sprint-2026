# Receive an economic source and customer edition

This guide travels with the original DBnomics publication plan and native merchant source files. It covers the full retained source, saved analyst work, original dataset publication and the existing SF82/SF88 merchant/customer path.

## One complete source operation

From a maintained Node 24/Linux source installation:

```sh
node sf30-seller-sdk/dbnomics/cli.mjs receive \
  --workspace /absolute/private/dbnomics-insee \
  --input /absolute/source/sf30-seller-sdk/dbnomics/examples/insee-ipc.receiving.json
```

The included configuration selects the two complete original INSEE response files. It creates four saved analyst reports and their complete JSON, CSV and HTML exports. The original publisher creates a candidate, reviews the exact target initialization and publishes the dataset. The same command imports the complete source/notes/report handover into its selected receiving project, verifies the received reports and reopens the original publication.

The command prints original phase results and saves its final result under:

```text
PROJECT/receiving/OPERATION_ID/operation.json
PROJECT/receiving/OPERATION_ID/publication-plan-input.json
PROJECT/receiving/OPERATION_ID/result.json
PROJECT/receiving/OPERATION_ID/delivery/
```

The final delivery includes each named report in three formats, `customer-dataset.csv`, `customer-edition.json` and `source-handover.json`. Their sizes and SHA256 values are in the result. The source handover contains every original captured response, the complete metadata and terms, saved query reviews, all note revisions and frozen report rows.

The native receiving configuration has this shape. The publication review note is limited to 2,000 characters by the original publisher:

```json
{
  "schema": "stellar-forge.dbnomics-receiving.v1",
  "id": "original-economic-receiving",
  "source": {
    "kind": "import",
    "file": "/absolute/private/response-import.json",
    "expectedSha256": "ORIGINAL_FILE_SHA256"
  },
  "reviewer": "Original source operator",
  "reviewNote": "The reviewed measure, frequency, source rights and intended customer selection.",
  "notes": [
    {
      "id": "measurement-scope",
      "author": "Analyst",
      "tag": "measurement",
      "text": "A whole-edition note bound to this exact capture."
    }
  ],
  "reports": [
    {"name": "levels", "spec": {"title": "Original observations", "method": "level"}}
  ],
  "query": {"name": "economic_source", "includeMissing": true},
  "receivingDirectory": "/absolute/private/economic-source-received",
  "waitMs": 120000
}
```

An observation note adds the exact `seriesId` and original `period`. Reports may select series, ISO-date bounds, calendar lag or an explicit index base. Use `source:{kind:"example"}` for the included original responses. Use `source:{kind:"live",selection:{title,seriesIds},rights?,timeoutMs?}` for one current official acquisition. That live acquisition is retained under the same `OPERATION_ID-source`.

The original input hash and extraction UUID are saved before downstream work. Repeating the command continues those exact operations. A changed input needs a separately selected operation; do not rewrite an existing operation's source selection.

## Open, review and export

```sh
node sf30-seller-sdk/dbnomics/cli.mjs serve --workspace PROJECT --port 8459
node sf30-seller-sdk/dbnomics/cli.mjs project-status --workspace PROJECT
node sf30-seller-sdk/dbnomics/cli.mjs operation --workspace PROJECT --id ORIGINAL_OPERATION
```

Use one process per project. The normal CLI and browser share the original publisher lock. The browser retains dirty note drafts and pending mutation identities; the original operation endpoint returns the result after an interrupted HTTP response.

To export source and analysis from the CLI:

```sh
node sf30-seller-sdk/dbnomics/cli.mjs export-sources \
  --workspace PROJECT --out /absolute/private/source-handover.json
node sf30-seller-sdk/dbnomics/cli.mjs export-report \
  --workspace PROJECT --id REPORT_ID --format html --out /absolute/private/briefing.html
node sf30-seller-sdk/dbnomics/cli.mjs export-report \
  --workspace PROJECT --id REPORT_ID --format csv --out /absolute/private/observations.csv
```

Receive the same source handover through the maintained importer:

```sh
node sf30-seller-sdk/dbnomics/cli.mjs init --workspace RECEIVING_PROJECT
node sf30-seller-sdk/dbnomics/cli.mjs import-sources \
  --workspace RECEIVING_PROJECT --id ORIGINAL_RECEIVING_ID \
  --file /absolute/private/source-handover.json
node sf30-seller-sdk/dbnomics/cli.mjs serve --workspace RECEIVING_PROJECT
```

The receiving project preserves capture IDs, source bytes, notes revisions and report identities. Its editable workspace has its own original publisher identity. The handover describes source and analyst work; the original project's publication/version-store and financial journals remain under their original project paths. Reopen those original paths to continue a merchant publication or Buyer session.

## Prepare the published merchant package

A native merchant package starts from the original `PUBLISHED` extraction. The source-query hash, capture hash, every original response, candidate, CSV and publication snapshot must agree.

Prepare a JSON input containing `runId`, absolute `outputDirectory`, the original native dataset `payment` object, the actual merchant HTTPS `origin` and its route `path`. Copy the already configured public payment terms from the original merchant operation. The maintained `buildDatasetSellerConfig` validates that object. The source provider's units and analyst values do not set the route price.

```sh
node sf30-seller-sdk/dbnomics/cli.mjs release-prepare \
  --workspace PROJECT --input RELEASE_PREPARATION.json
```

The package includes the native dataset/seller/binding configuration, full customer CSV and original source-file closure. `source.json` lists exact original paths and SHA256 bindings. Its `sourceGuide` identifies this guide inside the retained plan. Full source responses and the capture remain available for independent analyst receiving.

Optional preparation in the complete receiving configuration uses:

```json
{
  "release": {
    "paymentFile": "/absolute/private/existing-public-payment.json",
    "origin": "https://EXISTING_MERCHANT_ORIGIN",
    "path": "/economic-data",
    "outputDirectory": "/absolute/private/dbnomics-package",
    "releaseDirectory": "/absolute/private/original-release-store",
    "id": "original-dbnomics-release",
    "runtime": {"port": 0}
  }
}
```

That file contains the actual native payment object. The receiving operation retains its exact file path and SHA256 before preparing the package. It stages the release only when the existing release-store path is included.

## Stage and run the original release

The stage input is:

```json
{
  "packageDirectory": "/absolute/private/dbnomics-package",
  "releaseDirectory": "/absolute/private/original-release-store",
  "id": "original-dbnomics-release",
  "label": "Reviewed economic source",
  "runtime": {"port": 0}
}
```

Use the original facilitator fields in `runtime` when that configured deployment needs them. Then:

```sh
node sf30-seller-sdk/dbnomics/cli.mjs release-stage --input STAGE.json
node sf30-seller-sdk/dbnomics/cli.mjs release-activate --input ACTIVATION.json
node sf30-seller-sdk/dbnomics/cli.mjs release-run --input RUN.json
```

`ACTIVATION.json` is `{releaseDirectory,id,options:{expectedGeneration,reason?}}`; `RUN.json` is `{releaseDirectory,options?}`. These call the maintained SF82 generation, supervisor and dataset version controls. Preserve the original runtime's actual HTTPS origin, TLS transport, merchant account, facilitator and process handle. Reopen and reconcile the original release state after a process interruption before another activation.

## Prepare and continue the actual Buyer

Start the analyst server with the actual running seller address and resource:

```sh
node sf30-seller-sdk/dbnomics/cli.mjs serve --workspace PROJECT \
  --seller http://127.0.0.1:ACTUAL_MERCHANT_PORT \
  --resource https://EXISTING_MERCHANT_ORIGIN/economic-data
```

The original Buyer panel reads the live offer, locks the selected publication snapshot and prepares the existing SF88 Buyer configuration. Use its original intent ID, reviewed maximum atomic amount and existing authorization flow. The native dataset handler owns cursor pagination. The public client methods `buyerOffer` and `prepareBuyer` call this same path.

Continue the prepared original Buyer through the maintained SF88 CLI and its Dataset session. The original configuration specifies the exact resource, selected snapshot and offer; its outputs and page finalizations remain the custody record. Use the SF88 recovery/receiving commands printed by its installed `--help` and the original merchant's complete receiving guide.

## Complete the configured native customer operation

Add `customer` to the same receiving input when the intended deployment has its
original funded buyer configuration, accounting workspace and native merchant
transport. The complete shape is:

```json
{
  "release": {
    "paymentFile": "/absolute/private/existing-public-payment.json",
    "origin": "https://EXISTING_MERCHANT_ORIGIN",
    "path": "/economic-data",
    "outputDirectory": "/absolute/private/dbnomics-package",
    "releaseDirectory": "/absolute/private/original-release-store",
    "id": "original-dbnomics-release",
    "runtime": {
      "port": 0,
      "facilitator": "https://EXISTING_FACILITATOR_ORIGIN"
    },
    "activationOptions": {
      "expectedGeneration": 0,
      "reason": "Operate the reviewed DBnomics source edition"
    }
  },
  "customer": {
    "id": "original-dbnomics-customer",
    "configFile": "/absolute/private/original-buyer-settings.json",
    "operatorWorkspace": "/absolute/private/original-accounting-workspace",
    "pageSize": 250,
    "maxPages": 2,
    "maxTotalAtomic": "20000",
    "maxPageBytes": 1048576,
    "acceptIndex": 0
  }
}
```

This is a configuration shape. Select the actual public terms, account paths,
facilitator configuration and native generation from the intended original
operation. The illustrated `20000` total is suitable only when that original
offer and policy allow two pages at `10000` atomic units each. The complete
468-row included source fits two pages at page size 250. The native offer and
spend governor enforce the actual selected price and ceiling.

`release.runtime.facilitator` is the original facilitator URL. Select the actual
HTTPS endpoint; an original loopback facilitator additionally needs its reviewed
`allowLocalFacilitator:true` runtime option. Transport and account configuration
remain in the existing native operator. `activationOptions.expectedGeneration` is required by the native
selection operation; read the current release store first. `runOptions` may
supply the native startup and shutdown settings. The receiver binds the actual
activated generation and passes it into the original supervised launcher.

The receiving command performs the whole customer continuation:

1. Prepare and stage the reviewed source-complete release.
2. Select that exact native release under the reviewed generation and start its
   original merchant. A resumed selection verifies the retained generation and
   original activation history.
3. Read the actual native offer, bind the published snapshot and prepare the
   original SF88 dataset configuration.
4. Create or reopen the same Dataset session with the original buyer settings,
   selected offer, page capacity and total atomic ceiling.
5. Retrieve all original cursor pages and finish every page's accounting in the
   selected SF36 operator workspace.
6. Create the original SF100 Dataset delivery, compare every received typed
   observation with the reviewed source, and retain the complete capture,
   source query and source/analysis handover beside it.
7. Reopen the same delivery, compare every observation and source companion,
   close the original merchant, receive the editable analyst source and reopen
   the original published project.

The customer checkpoint is
`PROJECT/receiving/OPERATION_ID/customer/customer.json`. It retains the original
buyer selection, limits, source and publication bindings, activation generation,
Dataset acquisition, accounting reports and delivery. Its `buyer-delivery/`
directory contains the complete native customer output and exact source
companions. The outer `result.json` includes this completed customer result.

The buyer settings file is read privately and bound by digest. Keep payer
material, private keys and credentials in their existing account custody.
The operation records file paths and public payment selections. An interruption
reopens the same Dataset and original finalizations. A changed customer
configuration is reported against its retained binding before another purchase.

For a receiving project with an existing target, the publisher reviews the
actual running target's snapshot and revision. New targets use the original
initialization action. Start an existing target through its original release
before publishing a new economic edition into that target.

## Receive an interrupted operation

Read the original saved operation first. Successful provider returns are retained before capture assembly, so a missing local receipt can be recovered from exact completed response bytes. A provider's Retry-After remains its actual absolute deadline.

The plan uses a stable DBnomics operation ID; extraction uses a separate saved original UUID. An existing completed extraction is reused. The publisher's `recover` command reconciles uncertain publication against the actual original dataset version. The source handover and report exports are immutable exact files; receiving checks them before importing and again after reopening.

Keep the original receiving configuration, project paths, operation journal, source files and final result together. The printed result file provides a single entrypoint to the complete analyst, source, publication and receiving outputs.
