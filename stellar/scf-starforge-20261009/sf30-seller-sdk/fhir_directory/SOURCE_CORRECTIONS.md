# Source corrections in the Human Services Directory

The correction workbench lets an operator prepare, review and accept changes to exact retained HSDS rows. It keeps the original input files and every frozen edition, creates complete derived source files, and records the relationship between the original and accepted candidate. Open **Source corrections** in the existing private Directory operator.

The original source/index engine still owns parsing, record IDs, reference resolution, edition construction and comparison. The correction engine uses those same files and records. No correction request writes to a publisher endpoint, reserves a service, changes clinical data or establishes current service availability.

## Complete operator workflow

1. Open the exact original frozen edition. The edition picker and original-row browser follow all native pages, with table and full-record search.
2. Open an original HSDS row. The editor keeps its source ID, record ID and full row/resource/member hashes. Read or download the complete original JSON record. CSV rows additionally expose all physical headers and cells, including duplicate or blank headers, missing cells and extra positions.
3. Choose an explicit edit. JSON-set sends complete JSON text at a relative RFC6901 pointer; JSON-remove removes a selected field or array item. CSV-cell replaces one zero-based physical position. CSV-row replaces the entire ordered array of string cells and can explicitly repair a ragged row. Enter the reason for each edit.
4. Finish each row editor and arrange the complete ordered edit list. The engine permits repeated edits to one row in order. Distinct selected rows cannot be ancestors or descendants of each other. Keep the original edition bound while edits exist.
5. Save the complete correction plan. Saving does not accept a candidate. Build its full preview, then review the original before/after values, complete source pairs, candidate edition inventory and native comparison.
6. Accept that exact candidate using its preview ID and original expected edition ID. Acceptance retains an immutable correction record. It does not replace a mutable edition head.
7. Receive the complete correction packet and full editable workspace. The packet carries original and derived input files, ordered changes and the review graph. The workspace also carries source indexes, complete clinical/Directory history and all prior product records.

Original plans, previews and accepted corrections stay available in **Saved history**. A saved plan can become a new working copy over its same original edition. **Start successor from accepted edition** selects the accepted candidate as the new basis, links its accepted correction and asks the operator to choose fresh original row references. The optional predecessor identifies a prior **accepted correction**, rather than an arbitrary plan or unsaved draft.

## Working copies and interrupted requests

The operator retains the complete working request, unfinished editor text and original pending request in its browser session. **Save working JSON** downloads the same complete state; **Open working JSON** checks the entire selected file before replacing the current draft. An imported malformed working file leaves the current draft in place. Controls are frozen while a request or original-file read is pending.

If browser storage cannot retain the complete working input, the operator states that explicitly and asks the operator to download working JSON before leaving. A pending native request keeps its exact action and body. **Retry original request** sends those same bytes as JSON values; it does not substitute a new selection. The original native engine owns immutable request recovery. A working copy is not evidence that a native mutation completed.

Saving input preserves a lexical JSON value as its original text string. It does not round large numbers through JavaScript numeric values. RFC6901 escaping and physical CSV positions remain explicit. Original numeric lexemes, original source bytes and unedited byte ranges are retained by the native engine.

## Native API and CLI

All API routes use the existing private loopback operator and original Bearer authentication. The source-owned catalogue is available at GET /api/directory/catalogue. Its correctionsCatalogue and four correction_* input schemas are the authoritative accepted forms.

| Action | HTTP | Python method | Native CLI |
|---|---|---|---|
| Prepare complete ordered input | POST /api/directory/corrections/prepare | prepare_directory_correction | correction-prepare |
| Build immutable full candidate | POST /api/directory/corrections/preview | preview_directory_correction | correction-preview |
| Accept selected candidate | POST /api/directory/corrections/apply | apply_directory_correction | correction-apply |
| Retain full correction packet | POST /api/directory/corrections/export | export_directory_correction | correction-export |

Use the exact input in a private file:

```bash
python fhir_directory/cli.py correction-prepare --workspace /ABS/WORKSPACE --input /ABS/prepare.json
python fhir_directory/cli.py correction-preview --workspace /ABS/WORKSPACE --input /ABS/preview.json
python fhir_directory/cli.py correction-apply --workspace /ABS/WORKSPACE --input /ABS/apply.json
python fhir_directory/cli.py correction-export --workspace /ABS/WORKSPACE --input /ABS/export.json
```

The prepare input requires label, editionId, actor and edits. Optional note and predecessorId retain the explicit original context. Every edit requires sourceId, recordId, rowSha256, resourceSha256, memberSha256, action and reason, plus exactly the fields for its action:

| Action | Additional fields | Meaning |
|---|---|---|
| json-set | pointer, valueJson | Set one complete lexical JSON value; empty pointer replaces the selected complete row |
| json-remove | pointer | Remove a named field or array entry; empty pointer is not accepted |
| csv-cell | column, value | Replace an existing physical cell using exact text |
| csv-row | cells | Explicitly replace the complete ordered string-cell array |

Preview input is {planId}. Apply input is {previewId, expectedEditionId, actor, note?}. Export input is {correctionId, actor, label?, note?}. All identities are exact lowercase 64-hex native record hashes.

Read full records and complete history through existing generic routes:
GET /api/directory/{correctionPlans|correctionPreviews|corrections}[/:id].
Read all ordered edits or changes at
GET /api/directory/{collection}/:id/rows?offset=0&limit=50.
Follow each returned nextOffset until null; a page is a contiguous portion of the complete original sequence.

Read complete retained files at
GET /api/directory/{collection}/:id/files/:fileKind.
Plans expose input. Previews and accepted corrections expose changes (JSONL) and review (complete JSON graph).

```bash
python fhir_directory/cli.py records --workspace /ABS/WORKSPACE --kind correctionPlans --offset 0 --limit 50
python fhir_directory/cli.py rows --workspace /ABS/WORKSPACE --kind correction --collection corrections --id SHA --offset 0 --limit 50
python fhir_directory/cli.py file --workspace /ABS/WORKSPACE --kind correction --collection correctionPreviews --id SHA --member changes --out /ABS/Changes.jsonl
python fhir_directory/cli.py file --workspace /ABS/WORKSPACE --kind export --id EXPORT_SHA --out /ABS/Complete_Correction.zip
python fhir_directory/cli.py file --workspace /ABS/WORKSPACE --kind workspace --out /ABS/Complete_Workspace.zip
```

## Complete SDK, MCP and customer receiving

The maintained merchant-human-services-directory CLI and provider expose directory_correction_prepare, preview, apply and export, directory_correction_rows and directory_correction_file. Existing directory_records/directory_record include all three new collections. These use the same original native connection, immutable response retention, complete-file downloader and Merchant server as the rest of the Directory.

The typed SDK adds changeHumanServicesDirectoryCorrection, readHumanServicesDirectoryCorrection, iterateHumanServicesDirectoryCorrection, downloadHumanServicesDirectoryCorrectionFile and downloadHumanServicesDirectoryCorrection. Each returned file is checked against its native descriptor before the full retained export is received. The source.payloadFile declaration selects the original payload; original-artifact.json remains metadata.

Preparation, preview and acceptance remain separate SDK calls. A helper does not silently preview or accept an unreviewed request. Failed calls retain the original input in error details so the caller can reconcile that same request.

See [CORRECTION_CLIENTS.md](CORRECTION_CLIENTS.md) for the complete operated browser/Merchant/customer programme. The final customer result identifies the archive exported from the actually received customer workspace. The producer archive remains separately identified as sourceWorkspacePacket.

## Limits and receiving compatibility

The native correction input is limited to32MiB, at most10,000 ordered edits, and at most16MiB for each authored lexical value or CSV cell. Original source files remain limited by the original256MiB source/index engine. Native interactive pages have their existing4MiB budget and up to250 rows. Native full editable Directory receiving permits the existing2GiB complete archive bound.

Connected calls preserve the existing inline request limit and declared host-input transport. Use the native CLI for accepted complete correction inputs above the connected request limit. Connected complete-file receiving retains the existing512MiB limit; larger native archives remain directly available through native routes. No route truncates an accepted original input or file to fit a smaller transport.

Complete workspace receiving accepts the exact prior product registry sets or the entire new set including correctionPlans, correctionPreviews and corrections. It does not accept arbitrary missing collections. Reachability includes complete plan input, change/review files, original and derived source/index files, and every changed original/derived member. Native semantic verification checks the received correction graph against retained original source data. Receiver-local receives records retain the existing local import semantics.

A corrected edition is an explicitly authored local source interpretation. Conformance assessment, service selection, FHIR conversion and referral assignment remain separate reviewed operations on whichever edition the operator actually selects.
