# Saved diagnostics in Investigations

Scientific interpretation and Investigations use the same retained scientific Workspace and original Operations queue. The registered Scientific interpretation desk exposes **Investigate this analysis** for a saved complete report.

## Existing registered bridge

The maintained descriptor `operator/extensions/experiment-diagnostics.json` loads `attachDiagnosticsDesk` from `operator/web/retained_desks.mjs`. That bridge discovers installed desks and calls:

```js
host.openExtension('investigations', 'openForDiagnostic', {
  workspace_key,
  diagnostic_id,
  title,
  dataset_id: 'es26:' + diagnostic_id + ':report_json'
});
```

The same bridge preserves its Study transfer and Decision study connections. On supported earlier hosts with a built-in Scientific interpretation controller, the source-composition helper attaches the equivalent callback to that existing controller.

## Saved report intake

Investigations checks the selected Workspace and reads the complete report through the authenticated diagnostic route. The returned report identifies its original dataset, source hash, and existing investigation associations.

The original queue admits `intelligence.diagnostic.open` with `{diagnostic_id}`. Its completed result identifies the saved session, evidence, dataset, and report source. The browser opens that retained evidence and checks the source identity. Matching previous report editions reopen their existing association.

The staged report, original request, operation identity, and received session/evidence IDs remain in the per-Workspace recovery record. Reload retries an unacknowledged original request or polls the existing task. Another pending operation remains visible while the diagnostic waits.

A report opened in another Workspace is rejected. Late responses remain with their originating context; they preserve a later explicit investigation selection. A ready diagnostic is available through **Open saved investigation**.

## Native programme continuation

Investigations opens the existing Scenario experiments designer through the host's `openNativeProgramme` capability. Fully registered experiment hosts use their existing `openExtension` method. The returned original save/run task selects its retained programme in the investigation.

Original experiment result reads are paginated and retain native download tickets. Workspace changes invalidate stale design submissions. Completed programme and report reads recover independently of a failed catalog refresh.

See [INTELLIGENCE.md](INTELLIGENCE.md) for installation, original-file collections, request recovery, and the complete generic receiving command.
