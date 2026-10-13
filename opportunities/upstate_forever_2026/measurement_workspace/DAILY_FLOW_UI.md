# Daily flow in Measurements

Use the existing Measurements workspace → **Daily flow**. The backend is the original flow service; there is no separate application, store, or scheduler.

## Work with original data

1. Open a saved study, or start a new draft. Select retained discharge imports or add complete original USGS OGC daily / NWIS WaterML JSON responses with their original request URI. Keep every pagination page.
2. Inspect sources, then explicitly select each original station and series. Choose inclusive start/end dates and a title. The UI does not silently choose one of conflicting source editions.
3. Preview. Review quantified, missing, ambiguous and unquantified days; approved, provisional, qualified and signed-negative counts; original values, units and pointers.
4. Save the exact preview. The API checks its expected immutable ID against its original normalized input. Editing the draft creates a successor; the saved study is retained.
5. Open or receive the complete study JSON in another Measurements workspace. The receiver reproduces the original calculation before saving. Download the complete input, study JSON and daily/period/sample CSVs.

The complete input editor retains optional samples, original sample_sources, chemistry selection, relations and notes. Applying JSON is explicit. Original texts are preserved; no edited summary substitutes for a source response. Navigating away or refreshing the Measurements tab preserves its draft and completed result while destroying prior listeners.

Known volume is daily mean m³/s × 86,400 seconds for quantified days only. Missing or ambiguous days are not interpolated. Original signed discharge remains signed. A complete selected window does not imply a complete calendar year/month/water year. Sampling-day context is neither instantaneous discharge nor an annual nutrient/sediment export. Gauge support remains an explicit original relation.

## Compare retained editions

Choose earlier and later saved IDs. The comparison retains both original selections, full daily rows, approval/qualifier changes, period summaries and sample contexts. The view shows changed rows (up to 100 at once); its full JSON includes every row. No comparison automatically adopts one edition.

The actual 2026 gauge response is provisional. Approval/qualifier counts must remain visible; a partial year must not be labelled a complete annual observation.

## Integrate concentration and daily discharge

In the same Flow tab, use **Concentration and discharge loads**. Choose an original saved flow study, then explicitly upload/paste a complete `upstate.observed-loads-contract/v1` contract or load the retained context-only example at `source/observed-load-integration-20261013/flow-study-load-contract.json`. The example is preserved byte for byte and is never applied silently. Its end date is exclusive, while the parent's selected end date is inclusive.

Preview the exact parent/contract pair. Review every method/fraction series, original gauge relationship, support rejection reason, quantified versus expected days, complete-calendar status, daily calculations and source samples. The actual extended study has 589 samples and 2,477 daily-flow rows; its 19 series remain context only because the original network relationships do not establish coincident catchment support. It produces zero admissible annual rows. Do not manufacture a match to make this result nonempty.

Where independently evidenced support is admissible, the view shows point mass and finite censoring bounds, the matching quantified-day flow volume, and flow-weighted point/lower/upper concentrations. Missing days enter neither mass nor volume. Zero volume has no defined concentration, and a censored upper/lower envelope is not a point estimate or confidence interval. Annual export remains subject to the original complete-year, coverage, censoring and species/fraction rules. The original Approved-only example does not silently accept provisional 2026 flow.

Save the exact preview, then open it from the saved-result catalogue. Editing the contract preserves the saved result and requires a new preview. Download the complete load JSON, selected contract, full original parent study, readable report, and each complete CSV. The complete ZIP includes the report and all original supporting files together; extract it and open its report and study JSON as the recipient. Both ordinary flow studies and load results provide these full bundles. No customer data or original observation is mutated.

The load desk uses the existing authenticated API and shares Flow's lifecycle. Draft text, full completed result and selection survive parent refresh/tab changes. Original source-row inspection retains all observed characteristic, method, fraction and qualifier fields rather than a fixed calibration list.

## Integration

Full files:
- measurement_workspace/web/flow_editions.mjs and flow_editions.css
- flow_loads_ui.mjs supplies the load desk inside Flow.
- Identical modules/CSS under operator/web/
- Guarded mounts in measurement_workspace/web/workspace.js and operator/web/measured_observations.mjs
- operator/extensions/measured-observations.json registers the Flow modules and stylesheet.

The existing mount passes:
  api(path, {method='GET',value}={}) → parsed original JSON
  request(path,method,value) → original Response-like object for CSV downloads.
Both use the authenticated existing Measurements transport.

The standalone owner must add exactly these entries to the existing engine/cli.mjs files map:
  '/measurements/flow_editions.mjs':['flow_editions.mjs','text/javascript']
  '/measurements/flow_editions.css':['flow_editions.css','text/css']
  '/measurements/flow_loads_ui.mjs':['flow_loads_ui.mjs','text/javascript']
The CLI and flow service remain with the original backend publisher.

Existing frozen installation inventories are not rewritten blindly. A receiving installer must compose these files and the backend into its current complete source manifest before installation.

## Producing-peer acceptance

Before calling any client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing peer must actually open/run/render the exact outgoing version, LOOK at the rendered screen or real screenshots, and operate its important controls. Inspect actual desktop/screenshare and narrow/mobile widths, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix broken, unstyled, cramped, clipped, overflowing or unreadable output before presenting it. Code review, DOM counts, HTTP 200, unit checks and peer approval do not replace seeing the product.

ALL ATTACHMENTS count: literally open/view/play/use final HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and project as the recipient. Extract archives and open contained deliverables and the working project. For videos use available high-quality media and natural TTS, and watch/listen to the final export for pronunciation, pacing, timing and audio alignment. Keep building and fixing instead of creating a separate verification product.

Use readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Preserve real workflow, data and computation. Preserve original controls/history/vendor policies; no forced restart, new watcher or revival of owner-stopped work. The October 13 finish direction supersedes the earlier Eco checkpoint; the old local-browser reservation has been released. Other projects retain their own schedules.

For this screen, the producing peer should use the actual historical, 2026-only and extended studies supplied by the backend owner. Open every result tab; inspect a provisional/qualified original row, a missing/ambiguous example where present, all period completeness labels, full source text, saved/input JSON and each CSV. Receive a downloaded full study into the existing independent Measurements workspace and compare the retained original IDs. Inspect desktop and 390 px screenshots by looking at them. Exercise a malformed input/error and return to the preserved valid draft. Do not rerun native ecological models to inspect this measurement product.

The same producing-peer course must also open the original context-only load contract, preview/save/reopen the result, inspect all 19 support reasons and original sample rows, and download/extract/open both flow and load ZIPs and their contained reports/JSON/CSVs. Exercise an invalid contract and return to the preserved valid draft. The browser must show the same zero annual count as the original engine. Seeing source or a successful HTTP response is not this rendered acceptance.

Individual report downloads use the same sibling filenames as the complete ZIP. Keep each result's original JSON/CSVs together in its own folder; the complete ZIP is the primary portable report product.
