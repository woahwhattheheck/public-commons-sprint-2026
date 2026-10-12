# Europe PMC retained-source contract

Research checked 12 October 2026. This note records provider and publisher guidance for the original Europe PMC source workspace. Existing captured API bodies retain their own request, retrieval and response metadata; this note does not establish a new capture.

## Production search and paging

Use the original production REST search endpoint, `https://www.ebi.ac.uk/europepmc/webservices/rest/search`, with explicit `query`, `format=json`, `resultType=core`, `pageSize` and `cursorMark`. The first cursor is `*`. Pass each returned cursor verbatim, URL-encoded by the request builder, while keeping query, page size, result type and sort selection stable.

The Europe PMC team's May 2020 explanation says the search hit count is the expected result count for the query. Its explicit exhaustion rule is equality between the cursor sent and the next cursor returned. A null cursor is not the documented terminal condition. Preserve every original page and cursor transition, count distinct source identifiers, and distinguish a complete terminal walk from a stopped or malformed one. [Europe PMC team, 19–21 May 2020](https://groups.google.com/a/ebi.ac.uk/g/epmc-webservices/c/EkpGcWtbJOA)

In a November 2025 reply, the team identifies 1,000 as the maximum page size. The bulk lite metadata export omits core fields such as abstracts, full-text links, reference lists and MeSH terms; selecting lite to save transfers would change the retained data contract. [Europe PMC team, 25 November 2025](https://groups.google.com/a/ebi.ac.uk/g/epmc-webservices/c/f0TIuqrmvHw)

The official version 6.9.0, 2023 reference PDF is explicitly a **SOAP** service manual. It can help identify historical metadata fields but should not silently override current REST response behavior. In particular, its old 0–1000 page-size range should not be used to infer that a zero-size REST search remains supported. [Official SOAP reference, version 6.9.0](https://dev.europepmc.org/docs/EBI_Europe_PMC_Web_Service_Reference.pdf)

## Shared request budget and commercial use

The November 2025 team reply states limits of 10 requests per second or 500 requests per minute, counted for each request/query, not each returned publication or metadata field. A December 2024 team reply says the limit is applied per IP address. Treat both ceilings as shared egress constraints across clients; preserve rate-limit responses and any actual retry instructions. Neither small page sizes nor separate processes create separate provider budgets. [November 2025 limits](https://groups.google.com/a/ebi.ac.uk/g/epmc-webservices/c/f0TIuqrmvHw) · [December 2024 IP scope](https://groups.google.com/a/ebi.ac.uk/g/epmc-webservices/c/cZLnV1JhCj8)

The December 2024 Europe PMC reply confirms that the free API may be used in a commercial web service. It also explains that copyright in the underlying publications and other materials remains with their respective authors and publishers. API access is therefore distinct from permission to redistribute every abstract, article or media item. Keep the original record's licence and attribution alongside exported content. [Europe PMC team, 12 December 2024](https://groups.google.com/a/ebi.ac.uk/g/epmc-webservices/c/cZLnV1JhCj8)

## Original response integrity

A September 2026 public issue from Chris Chen reports occasional HTTP 200 responses containing only `{"version":"6.9"}`, with no result list, hit count or error field. The same report records a structured invalid-page-size response for `pageSize=0`, specifying 1–1000. This is an attributed user observation, not a provider-confirmed service-wide diagnosis or a new observation by this application. It supplies a useful failure shape: a successful transport status without the required result envelope must remain an incomplete source operation, preserving the exact body and any later retry as separate attempts. [Original report, 23 September 2026](https://groups.google.com/a/ebi.ac.uk/g/epmc-webservices/c/gdCleqJXtVg)

Source identifiers are composite: retain the original `source` and `id` together. DOI, PMID and PMCID are additional identifiers with their own presence and normalization rules. Retain original strings and response bytes when projecting them for lookup.

## Rights for the two retained public example records

| Record | Exact identity | Publisher evidence | Retained licence |
| --- | --- | --- | --- |
| Europe PMC in 2023 | DOI `10.1093/nar/gkad1085`; PMCID `PMC10767826`; Nucleic Acids Research 52(D1), D1668–D1676 | [OUP article](https://academic.oup.com/nar/article/52/D1/D1668/7442539); [official PMC record](https://pmc.ncbi.nlm.nih.gov/articles/PMC10767826/) | CC BY 4.0; © the authors 2023 |
| EMBL’s European Bioinformatics Institute (EMBL-EBI) in 2023 | DOI `10.1093/nar/gkad1088`; PMCID `PMC10767983`; PMID `38015445`; Nucleic Acids Research 52(D1), D10–D17 | [OUP article](https://academic.oup.com/nar/article/52/D1/D10/7453257); [official PMC record](https://pmc.ncbi.nlm.nih.gov/articles/PMC10767983/) | CC BY 4.0; © the authors 2023 |

The first paper appeared online on 22 November 2023 and the second on 28 November 2023; both belong to the January 2024 database issue. Preserve the original publication fields rather than deriving a year solely from either article title.

The current official PMC indexed copyright blocks identify both papers as CC BY 4.0. Direct PMC page opens presented a browser check in this research session; OUP article pages independently supplied article identity and content. The retained API's `license: "cc by"` on the first record is consistent with that publisher evidence but does not replace it.

For these two examples, keep author/title/DOI/source attribution, the [CC BY 4.0 licence link](https://creativecommons.org/licenses/by/4.0/), and a description of any changes or derived presentation. Apply the licence to the identified paper content; inspect separately credited third-party material on its own terms. Do not infer the same licence for unrelated Europe PMC records.

## Receiving checklist

The original provider operation should retain:

- Exact request configuration and page sequence, including cursors and source identifiers.
- Original response bytes, observed HTTP status/headers, retrieval time and content hashes.
- A projection version and explicit complete, partial or malformed-envelope outcome.
- Record-level licence, article identity and citation metadata used in a report.
- Original captured records alongside any filtered view or derived table.

These are source and receiving semantics. They do not add another acquisition scheduler or change the original responsible sender or customer relationship.
