# Implementation plans, original files and portable receiving

The Implementation & fieldwork desk retains complete native plan revisions, the original source register and saved report editions. Transfer and restore carries these files with the ordinary scientific Workspace archive. The received desk opens the original selected revision and its report downloads.

## Save a complete edition

1. Open the existing Workspace and its Implementation & fieldwork desk.
2. Select a saved plan, or open the supplied complete plan JSON and save its first native revision.
3. Attach original documents through the existing attachment action. The saved source register records their original byte length and SHA-256; the bytes live beside the native plan.
4. Save changes before choosing **Handover → Native report package**. The complete report includes the original plan, summary, printable HTML and task, cost, site, monitoring, visit, activity and observation CSV tables.
5. Reopen the plan. **Retained original files** and **Saved native report editions** show new download tickets for the actual original files. Reports retain their selected native revision and observation date.

The report producer first creates its existing complete package. The native adapter then copies its exact original manifest and members into the plan's report bank. Its edition ID is the original manifest SHA-256. An interrupted copy can be retried from the same complete report; a complete existing edition is reused after its identities match. Previous external task outputs remain available at their original locations.

## Transfer and reopen

Use the existing **Transfer and restore** desk to capture the complete Workspace and receive it in a new directory. Backup holds the plan-bank lock before enumerating per-plan locks, then keeps those locks until inventory and archive publication finish. New plan creation publishes its directory under that bank lock; native writes and attachment/report publication use the existing plan lock.

The original archive member inventory retains every revision, original attached file, conflict document and complete native report edition. Restore reuses the native revision-chain and plan-schema readers. It verifies frozen source identities across the entire history and compares attachments/report members against the already verified archive identities. No original plan, source reference, scientific record or report date is rewritten.

The receiving result includes an `implementation` summary. The existing transfer desk can select a received Workspace and open an original plan revision through:

```javascript
host.openDesk("implementation", "openSavedPlan", {
  workspace_key: receivedWorkspaceKey,
  plan_id: retainedPlan.id,
  revision: retainedPlan.revision
});
```

The original browser draft is retained before the selected native revision opens. Historical revisions remain read as their original editions. Normal optimistic revision checks continue to govern a later save.

## Original files that arrived as references

A JSON-only plan import may refer to a local file that was never attached to this Workspace. Receiving preserves that original reference and reports it in `unavailable_attachments`; it does not invent an attachment body. Native `attach_file` events require their original managed file bytes. Attach the actual file through the normal original-source workflow when it becomes available.

An unchanged native report can be reopened after receiving through **Saved native report editions**, even when the old host's task store is absent. Its selected plan and attached originals travel inside the Workspace.

## Original Greenwood course

The repository includes `source/implementation/20261013/greenwood-review-plan.json`. It contains the actual original Greenwood parcel/source case, its complete eight-category published assessment and seven source-review tasks. It has no invented field observations, costs or task durations. Import that JSON into the existing receiving Workspace, save its first native revision, create the native report package, and carry that same Workspace through ordinary transfer and reopening.

The native plan commands remain the maintained `python -B -m model.implementation_cli --workspace ACTUAL_WORKSPACE ...` interface. Use the existing import/show/report subcommands with the actual retained paths. A standalone report created at an explicitly chosen external path can be retained with `ImplementationStore(ACTUAL_WORKSPACE).retain_report(ACTUAL_REPORT_DIRECTORY)`; its exact selected revision must already exist in that store.

## Native receiving contract

`model.portable_implementation.verify_implementation(workspace_root, members=None)` returns `upstate.implementation-receiving/v1` with plan/revision/report counts and per-plan original revision, document digest, record counts, attachment availability and retained reports. When `members` is supplied, it is the already verified original archive map keyed by `workspace/<relative path>`.

Older archives without an Implementation summary remain readable. Prepared plan directories without a committed revision remain preserved in the ordinary archive without being presented as saved plans. Optional source-acquisition indexes and other application components keep their existing archive behavior.
