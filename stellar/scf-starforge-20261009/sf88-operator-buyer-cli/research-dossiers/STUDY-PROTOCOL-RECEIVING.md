# Registered study protocol: complete source and receiving

This delivery connects the original registered NCT03529110 protocol to an existing Research dossier and its selected question. It retains the original registry JSON and PDF, the real page-text extraction, the source bundle, the received edition, revision-specific reports and the editable dossier. The complete original Research engine and its public assets accompany the programme.

Use the existing study-extraction owner and selected Research workspace for capture and receiving. The protocol commands do not create another server, store, dossier or question. The archive helper verifies and transfers the completed output; the original Research APIs continue to validate and reopen its dossier.

## What the complete delivery contains

| Path in the delivery ZIP | Purpose |
|---|---|
| `OPEN_FIRST.md` | Local opening links and the actual saved operation, workspace, dossier, question, revision and hash identities |
| `DELIVERY_MANIFEST.json` | Exact inventory, byte lengths, SHA-256 hashes, original source modes and the frozen package selection |
| `receiving/RECEIVING_COMPLETE.json` | Original successful source-receiving and export receipt |
| `receiving/Research_Dossier.json.gz` | Complete editable dossier exported by the original Research engine |
| `receiving/Research_Report.html` and `Research_Report.md` | Reports for the actual received revision |
| `receiving/original-source/` | Reusable original capture: registry, PDF, page text, page metadata, methods map, source/provenance files, source manifest and bundle, and original capture receipts |
| `receiving/source-bundle.json` | Byte-identical retained source edition exported through the original Research client |
| `receiving/records/` | Original selected baseline, received metadata and exact question/edition/source binding |
| `receiving/receiving-selection.json` | Immutable original operation and receiving selection |
| `receiving/ENGINE_SOURCE.json` | Complete repository-relative engine inventory and source-cohort provenance |
| `receiving/engine-source/` | The complete selected Research engine, dependencies, public assets and licence, with all six protocol programme files. The original default contains 292 files; a current installation retains its complete selected inventory. |
| `receiving/records/engine-selection.json` | Exact full current-engine manifest when the original operator selected one; retained for receiving, packaging and resume |
| `receiving/programme-source/` | Convenient copies of the same six programme files, verified against their engine-source counterparts |

The complete reusable capture retains every member named by `CAPTURE_COMPLETE.json`. In particular, `original-source/source-manifest.json` and `original-source/source-bundle.json` are present beside the unchanged capture receipt. The original capture inspector therefore has the same selected input after transfer.

The ZIP includes only the original receiving receipt's explicit member selection and the generated opening guide. Connection files, listener tokens, browser profiles, unrelated workspace files and later working changes are outside that selection. A dossier export contains its actual retained research content; choose its recipient and destination as part of the original handover.

## Selected source and interpretation

The registered file is `Prot_SAP_001.pdf`. The registry's document-type label is **Study Protocol and Statistical Analysis Plan**; the PDF itself is protocol **DS8201-A-U302, version 6.0, 25 September 2020**. Its analysis section refers further rules to the SAP. The original registry entry has document date `2020-09-25`, upload date `2024-05-29T21:57`, and size `1,599,281` bytes. The captured registry file is `99,951` bytes with SHA-256 `1e8f401843a30673b2d653ceb2682ad8f6d038af268a185c3333028d339d14c1`.

The original registered-document endpoint is:

https://cdn.clinicaltrials.gov/large-docs/10/NCT03529110/Prot_SAP_001.pdf

The capture module binds this document to the actual retained registry and records the native source response, exact PDF hash, original source selection and Poppler output. The source index retains links to the PDF and its extracted pages. The methods map points to the selected protocol passages; it describes planned methods. Study results, eligibility decisions, appraisal and interpretation remain in their original reviewed workflows.

Original notices in the registry, PDF and source material remain intact. The included root `LICENSE` covers the selected application source. It does not change the rights attached to the study document.

## Runtime and installation

Use the original equipped Linux environment and its selected Node 24 runtime. The full engine requires the built-in Node APIs selected by the retained Research source, including its original SQLite store. Fresh capture also requires the existing `pdfinfo` and `pdftotext` executables from Poppler. The capture records the actual extraction output and selected tool identities. Reusing a verified capture does not run a new PDF acquisition or extraction.

The package helper requires Python 3.11 or newer on Linux. It uses only the Python standard library, the existing kernel file lock and `renameat2(RENAME_NOREPLACE)` for atomic fresh-directory publication. No dependency installation or service is added by the helper. If the receiving filesystem does not support the required atomic directory operation, it preserves the verified staging directory and reports that exact error.

The engine source has the original repository layout:

```text
engine-source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/
```

Materialize the selected complete Research source cohort with all six programme files beside `source-bundles.mjs`, `workspace-client.mjs` and `workspace-files.mjs`. The receiver verifies every selected source hash before using the existing client. It includes the complete selected files, all six actual programme postimages and the original licence in its receipt. `ENGINE_SOURCE.json` records the selected repository/ref, full cohort provenance, actual source identities and six programme overlays.

The original repaired 286-file engine remains the default for that retained source selection. For a current customer workspace with extraction, independent appraisal, workbook exchange and Python customer updates, pass the complete current installation manifest through `--engine-source`. Its dossier, client, host, assets and helpers then travel together in the delivered editable application.

Git source modes `100644` and `100755` remain source metadata. The original materializer and this helper use private physical permissions: `0600` for files and `0700` for executable source and directories. This matters because the original Research host-file reader expects private files. Invoke JavaScript with the selected Node executable and Python with `python3`; do not make the receiving tree publicly writable or readable to work around a reader error.

## Select the complete current Research engine

The existing Research installation owner supplies the full source manifest for the selected customer edition. Save that exact UTF-8 JSON as a private file beside the operation inputs. The descriptor uses the same original cohort structure:

| Field | Required value |
|---|---|
| `id` | The original installation's stable source-selection ID |
| `repository` | The selected repository as `owner/name` |
| `ref` | Its full 40-character source commit |
| `baseFiles` | The exact length of `files` |
| `baseBytes` | The sum of every selected file's byte length |
| `files` | Every selected complete source descriptor, with repository-relative `path`, byte length `bytes`, lowercase SHA-256 `sha256`, and original Git mode `100644` or `100755` |

Retain the original source/repair provenance fields with that descriptor. All original engine paths must remain represented, including the licence and Developer assets; changed current files use their actual current hashes. Include the complete current Python, Zotero, extraction, appraisal, workbook and customer source selected by the original installation owner. The receiver reads these files from its existing repository-layout source root and verifies every body against the chosen descriptor.

The six protocol programme files can be supplied alongside the selected engine. The receiver copies each actual complete programme source and records it as an overlay. If the current manifest already includes a programme path, that descriptor must match the running source exactly; the path is included once in the engine and its identical convenience copy remains in `programme-source/`.

Pass `--engine-source /ABS/original-inputs/Research_Engine_Selection.json` to the existing `receive` or `run` command. The JavaScript API accepts the same absolute file through `receiveStudyProtocol({engineSourceFile, ...existingSelection})`. Capture, the selected existing question, connection, source bundle and original operation stay the same.

The exact selection bytes are retained at `records/engine-selection.json`. Later invocations can omit the option and resume from that saved selection. Supplying a different file after selection is rejected before receiving. A completed operation returns its original completed source selection; an explicit request for a different engine does not relabel that delivery. Preserve the original delivered edition when selecting a later customer edition.

The archive validator binds this complete selection, every selected engine file, all six programme overlays and their exact union. The resulting file count comes from the selected source. Fresh archive materialization and native dossier reopen use that same complete delivered engine.

## 1. Reuse or capture the original protocol

All paths below are concrete absolute paths selected by the original operator. Replace the examples with that operation's retained paths and IDs. Keep the same operation ID after interruption.

Set a task-specific source path for convenience:

```bash
PROTOCOL_SOURCE=/ABS/selected-source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers
```

To inspect an existing complete capture:

```bash
node "$PROTOCOL_SOURCE/study-protocol-cli.mjs" inspect-capture \
  --directory /ABS/original-operation/capture
```

To capture the selected registered document from the original registry file:

```bash
node "$PROTOCOL_SOURCE/study-protocol-cli.mjs" capture \
  --study-file /ABS/original-inputs/NCT03529110_Original_Registry_Study.json \
  --directory /ABS/original-operation/capture \
  --operation DBC61-SCF-STUDY-EXTRACTION-20261012-PROTOCOL
```

The completed capture is identified by `CAPTURE_COMPLETE.json`. Its operation, original source descriptors, PDF-page count, methods identity and ten member hashes remain exact. A repeated command inspects the saved capture. Changed input under the same selection is rejected, so an actual new source selection needs its own explicit original operation.

## 2. Receive into the selected existing question

Use the existing Research listener's private connection file and the exact existing workspace, dossier and question IDs. `base-revision` names the original selected baseline. The receiving module reads that baseline, previews the additive source operation against the current dossier, and uses the existing SourceBundle receive API. Repeated delivery of the same question/bundle is recovered by the original engine.

```bash
node "$PROTOCOL_SOURCE/study-protocol-cli.mjs" receive \
  --capture /ABS/original-operation/capture \
  --directory /ABS/original-operation/receiving \
  --connection /PRIVATE/original-application-url.json \
  --workspace-id research_ORIGINAL_WORKSPACE_SHA256 \
  --dossier ORIGINAL_DOSSIER_ID \
  --question ORIGINAL_QUESTION_ID \
  --base-revision ORIGINAL_BASE_REVISION \
  --engine-source /ABS/original-inputs/Research_Engine_Selection.json \
  --operation DBC61-SCF-STUDY-EXTRACTION-20261012-PROTOCOL
```

The values beginning `ORIGINAL_` are the actual selected IDs and integer revision, not literal values. The workspace ID has the original `research_` plus 64 hexadecimal characters. The connection file stays private and is never a package input. The examples select the full current engine manifest; omit `--engine-source` when resuming its saved selection or intentionally using the original frozen engine.

The `run` command joins the same capture and receiving phases under one original operation directory:

```bash
node "$PROTOCOL_SOURCE/study-protocol-cli.mjs" run \
  --study-file /ABS/original-inputs/NCT03529110_Original_Registry_Study.json \
  --directory /ABS/original-operation \
  --connection /PRIVATE/original-application-url.json \
  --workspace-id research_ORIGINAL_WORKSPACE_SHA256 \
  --dossier ORIGINAL_DOSSIER_ID \
  --question ORIGINAL_QUESTION_ID \
  --base-revision ORIGINAL_BASE_REVISION \
  --engine-source /ABS/original-inputs/Research_Engine_Selection.json \
  --operation DBC61-SCF-STUDY-EXTRACTION-20261012-PROTOCOL
```

Use either the original combined command or its explicit saved phase. Do not start another concurrent operator against the same operation directory. The original DBC61 caller keeps the customer selection and native lifetime.

Inspect the completed receiving result:

```bash
node "$PROTOCOL_SOURCE/study-protocol-cli.mjs" inspect-receiving \
  --directory /ABS/original-operation/receiving
```

`RECEIVING_COMPLETE.json` must report `RECEIVED_AND_EXPORTED` before packaging. Its binding records the actual question, source edition and received revision. Reports and the portable dossier are exported for that revision, even if another original operator later advances the dossier. The complete source copies and capture directory are checked by the producer before its completion receipt.

## 3. Package and verify the complete output

```bash
python3 "$PROTOCOL_SOURCE/package-study-protocol.py" package \
  --directory /ABS/original-operation/receiving \
  --out /ABS/delivery/NCT03529110_Protocol_Research_Delivery.zip
```

The returned JSON reports `PACKAGED`, the exact ZIP byte count and SHA-256, the selected manifest and original customer identities. Save the ZIP together with its adjacent `.receipt.json`. The adjacent `.prepared.json` is the original frozen package selection and supports interrupted publication recovery; retain it with the producer's operation.

Verify the transferred ZIP against the actual hash from that receipt:

```bash
python3 "$PROTOCOL_SOURCE/package-study-protocol.py" inspect \
  --archive /ABS/delivery/NCT03529110_Protocol_Research_Delivery.zip \
  --expected-sha256 ACTUAL_COMPLETE_ZIP_SHA256
```

`inspect` streams every member, rejects duplicate or unsafe paths and unsupported member types, checks exact metadata and inventory, and binds the original receiving/capture/source manifests. It does not open the application or infer that the recipient has imported the dossier.

The package format uses uncompressed ZIP members, sorted paths and fixed archive timestamps. This gives deterministic archive bytes for one frozen selection. Every selected source file is complete; source comments, public assets and upstream licence files are retained. The helper's explicit limits are 256 MiB per file, 512 MiB summed payload, 4,096 members and 16 MiB per JSON control document. If a larger original dossier is selected, the helper reports the limit before publication; it does not shorten source, reports or portable data.

## 4. Materialize a fresh receiving copy

On the recipient's selected equipped Linux environment, use this same packager source from the delivered programme:

```bash
python3 /ABS/package-study-protocol.py receive \
  --archive /ABS/incoming/NCT03529110_Protocol_Research_Delivery.zip \
  --directory /ABS/received/NCT03529110_protocol \
  --expected-sha256 ACTUAL_COMPLETE_ZIP_SHA256
```

Place the separately supplied programme packager at `/ABS/package-study-protocol.py`, or use the same exact source already available in the equipped environment. Its bytes are also included in both programme-source and engine-source inside the ZIP. An ordinary ZIP reader can display those source files, but the helper is the documented full verification and private extraction path.

The destination must be absent, or already be this helper's complete verified copy of the same archive. It creates a private staging directory selected by an external immutable receiving record, verifies every materialized file and receipt, then publishes the whole directory without replacing any existing path. A different or incomplete pre-existing destination is preserved.

After success, open `OPEN_FIRST.md`, the original HTML source index and the saved Research report. `RECEIVED_ARCHIVE.json` records the exact archive and manifest received. This state is named `MATERIALIZED`; importing the editable dossier is the next explicit original-engine operation.

## 5. Reopen the editable dossier through the original engine

Use a selected existing Research connection and store for the recipient. With the delivered source layout:

```bash
RECEIVED_ROOT=/ABS/received/NCT03529110_protocol
RESEARCH_SOURCE="$RECEIVED_ROOT/receiving/engine-source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers"
node "$RESEARCH_SOURCE/workspace-cli.mjs" reopen \
  --connection-file /PRIVATE/recipient-application-url.json \
  --directory /ABS/recipient-dossier-store \
  --source-file "$RECEIVED_ROOT/receiving/Research_Dossier.json.gz" \
  --sha256 ACTUAL_PORTABLE_SHA256
```

Use `portableSha256` from the package identity, or `portable.expectedSha256` in the original receiving receipt. It is the dossier-file hash, distinct from the ZIP hash.

For an explicitly selected local store without a listener, the original local CLI is:

```bash
node "$RESEARCH_SOURCE/cli.mjs" reopen \
  --store /ABS/recipient-dossier-store \
  --file "$RECEIVED_ROOT/receiving/Research_Dossier.json.gz" \
  --projection metadata
```

The original client API is `reopenFile(file, {signal, expectedSha256})`. It streams the ordinary private file through `/api/reopen-stream?projection=metadata` and returns `{dossier, source: {bytes, sha256}}`. The engine validates the portable dossier, its original revisions, source and reviewed state. Retain that actual result when recording recipient acceptance. Archive verification alone does not establish a successful native reopen.

The included `original-source` can also be reused as the capture input for an explicitly selected later Research receiving operation:

```bash
node "$RESEARCH_SOURCE/study-protocol-cli.mjs" inspect-capture \
  --directory "$RECEIVED_ROOT/receiving/original-source"
```

Pass that same directory to the original `receive --capture` command when the existing operator has selected its actual target question and operation. Keep the delivered immutable directory unchanged and use a separate working directory for any continuation.

## Interruption, replay and publication

| Observed point of interruption | Supported continuation |
|---|---|
| Original capture or receiving is incomplete | Resume its exact original command and selection. Its existing native receipts determine completed work. |
| ZIP staging is incomplete | Repeat the same package command. Only its exact frozen unpublished staging file may be rebuilt. |
| Complete ZIP exists but its receipt is missing | The helper verifies the complete original selection and recovers only the missing receipt. It preserves the ZIP bytes. |
| Producer files changed after a package was selected | The helper refuses the changed selection. Preserve the earlier archive/receipts and choose a separate explicit edition for changed work. |
| Fresh extraction stopped partway | Repeat the same receive command. Its immutable selection binds the private staging directory; completed files are checked and partial writes are reconciled against the original member bytes. |
| Materialized directory exists | Exact files, private modes and received-archive identity are verified before reuse. Different contents or unrelated files are refused. |
| A competing destination appeared at final publication | No destination is overwritten. The helper checks whether it is already the same complete receiving copy and otherwise leaves staging intact. |
| Disk, permissions or atomic-rename support fails | Keep the original selected files and error output. Restore the selected environment's capacity/capability, then resume that same operation. |

The helper's lock covers one chosen output path or fresh receiving target. Its source selection, staging records and receipts are create-only. Do not delete or edit them to force a different input under an old operation.

## Handover acceptance

Retain the original capture and receiving completion receipts, the complete ZIP and hash receipt, the recipient materialization result and the actual original-engine reopen result. Confirm that the recipient can open the source index/PDF, inspect the selected protocol pages and methods bindings, see the same source edition under the intended question, read the revision-specific reports, and continue from the reopened editable dossier.

The original case owner records the actual runtime, destination and operation outcomes. Source publication and archive availability are useful completed steps; successful capture, native receiving and fresh dossier reopening are recorded only from their corresponding real receipts.
