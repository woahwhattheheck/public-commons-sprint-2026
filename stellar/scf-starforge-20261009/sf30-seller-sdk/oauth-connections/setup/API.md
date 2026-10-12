# OpenAPI connection setup API

## Original authorities

Use the unchanged original inspectOpenApi/merchantOAuthSelection, normalizeOAuthProfile/oauthProfileIdentity/oauthCallbackPath/oauthRedirectOrigin, initializeOAuthConnection/oauthConnectionStatus, readOAuthHostConnections/normalizeOAuthHostConnections and original private file/lock primitives. The original OAuth grant/refresh/revocation and managed launch own authority use. This setup performs no provider request, consent or token exchange.

## Facade and placement

Export:
`openApiConnectionSetupAction(root, {action, runtimeId, runtimeDirectory, context = {}, input = {}}, {policy = {}} = {})`

`root` is the original initialized Applications workspace, supplied by the server. Default setup directory is root/oauth-setup, grant root is root/oauth-grants, and native accounting selection root is root/oauth-accounting. The server may configure exact canonical private overrides through policy; no HTTP request selects destination paths. These roots remain separate from merchant project directories. Roots are original operator-owned 0700 directories. Every generated file is private and every path is checked before use. Setup metadata records root identity and refuses a replaced root.

Context (existing form inputs, read-only):
`{environmentFile: null|string, connectionsFile: null|string, port: integer, allowLoopbackOAuth: boolean}`.
Use port 1024–65535 for a new configured OAuth host. The generic callback is the original literal loopback origin plus its profile-derived path. Existing retained provider dialects continue their original callback rules. allowLoopbackOAuth is permitted only when the receiving host policy explicitly allows development providers.

The original environmentFile is read under the native private-file rules. Its complete declared JSON entries are preserved in the generated environment edition; only the new reviewed directory references are added/replaced. Do not serialize all process.env. Inherited values continue to be inherited. A selected confidential-client reference must exist in the original effective environment. Neither values nor raw secret-bearing file bytes enter a browser response, public profile, command journal or normal handover. Review binds the original file SHA; commit rereads that exact identity before private output.

The original connectionsFile is read through readOAuthHostConnections. The current exact alias/profile/directory identity is retained. Existing aliases are shown in catalog and are explicit entries in the reviewed desired registry; excluded/replaced aliases are shown as changes in review. Their actual grant stores are never deleted, disconnected or rewritten by registry activation.

## Envelope and commands

The facade returns a direct JSON result. The common authenticated server may use its existing response envelope. It must expose the authenticated POST /api/applications/openapi-setup/{catalog,import-source,import-provider,inspect-source,review,commit,status,activate,download,recover} routes. Each body is {runtimeId,context,input}, and the original model resolves runtimeId through its retained entries before calling the facade. Use the original server's action endpoints and current Applications request token/origin checks. The facade exports OPENAPI_SETUP_ROUTES and openApiSetupBodyLimit(action): import-source accepts at most 25,231,360 bytes (sixfold escaping of the 4 MiB original plus 64 KiB envelope); review accepts at most 32 MiB; other actions retain 32,768 bytes. Retained reviews are at most 16 MiB, source inspections 32 MiB and individual private JSON records 64 MiB. Context paths and selected operation paths are bounded to 4,096 UTF-8 bytes. It must not register these actions on the ordinary SF61 merchant endpoint.

Supported action names:
- catalog
- source.import
- source.provider
- source.inspect
- review
- commit
- status
- activate
- download
- recover

Every mutating command carries one retained requestId (1–128 identifier characters) and expectedRevision. An identical retry returns the exact retained result even if the workspace revision has advanced. Reuse with another semantic body fails. One unresolved publication blocks a different mutation; catalog reports its safe pending identity and status. A caller can retry the original request unchanged or retain only its action/request ID and use the original status/recover journal after a reload.

## catalog

Input: {}.
Result:
```json
{
  "schema": "stellar-forge.oauth-setup-catalog.v1",
  "enabled": true,
  "workspaceId": "id",
  "revision": 0,
  "currentEditionId": null,
  "sources": [],
  "editions": [],
  "baseEntries": [],
  "clientSecretEnvs": ["EXAMPLE_CLIENT_SECRET"],
  "limits": {"maxSourceBytes": 4194304, "maxEntries": 64, "maxSelectionsPerEntry": 64},
  "pending": null
}
```

Sources: {id,sha256,bytes,label,title,importedAt}. Editions: {id,sequence,createdAt,reviewId,requestId,entryCount,registrySha256,environmentSha256}. A pending command is {action,requestId,inputHash,phase}; it contains no private environment values.

baseEntries lists the exact selected original registry:
{alias,directoryEnv,profileSha256,profile,callbackUri,grant:{id,state},entry:{retainAlias,expectedProfileSha256}}.
When a retained entry came from this setup, also return its original editable definition; UI may deliberately convert it to a new definition for a source/client revision. All retained entries start selected. The operator UI keeps private paths out of its ordinary summary but may expose returned prepared settings to the operator.

## source.import and source.inspect

Import input:
{requestId,expectedRevision,label,sourceText}.
The original UTF-8 sourceText is retained byte-exact, bounded to 4 MiB. Its ID is the actual SHA256, never a parsed/reserialized source. Label is 1–160 UTF-8 bytes.
Result: {revision,source,inspection,choices}.

Inspect input: {sourceId}. Result: {source,inspection,choices}.
inspection is the maintained inspectOpenApi result. choices contains only exact original supported authorizationCode selections:
{id,label,selection:{method,path,serverIndex,securityAlternative},scheme,authorizationEndpoint,tokenEndpoint,resourceOrigin,requiredScopes,declaredScopes}.
Source may declare both clientCredentials and authorizationCode; this setup selects the authorizationCode contract without changing the other flow. Unsupported operations remain visible in inspection.

## Desired registry entries

A desired entry is either:
`{retainAlias:"existing",expectedProfileSha256:"64hex"}`
or:
```json
{
  "alias": "records",
  "directoryEnv": "RECORDS_OAUTH_DIRECTORY",
  "sourceId": "64hex",
  "selections": [{"method":"GET","path":"/records","serverIndex":0,"securityAlternative":0}],
  "label": "Records provider",
  "clientId": "registered-client-id",
  "authMethod": "none",
  "scopes": ["records.read"]
}
```
Optional new-definition fields:
clientSecretEnv, revocationEndpoint, issuer, authorizationParameters, resourceParameters, replacesProfileSha256.
authMethod enum: none | client_secret_basic | client_secret_post.
Client-secret values are not accepted. Confidential methods require the named existing reference; public clients omit it.
replacesProfileSha256 is required when a new definition intentionally replaces an existing alias with a different public profile.

All selections in one profile must use the same exact retained source/security scheme and resolved authorization/token endpoints. Backend origins are derived from the selected operations. Every required scope must be included and every selected scope must be declared by the source. The backend constructs schema/source/endpoints/resourceOrigins/pkceMethod:S256 and normalizes the original profile; HTTP fields cannot override them.

Generic definitions continue to use the original authorizationCode operation selection. Native QuickBooks and Xero definitions use the selected runtime's original provider factory through [providers.mjs](providers.mjs), with the exact shipped source identity. The native union and host-only accounting binding are specified below and in [ACCOUNTING_SETUP.md](ACCOUNTING_SETUP.md). Existing aliases and their grants remain explicit retained entries in either workflow.

## review

Input: {expectedRevision,baseEditionId:null|string,entries:[desiredEntry]}.
The full desired registry must have 0–64 entries with unique aliases and directory environment names. baseEditionId must match currentEditionId; context selects the currently configured external or prior setup registry.

Result:
{schema:"stellar-forge.oauth-setup-review.v1",reviewId,revision,baseEditionId,contextBinding,entries,changes,environmentNames,callbackUris,files}.
Each result entry:
{kind:"retained"|"initialize",alias,directoryEnv,sourceId,profileSha256,profile,callbackUri,definition?,existingGrant?}.
changes lists {alias,kind:"added"|"retained"|"replaced"|"removed",beforeProfileSha256?,afterProfileSha256?}.
files lists only planned relative names and roles.
environmentNames lists names only. callbackUris are the exact complete registered callback addresses.
No OAuth initialization happens at review. The review is immutable and includes source, profile, original config/environment SHA, root/policy identity and planned desired registry. Original secret values are reread only at commit.

## commit

Input: {requestId,expectedRevision,reviewId,actor,reference,callbacksRegistered:true}.
actor is 1–160 UTF-8 bytes; reference is 0–2000 UTF-8 bytes. callbacksRegistered affirms the exact displayed callback registrations for the selected host, not provider consent or a connected grant.

Under the original private writer lock:
1. Retain the complete exact command and review before any side effect.
2. Recheck source/config/environment/directory identities.
3. Retain the complete private environment edition before initializing any new store. Its hash must match the reviewed composition, so later recovery uses this exact private checkpoint.
4. Initialize each new profile through original initializeOAuthConnection in its setup-owned separate private directory. An identical original profile/store is reused; changed source/client/profile gets a different store. Never reset an existing grant. Write and verify the remaining immutable registry/profile/source-review files, and have the selected runtime inspect the prepared settings before publishing the edition and active pointer.
5. Retain the exact result for an unchanged replay. Recovery reuses those same operation/store/edition identities.

Result:
{schema:"stellar-forge.oauth-setup-commit.v1",revision,edition,prepared,operation:{requestId,action,state:"completed"}}.
edition includes the full reviewed definitions, source IDs, profile hashes, callback URIs, human review and original immutable file identities.
prepared:
{editionId,registrySha256,environmentSha256,settings:{oauthConnectionsFile,environmentFile,port,allowLoopbackOAuth}}.
These are the actual private files accepted by the original Applications applicationEnvironment + managed-launch inspector. UI applies them to the current form, then the user uses the existing Review/Save/Connect/Review start/Start flow. A currently running application is not silently reconfigured.

## status and activate

status input: {editionId?,requestId?}. Result:
{revision,currentEditionId,edition,prepared,connections,pending,operation}.
connections are current original safe status objects (no secret bytes) checked against the saved profile/directory identity. A changed grant state does not rewrite an immutable edition. A missing/replaced/invalid store is a concrete source error.

activate input: {requestId,expectedRevision,editionId}.
Recheck the immutable edition files and current original profile/store identity, then publish only the setup current-edition pointer. Return the same prepared settings plus a new setup revision. This does not roll back token state, overwrite a source, or stop a running application. Existing Applications Save/Start remains responsible for using the prior registry edition.

## download

Input: {editionId,kind}, kind profile-review | registry | source-manifest | operator-plan.
Return {filename,mime,content} for the normal authenticated server download wrapper. The private generated environment and grant files are excluded. Original raw source can be inspected through the original retained source path; no token store is exported by this setup API.

## Errors

Known failures have {code,message,status}. Facade preserves safe OAUTH_SETUP_* codes; unknown filesystem/provider errors are replaced with a safe setup failure.
400: SOURCE_INVALID, INPUT_INVALID, CALLBACK_INVALID, PROFILE_INVALID.
409: REVISION_CHANGED, REQUEST_CHANGED, CONTEXT_CHANGED, SOURCE_CHANGED, DIRECTORY_CHANGED, REVIEW_CHANGED, PROFILE_REPLACEMENT_REQUIRED, EDITION_CHANGED, ENVIRONMENT_CONFLICT.
423: COMMAND_PENDING.
A caught post-side-effect write failure leaves the exact retained command pending and returns RECOVERY_REQUIRED (409). It never reports success until the edition result is durable. A repeat with the same request resumes the retained plan.

## Receiving boundary

The receiving flow composes source import, declared operation selection, profile review, original disconnected-store initialization, exact request replay, source/client revisions with old stores retained, and current/prior immutable setup editions. It then applies the four prepared settings through the original Applications Save, Review start, Start and Reopen lifecycle using an actual compatible READY runtime. Account consent remains in the existing running OpenAPI host.

## Settled receiving details

The trusted model's applicationsOpenApiSetup method forwards runtimeId and runtimeDirectory from its original entry lookup; root remains the original operator workspace, never the selected installation directory. source.import and source.inspect map to import-source and inspect-source URL leaves. catalog accepts port 0 before callbacks are reviewed and reports policy.allowLoopbackOAuth, nullable contextError, and nullable baseEntry.callbackUri until a fixed port is chosen.

status input accepts {requestId}. Its operation is null or {requestId,action,inputHash,state:'pending'|'completed',phase?,result?}. Request-only lookup returns null edition/prepared and an empty connections array; its completed operation.result is the exact original safe command result. Recovery POST input {requestId} resumes the original retained command and context under the original lock. Neither lookup nor recovery substitutes current form paths or port. The original selected runtime/workspace identity is still checked. A source import retains its exact bytes before its pending journal; if no command reached that journal, lookup is null and the same source must be selected again. No full source/client/actor data is required in browser storage.

An explicitly reviewed empty registry edition is supported by the original host format. It retains all existing stores and can use port 0; any nonempty edition requires its fixed callback port. Errors also include OAUTH_SETUP_REQUEST_UNKNOWN for a request that never reached durable journal, and OAUTH_SETUP_IO_FAILED for a sanitized private I/O failure.


## Installed-runtime compatibility and host policy

The current console owns the setup engine. The selected runtime must be an original READY installation whose complete source, profile and dependency lock verify through inspectMerchantRuntime. It needs its original OAuth profile/store exports and managed OpenAPI inspector; it does not need to include this new setup module. Catalog reports enabled:false with a reason when that contract is unavailable. Existing plain OpenAPI applications retain their original legacy launch behavior.

The facade rechecks workspace.json and the exact entries/runtimeId.json record, then binds installationId, profileId/profileSha256, lockSha256, sourceCommit/sourceManifestSha256 and canonical sourceRoot. Reviews normalize each public profile with that selected runtime. Before setup publication, activation and retained publication recovery, its own inspectOpenApiLaunch reads the exact generated registry and private environment and confirms every alias, directory, source SHA, profile SHA and callback. Mutable token/grant state is not copied into a setup edition.

startRuntimeWorkspace and openRuntimeWorkspace accept openApiSetupPolicy as trusted host configuration. Its only keys are directory, grantRoot, selectionRoot and allowLoopbackOAuth. The default roots are the private oauth-setup, oauth-grants and oauth-accounting children of the original workspace. The policy is never a field in the HTTP body. Local-provider permission must still be present for a retained local-provider mutation; a prior review does not bypass a later host restriction. RUNTIME_UNAVAILABLE (409) is a safe capability or prepared-runtime validation error.

Decode source files using TextDecoder('utf-8', {fatal:true, ignoreBOM:true}) when reading original bytes into sourceText, and verify that UTF-8 re-encoding matches those bytes. Preserve CRLF and an existing UTF-8 BOM. The original source parser decides whether the document is supported; no decoding step silently changes its source identity.

## Installed CLI

Run starforge oauth-connection setup --help. It forwards to setup/cli.mjs and uses the same original workspace/facade; the existing init, status, connect, refresh, disconnect, revoke, QuickBooks and Xero commands remain unchanged.

Every setup action accepts --workspace ROOT and --runtime ID. --context PRIVATE.json supplies the current four context fields; --input PRIVATE.json supplies the action input. import-source instead takes --source FILE, --label TEXT, --request-id ID and --expected-revision N and preserves the exact original file bytes. --allow-loopback-oauth grants explicit development-provider permission to this CLI invocation, separately from the context setting. download can use --out FILE in an existing private parent, with exclusive publication and no overwrite. Normal JSON output contains only the public result; environment and grant files have no download action.

## Native QuickBooks and Xero registration

The selected READY runtime supplies its original [QuickBooks factory](../quickbooks.mjs)
or [Xero factory](../xero.mjs), descriptor bytes and profile authority. The setup
adapter loads only these fixed module paths. It checks the actual descriptor hash,
the provider's reported source SHA and scheme, and the factory-produced profile.
It never reads a browser-selected module, endpoint or grant path.

Catalog adds providers[]. Each entry is either
{provider,label,enabled:false,reason}, or:
{provider,label,enabled:true,kind,source:{sha256,bytes,scheme,file},factorySha256,
registrationFields,environments}.
provider is quickbooks or xero. kind is intuit-quickbooks or xero-accounting.
Only QuickBooks returns the sandbox/production environment choices.
A missing native provider disables that provider, while compatible generic setup
remains available.

### source.provider / import-provider

Authenticated POST import-provider, with the original envelope, accepts:
{requestId,expectedRevision,provider,sourceSha256}.
Use the exact sourceSha256 returned by the selected provider catalog. The command
copies that runtime's shipped original descriptor into the existing retained
source store. Result is {revision,source,inspection,choices,provider,factorySha256}.

The command journal retains its original provider, source ID, source byte count,
label and factory hash. An unchanged retry, request status and recovery use those
retained source bytes. If no command reached the journal, the caller must still
select the current catalog source before importing. A native descriptor may have
zero generic operation choices; the provider factory supplies its source-bound
accounting profile.

### Provider definition union

The complete review.entries array accepts these variants alongside ordinary
generic definitions and {retainAlias,expectedProfileSha256}:

| Field | QuickBooks | Xero |
| --- | --- | --- |
| provider | quickbooks | xero |
| alias, directoryEnv, sourceId | Required | Required |
| clientId, clientSecretEnv, callbackOrigin | Required registered values or reference | Required registered values or reference |
| label | Optional; original factory default | Optional; original factory default |
| environment | Required sandbox or production | Omitted |
| factorySha256 | Optional input pin; retained normalized definition includes it | Same |
| replacesProfileSha256 | Required for a different profile replacing an existing alias | Same |

A provider entry does not accept selections, scopes, authMethod, endpoints,
resource origins, authorization parameters or PKCE overrides. The original factory
derives those fields. QuickBooks retains its confidential Basic client and native
PKCE-none dialect; Xero retains its confidential Basic client, S256 and original
accounting/offline scopes.

callbackOrigin is the actual registered provider callback origin. The original
profile authority derives the final profile-specific callback path, and review
shows the complete URI. Its listener port must agree with context.port. Original
provider rules continue to reject unsupported development callback combinations;
the explicit host local-provider policy does not override a factory's own rules.

Review normalizes the original factory output, records its source/factory pin and
requires the named client secret in the original effective environment. Commit
uses the same immutable edition and original initializeOAuthConnection path.
The same profile retains its store; a changed source/client/profile uses a new
owned store. Recovery revalidates the retained definition through the selected
runtime factory before publication.

## Trusted accounting host binding

The facade exports:
resolveOpenApiSetupEdition(root,
 {runtimeId,runtimeDirectory?,editionId,alias,expectedProfileSha256},
 {policy?})

The core exports:
resolveOAuthSetupEdition(options,{editionId,alias,expectedProfileSha256}).

This is a host-only API. It is deliberately unreachable by string setup actions
or normal HTTP routes. The result contains effective private environment values
and must never be serialized to an HTTP response, ordinary log, browser storage
or public artifact. An authenticated request to the provider's own facade may
select only the exact edition, alias and profile; the host resolves all paths
and private values from this result.

The resolver reopens and verifies the immutable edition, the selected original
runtime's managed inspector, every registry/profile/directory identity, the
current original grant status, and the exact provider source. It returns:

- schema: stellar-forge.oauth-setup-host-edition.v1.
- ownerWorkspaceId, workspaceId, revision, currentEditionId, edition summary,
  runtimeBinding and provider.
- prepared with the same four application settings.
- registry {path,sha256,connections:[{alias,directoryEnv}]}.
- environmentFile {path,sha256} and PRIVATE environment containing the original
  effective values for this immutable environment edition.
- entry with its original reviewed public profile, directory and directory
  identity; status from the original OAuth store.
- selection {directory,key,owner,rootIdentity,directoryIdentity} for the existing
  provider's company or tenant selection.

The selection root is host-owned, separate from setup editions, grants and
installed source. Its child key binds workspaceId, alias and profileSha256.
The private setup-owner.json marker additionally binds the original owner
workspace, provider and selection key. A nonempty unowned location or a different
marker is rejected. Resolving creates only the owned selection location and
marker. Original provider helpers own company/tenant selection files, previews,
compare-and-swap saves and accounting clients.

The key excludes edition ID and grant ID so reuse of the same alias/profile
retains existing company or tenant selection history. This does not make an old
selection valid for a new grant: the original provider helper checks its current
grant and native realm/tenant binding before saving, reading native data or
opening the accounting client. Selection of an older setup edition does not
rewind grant state or hot-swap a running accounting process.

openApiSetupEditionSummary(binding) is the explicit safe projection for an
authenticated operator view or command output. It returns schema
stellar-forge.oauth-setup-accounting-binding.v1, edition, provider, prepared,
alias, directoryEnv, profileSha256, source, callbackUri,
grant:{id,state,scopes}, and selection:{directory,key,owner}.
It excludes the private environment and original grant-file bytes.

The installed provider-binding action accepts --workspace, --runtime and
--input containing {editionId,alias,expectedProfileSha256}. It calls the private
resolver and prints only this safe projection. It does not open a consent flow,
select a company/tenant or start accounting.

Native-specific safe setup errors include PROVIDER_UNAVAILABLE, SOURCE_CHANGED
and PROFILE_CHANGED. Original provider consent, selection and accounting errors
retain their own native error namespaces in their owning facade.

## Installed TypeScript contracts

The source-owned oauth-connection-setup distribution contribution publishes
types-first conditional exports:

| Installed subpath under @tokenjunkielabs/starforge-merchant | Module |
| --- | --- |
| /seller/oauth-connections/setup | workspace.mjs / workspace.d.mts |
| /seller/oauth-connections/setup/model | model.mjs / model.d.mts |
| /seller/oauth-connections/setup/providers | providers.mjs / providers.d.mts |
| /seller/oauth-connections/setup/applications | Applications facade and its declaration |

The declarations distinguish public results from PrivateSetupHostEdition and
model the native definition union, complete desired registry, retained command
recovery and selected-edition host inputs. Existing OAuth/provider exports and
the original oauth-connection setup command remain the executable authorities.
