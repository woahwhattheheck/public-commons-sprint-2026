# Berkeley daily cashiering workspace API

This additive application shares the existing permitting Workspace SQLite database, global revision, loopback HTTP listener and X-Workspace-Token. It does not change the original case comparator or case-level paymentMinor meaning. All source and operating rules are in SOURCE_CONTRACT.md and requirements-catalog.json.

## Entry points and envelopes

GET /cashiering/ serves the operator. The original / remains the permitting operator. Every write below is POST /api/cashiering/ACTION and a JSON object. Include revision (the exact integer returned by state), and optionally request_id (a UUID). A repeated request_id with the identical complete payload recovers its original committed result; different payload with the same ID conflicts. The UI does not automatically replay uncertain writes.

Every successful write returns {revision,state,result,detail?}. state is the refreshed financial state; detail is the complete selected run when the action concerns a run. Original global revision conflicts remain HTTP409 {error,message,current_revision}; malformed input is400. Reads do not mutate financial state.

State: {revision,settings,captures,runs,profiles,packets,catalog}. catalog includes source_catalog (the exact requirements catalog), fields, required_fields, lanes, events, statuses, mapping_schema, review_states and receipt_states. Captures and profiles retain all earlier versions. Runs retain source-bound financial editions, decisions, signoffs, closings and exchange observations. Money and all identifiers are strings; counts and revisions are integers.

GET /api/cashiering/requests/UUID — {found:boolean,response:original_success_envelope|null}; read committed outcome without resending a large original upload
GET /api/cashiering/runs/ID/editions — paged immutable edition metadata {id,run_id,edit_revision,snapshot_hash,created_at,action}
GET /api/cashiering/editions/ID — full historical detail from exact retained source/mapping bindings and history cutoff
GET /api/cashiering/state
GET /api/cashiering/captures/ID — source metadata, current mapping and mapping history
GET /api/cashiering/captures/ID/rows?normalized=0|1&offset=0&limit=100 — {capture_id,total,offset,limit,rows,issues}; original and normalized row lists are complete before pagination
GET /api/cashiering/captures/ID/download — exact original bytes as attachment
GET /api/cashiering/runs/ID — complete berkeley.cashiering.run.v1 detail; ?summary=1 retains totals/balances/manifest/counts/signoffs/close/interface metadata but omits rows/groups/findings/allocations/corrections/history arrays for paged operator navigation
GET /api/cashiering/runs/ID/rows?kind=permits|receivables|processor|cashier&offset=0&limit=100 — {total,rows,...}
GET /api/cashiering/runs/ID/report — generated grayscale HTML for current retained financial edition
GET /api/cashiering/runs/ID/{groups,findings,allocations,corrections,history}?offset=0&limit=100&query= — {total,offset,limit,rows}; kind/status/code filters are supported where present
GET /api/cashiering/artifacts/ID — exact prepared document/packet bytes as attachment
GET /api/cashiering/packets/ID — retained packet metadata and source binding
The existing GET /api/backup and --restore NEW_DB cover all financial tables automatically.

## Settings

POST settings {revision,settings}. Full replacement:
{scales:{USD:2},timezone:"UTC",scope_note:"",required_lanes:["permits","receivables"],balance_tolerance_minor:{USD:"0"},close_reviewers_required:2,balance_payment_types:{cashier:null,processor:null}}.

scales values are integers0..12; amounts use signed decimal integer strings in those units. Exact zero is the default tolerance. required_lanes is the declared operating input set, not a statement that a missing report is empty. All four observed lanes are always shown. timezone is a declared IANA timezone. close_reviewers_required must be an integer2..10; the source requires two distinct deposit reviewers. balance_payment_types declares per-lane tender applicability: null means all tenders, an explicit list limits that lane, and [] means none. Inapplicable differences remain null and their actual supplied rows remain visible. Explain the source-defined boundary in scope_note. Settings are copied into each run and later global changes never rewrite an old run.

## Source capture, interpretation and selection

POST upload {revision,kind,filename,content_base64,captured_at,coverage}.
kind is permits, receivables, processor, cashier, or document. CSV and JSON originals up to25MiB are accepted for data lanes; document retains arbitrary bytes without parsing.
captured_at is an ISO instant with an explicit offset.
coverage = {start_date,end_date,session_ids:[],payment_types:[],currencies:[],complete:false,note:"",data_mode:"event_stream",source_system:"",report_family:""}.
Dates use YYYY-MM-DD. data_mode is event_stream or snapshot. A source-defined complete:true declaration plus its explicit date/session/tender/currency scope can establish a zero for a missing group; absent or incomplete source never does. Empty filter arrays mean all values within the supplied report scope, and this must be explained by note before complete:true is accepted.
Exact same lane+originalSHA+coverage reupload (including a later reacquisition time) returns its retained capture instead of another counted source and retains the new acquisition observation. A run rejects selecting the same original SHA twice within the same lane/system/report family. Original bytes never change. CSV record row_number starts at2 after its header (CSV records, not physical lines). JSON input duplicate keys and nonfinite values reject; numeric lexemes remain strings with source type metadata, preserving long integers/decimals. Blank CSV records are retained as source positions but do not become financial rows.

GET captures/ID returns the bare capture projection plus mapping_history. catalog.fields is a descriptor array {key,label,type,required_for}; required_fields is a lane-to-key-array object. Normalized rows are flat canonical rows with original; raw rows are {line,values,types}.

Capture projection: {id,kind,filename,sha256,bytes,rows,headers,preview,captured_at,coverage,mapping,mapping_version,confirmed,current,issues,created_at}. preview rows {line,values,types}. source capture rows API preserves complete originals.

POST mapping {revision,capture_id,mapping,confirmed}.
A draft mapping can retain incomplete columns with actionable row issues; confirmed:true requires a valid interpretation for every nonblank row. Changing a capture mapping increments mapping_version and clears its current selection until confirmed again; earlier runs retain their exact old mapping and normalized rows.

mapping = {
 fields:{canonical_field:{column:"exact.header"} | {literal:"explicit value"}},
 amount_mode:"major" | "minor",
 amount_sign:"as_supplied" | "event",
 event_signs:{payment:"1",refund:"-1",void:"-1",chargeback:"-1",return:"-1",adjustment:"1",denial:"0",settlement:"1",balance:"1"},
 event_map:{"original status":"payment"},
 status_map:{"original status":"included"},
 date_format:"iso" | "mdy" | "dmy",
 net_mode:"amount" | "reported",
 note:"meaning of this source report"
}.

event_signs is explicit configuration used only for amount_sign:event; incoming amount must then be nonnegative and is multiplied by that exact sign. With as_supplied the signed original amount is preserved, independent of event name. No sign is inferred from a label. requested_minor and paid_minor preserve signed original supplied fields independently; net_mode:reported requires the actual net_minor source field, while net_mode:amount declares principal amount as the comparison basis. Denied/pending/excluded observations remain visible but do not contribute to posted financial totals.

Canonical fields:
record_id (optional native row identity),
transaction_id (required all data lanes),
permit_id, invoice_id, fee_code, session_id,
business_date (required), currency (required),
event (required), status (required), amount_minor (required),
requested_minor, paid_minor, net_minor, fee_minor,
related_transaction_id, denial_reason, payment_type.
The mapping uses canonical names ending _minor even when amount_mode:major declares the original source as a decimal currency amount.
Columns address an exact raw header first; JSON paths may use dotted object paths. Each mapping field must choose exactly one column or literal. Native source event/status strings are retained beside canonical classifications.
events: payment, refund, void, chargeback, return, adjustment, denial, settlement, balance.
statuses: included, pending, denied, excluded.
Optional fields are empty strings or null; missing numeric observations stay null.

POST select {revision,capture_id,selected:boolean}. Only a confirmed data capture can be selected. Selection affects new run defaults only.
POST run {revision,label,start_date,end_date,capture_ids?:[],note?}. Explicit capture_ids (or current selected captures) are deduplicated and frozen. Every selected mapping must be confirmed. All source rows are retained; rows outside the selected period remain visible with in_scope:false and do not contribute. Missing required lanes, overlapping snapshot reports, pending/denied observations, unmatched/remainder groups and incomplete daily coverage become findings.

POST refresh {revision,run_id,capture_ids,note}. Replaces the current run's source selection with explicit newly frozen source editions. Earlier editions, corrected originals, allocations and review history remain. Active allocations referencing removed groups are retired with their previous evidence; current signoffs/close become stale. This is an explicit source refresh, not a mutation of original captures.
POST run-settings {revision,run_id,settings,note}. Applies an explicit new settings edition to that run and reinterprets its exact frozen source bytes/mappings. Earlier financial snapshots remain.

## Financial comparison and corrections

GET run detail:
{
 schema:"berkeley.cashiering.run.v1",
 revision,
 run:{id,label,start_date,end_date,created_at,source_revision,edit_revision,status,settings},
 manifest:[{capture_id,kind,filename,sha256,bytes,captured_at,coverage,mapping,mapping_version}],
 rows:{permits:[],receivables:[],processor:[],cashier:[]},
 groups:[],allocations:[],findings:[],balances:[],totals:[],corrections:[],
 signoffs:[],closings:[],closing:null,interface_exports:[],history:[],counts:{},
 snapshot_hash,packets:[]
}.

Rows preserve record_key, original {capture_id,line,values,types}, canonical fields, raw_status/raw_event, in_scope, excluded, correction_ids and source_mapping_version. net_minor is the effective exact financial contribution (zero for observed denied/pending/excluded or explicit operator exclusion); reported_net_minor retains the source's separately supplied net when present. Missing reported net remains null.
Groups exist for permits and receivables, grouped by their native transaction_id and currency. Groups preserve record_keys and all permit/invoice/fee/session/tender IDs. Processor/cashier groups are also included for inspection but cannot be used as allocation endpoints.
Amounts and net remaining balances remain signed strings. A refund/reversal is a separate actual source row; neither a label nor an operator note creates another payment.

POST allocate {revision,run_id,source_group_id,target_group_id,amount_minor,owner,note}.
This explicitly allocates permit→receivables groups in the same currency and direction. Amount is nonzero, has the sign of both remaining balances, and may not exceed either. Multiple partial allocations and many-to-many joins are supported. Stable native IDs alone do not auto-authorize an amount/date guess.
POST allocation-retire {revision,run_id,allocation_id,owner,note}. Retains the old allocation and retires it; never deletes its event.
POST correct {revision,run_id,record_key,changes,owner,note}. changes is an explicit subset of canonical fields plus excluded/exclusion_reason. Amounts in this action are already exact signed MINOR unit strings, independent of original file amount_mode. An observation correction changes the current interpretation with immutable before/after/event provenance; it never alters raw source bytes or claims an ERP transaction occurred. Record identity cannot be reassigned. Use actual corrected source upload/refresh when available.
POST correction-retire {revision,run_id,correction_id,owner,note}. Retains original correction event and reapplies the remaining active corrections.
Corrections, allocations, settings/source refresh and source-bound finding reviews produce a new edit_revision. Old approvals do not approve the new financial state.

Findings include {id,code,severity,message,details,waivable,review:{status,owner,note,updated_at}}. id is bound to its actual source/configuration/amount evidence. A changed finding cannot silently inherit a previous review.
POST review {revision,run_id,finding_id,status:"open"|"investigating"|"accepted_exception"|"resolved",owner,note}. accepted_exception requires waivable:true and a reason. resolved records the investigation but never removes a still-present native discrepancy; a remaining discrepancy continues to require either an explicit accepted_exception or source correction.
Daily balances group business_date+session_id+payment_type+currency. expected_minor is the exact included permit contribution; cashier/processor comparison values stay null without supplied rows or a complete source-scoped zero declaration. Differences and totals are computed only by this backend. Review acceptance is shown separately from matched arithmetic.

## Supervisor close and reopening

POST signoff {revision,run_id,reviewer_id,name,role,statement,note}. Records a named distinct staff review against exact edit_revision+snapshot_hash; it does not impersonate an authenticated agency system identity. Repeating the same reviewer replaces their CURRENT signoff while preserving history. Signoff itself does not change financial edit_revision.
POST close {revision,run_id,owner,note,deposit_document_ids:[]}. Requires at least settings.close_reviewers_required distinct current signoffs and no unaccepted current finding. Deposits/over-short/unknown coverage therefore remain explicit until resolved or accepted by authorized staff. Supplied deposit documents must be retained original captures/documents; exact identities enter the close. No fabricated agency receipt is generated.
POST reopen {revision,run_id,owner,note}. Moves the working run back to open and retains every previous close/signoff/source edition. A reopened run requires renewed signoffs before a later close.
closing retains {id,status,owner,note,created_at,edit_revision,snapshot_hash,signoffs,deposit_document_ids}. closings is complete immutable history. run.status is open, reviewed or closed; a changed financial edition makes an older close stale without deleting it.

## Explicit receiving layout and exchange evidence

POST profile {revision,id?,name,columns,delimiter:",",include_header:true,line_ending:"CRLF",scope:"balances"|"transactions",lane:"permits",note}.
columns are [{header,field,format:"text"|"minor"|"major",literal?}]; exactly one field or literal. field must exist in the selected row family. Any monetary major rendering uses the row currency's explicit scale, never floating point. Format and account-code literals are supplied/reviewed partner choices; no built-in Munis/ACI layout is claimed. Each save produces a retained profile version. State profiles include current and historical versions. New profile name and substantive note are required.
POST interface-prepare {revision,run_id,profile_id,profile_version,label,owner,note}. Creates retained exact CSV bytes using that profile and current financial snapshot; returns artifact_id, profile version, source/edit_revision, row_count and SHA. This is PREPARED only. The generated interchange intentionally preserves the supplied native layout; spreadsheet-safe human CSV is a separate report export.
POST interface-receipt {revision,run_id,export_id,status,observed_at,reference,document_id,owner,note}. status is transmitted, accepted, rejected, posted, or void. observed_at has an explicit offset. document_id must name a retained original document/capture that supports the ACTUAL external observation; reference is its native transaction/batch/receipt reference. All earlier receipts remain, and latest observed time/order is visible. Local generation never sets a posted status. Receipts bind the exact prepared export artifact/profile/financial source; a receipt for an old edition cannot approve current financial work.

## Portable report and complete packet

POST packet {revision,run_id,label,owner,note}. Builds an immutable complete ZIP using the exact current retained detail, originals, all prepared interface files/actual receipt documents, source contract/catalog and the exact engine/model/report implementation bytes. Returns {id,artifact_id,sha256,bytes,manifest,run_id,edit_revision,snapshot_hash,created_at}. Earlier packets remain downloadable by exact artifact ID.
The packet includes readable report.html, exact run.json, full source-manifest/history/CSV exports, original bytes, document bytes, retained mappings/corrections/allocations/receipts/signoffs and implementation. Manifest members retain exact length/SHA and deterministic ZIP metadata. Human CSV cells protect formula-like strings without changing original files or machine-readable JSON.
The original full SQLite backup is the receiving/reopen artifact. Restoring it to a fresh path preserves the original permitting cases and all additive financial histories, sources, run editions and prepared files. Opening an old backup does not turn earlier prepared output into an actual posted receipt.
