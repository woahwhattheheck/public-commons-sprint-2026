# Python tools in the original runtime workspace

The Python pane adds the original buyer, Analysis and workbook package to a selected merchant runtime. It keeps the merchant archive, source manifest and Node profile attached to every Python selection. The wheel receiver uses the Python cohort schema defined by engine.py; the existing Node Offline transfers format is unchanged.

## Open and select

Start the existing workspace command and open its private URL:

    starforge runtime-workspace serve --workspace /srv/starforge/operator --port 8465

Open an original merchant runtime from the sidebar, then choose **Python & workbooks**. The selected source must include:

    stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/pyproject.toml

The source declaration owns the package version, build backend, scripts and optional extras. The current original package is stellar-forge-buyer 0.5.0. Its workbook extra declares openpyxl==3.1.5. A changed source release may retain that package version: source and wheel hashes distinguish the installed code.

Enter the exact Python executable on the operator host and select the original extras. **Review source and interpreter** reads the actual executable, environment prefix, Python version, pip version and original pyproject. **Resolve and retain exact wheels** uses that reviewed selection through the existing workspace worker.

Resolution records the original project, exact build closure, dependency wheels and resulting original package wheel. **Install offline** creates a private virtual environment using the selected candidate. Installation readiness comes from the original engine's installed-interpreter checks. Base receiving commands remain available without the workbook-building extra.

Each environment has a content-bound installation ID. **Select this environment** atomically changes the current Python selection using the observed previous installation ID. Selecting an older retained environment uses the same control. Existing Applications records retain their particular environment until explicitly reopened with another selection.

## Original source and interpreter identity

Every Python operation retains:

| Field | Meaning |
| --- | --- |
| runtimeId and directory | The original runtime workspace entry and physical runtime directory |
| installationId | The original merchant installation identity |
| archiveSha256 | Exact original merchant source archive |
| sourceCommit and sourceManifestSha256 | Selected complete original source release |
| profileId and profileSha256 | Original Node/runtime profile kept with this source |
| candidateId | Retained original source, build and wheel candidate |
| Python installation ID | The installed interpreter, wheel lock, original source and installed package receipt |
| python | The lexical virtual-environment executable used for customer commands |
| lockSha256 and source.id | Exact wheel/source identities from the Python engine |

The Python cohort lives at RUNTIME_DIRECTORY/python-runtime. Environments and candidates remain there when the browser closes. A source upgrade uses the original runtime workspace's new runtime directory; the prior directory and Python environment remain available.

A virtual environment's bin/python can be a symlink. The command handoff preserves that lexical path. Resolving it to the base interpreter would bypass pyvenv.cfg and select a different dependency environment.

## Receive or export the exact wheel cohort

Select **Export wheel bundle** beside a retained candidate. The original worker creates the complete Python ZIP. Its operation card provides the original SHA-256, bytes and download. The download reopens the retained ZIP and checks it against the saved digest before streaming its bytes.

On the receiving host:

1. Open the matching original merchant runtime.
2. Select a compatible local Python executable.
3. Choose the ZIP or its existing absolute path and enter the original SHA-256.
4. Use **Receive and verify bundle**.
5. Review the candidate's original extras for the receiving interpreter and install offline.

The server streams uploaded bytes into a private content-addressed file. A repeated complete upload reuses the same verified file. A failed upload retains no complete file; reselect the same original bundle to continue receiving. The maximum archive size is 2 GiB. No browser-side whole-file memory copy is needed to send it.

Receiving a candidate preserves its original release identity. Installing or activating it against another merchant source release is rejected before that installation or activation executes. The receiving runtime profile remains frozen in the original operation. The matching original merchant archive can be opened as its own runtime.

Node source/profile/npm tarballs continue through the existing Offline transfers pane. The Python ZIP travels as its explicit companion.

## Work, interruption and recovery

All six Python actions are original runtime workspace operations:

| Operation | Retained input |
| --- | --- |
| python-resolve | runtimeId and reviewed interpreter/extras selection |
| python-install | runtimeId, candidateId and receiving-interpreter review |
| python-inspect | runtimeId, Python executable and optional candidate or installation ID |
| python-bundle | runtimeId, candidateId and Python executable |
| python-receive | runtimeId, original archive SHA/path and Python executable |
| python-activate | runtimeId, installation ID, observed previous ID or null, and Python executable |

The original detached worker owns admission, request identity and process custody. It passes its held kernel lease as FD3 to the engine and every child. The engine also owns its Python-root lock. Closing the browser or HTTP server leaves that original work running.

Per-operation files include the frozen request, retained engine source, original private worker log, per-attempt progress/stdout/exit files, and the final source-bound result. A later helper source update does not replace an already retained operation's engine bytes.

**Continue this operation** first acquires the original worker lease. If the original engine completed before its worker ended, it adopts the saved complete result. Otherwise it appends the prior attempt to the retained history and queues the same immutable request. The ordinary workspace worker performs the continuation. The progress poll is drained before the final operation state is written.

An incomplete transfer or install is resumed from the engine's original candidate/environment state. Errors and the current stage appear in both Python operations and the common Operations view. The existing worker log contains the original private stage output.

## Existing command line

Use the existing runtime-workspace entrypoint:

    starforge runtime-workspace python-status \
      --workspace /srv/starforge/operator \
      --runtime-id ORIGINAL_RUNTIME_ID

    starforge runtime-workspace python-review \
      --workspace /srv/starforge/operator \
      --runtime-id ORIGINAL_RUNTIME_ID \
      --python /usr/bin/python3 \
      --extras workbooks

Use --extras base for the original standard-library tools, or the declared workbooks,agents selection when both are needed. The returned reviewId identifies the exact source and interpreter selection.

Write a private request file with a fresh UUID:

    {
      "requestId": "11111111-1111-4111-a111-111111111111",
      "operation": "python-resolve",
      "runtimeId": "ORIGINAL_24_HEX_RUNTIME_ID",
      "reviewId": "RETURNED_24_HEX_REVIEW_ID"
    }

Dispatch through the original worker:

    starforge runtime-workspace python-operation \
      --workspace /srv/starforge/operator \
      --request /srv/starforge/requests/python-resolve.json

Continue that same operation with its retained UUID:

    starforge runtime-workspace python-continue \
      --workspace /srv/starforge/operator \
      --operation-id ORIGINAL_OPERATION_UUID

Reuse the original request UUID after an uncertain submission. A different body under an existing UUID is rejected. Resubmitting a completed request returns its retained operation; use python-continue for an interrupted or failed original attempt.

For installation, use operation python-install with runtimeId, candidateId and reviewId. For inspection, use python-inspect with runtimeId and python, optionally candidateId or installationId. For bundle export, use python-bundle with runtimeId, candidateId and python. The resulting operation record contains its exact local ZIP path and SHA-256.

For receiving, use python-receive with runtimeId, archive, sha256 and python. For activation, use python-activate with runtimeId, installationId, expectedInstallationId and python. expectedInstallationId is null only when no environment is currently selected.

## Analysis and workbook use

The selected wheel contains the original Python package. Analysis also calls the original Node bridges and browser components in the matching complete merchant sourceRoot.

The original Analysis invocation is:

    VENV_PYTHON -m stellar_forge_buyer.analysis_workspace \
      --database /srv/starforge/customer/analysis \
      --checkout ORIGINAL_SOURCE_ROOT \
      --node SELECTED_NODE \
      serve --port 0

Its ready JSON reports status LISTENING, an address without the authorization fragment, and private_launch. The exact private file is:

    ANALYSIS_DATABASE_DIRECTORY/analysis-launch.json

It contains schema stellar-forge.customer-analysis.v1, workspace_id, the private url, and the native process pid. The original Applications observer opens this exact file after matching the selected database and current child. Its plain address alone does not contain the browser authorization.

The complete original source supports SQL, source/view/query management, workbook-source selection, saved recurring workbook previews and refresh review through its existing database and HTTP operations. This extension supplies the interpreter and source; those workflows retain their original data/review engines.

Original workbook examples:

    VENV_PYTHON -m stellar_forge_buyer.workbook_client \
      --database /srv/starforge/customer/analysis \
      --recipe /srv/starforge/customer/recipe.json \
      --operation /srv/starforge/customer/delivery

    VENV_PYTHON -m stellar_forge_buyer.analysis_workbooks receive \
      --archive /srv/starforge/transfers/workbook.zip \
      --sha256 ORIGINAL_ARCHIVE_SHA256 \
      --destination /srv/starforge/customer/received-workbook

    VENV_PYTHON -m stellar_forge_buyer.analysis_workbooks inspect \
      --delivery /srv/starforge/customer/received-workbook \
      --manifest-sha256 ORIGINAL_MANIFEST_SHA256

    VENV_PYTHON -m stellar_forge_buyer.analysis_workbooks copy \
      --delivery /srv/starforge/customer/received-workbook \
      --destination /srv/starforge/customer/workbook-copy

Receive, inspect and copy use the original standard-library receiving path. Workbook building uses the selected workbooks extra. Original scripts also remain declared in the installation's entrypoints: stellar-forge-buyer, stellar-forge-agent, stellar-forge-workbook and stellar-forge-workbook-deliver.

## Applications integration

The pane's **Original commands** creates a source-bound command descriptor. The existing Applications owner consumes it through the original managed-run lifecycle.

The API is:

    bindPythonApplicationCommand(root, {
      runtimeId, runtimeDirectory, installationId,
      command, args, leaseFd
    })

Supported command IDs are analysis, workbooks, workbookDelivery, and the four declared console-script names above. The result retains executable, argv, cwd, runtime binding, installation/source/lock IDs, original script hash or declared module, required extras, readiness metadata and a fingerprint.

    preparePythonApplicationCommand(root, descriptor, {leaseFd})

The launch helper reopens that exact installed interpreter and source, verifies the descriptor, and returns executable, args, cwd and binding. Applications keeps its original independent launch receipt, environment, terminal, PID/group/session tracking, output observer, stop and reopening behavior. terminalPython continues to select only the existing standard-library PTY helper.

A command handoff can also be prepared from a private original argv file:

    starforge runtime-workspace python-command \
      --workspace /srv/starforge/operator \
      --runtime-id ORIGINAL_RUNTIME_ID \
      --installation-id PYTHON_INSTALLATION_SHA256 \
      --command analysis \
      --args /srv/starforge/requests/analysis-arguments.json

This command emits the descriptor; the original Applications worker executes the selected customer command. The runtime deployment handoff includes the selected Python environment beside the original merchant roots.

## Source integration

New modules:

- python-runtime/engine.py: original source/build/wheel/environment authority.
- python-runtime/workspace.mjs: existing operation and receiving adapter.
- python-runtime/command-binding.mjs: exact original customer command binding.
- runtime-workspace/public/python.mjs: the shared grayscale operator pane.

Serial hooks extend the current model, HTTP server, CLI and browser shell. Existing Node transfer and managed Applications implementations remain in their original files. The adapter uses runtime-workspace/storage.mjs for private durable records and its original worker lease.

The shared-file changes are additive to the original runtime workspace. Their Git diff preserves the existing installer, transfer, operations and Applications integration points so the original owners can compose concurrent changes on the same branch.

Original source:
https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/1d22a89144b9903e63b3c2eabb0297a19852d036/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python

Original installer:
https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/1d22a89144b9903e63b3c2eabb0297a19852d036/stellar/scf-starforge-20261009/distribution/runtime-install.mjs
