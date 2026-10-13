# Local API and integration contract

The API is served on the same localhost origin as the application. Dates are ISO YYYY-MM-DD; instants include a timezone. CAD money uses decimal strings with exact cents. Record IDs contain letters, digits, dot, colon, underscore or hyphen, with a maximum of160 characters.

## Read and navigate

- `GET /api/status`: workspace status and server metadata.
- `GET /api/catalog`: all collection field types/defaults, immutable collections, supported operations, input limits, parsing keys and workflow templates.
- `GET /api/projects`: compact saved-project list.
- `GET /api/projects/PROJECT_ID`: current revision and bounded collection previews.
- `GET /api/projects/PROJECT_ID/analysis`: computed language, ballot, publication, phase, funding and receipt findings.
- `GET /api/projects/PROJECT_ID/records/COLLECTION?offset=0&limit=100`: paginated original records.
- `GET /api/projects/PROJECT_ID/records/COLLECTION/RECORD_ID`: complete record, including a retained immutable snapshot.
- `GET /api/projects/PROJECT_ID/history?offset=0&limit=100`: ordered change events.
- `GET /api/projects/PROJECT_ID/files/FILE_ID`: exact retained bytes and download filename.
- `GET /api/projects/PROJECT_ID/editions/EDITION_ID/compare`: compare that edition with the current draft. Add `?other=OTHER_EDITION_ID` to compare two frozen editions.

## Create, seed and mutate

`POST /api/projects` accepts `{title,actor,id?,mode?}`. Ordinary projects use mode `working`.

`POST /api/demo` accepts `{kind:"public"}`, `{kind:"authored"}` or `{kind:"review"}`. The review example prepares its separate stable public-source project, frozen edition, consultation exercise and ready bilingual packet; it creates no returned comments or decisions. Seeds are stable, separate and idempotent; the authored example is never silently adopted into a working project.

Every project mutation uses:

```json
{
  "operation": "record.save",
  "payload": {
    "collection": "clauses",
    "record": {
      "id": "clause-example",
      "number": "1",
      "kind": "normative",
      "title_en": "Original row identity",
      "body_en": "Retain the original source and row identifier.",
      "title_fr": "Identité de la ligne originale",
      "body_fr": "Conserver la source et l'identifiant de la ligne originale."
    }
  },
  "expected_revision": 1,
  "request_id": "request-unique-001",
  "actor": "Operator"
}
```

Send it to `POST /api/projects/PROJECT_ID/operations`. The schema fills omitted field defaults. `record.save` is a complete record replacement, not a partial-field patch; first read an existing record before updating it. `record.remove` accepts `{collection,record_id}` and retains the removed record in history. Frozen collections use their dedicated operations.

Success returns `{id,revision,operation,record_ids,state_sha256,replayed}`. HTTP409 contains `error,current_revision,input_preserved`. Keep the exact original payload and request ID after an uncertain network result. Retry that exact envelope to discover its durable result before creating a successor action. Reusing a request ID for a changed operation/payload is a conflict.

## Original intake and explicit mapping

`source.add` payload:

```json
{
  "source_id": "review-comments-original",
  "filename": "review-comments.csv",
  "content_base64": "BASE64_OF_ACTUAL_BYTES",
  "metadata": {
    "title": "Received consultation comments",
    "url": "",
    "publisher": "",
    "representation": "original_bytes",
    "language": "en",
    "citation_visibility": "internal",
    "public_redistribution": false
  }
}
```

The server computes file ID, exact byte digest and size. An existing source ID cannot be used by `source.add` to replace different original bytes. A new source version needs a distinct source ID.

`POST .../intake/preview` accepts:

```json
{
  "specification": {
    "source_id": "review-comments-original",
    "parse_options": {"format":"csv","encoding":"utf-8-sig","delimiter":",","header_row":1},
    "collection": "comments",
    "table_id": "ACTUAL_PARSED_TABLE_ID",
    "field_map": {"body":"ACTUAL_COLUMN_KEY","clause_id":"ACTUAL_COLUMN_KEY"},
    "constants": {"edition_id":"EXACT_FROZEN_EDITION_ID","kind":"public"},
    "identity_column": "ACTUAL_COMMENT_KEY_COLUMN",
    "row_indices": [0,1]
  },
  "offset": 0,
  "limit": 100
}
```

Call first with only source ID and parse options to obtain actual table IDs, column keys and row origins. Then add the explicit map and constants. The response contains parsed source/table previews, counts, warnings and selected mapped/adoption rows. Source columns are addressed by stable keys, not ambiguous display headers.

CSV options: `format,encoding,delimiter,header_row`. The original StatCan CSVs need `encoding:"cp1252"`. JSON uses `format,encoding,records_path`, with an explicit JSON Pointer where needed. XLSX uses `format,sheet,header_row,header_rows,data_start_row,data_end_row`; merged or multirow headers remain explicit. Plain text supports `encoding`. DOCX main-document preview accepts no inferred parsing options.

The unchanged parser preserves null versus textual cells, duplicate/blank headers through separate keys, row origin and cell annotations. Imported records keep their mapping/source identity. Duplicate source keys or invalid selected records are reported without partially adopting a batch.

To adopt the inspected map, call `records.import` with payload `{specification: SAME_EXPLICIT_SPECIFICATION}` through the mutation envelope. The current catalog is authoritative for field types. Frozen editions, ballots, financial decisions and payment receipts cannot be synthesized through generic record import.

## Immutable workflow operations

| Operation | Principal payload |
|---|---|
| `edition.freeze` | `label,contributor_ids,notes` |
| `language.record` | `clause_id,reviewer_id,decision,rationale,source_ids` |
| `comment.carry` | `comment_id,edition_id,clause_id,consultation_id` |
| `ballot.open` | `title,edition_id,procedure_id,opens,closes,method,membership_ids,consultation_ids,sponsor_endorsement_source_ids,notes` |
| `ballot.close` | `ballot_id,authority,recorded_decision,rationale,source_ids` |
| `decision.record` | `edition_id,procedure_id,method,consultation_ids,decision,authority,rationale,source_ids` |
| `procedure.review` | `closure_id,reviewer_id,independence_declared,appointment_source_ids,decision,rationale,source_ids` |
| `phase.freeze` | `phase,title,through,summary,submitted_at,source_ids` |
| `phase.response` | `report_id,decision,date,authority,rationale,evidence_ids` |
| `invoice.prepare` | `number,report_id,issued,allocations,hst_cad,terms` |
| `invoice.response` | `invoice_id,status,date,authority,rationale,evidence_ids` |
| `payment.record` | `invoice_id,kind,amount_cad,date,external_reference,evidence_ids,notes` |

Each payload may include a new explicit `id`; otherwise the server creates it. Read the returned `record_ids`. Immutable records cannot reuse an existing ID. A retry uses the same request ID, not a second record ID.

An invoice allocation is `{cost_id,net_cad}`. The cost must be an actual, substantiated cost in the selected accepted report's frozen snapshot. Allocation limits consider previously retained invoices. The server derives the invoice phase, acceptance response, net sum and total, retaining the full input snapshot. HST is entered independently.

Reference fields point to records in the same project. A publication links either an exact ballot closure or an exact flexible technical decision and must identify the same frozen edition. Case source rows identify their original source with `source_id`; this binding is required for public output.

## Export and restore

`GET .../export?audience=private_restore` creates a complete private continuation archive.

`GET .../export?audience=edition&edition_id=ID` creates the selected bilingual publication. Optional query keys are `publication_id`, `comparison_edition_id` and a comma-separated `include_source_ids`. Only explicitly public edition citations and case-row bindings are projected. Original attachments also require original-byte redistribution permission captured in the frozen edition.

`GET .../export?audience=management` creates phase workpapers and exact retained delivery/financial records. Its optional original attachments must be selected explicitly.

Both selected handovers are deliberately non-restorable: they omit the full private state/history and unselected originals.

`POST /api/restore` accepts `{content_base64:"BASE64_OF_COMPLETE_PRIVATE_ZIP"}`. It validates the expanded archive, manifest, byte identities, state, event chain and durable request ledger, then adopts everything in one transaction. Reopening identical restored content is idempotent; a different state under the same project ID is a conflict.

## In-process use

The package is `scc_workbench`. The main contracts are:

```python
from scc_workbench.workspace import Workspace
from scc_workbench import demo, exports

workspace = Workspace("work/projects.sqlite3")
result = demo.seed_demo(workspace, "public")
state = workspace.full_state(result["id"])
archive, manifest = exports.export_project(workspace, result["id"], "private_restore")
```

The core `engine` is pure. `engine.schema()` supplies field definitions; `validate_record` and `validate_state` enforce domain shape; `analyze` returns computed findings. The workspace owns revisions, history, originals and transactions. The publisher consumes an immutable selected edition or exact state/analysis pair and returns fixed safe relative paths to bytes.

## Communication timing and delivery registers

`communications` is an editable collection. Its kinds are `announcement`, `media_plan`, `public_review_link`, `mandatory_procedural_notice`, and `other_public`. Records retain a phase, optional edition/consultation IDs, content-source IDs, SCC submission date/evidence, publication dates, link and recipient, actual SCC response date/evidence, exception basis, excluded business dates, calendar status/basis/sources, and notes. A selected calendar requires its retained source. A mandatory-notice exception requires the corresponding kind and actual procedural basis. A public-review link requires the exact consultation and link.

`delivery.register` freezes an operator's scope/invoice register:

```json
{
  "operation": "delivery.register",
  "payload": {
    "title": "Contract scope and invoice register",
    "scope_deliverable_ids": ["deliverable-orientation", "deliverable-final"],
    "scope_confirmed": true,
    "final_invoice_register_confirmed": false,
    "authority": "Recorded operator",
    "rationale": "Scope mapped to the retained agreement; invoice register remains open.",
    "source_ids": ["signed-agreement-source"]
  },
  "expected_revision": 12,
  "request_id": "unique-request-id",
  "actor": "Recorded operator"
}
```

The operation captures scope definitions and all current non-void invoice identities/digests. It does not update earlier registers. A later scope-definition change, unassigned non-report deliverable, or new invoice makes the corresponding register calculation stale until an explicit successor record is made.

Analysis exposes `communication_reviews`, `review_link_dispatches`, `reporting_schedule`, `completion`, and `phases[].cash_release_conditions`. These are calculations over recorded inputs. Communication timing does not confer SCC authority. The three-month reporting calculation uses submission dates; a pre-first-report planning date is separate.

New `phase.freeze` snapshots include `report_context` containing the scope, selected procedure, consultation/decision metadata, OLA records, phase communications and exact delivery-register basis. The report narrative should describe progress and risks. The publisher distinguishes that retained context from later current records. `invoice.prepare` requires the accepted report's frozen received-deliverable basis; an older incomplete report can be retained while an explicit successor is prepared and accepted.


## Frozen bilingual consultation exchange

Version 0.2 adds four immutable collections: `review_packets`, `review_responses`, `review_amendments` and `review_resolutions`. They are optional for previously saved projects and enter the existing event history on first mutation. Original `comments` remain the review/disposition records used by the selected procedure.

Read routes:

- `GET /api/projects/PROJECT_ID/review/status`: packet/return counts, unresolved predecessor comments and current disposition bindings.
- `GET /api/projects/PROJECT_ID/review/responses/RESPONSE_ID`: original entry, retained comment, frozen/current clause and amendment/disposition histories.
- `GET /api/projects/PROJECT_ID/review/clauses/CLAUSE_ID`: current project revision, complete clause and SHA-256.
- `POST /api/projects/PROJECT_ID/review/preview`: `{packet_id,filename,content_base64}`; returns original byte/content identities, normalized declared response, duplicate/predecessor/difference details and current working-clause status. It does not mutate the project.

Use the ordinary operation envelope for these payloads:

~~~json
{
  "operation": "review.packet",
  "payload": {
    "consultation_id": "consultation-id",
    "title": "Bilingual clause review",
    "instructions_en": "Review the selected clauses and source-linked cases.",
    "instructions_fr": "Examiner les clauses sélectionnées et les cas liés aux sources.",
    "reply_route_en": "Return the exported JSON through the agreed project channel.",
    "reply_route_fr": "Renvoyer le fichier JSON par le canal convenu du projet."
  },
  "expected_revision": 12,
  "request_id": "packet-request-001",
  "actor": "Operator"
}
~~~

Success adds `packet_id` and `packet_sha256` to the ordinary result. The packet freezes the selected consultation metadata and public projection of its exact edition.

~~~json
{
  "operation": "review.receive",
  "payload": {
    "packet_id": "packet-id",
    "filename": "review-response.json",
    "content_base64": "BASE64_OF_ACTUAL_RETURN",
    "supersedes_id": "",
    "receipt_note": ""
  },
  "expected_revision": 13,
  "request_id": "return-request-001",
  "actor": "Operator"
}
~~~

Success adds `response_id`, `duplicate_of`, `source_id`, `source_sha256` and `comment_ids`. Exact normalized duplicates preserve existing comments and dispositions; original bytes are retained. A changed return with the same declared response ID requires its actual latest `supersedes_id` and receipt note. Prior comments remain explicit.

Returned file schema:

~~~json
{
  "schema": "standards-consultation-response/v1",
  "packet_id": "packet-id",
  "packet_sha256": "EXACT_PACKET_SHA256",
  "edition_id": "edition-id",
  "source_edition_sha256": "EXACT_ORIGINAL_EDITION_SHA256",
  "projection_sha256": "EXACT_PROJECTED_EDITION_SHA256",
  "response_id": "reviewer-response-id",
  "prepared_at": "2026-10-12T08:00:00Z",
  "exported_at": "2026-10-12T08:15:00Z",
  "reviewer": {
    "name": "",
    "organization": "",
    "email": "",
    "language": "bilingual"
  },
  "authored_example": true,
  "comments": [{
    "id": "entry-id",
    "clause_id": "clause-id",
    "kind": "technical",
    "language": "bilingual",
    "body": "The observation recorded by the reviewer.",
    "proposed_text_en": "Proposed English wording.",
    "proposed_text_fr": "Formulation française proposée."
  }]
}
~~~

The timestamps above illustrate the format. Actual values remain reviewer declarations. `exported_at` and `authored_example` are optional; contact fields default to empty. Original files are UTF-8 JSON, 1 byte through 8 MiB, with 1–500 distinct comment entries. Duplicate keys, unsupported fields, non-finite values, unknown clauses and wrong packet/edition identities are rejected. Comment kinds are `technical|editorial|public`, languages `en|fr|bilingual`; an empty clause ID is a general comment. Normalized content identity excludes the export timestamp.

~~~json
{
  "operation": "review.amend",
  "payload": {
    "comment_id": "retained-comment-id",
    "clause_id": "working-clause-id",
    "expected_clause_sha256": "EXACT_CURRENT_CLAUSE_SHA256",
    "changes": {
      "body_en": "Operator-selected revised English wording.",
      "body_fr": "Texte français révisé sélectionné par l'opérateur."
    },
    "rationale": "Explain the actual change."
  },
  "expected_revision": 14,
  "request_id": "amendment-request-001",
  "actor": "Operator"
}
~~~

Allowed change keys are `title_en,body_en,table_en,title_fr,body_fr,table_fr`. Tables use the existing clause schema. The operation requires a material change and retains the adjacent before/after clause versions plus original comment snapshot. It returns `amendment_id,clause_id,clause_sha256`; it does not set the disposition.

~~~json
{
  "operation": "review.resolve",
  "payload": {
    "comment_id": "retained-comment-id",
    "disposition": "accepted",
    "rationale": "Explain how the reviewed point was resolved.",
    "resolution_edition_id": "frozen-successor-edition-id",
    "resolution_clause_id": "clause-id",
    "amendment_ids": ["applied-amendment-id"],
    "response_visibility": "recipient_only",
    "publication_basis": ""
  },
  "expected_revision": 16,
  "request_id": "disposition-request-001",
  "actor": "Operator"
}
~~~

Disposition is `open|accepted|rejected|deferred`. Edition/clause/amendment links are optional and must agree when selected. A selected amendment's paired text must appear in the exact frozen resolution clause. Public inclusion requires `response_visibility:"public"` and a nonempty basis; recipient-only is the default. The operation retains an immutable disposition, updates the original comment, and returns `resolution_id,comment_id`.

Additional selected exports:

- `GET .../export?audience=consultation&packet_id=PACKET_ID`: offline reviewer HTML, exact packet JSON and bilingual instructions.
- `GET .../export?audience=review_response&response_id=RESPONSE_ID`: one respondent's comments/dispositions in JSON and readable HTML, without reviewer contact fields or raw returns.
- Edition exports append only explicitly public, current dispositions for that exact resolution edition.
- Management exports add the current private consultation operations summary.
- Complete private restore archives retain all new records and original returns, validated together with the existing event/request chain.

The in-process export signature adds optional final `packet_id` and `response_id` arguments after the existing source selection. The original positional arguments keep their meaning. See [CONSULTATION.md](CONSULTATION.md) for the full operator and recipient workflow.

### Adopt unchanged decisions from a corrected return

`review.carry` accepts `{response_id,predecessor_id,entry_ids:["ENTRY_ID"],rationale}` in the ordinary operation envelope. It selects the current return's actual predecessor and 1–500 distinct entries. Each selected complete entry must be unchanged and have a recorded predecessor decision/rationale; the current comment must still be open with no new decision work. The operation writes all selected comment updates and immutable resolution snapshots in one transaction. Each snapshot retains the exact original response/comment/decision basis and the adoption rationale. Changed entries remain independent. Public inclusion defaults to recipient-only and is not inherited. An explicit operation `id` cannot replace a previously recorded adoption; existing generated resolution identities reject the entire batch before any comment changes. An exact request replay still returns its retained result.

`review/status` exposes `responses[].unchanged_decisions_available`. The response detail exposes `decision_carry` with the predecessor identity, exact entry comparisons, eligibility reasons and predecessor decision revisions. Success returns `response_id`, `predecessor_id`, `adopted_comment_ids` and `resolution_ids`. Ambiguous 5xx responses preserve the original request identity for replay.


## Member ballot exchange

[BALLOT-EXCHANGE.md](BALLOT-EXCHANGE.md) describes the complete typed return, correction and adoption contract. The existing operation envelope adds `ballot.packet`, `ballot.receive` and `ballot.adopt`; original project revision and request persistence apply. `GET /api/projects/PROJECT/ballot-exchange/status` and `POST /api/projects/PROJECT/ballot-exchange/preview` expose the complete original-member context. Exports add `ballot_member` with `packet_id` and private `ballot_decision` with `ballot_id`. The existing `private_restore` archive retains all new immutable records, exact returned files and original vote history.
