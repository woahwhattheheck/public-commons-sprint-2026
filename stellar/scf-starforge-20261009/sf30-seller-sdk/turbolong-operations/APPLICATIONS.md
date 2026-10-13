# Turbolong operations in Applications

The **Turbolong operations** entry in the maintained Applications workspace launches the same complete application as `stellar-turbolong-operations serve`. It retains the workspace identity, private configuration selections, native runtime manifest and process startup receipt across reopen.

[README.md](README.md) covers the complete operating workflow. [OPERATING_DATA.md](OPERATING_DATA.md) covers provider coverage and report interpretation. [RUNTIME.md](RUNTIME.md) covers the selected original source, native build and process custody.

## Build and install the selected product

Use the complete repository and its existing distribution builder:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --ref HEAD \
  --selection turbolong-operations \
  --out /absolute/private/turbolong-operations-package
~~~

Install the resulting source-selected archive through the maintained runtime installation workflow. Preserve its source commit, full source manifest and archive. The selection exposes all three entrypoints:

| Executable | Purpose |
| --- | --- |
| stellar-turbolong-operations | Complete operator, native runtime, source/report and receiving CLI. |
| starforge | Maintained dispatcher with the selected application and installation commands. |
| starforge-merchant | The same dispatcher under the merchant alias. |

The direct command and dispatcher select identical application source:

~~~sh
stellar-turbolong-operations serve --workspace /absolute/private/turbolong
starforge stellar-turbolong-operations serve --workspace /absolute/private/turbolong
starforge-merchant stellar-turbolong-operations serve --workspace /absolute/private/turbolong
~~~

The contribution supplies the command, module exports, Applications provider and browser asset map. Both the contribution and selection explicitly retain the entire product cohort, guides, examples, ordinary commissioning programmes, dynamically read distribution metadata and maintained dependency files. The browser SHA256 implementation is the existing source helper, included through its original path.

The application source manifest selects every complete file by repository-relative path, byte count, SHA256 and executable mode. It is regenerated against the exact adopted repository source; newer maintained dependencies are preserved when this product is installed in another repository.

## Prepare the actual original runtime

The selected publisher source is Dgetsylver/TurboLong at `f017de605bb020bf3d7f4285aae4c654508e8d86`. Provide the complete customer installation or its private original source capsule. No publisher source is fetched implicitly from a guessed branch.

~~~sh
stellar-turbolong-operations runtime-build \
  --installation-directory /absolute/private/turbolong-source \
  --source-capsule-file /absolute/private/turbolong-original-source.json \
  --runtime-directory /absolute/private/turbolong-runtime \
  --node-heap-mb 512 \
  --cargo-jobs 1
~~~

The runtime module executes the selected source's own build commands. Original source, package manifests and lockfiles, generated locks where the publisher supplied none, installed dependency graphs, tools, compiled artifacts and command receipts are retained together. Keep the build directory and its receipts so the same operation can recover completed stages.

To retain an existing complete installation:

~~~sh
stellar-turbolong-operations runtime-retain \
  --installation-directory /absolute/private/turbolong-source \
  --runtime-directory /absolute/private/turbolong-runtime
~~~

Use `--build-targets` for the intended original scripts, binaries, contracts, frontend, alerts or Cargo-source selections. The full runtime options also accept explicit Node, npm, Cargo, Rust and Stellar executable paths. `--include-tools` and `--include-rust-toolchain` control the selected tool closure on retention; Node remains required. Consult [RUNTIME.md](RUNTIME.md) for the exact original command semantics and process recovery.

Verify the selected generation:

~~~sh
stellar-turbolong-operations runtime-verify \
  --runtime-directory /absolute/private/turbolong-runtime \
  --expected-manifest-sha256 ACTUAL_RUNTIME_MANIFEST_SHA256
~~~

Restore declared regular files independently, then bind their native source/tool paths to a received application:

~~~sh
stellar-turbolong-operations runtime-restore \
  --source-directory /absolute/private/transported-runtime \
  --destination /absolute/private/restored-runtime \
  --expected-manifest-sha256 ACTUAL_RUNTIME_MANIFEST_SHA256

stellar-turbolong-operations runtime-bind \
  --runtime-directory /absolute/private/restored-runtime \
  --application-directory /absolute/private/received-application \
  --expected-manifest-sha256 ACTUAL_RUNTIME_MANIFEST_SHA256
~~~

Restoration verifies full declared bytes, modes and confined links. Binding returns the actual source, tools and entrypoint selections without replacing authored application files.

## Select the managed application fields

| Field | Selected behavior |
| --- | --- |
| Private operating workspace | Existing complete workspace or a new private directory. |
| Private Turbolong connections | Owner-only JSON outside the workspace containing named provider/runtime/execution selections. |
| Workspace profile | Optional owner-only JSON outside the workspace. |
| Retained Turbolong runtime | Complete selected runtime with manifest, original source and installed artifacts. |
| Runtime manifest SHA256 | Exact lowercase SHA256 of the selected runtime manifest; it is pinned during preparation. |
| Original source installation | Optional original installation path used with native runtime configuration. |
| Local listen address | 127.0.0.1 or ::1. |
| Local port | 8779 by default; use 0 only for an intentionally temporary origin. |

A managed preparation checks the complete application leaves and browser hash helper, reads the current workspace identity, validates private configuration placement and verifies the selected runtime manifest/version. It passes the existing workspace UUID into `serve`. The original Applications process lifecycle owns start, stop and reopen.

The startup observer requires the exact application marker, workspace/source paths, selected private configuration, actual port, process ID and runtime identity. The URL must be the local host's token-bearing root URL. It rereads the workspace identity after startup so a different directory or UUID cannot be accepted as the launched application.

The server startup record includes:

~~~json
{
  "schema": "stellar-forge.turbolong-operations-workspace-startup.v1",
  "status": "TURBOLONG_OPERATIONS_READY",
  "url": "http://127.0.0.1:8779/#token=PRIVATE_OPERATOR_TOKEN",
  "origin": "http://127.0.0.1:8779",
  "host": "127.0.0.1",
  "port": 8779,
  "workspaceDirectory": "/absolute/private/turbolong",
  "workspaceId": "ACTUAL_WORKSPACE_UUID",
  "revision": 0,
  "sourceDirectory": "/actual/installed/source/stellar/scf-starforge-20261009/sf30-seller-sdk/turbolong-operations",
  "connectionsFile": null,
  "profileFile": null,
  "runtimeDirectory": null,
  "expectedManifestSha256": null,
  "installationDirectory": null,
  "runtimes": [],
  "pid": 123
}
~~~

The values above describe the fields; real startup output contains the actual IDs, process and random token. Runtime selections contained only in a private connections file remain available to the operator and export resolver; the explicit startup runtime fields describe the runtime selected as a launch field.

## Private API and recovery

The browser takes the token from the startup URL fragment, stores it in session storage and removes the fragment. API requests carry `Authorization: Bearer ...`. Every mutation also carries `X-Turbolong-Workspace-ID` matching the selected workspace.

`GET /api/bootstrap` returns current state, complete operator/native catalogues and local host selections. `POST /api/invoke` accepts `{method,args}`. Mutating method bodies retain their UUID and revision. Full source uploads use `POST /api/source-import` with the complete retained File and hash; full archives use `/api/packages/:exportId/archive` and `/api/packages/unpack`.

The browser's IndexedDB journal is scoped to origin, workspace UUID and operator. It stores complete arguments and File objects before dispatch, retains acknowledged results before applying the resulting view and automatically recovers incomplete acknowledgements on reopen. Stable port selection keeps that journal reachable. Private host credentials never enter this browser store.

The server carries a single read-only acquisition worker. Normal stop aborts scheduled/native work and drains owned requests. A stopped process does not erase original command custody: pending or uncertain native work remains available for explicit reconciliation.

## Receive and reopen independently

Full delivery includes this source-selected application and every runtime referenced by retained source/operation history. Receiving reconstructs the complete application and returns exact local CLI/server paths, workspace directory and restored runtime connections.

Open the returned CLI with the returned workspace and the receiving host's own private configuration. Inspect reports and original source history immediately. Received acquisitions and unfinished native operations remain paused until the operator selects the appropriate continuation.

The received application retains the original operation IDs, requests and execution origins. A keeper mutation whose original process custody is unavailable remains unresolved; it cannot be duplicated by treating reception as permission to rerun the financial command.

A report-only delivery carries the report metadata and every rendered member. Use full workspace receiving for editable periods, native histories, incidents, source files and independent runtime execution.
