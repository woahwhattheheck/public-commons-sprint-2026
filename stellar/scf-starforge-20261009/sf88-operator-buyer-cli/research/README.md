# Research workspace

Keep an OpenAlex search, its received pages, the review decisions, and the final report together. Each edition retains the original provider responses and can be reopened for analysis, CSV, bibliography, and a standalone HTML report.

The workspace uses the existing SF88 buyer for paid merchant retrieval and the existing SF30 OpenAlex source for an operator's direct retrieval. The merchant setup is described in [the OpenAlex operator guide](../../sf30-seller-sdk/openalex/README.md).

## Start with a saved query

Run commands from `stellar/scf-starforge-20261009` in the existing Node runtime. The workspace and provider budget directories should be outside the source checkout. Use the configured Node runtime and its existing dependencies; an environment that uses an HTTP proxy needs Node 22.21+ or 24.5+ for the source's explicit Agent proxy settings. See [Node's proxy support](https://nodejs.org/download/release/latest-v24.x/docs/api/http.html#built-in-proxy-support).

Create `greenhouse-query.json`:

~~~json
{
  "id": "greenhouse-heat-pump",
  "label": "Greenhouse heat-pump research",
  "entity": "works",
  "parameters": {
    "search.title_and_abstract": "greenhouse AND \"heat pump\"",
    "per_page": "100",
    "select": "id,doi,title,display_name,publication_year,publication_date,type,language,cited_by_count,authorships,primary_location,open_access,topics,keywords,funders,awards,biblio,is_retracted,updated_date"
  }
}
~~~

This example searches title and abstract text. OpenAlex's broader `search` also searches other text and keywords; save a separate query when changing that scope. Boolean operators are uppercase and quoted terms preserve phrases. [OpenAlex search semantics](https://help.openalex.org/api/searching/)

The selected fields are top-level provider fields. Include `id` so every work remains identifiable; selecting `authorships` brings its supplied nested affiliation data. Missing fields remain distinguishable from explicit nulls. [Selecting fields](https://help.openalex.org/api/selecting-fields/)

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs query-save \
  --workspace /private/research \
  --file greenhouse-query.json

node sf88-operator-buyer-cli/research/cli.mjs edition-create \
  --workspace /private/research \
  --query-id greenhouse-heat-pump \
  --edition-id greenhouse-2026-10-11 \
  --label "Greenhouse heat-pump research — first edition"
~~~

A query revision freezes its label, entity, and parameters under a SHA-256 identity. The edition pins that revision and its hash. Do not put `page` or `cursor` in the saved query: the workspace owns the page sequence. Omitted `corpus` preserves the provider's default; choose and save `"corpus": "all"` explicitly when an expanded corpus is wanted. OpenAlex currently excludes the expansion corpus from the default API selection. [Works attributes](https://help.openalex.org/data/works/attributes/)

To revise the query, edit the JSON and pass the current revision from `queries`:

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs queries \
  --workspace /private/research

node sf88-operator-buyer-cli/research/cli.mjs query-save \
  --workspace /private/research \
  --file greenhouse-query.json \
  --expected-revision 1
~~~

A changed query creates a new revision. Existing editions continue to use their original revision. An explicit `--query-revision N` on `edition-create` selects an older saved revision.

## Receive the full cohort

Choose the retrieval route that corresponds to the available account and merchant.

### Operator retrieval

The operator's configured OpenAlex source supplies the pages. All processes using the same provider account share the same budget directory and account label.

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs gather \
  --workspace /private/research \
  --edition-id greenhouse-2026-10-11 \
  --merchant-config /private/openalex/merchant.json \
  --budget-dir /private/openalex/budget \
  --product researchWorks
~~~

This command uses the edition's saved parameters and advances through the exact provider cursors. Reopen the same edition to continue an interrupted acquisition. Keep its retained files together so recovery can use an already received page. The optional `--max-pages N` pauses after an explicitly selected batch; omitting it continues to the terminal page.

### Native SF88 buyer retrieval

Use the original buyer profile and the merchant's exported `seller-client.mjs`. The selected product must be a list of the edition's entity.

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs gather \
  --workspace /private/research \
  --edition-id greenhouse-2026-10-11 \
  --buyer-profile /private/buyer/profile.json \
  --client /private/openalex-export/client/seller-client.mjs \
  --product researchWorks
~~~

When connecting to an operator-supplied service origin, add `--client-origin ORIGIN`. The buyer profile, generated client, and merchant's complete payment terms determine the payment route. Keep the original buyer's saved result with the returned page so the edition can reopen both.

### Import a page already obtained

A provider response can be received without another provider request:

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs receive \
  --workspace /private/research \
  --edition-id greenhouse-2026-10-11 \
  --response /private/capture/page-00000001.json \
  --request /private/capture/page-00000001-request.json \
  --source-url 'https://api.openalex.org/works'
~~~

The request file describes the exact request corresponding to those bytes:

~~~json
{
  "entity": "works",
  "parameters": {
    "search.title_and_abstract": "greenhouse AND \"heat pump\"",
    "per_page": "100",
    "select": "id,doi,title,display_name,publication_year,publication_date,type,language,cited_by_count,authorships,primary_location,open_access,topics,keywords,funders,awards,biblio,is_retracted,updated_date",
    "cursor": "*"
  }
}
~~~

Keep every selected query parameter and the exact cursor. The workspace compares the request to the next request in the edition. Supply the complete captured request URL to `--source-url` when it is available.

For an original saved SF88 result containing the response, use `--result` instead of `--response`:

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs receive \
  --workspace /private/research \
  --edition-id greenhouse-2026-10-11 \
  --result /private/buyer/results/original-result.json \
  --request /private/capture/page-00000001-request.json
~~~

Use `--buyer-result FILE` with `--response FILE` when the response bytes and original buyer result were retained separately. The receiver verifies their relationship before recording the page.

## Read coverage before interpreting a table

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs inspect \
  --workspace /private/research \
  --edition-id greenhouse-2026-10-11

node sf88-operator-buyer-cli/research/cli.mjs editions \
  --workspace /private/research
~~~

| Coverage state | Meaning |
| --- | --- |
| EMPTY | No completed page has been received. The first request starts with `cursor=*`. |
| PARTIAL | Retained pages are valid and a further provider cursor remains. |
| COMPLETE | The walk began at `*` and reached the provider's terminal empty result with a null next cursor. |
| INTERRUPTED | The retained chain or acquisition needs attention; inspect the reason and the pending operation before continuing. |

OpenAlex cursor paging continues until `meta.next_cursor` is null and the results are empty. A short page with another cursor continues. Basic numbered paging has a 10,000-result limit; the workspace uses cursor paging for full cohorts. [Paging through results](https://help.openalex.org/api/paging/)

The provider's reported total, the number of received occurrences, and the number of distinct retained IDs are separate measurements. A live dataset may change during a walk. Each page keeps its reported count, timestamp, cursor, byte length, and hash; the coverage summary exposes count changes. COMPLETE describes that saved query's cursor walk.

## Review identified works

The cohort table uses the full canonical OpenAlex ID as its key. The first occurrence of an ID in page order supplies the retained metadata. Later duplicate occurrences and conflicting fields remain visible. Titles, DOIs, and author names are display and bibliographic fields rather than alternate deduplication keys.

A record starts as `undecided`. Select an actual ID from `inspect` or the workspace, write the review notes in a UTF-8 file, and save the decision:

~~~bash
REVIEW_WORK_ID='https://openalex.org/W_REPLACE_WITH_AN_ID_FROM_THE_EDITION'

node sf88-operator-buyer-cli/research/cli.mjs decide \
  --workspace /private/research \
  --edition-id greenhouse-2026-10-11 \
  --record-id "$REVIEW_WORK_ID" \
  --status include \
  --notes /private/reviews/selected-work.txt \
  --tags greenhouse,heat-pump,methods-reviewed
~~~

Replace the illustrated ID before running the command. The accepted statuses are `include`, `exclude`, and `undecided`. The command records notes, tags, and the update time. Use `--expected-revision N` with the current annotation revision when coordinating edits from multiple operators.

Selected CSV and bibliography files include only `include` decisions. Excluded and undecided records remain in the full edition and review export.

### A practical greenhouse research review

Start with the saved heat-pump query above, then create separate query revisions or named queries for materially different search strategies. For a northern greenhouse study, review each candidate against the project's actual questions:

| Review question | Useful note or tag |
| --- | --- |
| Does the work address crop greenhouses and their heating or cooling demand? | `greenhouse-scope`; identify the studied crop and structure if the paper supplies them. |
| What system was studied? | Ground source, air source, water source, storage, or another stated design. |
| Are performance values measured, modeled, or manufacturer ratings? | Record the basis and the quoted operating conditions in the review notes. |
| Which climate, time interval, temperatures, and thermal boundaries apply? | Keep those conditions alongside the candidate finding. |
| What is useful for the engineering model? | Link the exact work ID and source passage to a demand assumption, equipment comparison, or question requiring follow-up. |

The report organizes the bibliographic cohort and your decisions. Assess a paper's engineering findings from its actual content before using a number in the thermal or financial model. Citation totals, topic membership, and affiliation counts provide navigation through the literature.

A reusable review note can be stored in the same notes file:

~~~text
Work ID and DOI:
Source URL, page/table/figure:
Study location and weather period:
Greenhouse floor area, shape, cover, insulation, infiltration:
Crop and day/night temperature or humidity targets:
Operating months and hours:
System family: shallow air-earth / liquid closed loop / mine water / other
Evidence basis: measured / calibrated model / unvalidated model / review
Delivered heating and cooling: quantity, unit, period, boundary
Electricity: compressor / circulation / fans / dehumidification / controls
Backup: capacity, fuel, hours and included energy
Ground exchanger: pipe, depth, length, spacing, soil and moisture conditions
Annual heat fraction and peak-load fraction:
Stated uncertainty and limits on transfer to the project:
Engineering use and follow-up:
~~~

Complete each line from the cited paper or mark it as unspecified in the reviewed source. This notes format is retained by the existing decision command, HTML report, CSV, and JSON exports. Separate shallow air-to-earth systems, liquid closed loops, and mine-water heat sources when comparing candidates.

## Compare editions and carry review decisions

Create a fresh edition for a later capture, preserving the query revision when the objective is to compare the same search:

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs edition-create \
  --workspace /private/research \
  --query-id greenhouse-heat-pump \
  --query-revision 1 \
  --edition-id greenhouse-followup \
  --label "Greenhouse heat-pump research — follow-up"
~~~

Gather that edition with the same selected retrieval route, then compare:

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs compare \
  --workspace /private/research \
  --before greenhouse-2026-10-11 \
  --after greenhouse-followup

node sf88-operator-buyer-cli/research/cli.mjs copy-decisions \
  --workspace /private/research \
  --before greenhouse-2026-10-11 \
  --after greenhouse-followup
~~~

The comparison lists IDs added or removed and each changed supplied top-level metadata field. An omitted field differs from a supplied null. Review both query identities and both coverage summaries when interpreting a change. A newer `updated_date` can reflect changes in the citation graph. [Work update and citation fields](https://help.openalex.org/data/works/attributes/)

`copy-decisions` carries matching ID decisions into the receiving edition. Use its `--expected-revision N` option when the destination already has a known annotation revision; review the resulting decisions before exporting the new selection.

## Produce the report and the portable edition

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs report \
  --workspace /private/research \
  --edition-id greenhouse-followup \
  --before greenhouse-2026-10-11 \
  --out /private/delivery/greenhouse-report.html

node sf88-operator-buyer-cli/research/cli.mjs export \
  --workspace /private/research \
  --edition-id greenhouse-followup \
  --out /private/delivery/greenhouse-edition
~~~

The HTML report is standalone: its tables, local search, review filter, print styles, and source links work from the saved file. It includes the complete identified cohort and the author, institution, topic, funder, source, year, type, language, open-access, and country summaries.

| Export | Contents |
| --- | --- |
| `report.html` | Readable report with query, coverage, records, review status, group tables, and identity notes. |
| `records.csv`, `selected-records.csv` | All distinct identified records and the included selection. |
| `review-decisions.csv`, `decisions.json` | Per-ID review status, notes, tags, update time, and saved annotation state. |
| `authors.csv`, `institutions.csv`, `topics.csv`, `primary-topics.csv`, `funders.csv`, `sources.csv` | Group counts with explicit retained member IDs and denominators. |
| `years.csv`, `types.csv`, `languages.csv`, `open-access.csv`, `countries.csv` | Other cohort summaries. |
| `references.bib`, `references.ris`, selected variants | Bibliographies for works using supplied names and bibliographic fields. |
| `duplicate-occurrences.csv`, `unidentified-records.csv`, `field-coverage.csv` | Identity conflicts and supplied-field coverage. |
| `edition.json`, `query.json`, `coverage.json`, `analysis.json`, `research-analysis.json` | Machine-readable edition, query, coverage, and analysis. |
| `page-index.json`, page directories, `manifest.json` | Retained request and response files, original buyer results when present, and exported file hashes. |

The programmatic `researchExports` function also emits comparison JSON and added/removed/changed CSVs when passed a comparison. The `report --before` command embeds the requested edition comparison in the HTML report.

By default, the edition export includes page bytes and retained native buyer results. `--without-pages` and `--without-native` produce deliberately smaller handoffs. Preserve the full original edition for later reopening.

CSV cells with spreadsheet formula prefixes receive a leading apostrophe; exact text remains in the JSON. BibTeX and RIS omit unavailable fields, retain the supplied author names, and export only the bibliographic data received in this edition.

## Use the local workspace

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs serve \
  --workspace /private/research \
  --port 8469
~~~

Supply the same direct or native retrieval flags used by `gather` when enabling retrieval from the workspace UI. Open the authenticated loopback URL printed by the command. Records, Summary, Sources, Compare, and Exports provide the full cohort, grouped tables, retained page history, review decisions, and portable delivery. Retrieval runs in the background; its stop action finishes the current page before pausing. The Sources view also accepts captured pages and original buyer results.

## How to read the summaries

A work counts once within each author, institution, topic, funder, or country group. Those groups overlap, so their totals can exceed the cohort size. Every summary carries its member IDs and denominator. Missing citation values remain missing; a citation sum describes only supplied citation counts for retained works.

OpenAlex caps a work's returned authorships at 100. The analysis identifies records at that cap and uses the affiliations actually supplied with those authorships. OpenAlex's current work data uses topics, funders, and awards; provider omissions remain visible in field coverage. [Authorships](https://help.openalex.org/data/authorships/) · [Work attributes](https://help.openalex.org/data/works/attributes/)

The same analysis interface supports authors, institutions, sources, topics, funders, publishers, and awards. Their profile metrics remain entity metrics; work bibliography exports are produced for works.

## Data and source terms

OpenAlex metadata is offered under CC0. Linked articles and PDFs retain their own licenses, which should be checked before reusing their content. [OpenAlex access and licensing](https://help.openalex.org/access/pricing/) · [Full-text terms](https://help.openalex.org/access/fulltext/)

The provider documentation referenced here was reviewed on 2026-10-11. The workspace retains the query, source URL, retrieval time, and received bytes so a report remains tied to its own edition as the live catalogue changes.
