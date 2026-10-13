# Scientific reports from saved implementation sources

The existing **Implementation & fieldwork** desk can open the maintained scientific-report publisher directly from a registered field, laboratory request/results or sample QC source. The original report document and selected source edition remain unchanged.

## Choose a saved source

- **Field records:** register the exact saved revision in Observed water quality, then choose **Prepare standalone scientific report** beside its registered field edition.
- **Laboratory requests:** select the retained request, review its current saved results, and register its scientific report source. Choose **Prepare standalone scientific report** beside that retained report-source receipt. A request with no returned results remains reportable.
- **Sample quality control:** save the explicit QC review and use **Register with scientific reports**. Choose **Prepare standalone scientific report** after the original registration completes. In **Review decisions and follow-up**, the retained follow-through report has the same registration and standalone-report controls; it opens that exact saved decision and task report, while retaining the current review draft.

These controls use the actual registered source collection and source ID. They do not create another observation edition, repeat the laboratory import, or run an environmental model. The existing **Prepare client report** controls retain the full model/geography delivery-selection workflow.

## Review the report in the original publisher

The maintained SourceReports desk refreshes its typed original-source choices and adds each selected source once, after any sources already in the current draft. Its opener preserves the existing nonempty title and contact fields. Review the original ordered sources and prepare a fresh preview before building the report through its original retained task queue. If a previous report request is still sending or has an uncertain response, use **Recover original report request** before changing its selection. The publisher retains the exact action, payload and operation ID in browser session storage, including across a reload. Once the native task ID is known, **Open retained report task** reopens that task. Source handoffs and draft controls preserve the pending request until it is recovered. If browser storage is unavailable, the desk displays that limitation and keeps the original request in the current view.

Fieldwork drafts remain saved in the workbench. The QC dialog preserves its own review state before handing off to the report desk. If the original workspace changes during a delayed module load, the handoff is cancelled.

The resulting publisher retains its existing PDF, HTML, Markdown, figures, original source companions, report metadata and complete archive/independent receiving flow. Use the publisher's original download and reopening controls.

## Native integration contract

The shared application capability is:

```javascript
host.openScientificReport({
  workspace_key,
  sources: [{source_collection_id, source_id}],
  title // optional; the maintained opener preserves a nonempty current title
});
```

The implementation descriptor declares `openScientificReport`. The maintained ES26 application host and SourceReports `openForSources` integration must be installed with this native release; an older host cannot supply the capability. The implementation installer includes `operator/web/implementation_source_reports.mjs`. The controller, laboratory helper and QC helper load that small adapter only for the native handoff. The standalone workbench preserves offline field capture and evidence transfer; it does not invent a native report service.

The adapter validates the original workspace, retains exact source order, removes only duplicate collection/source pairs and delegates to the existing publisher. It never reconstructs a report recipe from visible table values. Each source wrapper already retains the original scientific records and any previously composed report context.
