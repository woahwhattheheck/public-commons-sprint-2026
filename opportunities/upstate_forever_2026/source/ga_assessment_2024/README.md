# Georgia approved 2024 assessment: original workbook export

This source family decodes the complete original Georgia Environmental Protection Division assessment workbook. The existing assessment normalizer and reach-geography consumer retain scientific interpretation and actual watershed intersections.

## Publisher originals

`acquisition.json` lists the exact official workbook, shapefile ZIP, stream/lake PDFs and four supporting documents. The original workbook response was 344,383 bytes; the stream PDF was 2,378,857 bytes and the lake PDF 188,552 bytes. Receive the full original binary files and compute their actual SHA256 before processing. The public catalog's source capture date is separate from assessment periods and publication dates.

The [official assessment index](https://epd.georgia.gov/https%3A/epd.georgia.gov/assessment/water-quality-georgia) identifies the approved 2024 edition and EPA's September 3, 2024 approval. The [GIS index](https://epd.georgia.gov/geographic-information-systems-gis-databases-and-documentation) publishes the complete original shapefile ZIP. Preserve all original SHP/SHX/DBF/PRJ/CPG/XML and other members together. Preserve the original assessed ReachID independently of a HUC, monitoring station or GIS feature identifier.

## Export every original worksheet and package member

Use Python 3 and the standard library:

```sh
python -B source/ga_assessment_2024/export_original_workbook.py \
  --workbook /absolute/received/georgia-2024-305b-303d-original.xlsx \
  --output /absolute/owned/georgia-2024-original-workbook-export \
  --source-uri https://epd.georgia.gov/document/document/2024305b303dexcelversionxlsx/download
```

The output directory must be new. The exporter retains the exact original workbook and every package member, with byte/hash and original ZIP CRC metadata. `manifest.json` lists all worksheets and their output hashes, original workbook properties, date system, defined names and complete relationships. `shared-strings.json` retains indexes, text and XML.

Each `sheets/NNN.json` keeps stored-cell addresses, original row/column indexes, attributes/types, uncoerced raw string values, resolved shared/inline text, formula text/attributes and cached values. Interior absent rows and cells are explicitly marked `present=false` within the actual stored-cell extent. Original merge ranges and declared dimensions remain separate. The exact XML under `package/` is authoritative; serialized convenience XML may use different namespace prefixes. Styles remain original package members. The exporter evaluates no formula and converts no numeric/date/assessment value.

A noncanonical ZIP member, duplicated row/cell, invalid relationship, absent referenced shared string or excessive rectangular extent raises a source exception. An interrupted export retains its owned staging directory and leaves the input unchanged. The output is the complete original-data export; it is suitable for the maintained `source_tools/georgia_assessment.mjs` consumer. The source implementation has been reviewed; the actual original-workbook native execution supplies the final per-sheet counts and hashes.

## Scientific interpretation remains source specific

The approved methodology includes categories 5 and 5R in the 303(d) list. One reach may have category 4a for one cause and 5 for another. Preserve each original cause/use/category association and original assessment-unit identity. Keep the Source column's potential-source meaning; it is not a measured attribution. Preserve each size Unit and the code-key values. Do not infer a HUC from an opaque ReachID or collapse differing cause categories to one numeric reach status.

The complete original GIS may be joined to the actual watershed polygons through the existing jurisdiction geometry workflow. The original workbook export and GIS edition retain their own field maps and source identities so their records can be reconciled explicitly.
