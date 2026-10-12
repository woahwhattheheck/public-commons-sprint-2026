# Merchant cache operations

Operate response-cache retention from the original API merchant workspace, from a private browser workspace, or through the command line. Saved operating snapshots, policy comparisons, changes and recovery records share one local database.

## API merchant workspace

Save or reopen an API package in `starforge openapi-workspace`. Its run section includes **Open cache operations**, which remains available when the seller is stopped. Start the saved package to inspect and change its live caches. The operating page uses that exact managed seller and the same workspace login.

1. Select **Inspect current runtime** to see current retention, source activity and cache counters.
2. Give the operating snapshot a useful label and save it. Select a saved snapshot to review a route.
3. Change TTL, entry count, retained byte budget or maximum entry size; alternatively choose invalidation.
4. Prepare the change, review the exact before/after settings and apply it. The operation ID identifies the same change throughout its history.
5. Capture a later snapshot to compare settings and activity. To restore a prior policy, select a fresh current snapshot and choose the older policy under comparison.

Counter differences are calculated only within the same original runtime and cache generation. Restarts, invalidation and credential generation changes retain their own totals. Reports show the original measurements and retention settings.

Live retention changes last for that seller process. The saved API package supplies the next process's initial settings. The saved history supports restoring a prior policy against a fresh inspection of the restarted seller.

## Existing cache control

The original named-cache seller and API upstream seller expose the same management interface. A separate operating workspace connects through an existing private control descriptor or local socket. Host mappings use stable aliases:

```json
[
  {
    "id": "merchant",
    "label": "Production dataset API",
    "controlFile": "/private/merchant/cache-control.json"
  }
]
```

Keep this sources file on the host. A complete workspace export contains aliases and labels, so a receiving operator can remap the same alias to the receiving host's descriptor.

```sh
starforge cache-operations serve \
  --state /private/cache-operations \
  --sources /private/cache-sources.json
```

The launcher prints the complete loopback URL. Keep its fragment token when opening it. A single writer owns a workspace directory; close its browser host before using the command line against that same directory. The API workspace owns its package's operating history until it closes.

## Command-line operation

`starforge cache-operations --help` lists every command. Commands print JSON containing record IDs, current workspace revision and the original operation result.

- `show` reads saved history; `inspect` reads current controls.
- `capture` saves the current inspection and advances the local workspace revision.
- `review` opens one saved snapshot.
- `prepare` saves an exact retention or invalidation request before execution.
- `apply` dispatches a prepared request; `recover` reconciles a pending request with the original manager.
- `compare` compares two snapshots from one source.
- `note` changes the operator's explanation while keeping the operation identity.
- `report` creates a standalone HTML operating report.
- `export` and `restore` transfer the complete saved workspace.

For example, first inspect the returned workspace revision and then capture a review:

```sh
starforge cache-operations show --state /private/cache-operations

starforge cache-operations capture \
  --state /private/cache-operations \
  --sources /private/cache-sources.json \
  --source merchant --revision 0 --label "Before retention change"
```

Prepare using the returned snapshot ID and current workspace revision. The retention JSON may contain a partial patch of these four fields:

```json
{"ttlMs":30000,"maxEntries":256,"maxBytes":8388608,"maxEntryBytes":1048576}
```

```sh
starforge cache-operations prepare \
  --state /private/cache-operations \
  --sources /private/cache-sources.json \
  --source merchant --inspection SNAPSHOT_ID --revision 1 \
  --route BINDING_ID --action configure --policy /private/retention.json

starforge cache-operations apply \
  --state /private/cache-operations \
  --sources /private/cache-sources.json \
  --id CHANGE_ID --revision 2
```

Use values returned by the preceding command. A concurrent browser edit advances the saved revision, and a direct cache change or seller restart changes the live review; refresh the relevant review before preparing another operation.

## Recovery and receiving

A change is saved as PREPARED, then marked PENDING before dispatch. A successful original receipt makes it APPLIED. A definite rejected review becomes REJECTED. A lost connection leaves the saved operation available for recovery.

Recovery first asks the original manager for that operation ID. An existing receipt completes the saved change without repeating the mutation. If the manager has no receipt and the exact inspected instance and revision still match, recovery resends the same command. A changed runtime requires a fresh review and new change.

The original manager retains up to 256 operation receipts in memory within its 8 MiB receipt budget. The workspace retains its complete durable operating history. This distinction permits useful recovery while making a restarted seller's identity explicit.

```sh
starforge cache-operations export \
  --state /private/cache-operations --out /private/cache-history.json

starforge cache-operations restore \
  --state /private/received-cache-operations \
  --archive /private/cache-history.json \
  --sources /private/receiving-sources.json
```

Restore requires an empty workspace and preserves its original identity, revision, snapshots, notes and operation IDs. Pending operations reconcile against the receiving host's configured source mapping. The receiver validates the source, snapshot, route and exact command references before accepting the archive. Export files are created privately and existing files remain intact.

## Maintained interfaces

- `model.mjs`: `openCacheWorkspace` with durable SQLite state and the original private-directory lock.
- `server.mjs`: `startCacheWorkspace`, an optional loopback host for the same operating UI.
- `http.mjs`: original SF61 and standalone host share assets and API dispatch.
- `reports.mjs`: saved-history HTML reports.
- `cli.mjs`: installed `cache-operations` command.
- `../control.mjs`: original runtime inspection, guarded changes and operation recovery.
- `../../../../../stellar-forge/mcp-merchant-operator`: merchant agent tools use the original SF82-owned runtime and these same controls.

Only retention settings are mutable here. Source admission, maximum response size, payment handling and credential acquisition remain owned by their existing runtime components. A policy change advances the cache generation so in-flight source work can finish for its existing consumers while the new policy starts with fresh retention.

Run `node acceptance.mjs` for the focused operating journey: original cache/control, saved policy review, interrupted-response recovery, receiving and the authenticated browser API. Node 22+ with its built-in SQLite support is required.

## Save observed policy in a merchant package

In the embedded API package workspace, **Save policy for restart** reviews selected routes from a saved operating snapshot and compiles a new package through the original merchant revision engine. Retained reviews reopen after a workspace restart. Saving again after a lost successful response recovers the same completed package. The saved revision carries its selected operating snapshot to the receiving host.

The existing command line exposes `policy-review`, `policy-list`, `policy-show` and `policy-save`. [Complete retained-policy workflow](../../../sf61-openapi-seller-import/workspace/CACHE_POLICY_REVISIONS.md).
