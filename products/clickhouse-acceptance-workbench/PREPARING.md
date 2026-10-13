# Prepare ClickHouse Acceptance Workbench

This preparation installs the complete original ClickHouse migration acceptance application and its selected Python HTTP worker into private primary and receiving directories. It gives the operator an application that can reopen the same migration projects, native operation records, typed comparisons, consumer bindings, reviews and complete handoffs.

The accepted ClickHouse servers remain the actual source and target selected in the reviewed acceptance input. Preparation does not create a replacement database or copy the reference server into a customer installation. The existing original reference fixture and its retained operation remain the receiving programme’s source of actual ClickHouse execution.

## Host and source

Use Linux, Node 24 or newer, CPython 3.11 or newer and the host’s existing `flock`. Python uses its standard library. Select the canonical absolute Python executable; the preparation observes its implementation/version, imports the actual required libraries and retains its complete binary identity. Each receiver selects its own existing interpreter and obtains its own runtime receipt.

The product contains all 54 original application files, including the original Python worker, native custody implementation, operator application, original receiving programme, fixture, source records and upstream licenses. `original-source.json` selects the complete maintained edition and preserves every changed original preimage. Source copies are verified against every selected file. Additional application files, links and changed bytes are rejected; generated Python cache directories do not change the source selection.

Create one private parent directory for this installation. Keep source, preparation, editable workspaces, credentials, connection records and Merchant exports in separate directories. Use mode 0700 for private directories and mode 0600 for private JSON.

## Prepare the complete application

From the installed distribution:

```sh
starforge clickhouse-acceptance-workbench-prepare prepare \
  --directory /srv/private/clickhouse-acceptance/prepared \
  --python /usr/bin/python3.11
```

Replace the Python path with the actual canonical executable on this host. To select a separately retained complete copy of the same maintained original application, add `--source /absolute/application`. The selected directory must match all 54 published source identities.

The result has schema `stellar-forge.clickhouse-acceptance-workbench-preparation.v1`, state `READY`, the private preparation `directory`, a `primary` and a `receiving` selection, `portable`, `source`, and `resultPath`. Each selection contains:

- `applicationDirectory`: complete private original application;
- `runtimeDirectory`: private runtime observation records;
- `runtimeReadyFile`: its own complete source/worker/Python receipt;
- `python`: the canonical selected interpreter;
- `ready`: exact runtime receipt path, bytes and SHA-256;
- `runtime`: the full observed runtime value.

The runtime receipt has schema `stellar-forge.clickhouse-acceptance-runtime.v1`, state `READY`, adapter `altinity.native-http.v1`, the exact application and source manifest, worker identity, and observed Python identity. It is the installed wrapper’s preparation record. The original ClickHouse HTTP engine continues to select server/account/table bindings from each approved plan.

The primary and independent receiving application and receipt paths are distinct. The interpreter may be the same installed host Python. Each separately received installation verifies its own source and worker and binds its own interpreter. No database credentials or customer workspace are included in the preparation archive.

## Resume the same preparation

The operation retains its exact request in `.runtime/REQUEST.json`, the selected commands and closed child results, and `.runtime/PREPARED.json`. A kernel lock is inherited by every preparation child. A failed observation or result write does not release the operation before that actual child closes.

For an interrupted prepare, repeat its complete command with `--resume`. For an interrupted receive, repeat its original archive and Python selection with `--resume`. Keep the original directory, source, executable and archive bytes.

A completed command is reused only after its exact stdout/stderr and selection match. A complete result candidate is retained before final inspection/publication, so reopening a completed operation does not start another installation. The whole transfer and all original source identities are inspected again before a completed result is returned.

Inspect a completed preparation:

```sh
starforge clickhouse-acceptance-workbench-prepare inspect \
  --directory /srv/private/clickhouse-acceptance/prepared
```

This returns `state: READY` and the complete original result under `result`. It verifies both prepared selections, the original request, selected Python, full source, worker, runtime receipts and portable archive.

## Transfer to another host

Export the complete portable source to a new path outside the preparation directory:

```sh
starforge clickhouse-acceptance-workbench-prepare export \
  --directory /srv/private/clickhouse-acceptance/prepared \
  --output /srv/private/clickhouse-acceptance-transfer.tar.gz
```

The output parent must already be an owned private directory. If the selected output exists, it is reused only when all bytes match the original transfer.

The deterministic gzip/tar contains every `application/` source member, exact `ORIGINAL-SOURCE.json`, and `TRANSFER.json`. The receiving code verifies the full member set, sizes and hashes before publication. It rejects links, duplicate members, unknown members, escaping paths, missing members and changed source. It does not extract archive-supplied paths using a general filesystem extractor.

On the receiving host, select the complete saved archive and that host’s canonical Python:

```sh
starforge clickhouse-acceptance-workbench-prepare receive \
  --directory /srv/private/clickhouse-acceptance/received \
  --archive /srv/private/clickhouse-acceptance-transfer.tar.gz \
  --python /usr/bin/python3.11
```

This creates its own primary and independent receiving source directories and runtime receipts. Keep its resulting full `PREPARED.json`; use its own `primary` values when configuring Applications. Customer work travels through the original application’s complete handoff archives after this installation is prepared.

## Authentication and launch configuration

Use the original installation auth file. It has schema `tjlabs.sling-auth.v1` because the original application reuses that exact authenticated workspace implementation. Each actor has `id`, `name`, `roles` and a private `token`. Supported roles remain `operator` and `viewer`. Provision actual private tokens on the existing host; keep them out of source, shared guides, handoffs and model tool arguments.

Write a private launch JSON using the exact selected `primary` paths:

```json
{
  "schema": "stellar-forge.clickhouse-acceptance-workbench-launch.v1",
  "directory": "/srv/private/clickhouse-acceptance/customer-workspace",
  "applicationDirectory": "/srv/private/clickhouse-acceptance/prepared/primary/application",
  "authFile": "/srv/private/clickhouse-acceptance/auth.json",
  "actorId": "operator",
  "runtimeReadyFile": "/srv/private/clickhouse-acceptance/prepared/primary/runtime/runtime-ready.json",
  "connectionFile": "/srv/private/clickhouse-acceptance/current-connection.json",
  "python": "/usr/bin/python3.11"
}
```

Use the paths from the actual result: a received primary runtime directory can differ from a prepared one. Relative paths are resolved against the launch JSON. The auth, launch, runtime receipt and generated connection must remain distinct. The editable workspace and private credentials are outside the selected original application. There is no `consumerRoot` in this product’s launch contract: its consumer materializes the original retained declaration and native export inside the workspace.

Applications Review/Save retains the complete launch selection. Start verifies its unchanged configuration, complete source, source/worker/Python receipt and private directory identities, then opens the original authenticated application on loopback. The current startup observation binds the listener, launch UUID, workspace instance, original actor, source selection and original runtime selection.

For a direct original managed launch:

```sh
starforge clickhouse-acceptance-workbench-managed \
  --configuration /srv/private/clickhouse-acceptance/launch.json
```

The generated connection JSON is an owned mode0600 file for this actual listener. The Merchant alias configuration selects that file and the actor. It never substitutes a token supplied by a model. Reconnect after the listener reopens with a new launch identity.

Stop drains accepted HTTP requests, pending original observer reads, archives, store and workspace lease. Closing stages retain their owner across errors and may be retried. Accepted detached native ClickHouse jobs keep their original operation and kernel lifetime; use the original `job.cancel` action for an explicit cancellation.

## Native source and target selection

Before native work, retain the full customer acceptance input and review its actual source/target profiles, environment variable names, database/table pairs, every selected column and exact type, keys, sort/version/FINAL decisions and the stated source boundary. The original worker reads secrets only from the existing host environment and uses the reviewed HTTPS endpoint or explicit local reference endpoint. Server/account identity, version, table UUIDs, complete SQL/HTTP responses and native row exports remain in each original job.

A transfer writes the separate approved `commission_` candidate tables using the original native route. A fresh verification then reads the existing selected source and target. Cutover requires the latest completed verify and ready current comparison. It changes the retained consumer declaration and preserves the previous binding for rollback. Customer external client configuration remains an explicit work item in the original engagement.

The consumer API pages the retained typed native export with `liveQuery: false`. It is useful for inspecting exactly what the completed native operation observed. A current remote observation comes from a new explicitly selected original verification job.

## Complete receiving and operator use

Use `RECEIVING.md` for the complete installed course and `OPERATING.md` for the original application and agent workflows. The receiver preserves the existing `ALTINITY-MIGRATION-ACCEPTANCE-0C7A-20261013` operation and its real ClickHouse fixture. It adopts the existing complete original result or resumes the exact retained operation; it does not manufacture another reference dataset.

Keep the complete source package, primary and receiving preparations, actual original job results, native response files, complete typed comparison, original archives, browser outputs and reopened workspaces together in the original receiving delivery. The application’s original CLI is available through `starforge clickhouse-acceptance-workbench`; `--application ABS` or `--configuration ABS` selects the complete installed source before forwarding the original arguments.

## Rendered-product instruction

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
