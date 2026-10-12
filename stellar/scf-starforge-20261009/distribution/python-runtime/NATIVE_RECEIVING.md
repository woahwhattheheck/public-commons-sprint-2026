# Python runtime receiving on the original customer application

This workflow carries a selected Starforge source release and its exact Python
wheel set into private installations, then operates the existing customer
Analysis workspace and workbook delivery. It uses the maintained source installer,
Python runtime engine, AnalysisWorkspace, WorkbookDelivery and workbook client.

The receiving driver is native_receiving.py. Run it as the workload of the
original admitted native operation. Its output directory contains the retained
operation, step results and original command logs. Repeating the same plan
continues that operation with its existing source selection and customer IDs.

## What the complete journey operates

The first installation resolves the original Python project's selected extras,
including workbooks, retains all selected wheels, installs them in a private environment and
activates that exact installation. The driver receives one private copy of the
closed customer's complete database directory under its original analysis.lock.
The installed Python opens that receiving copy through the original
AnalysisWorkspace CLI and private loopback server.

The original workbook client reads the chosen saved definition, retrieves its
completed original delivery and downloads the complete handoff through the
authenticated application endpoint. The driver then requests one new workbook
build from that same saved definition, revision and definition hash. Every
selected source row, column mapping, precision choice and source history comes
from the original application. The saved workbook revision stays the same; the
one new job and its output are written only in the receiving copy.

The second original source runtime receives the same full source archive and
selection through the maintained installer. Its Python environment receives the
exact wheel bundle offline, installs the
same cohort in another private directory, receives the original workbook through
the installed workbook command, and reopens that same private receiving database.
It checks the completed first-environment build through the original API. The
original handoff, reconstructed workbook contents and exact text values are
compared using their actual manifest and installed openpyxl reader.

An optional upgrade selection performs that same reopen with an actual different
source commit. The prior installation remains available, and activation uses its
expected installation ID. The first activation is repeated with its original
empty expected predecessor; the engine must return the same retained activation,
including its timestamp and prior installation. This is part of the same receiving
operation.

## Required inputs and host

Use Linux, Python 3.11 or newer, Node 22.16 or newer as required by the selected
source, util-linux flock, and the maintained runtime installer. The selected
original project can impose a newer interpreter requirement. The original
installer and engine retain the observed interpreter and platform identities.

The native operation needs a host allocation that covers wheel resolution,
the private build environment, two customer environments, the full customer
directory copy, and the retained source/customer output. Wheel bytes and expanded wheel bytes are returned by the
engine. The original shared admission system remains the place to reserve the
actual host memory and storage.

Supply these original inputs:

- A maintained runtime-install.mjs and its exact SHA-256.
- An existing received source installation, or its exact original source archive
  and the source installer's preparation settings.
- The selected full source commit and package manifest SHA-256.
- The frozen Python engine file and its SHA-256.
- The original closed customer database, workspace ID and completed workbook
  delivery with its archive, manifest and XLSX hashes.
- A new private output directory outside the customer database.

AnalysisWorkspace holds its original process lock while open. The customer's
owner supplies the closed directory for the copy. The driver briefly acquires
that existing lock without creating or changing a source file. It releases the
source lock after publishing the complete copy, then opens and closes its own
receiving service. The original owner can continue using the original workspace.

The copy includes datasets.sqlite3, original control records, every retained
analysis-query-exports cohort, both workbook editions and their complete source
and history files. It streams regular files into private staging, verifies the
complete source inventory before and after copying, and uses the original
WorkbookDelivery directory-publication helper to publish without replacing a
destination. All original bytes and saved record IDs remain unchanged.

Saved job result.directory values remain producer provenance. The original
Python workbook download and source readers derive local paths from the selected
receiving database and validated job/export IDs, then verify the original
manifest and file hashes. The receiving driver preserves those saved results.

The source root is the complete selected original runtime containing
stellar/scf-starforge-20261009. The Python build project is its
sf88-operator-buyer-cli/python directory. Node bridge files stay in that original
source closure and are selected through the original installer receipt.

The workbooks extra currently comes from the original pyproject.toml:

    stellar-forge-buyer==0.5.0
    workbooks = ["openpyxl==3.1.5"]

The engine resolves and retains the concrete transitive wheel set from that
metadata. A package can keep version 0.5.0 across multiple source commits; the
selected source manifest, source snapshot and wheel hashes identify the actual
code being installed.

The plan's extras list is an explicit selection from that original metadata.
The complete receiving example selects workbooks and agents when the admitted
host fits their actual resolver-reported wheel and expanded bytes. Their original
requirement ranges remain unchanged. The engine verifies the full installed
package inventory and runs pip check for the selected cohort; the same complete
cohort travels through offline receiving. The application exercise remains the
existing workbook customer flow. A workbooks-only host selection can use
["workbooks"] explicitly; changing the selection creates a different cohort.

## Select the original source

An existing received installation supplies its source identity through the
maintained installer:

    node /absolute/toolkit/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs \
      inspect --dir /srv/starforge/source-runtime --load --source

The driver's source selection invokes inspectRuntimeInstall with source
verification, then reads the original runtime-install.json after that check. It
requires the observed source commit and manifest SHA-256 to equal the plan.

When a new original source archive is selected, the same plan can include a
prepare object. The driver calls prepareRuntimeInstall with that archive and
its complete hash, preserving the original source and runtime-profile metadata.

For a source profile with zero Node dependencies, install_zero_dependencies
uses the original installRuntime offline path to finish that small profile. It
first checks the actual generated dependency selection. Native Node feature
cohorts continue through the maintained installer and can be selected as an
already prepared installation when needed by the customer application.

An incomplete source preparation resumes through the original recoverRuntime
API and its retained archive. The source step records its selected recovery
directory before calling that original API. A later reconnect follows the same
retained selection, verifies the source identity and inspects the actual recovered
source root. Earlier partial preparations remain attached to that same operation.

## Prepare one private plan

Keep the plan outside source control. It contains private local paths and
customer identifiers. Wallet material, provider credentials and private launch
capabilities stay with their existing components.

The example below shows the complete revision-2 workbook case. Fill each
SOURCE or ENGINE placeholder from the actual selected source/install receipt;
use absolute host paths. The original customer handoff contains 17
manifest-declared payload files plus manifest.json, making 18 ZIP members.

    {
      "schema": "stellar-forge.python-native-receiving.v1",
      "operation_id": "scf-python-workbooks-review-r2",
      "engine": "/srv/starforge/toolkit/stellar/scf-starforge-20261009/distribution/python-runtime/engine.py",
      "engine_sha256": "ENGINE_SHA256",
      "python": "/absolute/selected/python3",
      "node": "/absolute/selected/node",
      "output": "/srv/starforge/receiving/journey",
      "extras": ["workbooks", "agents"],
      "source": {
        "installer_module": "/absolute/toolkit/stellar/scf-starforge-20261009/distribution/runtime-install.mjs",
        "installer_sha256": "INSTALLER_SHA256",
        "installation_directory": "/srv/starforge/receiving/source-primary",
        "root": "/srv/starforge/receiving/source-primary/package/source",
        "commit": "SOURCE_COMMIT",
        "manifest_sha256": "SOURCE_MANIFEST_SHA256"
      },
      "offline_source": {
        "installer_module": "/absolute/toolkit/stellar/scf-starforge-20261009/distribution/runtime-install.mjs",
        "installer_sha256": "INSTALLER_SHA256",
        "installation_directory": "/srv/starforge/receiving/source-offline",
        "root": "/srv/starforge/receiving/source-offline/package/source",
        "commit": "SOURCE_COMMIT",
        "manifest_sha256": "SOURCE_MANIFEST_SHA256"
      },
      "customer": {
        "database": "/srv/starforge/customer/customer-database",
        "workspace_id": "5e7e814ca0a4464680168c079b0430bb",
        "workbook_name": "customer_operations",
        "revision": 2,
        "delivery_id": "faf394e86cda48be91359daae951b590",
        "archive": "/srv/starforge/customer/edition-operation/handoff.zip",
        "archive_sha256": "5360eef6821afc43e2d94aaacc3149a37e4116e1a8679a2079e7b0de760ae4ff",
        "manifest_sha256": "29d587722631958b1522e98d08b4c28916cbdc044a817581c9489bb411b6f2ad",
        "xlsx_sha256": "9c8616ef61f552626daec68f38d4e6f0ee6494cdcc14217217b8b3545c37f009",
        "row_count": 7,
        "payload_files": 17,
        "exact_text_cells": [
          {"sheet": "Sales summary", "value": "599.010000"}
        ]
      }
    }

The completed original case has three data sheets: Wikimedia events (3 rows),
Sales summary (1 row), and Wikimedia report (3 rows). Its archive is 34,623
bytes, manifest is 5,909 bytes and XLSX is 10,046 bytes. The driver checks
the complete manifest and all retained file hashes through WorkbookDelivery.

To prepare a new source installation through the original source installer,
add these fields inside both source and offline_source. Keep their
installation_directory values distinct and select the same archive and profile:

    "prepare": {
      "archive": "/srv/starforge/downloads/original-selected-runtime.tgz",
      "sha256": "ORIGINAL_SOURCE_ARCHIVE_SHA256",
      "native": false,
      "features": [],
      "operator": true,
      "pins": {}
    },
    "install_zero_dependencies": true,
    "npm": "/absolute/selected/npm"

Each original received runtime owns its Python engine at
`installation_directory/python-runtime`. The primary and offline source
selections must have the same source commit, source manifest and profile identity;
the receiving directories and installed Python environments remain distinct.
Use a new installation_directory when preparing another original source
archive. The full source release and Python cohort remain separate retained
objects with their own identities.


## Use the managed Applications lifecycle

The optional applications selection exercises the original managed application
operator after each direct Analysis child has closed. It identifies the newer
controller source separately from the customer runtime's selected source. This
supports an original e287 Python cohort with a newer, explicitly pinned
Applications controller.

Add the actual complete controller closure and helper to the private plan:

    "applications": {
      "helper": "/absolute/toolkit/distribution/python-runtime/managed-application-receiving.mjs",
      "helper_sha256": "EXACT_HELPER_SHA256",
      "sourceRoot": "/absolute/newer-controller/full-source",
      "sourceCommit": "EXACT_CONTROLLER_COMMIT",
      "files": [
        {"path": "stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs",
         "sha256": "EXACT_ORIGINAL_FILE_SHA256"}
      ]
    }

The files array must include the complete required original controller closure
supplied with the helper. The single row above illustrates its shape. Every
selected file is verified before the native source operation starts.

The helper attaches the actual received runtime through openRuntimeWorkspace,
inspects the installed Python environment through the original python-inspect
operation, and reviews, saves and connects Analysis. It starts retained
application run IDs, checks the original authenticated state, closes and reopens
the operator facade around the same live child, then stops that run. A reviewed
fresh start reopens the same private database and is stopped before the helper
returns. The original application's FD3 lifecycle owns those children.

The primary and offline helper calls have separate private checkpoints. The
result records both controller and customer source identities, original
workspace/application/run IDs, the installed Python binding, authenticated state
hash and terminal stop outcomes. Private ready URLs remain in their native files.

## Match expansion to the original admission

When the selected host uses the maintained shared admission controller, add its
actual retained request path and the declared receiving allocation:

    "capacity": {
      "request": "/absolute/original-native-record/request.json",
      "directory": "/srv/starforge/receiving",
      "process_peak_bytes": 402653184,
      "memory_backed": true
    }

Set memory_backed from the actual filesystem. On tmpfs, all newly allocated
workspace bytes count alongside process memory. Place both received runtimes,
the journey output and any newly hydrated customer directory under this
allocation. Existing closed customer inputs can stay at their original paths.

The selected local full-run envelope is 1,024 MiB total memory with a 256 MiB
reserve, and 640 MiB storage with a 64 MiB reserve. The original shared controller
admits it using its supported clean-cache mode and live ledgers; that mode reads
the kernel's reclaimable-cache estimate while preserving shmem, mapped, dirty
and writeback accounting. The 384 MiB process allowance is part of the 1,024 MiB
peak, alongside all memory-backed files. The original storage declaration also
includes 30,000 inodes plus a 128-inode reserve.

After the original cohort is resolved or received, the driver records exact
wheel bytes, expanded bytes, archive member allocation, source allocation and
current workspace allocation before installing. It forecasts the remaining two source
and environment copies, compilation/bootstrap space, offline wheel copies and
workbook output. Before offline expansion, the first installed environment's
actual allocation replaces its initial bound.


The retained observation exposes the arithmetic used for admission. Let `W`
be the wheel archive bytes, `B` the sum of all expanded wheel members rounded
individually to the receiving filesystem block size, `P` the corresponding
rounded bytes of Python source members, and `D` the distinct parent-directory
count across all expanded wheel members. The initial installation bound is `I = B + 2P + D × block_bytes + 64 MiB`.
The remaining source-runtime bound `S` is the actual selected source allocation
plus its retained source archive and 8 MiB for installation metadata. If `C` is
the allocation already present, the initial projected total is
`C + 2I + S + 2W + 16 MiB`. The two wheel copies cover the portable archive and
the offline received cohort. Before the offline leg, the driver measures the
completed primary environment and replaces `2I` with that observed allocation
plus 64 MiB. File and inode counts are computed from the same complete wheel
inventory; they retain separate bounds.

For the declared 1,024 MiB tmpfs run, subtracting the 384 MiB process allowance
leaves 640 MiB for all owned allocation, matching its 640 MiB storage declaration.
The driver also requires the remaining writes plus the separate 64 MiB storage
reserve to fit actual `f_bavail`, and checks the 30,000-inode declaration and
128-inode reserve. Logical expanded size alone cannot establish this fit: small
files, Python compilation allowances, source copies and the second environment
are included in the retained calculation.

Both checks read the current limits from the same original request. A larger
actual cohort raises RECEIVING_CAPACITY_ADJUSTMENT_REQUIRED and retains the
candidate plus capacity-observation.json with the needed allocation. Keep those
retained outputs when using the original host's supported command continuation.
The selected host supports memory amendments while a command is still
undispatched; a larger declaration after a receiving command has run requires
its explicit completed-command continuation support. The private plan keeps
its original request path so a supported continuation can reread the current
limits. All measured counters and forecasting bounds are retained separately.

## Receive the complete closed customer package

The actual revision-2 transfer preserves the customer's complete directory under
its existing Analysis lock. Its private transfer archive contains all 51 database
and application files (751,347 bytes), plus the unchanged original workbook
handoff and handoff manifest. It preserves the three typed query cohorts, report
sources, both workbook revisions and every saved producer path.

To receive that package on another host within this same run, add the following
selection inside customer:

    "directory_transfer": {
      "archive": "/srv/starforge/incoming/scf-customer-revision-2.zip",
      "sha256": "4273340eec891df156f24d9174bb63fd394c62137d5d0c985219183930791f51",
      "manifest_sha256": "7ba52acb792e8a5f7c954d9b5c5a9b6e1033e806428324516218eafb825397b8"
    }

Keep customer.database and customer.archive pointed at their intended received
members:

    "database": "/srv/starforge/customer/customer-database",
    "archive": "/srv/starforge/customer/edition-operation/handoff.zip"

The containing /srv/starforge/customer directory is created from the verified
package. Its parent must be a private directory owned by the receiving account.
The transfer archive stays outside that destination. An existing destination is
reused only when its complete file and directory inventory matches the original
package.

Initial plan validation verifies the complete transfer archive SHA, exact
manifest, member names and sizes, original workspace/workbook identity and
intended receiving paths. The original handoff file becomes available after
hydration. The driver checks its original SHA before copying or opening the
customer application.

Hydration runs after the first actual Python installation, using that interpreter
and the original AnalysisWorkbooks directory publisher. All member hashes are
verified while streaming into a private retained staging directory. Complete
files and directory entries are synced before atomic publication. A replay
continues its own staged files or verifies the already-published exact directory.
The subsequent customer-copy step opens the restored original analysis.lock and
produces the separate application working copy described above.

The input contract is stellar-forge.customer-directory-transfer.v1. The transfer
contains 53 payload files, transfer-manifest.json and 22 directory entries: 76
ZIP members in total, 210,667 compressed bytes. Its database inventory identity is
225ac564e486b4a58a623fb7a554b534a7b37e34121ddf535c115903317c554e.
The receiving driver rejects archives above 100,000 members, manifests above
16 MiB, and payloads above 8 GiB as whole operations. Actual host admission must
cover the selected package, retained input, working copy and runtime cohort.

Existing plans with an already-present closed customer directory continue to
use that directory directly as the copy source. Both routes preserve the same
original customer and workbook identities.

## Run and continue the same operation

After the original host admission selects its source, input and capacity:

    /absolute/selected/python3 \
      /absolute/toolkit/stellar/scf-starforge-20261009/distribution/python-runtime/native_receiving.py \
      run --plan /srv/starforge/private/python-receiving-plan.json

The process creates a private operation.lock. That same open lock descriptor is
passed to every engine command. The engine keeps its own root lock and passes
both descriptors to its pip and venv children, so a surviving original child
continues to hold the operation after an interrupted parent.

Every step retains its intent digest and complete result. Engine completion is
written to its supplied progress file before stdout; the driver can recover
that completed result after a lost response. Candidate and installation
inspection rechecks the actual retained bytes. Source inspection reopens the
original source installer and verifies the selected archive.

The customer-copy step retains its complete file inventory and chosen receiving
path before copying. A partial copy resumes against those same original bytes.
Once the copy is complete, later steps reuse the selected receiving database;
they do not reread or modify the original SQL state.

The workbook build ID is derived from the original receiving operation ID.
Reconnecting posts that same build request to the existing Analysis API. A
completed delivery is read and verified against its exact archive before a
receiving directory is reused. Existing different content is never replaced.

The driver records service addresses without their capabilities. The private
Analysis launch file remains in the receiving database, and the original
workbook client reads it there. The owned server receives a graceful interrupt
and is joined before the second interpreter opens that database.

A failed step retains its exact error code and original stdout/stderr files.
Continue with the same plan once that concrete source, installation or host
condition is corrected. An input change requires a new explicit operation
selection; completed original steps remain retained.

## Inspect the retained result

The output directory contains:

- operation.json and plan.json: original selection, step state and result hashes.
- steps/: complete engine/installer/application command results and private logs.
- python-workbooks.bundle.zip: the exact portable wheel cohort.
- customer/database/: the private complete customer directory used by both
  installed interpreters.
- customer/: authenticated original downloads, original received workbook, and
  the single newly rendered workbook from the saved definition.
- result.json: the complete joined receiving outcome.

The original resolved cohort and installation live under the primary received
runtime's python-runtime/; the independently received cohort and installation
live under the offline runtime's python-runtime/. Both locations come from their
original installer receipts.

The result names both candidate/installation IDs, source identity, exact wheel
packages, wheel/expanded bytes, bundle digest, installed module locations and
versions. It also records the exact customer-copy inventory hash, file/byte
counts, source and receiving paths, and the unchanged-source observation made
while holding the original copy lock. Customer checks include the saved definition hash, original manifest
and XLSX hashes, all data rows, source history, exact sales text, and the original
and newly rendered workbook content projections.

The new workbook's delivery ID and archive bytes can differ from the earlier
delivery. The saved definition, source bindings and all projected data cells
must match. Original delivery files retain their own exact hashes.

Keep result.json and the complete customer artifacts in their existing private
receiving surface. Source publication contains the driver, engine and operating
guides.


## Reserved failure output for temporary execution storage

When the runtime allocation belongs to one execution namespace, select a separate
private directory for command diagnostics before admission. This optional plan
section keeps exact failure bytes available to the owning operator:

```json
{
  "diagnostics": {
    "directory": "/srv/starforge/private-record/results/diagnostics",
    "record": "/srv/starforge/private-record/command-diagnostics.dat",
    "state_record": "/srv/starforge/private-record/control-state.dat",
    "log_directory": "/srv/starforge/private-record/engine-logs",
    "log_limit_bytes": 262144
  }
}
```

The native driver passes the selected log directory and byte limit to the original
engine. The engine's usual destination remains its runtime's logs directory when
this option is omitted.

Prepare the selected shared files before the native operation begins. On Linux,
reserve each log's backing storage with fallocate in KEEP_SIZE mode: its logical
length stays zero while the requested blocks are allocated. Create twelve
private regular files named .reserve-00 through .reserve-11 in engine-logs, with
262,144 allocated bytes each. The engine atomically assigns those files to the
actual original stage names as each stage starts. The current source uses
python, create-environment, dependency-check, build-original, installed-source,
and resolve-/install- followed by the original builder or cohort identity.
Repeated stages append within their original file.

Create command-diagnostics.dat as a private regular file with 4,194,304 physically
allocated bytes and control-state.dat with 524,288 physically allocated bytes.
Use os.posix_fallocate on their open file descriptors and fsync the files and
their containing directory. The driver checks ownership, permissions, regular
file type, link count, and actual allocated blocks before writing a reserved
record. Include these shared bytes in the original resource declaration and
leave each record's file size intact. Reading a committed record retains the
private-file, slot, sequence, length and checksum checks, while permitting sparse
backing when an execution transport has preserved its exact logical bytes.
Unused zero padding does not need allocated blocks for that read; a later write
still requires the full original allocation.

| Output | Retained behavior |
| --- | --- |
| Original engine log | Child bytes are written and synced from process start into the reserved stage file. |
| Captured command stdout | The engine permits up to its explicit 8 MiB JSON capture limit. |
| Stage log limit | Each selected stage file stays within log_limit_bytes. A real excess ends the child and reports observed/written counts and truncation. |
| Command diagnostic record | A nonzero command exit commits a ZIP containing its exact stdout, stderr, engine progress, selected original stage log, and member hashes. |
| Reserved control record | The owning worker can maintain compact progress/results with the same exported record helpers; the native session's control mirror uses this file. |

The record format contains two checksummed slots. A writer syncs a new payload
before publishing its header, leaving the previous valid slot available during
an interrupted update. Native operators can read the latest committed payload
through read_reserved_record(path) from native_receiving.py; it returns a
(sequence, payload_bytes) pair, or None before the first commit. The command
diagnostic payload is the complete ZIP. Its failure receipt supplies the record
path, sequence, payload byte count, payload SHA256 and manifest SHA256. Extract
only that verified payload when opening it as a ZIP; the surrounding reserved
file intentionally keeps unused allocated space.

For an ordinary persistent output directory, diagnostics.directory alone remains
available: a failed command creates a private ZIP and JSON receipt there.
The reserved record is the appropriate choice when the shared filesystem may
fill while the original operation runs.

Read a saved stage log or the verified diagnostic payload to identify the exact
resolver error. Preserve the original native command's observed exit and its
request when continuing; a missing terminal observation is retained as missing.
A failed pre-customer resolver does not require republishing the unchanged
source archive or customer input merely to preserve its small error record.

## Offline receiving as an operator

The engine's portable cohort includes the original Python source descriptor,
the application wheel containing the selected package files, all selected runtime
wheels and the lock used for verification. The full original source and Node
bridge closure travel through their existing distribution archive. On an equipped
receiving host, use the original source runtime and the selected interpreter:

    /absolute/selected/python3 engine.py \
      --root /srv/starforge/receiving/source-offline/python-runtime \
      receive --archive /srv/starforge/python-workbooks.bundle.zip

    /absolute/selected/python3 engine.py \
      --root /srv/starforge/receiving/source-offline/python-runtime \
      install --candidate CANDIDATE_ID --python /absolute/selected/python3

    /absolute/selected/python3 engine.py \
      --root /srv/starforge/receiving/source-offline/python-runtime \
      activate --installation INSTALLATION_ID

Use the returned lexical installation.python path for the customer application.
The installed original workbook command can receive the complete saved output:

    /absolute/private/venv/bin/stellar-forge-workbook receive \
      --archive /srv/starforge/customer/handoff.zip \
      --destination /srv/starforge/customer/received \
      --sha256 ORIGINAL_HANDOFF_SHA256

    /absolute/private/venv/bin/stellar-forge-workbook inspect \
      --delivery /srv/starforge/customer/received \
      --manifest-sha256 ORIGINAL_MANIFEST_SHA256

The complete workbook handoff reopens independently through WorkbookDelivery.
To reopen the full SQL/Analysis application, select the private received
customer database and the received full original source:

    /absolute/private/venv/bin/python -m stellar_forge_buyer.analysis_workspace \
      --database /srv/starforge/receiving/journey/customer/database \
      --checkout /srv/starforge/source-runtime/package/source \
      --node /absolute/selected/node \
      status

    /absolute/private/venv/bin/python -m stellar_forge_buyer.analysis_workspace \
      --database /srv/starforge/receiving/journey/customer/database \
      --checkout /srv/starforge/source-runtime/package/source \
      --node /absolute/selected/node \
      serve --port 0

The server prints its public loopback address and private_launch filename.
Open the private launch record using the existing operator application. The
runtime workspace's Python selection supplies this same interpreter to its
original Analysis launcher.

## Upgrade with an actual new source release

Receive the newer original source through the maintained source installer.
Resolve its Python project with the new source commit and manifest digest,
install its candidate in the same private engine root, and activate with the
currently selected installation ID:

    /absolute/selected/python3 engine.py \
      --root /srv/starforge/python-primary \
      resolve --python /absolute/selected/python3 \
      --source /srv/starforge/source-runtime-new/package/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python \
      --extras workbooks,agents \
      --release-id NEW_SOURCE_COMMIT \
      --release-digest NEW_SOURCE_MANIFEST_SHA256

    /absolute/selected/python3 engine.py \
      --root /srv/starforge/python-primary \
      install --candidate NEW_CANDIDATE_ID --python /absolute/selected/python3

    /absolute/selected/python3 engine.py \
      --root /srv/starforge/python-primary \
      activate --installation NEW_INSTALLATION_ID \
      --expected-installation PREVIOUS_INSTALLATION_ID

The native plan accepts an optional upgrade object with the same shape as
source. It requires a different actual source commit, uses this guarded
activation, and reopens the known customer output through the newly installed
original application. The earlier cohort and environment remain available to
the existing rollback workflow.


## Receive a separately resolved public wheel cohort

A receiver can select an exact cohort produced by the same wheel engine on an equipped public-source host. Add this optional object to the private receiving plan:

```json
{
  "primary_cohort": {
    "archive": "/absolute/received/python-cohort.zip",
    "sha256": "<complete archive SHA-256>",
    "candidate": "<original candidate SHA-256 identity>",
    "lock_sha256": "<original lock.json SHA-256>"
  }
}
```

The public producer uses the selected source edition, its original source manifest and the unchanged requested extras. It runs the maintained engine's `resolve`, `inspect --candidate` and `bundle` commands. Retain its real Python descriptor, complete lock, original source descriptor, wheel hashes, wheel bytes, expanded bytes, stdout, stderr and stage logs. A Python patch-version difference is supported only where the engine's original implementation, major/minor, platform, machine and cache-tag comparison matches; installation still enforces that comparison.

The maintained `run-public-cohort.sh` is a complete producer for its pinned
source, interpreter and extras. Use its matching published `engine.py`; the
wrapper checks that engine's SHA-256 before starting. Its wheel reader selects
the wheel's one top-level `*.dist-info/METADATA` file. Metadata retained inside
vendored packages remains part of the original wheel bytes and does not change
that wheel's owning package identity.

Run the wrapper inside the selected host's original admitted operation:

```bash
COHORT_DISK_LIMIT_BYTES=268435456 \
COHORT_DISK_RESERVE_BYTES=33554432 \
bash /absolute/run-public-cohort.sh \
  /absolute/private-public-cohort \
  /absolute/engine.py \
  /absolute/selected-source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python \
  /absolute/python3.12
```

The two capacity variables are optional as a pair. Set them to the original
operation's actual disk declaration and reserve. They do not change admission.
After resolution and inspection, the wrapper measures physical allocation and
the returned `wheelBytes` before writing the portable bundle. It retains
`attempt-*/capacity.json` with the measured values, adds one wheel-sized archive
plus 16 MiB for metadata and diagnostics, and checks both the declared limit and
the filesystem's available bytes. Exit 75 retains the original candidate and
capacity report when that publication needs more space. Select an explicit
continuation with sufficient capacity to publish it; the existing source,
candidate and lock remain the same. The example values describe this source-only
producer, and do not replace the full receiving workflow's measured wheel,
installed-environment, customer and offline expansion requirements.

Each actual engine phase has its own JSON result, stderr and progress record
under the unique `attempt-*` directory. The original full stage logs stay under
`runtime/logs`. Successful stdout contains the exact source and candidate,
resolver Python, package hashes, wheel and expanded bytes, and portable archive
hash. Retain those actual outputs before a temporary execution mount ends.

### Retain public output from the same temporary foreground

When the host uses an execution-local temporary mount, the optional
`public-cohort-foreground.py` wrapper keeps resolution, bundling and saved output
inside that one original admitted workload. Its private plan uses schema
`stellar-forge.public-cohort-plan.v1` and the following fields:

| Field | Selection |
| --- | --- |
| `operation_id` | The exact public producer operation named in the shell wrapper. |
| `native_operation_id`, `capacity_request` | The original controller operation ID and its retained request JSON. |
| `directory` | The private temporary output root owned by this foreground. |
| `control` | A separately retained private directory for compact outcome and save progress. |
| `engine`, `wrapper`, `python` | Absolute paths to the pinned engine, shell wrapper and selected interpreter. |
| `source.directory`, `source.id`, `source.files` | The exact original project directory, source identity and complete 40-file inventory. Each file row has `path`, `bytes` and `sha256`. |
| `limits.disk_bytes`, `limits.reserve_bytes` | The actual original disk declaration and reserve, passed to the shell wrapper. |
| `library.session`, `library.helpers` | The existing pinned connected-file workflow module and its unchanged helper directory. |

Run `python3.12 public-cohort-foreground.py --plan /absolute/public-plan.json`
as that controller's workload. The helper validates the original source and
module hashes before starting. The selected output root, disk bytes and reserve
must match the retained controller request exactly; the compact result retains
that request's SHA-256 and original capacity values. It forwards a stop to its own process group,
waits for that group's exit, and preserves the observed child outcome. It never
releases or edits another operation's admission.

The compact `producer-result.json` is written to shared control before archive
creation or transfer. It includes the wrapper's stdout and stderr and, when an
engine phase fails, the original attempt's stdout, stderr, progress and selected
stage log. Each retained tail identifies the full original byte count and hash
and explicitly flags a shortened tail. The engine error is therefore readable
from shared control before the complete archive transfer. The full logs,
phase results and original stderr are retained in
`public-cohort-diagnostics.zip`. On success, the unchanged portable cohort and
that diagnostic ZIP are saved as separate files through the existing connected
workflow. Keep the foreground alive while its correlated requests under
`control/library-calls/` are completed by that existing connection.

Completion requires one successful saved-file result for each exact selected
path and its returned file identities. Full response details stay in private
`custody.json`; terminal stdout contains only the observed producer state,
custody paths, diagnostic identity and saved file IDs, names and sizes. The
native operation can then finish without relying on the temporary mount to
survive another execution session.

The receiver hashes the selected archive before work, checks the exact candidate and lock identities, and measures the pending expansion against its original disk, inode and memory declaration before extraction. It then uses the original `receive` command. Under the same engine lease, it invokes the engine's maintained source-snapshot and candidate validation functions against the actual selected local source project. The whole source descriptor must match: all source file bytes, project metadata, entrypoints, build requirements, optional dependency declarations and edition pins. This prevents an archive's source label from substituting for the actual selected source. The ordinary retained candidate inspection and installation follow; no online resolution occurs on this path.

The final receiving result includes `received_primary_cohort` with the four selected transfer fields. The subsequent customer operation and fresh offline receiving remain the same workflow. A newer source upgrade continues to resolve its own source cohort.

Keep an existing queued native request and any observed command result intact. Once the exact public cohort is available, select it in an explicit linked receiving continuation through the original supervisor workflow. Record the prior request/result or pre-dispatch transition, new plan identity and actual cohort hashes. The cohort contains public source and wheels; customer databases, private launch controls and customer output remain in their authorized local receiving workspace.
