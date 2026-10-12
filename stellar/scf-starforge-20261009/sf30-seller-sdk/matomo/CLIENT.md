# Matomo remote client and original customer receiving

The installed SDK exposes the same Matomo workspace through a typed JavaScript client and the `starforge matomo-remote` command. It calls the original source-owned MCP tools, transfers existing immutable artifacts through the maintained file writer, and hands a completed archive to the original Python customer.

The host retains the provider connection, workspace lease, source capture, reviews, publisher, SF82 release and customer state. The remote client does not supply a provider URL, credential or server filesystem path. It selects one of the aliases already configured in that host. Its bearer token is read from an environment variable and is never written to a command record or transfer manifest.

## Install and select the original host

Use the maintained merchant distribution containing the Matomo contribution. The installed commands are:

- `starforge matomo-source`: original local source/model operations.
- `starforge matomo-workspace`: original local authenticated workspace.
- `starforge matomo-customer`: original Python handover receiver.
- `starforge matomo-remote`: the client described here.

For host configuration and the source-owned `matomo-workspaces` MCP contribution, follow [the original Matomo MCP guide](../../../../stellar-forge/mcp-merchant-operator/MATOMO_WORKSPACES.md). The host must already declare the selected workspace identity. The client uses HTTPS, or the actual original loopback HTTP listener at `127.0.0.1` / `[::1]`. Userinfo, query and fragment components are rejected on the MCP endpoint. A new endpoint or port is an explicit operator choice.

Set the existing host token in an environment variable such as `MCP_ACCESS_TOKEN`. Pass its **name** with `--token-env` when another variable is used. Neither this command nor this guide creates or displays a token.

The original Node runtime must provide native JSON source-text support. The command rejects integer/decimal input that would change when converted to the JSON number sent over MCP. Use the exact decimal strings required by the native configuration and source mapping; revisions and bounded counts remain safe integers.

## Read and open an existing workspace

List the full tool declarations locally:

```sh
starforge matomo-remote tools
starforge matomo-remote tools merchant_matomo_capture_start
```

`tools` reads no endpoint or workspace. The current descriptions, fields, bounds and annotations come from the same maintained declaration used by the host; the client does not maintain a parallel tool catalog.

Create private JSON argument files with the exact chosen alias, then use the original commands. For example, `aliases.json` contains `{}`, and `open.json` contains the operator-selected alias under `workspace`:

```sh
starforge matomo-remote call merchant_matomo_workspaces \
  --url "$MATOMO_MCP_URL" --arguments aliases.json

starforge matomo-remote call merchant_matomo_open \
  --url "$MATOMO_MCP_URL" --arguments open.json

starforge matomo-remote call merchant_matomo_status \
  --url "$MATOMO_MCP_URL" --arguments open.json
```

Opening the original configured workspace is explicit. It starts that workspace's authenticated local HTTP service and retains its existing native model; it does not capture data, export a package, start a seller or make a payment. Status supplies the current native revision, original workspace UUID, source identity, and process instance. The workspace instance changes after a close/reopen; the original workspace UUID and source identity remain its saved binding.

All normal responses are the original host's structured data. Source numeric lexemes, missing/null kinds, hierarchy and provenance remain in the original typed rows. The client does not infer a timezone, fill missing values or format metrics. Use native page/limit arguments for catalog, rows and findings; the maintained MCP transport bounds each response at 2 MiB and rejects a larger response instead of truncating it.

## Revision-bound operations and lost responses

Every original revision-bound mutation tool requires the original `operationId`, `expectedRevision`, `workspaceInstanceId` and the tool's actual input fields. The CLI requires a private command directory:

```sh
starforge matomo-remote call merchant_matomo_edition_review \
  --url "$MATOMO_MCP_URL" \
  --arguments reviewed-edition.json \
  --operation-dir "$PRIVATE_ROOT/review-command"
```

Inspect `tools merchant_matomo_edition_review` and the current original edition before preparing that file. Choose the reviewer decision and note explicitly. The command does not generate an operation ID, change the revision, replace the workspace instance or approve a review.

Before dispatch, the CLI retains the exact argument-file bytes, their SHA-256, the request and the original workspace UUID/source binding. It holds the original shared Linux flock lease for that command directory. Private files are published with same-directory temporary files, fsync and exclusive links; a partial temporary file is never a completed request/result.

The `dispatch.json` marker means the client was ready to make the request. It is not proof of server acceptance. The original host action remains authoritative.

| Retained state | Next behavior |
| --- | --- |
| Exact request and completed response | Read the original saved response locally; no MCP request. |
| Exact request without dispatch marker | Continue that first dispatch with the original arguments. Native instance/revision rules still apply. |
| Dispatch marker without completed response | Inspect the original operation; do not repeat the mutation. |
| Different argument bytes, tool or request identity | Reject reuse of the command directory. |
| Lost host connection or changed process instance | Inspect the saved original action and current instance before preparing native recovery. |

For a restarted listener, reconcile with its current explicit URL:

```sh
starforge matomo-remote reconcile \
  --url "$MATOMO_MCP_URL" \
  --operation-dir "$PRIVATE_ROOT/review-command"
```

Reconciliation checks the original UUID/source binding, reads `merchant_matomo_operation`, and retains the complete inspected result. It never changes the old request or sends a mutation. Exit status 3 means an operator decision remains necessary. A native action may be complete, running, failed, missing or require recovery; follow its actual outcome. Prepare an explicit native resume command with its own retained arguments only after that inspection. Do not replay an unknown outcome.

This command-directory record is client custody, not a substitute for the original workspace action log. It does not establish payment, provider acceptance or completion.

## Inspect and download an existing artifact

An original workspace can expose existing capture, edition, SQLite database, comparison, delivery, handover and source artifacts. Select the actual retained ID. For a completed original handover:

```sh
starforge matomo-remote inspect-artifact \
  --url "$MATOMO_MCP_URL" --workspace "$MATOMO_ALIAS" \
  --artifact handover --id "$HANDOVER_ID" --kind archive \
  --out "$PRIVATE_ROOT/handover-selection.json"

starforge matomo-remote download \
  --url "$MATOMO_MCP_URL" \
  --selection "$PRIVATE_ROOT/handover-selection.json" \
  --out "$PRIVATE_ROOT/handover-transfer"
```

The selection contains the original workspace UUID/source identity, artifact type/ID/kind, native filename/content type, exact size and SHA-256. Its provenance is explicitly `CLIENT_SELECTION_OF_ORIGINAL_MATOMO_ARTIFACT`: it is an inspected client transfer selection, not a server-created export manifest or provider receipt. The native artifact bytes remain unchanged.

Output is:

```text
handover-transfer/
  matomo-transfer.json
  payload
  download-state/
```

The payload uses a fixed local name so a remote filename cannot select a path. Its original filename and content type remain in `source.file`. The transfer SHA binds the entire selection, including the original workspace and artifact identity.

The unchanged retained-download implementation owns the private output lease, range validation, partial-file prefix hashes, fsync checkpoints, whole-file SHA and exclusive completion. Its chunks are at most 196,608 bytes and the original artifact reader permits at most 8 GiB per file. The CLI can select a smaller native chunk with `--chunk-size`.

A later `download` invocation rechecks that the selected host alias is still the same original UUID/source identity, and that the file still has the reviewed name, size, media type and digest. It resumes only the verified prefix in the same private directory. A definitively expired native read handle can reopen the same file/hash/offset. A new workspace, changed source/file, failed hash, unknown read error or different selection is rejected.

Process-local file read IDs are released when the client finishes or is cancelled. They are not used as portable file identities. The transfer's stable workspace and file binding survives a new explicit loopback listener URL after the original host restarts.

## Receive and reopen with the original Python customer

Verify a completed transfer without contacting the host:

```sh
starforge matomo-remote reopen \
  --directory "$PRIVATE_ROOT/handover-transfer"
```

Then receive it through the original customer:

```sh
starforge matomo-remote receive \
  --directory "$PRIVATE_ROOT/handover-transfer" \
  --out "$PRIVATE_ROOT/customer"

starforge matomo-remote rows --out "$PRIVATE_ROOT/customer"
starforge matomo-remote reopen-customer --out "$PRIVATE_ROOT/customer"
```

`receive` requires the selected artifact to be an original handover archive. It first hashes the completed local payload, then delegates directly to the maintained `matomo-customer receive` implementation. The original receiver verifies the archive inventory, SF100 page chain, source-file chunks, edition/report identities, exact per-page operator request evidence and restored source hashes. Its original native payment status remains unchanged, including `NOT_INFERRED_FROM_SOURCE_HTTP_OR_LOCAL_HASHES` for a local producer handover.

Receiving is local work. It opens no Matomo provider or MCP endpoint, starts no seller and makes no purchase. Repeated receiving uses the original receiver's matching-archive reopen rules. `rows` streams its exact source-linked JSONL; no data is synthesized for empty or absent fields. Use `--python` / `MATOMO_PYTHON` and `--node` to choose existing interpreters; the launcher installs nothing.

## JavaScript and TypeScript

Public package subpaths are:

| Subpath | Original implementation |
| --- | --- |
| `/seller/matomo/client` | `client.mjs` with adjacent `client.d.mts` |
| `/seller/matomo/remote-download` | `remote-download.mjs` with adjacent declarations |
| `/customer/matomo/remote` | Installed `client-cli.mjs` command |

Use the same modules directly from source when developing:

```js
import {connectMatomoClient} from './client.mjs';
import {inspectMatomoArtifact, downloadMatomoArtifact} from './remote-download.mjs';

const client = await connectMatomoClient({
  url: process.env.MATOMO_MCP_URL,
  tokenEnv: 'MCP_ACCESS_TOKEN',
  timeoutMs: 120000
});
try {
  const inventory = await client.workspaces();
  // Choose the already configured alias explicitly.
  const state = await client.status(process.env.MATOMO_ALIAS);
  const inspected = await inspectMatomoArtifact({
    client,
    selection: {
      workspace: process.env.MATOMO_ALIAS,
      artifact: 'handover',
      id: process.env.MATOMO_HANDOVER_ID,
      kind: 'archive'
    }
  });
  await downloadMatomoArtifact({
    client,
    selection: inspected.selection,
    directory: process.env.MATOMO_TRANSFER_DIRECTORY
  });
} finally {
  await client.close();
}
```

`MatomoToolArguments` declares every current original input shape, including source scope, exact enums, array/object mappings, artifact ranges, publisher target revision and handover limit. Integer ranges and identifier patterns remain enforced by the original catalog/native owner. Known common results have explicit types; remaining result objects preserve the original native JSON shape rather than inventing a universal row/result wrapper.

`client.call` snapshots its JSON arguments before starting the request. Mutating call failures carry the exact original operation reference in `error.matomoOperation`. Library users must retain their own command/action identity or use the CLI's command directory; the library does not silently write client operation files.

`client.close()` aborts and drains the client's outgoing requests and releases known original artifact read handles. It does not close the remote workspace. Explicit `closeWorkspace(alias, instanceId)` uses the original native lifecycle and instance guard. A failed retained-read cleanup remains retryable on the same client. Preserve the primary native operation error when handling cleanup errors and inspect its original action before recovery.

## Source and acceptance boundary

The original demonstrated Matomo source remains the single retained demo-day Referrers capture: 89 rows across 14 native tables and 15 original responses. The existing original customer handover contains eight SF100 pages and 57 source-file chunks; its original receiver restored the complete retained source and reopened the 89-row edition. Those completed source/receiving facts do not imply a hosted deployment, customer authorization, payment or new remote-client execution.

This remote leaf adds source-owned client/command/transfer functionality to that same product. Its actual installed/remote operation must be recorded separately against the original retained workspace and archive, without recapturing the provider or reconstructing a buyer attempt. Provider permissions, segment access, processed-report transformations and archive truncation remain the original source's declared boundaries.

## Receive an editable workspace through the same remote client

A received source workspace exposes `merchant_matomo_original_records`, `merchant_matomo_original_files` and `merchant_matomo_original_merchant`. They return bounded original-history pages, exact original inventory IDs and a selected saved merchant draft. Explicit `merchant_matomo_merchant_adopt_original` uses the normal current instance, revision and operation identity to create a new local merchant through the original compiler.

The existing artifact selection and retained downloader also support `workspace-origin`, `workspace-archive` and `workspace-original`. Use ID `original` for the manifest or ZIP; use the opaque inventory ID for a source file. The unchanged shared remote-file ceiling remains 8 GiB. A larger permitted whole ZIP uses the original browser or local streamed route.

After an inspected `workspace-archive` has downloaded and reopened successfully, select its exact retained payload through the product receiving command:

~~~sh
starforge matomo-product inspect --archive /private/download/matomo/payload
starforge matomo-product receive --archive /private/download/matomo/payload \
  --directory /private/receiving/matomo-operator --operation-id reviewed-workspace-receiving
~~~

This creates a new editable authoring workspace and preserves its original full ZIP, extracted files and commercial/action history. Inspect the returned receiving budget and complete [workspace receiving contract](WORKSPACE_RECEIVING.md). The existing `matomo-remote receive` command continues to receive a published source-file customer handover through the original Python customer.
