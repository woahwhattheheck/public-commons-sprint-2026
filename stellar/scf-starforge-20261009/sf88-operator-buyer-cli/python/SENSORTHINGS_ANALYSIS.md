# SensorThings source editions in Python Analysis

This delivery connects the original SensorThings source workspace to the existing Python Analysis application. It provides complete source-table imports, editable SQL recipes, full typed query exports, a published report, Excel workbooks, a portable workspace, and an actual continuation of that workspace after receiving.

The source engine, AnalysisWorkspace, DatasetDatabase, report engine, workbook engine, source-document store, and portable receiver keep their existing ownership. The integration provides the original source-preparation action and an explicit saved-component preparation action, one existing command for either action, and the complete original Python receiving programme. It does not capture a provider, create another analysis database format, or add an account or session gate.

## Whole workflow

1. Finish an original SensorThings capture and retain its immutable source edition.
2. Complete the original edition.export action. Retain the returned result.id. That source-export ID is different from the caller's operationId.
3. Call analysis.python.prepare for the complete scalar/raw-source document, or analysis.python.components.prepare for an explicit saved MultiDatastream analysis version. Both select the exact editionId and returned exportId; the component action also selects the actual immutable analysisVersionId.
4. Receive the complete preparation through the existing file downloader, or use its retained source directory on the same host. The normal downloader keeps numbered flat names and their original selectors in sensorthings-download.json. The complete source archive travels as ordered content-addressed parts, accompanied by the original edition and export receipt.
5. Run the installed Python programme with each complete receiving manifest and its SHA-256, or with the original intake.json and its SHA-256 when using a retained source directory.
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

## Receiving the normal downloaded file set

Select the preparation's complete analysis file set in the existing source application. Its ordinary downloader writes sensorthings-download.json and numbered files in one receiving directory. Keep those received names and the complete manifest together.

The Python programme accepts that existing manifest directly:

    {
      "name": "bgs_pressure",
      "download_manifest": "/absolute/received-source/sensorthings-download.json",
      "download_manifest_sha256": "the actual SHA-256 of the complete received manifest"
    }

Use this object in the programme request's sources array. Each source selects either these three fields or the original name, intake and sha256 fields. Sources using the two receiving forms can participate in the same programme.

The programme checks the exact complete manifest bytes and its original client-bound identity, then follows files[].selection.file to the actual numbered file. Every selected file must belong to the same original analysis preparation. The native workspace and preparation IDs must match the received intake. The whole received closure, byte counts, SHA-256 values and content types must match the original source descriptors. The same original edition/export binding, five complete tables and ordered whole-archive hash are then checked.

The existing AnalysisResponses.register method accepts an optional document_files mapping from original descriptor paths to explicit local input files. It passes that mapping to the existing retain_document function as source_files. The normal FileDelivery reader and original publication method copy each complete input directly into the existing content-addressed Analysis document store. The source.json bytes, document ID, dataset identity and registration history remain original. Repeated imports reuse completed retained files through the same publication logic.

This mapping is an input-location option. The persisted source document continues to use its original files/<sha256> paths, so the normal workspace exporter and receiver need no new file format or path resolver. The complete downloaded receiving manifest is retained in the customer handover under source-receiving, alongside all other original programme deliverables.

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


## Explicit saved MultiDatastream components

The component path extends the same original document intake, SQL application, report engine, workbook engine and portable receiver. It retains all five existing source tables, then adds four complete component tables. The ordinary scalar action and its five-table format remain supported.

First save the actual component analysis in the existing SensorThings UI. Select each original zero-based position, its exact edition-bound metadata identity and the required issue acknowledgments. A numeric-json interpretation needs its explicit attributed note; it does not change or certify the publisher's declared observation type. A revised source edition requires its own actual binding IDs. Do not reuse a prior edition's binding IDs.

Open that saved version, then use **Receive, export and reopen → Python analysis handover**. Select its exact source edition and original source export. In **Explicit analysis selection**, choose the opened saved component version. The default keeps the ordinary complete-source path; no component is selected automatically.

The same action is available from the existing authenticated listener, typed merchant client and source command:

    {
      "action": "analysis.python.components.prepare",
      "operationId": "one-retained-component-preparation-id",
      "expectedRevision": 0,
      "payload": {
        "editionId": "actual immutable source edition SHA-256",
        "exportId": "actual returned source-export result ID",
        "analysisVersionId": "actual saved component analysis version SHA-256",
        "actor": "the current attributed operator"
      }
    }

Replace expectedRevision with the current original workspace revision. Preserve the entire exact request and operationId through an interrupted call. The source command accepts that same reviewed request file:

    node analysis/python-document-cli.mjs \
      --workspace /absolute/existing/sensorthings-workspace \
      --request /absolute/retained/component-preparation-request.json

The normal installed sensorthings-python-source command selects the same source CLI. There is no second queue, database, provider request or credential. The existing operation result/read endpoint resolves a lost reply; a new request ID is not a substitute for recovery.

### Component handover contract

The receipt remains stellar-forge.sensorthings-python-source.v1, so the original file selector and manifest-bound downloader continue to receive it. Its optional componentAnalysis field records the immutable version, project, selection, ordered binding IDs and complete binding-manifest identity.

The component intake.json declares stellar-forge.sensorthings-python-component-intake.v1. Its complete source document contains:

| Collection | Retained meaning |
|---|---|
| observations | Every original parent observation occurrence, source value/type/state, time, quality and JSON. |
| components | The original source engine's complete positional raw table; it is not limited to the selected analysis. |
| entities | Complete retained entity metadata, source pointers and opening/closing capture phases. |
| observation_index | Original typed parent record keys and semantic hashes. |
| numeric_eligibility | Original scalar classifier and every excluded reason. |
| selected_components | Every explicitly selected component, full unchanged parent context, actual selected value and source-pointer fallback. |
| component_index | Selected occurrence/key/semantic identity and the independent parent semantic identity. |
| component_eligibility | Separate exact-arithmetic and finite-browser eligibility, including both original reasons. |
| component_bindings | Original position, typed stream, selected property/unit/type, interpretation and complete ordered metadata binding. |

Two additional complete originals accompany the same source document: the actual saved component analysis version and its full ordered binding manifest. The original source edition, source export receipt, meaning record and all ordered archive parts also remain present. All document cells are text; original JSON numeric lexemes are never rounded into spreadsheet numbers.

The native preparer uses the existing selectedComponentRows, validateComponentBindings, componentExactEligibility and componentNumericEligibility implementations. It streams the complete tables within the original Analysis source limits. The receiving programme accepts a full original preparation directory or the original flat numbered download manifest exactly as described above.

The Python receiver validates the entire file/archive closure before its first workspace mutation. It also checks the saved version and ordered metadata identities, coverage of every selected parent/position, each selected value against the original JSON vector, and both classifier results. The receiver independently reconstructs the selected MultiDatastream's own ObservedProperties relation from retained entity roots and the original edition's page order. Inline property arrays retain their original positions; navigation pages retain their original root ordinals and nested relation order. Every complete property source reference must match that reconstructed list, so membership elsewhere in the source closure cannot substitute for positional meaning. Missing, null, non-array and short-vector values remain distinct. A present selected element cites /result/index; an absent element retains the actual array/parent pointer instead of inventing a nonexistent JSON Pointer.

Neither a prepared file nor a passing source check is evidence that the subsequent Python programme, workbook receiving or browser run has executed. Actual operation records and the final programme-result.json supply that evidence.

### Queries, statistics and comparisons

Run the same stellar_forge_buyer.sensorthings_analysis programme with the complete source-selection descriptors. A source entry may use the same source edition with a different explicitly saved analysis version; duplicate selections of the same edition and version are rejected. Every source entry retains a distinct source label. Optional comparison pairs reference those exact labels.

All source and derived tables get full original query-export JSONL and CSV files and workbook sheets. The report adds explicit selection/meaning, time/duplicate/separation, exact sample statistics, category, quality, eligibility and observed-code-change sections.

Exact component statistics use actual original JSON numbers with verified positional alignment, explicit source instants and the selected source-declared or numeric-json interpretation. Their canonical decimal exponents must stay within the existing ±4,096 exact-arithmetic bound. They do not inherit the browser finite-number or underflow exclusions. The report keeps both counts and all exclusion reasons.

Minimum and maximum retain original source number literals. Sum, mean and median use exact Fraction arithmetic over Decimal source tokens. mean_decimal_34 alone is rounded to 34 significant digits. Distinct component bindings, units, properties and original declarations are never pooled. All eligible occurrences have equal sample weight, including coincident timestamps. No time-weighted mean, interpolation, cadence, outage or coverage percentage is inferred.

The report and full data retain:

- Every source occurrence at a duplicate instant, with parent and component IDs and exact citations.
- Every separation between adjacent distinct source instants, with all endpoint occurrences and exact nanoseconds/rational seconds.
- The full separation distribution and selected-window/time extent distinction.
- Literal categories, original value states and quality declarations.
- Explicit intervals and unplaced or unresolved source times.

Comparison queries preserve independently selected bindings on both sides. They distinguish same, selectedComponentChanged, componentMeaningChanged, unselectedParentContextChanged, ambiguous, unkeyed and observedOnlyLeft/Right. Source query, selected positions, period and interpretation compatibility are displayed separately. The selectedComponentChanged classification concerns the complete selected observation semantic context, including value, time, quality, parameters and attributed interpretation; it does not assert that the numeric value alone changed. Changing an unselected vector element can change the parent identity without changing that selected semantic context. Observed-only rows do not establish source insertions/deletions or an atomic provider snapshot.

### Actual receiving and revision two

The existing programme imports into the original AnalysisWorkspace, saves queries, publishes its report, generates complete original workbook deliveries, exports the whole workspace and uses the existing restore_archive operation in a separate receiving directory.

For a component input, it then performs an additional real revision of component_time_coverage in the restored workspace. Revision 1 retains the complete component event/separation summary. Revision 2 selects the retained daily UTC component-count table, including distinct instants, coincident occurrences and separate exact/browser counts. The same report section and first workbook sheet are revised, and the whole continued workspace is exported again.

The original stream_coverage revision-two flow also remains. Both scalar and component query histories are read back. programme-result.json records the actual original imports/jobs, immutable component version/binding IDs, report and workbook revisions, both workspace archives and all file hashes. The generated receiving guide explains the exact source interpretation and continuing workflow.

A component-selection edit belongs to a new explicit version in the original SensorThings analyst UI, followed by its own preparation and a new Python programme operation. Reopening an existing operation recovers its exact original selection and executed source; it does not change those inputs. Completed original source files, archives and earlier query/report/workbook revisions remain available.

### Maintained source composition

This successor adds analysis/python-components.mjs and its paired declaration, plus stellar_forge_buyer/sensorthings_components.py. It extends the existing python-document.mjs, source CLI, sensorthings_analysis.py, action metadata, original analysis manager, typed contract and original UI. The source-owned normal distribution contribution exposes the new helper and preserves the complete Desk, managed launch and both original startup-schema bindings.

The AnalysisWorkspace, DatasetDatabase, response-document implementation, workbook/report engines and archive receiver are unchanged. The complete calculation programme and component-verification companion are retained with the derived document. Use the selected normal application release and its already-owned native receiving operation; do not build a manually reduced dependency tree.


## Maintainer composition

The source integration adds these leaves:

- sf30-seller-sdk/sensorthings/analysis/python-document.mjs
- sf30-seller-sdk/sensorthings/analysis/python-document-cli.mjs
- sf88-operator-buyer-cli/python/stellar_forge_buyer/sensorthings_analysis.py
- sf88-operator-buyer-cli/python/SENSORTHINGS_ANALYSIS.md

The existing scalar owner composes action/schema/core/read/file/MCP/type/contribution hooks once. Keep the normal source package and Python distribution; a second manually reduced package is unnecessary. The original .py/.mjs/Markdown distribution rules include these leaves. Existing upstream Helgoland licence inclusion belongs to the normal source builder and must preserve the original licence bytes.

The shared AnalysisWorkspace, DatasetDatabase, report/workbook engine and archive receiver are consumed through their existing methods. The optional flat-file input join changes response_tables.py and response_documents.py only: AnalysisResponses.register accepts document_files, and retain_document passes the reviewed source_files mapping to its original FileDelivery reader and publisher. Existing callers use the unchanged directory layout. Persisted manifest bytes, document IDs, response recovery, source registration history and portable workspace contracts remain original.
