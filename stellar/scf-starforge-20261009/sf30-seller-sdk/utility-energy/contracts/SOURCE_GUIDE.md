# Utility data original sources

These retained JSON strings are the complete code examples published at the linked UtilityAPI documentation pages on 2026-10-12. Their numeric lexemes, offsets, amounts, channels and unusual values are preserved. Each example records its source page and rendered line coordinates. Meter objects retain their original provider IDs. Standalone bill or reading blocks remain standalone source resources; they are not wrapped in invented provider objects.

`utilityapi-examples.json` contains syntactically complete original JSON examples. Read the `content` string as the original source input. The extraction removes rendered code indentation, leading comment labels and exterior whitespace only; it never serializes parsed numbers back to text. `original_rendered_text` retains the full extracted block, including its comment label when present.

`utilityapi-published-object-text.json` preserves the complete published object examples whose original comments, ellipses, missing commas or trailing commas prevent strict JSON parsing. They remain documentation text.

## Complete Green Button source

The original source repository is https://github.com/GreenButtonAlliance/OpenESPI-GreenButton-Java at commit06666dc82396b53ed14e7a5c45266ed54015c1ce. Fetch unchanged files from that pinned source:

- `openespi-common/src/test/resources/fixtures/test_usage_data.xml`: Git blobe63c31a61d130e121ca9d369893e92139c9ec358,324226 bytes.
- `openespi-common/src/test/resources/fixtures/test_usage_data_01.xml`: Git blobe415a3b942ac4a4b49c5fc45a7f385c2fc7d3e17,30748 bytes.
- `openespi-common/src/main/resources/schema/ESPI_4.0/espi.xsd`: Git blob4846013003b693db9bbbe94cfec6ed6bfa0a1a2f,235186 bytes.
- `openespi-common/src/main/resources/schema/ESPI_4.1/atom.xsd`: Git blobf62a6eeb2d86dd49325251ba138686b215c625f8,10701 bytes.
- `openespi-common/LICENSE`: Git blob261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64,11357 bytes.

Retain the original license and all fixture/schema copyright notices. The ESPI4.0 schema declares relative atom.xsd, while the current repository supplies the Atom schema under ESPI4.1. Preserve both source paths and declare any import-resolution choice explicitly. The complete fixture is original published reference data with20 Atom entries and1340 IntervalReading elements; it supplies original UsagePoint, MeterReading, ReadingType, LocalTimeParameters and billing-summary relationships.

## Receiving contracts

https://utilityapi.com/docs/api/intervals/list defines the original pagination and mixed-duration controls: explicit allow_mixed=true retains all available resolutions; limit counts Interval containers, not their nested readings; follow the original next link and inspect is_incomplete even after HTTP200. Short date filters use each utility's local time zone.

https://utilityapi.com/docs/api/intervals/blocks defines net/fwd/rev/gen/max channels, optional physical meter identifiers and units. The deprecated kwh convenience value does not replace the full datapoints array. The original multiple-meter example retains3.46+8.54 alongside aggregate12.01; the original supplier example retains its reversed date pair for explicit source review.

https://utilityapi.com/docs/api/bills/blocks defines exclusive bill and line-item end dates, nullable and signed charge fields, and the distinction between original total cost and line-item sums. Preserve complete supplier, tier, TOU, demand and utility-specific blocks.

https://utilityapi.com/docs/formats documents string UIDs, UTF-8, explicit-offset ISO8601 and extensible units/source types. Unknown source values stay available for review.

## Existing Energy Toolbase integration

https://help.utilityapi.com/energytoolbase-integration-faq- describes the existing UtilityAPI interval import. https://help.utilityapi.com/what-does-mixed-interval-data-mean explains the existing dominant-duration exports, mixed-duration alternatives and Energy Toolbase use. https://www.energytoolbase.com/blog/energy-storage/new-feature-in-etb-monitor-connect-my-data/ describes the existing rolling Green Button Connect integration. The receiving/reconciliation/corrected-edition workflow composes around those established integrations.
