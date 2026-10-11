# Audit interchange, reports, and receiving

The exchange layer carries a complete selected audit from preserved original inputs through mapping, reviewed audience reports, declared target tables, and a receiving operation that can resume without duplicating records. It operates on Python objects and bytes. The host owns authenticated access, transactions, original-file storage, and full encrypted workspace backup.

The shared format is an authored product contract. Public University Audit Services process and sample documents inform the report hierarchy and audience distinctions. Target-specific table definitions belong to an explicitly selected source contract.

## Files and runtime

- `audit_operator/exchange.py`: normalization, validation, packages, source custody, receiving plans and conflict resolution, ordered target tables, full returned-row comparison, and CLI.
- `audit_operator/reporting.py`: the same audience projection used by local access views and exports; HTML and CSV reports.
- `examples/EXCHANGE_PRACTICE.py`: one complete Practice operation covering mixed units, successful controls, all eight audiences, original sources/evidence, receiving/replay/conflict resolution, and a changed native return.

The modules use the Python standard library. Run the CLI from the operator root:

~~~sh
python -B -m audit_operator.exchange --help
~~~

The host supplies the authenticated grant; an audience object alone does not authenticate a caller.

## Stable record and source identity

Every domain record has this envelope:

~~~json
{
  "kind": "observation",
  "id": "observation-<32 lowercase hex characters>",
  "revision": 1,
  "source": {
    "namespace": "retained-original-system",
    "id": "original-row-identifier",
    "revision": "original revision or exact row hash",
    "locator": "original table, row, or document reference"
  },
  "payload": {},
  "created_at": null,
  "updated_at": null
}
~~~

`stable_record_id(kind, namespace, source_id)` returns:

~~~text
kind + "-" + SHA256(kind + NUL + namespace + NUL + source_id)[:32]
~~~

Namespace and original ID are strings. Leading zeroes matter. Row position is a locator and is never substituted for a missing identity.

A new normalized row starts at local revision 1, unless it explicitly supplies a positive integer revision. The upstream revision remains in `source.revision`. Corrections and resolved competing versions advance local revisions without rewriting original source files.

Supported families are engagement, audit_area, sub_activity, observation, management_action, evidence, review_decision, receiving_projection, follow_up_review, source_mapping, risk, workpaper, advisory_memo, and questionnaire_response. A planning risk may exist before an engagement is assigned. Full auditor access and the host's workspace backup preserve it; a selected engagement handoff omits it explicitly.

A source snapshot is:

~~~json
{
  "format": "commons-audit-snapshot/1",
  "workspace_id": "original-workspace-id",
  "captured_at": "2026-10-11T12:00:00Z",
  "records": [],
  "sources": [
    {
      "id": "retained-original-file-id",
      "name": "original.csv",
      "sha256": "<64 lowercase hex characters>",
      "bytes": 123,
      "media_type": "text/csv",
      "role": "original_input"
    }
  ],
  "revisions": []
}
~~~

`sources` refers to exact retained bytes. `revisions` is optional and is included only in a full auditor handoff. `blob_resolver(sha256)` resolves bytes internally without publishing a local custody path.

Evidence has two identities. Its envelope identifies the evidence record; `payload.source_id` identifies its retained file. Use `record_source_id` for the row identity when importing a row that also needs `payload.source_id`. For ordinary rows without that ambiguity, `source_id` remains the convenient row-identity input. Exact source adoption preserves incoming file IDs, or records an explicit original-ID mapping when conflicting file IDs must coexist.

## Original rows and reviewed mappings

~~~python
normalized = normalize_records(
    rows_by_kind,
    mappings,
    source_namespace="retained-original-system",
)
if normalized["valid"]:
    # Host preflights and commits this complete result in one transaction.
    records = normalized["records"]
~~~

`rows_by_kind` maps each family to object rows or positional arrays. The result contains `records`, `mappings`, `diagnostics`, `valid`, and per-family `counts`. Diagnostics identify the row, family, field, or canonical record where available.

Already-named object rows work with an empty mapping. Positional rows require explicit ordinal mappings. Original source values stay in the auditor record's `payload.source_values`, while the original input file remains byte-for-byte in custody. Local custody-path metadata is excluded from portable fields.

Mappings can be:

1. `{kind: [field rules]}`;
2. a list of field rules carrying `record_kind`;
3. saved `source_mapping` Records whose payload contains `record_kind`, `mappings`, revision, and native contract reference.

Example:

~~~json
[
  {
    "record_kind": "observation",
    "source_field_or_ordinal": 0,
    "target_field": "record_source_id",
    "transform": "string",
    "null_rule": "required"
  },
  {
    "record_kind": "observation",
    "source_field_or_ordinal": 1,
    "target_field": "engagement_id",
    "relationship_key": {
      "kind": "engagement",
      "namespace": "retained-original-system"
    }
  },
  {
    "record_kind": "observation",
    "source_field_or_ordinal": 4,
    "target_field": "priority_normalized",
    "transform": "value_map",
    "value_map": {"H": "high", "M": "medium", "L": "low"},
    "null_rule": "empty_to_null"
  }
]
~~~

Allowed transforms are identity, string, trim, integer, exact decimal, Boolean, ISO date, explicit value map, JSON, and a declared split separator. There are no evaluated expressions. Null rules preserve values, convert empty/blank to null, or require a value. Boolean conversion is explicit; text such as "false" cannot accidentally grant IT report access.

Foreign keys resolve to canonical IDs in the declared namespace. The complete graph is checked for missing references, wrong record families, cross-engagement links, area cycles, and conflicting duplicate identities. Identical repeated rows are coalesced with a diagnostic; their original occurrences remain in the input file.

Priority and results remain separate:

- Normalized priority is `high`, `medium`, `low`, or null. An unrecognized raw priority stays unresolved.
- Raw `O` describes an observation result at the sub-activity level. Several differently prioritized observations can belong to one sub-activity.
- The source check mark, including its retained PDF extraction glyph, maps to `no_observation`. It does not create a Low-priority finding.
- Unit-reported completion and auditor verification remain separate fields.
- Explicit action-plan dates, reference completion dates, and committee-age references remain separate fields.

The current questionnaire field is `catalog_sha256`. Legacy `catalog_sha` is accepted and retained as source data. Responses preserve the issuer's question ID and exact catalog hash. Questionnaire responses are auditor-only in receiving packages.

## Audience projections and local read views

Use the same helper on authenticated HTTP reads:

~~~python
view = project_for_access(
    snapshot,
    audience=actual_authenticated_grant,
    selected_engagement_ids=None,
)
~~~

An auditor with no engagement filter sees the full domain snapshot, including unassigned planning risks. Other roles receive the same field and unit scopes used for reports. This view is marked as a read-only access projection, not an export review.

For a reviewed handoff:

~~~python
projected = project_snapshot(
    snapshot,
    audience={"role": "unit_leadership", "unit_ids": ["unit-a"]},
    selected_engagement_ids=["engagement-..."],
    review_reference="retained-selection-review-id",
)
files = render_reports(projected)
~~~

| Audience | Included scope and detail |
| --- | --- |
| `auditor` | Complete selected records, mappings, source bytes, evidence, and revisions. |
| `unit_leadership` | Selected engagement units; observation details require an `owner_unit` match. Shared workpapers/risks require explicit compatible classification. |
| `executive` | Scope, objectives, balanced conclusions, successful-control sub-activities, and High/Medium observation and action summaries. |
| `it_leadership` | Summary content for explicit `is_it_audit: true` engagements; nonempty grant units also scope engagements and observations. |
| `medicine_it` | IT scope plus explicit `is_michigan_medicine: true`. `medicine_it_leadership` is the host alias. |
| `board_regents` | A periodic report summary, distinct from detailed observation documents. |
| `faic` | Activity and High/Medium summaries plus scoped follow-up status. |
| `management_advisory` | Explicitly selected advisory memos, declared recipient units, and a minimal engagement reference. `advisory` is the host alias. |

Advisory objects require `selected_record_ids` containing memo IDs, `recipient_unit_ids`, and authorized `unit_ids`. Recipients must be authorized and explicitly named on each memo. A referral can reach another unit able to resolve an issue without inheriting an unrelated audit report or observation set.

A nonempty unit list on a summary grant is enforced for engagements and observation owners. IT flags are actual Booleans. Absent or textual flags do not grant the additional audience.

Senior-report text comes from `report_summary`. A missing reviewed summary produces a labelled missing-summary result; detailed observation text and `plan_text` are not substituted. Successful controls and balanced conclusions remain visible. Low findings and unresolved priorities have distinct omission reasons. Low findings remain available to their scoped unit.

Nonauditor packages contain projected records/reports and hash references to restricted originals. Original mixed-unit CSVs, mapping text, raw source rows, revision history, and evidence bodies stay private. Evidence metadata requires an explicit compatible classification; unknown classifications default to auditor-only product behavior.

Each projected record retains its original ID/revision and source-record SHA. The projection records audience, selection hash, mapping revision hashes, review reference, and omitted IDs/reasons. Summary projections do not silently overwrite fuller receiving records.

## Frozen handoff and complete receiving

~~~python
archive_bytes, manifest = build_handoff(
    snapshot,
    blob_resolver,
    audience=actual_audience,
    selected_engagement_ids=selected_ids,
    review_reference=review_id,
)
received = read_handoff(archive_bytes)
preview = inspect_archive(archive_bytes)
~~~

The ZIP contains `manifest.json`, `snapshot.json`, HTML and complete report CSVs, and `blobs/<sha256>` for auditor source/evidence custody. One retained hash is stored once even when several records reference it. The manifest binds every byte, role, count, audience, selection, and review.

The reader validates all members before returning any receiving object. It rejects duplicate/case-colliding or unsafe paths, undeclared files, missing or altered bodies, mismatched snapshot identity, inconsistent history, and reports that differ from the frozen projection. Members are read into bounded memory without extracting paths into the workspace.

Limits are 64 MiB compressed, 512 MiB expanded, and 2,000 entries. Oversized selections can be split deliberately or retained in the host's full workspace custody. A failed operation produces no partial accepted handoff.

The reader returns:

~~~text
{
  format: "commons-audit-received/1",
  bundle_sha256, bundle_id, manifest, snapshot,
  files: {relative_path: exact_bytes},
  blobs: {sha256: exact_bytes},
  projection_only
}
~~~

Receiving sequence:

~~~python
received = read_handoff(original_archive_bytes)
plan = plan_receipt(current_snapshot, received, prior_receipts=retained_receipts)
if plan["status"] == "ready":
    adoption = prepare_adoption(current_snapshot, received, plan)
    # In ONE host transaction:
    # retain original archive and any projection variants;
    # adopt exact source metadata/blobs and records/history;
    # retain the reviewed receipt;
    # mark accepted and fill its actual imported IDs.
~~~

`plan_receipt` returns `ready`, `conflicted`, or `replayed`, with planned imports, source imports, reused records, conflicts, and omissions. `imported` is empty during planning. `prepare_adoption` returns a merged snapshot, exact blobs, a prepared receipt, and superseded projection variants for retention. It rechecks current heads before adoption.

The host retains the original archive as an immutable source, keeping original file IDs, row IDs, mapping records, and foreign revision branches reopenable. A previously accepted exact ZIP hash replays instead of importing again. Hashes bind package bytes; the host's authenticated operation establishes the actor.

## Resolve competing revisions in place

Decisions pin the full current record, full incoming record, and exact original ZIP:

~~~json
{
  "id": "observation-...",
  "kind": "observation",
  "decision": "accept_incoming_as_next",
  "current_sha256": "...",
  "incoming_sha256": "...",
  "bundle_sha256": "...",
  "reason": "Retained operator explanation",
  "reviewer_reference": "authenticated-auditor-reference",
  "reviewed_at": "2026-10-11T12:00:00Z"
}
~~~

~~~python
plan = resolve_receipt(current_snapshot, received, resolutions)
# Or bind a retained host plan with {id, choice, current_sha256,
# incoming_sha256, reason} decisions and server actor/time:
plan = resolve_receipt(current_snapshot, received, retained_plan, decisions,
    reviewer_reference=actual_actor, reviewed_at=server_time)
adoption = prepare_adoption(current_snapshot, received, plan)
~~~

`keep_local` retains the local head and incoming original bundle. `accept_incoming_as_next` creates the next local revision, preserves upstream source identity, and records incoming-bundle/original-record lineage. Foreign version numbers do not overwrite incompatible local history. The existing history and unchanged received archive preserve both sides.

A partial incoming projection cannot replace a fuller local record. Promotion from a matching projection to its exact full original returns the old projection separately for retention before canonical promotion.

File-source collisions support `keep_local` or `retain_both`. The latter creates a stable bundle-derived retained ID and preserves `original_source_id` and the original bundle hash. Existing original file metadata and bytes remain intact. Evidence retrieval must bind its retained file ID to the exact evidence SHA256; after an ID collision, resolve the preserved alias by that hash, never by the old ID alone. A review becomes stale if a pinned side changes.

## Ordered target tables and complete returned-file comparison

`export_native(projected_snapshot, contract)` renders the selected order, encoding, separator, header choice, null tokens, line endings, value maps, and relationship identities. Its input must already be an audience projection.

The format is `commons-audit-target-contract/1`, with a nonempty `native_contract_reference` and ordered `tables`. Every table declares kind, file, fields, encoding, delimiter, header Boolean, and CRLF/LF. Every field names its source-facing header and canonical target field. Duplicate or blank headers occupy separate positions and are preserved exactly.

Use `record_source_id` when a target table separately needs the upstream row ID and an evidence `source_id` file link. A table using only `source_id` retains convenient row-identity behavior.

For the returned export:

~~~python
normalized = normalize_native_files(returned_files, contract, original_namespace)
comparison = reconcile_native(projected_snapshot, normalized, contract)
~~~

The comparison covers every expected and returned identity and every declared field. All missing, added, and changed records are retained. Malformed headers, unexpected complete field counts, failed transforms, or broken relationships remain diagnostics before receiving.

Human report CSVs escape spreadsheet formula prefixes for viewing. Declared target files preserve the contract's literal values. Accepted target import is established from that system's returned data or receipt.

## CLI workflow

~~~sh
python -B -m audit_operator.exchange normalize original-rows.json \
  --mappings reviewed-mappings.json --namespace retained-system \
  --output normalized.json

python -B -m audit_operator.exchange package snapshot.json \
  --blobs retained-content-by-sha --audience reviewed-audience.json \
  --engagement engagement-... --review-reference review-... \
  --output audit-handoff.zip

python -B -m audit_operator.exchange inspect audit-handoff.zip

python -B -m audit_operator.exchange receive-plan audit-handoff.zip \
  --current receiving-snapshot.json --receipts accepted-receipts.json \
  --output receiving-plan.json

python -B -m audit_operator.exchange native-export projected-snapshot.json \
  --contract selected-target-contract.json --output new-native-directory

python -B -m audit_operator.exchange native-compare projected-snapshot.json \
  --contract selected-target-contract.json --files returned-native-directory \
  --namespace retained-system --output complete-comparison.json
~~~

CLI outputs use new paths and refuse to overwrite artifacts. Production adoption stays within the host's transaction.

## Source references

- [University Audit Services: Steps of the Process](https://audits.umich.edu/the-audit-process/steps-of-the-process/) — report stages, detailed observation audience, advisory purposes, and follow-up.
- [University Audit Services: Reporting and Follow-Up](https://audits.umich.edu/the-audit-process/reporting-follow-up/) — action follow-up and verification.
- [Original sample report, pages 1–3](https://audits.umich.edu/uploads/reports-and-advisories-sample-report-9-2024.pdf) — hierarchy, raw result symbols, priority distinctions, plans, and audience appendix.
- Retained `audit-domain-contract.json` — source-native wording, locators, questionnaire joins, and design distinctions.
- Retained issuer event catalog — 109 original question IDs across 11 groups, with exact labels and source pages.

The sample report's placeholders remain template examples. The included Practice journey uses marked records to exercise the operator; neither is represented as a live University audit or supplier response.


## Run the complete Practice journey

From the installed source root:

~~~sh
python -B examples/EXCHANGE_PRACTICE.py
~~~

The single journey normalizes 21 marked records, builds and rereads eight audience packages, preserves original source/evidence bytes, prepares and replays receiving, resolves one competing edit through the host-reviewed API, and rejects stale decisions and altered content. It also exports all seven declared native rows with duplicate and blank headers, then detects one changed returned summary. It opens no browser and contacts no provider.
