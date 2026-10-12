# Embedded merchant operator

Use [Merchant operator in Applications](APPLICATIONS.md) to save the original configuration, connect its installed runtime, and manage Open, Stop and reopening with the same console workspace.

The operator console adds a durable browser workspace to the existing authenticated merchant host. It uses the configured tool catalog, the original provider operations, the original authorization and the existing customer file reader. Applications remains the authority for selecting and starting a merchant profile.

The console contains four working areas:

| Area | Work completed there |
| --- | --- |
| Host | Inspect the configured capabilities, request capacity, provider load states and host identity. Request native status explicitly. |
| Tools | Search the actual configured catalog, keep favorites, review each tool's schema and save named immutable request revisions. |
| Requests | Run an exact saved revision, retain the native return, reopen earlier revisions, recover an original operation and download its exact JSON. |
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

## Receive an original customer

Customer receiving composes the maintained retained-file transport and SF82 customer archive encoder:

| Original authority | Native customer tools |
| --- | --- |
| Merchant release store | `merchant_client_export_manifest`, `merchant_client_export_file`, `merchant_client_export_file_release` |
| OpenSearch workspace deployment | `merchant_opensearch_deployment_manifest`, `merchant_opensearch_deployment_file`, `merchant_opensearch_deployment_file_release` |

For OpenSearch, select the configured workspace alias. Its original per-alias deployment store remains authoritative. Use the export ID and manifest SHA-256 returned by the original merchant. A compatible returned request can prefill those identities through **Receive this customer**.

The adapter calls the original manifest reader, verifies each native file chunk against the reviewed export and preserves the existing Linux file lease, partial-file checkpoint and read-ID recovery. Pausing records the durable prefix. Resuming the same selection continues those original files. A restarted listener can use a new port because the local adapter binds the original host fingerprint and provider/workspace identity.

A completed customer contains the original five SDK payloads and the original completion manifest. Concurrent archive responses reuse that customer's original reader owner and its existing concurrency limit. Host close enters the original archive cancellation/drain, retains failed owner handles for a same-instance retry and waits for those responses before closing the operator database. Individual downloads verify the exact file identity again. **Download original customer archive** streams the existing SF82 `.tar.gz` encoder over those retained files. The generated client, OpenAPI definition and original provenance remain intact.

The console's customer receiving action reads an existing generated export. Generate, adopt or recover that export through the original configured merchant or deployment tools. The same console can prepare those native tools as saved requests.

## Export and reopen operator work

**Export profile** produces a single `stellar-forge.merchant-operator-profile.v1` JSON archive containing:

- The named profile, favorite tools and original host binding.
- Every immutable saved draft revision.
- Original call IDs, exact arguments, exact returned JSON and their digests.
- Customer selection, receiving status and original file identities.

The archive has a canonical content SHA-256. Import validates the full packet, original draft-to-call references, identifiers, timestamps, state transitions and all retained JSON hashes before an atomic SQLite transaction. Receiving the same original archive again reopens its imported record. Conflicting original IDs require a separate operator workspace.

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
| `beginClose()` | Stops new console calls and pauses original customer transfers at retained checkpoints. |
| `close()` | Waits for accepted native returns and closes its own store after the original owner begins cancellation/drain. |

`startMerchantMcp()` owns the shared listener. On close, it refuses new interface requests, pauses customer transfers at their original checkpoints and starts the existing merchant owner's cancellation/drain immediately. It waits for the accepted native returns and customer cleanup before closing the interface database and original authorization. The console never replaces the provider lifecycle or closes a separate seller owner.

The API uses the native host request capacity for saved and executed requests. The exact MCP call envelope is checked again before native dispatch, including calls imported from a profile archive. The separate history-import route accepts a complete archive up to 128 MiB; importing a history does not run its saved tools.

Static assets use the original loopback host, same-origin requests and a restrictive content-security policy. There are no external scripts, fonts or image dependencies.

## Source layout

- `store.mjs`: private profiles, immutable revisions, exact calls, customer records and atomic archive receiving.
- `service.mjs`: authenticated API and original native dispatch.
- `customers.mjs`: original retained download and SF82 archive composition.
- `public/index.html`, `public/app.mjs`, `public/style.css`: the industrial browser interface.
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
