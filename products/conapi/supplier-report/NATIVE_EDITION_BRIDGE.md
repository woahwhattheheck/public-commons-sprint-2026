# Native Datasette editions in supplier review

The native bridge receives an existing reviewed Datasette edition and turns its original approved projection into a supplier source edition. It uses the maintained Datasette reader and projector; its workspace retains the exact source row JSON, numeric tokens, full native metadata, approved projection, and original page references.

Place datasette-bridge.mjs beside supplier-report.mjs under products/conapi/supplier-report.


## Operate a selected native source

The supplied CLI now carries the complete native consumer. Keep the existing request ID, selected edition SHA-256, source selection and approved projection from the original Datasette operation.

| Entry point | Original input |
| --- | --- |
| compare --baseline-format native-edition | Reviewed edition.json beside every original capture/review member |
| compare --candidate-format native-archive | Complete original .datasette.json.gz source package |
| native-source | One selected native edition or archive, exported as complete source JSON |
| compare --baseline-format source-json | Complete earlier supplier source JSON with its original identities |
| Browser: Complete Datasette source archive | Full original archive read through the existing loopback server |
| receive | Completed supplier delivery directory with its unchanged manifest and all source archives |

Each side can use a different format. The comparison uses the same supplier rules and decision engine.

### Read the existing selected edition

From the installed supplier component:

    node supplier-report-cli.mjs native-source \
      --input /original/native/edition.json \
      --format native-edition \
      --native-sha256 ORIGINAL_EDITION_SHA256 \
      --out /original/work/candidate-source.json

Replace the path and hash with the actual retained values. This invokes the maintained readDatasetteEdition and exportDatasetteEdition functions. The result prints the complete source JSON path and the exact original archive path, byte count, SHA-256, edition hash and capture hash. Keep that archive with the source JSON.

The default standalone source ID comes from the original selection hash; its edition ID comes from the original edition hash. Optional --id, --source and --captured-at are explicit caller values. The read uses the source's original approved projection.

Read a delivered native archive instead:

    node supplier-report-cli.mjs native-source \
      --input /original/delivery/Source_Edition.datasette.json.gz \
      --format native-archive \
      --archive-sha256 ORIGINAL_ARCHIVE_SHA256 \
      --native-sha256 ORIGINAL_EDITION_SHA256 \
      --out /original/work/candidate-source.json

The original receiveDatasettePackage implementation restores and verifies every complete package member before the bridge reads the edition. Repeated use of the same archive reuses that exact verified receive directory.

### Compare source formats through the maintained CLI

Use the actual prior source edition and incoming selected archive:

    node supplier-report-cli.mjs compare \
      --baseline /original/prior/baseline-source.json \
      --baseline-format source-json \
      --candidate /original/incoming/source.datasette.json.gz \
      --candidate-format native-archive \
      --candidate-native-sha256 ORIGINAL_CANDIDATE_EDITION_SHA256 \
      --candidate-archive-sha256 ORIGINAL_CANDIDATE_ARCHIVE_SHA256 \
      --rules /original/work/rules.json \
      --request ORIGINAL_REQUEST_ID \
      --out /original/work/native.workspace.json

A source-json input recreates and checks the full original edition from its retained rows, metadata and digests. Its original edition ID, source ID and capture time remain unchanged. The native input receives request ID plus side as its supplier edition ID; the original native edition ID, source selection, review and archive identities remain in its source metadata.

CSV remains the default input format. Use --baseline-format csv or --candidate-format csv when mixing a CSV edition with a native source. Source-ID and capture-time overrides apply to the new CSV/native input; exported source JSON preserves its retained identity.

For decimal-price rules that require plain decimal spelling, add --numeric-format plain-decimal. Numeric transformation is described below. The default source format preserves the original native spelling.

### Continue the same workspace and export all source

Use inspect, decide, the browser or the existing workbook workflow on the saved comparison. To continue an already reviewed comparison, pass its existing workspace directly to export:

    node supplier-report-cli.mjs export \
      --workspace /original/work/native.reviewed.json \
      --out-dir /original/deliveries/native-supplier

When its original archive was moved, provide that exact file:

    node supplier-report-cli.mjs export \
      --workspace /original/work/native.reviewed.json \
      --candidate-native-archive /original/archives/candidate.datasette.json.gz \
      --out-dir /original/deliveries/native-supplier

There is a corresponding --baseline-native-archive option. Export first locates the explicit archive, the adjacent side archive, or the archive path retained by source intake. An original bridge workspace without an archive receipt can use its still-present edition files to export the original complete source package. The archive is read through the native receiver, and its complete source rows and approved projection must reproduce the saved supplier edition.

The exporter retains the complete workspace content, comparison ID, request ID, revision, source metadata, and decision history. It does not add a new archive receipt to an already saved source edition. New intake records the archive receipt inside that new edition; export binds every retained side archive in the delivery manifest.

Each native side adds:

| File | Complete retained content |
| --- | --- |
| baseline-source.json or candidate-source.json | Entire supplier source edition, original metadata, exact native row JSON and projection |
| baseline-native-source.datasette.json.gz or candidate-native-source.datasette.json.gz | Every original native edition/capture/review/page member |
| native-runtime.json | Full unchanged original native reader/runtime modules |
| datasette-bridge.mjs | Native projection-to-supplier source bridge |
| source-editions.mjs | Complete source JSON identity reopening |
| native-source-io.mjs | Original archive IO and local browser source intake |

The existing complete editor, core, CLI, workbook modules and operator guides remain in the same delivery. Every member, including native archives, has an exact byte count and SHA-256 in manifest.files. Native archive bindings additionally use:

    "nativeSources": {
      "candidate": {
        "archive": "candidate-native-source.datasette.json.gz",
        "bytes": 12345,
        "sha256": "ORIGINAL_ARCHIVE_SHA256",
        "editionSha256": "ORIGINAL_EDITION_SHA256",
        "captureSha256": "ORIGINAL_CAPTURE_SHA256"
      }
    }

The example values illustrate the schema. Actual exports write the retained source identities and byte counts.

### Independently receive the same comparison

Use the CLI carried by the completed delivery:

    node /downloaded/supplier/supplier-report-cli.mjs receive \
      --delivery /downloaded/supplier \
      --out-dir /received/supplier

Receiving checks the complete manifest and every original file, replays the saved workspace through the domain module, checks both full source editions, and independently restores the original native packages. It reproduces every projected row, original numeric token, full native metadata, projection transformation and page reference. Reviewed accepted CSV and lineage must reproduce the same finalized result.

The destination receives the complete original files and manifest unchanged. Its workspace retains the original filesystem observations from source capture while the newly received archives use their own local paths. The source identity comparison explicitly separates those path observations from original edition/capture/review content.

    node /received/supplier/supplier-report-cli.mjs inspect \
      --workspace /received/supplier/workspace.json

    node /received/supplier/supplier-report-cli.mjs serve --port 8765

Choose Open workspace and load the adjacent workspace.json. The same comparison ID, revision and decisions appear. Saving a later review produces an updated workspace while its original source editions remain intact.

### Browser source and archive operation

Choose each side's format in New comparison. Exported source JSON is parsed in the browser and retains its exact edition identity. Complete Datasette source archives are sent to this same loopback server and passed through the installed original native reader. The server returns the complete source edition to the existing review UI.

Save baseline source and Save candidate source download the original CSV or full source JSON. Baseline source archive and Candidate source archive download the original selected package. A received delivery serves the adjacent side archives by their original SHA-256. Earlier bridge workspaces preserve their original metadata without adding a new archive receipt; the browser resolves their delivered archive from the adjacent completed manifest using the original edition and capture hashes. The local host reopens that archive through the maintained native receiver and matches both identities before returning the download. The existing workbook panel and its complete review/correction/replay operation remain available on the same report.

### Original runtime and cache

The self-contained native-runtime.json retains the unchanged original four-module dependency set, with a Git blob identity for each complete source body. The loader verifies those source identities and materializes the original relative paths in the operating system's temporary directory:

- datasette/editions.mjs
- datasette/capture.mjs
- datasette/json.mjs
- postgres/publisher/files.mjs

All dependencies are Node built-ins. Customer source packages contain source data and original native members; the installed component selects the runtime.

An existing host may supply --native-directory with the absolute directory containing its maintained editions.mjs and json.mjs. Export then carries that selected original four-module runtime in the resulting delivery.

The --native-cache option selects a private local source-receiving directory. New CLI source intake defaults to a sibling of its output path with .sources appended; the local server defaults to .supplier-native-sources in its working directory. Cache files retain their complete original bytes and are reused only when they agree exactly. Original native size limits apply: 512 MiB compressed/archive capacity, 256 MiB total original package members, 64 MiB per member, and 20,000 package members.

## Join the existing native workflow

The NativeWorkflowAdapter continues to use the original delivery.supplier configuration and sourceBindings aliases. Its workspace value is the existing descriptor with path, bytes and sha256. Its component is the installed supplier component directory. Source aliases point to already prepared Analysis editions, with each role either baseline or candidate.

For a prepared native edition, the adapter now binds the supplier source to:

- The original Analysis edition ID, row count and collections.
- Native edition, capture and review SHA-256 identities.
- The exact original reviewed projection and source/projected column order.
- The complete supplier source file, source digest and edition digest.
- The complete native archive's original filename, byte count and SHA-256.

The native handover acquisition retains its original full source archive beside Original_Handover.json. The adapter supplies an already retained matching archive to the maintained CLI export when available. The existing supplier-workflow-link.json and nativeIds.supplier receive those bindings without replacing the outer operation, request, comparison or archive identities.

Use the same original workflow configuration and reviewed supplier workspace for the installed receiving continuation. A mixed native/CSV comparison retains each side's existing native or CSV binding. Catalogue coverage continues to use the separately selected original publisher CSVs through its maintained coverage operation.


## Bind the installed native functions

Import these exact functions from the existing installed Datasette component:

    import {
      readDatasetteEdition,
      projectDatasetteRow
    } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/editions.mjs';
    import {
      exactJson
    } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/json.mjs';
    import { createDatasetteBridge } from './datasette-bridge.mjs';
    import { serializeWorkspace } from './supplier-report.mjs';

    const bridge = createDatasetteBridge({
      readDatasetteEdition,
      projectDatasetteRow,
      exactJson
    });

These relative paths apply to the repository layout above. An installed host with another layout passes the same original functions from its existing module paths. The bridge module itself imports only the supplier core and adds no package dependencies.

The native edition reader verifies the original capture members, page receipts and response-body hashes; the completed page chain; the retained source selection; the reviewed projection; the edition operation; and the native edition file list. Pass the previously returned editionSha256 as expectedSha256 when continuing a selected edition.

## Compare two received native editions

Use the original business request ID and the actual native edition files and hashes already retained by the operation:

    const report = await bridge.compare({
      requestId: originalRequest.requestId,
      baseline: {
        editionFile: previousNative.editionFile,
        expectedSha256: previousNative.editionSha256,
        sourceId: previousSupplierSourceId,
        numericFormat: 'plain-decimal'
      },
      candidate: {
        editionFile: incomingNative.editionFile,
        expectedSha256: incomingNative.editionSha256,
        sourceId: incomingSupplierSourceId,
        numericFormat: 'plain-decimal'
      },
      rules: originalSupplierRules
    });

    const completeWorkspaceJSON = serializeWorkspace(report);

Persist completeWorkspaceJSON through the existing request's workspace writer. It is the same full workspace consumed by the supplied browser and command line:

    node supplier-report-cli.mjs inspect --workspace native.workspace.json

    node supplier-report-cli.mjs decide \
      --workspace native.workspace.json \
      --decisions decisions.json \
      --reviewer "Supplier operations" \
      --expected-revision 0 \
      --out native.reviewed.json \
      --finalize

    node supplier-report-cli.mjs export \
      --workspace native.reviewed.json \
      --out-dir native-delivery

The compare method defaults the supplier edition IDs to requestId + ':baseline' and requestId + ':candidate'. Explicit input IDs remain supported. Both originals are read independently unless the exact same edition file and expected hash are selected for both sides within this comparison. The native reader runs afresh for the next bridge call.

A rules recompare may include predecessor:{comparisonId,revision}; the supplier core retains that predecessor with its new comparison identity. Supply the actual previous comparison and revision.

## Receive one edition

Use readEdition when the caller already owns the other source or needs to prepare a complete source edition independently:

    const incoming = await bridge.readEdition({
      editionFile: incomingNative.editionFile,
      expectedSha256: incomingNative.editionSha256,
      id: originalRequest.requestId + ':candidate',
      sourceId: incomingSupplierSourceId,
      numericFormat: 'source',
      source: {
        requestId: originalRequest.requestId,
        sourceAlias: originalSourceAlias
      }
    });

The result is an ordinary supplier edition accepted by reconcile(). Its rawCSV is null because it came from reviewed native structured data. The existing exporter therefore writes its complete source as candidate-source.json or baseline-source.json.

| Input | Meaning |
| --- | --- |
| editionFile | Actual local native edition.json path, alongside its retained capture and review files |
| expectedSha256 | Optional retained native edition file hash; supplied when continuing an already selected original |
| id | Optional supplier edition ID; a standalone read defaults to datasette-edition: followed by the native edition hash |
| sourceId | Optional source-system identifier; defaults to datasette-selection: followed by the original selection hash |
| capturedAt | Optional explicit capture time; otherwise derived from a retained native time as described below |
| numericFormat | source, the default, or the explicit plain-decimal projection described below |
| source | Optional operator metadata, retained under source.operator |

The bridge always uses the native edition's already approved projection. The receiving operation continues to own source selection and projection review.

## Exact source values and numeric prices

The original native projector returns strings or null. Numeric source tokens remain exact text. The bridge calls the original exactJson on the complete original rows, so large numeric identifiers and original decimal token spelling survive in source.native.nativeRowsJSON. It never uses JSON.parse on that source text to turn numeric tokens into JavaScript numbers.

All projected aliases become supplier source columns, in their approved projection order. All original source columns and unprojected values remain in source.native.sourceColumns and nativeRowsJSON.

The two numeric formats are explicit:

| Format | Behavior |
| --- | --- |
| source | Retain the exact reviewed projection string, including exponent notation |
| plain-decimal | Expand exponent notation only for approved integer/number projections that use native or label representation |

plain-decimal moves the decimal point using integer/string operations. A source token such as 1.25e2 becomes the exact decimal string 125 for a numeric supplier field. Every changed projected token is retained in source.native.projectionTransformations, with its row number, column, original token, and projected value. The complete original native row JSON remains unchanged.

Text projections retain their original spelling in either mode. JSON representation stays JSON text. String identifiers retain leading zeros. Explicit null remains null; an empty string remains an empty string whenever the approved native projection permits it. The source/JSON/label distinction stays in the native projection.

The supplier core accepts decimal inputs of up to 4096 characters. Exponent expansion uses that same limit. Numeric context such as currency, billing period, unit and starting-price qualification belongs in the existing supplier rules; the bridge does not infer commercial comparison rules from a column title.

## Original page references and times

Native JSON rows have an ordinal within the completed capture. Supplier rowNumber and lineNumber both use that one-based native ordinal. source.rowNumbering records this meaning. source.native.pageRanges maps each ordinal range to the original page index, retained response-body file, and body SHA-256. Native JSON responses are therefore traced by page and row ordinal.

The capture-time default uses the first available retained value in this order:

1. The native capture's completedAt.
2. The end of the retained observation window, observationWindow.notAfter.
3. The native capture's committedAt.
4. The reviewed edition's createdAt.

An explicitly supplied capturedAt takes precedence. source.capturedAtBasis records which value was selected, and the complete original capture/review/edition metadata remains available. This keeps publisher effective dates separate from retrieval and native commitment dates.

## Complete source and workflow receiving

The supplier edition retains:

- Original edition and capture file paths and SHA-256 identities.
- The complete native edition, source capture and review metadata.
- Every original source column and row, serialized with the original exact JSON token writer.
- The original approved projection and projected column order.
- Explicit numeric projection transformations, if selected.
- Native page ranges and body references.
- Original source selection, operation IDs and retrieval observations within the retained metadata.
- Caller request/source metadata under source.operator.

The completed CLI export retains the original native source archive with this workspace in the existing workflow delivery. The archive contains the original response files and edition members referenced by the supplier source. The supplied receive command restores that source through the maintained native receiving operation before reproducing the supplier edition on another host.

The native CLI, browser and workflow adapter use the same bridge and full source representation. The original CSV publisher operation remains available beside this native entry point, and the existing native attachment helper carries every complete member under the original workflow's retained identities.

## Actual native source used for this integration

The bridge's interfaces were read from merchant commit 9f5bad38bed2bcfc52c8f7ff9bc11ec816a6aba8 and reconfirmed unchanged at commit 4007537fb13f3c6088cf28b153a28293c149b496. The complete runtime capsule retains those same source bodies:

- [Original reviewed-edition reader and projector](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/9f5bad38bed2bcfc52c8f7ff9bc11ec816a6aba8/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/editions.mjs), Git blob cb61cf4456fdde0ae069b695de6097e5052092d9.
- [Original exact JSON token implementation](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/9f5bad38bed2bcfc52c8f7ff9bc11ec816a6aba8/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/json.mjs), Git blob 91d8d57a78e564aa5c62145798870f1423af12ef.
- [Original capture and page receipt reader](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/9f5bad38bed2bcfc52c8f7ff9bc11ec816a6aba8/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/capture.mjs), Git blob ec41be44421649a775a89c7755d814e7c65d2be9.

The retained original file writer is postgres/publisher/files.mjs, Git blob c59a09f58ed98997b6cb8ede44b7c0ef4db356be. Together these four original source files are the complete native runtime dependency set.

The native edition schema is stellar-forge.datasette-edition.v1 in REVIEWED state. Its capture uses stellar-forge.datasette-capture.v1 in COMPLETE state. The factory receives these maintained implementations directly from the caller's installed source.
