# Optimize an original conservation study

This module connects the maintained C8FF portfolio solver to the application's
original conservation studies and saved plans. It reads the complete retained
candidate inventory, preserves each pollutant's native support and original
source identity, and saves the chosen land through conservation.save_plan.

The complete decision analysis, all candidate rows, original attributes,
constraints, named preferences, source bindings and solver results are retained
beneath the original study. The original plan remains the authoritative land
selection. Its existing scenario and implementation consumers can open it.

## Source and callable integration

Install these two additive files under the actual application directory:

- model/conservation_optimization.py
- model/CONSERVATION_OPTIMIZATION.md

The adapter imports the maintained model/portfolios.py. Its verified starting
source is the complete 18-file C8FF bank:
https://chatgpt.com/space/page_5d11af3f59a08191ab9a2131b35c882d .
That bank has decoded JSON SHA256
a74d97e3bc28708a5c2a8cbf5e0d8e69828f7d653e8e5b460acb1a08f6016bd9.
The initial portfolios.py body is 95,248 UTF-8 bytes, SHA256
f0364a184cace554c136c04ab6d34b71963e9600a5bcc5c0fa0bf491b882c8fd.
Every analysis records the actual installed solver source identity and calls
its _optimize function. The adapter also uses the original integer USD-cent and
area-tolerance helpers. C8FF retains its original delivery input and UI.

The conservation input contract is the selected-native-model and original-grid
successor in F0C8HQY4M0B, subsequently included in the cumulative E7A1 application.
It supports completed NDR-only, SDR-only and historical combined InVEST 3.20.0
cases, each original selected cell size, and genuine source-context studies.

| Callable | Behavior |
| --- | --- |
| preview(workspace, selection) | Read actual candidates, apply objectives and support filters, run the current solver and named preferences, return the complete analysis. |
| save(workspace, selection) | Retain that analysis and save its exact selected IDs through conservation.save_plan. |
| get_analysis(workspace, study_id, analysis_id) | Verify and reopen the retained analysis and its complete files. |
| export(workspace, plan_id) | Export the original plan packet plus every optimization file. |

The existing queued operator can call these functions directly. Writes remain
in its current task queue. Output descriptors are relative to workspace.root
and use its existing authenticated file-ticket decoration. The portfolio UI
owner can expose its original delivery input alongside a conservation study
selector, then call this adapter for the latter. Source-context and partial
native controls must use the returned axes and available_axes.

The adapter performs a decision calculation without creating another native
run. To calculate a selected treatment, use the returned original plan.id with
conservation_scenarios.create_scenario, then the ordinary native run path.

## Actual input selection

Pass the original completed study ID. The supported fields are:

| Field | Accepted content |
| --- | --- |
| study_id | Original completed conservation study ID. |
| title, purpose | Decision title and reason; defaults use the original study title. |
| objective.kind | source-context, current-export, restoration, avoided-conversion or published-method; default follows the original study's score basis. |
| objective.basis | total or per-reporting-hectare. Source-context axes use total because their geographic units are explicit. |
| objective.scenario_run_id | Original alternative retained by the study, required for restoration or avoided-conversion. |
| weights | Nonnegative named weights; positive axes need their actual retained inputs. |
| filters.min_coverage_fraction | 0 through 1; inherits the study's minimum coverage by default. |
| filters.max_protected_fraction | 0 through 1, default 1; a tighter rule requires actual protected context. |
| filters.source_water | any, yes or no; unknown context cannot satisfy yes or no. |
| filters.high_quality_water | any, yes or no, using the original declared designation relation. |
| filters.include_ids, exclude_ids | Lists of exact original string IDs from the candidate inventory. |
| include_ineligible | Default false. True deliberately reconsiders the study's earlier eligibility; this adapter's selected support and resource rules still apply. |
| constraints.budget_usd | Supplied USD budget with at most two decimal places; requires the study's original USD cost table. |
| constraints.area_ha | Nonnegative area limit. |
| constraints.area_basis | whole_units by default, or reporting. |
| constraints.max_count | Nonnegative whole-unit limit; zero can produce an empty preview. |
| solver | deterministic by default, or scipy-milp. |
| solver_time_limit_seconds | Positive optional limit, default 20 seconds per preference profile. |
| stability | Boolean, or an object with enabled and optional profiles. |
| stability.profiles | Named objects containing name and weights. |

Candidate IDs remain original strings. Collection ID, source edition ID and
native ID stay with each original candidate. The adapter neither fabricates
delivery IDs nor rounds fractional covered hectares into integer pixel counts.

### Source-context geography

These axes operate immediately on the actual retained regional watershed study:

| Axis | Quantity | Required original source |
| --- | --- | --- |
| reporting_area_ha | Selected unit footprint inside reporting, in hectares. | Original units and reporting geometry. |
| source_water_area_ha | Union intersection with selected protection geometry, in hectares. | Bound drinking_water context. |
| unprotected_area_ha | Reporting footprint minus protected union, in hectares. | Bound protected_lands context. |
| high_quality_context | 1 or 0 for the study's declared designation relation. | Bound high_quality_waters context. |

Default source-context weighting is reporting_area_ha: 1. This is an explicit
geographic-coverage preference. It asserts no pollutant or health response.
Unknown source context remains unavailable. The four utility HUCs remain
geographic focus unless actual source-water protection polygons are bound.

The existing actual regional receiving operation can continue with its own
completed study record:

~~~python
from model import conservation_optimization

selection = {
    "study_id": completed_regional_study["id"],
    "title": "Regional land coverage under the selected resource limit",
    "objective": {"kind": "source-context", "basis": "total"},
    "weights": {"reporting_area_ha": 1},
    "constraints": {"area_basis": "whole_units"},
    "stability": True,
}
analysis = conservation_optimization.preview(workspace, selection)
saved = conservation_optimization.save(workspace, selection)
~~~

Add the actual intended count or area limit if that is the planning question.
There is no arbitrary top-N cap. All original candidates, including excluded
units, remain in the complete analysis and CSV.

### Physical native objectives

Axes are nitrogen_export, phosphorus_export and sediment_export. N/P retain
kg/year; sediment retains metric_tonnes/year. Per-reporting-hectare objectives
divide the actual case-footprint quantity by that unit's reporting hectares,
independently of the selected land-budget area basis.

Current-export uses the baseline quantity and its own support. Restoration uses
baseline minus the selected alternative on common native support.
Avoided-conversion uses the selected disturbance alternative minus baseline on
that common support. Adverse changes remain negative.

Current-export exposes the baseline's selected outputs. Change objectives use
the baseline/alternative output intersection. An alternative-only pollutant
quantity remains in the full original candidate record, while its paired delta
stays unavailable when the baseline omitted that model.

Omitted physical weights become equal across available outputs. Explicit
positive weights for absent outputs are rejected. Each candidate must meet the
active objective's actual case or common coverage. A missing inactive axis
cannot manufacture zero mass. Named preference profiles independently require
adequate support on all their positive axes.

Original structural stream coverage, fractional polygon-cell intersections,
NoData behavior, selected resolution and InVEST version remain in the original
conservation method and input.selection.

~~~python
selection = {
    "study_id": completed_native_study["id"],
    "title": "Restoration priorities from the retained alternative",
    "objective": {
        "kind": "restoration",
        "basis": "total",
        "scenario_run_id": completed_alternative["id"],
    },
    "weights": {
        "nitrogen_export": 1,
        "phosphorus_export": 1,
        "sediment_export": 0,
    },
    "filters": {"min_coverage_fraction": .95},
    "constraints": {"area_basis": "reporting"},
    "solver": "scipy-milp",
    "stability": {
        "enabled": True,
        "profiles": [
            {"name": "Nitrogen preference", "weights": {"nitrogen_export": 1}},
            {"name": "Phosphorus preference", "weights": {"phosphorus_export": 1}},
        ],
    },
}
saved = conservation_optimization.save(workspace, selection)
~~~

The named axes above must actually exist in both completed cases. Those code
examples consume records returned by the maintained model.

## Objective scale, land constraints and costs

Each axis uses the maximum absolute adequately supported objective across
source-qualified original units, before cost exclusions. Scales remain fixed
across named preferences. Negative changes stay negative. The current C8FF
solver supplies complete deterministic multi-order selection with relaxation
bounds, or optional native SciPy HiGHS integer optimization. Its actual fallback
and explanation remain visible when the optional solver is unavailable or does
not improve a feasible incumbent.

Reported optimality concerns the declared additive source-unit objective and
resource problem. It does not assert an optimal hydrologic treatment or a
geometry-union optimum. Independent source footprints may overlap. An additive
area cap is therefore conservative relative to the corresponding actual union
and may exclude an overlapping set that would fit under a pure union cap.
Preview computes both whole-unit and reporting unions so this is visible.

The solver expands area comparison by a numeric tolerance. This adapter records
a slightly tighter solver input so the effective additive cap stays within the
user's requested area. Both requested constraints and actual solver_request are
retained. The original saved plan also verifies the actual union.

A count limit counts selected original units. Cost is the supplied whole-unit
amount even when only part of the geometry lies in reporting. Overlapping units
are not presumed to share one acquisition or invoice. Missing costs stay
unknown and cannot pass a USD budget.

The maintained solver uses exact integer USD cents and at most two decimal
places; original USD amounts are not rounded. Other original currencies stay
visible in candidates and the saved plan, but are not converted to USD or used
for a USD budget. Known subtotal is separate from the total, which remains
unavailable when a selected amount is unknown.

## Saved records and portable receiving

The returned analysis contains the original input study/source/native bindings,
installed solver source identity, normalized request and actual solver limits,
every original candidate, selected IDs, objective values and units, axis support,
source/resource exclusions, selected scores, geometric unions and overlap,
normalization, solver explanation, preference results and interpretation.

Its ID is the digest of the complete canonical content. save retains:

~~~text
conservation/<study_id>/optimization/<analysis_id>/
    analysis.json
    candidates.csv
    index.html
    analysis-state.json
~~~

That directory is the decision explanation. The authoritative land plan stays
in conservation-plans/<plan_id>/plan.json. Its selection.optimization binds the
analysis ID, full file identities, request, scales, solver result and selection.

save returns:

~~~text
{
    plan: original completed conservation plan,
    analysis: retained analysis reference with complete file descriptors,
    selected_ids: same original candidate IDs,
    union_summary: original plan.summary
}
~~~

The original plan recomputes N/P/sediment on its reporting union. Read
union_summary.pollutants for those quantities. Independent objective sums in
the analysis stay separately labelled with their own units.

export includes the original conservation packet plus optimization/analysis.json,
candidates.csv, index.html and REFERENCE.json. It streams archive members to disk
and preserves the full GeoPackage and candidate tables. The original index.html
opens the land decision; optimization/index.html opens the full optimization
explanation. The original full Workspace archive is the receiving artifact for
recomputation from retained sources and native outputs.

get_analysis checks retained file identities and canonical analysis content.
Reopen the plan through conservation.get_plan. Implementation and editable
design consume conservation_bindings.bind_plan on that same original plan.id.
The existing conservation_scenarios.create_scenario bridge retains selected_union,
actual model-domain containment and separate reporting overlap.

## CLI and native receiving continuation

~~~sh
python -m model.conservation_optimization --workspace ACTUAL_WORKSPACE preview actual-selection.json
python -m model.conservation_optimization --workspace ACTUAL_WORKSPACE save actual-selection.json
python -m model.conservation_optimization --workspace ACTUAL_WORKSPACE inspect ACTUAL_STUDY_ID ACTUAL_ANALYSIS_ID
python -m model.conservation_optimization --workspace ACTUAL_WORKSPACE export ACTUAL_PLAN_ID
~~~

Capitalized arguments denote actual paths and IDs in the current operation.
Continue the existing regional/browser receiver after it has a completed study:

1. Use that actual study ID for a geographic decision; inspect its complete
   original inventory and resource interpretation.
2. Save the exact selected native IDs and export the complete decision packet.
3. Open a fresh Workspace on the same retained path and reopen both plan and
   analysis. Compare the original selected IDs, source identities, union area and
   complete output descriptors.
4. If a native baseline/alternative pair is complete, repeat using its actual
   shared modeled axes.
5. For an intended treatment, pass the saved plan through the ordinary scenario
   and native run path. Case-footprint comparison and the completed treatment
   retain their respective identities.

Return the actual source edition, study/analysis/plan IDs and original exception
to the existing project thread. This continues its native receiving operation.


## Published practice methods in the same optimizer

A study whose score basis is `published_method` now defaults to the
`published-method` optimization objective. This is the original practice
score already calculated by the maintained Lake Keowee engine from its retained
criterion table and declared field bindings. The numeric optimizer consumes
that complete score; it does not reconstruct published rules or substitute an
area preference.

The public point axis is `published_points`, also exposed as
`PUBLISHED_AXES = ("published_points",)`. Omitted weights give this axis weight
one. The request keeps the complete original method and category definition,
definition and implementation hashes, criterion-source identity, original
scoring normalization, priority ranges, method interpretation and required
native pollutant criteria.

A request for an actual completed practice study is:

~~~python
selection = {
    "study_id": original_practice_study_id,
    "title": "Published practice priorities under the supplied land limits",
    "objective": {"kind": "published-method", "basis": "total"},
    "weights": {"published_points": 1},
    "constraints": {
        "area_basis": "whole_units",
        "area_ha": supplied_area_limit_ha,
    },
}
analysis = preview(workspace, selection)
saved = save(workspace, selection)
packet = export(workspace, saved["plan"]["id"])
~~~

Use the real study ID and actual chosen area limit. Cost constraints continue
to require the original supplied cost table and its currency. Omit constraints
that have not been supplied.

The candidate's `point_score` retains known and possible criterion points,
attainable maximum, prerequisite, original point total, priority band and exact
definition identity. A complete score must have equal known/possible totals,
a true practice prerequisite, point units and the same candidate score. Only
those complete values satisfy a positive point weight. Incomplete criteria,
an absent prerequisite and an unknown prerequisite have separate availability
and reason values:

| Availability | Meaning |
| --- | --- |
| scored_published_method | The original prerequisite is true and the complete published criterion total is known. |
| partial_criteria | The prerequisite is true, but at least one criterion still permits a range of points. |
| inapplicable_practice | The selected practice's prerequisite is absent. |
| unknown_prerequisite | The retained criterion source has not determined the practice prerequisite. |

Point totals remain unknown where the original method did not establish a
complete applicable score. Their known/possible bounds remain visible in the
original candidate and point-axis support. A complete published score can
still be excluded by an explicit source, resource or native-support rule; its
actual points are preserved.

When the published method derives a criterion from native current export,
each required baseline pollutant must be selected, have its own original
quantity, and meet the request's minimum native coverage. These checks remain
active when `include_ineligible` deliberately revisits earlier study
eligibility. The point axis records `native_support` separately for every
required pollutant, and its coverage field is the minimum own-case coverage
across those required outputs. Methods whose selected criteria use only
original GIS/table observations have no native coverage denominator.

The optimizer's default quantity is the original point total. An explicitly
selected `per-reporting-hectare` basis uses points divided by the original
candidate reporting area and labels its unit `points/reporting_ha`. This is
an explicit portfolio intensity preference. The retained original point total,
category and published priority band remain unchanged. Within one study all
candidates use the same bound method/category; the adapter does not combine
points from unrelated scorecards into one axis.

Normalization continues to use the maximum absolute supported quantity across
the source-qualified candidate universe. Native annual masses are still
available in `original_candidate.pollutants`, with nitrogen and phosphorus in
kg/year and sediment in metric_tonnes/year. Published points remain a separate
decision measurement and do not become a water-quality load.

Saved results still use the original `conservation.save_plan` and
`conservation-plans/<plan_id>` record. The existing bindings carry its full
`selection.optimization` reference into implementation, design and decision
context. The same `get_analysis` and complete decision export reopen its
published method, all candidates, constraints, geographic union and source
lineage.

### Source-compatible practice and native experiment join

The practice engine and criterion builder are the complete original files in
ES-EXP-2319's F0C8TUMU328 revision 2. Its decoded source envelope is 669,556 bytes,
SHA256 a82e8ef8beb99520f35170655d80ca0e6a037f8aed52cd57b55fb0dceaea3920.
The compatible conservation core retains those additions and the current
native-grid resolution behavior. General aggregation accepts each retained
original grid resolution. The published mean-cell-mass criterion retains the
practice method's explicit 30-metre applicability; it is independent of the
general aggregation path.

A chosen plan reaches the existing scenario-to-experiment continuation through
`model.conservation_scenarios.create_scenario` and
`prepare_experiment`. The full current experiment engine is F0C8S2V4D0R,
decoded 220,922 bytes, SHA256
41599e382772d60b21f2f09ba9601656dfb6879fc71130d6fa9f1bacd4dd5191.
The adapter keeps the saved selected union, original model domain and reporting
overlap, selected model families, matching baseline and prepared experiment
IDs. The same actual native programme executes the cases.


## Save the reviewed selection

The existing save API also accepts the completed original preview through the operator's `preview_task_id` payload. The operator reopens that retained task, requires the same workspace, completed state and original preview action, and supplies its full analysis to `save(..., retained_analysis=...)`. The model validates the original content identity, exact study selection, candidate and geometry descriptors, current retained file bodies, decision request and selected original IDs. It then persists that exact analysis and saves the selected IDs through the ordinary conservation plan. Saving a reviewed selection does not rerun the optimizer; the authoritative plan still recomputes quantities and geometry across the selected union. A new spec retains the original optimize-and-save behavior.


## Combined criteria and original-case sensitivity

Select **Combined physical and source-context criteria** in the same Conservation optimizer. The typed editor combines original physical, geographic, published-point and numeric source-attribute criteria, preserves their units and support, and compares explicitly retained native alternatives at fixed decision weights. The saved analysis retains per-unit weighted contributions, case-specific quantities and selection/rank changes; the existing portfolio, GeoPackage and full project exports remain the receiving path.

See [Conservation decision methods](../CONSERVATION_DECISION_METHODS.md) for the request contract, exact score and normalization, source/coverage rules, interpretation of case sensitivity, and the complete operate/export/reopen workflow.


## Editable decision geometry and case membership maps

The same **Export complete decision packet** now includes
`optimization/geography/decision-geography.gpkg`. Open its
`decision_units` and `decision_reporting` layers in a GIS. They contain the
complete original candidate inventory, including excluded candidates, in the
original projected metre CRS. The first keeps whole-unit geometry; the second
keeps each original reporting footprint. Empty retained footprints stay null
geometry. No coordinate is inferred, simplified or reprojected.

Use **unit_id** as the join key. GeoPackage's internal feature ID is only a row
identifier. `decision_score`, `decision_rank`, `selected`, `eligible` and
`source_eligible` describe the retained selected analysis. An excluded or
unavailable rank/score remains null; an actual zero remains zero. Exclusion
reasons and original source identity are retained as JSON fields. The original
`geodata.gpkg`, its original study scores/attributes and all saved union
quantities remain unchanged at the packet root.

The stable `preference_*` and `case_*` columns contain the actual count of
compared profiles/cases, selection count, eligibility count and observed rank
range. These columns are null when that comparison was disabled; an unrequested
comparison is not presented as a one-of-one stability result. Counts include
the selected case/profile and refer only to explicitly retained comparisons.
They do not estimate scientific probabilities.

Companion tables use stable columns rather than inventing GIS field names from
user-defined criterion labels:

| File under optimization/geography | Contents |
| --- | --- |
| criteria.csv | Selected criterion IDs, labels, source kinds, units/bases, direction, weights, fixed scales and original run IDs |
| criterion-values.csv | One original unit × declared case × criterion; raw value/unit, support, coverage, normalized value and weighted contribution |
| case-candidates.csv | One original unit × declared case; actual selected, eligible, rank, score and exclusions |
| preference-profiles.csv | Original named profiles, complete weights, selected IDs and actual solver outcome |
| decision-geography.json | Source/analysis/implementation identity, original CRS, fields, full member byte hashes and authoritative saved union summary |
| README.md | GIS opening, exact joins and interpretation |

Filter a case and criterion before joining the long criterion table to a layer.
Source references are JSON Pointers into the same `optimization/analysis.json`.
CSV preserves original IDs as text for GIS joins; import source strings as data,
not spreadsheet formulas. JSON and GeoPackage preserve the complete lossless
identity. Mixed quantities keep separate units; the weighted decision score is
not a pollutant mass or a new union benefit.

The actual generated GeoPackage is reopened with Fiona before its manifest is
published. Both layer inventories, every output property, original CRS and exact
retained vertices are compared to the original source and analysis. File
descriptors are checked again when assembling the existing decision ZIP. A
different helper implementation has a different export selection identity;
previous ZIPs are not overwritten or silently relabeled.

### Categorical native-case geography

When the saved analysis has enabled comparison of at least two distinct retained
native cases, the existing Conservation report gains one additional map.
Light fill shows the reporting-footprint union of units selected in **any**
case; the dark outline shows units selected in **every** case. Its caption
retains the exact case names, original-unit counts and union areas, and the
source binding carries original run mappings and the analysis descriptor.

Membership is evaluated using original unit IDs before geometric union.
The every-case layer therefore is not an invented pixelwise intersection of
overlapping portfolios. If no original unit is selected in every case, that
outline is absent and the caption says so. This uses the original renderer's
two categorical roles, not a quantitative score scale. Existing selected-land,
whole-unit, reporting-footprint and context maps remain intact. Source-context
decisions without native alternatives do not acquire a native-case map.

### Complete producing and receiving path

Use the same selected original workspace, completed preview and saved plan.
Export the complete decision packet; reopen it independently and open both
decision GeoPackage layers. Inspect a selected and excluded original ID, a true
zero where present, and a supported/unsupported criterion. Join one case and
criterion by unit_id and compare the displayed values with the retained
analysis and original candidate source. Preserve the original geographic and
union totals when inspecting overlaps.

Open the actual outgoing report/PDF, all original selected/context maps, and the
native-case membership frame when the selected study genuinely has native
alternatives. Operate the exact desktop and 390-pixel interfaces, download the
actual ZIP, and open its GIS, CSV, JSON and guide attachments. The producing
owner must personally look at the rendered figures and controls. Capture the
actual runtime result and viewed artifacts in the same receiving operation;
source inspection does not replace this consumer workflow.

The ordinary full-application receiver includes all declared source members.
The Conservation installer owns the new helper and requires it when incoming
optimization/map source imports it. The existing scientific-report component
fragment also names the helper and method guide so selected source assemblies
retain this dependency.


## Receive and render an existing completed decision

The maintained application includes source_tools/receive_conservation_priorities.py.
Run it with the existing native Python environment from the application root:

~~~sh
python source_tools/receive_conservation_priorities.py \
  --workspace /ABSOLUTE/EXISTING/WORKSPACE \
  --source-plan ORIGINAL_COMPLETED_PLAN_ID \
  --output /ABSOLUTE/NEW/RECEIVING_DIRECTORY
~~~

The original source-water study can use its actually bound source-water overlap
and reporting area, with equal explicit weights and separate named preferences.
The receiver preserves the original plan's constraints. --max-count declares a
new analyst cap; --include-unprotected adds that criterion only when its original
protected-lands source is bound. For other decisions, --selection names a complete
authored JSON request using the same retained study and its actual alternative IDs.
It cannot be mixed with those convenience overrides.

The course freezes the source selection and installed implementations, previews
once, saves the exact retained preview, independently reopens the original
Workspace, creates the complete decision ZIP with editable geography, prepares
the mapped Scientific Reports source, and runs the existing Scientific Reports
renderer for PDF, HTML and companions. Its scientific-report subdirectory contains
the actual rendered output. result.json names every completed source and output.
Re-running the identical command resumes the retained preview and render; use a
new receiving directory when the source, authored choice or implementation changes.
The course verifies the original plan and candidate study remain intact.

On the actual producing host, operate the original Conservation editor, change
and restore criteria, reopen the saved decision, and inspect the outgoing report,
map, CSV and both GIS layers. Open PDF and HTML at desktop and narrow widths.
The native receipt records file production; visual_review remains pending until
the producing peer has looked at those actual outputs. Preserve that peer's
completed course and full project archive when delivering the new decision.
