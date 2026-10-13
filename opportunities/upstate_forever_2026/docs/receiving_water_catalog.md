# Receiving-water source catalog

## Purpose

The compiler turns original SCDES water-classification and drinking-water
assets already imported into the scientific Workspace into exact receptor
records. Its outputs drive model.receiving_waters.prepare directly and retain
the geometry and source fields needed to explain each map feature.

There are two independent spatial concepts. A classified-water feature is
the reach or waterbody shown in its original source. A drainage relationship
describes the contributing HUC12 units or published source-area polygon used
by the model. The first is retained in classification.legal_geometry_scope;
the second is retained in relation. Computing upstream support does not
change the classified-water geometry.

The receiver integration is separate from the existing application CLI:
source_tools.receiving_water_catalog is a dedicated module, avoiding edits
to the existing operator's argument parser.

## Original source layers

| Profile | Original service | Default model relation |
| --- | --- | --- |
| scdes_classified_streams | https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2 | upstream_huc |
| scdes_classified_waters | https://gis.des.sc.gov/gisserver/rest/services/water/Water_Classifications/MapServer/0 | upstream_huc |
| scdes_surface_intakes | https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/0 | upstream_huc |
| scdes_source_water_areas | https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2 | source_area |
| scdes_protection_zones | https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/3 | source_area |

Source profile titles describe the intended dataset roles. The acquired layer's
original name, field definitions, coded domains, source spatial reference,
update metadata, and source snapshot identity are retained in the catalog.
Acquisition keeps the metadata response and original features from the same
service snapshot together. The compiler operates on those original bytes,
using Workspace.source_file for hash verification and reconstruction.

SCDES's currently supplied R.61-69 document:
https://www.des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf

The retrieved convenience copy lists May 26, 2023 as its latest regulation
history entry. Its cover identifies the final State Register publication as
the legal version. The retrieval date, service update timestamp, regulation
history date, and effective date are separate fields in the workflow. A new
download date does not set a new legal effective date.

## Current classified-stream capture

The active SCHydroClass stream edition uses profile
scdes_classified_streams. The older Water_Classifications layer retains the
separate scdes_classified_waters profile and its own source identity.

The active layer's exact class field is H2OCLASS, name field is HYDNAME,
and true ObjectID field is OBJECTID. Its metadata aliases OBJECTID as
OBJECTID_1 while also retaining a separate nullable integer property named
OBJECTID_1. Field selection uses the actual field name and OID type. The
publisher HUC_12 value stays an original source attribute; the receiving-water
model associates geometry with the actual retained catchment edition.

Original HYDNAME values can contain only spaces. Display titles use a trimmed
name when it is nonempty, otherwise the profile title plus the exact source ID.
The original name remains verbatim in classification.native_name and
classification.source_fields.

The source loader honors explicit root source-entry object_id_field,
classification_field, name_field, and description_field declarations; a
request's field_map can override each deliberately. For a retained
upstate.water-source-dictionary/v1 metadata source, the compiler consumes its
exact sources.scdes.field_metadata and spatial reference, preserving the
dictionary hash and source component.

mapped_classification_status and regulatory_reference are carried from the
original source entry into the catalog and receptor metadata. Publisher-mapped
provisional geometry and an adopted regulatory reference remain distinct.
This source metadata does not become a proposed regulation merely because
the GIS publisher describes its mapping as provisional.

## First inspect the registered source assets

Run from the application's directory with its normal Python environment:

    python -m source_tools.receiving_water_catalog --workspace /path/to/workspace inspect --output receiving-water-inventory.json

The command discovers sources whose original URI matches one of the five
layer URLs, then lists their actual fields, resolved field candidates,
geometry types, raw classification values, source collection IDs, and original
body hashes. It does not choose a legal vintage or the project definition of
high-quality waters.

For source bundles stored under a different original URI, pass --selectors.
That JSON object maps profile IDs to real source descriptors copied from the
Workspace source inventory. A descriptor contains source_collection_id and
source_id, and may include layer, an equality where object, and exact native
feature_ids. Inventory reads apply all three restrictions through the same
loader used for compilation.

A profile selector may also be a full source selection containing source,
field_map and one of the metadata selectors below. This lets the inspector
show the actual scoped records, original coded domains, and explicit field
resolutions before compiling. For example:

    {
      "scdes_source_water_areas": {
        "source": {
          "source_collection_id": "<actual imported 64-character collection ID>",
          "source_id": "scdes-arjws-prwd-swpa-20261012",
          "where": {"OBJECTID": 11}
        },
        "layer_metadata_companion": "metadata/public-water-2.json"
      }
    }

The inventory lists metadata_companions with their exact source_path, hash,
and bytes, plus the selected metadata_provenance and complete layer_metadata.
A field with ambiguous candidates requests an explicit field_map entry.

## Original metadata companions

The public-water source manifests already declare their ArcGIS layer metadata
as companions of the original vector source. The compiler reads those retained
objects directly, verifies their SHA256 and byte length through Workspace, and
matches each companion's exact source_path to the verified original manifest.
It recovers the original metadata URL from that manifest; native source-view
directory layouts do not determine the association.

With no explicit metadata selector, the compiler selects one original ArcGIS
layer metadata object whose declared URL and layer ID match the vector source.
If an older manifest has no companion URL, the explicit original companion
binding and matching layer ID still apply. The original layer response takes
precedence over a derived source dictionary. A dictionary is eligible for
automatic selection only when sources.scdes.layer_url matches the vector's
original service layer. Distinct plausible metadata bodies require an explicit
choice; two copies of the exact same retained body are treated as one.

Use layer_metadata_companion with the exact retained source_path when a source
has more than one matching metadata edition. For the public native input set:

| Vector source | Exact metadata companion |
| --- | --- |
| scdes-public-surface-intakes-20261012 | metadata/public-water-0.json |
| scdes-arjws-prwd-swpa-20261012 | metadata/public-water-2.json |

The precedence is an explicit layer_metadata_source or
layer_metadata_companion, then request layer_metadata, then original
entry.metadata.layer_metadata, then automatic retained companion selection.
The two explicit reference mechanisms are mutually exclusive. JSON input
supports UTF-8 BOMs and gzip detected from its bytes.

Catalog metadata_provenance retains the original manifest object identity,
companion object identity, exact original companion declaration and source
descriptor. Automatic selection never reacquires a service or substitutes a
newer online metadata edition.

The actual public-water identifiers PWSNO, SYSTEM and INTAKE resolve to
system_id and intake_id. DESC_ is recognized as the original protection-zone
description. PWSSTATUS and INTAKESTAT remain separate source properties: when
both exist, choose the intended exact status field in status_filter.field or
field_map.status. The compiler does not conflate an intake's operational state
with the public water system's operational state.

## Source-selection request

The machine schema is source_tools/receiving_water_selection.schema.json.
The top-level schema is upstate.receiving-water-selection/1.

Required top-level fields are as_of and a nonempty sources array. as_of is an
explicit YYYY-MM-DD date, making the same request replay independently of the
day it runs. title and analysis_crs are optional. catchments is the existing
HUC12 source descriptor required for upstream_huc receptors, with id_field and
downstream_field matching the actual source. The model default analysis CRS
is EPSG:5070.

Each source selection has the following fields:

| Field | Meaning |
| --- | --- |
| id | Distinguishes separate selections or vintages of the same profile. Defaults to profile. |
| profile | One of the five exact profile IDs above. |
| source | Original Workspace source descriptor. where is an equality-only dictionary. feature_ids are native vector IDs. |
| layer_metadata_source | Optional source descriptor for the original ArcGIS layer metadata JSON, including gzip JSON. |
| layer_metadata | Optional inline layer metadata when retained with its acquisition record. |
| field_map | Exact property names for object_id, classification, name, description, status, system_id, intake_id. |
| vintage | Status, date range, source references, and any original publication/proposal details. |
| include_classes | Exact current designation codes selected for a classified-water project. |
| selection_rationale | Why these classes define the project's high-quality-water selection. Required for classified waters. |
| status_filter | Optional exact source status field and raw include values; coded values are retained separately. |
| relation | Drainage method, rationale, optional exact HUC seeds and supporting source references. |
| record_overrides | Per-original-ObjectID or native-ID adjustments for inclusion, title, vintage, and relation. |

The compiler resolves fields only against actual property names and metadata.
An explicitly supplied field must exist. A classification field with multiple
plausible exact matches requires an explicit mapping, and the error lists
those actual fields. Metadata's objectIdField or esriFieldTypeOID takes
precedence; OBJECTID_1 is not assumed. Without an ObjectID property the
compiler preserves the original native feature ID for model selection.

Domain-coded classifications are decoded through the original field domain.
Both the raw code and exact domain record are retained. Numeric and string
domain keys remain distinct.

### Classified-water class selection

include_classes uses designation codes ONRW, ORW, SFH, TN, TPGT, TPT, FW,
SA, or SB. It is an explicit project decision; the compiler does not label
every freshwater as high quality. Candidate high-quality classes exposed by
the source rules are ONRW, ORW, TN, TPGT, and TPT, but each request supplies
the classes and reasoning appropriate to the project.

R.61-69 section F defines the relevant notation. For ORW and ONRW, the
parenthetical class records the previous classification. The sp marker
indicates site-specific standards. The parser therefore yields:

| Original source text | Current designation | Previous class | Site-specific marker |
| --- | --- | --- | --- |
| ORW(FW) | ORW | FW | false |
| ORW(TPGT) | ORW | TPGT | false |
| ORW(SFH) | ORW | SFH | false |
| FWsp | FW | none | true |
| TPGT | TPGT | none | false |

A parser input cannot acquire ORW status because ORW appears somewhere in
its description. No-discharge-zone annotations in waterbody names remain
original fields rather than becoming a water-quality class.

Section A distinguishes site-specific numeric standards from the base class.
Section B describes the separate rule for unlisted tributaries. This compiler
uses original mapped named-water geometry; a regulatory inheritance mapping
would need its own actual tributary-source records and traceable rule
application. HUC support is a hydrologic association used for model analysis.

### Effective and proposed snapshots

vintage.status is one of effective, proposed, historical, or unknown. It can
also retain effective_from, effective_to, proposal_document, published_at,
retrieved_at, authority, and any other source metadata.

effective_to is an exclusive end date. A nominally effective record whose
start is after as_of goes to the proposed plan; an ended record remains
historical. An explicit proposed status never becomes effective merely
because time passes. Adoption needs an updated source status and references.

For effective or proposed selection, vintage.evidence contains the original
source references. This can reference the effective regulation and matching
source acquisition for a classification, or the original program inventory
and publication metadata for an intake/source-area record. Intake inventory
currency and legal classification authority describe different facts; retain
that distinction in the evidence object.

Unknown and historical records remain in the complete catalog with reasons.
The two model requests, prepare-effective.json and prepare-proposed.json,
are separate. The default operator can use the effective request; an explicit
proposed sensitivity analysis uses the other request without replacing it.

### Operational status

When an intake source has active/inactive or facility status fields, include
status_filter using the actual field and raw include values. The exact filter
and the decoded domain are retained per feature. Omitting this filter means
the original supplied records are considered; it does not invent an active
status. Original system_id and intake_id fields are carried when resolved.

### Drainage relationships

upstream_huc is appropriate for a source-mapped receiving water or surface
intake associated with the HUC12 graph. The model identifies geometric seed
HUCs or uses explicit seed_huc_ids when supplied. Explicit seeds must be
12-digit strings and have nonempty evidence. A nonempty rationale is
required for every relation.

source_area uses an original polygon and buffer_m=0. A published source-water
assessment area and a protection zone retain their source-defined meaning.
In particular, an arbitrary groundwater protection zone is not converted
into a surface-flow catchment.

geometric_context permits an original polygon or an explicitly stated,
nonzero buffer for a point/line. Its rationale records the context being
represented. Buffers do not change the legal feature itself. The compiler
does not create any buffered geometry; the model prepares the chosen context.

Original geometries are reprojected to EPSG:4326 for the catalog and GeoJSON.
The original source bytes, metadata spatial reference, and full property
dictionary remain referenced. No study-area clipping is applied by default,
so a named downstream receptor is not silently lost. Scope the original
source selection deliberately when a subset is wanted.

## Compile and prepare

    python -m source_tools.receiving_water_catalog --workspace /path/to/workspace compile --request selection.json --output-dir receiving-waters/20261013

The command writes the complete catalog and both vintage requests. To
prepare the effective plan in the same scientific Workspace, add
--prepare effective. To prepare the proposed sensitivity plan, add
--prepare proposed.

The importable interface is:

    from source_tools.receiving_water_catalog import compile_catalog, write_catalog
    from model.receiving_waters import prepare

    compiled = compile_catalog(workspace, request)
    files = write_catalog(compiled, output_directory)
    plan = prepare(workspace, compiled["plans"]["effective"])

compile_catalog returns catalog, geojson, and plans. Each selected receptor
contains id, title, family, source, relation, classification, and provenance.
The source uses the original collection/source plus exact ObjectID equality
when available and the original native feature ID. The classification object
retains all original properties, class parsing, vintage, status, and rule
references. The model preserves this metadata in its plan.

The two families are critical_drinking_water and high_quality_waters.
Priority weights, physical model results, and upstream support computations
are owned by model.receiving_waters, preserving one implementation of
those calculations.

## Complete exports

| File | Content |
| --- | --- |
| receiving-water-catalog.json | All records, source metadata, selection reasons, and catalog identity. |
| receiving-water-records.geojson | Original feature geometry reprojected to WGS84 with full receptor metadata. |
| prepare-effective.json | Model-ready effective-vintage receptors and catchments descriptor. |
| prepare-proposed.json | Separate model-ready proposed-vintage receptors. |
| receiving-water-index.csv | Reviewable feature, class, previous class, vintage, source ID, and inclusion summary. |
| catalog-files.json | Exact bytes and SHA-256 for the five data exports. |

The catalog includes unselected features, allowing a reviewer to see why a
record was omitted. Specific reasons include a class outside the chosen
set, a source operational-status filter, an unknown/historical vintage, an
empty/invalid geometry, or a record-level exclusion. Missing or mistyped
field definitions produce a concrete error rather than a guessed match.

The output directory supports an exact replay. A different body cannot
overwrite an existing artifact; use a new directory for a new source
selection. Each complete file uses the application's atomic immutable writer;
the completion manifest is written last. A stopped write leaves absent files
that an exact replay can finish. The inventory uses the same writer.
Catalog and receptor identities derive from the original bytes,
selection, source layer, and native feature IDs. ObjectIDs are therefore
never assumed to persist across a service's republishing.

## Integration receipt

This source component uses the existing Workspace and rasters interfaces.
The sibling model module receives its emitted plans directly. Native
integration should run a single focused import/compile check plus the
changed catalog path against the acquired layer records. Use the official
class values above to inspect designation parsing. Reuse the source
acquisition worker's metadata/count receipts instead of reacquiring or
repeating broad checks.
