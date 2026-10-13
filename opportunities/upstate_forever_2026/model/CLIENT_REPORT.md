# Client report and selected-zone economics

## Complete delivery

The maintained delivery builder produces report.pdf, report.html, report.md and report-data.json from the original completed baseline, alternatives, grid, profile, source records, observations and map state. The existing scientific_report formatter renders all four formats. Its current quantitative tables, scenario comparisons, source-water geography and receiving-water quantities remain in one report.

The delivery retains the original atlas, linked watershed report, receptor geography, saved spatial views, map exports, GIS metadata and scientific working archive. The report records the actual affine cell dimensions and area of the selected grid. Annual exports and supporting areas stay bound to that grid, and retained studies keep their original resolution. Economic annual masses are copied directly from the completed decision edition.

## Use the operator

1. Build and save an Economic desk edition from the completed watershed report and its chosen reporting zone.
2. Open the same watershed report. Under Map release, select the completed economic edition. The choices match the exact native report bytes and ordered baseline and alternative cohort.
3. Choose Build map release. Complete the source context, map settings and responsible metadata contact in the original atlas builder.
4. In Review and build, use **Refresh compatible economic editions** to inspect or replace the optional edition without rebuilding the prepared selection. Choose its original watershed report when the draft has no report link, then choose an edition and press **Use selected economic edition**. Submit through the original delivery.build queue.
5. Open the completed release. Download the PDF, offline HTML, Markdown or structured report, the complete economic decision package, or the complete GIS delivery.

Leaving the economic choice at Physical report and maps produces the complete scientific report and seven-map decision guide. The optional edition selector reads completed original economic editions for the exact ordered cohort. A linked report restricts the choices to its original ID and bytes. The atlas re-reads the original release before applying an edition; an unavailable or changed edition leaves the previous binding intact and asks the operator to refresh.

## Revise a map release

The Native runs step keeps a linked watershed report, saved scenario analysis or economic edition on its original baseline and ordered alternatives. Sources, layout, contact and notes remain editable. Choose **Choose a different run cohort** to remove all three kinds of retained result links and select another completed original baseline and land-cover alternatives. Prepared source context, map settings and contact carry forward.

In Review and build, **Remove economic edition** removes only the optional economic binding. Any original watershed-report or scenario-analysis link remains. **Refresh compatible economic editions** lists completed original editions without replacing this draft. Select an edition and press **Use selected economic edition** to replace only its ID and original record hash. Source selections, receptor context, layout, contact, notes and other original result links are preserved. A draft with no watershed-report link can retain an economic edition for its exact cohort without gaining a separate report link.

The picker keeps the chosen option across navigation within the same cohort. Reading choices and applying a replacement update only the economic panel, preserving unfinished contact and notes. A later workspace, selection import or new release invalidates an earlier pending response. A changed or removed economic binding is not overwritten by an older response.

Saved releases reopen with their retained choices. **Revise this selection** creates an editable draft with those same bindings. Loading selection or receptor JSON preserves newer selections and edits made while the file is being read, including unfinished invalid input; reload the file if the draft changed. Current-condition maps require an original baseline, and alternative IDs must be unique and distinct from it.

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
- model/scientific_report.py composes ASTRA13's current formatter, original biophysical/profile and priority-unit tables, typed publisher and package links, Markdown output, economic support coverage and retained working-material navigation. Physical, receiving-water, scenario and observation tables remain in the same report.
- model/delivery.py composes the newer atlas and linked-report builder with ASTRA13's guarded overlay labels, receiving-water map captions and scientific table renderer. It collects and attaches receiving-water data once.
- model/report_release.py exposes compatible completed editions beside the saved report's original map release selection.
- operator/web/extensions/scenario_reports.mjs adds the optional completed-edition selector and validated handoff.
- operator/web/map_atlas.mjs preserves linked cohorts, replaces compatible economic editions within the prepared draft, and downloads the report, complete economic package and offline atlas browser. Structured report downloads prefer report_data while retaining report_model compatibility for older saved deliveries.

The current composition retains the scientific formatter's original biophysical and profile tables, the atlas and linked-report hooks, selected economic and scenario-analysis bindings, original overlay labels, and package recovery. Renderer and delivery versions identify the composed report edition in each saved release.

The single detailed receiving-water section uses the current formatter's tables. The original receiving-water files and full inventory stay in the package. Publication must compose any later shared-file edits from the current repository head.

## Receiving check

Use the existing application's Python environment to compile the four Python modules. Build a delivery from the original completed project and an economic edition with that exact ordered cohort. Open the PDF and extracted report.html, follow the local economic desk and source links, and compare displayed physical quantities and costs with the original completed edition.

Check the actual selected grid dimensions and hectares in report-data.json. Confirm the atlas, saved watershed report, source-water and receiving-water assets, saved spatial views and every economic manifest member are in the final package. Reopen the same selected delivery to exercise existing completed-result reuse. Retain the actual generated output and its original IDs with the current receiving owner.

The authored JavaScript modules were parsed in this session; the exported economic-selection helper was exercised for a matching completed edition, physical-only choice and stale-edition rejection. Native Python compile and report rendering belong to the equipped receiving session using the retained original case.

## Original work

This integration carries forward ED6E's seven-map decision guide and economic report integration into ASTRA13's maintained scientific formatter. Source document and RFP coverage material remain available separately in the original source bank. All displayed scientific and financial quantities come from the original completed project and Economic desk edition.
