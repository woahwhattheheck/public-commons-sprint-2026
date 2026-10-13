# Elite Digital Agency: complete supplier intake and catalogue coverage

This example uses the complete original first-party pricing CSV, service catalogue and data package retained from Elite Digital Agency on 2026-10-12. The publisher dates the data package and price records 2026-08-12 and licenses the datasets CC BY 4.0. The published amounts are the supplier's displayed prices on its capture date.

Original sources:

- https://elitedigitalagency.io/data/published-pricing.csv
- https://elitedigitalagency.io/data/services-catalogue.csv
- https://elitedigitalagency.io/data/datapackage.json
- https://creativecommons.org/licenses/by/4.0/

## Open the complete reviewed operation

The `elite-delivery` directory contains the complete reviewed original import: workspace, original source files, rules, change report, readable HTML, accepted CSV, SQLite snapshot and lineage. Every content file appears in the maintained conapi-supplier-delivery manifest with its exact UTF-8 byte length and SHA-256. The operation retains all 23 original publisher price rows, including the five published free-tool prices and their zero amounts. Empty charity rates become null canonical values; they retain their original empty spelling in the source file.

From the supplier-report product directory, inspect and export the retained workspace through the existing CLI:

```sh
node supplier-report-cli.mjs inspect --workspace examples/elite-delivery/workspace.json
node supplier-report-cli.mjs export --workspace examples/elite-delivery/workspace.json --out-dir /absolute/new/elite-customer-delivery --table-name elite_published_pricing
```

The export directory must be absent. The CLI generates the complete delivery first, writes every file atomically and writes manifest.json last. Its existing native receiving helper verifies actual file bytes before attaching the bundle to the original request.

To use the browser, start `node supplier-report-cli.mjs serve`, open the printed loopback URL, choose Open review and select `examples/elite-delivery/workspace.json`. The complete sources, mapping, all 23 original-source decisions and accepted table reopen together. Review HTML is the standalone human-readable report. SQLite snapshot creates a new text-preserving table and its lineage and metadata tables.

## What was actually compared

The first operation imports the complete publisher CSV into an explicitly empty destination. The baseline CSV contains the original header and zero data rows. Its metadata identifies a new empty destination; the candidate metadata identifies the publisher, acquisition date, published edition and license. The comparison produces 23 additions, each accepted with a recorded source-intake reason. Final review is revision 23 with zero pending decisions and zero accepted-key conflicts. The saved workspace was reopened through the same core and reproduced the exact accepted result.

The second operation, `elite-reimport-workspace.json`, uses the actual accepted destination CSV as its baseline and the unchanged original publisher CSV as its candidate. Its explicit destination-to-publisher mapping produces 23 unchanged records, zero additions, removals, changes or exceptions, and identical canonical accepted rows. Its predecessor points to the reviewed first operation. The two saved operations show the initial and repeated intake; the separate service catalogue supplies coverage information.

## Canonical fields and commercial meaning

| Canonical field | Source and meaning |
| --- | --- |
| name | Exact publisher price key. Distinct tiers remain separate prices. |
| path | Exact original site path, retained for catalogue joining. |
| title | Original price label. |
| amount_gbp | Exact decimal amount, nonnegative. |
| charity_amount_gbp | Exact separate charity amount when published; blank becomes null. Published zero stays zero. |
| period | Exact one-off, month or free value. |
| display | Full original display string, including amount and any starting-price wording. |
| source_url | Original pricing or service page URL recorded by the publisher. |
| capture_date | Publisher's original capture date. The edition separately records acquisition on 2026-10-12. |
| currency | Explicit GBP constant, supported by the source's amount_gbp schema. |
| price_kind | Explicit alias dictionary from each retained display string to fixed or starting. All strings beginning with the published word from are listed as starting; the other retained strings are listed as fixed. |

The numeric comparison basis is currency, period and price_kind. Full display text remains an original field and can change independently; using that amount-bearing text itself as the price basis would hide legitimate numeric deltas. New display strings outside the explicit alias dictionary become review exceptions until the mapping is updated from that actual source. No quantity ratio or service-unit conversion is inferred.

## Complete catalogue report

The `elite-coverage` directory contains the full JSON working report, CSV and standalone HTML, generated from both complete original files by the maintained catalogue-coverage module. It joins the exact HTTP origin and pathname while preserving each original spelling and both complete rowsets.

| Coverage result | Count |
| --- | ---: |
| Original pricing rows | 23 |
| Original catalogue rows | 29 |
| Pricing rows with a catalogue match | 12 |
| Catalogue services covered by those rows | 7 |
| Services with multiple published price tiers | 4 |
| Price rows without a catalogue row at the same origin/path | 11 |
| Catalogue rows without a published price at the same origin/path | 22 |
| URL, identity or matching exceptions | 0 |

The pricing rows without catalogue matches include the starter site, three healthcare tiers, two care/subscription tiers and five free tools. The report preserves each complete unmatched row. The covered services are SEO, AEO, web design/development, website redesign, Shopify web design, WordPress web design and charity registration. An unmatched catalogue service has no mapped price in these exact source files; its complete row remains available for the customer's next source or mapping decision.

## Import another received file

Start a new comparison with the customer's actual destination and next supplier file. Use the existing CLI compare command or New comparison in the browser shell, then review the resulting keys and exceptions. The example initial rules in `examples/elite-initial.rules.json` map source-shaped columns on both sides; `examples/published-pricing-reimport.rules.json` maps accepted canonical destination columns to the original supplier columns. The previously installed `examples/published-pricing.rules.json` and `examples/published-pricing-intake.workspace.json` remain a separate complete saved intake with its original `price_basis` field and comparison identity. Open the rules retained inside the selected workspace when continuing either case. Keep the new request ID and source acquisition metadata attached to that operation. Existing recorded item IDs belong to their exact source editions and mappings, so new imports generate their own decisions through the review UI.

The complete supplier manifest feeds the existing native `supplier_attachment_files` receiving helper. Coverage outputs join as explicit sibling attachments. The outer native request, archive and native IDs retain their existing ownership.
