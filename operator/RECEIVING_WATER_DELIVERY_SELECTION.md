# Original delivery: keep a prepared receiving-water plan

This complete receiving_waters.mjs successor extends the existing original
delivery controls. It preserves the current source, designation, preparation,
analysis, view, source inspection, native progress, downloads and other actions.

Original preimage: public commit 4a2cf6c73bf39dd54747650233ba2e1582cdc503,
operator/web/receiving_waters.mjs 54,002 UTF-8 bytes,
SHA-256 4c7e066f177a4dbcfb2d4183837a70d2918d33587fc4de548c26e45df2fc0ac8.
If a newer owner edition is present, replay the included literal edits against
that actual current module, preserving all unrelated additions.

## Exact existing API extension

deliveryFields(initialSelection) still returns markup for the original form.
When initialSelection.receiving_waters.plan_id is present, it now shows:

- A checked Keep prepared plan control, original plan ID/title and quantity scope.
- The complete original prepared-plan settings in a details element.
- A read-only original-plan inspection button. It reads the original authenticated
  plan route and uses the existing detail dialog, keeping the delivery draft open.
- The existing completed-analysis select, with explicit replacement semantics.

deliverySelection(selection, initialSelection={}) keeps its existing first
argument and adds an optional second argument. In the original app call:

    receivingWaters.deliverySelection({
      baseline_run_id: val('baseline'),
      scenario_run_ids: alternatives
    }, row || {})

A chosen completed analysis supersedes the prepared plan and retains the existing
same-baseline/same-alternatives validation. With an empty analysis choice and
checked plan, the function clones the complete original receiving_waters object:
plan_id, quantity_scope, original weights, normalization, pollutants and metadata
stay unchanged. It checks the captured source workspace and original plan ID.
With empty analysis and unchecked plan, it returns {} to detach deliberately.

If the original form preserves unexposed selection fields by spreading ...row,
delete its original receiving_waters field before merging deliverySelection's
result. Otherwise an explicit detach would reintroduce the previous selection.
The current root form's selective source-binding reconstruction does not have
that problem.

The original native receiving_water_delivery.selected_analysis handles plan_id
by calling the actual original receiving-water engine on the selected cohort.
This control supplies no model quantities. Source polygon areas in the read-only
inspection are the actual prepared plan's geometry values and are labeled as
prepared contribution area.

A new dispatch action water-open-prepared-plan calls inspectDeliveryPlan(id).
This does not navigate away from the existing modal or replace its draft. The
original public openPlan/openAnalysis callbacks remain unchanged for navigation
from normal product views.

## Focused behavior check

The complete module parsed and its actual deliveryFields/deliverySelection and
dispatch functions executed in the V8 runtime with a native-shaped record.
The single journey checked: explicit retained plan, complete unchanged settings
including zero weight/cap, completed-analysis replacement, deliberate detach,
workspace mismatch, original authenticated plan route, draft-preserving detail
inspection and unchanged saved input. All eight checks passed.

Root independently owns the original app callback/context integration and
scientific v4 report composition. The root form must allow a nonnegative explicit
cap: actual native combined_priority supports zero caps, including retained
all-zero pollutant outputs. Its model implementation remains responsible for
the current zero-cap/new-positive-output behavior. The exact analysis/native
cohort binding and original model output checks remain in their existing modules.
