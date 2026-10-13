# Georgia approved 2024 — original Savannah-basin assessment context

This complete source collection contains 295 original assessed reaches from Georgia EPD's published 2024 GIS edition: 281 stream and beach reaches plus 14 lake and sound reaches. Both original feature-ID inventories match the captured attributes exactly.

## What the source says

| Overall publisher assessment | Unique reaches |
|---|---:|
| Supporting | 124 |
| Not Supporting | 143 |
| Assessment Pending | 28 |

Fifty reaches have a Category 5 or 5R listing. A source row can carry several categories, so category totals overlap. ReachID identifies an assessed waterbody reach; it is separate from a monitoring station and from a twelve-digit watershed.

This selection is the publisher's entire Savannah basin, including lower and coastal waters. The separate positive-dimensional intersection against the original 217 watershed polygons selects the study subset.

## Use the existing application

Import `sources.json` into the existing scientific Workspace. Its assessment table retains every original row and source pointer. In Scientific Reports, select the imported **Georgia approved 2024 assessment context** recipe. The recipe carries the normalized table, report section, original response bodies, both ID inventories, source metadata, exact query manifest and published-document context as its own companions.

The report does not use a station count as a reach count. Supporting and impaired reaches may occur along the same named river. Hartwell's overall Fishing/PCB impairment coexists with Drinking Water and Recreation uses meeting their criteria. The original published lake PDF supplies the full mercury context: Category 3 with one site's trophic-weighted residue between 0.25 and 0.30 mg/kg.

Eight captured GIS Notes values reach their declared 254-character capacity. `published-document-context.json` supplies separately cited concise summaries from the original 2024 PDFs for those exact reaches. Original GIS fields and listing categories remain intact.

## Reproduce the original attribute transformation

From the current application containing merged PR3818 (836f6b0e7378e3dd3b92aef9e1846aa40172a358):

```sh
node source_tools/georgia_assessment.mjs \\
  --input SOURCE_ROOT/originals/selection.json \\
  --document-context SOURCE_ROOT/published-document-context.json \\
  --output DERIVED_CONTEXT
```

Every original query response is verified by its exact bytes and SHA256, and the complete original selected-ID sets must match. Full workbook extraction remains a separate original edition through ECHO's original cell-export input. The current GIS response is identified as GIS throughout.

Publisher: https://epd.georgia.gov/water-quality-georgia

Original stream PDF: https://epd.georgia.gov/document/document/2024305bstreamspdf/download

Original lake PDF: https://epd.georgia.gov/document/document/2024305blakespdf/download

Exact request URLs and observed acquisition window are retained in the original capture manifest. The requests were captured on 13 October 2026; individual request times were not recorded.

## Public acquisition metadata

`originals/acquisition.public.json` preserves the actual publisher query URLs, selected IDs, acquisition window, response byte counts and hashes. It omits internal transfer handles from the acquisition worker's authored manifest. All original agency response bodies remain byte-for-byte unchanged; every normalized source row and document-context association remains identical to the completed capture edition.
