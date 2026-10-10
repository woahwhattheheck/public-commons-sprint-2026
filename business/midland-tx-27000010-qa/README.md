# City of Midland RFP 27000010: exact-schema export QA preflight

**NONBOUNTY, UNSENT internal opportunity and reusable MIT technical source.** Source transcription of *City-issued* 23-page LiDAR QL1 Topographic Capture, Impervious Surface Mapping & Data Layers RFP 27000010, [full PDF text mirrored by GovTribe](https://govtribe.com/file/government-file/001-rfp-27000010-lidar-geospatial-data-acquisition-dot-pdf), §§4.5.1–4.5.5 and §§5.3–5.5. The original City electronic procurement entry is [Bonfire opportunity 250058](https://midlandtexas.bonfirehub.com/opportunities/250058). The original PDF binary and subsequent addenda have **not** been compared; bidder must obtain them before use. The mirrored catalog metadata incorrectly labels issuer Mason County; actual RFP body and named procurement route say City of Midland.

## Qualified-buyer wedge

City of Midland TX, 390-square-mile USGS QL1 acquisition plus area-wide impervious features and **67,455** stormwater billing parcel records. Four exact Esri field layouts are mandatory:

- `IMP_SURFACE_AOI` polygon: 14 specified fields and binary `SURF_CLASS={1,2}`.
- `IMP_SURFACE_PARCELS` polygon: 16 fields, original City billing parcel join, `IMP_PCT` between 0 and 100, `QA_FLAG={0,1,2}`.
- `CONTOURS_1FT` polyline: 6 fields, 1-foot elevations and `CONTOUR_TYPE=Index|Intermediate`.
- `LIDAR_FLIGHTLINES` polygon: 10 fields, dates, density and overlap.

The City specifies **exact capitalization, types, minimum Text lengths, non-null fields and coded domains**. The parcel ID field/type is *provisional in the solicitation*: City will confirm at kickoff, and its approved data dictionary governs final acceptance. Post-award prime must submit a data dictionary **within 30 calendar days of notice to proceed**, obtain schema approval before acquisition, and deliver **at least five representative records** for City ArcGIS acceptance before full dataset. Full acceptance also entails LiDAR/accuracy/CRS/geometry/billing work outside this utility.

### Runnable review tool

1. In a legitimate ArcGIS Pro Python environment, on a real consenting prime-owned geodatabase, run `python arcpy_export.py /secure/work.gdb/IMP_SURFACE_PARCELS /secure/qa/midland-parcels`. This emits `midland-parcels.json` original Esri field metadata and `midland-parcels.ndjson` attributes, without geometry. **Do not upload actual customer parcel data into the public repository.** ArcPy adapter is provided but not executed here because ArcGIS is not installed in the Linux environment.
2. In Node 22, run `node preflight.mjs --metadata /secure/qa/midland-parcels.json --rows /secure/qa/midland-parcels.ndjson --out /secure/qa/review.json --sample` for an early sample, or omit `--sample` for full-population review. It prints the review status and preserves the original NDJSON SHA-256 in the report. The `--out` artifact refuses overwrite.
3. Treat `REVIEW_REQUIRED` exit 2 as corrective work before prime QA, and `PRELIMINARY_SCHEMA_PREFLIGHT_ONLY` exit 0 as merely metadata/attribute screening. It **never means government acceptance**. Independently validate geometry, horizontal/vertical CRS, USGS QL1, LAS/LAZ, raster, classification accuracy, 390-sq-mile coverage, 67,455 original City billing identifiers, City schema signoff, City Esri load, and official addenda.

RFP-required checks are field spelling/type/nullable status, minimum text width, three coded domains, `IMP_PCT` range, all records and population size. Additional **explicitly proposed engineering heuristics, not City numerical tolerances**, are cross-field impervious/pervious/parcel area within the larger of 1 sqft and 0.1%, percentage within 0.1 percentage points, and duplicate parcel-ID alarms. Successful source export is not proof the City billing join matches real ground truth.

## Direct-pay commercial path (not a claimed contract)

RFP questions: **Oct 21 2026**, proposals: **Oct 28 2026, 2:00 p.m. Central**. Offeror must be a single qualified prime with at least five years relevant government LiDAR, USGS QL1 and impervious mapping, three recent references, staffing, equipment, Texas insurance. RFP §1.19 requires **all proposed subcontractors listed** and reserves City approval rights; core LiDAR/impervious processing is in-house unless City approves changes. **Do not offer TJLabs as prime or assume an independent QA sidecar can be subcontracted.**

Relevant potential prime **research targets, not contacted or committed**:
- **Woolpert**: its [original North Central Texas Council of Governments program case](https://woolpert.com/projects/north-central-texas-council-of-governments-nctcog-orthoimagery-and-lidar-program/) states Woolpert processed lidar/ortho and impervious-surface polygons for five cities, geographically relevant to the buyer. This is a demonstrated comparable capability, not proof of three contactable references, current appetite or authorization.
- **NV5 Geospatial**: its [own government contract register](https://www.nv5.com/geospatial/about/contract-vehicles/) lists LiDAR acquisition/processing work and [original USGS LiDAR announcement](https://www.nv5.com/news/la-fires-data/) demonstrates field acquisition; municipal impervious-billing references still need qualification.

**Conditional proposed specialist transaction, not a promise or price to City:** ask incumbent sales owner to evaluate one narrowly separable paid **pre-award schema-readiness QA package** or **post-award data-dictionary/sample acceptance screen**, contingent on selected prime agreement and permissible City subcontract disclosure/approval. Internal *illustrative offer, unaccepted*: $2,500 fixed for a 5-business-day technical gate: capture exact City approved schema, configured original field map, run original partner sample metadata+attribute files, explain failing fields and provide second-pass signed-off quality report (up to two passes). Requires prime-supplied real Esri artifacts, written limited scope, no field collection, no extraction/transmission of protected parcel data, and separate professional geospatial expert for CRS/ground truth. Do not send or commit price without owner decision.

**Owner choice:** seek documented qualified-prime interest and allowed subcontract route, or **NO BID**. No buyer/partner contacted, no actual data received, no cash, submission or payment. More public-source demos without a prospective paying prime are not next priority.
