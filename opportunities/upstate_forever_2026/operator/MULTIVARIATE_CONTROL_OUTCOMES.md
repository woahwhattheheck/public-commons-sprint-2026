# Native matched-control outcome desk

TokenJunkieLabs • Original Upper Savannah application • 13 October 2026

## Analyst course

Open **Matched controls → Native control outcomes**. Select completed, adopted designs in the intended display order. Every selected design must share its original baseline, restoration, native grid and parameter profile. Choose nitrogen, phosphorus or sediment outputs actually present in all selected runs, choose the original reporting area or the complete retained model domain, and state the scientific comparison question.

**Review native sources** binds the exact completed run outputs, observed producing model versions, original quantity conversion, domain geometry, adopted designs and original source descriptors. **Prepare outcome comparison** submits `control.outcomes.prepare` to the original persistent task queue. Preparation reads retained native outputs; it does not execute InVEST. A changed binding requires a fresh preview.

The initial result uses **all selected controls on identical cells**. The primary rows are the annual B, R and C masses plus direct B−R, B−C and C−R differences on one common finite mask per pollutant. Positive C−R means less modeled annual stream delivery under restoration. Signed zero and negative outcomes remain visible. Every selected control appears in original selection order.

**Each baseline / restoration / control triple** preserves individual support. Its masks may differ between controls; read those rows as separate native coverage and scenario results. The common all-control roster, individual run valid-cell counts and exact support hashes remain available beside the values.

## Interpretation and original quantities

Annual nitrogen/phosphorus values retain the original kg/year units; sediment retains its native annual mass unit. Values are source-cell exports delivered to modeled streams. Region totals do not give intake load, concentration or observed improvement.

Changed-area tables retain whole-scenario, region and common-native changed hectares as distinct denominators. Each displayed rate retains its own label; a zero denominator stays unavailable. Converted, unchanged and unknown categorical source-cell partitions describe where modeled changes originate. Routing and retention can change output at unchanged source cells.

Placement hashes identify the actual original changed cells. Repeated placements remain marked; they do not create independent replications. Original strata, selected optional covariate definitions, source provenance and residual balance stay attached.

## Persistent work and original Study

Choices are retained under `upstate-multivariate-control-outcome-desk-v1:<workspace>`. The complete immutable request is saved and read back before dispatch. If a response is lost, **Recover same request** reuses the original operation identity. A late response is written to its original project's saved desk even if the analyst has navigated elsewhere.

Export/reopen retains choices and original task receipts. The original Study selector lists **Matched-control native outcomes** under `multivariate-control-outcomes`; its Open action navigates to this original desk and inspects the retained result. Complete Workspace/Study closure follows the original producer's typed lineage, including source reports and full map files.

## Original interfaces

- Registered view and extension: `multivariate-control-outcomes`.
- Factory: `createMultivariateControlOutcomesWorkbench`.
- Public reopening: `openSavedOutcome({workspace_key,outcome_id,isCurrent})`.
- POST reads: `/api/multivariate-control-outcomes/catalog`, `preview`, `inspect`, `progress`.
- Queue action: `control.outcomes.prepare`, payload `{selection,expected_id}`.
- Inspect payload: `{outcome_id}`; progress payload: `{task_id}`.
- Native model ports: `catalog/preview/prepare/inspect/files`; progress callback receives one dictionary.

Result files are verified against original Workspace-relative descriptors before issuing original download tickets. Reports, source figures, CSV tables, full-resolution Float64 differences and support maps use those tickets.

## Existing native receiving

Continue the original `integration/multivariate_control_native_receiving.py` and existing geographic browser runner's accepted matched-control chapter. Native receiving authors actual selections from its completed original project. Exercise populated results, same-mask comparisons, original task recovery, report/map downloads and reopened Study. Open and LOOK at actual relevant desktop/narrow/loading/empty/error states and outgoing attachments under current owner directions. Browser receiving fixes product defects directly; the maintained application and completed native output remain the deliverable.
