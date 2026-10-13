# Programme successors from retained source refreshes

The backend creates an explicit successor of an existing ComputeProgramme from one saved source-refresh plan. The original Programme, report and native selections remain available. Both edition-wide and root-selective plans use the maintained source_refresh facade.

## Operator contract

- catalog(workspace, programme_id) returns the selected Programme, relevant saved plans and its retained successors.
- preview(workspace, programme_id, refresh_plan_id, title=None) returns ready, issues, warnings, original and target source/run IDs, the proposed selection and the maintained Programme preview. Its id binds the reviewed mappings, selection and installed native-engine sources.
- create(workspace, programme_id, refresh_plan_id, expected_preview_id=..., title=None) rechecks that identity under the original refresh lock and a dedicated source-update capture lock, then creates the successor through ComputeProgrammes.create.
- verify_workspace(workspace, verified_members=None) checks retained source-update links after the original portable archive byte checks.

Creating a successor prepares selections; execution remains in the maintained Programme controls. The provider must pass the exact preview id and title used for the displayed preview.

## Native mapping semantics

Every published mapping used by this component is checked against its original immutable refresh plan and native selection. A mutable progress mapping cannot substitute another profile, scenario, grid or model selection.

A mapped run uses its exact retained target native_run_id. A root-selective plan may also replace only a shared profile, scenario or grid. When an original Programme run lies outside that plan's run nodes, the component passes the exact mapped dependencies to ComputeProgrammes.preview. That maintained implementation determines the successor run identity. Its mapping_origin is programme-preparation; target_existing and prepared_on_create distinguish a saved target from one prepared on creation. A run explicitly selected by the refresh plan must have its original published run mapping first.

Unchanged rows preserve their original native IDs. An unchanged completed-source-stage assembly preserves source_runs. A changed selection removes obsolete source-stage donors and follows the maintained Programme's ordinary preparation/execution path. All rows preserve named keys, order, titles, selected models and the named comparison baseline. A successor requires one common grid; mixed target grids are shown as an actionable preview issue.

The backend keeps original refresh interpretation for requires_native_rerun. Native completion is read from the actual target run. A source metadata change can require a new identity while still allowing the existing model engine to reuse equivalent stages.

## Retained links and retries

The Workspace's immutable programme-source-updates family records source and successor Programme IDs, the original refresh plan ID, reviewed preview identity, selected mappings and exact source/run lineage. It uses the successor's retained creation timestamp, so repeated creation returns the same link rather than generating a timestamp-dependent duplicate.

Preview identity excludes transient native states, progress timestamps and whether a deterministic run has just been prepared. A refresh mapping change, different title, selection change or installed engine change requires a new preview. After creating a successor, old Programme reports and progress are unchanged.

Portable inventory already captures this family. Backup must acquire the root .programme-source-updates.lock in its existing ExitStack before inventory, matching the complete creation-and-link transaction. Integration should add a read-only verify_workspace call before final portable restore publication when programme-source-updates/*.json exists. It takes no locks and writes nothing. The saved mappings remain verifiable if the original refresh later completes more rows.

## Source compatibility

Reviewed maintained sources: compute_programme.py Git blob 188ef3177830bd71a4ca061f36f2dba34cc4b0c9; source_refresh.py aa19734dbea8ee14c447080dca5614473a8599fa; source_refresh_compat.py 1ad69ed41ce16a13feb815cdf3445266e340b4a6; source_refresh_legacy.py c8ae58f54e80eb10d1a0d1cafee74ffccf5ed04d; Workspace 91b09d81c9e7a37434b28a9fe61f90d734159b8d.

The producing application owner must open and operate the exact composed product before a customer-ready claim, following the repository's owner-directed rendered-product inspection instruction. Keep the controls plain, readable and industrial; inspect populated and empty previews, pending mappings, stale-preview recovery, successor navigation and portable reopen.
