# Public disclosure handover desk

Open **disclosure-handover.html** to use the populated working desk. It carries the original first two JSON pages of EITI's Guinea company-payment query and a separately dated government-revenue page, their exact source mappings, and a complete source-bound workspace. The first page is selected initially; the second is a separate retained snapshot. The reader works offline. The command-line tools accept complete original exports when additional data becomes available.

## Open the complete release

Download [public-disclosure-handover.zip](https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/main/services/public-disclosure-handover/public-disclosure-handover.zip), extract it, and open `disclosure-handover.html` in a current desktop browser. Every source module, dependency, original public example, saved workspace, profile, review history, build command and guide is included. The standalone HTML requires no installation or credentials. GitHub's source preview displays HTML source; open the downloaded file to operate the desk.

The [standalone HTML](https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/main/services/public-disclosure-handover/disclosure-handover.html) is also directly downloadable. Keep the complete ZIP for rebuilding and reading the original inputs. `source-manifest.json` lists exact per-file UTF-8 byte counts and SHA256 identities. It excludes itself and the containing ZIP to avoid circular hashes. `THIRD_PARTY_NOTICES.md` distinguishes the MIT application source, maintained helpers and public EITI data attribution.

## What is loaded

The retained public response contains **25 original company-payment observations** from one 2021 declaration, covering two company names. It has the original **next cursor 25**, so it is one complete returned page within an unfinished query. The page's original source-update timestamp is **2026-10-13T08:05:17.394139+00:00**.

- Source URL: https://eiti-database.eiti.org/eiti_database/view_payments_detailed.json?country_name=Guinea
- Retained file: `sources/guinea-company-payments-page-000.json`
- Exact retained UTF-8 length: **17,316 bytes**
- SHA256: **a1f8cadbd6f01a3470827737a9c5eeff3bbe57575970d507a09372b9abd8de63**
- Retrieval representation: the complete L0 JSON text supplied by the original web reader. The original HTTP response bytes were not independently downloaded.
- Retrieval date: **2026-10-13**, retained at the precision supplied by its source owner.

The separate full-query CSV endpoint is https://eiti-database.eiti.org/eiti_database/view_payments_detailed.csv?_size=max&country_name=Guinea . The original web response reported 8,240 lines, but returned only its displayed beginning. This package therefore uses the complete retained JSON page, never a reconstructed full CSV. The exact retained JSON and adjacent provenance metadata are included under `sources/`.

## Second retained original page

The source owner followed the original table's Next page link and then its JSON export link. That complete second response contains 25 further observations with next cursor50. It is retained independently as `sources/guinea-company-payments-page-025.json`, 17,197 bytes, SHA256 `e488450d92b101391f6dd3d831617a033bbf1f8ad4e1e57f675c657b940c2944`. Its exact metadata is adjacent. Both snapshots preserve the same original update timestamp and their own source identities; the desk does not concatenate, renumber or sum them together. Use **Retained snapshots** to inspect and reopen either page. The full query remains incomplete.

## Separate government-revenue snapshot

The third retained snapshot is a complete 25-row JSON response from the **unfiltered** government-revenue endpoint, https://eiti-database.eiti.org/eiti_database/view_revenues_detailed.json . All 25 observed rows in that page are Guinea/2021, but its scope remains the first page of the global query, with next cursor25. It is not a verified complete Guinea extract.

The exact retained file is `sources/guinea-government-revenues-page-000.json`, 13,952 bytes, SHA256 `4e6f05ecf68181cd64d248e91089c94d70c800ce0ac14eb1763063a6e539c981`. Its original update value is **2026-09-16T13:22:19.910690+00:00**, older than the company-payment sources. Its original sector labels, nulls and imported row IDs are preserved. The original web reader described an older cached response; the current HTML table had different import identities and labels.

Choose this snapshot to inspect the actual government mapping: revenue_value and revenue_value_usd are independent original amount columns. Country uses country_name; company/project/in-kind roles are unmapped when absent. Every unselected column remains an original cell. This separate population demonstrates source receiving and review without reconciling it to company payments or presenting it as the latest government dataset.

## Findings from the initially selected first page

All 25 original project values are JSON nulls; they remain null in the data, profile and row inspector. No project name has been inferred.

Two business-key groups contain 11 and 13 observations. Their individual payment amounts differ. These groups identify a useful question about the available reporting grain, not a reason to remove records. Every original observation is retained.

The exact arithmetic sums of the selected page are:

| Original amount column | Currency | Original in-kind flag | Observations contributing | Exact sum |
| --- | --- | --- | ---: | ---: |
| payment_value | GNF | 0 | 25 | 9065175193.0 |
| payment_value_usd | USD | 0 | 25 | 940068.56643610451460 |

These are sums of published values from this one selected page, with all original rows retained. The USD values are the dataset's published USD column; the desk does not calculate a new exchange rate or currency conversion. Neither sum represents the complete Guinea query or a reconciliation with government receipts.

The same original source can be inspected, exported, saved, closed and reopened without losing its values or mapping. The source row IDs are retained as original cells, but observation identity uses source-content SHA256 plus original row position. Import-generated row IDs are not treated as stable business keys.

## Operate the working desk

1. Open `disclosure-handover.html`. Review **Source and coverage**, including the next cursor, retrieval representation and original update value.
2. Use **Retained snapshots** to choose an original source edition. Each profile and total uses that single snapshot. Older and overlapping source editions stay separate.
3. Expand **Original column mapping** to inspect the precise role-to-header association.
4. Search **Original observations** across all original cells. Use **Rows with review findings**, page controls, and **Inspect row** to see exact column names, source types, values and JSON/CSV locations.
5. **Download original row projection** saves its exact values, type labels and source identity. **Download complete profile** includes every original observation, quality finding, repeated-key group, exact total and coverage field.
6. **Download original source** preserves the retained original text. CSV originals can contain spreadsheet-active text; use **Download spreadsheet-safe observations** for a derived CSV intended for a spreadsheet.
7. **Print management brief** opens a full source brief containing all totals and review findings, independently of the current row page. Use its **Print this brief** control.
8. **Save working copy** saves complete JSON: all original source editions, saved review history, and current unfinished import and review drafts.
9. **Save editable HTML** saves the same complete state in a standalone page. Open that saved file independently to resume.
10. **Open working copy** accepts the full saved JSON or a native workspace JSON. It validates original hashes and source mappings before replacing the current workspace.

The desk retains incomplete draft text when making a working-copy or editable-HTML backup. It admits original source data only after validating the selected format and mapping. File reads belong to the exact current source selection; a superseded read cannot replace a newer draft.

Working-copy size is limited to 128 MiB of actual UTF-8 JSON/HTML. One source is limited to 64 MiB; each source table can contain at most 100,000 observations and 256 columns. If a complete package exceeds the cap, preserve its original files and use complete, explicitly scoped selections. A saved output and its corresponding reopen path share the same limit.

## Record and retain source review decisions

Use **Review row** in the row inspector, **Review finding** beside a quality finding, or **Review group** beside a repeated business key. The form opens beside the original target's source rows and exact reported values.

Choose **open**, **accepted**, **needs-source-check**, or **resolved**; enter an explicit review owner and explanation, then use **Save review decision**. These statuses describe source review work. They do not change reported payments, declarations or government approval state.

Each decision belongs to an exact retained snapshot, source SHA256 and original row/finding/group identity. A later saved decision appends a revision with its timestamp and previous decision hash. The original explanation remains available in **Source review register**. Repeating the same status/owner/note is idempotent. A target from another snapshot cannot be adopted.

The included first-page example has two saved decisions by **Example reviewer — fictional demonstration**. These demonstrate a review history over actual public source observations; the reviewer and decisions are illustrative. The original rows, reported values, mappings and totals are unchanged. Review status is local working context and does not constitute a government declaration or approval.

**Download review history JSON** and **Download review history CSV** retain every saved revision. The complete profile, working-copy JSON, editable HTML and printed management brief include the same register. An unfinished review draft, including a blank owner or incomplete explanation, is retained in complete backups. A draft belonging to another snapshot waits until that original snapshot is selected. **Clear review draft** explicitly discards only its unsaved fields; save a working copy first if those fields should remain available.

Opening a different review target preserves the current unfinished draft by asking the operator to finish or explicitly clear it. Saved decisions are immutable in this interface; corrections are new revisions with a new explanation.

## Receive another original source

Expand **Receive an original source**. Choose CSV or Datasette JSON, and choose the actual population:

- **company-payments**: original company-payment records.
- **government-revenues**: original government revenue records, using their own actual headers and mapping.

These populations are independently profiled. The desk does not join them or automatically subtract their values. Public government aggregates may have a different reporting grain and coverage.

Choose the complete source file. Retain its source URL, retrieval date or timestamp, received representation, exact scope, optional expected count and scope note. A date-only source stays date-only; no time precision is fabricated.

Map the exact observed columns. Header spelling and whitespace are significant. Use **Retain source and profile**. Repeating the exact same source, mapping and metadata reuses its existing source edition; changing mapping or provenance creates a new retained edition.

### Actual EITI payment mapping

| Role | Exact source header |
| --- | --- |
| declaration | eiti_id_declaration |
| companyId | eiti_id_company |
| year | year |
| country | country_iso3 |
| company | company_name |
| project | project_name |
| government | gov_entity_name |
| revenue | revenue_stream_name |
| amount | payment_value |
| amountUsd | payment_value_usd |
| currency | currency_code |
| inKind | payment_in_kind |
| classification | gfs_code |
| updated | last_updated |

Unmapped original columns, including id, country_name and gfs_name, remain in every retained row and export. Mapping associates explicit working roles with these observed public fields; all original columns remain retained.

## Exact-value and quality behavior

The maintained RFC4180 reader preserves quoted newlines, escaped quotes, physical CSV start lines, empty fields, original BOM and source bytes. Its complete original module is included unchanged; only its generic read/write functions are used.

For JSON, the grammar is checked with the native parser, then numeric tokens are retained using their original lexical text. Actual token objects are tracked privately; a source object cannot pose as a number. JSON null, empty string, number, boolean and string remain distinct source types.

Amounts are parsed into a signed integer coefficient and decimal scale, then summed using integer arithmetic. Original lexemes, including trailing zeros and exponents, remain in the observations. Supported amount lexemes are bounded to 1,000 significant digits and absolute exponent 1,000; unsupported values remain original text and receive a quality finding. No amount passes through binary floating-point arithmetic.

CSV has no inherent null type. An empty CSV field remains **empty**, rather than being silently interpreted as a JSON null. The schema does not assign a meaning to an absent project or in-kind flag.

Totals are partitioned by population, declaration, year, currency, original in-kind value and amount column. This separation preserves reporting distinctions; an in-kind flag does not give the desk a quantity unit or permit a new monetary interpretation.

Quality findings include absent required mapped values, unsupported decimal values, amounts without currency, repeated business keys and declared row-count mismatches. A repeated key includes country, declaration, company identity/name, year, project, government recipient, revenue stream, currency, in-kind value and classification. It intentionally excludes the amount so different reported payments sharing those descriptors remain visible.

Derived observation CSV includes each source value and an adjacent source-type column. Spreadsheet formula prefixes, including leading whitespace before =, +, -, or @, are neutralized in the derived CSV only. The original retained file and JSON data are unchanged.

## Node command-line operation

Use a maintained current Node runtime with native ES modules and BigInt support. No package installation, network call or service credential is needed. Run commands from the extracted source directory.

```sh
node cli.mjs inspect guinea-workspace.json
node cli.mjs export guinea-workspace.json NEW_EXPORT_DIRECTORY
node cli.mjs mapping NEW_MAPPING.json
node cli.mjs ingest sources/guinea-company-payments-page-000.json sources/guinea-source-metadata.json NEW_WORKSPACE.json
node build.mjs NEW_DISCLOSURE_READER.html guinea-workspace.json
```

The inspect command writes the complete profile summary, repeated keys, totals, coverage and issues to stdout. The export command creates a new directory containing:

- workspace.json — all retained source editions;
- profile.json — the selected complete observation/profile result;
- observations.csv — derived spreadsheet-safe rows with source types;
- review-history.json and review-history.csv — all saved source-bound decision revisions;
- original-source.json or original-source.csv — exact retained original text;
- source-metadata.json — exact identity, provenance and mapping.

The ingest command optionally accepts an existing workspace as its final argument:

```sh
node cli.mjs ingest COMPLETE_EXPORT.csv META.json NEW_WORKSPACE.json EXISTING_WORKSPACE.json
```

META.json supplies format, url, retrievedAt, representation, scope, population, mapping, and optional expectedRows/completenessNote. The included metadata file is a complete actual example for this source page.

Single-file outputs use a same-directory staged write and hard link so an existing file is never overwritten. Export refuses an existing directory. If an export fails after creating its new directory, retain the partial directory and error; do not overlay another completed export.

The builder writes a new standalone HTML page, or a blank desk when no workspace is provided. The existing original source model and UI are embedded unchanged. The desktop/narrow viewer and export/reopen paths remain part of the product receiving operation.

## Source and delivery contents

The complete source package includes:

- disclosure_core.mjs — original source/provenance, lossless JSON cells, mappings, profiles, exact arithmetic, save/reopen.
- disclosure_ui.mjs and disclosure.css — standalone industrial operator interface.
- disclosure.mjs — original maintained CSV/hash dependency composition.
- cli.mjs and build.mjs — usable Node intake, profile, export and reader build.
- host/connected_sha256.cjs — unchanged maintained SHA256 helper and original attribution.
- tools/revenue_owner_console_20261010/lead_procurement_waterford_csv.mjs — unchanged maintained CSV source.
- sources/ — the three exact public JSON pages and their complete source metadata.
- guinea-workspace.json and guinea-profile.json — complete current source-bound records.
- disclosure-handover.html — populated standalone viewer.
- README.md and source-manifest.json — complete operating guide and per-member identities.

The original helper authors retain their source notices. No government-system credentials, tenant data or native platform write adapter is included.


## Public source attribution and reuse

The example retains three partial EITI public response pages with their actual dates, original numeric lexemes, nulls, source URLs and independent coverage. Cite EITI and the source URLs when using the data. The government-revenue response is older and separately scoped; it is not a current complete Guinea extract. The application never combines the two reporting populations into a reconciliation.

Primary sources:

- [EITI public database](https://eiti-database.eiti.org/)
- [EITI open data policy](https://eiti.org/documents/eiti-open-data-policy)
- [How EITI collects and publishes summary data](https://eiti.org/how-we-collect-and-publish-eiti-summary-data)
- [EITI summary data template](https://eiti.org/guidance-notes/eiti-summary-data-template)
- [Quality assurance of revenue data](https://eiti.org/guidance-notes/quality-assurance-revenue-data)

See `THIRD_PARTY_NOTICES.md` for the observed reuse terms and preserved code attribution. The generic application does not connect to a government platform or send any data. A browser download and local file open keep the chosen source within the operator's environment.

## Receive and inspect a release

Open the exact delivered HTML at desktop and 390-pixel width. Use all three source selections; inspect mappings, filters, rows, repeated-key groups and their original values. Save a review decision, append a second revision, and inspect every retained prior explanation. Type an unfinished review and import draft, download both the complete working-copy JSON and editable HTML, then independently reopen each. Verify source identities, selected snapshot and draft text. Print the management brief and inspect its full saved history, source labels and amounts.

Open every attachment in the complete ZIP, read the source metadata, and run the documented Node inspect/export/build commands. Reopen the exported original source and rebuilt standalone page. For publication or customer delivery, the producing person must look at the actual rendered pages and their narrow layout, operate the controls and inspect all attachments. Hash checks, model execution and another person's review support that inspection.

The included example and executable source have undergone exact-byte, source-target, arithmetic, history, replay and save/reopen checks. Actual visual receiving remains a distinct operation; source checks do not establish browser rendering. If a defect appears, retain the exact input, source identity and original working copy, correct this maintained implementation, and rebuild through the same command.
