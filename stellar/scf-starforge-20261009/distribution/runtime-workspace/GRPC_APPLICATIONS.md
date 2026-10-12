# gRPC merchant authoring in Applications

The **gRPC merchant authoring** application opens the original gRPC workspace through the installed runtime's existing Applications lifecycle. It retains the same captured protobuf source, reviewed method mappings, saved merchant editions, preview, activation and recovery controls. Applications supplies the private local entry point and owns the original managed process.

The workspace directory remains the data owner. Saving an application, starting it, stopping it and reopening it do not create a second merchant database or copy source into a new authoring project.

## Open an existing workspace or create one

Choose an installed runtime that contains the original gRPC workspace and its managed launch support. The installed release must expose the existing **grpc-workspace** command. In **Applications**, select **gRPC merchant authoring** and give it a useful operator label.

| Setting | What to enter |
| --- | --- |
| Private gRPC workspace | The absolute path to the original private workspace. For a new project, enter one new directory inside an existing private parent. |
| Local port | Use 0 to select an available local port, or the intended port from 1 through 65535. This is the authoring workspace's browser port. |
| Seller preview port | Use 0 for an available port, or a fixed port for the original seller preview. The workspace starts the preview when you request it. |
| Seller operations port | Use 0 for an available port, or the intended operations port for that seller preview. |
| Payment facilitator URL | Optional HTTPS endpoint for the original native payment configuration. Omit it when that configuration is not needed. |
| Allow the selected local facilitator | Enable only for an explicitly selected http://127.0.0.1 facilitator used in local development. The facilitator URL is required when this is enabled. |
| Private environment JSON | The original Applications private environment file. It contains environment names and string values used by the selected application; its values remain on the host. |

The facilitator endpoint cannot contain URL credentials, a query or a fragment. Its path is retained. HTTPS uses the original native configuration; plain HTTP requires the explicit local option and the exact loopback hostname **127.0.0.1**.

Review the application and save it. For a new project, Save creates the one reviewed private directory through the existing Applications mechanism. Save does not start the gRPC process or initialize an unreviewed external source. Existing workspaces retain their original directory and data.

Finish the existing runtime connection or adoption step if the selected release is not yet available in the application's managed home.

## Review and start the original application

Choose the application's existing Start review. The review captures:

- The selected installed runtime and release.
- The exact private workspace path and its filesystem identity.
- The current native source revision, generation and current-file digest, or an explicit empty source selection for a new workspace.
- The byte count and SHA-256 of the four original native launch modules.
- The selected local ports, facilitator options and the original private environment reference.

Start consumes that review through the existing managed application request. If the workspace's source selection or the reviewed launch modules change before Start, the original native writer refuses the stale selection. Review the current source and start it through that same saved application.

For a new workspace, the Start review runs after Save has created its directory. It therefore captures the actual private directory identity before execution. A review made before directory creation cannot silently become a managed start without that subsequent selection.

The original workspace acquires its own writer lease. Under that lease, it validates the selected directory and current source before opening the source or recovering retained state. Two application entries pointing to the same directory continue to use the existing Applications resource ownership and original native lease.

## Use the verified local link

Applications reads the native process's single-line launch announcement. A URL in unrelated output does not become the application link.

The helper checks the retained application run and original Start review, loads validation from that review's selected runtime, and compares the announced directory, selection, source file map, current selection and requested port. It then reads the unique native launch record:

**WORKSPACE/managed-launches/INSTANCE_UUID.json**

The record must be in **LISTENING** state and equal the announcement. The helper also sends a bounded authenticated request to that exact instance's **/api/launch** endpoint. The live response must equal the saved native record and original announcement. The helper rechecks the directory and same instance record before returning the link.

The resulting browser URL is a private loopback URL with its original capability in the fragment. Open it through the application's existing live link. Keep that URL in the private operator session.

The underlying source workflow remains the original gRPC application: capture the intended protobuf contract, inspect the source, review the unary methods and their request/response mapping, save the merchant plan, and use the original preview and release controls. Managed startup does not inject an external source file, protobuf directory, entrypoint or plan into this workflow.

## Stop, drain and reopen

Use **Stop** on the original retained application operation. The existing managed worker signals the process it started. The native workspace immediately withdraws readiness, records **DRAINING** in its own unique launch record, and closes its original workspace, seller and operations resources.

That instance then records **STOPPED**, or **STOP_UNCONFIRMED** if its close could not be confirmed. An old process writes only its own instance record. It cannot replace the launch record of a later process.

Applications retains the original operation output and result. Wait for that operation's actual stop outcome before starting another one for the same workspace. If a stop is unconfirmed, use the original operation's controls and diagnostics to resolve that process; the helper does not create a replacement supervisor.

After the original operation has stopped, reopen the same saved application and take a fresh Start review. This captures the workspace's current saved source and starts the same native data directory with a new instance identity. The previous revisions and per-instance launch history remain available. The new link is validated from the new original instance record and live response.

A stopped instance's old link cannot establish readiness for the new operation. The application view also continues to suppress a link once its original operation has stopped or has a Stop request.

## Recover an interrupted start or a restored workspace

An interrupted browser connection does not authorize a second Start. Reopen the existing application operation and inspect its retained output, state and result. If the original process is still active, use that operation. If it ended, resolve that original outcome and obtain the current Start review before the next start.

If the workspace was restored or moved, select its actual restored private directory in Applications. Save that explicit application change and review Start again. A replacement directory can contain identical data while having a different filesystem identity; the original review intentionally does not authorize that replacement silently.

A restored source selection is read through the original native binding inspector. This helper does not edit the restored current file, clear the native writer lease, change release history or manufacture a successful stop.

| Reported condition | Operator action |
| --- | --- |
| Managed source required | Select a runtime that contains the four native managed launch modules and the existing grpc-workspace command. |
| Source changed during review | Inspect the selected runtime or source update, then make a current Start review for the same application. |
| Workspace or source selection changed | Reopen the original workspace and review the intended current selection. If the directory was intentionally replaced or restored, save that actual directory selection first. |
| Start review changed | Open the retained application run associated with this operation and use its current original review. |
| Instance changed or no longer ready | Inspect the original operation and its unique launch record. Reopen after its actual stop, or use its active original operation. |
| No link before startup | Read the original process output and result. A missing or rejected live announcement is not a successful ready state. |
| Local facilitator required or invalid | Enter the intended endpoint and use the exact native HTTPS or explicitly selected loopback HTTP configuration. |

## Integration into the maintained application owner

The two additive distribution files are:

- **distribution/runtime-workspace/application-grpc.mjs**
- **distribution/runtime-workspace/GRPC_APPLICATIONS.md**

The helper exports the existing owner-facing contract:

| Export | Contract |
| --- | --- |
| grpcApplication(common) | The grpc-workspace catalog entry. Retains common port and private environment fields. |
| prepareGrpcApplication(settings, inputPath, runtimeDirectory) | Returns args, inputs and createDirectories. Uses the selected runtime's native binding and managed-selection validation. |
| grpcStartup(request, text, operationDirectory) | Asynchronously checks the exact reviewed original launch and live instance. Returns url and original metadata, or null for unrelated output. |

The shared Applications owner adds the catalog entry and calls preparation from its existing command branch. It carries both the returned **inputs** and **createDirectories** into the original command review. The existing common **--port** and private environment handling remain in that caller.

The original output observer must serialize the asynchronous grpcStartup call in its existing saving promise, pass the current operationDirectory, and set its seen flag only after a valid returned URL. It then writes the original application-url.json record in the same way as its other managed application entries. The helper does not write a competing application URL file or create another lifecycle worker.

The native gRPC owner supplies:

- **sf30-seller-sdk/grpc/workspace/binding.mjs**
- **sf30-seller-sdk/grpc/workspace/managed-launch.mjs**
- The composed original workspace model and server.

The four relative native launch-source paths deliberately omit the installed source root. This lets a byte-identical original execution copy report the same reviewed source identity while the existing manager continues to bind the full installed runtime and release.

### Source contracts

The integration follows the original Applications lifecycle at merge **7ef0ec30cfbabbd4f11f74656d592b0571cbc740** in [public-commons-sprint-2026](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/7ef0ec30cfbabbd4f11f74656d592b0571cbc740/stellar/scf-starforge-20261009/distribution/runtime-workspace). Later shared Applications changes are composed by its existing owner.

Canonical native source semantics come from the selected runtime's **grpc/common.mjs**, **grpc/start.mjs**, **workspace/binding.mjs** and **workspace/managed-launch.mjs**. In particular, the native canonical JSON serialization owns the selection and source digests; the helper does not substitute another serializer. It loads those native validation functions from the selected installed runtime.

The original gRPC receiver remains responsible for the native managed Start, authenticated application opening, original Stop/drain and Reopen journey. No separate receiver or substitute merchant execution is introduced by these two files.

MIT attribution is preserved with the original source.
