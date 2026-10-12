# GridFabric managed application

This application places the original GridFabric Plaid workspace under Starforge Applications. Save one application for an existing populated workspace, start its original authenticated listener, open its operator, then use Stop to drain that listener and release the original SQLite lease. Restart reopens the same saved source and workspace.

The product keeps the original Plaid schedules, callbacks, management requests and device intents. The managed wrapper owns the native process and its connection publication. It does not create another domain store or automatically dispatch retained management or device work.

## Runtime and original workspace

Use a complete READY Starforge runtime containing the cumulative GridFabric contribution, its SDK/MCP files and these managed files. The normal selected builder and installer produce the package and its manifest. Source-only files and a source review do not establish an installed runtime.

The host needs Node 22.16 or later, including the original node:sqlite implementation, and Linux flock for the native state lease. No additional Node package is needed by this adapter. The complete managed receiving programme also uses the existing GNU tar executable to package its output.

Select an existing initialized or completely restored native workspace. The native GridFabric CLI and [README.md](README.md) describe creation and the product workflow. A restore in progress must finish through its original receiving operation before the directory can be managed.

The receiving programme also selects an existing Starforge Runtime Applications workspace. It attaches the already-installed runtime through that original workspace and uses its existing managed adoption, request journal and worker. It does not build a replacement runtime or start a second Applications control server.

## Save and start in Applications

Open **Applications**, choose **GridFabric Plaid**, and select the READY runtime. Give the saved application a clear label.

| Setting | Original binding |
| --- | --- |
| Original GridFabric workspace | Absolute private directory containing the existing gridfabric.sqlite and native metadata. |
| Private native connection file | The plaintext connection file read by the original SDK and agents. Default: gridfabric-connection.txt in the native workspace. |
| Managed readiness file | The companion source and workspace record. Default: gridfabric-application-ready.json beside the connection file. |
| Port | Zero selects an available loopback port. A specific port can also be selected. |
| Environment file | The maintained Applications environment-file option, when the original provider/header environment references require it. |

Review and save the application. Applications verifies the complete selected source, current native workspace identity and exact startup inputs before saving. If this runtime has not yet been adopted into a managed home, the same original adoption operation prepares it.

Start the saved application after that adoption is complete. Its single original request UUID is passed into the managed command and retained by the Applications worker. The worker waits for verified readiness before presenting the operator URL.

Open the URL from Applications. The existing native operator supports retained source files, mapping editions, report queries, callbacks, opt decisions and reviewed management/device actions. Follow [DOMAIN_OPERATIONS.md](DOMAIN_OPERATIONS.md) for the domain workflow and [SDK_MCP.md](SDK_MCP.md) for the original authenticated interfaces.

Saving or starting this application does not submit a management request, apply a device action, resume an uncertain dispatch or create provider scheduling. Those operations retain their original explicit domain inputs and native recovery.

## What the saved application binds

The source reader opens the original merchant package manifest at ../manifest.json relative to the selected source root. It verifies every declared member by complete byte count and SHA-256, checks the manifest's sourceCommit and total source bytes, and reads the original distribution specification.

The specification must retain both command names and the application provider:

| Declaration | Source-relative target |
| --- | --- |
| gridfabric-plaid | stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/cli.mjs |
| gridfabric-application | stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/managed-launch.mjs |
| applicationProviders.gridfabric-plaid | stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/application-provider.mjs |

The reader also compares the executing original native server's complete sourceIdentity module roster against that same manifest. There is no additional GridFabric source manifest.

An adopted release can reside in another directory. Its original complete manifest, source commit and member hashes must still agree. The operational sourceRoot path is recorded for that launch; the source digest describes the actual bytes and remains valid across an original managed relocation.

The native workspace binding contains its absolute directory, original workspace UUID and created_at identity. The selected Node executable and version, private connection/ready paths and complete source identity are also bound. Mutable domain revision, callbacks, sources and operation outcomes remain live native state; those fields do not make an ordinary subsequent Start require a new application edition.

Applications uses all three original resource keys: native workspace, connection path and ready path. The existing framework prevents a conflicting application start for the same resources. The native workspace still acquires its own original lease.

## Readiness and private connection custody

The managed command emits one compact JSON readiness line for the existing Applications observer. The original native CLI remains available and keeps its own output format.

The connection file is the original native plaintext format:

~~~text
http://127.0.0.1:SELECTED_PORT/#PRIVATE_LISTENER_TOKEN
~~~

It is private, and its exact bytes are bound by the readiness record. The SDK continues to read it through its original connection-file API. There is no additional authentication store or HTTP shutdown endpoint.

The readiness record uses schema stellar-forge.gridfabric-application-startup.v1. It identifies the original application request, a new listener instance, native directory/UUID/created_at, complete source, selected Node, binding SHA, connection path, ready path and exact connection SHA/length.

Publication is ordered:

1. The wrapper acquires the original native workspace lease.
2. It preserves any matching earlier managed connection and ready bytes under exact previous-file identities.
3. It starts the original native listener.
4. It durably records PUBLISHING, including that listener's exact planned plaintext bytes.
5. It publishes those plaintext bytes.
6. It advances the same record to READY.

Only the final READY line is accepted for a new application URL. Applications independently reads and verifies the complete ready record, selected source, original connection and native workspace-bound HTTP response.

A previous PID does not establish that an owner is gone. The original native lease must be acquired before earlier matching connection bytes can be retired. An arbitrary plaintext file without its exact managed companion is retained for the original owner to resolve.

## Stop and restart

Use **Stop** on the original saved application/run. The existing managed worker sends the original stop signal and waits for child closure. The wrapper attempts both listener drain and original workspace close, including the SQLite/lease release.

After successful native drain, it removes only its own exact plaintext connection. It removes the matching ready record only after that connection retirement succeeds. A failure leaves the matching recovery record available; another file or listener's bytes are never silently removed.

The worker records the actual command result and releases its original managed lease after observer and child close. SDK and MCP borrowers close their own HTTP work; they do not stop this owner.

Start the same saved application to reopen it. The new listener has a fresh token and may use another loopback port. Original workspace, source and business records remain the same. Clients that were attached to the earlier listener use their original same-workspace reopen method and re-read the current private connection.

A received portable sibling is a different directory. Manage it with a separate saved application and its own connection/ready paths, while retaining its original logical workspace UUID. Finish and close the original restore receiver's native owner before starting that managed sibling.

## Interruption and retained outcomes

| Actual observation | Continuation |
| --- | --- |
| Saved application, adoption pending | Reopen the same original adoption request in Applications. |
| Managed request retained, worker active | Read that exact run's output and readiness. |
| PUBLISHING or matching old READY after owner interruption | Preserve the paired bytes; a later original native lease acquisition validates and retires them. |
| Original managed command launched but its result was lost | Use the framework's original recovery for that request. It records the observed outcome and does not replay the launched command. |
| Listener or native close failed | Retain its original error and paired startup material until the same owner/recovery resolves it. |
| Connection retirement failed after native close | The ready record remains paired with the original connection. |
| Ready or connection bytes differ from their saved identity | Preserve the difference and review the actual original selection. |
| Workspace/source/Node binding changed | Review and save an explicit new application selection instead of changing the old request's inputs. |

RECONCILED and OUTCOME_UNAVAILABLE remain the original framework outcomes. A later native CLI lease check can prove that the exact workspace can reopen; it does not turn a missing process result into an observed normal exit.

## Read a binding without starting an owner

From the actual selected source root:

~~~sh
node "$SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/managed-launch.mjs" binding \
  --workspace "$GRIDFABRIC_WORKSPACE" \
  --connection-file "$GRIDFABRIC_CONNECTION" \
  --ready-file "$GRIDFABRIC_READY"
~~~

This verifies the complete selected source and reads the original SQLite metadata through its existing read-only snapshot API. It does not open another domain writer or start a listener.

The source CLI also has status, which can verify the current managed announcement through the original HTTP borrower. Run it with the same paths. Use Applications for managed Start and Stop.

After an observed Stop, the unchanged native status command provides a direct original lease-open/close proof:

~~~sh
node "$SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/cli.mjs" \
  --workspace "$GRIDFABRIC_WORKSPACE" status
~~~

Do this only after the original owner has drained. A busy native lease is an actual ownership result to retain.

## Complete populated-workspace receiving

The complete programme is [operations/scf-gridfabric-plaid-managed-receiving-20261012/run-receiving.mjs](../../../../operations/scf-gridfabric-plaid-managed-receiving-20261012/run-receiving.mjs). Its full input, workflow and output contract are in the [receiving guide](../../../../operations/scf-gridfabric-plaid-managed-receiving-20261012/README.md).

It starts with the already-populated workspace and a READY runtime containing this exact cumulative source. It then:

- Saves and starts the original managed application.
- Uses the original SDK callback to receive the native atomic portable export, original sibling restore, complete SDK/MCP pages and files, and SDK/MCP reopen.
- Confirms that callback's cold listener and native lease are closed.
- Receives complete original live tables and every original file into the customer result.
- Stops and proves native lease closure with the original CLI.
- Restarts the same saved application and compares every table and full file again.
- Starts the restored sibling through a separate saved application, compares the full original snapshot and files, and stops it.
- Freezes the complete customer member roster and produces a verified native tar/gzip result.

The programme does not run the earlier 51-step input portfolio again or substitute a new dataset. Keep that original operation's input/result identities with this supplied workspace. Current native source is recorded separately from the earlier frozen receiving-source declaration.

This managed programme makes no management or device dispatch. Its direct row/file observations and original CLI proof are substantive native operating evidence. Browser observation is not performed by this entry; use actual separately retained browser results when they exist.

## Implementation

The source-owned adapter consists of application-provider.mjs, managed-binding.mjs and managed-launch.mjs. It uses the original Applications provider, runtime inspection, native operator/server, SQLite snapshot and SDK. Its receiving programme is additive; the shared framework and original domain remain maintained by their existing owners.

Original managed work operation: GRIDFABRIC-MANAGED-APPLICATION-RECEIVING-20261012-1FB3.
