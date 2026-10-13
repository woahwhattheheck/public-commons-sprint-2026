# Parcel review and portfolio operations

The Parcels workspace joins public parcel inventories, tax registers, assessment records and published geometry into one reviewed portfolio. Staff can retain each original source, inspect conflicting assertions, record ownership and responsibility decisions, choose a stated assessment and area basis, publish a native map source, and hand over the complete project for continued work.

Parcels is part of the existing QGIS analyst workspace. It uses the same workspace database, revision history, request journal, file store and receiving format as Sources, Layers, Maps, Editions, Field and Transfers. Use [ANALYST.md](ANALYST.md) for installation, the existing Applications launcher, private runtime selection and general request recovery. Use [OPERATIONS.md](OPERATIONS.md) for native QGIS project and layer operations.

## 1. Open the original project and select the source edition

Open the existing analyst application and choose **Parcels**. Keep the original project directory when continuing a review. The current parcel edition, entity versions, saved decisions, portfolios and published map sources belong to that workspace.

A source edition is an immutable capture of selected original files and a declared parcel-key cohort. An edition can contain a selected subset or a larger inventory. Its selection and source coverage identify that extent. Importing a subsequent capture creates another edition; selecting the current edition is a separate recorded action.

The normal work sequence is:

1. Receive the complete source folder and inspect its manifest, dates, inventory and coverage.
2. Import the reviewed source edition.
3. Inspect parcel facts and original rows, then record ownership, responsibility and other choices.
4. Review a portfolio with an explicit assessment basis, area basis and grouping.
5. Freeze the reviewed portfolio and download its files.
6. Publish its retained geometry into the original Layers and Maps workflow.
7. Export the complete project, receive it independently and continue from the retained history.

The browser uses the existing analyst request journal for these actions. Keep the same request when recovering an interrupted submission. A changed choice is a new reviewed action.

## 2. Understand the original parcel identities and source meanings

### Parcel keys and original row identities

The Pittsburgh source contract uses the publisher's exact 16-character parcel identifier. Keep it as text, including leading zeroes and suffix letters. A numeric spreadsheet column loses information. An address, block/lot label, map label, alternate ID or display name does not replace that identifier.

A parcel key can have several source rows. eProperties has its own `id` and datastore `_id`; the tax register, County assessment export and geometry service have their own record identities. Retain each original row and its source identity. The joined parcel view collects those assertions without deciding that the first or last row is the correct one.

Blank or malformed identifiers stay in the original source and its reported exceptions. They do not become invented parcel keys. Source coverage distinguishes these cases:

| Coverage result | Meaning |
| --- | --- |
| A returned row or feature | The retained response contains an assertion for that exact key. |
| A requested key with no returned match | The source was queried for this key and returned no match in that capture. |
| A key outside the requested capture | That file supplies no observation about the key. |
| An invalid source identifier | The original row cannot participate in the exact-key join until an explicit source correction is supplied. |
| Several records for a key | The original records remain available for review and selection. |

The receiving manifest's `requestedPins` makes the second and third cases distinguishable for County and geometry captures. A missing feature does not imply that a parcel has no land, and a missing assessment row does not imply a zero assessment.

### Ownership, tax agents and accountable teams

The City inventory's `owner` and the geometry service's `propertyow` are statements made by their respective publishers. They can differ in wording, update date or substance. The review chooses a specific source claim, or explicitly leaves ownership unresolved.

The geometry service labels `agent` as **TAX AGENT**. A tax agent is a separate source fact. It does not automatically become the owner, occupier, operator or responsible department.

An accountable team is an explicit reviewed assignment. Create or select a versioned entity, then bind the parcel decision to that exact entity version. The choice records who is accountable within the reviewed work; it does not silently rewrite the publisher's ownership assertion.

The original City example illustrates why the distinctions matter. For `0002A00132000001`, the retained eProperties row identifies City of Pittsburgh as owner, while the geometry row identifies CITY OF PITTSBURGH as `propertyow` and PUBLIC PARKING AUTH as tax agent. The inventory's address, physical class, inventory type and status are also separate fields. Staff should examine each field in context before assigning a responsible team.

### Assessment, appraisal and sale amounts

Select an assessment basis deliberately. The County data dictionary distinguishes the following values:

| Portfolio basis | Source fields | Interpretation |
| --- | --- | --- |
| `county-assessed` | `COUNTYBUILDING`, `COUNTYLAND`, `COUNTYTOTAL` | County assessed values after the applicable reductions represented in the source. |
| `local-assessed` | `LOCALBUILDING`, `LOCALLAND`, `LOCALTOTAL` | Assessed values used for the municipal and school basis represented in the source. |
| `base-year-2012-appraisal` | `FAIRMARKETBUILDING`, `FAIRMARKETLAND`, `FAIRMARKETTOTAL` | The publisher's unreduced 2012 base-year appraisal values. |

Keep the last label in exported reports. The word FAIRMARKET in a column name does not change the recorded base year into a current valuation.

`SALEPRICE` is historical sale consideration. Read it with `SALEDATE`, `RECORDDATE` and `SALECODE`. It is a separate observation from the selected assessment basis. The City tax register's sale fields also retain their own dates and meanings.

Original numeric values and missing values are retained in the source. A missing value differs from a reported zero. Use the application's exact numeric projections and exported basis labels for calculations; avoid converting monetary values through binary floating-point spreadsheet or script intermediates.

County `OWNERCODE` and its description identify an owner category. They do not supply a named owner. Preserve that distinction when reviewing a source record.

### Area and geometry

A portfolio also selects one area basis:

| Area basis | Source meaning |
| --- | --- |
| `city-reported-square-feet` | The City's reported `parc_sq_ft`. |
| `county-reported-square-feet` | The County's reported `LOTAREA`. |
| `publisher-reported-acreage` | The geometry publisher's reported acreage, including `calcacreag` when supplied by that source. |

Retain the selected area claim, its units and the original source value. If two sources differ, choose a basis and explain the decision. A projected map polygon is a further source of geometry; it does not silently replace a reported area.

Captured geometry responses in the supplied Pittsburgh source use `outSR=4326`, recorded as `coordinateReferenceSystem: "EPSG:4326"` on each geometry descriptor. The original service schema preserves the publisher's source coordinate system. Select the appropriate native QGIS project coordinate system for display or an explicitly defined geometric calculation. A display transformation does not alter the portfolio's selected reported-area basis.

## 3. Receive a complete source folder

The folder must contain **`parcel-source-receiving.json`** and every file named in its inventory. Retain the original filenames, exact UTF-8 or CSV bytes, and relative directory structure.

The manifest schema is `starforge.parcel-source-receiving.v1`. It includes a label, assembly time, selection and file descriptors. Each descriptor identifies its `sourceId`, family, path, original URL, byte length and SHA-256. County and geometry descriptors retain their requested keys. Geometry descriptors identify the returned coordinate reference system.

The available source families include the original City inventory and tax-register JSON or CSV, County assessment JSON, Pittsburgh parcel GeoJSON and the original source metadata. Keep the metadata files with the capture: they explain columns, units, update dates and source conventions.

### Preserve the different dates

The manifest's `createdAt` is the time the receiving edition was assembled. A top-level `capturedAt` is optional. File-level `capturedAt` and its precision describe the actual capture. Source-effective dates, catalog dates and ETL dates remain distinct.

For example, a dataset can be republished in October 2026 while its underlying register describes September 2024. A County row can carry a 2026 tax year and a September 30 as-of date while the catalog has another update date. Use the Sources table and original metadata to retain these differences. If only a capture date was recorded, `captureTimePrecision: "date"` preserves that fact without adding a time of day.

### Preview and import

Use the Parcels source intake controls to choose the existing source directory, or upload the complete folder through the existing analyst transfer controls. The original folder transfer preserves selected paths and bytes.

Run **source preview**. Review:

- The manifest identity, declared selection and selected-key count.
- Every original file's byte length, digest, family, source ID and capture metadata.
- Returned records, explicit no-match keys and uncovered source families.
- Invalid original identifiers and duplicate source records.
- Any incomplete capture or file mismatch that needs attention.

Retain the returned manifest digest and `previewSha256`. Import using that exact pair. A changed file, manifest or selection requires another preview.

The import retains the raw files and a keyed parcel projection with its exact index. The edition references those retained files; it does not require another public-source request when staff reopen a parcel.

### The supplied 32-key source example

The first complete Pittsburgh input contains nine files: its receiving manifest, four original data responses and four source/schema documents. Its manifest SHA-256 is:

```text
f2c8266e7f5086b5cdefe14d1935b3bfa6f671091e7a65e593a8714e1a2c28a0
```

The four responses contain 29 eProperties records, nine tax-register records, 30 County assessment records and 29 geometry features. The City responses together cover the declared 32 keys. County returned no match for `0001A02020000000` and `0002A00132000002`; geometry also has no match for `0002B00171000000`. Those are explicit source-coverage facts.

The parent selection recorded in that manifest describes the larger 12,587-key union and 22 invalid original inventory rows. The selected example itself is a 32-key edition. Staff can receive a later, larger capture as another edition and review its additions through the successor workflow.

## 4. Inspect parcels and define accountable entities

The parcel rows view supports the original search, ward and issue filters. Open a parcel to inspect its original records, source assertions, assessment records, area claims and geometry claims. Use the original-source download or source-record view when a value needs context.

The row's `factsSha256` binds a decision to the facts being reviewed. Keep the original claim IDs. A choice such as “use the City owner” is represented by a selected source claim, not by copying a label into an untracked free-text field.

Create accountable entities before assigning them:

```json
{
  "entityId": "reviewed-asset-team",
  "label": "Reviewed asset team",
  "kind": "department",
  "parentEntityId": null,
  "note": "Use the team name and responsibility established by the actual review.",
  "expectedVersion": null
}
```

This is an illustrative entity definition. Enter the actual agreed team and evidence for the project.

Supported kinds are `government`, `authority`, `department`, `organization` and `other`. When updating an entity, provide its current `expectedVersion`. Saved versions are immutable; a parcel decision records `entityId` and the selected `entityVersion`. Changing a label or hierarchy later does not rewrite a frozen portfolio's historical assignment.

## 5. Review individual parcels and complete batches

A parcel decision records:

| Field | Reviewed choice |
| --- | --- |
| `key` | The exact parcel identifier. |
| `factsSha256` | The facts shown for the selected source edition. |
| `expectedDecisionSha256` | The current decision being replaced, or null for a first decision. |
| `owner` | A source claim, or explicitly unresolved. |
| `accountable` | A selected entity version, or explicitly unassigned. |
| `status` | A source claim, or explicitly unresolved. |
| `ward` | A source claim, or explicitly unresolved. |
| `assessmentRecordId` | The selected original assessment record, or null. |
| `areaClaimId` | The selected reported-area claim, or null. |
| `geometryClaimId` | The selected geometry claim, or null. |
| `reason` | The reviewer's explanation for these choices. |
| `evidence` | Optional retained edition/file references with notes. |

Source choices have the shape `{"mode":"source","claimId":"..." }`; unresolved choices use `{"mode":"unresolved"}`. Accountability uses `{"mode":"entity","entityId":"...","entityVersion":"..."}` or `{"mode":"unassigned"}`.

An evidence reference is `{editionId,fileSha256,note?}`. It points to an original retained file in the project. Keep reasons specific enough for another member of the team to understand the selected source, unresolved conflict or responsibility assignment.

### Prepare a batch without silently approving it

`review.prepare` accepts up to 1,000 selected keys and explicit preparation rules. It returns a proposed batch for review. Available rules include:

- `uniqueAssertions` for source assertions that have a unique eligible choice.
- Optional `sourcePreferences` for owner, status and ward.
- An explicit `accountableEntityId`.
- `uniqueAssessment`, `areaBasis` and `uniqueGeometry`.
- `replaceReviewed` and a named `reason`.

A source preference is an actual **source ID**, such as `city-eproperties` when that is the source ID in the manifest. It is not a family name. Choose IDs from the imported edition rather than assuming a source's label.

Existing reviews are skipped by default. Select replacement deliberately when an existing decision should change. The original expected-decision digest protects a concurrent review from being overwritten.

Run `review.preview` with the prepared or edited decisions. Inspect the normalized choices, source claim identities, unresolved fields, assigned entity versions and returned `previewSha256`. `review.save` can carry that digest and the exact decisions through the original revision/request/actor boundary.

A saved decision may explicitly leave fields unresolved. “Complete review” means that every selected key has a saved decision; it does not mean that every ownership, responsibility or source conflict was resolved. Keep unresolved values visible in portfolio review and delivery.

## 6. Compare a later edition and carry reviewed work

Import the new original source capture with its own manifest and preview. Use `successor.compare` with the left and right edition IDs to inspect the actual additions, removals and changed facts.

Review the returned comparison before carrying decisions. The successor review definition is:

```json
{
  "leftEditionId": "original-edition-id",
  "rightEditionId": "new-edition-id",
  "comparisonSha256": "digest-from-the-current-comparison",
  "unchanged": "carry-reviewed",
  "changed": "leave-unreviewed",
  "removed": "retain-history",
  "note": "Carry the reviewed choices whose source facts remain unchanged."
}
```

Use `unchanged: "leave-unreviewed"` when the new review should start without that carry-forward. Changed facts stay unreviewed in the new edition, and removed parcels retain their prior history. The comparison digest binds the decision to the actual pair being compared.

Inspect additions and changed facts through the normal parcel review controls. A later entity or source decision can produce a new reviewed portfolio. Earlier portfolios retain their original edition, choices, source amounts and geometry.

Selecting the current source edition does not replace earlier sources or publish a new map automatically.

## 7. Review and freeze a portfolio

A portfolio names its source edition, selected parcel keys or filters, assessment basis, area basis, grouping and note. An example definition is:

```json
{
  "editionId": "reviewed-edition-id",
  "title": "Reviewed public asset portfolio",
  "selection": {
    "keys": ["0002A00132000001"]
  },
  "assessmentBasis": "county-assessed",
  "areaBasis": "city-reported-square-feet",
  "groupBy": ["owner", "accountable", "ward"],
  "note": "Use the reviewed source claims and keep remaining missing values visible.",
  "requireCompleteReview": true
}
```

Use either explicit `selection.keys` or `selection.filters`, whose supported fields are `query`, `ward` and `issue`. Inspect the actual selected-key set during preview, especially when using filters. Supported grouping dimensions are owner, accountable entity, status and ward.

Run `portfolio.preview`. Check the selected extent, decision coverage, selected amount and area bases, unresolved facts, missing source values and geometry coverage. Review both individual parcel records and grouped results before freezing the edition.

Amounts retain their source meaning. A County-assessed portfolio and a local-assessed portfolio are distinct analyses. Keep the basis in titles, exported metadata and discussion. Use the source-year labels when presenting a base-year appraisal. Assessment totals, historical sale consideration and an analyst's separate valuation work should have clearly identified columns and methods.

Create the portfolio using the same definition and the returned `previewSha256`. The frozen result retains its source edition, selected decisions and original file lineage. Download its actual retained files from the portfolio controls.

Changing a definition after preview requires a new preview. A new assessment basis, changed responsible team or corrected source choice creates another portfolio; the earlier result remains available for comparison and receiving.

## 8. Publish the reviewed source into native QGIS

Use `map.publish` with the frozen `portfolioId`. Its result contains `map`, `source` and `layer`.

The retained source manifest is **`parcel-map-source.json`**, schema `starforge.parcel-map-source.v1`. It binds:

- `parcels.geojson`: the selected reviewed geometry and attributes.
- `portfolio.json`: the frozen portfolio.
- `lineage.json`: the source and decision lineage.

The source uses `sourceKind: "parcel"` and the existing native vector/layer workflow. Continue in **Layers** and **Maps** to inspect the selected native layer, choose a style, save the QGIS project, render it and inspect its features. The map source has the same retained identities as the reviewed portfolio.

Compare map coverage with portfolio coverage. Parcels without a selected geometry remain visible in the portfolio's records and exceptions. A map can only display the geometry retained for its selected features.

Use the existing configured QGIS runtime and profile for native operations. The analyst application preserves the selected runtime environment and existing authentication-store references. Private QGIS authentication databases, passwords and connection credentials remain in that original runtime custody. Project receiving retains the source and reference identities needed for the receiver to select its own authorized local runtime.

## 9. Use the installed command or the original analyst API

### Installed and standalone commands

The installed flat command is:

```bash
starforge stac-qgis parcels --workspace /absolute/project --input /absolute/action.json
```

The standalone package entry is:

```bash
python -m starforge_stac.parcels.operator --workspace /absolute/project --action-file /absolute/action.json
```

The action file has the shape `{action,payload,revision,requestId,actor}`. Use the current original workspace revision and a stable request ID. For example, a source preview action is:

```json
{
  "action": "source.preview",
  "payload": {
    "directory": "/absolute/received-parcel-source",
    "expectedManifestSha256": "actual-manifest-sha256"
  },
  "revision": 12,
  "requestId": "parcel-source-preview-001",
  "actor": "Named reviewer"
}
```

Replace the example revision, paths, digest and actor with the actual project values. Keep that exact file when recovering its original request.

### Analyst request boundary

The browser/API submits the original analyst action `parcel.command`:

```json
{
  "requestId": "parcel-source-preview-001",
  "action": "parcel.command",
  "payload": {
    "action": "source.preview",
    "payload": {
      "directory": "/absolute/received-parcel-source",
      "expectedManifestSha256": "actual-manifest-sha256"
    }
  },
  "revision": 12,
  "actor": "Named reviewer"
}
```

Submit through the existing authenticated `POST /api/operations` boundary. The installed controller, named request, original revision and private workspace are shared with the other analyst actions.

| Parcel action | Payload |
| --- | --- |
| `source.preview` | `{directory,expectedManifestSha256?}` |
| `source.import` | `{directory,expectedManifestSha256,previewSha256}` |
| `source.select` | `{editionId}` |
| `entity.save` | `{definition}` |
| `review.prepare` | `{editionId,keys,rules}` |
| `review.preview` | `{editionId,decisions}` |
| `review.save` | `{editionId,decisions,previewSha256?}` |
| `successor.compare` | `{leftEditionId,rightEditionId}` |
| `successor.review` | `{definition}` |
| `portfolio.preview` | `{definition}` |
| `portfolio.create` | `{definition,previewSha256}` |
| `map.publish` | `{portfolioId}` |

Read views use `GET /api/parcels` and its `/rows`, `/detail`, `/source-record`, `/portfolio` and `/compare` views. Original-source and frozen-portfolio downloads use the existing authenticated `/download/parcels/...` routes. Use the current controller's returned IDs and download links.

## 10. Continue an interrupted review or native operation

The original analyst journal retains READY, RUNNING, INTERRUPTED, FAILED and COMPLETED requests. Open **History** or the pending operation in the original browser session to inspect the actual result.

For an uncertain response, first read the original request with `GET /api/operations/ID`. Continue it through `POST /api/operations/ID/continue` using its retained `inputSha256` when the controller offers continuation. Keep the original action, payload, request ID and reviewed revision. The domain mutation retains its existing compare-and-swap boundary.

A concurrent revision conflict means the current workspace has changed. Reopen the current edition and decision, inspect the change, then prepare the new reviewed action. An old decision digest or preview digest should not be replaced simply to force an earlier choice through.

If a native QGIS operation needs a local runtime or source location, preserve its returned status and original input. Review the actual current location through the existing runtime/receiving controls. A received workspace can retain an unfinished request that refers to the original host; the receiver must select its appropriate current location before a new location-dependent action.

An interrupted download or upload retains its original transfer identity and byte prefix. Resume the same file selection through the original transfer controls. Do not assemble a receiving source from truncated previews or replace an original file with a copied table.

## 11. Deliver the complete project and reopen it

Use the existing **Transfers** project export/receive workflow. The complete receiving archive carries the original workspace state and the files referenced by its parcel history:

- Original source manifests, data responses, CSV files and metadata.
- Selected-key cohorts, keyed row projections and their indexes.
- Immutable entity versions and reviewed parcel decisions.
- Review batches, successor comparisons and carry-forward decisions.
- Frozen portfolios and their selected source and decision lineage.
- Published parcel map manifests, GeoJSON, portfolio and lineage files.
- The original vector definitions, saved native projects, styles and related resources.
- The original analyst request records and retained result files.

Keep the complete archive inventory and its digest with the delivery. Downloading a map image or a portfolio CSV is useful for presentation; the complete project is the receiving artifact for continued operation.

Receive into the chosen independent project location through the original project receiver. Inspect the retained edition, original source files, entity versions, saved decisions and frozen portfolio before continuing work. Open the published map source through the existing native layer and project controls. Select the receiver's existing authorized local QGIS environment for any native operation that needs it.

For a subsequent source refresh, carry the complete earlier project forward, import the new source edition, compare it and record the successor review. That preserves the relationship between what was previously reviewed and what changed.

A practical handover should let the receiving operator answer four questions: which original record supports this value, who made this choice, which source edition and basis produced this portfolio, and which existing operation should be resumed. The retained source, decisions and request history provide those answers.

## 12. Original public source references

The example source package retains the actual captured responses and schemas. These publisher endpoints identify their original context:

- City inventory catalog: https://data.wprdc.org/api/3/action/package_show?id=city-owned-properties
- City inventory resource: https://data.wprdc.org/datastore/dump/e1dcee82-9179-4306-8167-5891915b62a7
- City tax-register catalog: https://data.wprdc.org/api/3/action/package_show?id=city-owned-property
- City tax-register resource: https://data.wprdc.org/datastore/dump/4ff5eb17-e2ad-4818-97c4-8f91fc6b6396
- County assessment catalog and dictionary: https://data.wprdc.org/api/3/action/package_show?id=property-assessments
- County assessment datastore resource: `65855e14-549e-4992-b5be-d629afc676fa` on the same WPRDC API.
- Pittsburgh parcel service and original field aliases: https://pghbridgis.pittsburghpa.gov/hosting/rest/services/ThreeOneOneServices/MapServer/5?f=pjson

When a publisher changes a live endpoint, the retained capture remains the source for its existing edition. Acquire a new original response and review a successor edition when current data is needed.

## 12. Run the original source-to-recipient walkthrough

The complete product source includes `parcel-native-receiving.py` and `parcel-native-browser.mjs`. They continue one retained operation through the real analyst API and browser. Supply the original source directory, its manifest digest, the responsible analyst, and the same operation/output directory on every continuation.

The private browser configuration selects existing installed executables through `node`, `playwrightModule`, and `chromium`. Pass that file with `--browser-config`. Pass the selected existing native QGIS runtime file with `--native-runtime-file` when it is available on that host.

The walkthrough retains each original request before submitting it. It imports the source editions, previews and saves their reviews, carries explicitly unchanged successor decisions, and freezes portfolios in the separate County, local and 2012 base-year bases. The desktop and 390-pixel browser flow makes the named owner decision, retains entity versions, saves a portfolio and downloads its exact files.

Next, the original `project.export` operation produces the complete reviewed project. The original `project.receive` operation opens that archive in `received-domain/`, including its own copied software. The recipient browser reads the same source, reviewed parcel, portfolios and successor history. The programme compares the complete original state, domain history and analyst requests before and after that read-only recipient walkthrough.

A host that completes this stage without a selected QGIS runtime writes `result.json` with `status: "PARCEL_RECEIVING_COMPLETED"`. Its `domainReceiving` field contains the exact receiving receipt, archive descriptor, original request count and completed recipient browser result. `nativeContinuation` identifies the reviewed portfolio, map source and layer for the native stage. This is a completed source/review/portfolio receiving stage; native rendering follows through the retained operation when its QGIS runtime is selected.

Continue with the same operation ID, output directory, original inputs and saved browser requests. The programme reopens completed requests and preserves the original frozen domain export and recipient history. With the QGIS runtime selected, it inspects and saves the real native map, renders and reads its features, exports the complete native project, then reopens and renders it in the independent recipient. The final native result uses `status: "COMPLETED"` and retains both domain and native receiving results.

Keep the complete exported project as the receiving artifact. The operation directory also contains browser request/step files and continuation lineage needed to resume that particular walkthrough. Preserve those internal operation files with their existing custody; private connection files remain in the selected execution environment.

## 13. Continue with the complete later source cohort

`parcel-successor-receiving.py` takes a complete later source directory into the same reviewed workspace and operation used by the original walkthrough. It reads that operation's retained identity and actor, takes its existing application lock, and places this edition's continuation under `successors/<manifest-sha256>/`. The first edition's operation, source files, requests, reviews and portfolios stay attached to the project.

Supply the actual complete manifest digest, the original operation directory and the same responsible analyst:

```sh
python3 -B parcel-successor-receiving.py \
  --operation-root /absolute/path/to/original-operation \
  --operation-id ORIGINAL_OPERATION_ID \
  --source-directory /absolute/path/to/later-source-edition \
  --expected-manifest-sha256 EXACT_LATER_MANIFEST_SHA256 \
  --actor "Original responsible analyst" \
  --browser-config /absolute/path/to/existing-browser.json
```

The existing browser configuration contains `node`, `playwrightModule` and `chromium` paths. Add `--native-runtime-file` to select the original installed QGIS runtime and its retained authentication/profile environment. The request wait defaults to 1,800 seconds and can be set between 30 and 3,600 seconds with `--operation-timeout`; each original request remains in the journal if its process or carrier is interrupted.

The source is received through the same complete file manifest and resumable upload routes. Both full City CSV families and their selected JSON capture families use the original field names and exact parcel keys. Every active City, County and geometry descriptor retains its original public `sourceUrl`. A `source-metadata` descriptor can omit that field when the source URL was not retained; its exact file, digest, byte count, source ID and capture time remain required. Keep private transfer references with their existing local custody. They are unnecessary in a parcel receiving manifest.

The continuation compares the actual later facts with the active edition frozen at the start of this phase. Use `--previous-edition-id` to select another original retained predecessor explicitly. Only unchanged facts qualify for carrying an existing review. Changed and added records are prepared and reviewed in batches of at most 1,000 keys. The programme uses the existing explicit preparation rules: unique eligible assertions and assessment/geometry records, the City source preference for status and ward, the County reported area basis, and unassigned operational responsibility. Conflicting assertions remain unresolved. The named parcel selected in the original buyer walkthrough is reopened against its actual later City owner assertion and receives a new explicit source decision.

Three separate frozen portfolios preserve County assessed value, municipal/school assessed value, and the published 2012 base-year appraisal. Each retains its own tax year, as-of date, source amount and reported area. The complete later map source is added alongside the earlier retained layers. The desktop and 390-pixel browser reads the new source register, original records, reviewed parcel, frozen portfolio files and successor history.

The original complete export then receives into a separate workspace under that edition's continuation directory. The programme compares its archived state, events, domain requests and analyst requests; verifies every retained project file; and repeats the read-only buyer walkthrough. The result is `successors/<manifest-sha256>/result.json`, with `status: "PARCEL_RECEIVING_COMPLETED"` after domain receiving or `status: "COMPLETED"` after the selected native QGIS inspection, saved map, render, feature readback and independent native receiving. Each stage retains its exact archive and original request IDs.

Resume with the same operation directory and later manifest digest. A further publisher edition uses its own new manifest digest and a new reviewed successor phase. Resource declarations must cover the actual whole later source, indexed projections, review and portfolio files, native outputs, exported archives and independently received copies.

## 14. Preserve reviews when a City export format changes

The selected City JSON response and a later full CSV can represent the same original records. The programme keeps both original file sets and every existing record, claim and fact hash. The comparison first uses those exact fact hashes. When a City family changes between its JSON and CSV representation, it additionally reads the selected original rows and compares every published field except the datastore-only `_id`. Only the original JSON null and its empty CSV cell are treated as equivalent; all other scalar text, including case, whitespace, dates and numerical representation, remains exact.

Source identity, stable record ID, parcel key, geometry and every source assertion must bind one-to-one. County and geometry records retain their exact original identities. Duplicate or ambiguous equivalent records remain changed and require review. A changed business value also remains changed.

An otherwise unchanged parcel appears in `unchanged` with an explicit `sourceFormatEquivalence` receipt containing the old/new fact hashes, source formats, and original-to-target record and claim bindings. The receipt participates in the comparison hash reviewed by the operator. Carrying its existing review uses the target edition's actual claims and fact hash, preserves the original accountable-entity version and selected evidence, and records `carriedFrom` plus the equivalence receipt. The old review and raw inputs remain available in the original edition. Subsequent preview, save, portfolio and independent receiving therefore use the actual current source identities while preserving the earlier staff decision.

## 15. Recover the original receiving operation after a host directory is lost

A complete saved project carries the original SQLite snapshot, parcel source objects, reviews, frozen portfolios, domain history and analyst request journal. If the host's outer operation directory is lost, restore that saved project and the complete published software first. Preserve the original operation ID, responsible actor, workspace ID and absolute output location from the saved request inputs.

The preparation entrypoint reconstructs the original receiving programme's outer request files and initial source folder from that saved workspace:

```sh
python3 parcel-operation-restore.py \
  --archive /selected/Urban3_Reviewed_Parcel_Workspace.zip \
  --expected-archive-sha256 ORIGINAL_SAVED_ARCHIVE_SHA256 \
  --workspace-id ORIGINAL_WORKSPACE_ID \
  --source-manifest-sha256 ORIGINAL_COMPLETE_SOURCE_MANIFEST_SHA256 \
  --operation-id ORIGINAL_OPERATION_ID \
  --actor 'Original responsible analyst' \
  --output /original/operation/location
```

Run this preparation inside the same maintained native continuation allocation. It checks the exact archive hash and all 20 completed original programme requests, including their actor, workspace, location and input hashes. The original project receiver restores the saved database and complete file closure. The helper then reopens the retained initial-edition objects and copies their exact original manifest and source bytes into `inputs/original-scope`. This preserves the original selected subset's creation time and manifest hash. Rebuilding that initial manifest from the present clock would create a different source edition.

The original outer request files are reconstructed from the archived request journal, including their original revisions and payloads. The database journal remains unchanged. A subsequent invocation of `parcel-native-receiving.py` with the original source, manifest digest, operation ID, actor and output location finds the completed request IDs and continues the buyer workflow from its retained results.

The preparation returns `ORIGINAL_OPERATION_PREPARED` and writes an immutable receipt under `recovery/worked-workspace-<archive-sha256>.json`. It starts no listener or publisher acquisition. Repeating preparation for the same saved archive reopens its received workspace and requires that all saved events and analyst requests remain intact, including when later buyer work has advanced the workspace. A different received archive, actor, path, missing completed stage or changed saved request is rejected. If the current workspace already exists from its original creation and is healthy, continue that workspace directly.

Retain any separately saved read-only observation captured after the selected archive as a separate original observation in the handoff. Do not fabricate missing journal timestamps or treat the older archive as containing that later observation. The saved snapshot and its completed domain outcomes remain the recovery authority.


## 16. Capture a named publisher refresh in the analyst console

**Parcels → Capture** operates the same supported Pittsburgh publisher capture as
the standalone capture CLI. Use it for an agreed future refresh. The completed
original cohort remains an existing source edition; opening the pane does not
fetch it again.

Choose an absolute working directory outside the project and give the refresh a
clear label. **Create named refresh** saves its identity and operator without a
publisher request. **Open capture / refresh status** reads an existing capture.
Status shows the actual retained request counts, selected keys, original capture
identity, operator and time.

**Advance capture** submits one original analyst request. Choose 1–64 publisher
requests and a 1–120 second timeout per request. Each action has a durable request
budget charged immediately before each actual GET. Continuing that same analyst
request uses its remaining budget. To authorize another bounded group after a
completed action, click Advance again; it receives a new analyst request ID for
the same capture. There is no unattended capture loop.

WAITING and BLOCKED are normal retained capture outcomes. The cooldown table
shows the publisher's recorded retry deadline and response. Refresh status after
that deadline. A blocked request requires an explicit **Reason for retry** and
**Record reviewed retry** before another Advance. Retrying preserves the original
attempt evidence; it does not discard the body or rewrite a previous result.
The retry freezes the displayed attempt SHA-256. If another operator advances or
changes that attempt before the retry acquires its lock, refresh and review the
new result before submitting another retry.

When status is READY, **Prepare receiving edition** validates the complete output
with the original parcel intake. If the publisher metadata changed between its
before and after captures, the returned comparison is saved for review. Record
the publisher-change review reason and prepare again. The resulting receipt
retains that reason, the complete directory, exact manifest SHA-256, file and byte
counts and source summary. **Use this edition in Sources** copies that exact
directory and SHA into the existing source preview. Preview and import retain
their original separate review and request controls.

### Complete capture checkpoints and independent receiving

Every completed capture action retains a complete capture checkpoint in the
original analyst journal. **Save complete capture checkpoint** also records work
completed through the standalone capture CLI. Exact files are retained as
content-addressed objects under the original analyst result closure. Later
checkpoints share unchanged objects. This includes response bodies and headers,
attempts, retry decisions, progress, selection and any finalized receiving files.
Raw publisher bytes remain unchanged; exact decimal metadata displayed in an
analyst review is represented as text.

The saved-request table is paged and remains available after browser draft loss.
History exposes the original result files and same-request continuation.
Project export includes every checkpoint object plus the capture operator and
original capture software. Project receiving verifies those hashes before
publishing the received workspace database.

On another host, select a completed original checkpoint and enter a new empty
capture directory outside the project, then use **Restore complete capture**.
Restoration checks and copies every retained member, preserving the capture,
attempts and provider deadlines. It makes no publisher request. An interrupted
restore must continue its original analyst request; other actions are refused
until its receiving marker is complete. The old absolute working path remains in
the immutable history. A finalized capture exposes its actual new receiving
directory while preserving its original manifest and review reason.

The original capture folder is still needed for work after an interrupted action
until a complete checkpoint has been saved. An interrupted action cannot promise
to retain bytes that never reached the workspace. Keep the source folder and use
History's original continuation before moving the project.

### Analyst API

The original operation endpoint accepts action `parcel.capture`, with payload
`{action, payload}`. It keeps the existing actor, revision, request ID, selected
runtime and worker ownership.

| Capture action | Inner payload |
| --- | --- |
| `init` | `directory, label` |
| `advance` | `directory, maxRequests?, timeout?` |
| `retry` | `directory, jobId, reason, expectedPreviousSha256` |
| `finalize` | `directory, publisherChangeReason?` |
| `checkpoint` | `directory` |
| `restore` | `directory, checkpointRequestId` |

GET `/api/parcels/capture?directory=...` reads current status without a publisher
request. GET `/api/parcels/captures?offset=0&limit=50` pages the original capture
journal (limit 1–100). Completed action results include the exact checkpoint
request ID, file count, expanded bytes and snapshot path. Each checkpoint
supports at most 25,000 files and 16 GiB of expanded working files, within the
original receiving system's applicable package limits.
