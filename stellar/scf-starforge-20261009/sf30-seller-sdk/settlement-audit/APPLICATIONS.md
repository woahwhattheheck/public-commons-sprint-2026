# Stellar settlement audit in Applications

The **Stellar settlement audit** application opens the complete settlement workspace through the original managed Applications lifecycle. It uses the same operator, connection loader, source captures, editions, reports and receiving implementation as the `stellar-settlement-audit` command.

The audit operator and its SDP and Horizon adapters run on Node's built-in modules. New remote reads use the source connections selected on that host. Retained policies, batches, source pages, plans, reconciliations and reports can be reopened without a live service credential.

The complete programme, native source rules and operating examples are in [README.md](README.md).

## Prepare the selected product

Build from the actual source checkout and its selected Git revision:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/public-commons-sprint-2026 \
  --ref HEAD \
  --selection stellar-settlement-audit \
  --out /absolute/private/settlement-audit-package
~~~

Keep the package archive, the resolved source commit and the original build manifest together. Use the existing runtime installation and Applications workspace for that selected package. The retained runtime's own inspection identifies the source and dependency profile used by managed launches.

The package supplies three executables:

| Executable | Original source and use |
| --- | --- |
| `stellar-settlement-audit` | The complete settlement CLI, including `serve` for the local operator. |
| `starforge` | The maintained source dispatcher; accepts `stellar-settlement-audit` and the selected installation and runtime commands. |
| `starforge-merchant` | The same maintained source dispatcher under its existing merchant alias. |

For example, these select the same original application command:

~~~sh
stellar-settlement-audit serve --workspace /absolute/private/settlement-audit
starforge stellar-settlement-audit serve --workspace /absolute/private/settlement-audit
starforge-merchant stellar-settlement-audit serve --workspace /absolute/private/settlement-audit
~~~

The contribution owns its Applications provider, browser map, command and package exports. Both the contribution and selected recipe explicitly retain the full application source cohort, including the original dynamically read runtime unpacker and distribution declaration. The source manifest also carries the complete original SDP and Horizon API source capsules used by the adapters.

## Open through Applications

Select **Stellar settlement audit** in the original Applications workspace. Save the application's settings and start that saved application through its existing managed lifecycle.

| Setting | Meaning |
| --- | --- |
| **Private settlement workspace** | Absolute directory for the complete editable programme. An existing directory reopens its original workspace identity. A new directory is created privately by the original lifecycle. |
| **Private source connections** | Optional absolute path to the alias-to-connection JSON. Keep it outside the settlement workspace. Use [connections.example.json](examples/connections.example.json) and the original connection rules in the operating guide. |
| **Programme profile** | Optional absolute JSON file containing the programme and institutional contact configuration. The original CLI loader validates it. |
| **Local listen address** | `127.0.0.1` by default, or `::1`. |
| **Local port** | Use `0` for an available local port, or choose an explicit port. |
| **Private environment JSON** | The original Applications environment-file option. The selected host supplies environment values to the original child process. |

Private source connections are path selections in Applications. The original configuration reader loads their contents inside the selected source. The provider records the input descriptors and paths used for the launch.

The preparation step checks the complete native operator and browser files. If a workspace already exists, it reads its actual UUID and supplies that UUID to the original command. Startup checks the resulting source directory, workspace directory and identity, local host and actual port, process ID, profile and connection paths, and announced workspace revision.

Applications retains the original command's first valid startup announcement and its local session URL. The browser puts the session token in its tab's session storage and removes the token fragment from the visible address. A newly started process supplies its own local session URL.

## Run the same source directly

An existing checkout can invoke the complete CLI without a package alias:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/settlement-audit/cli.mjs serve \
  --workspace /absolute/private/settlement-audit \
  --connections-file /absolute/private/settlement-connections.json \
  --profile-file /absolute/private/settlement-profile.json \
  --host 127.0.0.1 \
  --port 0 \
  --startup-format json
~~~

Omit the two optional configuration-file flags when opening retained work without a new connection or profile file. The command stays in the foreground and serves the same browser used by Applications.

For an existing workspace, retain the actual UUID returned by its description and use `--expected-workspace-id` when that exact identity is required by an automated launch. This is the same check applied by the managed provider.

The machine-readable startup object has schema `stellar-forge.settlement-audit-workspace-startup.v1` and status `SETTLEMENT_AUDIT_READY`. Its values come from the actual launched process:

| Fields | Native values |
| --- | --- |
| `url` | Complete local HTTP URL with the process's 43-character base64url session token in `#token=...`. |
| `host`, `port` | The selected loopback address and actual integer listen port. |
| `workspaceDirectory`, `workspaceId` | The absolute continuing directory and its original UUID. |
| `revision` | Nonnegative integer workspace revision announced at startup. |
| `pid` | Positive integer process ID of this server. |
| `sourceDirectory` | Absolute selected directory containing this application's original source. |
| `connectionsFile`, `profileFile` | Exact selected configuration paths, or `null` when omitted. |

Treat the complete local session URL as private.

## Continue and recover an operation

A saved application retains its workspace directory and selected source. Stop and reopen that application through the original Applications controls, or use the direct CLI on the same workspace. The workspace's recorded revisions, source observations and immutable editions remain the continuing programme.

The operator catalog gives each method's required arguments. Mutations retain an original UUID request ID and the expected workspace revision; the independent receiving operation has its own request lifecycle. Retain the complete original request body when its result is uncertain. Read `request.status` with that same request ID before creating another operation.

For code using the installed original operator, request lookup is:

~~~js
const result = await operator.invoke({
  method: 'request.status',
  args: { requestId: originalRequestId }
});
~~~

The returned original record determines whether that request has already completed. Read the current workspace and retained source capture state before continuing an interrupted acquisition. `capture.resume` and `capture.run` operate on the selected original capture; saved source files and provider cursors remain associated with it.

For a managed startup that reports an identity or source mismatch, reopen the saved application settings and the actual selected workspace. The current directory and source must correspond to that saved application before it can be launched under the same identity.

## Receive a complete continuing workspace

The original operator supplies `workspace.export`, `report.export`, `delivery.inspect` and `delivery.receive`. A workspace export retains the editable programme and its complete application source. A report export selects the original report edition and its declared delivery files.

The browser and CLI use the same complete tar.gz archive implementation. Download the complete original delivery and keep its manifest identity with the archive. On the receiving host, unpack and inspect the original declared files, then use the native receiving operation to create the independent workspace.

Open the returned receiving directory through **Stellar settlement audit**, or through `stellar-settlement-audit serve --workspace RECEIVED_DIRECTORY`. Its original source observations, policy and batch versions, plan and reconciliation editions, reports and receiving history are available immediately.

Configure source aliases in a private file on that receiving host before requesting new remote pages. The received workspace continues through the original operator and keeps its retained acquisition and edition history.

## Source integration

The public package exports the native workspace, operator, server, receiving, archive, reconciliation, SDP and Horizon adapters under `./seller/settlement-audit`, plus the Applications lifecycle under `./applications/settlement-audit`.

The browser map contains the three original local files: `web/index.html`, `web/app.mjs` and `web/styles.css`. Complete delivery transfers use `archive.mjs`. The source-owned provider uses the maintained Applications input preparation, environment handling, process lifecycle and startup observer.
