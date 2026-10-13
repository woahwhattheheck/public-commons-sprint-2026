# FGDC metadata for original delivery rasters

The delivery writer retains original source declarations, dates, contacts, units,
grid geometry and dataset relationships in FGDC Content Standard for Digital
Geospatial Metadata (CSDGM) XML. Its metadata edition is
`fgdc-retained-content-20261013-1`. The copied delivery selection binds
`fgdc_metadata_edition` before the delivery identity is computed, so an existing
completed delivery remains its original edition. Rebuild through the ordinary
delivery operation over the same selected baseline and alternative run IDs to
produce the corrected metadata edition.

## What the XML represents

Physical exports retain their native annual mass per pixel and the original
rate-to-mass conversion using the affine cell area. Signed scenario differences
retain alternative-minus-baseline annual mass on original paired support.
Priorities retain their dimensionless normalization and selected weights.
Packaging copies the original raster bytes; the metadata operation adds no
numerical conversion, resampling, or model run.

Baseline metadata stays beside its raster and uses its sibling filename.
Derived metadata stays in `gis/metadata/` and links through
`../../gis/datasets/...`. The original atlas index, selected run IDs, source
hashes, physical raster header, masks and support descriptions remain authoritative.

## Source declarations and dates

Both ordinary delivery source roles and native-study reporting/model-domain/
biophysical roles retain the complete original entry declarations under
`source_metadata`. The duplicate binary `body`/`companions` descriptors and
local source path are excluded; original source IDs and the original body SHA
remain in the surrounding source record. Original citation/contact, units,
conversion, originator, publisher and observation fields are kept.

The writer reads fields from original `metadata` and `citation` dictionaries
and original top-level declarations. Top-level declarations take precedence.
It recognizes the following supplied values without inferring them from an
edition label:

| Meaning | Original fields |
| --- | --- |
| Originator | originators, originator, origin |
| Publication date | publication_date, published_at, pubdate |
| Publisher | publisher; optional publication_place |
| Content period | observation_period, temporal_extent, time_period with start/end or start_date/end_date |
| Content date | content_date, observation_date |
| Currentness basis | source_currentness, srccurr |
| Source medium | source_media, typesrc |
| Source contribution | contribution; otherwise original derivation |

Dates may retain year, year-month or day precision. Actual ISO timestamps are
normalized to their calendar day for the date element; the original declaration
remains in the source citation or model-stage JSON. Invalid calendar dates and
unstructured labels produce `Unknown`. Explicit publication value
`Unpublished material` and content-period ending value `Present` remain valid.
The complete original vintage is an edition string, including computed LS-factor
labels such as an InVEST version plus DEM edition. That string is never used as
a publication or observation date.

A source originator is not inferred from its publisher or from the metadata
author. Source media describe the medium; raster/vector/tabular presentation
forms are separately retained in `geoform`. A selected source's own explicit
currentness basis stays explicit.

Model-stage completion uses the retained original producing stage timestamp.
The separate annual-mass conversion date is `Unknown` if it was not recorded.
Original comparison/normalization dates similarly remain `Unknown`; model-stage
completion is not substituted for them. Citation, metadata and packaging process
dates describe the actual new delivery edition. Ground-condition dates remain
separate from all of these.

## Contacts and distribution

The selected original contact supports a person or an organization primary.
Address blocks retain supplied type, street lines, city, state, postal code and
country. Voice, email, fax, TDD, position, hours and instructions are retained
when supplied. Required contact fields absent from the original record are
explicitly marked `None`, with an instruction explaining that the detail was
not supplied; this does not assert that no contact method exists.

Every emitted digital standard-order entry includes GeoTIFF transfer information,
its actual relative dataset link, and fees. Fees use explicit
`selection.distribution.fees`; absent retrieval terms remain `Unknown`.
Engineering prices are not dataset retrieval fees.

## Rebuild the selected original delivery

Use the application's normal delivery operation or call its existing builder
with the original saved selection. The builder, not this receiver, creates the
new delivery edition. For example, in the chosen application's working Python:

```python
from copy import deepcopy
import json
from model.delivery import build
from model.workspace import Workspace

workspace = Workspace("/actual/retained-workspace")
old_id = "the-original-complete-delivery-id"
old = json.loads((workspace.root / "deliveries" / old_id / "delivery-state.json").read_text())
selected = deepcopy(old["selection"])
new = build(workspace, selected)
assert new["selection"]["baseline_run_id"] == old["selection"]["baseline_run_id"]
assert new["selection"].get("scenario_run_ids", []) == old["selection"].get("scenario_run_ids", [])
print(new["id"])
```

Use a complete receiving application containing the current delivery, native-study,
shared native-version and helper modules. Preserve independently newer source when
composing this release. Do not replace an existing completed delivery's XML files
in place.

## Validate the writer and an actual delivery

The standalone receiver is
`source/fgdc-metadata/receive_metadata.py`. It uses the exact installed
`_fgdc` and `_grid_measurements` production functions, the real Pyproj CRS
implementation, and the official FGDC XSD with all ten section schemas.
Its controlled six-file exercise covers Albers and UTM coordinates, physical
exports, signed changes, priorities, source date precision, explicit unknown
dates, person/organization contacts and both relative dataset-link layouts.
Those descriptors are validation fixtures, not scientific outputs.

Run in the existing equipped Python with `pyproj` and `lxml` available:

```sh
ECO_APP=/actual/current-application
ECO_RECEIVING=/actual/new-metadata-receiving
ECO_PYTHON=/actual/equipped/python

"$ECO_PYTHON" -B "$ECO_APP/source/fgdc-metadata/receive_metadata.py" \
  --application "$ECO_APP" \
  --schema-directory "$ECO_RECEIVING/official-schema" \
  --download-schema \
  --exercise-output "$ECO_RECEIVING/writer-exercise" \
  --delivery-directory /actual/retained-workspace/deliveries/NEW_DELIVERY_ID \
  --receipt "$ECO_RECEIVING/metadata-receiving.json"
```

The schema download uses only https://www.fgdc.gov/schemas/metadata/.
For an offline receiving host, supply all eleven original schemas in that
directory and omit `--download-schema`. The receipt records their hashes.
The exercise directory and receipt are create-only; select a new receiving
directory for another attempt.

Actual-delivery validation is read-only. It checks every registered XML member's
original bytes and SHA, validates the XML against the official schema, and
requires each relative dataset target to exist inside that same delivery.
The ordinary builder/archive receiver remains responsible for complete scientific
and portable-package verification. The standards exercise can be used alone by
omitting `--delivery-directory`; an actual-delivery check can omit
`--exercise-output`.

## Standards and execution evidence

The original standards are:

- [CSDGM data quality and lineage](https://www.fgdc.gov/metadata/csdgm/02.html)
- [Spatial reference](https://www.fgdc.gov/metadata/csdgm/04.html)
- [Distribution](https://www.fgdc.gov/metadata/csdgm/06.html)
- [Metadata reference](https://www.fgdc.gov/metadata/csdgm/07.html)
- [Citation](https://www.fgdc.gov/metadata/csdgm/08.html)
- [Time period](https://www.fgdc.gov/metadata/csdgm/09.html)
- [Contact](https://www.fgdc.gov/metadata/csdgm/10.html)
- [Official FGDC schema distribution](https://www.fgdc.gov/schemas/metadata/)
- [Esri FGDC metadata guidance](https://doc.esri.com/en/arcgis-pro/latest/help/metadata/create-fgdc-csdgm-metadata.html)

The authoring seat's initial standards-exercise request ended with an environment
registry 409 before process creation. No Python/schema execution is claimed from
that request. Record the actual equipped receiver's command, source hashes,
schema hashes, resulting delivery ID and successful receipt with the original
delivery operation. The source/API and official-schema review is a separate
form of evidence.
