# Merchant receiving through the existing MCP operator

An agent can prepare a merchant's receiving accounts before deployment and
reopen the same saved work used by the receiving browser. The existing SF101
controller owns seller profiles, compiled payment choices, background reviews,
captured reads, comparisons and complete exports. This adapter supplies the
original merchant MCP's source selection, tool descriptions and lifecycle.

## Host setup

Use the installed merchant package and its existing Node/SDK environment.
Keep the connection file, seller configuration, optional asset/RPC maps and
captured exports private: owned regular files with mode 0600, under private
directories. Relative paths resolve beside the connection file.

Create a receiving connection, for example:

```json
{
  "schema": "stellar-forge.merchant-receiving-connection.v1",
  "directory": "./receiving-data",
  "profiles": {
    "store": {
      "label": "Store receiving accounts",
      "seller": "./seller.json",
      "rpc": "./rpc.json",
      "options": {
        "origin": "https://merchant.example",
        "timeoutMs": 12000,
        "feeOperations": 0
      }
    }
  },
  "imports": {
    "earlier-review": {
      "label": "Earlier complete receiving review",
      "file": "./receiving-export.json"
    }
  }
}
```

Omit unused profiles, imports, RPC maps and asset maps. A profile may also
declare `assets` and `options.proxyEnv`; the latter names an existing host
environment variable consumed by the original readiness transport. Use the
actual merchant's public origin and original seller configuration. This
connection contains paths and variable names; the MCP tools never select a
filesystem path, RPC endpoint, proxy value or executable.

For a merchant MCP configuration already in use, add
`"receivingConnection": "/absolute/private/receiving-connection.json"`.
The existing configuration's customer export directory must be private.
The normal `merchant-mcp init` forms also accept `--receiving`.

To prepare receiving work before configuring a running seller:

```bash
umask 077
npx --no-install starforge merchant-mcp init-receiving \
  --dir /absolute/private/merchant-operator \
  --receiving /absolute/private/receiving-connection.json
npx --no-install starforge merchant-mcp-stdio \
  --config /absolute/private/merchant-operator/merchant-mcp.json
```

The existing `merchant-mcp-client-config` command registers this same
configuration in a local MCP host. Existing authenticated HTTP
`merchant-mcp serve` also exposes the receiving tools. The release store,
seller, fleet, catalog, support and other configured merchant capabilities
remain available in that original operator.

## Prepare and review saved receiving accounts

1. Call `merchant_receiving_sources`. Inspect a selected profile with
   `{"kind":"profile","source":"store"}`. Retain its `sha256`, filenames,
   declared options and individual file digests.
2. Call `merchant_receiving_open`. This opens the original controller and
   resumes its retained queued reviews. `merchant_receiving_status` reports
   whether this process owns an open workspace, plus its active review,
   pending count and storage state.
3. Call `merchant_receiving_prepare` with the source alias, the exact
   `expectedSourceSha256`, and a new caller-retained `id`. The original
   controller freezes those inspected bytes and compiles the seller's actual
   payment choices. A repeated equal request returns that same profile.
4. Inspect `merchant_receiving_profiles` with the returned profile ID.
   It returns source identities and paged route/payment choices. Keep its
   exact `planDigest`.
5. Call `merchant_receiving_start` with a new retained review ID,
   `profileId`, `expectedPlanDigest` and `mode:"live"`. The original
   controller queues the native receiving review and returns its state
   immediately. Native network reads run in the controller's existing
   background job; they do not occupy the MCP mutation slot while waiting.
6. Read `merchant_receiving_reviews` with that review ID. A completed
   response contains the original summary, observation mode, completion time,
   source digest, account findings and relevant corrective actions. Inspect
   every returned page, using `nextOffset`.

Generate a caller-retained ID once per intended prepare, import or review and
save it before the tool call. The original format is a lowercase base36
time-like prefix of 8–13 characters, a hyphen, and 16 lowercase hexadecimal
characters. For example, an existing host can use:

```javascript
import { randomBytes } from 'node:crypto';
const id = Date.now().toString(36) + '-' + randomBytes(8).toString('hex');
```

Equal retries retain the original record; changed requests using the same ID
raise the original conflict. After an uncertain response, inspect the saved
ID before deciding whether another operation is needed.

## Replay, compare and cancel

`merchant_receiving_import` accepts an inspected host import alias, its
exact `expectedSourceSha256`, and a retained review ID. The source must be
the complete JSON export produced by the original receiving workspace. The
original controller checks its profile, seller plan, all six report/capture
files and manifest together, then returns the saved profile and review.

Start a replay with `mode:"replay"` and `captureReviewId`. The selected
profile must have the same original seller and plan as the capture. The
original evaluator consumes captured reads. It does not turn the earlier
observation into a new live observation.

Supply `previousReviewId` when starting a live review or replay to retain
the original comparison. Alternatively, call `merchant_receiving_compare`
with `previousId` and `currentId`. Matching uses the original complete
payment identity, so reordering options does not create a spurious change.
The output pages added, removed, changed and unchanged choices with resolved
and introduced account requirements.

`merchant_receiving_cancel` removes a queued job or requests cancellation
of an active job's reads. Read that same review ID for its terminal state.
Completed results retain their original outcome.

## Private export and handoff

Call `merchant_receiving_export` with a completed review ID and a host-safe
`exportId`. The original controller supplies its complete receiving JSON:
source files, saved profile, review record, original report/HTML/CSV, seller
plan, asset map, captured reads and manifest.

The adapter publishes `receiving-EXPORT_ID.json` in the configured
customer export directory by linking a fully written private staging file
without replacing an existing destination. It returns the filename, exact
bytes, SHA-256, native review identity and member digests. An equal retry
reads and reuses the existing complete file; a different review using that
export ID is rejected.

`merchant_receiving_export_status` verifies the embedded file bytes,
original manifest, profile metadata and retained review before returning its
digest. Use it to reconcile an interrupted export reply. The source payloads
stay in the private file; tool responses contain the requested review page
and transfer metadata. File distribution to another person remains a
separate action in the host's existing delivery workflow.

## Continue in the original browser

Call `merchant_receiving_close` to drain this process's receiving work
and release the original directory lease. Then open the same directory:

```bash
npx --no-install starforge merchant-readiness workspace \
  --directory /absolute/private/receiving-data --port 8408
```

The browser shows the same profiles, complete captures, reviews and exports.
Close that original browser server before `merchant_receiving_open`
reacquires its lease. The HTTP workspace handler can also embed an already
opened original controller; its caller retains controller ownership.

Merchant MCP shutdown waits for its admitted operation and drains its owned
receiving controller alongside the other original runtimes. Queued work
remains in the original store for reopening. A process interrupted during a
review is reconciled by the controller's existing completion/recovery logic.

## Limits and operating details

- Up to 32 configured profile aliases and 32 complete-import aliases.
- Each seller, asset map or RPC input is at most 1 MiB.
- Native timeout is 1–30 seconds per configured request; fee-operation
  estimate is an integer from 0 through 100,000.
- Saved-list cursors are original workspace IDs; selected profile, review
  and comparison pages use numeric offsets. Pages contain up to 50 rows and
  at most about 90 KiB of JSON. Complete private export handles larger rows.
- Complete import/export files are at most 144 MiB, including the original
  base64 representations. Larger saved captures consume the original
  controller's corresponding memory during export.
- The existing stdio transport's request cancellation retires its wait;
  `merchant_receiving_cancel` is the explicit native review cancellation.
  A lost transport response retains the original saved operation identity.

Implementation: `receiving.mjs` composes
`sf101-merchant-account-readiness/workspace/controller.mjs`;
`config.mjs`, `operator.mjs` and `serve.mjs` supply the existing
provider's configuration, registration, initialization and owned shutdown.
