# WQX water-quality product journey

This entrypoint carries the retained, original Water Quality Portal cohort through the private analyst workspace, a complete portable review, the maintained SF30 merchant, the original SF88 buyer, and the browser. Run it once in the assigned receiving worker after the complete source revision has arrived.

The receiving command uses the bundled original capture. The cohort identity, original response files, native provider status receipts, and all three profile joins travel together. The saved analyst review selects March against January; the merchant edition contains the entire captured first-quarter cohort.

## Run the complete journey

From the repository root, with the original SF30 and SF88 dependencies already available:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/journey.mjs \
  --directory /absolute/new-wqx-product-run \
  --source-bundle stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/examples/potomac-2025-q1.source.json \
  --page-size 25 \
  --browser
```

Choose a new output directory. The command creates it with mode 0700 and retains private files with mode 0600. The full receiving operation needs Node 22 or later, Python 3.11 or later with POSIX terminal support, OpenSSL, and the existing native dependencies used by SF30 and SF88. The browser arm needs an installed Playwright package and Chromium.

If the worker has Playwright outside this source tree, supply the actual installed module and browser paths:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/journey.mjs \
  --directory /absolute/new-wqx-product-run \
  --source-bundle stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/examples/potomac-2025-q1.source.json \
  --page-size 25 \
  --browser \
  --playwright-module /absolute/installed/playwright \
  --browser-executable /absolute/installed/chromium
```

The browser module also accepts `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Those paths identify installed components; the receiving run does not install packages.

The original merchant resolves `@x402/core`, `@x402/stellar`, and `@x402/extensions` 2.28.0 through its existing SF30 dependency closure. The original SF88 buyer resolves its maintained Stellar SDK dependency through its own package. Record the actual worker package versions alongside the source revision. The previously observed receiving worker has Node 24.20.0, x402/stellar 2.28.0, Stellar SDK 16.3.1, and Playwright; the command uses the worker's observed installation.

A worker that already has the complete original capture may replace `--source-bundle FILE` with:

```sh
--capture /absolute/captures/potomac-2025-q1
```

The source-bundle flag defaults to the included example when neither source flag is provided. The two source flags are mutually exclusive. The retained capture must match the exact identity below.

## Resume the browser from the existing native run

The native terminal phase and the browser phase have separate lifetimes. The original native buyer uses its 90-second operation timeout; the terminal allows that same budget per expected purchase plus a five-minute setup margin. The expected reservation count remains the original number of result pages plus the CSV and edition purchases. The browser begins after the native terminal exits, using the retained buyer journal and original project.

Before launching Chromium, the journey saves `native-result.json`. This contains the complete native result, its canonical SHA-256, the original project revision, and a canonical hash of the private buyer configuration. `result.json` is written after the requested browser arm finishes. A native-only run writes both files when its native workflow completes.

If the process stops during the browser, resume the same output directory on the original receiving host:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/journey.mjs \
  --resume-browser \
  --directory /absolute/existing-wqx-product-run \
  --playwright-module /absolute/installed/playwright \
  --browser-executable /absolute/installed/chromium
```

This command reads the original `local-fixture/buyer-config.json`, keeps its existing buyer state and ledger, and restores the fixture-specific environment in the process. The saved configuration stays private. The original capture, saved review, merchant edition, project revision, and buyer configuration are checked before opening the workspace. Browser form edits resume from the original project snapshot, including when a prior interruption occurred between the richer-filter save and the restoration of the original selection.

A completed `exports/browser/browser-result.json` is reused after its four downloads, three screenshots, original capture, and restored project selection are checked. Otherwise the command runs the maintained browser operation with the original buyer. It writes `browser-resume.json` with the actual output paths, and joins the browser outcome to the saved native result. `native-result.json` remains the original native completion. The exclusive existing-directory lock prevents simultaneous browser continuations on one run. Both browser workspaces and Chromium close in the browser operation’s `finally` block.

Runs created before this checkpoint was introduced also use `--resume-browser`. The continuation opens their original project revision and first result, source CSV, and edition delivery intents through the maintained native buyer. Their completed browser files are saved under the same `exports/browser/` directory. If that older run has a complete original `result.json`, the browser is joined to it. Otherwise `browser-resume.json` points directly to the completed browser result. An absent delivery is reported with its original native error and retained intent; continue that exact original native operation before resuming the browser.

Failures in this continuation are saved in `browser-failure.json` with the actual stage. Keep the original native result, buyer records, source files, and any earlier browser output together when moving the completed private handoff. Resume on the original host before moving a run whose native configuration still contains host-specific paths.

The JavaScript entrypoint is also available as `resumeWaterQualityBrowser({ directory, playwrightModule, browserExecutable })` from `browser-resume.mjs`. It uses the same original-source checks, lock, saved configuration, output reuse, and browser implementation as the CLI.

## Original cohort and source identity

The original acquisition used the deployed Water Quality Portal WQX 3 interface. Its complete capture manifest and every retained member are included in [the source carrier](./examples/potomac-2025-q1.source.json).

| Field | Original value |
| --- | --- |
| Provider filter | `NWIS` |
| Monitoring location | `USGS-01646580` |
| Inclusive source dates | January 1–March 31, 2025 |
| Profiles | Station, Activity, Result |
| Partition | `none` |
| Station rows | 1 |
| Activity rows | 13 |
| Result rows | 1,035 |
| Capture completion | 2026-10-11T23:04:44.530Z |
| Capture SHA-256 | `cbb29504ab01598cddb21bde33c918ca92075aad7f53fdac4fb07581371d29d7` |
| Selection SHA-256 | `690e10e385c7633df757f800b467e2b0a3bfaf4f834fee7278466b1597883860` |
| Source-carrier SHA-256 | `ab476fabf7af0f21c9c00580c1a3f9cf15c4a9ee20be93967330a91ce1603d03` |

Exact normalized selection:

```json
{
  "filters": {
    "providers": ["NWIS"],
    "siteid": ["USGS-01646580"],
    "startDateHi": "03-31-2025",
    "startDateLo": "01-01-2025"
  },
  "profiles": ["Station", "Activity", "Result"],
  "partition": "none"
}
```

All three original response profiles and their native status receipts completed with HTTP 200. Their provider-reported output counts are 1, 13, and 1,035; each receipt's totalRowsSent also includes its CSV header. The carrier contains 19 members and 1,693,264 original bytes, including the complete capture manifest. Its gzip payload is 202,791 bytes with SHA-256 `6b2f18c82befaf5a8478cb569df2271eb425d0662363dca36b998f74873deece`.

The transfer wrapper uses `starforge.wqx-capture-bundle.v1` and `gzip+base64`. Its decompressed member array has `path`, `bytes`, `sha256`, and `base64` fields. The receiver verifies the compressed payload, every member, and the reopened original capture. It writes members exclusively, accepts an existing member only when its exact original bytes match, and writes the manifest last.

See [PROVIDER.md](./PROVIDER.md) for the original deployed profile semantics and [ANALYSIS.md](./ANALYSIS.md) for the scientific review rules.

## What the single command completes

1. **Receive and reopen the original source.** The original provider reopens the complete capture. Its retained-source resume path must make zero new source requests.
2. **Join every original result.** Each result keeps its source resource, exact CSV fields, original activity and station records, and all attached reported A/B limit slots. Provider and organization are part of the join keys.
3. **Build the scientific review.** The command saves `march-versus-january`, using March 1–31 as the review window and January 1–31 as the baseline. It also computes the full-cohort inventory. Original reported qualifiers, estimates, censoring, units, methods, sample preparation, and depth context remain visible.
4. **Inspect an original censored result.** The exact result and source position reopen with their station, activity, and detection-limit records.
5. **Export the analyst work.** The command saves HTML, JSON, CSV, and GeoJSON outputs, plus a portable review bundle containing the original source closure and the required project revisions.
6. **Receive the complete review into a second private project.** The received review and original result detail must match. A second receive of the same archive reopens that same retained work.
7. **Prepare the whole captured cohort as an edition.** `potomac-q1-water-quality` contains all 1,035 results, even though the saved analyst review covers a narrower date window. It carries the query projection, the joined result export, original capture files, report, saved review, and native dataset configuration.
8. **Serve the original merchant and use the original buyer.** The command follows the maintained native offer, review, reservation, delivery, and recovery paths. At the default page size of 25, it receives 42 dataset pages, one original Result CSV, and the edition manifest: 44 original buyer operations against the local protocol fixture.
9. **Compare every delivered result with its source.** Exact scalar values are carried in `values_json`; the delivery also preserves `record_json`, `source_json`, `limits_json`, `station_records_json`, and `activity_records_json`. The source CSV delivery must have its original SHA-256.
10. **Reopen the portable customer product.** The authoring capture is temporarily relocated, the complete edition is copied to an independent directory, and all original buyer deliveries reopen with their saved metadata and hashes. Recovery must add zero merchant requests and zero fixture settlements. The authoring capture is then restored.
11. **Use the actual browser.** With `--browser`, the driver opens the real private operator and customer workspace in the same process, then receives the complete review through a second workspace.
12. **Retain the outcome.** The command writes `result.json` only after the full requested operation succeeds. On failure it writes `failure.json` with the actual stage and concise error, preserving the operation's existing files.

The original model and scientific run on this retained cohort produced 1,112 reported A/B limits across 685 results, 452 non-detects, 146 qualified results, 10 reported estimates, 279 strict groups, and 413 rows in default arithmetic. The native join had zero issues, duplicate rows, or conflicting duplicates. These values describe the full cohort. The saved March review has its own selected inventory. Exact scientific result values and comparison reasons remain in the report.

## Original commerce fixture

The journey reuses the maintained USGS/native merchant fixture methods and the original SF81 terminal acceptance mechanism. It runs the original SF30 merchant and SF88 buyer against an owned local HTTPS gateway and local protocol facilitator.

The fixture authority is `wqx-journey.example`. A disposable certificate is trusted by the original buyer child processes through the fixture environment. An owned CONNECT proxy admits that one authority. The local signer marks its payload `LOCAL_CONTROLLED_NOT_A_TRANSACTION`; the local facilitator records protocol verification and settlement responses in the retained result.

The Python terminal driver responds to the original one-reservation prompt for these disposable fixture operations. Its maximum approval count is calculated from the complete 1,035-row journey and selected page size. It retains the exact terminal transcript privately, has an operation deadline, and terminates its owned child on interruption. Keep this entrypoint scoped to its defined local fixture.

The resulting commerce evidence covers native offer admission, review preparation, per-intent original buyer execution, immutable page continuation, exact source-byte delivery, complete edition delivery, and saved recovery. The result identifies this mode as `ORIGINAL_LOCAL_PROTOCOL_FIXTURE`.

## Actual operator and customer browser flow

The browser arm uses [browser-journey.mjs](./browser-journey.mjs) with [workspace.mjs](./workspace.mjs). It opens the actual private application and:

- Reads the saved review's scientific inventory and comparison.
- Opens a censored original result, all original fields, its joined activity/station context, and reported detection limits.
- Saves richer native source filters, including a characteristic containing a comma, then confirms that a title-only edit preserves the exact source selection.
- Confirms that unsaved source edits disable acquisition and unsaved analysis edits require a fresh review calculation.
- Restores the original source selection and downloads the exact retained Result CSV.
- Calculates, saves, and exports `browser-sample-review`.
- Prepares `browser-quality-edition` and confirms that its row count covers all 1,035 captured results.
- Reopens the original customer page, prepares a new continuation intent using its unchanged query and exact previous metadata, and prepares source/edition intents.
- Reopens and downloads the original paid Result CSV.
- Receives the complete analyst bundle into a fresh private workspace.
- Captures desktop and mobile views, checks the mobile viewport for horizontal overflow, and records browser errors.

This browser arm operates on retained captures and existing original deliveries. It verifies that the browser flow submits no source-acquisition or customer-execution request; the complete native customer executions occur earlier in the same entrypoint.

## Retained output

| Path under the chosen directory | Contents |
| --- | --- |
| `result.json` | Final source identity, exact inventories, review/edition identity, all edition member hashes and byte sizes, native purchase/page counts, recovery counts, browser outcome |
| `failure.json` | Actual failing stage and concise error when a stage fails |
| `project/` | Original private authoring project, saved reviews, complete captures, and editions |
| `received-review/` | Independently received original review and source closure |
| `exports/` | Complete analyst reports, portable review, native customer exports, and independently copied edition |
| `exports/water-quality-edition/` | Complete immutable customer edition and original capture members |
| `exports/browser/browser-result.json` | Actual browser outcomes, downloads, screenshots, and observed mutations |
| `exports/browser/water-quality-review.png` | Desktop scientific review |
| `exports/browser/water-quality-customer.png` | Native customer workspace |
| `exports/browser/water-quality-mobile.png` | Mobile review |
| `buyer/` | Original private SF88 intent and delivery state |
| `local-fixture/` | Disposable local protocol configuration, certificate, and signer |
| `local-fixture-transcript.log` | Original terminal interaction retained with private permissions |

The edition's internal query CSV and joined JSONL repeat joined source context so each delivered row is independently interpretable. Their sizes can exceed the original profile CSV. Inspect `result.edition.files` for exact per-member bytes and SHA-256, `memberBytes` for the complete retained edition, and `directDownloadBytes` for the offered source/report assets. The direct asset routes offer the original source closure, analysis, and saved review; paginated native query delivery carries the full result projection.

Keep the complete output directory and source revision together. When handing the result to another worker, include the actual command, Node/native package versions, `result.json` or `failure.json`, exact source/edition hashes, and browser screenshots. Continue any failed stage using the retained original source and the reported failure context. The complete receiving outcome belongs in the existing product owner thread so the source, result, and integration remain connected.
