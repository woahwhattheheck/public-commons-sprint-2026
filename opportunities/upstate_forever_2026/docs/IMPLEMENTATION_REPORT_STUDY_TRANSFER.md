# Editable fieldwork behind a saved scientific report

A saved scientific report can contain an original **whole Implementation plan report**, a retained **Outcomes comparison**, or an original **field/laboratory observation context**. The source already carries the exact native plan JSON, dated report, summary, CSV tables and available original attachments. The selected Study transfer now also carries the matching editable plan when that source was produced by the same scientific Workspace.

## The existing operator course

1. In **Implementation & fieldwork**, reopen the actual saved plan and retain its **Native report package**.
2. Review and register that exact whole-plan report, then open it in the existing ordered **Scientific Reports** composer.
3. Save the scientific report edition. In its existing Study transfer control, preview and export that saved edition.
4. Receive the original Study archive through the maintained transfer service. Reopen its scientific report and the original native Implementation plan. Its saved revision history, retained report editions, original attached files and complete deployment packets remain available.

The scientific report continues to identify the exact historical plan revision that produced it. Later native edits are retained as later revisions; they do not rewrite the saved scientific edition. A report imported from another project carries its complete original source files and project identity. It does not adopt unrelated local plan IDs.

## Native source join

The complete additive module is `model/implementation_report_transfer.py`. The shared dispatcher remains `model/scientific_report_study_transfer.py`.

Inside its existing `_source(closure, choice, expected_source)`, after raw source validation and the other producer-specific resolvers:

```python
if getattr(closure, "implementation_lineage_enabled", True):
    from . import implementation_report_transfer
    implementation_report_transfer.include_source(closure, collection_id, entry)
```

The helper recognizes the explicit whole-plan `metadata.report_context_kind == "implementation-plan-report"`, the Outcomes `metadata.implementation_outcome` identity, and the original `field-observed-report-*` recipe identity. It validates each original producer schema, source ID and URI; unrelated source documents keep their existing dispatcher behavior. It validates the original CAS recipe, complete inputs, native report manifest SHA, historical plan digest, report date and attached-original inventory. It does not call source-view, rendering or source-import helpers.

During the existing repeated discovery/owner-lock pass, call:

```python
implementation_report_transfer.capture_locks(stack, closure, locked)
```

This uses the original native Implementation file-lock implementation. It first acquires the discovered original field/laboratory `operation.lock` paths with the maintained native `held` helper. It then acquires `implementation/.plans.lock` before sorted `implementation/plans/<id>/.lock` paths and skips locks already held. This preserves the laboratory writer’s operation-before-plan order. The Workspace lock remains the outer owner in the existing capture. The first closure discovers the native plans; the repeated closure under their locks validates their current retained contents. It does not wait for the plan lock while holding another writer's source lock.

For explicit original-plan receiving information, retain:

```python
originals = implementation_report_transfer.receipt(closure)
if originals:
    identity["implementation_report_sources"] = originals
```

and after the existing received Workspace closure is rebuilt:

```python
implementation_report_transfer.verify_receipt(
    closure, identity.get("implementation_report_sources", []))
```

The maintained `_Closure` accepts `implementation_lineage=True` for new previews and captures. When reopening a retained receipt, set `implementation_lineage="implementation_report_sources" in identity`. Archives captured before this field existed keep their original dependency requirements; new original Implementation sources carry the complete explicit family. The preview and verified receiving result expose `implementation_report_sources` so the existing receiving desk can open its original plan revisions and report files.

The source, selected historical revision and report identity must remain exact. Later legitimate native edits or added deployment packets may coexist; original retained deployment IDs must remain present.

## What travels

For each same-project source, the resolver keeps:

- The complete original `implementation/report-context/<source-key>` tree, including original source manifest, receipt and all ordered-selection handoffs.
- The complete `implementation/plans/<plan-id>` tree: immutable native revisions, managed originals, original reports, exported snapshots and matching deployment packets.
- Every accessible local original referenced by those saved revisions with a complete original byte descriptor. A never-attached unavailable reference stays explicitly unavailable.
- Original Monitoring campaign revisions and editable campaign history when their exact native records are available. The snapshot is checked against those records. A contained historical snapshot without local native records remains a recorded dependency; no campaign is fabricated.
- Complete original field import operations, their exact native observation editions and source collections, and their original ordered scientific context.
- Laboratory import operations explicitly named by saved plan history: original mapping/source identity, row-decision audit, preview and applied-revision receipt. Imported historical records without a local native operation keep their contained original audit and plan identity.
- Every original CAS source body and companion already selected by the maintained scientific-report resolver.

The original native revision chain and frozen source fields are checked before capture. Native report validation uses the maintained `portable_implementation.report_edition`. An original `attach_file` event requires its original managed bytes. Other JSON-only local references do not become invented attachments.

If a plan has saved crew/day packets in `deployments/<id>`, the resolver invokes the installed `model.field_deployment.inspect(workspace, plan_id, id)` and preserves the complete packet tree. An interrupted packet with its original immutable intent is retained for ordinary native continuation; it is not presented as a completed packet. It does not schedule visits, create calendar times or execute a model during receiving.

## Source and installation

The module is included in the maintained fieldwork/scientific component fragment together with its actual Implementation read dependencies. The shared dispatcher and lock/receipt joins are composed by the selected Study transfer owner; this module is not a second transfer engine or archive format.

For an original native receiving course, use the existing completed WQP or Monitoring plan and its actual retained report ID. Continue through the original queued scientific renderer and selected-study receiver. Keep that course's actual project, revision, source and output directory, including a genuine new receiving identity when original-data replay created one.

## Existing native receiving result

The maintained WQP receiving course has already completed a whole-Workspace capture and fresh restored-application reopen with 88 original observations and activities, 48 visits, three sites, two saved revisions, the original attachments and complete field/scientific reports. Its replay produced a genuine new project beginning `dc92b8b9`; it remains distinct from the earlier project beginning `f4f731d7`. Continue this course using its actual retained source/report IDs and exact saved revision. The same native run found and repaired `ImplementationStore(Path)` path normalization; use current main with the original PathLike fix before verifying the native plan bank. The selected-study course adds the source-linked native history described above to the same existing receiving operation.
