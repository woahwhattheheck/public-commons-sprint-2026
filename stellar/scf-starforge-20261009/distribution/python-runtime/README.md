# Python customer runtime receiving

The Python runtime component installs the original Stellar Forge customer package
and its selected extras into an isolated environment attached to the existing
runtime workspace. A received environment supplies the actual interpreter used
by AnalysisWorkspace and the original buyer, agent and workbook commands.

The original source package currently declares `stellar-forge-buyer 0.5.0`,
Python 3.11 or newer, the `setuptools.build_meta` backend, and the optional
`workbooks` and `agents` dependency groups. Workbooks selects
`openpyxl==3.1.5`. The engine reads those declarations from the selected original
`pyproject.toml`; source and wheel hashes distinguish successive application
editions even when the package version stays the same.

## Select and install an environment

Use the complete received source root reported by the original runtime installer.
The Python project is its
`stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python` subdirectory.
The source commit and source-manifest digest below come from that same installed
release. Select an executable Python 3.11+ with pip 23+ for provisioning.

```bash
python3 distribution/python-runtime/engine.py --root /private/runtime/python-runtime resolve \
  --python /absolute/path/to/python3 \
  --source /selected/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python \
  --release-id SELECTED_SOURCE_COMMIT \
  --release-digest SELECTED_SOURCE_MANIFEST_SHA256 \
  --extras workbooks

python3 distribution/python-runtime/engine.py --root /private/runtime/python-runtime install \
  --candidate CANDIDATE_SHA256 --python /absolute/path/to/python3

python3 distribution/python-runtime/engine.py --root /private/runtime/python-runtime activate \
  --installation INSTALLATION_SHA256
```

Resolution retains the original package source and declared build requirements,
resolves an exact binary wheel closure for the selected interpreter and platform,
and builds the original source wheel through that retained build environment.
Source upgrades reuse the same matching build-tool environment. Every original
package member is compared with the built wheel.

Installation uses the retained wheels with the package manager's offline,
hash-required mode in a private virtual environment. It then checks dependencies,
the complete installed package inventory, original source files, console scripts
and Analysis/workbook modules. The returned installation manifest contains the
lexical virtual-environment Python path, original command targets and script
hashes, selected extras, source identity and wheel lock.

Preserve that lexical executable path: resolving its symlink to the base Python
would select a different environment. The source root passed to Analysis remains
the full original runtime root containing `stellar/`.

## Transfer and reopen

```bash
python3 distribution/python-runtime/engine.py --root /private/runtime/python-runtime bundle \
  --candidate CANDIDATE_SHA256 --output /private/transfer/python-workbooks.zip

python3 distribution/python-runtime/engine.py --root /receiving/runtime/python-runtime receive \
  --archive /private/transfer/python-workbooks.zip

python3 distribution/python-runtime/engine.py --root /receiving/runtime/python-runtime install \
  --candidate CANDIDATE_SHA256 --python /absolute/path/to/receiving-python3
```

The separate `stellar-forge.python-runtime-transfer.v1` cohort contains its
complete source-bound lock, exact requirements file and all application and
dependency wheels. Receiving verifies the full archive inventory and each member,
retains completed members across interruptions, and publishes the lock last.
The receiving interpreter must match the cohort's implementation, major/minor,
platform, machine and ABI tag. Resolve a cohort for another platform on an
appropriate selected interpreter before transferring it.

The original Node source and native dependencies travel through the existing
runtime installer and BC08 transfer component. Each Python receipt remains bound
to that original source/archive/profile selection. Customer databases, operator
settings and existing application sessions are opened through their original
application receiving workflows.

## Original applications and source upgrades

The installation manifest exposes the original console scripts in
`entrypoints`, with `target`, `path` and `sha256` per script. It also names
`stellar_forge_buyer.analysis_workspace`,
`stellar_forge_buyer.analysis_workbooks`, and
`stellar_forge_buyer.workbook_client` in `modules`. The existing Applications
runner consumes that source-bound descriptor and supplies the full matching
checkout to the original command.

Select another source release or extras set to create a distinct candidate and
installation. The existing environment stays available for sessions that already
selected it. Activation uses an atomic pointer; pass
`--expected-installation PREVIOUS_ID` to require the inspected prior selection.
Use an empty expected identifier to require that no environment is active yet.
Reactivating the same environment returns the original activation record.

## Runtime workspace integration and recovery

The original runtime workspace remains the operation owner. Its adapter passes
the existing worker lease as `--lease-fd 3` and a private per-operation
`--progress-file`. Every package-manager and environment child inherits that
lease together with the engine's runtime-directory lock. The engine writes its
final successful result to the progress file before emitting stdout, so the same
workspace request can recover completion after its caller disconnects.

Replaying a completed bundle verifies and returns the original archive.
Resolve, install and receive reuse the original candidate and complete bytes.
`inspect` lists candidates, installations and the active selection; use
`--candidate ID` or `--installation ID` to inspect a particular retained
environment. Stage logs and progress remain in the private runtime directory.

The engine's use of pip's supported installation report and selected-interpreter
interface follows the primary documentation:
[installation reports](https://pip.pypa.io/en/stable/reference/installation-report/),
[managing another interpreter](https://pip.pypa.io/en/stable/topics/python-option/),
and [pip install](https://pip.pypa.io/en/stable/cli/pip_install/).

## Evidence synthesis in the same Python installation

Select the source-declared `synthesis` extra to install
`statsmodels==0.15.0` and `matplotlib==3.10.8` with their actual wheel
dependencies. The original resolver retains the interpreter-specific wheels,
full source, requirements and lock. The resulting installation names
`stellar_forge_buyer.synthesis_cli` as its `synthesis` application module
and exposes the `stellar-forge-synthesis` console entrypoint. The Applications
command binding checks that same installed module or script, source identity,
selected extra and database path.

Use the original resolve/install/activate procedure above with
`--extras synthesis`; combine it with other original extras when the same
customer environment needs them. A synthesis protocol and its results remain
in the original Analysis SQLite database. The complete publication JSON,
frozen descriptor projection, saved protocol, statistical result and generated
reports are retained there as database records and BLOBs.

```bash
/selected/installation/bin/python -m stellar_forge_buyer.synthesis_cli engine

/selected/installation/bin/stellar-forge-synthesis \
  --database /private/customer/analysis \
  --checkout /selected/complete-source \
  import-publication --request /private/requests/publication.json \
  --source /private/research/accepted-publication.json

/selected/installation/bin/stellar-forge-synthesis \
  --database /private/customer/analysis \
  save-protocol --request /private/requests/protocol.json

/selected/installation/bin/stellar-forge-synthesis \
  --database /private/customer/analysis \
  review --name bcg-primary --revision 1

/selected/installation/bin/stellar-forge-synthesis \
  --database /private/customer/analysis \
  run --request /private/requests/run.json

/selected/installation/bin/stellar-forge-synthesis \
  --database /private/customer/analysis \
  receive --id ORIGINAL_32_CHARACTER_RUN_ID --output /private/delivery/bcg
```

The import request contains the original `id`, name, expected revision,
complete source SHA256, source context, results pointer and optional descriptor
pointer. `--source` supplies the unchanged original bytes and must match that
request's SHA256; an already prepared request may instead contain `raw_text`.
The protocol request selects one exact publication name/revision/SHA256 and
the full reviewed definition. The run request is precisely
`{id, protocol_name, protocol_revision, protocol_sha256}`. Preserve those
request files and IDs when continuing after an interrupted response.

Native `run` opens the original Analysis owner, waits for its actual
background job, and closes only after the job drains. SIGINT or SIGTERM requests
cancellation of that same job and waits for the original owner to finish. An
explicit repeat of the same run request reuses a completed result or resumes
that original interrupted job; changing the selected protocol under its ID is
rejected by the existing job store.

When the private Analysis app is already open, add `--live` to borrow its
current launch and capability. Mutations also require `--operation`, a
private retained SDK request directory:

```bash
/selected/installation/bin/stellar-forge-synthesis \
  --database /private/customer/analysis --live \
  --operation /private/operations/bcg-run \
  run --request /private/requests/run.json

/selected/installation/bin/stellar-forge-synthesis \
  --database /private/customer/analysis --live \
  --operation /private/operations/bcg-run resume

/selected/installation/bin/stellar-forge-synthesis \
  --database /private/customer/analysis --live \
  cancel --id ORIGINAL_32_CHARACTER_RUN_ID
```

Live `--wait-seconds` controls how long the caller waits before returning the
same retained RUNNING job; the original app continues to own it. `resume`
reconciles the original SDK request and returns its current native postimage.
Read the same job/result or use `receive` to finish its delivery. A changed
port on app reopen is resolved from the original private launch record, while
the retained workspace identity continues to bind the request.

`history`, `publication`, `protocol`, `review`, `job`, `result` and
`source` expose the same original saved editions and complete source.
History uses `--before` cursors; publication rows use a fixed
`--revision` plus `--offset`. The receiver verifies every file's complete
byte count and SHA256, retains an interrupted partial under its original
identity, and publishes complete files without replacing different local
content. It stores the selected run and complete delivery receipt alongside
the files.

Use the existing Analysis workspace archive/export and receiving commands for
portable customer databases. All synthesis source, protocols, jobs and report
BLOBs travel in the original database snapshot; reopen through the same
AnalysisWorkspace and receive the same result files. The separate report ZIP
contains the complete selected publication, protocol, statistical data and
figures for delivery. It does not replace the original customer's database
backup.

The statistical methods and protocol fields are documented in the Python
package's maintained [SYNTHESIS_OPERATOR.md](../../sf88-operator-buyer-cli/SYNTHESIS_OPERATOR.md) guide. Dependency declarations follow
the selected `pyproject.toml` and
[statsmodels' published release](https://pypi.org/project/statsmodels/0.15.0/).
