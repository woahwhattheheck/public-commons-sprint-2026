# Accounting setup: host and receiving integration

QuickBooks and Xero use the original setup workspace to publish a reviewed
registration edition, then the original provider workflow to authorize and select
the native account. This guide describes the join between those two owners.
The [API contract](API.md), [provider adapter](providers.mjs) and
[private host resolver](../../../distribution/runtime-workspace/openapi-connection-setup.mjs)
are the executable source references.

## Source and authority

The Applications workspace selects an existing, verified READY runtime. That
runtime supplies its own original QuickBooks or Xero descriptor, profile factory
and profile authority. Catalog reports their exact source and factory hashes.
Its availability is independent for each provider; a runtime without the Xero
factory can still support QuickBooks or generic OpenAPI registration.

The provider registration entry contains the registered client ID, an existing
client-secret environment reference, callback origin and human-readable label.
QuickBooks additionally requires an explicit sandbox or production environment.
The original factories supply their protocol fields:

| Provider | Factory | Native profile contract |
| --- | --- | --- |
| QuickBooks | [createQuickBooksProfile](../quickbooks.mjs) | Original accounting source and scope, confidential Basic client, explicit environment, Intuit PKCE-none dialect. |
| Xero | [createXeroProfile](../xero.mjs) | Original accounting source and scopes including offline access, confidential Basic client, S256. |

The provider entry has no operation, endpoint, scope, authentication-method,
resource-origin or PKCE override. Generic OpenAPI entries continue to use the
original operation/scope picker. A complete desired registry may contain both
kinds and unchanged retained aliases.

## Prepare the original registry edition

Use the existing authenticated Applications setup methods and its current
workspace token. The server resolves the selected runtime; the browser never
chooses a private destination or provider module.

1. Read catalog with the current environment file, registry file, listener port
   and local-provider setting. Keep existing aliases in the desired registry.
   Select a provider whose returned enabled value is true.
2. Call import-provider with a retained requestId, current expectedRevision,
   provider and the exact catalog sourceSha256. The existing source journal
   retains the original descriptor bytes. A native source can have no generic
   operation choices because its original factory supplies the accounting flow.
3. Build the complete review.entries array. A QuickBooks definition contains
   provider:"quickbooks", alias, directoryEnv, sourceId, clientId, clientSecretEnv,
   callbackOrigin and environment. A Xero definition contains the same fields
   with provider:"xero" and no environment. label and factorySha256 are optional
   input pins. Include replacesProfileSha256 when deliberately changing a
   registered alias's profile.
4. Review at the current setup revision and current baseEditionId. Check the
   exact generated callback URI, environment names and changes to the complete
   registry. Register that exact callback with the original provider client.
5. Commit that immutable review with the original request ID, revision, actor,
   reference and callbacksRegistered:true. This acknowledges callback
   registration; provider consent and grant approval happen later in the
   original connection workflow.
6. Apply all four returned prepared.settings fields together to the existing
   application form: oauthConnectionsFile, environmentFile, port and
   allowLoopbackOAuth. Continue through the original Save and reviewed Start.

The generated environment file preserves every declared entry from the original
environment file and adds the reviewed directory references. Inherited
environment values stay inherited. The API does not return secret values.
Do not replace these prepared settings with a separate directory-only file.

For an unchanged alias/profile, setup reuses the original grant store. A changed
source, client, callback or other public profile field receives a new owned
profile directory. Removing an alias from a registry or selecting a prior
edition leaves existing grant stores and their histories intact.

## Retain and recover the original command

Before sending a mutation, retain its request ID and exact intended input in the
owning application journal. After an uncertain response, call status with that
requestId. A completed operation carries the exact original result. A pending
operation is continued by recover with that same requestId.

The setup recovery path uses the command's original retained context, review and
source bytes. It remains reachable after the browser form reopens with different
paths or port. Do not regenerate an import, revision or request ID to make a
pending command appear new. If status has no record, the mutation never reached
the durable command journal; reselect the actual source and retain the original
intent before deciding whether to send it.

This is separate from the original OAuth consent/approval command journal and
from the original company or tenant selection save identity. Each owner retains
the identity for its own operation.

## Resolve the selected edition inside the host

The provider host accepts an exact editionId, alias and expectedProfileSha256,
plus the original runtimeId. It resolves them with the trusted facade:

~~~ts
import {
  resolveOpenApiSetupEdition,
  openApiSetupEditionSummary,
} from '@tokenjunkielabs/starforge-merchant/seller/oauth-connections/setup/applications';

const binding = await resolveOpenApiSetupEdition(
  originalApplicationsWorkspace,
  { runtimeId, editionId, alias, expectedProfileSha256 },
  { policy: originalHostSetupPolicy },
);

// Only this explicit projection may be returned to the authenticated UI.
const displayedBinding = openApiSetupEditionSummary(binding);
~~~

The host must retain the PRIVATE binding internally. In particular,
binding.environment contains effective environment values and must not be
serialized, logged, copied into an application plan, or stored in the browser.
The explicit summary intentionally excludes those values and grant-file bytes.

The resolver checks the selected runtime, immutable registry/environment files,
profile and source identities, and current original grant state. It returns the
verified registry connections and environment directly for the original registry
owner:

~~~ts
import {
  openOAuthConnectionRegistry,
} from '@tokenjunkielabs/starforge-merchant/seller/oauth-connections/host';

const registry = await openOAuthConnectionRegistry({
  connections: binding.registry.connections,
  env: binding.environment,
  allowLoopback: binding.prepared.settings.allowLoopbackOAuth,
  // Supply the owning host's optional lookup/Agent policy here when needed.
});

try {
  const status = await registry.status(binding.entry.alias);
  // Bind this registry to the existing provider consent and review controls.
  // Pass the same registry to the original native selection helpers.
  // Send only their supported public projections to the authenticated UI.
} finally {
  await registry.close();
}
~~~

Use the native provider helpers from the selected installed source closure.
Provider availability at setup establishes its factory contract; the accounting
host must also verify that its selected runtime exports the downstream helper
interfaces it needs. Do not mix an unrelated runtime's company or tenant client
with the selected descriptor/profile.

A host-owned Agent or lookup policy remains runtime configuration. It is not
part of a setup review, registry file or saved provider definition. Close the
original registry and its provider owners before disposing any borrowed
transport owner.

## Use the original native selection and accounting workflow

The resolver prepares a private selection directory for the original provider
helpers. The location is keyed by setup workspace, alias and profile hash, and
has an immutable setup-owner.json marker. It rejects a different owner marker
or a nonempty unowned directory.

| Stage | QuickBooks owner | Xero owner |
| --- | --- | --- |
| Current connected choices | listQuickBooksConnections(registry) | listXeroConnections(registry) |
| Native account source | previewQuickBooksSelection with the reviewed grant, realm and environment | listXeroTenants, then previewXeroSelection with the selected connection and tenant |
| Human-reviewed save | saveQuickBooksSelection(binding.selection.directory, ...) | saveXeroSelection(binding.selection.directory, ...) |
| Reopen saved identity | readQuickBooksSelection | readXeroSelection |
| Accounting application | startQuickBooksAccountingWorkspace | startXeroAccountingWorkspace |

The actual [QuickBooks](../quickbooks.mjs) and [Xero](../xero.mjs) helpers retain
their source captures, grant checks, preview integrity and compare-and-swap
selection saves. Use the preview's actual ID, creation time and integrity hash;
retain the expected prior selection SHA before saving. On an unknown save
response, read the original saved selection and retry the same preview and
prior identity. Do not invent a replacement company or tenant choice.

For the original accounting launcher, use:

- connectionsFile = binding.registry.path.
- selectionDirectory = binding.selection.directory.
- env = binding.environment.
- allowLoopback = binding.prepared.settings.allowLoopbackOAuth.
- The existing accounting workspace, port, host transport and other native
  options already owned by the accounting application.

The original launcher owns its accounting server, token provider and registry
lifecycle. Await its close function. A new setup edition does not replace those
live objects. Stop and reopen through the existing application owner to use a
different selected edition.

The same alias/profile keeps its selection directory across setup editions and
regrants, preserving native selection history. A regrant still requires the
original provider's current-grant validation and, when required, a newly
reviewed native selection. Returning to an older edition never restores old
tokens or implicitly authorizes an old company or tenant.

## CLI and installed contracts

The original command is:

~~~sh
starforge oauth-connection setup --help
~~~

Native import uses the same private JSON input file as the API:

~~~sh
starforge oauth-connection setup import-provider \
  --workspace /private/original-applications \
  --runtime ORIGINAL_RUNTIME_ID \
  --context /private/current-context.json \
  --input /private/provider-import.json
~~~

provider-import.json contains the original requestId, expectedRevision, provider
and actual sourceSha256 from catalog. It contains no secret value.

After a committed edition, inspect its safe host binding with:

~~~sh
starforge oauth-connection setup provider-binding \
  --workspace /private/original-applications \
  --runtime ORIGINAL_RUNTIME_ID \
  --input /private/selected-edition.json
~~~

selected-edition.json contains editionId, alias and expectedProfileSha256.
The command can create the empty owned selection location under the host's
oauth-accounting root. Its JSON output is the explicit safe summary; it does not
authorize, fetch a native account or start accounting.

The source-owned distribution contribution provides four typed exports:
setup, setup/model, setup/providers and setup/applications beneath
/seller/oauth-connections. Their .d.mts contracts distinguish public results from
PrivateSetupHostEdition. Existing QuickBooks/Xero exports and commands remain
the original provider interfaces.

## Continue the existing native receiving operation

Use the accounting owner's actual selected runtime, registered client/callback
inputs and retained original provider operation. The following phases belong to
one complete receiving flow; they do not imply that an unrun phase has passed.

| Phase | Evidence to retain |
| --- | --- |
| Actual provider catalog/import | Runtime/source/factory identity, original descriptor SHA and import request/result. |
| Review and immutable commit | Complete desired aliases, generated callbacks, original review/request, prepared settings and file hashes. |
| Unchanged retry and reopen | Exact recovered command result, selected edition/profile, preserved original environment names and existing grant identity. |
| Original provider consent/review | The native connection owner's actual approved grant and retained request receipts. |
| Native company or tenant | Original source response, reviewed preview, expected prior selection SHA and saved selection readback. |
| Accounting launch/reopen | Same selected setup edition and native selection, original launch receipt, actual application state and normal close. |
| Prior edition choice | Actual selected pointer/settings, unchanged original grant stores and retained native selection history. |

The generic setup receiving module already composes original source import,
immutable edition review/replay, prior-pointer selection, four public downloads
and the original managed Applications Save/Start/HTTP/Stop/Reopen lifecycle.
The provider extension adds import-provider and the original accounting
selection/launch phases through that same owning application. It does not
create a second installer, fake READY descriptor, OAuth consent operation or
replacement accounting state.
