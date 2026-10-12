# API merchant authoring in Applications

Use the existing **API merchant authoring** application to keep the original API source, registered provider connections, merchant projects and managed process together. The application opens the maintained SF61 workspace. That workspace continues to own source inspection, OAuth consent and grant review, route selection, merchant compilation, seller operation, source revisions and customer handoff.

This receiving integration adds configuration and startup review to the existing Applications lifecycle. It uses the original private OAuth stores. It does not copy a grant into an application record or authorize a provider when an application opens.

## What to have ready

An existing plain OpenAPI application can continue using an older valid READY runtime. When that installation predates the managed host and no OAuth configuration or local-provider option is selected, Applications retains its original **--out-parent / --port** command and original startup URL reader. Its saved projects remain reopenable. Selecting OAuth connections requires a runtime containing the managed host described below; an older runtime does not receive invented managed-startup metadata.

Use a READY installation containing the original **openapi-workspace** command and matching **workspace/managed-launch.mjs**, **workspace/server.mjs**, **distribution/runtime-workspace/application-openapi.mjs** and common Applications hooks. The original authoring and seller dependencies come from that installation.

The maintained distribution includes these files in its existing SF61 and runtime-workspace components. No new package, provider library or supervisor is introduced.

Choose separate locations for installed source, private projects and private OAuth connections:

| Example location | Contents |
| --- | --- |
| /private/api/projects | Original merchant projects, source revisions and operation state |
| /private/api/registrations | Public source profiles and original host alias JSON |
| /private/api/connections/records | One original private OAuth connection and grant history |
| /private/api/operator-environment.json | Optional private directory and client-secret environment values |
| Existing runtime workspace | Application configuration, reviews, process records and private startup URL |

Use actual absolute paths on the host that owns the READY installation. Keep OAuth stores outside both merchant projects and installed source. The projects directory must be private and operator-owned. Applications can create one new projects directory inside an existing private parent when its reviewed configuration is saved.

## 1. Register the exact original source

Retain the actual OpenAPI source used by the original workspace. A registration is bound to that source's exact SHA-256 and security-scheme name. Select the provider's declared authorization-code flow, actual registered client, approved scopes and resource origins. Keep the source and public registration together for later review.

The original public profile has this form:

~~~json
{
  "schema": "stellar-forge.oauth-authorization-profile.v1",
  "label": "Records provider",
  "source": {
    "sha256": "EXACT_SHA256_OF_THE_RETAINED_OPENAPI_SOURCE",
    "scheme": "ProviderOAuth"
  },
  "authorizationEndpoint": "https://accounts.provider.example/authorize",
  "tokenEndpoint": "https://accounts.provider.example/token",
  "revocationEndpoint": "https://accounts.provider.example/revoke",
  "clientId": "ACTUAL_REGISTERED_CLIENT_ID",
  "authMethod": "none",
  "pkceMethod": "S256",
  "scopes": ["records.read"],
  "resourceOrigins": ["https://api.provider.example"]
}
~~~

This is an illustrative profile. Replace the hash, scheme, endpoints, client ID, scopes and resource origins with the actual registration. The .example hosts identify no live provider. The original profile validator checks the completed file.

Public clients use **none** and omit **clientSecretEnv**. For a confidential client, use the original provider's supported **client_secret_basic** or **client_secret_post** method and its environment reference, for example **Records_Client_Secret**. The value belongs only in the host's private environment. For QuickBooks, use the existing QuickBooks setup and explicit dialect; its actual registered callback origin and documented confidential-client behavior remain authoritative.

Initialize the private store through the installed original command:

~~~sh
starforge oauth-connection init \
  --directory /private/api/connections/records \
  --profile /private/api/registrations/records-profile.json
~~~

The original engine initializes a new private directory or reopens it when the normalized profile is unchanged. It refuses to replace a different profile. A changed source, client registration or approved scope belongs in a new original connection directory.

Read its public status:

~~~sh
starforge oauth-connection status \
  --directory /private/api/connections/records
~~~

This displays the normalized profile, profile SHA-256, callback path and public connection state. No access or refresh token is printed. A new disconnected store is a valid application configuration. Consent and approval happen after the original authoring workspace opens.

For an explicitly local development provider, add **--allow-loopback** to these commands and select the matching application option. Normal profiles retain public HTTPS.

## 2. Select host aliases and the private environment

Create the original host connection JSON. It contains trusted aliases and environment-reference names:

~~~json
{
  "schema": "stellar-forge.oauth-host-connections.v1",
  "connections": [
    {
      "alias": "records",
      "directoryEnv": "Records_OAuth_Directory"
    }
  ]
}
~~~

Aliases and directory-reference names must be unique. Every referenced private directory must have its original initialized connection. The host supports up to 64 aliases. Keep the configuration a regular file without symlinks or group/world write access.

Provide the actual directory reference in the host environment. The optional application-specific environment uses the existing Applications JSON format:

~~~json
{
  "Records_OAuth_Directory": "/private/api/connections/records"
}
~~~

For a confidential client, the same file can carry the named client-secret value expected by its original profile. Keep it operator-owned, mode 0600, regular, with one file link. Exclude it from public source, merchant packages, customer deliveries and ordinary reports.

Applications retains this file's identity and SHA-256. The managed worker verifies and reads those exact bytes just before launch, then passes the values to the original child. The same environment reaches its registry, seller and customer session. With no file, the existing inherited operator environment remains in use.

Environment names support the original mixed-case and underscore convention. A directory reference is a runtime setting. Client-secret values and grants remain private.

## 3. Review the callback and save the application

Open **Applications → New application → API merchant authoring**.

Select the READY runtime and complete these fields:

| Setting | Meaning |
| --- | --- |
| Display name | A useful name for the retained workspace |
| Private merchant projects directory | Original projects or one new private directory |
| Original OAuth host configuration | Exact alias JSON; optional without authorization-code connections |
| Local port | Fixed listener registered for the selected callbacks |
| Private environment JSON | Optional original private environment file |
| Use a local development OAuth provider | Enable only for an intentionally local HTTP provider |

With OAuth aliases, use a fixed nonzero port other than 80. Port 0 would select a new callback address on restart. Without aliases, port 0 retains the original available-port behavior.

**Review application** uses the selected installation's original inspector. It displays each provider, source SHA-256, security scheme, profile SHA-256, exact callback, private directory reference, client-secret reference, provider origins and scope count. Exact scope values remain in the original authorization review.

Register the displayed callback with the actual provider. Generic profiles use the original literal 127.0.0.1 listener and source-specific callback path. QuickBooks preserves its actual registered localhost or HTTPS origin and checks its listener relationship. An original HTTPS ingress must forward to this same private listener.

**Save application** records the configuration through the existing idempotent save and joins or adopts the selected READY installation. It does not initialize another grant store, request consent or start a seller.

An existing API merchant application can add this configuration after its original run stops. Its merchant projects remain in the same directory.

## 4. Start and use the original authoring workflow

Choose **Review start → Start reviewed application**.

The review retains the selected runtime/source, projects and connection-directory identities, registry bytes, public source/profile/callback bindings, explicit development setting, optional private environment identity, and exact command with its launch SHA-256.

The original CLI rechecks the binding when a queued command actually starts. Replacing a directory, registry, profile or callback listener requires a new review. A mismatch fails before the host publishes its private URL.

The original host announces its actual instance, process, projects, listener, profile count and reviewed binding. Applications accepts the URL only when that announcement matches its retained command. The private URL stays in the original managed operation; it is not inferred from the selected port.

Select **Open application** and use SF61's existing controls:

1. Import or reopen the exact original API source.
2. Select its declared authorization-code flow and matching alias.
3. Begin authorization and complete the actual provider consent.
4. Return to the workspace and review the returned grant, scopes and source.
5. Approve that exact grant and select it for the intended route.
6. Review the original method, path, request/response contract and merchant terms.
7. Compile and save the original merchant package.
8. Use existing seller, source-revision and customer controls for that project.

An unpaid challenge, local protocol fixture and real provider authorization are different results. Opening a workspace does not mean an account is authorized or a chain payment occurred.

## 5. Stop, reopen and change registrations

**Stop application** addresses the original managed operation. Its server drains the owned merchant, customer, migration, cache and OAuth lifetimes. A later reviewed start reopens the same projects and private stores. Closing the Applications browser alone leaves the managed process available.

Normal approval, renewal, disconnect and revocation update original connection state. Their mutable token generations, grants and command journals are excluded from the application launch fingerprint and remain with the OAuth engine.

Renewal therefore does not require a new Applications configuration. The original compiler still checks the route's current reviewed grant. Reconnecting to a new grant may require explicit reselection and recompilation in the original merchant workflow.

For a changed source or client registration:

1. Preserve the old source, merchant and connection.
2. Initialize a new original connection with the revised public profile.
3. Add its alias and directory reference to the host/environment files.
4. Stop the current managed application.
5. Edit, review and save its configuration, then review a new start.
6. Use the existing revision desk and returned-grant review to select the new source and connection for the intended routes.

A changed environment file requires a fresh start review. A lost save/start response uses the existing recovery action and the same original request ID. It does not authorize a new consent or repeated merchant action.

## Receiving and private recovery

Customer merchant packages retain original source and public upstream references. They contain neither private connection stores nor environment values. Provision the receiving seller's directory references through its existing host/deployment controls.

An operator moving a complete private authoring installation retains projects and connection stores through the existing private recovery process. Deliberately rebind destination paths, reopen original stores and review the actual new Applications configuration. This integration refuses silent directory replacement. It does not rewrite source-bound grants or introduce another recovery format.

Keep public handoffs separate from private connection recovery. Source/configuration metadata, source commits and actual operator results identify the product; private environments, stores and capability URLs stay with the authorized operator.

## Source and callable integration

| Export | Purpose |
| --- | --- |
| openApiApplication(common) | Existing API merchant card with host configuration and development fields |
| prepareOpenApiApplication(settings, context) | Original installed inspection, expected launch SHA, inputs and arguments |
| openApiStartup(request, operationDirectory, text, context) | Exact startup and private URL validation |
| renderOpenApiApplicationReview(command) | Source/callback review in the original configuration and start panels |

The selected **workspace/managed-launch.mjs** exports **inspectOpenApiLaunch** and **startManagedOpenApiWorkspace**. Ordinary **openapi-workspace --out-parent …** remains available. Applications adds **--managed-launch-sha256**; preserve that actual reviewed command instead of manufacturing a digest.

The original server's **connectionStatus()** returns the same public registry status as its operator API. It exposes no token, verifier or private provider response.

This source is additive to the existing application, credential engine and managed worker. Original owners retain cumulative source, installed distribution and execution custody.
