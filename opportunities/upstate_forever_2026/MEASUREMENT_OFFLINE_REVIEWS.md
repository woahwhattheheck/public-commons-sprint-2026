# Complete offline observation reviews

Version 1.0.0 · ECO-CLOUD-COMPARE13 · 13 October 2026

The original Measurements workspace can now hand a complete collection to a reviewer without a server. `review.html` contains the original measurements, original file downloads, source lines and hashes, native review history, censor bounds and native eligibility reasons. The reviewer filters and opens records, writes reasoned single-record or batch decisions, and downloads a complete change file. The receiving command reconstructs an independent native workspace, applies those changes through the original review engine, and publishes another complete editable review package.

## Use the complete handover

Extract the whole delivery ZIP. Open `original-review/review.html`. It is the unchanged five-station source edition. Search or filter the records, open a result, inspect its retained source and record a draft decision. Enter a reviewer name, download `review-changes.json`, and keep it with the original package. The review table CSV is a readable companion; JSON is the native receiving input. Browser-local draft persistence is optional and its availability is displayed. Downloaded change files remain usable when browser storage is unavailable.

All original files remain downloadable from the reader. The HTML embeds their full bytes; its table pages do not truncate the collection. No third-party scripts, fonts, network service, model execution or extra account is needed. Large complete collections require enough browser memory for their complete embedded files and normalized records; this is an offline receiving format rather than the separate streaming-import interface.

From the delivery root, use Node 22.16 or later:

```sh
node application/measurement_workspace/engine/offline_review_cli.mjs inspect \
  --package original-review --changes /path/to/review-changes.json

node application/measurement_workspace/engine/offline_review_cli.mjs receive \
  --package original-review --changes /path/to/review-changes.json \
  --workspace /path/to/new-recipient
```

Open `/path/to/new-recipient/review-package/review.html`. The native editable SQLite workspace is `/path/to/new-recipient/measurements`. Its reports, source collection and subsequent exports use the existing Measurements commands. The complete received package carries the reviews and their original source history, and it can produce the next offline review edition.

## Export another native collection

From the application root:

```sh
node measurement_workspace/engine/offline_review_cli.mjs export \
  --workspace /path/to/native-measurements \
  --collection ORIGINAL_COLLECTION_ID \
  --output /path/to/new-review-package
```

This publishes a revision-pinned edition with the original `publishCollection`, opens its original `project.json` through `MeasurementWorkspace.receive`, and renders the complete original population. `collection.json`, `native-reaches.json`, the original input files and original native reports travel with it.

Programmatic callers import `exportOfflineReview`, `inspectOfflineChanges` and `receiveOfflineChanges` from `measurement_workspace/engine/offline_review.mjs`. The original `MeasurementWorkspace` is the scientific writer. No server controller, model queue or cohort-comparability store is replaced.

## Review meaning and source custody

A draft records a requested `pending`, `include` or `exclude` decision, an explicit rationale and a user-entered reviewer name. A source-version choice must be explicit and included; only one version of a logical measurement can be selected within the draft. Names are not authenticated signatures.

Receiving checks the exact original project, collection, edition, record population, normalized measurements, source downloads and per-record review fingerprints before opening a new recipient. Every accepted decision goes through `MeasurementWorkspace.review`. Native mapping, unit, censoring, scientific-method and source-conflict restrictions remain in effect. An included review does not turn a censored, unmapped or unsupported observation into an eligible calibration value.

The sender is never edited. Repeating the same completed receive returns its existing recipient and does not replay changes. A different receiving operation cannot overwrite that recipient. An interrupted receive resumes its same staging directory, including recovery when a native review committed before its progress marker. The package and its receiving file must be retained together. Shared-file hashes establish content identity, not authorship or third-party authentication.

## Installation into an existing application

Run `python install_measurement_offline_review.py --application /path/to/application --source-root /path/to/this/source`. The installer adds only this feature's own files and its component fragment, preserves the native engine and peer controllers, and refuses to replace a different existing feature edition. An identical interrupted installation can be repeated. The component requires `measurement-collections`; its manifest is `integration/component_fragments/measurement-offline-review.json` for the original application assembler.

The complete handover includes the 55-file Measurements 1.2.0 source closure operated in this Linux session. Shared current-application source remains authoritative; do not replace newer native modules with that archived dependency copy when installing the seven additive feature files.

## Operated source case

The unchanged original collection has **533 records**, **five stations** and **247 censored records**, from the retained 2023 WQP source files. Its original collection identity is `929f89f0ccf8974e3cae0d3a62090b6b878580127bac91534caaa23415fa329e`. Complete original CSV bodies, native normalization source and companion descriptions are included. All 533 original records and all five source bodies were compared after receiving; original station and mapping rows were also preserved.

The separate `internal-receiving-example` demonstrates two explicitly labeled engineering-exercise reviews. Its author-entered reasons identify them as an internal exercise. Start with `original-review` for actual scientific review. The example demonstrates round-trip editability and is not the original source edition.

The populated outgoing reader was operated in Chromium at 1440 and 390 pixels. Actual filtering, source/censor inspection, reasoned review edits, JSON/CSV and exact-original downloads, cold change-file reopening, empty results and wrong-source recovery completed. Native receiving, a second independent native reopening, identical-operation replay, and lost-response recovery retained every original record without duplicate review events. Actual outgoing screens were viewed, including the repaired phone details pane and original native report. Browser execution of the self-contained HTML required no network requests. This lane did not change browser administrative policy.

## Current receiving direction

Carry the complete `CURRENT_OWNER_DIRECTION.md` version **2026-10-13.3** and the original application's `AGENTS.md` when composing this source into the Ecosystem handover. Keep the active regional native modeling operation and its existing owners intact. This offline measured-data review is a complementary receiving capability. The current sprint ends at **14:00 UTC on 13 October 2026**. Open and use the outgoing product and its attachments at desktop and narrow widths, repair observed faults, and retain the original scientific source identities and exact units.
