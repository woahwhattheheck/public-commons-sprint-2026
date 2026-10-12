# Embedded merchant operator

Use [Merchant operator in Applications](APPLICATIONS.md) to save the original configuration, connect its installed runtime, and manage Open, Stop and reopening with the same console workspace.

The operator console adds a durable browser workspace to the existing authenticated merchant host. It uses the configured tool catalog, the original provider operations, the original authorization and the existing customer file reader. Applications remains the authority for selecting and starting a merchant profile.

The console contains five working areas:

| Area | Work completed there |
| --- | --- |
| Host | Inspect the configured capabilities, request capacity, provider load states and host identity. Request native status explicitly. |
| Tools | Search the actual configured catalog, keep favorites, review each tool's schema and save named immutable request revisions. |
| Requests | Run an exact saved revision, retain the native return, reopen earlier revisions, recover an original operation and download its exact JSON. |
| Workflows | Arrange saved native requests into complete operations with input bindings, required results, durable progress, original recovery and named receiving ownership. |
| Customers | Receive an original seller-generated client, retain partial progress, resume the same reviewed export and download its verified files or original archive. |

## Open the existing host

Use the original merchant configuration and its existing access-token environment. Supply a private, owned console directory when starting that same host:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/merchant/merchant-mcp.json \
  --port 3211 \
  --token-env MCP_ACCESS_TOKEN \
  --operator-console-dir /private/merchant/operator-workspace
```

The listener record includes `consoleUrl`, such as `http://127.0.0.1:3211/operator/`. Open that address and connect with the merchant token. The page keeps the token in memory. An existing launcher may pass the original token in the URL fragment `#token=...`; the page removes the fragment before opening its workspace.

The same option is available to an existing Applications integration:

```js
const session = await startMerchantMcp({
  configPath: '/private/merchant/merchant-mcp.json',
  consoleDirectory: '/private/merchant/operator-workspace',
  port: 0,
  environment
});

console.log(session.consoleUrl);
// Keep the existing Applications owner, process handle and stop action.
await session.close();
```

`consoleDirectory` is optional. A headless merchant keeps its original startup and MCP interface. The console uses the same loopback server and original OAuth-resource or fixed-bearer authorization. Existing OAuth subjects remain in the original shared operator workspace, with native tool authorization checked on calls, history reads, exports and customer file access.

The installed `starforge-merchant-mcp` command forwards the same `serve` arguments. Use the existing installed command when Applications already owns that package.

## Inspect the configured host

Opening the Host page calls the synchronous `operator.inspectHost()` snapshot. It returns the configured tools and providers without importing or constructing provider implementations. The snapshot includes:

- The merchant name, configured tool families and exact native request-byte capacity.
- Provider states and measured load duration for implementations already opened by this owner.
- The original release-source aliases.
- Active accepted calls, host shutdown state and the currently owned seller instance.
- A SHA-256 identity of the normalized configuration. The browser also receives the original configuration file's basename, byte count and SHA-256.

The **Inspect native status** button saves and runs the original `merchant_status` tool. That explicit operation retains the full native status return and can load the configured status providers. Refreshing the lightweight host snapshot uses no native status call.

The configuration fingerprint is stable across a listener-port change. Moving or changing the configured source, workspace or release-store identity changes the fingerprint. A saved profile can be explicitly bound to the newly displayed host revision; the prior binding remains in its retained metadata.

## Save, run and recover requests

Create a named profile, select a configured tool and review its actual input schema. The JSON editor contains native arguments. Existing `requestId`, workspace alias, release ID, expected digest, selection generation and file-read IDs retain their original meanings.

**Save revision** writes an immutable draft revision. Editing a saved draft requires its current revision; a concurrent change returns `CONSOLE_REVISION_CONFLICT`. **Save as new draft** creates another independently named request. A saved call always refers to its exact draft revision, including older revisions.

**Run saved revision** reserves a console call ID before entering the original operator. The reservation includes the tool-definition digest, exact argument JSON, argument SHA-256, original host binding and request digest. A repeated reservation with the same ID and exact input returns the original record. Reusing that ID with different input returns `CONSOLE_REQUEST_CONFLICT`.

The original tool performs its own source validation, generation checks, native idempotency and concurrency handling. The console records the returned value once as exact JSON text and retains its SHA-256. The browser's readable preview is separate from the **Download returned JSON** bytes.

Accepted requests appear immediately in Requests. A browser reconnect reads the existing record. If the host ended before it retained a native return, the record shows **RETURN_PENDING**. The recovery picker selects original read operations from the same configured family whose required identifiers are present in that call. It prepares a linked draft using those original identifiers. Review, save and run that original read to reconcile the native operation.

## Complete saved workflows

[Saved merchant workflows](WORKFLOWS.md) covers the full stage, activate, start, customer generation, manifest, stop and status operation. Add immutable saved request revisions in their execution order, bind actual inputs or earlier native results, select required result values and save the complete workflow edition.

A run retains its original input object, workflow digest, native call IDs and ordered events. **Pause after current request** lets the current accepted native request return before stopping progress. **Continue same run** reopens the same run. Lost browser Start or Handover responses use their displayed durable original action; unfinished native calls use the existing linked recovery requests in **Requests**.

An unfinished run can be handed to a named console workspace and host after its current owner releases it. Importing the complete post-handover profile extends that receiver's verified history. The receiving owner can later hand the same run back with all native calls and events preserved. The guide explains the exact lifecycle checkpoints, current host binding and original provider state required for that transfer.

## Receive an original customer

Customer receiving composes the maintained retained-file transport and SF82 customer archive encoder:

| Original authority | Native customer tools |
| --- | --- |
| Merchant release store | `merchant_client_export_manifest`, `merchant_client_export_file`, `merchant_client_export_file_release` |
| OpenSearch workspace deployment | `merchant_opensearch_deployment_manifest`, `merchant_opensearch_deployment_file`, `merchant_opensearch_deployment_file_release` |

For OpenSearch, select the configured workspace alias. Its original per-alias deployment store remains authoritative. Use the export ID and manifest SHA-256 returned by the original merchant. A compatible returned request can prefill those identities through **Receive this customer**.

The adapter calls the original manifest reader, verifies each native file chunk against the reviewed export and preserves the existing Linux file lease, partial-file checkpoint and read-ID recovery. Pausing records the durable prefix. Resuming the same selection continues those original files. A restarted listener can use a new port because the local adapter binds the original host fingerprint and provider/workspace identity.

A completed customer contains the original five SDK payloads and the original completion manifest. Concurrent archive responses reuse that customer's original reader owner and its existing concurrency limit. The console retains accepted HTTP handlers through shutdown and cancels incomplete request bodies. Authorization completion rechecks native mutation admission before creating an operation. A disconnected archive finishes through its original response framing. Host close enters the original archive cancellation/drain, retains failed owner handles for a same-instance retry and waits for those responses before closing the operator database. Individual downloads verify the exact file identity again. **Download original customer archive** streams the existing SF82 `.tar.gz` encoder over those retained files. The generated client, OpenAPI definition and original provenance remain intact.

The console's customer receiving action reads an existing generated export. Generate, adopt or recover that export through the original configured merchant or deployment tools. The same console can prepare those native tools as saved requests.

## Export and reopen operator work

**Export profile** produces a single `stellar-forge.merchant-operator-profile.v1` JSON archive containing:

- The named profile, favorite tools and original host binding.
- Every immutable saved draft revision.
- Original call IDs, exact arguments, exact returned JSON and their digests.
- Customer selection, receiving status and original file identities.
- Immutable workflow editions, complete run inputs, native step references, progress and owner-release events.

The archive has a canonical content SHA-256 and is captured in one SQLite transaction across the complete profile. Import validates the full packet, original draft-to-call and workflow references, identifiers, exact timestamps, state transitions and all retained JSON hashes before an atomic transaction. Receiving the same original archive again reopens its imported record.

A compatible later archive extends the same profile's immutable revisions, calls and contiguous workflow-event history. It preserves the receiving workspace's local profile settings, host binding and verified customer files. Conflicting immutable source, finalized returns or divergent workflow history are rejected. [Named workflow handover](WORKFLOWS.md#hand-over-a-paused-run-and-return-it) uses this receiving path to review, transfer and return unfinished work.

The profile archive preserves operator history. The complete customer archive contains the received customer files. Existing Applications and provider backup/reopen commands remain the authority for the underlying native provider workspaces.

Keep the private console directory to reopen the same operator database and partial customer downloads. The database uses SQLite WAL and full synchronization. It retains local identity independently of a process or listener. Imported histories retain their original workspace identity and stay distinguishable from calls accepted by the current workspace.

## Host integration contract

`createMerchantConsole({ operator, configPath, directory, authorization, bearerToken })` returns:

| Member | Behavior |
| --- | --- |
| `handler(req, res)` | Handles `/operator/` and its authenticated API; returns false for unrelated paths. |
| `snapshot()` | Pure configured-host snapshot with the current console identity. |
| `startCall(input, context)` | Reserves an exact native request and retains its original asynchronous return. |
| `store` | Original private profile/request SQLite store. |
| `workflows` | Saved workflow definitions, original run driver, recovery and receiving controls over that store. |
| `beginClose()` | Stops new calls, requests workflow pauses and pauses original customer transfers at retained checkpoints. |
| `close()` | Waits for accepted native returns and closes its own store after the original owner begins cancellation/drain. |

`startMerchantMcp()` owns the shared listener. On close, it refuses new interface requests, requests workflow pauses, pauses customer transfers at their original checkpoints and starts the existing merchant owner's cancellation/drain immediately. It waits for workflow drivers, accepted native returns and customer cleanup before closing the interface database and original authorization. The console never replaces the provider lifecycle or closes a separate seller owner.

The API uses the native host request capacity for saved and executed requests. The exact MCP call envelope is checked again before native dispatch, including calls imported from a profile archive. The separate history-import route accepts a complete archive up to 128 MiB; importing a history does not run its saved tools.

Static assets use the original loopback host, same-origin requests and a restrictive content-security policy. There are no external scripts, fonts or image dependencies.

## Source layout

- `records.mjs`: shared canonical JSON, hashes and original record validation.
- `store.mjs`: private profiles, immutable revisions, exact calls, customer records and atomic archive receiving.
- `workflow-records.mjs`, `workflows.mjs`: saved workflow editions, original request guards, progress, recovery and receiving ownership.
- `service.mjs`: authenticated API and original native dispatch.
- `customers.mjs`: original retained download and SF82 archive composition.
- `public/index.html`, `public/app.mjs`, `public/workflows.mjs`, `public/style.css`: the industrial browser interface and durable original workflow actions.
- `../operator.mjs`: pure configured-host snapshot and original operator lifecycle.
- `../serve.mjs`: opt-in same-listener startup and existing authorization.

## Complete native receiving

The maintained receiver uses the original SF61 example source, original merchant stage/selection/start, the original seller-generated five-file client and the actual browser interface. It retains native request IDs, checks the complete customer archive, closes the owned seller, reopens the same operator history and imports its exact portable profile into another private console directory.

```sh
node stellar-forge/mcp-merchant-operator/receiving/console-journey.mjs \
  --directory /private/receiving/merchant-console \
  --chromium /absolute/path/to/chromium \
  --playwright-module /absolute/path/to/playwright \
  --source-commit REVIEWED_SOURCE_COMMIT
```

Use Node 24 and the existing Chromium/Playwright installation. The output retains `console-native-run.json`, the exact profile archive, the original customer `.tar.gz`, browser views and the original merchant/console workspace. A completed receiving directory returns its existing result on a repeated invocation.


The complete saved-workflow receiver is `receiving/workflow-journey.mjs`. Its [native receiving instructions](WORKFLOWS.md#run-the-complete-native-receiving-workflow) cover the original seven-step merchant operation, browser action recovery, named workspace transfer and return, complete profile receiving and customer files. Use its selected source and existing native runtime for that original operation.
