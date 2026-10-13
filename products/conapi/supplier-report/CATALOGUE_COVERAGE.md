# Catalogue coverage

The catalogue coverage component turns a publisher’s pricing table and service catalogue into one complete commercial review. It identifies the catalogue services with published price tiers, price records outside the supplied catalogue, and catalogue services that need pricing follow-up. Original rows, columns, source strings and provenance stay inside the report.

## Source contract

Place `catalogue-coverage.mjs` beside `supplier-report.mjs`. The module uses the shared synchronous `parseCSV`, `sha256` and `canonicalJSON` helpers and has no external dependencies.

| Input | Contract |
| --- | --- |
| `pricingCSV` | Complete original CSV string. Required columns: `name`, `path`. Each distinct published price tier has its own `name`. |
| `catalogueCSV` | Complete original CSV string. Required column: `url`. The original absolute URL identifies the catalogue service. |
| `origin` | Explicit HTTP or HTTPS origin, such as `https://elitedigitalagency.io`. |
| `sourceMetadata` | Complete JSON object retained in the report. Use `publisher`, `publisherEdition`, `acquiredAt`, `pricingURL`, `catalogueURL`, `metadataURL` and `license` for the visible source description. Other fields, including the original data-package metadata, remain available in full. |

The readable price table displays the publisher’s optional `title`, `amount_gbp`, `charity_amount_gbp`, `period`, `display`, `source_url` and `capture_date` fields. Optional catalogue fields `slug`, `title`, `short` and `section` describe the service. Every additional source column remains in the complete original tables and record exports.

## Complete use

```js
import { readFile, writeFile } from 'node:fs/promises';
import { catalogueCoverage, coverageCSV, coverageHTML } from './catalogue-coverage.mjs';

const [pricingPath, cataloguePath, metadataPath] = process.argv.slice(2);
if (!pricingPath || !cataloguePath || !metadataPath) {
  throw new Error('Pass the original pricing CSV, catalogue CSV and data-package JSON paths.');
}
const [pricingCSV, catalogueCSV, originalMetadataText] = await Promise.all([
  readFile(pricingPath, 'utf8'),
  readFile(cataloguePath, 'utf8'),
  readFile(metadataPath, 'utf8')
]);
const report = catalogueCoverage({
  pricingCSV,
  catalogueCSV,
  origin: 'https://elitedigitalagency.io',
  sourceMetadata: {
    publisher: 'Elite Digital Agency',
    publisherEdition: '2026-08-12',
    acquiredAt: '2026-10-12',
    pricingURL: 'https://elitedigitalagency.io/data/published-pricing.csv',
    catalogueURL: 'https://elitedigitalagency.io/data/services-catalogue.csv',
    metadataURL: 'https://elitedigitalagency.io/data/datapackage.json',
    license: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    licenseURL: 'https://creativecommons.org/licenses/by/4.0/',
    originalMetadata: JSON.parse(originalMetadataText),
    originalMetadataText
  }
});
await writeFile('catalogue-coverage.json', JSON.stringify(report, null, 2) + '\n');
await writeFile('catalogue-coverage.csv', coverageCSV(report));
await writeFile('catalogue-coverage.html', coverageHTML(report));
```

Use the acquisition date and source edition that belong to the actual supplied files when receiving another source bundle.

## Read the result

| Section | Meaning | Operator action |
| --- | --- | --- |
| Mapped published prices | One exact service URL has one or more usable price tiers. | Review the original amount, billing period and price wording before quoting. |
| Published prices outside the supplied catalogue | A usable pricing path has no exact service counterpart. | Decide whether the published offer belongs in the maintained catalogue or has a separate commercial scope. |
| Catalogue services without mapped published prices | The complete catalogue record has no pricing counterpart at the same origin and path. | Prepare the commercial pricing or service-maintenance follow-up from the existing source description. |
| Review exceptions | Duplicate price identities, ambiguous catalogue paths, invalid URLs or candidate rows needing correction. | Inspect the retained original records and provide corrected source records through the supplier review workflow. |

Many distinct price names can map to the same service URL. A business-site tier and a starting web-design tier therefore remain two price records when both share one web-design service. Catalogue slugs are descriptive; the exact URL retains the service namespace.

The join uses the explicit `strict-http-path-v1` grammar, implemented entirely with standard JavaScript string operations. It supports HTTP and HTTPS, ASCII DNS labels without IDNA `xn--` labels, and canonical four-part decimal IPv4 addresses. An optional decimal port must use its shortest spelling and be within 0–65535. Scheme and host case are normalized to lowercase, and the default HTTP 80 / HTTPS 443 port is omitted from the origin key. The complete supplied spelling stays in the original row and join input.

Paths contain ASCII URI path characters and complete `%HH` encoded octets. Path case, percent-encoding spelling, repeated slashes and trailing slashes remain exact. A missing path denotes `/`. Root-relative pricing paths must begin with `/` and cannot begin with `//`. Literal or percent-encoded `.` and `..` segments become exceptions. IDNA and IPv6 hosts, legacy numeric IPv4 forms, foreign origins, credentials, literal whitespace/control characters, backslashes, malformed percent encodings, query strings and fragments become explicit source review exceptions. Source links in the readable report may retain valid URI-encoded queries or fragments; the service join itself uses neither.

This deliberately supported source grammar keeps the same result in JavaScript hosts with or without the `URL` global. The grammar follows the URI path components described in [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986.html) and the host, dot-segment and default-port behavior described in the [WHATWG URL Standard](https://url.spec.whatwg.org/).

A duplicate price name is an identity exception even when its path is valid. A duplicate catalogue origin/path produces an ambiguous match with every original candidate retained. A catalogue service with only unresolved candidate prices appears in review exceptions, so the report preserves the fact that pricing candidates exist.

## Publisher source coverage

The complete original Elite Digital Agency files were acquired on October 12, 2026. Their published capture date is August 12, 2026. The original data package gives CC BY 4.0 attribution terms. See `SOURCE_NOTES.md` for the full source interpretation and original file metadata.

| Actual source relationship | Records |
| --- | ---: |
| Published price tiers | 23 |
| Catalogue services | 29 |
| Price tiers mapping to a catalogue service | 12 |
| Catalogue services reached by those price tiers | 7 |
| Price tiers outside the supplied catalogue | 11 |
| Catalogue services without a matching published price | 22 |

The seven mapped services are web design and development, Shopify web design, website redesign, WordPress web design, AEO, SEO and charity registration. Multiple tiers remain separate for web design, Shopify, SEO and charity registration. The 11 outside-catalogue price records cover the starter website, three healthcare packages, two care subscriptions and five free tools.

The pricing file includes 13 one-off entries, five monthly entries and five free entries. Its charity-price field contains 17 blanks, five published zero values and one separately published amount of 1000 GBP. Blank charity pricing stays blank in CSV and displays as “Not published” in the readable report. The original price wording retains starting-price qualifications.

These files describe complementary parts of one publisher’s offer. The coverage result describes their relationship. For dated price-change review, supply two actual price editions to the separate reconciliation workflow described in `FIELD_GUIDE.md`.

## Export and receiving

`catalogueCoverage()` returns a JSON-compatible report with `sources.pricing` and `sources.catalogue`, each containing the original CSV string, full original column list and source rows, source URL and SHA-256 fingerprint. It also retains all enriched pricing and catalogue rows, matches, complete unmatched sets, complete unresolved sets, exception records, source metadata and the exact join policy.

`coverageCSV(report)` produces one header and CRLF records. Every price tier gets one record; catalogue entries without an accepted price match get their own records. Structured cells preserve each original pricing record and all catalogue candidates. Original file URLs and fingerprints accompany the rows. Commas, quotes and embedded newlines are escaped using CSV quoting. [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180) documents the common CSV format.

`coverageHTML(report)` produces a standalone report with neutral styling, source details, commercial coverage sections, complete exceptions and expandable original tables and source text. It requires no external scripts, fonts or network calls to read. All supplied text is escaped before inclusion in HTML.

To regenerate from a saved report, use its original source strings, `joinPolicy.originInput` and `sourceMetadata` as the inputs to `catalogueCoverage()`. To regenerate only the readable exports, parse the saved JSON and call `coverageCSV()` and `coverageHTML()` directly.

Input and parser failures throw `CatalogueCoverageError` with `code`, `message` and `details`. Row-level problems remain in the report’s `exceptions` collection so operators can read the rest of the complete source coverage.
