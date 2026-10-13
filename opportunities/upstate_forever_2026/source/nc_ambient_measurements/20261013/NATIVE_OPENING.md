# NC ambient measurements — native report opening and complete receiving

This course opens the retained North Carolina ambient-measurement source family in an existing scientific Workspace. It uses the ordinary Sources catalogue, Scientific report editions and selected Study transfer. The same saved report can be opened in the installed operator and received as an editable application plus Workspace.

The source report entry is `nc-ambient-measurements-observed-report`; its root manifest is `nc_ambient_measurements.sources.json`. The original Horsepasture and Big Creek source responses, activity descriptions, result qualifiers and reporting limits remain declared members of that source family. Actual source periods, units, sample counts and qualified subsets come from the retained report and its complete CSVs. The earlier 730-observation microbial source keeps its own collection and saved study.

## Operate the existing Workspace

Use the actual accepting host's installed application and original Workspace. Keep its project and any already admitted source opening. Do not restore over an advancing project or start another operator against its state directory.

From the application root:

```sh
"$PYTHON" -B source/nc_ambient_measurements/20261013/open_saved_report.py \
  --workspace "$WORKSPACE" \
  --output "$OPERATION/nc-ambient"
```

`PYTHON`, `WORKSPACE` and `OPERATION` are the accepting host's real interpreter, original Workspace and owned external output directory. The helper resolves its complete source manifest from its installed application. It has no source download step and starts no InVEST run.

To bind the known project explicitly, append `--expected-project-id` followed by its original project ID. To open another retained version of this same family, supply its complete `--manifest` path. An explicit alternative entry can be named with `--source-id`; it must be a document in the Scientific report catalogue and must pass the original observed-report source binding.

Progress is emitted as JSON lines on stderr; the completed opening record is emitted on stdout and saved as `opening.json`. The source ID, imported collection, original preview, saved report edition, selected-study archive and exact received application paths are in that record. Keep a full traceback or original stderr if the current application needs a dependency correction.

### Produce the first report before the archive phase

When the active host needs the populated report first:

```sh
"$PYTHON" -B source/nc_ambient_measurements/20261013/open_saved_report.py \
  --workspace "$WORKSPACE" \
  --output "$OPERATION/nc-ambient" \
  --render-only
```

This performs the real source import, original preview, native PDF/HTML/Markdown/data rendering and complete report-file copy. Repeat the same command without `--render-only` to finish selected-study export and independent receiving. The same original preview and report edition are reused.

Use the same output directory and original arguments after an interrupted process. The helper locks that operation, verifies retained artifacts and resumes its native report/archive/receiving records. The original source family, title, preceding report selections and project are immutable within that directory. Use a new operation directory for an intentional new source edition or changed report selection. A source-code change after an unfinished preview is returned as the native renderer's actual identity error; a completed original edition reopens through the engine's retained-operation recovery.

## Open the saved result in the operator

1. Open the original Workspace.
2. Go to **Sources → Scientific report → Saved reports**.
3. Select the exact `scientific_report_edition_id` returned in `opening.json`.
4. Open the populated HTML/PDF and original source downloads. The report's original selection and companion files remain attached to the saved edition.
5. Use the ordinary Study export/receiving controls when handing off that saved report from the application. The command-line course has also produced an independently reopened selected-study archive for the same edition.

No extra report viewer or second source catalogue is installed by this helper. Its component fragment adds only this opening course, guide and source manifest to the maintained `scientific-report-editions` component.

## Compose an explicitly ordered report

The NC ambient report can follow existing saved scientific sources, such as the retained NC designation/assessment report. Choose their actual original collection IDs and source IDs; do not infer a designation or assessment result from a station's latest measurement.

Write `preceding-sources.json` as an ordered array:

```json
[
  {
    "source_collection_id": "ACTUAL_RETAINED_COLLECTION_ID",
    "source_id": "ACTUAL_RETAINED_REPORT_SOURCE_ID"
  }
]
```

Run the same helper in a new operation directory with:

```sh
  --preceding-sources "$SELECTION/preceding-sources.json" \
  --title "North Carolina waters: designations, assessment and measured context"
```

The helper appends the NC ambient source after those explicit selections. The existing native binder validates every source, preserves order and retains all original source members in the saved report and selected Study. Duplicate selections are rejected. In the interactive operator, the existing ordered-source report composer provides the same choice.

## Complete output

| Output | Use |
| --- | --- |
| `request.json` | Original project, manifest SHA, source entry, title and preceding source choices. |
| `report-preview.json` | Complete original native preview and rendering-source identity. |
| `opening.json` | Current phase, original saved IDs, report paths, archive and independent receiving result. |
| `report/` | Every native report output, original linked source, retained rendering source, selection, operation and edition file at its original relative name. |
| `report-files.json` | Native roles and complete member byte/SHA inventory. |
| `nc-ambient-selected-study.zip` | Original saved scientific edition and its complete dependency closure in the maintained portable application/Workspace format. |
| `received/application/` | Independently received original application. |
| `received/workspace/` | Independently received selected scientific Workspace. |
| `cold-opening.json` | Fresh-interpreter opening result, exact saved edition/operation identities, source counts and verified selected-study receipts. |

Files are streamed and verified against their original native descriptors. Existing matching files are reused; differing files are preserved and reported. Relative source and figure links remain valid in the complete `report/` directory. Copy or transfer that whole directory when sending its HTML.

The selected-study exporter reuses an identical completed archive. Receiving uses the maintained `portable.restore` or `portable.resume_restore` and checks the original archive SHA. It therefore preserves legitimate native receiving metadata and later recipient state while verifying the selected saved report. A separate Python interpreter imports `model.workspace` from `received/application` and verifies the original edition, operation and source closure; the producing process's loaded modules are not used for that final opening.

## Scientific reading

The retained measured-result and activity files are the authority for station identity, sample date, parameter, fraction, method, unit, reporting condition and detection/quantitation limit. Keep those fields visible when selecting a comparison or exporting a table.

- Separate ambient measurements from published designated uses and the selected assessment-cycle determinations. Recent measured values and an earlier assessment window answer different questions.
- Keep temperature units explicit. Apply a threshold only when its original rule/source, unit conversion, parameter applicability, observation support and comparison period are retained. A date outside a source assessment period does not revise that assessment.
- Preserve nondetect/qualified result intervals and original source comments. A reporting limit is not an observed concentration. The source report's interval and qualified-subset views carry those distinctions.
- Do not pool different chemical forms, fractions, units, methods or station locations merely because their labels are similar. Use the retained grouping fields and original complete exports.
- Read year and season coverage alongside summaries and temporal charts. Sparse or non-overlapping sampling periods do not establish a continuous trajectory.
- These report sources remain separate from the prior microbial study. A future Monitoring context must use its own compatible original observation schema and exact station/network identities; this report opening does not change an existing network, plan, campaign or sampling calendar.

## Inspect the actual outgoing product

The producing worker must open and LOOK at the exact rendered edition before presenting it. Source review, successful imports and hashes support that work; the actual populated report is the human deliverable.

Inspect the HTML and every PDF page at readable size. Check titles, station IDs, source dates, units, qualified values, table wrapping, source citations, chart axes/legends and page breaks. View the installed report desk and opened report at desktop/screenshare and narrow widths. Operate source selection, saved-edition opening, downloads and the received report's reopening. Confirm that the report's displayed source and measurement counts agree with its complete original CSV/JSON exports.

Inspect **every outgoing attachment** in its recipient form, including PDF, HTML, Markdown, CSV, JSON, figures and ZIP contents. Open original links from the copied `report/` tree. Open the selected Study with its received application and locate the saved report there. Preserve actual PNG/PDF handles and any visible/control defect with the same operation; repair the authored source and generate a new explicit edition when a presentation change is needed.

A native completion record establishes the executed scientific/source path. The actual rendered pages and operated controls establish the human opening. Keep both attached to the same saved source and operation.
