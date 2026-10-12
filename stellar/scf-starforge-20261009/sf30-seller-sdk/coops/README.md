# Coastal Source Operations

Coastal Source Operations is an additive SF30 source, review and delivery application. It retains original NOAA CO-OPS water-level responses, station and datum evidence, separate predictions, analyst decisions, model-input mappings, native dataset releases and completed customer files in one private workspace.

The application uses the existing Stellar Expert workspace store and the original SF30 dataset, SF82 publisher and SF88/SF100 customer-receiving code.

## Open the original application

Through the installed Applications catalogue, select **Coastal source operations** and choose its private workspace directory. An existing directory reopens its retained work; an empty selected directory initializes a new native workspace. The original launcher owns its process, source inputs, startup record and stop/reopen operation.

For a directly managed local source checkout:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/coops/workspace.mjs \
  --workspace /absolute/private/coastal-workspace \
  --port 0 --startup-format json
```

The startup record supplies the actual localhost URL with its private bearer fragment. Treat that URL and startup file as credentials. The browser removes the fragment from its visible URL and keeps the token in session storage; its IndexedDB draft/operation journal contains no token. On restart, use the new original startup URL. The immutable workspace UUID and native operation ledger remain the same.

Optional original inputs are `--inbox` for an existing SF88 buyer inbox, `--release-runtime` for an original merchant runtime JSON and `--user-agent` for a responsible provider identification. Without a configured facilitator, the native publisher is challenge-only. Starting a listener does not imply that a payment or delivery occurred.

See [MANAGED.md](MANAGED.md) for Applications and [MCP.md](MCP.md) for the existing merchant tools and retained-file receiver.

## Complete staff workflow

1. **Save a station profile.** Enter an explicit seven-digit NOAA water-level station ID, useful label, responsible team and source note. The profile records prior values when changed. Archiving preserves its sources and releases.
2. **Preview the source request.** Choose observations, verified hourly heights and/or separate predictions, inclusive dates, metric/English units, GMT/local standard/local daylight time and datum. Preview shows the exact initial NOAA URLs and chunk plan. It records no source response.
3. **Start the selected capture.** The application retains the actual station response, then follows the supported resource URLs NOAA advertised in that response. It records accepted, unavailable and failed requests. Pause/resume continues the original capture and keeps its completed responses.
4. **Inspect the retained edition.** Review source completion, actual timestamp/value coverage, original quality fields, station datums and epochs. Page normalized rows or download the exact response bytes. Leave a dated, source-bound review or follow-up note.
5. **Prepare a receiving mapping or dataset.** A model-input mapping selects original columns and explicit receiving headings. A native dataset selects one immutable edition, table, dates and products for the existing SF30 query engine. Neither action transforms a datum or fills a missing measurement.
6. **Inspect and release.** Enter actual authorized payment terms and original publisher settings. Prepare, inspect and explicitly activate/start through the native release control. Enter the generation returned by inspection for a generation-bound change. Customer receipt inspection and receiving use the existing buyer inbox and its original intent IDs.
7. **Export and reopen.** Export a complete selected table, all originals in a source package, a readable source report, a comparison or the five original customer files. Retain receipts and hashes. Stop/reopen through the same owner; paused requests and uncertain operations require explicit original-request recovery.

The included [La Jolla recipe](examples/la-jolla-reference.json) selects NOAA station 9410230 and January 1–7, 2025 in metric/GMT/MLLW as a public reference. It contains **no captured observations**. Its optional longer range is a proposed source choice, not a completed backfill or a claim that measurements are available. The receiving engineer decides whether the regional station is appropriate for the actual study.

## Multi-year capture with bounded memory

A capture covers one to 366 inclusive days. A historical study covers up to five calendar years and composes consecutive, nonoverlapping native capture parts. Each part uses the same provider and operation journal.

- Six-minute water levels and predictions use at most 28 inclusive days per NOAA request.
- Verified hourly heights use at most 365 inclusive days per request.
- A backfill runs child captures serially. Completed parts remain immutable. Failure stops the affected part; resume continues its original capture.
- Every response is bounded to 32 MiB. One capture is bounded to 256 MiB and 128 source tasks.
- Table projection reads one retained response at a time. Browser/API pages contain at most 500 rows.
- Combined backfill CSV/JSON/JSONL exports stream completed and explicitly partial editions, each identified in the receipt. A missing part remains declared in the backfill metadata.
- Comparison processing holds one metadata resource or seven-day product partition at a time. Counts cover the whole comparison; the console retains up to 200 examples per change kind. The JSON export streams every change.
- Native SF30 dataset preparation has explicit 250,000-row and 256 MiB selected-snapshot limits. For a large historical study, select the annual/windowed dataset needed by the consumer. The five-year archive is not implicitly loaded into one query snapshot.

Exports are written incrementally into private immutable files and finalized with byte counts and SHA-256. The stream limit is 1 GiB. Browser downloads use short-lived, single-use tickets for the same retained file; large exports do not first become an application-side browser Blob. The merchant adapter passes a verified read-only file descriptor to the existing bounded retained-file reader.

## Source meaning and coverage

The request and field contract in `schema.mjs` cites the original [NOAA Data API](https://api.tidesandcurrents.noaa.gov/api/prod/), [response definitions](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html) and [Metadata API](https://api.tidesandcurrents.noaa.gov/mdapi/prod/).

| Field or decision | Retained meaning |
| --- | --- |
| `water_level` | Six-minute measured water levels; original preliminary/verified `q` remains attached. |
| `hourly_height` | Original verified hourly-height product, distinct from a six-minute series. |
| `predictions` | Separate provider predictions, never labeled observations. |
| Datum and units | Exact request basis and returned values. Datum/epoch evidence is separate. |
| GMT | Receives a UTC timestamp projection after validation. |
| Local time | Retains its source timestamp/basis; UTC remains blank. Daylight ambiguity is not guessed. |
| Preliminary `f[0]` | Number of excluded one-second samples. |
| Verified `f[0]` | Inferred-value flag. Other positions retain actual product/quality meaning. |
| Empty/null value | Distinct from numerical zero through `valueType`. |
| Source-complete | Every requested task reached a recorded completed/unavailable outcome. |
| Complete observations | Requires the fixed expected grid, populated values, no conflicting duplicate keys and completed observation requests. |

A no-data response is retained as unavailable. Other errors retain their response and leave the task incomplete. No interpolation, quality upgrade, datum conversion, local/DST conversion, navigation assessment or project design calculation is performed.

Coverage and metadata describe the whole original edition. Coverage may select original products but retains complete edition dates. Metadata retains full product/date context. Narrow date windows belong to observation/prediction tables.

## Mappings and immutable exchange

A mapping has an ID, revision, table, selected source/receiving columns and explicit decision note. Required identity columns are `editionId`, `recordId` and `sourcePageSha256`. The [model-input example](examples/model-input-columns.json) also keeps station, timestamp, value/type, datum, units, quality and source locator.

Mappings perform column selection and renaming only, preserving original strings and precision. A model requiring numerical conversion, another datum, corrected quality or local-time interpretation needs a separate explicit engineering decision.

Every table export pins its mapping revision, editions, source hashes, query basis, annotations and backfill snapshot. JSON embeds this metadata. CSV and JSONL carry selected row columns; their native export receipt supplies full mapping and selection metadata. Keep that receipt with the file.

Comparison JSON has `context`, compatibility findings, complete `counts` and a streamed `changes` array. Every change has a `kind` and an original or before/after record. Window/product scope changes are separate from observation edits. Duplicate keys remain ambiguous. Comparison never overwrites either edition or adopts a value.

## Recovery and portability

The original request is `{action,payload,operationId,expectedRevision}`. The native ledger reconciles its operation ID and exact request hash before current revision. An accepted action with a lost response can return its original result on an explicit retry.

Station, mapping and source-review drafts retain the exact saved record they were opened from. Background capture progress may advance the workspace revision without rebasing those drafts. If that same saved record changes, compare the original version, current version and entered draft, then explicitly choose which fields to retain before saving. A new subject or record remains distinct.

The original request also retains its originating draft identity. Both normal completion and exact replay apply the original saved station/mapping ID and saved-record baseline before the completed browser journal is written. Later unsaved field edits survive; a different newly opened draft does not receive another draft’s result.

The browser preserves the original request and later unsaved drafts separately. Authentication errors, transport failures and incomplete/5xx replies retain the request. Read its native operation status, reopen the original session, then choose retry. A definitively rejected request can be closed while keeping its form. An uncertain request is not silently discarded or given a new ID.

Source-package import verifies every response hash and advertised station/resource/request binding, then uses the same capture machinery. It retains source-observed times, never refetches a missing response and never relabels imported evidence as freshly observed. One package import is bounded to 64 MiB; larger raw source sets remain individually downloadable by original receipt.

Back up or relocate the **complete closed workspace**, including native JSON, objects, editions, exports, datasets, publisher state and receipts, through the host's existing backup/recovery mechanism. A source package exchanges selected evidence; it does not replace the complete workspace backup. Preserve the original writer lease.

## Public integration surface

- `openCoopsWorkspace` — original operation/store lifecycle.
- `startCoopsWorkspace` — one native localhost console.
- `makeQuery`, `requestPlan`, `makeBackfillPlan` — explicit source selections.
- `iterateEditionRows`, `editionRows` — streamed/bounded projections.
- `iterateComparisonChanges` — complete bounded comparison.
- `writeTableExport`, `writeSourcePackage` — immutable streamed exports.
- `prepareCoastalDataset` — original SF30 dataset preparation.
- `coopsWorkspaceTools`, `MerchantCoopsWorkspaces` — existing merchant attachment.
- `openCoopsClient`, `downloadCoopsFiles`, `reopenCoopsFiles` — original calls and complete file receiving.

The additive contribution registers commands, browser assets, source exports and the Applications/merchant providers. It does not replace shared runtime or peer-product code.

Source-edition selection and request-plan preview use the same retained-request effect. Replaying a completed selection restores the exact immutable edition. A preview is restored only if the original capture draft token, fields, mode and station profile still match; later inputs keep it invalidated. The browser stores that preview and selection with its existing workspace journal.

## Connected receiving and project handoff

[RECEIVING.md](RECEIVING.md) provides the one existing-page capture → actual independent review → complete source/model-input receiving → original SF30 query → serial historical capture → same-origin reopen continuation. It creates no server or browser. [DELIVERY.md](DELIVERY.md) separates implemented source capabilities, required actual receiving evidence and project-specific engineering decisions.


### Import and receive an existing model-input convention

Select **Model-input mappings → Select mapping file**. Choose one nonempty UTF-8 JSON file up to 64 KiB: the published example, a plain saved mapping, or a native `stellar-forge.coops-model-input-mapping-file.v1` download. The inspector uses the same native mapping validation as saving.

Choose **Distinct new mapping** or explicitly select a saved receiving mapping, record the responsible model owner and intake decision, then inspect the complete convention beside the current target and current draft. An ID or revision inside the file is source provenance only. **Open reviewed file as draft** does not save. The normal editor can adjust receiving headings; **Save mapping revision** commits those explicit fields.

The saved revision retains the exact uploaded filename/bytes/SHA, declared source mapping, original normalized convention, intake decision and adaptations. Its original input file remains in the native object store; later revisions retain their own evidence and the complete earlier mapping history. Earlier exports stay pinned to their original mapping revision. **Revisions / input file** downloads each exact original file, including after reopen.

If another operator changes the selected target after inspection, recompare before applying the file. Polling does not silently rebase the draft. An interrupted save keeps its original operation and incoming file; exact replay applies the saved ID to the originating draft while retaining later edits.

A downloaded convention can return through the same intake. Staff select its receiving target explicitly and review it as a new revision. The file adapter rejects a requested transformation that differs from the native field-selection/renaming contract. It does not evaluate an engineering model or infer the customer's headings.

Read-only CLI inspection and original-file receiving use the running console:

```sh
node coops/cli.mjs --session /private/coops-startup.json inspect-mapping --file /selected/model-input.json
node coops/cli.mjs --session /private/coops-startup.json mapping-source --mapping-id mapping-ORIGINAL_ID --mapping-revision 1 --output /new/received-mapping.json
```

Agent access uses the same `merchant_coops_mapping_file` inspector and `mapping.save` payload with optional `mappingSource: {filename, base64, decision}`. The existing retained-file transfer accepts `kind: "mapping-source"` and the exact mapping revision as `page`. Keep its transfer receipt with the data export.

## Coastal residual workbook

Open a retained edition and choose **Build coastal workbook**, or open the
workbook form below **Compare retained editions**. Select original GMT
water-level observations and six-minute predictions. The same edition can
supply both products. Retain analyst options and notes, then download the
complete offline HTML or editable workbook. Full paired data, episode/unplaced
CSVs, original source responses and a delivery manifest remain in Handoff files.

The original journal reconciles the same `analysis.export` request and creation
time across interrupted publication. The CLI exposes `analyse --operation-id
ID --request ORIGINAL_SELECTION_JSON`; Merchant exposes the same action and
retained-file reads. The installed `coops-analysis` command reproduces a complete
directory from an original input or portable workbook.

See [the full analyst workflow and source contracts](analysis/README.md).
