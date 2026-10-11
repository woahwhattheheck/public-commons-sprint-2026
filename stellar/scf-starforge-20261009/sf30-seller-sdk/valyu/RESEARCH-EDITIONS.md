# Valyu research editions

`research.mjs` provides the domain layer between the native Valyu delivery,
immutable edition store, and operator interface. It performs no network requests
or filesystem writes. Its exports return values or UTF-8 buffers for the existing
server and CLI to deliver.

## Runtime API

| Export | Result |
| --- | --- |
| `analyzeValyuResponse(payload)` | Status, display rows, original values, source/usage summary, delivery metadata |
| `compareValyuResponses(left, right)` | Added, removed, changed and unchanged rows; movement, source, usage, query and delivery differences |
| `exportResearchEdition(manifestOrSavedEdition, format)` | `{bytes: Buffer, type, extension}` for `json`, `md`/`markdown`, `csv`, or `html` |
| `assertResearchDelivery(payload, options)` | Alias for the shared `assertValyuDelivery` boundary in `delivery.mjs` |
| `safeHttpUrl(value)` | An HTTP(S) presentation URL, or `null` |

The saved-edition wrapper returned by `store.edition(id)` and its `.manifest`
both work with the exporter. The lightweight `store.editionView(id)` is for the
interface; export the original manifest to preserve the actual delivered bytes.

## Original response and delivered response

The immediate parser accepts native Valyu responses. It preserves the entire
payload in `analysis.raw`, including all unrecognized top-level fields. Each
result preserves its entire original object in `row.raw`; `row.content` retains
the provider's string, object, or array-of-objects content value.

Durable analysis consumes `stellar-forge.valyu-search-delivery.v1`. Before reading
results, the parser calls the same `assertValyuDelivery` used at the storage
boundary. A durable result is unwrapped from `results[i].result`. A withheld
result exposes only its opaque occurrence ID: title, source, URL, content, and
citation fields remain absent. The response's raw top-level native fields never
reappear through the view.

This product's server-owned delivery profile decides which original results may
enter an immutable edition. The default profile emits operational handles. A
profile configured for exact licensed sources can retain those complete native
result objects when it carries durable rights. Request-only and content-expiring
profiles emit handles. The retained envelope distinguishes the profile's expiry
for new delivery (`profileValidUntil`) from content expiry (`validUntil`, always
`null` for immutable output). Export does not reinterpret an expired profile as
revoking a previously valid durable edition.

## Row contract and presentation

Each row includes these fields:

| Field | Meaning |
| --- | --- |
| `id` | Deterministic annotation key within a captured response |
| `occurrenceId` | Delivered response occurrence handle; `null` for immediate native parsing |
| `index`, `rank` | Zero-based native result position and one-based display position |
| `contentDisposition` | `durable`, `withheld`, or `immediate` |
| `identity`, `identityKey`, `fingerprint` | Matching metadata used for comparison |
| `title`, `source`, `description`, `url` | Plain presentation text, or `null` when absent |
| `safeUrl` | Validated HTTP(S) link without embedded credentials |
| `contentType` | `text`, `object`, `array`, `missing`, `other`, or `withheld` |
| `contentText` | Plain text or formatted JSON for display |
| `content` | Original content union value, unchanged |
| `citations` | Exact provided `id`, `title`, `url`, `doi`, `citation`, `citation_count`, `authors`, `publication_date`, and `references` fields |
| `authors`, `citation`, `doi`, `publicationDate` | Presentation convenience values |
| `price`, `length`, `relevanceScore` | Finite provider numbers, otherwise `null` |
| `raw` | Whole original retained result object; `null` for withheld results |

Use DOM `textContent` for presentation fields and `safeUrl` for links. Neither a
provider content string nor its citation is HTML. Presentation text removes
control and directional override characters; the original values remain intact
in `raw`. The standalone HTML export escapes every provider and annotation
value, makes no network requests, and contains no JavaScript. Markdown uses
dynamically sized literal fences for result content, citation fields, annotations,
and the complete manifest, so provider text cannot close its own fence.

## Status and accounting

The parser distinguishes four states:

| `status` | Interpretation |
| --- | --- |
| `success` | Provider success with one or more returned occurrences |
| `empty` | Provider success with an empty results array |
| `error` | Explicit native `success: false`, regardless of HTTP status |
| `invalid` | A native input is missing the success flag, results array, or object-shaped result |

Malformed delivered envelopes throw from the shared assertion before becoming
display rows. A nonempty provider `error` field on `success: true` is a warning;
it does not turn a successful empty search into a failure. Native raw warnings
remain intact in the original payload. Projected output reports local warning
codes plus operational `providerErrorPresent` and `providerWarningCount` signals.
The provider HTTP status, including 206 partial success, is retained separately.

`summary.resultCount` includes withheld occurrences. `summary.sources` and
`sourceCount` describe only the available named sources, with explicit
`sourceSummaryScope` and `unknownSourceResultCount`. Each named-source entry
counts available result prices and lengths; its `listedResultPricesDollars` is
the arithmetic sum of the supplied per-result prices. The independent
`summary.usage.totalDeductionDollars` is the provider's reported charge, and
`totalCharacters` is its reported character total. Missing numeric metadata is
`null`; it is never represented as a measured zero. The immediate parser also
retains native `results_by_source`; the delivered profile omits source aggregates
that were not authorized for retention.

## Comparing exact editions

Pass the two saved manifests' `response.payload` values to
`compareValyuResponses`; the function never re-queries Valyu. Provider result IDs
are namespaced by the exact source. If an ID is absent, the complete original URL
is the fallback identity; query strings, fragments, and source names are not
discarded. Results without either identifier match only when their complete
content fingerprint agrees.

Duplicate IDs remain separate rows. The comparator first pairs exact original
objects, then pairs remaining rows with the same identity in response order.
Reordering identical rows reports `moved: true` without labeling their content
changed. Matching occurrence handles can connect different delivery dispositions
of the same upstream position. A URL can bridge one side's missing ID only when
the pairing is unambiguous; it never overrides conflicting provider IDs.

Every changed pair includes `before`, `after`, and `changedFields`, covering
content, citation, relevance, price, metadata, and future provider fields.
Added and removed rows remain complete. Usage, named-source counts, query,
warnings, provider success, and delivery-profile changes are reported separately.
Withheld handles match only their actual occurrences; `opaqueAdded` and
`opaqueRemoved` count unmatched handles without inferring source identity.

The row `id` combines a SHA-256 identity fingerprint and the duplicate ordinal.
An immutable edition freezes annotations against those exact row IDs. Annotation
carryover between different captures is an explicit application decision; the
comparator does not silently move notes to a changed or ambiguous result.

## Portable exports

Before writing any format, the exporter requires a delivered edition and checks
the canonical base64 representation, actual response byte count, SHA-256,
UTF-8 JSON decoding, parsed-payload equality, exact saved request, and request
hash. Native raw response objects cannot be exported as durable editions.
The delivered response hash and upstream native response hash remain separate.

JSON returns the native `stellar-forge.valyu-edition.v1` manifest directly for
round-trip import. It contains every retained original field plus the exact
delivered bytes in `response.bodyBase64`. Markdown and HTML add readable
summaries, result content, citation fields and annotations, then embed that same
complete manifest. JSON formatting can differ from the original wire formatting;
the base64 field preserves the wire bytes exactly.

CSV contains an `edition` record with the whole original manifest in
`record_json`, a `summary` record, and one `result` record per occurrence. This
also carries successful empty editions. Each result provides useful plain
columns plus exact `citation_json` and `raw_result_json` cells. Spreadsheet
formula-like presentation values receive a leading apostrophe; original values
remain unchanged inside the JSON cells and embedded manifest. CSV uses quoted
fields and CRLF record endings, preserving embedded commas, quotes and newlines.

## Primary source references

- [Pinned SearchResult and SearchResponse types](https://github.com/valyuAI/valyu-py/blob/b735d8df4f612b603a61cd0613807d3f89bc814f/valyu/types/response.py), blob `0363824648e89d71676f7ae788bc57499cecf578`.
- [Pinned native search client](https://github.com/valyuAI/valyu-py/blob/b735d8df4f612b603a61cd0613807d3f89bc814f/valyu/api.py), blob `6d9cb36354f416bcbcf6281a54584e4e8187fd08`.
- [Search endpoint documentation](https://docs.valyu.ai/api-reference/endpoint/search), retrieved 2026-10-11, especially response success, error/warnings, usage and source fields.
- [Valyu Acceptable Use Policy](https://www.valyu.ai/valyu-acceptable-use-policy), retrieved 2026-10-11; the shared delivery profile handles source retention before the original buyer artifact saver runs.
