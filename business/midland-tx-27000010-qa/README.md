# Midland geospatial delivery workspace

A local operator application for City of Midland RFP 27000010: original-source intake, complete attribute review, correction cycles, City dictionary versions, correspondence records and retained delivery editions. It extends the released `preflight.mjs`, `spec.mjs` and ArcPy adapter. The original field and row checks remain the review engine.

## Open the application

Use Node.js 24 or later. PDF inventories use Python 3 and ReportLab; the application otherwise uses Node’s built-in HTTP, SQLite, filesystem and streaming APIs. There is no hosted workflow, paid service, database server or package build.

```bash
python3 -m pip install -r workspace/requirements.txt
node workspace/cli.mjs serve --workspace /private/midland-delivery --port 8787
```

Open the complete local URL printed by the launcher. Enter your operator name in the header. The service listens on `127.0.0.1`; the URL opens that private workspace and grants its local session access. Use `MIDLAND_PYTHON` or `--python` when the Python environment has a different path. The application keeps source data outside the code repository.

### Source intake

Create a project, retain an original metadata/NDJSON pair and select the corresponding source versions. The source history retains each file’s identity, operator, capture reference and correction parent. Each run freezes its source selection and selected dictionary. Partial samples stay explicitly separate from full-population review.

The maintained ArcPy export command runs in the prime’s licensed ArcGIS environment:

```bash
python arcpy_export.py /secure/work.gdb/IMP_SURFACE_PARCELS /secure/qa/midland-parcels
```

Upload the resulting `midland-parcels.json` and `midland-parcels.ndjson`. The adapter exports the original Esri fields and readable attributes; geometry stays in its original geodatabase.

The source screen also accepts a native ArcGIS REST layer metadata file and a native feature response. Choose the RFP class against which to compare that source. Field names stay unchanged, standard UTC date epochs become lossless ISO dates, and the original response—including geometry and original values—is retained. An absent backend geometry-field name remains absent; the adapter does not invent `SHAPE`. A reported transfer limit requires sample mode. This lets an operator inspect an existing public dataset against the future delivery schema without relabeling the dataset as an acquired deliverable.

### Review and corrections

The finding register retains every observation, including those beyond the original compact report’s 40 examples. Filter by run, code, state, field or record. Open the exact retained source row, assign a reviewer, request a correction, record a source-linked exception, reopen a decision or append a note. Up to 1,000 explicitly selected findings can receive one bulk action through the API; the browser exposes the 50 findings on its current page.

A corrected export creates a new source version. Run the selected versions again and compare results. A decision carries forward only when the row, source metadata, dictionary and finding remain identical and the match is unambiguous. Changed records or dictionaries require new decisions. Duplicate records do not share a decision accidentally. A note preserves the active assignment. A recorded exception remains attached to the finding; it does not remove the original result.

The three area-balance, percentage-difference and duplicate-identifier heuristics retain their original proposed-QA designation. They are not added City numerical tolerances. Review verdicts remain `REVIEW_REQUIRED` or `PRELIMINARY_SCHEMA_PREFLIGHT_ONLY`.

### City dictionary and project correspondence

Start from the downloadable original RFP dictionary or retain a configured JSON version. The four classes, geometry families, field definitions and required semantic roles are validated before selection. The provisional parcel identifier supports a documented String, Integer or SmallInteger field and an explicit renamed-field mapping. The ERU formula remains a separate City decision; this application does not guess it.

The fourteen original Double fields retain the exact declared precision and scale: precision 38; scale 6 for acreage fields, scale 2 for the three flightline Double fields, and scale 4 for the remaining Double fields. Revised dictionaries preserve and validate an explicit precision/scale pair. ArcPy and REST intake retain the numeric metadata actually exported. The completed review shows declared and exported values side by side, and the physical-schema milestone stores the original database/City decision. [Esri documents](https://doc.esri.com/en/arcgis-pro/latest/tool-reference/data-management/add-field.html) that file geodatabases ignore numeric precision and scale; matching metadata is therefore not a storage guarantee. The application does not round source values or infer a decimal tolerance. [ArcPy Field properties](https://doc.esri.com/en/arcgis-pro/latest/arcpy/classes/field.html) are retained directly by the original exporter.

The browser keeps a draft dictionary distinct from recorded written City approval. The approval author, date and source are required for the latter. Existing runs retain their original dictionary. Milestones separately record packet/addenda, notice to proceed, dictionary submission/approval, representative records, approved modifications, spatial QA, billing review, delivery inventory, City comments and final acceptance correspondence.

Dates come from the actual City documents. The exposed original packet contains conflicting notice-to-proceed timing. Its sample sequence also differs: §5.5.4 places at least five representative records before full delivery, with City load validation within five business days and acceptance dependent on that validation; the §6 schedule places schema approval and sample validation before acquisition. Retain the actual City timing clarification and the separate §5.5.2 ten-business-day dictionary review. No date or reconciled sequence is inferred from these conflicts. A received milestone is an operator-entered record with an original source reference. Completing attribute review does not fill in City approval.

### Delivery and reopening

Retain original delivery files under their inventory roles: source context, LAS/LAZ, DEM, contours, impervious layers, flightlines, geodatabase, imagery, accuracy report, metadata or correspondence. A delivery edition freezes a completed run, its original sources, selected files, dictionary, review cutoff and milestone snapshot.

The edition contains:

- A matching CSV and PDF inventory with each included file’s full SHA-256, byte count, role and original reference.
- Original metadata and attribute exports, selected delivery files and the retained dictionary.
- The complete finding CSV and decision history as of the edition’s review cutoff.
- A retained review report and `SHA256SUMS.txt`, which includes the CSV/PDF inventories after generation.

The inventories list the deliverable and review files. `SHA256SUMS.txt` lists those files plus the generated inventories; it excludes itself. The ZIP manifest contains the exact constituent identities. This avoids a circular self-checksum while covering the physical delivery files.

**Download reopenable case** preserves the project’s full history, every source version, original objects, completed physical edition files and the application source. Restore validates the manifest, native column structure, links, original object identities and cached edition identities into a new directory. It imports data using the maintained application; uploaded application code is never executed. An unfinished worker imports as interrupted. A later operator explicitly reruns its retained inputs.

The browser can restore a ZIP into a new retained workspace and reopen that workspace after a server restart. The CLI also supports this path:

```bash
node workspace/cli.mjs backup --workspace /private/midland-delivery --project PROJECT_ID --out /private/midland-case.zip
node workspace/cli.mjs restore --archive /private/midland-case.zip --workspace /private/reopened-midland
node workspace/cli.mjs serve --workspace /private/reopened-midland
```

Source uploads default to 512 MiB per file; `--upload-limit-mib` selects a larger explicit limit. Restore defaults to an 8 GiB expanded package limit. ZIP64 and streaming copies support large retained files within the configured storage. Preserve room for both the original files and their delivery/case packages. Prepared editions retain physical copies so their downloaded bytes survive reopening.

## Original command and integration contracts

The original standalone command remains usable:

```bash
node preflight.mjs --metadata /secure/qa/midland-parcels.json --rows /secure/qa/midland-parcels.ndjson --out /secure/qa/review.json --sample
node workspace/cli.mjs --help
```

The preflight API accepts optional `contract`, `onFinding`, `onRow`, `onProgress` and `signal` arguments. Its output adds the actual metadata input digest; the original compact examples and verdict remain available. `workspace/contract.mjs` validates dictionary inputs, `store.mjs` retains project state and full findings, `arcgis.mjs` adapts original REST exports, and `delivery.mjs` creates editions and portable snapshots. Mutations use the project’s current revision; a stale revision returns 409. Source objects and review history are retained rather than overwritten.

A graceful shutdown stops owned reviews and saves their partial observations. On reopening, worker identity includes the original boot, PID namespace and process start, so a recycled PID is not treated as the original live review. A worker in an unobservable namespace is not killed or silently replaced.

## Original source and commercial context

The source transcription comes from the [exposed RFP text](https://govtribe.com/file/government-file/001-rfp-27000010-lidar-geospatial-data-acquisition-dot-pdf), particularly §§4.5–6, and the [original City procurement entry](https://midlandtexas.bonfirehub.com/opportunities/250058). The catalog describes 23 pages, but the exposed text ends on printed page 17 in §7.7. The original PDF binary and addenda are separate source inputs. The published dictionary uses 67,455 project parcels; the actual City-approved dictionary governs later changes.

The [City GIS page](https://www.midlandtexas.gov/1196/GIS-Mapping) links [GeoStation](https://geostation-comgis.hub.arcgis.com/) and documents the existing public data’s coordinate system and use context. Existing public parcel data is source context. It is not the future acquired RFP population or an accuracy certificate. Original data retains its source ownership; the application’s MIT code license does not relicense City data.

The preserved `pipeline-case.json` is the original commercial workstream input. It records two researched potential primes and a conditional illustrative **$2,500 / five-business-day** specialist package; it does not record an accepted customer agreement or payment. The existing pipeline’s qualification states remain data in that historical case, separate from owner instructions or permission to continue engineering. This change does not send an offer, submit a City proposal or modify any compensation claim.

The City procurement calls for an integrated qualified prime and retains subcontract disclosure/approval requirements. The application supports that delivery team’s retained-data and review work. Acquisition, geodatabase geometry/load, datum, coverage, independent accuracy, stormwater billing validation and City acceptance remain their actual technical and contractual work.
