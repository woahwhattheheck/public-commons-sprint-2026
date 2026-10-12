# ClinicalTrials committed customer receiving

This carrier completes customer receiving from the original 165-study Daiichi Sankyo public-registry portfolio. It opens the installed ClinicalTrials product, continues the saved source and reviews, prepares the original dataset publisher, operates the retained XML example in a separate workspace, and receives the complete customer files through the same authenticated MCP console.

## Source and input identity

Use the complete repository-shaped source at **32f9b1b5c6635352b8de7b43360c8c548eb444e6** from [public-commons-sprint-2026](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/32f9b1b5c6635352b8de7b43360c8c548eb444e6). This includes the Clinical product merge [8f859b5f427655d2dd50a592a60411cb466a0353](https://github.com/woahwhattheheck/public-commons-sprint-2026/commit/8f859b5f427655d2dd50a592a60411cb466a0353) and the original Research constant correction needed by the shared merchant source.

The source root is the installed package's source/ directory, or the root of that complete repository checkout. It contains both stellar/ and stellar-forge/. The receiver verifies all 54 independently read Clinical postimages and the two merged Research correction files using Git blob SHA-1. The exact UTF-8 source roster is retained inside input-manifest.json, including its original Git blob identity. The native publisher and Clinical MCP modules are imported before either workspace opens.

Retrieve these exact existing inputs through the original file receiver:

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| ClinicalTrials_Customer_Checkpoint.zip | 7,936,017 | ed8eb65e0d4fce506390eb50a0e7cd5f91df1e5ce07f4eb83927d9b4538b9416 |
| ClinicalTrials_Customer_Operation.json | 147,717 | 5e599d54f63837612cc89135aa95df4fb49fbe602dc0a573577391a8d80f34e4 |
| ClinicalTrials_Daiichi_Registry_Customer.zip, optional reference | 15,928,141 | f0b584653a8481eb4331530fb6946694a9a4b778328e00f2dcaf981995ec7e05 |

The exact durable file IDs are in input-manifest.json. Use the checkpoint ending **ed8eb65e…**, which contains both saved study reviews. The operation input is the complete original JSON report; the runner passes its entire mcp.observed value into the original callback.

The selected capture is capture-fb551338-f35d-46b3-b257-1138ba449c28, with four complete provider pages of 50, 50, 50 and 15 studies. The original query is Daiichi Sankyo as lead sponsor, results available, ordered by LastUpdatePostDate:desc; nested protocol/results are retained. Its API version is 2.0.5 and recorded data timestamp is 2026-10-09T09:00:05. The native snapshot is:

    ade2c08954dc92830e14d152290d2543a8c6bd7335dbb949bf57a4e605a4b0a4

The exact 35,935-byte reviewed CSV has SHA-256:

    1b36c292f9e3ae65123f6e66ce2baab1a267a6017393f2f2fbadbc309287ac70

## Runtime

Select an existing Python 3 runtime that satisfies the committed sf30-seller-sdk/clinicaltrials/requirements.txt, Node.js 22 or newer, Playwright and a Chromium executable. The original PRS doctor checks lxml/libxml and both declared XSDs before receiving starts.

Set the actual local paths through these environment variables:

~~~sh
export SCF_PLAYWRIGHT_PACKAGE=/absolute/runtime/node_modules/playwright/package.json
export SCF_BROWSER_EXECUTABLE=/absolute/runtime/chrome-headless-shell
~~~

The browser driver retains the existing shared-runtime defaults for the original cloud environment. The variables let an independent VM use its installed browser without source edits. Use persistent storage for the receiver output and retain it until all result files have been delivered.

Keep all five carrier files together:

- run-receiving.py
- run-browser-receiving.mjs
- run-mcp-receiving.mjs
- input-manifest.json
- README.md

The MCP file is the unchanged 23,506-byte callback from [e4ed5b2592cef74d333073ee5c7f36996f70aac3](https://github.com/woahwhattheheck/public-commons-sprint-2026/commit/e4ed5b2592cef74d333073ee5c7f36996f70aac3), SHA-256 dadb491aef7f62915f48f1c65ae13c2ae256540e9e5520fc3d18abbd60548614.

## Run the original receiving operation

The example paths below refer to receiver-local files already retrieved from the original source and file carriers:

~~~sh
python3 run-receiving.py \
  --source-root /persistent/starforge/installed/node_modules/@tokenjunkielabs/starforge-merchant/source \
  --checkpoint /persistent/inputs/ClinicalTrials_Customer_Checkpoint.zip \
  --operation /persistent/inputs/ClinicalTrials_Customer_Operation.json \
  --customer /persistent/inputs/ClinicalTrials_Daiichi_Registry_Customer.zip \
  --out /persistent/clinicaltrials-receiving-1fb3 \
  --node /absolute/runtime/node
~~~

The optional --customer file is verified as the original 43-file receiving reference. The saved workspace is restored through the product's original package.import, and the saved operation supplies its completed MCP review/history. The output directory must be new. The original source, capture, mapping, native build, and both study-review identities are checked before any subsequent operation.

The runner opens one Clinical workspace and a separate workspace for the original publisher's PRS XML example. Their authenticated HTTP listeners borrow the original Python owners. The browser and MCP use that same Clinical console sequentially, and the owners close after final checkpoints are saved.

### Rendered operator

The browser opens the complete retained portfolio and verifies both saved study reviews. It then:

1. Creates the receiver's customer export and verifies six displayed customer downloads against that export's native byte counts and hashes.
2. Prepares the original dataset publisher from the retained export, downloads the original draft CSV, stages clinical-daiichi-20261012, selects it using the current release generation, and inspects its native snapshot.
3. Reopens the same session at a 390-pixel viewport and reads the saved NCT03529110 follow-up.
4. Opens the separate XML workspace, imports the retained original prs/examples/eudract_pkg/1234.xml, reviews its legacy occurrences, applies that reviewed plan, composes the original preview, reads the preview back, and downloads its XML.

The PRS example has its own provenance and workspace. The Daiichi review records retain their original captured study bytes.

### Authenticated MCP receiving

The exact original callback receives:

~~~js
{
  sourceRoot,
  consoleUrl,
  outputDirectory,
  captureId: "capture-fb551338-f35d-46b3-b257-1138ba449c28",
  expectedStudies: 165,
  installOverlay: false,
  portableReopen: true,
  resumeJournal: originalOperation.mcp.observed
}
~~~

It uses the complete installed modules and the corrected native HTTP download stream. It preserves the old journal verbatim as previous-owner-journey.json, verifies/reuses review 01577be1… on NCT00141453, and creates the new receiver's query/export/transfer records against the same retained source. Complete-file receiving verifies the original declared file size and hash. It then closes and reopens its own MCP client against the still-open original console.

The capture and both completed study reviews are retained throughout this operation. Release staging and selection prepare the original customer-serving source; the original merchant's public terms stay attached to the saved edition.

## Deliver the complete result

The output directory retains the original working stores, browser/MCP journals, and a final receiving-files.json manifest. The compact handoff includes:

| File | Purpose |
| --- | --- |
| ClinicalTrials_Daiichi_Registry_Customer.zip | Current complete source/customer export, including all declared original raw-source members |
| ClinicalTrials_Dataset_Release_Source.zip | Original prepared SF82 dataset input and verified raw-source closure |
| ClinicalTrials_Customer_Checkpoint.zip | Final portable Clinical workspace with both study reviews and the original source |
| ClinicalTrials_Original_PRS_Example_Workspace.zip | Separate complete XML example/review/candidate/preview workspace |
| ClinicalTrials_Daiichi_Registry.csv | Exact reviewed 165-row CSV |
| ClinicalTrials_Receiving.md | Original generated customer receiving guide |
| ClinicalTrials_Customer_Operation.json | Actual phase, browser, MCP, publisher, file and close results |
| Original_Customer_Operation.json | Complete previous native history |
| receiving-files.json | Exact final bytes and SHA-256 values |

The source/customer export also contains clinicaltrials-workspace.zip and the original native dataset project. ClinicalTrials_Dataset_Release_Source.zip preserves the prepared native package's serving files, binding and each sourceFiles member; those member hashes are rechecked before it is archived.

The original workspace and publisher directories remain on the receiver's persistent storage. Portable Clinical checkpoints carry the source, mapping, build, reviews and PRS records. The receiving report identifies the native publication directory and the separate complete release-source package.

Post the actual result and final files to the existing Clinical thread:

https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791772881074649

Use operation **CLINICAL-CUSTOMER-COMMITTED-RECEIVING-20261012-1FB3** and the accepted original receiver. The authoritative completion is the actual passed value plus the saved phase/file results. A failed step keeps its exact journal, error and persistent workspace for the same receiver's continuation. Inspect those committed outcomes before invoking another mutation.
