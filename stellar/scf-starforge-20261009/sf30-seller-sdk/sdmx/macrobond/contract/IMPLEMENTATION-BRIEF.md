# Macrobond customer series provider: implementation brief

Prepared 2026-10-12 for the existing F1CB SDMX customer workflow.

## Outcome and scope

A customer receives an approved SDMX edition through the original seller/buyer delivery, reviews its series identities and metadata, and publishes a stable private Web API Series Provider for its existing Macrobond Analysis installation. The same operator can compare a successor, approve a new publication, inspect prior provider publications, export the complete receiving project, restore it on another host and continue serving the selected publication. Original source documents, observation text, SDMX statuses and analyst decisions remain attached throughout.

The product should compose the maintained SDMX workspace and SF88/SF100 customer delivery. It needs a provider configuration/publication store and the actual Macrobond HTTP representation, rather than another statistical source database. The initial operated source is the real ECB EXR collection already delivered: eight GBP/USD series across annual, daily, monthly and quarterly frequencies, 544 observations, exact annual GBP value 0.8567923137255.

## Original contract and source identity

- Official provider documentation: https://help.macrobond.com/apis-feeds-connectors/web-api-series-provider/
- Original hosted OpenAPI: https://schemas.macrobond.com/webclientapi.swagger.json
- Native capture of that OpenAPI: HTTP200; 13,318 bytes; SHA256 fc4b93c0caa694d493c6a85c8490d54fad6b3db1a297ef84985a0e6aed6f25d2. The retained response is OpenAPI3.0.1 / Web API v1.
- Original sample: https://github.com/macrobond/client-webapi-sample
- Current native GitHub commit: 9ee0f59a36b8c1224e0e9af3414cf1f982a1b761; tree ff5000eaf6c2b207d2a47e7c4dc24cd434b838b1; commit date2025-06-18.
- Password variant controller: client-webapi-sample-password/SeriesServer/Controllers/SeriesController.cs; Git blob cf70e0fffe39719ad04f1df7f623352db2a022a8.
- Token startup: client-webapi-sample-token/SeriesServer/Startup.cs; Git blob1fedf8af8d09543854cd2b7a9fc2d36929019c4b.
- Token project: client-webapi-sample-token/SeriesServer/SeriesServer.csproj; Git blob172bcfdb402b704f643cca1853b9bde96fdf2fe8.
- Original Apache2.0 license: client-webapi-sample-password/LICENSE; Git blob261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64. The token variant has the identical license blob.

The hosted schema is retained as the original source, with its limitations explicit. It omits current revision methods, calls the loadtree parameter query and listseries parameter name, and represents several dictionary schemas as arrays. The current source and current prose agree on reference for both browse endpoints, actual metadata dictionaries and current revision routes. The README says.NET8; the current csproj targets net9.0. These differences belong in the contract adapter documentation and source manifest.

## Full customer workflow

1. Open the customer's original received SDMX project or its complete portable project. Show retained flow/DSD editions, source URLs, selected response coverage and current reviewed project revision. Keep buyer acquisition identity and public source identity in separate fields.
2. Select the intended series and assign stable lowercase provider identifiers. Save the mapping from each identifier to its full original series key, flow, DSD, source edition and project selection. Display collisions before save; maintain identifiers through later publications.
3. Review the actual wire projection. Present original period/value/status beside the chosen Macrobond date, frequency, number or gap and metadata. Preserve original decimal text and every status in the receiving/export data. Review Class, Currency and Region explicitly because the Macrobond client can use these to alter analysis or conversion.
4. Save a named provider definition using the existing revision/retry pattern. Publish an immutable edition from the approved definition and pinned source; retain the earlier edition. Read requests consume the selected publication.
5. Configure the existing client using an exported XML provider definition, the selected HTTPS host and the customer's chosen authentication. The XML contains connection configuration; credentials stay in their proper private host/client settings.
6. Browse the flow/frequency/currency tree, search descriptions and exact identifiers, load several requested series in order, open metadata and inspect the original source/rights details. Retain useful per-series failures so one unavailable identifier does not erase other requested results.
7. Compare a successor using the original SDMX comparison engine. Review metadata, source coverage and changed observations before publishing the successor. A new transport Header.Prepared timestamp alone does not create an economic revision.
8. Export the provider definition, publication history, exact original source references and native receiving project. Restore them into a separate private receiving root; verify the selected publication and same responses; rotate only the receiving host's private credentials as required.
9. Operate restart, drain, selected-publication change and rollback through this same store. The private operator view provides current state, history, source inspection and full download; the public provider exposes only the approved customer series.

## Public HTTP contract

The adjacent wire-contract.json records exact method/query/response shapes and source discrepancies.

Required: GET getcapabilities and loadseries. A useful complete read service also implements loadmeta, searchseries, loadtree and listseries. getcapabilities advertises only the implemented behavior; allowMultipleSeriesPerRequest controls ordered multi-series requests.

loadseries and loadmeta take repeated n query parameters and return an ordered result for every requested identifier. Each result has a data object or an error. Full data contains values, optional dates and metaData. Metadata property names are case-sensitive PascalCase; structural response fields are lower camelCase. The browse tree uses its documented Description/Children/ChildrenReference/SeriesReference keys.

Search returns metadata dictionaries directly. The list response has groups, optional aspects and rows containing entityMeta; there must be a metadata entry for each declared aspect. Current upstream rows also retain names.

Use application/json; private responses carry Cache-Control: no-cache, private. Return original semantic errors with useful status and text. Avoid automatic source acquisition or publication mutations in provider reads.

## Calendars, numbers and metadata

Map A→annual, Q→quarterly, M→monthly and D→daily for the real ECB source. The documented vocabulary also includes semiannual, quadmonthly, bimonthly and weekly. Extend these only through the original SDMX period parser and retained explicit mapping. The provider's supported date range is1600–2499.

Prefer explicit dates plus a declared frequency and StartDate. Convert a source period to its documented period anchor; keep the original period string in the receiving projection. Maintain actual daily gaps and source chronology. DayMask is an explicit daily-calendar decision; the client default is Monday–Friday. Do not resample a monthly/quarterly source from daily values or manufacture missing observations.

The interface consumes numeric values. Emit validated finite numeric representations without pre-rounding by SDMX DECIMALS; retain the exact original decimal text alongside the projection. Macrobond's sample uses double[] and the original schema describes nullable values. An exact JSON number can still be represented as a binary floating-point value by the downstream client. Surface overflow or a lossy projected representation during review and retain the source string. Missing/nil/empty source states remain distinguishable in the source record even where the consumer representation has one gap form.

PrimName is the durable identifier. Description should identify the source series and edition clearly. Frequency and StartDate are present in loadmeta. Source provenance and units can be described in IHInfo. Currency is not inferred from geography, and a quoted currency/denominator pair is not reduced to a single monetary unit silently. Region, Class and conversion metadata are saved reviewer choices backed by the actual source.

## Publication history and optional vintage behavior

The original contract has loadvintage, loadvintagetimestamps and loadcompletehistory. RevisionTimeStamp is an ISO8601 instant; the returned vintage must be the latest applicable publication at or before the requested time. Unknown identifier and known series before its first available vintage are different cases. The prose specifies the prehistory behavior; the sample's lookup implementation is not a substitute for that rule.

Customer provider-publication history and official statistical revision history are separate. If the product exposes its own reviewed publication vintages, identify that history explicitly in metadata and labels, retaining the original source edition. It must not relabel an ECB response retrieval time as an official release. Only advertise revisionsRelease after actual per-observation release ordinals are represented; local project revision numbers are not those ordinals.

## Authentication and operation

The official client supports unauthenticated providers, Basic credentials entered in its My Series settings, and an already configured external identity provider's bearer token when UseOAuth=true (client1.31+). The original token sample verifies configured authority/audience and an authorized role.

Provide the complete Basic-over-HTTPS operating path and maintain the private operator's existing authenticated control boundary. A selected OAuth integration must validate the real configured issuer/audience and authorization instead of treating an arbitrary bearer string as a verified identity. Keep generated XML/configuration separate from host secrets, preserve authentication through backup policy and support deliberate receiving-host rotation.

Customer use of Macrobond Analysis remains in its own licensed installation and existing identity. Our provider/native protocol and original received data can be operated in the Linux container.

## Source rights and attribution

The Macrobond sample is Apache2.0. Retain its license and attribution with any reused source; identify our modifications. The hosted contract and help pages are retained by URL, retrieval receipt and digest for implementation provenance; avoid republishing the vendor's full help site.

ECB's source policy permits commercial and noncommercial reuse with attribution and preservation of statistics/metadata; individual third-party series retain their own rights. Source policy: https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html . Reference exchange rates are information/reference data: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html . Carry those original meanings into the customer data and IHInfo; keep analyst decisions identifiable.

## Product receiving outcome

One original received eight-series/544-observation project should exercise mapping, review, provider publication, browse/search, ordered multi-series retrieval, metadata, original-value export, later named publication, selected-publication rollback, complete portable receiving and restart. The native operation should preserve source hashes, calendar/value meaning, stable series IDs and the original customer's publication history. The same private operator should be inspected on desktop and390px width using the existing one-owner browser/service pattern.

## Commercial direction

The likely paid work is a customer's source onboarding, metadata mapping, provider deployment, receiving and operational handover. The existing official provider interface supplies a concrete integration boundary. Our all-history Macrobond Slack query returned no matching relationship; mailbox history and the official business recipient remain to be checked by the relationship owner before outreach. This brief supports the product implementation first.
