# Embed the authorization connection SDK

The installed package exposes the maintained OAuth implementations through typed
ESM paths:

| Import | Runtime implementation | Declaration |
| --- | --- | --- |
| `@tokenjunkielabs/starforge-merchant/seller/oauth-connections` | `connection.mjs` | `connection.d.mts` |
| `@tokenjunkielabs/starforge-merchant/seller/oauth-connections/profile` | `profile.mjs` | `profile.d.mts` |
| `@tokenjunkielabs/starforge-merchant/seller/oauth-connections/host` | `host.mjs` | `host.d.mts` |
| `@tokenjunkielabs/starforge-merchant/seller/oauth-connections/provider` | `provider.mjs` | `provider.d.mts` |
| `@tokenjunkielabs/starforge-merchant/seller/oauth-connections/quickbooks` | `quickbooks.mjs` | `quickbooks.d.mts` |

Use TypeScript's `NodeNext` module and module-resolution settings in an ESM
consumer. The package's existing conditional exports select `types` for
TypeScript and `import` for Node. The distribution copies the original source
and declarations without a generated wrapper or second OAuth implementation.

## Use the embedding example

`examples/embedding.mts` is a complete ownership function for an existing
operator application. Copy it into the host's TypeScript source and compile it
with that host's build. The packaged example is source, not a new executable
export. It initializes the exact reviewed public profile, opens
the original trusted alias registry, obtains and reviews a grant when needed,
passes the current compiled binding to the host's application code, and drains
the original registry when the callback finishes.

Supply the host's existing command journal and operator UI as the two small
interfaces in the example. This keeps the host's actual recipient, reviewer,
request recovery and HTTP-session ownership in one place:

- `HostCommandJournal.retain` durably records the unchanged command before any
  dispatch and rejects different input under the same request ID.
- `HostCommandJournal.complete` stores the exact returned public receipt.
- `HostInteraction.authorize` opens the returned authorization URL for the
  operator and resolves with the actual callback `URLSearchParams`.
- `HostInteraction.review` shows the exact source, profile, scopes, refresh
  availability and token expiry, then returns the real reviewer or `null`.
- `HostInteraction.commandProblem` keeps the running owner available while the
  operator chooses an unchanged retry or preserves the pending command.

The callback listener must already be running on the exact registered
`http://127.0.0.1:PORT` origin. The example adds the current profile's
`callbackPath`; the core checks that exact URI, protocol state, issuer and
duplicate query values. Provider endpoints remain public HTTPS unless the
host explicitly enables the original literal-loopback development option.
The example does not start a listener or replace the application's operator
authentication and request validation.

Pass the actual original OpenAPI bytes as `sourceBytes`, along with the
selected original scheme, resource origin and required scopes. The example
hashes those bytes before provisioning. A new source profile receives a new
explicit alias/private store; it does not overwrite the old store.
Other aliases in the same host configuration must already be provisioned; the
example initializes only the selected one before opening the complete registry.

A host call has this shape:

```ts
import { withReviewedSourceConnection } from './embedding.mjs';

const outcome = await withReviewedSourceConnection(
  {
    connectionsFile: hostConfiguration.oauthConnectionsFile,
    alias: selectedSource.oauthAlias,
    env: hostEnvironment,
    profile: selectedSource.reviewedOAuthProfile,
    sourceBytes: selectedSource.originalBytes,
    sourceScheme: selectedSource.securityScheme,
    resourceOrigin: selectedSource.resourceOrigin,
    requiredScopes: selectedSource.requiredScopes,
    callbackOrigin: existingCallbackListener.origin,
    journal: existingOperatorJournal,
    interaction: existingOperatorUI,
  },
  async ({ binding, registry, alias, run }) => {
    // Feed this raw reference to the maintained application compiler.
    // Preserve the original selected routes, prices, headers and policies.
    const saved = await applicationCompiler.saveSelectedSource({
      ...selectedSource.plan,
      oauthAlias: alias,
      oauthConnection: binding,
    });
    const current = await registry.status(alias);
    await existingOperatorUI.showSavedApplication(saved, current);
    return saved;
  },
);
```

The application-specific objects in this call are the receiving host's existing
implementations. The example's exported interfaces describe their exact OAuth
boundary; they are not additional services to deploy. A saved application's
reference must be reselected/recompiled when the reviewed grant changes. Use
the original SF30 upstream provider to call the resource; the example does not
replay backend requests or handle payment settlement.

## Keep command and provider outcomes distinct

Every `approve`, `refresh`, `disconnect` and `revoke` call returns an
`OAuthCommandReceipt` when its result is recorded. Read both the grant and
`receipt.operation.state`: a fulfilled promise can record `failed`,
`reconnect_required` or `superseded`. The exact receipt may describe an older
revision on replay, so read `registry.status(alias)` separately for current
state.

`executeRetainedCommand` returns three different receiving outcomes:
`receipt`, `command_error`, and `receipt_not_recorded`. The last means the
original core returned a receipt but the receiving host could not record it.
Resubmit the unchanged command to recover its original receipt; do not invent
a new request ID or substitute the latest revision. Retention failure before
dispatch throws without calling the connection.

An error is caught as `unknown`. Core errors may expose `code` and `status`;
host registry errors expose a local `code` without an HTTP status.
`OAUTH_CONNECTION_SAVE_UNKNOWN` identifies an uncertain save even when an
approval error lacks the optional `outcomeUnknown` field. Keep arbitrary
errors private; serialize only the host's chosen safe code/message projection.

Begin and callback exchange are tied to the current open connection instance.
Their authorization code, PKCE verifier and unapproved token remain in that
instance. Closing the registry ends those flows. A completed durable approval
can be recovered by replaying its exact command after reopening; an unfinished
flow after process loss requires a new authorization. Do not automatically
replay a code exchange. The example waits for the explicit operator retry
decision before closing, so an in-process approval retry retains its flow.

## Explicit renewal, disconnect and cleanup

Inside the example's `use` callback, the original registry and retained
dispatcher remain available. Renewal uses the current exact grant:

```ts
const current = await registry.status(alias);
if (current.grant.state !== 'connected' || !current.grant.id)
  throw new Error('A reviewed connection is required.');
const renewal = await run({
  alias, action: 'refresh',
  args: {
    expectedRevision: current.revision,
    expectedGrantId: current.grant.id,
    requestId: crypto.randomUUID(),
  },
});
// Display renewal.receipt.operation.state when kind === 'receipt'.
```

For a user-requested disconnect, retain the same current revision/grant and
supply an explicit `revoke: true` or `false`. Local disconnect is saved before
a requested remote call. A lost remote response keeps its cleanup row; it
does not restore local access or claim confirmed revocation.

A later retry selects that exact retained cleanup:

```ts
const current = await registry.status(alias);
if (current.grant.state !== 'disconnected')
  throw new Error('Disconnect local use before retrying remote cleanup.');
const selectedCleanup = current.revocations.find(row => row.grantId === chosenGrantId);
if (!selectedCleanup) throw new Error('The selected cleanup is not retained.');
const cleanup = await run({
  alias, action: 'revoke',
  args: {
    expectedRevision: current.revision,
    expectedRevocationGrantId: selectedCleanup.grantId,
    requestId: crypto.randomUUID(),
  },
});
```

Reconnecting does not erase older cleanup rows. Remote retry remains unavailable
while a new local grant is connected, because a provider may revoke a related
token family. The connection's `close()` drains and releases its owner; it
does **not** disconnect the committed grant. Explicitly disconnect only when the
operator requested that state change.

## Safe status and private runtime credentials

Public status includes the normalized profile, reviewed grant identity,
nullable access/refresh expiries, generation, safe history and retained
revocation metadata. A missing expiry is `null`, not an invented duration.
`status({flowId})` adds safe flow metadata. Registry list/status also add
the configured alias and environment **name**, never the resolved private path.

`getOAuthAccessToken` is a separate server-only export. Its result deliberately
contains a bearer token and is typed `OAuthPrivateAccessToken`; it is not part
of any public status or workspace response. The original upstream provider
uses the pinned profile/grant/scopes/secret references and owns token caching
and renewal. A resource's first rejected bearer is not an automatic backend
replay; the original caller observes that response before a later request uses
a renewed credential.

The core's `discard` is synchronous. Registry `discard` is asynchronous
because it first rechecks the alias's private directory identity. Both core and
registry `close` return promises and wait for their owned exchanges/saves.


## Native QuickBooks company and accounting owner

The typed `@tokenjunkielabs/starforge-merchant/seller/oauth-connections/quickbooks` export connects this registry to the original native QuickBooks accounting controller. Use `previewQuickBooksSelection({registry,...reviewedIdentity})` to read CompanyInfo, Preferences and all Account pages, then `saveQuickBooksSelection(directory,{registry,selection,previewSha256,expectedSelectionSha256})` to persist the reviewed company.

`openQuickBooksOAuthClient({registry,selection,...runtime})` returns the original native client and an owned token provider. Inject its `client` into `startAccountingWorkspace({...,qboClient:client})`. Drain accounting before closing that client owner, and retain the original host's ownership of a shared registry. The integrated `startQuickBooksAccountingWorkspace` launcher performs these steps and exposes the actual original runtime as `accounting`.

The full [QuickBooks guide](./QUICKBOOKS.md) covers registered callbacks, consent, persistent company selection, automatic grant renewal, native posting recovery, and complete CLI/SDK examples.

## Connect an existing protected-resource application

The installed `/seller/oauth-connections/provider` path exports
`createOAuthConnectionProvider(binding, runtimeOptions)`. It is the same
provider used by the original SF30 handlers. Construction compiles the public
binding and selects the named host directory; private grant reads and token
requests begin when the application asks for headers.

`examples/embedding.mts` also exports `withReviewedResourceConnection`. It
performs the same original provision, consent and grant-review flow, then gives
the host callback a `credentialProvider` alongside its registry, binding and
retained-command dispatcher. Consent and renewal use one initial environment
snapshot.

```ts
import { withReviewedResourceConnection } from './embedding.mjs';

const outcome = await withReviewedResourceConnection(hostOptions,
  async ({ credentialProvider, binding, registry, alias, run }) => {
    // These receiving-host interfaces belong to the existing application.
    const application = await existingApplication.open({
      binding,
      credentialProvider,
      onConnectionCommand: run,
    });
    try {
      return await existingOperatorUI.operate({
        application,
        connection: () => registry.status(alias),
        provider: () => credentialProvider.snapshot(),
      });
    } finally {
      await application.close(); // Drain resource requests before leaving this callback.
    }
  });
```

The helper drains the credential provider after the application callback
settles, then drains the original registry. A primary operation failure and a
later shutdown failure remain visible together. The callback must not return a
still-running application that keeps using the provider.

The private request seam is `await credentialProvider.headers({signal})`,
returning an `authorization` header for the selected grant. Send it only to the
original selected resource. Read `snapshot()` for operator status; the header
is not a status response or export. `generation()` belongs to this provider
instance and changes on acquired credentials, invalidation and close; it is
not the saved grant's generation.

After a resource rejects a bearer, call
`invalidate(rejectedAuthorization)` with the exact rejected header. A later
application request can obtain a renewed credential. Invalidation performs no
resource request and does not repeat the rejected operation. Original payment,
idempotency and business-operation recovery remain with the receiving
application.

## Host-owned transport and shutdown

`OAuthConnectionOptions`, `OAuthRegistryOptions` and
`OAuthConnectionProviderOptions` accept an optional Node HTTP(S) `agent`.
Original connection options reach code exchange, explicit and automatic
renewal, and remote revocation. The host registry forwards the same runtime
option to every selected connection. `SourceHostOptions.agent` supplies it to
both registry and provider in the embedding lifetime.

The Agent is a trusted host implementation whose protocol must match the
selected endpoint. Keep the object, proxy values, sockets and credentials in
that host. Profiles, host-connection files, bindings, browser plans, saved
connection records and public snapshots keep their existing serializable
schemas.

The caller owns the Agent. The registry and provider do not destroy a borrowed
transport. Keep it alive through application requests, provider renewal and
connection shutdown, then destroy it after the embedding promise settles:

```ts
try {
  return await withReviewedResourceConnection({
    ...hostOptions,
    agent: existingHostTransport,
  }, operateExistingApplication);
} finally {
  existingHostTransport.destroy();
}
```

Omitting `agent` retains the original direct transport. The optional `lookup`
hook remains a runtime function. Direct connections retain the original
address policy; endpoint, TLS, response-size, timeout and credential-state
rules remain in the maintained OAuth transport. The original SF30 upstream
launcher selects configured egress through trusted host configuration; neither
this example nor an operator request body chooses a proxy.

## Native Xero tenant and accounting owner

The typed `@tokenjunkielabs/starforge-merchant/seller/oauth-connections/xero` export uses this maintained registry and provider to discover the actual native connection array and retain an explicit connection ID / tenant ID choice. `previewXeroSelection` captures the selected original Organisation and Accounts responses; `saveXeroSelection` seals their review under the original lock with an expected prior selection identity.

`openXeroOAuthClient({registry,selection,...runtime})` returns the existing native Xero client for `startAccountingWorkspace({...,xeroClient:client})`. It forwards the optional borrowed `agent` to the original OAuth owner and accepts the trusted native resource `fetchImpl` separately. Close accounting first, then the native client owner; the shared registry and borrowed Agent remain with the host that created them. `startXeroAccountingWorkspace` owns and closes its registry as well. See the [complete Xero guide](./XERO.md) for discovery, review, saved tenant recovery, native operations and CLI examples.
