# Open the original Gauge study after receiving

The existing Study transfer now opens the complete retained Gauge, Station Geography and regional report behind a saved scientific source. Use the same received Workspace and original selected Study receipt. The source choices, saved calculation identity and reporting-area selection remain those captured with that receipt.

## Receiving journey

1. Restore the selected Study archive through the existing receiving form, or use the established native Gauge receiving course. Switch the operator to its actual restored Workspace.
2. Open **Study transfer → Received studies and original sources**. The catalogue shows scientific reports, editable Implementation plans and Gauge studies. Open the retained Study.
3. Under **Gauge support and original geography**, inspect the selected reporting watershed and utility-source footprint counts and declared catchment support method. Open **Source details** for the original project, full HUC12 selection and source/build hashes.
4. Choose **Open Gauge support**. The original Gauge desk opens the exact saved edition and build. Its retained map, gauge coverage, source choices and report downloads remain available. Use the desk's existing selection controls when preparing another edition.
5. Choose **Open Station Geography** to inspect the retained station edition in its maintained desk, or **Open regional report** to open the original watershed report and its verified downloads.
6. Choose **Add source to report** to append this exact source collection/source ID to the existing scientific report composer. The composer preserves an existing draft's order, title and contact fields through its maintained source-selection API.
7. Download the complete original Gauge, station, regional and source-companion files directly from the received Study. Associated saved scientific reports remain alongside their captured source.

The original selected-study preview also describes which Gauge sources will retain editable same-project geography, and which contain originals from another project. The preview uses the current closure's real source-lineage rows.

## Historical and external source editions

A Study opens its captured scientific source. A later scientific report may coexist in the Gauge desk for the same immutable calculation. If that later source differs, the desk explains the distinction and the received Study continues to expose its historical report and original source through its own verified links.

For a scientific source originating in another project, the received Study retains the complete captured Gauge results, source recipe, maps and companions. It offers the original contained source to the scientific report composer. Its native editable buttons are shown only when the original Gauge, station and regional records belong to the receiving project. Foreign IDs are never resolved against unrelated local records.

Whole upstream catchments, indexed split catchments and coordinate-derived drainage basins keep their existing declared support kinds and request flags. This navigation reads the original producer's description; it neither substitutes geometry nor changes the gauge/series identity, reporting domain, upstream support or utility footprint.

## Source and ticket binding

The new model reader is `model/gauge_study_receiving.py`. It extends the existing `model.study_receiving.detail` result after the maintained selected-study resolver and scientific-report receipt checks, before the same closure's final `assert_unchanged()`.

For each captured Gauge source it requires the complete current lineage record to equal the original receipt. It then verifies the exact source collection/source ID, source-body hash and producer metadata. Same-project navigation additionally binds:

- the original Gauge edition ID and immutable build;
- the original Station Geography edition ID and immutable build;
- the exact retained Gauge selection;
- the original completed regional report and its source fingerprint;
- all three required editable records;
- every original Gauge, station, regional and source-companion descriptor.

All file reads join that same existing closure. `operator/gauge_receiving.py` verifies each actual member before creating the ordinary operator file ticket. The browser only renders those verified ticket URLs.

The browser captures the receiving Workspace, original opened Study and navigation generation before an action. The Gauge desk rechecks its Workspace and expected edition/build after awaited catalogue and detail requests. Source composition sends the backend-bound original selector and title to the current `host.openScientificReport` API.

## Maintained integration

Full shared postimages are supplied for composition by the existing Study receiving owner. Their hooks are:

- `model/study_receiving.py`: import the Gauge reader, merge `summary(identity)` into the catalogue row, and call `augment(closure, retained, result)` before the existing final closure assertion.
- `operator/study_receiving.py`: call `gauge_receiving.decorate(operator, workspace_key, result)` before adding the existing Workspace key.
- `operator/web/received_studies.mjs`: import `receivedGaugeHTML` and `openReceivedGauge`; retain all original Implementation sections and append Gauge content; dispatch only the distinct `gauge-` action prefix to the additive helper.
- `operator/web/extensions/study_transfer.mjs`: import `receivedGaugePreview` and append it to the existing preview using `plan.scientific_report_sources`.
- `operator/extensions/study-transfer.json`: retain the full current routes and assets, add `gauge_received_studies.mjs`, and declare the already-maintained host APIs `openExtension`, `openItem` and `openScientificReport`.
- `operator/web/gauge_support.mjs`: expose `openSavedStudy({workspace_key, edition_id, build_id, study_id, source})` while preserving every original desk action.

The Gauge receiving fragment preserves its existing `study-transfer` dependency and all three original editable-transfer helper paths. The additional model reader uses only the standard library and common model utilities; it does not eagerly import GIS modules. The Gauge installer carries all18 owned files, including these four additive receiving files, and requires the maintained shared Study receiving modules, client and descriptor. Apply the composed full current shared application before using the family installer; it preserves shared host files. Full product selection includes the existing Gauge, Station Geography, Regional watershed and Scientific Reports components. Their maintained implementations and installers remain authoritative.

## Native course and focused receiving check

Continue the original `source_tools.receive_gauge_support` course, with its selected source/catchment/reporting choices and existing Workspace. The merged receiving successor prepares the saved scientific edition, exports its editable selected Study, independently opens the archived application/Workspace and preserves a complete Workspace archive. This navigation joins the resulting original Study receipt.

At the existing native/browser phase, verify one real received Gauge Study end to end: open the original Gauge build, open its retained Station Geography, open the original regional report, download an original companion, and append the original scientific source to an existing draft. Capture the actual received Workspace, Study/Gauge/Station/regional IDs and the first concrete exception if one occurs. The source reader and navigation add no native model execution or duplicate capture queue.

## Exact rendered-product inspection

Before presenting this client-facing workflow as ready, the producing receiver must open and render the exact outgoing application and actually view its screen or real screenshots. Operate the Gauge, Station Geography, regional, scientific-source and original download controls on the populated received Workspace. Inspect the actual screenshare width and a narrow/mobile width, plus relevant empty/loading/error states and reopening. Fix clipped tables, unreadable identifiers, overflow, missing styles or broken controls in this same maintained workflow. Keep the plain industrial presentation and original scientific data. Capturing screenshots without viewing them, source review or HTTP success does not complete this inspection. Continue focused verification of this actual journey without adding a broad test suite.

This requirement carries Bryce’s persistent rendered-product instruction from1791881463.183449 into the maintained receiving guide. Include it when delegating this receiving phase and preserve the existing14:00UTC sprint cutoff.
