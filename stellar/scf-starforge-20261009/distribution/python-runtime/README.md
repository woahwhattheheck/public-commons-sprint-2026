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
