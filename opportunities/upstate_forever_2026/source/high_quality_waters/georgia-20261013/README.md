# Georgia original water designations

This source retains all 30 specific designated-use entries in the Savannah
River Basin table and all 256 statewide county trout clauses in Georgia
Rule 391-3-6-.03, EPA-approved August 31, 2022. The trout section covers 31
counties. Eighteen explicit None category declarations remain separate.

## Original sources

- Approved 53-page rule: https://epd.georgia.gov/document/document/georgia-water-quality-standardsaug-2022pdf/download
- EPD edition index: https://epd.georgia.gov/watershed-protection-branch/watershed-planning-and-monitoring-program/georgia-water-quality
- EPA Georgia standards index: https://www.epa.gov/wqs-tech/water-quality-standards-regulations-georgia

The current approved edition was adopted January 28, 2022 and approved
August 31, 2022. Separately displayed draft/triennial proposals are not
substituted into this register. Record effective_date values are null because
the original table supplies no individual designation dates. The edition's
CWA approval date is retained independently.

rule-indexed-source.json retains 561 original extracted text lines covering the
complete Savannah table, county trout section and original definitions.
Extraction line indices are not printed statutory line numbers; one-based PDF
pages are preserved separately. The original 514,565-byte PDF is retained on
the shared source page. Its public URL is the primary reference; no PDF byte
hash is inferred from extracted text.

## Reproduce the complete register

rule-selection.json records reviewed original column/paragraph spans.
build_registry.mjs reconstructs all 286 records from retained source lines,
rejecting missing lines, incorrect name/class columns, wrong trout ordinals,
duplicate IDs, skipped numbered clauses and changed cohort counts.

```bash
node source/high_quality_waters/georgia-20261013/rebuild.mjs
```

This command compares the reconstructed semantic document with the retained
register and reports source/input hashes without overwriting original files.
The CSV contains the same complete records with arrays serialized explicitly.
The builder was executed against the actual retained lines: all 286 records
matched every field of independently parsed source rows. This verifies source
transcription; it is not a GIS intersection result.

## Preserve the two legal roles

Savannah designated-use rows retain complete boundaries and literal combined
uses. Repeated waterbody names with different reach descriptions stay separate.

County trout clauses describe watersheds, tributaries, exclusions, road
crossings, upstream/downstream limits and conditional countywide coverage.
They are not 256 individual mapped stream segments. Their full clauses are
authoritative. Derived short display labels have allow_name_candidate=false,
so name coincidence cannot make a conditional paragraph coextensive linework.

Primary Trout Waters support a self-sustaining trout population. Secondary
Trout Streams support trout year-round without the stated evidence of natural
reproduction. The original definitions and additional criteria are retained.
These categories are not renamed to another state's classes.

Section (14)'s default Fishing rule remains policy context. A missing
association or empty map selection does not establish that a water is governed
only by this default.

## Geographic scope and public fishing-map discovery

The Savannah table includes downstream reaches beyond the study. County trout
rules include other Georgia basins. Neither full source cohort is asserted to
be wholly within the original 217-HUC domain. The maintained native crosswalk
provides measured intersections and source associations.

The retained DNR item/service/layer JSON are original metadata responses for
public item c019227530f545f1ad74d71ab3ff9144:

https://services6.arcgis.com/9QlSLDqa0P1cHLhu/arcgis/rest/services/Georgia_Trout_Streams_Public_Download_All_Layers/FeatureServer/1

Fields are OBJECTID, Name, Basin, Spec_Reg, Regs, Delay_har and Hvy_stock.
The layer does not contain statutory Primary/Secondary classes. The publisher
describes simplified NHDPlusV2-derived fishing-map linework. Its useful
discovery metadata is preserved, with no automatic legal geometry substitution.

## Import and use

Import ga_classified_water_sources.json from the application root into the
existing Workspace. Water source review recognizes registry v2 and retains all
companions. Choose GA, a literal class or individual component, read the
complete original clause, and export filtered CSV/JSON or a printable briefing.
Retain explicit jurisdiction-qualified geometry bindings when the original
reach relationship has been resolved.
