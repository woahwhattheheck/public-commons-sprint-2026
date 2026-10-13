# Simulated restoration programme: original native scenario to priced implementation

Consumed owner brief: `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md`, version **2026-10-13.3**.

This is an explicitly authored implementation scenario for the original 30 m headwaters simulation on the retained square source grid. It supplies a concrete, editable work programme and cost basis to the existing Economic and FIELD12 workflows. It does not establish an actual landowner design, grant award, contractor quote, completed field activity or observed environmental response.

## What is delivered

- `source_data/simulated_restoration_programme_20261013/programme.html`: self-contained editable design page, hand/machine comparison, source rates, original-quantity intake, working-page save/reopen and printable layout.
- `programme.json` in the same directory: complete authored choices, expected footprint, source pins and scheduling assumptions.
- `source_tools/apply_simulated_restoration_programme.py`: actual native preview/apply operation, using the maintained footprint compiler, EconomicWorkbench, original economic-candidate adapter and ImplementationStore.
- This guide: source meaning, actual invocation, replay and producing-worker inspection.

The complete SC source catalogue remains at `source_data/sc_conservation_costs_20261013/catalogue.json`. This component reuses its published rows and exact retained source metadata. It does not replace the catalogue or its worksheet.

## The actual priced option

The authored design expects 635 changed 30 m cells: 236 cells from source class81 to41 and399 from82 to41. That is57.15ha, approximately141.2207255acres. These are the declared original square-case design quantities; the native binder independently checks the selected run's actual footprint before creating Economic inputs. The1296ha total square grid is never priced as treated land.

At12×12ft spacing, density is302.5 positions/acre. The design requires42,720 planting positions, allocated equally to14,240 willow oak,14,240 sweetgum and14,240 cherrybark oak. The mix is an editable simulation choice. Actual soil, hydrology, flooding, tree suitability, stock availability, buffer width and professional design remain to be reviewed.

| Scope | Hand option | Machine option | Meaning |
|---|---:|---:|---|
| Planting | $75,201.45 | $86,198.31 | FY2025 historical NRCS391 scenario benchmark |
| Site preparation | $25,419.73 | $25,419.73 | Authored $180/acre simulation allowance |
| Design and layout | $9,179.35 | $9,179.35 | Authored $65/acre simulation allowance |
| Contingency | $16,470.08 | $18,119.61 | Authored15% of preceding initial-capital lines |
| **Initial capital** | **$126,270.61** | **$138,917.00** | USD, separate alternatives |
| **Annual maintenance** | **$4,942.73/year** | **$4,942.73/year** | Authored constant$35/acre/year forecast |

The alternate planting method changes initial capital by$12,646.39 and leaves the modeled physical scenario unchanged. A20-year horizon and3% real discount rate are explicit editable planning assumptions. The maintained Economic engine calculates its own present value and annualized cost; this adapter does not replace that calculation.

Rates are not inflation-adjusted by default. A price factor of1.00 retains the FY2025 nominal benchmark as an explicitly simulated allowance. A different factor is a reviewed assumption, not a claim about observed inflation or a current contractor quote.

Spacing changes use an explicit linear density multiplier144/(Xft×Yft) on the historical planting benchmark. This is authored cost sensitivity; the publisher's original scenario was12×12ft. The native forest-class model does not resolve tree spacing, species, establishment lag or survival, and these controls do not rerun it. A changed treatment footprint requires a revised native scenario and a revised programme.

## Source meaning and double-counting boundaries

### Historical installed-scenario benchmark

USDA NRCS, *South Carolina practice scenarios, Fiscal Year2025*, practice391:
- Scenario1, bare-root hand planting: $532.51/acre, printedpage361.
- Scenario2, bare-root machine planting: $610.38/acre, printedpage362.
- Original: https://www.nrcs.usda.gov/sites/default/files/2024-11/fy25-sc-scenarios_0.pdf
- Catalogue rows `nrcs-sc-fy25-391-1` and `nrcs-sc-fy25-391-2`.

The source describes planting on a prepared riparian site with12×12ft spacing and a minimum35ft buffer. It is a statewide historical planning benchmark; local costs vary, and site-specific implementation requirements are still needed. The native30m class substitution alone does not prove those design conditions or practice eligibility.

The planting benchmark is treated as the complete source planting scenario. SCFC material-only prices, planting equipment rental and another full planting scenario are **not added** to it. Site preparation and design/layout are separately identified authored scopes. No sourced material component is counted twice.

### Current material comparison

SC Forestry Commission's live seedling page lists the selected willow oak, sweetgum and cherrybark oak at$390.41 per1,000, with250 minimum per species. The42,720-position illustration gives a separate stock-only subtotal of$16,678.32.

Original: https://www.scfc.gov/management/seedlings/

The source page does not state a price-effective year. Confirm current quote, stock, order increments, shipping and tax. Its material price excludes preparation, planting labour, shelters, replacement and maintenance. The programme applies the stated minimum order per species; it does not invent an unreported package increment. Any surplus from a minimum is separately shown. This stock check is not added to the all-in historical planting benchmark.

### Assistance comparison

USDA NRCS South Carolina FY2026 payment schedule, practice612, small seedlings without protection, standard category: $0.89/seedling. The authored count multiplies to$38,020.80. This is shown separately as a hypothetical schedule comparison.

Original: https://www.nrcs.usda.gov/sites/default/files/2026-04/SC%20EQIP%20Payment%20Schedule%20-%20FY26.pdf

Catalogue row `nrcs-sc-eqip-fy26-612-061`. No eligibility, allowable quantity, programme agreement, payment timing, funding or FY2027 availability is established. Standard/HU variants are not stacked. No assistance is deducted from capital or used to claim net cost. Matched-control planting outside the riparian corridor does not inherit practice391 applicability: if shown with equal planting costs, it is explicitly a **comparative planting benchmark**.

### Excluded scopes

Land/easement acquisition, opportunity costs, permitting, access works, major channel construction, shelters/fencing, financing/tax/grant administration and a separate laboratory monitoring programme are not priced here. If the actual project needs them, add reviewed costs before treating this as a complete project budget. The scoped scenario option is useful for a controlled simulation comparison; it is not a bid estimate.

## Native source and API contracts

Public functions in the maintained new module:

```python
pricing(programme, catalogue)
prepare(workspace, programme, *, report_id, zone_id, run_id,
        catalogue=None, footprint_id=None, existing_selection=None)
apply(workspace, programme, *, report_id, zone_id, run_id,
      expected_operation_id=None, catalogue=None, footprint_id=None,
      existing_selection=None, actor="")
```

`prepare` returns the complete original binding, operation ID, authored programme, priced basis, retained footprint, original physical outputs, Economic input and actual Economic preview. `apply` saves the original Economic draft/edition and a native implementation plan, then returns its edition, plan/candidate IDs, historical applied revision/digest and verified local files.

The native binder:
1. Resolves the actual completed `scenario-decisions/<report_id>/decision.json` or report through the maintained source adapter, retaining its exact SHA and chosen zone.
2. Selects the exact original alternative run and its baseline/profile/grid.
3. Reads the named retained footprint or runs only the maintained categorical footprint compiler if no footprint ID was supplied. It does **not** run NDR/SDR.
4. Requires30m resolution,635 net-changed cells,57.15ha and exact81→41/236 plus82→41/399 transitions.
5. Requires footprint run/selection to match the current original run and the report's scenario/profile/grid.
6. Copies original annual baseline, alternative, delta, reduction and reduction-percent fields unchanged. The reporting-zone area is not used as implementation area.
7. Applies the cost row only to the chosen run. An optional original selection preserves the other cohort costs, criteria and targets.
8. Builds through the actual EconomicWorkbench and imports its completed edition using `import_economic_selection`.
9. Saves one deterministic native plan with the original Economic source snapshot, one complete modeled-scenario candidate, six linked tasks and budget-only capital/annual lines.

The candidate's intervention area is explicitly `verified_scenario_intervention_footprint`. Original `reporting_area_ha` and the full source snapshot remain intact. Plan budget totals include one annual maintenance allowance; this is not a lifetime operating total. Capital and annual forecasts are also separately retained, and no actual or commitment entries are created.

## Actual original receiving command

Run from the existing complete application. Use the actual retained Workspace and IDs returned by the original native owner; do not replace them with the square specification or an unrelated regional case.

```sh
python -B -m source_tools.apply_simulated_restoration_programme \
  --workspace ORIGINAL_WORKSPACE \
  --report-id ORIGINAL_SCENARIO_REPORT_ID \
  --zone-id ORIGINAL_ZONE_ID \
  --run-id ORIGINAL_RESTORATION_RUN_ID \
  --footprint-id ORIGINAL_RETAINED_FOOTPRINT_ID \
  --programme source_data/simulated_restoration_programme_20261013/programme.json \
  > programme-preview.json
```

Inspect the complete preview and its original footprint/source. Then repeat the same inputs with `--apply --expected-operation-id ACTUAL_PREVIEW_OPERATION_ID`. The original task owner can omit `--footprint-id` to use the maintained categorical compiler once when a footprint record is not yet retained; the operation still validates actual masks/cell transitions before attaching costs.

`--planting-method hand|machine` selects the authored cost alternative. `--scenario-role riparian_restoration|matched_control` makes the intended role explicit. A matched-control run must independently meet its own expected footprint; the chosen label does not waive any source check or confer riparian eligibility.

Use `--selection ORIGINAL_SELECTION.json` when carrying an already reviewed Economic selection. The selected run's old cost is preserved in the preview for review; all other original costs/criteria remain. `selection.json` and `economic-input.json` are saved under the actual operation directory and are ordinary inputs to the existing Economic desk/receiver.

## Retention and replay

The native operation lives under:

`<workspace>/implementation/restoration-programmes/<operation_id>/`.

It retains identity, authored programme, priced basis, original footprint/scenario definition, original physical outputs, original Economic input/selection and implementation seed. Each attempted Economic implementation identity is written before invoking the original build. An already completed exact original edition is reconnected before any newer engine build is considered. No retained source code is dynamically executed.

The implementation seed is retained before import. A crash after the original native revision commit but before the result receipt is repaired through the original `ImplementationStore.import_document` historical source-document replay. Later user edits are preserved: the receipt reports the historical applied revision separately from the latest current revision. Same inputs rejoin the same plan; changing authored source/code/footprint choices creates a new retained operation.

## Use and inspect the exact outgoing product

The HTML works from a local file and embeds its selected source rows. **Planting shares and work schedule** exposes each selected species' relative share, the proposed start date and all six task durations. The displayed work programme is rendered from those saved values, including zero-day milestones; imported JSON and reopened working pages show their actual edited schedule. Changes clear the previous native binding until the revised programme is bound again. Operate method, role, spacing, allowances, horizon/rate, reset, programme download, full-basis download, working-page save/reopen and print. Load the actual native `programme-preview.json` to display unchanged original physical values and enable the exact bound Economic selection download. Any design edit clears that binding until a matching new native preview is loaded.

Before client-ready delivery, the producing native worker must:
- Open and **LOOK at** this exact page at desktop and390px.
- Change hand to machine and verify the displayed original capital difference; verify assistance/material comparisons stay separate.
- Save/reopen the working HTML and programme/basis JSON, retaining edits and original source identities.
- Load the actual native preview and inspect all original physical quantities and footprint binding.
- Download/open the bound Economic selection; operate the existing Economic and FIELD12 tasks using the returned exact IDs.
- Print and open the actual PDF; inspect every outgoing table, source link and attachment, not merely capture screenshots.
- Retain elapsed history, original run/result paths and actual rendered screenshots for the producer's inspection.

No new native model job or equipment request is introduced. Join the already accepted original native source/economic course. Tim and the prime retain scientific interpretation, methods review and client decisions.


## Continue through the existing cost-review comparison course

The successful apply also retains `cost-review.json` and `cost-review-preview.json` in the original operation directory. The former is the actual `upstate.implementation-cost-review-selection/v1` consumer input, generated against the saved native plan/candidate.

It explicitly excludes every seeded budget row as non-actual context. Remaining capital is the opposite planting method's complete authored forecast; annual operating is the same explicitly authored annual allowance. Financial parameters are explicitly copied unchanged, scope remains the same verified whole scenario, and no observed expenditure is invented. The maintained `preview_cost_review` must accept the selection before a completed programme receipt is written.

For the default hand option, the reviewed machine option increases capital by$12,646.39 with unchanged native physical quantities. The return receipt supplies `plan_id`, `candidate_id`, `cost_review_path`, `cost_review_operation_id` and `alternate_capital_minor`.

The original native operator receiver can continue with its existing flags:

```sh
python -B operator/economic_receive.py \
  --operator-url-file ORIGINAL_OPERATOR_READY_JSON \
  --output ORIGINAL_RECEIVING_OUTPUT \
  --workspace-key ORIGINAL_OPERATOR_WORKSPACE_KEY \
  --cost-plan-id ACTUAL_RETURNED_PLAN_ID \
  --cost-candidate-id ACTUAL_RETURNED_CANDIDATE_ID \
  --cost-review ORIGINAL_WORKSPACE/ACTUAL_RETURNED_COST_REVIEW_PATH \
  --compare-editions --comparison-report
```

Use the application's maintained actual receiver entry-point convention if its `operator` directory is imported directly rather than as a Python package (for example `python -B operator/economic_receive.py`). The original-ready URL contains the existing operator authorization; do not publish it. These flags reopen the saved source-bound candidate and actual budget context; the receiver discovers its retained Economic source, so no unrelated new edition is substituted. The existing full course performs the comparison, scientific source/report, Study export and fresh-Workspace reopen. It must still operate and LOOK at the exact outputs before client-ready use.
