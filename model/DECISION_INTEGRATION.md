# Upper Savannah scenario decision companion

This companion turns completed watershed-model scenarios into an implementation decision. It compares annual nitrogen, phosphorus and sediment export; applies sourced implementation costs, budgets and pollutant-reduction targets; identifies the Pareto frontier; examines paired parameter sensitivity; ranks original parcel targets; and produces a complete offline decision desk with JSON, CSV, source and a ZIP delivery.

## Complete source placement

Place these files together in the original product model directory:

| File | Responsibility |
| --- | --- |
| decision_analysis.py | Original workspace intake, shared-cell annual mass, economic assessment, complete scenario selection, sensitivity, parcel intake and export |
| decision_cli.py | Existing-comparison inspection, selection preparation, native workspace analysis, physical-packet analysis and receiving |
| decision_desk.html | Offline interactive comparison, saved view, notes, costs, filters, graph, parcel/source inspection and printing |

The backend is self-contained. It accepts the original Workspace object or its directory path and does not import or invoke model/native.py. Direct script execution and package execution use the same source. Python 3.10 or newer supplies the standard library; numerical workspace intake uses the existing Rasterio and NumPy installation. A compatible physical-input packet can be processed with ordinary Python without reading the rasters again.

## Operate the real completed workspace

From the product directory, list actual retained comparison identities:

    python -B model/decision_cli.py inspect --workspace /absolute/upper-savannah-study

Choose the reference comparison from that output and prepare a selection:

    python -B model/decision_cli.py selection --workspace /absolute/upper-savannah-study \
      --comparison-id ORIGINAL_COMPARISON_ID \
      --title "Upper Savannah management alternatives" \
      --output /absolute/decision-selection.json

ORIGINAL_COMPARISON_ID means the exact ID returned by inspect. The selection starts with that actual comparison and contains no invented costs. Add reviewed economic assumptions, optional budget and targets, and the IDs of the existing profile-paired sensitivity comparisons.

Run the actual completed outputs through the full companion:

    python -B model/decision_cli.py build --workspace /absolute/upper-savannah-study \
      --selection /absolute/decision-selection.json \
      --output /absolute/upper-savannah-decisions

The original workspace remains the source. The output directory is a new decision edition. Open its index.html; decision-package.zip carries the complete result, original physical-input packet and companion source.

The package-mode equivalent is:

    python -B -m model.decision_cli build --workspace /absolute/upper-savannah-study \
      --selection /absolute/decision-selection.json \
      --output /absolute/upper-savannah-decisions

## Selection contract

The selection schema is upstate.decision-selection/v1.

| Field | Meaning |
| --- | --- |
| title | Human-readable title of the decision |
| comparison_id | Original baseline-plus-alternatives comparison |
| costs | Optional cost records, each keyed by one reference alternative run_id |
| budget | Optional currency plus capital_limit, annualized_limit or both |
| targets | Optional minimum annual avoided export for nitrogen_export, phosphorus_export and sediment_export |
| sensitivity_comparison_ids | Existing completed comparisons, each pairing a profile-specific baseline with its own alternatives |
| delivery_id | Optional completed delivery carrying the original parcel inventory for the same baseline and alternatives |
| top_parcels_per_pollutant | Number of independent original parcel targets retained per physical axis; default 10 |
| notes | Reviewer text carried into the report |

Each supplied cost record has run_id, currency, capital, annual_operating, horizon_years, discount_rate, source and optional note. The source is an object containing title, uri and as_of, with an ISO calendar date. Currency is a three-letter code. Costs and rates are finite nonnegative numbers, and the horizon is positive.

Capital and annual operating costs refer to the modeled management scenario. A modeling-service fee is a different cost scope and must not silently stand in for land-management implementation cost. Preserve the source and scope of each entered assumption.

Targets are absolute annual avoided mass: nitrogen and phosphorus in kg/year, sediment export in t/year. Budgets retain their entered currency. Costs in another currency remain explicit; the companion performs no inferred exchange conversion.

Equivalent annual cost is capital divided by the present-value annuity factor, plus annual operating cost. At zero discount, it is capital divided by the selected horizon plus annual operating cost. Present value is capital plus the discounted annual operating stream. Dividing annualized currency/year by avoided kg/year gives currency/kg; sediment gives currency/t. Nonpositive reductions have no positive-reduction cost ratio.

## Native physical input

The workspace adapter reads the original paths and identity fields already used by the product:

| Retained record | Fields consumed |
| --- | --- |
| workspace.json | Original project identity and title |
| runs/ID/run.json | Completed state, grid/profile/scenario/model-version selection and artifact descriptors |
| scenarios/ID.json | Original scenario kind, source collection and ordered land-cover patches |
| profiles/ID.json | Selected parameter profile |
| grids/ID/grid.json | Retained grid identity and source selection |
| comparisons/ID/comparison.json | Baseline ID, alternative IDs, direction and original difference artifact descriptors |
| deliveries/ID/delivery-state.json | Completed parcel delivery, baseline/alternative selection and parcel CSV identity |

For each pollutant, the adapter obtains the raster filename from the original run artifact descriptor. It does not guess native filename suffixes. The existing derived roles are nitrogen_export, phosphorus_export and sediment_export.

The current product's derived reporting rasters are already annual mass per pixel. The adapter sums them directly. Raw per-hectare inputs, when explicitly selected and labeled as such, multiply by the actual determinant of the projected metre grid divided by 10,000. The model version alone never determines a derived artifact's unit basis. Annual-mass summary totals receive no second area conversion.

Before numerical processing, candidate file availability, units and exact raster dimensions, CRS and transform are inspected. An unavailable, incomplete or incompatible alternative is retained in unavailable_alternatives with its exact run ID and reason; the remaining complete candidates continue. The common finite-cell mask is then formed across the reference baseline and all available alternatives in that comparison.

Each source raster is read once for that numerical comparison. Baseline and alternative own-support totals are retained, and the side-by-side decision quantities use the same common mask. The support descriptor includes a deterministic mask identity, valid cells, area, candidate membership and each run's coverage fraction. Equal cell counts alone do not establish equal support.

The delivered reporting mask is downstream of the original native routing operation. The companion does not reconstruct hydrologic routing or replace the native whole-scenario result. All comparisons preserve the selected original grid and model version. Pixel export changes describe changes in modeled source contribution; they are not a map of where retention service occurred.

## Join existing physical reports and experiments

The experiment owners continue to select parameter profiles and execute the native baseline/scenario pairs. This companion consumes their completed comparison IDs.

The physical watershed-report producer can bypass a new raster pass by supplying upstate.decision-input/v1:

| Packet field | Content |
| --- | --- |
| project | Original project identity and title |
| comparisons | Reference comparison followed by any selected sensitivity comparisons |
| sources | Original source records with path or reference, SHA256 and byte count |
| parcel_inventory | Optional original parcel rows and coverage |
| unavailable_alternatives | Optional original comparison/run IDs and exact unavailable-input reasons |

A comparison contains id, baseline and alternatives. The baseline contains run_id, scenario_id, scenario_key, title, profile_id, grid_id, invest_version and outputs. Each baseline output has total, units, valid_cells, pixel_area_ha, normalization and artifact.

Each alternative contains run_id, scenario_id, scenario_key, label, kind, profile_id and outputs, with optional source_edits and scenario_definition. For each pollutant, its output contains baseline, alternative, delta, reduction, reduction_percent, units, baseline_valid_cells, alternative_valid_cells, comparison_valid_cells, support and artifact.

For a supported comparison, support.status is paired and support.id identifies the actual common cells. The input validator also accepts same_support and emits paired for the desk. Baseline and alternative values are the same-cell annual masses. Delta is alternative minus baseline; reduction is baseline minus alternative. A zero baseline has a null percentage. Unsupported summary rows keep percentages null.

scenario_key identifies the same physical land-cover definition across parameter profiles. The workspace adapter hashes the original source collection and ordered physical patches, excluding descriptive title/reason/notes; patch order and source masks remain meaningful. A physical producer must preserve the same identity semantics across all of its member comparisons.

Process an actual packet:

    python -B model/decision_cli.py packet --input /absolute/physical-input.json \
      --selection /absolute/decision-selection.json \
      --output /absolute/upper-savannah-decisions

The shared Python interface is analyze_packet(packet, selection), followed by export_report(report, destination, input_packet=packet).

## Decision and sensitivity behavior

Every candidate is an indivisible completed modeled scenario. The companion does not sum isolated parcel or project benefits into a new hydrologic portfolio.

Targets and budgets produce an eligible shortlist. Pareto comparison keeps nitrogen, phosphorus and sediment separate. A candidate dominates another only when it is at least as good on every compared axis and strictly better on one. Exact ties remain tied. The cost axis is included when every candidate on the same support has a known cost in the same currency; otherwise the report explicitly identifies the physical-benefit-only frontier. The report distinguishes all supported candidate_ids from nondominated frontier_ids.

Sensitivity members pair each alternative to that member's own baseline profile. The baseline definition, grid and model version stay fixed. Matching original scenario definitions and common support IDs determine comparable members. Missing matches remain listed with their reason, and the completeness count reflects the selected group.

Sensitivity output includes minimum, maximum, median, q10/q90, improvement frequency and per-pollutant rank range. Rank ranges compare the same semantic candidate intersection across every accepted member, with rank_candidate_count and rank_basis retained. These summarize the supplied profile choices. They are not probabilistic confidence intervals without an externally established parameter probability model.

Parcel targeting uses the original delivery's per-parcel scenario deltas and retains feature identity, reporting area, valid-cell coverage, protected fraction, drinking-water intersection and high-quality-water context. Rankings are independent for each physical pollutant. Original overlaps remain separate, and ranked parcel quantities are not added into a basin or bundle total.

## Direct native watershed report adapter

The companion reads the completed ASTRA-S1 physical producer report directly. The producer's actual schema is upstate.scenario-decisions/v1, created by model/scenario_decisions.py from the original completed native runs. Its report.json embeds the original scenario definitions, run selections, profile identities, model version, reporting-zone sources, all-run common masses, pairwise quantities and native coverage. This intake therefore needs only the retained JSON report and ordinary Python. The same commands also accept the producer's completed decision.json summary; the adapter resolves its files.json descriptor inside that original directory and verifies the report's size, SHA-256, identity and selection before reading its quantities.

Inspect the actual zones and source-compatible alternatives:

    python -B model/decision_cli.py scenario-inspect \
      --report /path/to/study/scenario-decisions/REPORT_ID/report.json

The result includes each original zone_id, title, area, scope, source selection, common physical coverage and the exact decision comparison_id derived from that source report and selected zone. Built-in producer zones are reporting_area and model_domain. Additional utility/HUC zone identities come directly from the original source selection and remain intact.

Prepare the selected zone's economic input file:

    python -B model/decision_cli.py scenario-selection \
      --report /path/to/study/scenario-decisions/REPORT_ID/report.json \
      --zone-id reporting_area \
      --output /path/to/zone-selection.json

This writes the exact source-bound comparison identity and lists the retained run IDs for adding sourced costs. Add actual cost assumptions, budget and physical targets with the same selection schema described above. Name the intervention footprint and whether the cost covers the whole scenario or a zone-specific implementation estimate in the cost source/note. Selected-zone benefits can cover only part of a scenario's footprint; the adapter never prorates implementation cost by reporting area. Then build:

    python -B model/decision_cli.py scenario-report \
      --report /path/to/study/scenario-decisions/REPORT_ID/report.json \
      --zone-id reporting_area \
      --selection /path/to/zone-selection.json \
      --output /path/to/new-zone-decision-edition

The Python functions are inspect_scenario_report(path) and scenario_report_packet(path, zone_id). The packet feeds analyze_packet and export_report unchanged.

The adapter maps producer nitrogen, phosphorus and sediment to nitrogen_export, phosphorus_export and sediment_export. It uses baseline_common_mass and alternative_common_mass, change_mass, avoided_export_mass and avoided_export_percent. Annual kg/year and metric_tonnes/year are normalized to the companion's annual mass labels without multiplying by cell area again. The independent all_valid_mass and original pairwise results remain attached alongside the shared comparison.

The original producer establishes common finite cells across every selected run within each pollutant/zone. Its current report has no raster mask digest. Accordingly, support.id is a source-report/zone/pollutant/cohort identity with id_kind=producer_report_zone_cohort. This supports comparisons within that exact cohort. The adapter does not infer equal masks between separate reports from equal counts or area. The original workspace raster adapter remains the route for sensitivity comparisons that measure common-mask identities across profiles.

Alternative records with a different parameter profile from their baseline stay listed under unavailable_alternatives, with their original identity and specific reason; compatible land-cover alternatives continue. Source comparison support retains the original producer's complete cohort, including any alternative omitted from the economic table. The reported geography, common area, native structural stream support, unresolved coverage, original source selection and pairwise statistics travel with the result.

The decision report exposes physical_source and scope.reporting_unit with the exact selected zone. physical-input.json retains the exact original source report text, and source-inputs/scenario-report.json reproduces its original bytes. The export verifies their size and SHA-256 before adding them to the complete edition.

## Execute the receiving journey

Save model/decision_receive.py beside the backend. This entrypoint builds a real edition and operates its actual desk with the host's installed Python Playwright and Chromium. It consumes existing scientific results through the same analysis adapters.

From a completed native zone report:

    python -B model/decision_receive.py \
      --scenario-report /path/to/study/scenario-decisions/REPORT_ID/decision.json \
      --zone-id reporting_area --selection /path/to/zone-selection.json \
      --output /path/to/new-received-edition

From existing workspace comparisons, replace --scenario-report and --zone-id with --workspace /path/to/study. To receive an already built edition:

    python -B application/decision_receive.py --edition /path/to/decision-edition

An installed system Chromium is detected when the Playwright browser binary is absent. --browser-executable selects an existing browser path; --run-id chooses an actual available alternative; --notes supplies the working note to append.

The journey opens the real report, chooses a complete scenario, selects an available pollutant for its chart, applies a view criterion drawn from that case's actual cost or physical reduction, and exports the visible table, complete table, report JSON and selection. It saves working notes in the desk, reopens that file through the application's file picker, opens it as a standalone HTML document, and activates print before producing the browser PDF. Saved case, criteria, chart selection and notes are checked against the observed interaction.

Each receiving session is retained beneath receiving/TIMESTAMP-ID. A completed journey includes five actual browser screenshots, the downloaded documents, saved HTML, decision-report.pdf and journey.json with stage timings, browser version, source identities and any browser errors. decision-receiving-package.zip contains the complete original edition and that receiving session.

Exit 0 means the journey completed. Exit 3 records browser_unavailable and supplies browser_resume_command for the existing browser host; the completed analysis edition remains usable. Exit 1 records the failed journey stage and available artifacts; exit 2 reports an input or filesystem error. The journal is checkpointed at stage boundaries, and repeated receiving sessions retain distinct directories.

The browser API references are the official [Playwright downloads](https://playwright.dev/python/docs/downloads), [Chromium launch](https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch) and [PDF](https://playwright.dev/python/docs/api/class-page#page-pdf) documentation.

## Join the existing operator

Keep the new files in their own model paths and add a single decision.build action in the active operator owner's dispatcher. Pass the original workspace and the selected payload to decision_analysis.build. The destination should be the operator's current output directory for that task, and its existing download ticket mechanism should expose index.html, report.json and decision-package.zip.

The callable interface is:

    from model.decision_analysis import build
    result = build(workspace, payload, destination)

The result supplies report_id, directory, index, archive, candidates and eligible_candidates. The receiver can reuse an existing completed result at that path through its original operation identity. Direct CLI operation remains available independently of that integration.

## Export and receiving

Each successful export includes:

| Output | Use |
| --- | --- |
| index.html | Complete offline decision desk with the report embedded safely |
| report.json | All physical/economic outcomes, selections, sources and decision explanations |
| physical-input.json | Actual source-bound packet used for that result |
| source-inputs/scenario-report.json | Exact original physical producer report for native-zone intake |
| selection.json | Exact economic, budget, target, sensitivity and parcel selections |
| alternatives.csv | Separate physical axes, signed changes, cost effectiveness and prepared decisions |
| sensitivity.csv | Paired-profile ranges and rank stability |
| parcel-targets.csv | Original independent parcel targets and coverage |
| costs.csv | Explicit economic assumptions and source references |
| sources.csv | Retained source identity inventory |
| application | Complete Python backend, command line source, desk template and colocated methods, walkthrough and integration guides |
| manifest.json | Hashes and sizes of the complete delivery members |
| decision-package.zip | One-file carrier of that complete edition |

CSV exports protect text fields against spreadsheet formula execution while retaining numeric negative changes as numbers. The embedded report escapes HTML-significant characters and Unicode line separators before insertion into the single DECISION_REPORT_DATA marker.

The desk can save a standalone HTML working copy with its selected case, view filters and notes, reopen it offline, export an updated selection request and print to PDF. Filtering a saved view does not silently rerun models or overwrite the prepared report; the exported selection is the explicit input to a new decision edition.
