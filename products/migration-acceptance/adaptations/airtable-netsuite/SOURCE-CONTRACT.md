# Provider contract sources

Reviewed 2026-10-13. These are provider contracts used by this intake; actual account schema and permissions remain part of the retained customer source.

## Airtable

Official API overview: https://support.airtable.com/articles/6292134965-getting-started-with-airtable-s-web-api

Record lists page at up to 100 records and expose an opaque offset when more records exist. Empty field values may be absent from the response, including empty strings, empty arrays and false. The complete base schema endpoint is GET /v0/meta/bases/{baseId}/tables; schema access needs its relevant scope and actual base authorization. This adapter keeps the full schema and uses explicit missing-value policies.

Official API rate limits: https://support.airtable.com/articles/7735693959-managing-api-call-limits-in-airtable

The documented limit is five requests per second per base, with a separate token/user limit. The provider documents a 30-second wait after a rate-limit response. Plan-level monthly restrictions also apply. This collector runs serially, spaces base calls at 250 ms, observes Retry-After and stops after bounded retries.

Official SDK parameter source: https://github.com/Airtable/airtable.js/blob/master/src/query_params.ts
Official endpoint: https://airtable.com/developers/web/api/list-records
Official schema endpoint: https://airtable.com/developers/web/api/get-base-schema

The retained SDK declares returnFieldsByFieldId as boolean. The collector requests it explicitly, validates every returned field against the captured schema, and preserves raw response bodies. It does not use the SDK's numeric offset type; the documented returned cursor remains opaque text.

## Oracle NetSuite

Executing SuiteQL through REST:
https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157909186990.html

The endpoint accepts a POST containing q and optional bound params, with the required Prefer: transient header. The Records Catalog supplies the actual available record/field contract. The documented REST result limit is 100,000; larger selections require a separately reviewed SuiteAnalytics Connect route. The collector uses this query endpoint only, with an explicit reviewed SELECT and unique ordering.

Collection paging:
https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156414087576.html

The collector retains each count, offset, hasMore and totalResults, limits page size to 1,000 and keeps offset divisible by limit. It requires a terminal page and a complete total count, and rejects page/result ceilings before declaring completion. Response links are preserved as source; credentials are never forwarded to a returned link.

SuiteQL limitations:
https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156257796125.html

Oracle warns that result field/name casing can change, so aliases are compared case-insensitively with collision rejection. Analytic interfaces have field/subtab coverage limits; the mapping must be reviewed against actual Records Catalog availability. The adapter uses full JSON bodies and does not remove formatting from a separate CSV export.

## Original native engine

Public product: https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/tree/main/products/migration-acceptance

The native operator, worker, compilePipeline and exact JSON parser were read in full at their retained source pins. Worker schema is dlthub.expected-table.v1; pipeline input is dlthub.pipeline-input.v1. dlt 1.31.0 is the original runtime pin. This intake supplies files and exact IDs to that existing engine rather than implementing a new loader or target writer.
