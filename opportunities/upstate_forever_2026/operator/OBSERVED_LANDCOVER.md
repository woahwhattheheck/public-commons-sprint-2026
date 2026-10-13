# Observed watershed land-cover changes

The **Observed watershed change** desk makes the completed original Annual NLCD watershed analysis usable for a selected group of HUC12s. It reads the original 2023 and 2025 annual inventories and all original directional transition cells. Users can inspect a subset, save its complete comparison, download the offline report and tables, and open the retained report source in the existing Scientific Reports workflow.

The existing **Land-cover changes** desk remains the place for a new comparison from selected rasters or native run outputs using its fractional polygon-overlap method. The observed watershed desk uses the completed source analysis's native pixel-centre method. These products have different area support and should retain their respective methods when compared.

## Operator journey

1. Open **Observed watershed change** in the current Workspace.
2. If the source has not been retained there, choose **Import completed 217-HUC source**. This submits the normal native queue action against the installed original source manifest. Open **Choose original watersheds** on its completed task.
3. Choose an original analysis. The reader verifies the bound annual and paired result documents and displays their original HUC12s, names, states and support. Search by HUC12, original name or state. **Select visible** adds the current filtered rows; clearing the search preserves the selected set.
4. Choose one or more watersheds and name the comparison. **Inspect selected watersheds** opens the full directional matrix and class gains, losses and net changes. Switch between the selected non-overlapping union and each selected HUC; display cells, hectares or percent of each earlier paired class.
5. Choose **Save comparison and report source**. The normal original operator form freezes the selected source edition, HUCs and title before queue submission. A retry uses that form's original operation ID. Tasks retain the operation if a later display or catalogue refresh fails.
6. Open **Open selected watershed comparison** on the completed task, or choose it from the desk's saved comparison list. All original files have ordinary authenticated native download tickets.
7. Download **selected-huc-landcover.zip** for the complete standalone report, selected CSV and JSON data, Scientific Reports recipe/source manifest, and original input documents with their declared companions. Extract the ZIP together and open **report.html**.
8. Choose **Open this report only** or **Add to current report**. The existing composer receives the actual retained OBSERVED_CONTEXT collection/source pair and title. Its normal report/delivery workflow binds and copies every selected source member.
9. Use the original Workspace backup/restore workflow to transfer the editable Workspace and saved comparison desk. Restoration verifies the saved selection files and original report-source companion membership. A source ZIP can also be imported through the existing scientific source manifest workflow for report composition in another Workspace.

Draft source selection, HUCs, filter, title, matrix quantity and last opened saved edition are scoped to the original local Workspace key. Saved comparisons belong to the scientific project's original ID. Browser reads reject a late result if the selected Workspace, source or comparison selection changed.

## What the numbers mean

The original producer defines 16 Annual NLCD classes and retains every one of the 256 earlier-to-later class pairs for each HUC, including zero counts. The rows of a displayed matrix are the earlier year and the columns are the later year. The diagonal is unchanged class.

The reader preserves seven support quantities:

| Quantity | Meaning |
|---|---|
| Selected native cells | Every original pixel selected by the source watershed rule |
| Paired-valid cells | Cells with supported original classes in both years |
| Earlier-only valid | Earlier-year class is available, later-year value is NoData |
| Later-only valid | Later-year class is available, earlier-year value is NoData |
| Both NoData | Neither year has a supported class |
| Stable class cells | Paired cells whose class is identical in both years |
| Changed class cells | Paired cells whose class differs between the two years |

The first four validity categories partition selected support:

    paired-valid + earlier-only + later-only + both-NoData = selected cells

Stable plus changed cells equals paired-valid cells. Changed percentage is changed cells divided by paired-valid cells. A selection with zero paired-valid cells has an unavailable percentage, with its zero denominator shown explicitly.

Class gains are off-diagonal transitions into a class; losses are off-diagonal transitions out of it. Net is later minus earlier on paired support, and equals gains minus losses. The desk also retains independent annual class counts, areas and unmatched valid counts. It does not silently substitute paired margins for an annual inventory.

The hectare conversion uses the absolute determinant of the original native affine transform, divided by 10,000. Both original rasters are bound to EPSG:5070. The exact transform and declared cell area remain in the report, and stored source area values must agree with their cell counts. The source analysis uses **centre inclusion; half-open scanline edges; even-odd ring parity**. It reports zero overlapping selected cells. The reader requires that condition before summing selected HUCs, then checks all original HUC counts and directional matrices against the source domain union. Union percentages are computed after summing counts; they are not averages of watershed percentages.

A changed annual product classification alone does not establish the physical cause, the date of a change within the interval, or classification accuracy. These class observations do not estimate pollutant export. Original whole-HUC reporting attributes and class support remain attached.

Class names follow the official USGS Annual NLCD legend: https://pubs.usgs.gov/fs/2025/3001/fs20253001.pdf . Original result documents retain their producer metadata, raster SHA-256 identities, declared product years, NoData codes, source-domain hash and coordinate operation.

## Original source contract

The installed published source manifest is:

    observations/landcover_2023_2025/model-sources.json

Import uses the existing Workspace source importer, which retains primary bodies and declared companions. The reader chooses a retained analysis-run entry by its actual collection and source IDs. It resolves annual and transition entries by the exact byte size and SHA-256 bound in that analysis-run document; labels and filename guesses never substitute for the source identity.

Supported documents are:

- upstate.original-landcover-analysis-run/v1
- upstate.landcover-zonal-summary/v1, one for each declared product year
- upstate.annual-landcover-transitions/v1

Required comparisons preserve the same original grid, domain, source attributes, declared raster editions and pixel rule. Each original HUC12 is a 12-character string. Both independent annual inventories must have the same HUC inventory and original properties as the paired result. Class and support counts are nonnegative integers. Each matrix contains all 16 × 16 class pairs exactly once. Row and column margins must agree with the declared paired class margins and with the independent annual inventories after accounting for their explicit unmatched valid cells.

This workflow reads completed source documents. It does not reopen large original rasters or re-run the native raster producer during source browsing or selection.

## Retained products

Each saved comparison directory is content addressed under:

    observed-landcover-selections/<selection-id>/

The selection identity binds the project ID, complete original source entries, title, HUC12 selection, source hashes, coordinate method and producer identity. Completed output is immutable and reusable. The receipt is published after the complete files, source registration and source binding succeed.

| File | Retained content |
|---|---|
| selection.json | Complete selected report, per-HUC matrices, paired and independent annual margins, original metadata and identities |
| original-inputs.json | Actual original source entries, raster/hash bindings, grid and method |
| huc-summary.csv | Every selected original HUC and its full support, original properties and changed percentage |
| huc-classes.csv | Every selected HUC × class, with independent annual and paired class margins, gains, losses, net and unmatched counts |
| huc-transitions.csv | All 256 directional pairs for every selected HUC, including zero pairs |
| selected-transitions.csv | Complete selected-union matrix, cells, hectares and earlier-class denominator percentages |
| report.html | Standalone readable report, full union matrix and original-member links |
| observed-report.json | Actual upstate.observed-report/v1 recipe for the maintained Scientific Reports composer |
| sources.json | Original native source manifest for the recipe and all of its companions |
| originals/ | Complete original analysis-run/annual/transition documents and their declared companions |
| selected-huc-landcover.zip | Complete portable source/report tree |

CSV headings explicitly distinguish cells from hectares. Empty percentage cells mean the original denominator was zero. CSV string cells beginning with =, +, - or @ receive a leading apostrophe for safe spreadsheet opening; exact original strings remain in the JSON documents. HUC12 values retain their leading zero in the CSV text; import that column as text in spreadsheet applications.

The selected report ZIP carries the complete original result documents, rather than pretending to contain the original raster pixels. Their raster identities and native computation metadata remain bound in those documents. The scientific source recipe links all retained inputs, and the ordinary Workspace archive carries the project and application for reopening.

## Integration

This feature is additive:

- model/observed_landcover.py owns native source validation, selection, reports and retained source registration.
- operator/observed_landcover_operator.py uses the existing queue, read routes and native download tickets.
- operator/extensions/observed-landcover.json registers the desk, item kind, task controls and restored-Workspace verification.
- operator/web/observed_landcover.mjs and observed_landcover.css supply the neutral browser interface.
- The maintained extension host supplies getState, api, endpoint, openForm, submitAction, openDesk and openScientificReport. No shared application controller needs replacing.

Native actions are observed.landcover.import and observed.landcover.save. Read routes are /api/observed-landcover/catalog, /api/observed-landcover/inputs and /api/observed-landcover/edition. The inputs route uses POST with an explicit selection. Supplying huc12s returns the complete selected comparison; omitting them returns the original HUC inventory.

Example queue payload for saving uses actual retained identities:

    {
      "source_collection_id": "<actual source collection ID>",
      "analysis_source_id": "<actual analysis-run source ID>",
      "analysis_sha256": "<actual analysis-run body SHA-256>",
      "huc12s": ["030601010704"],
      "title": "Lower Six and Twenty Creek annual class change"
    }

The source registration uses the maintained model.observed_context and model.landcover_report_source portable ZIP writer. Existing model.common and model.reuse retain immutable bytes and verified original members. The feature is included by the maintained cumulative application/extension loader and the original Workspace portable application inventory.

## Open a source-bound selection from the offline report

The paired annual report can export a compact `upstate.observed-landcover-selection-request/v1` JSON with one to eight original HUC12s and chart hints. **Open saved selection JSON** also accepts this desk's complete retained comparison JSON. The import finds exactly one current source using the original analysis source ID and SHA256, calls the maintained inputs reader, and verifies polygon SHA256, original raster years and raster SHA256 values before replacing the draft. It also checks every selected HUC against the actual current original inventory.

If the source is missing, first import the completed original source. If multiple retained collections contain the same analysis, choose the intended original source explicitly and retry the import. The importer accepts that current selection only when its real collection, analysis ID and hash match exactly one fresh catalogue entry; otherwise it keeps the draft and asks for a clear source choice. Failed validation, a new workspace, a newer file import or edits made during the read keep the current draft. File inputs accept up to32 MiB so the original complete native saved comparison remains usable.

The imported title and source/HUC checkboxes are editable. Chart group/quantity hints are retained separately in the workspace-local browser draft and never enter the native scientific selection payload. **Inspect selected watersheds** and **Save comparison and report source** continue through the original reader and queued action. The exported complete native report can reopen in the paired offline side-by-side view when its source bindings match and it has at most eight watersheds; larger native comparisons keep their original native workflow.

For rendered acceptance, inspect this file control, successful source import, unchanged draft on missing/ambiguous/foreign source, edit-during-read and workspace-switch behavior using the actual operator. Module-level execution is a separate check.

## Read group gains and losses, then prepare the editable Study

The original saved or previewed comparison now opens all nine land-cover groups before its complete class matrix. Select **All selected watersheds · unique union** or an original HUC in **Reporting area**. Every group in that area shares the same hectare axis: light bars show gross loss to the left, dark bars gross gain to the right, and diamonds show signed net change. The complete numerical table immediately follows, including the original class-code membership, earlier/later paired hectares, gains, losses, net change, group-specific percentages and within-group class changes. Native-width charts and keyboard-focusable tables scroll horizontally on narrow screens; their labels remain readable. Print keeps the same nine groups and original numbers.

Group turnover counts only transitions across a group boundary. A change between forest classes 41, 42 and 43 remains within forest; developed classes 21–24 are treated equivalently. Internal class changes are shown separately and sum with cross-group changes to the original changed-class cell count. Percent loss uses the earlier group, percent gain uses the later group, and zero denominators remain unavailable. All areas use the exact retained affine cell area; original independent annual inventories remain separate below the grouped view. The helper reads the complete original 16 by 16 matrix and checks its class pairs, support and native areas before displaying it. It does not replace the report producer or any retained values.

On a saved comparison, choose **Open this report only** to replace the Scientific Reports source draft with this exact source, or **Add to current report** to append it to the existing ordered draft. The action rereads the complete saved comparison and checks its original project, saved ID and source before handing it over. A changed Workspace or newly opened comparison during the read cancels that handover. The current Scientific Reports composer preserves its own pending-work and edit guards.

Prepare and save the scientific report using the original composer, then choose **Transfer this report and its studies** on that saved edition. The source closure added in PR3877 retains the native selected-HUC receipt, complete original files and original input/report source collections. The receiving Study can reopen that same native saved selection; original imported sources from another project retain their separate contained lineage. The full Workspace backup remains available through the existing project workflow.

The grouped view is part of both the observed-watershed-change and selected Study source families. Its additional fragment contains only the new view module, preserving the existing producer and shared receiving component. The original native receiving operation should open a saved comparison, switch between its union and named HUC, inspect all nine values, and exercise both report-source choices against a populated report draft. Continue through the saved report's selected Study transfer and original receiving desk. Before presenting the outgoing application, open and LOOK at its exact installed desktop and narrow-width screens, inspect print output and operate the controls and downloads.


## Native group report, export and editable Study

New saved comparisons carry the original nine group definitions into the offline HTML, native Scientific Reports HTML/PDF, complete source ZIP and editable selected Study. Two figures retain every original group, including zero values:

- Gross gains, losses and net group change: losses below zero, gains above zero, and net as a diamond. The full tables show group membership, gross area, distinct percentage denominators and within-group class changes.
- Group areas on the same paired support: the two original year margins, retaining the independent annual inventories separately.

The complete landcover-groups.csv contains nine selected-union rows plus nine rows per selected HUC. It includes exact integer support, before/after cells, gross gain/loss, retained cells, internal class change, net and turnover, hectare values and percentage denominators. A crossing between groups contributes one gain and one loss; summed gross turnover across groups therefore counts each crossing twice. Empty percentages mean a zero denominator. Import the HUC12 column as text to preserve leading zeros.

figures/selected-group-data.json retains the full values, original selection, source binding and HUC attributes. figures/selected-group-figures.json retains every plotted coordinate and its source quantity. Both native SVGs and the exact group/figure implementation source files travel with the report.

Groups are water 11; snow/ice 12; developed 21–24; barren 31; forest 41–43; shrub 52; grass 71; agriculture 81/82; wetland 90/95. Original integer cells are added before conversion. A class change within one group remains an internal change rather than a gross group loss or gain. Changed-group cells plus internal class-change cells equal the original changed-class count.

The offline HTML embeds its exact native SVGs, so figures remain visible when the HTML is opened separately. Extract selected-huc-landcover.zip to use all linked CSV, JSON, original inputs and source files. Tables and figures have keyboard scrolling at narrow widths; print retains full-width figures and repeating table headings.

The comparison identity now records its original producer, group helper, scientific figure renderer and ReportLab version. An implementation change creates a new saved edition. Previously completed comparisons keep their original recipes, files and report identity. Original summary and watershed scientific dictionaries remain unchanged.

### Continue the original native receiving course

Use the existing selected-HUC operation and original Workspace. For an unstarted comparison, the four original RFP HUCs are 030601010703, 030601010704, 030601020502 and 030601020507; preserve any already-admitted selection. Save, render through Scientific Reports, download the source and native report ZIPs, restore the original full Workspace and selected editable Study, and reopen the saved IDs. No new raster or model run is required.

Actually open and LOOK at both outgoing group figures, all relevant tables and the native PDF/HTML at presentation width and 390px. Operate union/HUC selection, all three matrix quantities, explicit report replace/append, downloads and reopening. Open the single HTML alone, then extract the full ZIP and open the contained CSV/JSON/SVGs and working project normally. The four RFP HUCs have 588,980 paired-valid cells and 17,565 changed-class cells; retain the actual selected scope when assessing any other comparison. Return actual viewed output and concrete fixes through the same receiving operation. The complete standing all-attachments/media instruction above applies; cutoff remains October 13 at 14:00 UTC.


<!-- bryce-rendered-product-inspection:begin -->
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
