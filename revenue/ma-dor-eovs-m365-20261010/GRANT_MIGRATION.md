# Grant migration mapping, reconciliation and receiving

This is an extension of the existing migration workbench. It retains the original SQLite history, complete CSV/JSONL source files, case/document engine, browser, HTTP/CLI actions, reviewer decisions and portable receivers. It does not implement a Grant Tracker exporter, OmniStar loader, HMAC client, tenant write or payment operation.

## Vendor and institutional boundaries

The following public sources establish the operating requirements. They do not provide the selected institution's export schema, data, target template or acceptance.

| Source | What it establishes | What must still be supplied |
| --- | --- | --- |
| [Symplectic announcement, 14 July 2025](https://www.symplectic.co.uk/blog/important-update-symplectic-grant-tracker-to-be-sunset-by-december-2026/) | Planned Grant Tracker sunset on 31 December 2026; individual customer offboarding applies. | Actual customer notice, retention agreement and cutoff. |
| [OmniStar migration toolkit](https://www.omnistar.cloud/compare/symplectic-omnistar-migration-toolkit) | Existing automated/hybrid services and migration of applications, panels, workflows, reviewers, programmes, documents, awards, payments, reports, integrations, access and training. | Selected migration route, configuration decisions and full original populations. |
| [OmniStar security and data access](https://www.omnistar.cloud/security) | Standard migration templates; complex implementation migration service; ID-bearing spreadsheet exports; vendor database-export service. | Actual template/version, returned export, scope and completeness evidence. Public API authentication description is insufficient to construct routes, payloads or signatures. |
| [OmniStar products](https://www.omnistar.cloud/products) | Spreadsheet migration can create/update supported entities including contacts, applications and projects. | Exact supported import edition and F1's original load/result interface. |
| [Alzheimer's Society transition guidance](https://dementiaconnect.alzheimers.org.uk/what-we-do/researchers/our-application-process/migration-grant-tracker-omnistar) | Historical institution guidance illustrates outline/full continuity and separate account credentials. | Current institution-specific workflow, identity and access decisions. Historical June/August 2026 dates are not a current assignment. |

F1's actual loader remains authoritative. Retain its submitted file, job/request ID, complete result and independent destination return separately. A loader success receipt is not an independent target inventory. Direct warehouse access is an additional vendor offering; it is not presumed.

## One complete intake

Start from the existing source/import and receiving APIs described in CASE_MIGRATION.md and CASE_RECEIVING.md. Keep every original file byte. Select CSV headings or JSON pointers explicitly; a friendly business label never establishes a native vendor field.

Use one scope and identity namespace for the reviewed institution/programme cohort. Within it, each projection may declare:

- **record_family**: explicit family name, such as applications, reviews or payment_requests.
- **identity_scopes**: scopes for mapped case_id, document_id and version_id. For example, {"case_id":"applications"} makes original ID "001" distinct from award "001". The normalized identity is the canonical JSON pair [scope, original ID]. The original field value and the conversion remain retained.
- **columns**: original heading/pointer for every selected identity, lifecycle, relation and comparison field.
- **value_maps**: only explicitly reviewed exact-string replacements. These can align an independently returned foreign key to its retained original key when supported by the actual identity crosswalk; preserve that original crosswalk as evidence.

All source and target occurrences of a family use the same reviewed identity scopes. Scope mismatches become findings. Numeric identifiers are not silently converted to text. JSON numeric tokens remain exact typed lexemes, while CSV text remains text.

### Record and relationship coverage

The grant intake contract accounts for every family below as included or explicitly excluded with a reason. Inclusion does not invent a population.

| Families | Preserve and compare |
| --- | --- |
| persons, organisations | Original identities, organisation links and relevant contact attributes; account activation is separate. |
| programmes, rounds, forms | Programme/round identity, form version, open/close meaning and access rules. |
| applications | Outline/full stage, original parent and form version, status at cutoff, applicant/organisation relationships. |
| reviewers, panels, assignments, conflicts, reviews | Reviewer/panel identities; assignment, COI/NDA decisions; scores and decision meaning. |
| awards, amendments | Award/application link, contract letter/version, amendment chain and original audit evidence. |
| milestones, reports | Schedule, obligations, approval state, original report/award relationships. |
| documents, document_links | Original document/version identity, every association, full returned bytes/hash/size and available metadata/access evidence. |
| payment_requests, payment_approvals, disbursements, refunds | Original amount token, currency, interpretation, state, date meaning and related request/award. Scheduled, milestone, claim, partial, refund and recoup states remain distinct. |
| workflows, access, integrations | Configuration and operational ownership, roles, transitions, interface versions and re-authentication evidence. Copying records does not prove these services work. |

Represent record families as existing **cases**, binary/document inventory as **documents**, and association rows as **links**. This is an internal reviewed projection, not a claim about either vendor's database tables. A case projection requires case_id; document projection requires document_id; links require both.

### Explicit relation rules

Plans accept relation_rules. Each rule has all eight fields:

```json
{
  "id": "application_round",
  "source_family": "applications",
  "field": "round_reference",
  "target_family": "rounds",
  "target_kind": "cases",
  "target_scope": "rounds",
  "cardinality": "one",
  "required": true
}
```

Both families and the relation field must be selected. Every source reference must resolve to exactly one retained original parent. Independently returned references must preserve membership and resolve to a valid target parent at the destination required by that parent's cutoff state. Referenced parents must use the declared scope. Unknown, missing, duplicate, stale or invalid evidence remains a finding.

A many-valued relation requires an **original JSON array in JSONL**. JSON-looking text inside a CSV cell is retained as a typed string and is not automatically decoded. Use the supplier's separate original association export, a documented single-reference row structure, or an explicitly reviewed transformation retained beside the original source. Do not silently split delimiters or parse arbitrary spreadsheet strings.

Document/version references that cannot select one parent version remain ambiguous. Ordinary document links preserve the existing version-aware engine and multi-case copy policy.

## Destination and comparison policy

A grant plan explicitly supplies all four destination_policy fields:

```json
{
  "live_cases": "omnistar_operational",
  "live_documents": "omnistar_documents",
  "closed_cases": "approved_historical",
  "closed_documents": "approved_historical_documents"
}
```

These are operator labels, not vendor endpoints. The actual destination and archive policy need institutional review. Existing plans that omit this extension retain the original dynamics/sharepoint/archive policy.

Lifecycle is selected through exact live_statuses and closed_statuses. Outline-to-full and active-to-historical changes are assessed at each selected cutoff; records with unmapped state, tombstones or unclear authority remain unresolved. A single record cannot be assigned an invented lifecycle. Separate reviewed cohorts/plans where different programmes require different routing.

Use family_checks for explicit per-family comparison fields. These replace the plan's general case/document field list for that family. Select amount token, currency, dates and decisions deliberately. Exact typed comparison does not assert numeric equivalence across formatting differences or perform currency conversion. Preserve a reviewed numeric interpretation as a separate field/evidence edition if needed.

Absence conclusions require matching family **and identity scope**, complete original/target coverage and valid capture times. Complete applications coverage cannot prove absent awards. Filtered, failure-only and unknown populations do not establish deletion or absence. A declared complete return remains the operator's sourced assertion; retain its actual scope evidence.

The original statuses remain MATCH, DIFFERENT, UNKNOWN, AMBIGUOUS, MISSING and UNEXPECTED. MATCH concerns selected evidence only. It does not mean tenant acceptance, effective authorization or permission to pay.

## Two complete editions

1. Obtain the reviewed source export, actual vendor template, complete relationship/document inventory and exact scope declarations for rehearsal 1. Retain the actual F1 load request/result.
2. Import the independent ID-bearing returned target population. Create explicit projections, the cutoff plan and rehearsal 1. Record findings and their original review histories.
3. Obtain the later source and target editions for rehearsal 2. Create new source occurrences and projections; preserve both original editions and their parent references.
4. Compare the two actual rehearsal IDs. Review changed lifecycle/destination, new records, omitted records and changes in each selected field.
5. Record cutover as hold, ready_for_review or approved under the original engine's evidence requirements. Readiness alone never dispatches a migration. F1 and the institution retain actual release and acceptance authority.

There are exactly two rehearsals in this delivery: the first load/return starts rehearsal 1; reconciliation of it is not an additional rehearsal. Rehearsal 2 uses the later complete editions.

## Complete native receiving command

The original case receiving input is extended by grant_contract:

- schema: commons.grant-migration-contract/v1.
- mode: customer_migration or public_reference_review.
- title, scope_note, source_owner, target_loader, acceptance_owner.
- families: included family → {kind, identity_scope, meaning, compare_fields}.
- excluded_families: each other advertised family → explicit reason.
- interface_evidence: entries with kind, status and description; retained entries name a complete source_files key; missing/not_applicable entries include reason.
- periods: exactly two {label, cutoff_at, plan_key, rehearsal_key}, pointing to actual producer steps.

The native source actions use ordinary result references {"$result":"producer:STEP","pointer":"/id"}. Source/target projections and family checks must be consistent in both periods. The real customer mode requires original customer_export source and independent target imports. Missing template/document/configuration evidence stays explicitly missing; do not replace it with invented files.

```sh
python3 grant_receiving.py --input /absolute/reviewed-input.json --inspect
python3 grant_receiving.py --input /absolute/reviewed-input.json --out /absolute/original-operation
```

This runs the existing ten-phase case programme: original retained intake/history, full reports, complete producer delivery, independent receiver, recipient edit and comparison, older-delivery replay preserving edits, returned delivery, second independent receiver/cold reopen, and exact original request replay. Stable IDs and original request bytes control continuation. The wrapper validates before opening the case, then binds the same bytes in the original receiving journal.

An uncertain/incomplete operation retains its ID. Resume through the original operation control with its explicit reason; do not create replacement IDs or rewrite a completed phase. Preserve the complete old application when an interrupted operation is pinned to it.

## Public-source operator example

```sh
python3 grant_reference_example.py --directory /absolute/owned-grant-reference
```

This authors a source register and thirteen local programme/workflow requirement definitions grounded in the public sources. It records two actual local review editions, an explicit pending reviewer-obligations finding, the corrected local design and a hold decision. It then runs the complete original portable receiving journey and recipient edit.

Every input is marked local_reference/public_reference_review. There are **zero tenant application/award rows, zero vendor loads and zero actual migrated-target results**. The local target register means an operator's design review. It is not an echo represented as independent OmniStar evidence. The second edition is a revised local specification, not a claimed later customer export. The example does not establish delivery acceptance or institutional readiness.

The example preserves its authored source files and original native request history. A successful rerun verifies/reuses the same completed programme. It does not reset the workspace. If interrupted before receiving-input.json is written, exact completed preparation operations replay using their original IDs; an incomplete native preparation stays reserved for original operation.resume with an explicit reason.

## Browser, HTTP and portable compatibility

The existing browser's case projections form exposes record family and identity scopes. Its plan form exposes all four destinations, per-family fields and relation rules. Existing drafts, request IDs, conflict handling, evidence pages, reviews and cutover controls are retained. HTTP and native CLI dispatch the same original actions; no parallel server or importer is introduced.

New portable deliveries include this guide and both grant command modules. Receivers continue accepting the original 16-file workbench and 21-file case application editions. A delivery preparation begun with an older roster preserves that exact complete application. New prepares freeze the whole current roster; source code is never silently mixed across editions.

The complete receiver contains original source objects, SQLite history, immutable case editions, decisions, reports and exact application. Treat customer archives according to their actual access requirements. Public repository source contains generic code and the explicitly public design example only.
