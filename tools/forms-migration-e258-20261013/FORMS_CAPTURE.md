# FormAssembly original-source capture

TokenJunkieLabs — complete selected exports and attachment custody.

## Purpose and boundary

This collector receives exact selected originals for the six forms migration classes: definitions, settings, responses, uploads, workflow and downstream. It uses documented FormAssembly GET routes or explicitly selected existing files. It preserves complete original bodies, source hashes, individual request outcomes, ZIP member identities and unfinished attempts.

A completed capture means that the selected reads and file copies completed. It does not mean that all responses, previous field versions, workflow history or attachment parents have been accounted for. The separate mapping worksheet leaves the original discovery manifest, migration selection and table mapping unset. An operator must supply those choices and reconcile returned identifiers before running the forms workbench.

The generic collector is suitable for public source distribution. Tenant exports, tokens, original internal references and customer files remain in their authorized private case. This guide contains no customer commercial terms or credentials.

## Required software and existing source

Use Python 3.11 or later. The collector uses only the Python standard library. Keep these four source files together:

- forms_capture.py
- FORMS_CAPTURE.md
- FORMS_CAPTURE_API.json
- LICENSE

At capture creation, the program retains all four exact files under workbench/ and records their full byte counts and SHA256 values. A resumed capture requires the same selected source. A received capture can be verified and packed again without fetching software or contacting FormAssembly.

The official API source is https://github.com/FormAssembly/formassembly-api. This implementation follows its README Git blob 45c1369e687e0e9f73ec919accb3a521379b8316, 21,868 UTF-8 bytes, SHA256 77a4633eacdf8cd67cdec5af6f4336edbff11c7d3574ac4b8b0e316b1a787884. Reconcile an actual tenant's supported API and permissions with the original account owner before selecting live reads.

## Complete original selection

The input is a UTF-8 JSON object with schema tjlabs.forms-capture.selection.v1. Duplicate JSON keys and nonfinite numbers are rejected. FORMS_CAPTURE_API.json provides the complete route and field contract.

Set label, edition and authority_reference to the actual source selection. Set data_class to DEMONSTRATION for invented data, or AUTHORIZED_CUSTOMER_EXPORT for an explicitly authorized export. This value is shared with the original discovery engine.

All six classes require a disposition of include, exclude or defer and a human-readable reference. Excluding a class is a recorded scope decision; it is not a successful migration of that class.

A local asset records id, asset_class, side, availability, content_state, path, bytes, sha256, filename, media_type and provenance. side is source, target or shared. For PRESENT originals, path is relative to the selected input root and bytes/sha256 must match the complete original file. For MISSING or REDACTED bodies, path, bytes and sha256 are null. A physically received file with redacted cells is PRESENT with content_state REDACTED.

content_state is independently COMPLETE, PARTIAL, REDACTED or UNASSESSED; it defaults to UNASSESSED. COMPLETE is the operator's explicit coverage assessment of the selected original, not an inference from receiving a file. Preserve partial histories and inaccessible classes as such.

Asset and request IDs are safe identifiers up to 48 characters. Generated attachment member IDs remain within the workbench's 96-character identifier limit. Avoid names that collide with generated -zip or -m000001 suffixes.

Whole PDFs, JSON, XML, CSV, form packages, settings, scripts, history exports, vendor receipts and other ordinary files can be retained as local originals. The collector does not parse or reinterpret their opaque content. It never edits the originals in place.

For an existing authorized inventory, calculate identities before freezing the selection:

```python
from pathlib import Path
import hashlib
import json

root = Path("/absolute/private/originals")
rows = json.loads(Path("selected-originals.json").read_text(encoding="utf-8"))
for row in rows:
    if row["availability"] == "PRESENT":
        path = root / row["path"]
        h = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                h.update(block)
        row["bytes"] = path.stat().st_size
        row["sha256"] = h.hexdigest()
    else:
        row.update(path=None, bytes=None, sha256=None)
Path("measured-originals.json").write_text(
    json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
```

Review the actual selected paths and full content before copying these measured rows into local_assets. This small identity calculation does not assess historical coverage or authorize access.

## Documented GET routes

The selected tenant is an exact HTTPS origin without a path, query, fragment, username or password. Enterprise instances use their actual tenant origin. The API prefixes are supplied by the named route, never by an arbitrary URL in the selection.

| Route name | Original relative route | Formats |
| --- | --- | --- |
| forms_index | api_v1/forms/index.{format} | json, xml |
| admin_forms_index | admin/api_v1/forms/index.{format} | json, xml |
| form_definition | api_v1/forms/view/{id}.{format} | json, xml |
| responses_export | api_v1/responses/export/{id}.{format} | csv, json, xml, zip |
| connectors_index | api_v1/connectors/index/{id}.{format} | json, xml |
| connector_definition | admin/api_v1/connectors/view/{id}.{format} | json, xml |
| themes_index | api_v1/themes/index.json | json |
| theme_definition | admin/api_v1/themes/view/{id}.json | json; original body may be CSS |
| form_elements_index | api_v1/form_elements/index.xml | xml |
| form_element_definition | admin/api_v1/form_elements/view/{id}.xml | xml |

Every request includes its original id, asset_class, side, route, format, provenance and optional content_state. Routes with an object ID require the original numeric ID as a string. Optional expected_media_type checks the actually returned base media type after retaining the original body.

No create, edit, delete, reset, import, submit, token registration or token refresh route is available. There is no generic authenticated URL fetch. HTTP redirects are retained as non-success responses, never followed with credentials.

Use an existing authorized user token from a named environment variable. Do not place the token or an authenticated URL in the selection, filename, provenance, shell arguments or guide. The documented API uses an access_token query parameter; the program constructs that parameter only in memory. Retained request descriptors omit it. Exceptions from networking libraries are normalized rather than printing a credential-bearing URL. The original response bytes remain intact and private.

Form definition raw=1, response unlock=1 and admin routes require the actual owner's corresponding authority. They are only requested when explicitly selected. The collector does not escalate permissions.

## Response selection and historical coverage

For responses_export, choose exactly one of these finite strategies:

1. Explicit response IDs: params.response_ids is a nonempty array of distinct numeric strings. coverage.basis is EXPLICIT_RESPONSE_IDS and coverage.reference records the original membership source. Do not mix this with page or page_size.
2. Reviewed pages: each request explicitly supplies positive page and page_size integers. coverage.basis is REVIEWED_PAGE_INVENTORY; coverage.inventory_id names the complete original page selection and coverage.reference explains its source. List every selected page as its own request.

The collector never requests a following page because a CSV contains a particular number of rows, and never stops because a page is short. The official README documents no stable response JSON envelope, returned total or terminal pagination marker, so the collector preserves JSON and XML without inventing one.

The official export troubleshooting guidance, https://help.formassembly.com/help/340336-export-troubleshooting, says repeated-section values can occupy additional Excel/CSV rows and current CSV exports may omit data collected with earlier field versions. A CSV row count is therefore not an API response count or proof of historical completeness. Any historical recovery requiring live form changes belongs to the authorized original form owner; this read-only program does not perform it.

Selected date_from, date_to, flag, unlock and filter values are retained exactly. filter=all explicitly includes incomplete responses; when it is absent, coverage.json records the documented default exclusion. Historical field-version coverage remains unassessed until actual originals and authoritative returned membership are reconciled.

Multiple GETs are separate observations with retained timestamps. They do not create an atomic tenant snapshot. Resume reuses completed original operations and retries only unfinished selected operations, retaining the earlier attempts. A source that changes between attempts remains visible through its original received bytes and dates.

## ZIP export and original attachment bodies

The official API FAQ describes a ZIP export response that contains a relative uploads/get_zip/...zip path. Choose the actual response contract in request.zip:

- mode none retains the original response without interpreting it.
- mode direct requires the first response to be the ZIP itself.
- mode pointer_text treats the first full response as a plain returned path.
- mode pointer_json_string treats it as a JSON string containing that path.

The collector retains the first response in all cases. A pointer must be the documented relative path on the same selected tenant. It cannot contain an external origin, query or fragment. Choose authentication none or same_token for the second GET according to the actual tenant's authorized contract. There is no automatic credential fallback.

For a local complete ZIP, set inspect_zip true on that local asset. The original ZIP remains one complete asset and every directory entry is inventoried by its original ordinal, name, duplicate-name count, declared size, compression size, CRC, mode and flags. Ordinary member bytes are streamed into controlled ordinal filenames; original ZIP names are never used as filesystem destinations. Duplicate names remain separate entries. Parentage is never inferred from a name.

Generated IDs are ORIGINAL_ID-m000001 for direct or local ZIP members, or REQUEST_ID-zip-m000001 when a separate pointer ZIP is fetched. The intermediate ZIP asset in the second case is REQUEST_ID-zip. Ordinals start at one and include directory entries, so preserve the inventory rather than assuming sequential attachment IDs without gaps.

Encrypted or unsupported members and explicit capacity failures remain visible in the retained original archive and operation state. The collector does not supply passwords or execute extracted files. A request or member failure does not erase the earlier original response, ZIP or partial attempt.

Complete selected local files can alternatively be supplied individually; that route is preferable when a ZIP's encryption or proprietary packaging requires its original owner's tools.

## Explicit attachment links and worksheet

attachment_links contains actual operator-selected workbench attachment declarations. Each declaration includes:

- entry_id and logical_id;
- source or target side;
- exact asset_id for a present body; an unavailable attachment may retain the exact missing/redacted asset declaration ID, or null if no declaration exists;
- availability;
- canonical form_key, response_key, field_key and repeat ordinal;
- original filename and media_type;
- parent table, one-based raw record ordinal, full key_columns and literal key_values;
- the original mapping reference.

An unavailable asset declaration retains its original identity, filename and provenance while its path, byte count and hash remain null. Referencing that declaration never asserts that a body was received.

These are declarations, not discoveries. An inspected ZIP member becomes a verified attachment only after an operator links it to the actual parent record and returned target identity. The collector's attachment_link_review reports captured body scope separately from UNRECONCILED parent status. It does not label a link MATCHED.

mapping-worksheet.json contains all original asset declarations and full selected attachment links. Its status is MAPPING_REQUIRED. Fill the original discovery_manifest, migration_selection, table_assets and pair_classes in a new forms workbench intake, preserving all selected opaque originals. Use the capture directory as that intake's input root so each emitted asset path resolves directly. Explicit CSV projections are separate source assets with their own provenance; never silently replace opaque originals with inferred tables.

Missing source bodies, redacted content, unexported workflow history, unexamined configuration and absent downstream receipts must remain explicit across all six classes. A successful CSV comparison cannot fill those gaps.

## Run and resume the original capture

Use a distinct output directory outside the original input root. The initial output must not exist.

```bash
python /absolute/source/forms_capture.py capture \
  --selection /absolute/private/capture-selection.json \
  --input-root /absolute/private/originals \
  --output /absolute/private/capture
```

For actual authorized API reads, add --token-env with the name of the already populated token environment variable:

```bash
python /absolute/source/forms_capture.py capture \
  --selection /absolute/private/capture-selection.json \
  --input-root /absolute/private/originals \
  --output /absolute/private/capture \
  --token-env FORMASSEMBLY_EXISTING_TOKEN
```

Do not put the token value on the command line. No API call occurs when requests is empty.

A complete original operation writes an immutable attempt receipt and exact member list before publishing its current pointer. Resume reconciles a completed receipt if interrupted before that final pointer update. It verifies the original source files and selection bytes before any further request.

```bash
python /absolute/source/forms_capture.py capture \
  --selection /absolute/private/capture-selection.json \
  --input-root /absolute/private/originals \
  --output /absolute/private/capture \
  --token-env FORMASSEMBLY_EXISTING_TOKEN \
  --resume
```

An active original process retains its lock. A same-host dead process lock may be retired by --resume after a real PID liveness check. A different host's lock must be resolved by its original owner. Do not create a parallel receiver or copy a live case directory to evade the lock.

The exit codes are 0 for a completed selected capture or successful verify/pack/receive, 3 for CAPTURED_WITH_GAPS, and 2 for an operation error. A complete selected capture can still contain declared missing or redacted assets; inspect coverage, class dispositions and attachment reviews. API failures retain the original response and stop later API requests. There is no automatic rate-limit retry or sleep loop; honor the actual retained Retry-After and the original account owner's schedule before an explicit resume.

## Retained files

| File or directory | Meaning |
| --- | --- |
| selection.original.json | Exact original selection bytes |
| selection.json | Parsed selection preserved in canonical readable JSON |
| source-files.json and workbench/ | Exact selected collector, API, guide and license |
| attempts/ | Every original request, response, body, ZIP inventory and attempt receipt |
| operations/ | Current original operation pointers and receipt hashes |
| assets.jsonl | Complete selected asset population; one JSON object per line |
| archive-members.jsonl | Complete successfully inventoried attachment member records |
| coverage.json | Selected versus completed operations and unresolved source coverage |
| mapping-worksheet.json | Whole raw-source worksheet, with mapping left explicit |
| capture.json | Actual capture state, original selection identity and source identity |
| delivery.json | Exact complete retained file inventory with bytes and SHA256 |

If archive extraction stops, the raw ZIP and original-inventory.json under that attempt preserve the source even when the successful-member population is incomplete. Incomplete operation files remain in the full delivery archive. Do not call those partial bodies verified attachments.

## Verify, pack, receive and reopen

```bash
python /absolute/source/forms_capture.py verify --capture /absolute/private/capture
python /absolute/source/forms_capture.py pack \
  --capture /absolute/private/capture \
  --output /absolute/private/FormAssembly_Original_Capture.zip
python /absolute/source/forms_capture.py receive \
  --archive /absolute/private/FormAssembly_Original_Capture.zip \
  --output /absolute/private/received-capture
python /absolute/private/received-capture/capture/workbench/forms_capture.py verify \
  --capture /absolute/private/received-capture/capture
```

Receiving writes an exact inner capture/ directory and a separate outer receiving.json. The inner directory remains independently verifiable and can be packed again with the same original sources, outcomes and unfinished history. receive defaults to a 20 GiB expanded archive ceiling; --max-bytes explicitly selects a different positive capacity. Member hashes, unique paths, ordinary file types and whole selection identity are checked before the destination becomes visible.

A capture archive includes complete selected collector software and original data. It is distinct from the later complete forms workbench project archive, which adds the explicit mapping, returned-target reconciliation and whole inspector. Retain both identities and the original owner decisions.

To continue an incomplete capture from a received archive, use its exact retained selection.original.json, the restored original input files for unfinished local operations, the received collector, and --output pointing to the inner capture/ directory. Complete original operations are reused. Live API continuation still requires actual authorization and the existing token environment.

## Receiving and visual operation

The collector is a command-line custody tool. Its complete native course must verify actual source files, source identities, full archive receiving and a cold reopen. It must not report a source-only code review as a completed native capture.

The joined forms workbench course operates the actual rendered inspector, all six asset classes, full original source/attachment downloads, explicit parent evidence, mapping alternatives, complete project export and independent cold receiving. Open and view the actual outgoing images and documents. Operate important controls at desktop and narrow widths, inspect generated screenshots, and reopen the exact exported files. Preserve existing user browser tabs and any current owner reservation. Use the original coordinated equipped operation rather than starting a duplicate case.

This software records observed files and explicit selections. Human acceptance, migration authorization, contractual signature and any subsequent customer correspondence remain with the original authorized owner.
