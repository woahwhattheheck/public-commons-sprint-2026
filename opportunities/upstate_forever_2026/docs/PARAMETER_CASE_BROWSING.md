# Saved parameter-study case browsing

Open **Parameter studies → Open study**. The original saved study now opens its case page and current whole-study progress without repeatedly loading every native stage registry.

## Cases and recovery

Use **Case state** to select all, unfinished, failed, interrupted or completed cases. **Find a case** searches the retained case ID, label, native run ID, parameter profile ID and original parameter changes. Search applies to the complete saved study. Previous, Next and Go to case navigate the matching cases in their original order; the displayed study total remains the complete original inventory.

**Native case console** opens the selected run's actual worker or CLI attempts, retained logs and exit receipts. Its saved-study binding is checked against the original specification and exact case selection. Opening a case does not inspect unrelated native stage registries.

Study activity and native-run activity are separate observations. A recorded running case whose original run lock is free is displayed as interrupted. A saved study marked complete becomes visibly partial if a native case is no longer complete. Completed cases and actual version labels remain the original native observations. Run all cases / Resume remaining cases retain the original study ID and existing execution queue; filter or page choices do not change the scientific run selection.

A page is a read of ongoing original records, not a simultaneous snapshot of all child processes. The whole-study counts observe every original run record and lock on each request. The native console retains the detailed selected process and source histories.

## Original result editions and complete selections

Result rows and ranges continue through the original source-bound result index. Original JSON, CSV, raster and report downloads keep the full scientific outputs. Download tickets follow the displayed result artifact SHA even when a newer completed summary appears while the study is open.

Use as new draft retains the complete original study selection, including all explicit parameter axes and reporting-area choices. Use completed cases in calibration continues through the original complete candidate API. Neither operation derives a scientific cohort from a visible page.

## Native read API

The additive model reader is `model.parameter_views.DEFAULT_VIEWS`.

`read(workspace, study_id, offset=0, limit=50, case_filter="all", query="", run_id=None)` returns the original study metadata plus:

- `cases`: the selected original page, retaining overrides, profiles, original native selections and completed model versions;
- `case_count` and `progress`: counts for the full study;
- `page`: effective offset/limit, filtered total, original study total, state filter and search;
- `active` and `native_active`: current original study and run lock observations;
- `recorded_state`: the saved coordinator state, separate from the visible interrupted/partial state;
- `cases_complete`: whether this response contains the entire original case inventory.

A zero limit reads metadata/counts without returning cases. Positive page sizes are at most500; this limits the response size, not the study design. A supplied original run ID returns its exact saved case bindings. Full scientific inspection remains `model.parameter_studies.inspect`, and the original operator `/api/item?kind=parameter-studies` continues returning that complete inspection.

The operator's additive `GET /api/parameter-studies/view` accepts id, offset, limit, case_filter, query and run_id. It attaches the existing native download tickets. The shared execution console endpoint retains its original options and response contracts.

## Read throughput and source identity

The reader uses the existing bounded `ProjectedFileCache`:32MiB of isolated saved specification/checkpoint projections and16MiB of native projections. These are process-local byte budgets, not limits on scientific studies or cases. Oversized or evicted records are read normally.

Each native cache miss applies the same original run-selection digest and completed-stage validation as Workspace.inspect_run before keeping only selection, state, errors and native version metadata. Exact original frozen selections, legacy requested versions and the baseline identity are checked against each saved case on every read. Replacing an original JSON record invalidates its projection by file identity. Live locks are observed afresh and are never inferred from a cached timestamp.

The reader writes no source, run or study records and starts no calculation. Scientific execution, comparison math, calibration, complete result exports and original portable source inventories remain in their maintained producers.
