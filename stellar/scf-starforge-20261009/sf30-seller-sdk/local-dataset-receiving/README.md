# Complete local dataset customer receiving

This source connects an already reviewed Frictionless publisher candidate to the original SF100 delivery and DuckDB customer. The original source engines, native dataset pagination, warehouse, saved-query transaction and file readers retain their contracts.

The operator uses one publisher browser to select the retained candidate, review its source/query scope, receive all pages, review every field mapping, import an immutable customer edition, choose saved views, save and run SQL, select complete exports and create a portable handoff. The same operations are available through the merchant agent and client CLI.

The [complete installed and receiving guide](../../../../stellar-forge/mcp-merchant-operator/LOCAL_DATASET_WORKSPACE.md) covers host declarations, Applications, browser operation, agent calls, full download, original warehouse working copies and source reopening. The existing [Frictionless source guide](../frictionless/README.md) owns source capture, mapping, original publisher plans and publication.

## Native ownership

`openLocalDatasetReceiving({publisher,customer,environment})` borrows an already open original Frictionless publisher. The customer declaration identifies its independently running original Python service by private database directory and persistent 32-hex workspace ID. This module creates no SQL engine, customer server, publisher or scheduler.

The persisted local delivery workspace has a distinct canonical UUID. A host owns one admission queue and one active local operation. The original merchant borrowing API tracks that child’s lifetime, browser and immutable file readers; closing the child leaves the original publisher/scheduler and independently owned customer under their original owners.

`startLocalDatasetReceivingServer({workspace,port,schedule,ownsWorkspace})` adds fixed routes and two UI assets to the original publisher listener. Borrowed mode requires its original scheduler and `ownsWorkspace:false`. It closes only that listener and its current downloads.

## Exact original data path

1. Prepare against the original run UUID, current independent candidate-review UUID and complete candidate digest. The original query contains no continuation cursor.
2. Retain the original preview, plan, candidate, source declaration, source archive and explicit local operator authorization. This step does not claim a purchase or signed payment.
3. Use the original candidate dataset for every subsequent response. Each exact page and its local authorization evidence receives a stable page intent. The original SF100 validator checks snapshot, complete schema, selected fields, filters/ranges/order/semantics, counts and every cursor boundary.
4. Reconcile an already accepted prefix through native scan before adding a bounded batch with original `appendMany`. Original page archives and final outputs publish through staged, fsynced, no-replace files. Existing different bytes are a conflict, never overwritten.
5. Retain the complete unchanged `scan(out,{retainPayload:false})` object. The existing Python receiving adapter verifies every SF100 manifest/session/page/output byte and streams JSONL against the archived typed rows.
6. Review every original field exactly once through the native customer. Mapping, key/null checks and import remain its transaction. Empty keys preserve duplicate observations when uniqueness was not part of the reviewed source.
7. Preserve original view/query revisions and the complete ordered `expected_views` list. Exact `parameters_text` accompanies saved recipes without changing stored history. Python retains its existing number semantics; quote precision-sensitive decimal parameters and use explicit SQL casts when appropriate.
8. Select the original completed query exports, any edition source exports and one whole `source-handoff` containing `warehouse.duckdb` and `handoff.json`. Package creation performs no implicit query, source capture or export.

## Recovery and publication

Every mutation stores its exact UUID and body before execution. Reopening marks former in-flight work interrupted without replaying it. Inspect the request, then explicitly resume that same ID. A changed body requires a new reviewed operation.

An interrupted page operation can have a fully accepted native prefix. The model checks its original intent, source/evidence SHA and query signature before continuing. An interrupted SF100 finalization compares every exact existing output and completes the same publication. The final manifest is published last; a legacy mismatched partial remains a visible recovery conflict.

Customer review/import use native content identities. Saved view/query recovery first reads the original native revision; it reconciles an exactly completed revision or reports a conflict. Export/source/whole-handoff requests keep the same native 32-hex ID and use the existing operation/resume path.

The complete customer package freezes its selected original records and guides. Native file copying checkpoints digest-bound offsets, verifies any uncommitted tail and finishes a retained complete partial without starting another query/export. The portable receiver validates the whole ZIP, each declared member and the final manifest, then uses no-replace directory publication and a target-scoped kernel lock. A completed receiving reply is reusable after the source archive is no longer present. Preserve the verified directory; open a distinct sparse warehouse working copy.

## Source interfaces

- `model.mjs`: status, record, request, preparation, whole delivery, original customer calls, package and explicit resume.
- `server.mjs`: original publisher extension at `/api/local-customer`.
- `package.mjs` / `package.py`: complete declared source/customer package and original-byte receiving.
- `cli.mjs`: typed merchant calls, request observation/resume, full download and local receiving.
- `public/app.mjs` / `style.css`: complete original publisher/customer operator panel.
- `local-dataset-workspace.mjs` in the merchant MCP component: one original publisher lease and file-reader lifetime.
- `local-dataset-workspace-client.mjs`: original MCP transport plus maintained retained-file downloader.

The maintained contribution is `distribution/contributions/local-dataset-customer.json`. It joins source, UI assets, original Python receiving code, CLI, merchant provider, Applications and guides in the cumulative source. It does not replace an already selected frozen release.

## Bounds and interpretation

The existing SF100 contract remains 1,000 rows per page, 2 MiB per native page, 4,096 pages, one million rows and 64 columns. The original combined archive/export bounds remain enforced. The local receiver does not silently truncate a complete query to meet a bound.

A package can declare up to 25,000 original files, 8 GiB per file and 16 GiB aggregate payload. Its complete compressed ZIP also must fit the installed immutable reader’s 8 GiB file limit. The manifest can contain up to 64 MiB. File copies stream bounded blocks and preserve zero-filled warehouse regions sparsely. Linux/Python 3.11+ provides the original kernel file lock and no-replace receiving publication.

Hashes prove retained byte identity. A local operator delivery is distinct from a paid acquisition, source authority, scientific interpretation or commercial acceptance. Publisher classes, units, raw quality codes and modeled values retain their original meaning.
