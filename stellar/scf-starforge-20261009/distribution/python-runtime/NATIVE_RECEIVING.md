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

The second environment receives the exact wheel bundle offline, installs the
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
      "operation_id": "scf-python-workbooks-7de2-r2",
      "engine": "/srv/starforge/toolkit/stellar/scf-starforge-20261009/distribution/python-runtime/engine.py",
      "engine_sha256": "ENGINE_SHA256",
      "python": "/absolute/selected/python3",
      "node": "/absolute/selected/node",
      "output": "/srv/starforge/private/python-receiving-r2",
      "extras": ["workbooks", "agents"],
      "source": {
        "installer_module": "/absolute/toolkit/stellar/scf-starforge-20261009/distribution/runtime-install.mjs",
        "installer_sha256": "INSTALLER_SHA256",
        "installation_directory": "/srv/starforge/source-runtime",
        "root": "/srv/starforge/source-runtime/package/source",
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
add these fields inside source:

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

Use a new installation_directory when preparing another original source
archive. The full source release and Python cohort remain separate retained
objects with their own identities.


## Receive the complete closed customer package

The actual revision-2 transfer preserves the customer's complete directory under
its existing Analysis lock. Its private transfer archive contains all 51 database
and application files (751,347 bytes), plus the unchanged original workbook
handoff and handoff manifest. It preserves the three typed query cohorts, report
sources, both workbook revisions and every saved producer path.

To receive that package on another host within this same run, add the following
selection inside customer:

    "directory_transfer": {
      "archive": "/srv/starforge/incoming/scf-7de2-customer-revision-2.zip",
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
- python-primary/: the original resolved cohort and private installation.
- python-offline/: the independently received cohort and private installation.
- python-workbooks.bundle.zip: the exact portable wheel cohort.
- customer/database/: the private complete customer directory used by both
  installed interpreters.
- customer/: authenticated original downloads, original received workbook, and
  the single newly rendered workbook from the saved definition.
- result.json: the complete joined receiving outcome.

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

## Offline receiving as an operator

The engine's portable cohort includes the original Python source descriptor,
the application wheel containing the selected package files, all selected runtime
wheels and the lock used for verification. The full original source and Node
bridge closure travel through their existing distribution archive. On an equipped
receiving host, use the original source runtime and the selected interpreter:

    /absolute/selected/python3 engine.py \
      --root /srv/starforge/python-offline \
      receive --archive /srv/starforge/python-workbooks.bundle.zip

    /absolute/selected/python3 engine.py \
      --root /srv/starforge/python-offline \
      install --candidate CANDIDATE_ID --python /absolute/selected/python3

    /absolute/selected/python3 engine.py \
      --root /srv/starforge/python-offline \
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
      --database /srv/starforge/private/python-receiving-r2/customer/database \
      --checkout /srv/starforge/source-runtime/package/source \
      --node /absolute/selected/node \
      status

    /absolute/private/venv/bin/python -m stellar_forge_buyer.analysis_workspace \
      --database /srv/starforge/private/python-receiving-r2/customer/database \
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
