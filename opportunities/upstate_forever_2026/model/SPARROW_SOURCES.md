# USGS Southeast SPARROW original-source import

This component acquires the complete original records for explicitly selected published reaches and imports them through the existing scientific Workspace source system. It supports the independent comparison editor with nitrogen, phosphorus and sediment prediction tables and their calibration-station tables. It uses Python's standard library and the public USGS ArcGIS service.

## Acquire the retained Upper Savannah selection

Run from `opportunities/upstate_forever_2026`:

```bash
python -m model.sparrow_source acquire \
  source/usgs-sparrow-upper-savannah-20261013/selection.json \
  work/usgs-sparrow-upper-savannah-20261013
```

The selection contains the actual current NLDI reach identifiers **6269342**, **6280111**, **11730084**, **22724211** and **22726623**, bound to the existing original NLDI response files by SHA-256. These are the original Chattooga, Broad/Bell, Stevens, Jackson and Cohens reference reaches selected by the existing annual-reference course. Their full response bytes and the unchanged complete P9A682GW data dictionary are copied into the new source collection. The source paths are resolved relative to the selection file. To acquire another complete selection, create another selection with each original COMID and its original source binding, then use a new output directory.

The collector queries the publisher's original COMID field for each prediction layer and its COMID field for each calibration layer. It first obtains the complete object-ID selection, then retrieves every selected object with all attributes and geometry. Requests are divided into transfer pages of 100 objects; every original ID is retained. Duplicate publisher COMIDs remain separate original records. Each query page must return its exact requested object set.

An interrupted acquisition retains its completed responses. Repeating the same command reuses those response bodies and their retrieval times, checking the original bytes before continuing. A completed source collection is verified and returned without new HTTP requests. If a response body exists without its accompanying completed receipt, retain that partial directory and use a new output directory; the command does not overwrite an uncertain original response.

The command prints the actual matched and unmatched COMIDs separately for every constituent and source role. A current NLDI identifier is an acquisition selector; it does not establish that the older SPARROW network has a corresponding published record. Missing matches remain visible. No nearby reach or station name is substituted.


## Reuse existing original HTTP bodies

When the source owner has already retained a response, pass an index with
`--retained-responses path/to/original-response-index.json`. The index uses
`upstate.sparrow-retained-responses/v1` and a `responses` array. Each entry contains the exact request `url`, local original body `path` relative to the index, original `bytes`, `sha256`, and its retained `source_reference` URL/blob/file identifier. Optional original HTTP fields are `resolved_url`, `retrieved_at`, `status`, `content_type`, `etag` and `last_modified`.

Exact query URLs are the lookup keys. The collector consumes each matching original body without another provider request; missing responses use its normal public HTTPS route. Retained transport is recorded separately from direct HTTPS. If the original carrier does not expose status, headers or retrieval time, those remain null; the new receipt records the actual receiving time separately. The body is always checked against its original byte count and hash.

A complete previously acquired collection should be reopened through its existing manifest or imported directly into Workspace. The retained-response index is for composing already-held originals with missing selected responses. Reformatting a page excerpt into JSON does not make it an original HTTP body.

Each selected table now carries all original collection tables and HTTP companions. Its exported bundle therefore retains the prediction and calibration source records together, even when the analyst selects one reference table. The generated companion paths preserve the same directory relationships on reopen.

## Open the already received five-reach prediction packet

The completed 814B source packet is retained at
`source/usgs-sparrow-upper-savannah-20261013/received-predictions.json`
(143,661 original UTF-8 bytes; SHA256
`d1904b8730b0f1209f71489bfb93cb0dd9d5222cabaf702b86168d6412b13827`).
It holds all six original publisher bodies: three layer definitions and three
complete selected responses for nitrogen layer 9, phosphorus layer 0 and
sediment layer 27. Each response contains exactly the five selected original
COMID_ORIG values. Use those completed originals directly:

```bash
python -m model.sparrow_source receive \
  source/usgs-sparrow-upper-savannah-20261013/received-predictions.json \
  source/usgs-sparrow-upper-savannah-20261013/selection.json \
  work/usgs-sparrow-upper-savannah-received-20261013
```

This command makes no HTTP request. It checks the packet's complete body hashes,
exact numeric reach selection, query URLs, full publisher attribute schema,
unique object/reach IDs and transfer-limit flag before producing three complete
prediction CSVs and the ordinary `upstate.sources/v1` manifest. Import that
manifest through the existing Sources workflow described below. All original
publisher columns remain available for explicit scientific mapping.

The original requests explicitly used `returnGeometry=false`. The received
collection keeps that fact and the unchanged NLDI reach bindings. It does not
manufacture object-ID enumeration responses or polygon geometry. The normal
`acquire` command remains available for a separately selected full
prediction/calibration/geometry capture; receiving this completed source does
not require that additional capture.

Each prediction table carries the other two prediction tables, all six original
responses with their original source receipts, the complete received packet,
selection, five original reach bindings, full publisher XML dictionary, collection
description and exact producer/guide. A selected table therefore stays
interpretable after a comparison export and reopen. Unknown HTTP headers/times
remain unknown; original retrieval bounds remain those provided by the source
owner. The saved collection uses the original project's atomic immutable writer. A completed manifest must contain every selected table and the whole companion collection; empty or partial manifests fail explicitly. The complete original common.py helper travels with the producer. Reopen the saved collection with the existing `verify` command.

The packet records eleven differences between current mapper `ACCL` and the
older calibration `PLOAD_TOTA`/`PLOAD_MT` values. Both editions remain
available under their original source identities. The separate publisher-fit
context uses the older original calibration edition. No current mapper value
replaces an older prediction or observation.

The publisher's report separately defines a model-based TSS to suspended-sediment
load adjustment: Hoos and Roland (2019), equation (3), with the Southeast
coefficient discussed on page 60 and in table 13. That method belongs in the
explicitly derived publisher-fit context. Source receiving retains
`CONSTITUEN`, `TSS_CONV`, `ACTUAL_MT` and `PLOAD_MT` untouched in their
original calibration sources.

## Open the source in the existing Workspace

The generated `source-manifest.json` uses the maintained `upstate.sources/v1` schema. Import it with the operator's existing Sources workflow, or with the actual Workspace API:

```python
from model.workspace import Workspace

workspace = Workspace("path/to/existing/workspace")
edition = workspace.import_sources(
    "work/usgs-sparrow-upper-savannah-20261013/source-manifest.json"
)
print(edition["id"])
```

The collection exposes six original-attribute tables, one prediction and one calibration table per requested constituent. A table with no matching records retains its headers and the original empty ID response. It remains visible as an acquired source, and the comparison editor requires an actual nonempty reference table before selecting reference rows.

Every table keeps companion files containing its exact original HTTP metadata, object-ID selection, feature pages, response headers, source bindings, collection description and collection producer. The existing Workspace source-copy and comparison export operations preserve those companion paths.

## Original fields and their scientific roles

| Publisher layer | Prediction / calibration | Original fields |
| --- | --- | --- |
| 9: southeast_cats_tn | Nitrogen prediction | COMID, COMID_ORIG, original loads/yields/areas and five source allocations |
| 0: southeast_cats_tp | Phosphorus prediction | COMID, COMID_ORIG, original loads/yields/areas and six source allocations |
| 27: southeast_cats_ss | Sediment prediction | COMID, COMID_ORIG, original loads/yields/areas and eleven source allocations |
| 37: southeast_calib_sites_tn | Nitrogen calibration station | COMID, STATION_ID, STATION_NM, LAT, LON, ACTUAL, PLOAD_TOTA |
| 36: southeast_cal_sites_tp | Phosphorus calibration station | COMID, STATION_ID, STATION_NM, LAT, LON, ACTUAL, PLOAD_TOTA |
| 39: southeast_calib_sites_ss | Sediment calibration station | COMID, STATION_ID, STATION_NM, LAT, LON, CONSTITUEN, ACTUAL_MT, TSS_CONV, PLOAD_MT |

The three prediction layers contain the separate original fields ACCL, INCL, ACCY, INCY, DACCL, DINCL, DACCY, DINCY, DEL_FRAC, CONCENTRAT, INCAREAK_1 and CUMAREAKM2. Their ArcGIS field aliases repeat their codes. An alias alone does not resolve the scientific definition or unit. Select the intended original field using the publisher's report/data dictionary and retain that definition in the comparison.

The collector preserves every original numerical field. It does not select one as the comparison value, scale a yield by an area, sum upstream accumulated loads, apply TSS_CONV or combine the two calibration quantities. This lets the analyst inspect and select the actual documented quantity while preserving all other source information.

The original JSON bodies retain number spelling, nulls, attributes and the returned geometry/spatial reference. CSV output is a derived view: parsed decimals are written without binary floating-point rounding and JSON null becomes an empty cell. The unchanged HTTP response is the authoritative value source.

## Map the table into the independent comparison editor

Select the imported prediction table, then use these mappings:

| Comparison field | Original table column or explicit definition |
| --- | --- |
| record_id | reference_id |
| catchment_id | COMID or COMID_ORIG, according to the selected source support |
| parameter | reference_parameter |
| value | The exact publisher field selected for the scientific question |
| unit | The selected field's documented original unit |
| method | The publisher model and field definition |
| source_records | reference_response_path, with the unchanged companion JSON |
| definition.evidence_kind | external_model_estimate |
| definition.source_support | The selected field's actual spatial/transport support |
| definition.temporal_basis | 2012 source conditions normalized to 1999–2014 hydrology |
| definition.lineage | Southeast SPARROW source release, model fit and selected original calibration linkage |

The editor's remaining source definitions—quantity, constituent fraction, source period, spatial basis and reference IDs—describe the selected original field. Field selection is intentional. Retain the original source conditions and hydrological normalization; neither is automatically the period of the local native simulation.

For calibration tables, ACTUAL/ACTUAL_MT and PLOAD_TOTA/PLOAD_MT have distinct roles. The collector labels the whole row as a calibration reference so that the selected value's evidence kind must be stated explicitly. Selecting a calibrated model prediction does not turn it into an independent observation. Selecting an original monitoring-derived value retains its estimator and fitting lineage. CONSTITUEN and TSS_CONV remain original sediment-source evidence.

Pair only the actual native catchment/period/output with the appropriate selected reference row. The native NDR output describes landscape-to-stream export. Published station, incremental-reach and accumulated-reach quantities may have different transport, point-source, drainage or period support. Preserve these pairs as context where the intended quantities differ. The comparison editor retains the full original rows, analyst rationale and unmatched records.

## Reopen and use the complete result

```bash
python -m model.sparrow_source verify work/usgs-sparrow-upper-savannah-20261013
```

The command verifies the actual saved manifest members and each original HTTP body's size and SHA-256. It reports complete table counts and matches. It neither imports a new native run nor changes saved model parameters. Once imported, save the comparison edition, open its report, download its complete source archive, and reopen the archived files through the ordinary recipient workflow.

The actual producing/receiving session must follow the current owner-directed rendered-product inspection rule in the project AGENTS.md and the current post-call ECO work orders. Open and operate the completed populated comparison, narrow view, empty/error states, source tables and exports. Open the delivered archive and attachments as a recipient. Repair the affected product while continuing the original build; preserve current compute owners and existing results.

## Primary source and original selection references

- Publisher live service and layer directory: https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/
- Southeast model input/output release, DOI10.5066/P9A682GW: https://water.usgs.gov/catalog/datasets/684ccf40-27f3-4733-b6bb-58e8a54e52ea/
- Hoos and Roland (2019), USGS SIR2019-5135, DOI10.3133/sir20195135: https://pubs.usgs.gov/publication/sir20195135
- Publisher mapper: https://apps.usgs.gov/sparrow/sparrow-southeast-2012/
- Original five-reach selection: ../source/usgs-southeast-sparrow-2012/upper-savannah-all-targets-selection.json
- Original current NLDI reach6280111: https://api.water.usgs.gov/nldi/linked-data/comid/6280111?f=json

The live directory describes a 2019-10-06 data update republished to the server on 2022-04-08. The service does not offer historic-moment queries. Each response therefore retains its actual retrieval timestamp; a multi-request collection is not presented as an atomic historical database snapshot.


<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->

## Maintained original source identity helper

The current original model/common.py imports model/verified_files.py. Both acquire and offline receive retain the complete original helper as producer/verified_files.py alongside producer/common.py; exact bundle verification requires both companion files. The installed component and Study source closure select the unchanged maintained helper. This preserves the original atomic_bytes implementation and operation-scoped verified source reads without restoring an older common.py.
