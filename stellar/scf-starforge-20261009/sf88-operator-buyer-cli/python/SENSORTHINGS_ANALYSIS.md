# SensorThings source editions in Python Analysis

This delivery connects the original SensorThings source workspace to the existing Python Analysis application. It provides complete source-table imports, editable SQL recipes, full typed query exports, a published report, Excel workbooks, a portable workspace, and an actual continuation of that workspace after receiving.

The source engine, AnalysisWorkspace, DatasetDatabase, report engine, workbook engine, source-document store, and portable receiver keep their existing ownership. The integration adds one source-preparation action, a small command for that action, and one complete Python receiving programme. It does not capture a provider, create another analysis database format, or add an account or session gate.

## Whole workflow

1. Finish an original SensorThings capture and retain its immutable source edition.
2. Complete the original edition.export action. Retain the returned result.id. That source-export ID is different from the caller's operationId.
3. Call analysis.python.prepare in the same workspace, selecting the exact editionId and returned exportId.
4. Deliver every file named in the resulting preparation record, preserving its relative path. The original complete source archive travels as ordered content-addressed parts, accompanied by the original edition and export receipt.
5. Run the installed Python programme with the exact intake.json files and their SHA-256 values.
6. Receive full tables, source and time summaries, categorical occurrence counts, exact numeric summaries, original semantic-key comparisons, complete query exports, a report, and workbooks.
7. The same programme exports the original Analysis workspace, restores it with the existing receiver, edits the saved stream-coverage query, updates the report and workbook, and exports the continued workspace.

A native run reports actual source editions and original job identities as they complete. Preparing source files alone does not claim the subsequent analysis or receiving has run.

## Source preparation action

The existing manager advertises analysis.python.prepare with this original action envelope:

    {
      "action": "analysis.python.prepare",
      "operationId": "one-retained-preparation-identity",
      "expectedRevision": 0,
      "payload": {
        "editionId": "the exact retained edition SHA-256",
        "exportId": "the returned completed source-export result ID",
        "actor": "the current operator label"
      }
    }

Use the actual reviewed workspace revision; zero is only an example. Retain the complete original request before dispatch. The existing action journal supplies replay and compare-and-swap handling.

The existing HTTP/MCP workspace can execute the action directly. When the workspace is not held open by another original process, the normal source command can use the same action:

    node sensorthings/analysis/python-document-cli.mjs \
      --workspace /absolute/original-sensorthings-workspace \
      --request /absolute/python-preparation-request.json

The helper's fixed module API is:

    preparePythonSource(store, {edition, exportReceipt, id, createdAt})
    pythonSourceFile(store, record, file)

The returned record uses schema stellar-forge.sensorthings-python-source.v1. It binds id, createdAt, editionId, exportId, exportSha256, originalWorkspaceId, relativeDirectory, documentId, tables, sourceComplete, sourceArchive and files. The existing manager retains it in analysisPythonSources and reads it using the original analysis tool.

The directory is analysis-python/<id>. The selected files are source.json, intake.json and files/<sha256>.json or .bin. The source file reader returns path, file, bytes, sha256, contentType, filename and mime. The filename is the selected basename; the selector still retains the complete relative file name. The existing held-descriptor download path and original workspace authentication remain the only file gateway.

## Five complete tables

| Table | Contents | Interpretation |
|---|---|---|
| observations | All original observation projection columns | Every cell remains exact projected text, including original JSON, numeric literal, type, state, unit, time, quality and source pointer. |
| components | All original MultiDatastream component rows | Array positions, units, properties, observation types and unresolved alignment issues remain explicit. This scalar programme does not choose a component implicitly. |
| entities | All original entity occurrences | Opening/closing capture phases and original source-page identities remain available separately. |
| observation_index | Original key and semantic hash for every occurrence | The original engine's typed stream/observation key and semantic identity are reused without a replacement comparison parser. |
| numeric_eligibility | Original scalar classification for every occurrence | The original numericEligibility function supplies eligibility and its exact reason; it does not replace the raw result. |

The three original tables use the unchanged domain.tableRows iterator. The additional tables are explicitly derived. The source engine's immutable original key includes typed source identity. Its semantic hash includes observation content, stream meaning, observed properties, things and features; comparing only observation JSON would miss material source changes.

The complete tables form one JSON document. Reusing it for five projections retains the complete original source archive once in the Analysis document store. Each original archive part is at most 16 MiB. The whole archive hash is checked again after joining its ordered parts logically; it is never represented by a first/last-byte sample.

The integration follows the existing Analysis source limits: 32 MiB JSON document, 32 MiB per original attachment, 256 MiB total, and at most 32 originals. Unfinished output and original source bytes remain when an actual source exceeds those limits. Choose a different explicit provider window in the original source application if a later source requires it.

## Python programme request

The command is installed with the existing Python package:

    python -m stellar_forge_buyer.sensorthings_analysis --input /absolute/programme.json

A complete request selects actual native preparation outputs:

    {
      "schema": "stellar-forge.sensorthings-analysis-programme.v1",
      "operation_id": "one retained 32-character lowercase hexadecimal UUID",
      "workspace": "/absolute/customer-analysis-workspace",
      "received_workspace": "/absolute/received-customer-analysis-workspace",
      "control": "/absolute/sensorthings-programme-control",
      "output": "/absolute/sensorthings-customer-handover",
      "checkout": "/absolute/original-stellar-forge-checkout",
      "node": "/absolute/original-node-executable",
      "title": "SensorThings source analysis",
      "sources": [
        {"name": "hamburg_a", "intake": "/absolute/source-a/intake.json", "sha256": "actual file SHA-256"},
        {"name": "hamburg_b", "intake": "/absolute/source-b/intake.json", "sha256": "actual file SHA-256"},
        {"name": "bgs_pressure", "intake": "/absolute/pressure/intake.json", "sha256": "actual file SHA-256"}
      ],
      "comparisons": [{"left": "hamburg_a", "right": "hamburg_b"}],
      "allow_incomplete": false
    }

All shown identities, revisions, hashes and paths must be replaced by the actual retained native values. The request is retained unchanged in its control directory. Named source aliases begin with a letter and contain at most 20 letters, digits or underscores. Up to 16 complete editions can share one operation. Workbooks are composed in groups of at most 32 sheets using the original workbook limits.

The original response-preview and response-import actions receive every column explicitly as text. Named views are selected with the original DatasetDatabase compare-and-swap operation. Saved SQL definitions and original job requests are retained before execution. No provider is queried by this programme.

Incomplete provider traversal is distinct from possession of a complete retained source archive. The default request uses the original complete-source intake. The existing allow_incomplete acknowledgement remains an explicit input if an operator deliberately selects a retained incomplete traversal.

## What the analysis computes

**Source inventory and coverage.** Each edition retains the original service, selected query, traversal status, counts, source archive identity, source licence, and typed-key multiplicity. Stream summaries keep original observation type and unit. Explicit instants, explicit intervals and unresolved times remain different representations.

**Categorical observations.** Counts group declared category observations by their original literal value, state and type. Adjacent-code analysis requires explicit source instants, a unique observation at both instants, and usable states. Coincident observations and source gaps are not silently converted into duration. A differing adjacent code does not establish the exact transition time.

**Numerical observations.** The unchanged scalar source classifier admits declared numeric/count observations with an original JSON-number result, an explicit phenomenon instant, and the original browser's representability conditions. Every excluded row retains its reason in the classification table and all original fields in observations. Groups keep the original stream kind, typed ID, observation type, observed property and unit.

Decimal source strings enter Decimal and Fraction directly. The programme never aggregates binary browser floats. Minimum and maximum retain original source literals. Sum, mean and median have exact rational representations. mean_decimal_34 is separately identified as a mean rounded to 34 significant decimal digits. Different units and implicit MultiDatastream components are never combined.

**Edition comparison.** Matching reuses the original canonical keys and semantic hashes. A key repeated on either side is ambiguous. Keyless occurrences remain unkeyed on their respective sides. Other classifications are same, changed, observedOnlyLeft and observedOnlyRight. Scope compatibility compares the original service, ordered selected stream kind/URL list and observation query. Observed-only records do not establish deletion or insertion at the provider.

**Metadata.** Entity capture phases and source-page counts are reported separately. An end-time update outside a selected observation window can be a metadata difference without changing the observations in that window. Source quality labels remain publisher values and do not become analyst approvals.

The full calculation module accompanies the derived source document, together with every selected intake descriptor. Both original raw source archives and these derived records remain inside the same portable workspace.

## Customer outputs

The whole handover ZIP contains:

- Original and receiving-revision reports in HTML, full JSON and CSV ZIP formats.
- Editable XLSX workbooks plus each workbook's complete original handoff ZIP and manifest.
- Complete JSONL and spreadsheet-safe CSV exports for every saved query.
- The source inventory and calculation document with its original descriptors and source code.
- The original full Analysis workspace ZIP.
- The continued workspace ZIP after the actual original receiver, saved-query edit, report revision and workbook revision.
- A plain-text operator guide and a programme result with the actual original identities.

Interactive query previews can be small. Workbook sources are complete original query-export rows.jsonl files; the integration does not substitute the preview for the full query.

The cold-receiving continuation keeps the original Analysis workspace identity. It retains stream_coverage revision 1, saves revision 2 with daily source coverage, publishes report revision 2 and workbook revision 2, then exports the resulting editable workspace. Existing report and query histories remain available. A repeated completed programme verifies and returns its own original delivery; it does not replace later customer edits.

## Native acceptance with the retained public sources

The scalar release's existing native owner supplies the actual completed Hamburg edition A, Hamburg edition B and BGS pressure edition. The full retained connector-response packets are already part of the source distribution; their receiving programmes supply exact native IDs and source exports.

The Hamburg record is categorical. The BGS June 1 pressure window is numeric. They deliberately exercise different source meanings in the same retained-source application. No native edition ID, source-export receipt, database result or receiving result should be replaced by an expected value in this guide.

Run the original source receiving, preparation actions and this whole Python programme in the existing owned native execution. Inspect the actual report, workbook and reopened app. Use the current original package, including the B9D2 response-intake recovery changes. The programmer-facing Python and Node syntax checks are separate from this full native receiving result.

## Maintainer composition

The source integration adds these leaves:

- sf30-seller-sdk/sensorthings/analysis/python-document.mjs
- sf30-seller-sdk/sensorthings/analysis/python-document-cli.mjs
- sf88-operator-buyer-cli/python/stellar_forge_buyer/sensorthings_analysis.py
- sf88-operator-buyer-cli/python/SENSORTHINGS_ANALYSIS.md

The existing scalar owner composes action/schema/core/read/file/MCP/type/contribution hooks once. Keep the normal source package and Python distribution; a second manually reduced package is unnecessary. The original .py/.mjs/Markdown distribution rules include these leaves. Existing upstream Helgoland licence inclusion belongs to the normal source builder and must preserve the original licence bytes.

The shared AnalysisWorkspace, response-document engine, DatasetDatabase, report/workbook engine and archive receiver are consumed through their existing methods. This integration does not change those shared source files or their recovery contracts.
