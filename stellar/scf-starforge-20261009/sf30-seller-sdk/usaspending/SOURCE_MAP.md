# Source map — USAspending award research

## Primary provider contracts

This integration consumes the official USAspending API. The original provider response bytes and observed request are the source of each stored capture. The product preserves the original request independently from the normalized query editor.

| Contract | Official source |
| --- | --- |
| Award search | https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/search/spending_by_award.md |
| Shared search filters | https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/search_filters.md |
| Award counts | https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/search/spending_by_award_count.md |
| API documentation | https://api.usaspending.gov/docs/ |
| Search endpoint | https://api.usaspending.gov/api/v2/search/spending_by_award/ |
| Original award details | https://api.usaspending.gov/api/v2/awards/ followed by the original generated unique award ID and a trailing slash. |

The source search contract was retrieved during implementation. The exact current search-contract Git blob inspected by the integration owner was **235791f0** in the official fedspendingtransparency/usaspending-api repository. The implemented contract query uses prime award types A, B, C, and D, the official field names, explicit date semantics, and supported filters.

The retained October 11 acquisition first received a 422 response to the documented object-form NAICS filter. The source owner preserved that request and response, then submitted the explicit supported string-array codes 541511, 541512, 541513, and 541519. That successful query and its exact body are the collection imported by this product. The operator also uses the explicit string-array form.

## Retained original public cohort

The source owner retained the complete cohort and award details before the research product was assembled.

**Collection archive**

- Filename: WINTrio_USASpending_Source_Cohort_20261011.zip
- Bytes: 59,506
- SHA-256: e1ff68eeff5031f8ef9cedf4c3ff86e7bc69f02f2df36f6da8e9da28c70ab488
- Members: 38
- Contents: original public source pages, award detail responses, acquisition receipts, query manifest, detail collection manifest, derived CSV, and PACKAGE_MANIFEST.json.
- Query manifest: source/recent-ai-v2-capture.json
- Collection manifest: source/recent-ai-v2-details.json

The archive contains the original public source material. The original commercial owner's private proposal, addresses, case state, and relationship history remain with the original case.

**Original query**

| Parameter | Actual retained value |
| --- | --- |
| Source | Official spending_by_award POST endpoint. |
| Award type | A, B, C, D prime contracts. |
| Date semantics | new_awards_only. |
| Date period | 2026-09-01 through 2026-10-11. |
| Keyword | artificial intelligence. |
| NAICS | 541511, 541512, 541513, 541519. |
| Award obligation filter | 100,000 through 20,000,000 USD. |
| Original order | Award Amount descending. |
| Page size | 50. |
| Actual rows | 15 unique awards. |
| Actual final metadata | page 1; hasNext false; last_record_unique_id null; last_record_sort_value "None". |

The successful source page was requested at 2026-10-11T22:52:40.508976+00:00 and retrieved at 2026-10-11T22:52:47.828068+00:00. Its original request SHA-256 is **421aeb476e4c33a8e828fc03d2b52de5a4001ff2573b553264a8603c0c8b1d11**. Its original response has **16,794 bytes** and SHA-256 **201d7ef6d8e9d7a3823a04d1405b8e44006926229e885ec83cf0d130eca02f20**.

The completed detail collection has 15 official HTTP 200 responses, totaling 103,301 bytes. Each detail entry has its own generated unique award ID, exact source URL, capture time, byte count, SHA-256, and receipt filename. After an interrupted capture process, the source owner reused the 13 responses already present and acquired only the two missing original records. The final collection manifest records completion at 2026-10-11T23:03:58.298245+00:00.

The importer follows the original query and collection manifests, validates each response, retains every original byte string, and attaches the details to the original search edition. A subsequent fresh acquisition is a distinct observation with its own request, time, bytes, and identity.

## Real field behaviors preserved by the product

The original cohort contains useful distinctions that the normalized projection must preserve.

| Original record | Source distinction and research consequence |
| --- | --- |
| All 15 awards | total_outlay is null. A separate total_account_outlay value of 0 does not fill that missing outlay field. |
| WINTrio / 70FA3126F00000078 | Recipient UEI E9GWUWJTVME7 differs from returned parent UEI FJKXXRJG14R5. |
| WINTrio / 70FA3126F00000078 | Base/exercised amount 493058.57 differs from all-options amount 1509875.47; current end 2027-09-29 differs from potential end 2029-09-29. |
| STS / 70VT1526F00043 | Obligation 461220 differs from exercised 465589 and potential 875929. |
| ICF | Recipient UEI QHBLBNKKV4U3 differs from returned parent UEI S48EJAG5DJ11. |
| August Schell / 2099CH26F00017 | Awarding agency and subagency are null in the summary while funding agency Treasury/TTB is populated. |
| Wilcore / 36C10B26F0372 | Current and potential performance end 2026-09-29 despite inclusion through its September 21 signed date. |
| Fearless / 205AE926F00133 | The description covers IRS full-stack data/AI upskilling and continuous development; current period 2026-09-24 through 2027-03-23. |
| WINTrio / 70FA3126F00000078 | The description covers FEMA OCIO AI support; current period 2026-09-30 through 2027-09-29. |

These are retained source observations. A proposed technical workshare is recorded separately as the analyst's work. The native driver chooses an actual retained award, supplies a source-linked research record, and binds research to its original edition. Commercial terms enter only through an explicit private review file or the operator.

Original WINTrio detail identity:

- Unique award ID: CONT_AWD_70FA3126F00000078_7022_47QTCB21D0194_4732
- Original detail response: 7,094 bytes
- SHA-256: 182b55470a5a7ef181353271361238b1cacc73182cb620ad4006b549687ef84d

## Original Stellar Forge integration

All repository paths below are relative to stellar/scf-starforge-20261009.

| Existing module | Use in this product |
| --- | --- |
| sf30-seller-sdk/dataset-handler.mjs | Loads the exact immutable CSV/config, supplies dataset admission and handling, and generates original page/cursor semantics. |
| sf30-seller-sdk/dataset-cli.mjs | Builds the original native dataset seller configuration from the actual payment/origin configuration. |
| sf30-seller-sdk/serve.mjs | Runs the existing seller service. |
| sf100-buyer-dataset-delivery/deliver.mjs | Initializes, appends, scans, and finalizes original numbered delivery archives. |
| sf88-operator-buyer-cli/research-dossiers/dossier.mjs | Stores actual questions, original source receipts, portable exports, and reopened research dossiers. |
| sf30-seller-sdk/usaspending/dossier.mjs | Imports one existing award edition into the original dossier and reconstructs its exact first packet. |

The original SF100 delivery module inspected during integration has Git blob **d4295e06857f106d7dd0e9c46bc312652ee106b5**. Its appendMany operation receives each original absolute page filename, operation handle, optional exact prior cursor, and evidence filename. The first cursor is omitted. The dataset handler's successful admission result is true, and its successful handle result contains status 200 plus the original dataset page in body.

The product's direct source-native run records local_dataset_read in each evidence file and uses an explicitly local dataset read handle. The same original archive/receiving code subsequently adopts those pages. A funded buyer's original received delivery enters through the same adoption API with its own retained native receipts and operation identity.

The dossier bridge retains original source pages and details, source-completion metadata, the selected or received view's separate coverage, exact typed award values, the original native manifest bytes, and every numbered receiving archive. It chunks complete original archives to fit the dossier source store, preserves question-specific component bindings, and reconstructs the first retained packet from the portable dossier.

## Coverage and lineage

The original source capture's completion and the current edition's row coverage are separate values:

- A completed original query retains its actual final hasNext false and every original source page.
- A partial query retains its successful prefix and its original pending/error state.
- A selected view retains exactly the selected original keys and the complete original capture reference.
- A detail-enriched view retains the original search row and the exact detail record joined to it.
- A received view retains the original delivery's source/selection coverage and original numbered page archives.
- Derived receiving editions resolve the original native archive through edition ancestry.

The source packet also preserves null values, warnings, source filters, original observation times, and explicit source kinds. A null field is an information gap in that field; it does not on its own change a completed source capture into a partial capture.

## Release operation

The original complete run is identified as **usa-research-native-4c21-20261011**. Its driver is run-native.mjs. The operation consumes the retained collection above and journals source import, analyst workshare, partial selection, merchant package, original dataset receiving, two-question dossier delivery, portable reopen, and the actual operator HTTP response. The operation's retained stage records supply the observed runtime outcome.

The driver does not acquire the original cohort again. The source publication and the later native operation each have their own actual release/status receipt. Use the merged repository revision and the retained operation journal when handing this product to the existing commercial owner.
