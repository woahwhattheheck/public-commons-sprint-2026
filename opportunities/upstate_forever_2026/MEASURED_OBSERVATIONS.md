# Upper Savannah · Measured observations

Version 1.1.0 · Recovered OBS12 engine and complete source-collection workflow

See `MEASUREMENT_COLLECTIONS.md` for complete collection receiving, saved study ZIPs and independently editable receiving. The optional original chemistry-inference adapter is a separate integration; this collection component operates independently.

A complete measured-data workspace for the existing Python operator: retained source receiving, chemistry normalization, explicit native-domain assignments, record review and source revision choice, reviewed input export, concentration/discharge pairing and independently editable receiving. Industrial grayscale browser, Python adapter and Node command line are included. No npm or pip dependency installation is needed for operation; use Node 22.16+ and Python 3.10+ on Linux.

## Install into the maintained operator

The native registration follows the actual `upstate.operator-extension/v1` registry and shared browser host published by ECSA at `f293e68f7f490346280419ae447748ef95ec76a3`. It reuses that host's authentication, session, Workspace selection, navigation and static-file transport. No scientific writer or shared operator source is replaced.

The source tree already contains the component and its declaration at `integration/component_fragments/measurement-collections.json`. Restart the existing operator process, open its existing authenticated interface and select **Measured observations**. The existing shared extension host discovers the retained descriptor. No shared operator source or Published Studies initializer is replaced.

The separately distributed source archive also provides `install_measurements.py`; run that installer from the extracted archive when upgrading an original application outside this source tree. It preserves peer modules and upgrades only exact known predecessor bytes. The direct Python HTTP adapter also supports an operator without the extension host.

Namespaced native routes: `POST /api/measurements/rpc` and `POST /api/measurements/domain`. Browser view: `measured-observations`. Descriptor: `operator/extensions/measured-observations.json`. An application-owned Node child runs only on loopback with a per-process private token. Requests arrive through the original Python authentication boundary. It is started once per opened measurement workspace, restarted after process death on the next operation, and closed with its Python parent. No write is automatically replayed after an uncertain response.

### Native reach or HUC source binding

Open **Bind an original native reach or HUC source** above the desk. Choose a JSON/GeoJSON already retained within the original Workspace, its list field path and string identifier field path. For GeoJSON, list path is normally `features`; select the actual source property's path, such as `properties.HUC12`, only when that property exists. An existing identifier list uses an empty item path and ID path. Numeric identifiers are rejected rather than changed to strings with lost leading zeros. All source identifiers must be unique. The original file SHA-256 and source field mapping are retained.

The desk never supplies guessed reach IDs or treats proximity as a drainage assignment. After binding the source edition, each imported monitoring station receives an explicit analyst assignment with reviewer and rationale. The assigned spatial unit is context; it does not itself establish that the entire HUC drains through the monitoring point.

## Operator workflow

1. Receive a complete WQP/WQX3 chemistry CSV, stations CSV, or USGS OGC daily mean discharge GeoJSON. Alternatively retrieve a station/date range from the public providers. Inspect parse counts, rejected rows, units, fractions, censoring, mapping and source checksum, then commit the complete source.
2. Assign stations to the actual selected native identifiers. Filter measurements, open an exact record, inspect raw fields and every original source-row link, review qualified results, and select between conflicting revisions without deleting alternatives.
3. Export all measurements or the reviewed input population. The input package includes complete accepted/excluded records with reasons; no nondetect substitution or replicate averaging is performed. Create an optional explicit concentration/discharge pairing report with the actual station pairing and written rationale.
4. Export the complete editable measurement workspace. Receive it into an empty measurement workspace, reparse the original files, verify every canonical record and source link, and continue independent edits. Existing work is never overwritten.

The complete handover contains original source texts, original provider response pages, parse accounting and rejected rows, canonical measurements, station metadata, assignments, reviews, alternative revisions, events and saved exports. It is a portable JSON artifact, not a pointer to the sender's SQLite database. Native-domain source files remain owned by the original Workspace; bind the same retained source edition in the recipient's native app.

## Scientific semantics

Original strings are retained verbatim. Recognized mass concentration units normalize to mg/L without changing chemical basis; mg/L as N is not silently changed to mg/L as nitrate. Total/unfiltered nitrogen and phosphorus are distinct from dissolved or unspecified fractions. Nitrate and orthophosphate retain basis and fraction. BOD5 and carbonaceous BOD5 remain distinct, with no conversion to ultimate BOD. Blank values never become zero. Nondetects retain a null point value and an explicit lower/upper bound where the original result or one compatible detection limit supplies it. Multiple laboratory detection/quantitation limits are preserved rather than selected automatically.

Explicit time zones produce UTC instants while retaining source calendar date/time; unspecified time zones remain unspecified. USGS daily data remain source-calendar-date daily means. Qualified or provisional results require a saved inclusion review; quality-control samples, unknown units and source-derived values remain excluded from usable inputs. Source revisions must be selected explicitly.

`upper-savannah-calibration-input` version 1 contains `accepted`, `excluded`, `counts`, `workspaceRevision`, source references and rules. These are measured inputs for downstream calibration and temporal matching. **Native annual loads PO4_KG/NH4_KG/NO3_KG, and native InVEST annual N/P or sediment outputs, are not concentration aliases.** This extension does not write them through `Workspace.import_observation_loads`.

`upper-savannah-paired-loads` version 1 calculates `C [mg/L] × Q [m³/s] × 86.4` as a kg/day estimate. The supporting concentration is a discrete sample, not a daily mean. Pairing requires an explicit chemistry station, discharge station and rationale; exactly one usable daily flow on the source calendar date; and preserves unpaired/ambiguous measurements. Censored concentration bounds produce load bounds, not point estimates. There is no interpolation, annualization or drainage-area scaling. Floating-point conversion is used, not an exact-decimal laboratory calculation.

## Public-data contracts

Provider documentation checked October 12, 2026:

- USGS states legacy WQP profiles exclude USGS updates after March 11, 2024; WQX3 is used by default: https://waterdata.usgs.gov/blog/wqx3/ .
- WQX3 query/profile documentation: https://www.waterqualitydata.us/beta/webservices_documentation/ . Chemistry uses `/wqx3/Result/search`, `dataProfile=fullPhysChem`; stations use `/wqx3/Station/search`.
- USGS daily OGC query fields: https://api.waterdata.usgs.gov/ogcapi/v0/collections/daily/queryables . Discharge parameter `00060`, daily mean statistic `00003`; all pages are acquired before preview or commit.

Full original CSV headers and optional field overrides are exposed. Provider responses retain complete original page bodies and retrieval URLs/checksums. Redirects and continuations are restricted to the original official endpoint. Errors and incomplete pagination never become a silently partial committed source. An HTML error response is rejected as such.

## Standalone and Python use

For isolated operator development without the full native application:

```sh
node measurement_workspace/engine/cli.mjs serve --workspace ./measured-data --port 3101
# Open http://127.0.0.1:3101/ locally.
node measurement_workspace/engine/cli.mjs import --workspace ./measured-data --kind wqp --file complete.csv --label "Agency sample edition"
node measurement_workspace/engine/cli.mjs fetch --workspace ./measured-data --kind usgs-daily --station USGS-ACTUAL_ID --from YYYY-MM-DD --to YYYY-MM-DD
node measurement_workspace/engine/cli.mjs portable --workspace ./measured-data --output complete-measurements.json
node measurement_workspace/engine/cli.mjs receive --workspace ./independent-copy --file complete-measurements.json
```

The station/date strings above are placeholders; provide actual source selections. Standalone explicit reach IDs come from `measured-data/reaches.json` containing objects with string `id` and optional `name`.

```python
from measurement_workspace.operator import Measurements
service = Measurements(existing_workspace,
    data_dir=existing_workspace.root / "measurement-observations",
    reaches=lambda ws: your_existing_native_reach_resolver(ws))
summary = service.json("GET")
# Inside the ORIGINAL already-authenticated HTTP handler:
if service.try_handle(self):
    return
# Existing unrelated routing continues unchanged.
```

The optional `service.wrap(ExistingHandler, authorize=existing_authentication)` requires the explicit original authorization function. It does not infer that subclassing a handler inherits authorization performed inside its old route methods.

## Persistence and operational characteristics

SQLite WAL, full synchronization, foreign keys and explicit write transactions. Concurrent edits use expected workspace revisions; source imports are content addressed. Original source text and canonical records are stored together. Reimport deduplication is per source kind, complete content and resolved column mapping. Canonical record IDs include the full normalized record, preventing one mapping from overwriting another interpretation of the same raw row.

A single import/download defaults to 128 MiB; the current original operator's request limit can be lower. Use complete date windows for larger providers or the CLI receiving path on the same measurement directory. Each CSV is parsed in memory; this is not a claim of arbitrarily large streaming ingest. SQLite-backed record paging returns up to 500 records per request. Complete portable receiving reparses originals before any commit; interrupted transactions roll back. The managed process log is local under the measurement directory.
