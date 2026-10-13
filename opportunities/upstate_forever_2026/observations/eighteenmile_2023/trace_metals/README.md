# Eighteenmile 2023 — original trace-metal observations

This edition turns the original 2023 Water Quality Portal source into an editable sampling calendar, exact result explorer and normal observed scientific-report source. It retains **153 metal results at five stations from 17 activities**, including **38 reported numeric results and 115 below-limit results**, plus 51 original calcium, magnesium and hardness observations from the same activities.

## Open and operate

Open generated/index.html in an ordinary current browser. The HTML is self-contained and works without a server or network. Filter by station, metal, result condition, month or original source text; select a plot point or activity cell to inspect all 73 normalized source/context fields. The plot uses actual sample dates and separate filled numeric markers and open original-limit markers. Calendar cells retain the full station schedule while dark cells identify the current selection.

Download selected CSV retains the unchanged original fields, including blank values and units. Save selection retains the exact original input identity and selected record IDs. Reopen selection validates both before changing the view. Print selected view keeps the actual filter state with the selected calendar, tables and chart. The full record inspector is omitted from print to keep the printed cohort explicit.

Export scientific source ZIP creates a complete package for the current selection. Open its explorer.html to reopen the selection directly. Its sources.json is an ordinary upstate.sources/v1 manifest with one OBSERVED_CONTEXT document, report.json. The package retains the selected original CSV, same-activity chemistry, sampling calendar, per-metal native figure specification and SVGs, all nine original source responses, unchanged original normalizer, selection, complete builder source and source inventory. Native Scientific Reports can select this imported source in the existing ordered composer. The ordinary editable Study transfer follows the retained source and all its companions.

## Original sampling support

The trace-metal records are routine SWS-2023 Water samples with Unfiltered result fraction. The nine characteristics are Cadmium, Chromium, Copper, Iron, Lead, Manganese, Mercury, Nickel and Zinc. All use original mg/L support. SV-245 has one sampled activity in December. SV-268 and SV-374 have four activities in March, June, September and December. SV-375 and SV-376 have four in February, May, August and November. Exact dates and original clock/timezone strings remain unchanged.

Reported ranges use quantified values within the same metal, method, unit and fraction. Below-limit records keep their original blank reported value/unit and their separate lower quantification limit. Open markers locate that limit. Original limit strings retain their precision, including 0.002 versus 0.0020. Calendar overlap is calendar support; individual activities and collection times remain distinct. Same-activity calcium, magnesium and hardness observations retain their own original fractions, units, methods and basis.

Every original result, activity and laboratory comment is preserved. The selected original metal rows have blank source comments and collection-method/equipment fields. The exact analytical method metadata, result status, detection condition, quantification limit type, original row index and response SHA256 remain in every selected result.

## Reproduce from the original source

The maintained application stores the nine response files in the sibling wqp/originals directory. The complete report ZIP places the same unchanged files under its own wqp/originals. The builder accepts either layout and verifies every original file's byte count and SHA256 before processing it.

Run with Node.js 18 or newer:

    node build.mjs --output /absolute/separate/output-directory

Rebuild an exact saved selection:

    node build.mjs --selection /absolute/trace-metals-selection.json --output /absolute/separate/selected-output

The unchanged wqp/normalize_core.mjs processes all nine original responses because its existing full-study tables require the entire capture edition. The builder verifies that its complete output reproduces the original 920-row measurements.csv byte-for-byte (863082 bytes; SHA256 20600293095da71c25ffa104e84f07289b2ef1a86123342801512614eb4b0b7a). It then selects the original 153 metal records by characteristic and verifies the activity, condition and source counts. No network download is used during rebuilding. Existing output files must match exactly; choose a new output directory when authoring a new edition.

The native report recipe names only neutral selected-data paths. Full original campaign responses remain unchanged source companions. This keeps the selected trace-metal report distinct from the original whole-lake concentration study and its independent selection.

## Native application use

Extract the package into a separate source directory, and pass its absolute sources.json to the installed Workspace.import_sources method or the application's ordinary source importer. The returned source collection contains the report document whose entry role is OBSERVED_CONTEXT. Select that actual collection/document in the ordinary Scientific Reports composer; preserve their source IDs in the report selection. Retained file hashes and the original recipe bind the selected source and its complete companion tree. Use the existing scientific report / editable Study export workflow rather than copying only the HTML out of its source package.

## Outgoing visual check

The producing worker must open and look at the actual outgoing populated HTML at desktop/screenshare width and at 390 pixels, operate the important filters, record inspection, selection save/reopen, source downloads, scientific source ZIP and print path, and inspect the native report/export/reopening intended for delivery. Actual pixels or the live browser must be viewed by the producing worker. Source parsing, hash checks and another worker's approval do not substitute for that requirement. Route the exact HTML and original source package through the existing SOL61-ECO-UI browser course; keep the current native Ecosystem receiving operation and its original source identities.

## Files and source provenance

inputs.json lists each original response URL, station, row count, byte length and SHA256, the exact normalizer and canonical complete CSV identity. analysis_core.mjs performs original activity/cohort analysis. report_core.mjs contains the shared selection, CSV, original-value figure and ordinary ZIP/report logic used by both Node and the browser. explorer.mjs, explorer_template.mjs and explorer.css implement the industrial source explorer. hash.mjs supplies the same deterministic SHA256 in the self-contained browser. Generated inventory.json retains every package member's path, bytes and SHA256. Its own hash is intentionally outside that inventory.

Source edition: 2026-10-13. Original observing organization: South Carolina Department of Environmental Services / original Water Quality Portal organization 21SC60WQ_WQX.
