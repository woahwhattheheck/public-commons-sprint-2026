# Original inputs and receiving contract

## Original authority

The client engagement is Lake County, Colorado, **RFP_F-Lake-0000000014, Lake County Capital Asset Management Plan**. The issued scope includes a 15-year capital forecast; 5- and 10-year views must reconcile to that same model selection. Aggregate figures printed in the solicitation do not constitute individual asset records.

FEA retains field assessment, appraisal/valuation methodology, professional judgment and its prime/client relationship. My Facility Plan remains an original product authority. No private API or workbook format has been established by the public product page. The County's public maintenance-request link identifies PubWorks as an existing service, not permission to read or write private service records.

Before fixed client commissioning, agree the actual model/export format, writable cells or fields, formula recalculation environment, data volumes, record units, currency/year basis, review authorities and export/receiving criteria. A new formula-repair scope, new rate/policy model or additional vendor integration is a scope change.

## Public observation versus asset identity

A public-source record must retain:

- Original source URL and complete file identity.
- The document or memo date, separately from its publication/agenda and retrieval dates.
- The name/address as printed and whether it represents a building, room, park, facility, maintenance location or drop site.
- Original ownership/maintenance/lease wording and any explicitly stated responsible organization.
- The observation's scope and uncertainty.

The canonical `asset_observations` table is distinct from `assets`. County-owned, County-maintained School District premises, leased premises and unknown relationships must not be collapsed.

For example, the Aug. 18, 2026 Health/Human Services memo within the Oct. 6 agenda describes a lease at 735 US Hwy 24, with a current Aug. 31, 2027 expiry. The approximate $110,000 figure is **per department per year**, as of the memo. A requested renewal is not executed lease terms. Preserve these dates, units and status in the source note and original file; do not infer a combined two-department figure or property ownership.

The 2026 budget book's general adoption language and an individual table's printed `2026 PRELIM` column label are separate facts. Store each budget amount with its actual column label and source page; do not replace those labels with a document-wide status.

## Supported registers

Each mapping is explicit: `columns` maps the canonical name below to the actual original header or object property. Keys remain original text. CSV keys may use explicitly selected trim/casefold; both are false by default. JSON requires an explicit RFC 6901 pointer to the original array.

| Register | Original key | Principal fields |
|---|---|---|
| assets | source_asset_id | name, class, ownership_relation, responsible_entity, record_unit, parent_source_asset_id, ownership_basis, as_of, area/unit, source_note |
| asset_observations | observation_id | the same asset context plus the observation's independent ID |
| assessments | assessment_id | source_asset_id, date, assessor, method, condition_raw/scale, risk_raw, criticality_raw, remaining_life_years, source_note |
| valuations | valuation_id | source_asset_id, date, basis, currency, amount, appraiser_or_author, restrictions, source_note |
| actions | action_id | source_asset_id, scope/type, planned_year, capital_cost or quantity/unit/unit_cost, currency/price_basis/date, operating_impact, dependencies, priority_raw, source_note |
| funding | funding_id | programme, amount/currency, fiscal_year, status, amount_role, programme_scope, eligible_actions, conditions, receipt_year/status, source_note |
| budgets | budget_observation_id | fund, account, fiscal_year, column_label, basis, amount/currency, source_note |
| model_outputs | result_id | scenario_label, source_asset_id/action_id, fiscal_year, metric, amount/currency/price_basis, model_version, source_note |

The exact complete field lists are returned by `GET /api/status` and declared in `domain.TABLES`.

Ownership relationships: `owned`, `maintained_nonowned`, `managed`, `leased`, `unknown`, `other`. Retain original wording alongside the selected relationship.

Funding status: `historical_actual`, `adopted`, `committed`, `requested`, `anticipated`, `proposed`, `unknown`. Role: `component`, `stated_total`, `context`. Scope: `asset_capital`, `study_programme`, `operating`, `unknown`. Receipt status: `actual_received`, `scheduled`, `unknown`.

The June 2026 EIAF source describes anticipated DOLA funding and a requested County match toward a study/programme total. Preserve each component and the printed total as separate non-additive roles. None establishes executed award, appropriation, cash receipt or available asset-project funding.

## Exact amount and missing-value semantics

Use decimal strings such as `"0"`, `"110000"` or `"-1250.50"`. Currency symbols, grouping separators, exponents, binary floating point, NaN and infinity are not accepted. Currency is an explicit three-letter uppercase code.

A JSON null, absent mapped value, empty string and numeric-looking text remain distinct in original rows and exchange comparison. A mapped decimal must be a string. Supplied zero is preserved; a blank amount is unresolved.

For selected actions, a complete direct capital cost may be supplied, or quantity × unit cost with a declared unit. If both are supplied, they must agree. Operating impact is separate and is not repeated into later years without an explicit original model row.

No cost, year, valuation, risk score, inflation rate, discount rate or cash balance is derived from a name or a similar asset.

## File mapping example

This is a schema illustration, not a client record:

```json
{
  "file_id": "ACTUAL_RETAINED_FILE_ID",
  "table": "asset_observations",
  "format": "json",
  "mapping": {
    "json_pointer": "/observations",
    "columns": {
      "observation_id": "observation_id",
      "asset_name": "asset_name",
      "record_unit": "record_unit",
      "ownership_relation": "ownership_relation",
      "source_note": "source_note"
    },
    "key_trim": false,
    "key_casefold": false
  }
}
```

The parser retains the original full file, including unselected fields. Missing columns, duplicate JSON object fields, row-width errors, nontext keys and duplicate normalized keys remain errors. Structural parse failures retain the full original and all successfully parsed preceding rows while marking the edition incomplete.

## Whole operating selection

Top-level schema: `lake-county.operating-selection/v1`.

Required:

- `operation_id`, `actor`, `case_id`.
- `workspace_root`, `application_root`, `output_root`, `receiving_root`: actual selected paths.
- `workshare_source`: exact original `{path,bytes,sha256}`.
- `files`: entries `{key,path,bytes,sha256,mime,metadata}`.
- `editions`: entries `{key,name,predecessor_key?,selections:[{file_key,table,format,mapping}]}`.
- `publication`: `{name,edition_key,kind,scenario_keys:[]}`.

Optional:

- `exchanges`: actual model name/version/method, original register and key/guard/editable fields, `model_file_keys`, source `edition_key`, optional original `return_edition_key` and actual `adoption:{status,note}`.
- `scenarios`: `{key,edition_key,spec,record_keys?,exchange_key?}`. `record_keys` must match exactly one original row each. An absent or duplicate key blocks selection.
- `reviews`: actual `{kind,key,status,note,capacity?}`. The programme never inserts a default approval.
- `browser`: exact installed `{node,playwright_module,browser_executable}`. This performs desktop/phone inspection and original report/full-archive downloads.

For an initial public-source working edition, use `kind:"internal_working"`, no inferred model, no approval rows and no fabricated action records. Complete private client commissioning remains a following exact source edition.

## HTTP and CLI contract

The browser and CLI call the same serialized native mutation API.

`POST /api/action` accepts exactly:

```json
{
  "operation_id": "ORIGINAL_OPERATION",
  "actor": "ACTUAL_OPERATOR",
  "workspace_id": "ACTUAL_NATIVE_UUID",
  "expected_revision": "ORIGINAL_SELECTED_REVISION",
  "action": "edition.create",
  "payload": {}
}
```

Actions: `file.retain`, `edition.create`, `edition.compare`, `review.save`, `crosswalk.save`, `exchange.prepare`, `exchange.return`, `exchange.adopt`, `scenario.save`, `publication.create`.

Reads:

- `GET /api/status`: actual workspace, complete source/edition/head metadata and schemas.
- `GET /api/rows?edition=…&table=…&offset=…&limit=…`: explicit pages, `total`, `next_offset`; maximum 1,000 rows per page.
- `GET /api/operation?id=…`: original completed request/result or `not_applied`.
- `GET /api/object?kind=…&id=…&revision=…`: original immutable version.
- `GET /api/file?id=…`: exact complete original bytes.
- `GET /api/inspect-file?id=…&format=csv|json&delimiter=…&pointer=…`: limited column preview; full import remains the authority.
- `GET /api/report?id=…`: full frozen readable report.
- `GET /api/export?publication=…`: complete native/source/application archive.

All API routes require the original private loopback Bearer token. Tokens are never accepted in query parameters. The browser startup fragment is removed from the address after session intake.

## Original public references

The issued procurement is [Lake County Capital Asset Management Plan, RFP_F-Lake-0000000014](https://www.lakecountyco.gov/DocumentCenter/View/3141), with the [County's original listing](https://www.lakecountyco.gov/bids.aspx?bidID=71). The [June 9, 2026 agenda](https://www.lakecountyco.gov/AgendaCenter/ViewFile/Agenda/_06092026-838) retains the separate anticipated DOLA request and County reserve proposal; those statements do not establish an executed award or received cash.

Use the [County annual-budget index](https://www.lakecountyco.gov/370/Annual-Budget) and retain each actual selected document and table-column label. The [October 6, 2026 agenda](https://www.lakecountyco.gov/AgendaCenter/ViewFile/Agenda/_10062026-889) contains the dated August 18 Health and Human Services lease memo; the memo's approximate annual rent is per department. Its requested renewal is a decision request. The [Maintenance page](https://www.lakecountyco.gov/501/Maintenance) identifies current public maintenance context and the existing public PubWorks request service. The [Mapping page](https://www.lakecountyco.gov/207/Mapping) links the County's published open-data portal. Raw selected captures, capture times, original record identifiers and complete source-file hashes remain in the delivered source register; current web pages can change after that edition.
