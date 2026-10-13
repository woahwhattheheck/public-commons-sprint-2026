# Receive the complete CMS reviewer as a recipient

This is the maintained product receiving course. It opens the real standalone reviewer, receives either the complete original publisher ZIP or its complete original-source transfer through the existing controls, applies an explicitly reviewed source request, retains every supplied member and field, downloads the complete delivery and reopens the recipient edition in a new browser context. It saves actual desktop and 390-pixel screenshots for the producing reviewer to open and inspect.

Use an already installed Node, Playwright and Chromium. The driver installs nothing, obtains no publisher data, sends no messages and does not change the original input files.

## Inputs

Supply the complete current tool directory, including release_core.mjs, release_csv.mjs, archive_core.mjs, csv_intake.mjs, review-desk.html and receive_browser.mjs. Keep the current viewer and its modules from the same merged edition. The comparison template is already embedded in the complete viewer.

When using --archive, the original archive must be the actual publisher ZIP. A later convenience ZIP containing extracted members has a different origin and cannot stand in for it. For the existing May CMS course:

- Full original hospitals_2026-05-13.zip: 13,830,630 bytes; SHA256 a0816ffb0fdd9f1bd4fe1efe37928de71b604f2bd8b75c23925edaf6d9c9f7d0; publisher source: https://data.cms.gov/provider-data/sites/default/files/dataset-archives/theme/hospitals/hospitals_2026-05-13.zip.
- Selected Hospital_General_Information.csv: 1,453,884 bytes; SHA256 83c98b2e8687580e0482b13e1e9acd5813534be243e5ccd9f55556a869595d40; 5,432 national rows, 378 California rows and 38 original columns.
- Reuse the retained publisher files. The included complete-source transfer also contains the unchanged original CSV.

Read the actual original readme before filling request.metadata. A dated archive name does not establish a publication date. Use source_released:null with actual date_provenance.publication when no publication date is supplied. A separately attributed archive_date has its own archive_date_meaning and date_provenance.archive. Exact readme source_member/source_sha256 pairs are checked against the original ZIP.

The JSON request is the existing source-csv-request/1 shape used by the CLI and mapper. It must explicitly identify every chosen original-header → known-field mapping; unassigned columns stay under their original header. Preserve the original header order in column_mapping, and use original/<CSV basename> for original_member when it is present. The browser exports this same reviewed mapping/date/dictionary selection and the driver compares the reconstructed manifest to independent native receiving.

The optional dictionary_url is a source attribution, not a replacement for the retained original dictionary member. Leave it blank when no original dictionary URL is supplied.

## One actual course

Set the variables below to paths already returned by the original receiving host. CMS_REVIEWED_REQUEST is the actual reviewed May metadata/mapping request, not a guessed date or generated substitute. CMS_RECEIVING_OUTPUT is a directory owned by this same operation.

~~~bash
"$CMS_NODE" "$CMS_TOOL/receive_browser.mjs" \
  --viewer "$CMS_TOOL/review-desk.html" \
  --archive "$CMS_ORIGINAL_ZIP" \
  --request "$CMS_REVIEWED_REQUEST" \
  --archive-sha a0816ffb0fdd9f1bd4fe1efe37928de71b604f2bd8b75c23925edaf6d9c9f7d0 \
  --csv-sha 83c98b2e8687580e0482b13e1e9acd5813534be243e5ccd9f55556a869595d40 \
  --output "$CMS_RECEIVING_OUTPUT" \
  --chromium "$CMS_CHROMIUM" \
  --playwright "$CMS_PLAYWRIGHT" \
  --reviewer "Recipient receiving operator"
~~~

The default Playwright import uses the current host's installed module resolution if --playwright is omitted. No browser install is attempted. --timeout may be set from 10000 to 600000 milliseconds for slower original archives.

The course saves receiving.json after each meaningful phase. If it is interrupted, retain that directory and the complete downloads. A same-input restart checks the original input identities; a different edition needs a separate output directory. It creates no second source acquisition or modeling operation.

## Receive the complete retained May source directly

The public May/August example is in `examples/may-2026-to-august-2026/`. It contains the unchanged national publisher CSV (5,432 rows), the original publisher readme and dictionary, its explicit source request and a complete source transfer. The transfer independently reconstructs all 378 California records and every original field. This input mode uses the reviewer's existing **Receive previous release** control, then imports the same retained CSV through the explicit mapper and source-date controls. It preserves the whole-ZIP route above for the original archive holder.

From the maintained tool directory, run the same receiver with the host's existing browser runtime:

~~~bash
node receive_browser.mjs \
  --viewer review-desk.html \
  --prior-source examples/may-2026-to-august-2026/may-complete-source.json \
  --request examples/may-2026-to-august-2026/may-source-request.json \
  --csv-sha 83c98b2e8687580e0482b13e1e9acd5813534be243e5ccd9f55556a869595d40 \
  --output "$CMS_RECEIVING_OUTPUT" \
  --chromium "$CMS_EXISTING_CHROMIUM" \
  --playwright "$CMS_EXISTING_PLAYWRIGHT"
~~~

Supply exactly one of `--archive` and `--prior-source`. Both modes use the actual reviewed `--request`. The prior-source mode verifies the complete transfer from its original CSV, requires an identical request, writes the unchanged original CSV only after checking any existing output's identity, and records its actual input mode. It receives the original transfer, operates the explicit CSV mapper, saves complete comparison/source downloads and cold-reopens the recipient comparison and review. A fresh browser then re-receives the same original transfer. Archive-only inventory/download phases belong to the separate whole-ZIP input mode.

The May publication date remains unknown; 13 May 2026 is the original archive's unpublication/replacement date, according to its unchanged readme. The source-derived comparison is 371 unchanged facilities, six changed facilities, one removed source record, zero added records and 18 complete change items. Removal from one dataset edition does not establish hospital closure.

The actual Page and outgoing attachment options below also apply. Use the exact same standalone edition and captured Page fragment; retain the actual received screenshots and open them for visual inspection.

## Actual published Page

For the full actual Page phase, supply its exact retained published fragment and SHA together with its observed URL and the existing authenticated browser's CDP endpoint:

~~~bash
  --published-fragment "$CMS_PAGE_FRAGMENT" \
  --published-sha "$CMS_PAGE_FRAGMENT_SHA" \
  --page-url "$CMS_ACTUAL_PAGE_URL" \
  --cdp-url "$CMS_EXISTING_BROWSER_CDP"
~~~

The driver verifies the captured fragment SHA, then requires the same complete embedded original-source/comparison payload and receiving script as the outgoing standalone edition. The published fragment keeps its own exact scoped CSS; Page wrappers may replace standalone :root/body selectors with their specific host ID. The driver opens its own tab in the existing browser, finds the live source-review frame and checks that actual fragment’s style, receiving script and complete original source transfer. It searches, opens a source record, downloads the original transfer and records actual desktop/390px light/dark Page images. It closes only its own tab and driver connection, preserving the original browser/profile. It does not export cookies, discover a login or create a replacement account session.

An exact retained published Page fragment may also be operated without a live Page connection by supplying --published-fragment "$CMS_PAGE_FRAGMENT" --published-sha "$CMS_PAGE_FRAGMENT_SHA". Its scoped CSS remains unchanged, while its embedded source payload and receiving script must match the current standalone edition. It is opened in light and dark receiving host frames and operated. These images are labeled as a captured-fragment course; they are distinct from actual live Page acceptance. A fragment from an older product edition must be replaced with the current published fragment before this course; it cannot silently pass because its original dataset happens to be unchanged.

## Open the actual outgoing attachments

Append the actual outgoing attachment paths, preserving the original files:

~~~bash
  --recipient-brief "$CMS_OUTGOING_BRIEF" \
  --recipient-csv "$CMS_OUTGOING_CSV"
~~~

The driver retains both originals unchanged and verifies the CSV bytes, every original field and every literal cell against the current edition. It opens the unchanged brief text file directly in Chromium’s normal plaintext viewer and captures desktop/390px light/dark views. It also creates a supplementary literal view containing the complete brief and all CSV cells; that authored panel is not labeled as the recipient’s normal spreadsheet or data application.

At the same equipped receiving operation, open the exact retained CSV in the host’s existing spreadsheet/data viewer. Retain the original-file hash and that application’s import/document identity, inspect the 38 original columns and literal identifiers, and return actual desktop/narrow screenshots alongside the browser-course results. Open the complete outgoing reviewer attachment itself and the brief in their ordinary viewers. The producing reviewer must look at these returned images and attachments before the next prospect delivery. No additional viewer install or source acquisition is part of this course.

## What is retained

The ordinary output directory contains:

- Receiving status, exact source identities, date meanings and independently reconstructed comparison.
- Complete original archive inventory and the untouched downloaded publisher ZIP in archive mode; the unchanged complete prior-source transfer and original CSV in prior-source mode.
- Complete imported CSV/source request and current API source transfer, plus the original archive intake when supplied.
- Every comparison record and source field in JSON/CSV; all original before/after source downloads.
- The full offline comparison reviewer, exported decisions, and re-imported/re-exported recipient decisions.
- Actual desktop/390px light/dark PNGs, source-mapper PNGs, and computed visible-control styles/geometry.
- Actual Page and exact-fragment results when those phases are configured.
- The unchanged outgoing brief/CSV when supplied, normal plaintext-brief images, supplementary literal views, and the exact CSV identity for the host’s normal data-viewer inspection.

The producing reviewer must open the returned images and the actual downloaded/reopened product, inspect readable labels and controls, and repair any real defect. A completed automated phase does not claim that a person or model already looked at its pixels.

For the May/August course, the independent result should use all 378 original May California records against all 377 retained August records and every original field. The actual changes are computed from the supplied originals; the driver does not hardcode a difference count.

## Source meaning

This course records review decisions about receiving the data handover. It does not alter CMS source values, infer clinical quality, fill unavailable values or turn an archive replacement date into a publication date. Original identifiers remain literal strings. The working delivery remains one complete current product, with exact originals available through its normal controls.
