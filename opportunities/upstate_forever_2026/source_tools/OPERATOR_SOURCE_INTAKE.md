# Prepare original regional sources through the running operator

The client has two execution modes over the application's existing HTTP API,
source preparation helpers, task queue and Workspace. The original `run`
command receives the retained PRISM and NOAA originals. The `plan` command
executes a complete source plan, resolves dependencies to the source IDs
actually returned by the operator, adopts existing preparations, and composes
one imported source edition.

The command is a standalone Python 3.10+ client using the standard library.
Native GIS work runs in the operator's existing interpreter and worker queue.
Both modes follow the original task IDs through completion and retain a local
JSON record for continuation.

## Execute a complete source plan

Run the catalogue command against the accepting operator to obtain its exact
Workspace key, registered roots, methods, source selectors, prepared task IDs
and source collections. Catalogue output includes the installed method input
and option contracts, so a plan can be assembled from the actual application.

```bash
python -B source_tools/operator_source_intake.py catalog \
  --operator-url http://127.0.0.1:8765 \
  --study-title "THE EXISTING STUDY TITLE"
```

Supply the current capability through the existing
`UPSTATE_OPERATOR_CAPABILITY` environment variable or the documented
owner-only capability file. Keep the operator's capability out of the plan.

A source plan is a JSON object with schema
`upstate.operator-source-plan/v1`. Its `steps` are original
`source.prepare` operations. The method names are the IDs from the
catalogue: currently `nlcd`, `prism`, `erosivity`,
`dem` and `soil`. The plan's selected existing source
collections and registered manifests join its completed preparations in the
final `source.compose` request.

### Bind a real dependency

A dependent input uses `{"from_step": "landcover"}`. After the
land-cover preparation finishes, the client reads its actual
`source_collection_id` and `source_id`, reopens that
collection, and supplies the native
`{"collection_id": "…", "source_id": "…"}` selector to the
dependent method. It checks the numeric source role and original raster body
before submitting the dependent request.

New preparations used by later steps import their output directly. A reused
preparation that was completed without importing receives one ordinary
`source.compose` import through the existing queue. The final
composition selects each prepared task bank once. Intermediate imports serve
the dependency binding and are not added a second time to the final source
edition.

For example, a plan can receive the existing national land-cover archive,
prepare terrain on its actual numeric reference grid, reuse the climate
preparations that have already completed, and include the existing regional
soil/source manifest. The soil acquisition already owned by another operation
continues independently; select its retained collection or manifest when ready.

The following example shows the dependency structure. Set its root paths,
filenames, source edition and retained identifiers from the accepting
operator's catalogue and existing source results before executing it.

```json
{
  "schema": "upstate.operator-source-plan/v1",
  "title": "Upper Savannah original regional source edition",
  "roots": {
    "originals": "/path/to/registered/originals",
    "domain": "/path/to/registered/domain"
  },
  "steps": [
    {
      "id": "landcover",
      "method": "nlcd",
      "inputs": {
        "archive": {
          "root": "originals",
          "path": "Annual_NLCD_LndCov_2025_CU_C1V2.zip"
        },
        "transfer": {
          "root": "originals",
          "path": "source-transfer.json"
        },
        "domain": {
          "root": "domain",
          "path": "model-domain.esri.json"
        }
      },
      "options": {
        "read_mode": "archive",
        "expected_features": 217,
        "buffer_m": 1000
      }
    },
    {
      "id": "terrain",
      "method": "dem",
      "inputs": {
        "reference": {"from_step": "landcover"},
        "domain": {
          "root": "domain",
          "path": "model-domain.esri.json"
        }
      },
      "options": {
        "vintage": "THE SOURCE EDITION IN THE RETAINED METADATA",
        "tile_size": 2048,
        "workers": 1,
        "buffer_m": 1000
      }
    }
  ],
  "source_collection_ids": [],
  "registered_ids": []
}
```

The example's 217-feature domain and 1000 metre buffer match the existing
Upper Savannah operation. The original source helper still verifies the
selected geometry and applies its own domain, grid, unit and native-data
contracts. The client passes those actual method options through unchanged.

To adopt a completed preparation, replace the corresponding new-preparation
step with a step containing its actual original task ID:

```json
{
  "id": "landcover",
  "method": "nlcd",
  "reuse_task_id": "THE ACTUAL 64-CHARACTER PREPARATION TASK ID"
}
```

A reused step retains its original inputs and options. It can be a prerequisite
for other steps, or simply contribute its original bank to the final edition.
An active reused task is followed in place; a failed or interrupted original
task is resumed through its native resume route. The existing explicit
`--resume-cancelled` choice also applies to cancelled reused tasks.

```bash
python -B source_tools/operator_source_intake.py plan \
  --operator-url http://127.0.0.1:8765 \
  --study-title "THE EXISTING STUDY TITLE" \
  --plan /path/to/upper-savannah-source-plan.json \
  --operation-id ECO12-REGIONAL-SOURCE-PLAN-20261013 \
  --output /path/to/retained/upper-savannah-source-plan-result.json
```

`--plan-root NAME=REGISTERED_ROOT` changes one existing named root
for the accepting machine without editing the saved plan file. The value must
identify one exact root from that operator's catalogue. The effective root
selection is retained in the result, together with the plan and its resolved
native requests.

`--include-collection` and `--include-manifest` can add
existing source editions to the plan's own selected arrays. They use the same
exact catalogue identifiers as the climate command. A plan may have no new
steps and compose only existing collections/manifests.

### Select original inputs

Each input accepts one of the following selectors.

| Selection | Fields |
| --- | --- |
| Named plan root | `root`, `path` |
| Existing registered root | `root_id`, `path` |
| Imported source | `collection_id`, `source_id`, optional `companion_path` |
| Existing upload | `upload_id` |
| Bundled original reference | `builtin_id` |
| Completed prerequisite | `from_step`, optional exact `source_id` and `companion_path` |

Fields omitted from a method's inputs continue to use its installed defaults.
For example, current NLCD metadata, NOAA metadata, USDA interpretation metadata
and USGS metadata use the original bundled reference selectors when declared
by the method. The source helper owns the actual receipt and file validation.

A step can also declare `expected_inputs` to check selected originals
against specific retained byte counts and SHA256 values. Use the input's
method field name as the key and an object with exactly `bytes` and
`sha256`. After the native preparation, the client reads the
original selection document and compares the retained main member for each
declared input. It then reads the original numeric source entry and verifies
the same raster body in the completed imported edition.

### Continue and restore

Use the same plan, effective roots, operation prefix and result file to
continue an interrupted observation. The result records resolved requests
before they are sent; a lost HTTP response is reconciled against the
operator's retained task. Completed preparations are reused and dependency
selectors retain their actual imported source identities.

The complete source-plan release also updates
`operator/source_preparation.py`: its existing result route now
attaches the same workspace-bound original document tickets as the task view.
This makes the retained selection, source manifest and native entry readable
after a Workspace restore even when the former queue task is absent. The
client adopts that complete prepared bank through the normal result and
composition routes. Restored composition records are checked against the
original resolved request before reuse.

The same native task continues to own acquisition and processing errors.
After resolving its reported source or helper issue, rerun the same command.
Only genuinely changed input selections need their own operation prefix and
result file.

The plan result records each logical step's original task ID, source ID, role,
units, source edition, imported prerequisite collection and original raster
identity, followed by the final composition task and source collection IDs.
Open that collection in the existing source desk or select it for the current
regional model preparation.

## Retained PRISM and NOAA command

The original climate command continues to prepare both numeric sources,
check its pinned retained inputs, compose the selected edition and import it.
Its command arguments and default operation identity remain compatible with
the original release.

## Installed source

Place these complete files under the current application:

- source_tools/operator_source_intake.py
- source_tools/OPERATOR_SOURCE_INTAKE.md

The source preparation backend and routes must be installed. The original
ECO12 integrated release is F0C8RSDBVMX. Install the current complete source-plan
release over that application to receive the plan command and restored-result
document tickets; it includes the full current operator/source_preparation.py.

Both supported integrations expose the same original routes:

| Operation | Current native route |
| --- | --- |
| Studies and source collections | GET /api/state |
| Source roots and preparation catalogue | GET /api/source-preparation/catalog |
| Actual registered directory contents | GET /api/source-preparation/files |
| Queue preparation and composition | POST /api/actions |
| Read the original task and progress | GET /api/task |
| Resume its retained operation | POST /api/task/resume |
| Original selection and entry documents | GET /api/file/:ticket |
| Reopen the imported source collection | GET /api/item?kind=sources&id=:id |

ECSA registry edition
f293e68f7f490346280419ae447748ef95ec76a3 preserves these source routes. The
direct source-preparation integration uses the same API.

## Prepare the already-retained inputs

Register the existing archive directory and current application root when
starting the operator, using its repeated --source-root option. The archives
may have separate registered roots. Existing --source-manifest registrations
also expose their parent directories.

The complete original reference packet is:

https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8MSHTJG6

It contains nine byte-preserving files at their application-relative paths.
The packet schema is upstate.original-source-references/v1. For each member,
decode content_base64 and check the declared bytes and SHA256 before placing
it beneath the current application root. The entire packet contains 135,035
decoded bytes. Its complete pretty-printed JSON plus final newline is 184,069
bytes, SHA256
caa8395ad71b92532121cc995bde9942719d077449d95ceaf8418b95835e0068.

The native source operation already retained these two original archives:

| Source | Original Slack file | Bytes | SHA256 |
| --- | --- | ---: | --- |
| PRISM annual precipitation normal | F0C8H2FGAUV | 62,685,097 | 763f97b677711112ff7b1082c794476e2d9b7abe1f6e55dd4f1166e32523ccd3 |
| NOAA rainfall erosivity | F0C9BC7MKME | 47,143,128 | 157bbcaa54b445f96506fb1caffda4bbaea6b28f71bc7199235705e69cd00596 |

Use the existing mounted copies of those files. Their observed original names
are PRISM-ppt-1991-2020-800m-original.zip and
NOAA-R-Factor-CONUS-original.zip. Select the actual current filenames from the
registered directory.

The PRISM transfer receipt is the completed original
DBC61-UPSTATE-PRISM-ANNUAL-ORIGINAL-20261012 operation, retained from the
canonical Sales message 1791842427.025379. Its complete 3,873-byte JSON includes
the original final newline and SHA256
42ae6aa2a7d9fb987983c970ccc130b9045e330cd7e893f6dc92b67e01f68a53.

The native helpers use the exact original published sources:

- PRISM:
  https://data.prism.oregonstate.edu/normals/us/800m/ppt/monthly/prism_ppt_us_30s_2020_avg_30y.zip
- NOAA:
  https://coast.noaa.gov/data/digitalcoast/zip/R-Factor-CONUS.zip
- NOAA original metadata:
  https://www.fisheries.noaa.gov/inport/item/48224

The reference root must contain these four intake files from the nine-file
packet:

    source/prism-precipitation-1991-2020/source-transfer.json
    source/noaa-r-factor-conus-2013/source-transfer.json
    source/noaa-r-factor-conus-2013/metadata.html
    source/noaa-r-factor-conus-2013/metadata.html.capture.json

The first preparation needs its archive and PRISM transfer; the second needs
its archive and the three NOAA reference files. The command contains their
exact byte counts and hashes.

## Connect to the active operator

Use the actual current operator origin and capability. The origin contains
only its scheme, host and port. Authentication comes from
UPSTATE_OPERATOR_CAPABILITY by default, another explicitly named environment
variable, or an owner-only file selected with --capability-file.

An owner-only file must be a regular UTF-8 file owned by the current user, with
mode 0600 or 0400, containing only the capability. The client rejects symlink
files and authenticated redirects. It uses HTTP for the local loopback
operator, or HTTPS for an explicitly configured remote operator. The
capability is excluded from the result record and console output.

The examples below use task-specific environment variables for the actual
origin, selected study and native paths. ECO12_OPERATOR_ORIGIN is the origin;
ECO12_OPERATOR_CAPABILITY_FILE is the path to the owner-only capability file.

Discover available studies and the exact root labels/IDs:

    /opt/pyvenv/bin/python source_tools/operator_source_intake.py catalog \
      --operator-url "$ECO12_OPERATOR_ORIGIN" \
      --capability-file "$ECO12_OPERATOR_CAPABILITY_FILE"

Then select the intended original study by its exact unique title, or use its
explicit --workspace key. A duplicate title requires the key. The run command
always requires an explicit study selection.

List the existing archive directory:

    /opt/pyvenv/bin/python source_tools/operator_source_intake.py catalog \
      --operator-url "$ECO12_OPERATOR_ORIGIN" \
      --capability-file "$ECO12_OPERATOR_CAPABILITY_FILE" \
      --study-title "$ECO12_STUDY_TITLE" \
      --list-root "$ECO12_ARCHIVE_ROOT"

Use --path for a relative subdirectory and --offset for the returned
next_offset. The client uses the exact registered source root ID or absolute
path reported by the server.

## Complete preparation, import and composition

With the original archive filenames and reference root selected:

    /opt/pyvenv/bin/python source_tools/operator_source_intake.py run \
      --operator-url "$ECO12_OPERATOR_ORIGIN" \
      --capability-file "$ECO12_OPERATOR_CAPABILITY_FILE" \
      --study-title "$ECO12_STUDY_TITLE" \
      --archive-root "$ECO12_ARCHIVE_ROOT" \
      --reference-root "$ECO12_APPLICATION_ROOT" \
      --prism-archive PRISM-ppt-1991-2020-800m-original.zip \
      --noaa-archive NOAA-R-Factor-CONUS-original.zip \
      --operation-id ECO12-ORIGINAL-CLIMATE-INTAKE-20261012 \
      --output "$ECO12_INTAKE_RESULT"

Archive arguments accept either exact relative paths beneath their selected
root or absolute paths beneath that same registered root. Use --prism-root
and --noaa-root when those originals are already retained in different
registered directories.

To compose with the current complete upstream geography or other compatible
scientific inputs, append their exact current catalogue identifiers:

    --include-collection EXISTING_COLLECTION_ID
    --include-manifest REGISTERED_MANIFEST_ID

Both options may be repeated. The catalogue lists current source collections
and registered manifests. The original source composer resolves the selected
manifests and enforces its source identity rules.

The client performs this complete native sequence:

1. Read the selected original Workspace and its current source catalogue.
2. Record the exact selection and stable operation identities in the result
   file before queue submission.
3. Check that each newly selected archive and reference file appears in its
   registered native directory with the retained original byte count.
4. Submit or reuse the same PRISM and NOAA source.prepare tasks with
   source_mode=received and import_sources=false.
5. Follow the operator's real task states and preparation stages until both
   source banks complete.
6. Fetch the original selection and native-entry documents through the
   operator's file tickets, verify their transmitted hashes, and match every
   retained archive/receipt/metadata input to its pinned original hash.
7. Submit source.compose using the completed preparation task IDs and selected
   existing source collections/manifests, with import_sources=true.
8. Reopen the imported collection and match both original numeric raster
   bodies to the verified native preparations.

The intermediate preparations remain reusable source banks. The imported
composition is the single source edition for subsequent regional alignment
and model preparation. PRISM retains its original 1991–2020 climate normal and
native 30-arcsecond grid. NOAA retains its historical 800-metre raster and
the explicit physical conversion for the existing model alignment.

The final result records the exact unit and conversion declarations returned
by the native helpers. NOAA's source conversion remains applied by the
existing model grid preparation. Subsequent grid-dependent DEM/K and the
complete upstream NLCD preparation continue through the source desk.

## Continue the same original operation

Rerun the same command with the same result path and selection. The client
reopens the server's original task records. It observes queued/running work,
reuses completed preparations and resumes a retained failed or interrupted
task once at the beginning of that invocation. A previously cancelled task
requires the explicit --resume-cancelled option.

The client also reconciles the operator's existing identical-request reuse,
including a response lost after acceptance. It preserves the actual task ID
returned by the queue and can recover a matching active/completed request
from the current Workspace task catalogue.

The result file is written atomically after every accepted task and state
change. A small adjacent lock protects only this client's result record. The
native operator remains the owner of its original state and scientific queue.

Default observation continues to native completion. --wait-seconds can set
a client observation interval when needed; expiration leaves the actual
native tasks running and records pending. --poll-seconds controls the
progress read interval and defaults to five seconds. Ctrl-C likewise leaves
the native work retained for continued observation.

A changed selection requires its own result file and operation prefix. This
preserves existing source inputs, failed-task details and successful source
editions. Server-native preparation errors remain attached to their exact
task IDs and attempts. After repairing the reported source or installed
helper, rerun the original command.

## Use the completed result

The local JSON contains:

- Workspace key, original project ID and study title.
- Original request definitions and selection identity.
- Both preparation task IDs, attempt history, latest stage and retained log tail.
- Exact verified archive/receipt/metadata selectors, sizes and hashes.
- Native raster source IDs, bytes/hashes, units, vintage, grid metadata and
  source conversion declarations.
- The composition task ID and imported source collection ID.
- The completed native manifest and source bank paths returned by the operator.

The short stdout JSON contains the actual collection/task identifiers and the
result file path. Open that same collection in the source desk or select it
for the current regional preparation. Send those actual IDs and the first
native source result to the existing ECD1/ECO12 receiving thread so the
regional source owners can continue on the completed originals.

The original source packet and root's integrated release travel through the
same cumulative application receiving operation. Keep the current source
root, native interpreter, saved Workspace and original regional input
selection together when reporting its first executed intake.
