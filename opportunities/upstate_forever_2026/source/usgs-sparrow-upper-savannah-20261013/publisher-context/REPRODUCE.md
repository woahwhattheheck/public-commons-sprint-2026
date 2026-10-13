# Reproduce the published SPARROW prediction context

This is the source-context chapter for original operation ECO-INDEPENDENT-COMPARISON-B3909-20261013, WO28. It consumes the existing five-reach receiving packet, original regional calibration tables and release dictionary, plus the actual publisher index and the JavaScript that index references. It does not fetch new predictions, run a native watershed model or fit a calibration.

## Whole source and output

The directory contains nine complete files:

| File | Purpose |
|---|---|
| inputs.json | Complete original text bodies, hashes and retained receiving information for seven sources; received-predictions.json itself retains all six original schema/prediction responses |
| analyze.cjs | Pure calculation and data-only publisher configuration reader, plus standard Node reproduction entry |
| publisher-field-map.json | Exact publisher labels, annual units, support, source keys, original definitions and comparison caveats |
| prediction-context.json | All fifteen original feature records, 120 budgets, 880 component values and all fifteen old/new-edition cells |
| PREDICTION_CONTEXT.md | Readable fifteen-row results, source-allocation interpretation, exact source definitions and edition differences |
| prediction-totals.csv | All selected metric totals with full original feature JSON |
| source-budgets.csv | All 880 source components, totals, shares and unbalanced rounding residuals |
| edition-differences.csv | Eleven distinct old/current overlaps and four explicitly missing old calibration cells |
| REPRODUCE.md | These receiving/reproduction instructions and the complete standing owner rule |

The original raw response numeric tokens remain inside inputs.json. Calculations use JavaScript finite numbers and retain full computed precision; tables format selected display columns. No target loads are summed across potentially nested reaches. No component is silently rescaled to force totals to match.

## Reproduce without network

With the original complete directory received on an equipped host:

```sh
node analyze.cjs inputs.json ./publisher-context-reproduced
```

The output directory must not exist. The command verifies every original source text against its declared UTF-8 byte count and SHA256, verifies all six nested prediction responses, checks the five selected original numeric COMIDs and all declared feature attributes, and reproduces the six result files. It prints byte/SHA pins for those outputs. Any interruption leaves already written files intact; inspect that original directory rather than overwrite it with a new result. The parser reads only the specific plain key/string configuration objects from the publisher script and never executes the downloaded JavaScript.

The pure exported API is `analyze(input, hash)`, `csv(result, "totals"|"budgets"|"editions")` and `report(result)`. The hash callback returns `{bytes,sha256}` for complete UTF-8 text. This source edition has executed those exact pure functions over all retained originals in the existing V8 source environment. The new Node wrapper and actual customer-facing rendered result remain for the original equipped native receiving course; a source execution is not a rendered acceptance claim.

## What the publisher source resolves

The index actually references scripts/combined.js. Both exact original files are in inputs.json, with their supported Notion source_url creation and subsequent complete-text read receipts. The source host HTTP status and response headers were not returned by that route and remain null.

The publisher's load definitions establish mean annual loads; its JavaScript supplies kg for nitrogen/phosphorus and MT for sediment. This jointly establishes kg/year and metric tonnes/year, with area-normalized yields and mg/L concentration separately identified. The raw ArcGIS aliases alone did not establish those units.

The same original script labels calibration ACTUAL as Beale-or-Fluxmaster estimated TN/TP load and PLOAD_TOTA as SPARROW estimated load with kg/year chart units. Sediment ACTUAL_MT is SSC-or-TSS and PLOAD_MT is SSC, both MT/year. The earlier fit-context analysis remains its own immutable dictionary-only edition; this new source-backed mapping resolves that edition's open unit question without changing any original calibration value.

The sediment popup calls TSS_CONV a conversion factor, but the retained negative coefficient is interpreted only through the cited report equation 3: SSC-equivalent load = TSS load / exp(bCONVERT). The previous fit-context chapter preserves exact coefficients and separately derived values. This prediction chapter does not refit, replace or silently harmonize them.

## Scientific and source boundaries

- Incremental load includes attenuation over half the incremental stream reach. It is not automatically a native hillslope-to-stream quantity.
- Accumulated load includes upstream routing and attenuation; the local source allocation may differ sharply from the upstream allocation.
- Delivered quantities use the retained TARGET, Atlantic Ocean for these fifteen rows. They are not delivery to the selected monitoring station.
- Nitrogen fertilizer/manure source labels already include indirect atmospheric transport. The separately labeled S5 category is not all atmospheric transport.
- Suspended sediment includes publisher land-cover/geology categories and a channel source term; preserve the original analytical fraction.
- Source allocations are model components, not measured causal contributions.
- Four calibration cells have no original row. All eleven overlapping PLOAD/ACCL values differ; these are distinct source editions, not a temporal trend or native model error.
- INCAREAK_1 is a qualified truncated publisher alias against the release dictionary's IncAreaKm2. CUMAREAKM2 is an explicit case match to CumAreaKm2. Preserve both original names and values. Shape attributes do not establish geometry rings or a verified native catchment.
- Matching units alone does not establish scientific comparability. The WO28 domain still requires explicit quantity, fraction, period, spatial support, source lineage and interpretation decisions.
- Exported CSVs preserve exact publisher text and original values. Open them as data with deliberate column types rather than allowing spreadsheet automatic conversion of source identifiers.

## Original operator integration

The existing authenticated WO28 extension may read the installed prediction-context.json and publisher-field-map.json and show a separate publisher-metric section in its current context tab. It should display all fifteen cells, explicit old/current editions and quantity support, and offer the complete JSON, original input and readable report. It must not write a comparison selection or make a row comparable merely because the mapping exists. The original Study/application source closure should include all nine files.

The original source acquisition peer retains ownership of prediction reception. The same equipped original operator receiving course owns native execution, desktop/narrow viewing, important controls, file download and recipient-style reopen. Do not create a second native operation or duplicate a completed source query.

## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->

