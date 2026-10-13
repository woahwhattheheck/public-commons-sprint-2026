# Retain and receive an original joint parameter study

This extension keeps the frozen sampled design with the original native experiment, generated profiles, source inputs and retained analysis editions. It uses the existing selected-study exporter and full scientific-workspace archive. It never samples or runs a model during capture or receiving.

## Select the original study

Use the original study catalogue with kind `joint-parameter-studies`. Select its complete retained identifier as an ordinary study root:

```json
{
  "title": "Original joint parameter study",
  "roots": [{"kind": "joint-parameter-studies", "id": "<retained-study-id>"}],
  "include_related_results": true
}
```

Pass this selection through the existing study preview and export controls. Keep the actual preview token when accepting the selection. The selected closure includes the original completed baseline, grid, reference profile, baseline and alternative land-cover scenarios, explicitly adopted source runs, all already-prepared sampled profiles and the original experiment when one exists. Selecting that experiment or one of its sampled profiles also follows the typed back-reference to the complete frozen design. Existing immutable profile and experiment identity checks remain in place.

The definition records all sampled unit-cube coordinates, transformed values, source bounds, seeds, SciPy edition and ordered axes. The exporter copies those bytes. A restored workspace can inspect an older saved design without requiring the receiving SciPy version to redraw it.

## Interrupted preparation remains resumable

A newly published directory can precede its definition. An empty directory contributes no archive members. A definition can precede its first state publication; receiving preserves that definition without inventing a state. A partial state must retain the exact original sample prefix and its complete immutable native profiles.

An experiment marker can be published before the joint state records the experiment identifier. The receiver validates the complete original experiment selection against the full prepared sample map, keeps that marker and leaves the older state unchanged. The original preparation programme completes its own pending publication on continuation.

No receiving verifier advances preparation, changes timestamps, generates a profile or starts an experiment. Each study owner lock is acquired before experiment locks during full capture and selected export, including directories whose lock file has not yet been created. Existing workspace, bridge, native-family and application capture controls remain.

## Captured bytes and subsequent continuation

Full-workspace archives record the exact joint-study files, sample map, experiment marker and capture state. Receiving verifies every member against the archive inventory and compares the complete joint capture record when the archive declares one. Older ordinary archives without joint studies or experiment markers remain readable. An earlier experiment-only archive that copied a joint marker but omitted its referenced definition is incomplete; restore the missing original joint source before claiming a complete scientific receive. This verifier does not invent that source or waive its identity checks.

A selected-study receipt also preserves its historical captured state. After restoring that study, the scientist can complete preparation or publish a following analysis. Historical selected receipts continue to validate the same frozen definition, their exact already-published sample-map prefix, the same prepared experiment when originally present, and every captured immutable analysis body. Only the original `state.json` and `analysis-current.json` publications may advance. The historical receipt is neither rewritten nor relabelled as a current state.

Selected receipts from before this extension do not acquire a new joint dependency retrospectively. New selections capture the complete joint lineage. Restoring a workspace containing joint studies invokes the original selected-study verifier explicitly for receipts declaring joint studies; constructing a Workspace alone is not claimed to perform that verification.

## Source and operating verification

The complete implementation consists of `model/joint_parameter_study_transfer.py` and additive joins in the current `model/study_transfer.py` and `model/portable.py`. The existing climate-forcing, geographic, ensemble, parameter, report, customer-review and delivery-preparation behavior is retained. The operator extension calls `verify_workspace` when opening a received original workspace.

Use the full current application, including the sampler, analysis, operator, browser, report and receiving companions documented in `JOINT_PARAMETER_STUDIES.md`. A historical saved workspace is an input to that application; its older bundled application does not replace the complete current source.

The source has undergone complete peer review only when a corresponding review receipt exists. Executor admission failures provide no Python, native, scientific or visual result. Actual acceptance requires selecting an original baseline and scientifically sourced ranges, completing the original native experiment, exporting and independently restoring the study, comparing all retained design/state/report downloads, and opening the complete desktop and narrow-screen journeys and their attachments.
