# Upstate county population context

This table adds dated Census population information to the same ten counties found in the original retained publisher Web Map. All ten official QuickFacts pages were retrieved on 13 October 2026, and county identifiers were checked against the Census ACS25 South Carolina county table.

## Fields and scientific use

The four numeric columns retain distinct measures: July 2025 resident estimate (Vintage 2025), April 2020 estimates base revised in that same vintage, April 2020 census count and April 2010 census count. Use the first two columns for 2020–2025 current-vintage growth. Keep the original source's historic POP1930/POP1960/POP1990/POP2000 attributes unchanged. Import GEOID/STATE/COUNTY as strings to preserve their fixed widths.

The ten complete counties sum to 1,659,022 persons in July 2025, up 147,105 (9.73%) from their same-vintage April 2020 estimates base. These are whole-county demographic context totals. Watershed-level population needs a spatial allocation dataset and method; a county boundary overlap by itself does not determine that allocation.

## Native integration

Register the CSV and its metadata through the original Workspace source registry. Link its GEOIDs to the admitted original county layer using the supplied county crosswalk, retaining the original collection/source identifiers and parent source lineage. The native source-collection export can transfer both the admitted original vector and this dated table together. Use the table as context in reporting-region summaries.

The complete JSON metadata contains all ten original official page URLs, units, reference dates, estimate vintage and join semantics. CSV values were extracted directly from those retrieved rows; comma thousands separators were removed without rounding. Original polygon coordinates remain in their admitted source and keep the native parser's CRS handling.
