# Redis authoring and merchant operation through MCP

The 17 Redis tools open the original saved Redis authoring workspace. Its browser
and agent tools share one original model, SQLite history and writer lease. Saved
source queries and merchant plans feed the original package preparer; the same
SF82 release store carries the merchant through comparison, activation, startup,
rollback and customer delivery.

The imported Redis connection and source limits remain host configuration. The
native source resolves its existing environment references for Redis TCP or
Upstash HTTPS. Redis values, binary values, missing values, score strings and
stream IDs retain their original representations.

## Connect an existing workspace

Create the workspace with the original Redis product command and its source and
merchant-plan files, or connect an existing original workspace. Save a private
regular connection file with mode `0600`:

```json
{
  "schema": "stellar-forge.redis-workspace-connection.v1",
  "workspaces": {
    "catalog": {
      "directory": "/srv/starforge/redis-catalog",
      "label": "Redis catalog",
      "runtime": { "port": 0 }
    }
  }
}
```

The directory must be the canonical private original workspace. The connection
reader inspects its immutable workspace ID and source-profile fingerprint without
taking a writer lease or changing saved operations. Optional `workspaceId` and
`profileSha256` fields pin the alias across host restarts; copy the original values
returned by initialization or `merchant_redis_workspaces`. The running MCP keeps
the inspected identity and rechecks it whenever it reopens an alias.

The host runtime accepts the original release `port`, `facilitator` and
`allowLocalFacilitator` options. Set the actual facilitator for native payments.
The minimal example serves the original merchant payment challenge on an
ephemeral port.

```sh
starforge merchant-mcp init-redis-workspaces \
  --dir /srv/starforge/redis-mcp \
  --connection /srv/starforge/redis-connection.json
```

For multiple aliases, add `--workspace catalog`. Merchant lifecycle controls bind
to that selected workspace's existing `releases` directory. Other configured
workspaces remain available for authoring, previews and customer exports.
`releaseBound` identifies the workspace served by this merchant lifecycle; use
another MCP host configuration to operate another workspace's releases.

Initialization opens the original model to ensure its release store, closes it,
and saves the normal `merchant-mcp.json`. Start the maintained authenticated HTTP
or stdio provider using [README.md](README.md). Use the provider's configurable
request-size setting for a large source and merchant-plan edit. The native
model's source, plan and operation input limits continue to apply.

## Complete the merchant workflow

1. Call `merchant_redis_workspaces`, then `merchant_redis_open` with
   `{"workspace":"catalog"}`. Save the returned instance ID and browser URL.
   The URL opens the original interface with this process's access token.
   Reopening the same alias returns the same instance.
2. Read `merchant_redis_status`. The current revision is in
   `native.current`; its `native` field contains the full saved source and plan
   when small. For a larger record, follow its `record.fileRead` descriptor.
3. Send proposed `queries` and `plan` to `merchant_redis_review`. The native
   compiler returns each query and route's complete payment offers. Save the same
   reviewed input with `merchant_redis_save`, a new `requestId` and the current
   `expectedHead`. A browser edit can produce the original head-conflict outcome;
   refresh, merge the intended changes and save with a new request ID.
4. Execute `merchant_redis_preview` with a saved `revisionId`, declared `query`,
   its `input` object and a new `requestId`. The original source performs the
   read and retains the complete input, observation time and result.
5. Prepare that revision with `merchant_redis_prepare`. The completed operation
   ID is the `packageId` used by staging and customer downloads.
6. Call `merchant_redis_stage` with a new `requestId`, the original `packageId`
   and a new `releaseId`. The host connection supplies runtime settings.
7. Use the maintained `merchant_inspect`, `merchant_compare`,
   `merchant_activate`, `merchant_start`, `merchant_restart` and
   `merchant_rollback` tools for that same release. Their normal digest,
   generation and instance requirements apply. Catalog and customer SDK tools
   see the same active merchant.

Example source observation:

```json
{
  "workspace": "catalog",
  "requestId": "rankings-page-1",
  "revisionId": "COPY_THE_SAVED_64_CHARACTER_REVISION_ID",
  "query": "leaderboard",
  "input": { "offset": "0" }
}
```

Use the native result's `nextInput` verbatim for the next query with a new request
ID. Repeating an ID and its original input reopens the retained observation.
Sorted-set continuation follows live Redis ranks; stream continuation follows
the original exclusive stream ID. The original `truncated` flag and continuation
remain visible in the operation summary and complete retained result.

## Read complete original records and customer files

Saved revision and operation replies include the complete record's byte count,
SHA256 and exact `merchant_redis_file_read` selection. Records up to 32 KiB also
include complete native JSON inline. Larger records use the same retained-file
reader, preserving every result row and original field.

```json
{
  "workspace": "catalog",
  "kind": "operation",
  "requestId": "rankings-page-1",
  "limit": 65536
}
```

For a generated customer file:

```json
{
  "workspace": "catalog",
  "kind": "customer",
  "packageId": "prepare-catalog-v1",
  "name": "openapi.json",
  "limit": 65536
}
```

Use `openapi.json` or an exact `client/…` filename from the completed prepare
operation. The native package verifier checks the original package before each
new customer-file read; the original workspace selects its public generated files.

Append decoded base64 chunks at their returned offsets. Continue with the same
selection, `readId`, `expectedSha256` and `nextOffset`. Completion returns
`nextOffset: null`. Verify the complete byte count and SHA256 before using a file.
After a lost final reply, expired read, closed workspace or restarted process,
omit `readId` and repeat the original selection, expected SHA256 and saved offset.
The reader reopens the original and checks its digest before returning bytes.
`merchant_redis_file_release` releases an unfinished temporary read.

## Recover and reopen

Revision and operation lists use original pages of up to 100 records. Feed
`nextCursor` back as `after` until null. The individual revision and operation
tools read the selected native record in full.

Every save, restore, preview, prepare and stage has an original `requestId`.
After a lost reply, inspect that same operation. The native model retains
completed and failed outcomes. Reopening after process interruption marks
formerly running operations `INTERRUPTED`; `merchant_redis_resume` resumes the
exact saved input. Original package and release recovery verify the retained
package or release before reopening it.

`merchant_redis_restore` creates a new revision from a saved source and plan,
preserves intervening history and checks the current expected head. Close the
browser/model with `merchant_redis_close` and its exact instance ID. Use the
maintained merchant stop tool for a seller owned by the MCP lifecycle. Reopen
the same alias to continue its saved history and releases. The managed
Applications launcher can reopen that same original workspace after its current
owner closes it, using the shared immutable workspace and profile binding.
