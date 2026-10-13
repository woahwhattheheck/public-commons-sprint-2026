# Source and data notices

## Application source

The disclosure desk, CLI, builder and operating guidance are distributed under the repository's MIT license, reproduced in `LICENSE`.

## Original public data

The included Guinea JSON files are original public records from the EITI International Secretariat database, retrieved on 13 October 2026 through its official table navigation and JSON exports. Credit: **EITI International Secretariat, eiti.org**.

- Database: https://eiti-database.eiti.org/
- Exact first page: https://eiti-database.eiti.org/eiti_database/view_payments_detailed.json?country_name=Guinea
- Exact second page: https://eiti-database.eiti.org/eiti_database/view_payments_detailed.json?_next=25&country_name=Guinea
- Separate government-revenue first page: https://eiti-database.eiti.org/eiti_database/view_revenues_detailed.json
- Database's linked data-use policy: https://eiti.org/documents/eiti-open-data-policy

The database expressly offers CSV/JSON export and reuse in analysis, tools and publications. Its linked policy includes a content-use permission to republish with source credit. The policy recommends open licensing, preferably Creative Commons Attribution 4.0; that recommendation is not presented here as a separately verified dataset-specific license declaration.

The data is kept under its original publisher's terms, separate from the application software license. Each retained page has its own complete source, identity, mapping and scope metadata. The two company-payment pages remain partial selections of the larger country query. The separately dated government-revenue page is the first page of an unfiltered global query; its 25 observed Guinea rows do not establish a complete Guinea extract. All original next-page markers and update values are preserved. Profile totals apply to the selected page. Exact retrieval representation and date precision are recorded alongside each source.

## SHA-256 helper

`host/connected_sha256.cjs` is the unchanged maintained strict UTF-8 helper. It embeds **emn178/js-sha256 1.0.0**, with the original upstream source and full MIT notice retained in that file:

- Author: Chen, Yi-Cyuan
- Upstream: https://github.com/emn178/js-sha256
- Upstream commit: `9a54fb31d4594762987e1b5d175265f6bac921de`
- Original bundled upstream blob: `e3a08633357cb7ca248e14751f9270d95fbbbdf2`
- Maintained complete helper: 18,336 UTF-8 bytes, SHA-256 `023b01f089168605a6153b9e5f3ccd7a66a0d0487fab3e79522897a1df226cc2`

## Original CSV reader

`tools/revenue_owner_console_20261010/lead_procurement_waterford_csv.mjs` is the unchanged maintained MIT source, 19,903 bytes, SHA-256 `d9a0c4ef6fcf0d758e186480c1031494ba54bf0b67b7519abb125da2a6c7146f`.

The disclosure desk composes only its generic `readMunicipalCsv` and `writeMunicipalCsv` functions. The complete original module and original header are retained for provenance. Its original domain-specific helpers do not determine disclosure mappings, accounting rules or reviewer decisions.

## Rebuilding and source identities

The application embeds the same source bodies into the standalone HTML. `source-manifest.json` records the full selected public file set and exact SHA-256 identities; the source archive contains that complete selection. Rebuild using the commands in `README.md`, preserving the original source files and notices.
