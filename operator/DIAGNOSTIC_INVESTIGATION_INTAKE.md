# Saved diagnostic recovery and native programme continuation

Scientific interpretation and Investigations share the original scientific Workspace, operation queue, saved source and native experiment designers. An investigation opened from a scientific report retains that report revision, its evidence and its original source identity throughout reload and continued work.

## Open a reviewed report

Open a saved item in Scientific interpretation and choose **Investigate this analysis**. The registered Scientific interpretation desk uses the existing host bridge:

```js
host.openExtension('investigations', 'openForDiagnostic', {
  workspace_key,
  diagnostic_id,
  title,
  dataset_id: 'es26:' + diagnostic_id + ':report_json',
  report_sha256
});
```

The controller retains the selected workspace, diagnostic ID, source alias and expected report SHA before it submits the single original `intelligence.diagnostic.open` action. The task returns the investigation, evidence and immutable report dataset. The complete saved report and its authenticated original downloads appear together.

If a matching report edition already has an investigation, the same action reopens that association. Its staged request, operation identity, task and received session/evidence IDs remain in the workspace's recovery record. Reload retries the same unacknowledged request or polls its original task. A different pending action remains visible while the diagnostic waits.

## Reopen the captured revision

When the current diagnostic produces a later report, **Open saved investigation** returns to the retained evidence and report. The report request includes its captured digest:

```text
GET /api/intelligence/diagnostic?workspace=...&diagnostic_id=...&report_sha256=...
```

The provider reads the captured revision directly, verifies its manifest and original bytes, and returns fresh authenticated report and revision-manifest download tickets. A task interrupted after capturing its original report resumes that revision before consulting the current report.

An earlier intake may refer to a mutable report alias without an immutable revision dataset. It can reopen the alias when the saved source SHA still agrees. If the report has advanced, the original investigation and evidence remain available with their saved identity. Intakes returned with an immutable dataset always read their captured revision.

The Assistant retains the original diagnostic context through its session/evidence binding. Late responses remain attached to their originating workspace and preserve a later explicit investigation selection.

## Continue through the existing programme designer

Guided actions open the registered Scenario experiments designer through the host's `openNativeProgramme` capability or original `openExtension` bridge. The original save/run task returns to the same investigation and selects its native programme.

Inspect the programme's scientific metrics, units and execution stages; move through its original result pages; use the authenticated downloads; reopen original native-task history; and continue an existing submission when its native state permits. The selected programme and result page survive reload. Workspace changes invalidate stale design submissions.

Catalogue, source inventory, task, evidence and programme reads retain the current coalesced refresh. An independent read failure leaves the other views available. Diagnostic receiving follows that refresh and shares one flight per workspace. Ordinary task-state updates do not resubmit a completed diagnostic intake. Resource captions use the original label, title, name or ID.

Original-source collections retain their existing selected-byte verification, export and portable receiving workflow.

## Install into the current application

Use the current complete application and its existing Python environment. The repository already contains the complete host, controller, diagnostic providers, source dependencies and maintained installer. For a separately received component, materialize its complete file contents and verify their declared UTF-8 lengths and SHA-256 values before installation.

Select the actual existing application, interpreter and received source directory:

```sh
ECO_APPLICATION="/absolute/path/to/current/upstate_forever_2026"
ECO_GIS_PYTHON="/absolute/path/to/existing/python"
ECO_DIAGNOSTIC_SOURCE="/absolute/path/to/received/upstate_forever_2026"

"$ECO_GIS_PYTHON" -B "$ECO_DIAGNOSTIC_SOURCE/operator/install_diagnostic_investigations.py" \
  --application "$ECO_APPLICATION" --source-root "$ECO_DIAGNOSTIC_SOURCE"
```

The installer retains the original native/programme upgrade patches and their source identities. Its explicit compatible preimages accept the preceding diagnostic host; its explicit compatible postimage recognizes the observed newer programme designer and preserves it. Each alternative names a complete reviewed source block. Other source changes require composition against that actual version.

The saved-report update changes the diagnostic host method and its read dispatch. Full controller/provider replacements require the retained preimage hash. Registry composition preserves `intelligence.diagnostic.open`, `navigate` and `openExtension`. The installer retains source backups, checks all preimages before the first write, and restores only its own exact writes if installation fails. Repeating the same install is idempotent.

After adoption, use the existing application startup and original Workspace. Open the saved report, reopen its investigation, return from a saved programme and download the original selected sources. Refresh the same complete-application archive through its maintained SQLite-consistent backup and portable receiving route.

## Focused verification

The composed public client journey exercised one original diagnostic admission, captured report/evidence, completed native programme return, programme page 100, a later current report, reload to the captured revision, and two simultaneous refreshes sharing one catalogue read. All fourteen original-shaped requests completed without read errors in the V8 controller exercise.

The current source replay reproduces the complete diagnostic host exactly, preserves the original native adapter and newer programme designer, verifies every replacement-file hash, and leaves all patch targets unchanged on a second application.
