# Client report and selected-zone economics

## Complete delivery

The maintained delivery builder produces report.pdf, report.html, report.md and report-data.json from the original completed baseline, alternatives, grid, profile, source records, observations and map state. The existing scientific_report formatter renders all four formats. Its current quantitative tables, scenario comparisons, source-water geography and receiving-water quantities remain in one report.

The delivery retains the original atlas, linked watershed report, receptor geography, saved spatial views, map exports, GIS metadata and scientific working archive. The report records the actual affine cell dimensions and area: Gura's 300 m, 9 ha grid keeps its own support, while regional 30 m grids retain theirs. Economic annual masses are copied directly from the completed decision edition.

## Use the operator

1. Build and save an Economic desk edition from the completed watershed report and its chosen reporting zone.
2. Open the same watershed report. Under Map release, select the completed economic edition. The choices match the exact native report bytes and ordered baseline and alternative cohort.
3. Choose Build map release. Complete the source context, map settings and responsible metadata contact in the original atlas builder.
4. The review screen identifies the selected economic edition. Submit through the original delivery.build queue.
5. Open the completed release. Download the PDF, offline HTML, Markdown or structured report, the complete economic decision package, or the complete GIS delivery.

Leaving the economic choice at Physical report and maps produces the complete scientific report and seven-map decision guide. The optional edition selector reads completed original economic editions. Reopen the selection if an edition changed or became unavailable.

## Economic content

The report includes:

- Selected reporting zone, original economic and native report identities, physical targets and budget.
- Each complete alternative's budget status, target status, eligibility, frontier basis and original review reasons.
- Baseline, alternative and avoided annual export for each modeled pollutant, with common-support area and exact units.
- Capital and annual operating estimates, annual discount rate, horizon, present value and annualized cost.
- Original implementation footprint, estimate reference, source date and notes.
- Annualized cost per avoided mass when present in the completed economic report.
- Local links to the complete decision desk, full edition ZIP and original source records.

Negative avoided export remains an increase. Zero remains zero. An unentered cost remains unentered. Physical and cost-inclusive frontiers retain their recorded bases. Regional model outputs, selected-zone economic quantities, whole-scenario estimates and zone-specific estimates keep their respective support.

The report adapter copies values from the completed economic report. It does not launch a model or recalculate financial estimates.

## Delivery identity and package

Selection accepts economic_edition_id and an optional economic_edition_sha256. Before the original delivery digest is calculated, bind_economic verifies the saved edition, original native report, selected zone, project, grid, profile and exact ordered cohort. The actual edition-record SHA-256 enters selection, together with CLIENT_REPORT_EDITION. The scientific renderer version, native delivery format and atlas version also contribute to the original delivery identity.

Every economic manifest member, the completed edition record and existing decision-package.zip are retained under economics/<edition-id>/. The original hierarchy preserves relative desk, application and source links after extraction. economic-decision.json retains the selected binding. Every retained economic member and all report companions enter project_assets in the original package engine.

report-data.json keeps the original scientific schema, structured table and link blocks, source records and responsible contact. Its binding includes the exact native cohort, grid and actual grid measurements, observation IDs, receiving-water identity, source-report binding and selected economic binding. Complete original economic report, physical-input.json, selection.json, native report and companion application source remain in the economic subfolder.

## Source composition

- model/client_economics.py validates and binds editions, lists compatible choices, retains complete economic members, and adapts economic content to the existing tuple and table report contract.
- model/scientific_report.py extends ASTRA13's exact v4 formatter with package-local PDF and HTML links plus Markdown output. Current physical, receiving-water, scenario and observation tables are preserved.
- model/delivery.py composes the newer atlas and linked-report builder with ASTRA13's guarded overlay labels, receiving-water map captions and scientific table renderer. It collects and attaches receiving-water data once.
- model/report_release.py exposes compatible completed editions beside the saved report's original map release selection.
- operator/web/extensions/scenario_reports.mjs adds the optional completed-edition selector and validated handoff.
- operator/web/map_atlas.mjs shows the chosen economic edition and downloads the completed report and economic package.

The renderer source preimage is scientific_report.py at a998b30bce14ea4b49fdea41e2ef73031c2d4bf7: 31,003 bytes, SHA-256 b227849449d3f7ed2b39baddc9e721bf272e64d2119db9aab09e5acf1137158b. Its delivery.py was 46,872 bytes, SHA-256 f1088db9c2cc8a87869abca69d6c12145a1a362bc54827a6eb5ae6b159623a0b. The latter lacked newer atlas and report-release hooks and repeated receiving-water collection; the composed delivery uses the retained 45,137-byte main builder, SHA-256 84cd4058e06c55547f07e08cb8fc138214f578991e6f4cb5992cd955b06cf3e9, to preserve those features and existing package recovery.

The single detailed receiving-water section uses the current formatter's tables. The original receiving-water files and full inventory stay in the package. Publication must compose any later shared-file edits from the current repository head.

## Receiving check

Use the existing application's Python environment to compile the four Python modules. Build a delivery from the original completed project and an economic edition with that exact ordered cohort. Open the PDF and extracted report.html, follow the local economic desk and source links, and compare displayed physical quantities and costs with the original completed edition.

Check the actual selected grid dimensions and hectares in report-data.json. Confirm the atlas, saved watershed report, source-water and receiving-water assets, saved spatial views and every economic manifest member are in the final package. Reopen the same selected delivery to exercise existing completed-result reuse. Retain the actual generated output and its original IDs with the current receiving owner.

The authored JavaScript modules were parsed in this session; the exported economic-selection helper was exercised for a matching completed edition, physical-only choice and stale-edition rejection. Native Python compile and report rendering belong to the equipped receiving session using the retained original case.

## Original work

This integration carries forward ED6E's seven-map decision guide and economic report integration into ASTRA13's maintained scientific formatter. Source document and RFP coverage material remain available separately in the original source bank. All displayed scientific and financial quantities come from the original completed project and Economic desk edition.
