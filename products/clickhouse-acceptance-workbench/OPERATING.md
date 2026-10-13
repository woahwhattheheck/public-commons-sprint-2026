# ClickHouse Acceptance Workbench operating guide

ClickHouse Acceptance Workbench gives a data owner a complete workflow from an existing approved source to a separately retained candidate, exact native comparison and an independently received customer edition. The browser, CLI and Merchant agent use the same application, immutable project history, original request IDs and native attempts. A transfer is followed by an explicit fresh verification before the consumer declaration can be selected.

This is a TJLabs product integration of the complete original Altinity migration acceptance source. It does not imply Altinity endorsement or replace the existing company relationship. The source package and an operated customer result are different deliverables: call the outgoing product ready only after the exact original receiving course and the rendered-product instruction below are completed.

## 1. Source, native ownership and commercial scope

The complete original source is under workbench/. Its origin is woahwhattheheck/commons at 67ed8a126bf56c8dafa4202a672f441498a6b1a6, opportunities/altinity_clickhouse_application_workshare_2026/migration_acceptance/. The 54-file origin has 816,268 bytes including its own SOURCE_MANIFEST.json. original-source.json binds every selected file and records each explicit maintenance preimage/postimage. The maintained edition contains 820,805 bytes and repairs observer closure, isolated Python/native-output handling, receiving-phase/source-intake recovery and stale-form revision protection; the actual ClickHouse planner, native worker, exact comparison and merchant-source transformation remain their original implementations.

The existing native course is ALTINITY-MIGRATION-ACCEPTANCE-0C7A-20261013. Its original owner and source/operation directory remain authoritative. Do not start a second database fixture or duplicate the course because a local executor is unavailable. Use the already equipped original receiver with the complete selected source and operating instructions.

The company/sender remains F8256 in the original Altinity thread. Its sent USD 6,000, 40-hour, 10-business-day read-service offer covers one approved connection and up to four read products; its commercial split is USD 3,000 + 3,000. The separate migration proposal is USD 7,200 over 12 business days, USD 3,600 + 3,600, for one approved pair and up to five scalar tables. These are proposals and scopes, not a claim of customer agreement or additional grant funding. The original company case, original ClickHouse merchant and any existing customer commitments retain their owners.

The original reference uses ClickHouse 26.8.24.9 and three declared demonstration transfers from the existing ce4fd5b79c7d098305a00567cf2c3cb983d4065d merchant source. Those three reference rows are not a customer population or a performance claim. Real customer acceptance covers the whole agreed population and boundary.

## 2. What the application actually supports

Select one to five exact source/target [database,table] pairs. Target candidate names begin commission_. Each table retains its complete native columns, business names, optional left/right column bindings, primary key, ORDER BY, engine, version column, explicit FINAL decisions, full-export cap and source boundary.

Supported candidate engines are MergeTree and ReplacingMergeTree. ReplacingMergeTree requires the declared logical primary key to equal ORDER BY, an explicit version column and FINAL for logical acceptance. A delete/tombstone column creates a visible blocking projection issue; the adapter does not silently drop records. Arrays, maps, tuples or other unsupported nested types require a separately reviewed scalar source projection. Do not present that work as already implemented.

Native exports preserve integer values through 256 bits as text, exact decimals, Float32/64 values through their selected Float64 bit encoding, binary String/FixedString values as Base64, explicit null masks, dates, timestamps normalized by the original SQL projection, UUID and IP text. The complete comparator checks all selected cells and duplicate multiplicities, as well as declared keys and schema meaning. Equal row counts alone are insufficient.

A table declares at most 1,000,000 rows and 512 MiB for its complete export. The worker requests one extra row to detect an exceeded row cap; it rejects an incomplete population. Whole uploads and retained artifacts are bounded at 2 GiB; source and request JSON at 32 MiB. Increasing a limit does not establish capacity or authorize a partial population. Agree complete partitioning and preserve its joins before accepting larger work.

Source and target observations occur through separate native requests. A successful run does not manufacture cross-table transaction isolation. The data owner must declare an actual quiesced period, immutable snapshot or another approved boundary, and the worker retains its source-stability observations.

## 3. Prepare the installed application and receiving copy

Read PREPARING.md for the exact installed prepare/inspect/export/receive commands and their required output selections. The four distribution commands are:

| Command | Purpose |
| --- | --- |
| clickhouse-acceptance-workbench | Forward the original complete local CLI. |
| clickhouse-acceptance-workbench-prepare | Prepare or inspect complete source/Python receipts; export and independently receive the application runtime package. |
| clickhouse-acceptance-workbench-managed | Own the original HTTP application through Applications. |
| clickhouse-acceptance-workbench-receive | Continue the original native course and installed Merchant/Applications receiving. |

Use the returned primary or receiving applicationDirectory, runtimeDirectory, runtimeReadyFile and python exactly. The integration runtime receipt has schema stellar-forge.clickhouse-acceptance-runtime.v1 and state READY; it binds the selected full source, original worker and actual standard-library Python at that installation. The original engine does not need a local ClickHouse binary or an installed Sling executable. Customer endpoints are existing approved ClickHouse servers. The local reference fixture, if selected by its original owner, uses that owner's exact original ClickHouse 26.8.24.9 binary and directory.

The portable runtime is a complete tar.gz source/runtime-selection carrier. Independently receive it into a new owned directory and measure that host's actual interpreter. Do not relocate an old runtime-ready file, manually copy its absolute Python path, or add unrelated generated metadata inside inventoried workbench source. Keep private runtime/host state in the declared separate directories. Preserve complete source and license files, including the original vendored comparison, archive and lifetime modules.

The Merchant distribution's complete selected source manifest covers the additive adapters and shared Applications/MCP dependencies. The original workbench source inventory covers the native application it actually executes. Keep both inventories and do not substitute one for the other.

## 4. Private application setup and managed lifetime

Create a private parent directory owned by the operating user. Authentication, launch configuration and connection files are mode 0600; workspaces and host output directories are mode 0700. Choose absolute canonical paths. The same original listener may expose separate operator and viewer aliases without opening another application writer.

The original authentication file uses:

~~~json
{
  "schema": "tjlabs.sling-auth.v1",
  "actors": [
    {
      "id": "acceptance-operator",
      "name": "Acceptance operator",
      "roles": ["operator"],
      "token": "REPLACE_WITH_A_PRIVATE_RANDOM_TOKEN_OF_AT_LEAST_24_CHARACTERS"
    },
    {
      "id": "acceptance-viewer",
      "name": "Receiving reviewer",
      "roles": ["viewer"],
      "token": "REPLACE_WITH_A_DIFFERENT_PRIVATE_RANDOM_TOKEN"
    }
  ]
}
~~~

Keep tokens out of source, tool arguments, screenshots and exported customer packages. Native endpoint/user/password selections name existing host environment variables; their actual values remain private host configuration.

The managed launch input selects schema stellar-forge.clickhouse-acceptance-workbench-launch.v1 and the exact directory, applicationDirectory, authFile, actorId, runtimeReadyFile, connectionFile and python. Do not pass consumerRoot: this original application retains consumer table-binding JSON and does not use a filesystem downstream-edit root. actorId must be an actual actor in the selected private authentication file.

Use the original Applications Review/Save/Start lifecycle with the clickhouse-acceptance-workbench provider. Review the complete launch selection, save its exact revision and start that saved application. The provider binds source/runtime/configuration identity before launching the original application. It returns the actual loopback origin and instance/launch identity through the private connection file. Browser login uses the existing private actor token.

Applications Stop drains the observer/listener, HTTP work and its own source/store/lease handles. Accepted native ClickHouse jobs are detached and keep their original kernel lifetime. Stop does not cancel a transfer, undo a remote INSERT or drop a candidate table. Use the original job.cancel action when cancellation is intended, then observe the original native result. Reopen the same workspace to reconcile accepted jobs. A failed close must keep the same owner handles until closure is confirmed; never open a second writer to bypass it.

## 5. Retain the complete source and approve the plan

Start a customer project through the browser, original CLI or merchant_clickhouse_acceptance_create. Preserve the selected request ID and full title/notes. Retain the complete altinity.acceptance-input.v1 JSON as role acceptance_config. Inspect its actual source and target declarations through Source connections before compiling.

Each connection declares an ID, endpointEnv, userEnv, passwordEnv, allowLocal where explicitly intended, approved databases, exact allowed four-part server versions and read/write mode. The candidate target requires write mode. An optional endpoint identity constrains the real endpoint. The worker retains actual observed server version/account/UUID evidence; an example's version list is not permission to operate an unreviewed server.

The original example file workbench/reference/acceptance-input.example.json is an editable example, not a ready customer configuration. Replace its sample database/table names and boundary note with the actual authorized selections. Preserve the meaning of every field. The reference fixture-input.json remains the unchanged original three-row native programme input.

Call plan.compile with {sourceId,title}, then inspect the complete compiled native plan and generated comparison projection. Review the exact plan row through plan.review. Resolve all required issues before approval. The application retains the source edition, semantic plan identity, reviewed project revision and actor. Changing a source or plan requires a new deliberate review; a prior comparison cannot approve a changed plan.

## 6. Original transfer, fresh verify and effect recovery

Select the original runtime with runtime.select, prepare run.prepare with the approved planId and mode transfer, and start the returned original job with job.start. Each transfer creates separate commission_ candidate tables using reviewed native SQL and RowBinary input. The same semantic plan has one transfer; a new useful source edition requires an explicit new selection.

The original worker retains native selection, commands, actual responses, table UUID/schema identities, RowBinary and complete typed observations. job.resume continues the original ended attempt. job.cancel requests the original cancellation. job.resolve records an explicit operator decision for uncertain native CREATE/INSERT effects. A lost response after a write is not evidence that the write failed. Inspect the retained request/response and exact native effect before retry/adopt/abandon; never construct a replacement operation to avoid this decision.

After transfer, prepare mode verify for the same approved plan and run that original job to completion. Verify reads the selected existing source/candidate pair. Retain the complete new observations and call comparison.create on that completed job. The comparison binds both the native acceptance plan and original semantic comparison projection. readyForCutover also requires actual source stability and verified target identity.

Read the full comparison report and observations, including every failed row, exact cell and multiplicity. Retain schema/UUID/version/account evidence with them. Plan readiness, a stopped worker, equal counts or a browser success banner alone do not establish full acceptance.

## 7. Consumer selection, rollback and original read-service adoption

cutover.apply requires the current approved plan, a ready comparison from the latest completed verify and a reason. It saves a complete table-binding JSON with source/target side, native job, plan, comparison, table UUID/engine/columns, source boundary and observed time. It retains the exact previous declaration.

The consumer endpoint returns mode retained-native-export and liveQuery:false. Page each stream through offset/limit (maximum 1,000 rows), compare columns and every typed row to its retained native observations, and bind the selected snapshot SHA. These are the actual saved results of the selected job, not a fresh remote SELECT. A customer requiring continuously refreshed data must commission a new real verify/edition at its actual period.

cutover.rollback restores the retained prior binding with an explicit reason. It does not drop tables, downgrade ClickHouse or silently rewrite another application's configuration. Select the final accepted declaration deliberately after demonstrating rollback.

For an agreed merchant handoff, retain the complete original stellar-forge.clickhouse-source.v1 document with role merchant_original. merchant.derive accepts its sourceId, title and literal edits containing queryId, find, replace, expectedOccurrences and reason. It preserves all unselected original queries/parameters/limits, derives endpoint/user/passwordEnv/database from the accepted binding and retains both the complete derived source and full original-to-derived change record. Its result includes derivedSourceId, changeSourceId and nativeReviewRequired:true. Deliver those exact files to the original ClickHouse merchant Review/Stage/Activate owner. This application does not perform that later paid-service activation or invent payment success.

## 8. Attach a complete customer agent

Prepare a private host alias file:

~~~json
{
  "schema": "stellar-forge.clickhouse-acceptance-workbench-host.v1",
  "workspaces": {
    "customer": {
      "label": "Customer acceptance operator",
      "directory": "/private/acceptance/customer-workspace",
      "connectionFile": "/private/acceptance/customer-connection.json",
      "actorId": "acceptance-operator",
      "inputs": {
        "configuration": {
          "label": "Approved complete acceptance source",
          "file": "/private/acceptance/input/acceptance.json",
          "sha256": "REPLACE_WITH_THE_FULL_ACTUAL_LOWERCASE_SHA256",
          "bytes": 12345,
          "filename": "acceptance.json",
          "mediaType": "application/json"
        }
      }
    },
    "reviewer": {
      "label": "Read-only customer reviewer",
      "directory": "/private/acceptance/customer-workspace",
      "connectionFile": "/private/acceptance/customer-connection.json",
      "actorId": "acceptance-viewer"
    }
  }
}
~~~

The byte count and SHA above are selections to replace with the complete real file identity. Alias configuration may select a stopped application, but connect and data disclosure require its actual original listener. A connection file maps to only one workspace; different explicit actors may attach to that same listener. The host never accepts arbitrary model-chosen file paths.

Initialize the existing Merchant host through the exported setup function:

~~~js
import {initializeClickHouseAcceptanceMerchant}
  from "./products/clickhouse-acceptance-workbench/setup.mjs";

const host = await initializeClickHouseAcceptanceMerchant({
  directory: "/private/acceptance/merchant",
  connection: "/private/acceptance/agent-aliases.json",
  name: "Customer ClickHouse acceptance operator"
});
~~~

This retains a merchant-mcp.json using clickhouseAcceptanceConnection, existing release store and private retained exports. It does not start another application. Run the existing Merchant MCP host against that configuration, discover the registered provider and use a declared workspace alias.

| Tool suffix after merchant_clickhouse_acceptance_ | Original capability |
| --- | --- |
| status, connect, disconnect, browser, info | Declared aliases, exact launch attachment, native actor/runtime and browser address. |
| projects, project, create, action, requests | Complete original project/history and durable exact actor-bound create/action recovery. |
| upload_begin, upload_status, upload_chunk, upload_finish, upload_input | Original full upload with committed range replay; declared complete host file streaming. |
| source_connections, consumer | Approved source/target connection declarations; complete paged retained native consumer export. |
| artifact, files, file, file_release, inspect | Full SHA/byte-bound artifacts and response snapshots, byte ranges, maintained reader lifetime and JSON pointers. |

The catalog contains 22 tools. The installed course validates the complete catalog and operates the selected real customer workflow; it does not create extra database operations merely to exercise every action.

## 9. Exact requests and full retained files

Before create or action dispatch, the adapter writes the complete original actor, instance, request ID and input to private retained storage. A successful native response is kept in full; the tool's compact value contains JSON references for large arrays or strings. inspect pages at most 50 entries from the same retained JSON. file reads at most 196,608 bytes per page. Follow the same fileId/expectedSha256/readId and verify complete bytes; do not treat a compact preview as the full output.

The requests tool pages the saved original selection and confirmation. Native errors may occur after project commit, job launch or consumer materialization. Keep the original ID, expectedRevision and payload. Reconnect the same original actor, read its saved full request and replay that exact action; the original store recovers its immutable outcome and current head separately. There is no invented native request-receipt HTTP endpoint. A successful native outcome remains successful if later local file retention failed; continue retention by exact replay.

Upload_input verifies the whole declared host file before streaming it using the original 8 MiB chunks, then follows the committed offset. Inline MCP upload chunks are at most 196,608 decoded bytes. A source change requires a deliberately new input identity; do not overwrite the selected source behind an existing upload ID.

Artifact kinds are source, plan, replication, comparison, observations, handoff and native. Select projectId, kind, original row id, optional revision and, for native, the safe original relative path. Supply the actual complete expectedSha256 and expectedBytes. Original native and archive descriptors identify different objects: a project row's semantic descriptor is not automatically the bytes of a downloaded archive. Use the sealed handoff record for its whole archive identity.

The adapter retains complete bytes and the original access selection. Every retained disclosure rechecks the current original actor/instance/read permission; original mutations and request records require operate. Listener Stop retains files on disk but does not authorize offline disclosure. Reopen/connect the original installation to read them. Disconnect closes only this attachment and its reader handles.

## 10. Full named packages and receiving

The original archive writer creates complete flat canonical NDJSON v2 with frozen header/request selections and the complete content-addressed object pool. Prior named v2 archives are reconstructed byte-exact. Original gzip-v1 archives remain readable and keep their literal original filename/media type. Do not rename a gzip package to plain NDJSON or assume a project JSON export is the whole package.

Close original native work before handoff.prepare. Retain the sealed handoffCustody row and download its exact bytes. Independent receiving uses the same original upload and handoff.receive action. Preserve fresh import, same edition, older prefix and forward review semantics; an older package must not replace a later current head. Receive fences source-host bindings and preserves current receiving authentication rather than importing credentials.

Use the original CLI only while the same workspace is not held by an HTTP writer. It exports main(argv) and supports serve, list, create, show, retain, action, download, receive, inspect-package and consumer. For example, once the application has closed:

~~~sh
starforge clickhouse-acceptance-workbench show --directory /private/acceptance/customer-workspace --project ORIGINAL_PROJECT_ID
starforge clickhouse-acceptance-workbench consumer --directory /private/acceptance/customer-workspace --project ORIGINAL_PROJECT_ID --stream '["database","table"]' --offset 0 --limit 1000
starforge clickhouse-acceptance-workbench download --directory /private/acceptance/customer-workspace --project ORIGINAL_PROJECT_ID --kind handoff --id ORIGINAL_HANDOFF_ID --output /private/acceptance/exports/Customer_H1.ndjson
~~~

Pass the exact absolute Python where native inspection is needed. The CLI retains original mutation requests before dispatch. Existing output paths must contain the exact selected bytes.

RECEIVING.md describes the whole installed course and its immutable input selections. It continues or adopts the original native reference, managed primary/receiving applications, customer agent, full output downloads, original browser controls and complete cold receiving. The original operation's already-completed stages remain completed; source changes require explicit selected maintenance and do not authorize a second native reference.

## 11. Installation, grant and recurring delivery

The installed profile is stellar/scf_2026/sf49_data_commissioning/installation-workorders/clickhouse-acceptance-workbench.json. Use the existing Installation Source Desk and Workshare-derived case preparation to select it; do not hand-edit another owner's canonical case. Existing merchant unit, payment recipient/asset/network, integer atomic prices/counts/budget, assignments and approved spending remain the original preparer's selections.

The profile covers the complete 11-step customer task, actual source/runtime and native outputs, exact comparison, consumer/merchant adoption, full agent operation and independent receiving. Real useful later source periods or approved table/schema changes create linked work; retries, repeated formats and download pages do not increase purchase counts.

The grant registration and chapter attach this existing product to the same current canonical application. Preserve the original six funded packages, 400 hours, USD 38,000 and the 150-day programme. Existing engineering is the starting product; funded work is actual merchant/customer commissioning, integration, independent receiving and recurring operation within those packages. Neither the separate Altinity proposal nor an illustrative data period is additional grant revenue or evidence of purchases.

## 12. Required rendered-product inspection

Carry this complete owner instruction into the existing receiving owner's active guide and every current, future, resumed or delegated worker contributing to the outgoing product or attachments:

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Apply the same inspection to every outgoing attachment. New videos require natural generative text-to-speech and an actual watch/listen pass.
