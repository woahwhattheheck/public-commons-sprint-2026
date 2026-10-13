# Conservation optimization in the original operator

This registration makes the complete conservation-to-C8FF optimizer available
through the existing application and serial task queue. It uses the retained
conservation study and saves the chosen land with the original conservation
plan service. Scientific quantities, support filters, objective normalization,
preference comparisons and numeric optimization remain in the installed
model/conservation_optimization.py and model/portfolios.py.

## Receive the complete component

Receive these files into the current Upper Savannah application:

- operator/conservation_optimization.py
- operator/extensions/conservation-optimization.json
- operator/CONSERVATION_OPTIMIZATION.md

The exact model companion is F0C8J0B8D1R: its complete model bridge and full
methods guide were independently decoded and verified. The model file is
47,743 bytes, SHA256
60d91c12df8abe5db11aeff9c9473ae68e20e8c20322c95c3e03266c3ccba85c.
It calls the maintained C8FF portfolio solver installed in model/portfolios.py
and the current partial-model-aware conservation study/plan service.

The existing ECSA ExtensionRegistry discovers the installed JSON descriptor at
startup. Use the maintained host installer in the complete application, then
start that same operator on its original Workspace. No additional server or
queue is needed. The descriptor is backend-only so C8FF can attach its existing
operator controls without creating a competing browser desk.

The current host registry accepts backend.actions as strings, an explicit
provider factory and bindings, exact GET/POST reads, an optional item kind and
decorate_task. It has no custom action-label field. This registration uses
that contract; the current host displays a known action label or its actual
registered action name.

GET /api/extensions must expose conservation-optimization, these three actions,
the three read routes and conservation-optimized-plans. Import/registration
errors remain visible in the existing extension issues.

## Original task queue

Use the existing authenticated POST /api/actions with workspace, action,
payload and a stable operation_id. Keep the same operation_id for the same
selection after a lost response; retain the returned task ID through the
normal task endpoint and original resume path.

| Action | Payload | Complete result |
| --- | --- | --- |
| conservation.optimization.preview | The model selection below, or {spec: selection}. | Complete original analysis, candidate inventory, selected IDs, signed objectives, support, resource constraints, optimization outcome and named preferences. |
| conservation.optimization.save | The same model selection. | Original plan, retained analysis reference, selected IDs and union-recomputed physical/geographic summary. |
| conservation.optimization.export | {plan_id: original saved plan ID}. | Verified ZIP descriptor for the complete original portfolio and every retained decision-analysis file. |

The preview computes in the task worker. Its complete response is retained in
that original task; it does not create an analysis record. Save computes the
selected decision and retains its full analysis beneath the original study,
then saves the original plan. Persisted results reopen without rerunning the
solver. Export also stays in the worker.

A source-context selection can operate on the existing completed regional
receiving study before a native pollutant case is bound:

~~~json
{
  "study_id": "ACTUAL_COMPLETED_REGIONAL_STUDY_ID",
  "title": "Regional geographic coverage",
  "objective": {"kind": "source-context", "basis": "total"},
  "weights": {"reporting_area_ha": 1},
  "constraints": {"area_basis": "whole_units"},
  "stability": true
}
~~~

Bind the actual study ID from
WORKSPACE/conservation-receiving/regional-receiving.json. Set a count, area or
supplied USD-cost constraint only when it expresses the selected planning
question. Candidate coverage has no arbitrary top-N cap. Source-context
area is a geographic objective; physical modeled quantities keep their
availability state.

For physical objectives use the model's current-export, restoration or
avoided-conversion selection. Returned request.available_axes identifies
outputs supported by the selected baseline or shared baseline/alternative.
Named preferences also require their actual support. The model methods guide
describes the exact weights, filters, native coverage, currency and solver
fields; the operator passes that selection intact.

## Catalog, inspect and reopen

These passive reads support GET query values or POST JSON, through the same
operator authorization and workspace resolution:

| Read | Parameters | Response |
| --- | --- | --- |
| /api/conservation-optimization/catalog | Optional study_id. | Original study/plan summaries, every retained analysis reference, supported axis names and any malformed-reference issues. |
| /api/conservation-optimization/analysis | study_id and analysis_id. | Original verified retained state plus complete analysis and file tickets. |
| /api/conservation-optimization/plan | plan_id. | Original optimized plan, verified analysis reference and original portfolio/analysis file tickets. |

The catalog reads retained metadata. It runs no solver and adds no periodic
state polling. Its supported axis names are not an assertion that any specific
study has those outputs. The queued preview returns the actual available axes
and per-candidate support.

The same optimized plan also opens through the original /api/item route using
kind=conservation-optimized-plans and id=PLAN_ID. Its item identifier is the
original conservation plan ID; the read verifies its analysis relationship.

Completed tasks expose _conservation with study_id/plan_id. The existing
Conservation task controls therefore open the original study and saved
portfolio. _conservation_optimization additionally retains the original
analysis ID, task ID and whether the analysis is saved beneath the study or
retained in the preview task. C8FF can use these fields directly.

## Original downloads and native continuation

Saved-plan task/read downloads include the complete geographic portfolio
products and optimization analysis JSON, all-candidate CSV and HTML report.
Export includes the complete original portfolio packet plus optimization/
analysis.json, candidates.csv, index.html and REFERENCE.json. The original
operator's byte/hash-verified ticket route serves every file. Descriptor paths
must resolve inside the same Workspace.

Open the saved plan in Conservation plans to create a land-cover scenario
from its exact selected union. Prepare the chosen original grid/profile/model
scope and run it through the existing native workflow. Keep the plan's
whole-unit and reporting areas, overlaps, supplied costs and per-pollutant
support alongside the resulting modeled scenario. The solver's own declared
additive objective and resource scope remain visible in the retained analysis.

## Receiving continuation

On the already-running original operator and completed regional study:

1. Read the current extension catalog and the conservation optimization catalog.
2. Enqueue one actual source-context selection and retain its full preview task.
3. Save that same chosen selection through conservation.optimization.save.
4. Reopen the returned plan and analysis by their original IDs.
5. Export through conservation.optimization.export and download the original
   ZIP ticket. Verify its packet members and reopen the saved plan after refresh.
6. Continue the existing Conservation scenario/native journey if a selected
   treatment is being evaluated.

This is one integration journey through the original product, not another
parallel test suite. Preserve its actual task IDs and Workspace so interruption
continues the same decision.


## Published practice scores

When installed with the current scientific conservation-optimization bridge, the catalog also exposes published_axes. A study scored with published_method can use the published-method objective, whose axis is published_points. The queued preview derives the complete practice eligibility, prerequisite, source definition and original criterion coverage from that study. The same original native solver and Conservation plan store supply selection, save, reopen and decision export. The candidate table retains independent physical pollutant quantities and their actual native availability.

The optimizer does not substitute known partial criterion points for a complete practice score. Use request.available_axes and the complete preview's candidate support to drive the existing interface. All previous geographic and native-quantity objective contracts remain available.
