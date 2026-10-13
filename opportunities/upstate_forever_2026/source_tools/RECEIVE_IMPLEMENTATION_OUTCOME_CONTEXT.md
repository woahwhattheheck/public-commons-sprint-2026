# Continue a saved outcome into the original scientific report

The maintained receiver reopens an existing Implementation outcome, adds it to the original observed-report selection, runs the current observed and client section consumers, and receives a complete portable copy of the same scientific Workspace.

It uses the original report bank. It does not create a plan, reimport laboratory results, select a new comparison, or create modeled runs. Saved studies remain in their original order, with the outcome appended once. The first original study retains the primary observed-source role. Non-observed draft fields are preserved exactly.

## Existing Eighteenmile case

The completed original WQP receiving operation used:

- Workspace: /workspace/scratch/178ddc647ae4/eco-wqp-field-receiving/eighteenmile-observed-workspace
- Interpreter: /workspace/scratch/178ddc647ae4/eco-native-runtime/bin/python
- Workspace ID: f4f731d7-b74f-4193-9f3c-548acffa8b15
- Plan: eighteenmile-2023-original-lake-samples
- Applied revision: 2
- Original document digest: dc9371d09962f3b76a101ec8e1bd101396862c99447114b2a5fec3d6cceaae52
- Original laboratory result support: 88 records, 82 numeric and 6 censored.
- Prior field delivery selection, relative to that Workspace:
  implementation/observed-context/272f90698513b40931b0daac54bc8b1b6cc7f34efde4253df19c14ee0a3447d7/report/delivery-selection.json
- Original selection: 2,749 bytes, SHA256 5ce920fd722256483fdee84ff84df16f6e5c991507a159e6de500a76c2710ed7.
- First observed collection: fc575c46d48bf9a56a874b7689c368acba61d9604bfa5bf305d0d7e6327692c0.
- First source: field-observed-report-272f90698513b40931b0daac.

These are original applied-field receiving identities. The outcome report ID must come from the completed outcome phase or the maintained list command below.

Run from the current complete cumulative application directory, including its current core client/scientific report modules and Implementation family. A narrow Implementation installer preserves other desk families and is not a replacement for that full application. Keep the existing field Workspace; use a sibling directory for archives and restored copies.

~~~sh
/workspace/scratch/178ddc647ae4/eco-native-runtime/bin/python -B \
  source_tools/receive_implementation_outcome_context.py \
  --workspace /workspace/scratch/178ddc647ae4/eco-wqp-field-receiving/eighteenmile-observed-workspace \
  --plan-id eighteenmile-2023-original-lake-samples \
  --list
~~~

The receiving command discovers the unique saved outcome for revision 2. If there are several completed comparisons, add --outcome-id with the chosen ID returned by --list. An ambiguous or absent outcome leaves the original report bank unchanged and identifies the available choices.

~~~sh
/workspace/scratch/178ddc647ae4/eco-native-runtime/bin/python -B \
  source_tools/receive_implementation_outcome_context.py \
  --workspace /workspace/scratch/178ddc647ae4/eco-wqp-field-receiving/eighteenmile-observed-workspace \
  --plan-id eighteenmile-2023-original-lake-samples \
  --revision 2 \
  --delivery-selection implementation/observed-context/272f90698513b40931b0daac54bc8b1b6cc7f34efde4253df19c14ee0a3447d7/report/delivery-selection.json \
  --output /workspace/scratch/178ddc647ae4/eco-wqp-field-receiving/outcome-context-receiving
~~~

This uses the original saved source selection even though that selection has no modeled cohort. The adapter supports a complete unfinished report draft; it adds only the actual observed-source list and binding. Model-driven map delivery remains a separate operation using a completed native cohort selected by its operator.

## What the command retains

An operation ID binds the original Workspace, saved outcome/plan revision and document digest, source selection path/bytes/hash, adapter handoff operation, and exact receiver/consumer source hashes. A later renderer or adapter edition receives its own retained operation instead of replacing earlier collected sections. Its original records live in implementation/outcome-receiving/OPERATION_ID inside the same Workspace:

| File or directory | Retained content |
| --- | --- |
| identity.json | Original project, plan, outcome and source-selection identity |
| original-delivery-selection.json | Exact original selection as structured JSON |
| preview.json | Saved outcome, original source inventory and proposed source handoff |
| imported.json | Canonical returned handoff, with runtime reuse flags omitted |
| collected/observed-product.json | Actual current observed_context.collect result |
| collected/client-observed-sections.json | Actual core client section consumer output |
| collected/observed-context/ | Every original recipe member copied and hash-checked by the existing collector |
| collected.json | Original section headings, member descriptors and consumer hashes |
| reopened.json | Verified saved outcome and ordered source inventory |

The adapter retains all original outcome members, its complete analysis selection and plan binding, and verified original local attachments. The receiver handles an expanded report inventory, including later original figure members, without a fixed member count.

Outside the Workspace, OUTPUT/OPERATION_ID contains:

| File or directory | Meaning |
| --- | --- |
| identity.json | Same receiving-operation identity |
| complete-workspace.zip | Existing portable.backup archive, including application, original Workspace, model intermediates and deliveries |
| archive.json | Exact archive SHA256, size and original project identity |
| restored/ | Existing portable.restore output, with workspace/ and application/ |
| restore.json | Actual original archive receiving receipt |
| result.json | Completed original/reopened/restored comparison and file locations |

The output directory must be outside the original Workspace so its backup cannot recursively include archives or restored copies.

## Restart behavior

Run the same command again after interruption. The saved outcome and source handoff are reopened and verified, not regenerated. The source adapter owns its existing lock and idempotent import identity; the receiver has its own external operation lock.

A completed archive is reused only when its identity and hash match. If a process stopped between atomic archive publication and receipt persistence, the receiver reads and verifies that original archive and its operation identity. A published restored directory without its receipt is checked against every archived member before adoption. Existing unrelated directories and differing bytes are never overwritten.

The same ordered source binding and original outcome files must still match after restore. Both actual consumers run again against the restored sources; their full section structures and all delivered member hashes must equal the original collected products.

## Reading the result

The completed JSON gives the actual outcome ID, plan revision/digest, ordered source identities, original and final study counts, section headings, full collected-file descriptors, archive identity, restored paths and retained source-selection path.

For the original Eighteenmile field case, the field study remains first and the selected outcome becomes the second study. The receiver does not infer an intervention from the seasonal comparison. Original units, analytical methods, reporting limits, QA labels, time zones and censor intervals remain in the saved outcome and its source recipe.

The current core client consumer is model.client_report._observed_sections. The scientific report already consumes the same observed product sections. The original full observed product and client section output are retained for inspection without manufacturing a modeled report or substituting a different geographic study.

Related maintained workflows:

- model/IMPLEMENTATION_OUTCOMES_METHOD.md — selection, descriptive interval methods and saved outcome CLI.
- model/IMPLEMENTATION_OUTCOME_CONTEXT.md — preview/import and the current operator report handoff.
- source_tools/receive_wqp_field_results.py — original laboratory receiving operation, already completed for this case.
