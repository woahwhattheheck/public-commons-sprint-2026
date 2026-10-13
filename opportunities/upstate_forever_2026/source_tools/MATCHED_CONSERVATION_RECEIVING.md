# Receive matched-family Conservation priorities

Use the existing scientific application, its installed GIS Python and original
completed Workspace. This course projects saved NDR/SDR rasters onto retained
planning geometry; it does not call a native model or generate new model inputs.
The existing --source-plan receiving mode remains available unchanged.

## Scientific selection

Prepare two complete UTF-8 JSON files from the actual scientist-selected records:

1. A normal Conservation specification with mode native_model, original planning
   source/layer/ID field, reporting grid, contexts, rules and score. Keep the
   original baseline_run_id and alternative_run_ids. Add matched_families:
   each row has a unique id, label, baseline_run_id, alternative_run_id, reason
   and optional reference. Each pair must use the same original grid and profile.
   Different family baselines are explicit; a treatment is never compared with
   another profile's baseline.
2. The original optimization request. The receiver supplies the prepared study_id
   when omitted; a supplied different study_id is rejected. Use either a
   matched-restoration/matched-disturbance objective with family_id, basis and
   original pollutant weights, or multi-criteria with at least one matched
   criterion. Matched criteria declare id, label, kind, axis, family_id, basis
   and direction. Other geographic or source-attribute criteria remain available.

Keep any constraint, inclusion/exclusion and solver choices explicit in that
request. Named case comparisons use multi-criteria and
scenario_stability.cases[].family_ids mapping each criterion ID to its selected
family ID. Ordinary preference-weight profiles remain separate. No probability,
calibrated uncertainty or recommended budget is inferred from those comparisons.

Each pollutant retains its own common support across all selected families'
baseline and treatment runs. The source record, exact support mask, covered area,
physical values, units, direction and original run identities travel together.
Nitrogen, phosphorus and sediment masks and units are not combined silently.
A unit lacking a required supported quantity is excluded visibly rather than
given an invented zero. Normalization scales are frozen over the full selected
cohort, so named case ranks and selection stability use the same scale.

A555's completed disturbance project and the b9d5 source-context project are
different scientific Workspaces. Use actual retained planning geometry belonging
to the selected case. An experiment or disturbance Study ID is not a Conservation
Study ID; its original records supply native pairs to the ordinary Conservation
specification.

## One native receiving operation

From the complete application, using its actual installed scientific interpreter:

    "$ECO_PYTHON" -B source_tools/receive_conservation_priorities.py \
      --workspace "$ORIGINAL_WORKSPACE" \
      --matched-study-spec "$AUTHORED_CONSERVATION_SPEC_JSON" \
      --selection "$AUTHORED_PRIORITY_REQUEST_JSON" \
      --output "$NEW_EXTERNAL_RECEIVING_DIRECTORY"

The output directory must be outside the application and source Workspace.
The existing --max-count and --include-unprotected shortcuts belong to
--source-plan mode; put all matched-family choices in the complete request.
The request's title is authoritative for this mode.

The receiver retains full original JSON inputs and their byte identities before
preparation, plus exact selected implementation identities. It admits one
operation under a native file lock, uses conservation.prepare/build and the
existing preview/save/export APIs, and reuses a retained exact preview on retry.
Do not change input or source under an existing output directory. A different
authored selection is a separate receiving edition with its own directory.

Completed outputs include:

- The full original candidate study and per-pollutant support masks.
- The frozen optimization analysis, candidate contributions and named case
  comparisons, saved portfolio and physical union quantities.
- The original decision ZIP, all seven editable GIS/table members, and complete
  Scientific Reports HTML/PDF and original companion files.
- matched-priorities-editable-study.zip, using the maintained selected-Study
  closure for the actual study, plan, decision packet and report source.
- An independent received-matched-study/application and workspace.
- A new process using that received application's own Workspace/Conservation
  modules, checking exact support, analysis, portfolio and report identities,
  then rendering its original scientific report into received-scientific-report.
- Full cold-process stdout/stderr and the actual final receiving result.

The selected archive is checked for the exact receiving implementation and every
retained support mask before restoration. Its published destination is reconciled
through the maintained portable.resume_restore API after a lost reply; it is
never overwritten with another project or archive. Prior completed runs and the
original study sources remain unchanged.

## Original fixed-baseline course

The existing source-context/one-baseline course keeps its original command:

    "$ECO_PYTHON" -B source_tools/receive_conservation_priorities.py \
      --workspace "$ORIGINAL_WORKSPACE" --source-plan "$ORIGINAL_PLAN_ID" \
      --max-count 12 --output "$NEW_EXTERNAL_RECEIVING_DIRECTORY"

The count12 is an explicitly authored comparison choice for the earlier12-unit
worked portfolio, not a general solver default or recommendation. Its queued
complete95-source receiving edition remains separate from this additive source.

## Complete application and producing review

Receive the current matched-family helper, Conservation model, optimizer,
geography, registered UI, scientific report source, this receiver and the
report-edition4 Conservation transfer adapter together through the maintained
complete Conservation installer. Preserve newer unrelated application sources
and the original source/runtime installer contracts.

Operate the installed Conservation desk at desktop and narrow widths. Select
actual named families and criteria, inspect missing support and physical signs,
save and reopen the decision, open every original report/PDF/map/table/GIS/ZIP,
and open the independently received editable project. The producing owner must
look at the actual screenshots and outputs before presenting the delivery.
The receiving record keeps visual_review pending until that original inspection
is completed. No new browser controller or external customer message is created
by this source course.
