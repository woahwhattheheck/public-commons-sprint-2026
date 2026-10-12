# Native Redis-to-Valkey application receiving

This companion runs the original commissioning, paired cutover, saved workspaces and generated customer application against **two actual native engines**. The first engine is Redis OSS. The second must identify itself as Valkey through its native `INFO server` response.

The receiving operation uses one owned source edition and all six supported products. It preserves the original Redis snapshot, both complete source inputs, original SQLite workspaces, every preview/page, useful comparison files, prepared customer packages, retained releases and complete customer responses.

## Equipment and source

Run `native-cutover.mjs` from the same complete installed Starforge source as its sibling `cutover.mjs`, `commission.mjs`, `customer-export.mjs` and `model.mjs`. The maintained distribution also supplies the existing seller/buyer and release modules imported by this companion. Reuse an equipped worker's installed dependencies.

Required equipment:

- Node.js 24 with the original SQLite-backed workspace support.
- The maintained `@redis/client@6.2.1` dependency.
- A native Redis OSS executable, version 7.0 through 7.2.
- A distinct native Valkey executable that reports `server_name=valkey` and `valkey_version`.
- A private writable working parent for engine files, SQLite workspaces, packages and complete customer exports. Preserve that directory through the receiving carrier's finalizer.

The original source uses ACL-restricted EVAL_RO, which requires Redis 7 or later; the RDB receiving range for this complete product is therefore Redis 7.0–7.2.

The receiving code takes explicit engine paths. It does not download a server, choose a different engine, or modify an existing deployment. Each invocation starts two fresh loopback-only servers in new private directories, generates temporary independent reader credentials, and stops its own children before the final cold reopen.

Valkey's migration documentation identifies Redis OSS 7.2 and earlier RDB/AOF files as compatible and documents the native SAVE/copy/load procedure. It also explains that `redis_version` is a compatibility field: identify actual Valkey with `server_name` and `valkey_version`.

Original sources:

- https://valkey.io/topics/migration/
- https://valkey.io/download/releases/v8-1-10/
- https://docs.percona.com/valkey/migration.html

One available official binary edition is Valkey 8.1.10 for Ubuntu Jammy x86-64:

- https://download.valkey.io/releases/valkey-8.1.10-jammy-x86_64.tar.gz
- https://download.valkey.io/releases/valkey-8.1.10-jammy-x86_64.tar.gz.sha256

An equipped receiver should read and verify the publisher's complete checksum before extracting that chosen release. Select the correct binary for the actual worker architecture and platform. The runner records the installed executable bytes/SHA256 and the native engine identity it actually opened.

## One complete run

Choose a **new** output directory whose parent already exists:

~~~sh
node sf30-seller-sdk/redis/workspace/native-cutover.mjs run \
  --directory /private/receiving/redis-valkey-cutover-001 \
  --redis-server /installed/redis/bin/redis-server \
  --valkey-server /installed/valkey/bin/valkey-server
~~~

The CLI also accepts existing `REDIS_SERVER` and `VALKEY_SERVER` environment selections when their corresponding flags are omitted. It emits phase progress on stderr and the complete final result on stdout. The final result names `retainedWorkDirectory` for the existing compute receiver.

The fixture's two servers use separate local ports, database 2, a 64 MiB memory limit, a private administrator credential and a source reader restricted to declared `merchant:*` keys and original read commands. These temporary values stay in the receiving process or owner-private files; source inputs retain named environment references.

## What the operation does

1. Start actual Redis and record its native identity. Seed one six-key application edition: a binary availability value, projected catalog with the exact integer `9007199254740993`, ranked members, original stream IDs/fields, an ordered list with duplicate/binary/empty values, and a native member set.
2. Call Redis SAVE, preserve the complete original RDB, copy those exact bytes into the new Valkey data directory and start Valkey from it. Confirm the file identity, actual Valkey version and six loaded keys.
3. Make three deliberate candidate changes: a catalog atomic price, one duplicate list position and one set member. Receive both original commissioning operations. Keep the complete `CONTRACT_MISMATCH`, original pages and useful ordered/member differences; the candidate has no accepted package or release.
4. Correct those physical candidate values and receive a separately named corrected operation. The first operation retains its original observations. Both sources now traverse the full six-product contract; ranking, streams, lists and sets all exercise native continuations. The set comparison uses membership while preserving native page order, duplicate visits and exact textual cursors.
5. Prepare both original customer packages and retain their complete file identities. Stage the matched candidate through the original cutover operation and the received baseline through its original workspace stage operation.
6. Run each original retained seller and its actual generated customer client. The shared customer exporter buys every selected page through the existing native buyer/response-file path, retaining full response bytes and explicit per-call/aggregate budgets. Compare every exported product against the same engine's original source observations and against the other engine's application results.
7. Stop both original sellers and owned engine children, then reopen the original cutover and customer files. The corrected operation still matches; the earlier mismatching operation still shows its three original differences. Customer reopen uses retained files and makes no new buyer call.

The payment portion uses the same local x402 protocol facilitator fixture as the original merchant journey. Each actual client delegation has a retained original intent, complete returned response and native verify/settle count. The result records that selected facilitator mode explicitly.

## Retained outputs

`native-cutover.json` contains the complete run identity, runtime and engine versions, exact binary/snapshot hashes, named phases, original workspace bindings, customer manifests, payment-call counts, owned-process closure and cold receiving result.

The directory also includes:

- `redis-data/dump.rdb`: the original Redis source edition.
- `valkey-data/dump.rdb`: the exact snapshot loaded by Valkey.
- `redis-data/identity.json` and `valkey-data/identity.json`: installed binary/native server identity.
- `mismatch-input.json` and `corrected-input.json`: original complete contracts with separate operation IDs.
- `mismatch/`: both original workspaces, full saved previews, receiving reports and six difference files.
- `corrected/`: both complete workspaces, customer packages, original releases and six corrected comparison files.
- `corrected/baseline-customer-responses/` and `corrected/candidate-customer-responses/`: complete response JSON files and the original shared exporter manifests.

A failed run preserves its original directory and writes `native-cutover-error.json` with the completed phases and concrete error. Resolve the owning source/fixture issue against those files. A fresh full run uses a new directory and original operation; the previous receiving remains available.

Engine server configurations contain only temporary fixture credentials and are removed after their owned process closes. The original source/package files retain environment variable names.

## Cold receiving

~~~sh
node sf30-seller-sdk/redis/workspace/native-cutover.mjs status \
  --directory /private/receiving/redis-valkey-cutover-001
~~~

This invokes the existing saved cutover comparison and complete customer-file inspector. It reopens both original workspaces, every complete package/customer file and the original mismatching edition. Redis and Valkey can remain stopped.

Programmatic use:

~~~js
import { runRedisValkeyCutoverJourney, inspectRedisValkeyCutoverJourney } from './native-cutover.mjs';

const result = await runRedisValkeyCutoverJourney({
  directory: '/private/receiving/new-original-operation',
  redisServer: '/installed/redis/bin/redis-server',
  valkeyServer: '/installed/valkey/bin/valkey-server',
  onProgress: phase => originalJobProgress(phase),
});
const reopened = await inspectRedisValkeyCutoverJourney({ directory: result.directory });
~~~

## Customer commissioning

Use `CUTOVER.md`, `COMMISSIONING.md` and `CUSTOMER_EXPORT.md` for the selected customer's actual source pair, application terms and buyer. This companion supplies a complete two-engine product receiving operation; the customer's editable cutover input identifies its own approved source edition/window, connection profiles, expected results and acceptance operator. The Percona workshare consumes those existing product APIs and preserves its original company case and contact.
