# Source delivery in the merchant case

Source delivery is part of the existing **Implementation and receiving** screen. It connects the original SF49 source-edition engine to the saved SF74 case, the original SF77 workorder and the implementation task/receiving record.

## Open the complete workspace

Start the maintained console with the original private case directory:

~~~sh
starforge support-console --cases-dir /absolute/private/merchant-cases
~~~

The repository entry is `node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs`. The source delivery directory defaults to `source-bundles` inside the case directory. Pass `--source-dir /absolute/private/original-sources` when reopening an existing separate source store. The managed application selection binds this actual source directory together with the original cases and incident configuration.

Open the relevant saved merchant case, check its attached runtime and terms, enter the operator in **Recorded by**, and save any current edits. Source preparation and attachment use that case's actual saved revision.

## Prepare, deliver and use an original source edition

1. In **Source delivery and receiving**, choose preparation from the saved case. Select the actual original attachment files and their source roles.
2. The host retains the first complete original SF74 handoff and owner terms under the stable preparation operation. A continuation reuses those same input bytes even if another case revision is later saved.
3. Upload the selected originals. Uploads use the native file stream and retain their declared byte counts and hashes. The operation can continue after a connection is interrupted by reselecting the same original files.
4. Prepare and inspect the native bundle. Its original request, manifest, handoff, owner terms, packet, HTML, checklist and every declared attachment remain together.
5. Attach the native workorder to the saved case. The original case writer records its exact outputs, input identities and complete manifest under the retained request. The page reopens the same case through its existing draft transition controls.
6. Use the implementation's original-file selector to associate native members with actual tasks, receiving observations or measurements. Selecting a file records its bundle ID, manifest digest and original member path. Direct downloads use the native source reader.
7. Review earlier workorders or select a retained edition when continuing the implementation. Every earlier source manifest and original member remains in the inventory.

The source panel can also receive an existing complete native archive. The original archive engine inspects and receives it, then the same attachment path records its original workorder in the chosen saved case. A received archive retains the original source case identity separately from the receiving case.

## Whole case transfer

Use [complete case and original source receiving](CASE_SOURCE_PACKAGE.md) for the installed export, inspect and receive commands. The complete package contains the selected case, captured original history and every source bundle referenced by that history. It includes original attachments that were never assigned to a task, plus manifests and older editions.

The implementation JSON carries the complete workplan, observations, inline originals and compact source references. The full case package carries those records together with the native source archives. Reopen the receiving case with its actual receiving source directory to make its direct original-file links available.

## Original interfaces

| Interface | Purpose |
| --- | --- |
| `createCaseSourceInputs({store,directory})` | Resolve and retain the saved case's first original handoff and terms for one source operation. |
| `createCaseSourceDelivery({store,directory,environment,python})` | Open the native source service and its original case attachment adapter. |
| `delivery.resolveBundle({bundleId,manifestSha256})` | Resolve the original native directory and complete descriptor. |
| `delivery.resolveFile({bundleId,manifestSha256,path})` | Resolve one original member and its native download identity. |
| `commissioningSourceBundles(state)` | Enumerate every retained manifest and its complete inventory, including unlinked original files. |
| `commissioningOriginalFiles(state)` | Enumerate original inline bytes and native file references across all retained editions. |
| `GET /api/commissioning/source-file` | Resolve a retained member identity to the same local application's native download URL. |
| `/api/commissioning/source-bundles/*` | Original native prepare, upload, inspect, receive, export, command continuation and streamed downloads. |

The delivery factory exposes its canonical `directory`, original `service`, member/bundle resolvers and `close`. The host routes retain the original loopback, Host and same-origin checks. Metadata requests and binary file uploads use separate native paths. Native downloads support byte ranges and original content identities; the browser streams large originals directly.

Source preparation, receive and attachment retain their original operation/request IDs. Repeating a request reuses its original result and bytes. A request ID with a different saved case, revision or payload is rejected by the original operation. The service performs one complete native input inspection for attachment and passes that original result into the case writer.

## Capacity and lifecycle

The original SF49 module exports `SOURCE_EDITION_LIMITS`; its archive module derives `SOURCE_ARCHIVE_LIMITS` from those exact limits. Attachment files can be up to 8 GiB, within the original 16 GiB source input population. The current SF74 runtime owns its handoff capacity, including commissioning and Service workspace state. Archive expanded size follows the full original inventory plus manifest; archive upload capacity includes its native ZIP overhead.

The case record retains the source manifest rather than another large copy of the runtime. Server startup opens the configured native delivery service; managed selection binds its original root. Shutdown stops owned source work and download streams through the original service/router lifecycle.
