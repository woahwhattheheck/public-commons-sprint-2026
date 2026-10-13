# Saved Monitoring comparisons in the scientific report

The original Monitoring report panel can prepare a scientific report source from an exact saved budget comparison. It uses the existing report store, native task queue and ordered delivery form.

## Choose the report source

1. Open **Monitoring design** in the original Workspace.
2. Open the existing report/export section and find **Use this Monitoring work in the scientific report**.
3. Set **Report scope** to **Saved budget comparison**.
4. Choose the exact saved comparison. The panel reads the original comparison and shows its title, number of original plans and selected baseline.
5. Enter the **Report source title** and choose the existing **Scientific delivery**, or keep **New report selection**.
6. Select **Prepare scientific report source**.
7. When the original task completes, select **Open prepared report form** and review the existing delivery's native runs, source selections and ordering before preparing that delivery.

The current saved plan/campaign option remains the default. A comparison selection is explicit and independent of the currently open single plan. Each saved comparison retains its original frontier, ordered plans, baseline, cost and coverage values, solver states, and any selected observed-context source editions.

Working titles are retained for each exact plan, campaign revision or comparison. Changing scope and returning to the earlier selection restores its title draft. Scientific delivery selection remains unchanged. Unrelated task refreshes do not overwrite these choices.

## Resume and reopen

The panel keeps its existing durable request ledger. Before a request is submitted, its exact comparison ID, title, optional delivery ID and operation identity are retained. Retrying a lost response reenters that original operation. An accepted task remains available through **Open saved operation**.

Completed comparison report sources appear in **Saved monitoring report sources**, labeled **budget comparison**. Choose a retained source and select **Open saved report source**, then reopen its prepared report form. Downloads use the original source tickets.

The saved source can be added to an existing ordered scientific delivery. It can also travel with the full editable Workspace, which retains the original comparison and all of its source records.

## Scope and source meaning

The report uses an existing native comparison and its original planned budgets. It does not run another frontier. Selected catchments remain field search areas; candidate station counts and historical observations do not assign future visits to field stations. Any observed context retains its original station mapping, period, flow scope and recorded campaign revision.

The native provider accepts exactly one of `comparison_id`, `plan_id` or `campaign_id`. Comparison preparation uses the same `monitoring.report.prepare` action, catalog, saved report record and `delivery_selection` returned by the current programme workflow. The frontend reads comparison choices through the existing `/api/monitoring` comparison library.

The comparison browser course and whole regional progression can first prepare the saved comparison (PR3561/PR3585). This report panel then carries that exact retained selection into the ordinary scientific delivery workflow.
