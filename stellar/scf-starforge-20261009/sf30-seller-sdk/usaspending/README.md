# USAspending award research operator

A complete local research workspace for federal prime contract awards. Save an agency or service cohort, retain each official request and response, enrich the resulting awards with their original detail records, qualify a prime and a proposed workshare, compare a later edition, and deliver the resulting dataset through the existing Stellar Forge merchant and receiving tools.

The operator includes an industrial browser workspace, a command line, a durable SQLite store, exact decimal values, a portable research packet, and the original SF88 research-dossier integration. Its public dataset projection contains award research; the analyst's contacts, pricing, proposal notes, and disposition remain in the private workspace and explicitly requested review exports.

## Start the workspace

Use Node 24 (Node 22.13+ with node:sqlite and JSON.parse source context is also supported). The research core has no third-party package dependency. Run from the complete Stellar Forge source tree so the existing SF30 dataset, SF100 receiving, and SF88 dossier modules are available.

Installed command:

~~~sh
starforge usaspending-research serve \
  --workspace /private/federal-award-research \
  --operator "Research operator"
~~~

Equivalent source command:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/cli.mjs serve \
  --workspace /private/federal-award-research \
  --operator "Research operator"
~~~

Open the complete URL printed by the command. The server listens on 127.0.0.1 and gives that session a private capability in the URL fragment. The browser uses it for authenticated workspace requests. The interface supports:

- Saved cohorts and source capture, including actual source pages, pause/resume, and explicit capacity changes.
- Searchable award editions with current and parent prime identities, original order and parent award identifiers, agency, procurement, amount, and performance fields.
- Detail enrichment and a named selection of actual award IDs.
- An analyst shortlist and full workshare record, including capability source URLs, scope, deliverables, acceptance, commercial owner, fee, duration, and next action.
- Added, changed, and absent-in-later-results comparison between retained editions.
- Immutable merchant preparation, original dataset preview, and adoption of an existing finalized buyer delivery.
- Exact CSV, source-edition, workshare brief, and portable workspace exports.

Set an explicit --receiving-root DIRECTORY when the browser should enumerate existing receiving folders outside the workspace. A retained source import is also available through the CLI below. Stop the server with Ctrl-C; committed source, reviews, and editions remain in the workspace.

## Save and acquire a real cohort

Create a query definition in a private JSON file:

~~~json
{
  "name": "Federal AI and IT prime awards — September to October 2026",
  "startDate": "2026-09-01",
  "endDate": "2026-10-11",
  "dateType": "new_awards_only",
  "keywords": ["artificial intelligence"],
  "naics": ["541511", "541512", "541513", "541519"],
  "awardTypes": ["A", "B", "C", "D"],
  "minimumAwardUsd": 100000,
  "maximumAwardUsd": 20000000,
  "pageSize": 50,
  "maxRows": 10000
}
~~~

~~~sh
starforge usaspending-research query-save \
  --workspace /private/federal-award-research --file /private/query.json

starforge usaspending-research capture \
  --workspace /private/federal-award-research --query RETURNED_QUERY_ID --revision 1
~~~

Additional filters are recipient, awardIds, psc, description, and agencies. Agencies are objects with type awarding or funding, tier toptier or subtier, and the exact agency name; subtier entries can include toptier_name. Date selection is explicit. The supported values are new_awards_only, action_date, date_signed, and last_modified_date. The provider's documented filter contract is linked in SOURCE_MAP.md.

Fresh acquisition uses the official USAspending search endpoint, the configured fields, and an Award ID ascending order. Each accepted source page retains its original request bytes and the entire original HTTP response. Provider continuation values become the next request; completion requires the provider's actual hasNext false. A retained imported capture keeps its original source fields and ordering, including an Award Amount descending query.

The workspace serializes requests, stores provider failures with their response bytes and retry time, and exposes a paused capture for operator resumption. It does not silently widen a query after a provider rejection. A complete cohort, a partial capture, an analyst selection, a standalone detail, and a received dataset view have separate coverage descriptions.

~~~sh
starforge usaspending-research resume \
  --workspace /private/federal-award-research --capture ORIGINAL_CAPTURE_ID
~~~

If the source cohort exceeds the selected local row capacity, the operator can explicitly increase it up to 250,000 using the original capture's current updated_at value:

~~~sh
starforge usaspending-research capacity \
  --workspace /private/federal-award-research --capture ORIGINAL_CAPTURE_ID \
  --max-rows 25000 --updated-at ORIGINAL_CURRENT_UPDATED_AT
~~~

The already accepted pages and the successful response that reached capacity stay attached to the original capture. A subsequent resume continues that capture.

## Import an existing source collection

The source importer accepts the retained Commons USAspending capture and detail manifests. It checks each referenced response against the original SHA-256, byte count, source URL, observation time, and query identity. Source manifest references must point to direct sibling files.

~~~sh
starforge usaspending-research import-collection \
  --workspace /private/federal-award-research \
  --file /private/original-source/source/recent-ai-v2-details.json
~~~

A collection joins the original complete search capture and its original per-award details. It returns the original search edition, the resulting enriched edition, and any explicit detail failures. Repeating the exact import reuses the retained source identities. A capture interrupted during import resumes its original accepted page prefix.

Standalone retained imports are available through import-capture and import-detail. Live detail enrichment takes an explicit JSON array of original award keys:

~~~sh
starforge usaspending-research enrich \
  --workspace /private/federal-award-research --edition EDITION_ID \
  --file /private/award-keys.json
~~~

Enrichment creates another immutable edition. A detail row retains the exact detail source, the joined original search row, and their composite row identity. The earliest source edition and the raw source pages remain available.

## Qualify the prime and prepare useful work

Open an award in the browser to inspect the source-backed identity and procurement fields before recording a fit assessment. A review is keyed by the original award identity and records the exact source edition and row digest that the analyst reviewed. A later source edition keeps the prior review and identifies source changes for renewed review. Concurrent edits use a revision check.

An example analyst record has the following shape:

~~~json
{
  "status": "workshare_prepared",
  "fit": "The analyst's specific explanation of the actual prime and requirement fit.",
  "workshare": "The complete service proposed to the commercial owner.",
  "deliverables": "The receiving product, configuration, and source handover.",
  "acceptance": "Observable customer outcomes and the agreed receiving workflow.",
  "constraints": "Required customer inputs, access, and scope assumptions.",
  "feeUsd": "4800.00",
  "durationDays": "10",
  "primeContact": "Contact confirmed by the original commercial owner.",
  "businessFitUrls": [
    {
      "url": "https://example.org/actual-first-party-capability",
      "title": "Replace with the actual source title",
      "observedAt": "2026-10-11T00:00:00Z",
      "notes": "Replace with the observed source-backed fit."
    }
  ],
  "owner": "Original commercial owner",
  "caseUrl": "",
  "notes": "",
  "nextAction": "The actual agreed action",
  "nextActionDate": ""
}
~~~

Those strings describe a record format; enter the actual case's information. The statuses and review history are available in the operator. Shortlisting requires a fit reason; a prepared workshare requires scope, deliverables, and acceptance.

~~~sh
starforge usaspending-research review \
  --workspace /private/federal-award-research --edition EDITION_ID \
  --key ORIGINAL_AWARD_KEY --revision CURRENT_REVIEW_REVISION \
  --file /private/review.json

starforge usaspending-research brief \
  --workspace /private/federal-award-research --edition EDITION_ID \
  --key ORIGINAL_AWARD_KEY --out /private/workshare.md
~~~

The brief combines exact award source fields and the retained analyst record. It can be joined to the original owner/case without duplicating the acquisition or relationship.

## Understand the source values

| Field family | Meaning retained by this operator |
| --- | --- |
| award_key / piid | USAspending's generated unique award identity and its order/PIID. |
| Recipient / parent recipient | Separate names, UEIs, and provider IDs. A parent is not substituted for the prime. |
| Parent award | Original parent award key and parent PIID, when supplied. |
| Award / obligation / exercised / potential | Separate source amounts. Decimal values are retained as exact strings and calculations use integer arithmetic. |
| Outlays | The source's total outlay value. A null is retained; a separate account-level outlay is not substituted. |
| Signed / current performance / potential end | Separate source dates. A query's signed date does not establish that the current performance period is still open. |
| Agencies | Awarding agency, awarding subagency, and funding agency remain distinct. Missing awarding fields remain missing. |
| Procurement | NAICS, PSC, set-aside, and subcontracting-plan source fields. |
| Source | Original source URL, observation time, query digest, complete raw page/detail bytes, and row lineage. |

The CSV public projection contains 33 stable columns. Standard CSV retains exact string values. Use --spreadsheet for a spreadsheet-oriented export with formula-leading strings escaped. Original source JSON remains available for full fields beyond the projection.

## Compare actual editions

Capture a later source edition from the saved cohort or import the next retained collection, then compare the original editions:

~~~sh
starforge usaspending-research compare \
  --workspace /private/federal-award-research \
  --before EARLIER_EDITION_ID --after LATER_EDITION_ID \
  --out /private/edition-comparison.json
~~~

Comparison joins original award keys and reports each changed source field, exact known amount deltas, added awards, and awards absent from the later results. Acquisition timestamps and capture IDs alone do not count as changes. An award absent from a query result has that precise disposition; the original source and review remain retained.

A named selected view contains only the explicit award keys. Its export carries both its selected-row coverage and the original capture's completion, filters, query definition, times, and source pages. It cannot become a complete original cohort merely because its own row set was fully delivered.

## Prepare and serve the original merchant

~~~sh
starforge usaspending-research merchant-prepare \
  --workspace /private/federal-award-research --edition EDITION_ID
~~~

Preparation writes an immutable dataset package beneath the private workspace and returns its directory. It contains the exact public CSV, original SF30 dataset config, source-manifest references, and a hash-bound bundle. It uses the existing SF30 dataset handler and seller config builder.

~~~sh
starforge usaspending-research merchant-preview \
  --bundle RETURNED_BUNDLE_DIRECTORY --out /private/dataset-page.json
~~~

Preview executes the original dataset admission and handling path. The dataset supports eight identity/agency/procurement filters, three date ranges, and four appropriate string/date sorts. Decimal columns retain exact strings; use research comparison for exact arithmetic.

For a funded merchant, supply the original native seller payment configuration and the operator's actual public origin together:

~~~sh
starforge usaspending-research merchant-prepare \
  --workspace /private/federal-award-research --edition EDITION_ID \
  --payment /private/original-payment.json --origin https://actual-merchant.example \
  --path /federal-awards

starforge usaspending-research merchant-serve \
  --bundle RETURNED_FUNDED_BUNDLE_DIRECTORY --port 8423 \
  --facilitator https://actual-facilitator.example
~~~

The payment file uses the original SF30 payment schema. Existing payer/signing custody and the actual funded operator allocation remain with their owners. Merchant service composes the original seller SDK and optional facilitator; it adds no wallet or settlement implementation.

## Receive the original dataset and continue research

An existing finalized SF100 delivery, including one collected through the original SF88 buyer, can be adopted directly:

~~~sh
starforge usaspending-research adopt-delivery \
  --workspace /private/receiving-research \
  --directory /private/original-finalized-delivery
~~~

Adoption validates the finalized original manifest, numbered pages, source/evidence hashes, and exact row sequence. The workspace retains the original manifest bytes and every numbered native archive. Replaying the same manifest reuses the original receiving edition and can attach the original archives to an older import that lacked them. Detail enrichment or a selection derived from a receiving edition preserves those original delivery bytes through ancestry.

Use the companion **DOSSIER.md** for the installed usaspending-dossier commands. The dossier bridge consumes the same retained workspace edition once and supports exact source restoration, original native receiving provenance, portable export/reopen, and distinct question bindings when multiple research questions reuse a cohort.

## Export and reopen

~~~sh
starforge usaspending-research export-edition \
  --workspace /private/federal-award-research --edition EDITION_ID \
  --out /private/source-edition.json

starforge usaspending-research backup \
  --workspace /private/federal-award-research --out /private/workspace-packet.json

starforge usaspending-research restore \
  --workspace /private/reopened-research --file /private/workspace-packet.json
~~~

An edition export includes exact original source bytes and source lineage. Reviews require --include-reviews. A complete workspace backup contains the private research records, source store, review history, original deliveries, and operation history; place it in the authorized receiving location. Restore requires an empty workspace and validates the source and delivery archives. Output files are create-only.

## Run the complete original source workflow

The source-native driver executes a whole receiving operation from the retained Commons capture/detail collection:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/run-native.mjs \
  --source-collection /private/original-source/source/recent-ai-v2-details.json \
  --out /private/usa-research-native-4c21-20261011 \
  --operation-id usa-research-native-4c21-20261011 \
  --operator "USAspending research operator"
~~~

It imports the original query and award details, retains a useful analyst workshare, creates a partial selected view, prepares the immutable merchant, reads real pages through the original dataset handler, archives them with the original SF100 receiving module, adopts the full receiving view, answers two actual research questions through the original dossier store, exports and reopens both research stores, and opens the operator HTTP surface.

Each direct dataset read records sourceKind local_dataset_read, its exact query, snapshot, source edition, page bytes, and observation. Its original receiving handle identifies that local read. An optional actual --payment FILE --origin HTTPS_ORIGIN prepares the funded merchant using the existing config. The acquisition, local dataset operation, and any later funded buyer operation retain their own observed outcomes.

The driver journals its original operation ID and original source manifest digest. Resume the same operation with the same directory and inputs after an interruption. Source import and native delivery reuse retained original pages. The complete run's operation.json records its actual stage outcomes; SOURCE_MAP.md identifies the technical contracts and original public cohort supplied for this release.

## Source files

| File | Responsibility |
| --- | --- |
| core.mjs | Source JSON, exact values, source projection, query contract and comparison. |
| transport.mjs | Official request execution and retained HTTP results. |
| workspace.mjs | Durable source, capture, editions, reviews, delivery lineage and recovery. |
| source-import.mjs | Original capture/detail collection import and file validation. |
| merchant.mjs | Original SF30 merchant preparation and SF100 delivery adoption. |
| brief.mjs | Source-linked workshare export. |
| server.mjs, web/ | Complete private browser operator. |
| cli.mjs | Installed research command. |
| dossier.mjs, dossier-cli.mjs, DOSSIER.md | Original research-dossier integration and receiving guide. |
| run-native.mjs | One complete source-native receiving operation. |
| SOURCE_MAP.md | Original source contracts, cohort provenance and field semantics. |
