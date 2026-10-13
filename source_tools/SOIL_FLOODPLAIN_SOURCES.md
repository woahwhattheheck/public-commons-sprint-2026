# Original hydric soils and one-percent floodplain sources

This component takes an existing parcel study or an explicit retained domain, acquires the relevant original soil and flood-zone information, imports it into the workspace, and returns source choices that the parcel-criteria builder can use immediately. It joins the current Conservation workflow through the existing operation queue.

The public entry point is `source_tools.soil_floodplain_sources.capture(workspace, selection)`. The result contains actual imported source collection IDs, selected source IDs, their original coverage, and a ready parcel-criteria selection when the request came from a study.

## The scientific decisions

### Hydric soil means an explicit original map-unit interpretation

USDA Soil Data Access exposes map-unit attributes and the underlying component records. The original `muaggatt.hydclprs` value records the map-unit hydric percentage; component rows retain `comppct_r` and `hydricrating`. The adapter joins these by the original MUKEY, retaining every component, including unknown percentages or ratings. The authoritative field definitions are in the [NRCS Soil Data Mart schema](https://sdmdataaccess.sc.egov.usda.gov/documents/TableColumnDescriptionsReport.pdf); the [NRCS hydric-class instructions](https://efotg.sc.egov.usda.gov/references/public/IN/HYDRIC_CLASS_INSTRUCTIONS.pdf) describe the original map-unit/component join.

The default is `full`: the published hydric percentage must equal 100, and every component with positive or unknown weight must have an original Yes hydric rating. At least one such component must exist. A confirmed negative requires percentage 0 and No ratings under the same component rule.

That produces two different source geometries:

- The positive footprint contains confirmed fully hydric map-unit polygons.
- The certainty footprint contains confirmed fully hydric and confirmed fully nonhydric polygons.

A parcel crossing mixed or unknown map units retains incomplete acreage coverage. A positive overlap remains visible in the observed acreage. Absence can be concluded only inside the actual certainty footprint. An empty positive selection with known nonhydric coverage therefore carries useful information.

Two additional interpretations are available as explicit retained choices: `predominant` selects whole map units with an original hydric percentage of at least 66; `any_component` selects whole map units with a positive published hydric percentage. Their known coverage consists of map units with a known percentage. These choices preserve their whole-map-unit meaning in every source and criterion record.

The [NRCS published five-class scheme](https://www.nrcs.usda.gov/sites/default/files/2022-12/2017_RI_Soil_Survey_Attribute_Information.pdf) distinguishes 100, 66–99, 33–65, 1–32 and 0 percent. The adapter retains those original class groupings along with the actual percentages and component records. The [Lake Keowee Watershed Plan](https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/WPLakeKeowee.pdf), Appendix D, printed page 140, scores hydric-soil acreage. Its acreage criterion is applied by the maintained Keowee point engine; this source selection records the chosen map-unit interpretation separately.

A sentence Bryce can use: **“We keep the soil map, its component information, and the exact interpretation behind each parcel’s hydric-soil acreage together.”**

### Floodplain means the actual original FEMA classification

The adapter reads the original [FEMA NFHL layer 28](https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28) metadata and uses the declared object-ID field and native coordinate reference. It captures the original zones intersecting the actual study query area, then selects the exact native string `SFHA_TF='T'`.

Known negative coverage comes from original `SFHA_TF='F'` polygons with a known mapped zone. Zone D, missing zones, unmapped or undetermined areas, areas not studied, and areas not included remain separate unresolved context. Their presence cannot establish a negative classification. The original zone and subtype attributes remain attached to every geometry.

The source’s actual metadata, response dates and features establish its edition. The [FEMA NFHL guidance](https://www.fema.gov/sites/default/files/2020-02/NFHL_Guidance_Feb_2019.pdf) supplies the dataset context, while the retained live layer metadata supplies the field and spatial-reference contract used by the run.

A sentence Bryce can use: **“The floodplain field comes from the original FEMA polygons, and the workspace retains where that classification was actually mapped.”**

## Geography and reuse

A `study_id` request uses the original reporting geometry union the **full original geometry of every selected parcel**. This covers parcel portions outside the reporting boundary when a criterion uses the whole parcel. Selection still follows the original parcel source, native ID field, exact typed filter and positive reporting-area intersection.

The source identity records the parcel binding, reporting source or native grid, count and digest of the selected parcel IDs, the area of the full-parcel extension, and the same geometry context used by the criterion table. Query geometry is retained as WGS84 GeoJSON and WKT. Reporting clipping remains a downstream metric definition.

An explicit `domain` request instead follows that exact retained polygon source choice. This lets the existing native source owner acquire against the complete original 217-HUC domain, a utility domain, or the exact reporting source already imported.

The native soil capture preserves its actual queried AOI rectangles separately from the returned soil polygons. The adapter uses that original query coverage to acquire any remaining portion of the selected full-parcel domain. It requests only the difference, retaining original fragment identities and combining their actual geometric union downstream. The resulting query-coverage layer stays distinct from hydric certainty.

Existing geometry is reused in this order:

1. An explicit imported original vector source.
2. An explicit completed original soil capture root.
3. The latest matching original vector already imported in the workspace.
4. A new original provider geometry capture.

The soil auto-selection recognizes the current `SOIL_K_NATIVE` source and the declared original map-unit roles. Reuse preserves the original geometry edition while obtaining the hydric attributes needed for this criterion. `reuse_existing=false` selects new geometry acquisition for a new source edition.

The current soil collector retains WGS84 WKB, original MapUnitKey and MuPolygonKey, original AOI/part/polygon IDs, and survey spatial versions. The `reuse_capture_root` route reads its `geometry-capture.json` page inventory through the existing `soil_sources.Sda` client. Original request and response files are copied into the imported source companions. The AOI-clipped extent and each native identity remain explicit.

Source AOIs can overlap. The adapter keeps the original fragments and their identities. The maintained parcel builder uses spatial indexing and polygon unions, so overlap does not multiply reported acreage.

## Public API

```python
from source_tools import soil_floodplain_sources, parcel_criteria

# study is the operator's actual retained Conservation study.
selection = {
    "schema": "upstate.soil-floodplain-selection/v1",
    "study_id": study["id"],
    "title": "Original soil and floodplain context for " + study["title"],
    "families": ["soils", "floodplains"],
    "soils": {"hydric_selection": "full"},
    "floodplains": {},
}
acquired = soil_floodplain_sources.capture(workspace, selection)
if acquired["source_collection_id"]:
    criteria = parcel_criteria.prepare(
        workspace, acquired["parcel_criteria_selection"]
    )
```

The adapter imports every completed family even if the other family remains incomplete. The returned criteria selection includes actual source choices with their coverage, reference and meaning. Pass each complete choice; the coverage binding is part of its interpretation.

### Selection fields

| Field | Meaning |
|---|---|
| `schema` | `upstate.soil-floodplain-selection/v1`. |
| `study_id` | Existing original parcel study; mutually exclusive with `domain`. |
| `domain` | Actual `source_collection_id`, `source_id`, and optional original layer/where selection. |
| `families` | Distinct members of `soils` and `floodplains`; both by default. |
| `soils.hydric_selection` | `full` by default, `predominant`, or `any_component`. |
| `soils.reuse_source` | Existing original MUKEY polygon source choice. |
| `soils.mukey_field` | Original join column; defaults to MUKEY, while the current auto-selected SOIL_K_NATIVE source uses MapUnitKey. |
| `soils.reuse_capture_root` | Actual completed native soil capture directory; alternative to an imported original vector. |
| `floodplains.reuse_source` | Existing original flood-zone vector source choice. |
| `floodplains.service_uri` | Original FEMA layer 28 endpoint; the maintained alternate FEMA NFHL path is also accepted. |
| `reuse_existing` within a family | Defaults to true; controls auto-selection of already imported original geometry. |
| `tile_degrees` within a family | Source-query batching only; defaults to 0.125 for new SDA geometry and 0.5 for FEMA. |
| `floodplains.page_size` | Exact native feature page size, default 50. |
| `retry_failed` | Enables another preserved failed FEMA attempt after its original Retry-After interval. The maintained SDA client applies its own preserved transient-retry rules. |
| `capture_tag` | Nonempty source-edition label for a distinct retained acquisition request. |

Every query tile intersects the exact acquisition domain. Original source features are retained only after positive area intersection with that domain. The complete native provider feature remains available in the source response.

### Results and progress

`capture` returns `upstate.soil-floodplain-result/v1`:

| Field | Content |
|---|---|
| `id`, `title`, `state`, `created_at` | Retained source operation identity and actual completion state. |
| `study_id` | Original study when the request used that route. |
| `source_collection_id` | Actual imported selected-criterion source edition. |
| `original_source_collection_id` | Actual original/classification/coverage source edition. |
| `source_ids` | Builder role to selected source ID. |
| `builder_sources` | Full actual source choices, including the original certainty coverage and provenance. |
| `parcel_criteria_selection` | `study_id` and complete source choices, ready for the maintained builder. |
| `coverage` | Actual selected/known/unknown polygon counts and source definitions. |
| `counts` | Actual map units, source polygons and original class/zone counts by completed family. |
| `families` | Each family’s actual pending/running/complete/failed state and retained error when applicable. |
| `domain`, `query_domain_sha256` | Bound original geography and query geometry identity. |
| `files` | Exact selection/domain and edition-specific manifest descriptors. |

`overview(workspace)` reads the compact operation states. It returns `operations` rows with ID, title, state, creation/update times, original study ID, per-family states, progress, and actual imported source IDs. The response also gives the supported families and hydric interpretations.

`inspect(workspace, operation_id)` returns compact current state while a capture runs and the retained result afterward. Progress contains `stage`, `completed`, `total`, `details`. Stages distinguish soil native keys, original geometry, reused soil geometry, original attributes, original flood-zone capture, and source import.

`prepare(workspace, selection)` is an operator-compatible alias for capture. The maintained continuation entry point is `continue_capture(workspace, operation_id, retry_failed=True)`. It resumes the same operation when its source-processing implementation matches, and creates a linked successor when the application has been updated.

The maintained operator integration uses the existing queue for `conservation.sources.capture`, reads `source-capture` by operation ID, and supplies the retained `parcel_criteria_selection` to `conservation.criteria.prepare`. This makes acquisition, criterion computation, point scoring, portfolio selection and the existing native scenario/experiment continuation use the same original study context.

## Continuing after an application update

The saved operation binds its original normalized request, resolved reused-source choices and query domain to the source-processing implementation that created it. Updating the application can change how those original responses are interpreted. The operator's **Continue with current application** action and the CLI `resume` command use the same continuation entry point.

A continuation keeps the original operation and its imported source editions available. When the implementation changes, it creates a separate operation whose selection retains the exact original request, resolved source choices and domain, records the new implementation identity, and binds `continued_from` to its predecessor. Repeating the same continuation resolves to the same successor. It does not run the automatic source picker again.

Only original provider response caches are eligible for reuse. The current query must match the retained request identity before its cached response is used. SDA request bodies and FEMA URL/query parameters remain part of that match; response hashes are verified. A same-label request with different parameters requires its own original provider response. Retained failed attempts and provider retry timing travel with the corresponding request, so continuing cannot discard an active Retry-After interval.

Completed family outputs, derived geometries, coverage classifications and imported source collections are recalculated for the successor. The current processing application therefore consumes the retained original responses through its ordinary collectors and source importer. The predecessor's result remains available with its original source IDs.

The returned continuation metadata exposes:

| Field | Meaning |
|---|---|
| `continuation.previous_operation_id` | Original predecessor operation. |
| `continuation.previous_implementation`, `current_implementation` | Source-processing identities on each side of the continuation. |
| `continuation.reused_requests`, `reused_bytes` | Actual reused request count and original HTTP body bytes recorded by the successor. |
| `continuation.reused_stored_bytes` | Retained compressed response storage reused. |
| `continuation.successful_responses`, `retained_failures` | Successful responses and preserved failed attempts, reported separately. |
| `continuation.donor_directory` | Original predecessor directory, relative to the workspace. |
| `continuation.families` | Reuse quantities for each source family. |
| `continued_as` | Successors found from their own retained continuation records; the predecessor is not rewritten. |
| `implementation_changed` | Whether the currently installed source-processing implementation differs from this operation's retained selection. |

The acquisition list shows whether an application update is available or an operation continues an earlier acquisition. Opening a result exposes the predecessor, continued acquisitions, their current states and the response reuse counts. Existing completed results can still prepare criteria from their retained source edition.

## Original data and retention

The source directory is `soil-floodplain-sources/<operation_id>`. It contains the original selection, actual query domain, operation state, independent family checkpoints, all provider request/response companions, derived source representations and imported manifest editions.

The first imported edition contains the original classified geometry and its supporting records:

| Soil source | Meaning |
|---|---|
| `soil-mapunits` | All actual original map-unit geometry selected by the domain. |
| `soil-query-coverage` | Actual original query support, including any acquired domain extension. |
| `hydric-full` | Confirmed fully hydric footprint. |
| `hydric-certainty` | Confirmed hydric and confirmed nonhydric coverage. |
| `hydric-predominant` | Whole map units with hydric percentage at least 66. |
| `hydric-any-component` | Whole map units with positive hydric percentage. |
| `hydric-rated-coverage` | Footprint of map units with a known hydric percentage. |
| `hydric-table` | Full original attributes, all components and the explicit classification. |

| Flood-zone source | Meaning |
|---|---|
| `flood-all-zones` | Original zones in the acquisition domain. |
| `flood-one-percent` | Exact original SFHA_TF=T selection. |
| `flood-known-coverage` | Selected T and known mapped F footprint. |
| `flood-unknown-context` | Original undetermined/unmapped context. |
| `flood-table` | Original attributes and exact classification rule. |

The second edition exposes `HYDRIC_SOILS` and `FLOODPLAIN_ONE_PERCENT` roles. Each selected source binds the actual certainty source from the first edition. This order avoids a circular source collection identity.

Both editions preserve native IDs and original attributes. Analysis GeoJSON is WGS84; native coordinate declarations and original response bytes remain retained. Every imported criterion entry carries its exact reference, meaning, classification and source scope.

GeoJSON outputs stream one original feature at a time, and file hashes use fixed-size blocks. This keeps large source captures from allocating another complete feature document during export.

The family checkpoint stores its original output descriptors. A restart verifies and reuses a complete family, then continues the remaining source work. Completed provider responses remain immutable. Partial and full source publications receive distinct actual source collection IDs, with edition-specific manifests retained alongside the latest result.

## Native commands

The application’s actual workspace path and its saved selection file are the command inputs:

```sh
python -B -m source_tools.soil_floodplain_sources --workspace /owned/project capture /owned/project/soil-floodplain-selection.json
python -B -m source_tools.soil_floodplain_sources --workspace /owned/project overview
python -B -m source_tools.soil_floodplain_sources --workspace /owned/project inspect OPERATION_ID
python -B -m source_tools.soil_floodplain_sources --workspace /owned/project resume OPERATION_ID --retry-failed
```

A complete result exits with status 0. Partial or failed source acquisition exits with status 2 and retains the actual state, original requests, errors, and any successfully imported family. The source operation ID comes from the command’s actual JSON result or the operator’s saved acquisition list.

## Dependency and receiving contract

The component uses the maintained model workspace, common file helpers, original conservation source/geometry selection, original raster/vector helpers, the current parcel-criteria builder and the Keowee geometry-context helper.

New SDA queries and existing native WKB capture reuse require `source_tools/soil_sources.py` and its maintained dependencies from the current soil source component. The current whole-region source producer also supplies `soil_region.py`, its completed native geometry captures and their import manifest.

Continuation response reuse uses `source_tools/source_response_reuse.py`; its source identity participates in the acquisition implementation identity. FEMA capture reuses `source/capture_original_overlays.py` and `source/capture_upstream_network.py`. Their existing native ID pagination, original coordinate references, raw response retention and provider curve handling remain the capture implementation.

The current parcel builder includes verified empty-GeoJSON support: an actual `features: []` document can be used with its actual nonempty certainty footprint. When certainty itself contains no polygons, this adapter emits no coverage binding. The builder then preserves unresolved coverage in the resulting criterion table.

The native receiver supplies the actual acquired source counts, imported edition IDs and generated criterion table for the selected project. These retained outputs flow directly into the existing Conservation map, point-score and portfolio views.
