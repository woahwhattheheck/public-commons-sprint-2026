# Client report and selected-zone economics

## Complete delivery

The maintained delivery builder produces report.pdf, report.html, report.md and report-data.json from the original completed baseline, alternatives, grid, profile, source records, observations and map state. The existing scientific_report formatter renders all four formats. Its current quantitative tables, scenario comparisons, source-water geography and receiving-water quantities remain in one report.

The delivery retains the original atlas, linked watershed report, receptor geography, saved spatial views, map exports, GIS metadata and scientific working archive. The report records each retained grid's actual affine cell dimensions and area. Grid-specific quantities use that original support throughout the report. Economic annual masses are copied directly from the completed decision edition.

## Use the operator

1. Build and save an Economic desk edition from the completed watershed report and its chosen reporting zone.
2. In the completed Economic desk edition, choose Prepare client report. This opens the original atlas form with the saved native cohort and this edition selected. You can also open the same watershed report and select the edition under Map release. Both routes use the same matching native report bytes and ordered cohort.
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
- model/scientific_report.py uses the merged scientific v6 formatter with original coefficient and source-reference tables, package-local PDF and HTML links, and Markdown output. Current physical, receiving-water, scenario and observation tables are preserved.
- model/delivery.py composes the newer atlas and linked-report builder with ASTRA13's guarded overlay labels, receiving-water map captions and scientific table renderer. It collects and attaches receiving-water data once.
- model/report_release.py exposes compatible completed editions beside the saved report's original map release selection.
- operator/web/extensions/scenario_reports.mjs adds the optional completed-edition selector and validated handoff.
- operator/web/map_atlas.mjs shows the chosen economic edition and downloads the completed report and economic package.
- operator/web/economic_desk.mjs opens the map-release form directly from a completed edition, using the existing report selection helper and workspace-change guard.

The report modules merged in ECSA PR2821 as bdae930c5bb661da538924ea16e59abb868073e1 (head 020b9eb1c36d6ce893363aa025a2ba33d735975e) and were read back exactly from Git. The complete integrated delivery is 50,533 bytes, SHA-256 6dcb1890b49e083a943d5c58958b02d0320b7e9f42aea10b8defe01885077867. It keeps original scenario-analysis attachments, receiving-water selection bindings, source aliases, atlas browser, report release, current captions and working-archive recovery. The scientific formatter v6 is 38,749 bytes, SHA-256 83e46590043b8bea6de58f63d84606211121a466b3b7b7c555ac65560f10b746; it includes the original coefficient and source-reference tables with local links and Markdown. The economic adapter (24,566 bytes) matches its reviewed source exactly. The direct Economic desk action continues that merged integration; its source preimage is the already merged 35,513-byte economic_desk.mjs, SHA-256 7fee96241ce58ab06928d29342c75db6d650ad2e2aad0a9b5005c5031dc3f6c6.

The single detailed receiving-water section uses the current formatter's tables. The original receiving-water files and full inventory stay in the package. Publication must compose any later shared-file edits from the current repository head.

## Receiving check

Needs expert review: environmental model interpretation and application-specific cost estimates.

Use the existing application's Python environment to compile the four Python modules. Build a delivery from the original completed project and an economic edition with that exact ordered cohort. Open the PDF and extracted report.html, follow the local economic desk and source links, and compare displayed physical quantities and costs with the original completed edition.

Check the actual selected grid dimensions and hectares in report-data.json. Confirm the atlas, saved watershed report, source-water and receiving-water assets, saved spatial views and every economic manifest member are in the final package. Reopen the same selected delivery to exercise existing completed-result reuse. Retain the actual generated output and its original IDs with the current receiving owner.

The authored JavaScript modules were parsed in this session; the exported economic-selection helper was exercised for a matching completed edition, physical-only choice and stale-edition rejection. The direct Economic desk action also exercised the actual shared helper and preserved native report, edition SHA and alternative order; a workspace change stopped navigation. Native Python compile and report rendering belong to the equipped receiving session using the retained original case.

## Original work

This integration carries forward ED6E's seven-map decision guide and economic report integration into ASTRA13's maintained scientific formatter. Source document and RFP coverage material remain available separately in the original source bank. All displayed scientific and financial quantities come from the original completed project and Economic desk edition.
