# NDTMS source projection in the existing service workspace

This extension adds a six-entity structural intake to the original Python/SQLite service workbench. It uses the existing source editions, immutable objects, reviewed cell corrections, task requests, mapping contracts, target returns, baseline/delta/rollback and complete receiving archive. It does not implement a supplier API, clinical decision system or statutory submission gateway.

## Install the complete source continuation

Use Python 3.10 or newer and the exact retained original application edition. The source composer uses only the standard library and writes a separate complete application directory. Its full-file preimage guards reject another or locally changed original edition.

```sh
python application/compose_ndtms_application.py --source ABS_ORIGINAL_APPLICATION --overlay ABS_NDTMS_OVERLAY_JSON --out ABS_COMPOSED_APPLICATION
```

The overlay is `ndtms-overlay.json` in this public source directory. It contains every complete changed/new application file and its bytes/SHA-256. The composer verifies every original APPLICATION.json member, preserves all unmodified source and original case documents locally, applies only matching postimages and generates a complete new APPLICATION.json. It does not alter a workspace or run the operator. Replaying the same output requires every complete composed byte to match. A changed source edition needs explicit composition with its actual current full source, not an override of the preimage guard.

Start the existing operator against the intended existing workspace:

```sh
python ABS_COMPOSED_APPLICATION/operator/server.py --workspace ABS_ORIGINAL_WORKSPACE
```

Open its printed loopback session URL. Keep that session token private; it is not source evidence and is excluded from portable archives. The new navigation item is **NDTMS source intake**. All original navigation and operations remain available.

## Select original data

Import a complete original CSV/TSV or source ZIP through **Source editions**. Choose the exact encoding and dialect. The workbench retains the original complete bytes, original headings, every string cell and one-based CSV record numbers, including quoted multiline cells. Existing supported encodings are UTF-8/BOM, UTF-16 and Windows-1252.

The public catalogue is `source/ndtms-cds-r-v1.3.json`, ID `ndtms-cds-r-technical-v1.3-20261013`, SHA-256 `decc19db8da3ce80ed7485629b6a8de8230a8c9152ea3e9e98ea1bc039b7f4f4`. It preserves all 290 published headers and source-derived layout/rule references. The reference blank CSV contains headers only. It is not populated clinical data.

The whole operator exposes this exact installed catalogue through its authenticated `GET /api/ndtms-profile`. Do not substitute an inferred later dataset or a supplier template.

Select an actual original edition/table, declared cohort and extraction scope. Cohorts are `adult`, `young-person`, `mixed`, `secure-setting` or `other-declared`. Record the actual published AD/YP/SA/SY population in the note. These declarations do not implement cohort-specific clinical applicability.

Scopes are `full`, `reporting` or `changed-since-prior-submission`. A partial/changed scope requires calendar from/to dates and a source-population note. Changed-only additionally requires a separate retained prior source edition, a source reference and an explicit relationship/limits note. The adapter retains that prior original object identity but does not infer its submission acceptance or completeness. A vendor-return baseline is a different original record and is not used as an NDTMS submission reference.

## Structural analysis and original corrections

The exact action is `analyse-ndtms`:

```json
{
  "editionId": "ACTUAL_ORIGINAL_EDITION_ID",
  "tableId": "ACTUAL_ORIGINAL_TABLE_ID",
  "profileId": "ndtms-cds-r-technical-v1.3-20261013",
  "cohort": "adult",
  "scope": {
    "kind": "full",
    "from": null,
    "to": null,
    "agency": "EXACT_SOURCE_AGENCY",
    "note": "Actual source population, authority and known exclusions."
  }
}
```

For a changed extract, add `scope.priorSubmission = {editionId, reference, note}` with the actual separate retained prior edition. No identifier is synthesized from a person name.

The analysis checks all exact unique published headers, source widths, opaque identities and parent ownership, Y/N consent, one child group per row, repeated entity equality, calendar dates, declared character maxima, unambiguous numeric shape and whitespace. Every source row remains in the full raw/effective artifact. Every projected witness retains original row identity/proof, effective hash, all applicable correction IDs, complete projected variant and extension values. Conflicting variants remain separate; a conflicted entity has `values: null`, not a chosen first/last value.

Every finding returns `rowIds` and `sourceRows:[{sourceRowId,sourceRow}]`, scoped to the actual edition/table. This includes invalid rows that could not form an entity. Open the original row, review a specific cell with its source basis and use the existing correction dialog. A correction never changes original bytes. Create a successor analysis; previous analyses, variants and artifacts stay immutable. Publishing a now-stale analysis is rejected.

### Consent partition

A native client with both consented and minimal no-consent episodes remains one native client. The normalized source adds explicitly generated `NDTMS_CONSENT_SCOPE` and separate Y/N client projections. It may therefore contain more client projection rows than native clients.

For N rows, only original AGNCY, CLIENTID, EPISODID and CONSENT values may be populated. Any other supplied value is retained as a finding and original source, never copied into the minimal projection. Y values do not fill blank N attributes. Generated keys/context are adapter metadata, not asserted supplier or NDTMS columns.

Normalized client key is AGNCY + CLIENTID + NDTMS_CONSENT_SCOPE. Episode-to-client joins include that partition. Episode key remains AGNCY + CLIENTID + EPISODID; changing consent for the same episode is a conflict. Child keys add their exact MODID, SUBMID, TOPID or CIRID.

## Publish and receive through the existing mapping workflow

`publish-ndtms` takes only `{analysisId}`. It checks structural readiness, the exact unchanged original/correction selection and complete immutable projection indexes before publishing. The resulting source ZIP contains precisely these six mapping tables:

| Table | Original source group |
| --- | --- |
| client | Columns 1–9 and native client identity |
| episode | Columns 10–103 and parent identity |
| intervention | Columns 104–110 |
| sir | Columns 111–190 |
| top_ypor | Columns 191–256 |
| cir | Columns 257–290 |

All six tables are present even when a group has zero records. The archive also retains the full original source/table bytes, catalogue, source/effective rows, entity variants, lineage, complete findings, manifest and readable HTML report. Original CSV/ZIP members are byte-identical `.bin` aliases under `originals/`; the manifest's original object references preserve their names and hashes. This avoids importing a seventh denormalized or blank table.

The archive enters the ordinary `import_edition` transaction. The operator opens this real edition in the existing mapping-contract builder. Select the actual vendor-approved columns, keys, relationships, transforms, complete exit format and permitted load route. No contract is automatically approved. A projection that is structurally ready is not clinical acceptance, successful supplier import or NDTMS acceptance.

Obtain actual returned files after the supplier's sanctioned load. Use the existing target-return binding and field comparison, retaining actual returned identities/versions only when the real supplier provides them. Original record absence does not authorize deletion. Complete exit scope, notes, attachments, history and any priced export work must be agreed separately with the supplier.

## CLI and interrupted continuation

The addon CLI uses the same Workspace writer. Supply a stable request ID and original expected revision, actor and complete data JSON:

```sh
python ABS_COMPOSED_APPLICATION/ndtms_cli.py --workspace ABS_WORKSPACE analyse --data ABS_SELECTION_JSON --request-id ORIGINAL_REQUEST_ID --expected-revision ORIGINAL_REVISION --actor-id ORIGINAL_ACTOR --actor-name "Original operator" --save-request ABS_ORIGINAL_REQUEST_JSON
python ABS_COMPOSED_APPLICATION/ndtms_cli.py --workspace ABS_WORKSPACE publish --data ABS_ANALYSIS_SELECTION_JSON --request-id ORIGINAL_PUBLICATION_REQUEST_ID --expected-revision ORIGINAL_REVISION --actor-id ORIGINAL_ACTOR --actor-name "Original operator" --save-request ABS_ORIGINAL_PUBLICATION_REQUEST_JSON
python ABS_COMPOSED_APPLICATION/ndtms_cli.py --workspace ABS_WORKSPACE status ORIGINAL_REQUEST_ID
```

The request file is saved completely before mutation. On retry, the CLI uses that original full request, verifies the same command/ID/revision/actor, and compares current data when its staging file still exists. Removed staging JSON does not prevent original replay. Changed data or reused identity rejects. Workspace resolves an already committed request before checking the current revision. Do not create a new request to guess around an unknown response.

Read-only commands `profile` and `blank` output the actual complete catalogue and blank header template. Original API pagination remains revision-bound and limited to 200 rows per page. New kinds are `ndtms-analysis`, `ndtms-findings`, `ndtms-rows` and `ndtms-lineage`; analysis filters use its actual analysisId.

## Meaningful native receiving in the existing programme

The included course uses labelled fictional data only:

```sh
python ABS_COMPOSED_APPLICATION/native/ndtms_receiving.py --work ABS_ORIGINAL_PROGRAMME_DIRECTORY --operation-id ORIGINAL_NDTMS_RECEIVING_OPERATION
```

It retains one kernel-backed owner lease, exact source/profile/input selection and every original request before mutation. Eight authored original rows exercise a repeated-episode conflict, all four child groups, repeated equal witnesses and mixed consent for one native client. A reviewed original correction produces ten normalized rows: three client partitions, three episodes and four child records.

The course then uses the real original mapping/approval/release, separate owned local target, full native returned files, accepted baseline, successor delta, actual stale-write refusal, field-level verification, rollback and independent complete workspace/application receiving. The local schema and target are explicitly authored examples; no supplier system is contacted.

Its result `NDTMS_NATIVE.json` retains all original source/analysis/correction/contract/target IDs, actual artifact paths, complete backup and original independent receiving. On replay it validates original request receipts and artifacts, uses the same original backup and preserves later source/target/recipient descendants. It does not generate a new backup into the original receiving destination after browser edits. Missing selected artifacts can be restored create-only from their full original immutable objects; changed bytes are preserved and rejected.

The optional original browser join is executable in the same command:

```sh
python ABS_EXECUTING_APPLICATION/native/ndtms_receiving.py --work ABS_ORIGINAL_PROGRAMME_DIRECTORY --operation-id ORIGINAL_NDTMS_RECEIVING_OPERATION --node ABS_EXISTING_NODE --playwright ABS_EXISTING_PLAYWRIGHT_MODULE_FILE --chromium ABS_EXISTING_CHROMIUM --attachments ABS_OUTGOING_SELECTION_JSON --application-archive ABS_EXACT_OUTGOING_APPLICATION_ZIP
```

All three runtime flags are supplied together. The optional attachment JSON is an array of exact absolute `{path,bytes,sha256}` identities. The named application archive must be one of those attachments; its complete root-level file inventory and embedded APPLICATION.json must match the actual executing source. Run this command from the application unpacked from that exact outgoing ZIP. Every selected file and the original manifest are retained before browser dispatch. Missing original staging can reopen from those bytes; changed input or runtime rejects.

The browser owner reuses the original maintained process/listener lifecycle. It operates the source workspace, retains its first complete backup and receives its actual destination, then starts the same original application there for independent browser reopening. Full native/browser IDs, inputs, phase results, screenshots, draft sidecars and every recovery branch remain under the original programme directory. No manually authored session JSON is required. The full operator and browser guide is [NDTMS_OPERATOR_GUIDE.md](NDTMS_OPERATOR_GUIDE.md).

A native `CORE_COMPLETE` result is separate from rendered delivery. Use the same existing operator/browser owner to open the source workspace and independent receiver, operate source findings/corrections/analysis/publication/mapping, inspect full reports and open complete downloaded archives. View desktop 1440 and narrow 390 widths, and personally LOOK at actual screenshots. Open every outgoing attachment and every applicable report/PDF page, use the important controls, download and reopen the exact result. Source review, parsing, metadata or another peer's approval does not satisfy this requirement. Retain precise actual gaps rather than claiming an unexecuted runtime.

## Limits and interpretation

Existing intake limits remain 512 MiB total/expanded input, 256 MiB per member, 250,000 rows across an imported edition, 20 CSV tables, 1,000 archive members and 2 MiB per cell. The projected six-table row sum must fit the original row limit. Source-row count does not equal normalized entity count. These are selection ceilings, not measured throughput or a commissioned population promise.

The catalogue identifies clinical/reference rules; this adapter does not claim to execute every reference list, sentinel, cohort applicability, historical introduction/trigger rule or intervention sequencing exception. Those remain explicitly listed in each analysis. Unknown, missing and zero source tokens remain distinct strings. Scope declarations, original supplier authority, full exit obligations and actual recipient acceptance remain visible responsibilities.

No new credentials, external send, buyer account, supplier API, watcher or controller is created by this addon.
