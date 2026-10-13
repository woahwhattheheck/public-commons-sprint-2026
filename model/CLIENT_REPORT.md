# Client report and selected-zone economics

## Complete delivery

The maintained delivery builder produces report.pdf, report.html, report.md and report-data.json from the original completed baseline, alternatives, grid, profile, source records, observations and map state. The existing scientific_report formatter renders all four formats. Its current quantitative tables, scenario comparisons, source-water geography and receiving-water quantities remain in one report.

The delivery retains the original atlas, linked watershed report, receptor geography, saved spatial views, map exports, GIS metadata and scientific working archive. The report records the actual affine cell dimensions and area of the selected grid. Annual exports and supporting areas stay bound to that grid, and retained studies keep their original resolution. Economic annual masses are copied directly from the completed decision edition.

## Use the operator

1. In **Watershed reports → Build report**, select the completed reference and alternatives, pollutants and any additional original watershed polygons. Choose **Delivery context**. For **Original native study**, enter the original study title, purpose and optional reference before **Build and save report**. The report retains these fields with its original run and source selection. Then build and save an Economic desk edition from that completed report and its chosen reporting zone.
2. In the completed Economic desk edition, choose **Prepare client report**. This opens the atlas with the saved report’s declared delivery mode and original study fields, its exact native cohort and the economic edition selected. You can also open the same watershed report and select the edition under **Map release**. Both routes preserve the original report bytes and ordered baseline and alternative cohort.
3. From the watershed-report route, check **Delivery mode** and choose **Build map release**. The saved report’s explicit mode is preselected. In the atlas, complete the source context and map settings for that mode. Regional RFP delivery requires its regional source overlays and responsible metadata contact. Native-study delivery retains the original grid and reporting domain; regional overlays and contact are optional. For a saved report created before delivery context was retained, choose **Original native study** in this selector or the atlas and enter its original study title and purpose there.
4. In Review and build, use **Refresh compatible economic editions** to inspect or replace the optional edition without rebuilding the prepared selection. Choose its original watershed report when the draft has no report link, then choose an edition and press **Use selected economic edition**. Submit through the original delivery.build queue.
5. Open the completed release. Download the PDF, offline HTML, Markdown or structured report, the complete economic decision package, or the complete GIS delivery.

Leaving the economic choice at Physical report and maps produces the scientific report and the selected mode’s map guide: seven regional RFP families, or five native-study families plus any optional source-water families actually selected. The optional edition selector reads completed original economic editions for the exact ordered cohort. A linked report restricts the choices to its original ID and bytes. The atlas re-reads the original release before applying an edition; an unavailable or changed edition leaves the previous binding intact and asks the operator to refresh.

## Retained report delivery context

A newly declared `delivery_mode` and `native_study` belong to the watershed report’s original selection and therefore its existing identity hash. Native-study metadata uses the same validator as the delivery builder: original `title` and `purpose`, with optional `reference`. The report, economic edition, release selection and restored project retain those values. No study mode is inferred from a project name, coordinate system, grid resolution or geographic location.

Older report selections without these fields keep their original identity and regional default. Choosing a different mode in **Map release** or the atlas creates a release draft; it does not rewrite the saved report or economic edition. A native-study draft prepared from an older report leaves its purpose for the operator to supply. Changing to regional mode removes study metadata from the new release selection while retaining its original report and economic bindings.

The existing CLI supports the same retained declaration:

```sh
python -m model.scenario_decisions --workspace WORKSPACE --baseline-run BASELINE_ID \
  --alternative-run ALTERNATIVE_ID --delivery-mode native_study \
  --study-title "Original study title" --study-purpose "Original study purpose" \
  --study-reference "Original study reference"
```

Use these context flags with `--baseline-run`. A `--selection` JSON file carries its own optional `delivery_mode` and `native_study` fields. Supplying no declaration preserves the legacy selection shape. The original model, pollutant and watershed selections remain unchanged.

## Revise a map release

The Native runs step keeps a linked watershed report, saved scenario analysis or economic edition on its original baseline and ordered alternatives. Sources, layout, contact and notes remain editable. Choose **Choose a different run cohort** to remove all three kinds of retained result links and select another completed original baseline and land-cover alternatives. Prepared source context, map settings and contact carry forward.

In Review and build, **Remove economic edition** removes only the optional economic binding. Any original watershed-report or scenario-analysis link remains. **Refresh compatible economic editions** lists completed original editions without replacing this draft. Select an edition and press **Use selected economic edition** to replace only its ID and original record hash. Source selections, receptor context, layout, contact, notes and other original result links are preserved. A draft with no watershed-report link can retain an economic edition for its exact cohort without gaining a separate report link.

The picker keeps the chosen option across navigation within the same cohort. Reading choices and applying a replacement update only the economic panel, preserving unfinished contact and notes. A later workspace, selection import or new release invalidates an earlier pending response. A changed or removed economic binding is not overwritten by an older response.

Saved releases reopen with their retained choices. **Revise this selection** creates an editable draft with those same bindings. Loading selection or receptor JSON preserves newer selections and edits made while the file is being read, including unfinished invalid input; reload the file if the draft changed. Current-condition maps require an original baseline, and alternative IDs must be unique and distinct from it.

## Observed water-quality context and receiving waters

Import the complete original observed-report source through its supplied native installer. In the atlas **Source context** step, enable **Observed water-quality context** and choose the imported scientific report document. The selector lists editions carrying the original report schema. The report retains the measured concentrations, dated flow context, reported discharge quantities and the figures declared by the selected original source recipe alongside the annual native-model results. The same source selection and numeric figure specifications drive PDF, offline HTML, Markdown and structured report data.

Receiving-water tables show baseline and alternative annual exports over the same valid cells. They preserve each original receiving-area identifier and source-feature cohort. Geometric contribution area, total selected pixel area and each quantity's valid modeled support are recorded separately. Long source-feature cohorts continue across table rows without dropping IDs. Working-material links include every retained receiving-water asset.

The final scientific workspace is created once after the report files are complete, and its delivery snapshot includes those finished reports. Report links use its planned package-relative path; the retained archive descriptor is recorded after the backup succeeds. The complete GIS package and offline index retain the scientific, economic, receiving-water and observed-context materials together.

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
- operator/web/map_atlas.mjs preserves linked cohorts, replaces compatible economic editions within the prepared draft, and opens geographic inspection and paired map comparisons from the saved release. Extract the complete GIS package and open index.html for offline use. Structured report downloads prefer report_data while retaining report_model compatibility for older saved deliveries.
- operator/web/economic_desk.mjs opens the atlas form directly from a completed edition through the existing report-selection helper, preserving the original ordered cohort and workspace-change guard.

The current composition retains the scientific formatter's original biophysical and profile tables, the atlas and linked-report hooks, selected economic and scenario-analysis bindings, original overlay labels, and package recovery. Renderer and delivery versions identify the composed report edition in each saved release.

The single detailed receiving-water section uses the current formatter's tables. The original receiving-water files and full inventory stay in the package. Publication must compose any later shared-file edits from the current repository head.

## Receiving check

Use the existing application's Python environment to compile the four Python modules. Build a delivery from the original completed project and an economic edition with that exact ordered cohort. Open the PDF and extracted report.html, follow the local economic desk and source links, and compare displayed physical quantities and costs with the original completed edition.

Check the actual selected grid dimensions and hectares in report-data.json. Confirm the atlas, saved watershed report, source-water and receiving-water assets, saved spatial views and every economic manifest member are in the final package. Reopen the same selected delivery to exercise existing completed-result reuse. Retain the actual generated output and its original IDs with the current receiving owner.

The authored JavaScript modules were parsed in this session. The economic-selection helper was exercised for a matching completed edition, physical-only choice and stale-edition rejection. The direct Economic desk action exercised that same helper, preserving native report identity, edition SHA and alternative order, while a workspace change stopped navigation. Atlas checks covered in-place edition replacement, retained contact edits, navigation, unavailable editions and stale selection responses. Native Python compilation and report rendering use the equipped receiving session and retained original case.

## Original work

This integration carries forward ED6E's seven-map decision guide and economic report integration into ASTRA13's maintained scientific formatter. Source document and RFP coverage material remain available separately in the original source bank. All displayed scientific and financial quantities come from the original completed project and Economic desk edition.

## Current-source integration

The prepared-atlas revision is composed with the current scientific v11 renderer and its safe-link checks. Source records retain declared data status, legal edition status, catalogue source identity and original source labels for both modeled inputs and selected context. Delivery format `retained-grid-study-observed-client-report-11` binds this report metadata to a new release identity.

The existing native grid record, source-native versus regional audit scope, saved-analysis attachment, package recovery and final atlas-browser snapshot remain in the delivery. The final browser snapshot runs after report and analysis members have been retained. Existing completed releases reopen unchanged through their original identities.

## Separate client companion in the complete delivery

The full client decision guide is produced alongside the canonical scientific report. Its current compiler retains the selected models, original grid, paired support, source-area interpretation and edition4 receiving-water quantities, with separate companion filenames. Values with no native valid or common support remain unavailable in the report. The scientific renderer includes the original observed figures and source-bound context.

```python
generated = client_report.build_report(
    workspace=workspace, directory=directory, selection=selection,
    state=state, baseline=baseline, alternatives=alternatives,
    grid=grid, profile=profile, records=records,
    observation_results=observation_results, comparison=comparison,
    scenario_summary=summary,
    additional_sections=receiving_water_delivery.report_section(water_product),
    output_stem="client-report", file_key_prefix="client_",
    working_archive_path="working/scientific-workspace.zip")
for name, relative in generated.items():
    state["files"][name] = describe_file(directory, directory / relative)
```

The four original companion keys are `client_report`, `client_report_html`, `client_report_markdown`, and `client_report_model`, with files `client-report.pdf`, `client-report.html`, `client-report.md`, and `client-report-model.json`. The normal builder already makes this call and retains all four paths in its project assets and working snapshot. The original scientific filenames and full economic/scenario sections stay in place.

Before the delivery identity is calculated, `selection.client_companion_edition` records this compiler's `REPORT_EDITION`. The scientific `selection.client_report_edition` and `report_renderer_version` retain their independent current producer editions. The current complete application inventory is bound as `application_sha256`.

The existing delivery screen opens either report through the authenticated preview route. Both report models must bind the exact selected delivery ID. Its file tickets preserve each real map, GIS and report path, and the grouped downloads expose both complete formats. Received copies list their retained snapshot and can prepare a complete local delivery through the original task queue.

Customer-specific narrative and RFP delivery coverage are maintained in the private handoff alongside this reusable compiler.

## Reopening the working project

The first rendered report links to `working/scientific-workspace.zip`. The actual ZIP is registered and verified after both reports are complete, so its selected snapshot includes their final bytes. Receiving retains the original input ZIP outside its own member manifest, beside the extracted reports and through the restored delivery record. Same-filesystem receiving uses one linked data copy; cross-filesystem receiving streams the original open archive into the destination. Identity reads and result construction finish before the receiving directory is published.

## Original native-study releases

Select the existing native-study delivery mode for an original study such as Gura. Its title, purpose, reference, reporting polygon, model domain, biophysical table and native grid are retained with the release. The scientific report and client companion use that study context. The client map guide counts the five native-study families and any optional source-water families actually selected; the regional mode retains its seven RFP families and original RFP references. Native-study PDF, HTML and Markdown identify the original study rather than presenting the regional RFP as its contract.

Both reports preserve the same completed runs, annual-mass artifacts and paired valid support. The companion links to the scientific report and selected economic or observed materials without changing their quantities. The final archive captures both complete report sets, the original grid record, the offline atlas navigator and delivery manifest.

## Receive the completed client delivery

The maintained `source_tools/receive_client_delivery.py` entry continues the original client receiving operation. It uses the selected completed delivery or its received snapshot, applies the explicitly selected compiler, and checks the four client formats, map-file index, package assets and original working-archive descriptors. It reuses the retained native run cohort.

After the existing Gura study driver reaches its completed checkpoint, use the same application, interpreter and Workspace from that operation:

```sh
"$GIS_PYTHON" -B "$APPLICATION/source_tools/receive_client_delivery.py" \
  --application "$APPLICATION" --workspace "$GURA_WORKSPACE" \
  --native-study-record "$GURA_WORKSPACE/gura-receiving/gura-native-study-state.json" \
  --expected-report-edition 2026-10-13-client-report-9 \
  --expected-compiler-sha256 0c6fc153c8279ac6fdce7b73f45b2ca2d6fbc55f573a26d34ecd48e55ea78c63
```

The edition and compiler hash above identify the current client edition9 on main d6169e5c, which preserves the complete PR3104 companion and adds producing-model execution provenance. The receiver checks those selected bytes before importing the compiler. Preserve the current complete application, including the report-context handoff from PR3150 and its Gura callers, when continuing that source edition.

`--native-study-record` reads the completed driver's actual delivery ID, verifies its output directory, saved source report and ordered native cohort against the same Workspace, and returns the checkpoint's original byte count and SHA256 with the receiving result. This removes delivery-ID copying from the native job. The existing explicit `--delivery-id ORIGINAL_ID` route remains available for any completed release or restored `received_snapshot`; the two selectors are mutually exclusive.

The result contains the selected and resulting delivery IDs, original grid, native run IDs, map-file count, absolute client report paths and archive descriptors. Keep this result with the existing operation output, then use the maintained Workspace archive receiving and operator preview routes to reopen the report and its original GIS files. The archive inventory check reads `delivery.files` from the actual portable manifest, retaining the original roles and hashes.
