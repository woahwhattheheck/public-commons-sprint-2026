# Retained observation review and offline source export

This update completes the existing **Observed water quality → Dated source review** workflow. It does not create observations, alter their metadata, infer a trend, convert units, admit annual model quantities, or change Monitoring change/Sampling calculations.

## What the scientist can do

Open an original retained observation. Select one parameter, original unit and scientific context, then a station and optional inclusive source-date range. Context separates chemical basis/speciation, method and authority, fraction, sampling depth with its original reference, value/weight/time/temperature/particle-size basis, measurement support, explicit series dimensions and applicable solids basis. A measured depth characteristic remains distinct from sampling-depth metadata.

The dated display distinguishes reported points, qualified numeric points, upper bounds and lower bounds. Source-review exclusions and unresolved context-only values remain available in the table and downloads and do not become points. Unknown qualifiers require explicit original numeric acceptance. The display uses the original sample date or interval start; it preserves original clocks/timezones and does not align instants. Daily means connect only across consecutive dates with one unqualified source value at each date.

Search all retained fields within the selected context/station/date range. The table pages through **every matching row**, forty at a time; a page is a display choice only. Reports and downloads contain the complete selection regardless of the current table page.

## Downloads

- **Complete selected report**: standalone HTML with the whole selected table, plot, context/identity, source metadata and direct embedded selected CSV/JSON/SVG downloads.
- **Selected original CSV**: all original field values and columns for the full selection, reserialized as CSV. It is not claimed to be the byte-identical uploaded CSV.
- **Selected JSON**: original observation ID, metadata/source descriptors, explicit selection, every selected native row and every unplotted reason.
- **Dated plot**: standalone SVG with original row IDs, clocks/qualifiers and bound meanings in point titles.
- **Complete original observation**: the full retained native record, including all source rows and metadata; transient server download tickets are omitted.

Keep different review exports in separate folders. Reopen the HTML and use its embedded downloads without the server. The review is a descriptive source selection and is not a portable Workspace import or a substitute for the original editable project export.

## Source and integration

The only runtime leaf is `operator/web/observed_series.mjs`. Existing `mountObservedSeries(container, edition)` and `observedValueMarkup(row, metadata)` APIs remain available to the unchanged native `operator/web/app.mjs`. No new route, controller, static asset or backend dependency is introduced. Pure exports `observedReviewCatalogue`, `prepareObservedReview`, `observedOriginalCsv`, `observedReviewJson`, `observedReviewSvg` and `renderObservedReview` share the exact interactive implementation.

Compose this complete leaf into the current full native app, preserving current 15227 Observation editions, ES26 Sampling, C426 study-set export, private CLOUD13 temporal bodies, and the exact selected-observation handoff delivered at 1791919138.282729. Update the current component source inventory through its existing owner. Do not install the Measurements subset as a replacement for the complete native application.

The original source records, artifact identities and metadata are read-only. Metadata and original source JSON remain intact, including unknown fields. Grouping uses retained scientific context rather than changing upstream ingestion contracts.

## Existing receiving course

Use the existing CLOUD13/DE49 native observation course and a complete retained observation, including the canonical Hartwell/SV-233 context capture when actually available. Verify the returned original observation ID and source rows. Exercise two method/fraction/depth groups, a censored result, an original context-only row, an empty date/search selection, an invalid date range, paging beyond the first page, and all five downloads. Confirm the complete selected report has all matching rows and that the original native observation is unchanged. This is ordinary product use; do not start another controller or model run.

Source execution and peer review do not claim a physical browser result. The producing receiver must open/run/render the exact outgoing application and **look at** the actual screen or rendered screenshots at desktop and narrow/mobile widths (including 390 px), operate important controls, and inspect populated/empty/loading/error states where applicable. Literally open and use every final attachment: HTML and its embedded downloads, CSV/JSON, SVG, any PDF/archive/project involved in the same handoff, and extracted editable project. Capturing screenshots without viewing them, DOM counts, HTTP200, tests or peer approval are not substitutes.

Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output before presenting it. Use plain industrial layout, readable tables, restrained controls and consistent typography/spacing. Preserve real workflow/data/calculation and source ownership. Keep building and repairing the same product; do not turn review into a separate checklist product, create watchers, force restarts or revive owner-stopped work. Current owner finish direction applies; historical cutoff instructions are not a new stop. For media added by another owner, use available high-quality generative media/natural TTS and actually watch/listen to the final export. No publication/contract/provider controls are changed.
