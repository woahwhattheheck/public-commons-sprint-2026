# Point-list modelling and contractor handover

This application turns complete original point lists and native Haystack grids into a reviewed semantic model. It keeps source identifiers, original row positions, naming decisions, classes, relationships, dictionary definitions, observation evidence and every saved version together. The native standard is the selected original Brick 1.4.4 distribution, including its REC vocabulary; validation uses the actual pinned Brick/RDFLib/pySHACL stack.

Open the existing Haystack workspace and choose **Point-list modelling**. The same server, workspace identity, authentication, operation journal and delivery mechanism serve the original grids, corrective work and modelling page. No existing source record is renamed or overwritten by a semantic proposal.

## Complete delivery and runtime

The complete v3 workspace JSON contains 62 application files, all original selected/unselected sources and editions, corrective-work history, complete semantic models and both sides of received model decisions. Every source and native report is retained with its original bytes and SHA-256. Version 1 packages retain their original 36-file inventory, and version 2 packages retain their original 41-file inventory; both remain receivable by this application. A package cannot place semantic history under an older application format.

The Python runtime is a separate explicit offline dependency archive. The application carries its complete manifest, original ontology and licence, adapter, requirements, generated catalogue and installer. Follow **SEMANTIC_NATIVE.md** and the exact semantic-dependencies.json to receive and verify that archive and create its isolated Python environment. The installer uses the complete pinned wheel set with --no-index and --require-hashes. Copy the actual offline ZIP alongside the workspace handover when the recipient must validate without installed dependencies. Its precise filenames, bytes, hashes and original licences are in the archive manifest. The workspace JSON alone contains the complete model and reports but does not contain the wheel payloads.

Select the installed interpreter explicitly with HAYSTACK_SEMANTIC_PYTHON before serving or using a local CLI. The server never installs or downloads a dependency during a request. Missing or incompatible runtime/source files produce an actual error; the complete model remains editable. Node.js 22 or later runs the application.

## 1. Receive complete source files

Choose an original CSV or TSV file and its actual format. An optional delimiter selects comma, tab or semicolon. The native Python CSV reader preserves:

- Original UTF-8 bytes and any BOM.
- Column position and exact heading, including duplicate and blank headings.
- Every cell as text, including zeroes, dates, decimal-looking identifiers, whitespace and embedded newlines.
- Original logical row index and physical end line.
- Native inspection observations and the executed adapter/source identity.

The supported file capacity is 32 MiB, 25,000 data rows and 256 columns. An input beyond that capacity fails explicitly; it is never silently shortened. Select the intended export or split it into separately identified complete source files before importing. Original file downloads return the exact input bytes.

The same page can import an original native Haystack JSON grid through the existing source importer. That importer and its typed proposal/review behavior are unchanged. The modelling selection uses currently selected native sources; point-list intakes are selected explicitly.

## 2. Declare mappings and naming

For each selected point list, choose column positions for original ID, original label, kind, equipment name, site name and unit observation. Position is authoritative when headings repeat. Choose a default proposed kind and, if appropriate, an exact default class IRI.

A model can include native sources, point lists or both. Source references are {kind, sourceId, rowIndex}. Initial entity IDs derive from those references. Duplicate identifiers or display names therefore remain separate entities until an operator explicitly revises their source associations. They are not silently merged. A source row may be left unmapped or referenced by more than one entity; the complete assessment exposes both situations.

Naming templates support {nativeId}, {name}, {source}, {row}, {equipment}, {site} and {kind}. The case and separator are explicit. The preview proposes names; it does not change the original source. A stable entity IRI is the selected namespace plus the encoded entity ID. Renaming a display label therefore does not change its identity.

Choose a namespace ending in /, # or :. Use an agreed controlled namespace for a customer model. The operating demonstration uses its own explicitly labelled namespace and the original anonymized Charlie example; it does not represent a commissioned live site.

## 3. Review the complete model

The editor includes all entity, relationship and dictionary fields. An entity retains its source references, reviewed name, label, kind, full class/tag IRIs, typed RDF attributes, physical observation and full note. Manually added entities receive a stable ID and remain distinguishable from imported rows.

Relationships require two actual declared entity IDs and the original predicate IRI. Equipment/site naming tokens do not imply a physical relationship. Declare those links from the actual source or a recorded review. Dictionary rows retain the term, original IRI, kind, full definition, source URL and review note.

**Check current draft mappings** assesses the exact editable content against its frozen original source context. It reports missing names, unclassified entities, reused/unmapped rows, manual entities and duplicate names. This check is separate from native standard conformance.

The complete JSON editor supports every model field. Its unapplied text is retained separately from structured edits, including invalid or unfinished JSON. Apply it to the draft or discard it explicitly before saving. Invalid source references and incomplete entity/relationship shapes are reported before JSON replaces the structured editor. Structured edits do not silently erase an unapplied advanced edit.

The browser saves drafts in the original application's IndexedDB, using a separate modelling key for the workspace and tab. Writes are coalesced to avoid repeatedly cloning a large model on every keystroke, and are flushed before a mutation. An open modal, source-file selection, returned file and per-model decision are retained. Keep the tab open if the browser reports that storage failed.

A saved model version retains its complete content, content hash, source-context hash, parent versions, author, time and reason. The operation checks both the original workspace revision and the model head that was opened. If another operator has changed either, the draft remains intact. Compare the current saved content with the retained draft. When only unrelated workspace work changed and the model head is identical, **Use current revision** deliberately advances the draft's workspace revision. A changed model head requires explicit content resolution.

## 4. Validate and review the exact version

Save the complete model before native validation. The adapter receives that exact model ID, version ID and content hash, plus its projected native entities and relationships. It returns a separate hash for the complete received native projection. These hashes serve different purposes and are not substituted for one another.

The selected original ontology and actual validator produce:

- model.ttl: the complete native model in Turtle.
- model.json: the exact native model projection received by the validator.
- validation-report.ttl and validation-report.txt: the complete pySHACL report graph and text.
- brick-wrapper-report.ttl and brick-wrapper-report.txt: the original Brick wrapper's report graph and text.
- validation-expanded.ttl: the complete graph after the observed validation rule passes.

All seven files keep their original byte counts and hashes. The result also retains actual conformance, every structured diagnostic and mapping observation, dependency/source identities, and the observed validation pass history.

Unclassified entities and unknown terms remain explicit observations. A valid SHACL result is evidence about the selected semantic model and shapes. It is not evidence that an endpoint is online, that a sensor is calibrated, or that a physical connection exists. Physical observation is retained separately as unreviewed, observed-live, observed-offline, configured-only or not-observed, with its supplied date, author and evidence.

A reviewer can record **Ready** or **Changes requested** for the exact saved head, with a complete purpose/reason and optional selected native validation. Later edits create a new version; they do not carry an earlier review forward as a new approval. The application retains review and conformance independently rather than fabricating a combined acceptance.

Native execution retains its exact request, selected source identities, attempt and atomic result under the original operation. If the browser loses a reply, use **Requests → Read original receipt**. **Continue same request** reconciles that operation first and only resends its original bytes and revision when no completed workspace receipt exists. An active or uncertain original native process is not duplicated.

## 5. Prepare contractor handover

Choose the exact model version when preparing a report. The application supports:

- Full JSON model/source/review report.
- CSV entity register, with original IDs, full IRI/class/tag/source-reference/attribute data and physical observation evidence.
- Printable HTML report with complete mappings, entities, relationships, dictionary, notes, history and source context.
- JSON or CSV dictionary.
- Each exact original native Turtle/report file.
- Complete editable workspace JSON, including source bytes and immutable histories.

CSV cells that could be interpreted as formulas receive the existing export protection. Exact original CSV/TSV downloads and JSON remain available when byte-for-byte original cell representation is needed.

The report and native file are immutable original deliveries with their own operation IDs, complete-byte hashes and recovery records. A download can be continued through its original delivery receipt. Repeating the original request does not create another model version.

## 6. Receive a contractor's returned workspace

Select the complete returned workspace file. The receiver validates its format, every application member, payload hash, workspace identity, original source bytes, model version ancestry, reviews and native reports. It does not execute returned application code during preview or apply.

Read every model's comparison, including array order and source-context changes, then choose:

- **Keep local**: retain the current active head; an incoming-only model remains outside the active list.
- **Adopt returned**: take that model's complete returned content. For an existing model, a new immutable version records the local and incoming heads as its parents.

Decide every returned model explicitly. The application checks the exact local/incoming heads and reviewed workspace revision before applying. It never silently merges individual fields. When a return is re-previewed after a change, a decision is preserved only if both model heads are unchanged.

Both choices retain the complete incoming immutable source bank, model versions, reviews, native outputs and prior return decisions once by identity. Keeping local content does not discard contractor evidence. The return receipt also keeps the original model creation identities and incoming application manifest. The receiver's active application remains the selected installed source.

A complete subsequent export retains that combined history. Receiving it into a fresh directory preserves the original workspace/model/source IDs. Start its included application against the received directory, verify the current model/report, and provide the same offline runtime archive if further native validation is required.

## Command-line operation

All commands use the original cli.mjs, explicit local directory or authenticated server connection, and the existing retained request/replay mechanism. For example:

~~~sh
node cli.mjs init --directory /absolute/private/turnover --title "Reviewed building model"
node cli.mjs point-import --directory /absolute/private/turnover --file /absolute/source/points.csv --format csv --request-directory /absolute/private/requests
node cli.mjs point-intakes --directory /absolute/private/turnover --out /absolute/private/intakes.json
node cli.mjs model-preview --directory /absolute/private/turnover --file /absolute/private/mapping-args.json --out /absolute/private/preview.json
node cli.mjs model-create --directory /absolute/private/turnover --file /absolute/private/create-args.json --request-directory /absolute/private/requests
~~~

A complete mapping argument file has this shape. Replace the IDs with the actual retained source IDs:

~~~json
{
  "title": "Reviewed building point model",
  "namespace": "https://example.org/agreed-building/",
  "selection": {"nativeSourceIds": [], "intakeIds": ["ACTUAL_INTAKE_UUID"]},
  "mappings": [{
    "intakeId": "ACTUAL_INTAKE_UUID",
    "idColumn": 0, "nameColumn": 1, "kindColumn": null,
    "equipmentColumn": 2, "siteColumn": 3, "unitColumn": 4,
    "kind": "point", "defaultClass": ""
  }],
  "naming": {"template": "{equipment}_{name}", "case": "preserve", "separator": "_", "description": "The agreed reviewed naming convention."}
}
~~~

The create file takes the preview's complete selection, contextId and content, then adds author and note. A saved-model file also supplies its original modelId and expectedHeadId. Keep all content arrays even when empty. Friendly commands take business fields; use the original generic request/replay commands when providing a complete original operation envelope with its own operation/revision IDs.

~~~sh
node cli.mjs model --directory /absolute/private/turnover --model-id ACTUAL_MODEL_UUID
node cli.mjs model-validate --directory /absolute/private/turnover --model-id ACTUAL_MODEL_UUID --head-id ACTUAL_VERSION_SHA --author "Named operator"
node cli.mjs model-review --directory /absolute/private/turnover --model-id ACTUAL_MODEL_UUID --head-id ACTUAL_VERSION_SHA --decision ready --author "Named reviewer" --note-file /absolute/private/review.txt
node cli.mjs model-report --directory /absolute/private/turnover --model-id ACTUAL_MODEL_UUID --format html --out /absolute/private/model-report.html
node cli.mjs export-workspace --directory /absolute/private/turnover --out /absolute/private/complete-workspace.json
node cli.mjs receive --file /absolute/private/complete-workspace.json --destination /absolute/private/recipient
node cli.mjs serve --directory /absolute/private/recipient --port 8768
~~~

Read **node cli.mjs help** for complete source downloads, version comparison, dictionaries, original native outputs and contractor-return commands. **request ACTION --args FILE** exposes the entire catalog unchanged through HTTP, CLI and MCP.

## Original operating and browser programme

SEMANTIC_RECEIVING.mjs accepts one complete private input JSON path as its positional argument. It operates the selected original source through source-derived CSV intake, explicit mapping, model versions, actual native validation, reviews, reports, returned work, independent receiving and restart. SEMANTIC_BROWSER.mjs is its browser companion and uses the same original server/workspace and retained request state.

The original Charlie fixture is an anonymized donated Haystack example, not a customer deployment. The source-derived point-list input retains its original record keys, and any demonstration edits or physical-observation notes are explicitly labelled as programme evidence. The programme preserves every original source file, request UUID, complete result and interrupted-stage journal. Continue the same root/input after interruption; do not replace it with a new project or silently advance an existing request's revision.

The complete operating result and saved artifact manifest identify which source/runtime/browser stages actually ran. Prepared source, successful native validation and observed browser completion are separate recorded facts.
