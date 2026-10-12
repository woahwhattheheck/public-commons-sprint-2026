# Xero: managed authorization, reviewed tenant, original accounting

The maintained OAuth connection now supplies the original Xero accounting workspace. An operator authorizes the app, reviews its grant, reads the actual connected tenants, and chooses one organization by its connection ID and tenant ID. The saved choice retains the original connection array, Organisation response, Accounts response, reviewed grant binding and source hashes.

The native accounting workspace then captures current accounts, prepares explicit payment/refund journal plans, creates its retained Xero drafts, reads the resulting journals, and returns matched results to the original accountant handoff. Its existing operations, source files, comparisons and recovery remain the accounting record.

## Register and authorize the original connection

Create a confidential Xero OAuth app and register its exact callback URL. Xero's issuer advertises authorization code, refresh, client-secret Basic and PKCE S256. The Xero profile uses these endpoints and scopes:

| Purpose | Exact value |
| --- | --- |
| Authorization | `https://login.xero.com/identity/connect/authorize` |
| Token and refresh | `https://identity.xero.com/connect/token` |
| Whole-grant revocation | `https://identity.xero.com/connect/revocation` |
| Native resource origin | `https://api.xero.com` |
| Organization and accounts | `accounting.settings.read` |
| Manual journals | `accounting.transactions` |
| Retained renewal | `offline_access` |

Keep the client secret in its named server environment variable. The profile and host configuration contain references.

```sh
starforge-merchant oauth-connection xero init \
  --directory /srv/starforge/oauth/xero \
  --client-id YOUR_REGISTERED_CLIENT_ID \
  --client-secret-env MERCHANT_XERO_CLIENT_SECRET \
  --callback-origin http://localhost:8445 \
  --label "Merchant Xero"
```

Register the exact callback origin plus the returned `callbackPath` in the Xero app. The path includes the original profile's SHA-derived identity. Use the same port when opening the original connection listener:

```sh
starforge-merchant oauth-connection connect \
  --directory /srv/starforge/oauth/xero \
  --port 8445 \
  --actor "Accounting operator" \
  --reference "Merchant Xero authorization"
```

The original interactive command displays the authorization URL, receives the state-matched callback, and presents the returned grant for review. The existing merchant OAuth browser workspace can perform the same connection flow through its configured alias.

For a hosted callback, initialize the profile with the registered public HTTPS origin. Route the exact callback path to the original local listener. Its callback admission checks the registered origin, current state and profile-specific path. The listener's administrative routes keep their existing local access requirements.

The `--allow-loopback` runtime option permits an explicitly local OAuth peer for development. Registered localhost browser callbacks already belong to the public Xero profile; this option controls the provider's token endpoints.

## Discover actual tenants and save one reviewed choice

Configure the original trusted alias file:

```json
{
  "schema": "stellar-forge.oauth-host-connections.v1",
  "connections": [
    {"alias": "merchant-xero", "directoryEnv": "MERCHANT_XERO_DIRECTORY"}
  ]
}
```

Set `MERCHANT_XERO_DIRECTORY` to the private directory initialized above. The original registry checks its real directory identity and permissions. Use a regular host configuration file whose write permissions belong to its operator.

Read the current public profile and grant identity:

```sh
starforge-merchant oauth-connection xero list \
  --connections /srv/starforge/oauth/connections.json
```

Use the returned alias, profile SHA and reviewed grant ID to read the native connection array:

```sh
starforge-merchant oauth-connection xero tenants \
  --connections /srv/starforge/oauth/connections.json \
  --alias merchant-xero \
  --profile PROFILE_SHA256 \
  --grant GRANT_ID \
  --out /srv/starforge/reviews/xero-tenants.json
```

The output includes each actual connection ID, tenant ID, authorization event, tenant name and tenant type. Select an `ORGANISATION` row explicitly. Its original Organisation response must identify the same tenant, an active organization, base currency and actual demo-company flag. The original chart must provide at least two active accounts eligible for manual journals.

```sh
starforge-merchant oauth-connection xero preview \
  --connections /srv/starforge/oauth/connections.json \
  --alias merchant-xero \
  --profile PROFILE_SHA256 \
  --grant GRANT_ID \
  --connection-id CONNECTION_UUID \
  --tenant TENANT_UUID \
  --actor "Accounting operator" \
  --reference "Settlement journal organization" \
  --out /srv/starforge/reviews/xero-selection.json

starforge-merchant oauth-connection xero select \
  --connections /srv/starforge/oauth/connections.json \
  --selection-directory /srv/starforge/xero-selection \
  --preview /srv/starforge/reviews/xero-selection.json \
  --preview-sha PREVIEW_SHA256
```

Review the complete preview before selecting its SHA. It includes the original response text and byte hashes, the native account eligibility decisions, and the selected tenant/grant identities. Preview and tenant-source files are created in an existing private output directory.

A selection retry uses the same preview and SHA. Replacing an existing saved choice also requires `--previous-sha CURRENT_SELECTION_SHA256`. The original file lock protects comparison and atomic replacement. A repeated selection returns the retained result. Reusing a selection UUID with different source is rejected.

```sh
starforge-merchant oauth-connection xero status \
  --selection-directory /srv/starforge/xero-selection
```

On read, the selection reconstructs its native context from the retained response bytes and compares the result. An edited account, tenant ID, source body, binding or review cannot silently become the saved organization.

## Run the accounting workspace

```sh
starforge-merchant oauth-connection xero serve \
  --connections /srv/starforge/oauth/connections.json \
  --selection-directory /srv/starforge/xero-selection \
  --workspace /srv/starforge/accounting \
  --port 8446
```

Pass the same original accounting options used for the merchant's source: `--outbox`, `--proof-dir`, `--terms`, `--recovered-dir`, RPC proxy and recovery options. The launcher prints the original workspace URL ending in `/xero.html`.

The workspace shows the selected alias, organization, tenant and connection IDs, selection hash, and current provider state. It fills and locks the tenant field for native capture. Use **Read from Xero** to retain the current organization and chart in the original workspace, then prepare the handoff's journal plan.

Choose an explicit base-currency amount, debit account, credit account, journal date and valuation source for each included payment or verified refund. Demo/book purpose follows the native organization's actual `IsDemoCompany` flag. The original accounting engine applies its existing source, reservation, balancing and account eligibility rules.

**Create these drafts in Xero** uses the original controller's stored request and Idempotency-Key. **Read journals from Xero** performs the existing exact journal-ID or narration lookup. The original comparison and accountant-return steps retain the native source and matching result. Plans for other tenants remain readable; native actions use the selected tenant's owner.

### Renewal and recovery

A token request goes through the original managed provider and private connection lock. Two owners sharing the same reviewed grant reuse its serialized refresh result. The saved selection pins the grant ID, profile, resource origin, source and tenant; refresh generation can advance within that same grant.

An HTTP 401 invalidates the exact bearer that received it. Read-only tenant discovery retries once through the original renewal owner. Organization/account capture restarts its complete read once after renewal. A native journal write retains its actual response; its original accounting operation owns the later retry or reconciliation.

The launcher checks the current connection array when opening the saved tenant. A removed connection, different authorization event, replaced grant or different profile requires a current explicit tenant selection. Native accounting requests also bind the `xero-tenant-id` header to that reviewed tenant.

For an uncertain journal result, use the original workspace's retained operation and exact journal read. The existing controller retains request/response metadata, journal identity and comparisons before returning accounting decisions.

### Disconnect and revocation

The original OAuth `disconnect --revoke` operation disconnects and revokes the whole authorization. Reconcile its returned operation state with the original connection status. Reconnection produces a new reviewed grant and requires a new tenant selection.

Xero distinguishes that grant revocation from `DELETE /connections/{connectionId}`, which removes one tenant connection. Its connection ID is distinct from the accounting tenant ID. The saved selection and launcher preserve both identities, and a later launcher open checks that the selected connection still exists.

## Embed through the existing SDK

The typed export is `@tokenjunkielabs/starforge-merchant/seller/oauth-connections/xero`. Use the existing registry owned by the host:

```js
import {
  listXeroTenants, previewXeroSelection, saveXeroSelection,
  readXeroSelection, openXeroOAuthClient,
} from '@tokenjunkielabs/starforge-merchant/seller/oauth-connections/xero';

const native = await openXeroOAuthClient({
  registry,
  selection: await readXeroSelection(selectionDirectory),
  env: process.env,
  agent: oauthAgent,
  fetchImpl: nativeResourceFetch,
});

const accounting = await startAccountingWorkspace({
  ...originalAccountingOptions,
  xeroClient: native.client,
});

try {
  // Use the original accounting host, SDK, CLI or browser workflow.
} finally {
  await accounting.close();
  await native.close();
}
```

The host that created `registry` closes it after all its users drain. A borrowed Node HTTP(S) `agent` remains with its original owner; destroy it after the provider and registry close. The `fetchImpl` resource transport and OAuth `agent` are separate trusted runtime inputs.

For an owner that should create and close its registry too, use `startXeroAccountingWorkspace({connectionsFile,selectionDirectory,...originalAccountingOptions})`. It exposes the actual original runtime as `accounting` and closes accounting, its native client/provider, then its registry in that order.

## Retained interfaces

| Interface | Retained behavior |
| --- | --- |
| `createXeroProfile` | Public native registration and exact operation source |
| `listXeroConnections` | Configured original aliases and reviewed grant readiness |
| `listXeroTenants` | Complete current native connection array and response |
| `previewXeroSelection` | Explicit connection/tenant choice plus native organization/accounts |
| `saveXeroSelection` | Exact preview review, prior selection comparison, atomic save/replay |
| `readXeroSelection` | Original response reconstruction and full identity validation |
| `openXeroOAuthClient` | Borrowed registry, bound native client, managed renewal and owned drain |
| `startXeroAccountingWorkspace` | Original accounting launcher and complete lifecycle |

## Primary provider references

- [Live issuer metadata](https://identity.xero.com/.well-known/openid-configuration).
- [Official Xero Node SDK](https://github.com/XeroAPI/xero-node/blob/master/src/XeroClient.ts): native token helper, tenant discovery, selected-connection deletion and whole-grant revocation.
- [Official identity schema](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-identity.yaml): original connection fields and endpoints.
- [Official accounting schema](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml): Organisation, Accounts, ManualJournals and scopes.
- [Official SDK authorization guide](https://github.com/XeroAPI/xero-node/blob/master/README.md): registered localhost callbacks and maintained authorization.
