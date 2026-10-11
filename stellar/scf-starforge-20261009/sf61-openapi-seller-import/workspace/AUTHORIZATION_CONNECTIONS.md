# Authorization connections in the API merchant

This workflow connects an OpenAPI authorizationCode flow to the existing SF61 merchant compiler, SF30 upstream provider, saved seller package and release workflow. An operator authorizes the registered provider application and reviews the returned grant. The host retains credentials privately. A route retains the exact public source, profile and grant reference selected by that review.

Client credentials continue to use the existing route controls and provider. The separate Google Sheets connection keeps its existing workflow. This feature does not implement an OpenID Connect login or establish a verified personal account identity.

## Prepare the registered application and host

Use the original OpenAPI JSON or YAML. Load it in the API workspace to read its original source SHA256. Preserve those exact bytes: source identity includes formatting and a UTF-8 byte-order mark when present.

The provider’s application registration must permit the exact source-specific callback shown by this workspace. Choose a stable loopback port for a real registration. A random port is useful only when the provider registration permits it or for the explicitly declared local development peer.

Create a public profile JSON file using the actual registration and source values:

~~~json
{
  "schema": "stellar-forge.oauth-authorization-profile.v1",
  "label": "Records API",
  "source": {
    "sha256": "REPLACE_WITH_THE_64_CHARACTER_ORIGINAL_SOURCE_SHA256",
    "scheme": "recordsOAuth"
  },
  "authorizationEndpoint": "https://provider.example/authorize",
  "tokenEndpoint": "https://provider.example/token",
  "clientId": "REGISTERED_PUBLIC_CLIENT_ID",
  "authMethod": "none",
  "scopes": ["records.read"],
  "resourceOrigins": ["https://api.provider.example"],
  "authorizationParameters": {},
  "resourceParameters": [],
  "pkceMethod": "S256"
}
~~~

The example is a template, not a provider registration. Replace every placeholder before initialization. The profile’s authorization and token endpoints must equal the original authorizationCode flow resolved against the selected backend server. Profile scopes must be declared by that flow and cover the intended operations.

For a confidential registered client, use its required client_secret_basic or client_secret_post method and add clientSecretEnv with the name of its existing host secret reference. Supply the value through the launch environment. Public clients use none and omit that reference. The profile file never contains a client-secret value.

Optional issuer, revocationEndpoint, authorizationParameters and resourceParameters are explicit reviewed provider settings. Resource parameters must belong to an approved resource origin. Additional authorization parameters cannot replace protocol fields such as redirect_uri, state or code_challenge. No endpoint discovery or redirect-following policy is added.

Initialize the private store through the original connection CLI:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/cli.mjs init \
  --directory /srv/merchant-private/records-authorization \
  --profile /srv/merchant-config/records-profile.json
~~~

The selected parent must already be suitable for private operator data. The connection directory is a canonical real directory with mode 0700, owned by the operating account. Its profile becomes immutable. A different source, client registration or profile requires another reviewed directory. Initialization with the same profile reopens its existing state.

Create a host configuration containing public aliases and environment references:

~~~json
{
  "schema": "stellar-forge.oauth-host-connections.v1",
  "connections": [
    {
      "alias": "records-api",
      "directoryEnv": "RECORDS_OAUTH_DIRECTORY"
    }
  ]
}
~~~

Aliases are lowercase letters, digits, underscores or hyphens and begin with a letter. Directory environment names are uppercase and distinct. A host supports up to 64 aliases. The host JSON must be a regular canonical file without group or world write access.

Set the named directory reference in the same environment used by the merchant:

~~~sh
export RECORDS_OAUTH_DIRECTORY=/srv/merchant-private/records-authorization
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/server.mjs \
  --out-parent /srv/merchant-private/packages \
  --port 8710 \
  --oauth-connections /srv/merchant-config/oauth-host.json
~~~

The output directory follows the existing workspace’s private directory rules. Open the complete URL printed by the launcher. Its fragment is the temporary workspace access capability.

The browser cannot add an alias, choose a host directory or change registration settings. Its provider selector contains only the host’s configured aliases. Changing a host configuration takes effect when that workspace is reopened.

For a deliberately local protocol peer, initialize the connection CLI with --allow-loopback and start this workspace with --allow-loopback-oauth. Both choices are explicit. The usual source-backed development upstream switch remains separate. Production profiles require public HTTPS endpoints.

## Authorize and review

1. Load the original API document. Compare its displayed source SHA256 and security scheme with the configured connection.
2. In **Provider authorization connections**, select the provider alias. Expand its details and review the registered client, source, endpoints, resource origins and profile scopes.
3. Register the displayed callback, including its loopback port and source-specific path, with the actual provider application.
4. Select **Begin provider authorization**. The core creates a one-time state and PKCE S256 challenge. The verifier remains inside the host process.
5. Select **Continue at provider**. Complete the provider’s normal authorization in the separate tab. The provider controls account selection and consent.
6. The callback is handled by the original local listener. Its response immediately redirects to a script-free return page without the authorization code, state or workspace capability in the returned URL.
7. Return to the original workspace tab and select **Refresh authorization**.
8. Review the actual returned scopes, access-token expiry when supplied, and whether a refresh token was returned. Enter a reviewer and nonsecret reference, confirm the review, then select **Approve and keep private grant**.

Receiving a callback does not itself retain an approved grant. Approval is explicit. Discarding the attempt clears that proposed grant while preserving a previously approved one.

The source-specific callback and authorization attempt expire after ten minutes. In-progress authorization attempts do not survive a host restart. Existing approved grants remain in their private store. If a callback or exchange cannot be safely resumed, the operator starts a fresh authorization; an old code is not blindly exchanged again.

Returned OAuth scopes authorize API use. They are not a validated OpenID Connect identity token and do not prove which person owns an account.

## Bind the exact grant to routes

For each selected operation:

1. Select its original backend server and declared security alternative.
2. Open **Backend OAuth authorization**. When the scheme declares both supported flows, choose **Authorization code with reviewed grant**.
3. Select the configured provider alias and choose **Use reviewed grant for this route**.
4. Review the retained grant ID, required operation scopes, source scheme and public profile. Configure any additional header API-key scheme in that same alternative through its normal environment reference.
5. Choose **Validate configuration**, review the exact routes and backend authentication, then **Save new package**.

The compiler checks the original source hash, selected security scheme, resolved authorization/token endpoints, resource origin, declared profile scopes, required operation scopes, normalized profile hash and client-secret reference. The local server also reads the actual configured alias and current reviewed grant before preview, save, seller start and managed customer preparation/open.

A security alternative combines all schemes it contains. Separate alternatives are choices. Multiple simultaneous schemes that both require the Authorization header are rejected. The workspace does not reinterpret an unsupported login flow as client credentials.

The saved public merchant plan adds three operation fields:

| Field | Retained value |
| --- | --- |
| oauthAlias | The explicitly selected host alias |
| oauthProfile | Normalized public registration and original-source metadata |
| oauthConnection | Directory environment name, public profile hash, reviewed grant ID, exact required scopes, optional secret environment name |

Generated upstreams.json receives only oauthConnection. Private directory paths, access/refresh tokens, code verifiers and secret values are excluded from the plan and package.

Compilation is a pure source/configuration operation. Host validation reads the selected private grant metadata but does not exchange or renew a token. The original unpaid 402 seller route never acquires credentials or calls the protected backend.

## Operate the saved seller

Use the existing **Start challenge preview**, unpaid-route review, facilitator selection, native seller, operations dashboard, stop and reopen controls. Authorization-code routes use the original upstream/cache lifecycle.

A renewal preserves the reviewed grant ID. The provider reads current private state before selecting credentials for a delivery; credential changes participate in the original cache generation. The browser does not run a renewal scheduler.

The runtime’s **Backend OAuth lifecycle** table shows safe provider state, grant reference, expiry when known, acquisitions, renewals and failures. Grant approval, connection revision and remote cleanup appear in the separate provider controls. No token contents or token fingerprint is displayed.

Select **Renew current grant** for an explicit renewal when supported. Honor a displayed retry boundary. A provider can omit refresh support or expiry information; the UI reports that absence. It does not invent a lifetime.

If a rotating refresh may have reached the provider but its result was lost, the private state records that uncertainty. The old refresh token is not blindly replayed. Inspect the connection and authorize a replacement grant when required.

A successful replacement authorization receives a new grant ID. Existing application references remain bound to the previous grant. The route is marked stale and the server rejects a changed binding. Explicitly select the new reviewed grant, validate the source and terms, and save/release a new package through the existing workflow.

## Disconnect and retain remote cleanup

**Disconnect local grant** stops local use first. The optional remote revocation checkbox calls only the configured provider endpoint. Local disconnection remains effective if that request fails or its outcome is unknown.

The retained-cleanup table records each original grant, remote state, request identity and last attempt. Pending retry tokens stay in private host state across reconnect. Confirmed rows keep safe metadata only.

A retry selects the exact original grant’s cleanup row. First disconnect the current local grant: some providers revoke a token family, so retrying old cleanup while a new grant is serving an application is intentionally unavailable. The backend enforces that same condition.

Revocation status is the actual provider result. Local disconnection does not imply remote revocation succeeded.

## Recover an interrupted operation

Every durable browser command carries a generated request ID, original arguments and expected connection revision. Before dispatch, the browser retains only that public command metadata in session storage.

If a response is lost, the panel keeps **Retained connection request**. Refresh to inspect actual state and use **Retry exact retained request**. That sends the same semantic request; it does not create another operation or silently substitute a newer revision. Successful commands are recovered through the original private command journal.

A known validation or revision-conflict response clears that attempted command so the operator can review current state. An unknown outcome keeps the original command. A refreshed workspace access capability is transport state and does not change the semantic command identity.

For a closed browser tab or separate host session, use the original connection CLI’s status and attributed commands with the actual current revision and retained request ID. The core guide documents its private journal and renewal behavior. Do not copy private connection files into the source checkout, public package, container build context or customer download.

## Receiving-host handoff

The public merchant package contains its exact source, plan, generated upstream references and compiler output. The receiving host provisions the same approved connection reference through its credential/setup workflow and checks the source/profile/grant binding before launch.

Keep the connection directory durable and private. Restarting the workspace or seller uses that same approved store; it does not auto-authorize an account. Client-secret rotation follows the host’s existing credential provisioning. Changing the profile or approved grant requires the explicit route/package review described above.

The existing SF82 release manager and SF66 setup integration retain their normal release and credential selection workflows. This feature introduces no additional seller, buyer, publisher or background scheduler.

## Protocol references

The [OpenAPI OAuth Flow Object](https://spec.openapis.org/oas/v3.1.0.html#oauth-flow-object) defines the source flow URLs and scopes. [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html) defines PKCE verification, and [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) describes the OAuth security practices used here. Original implementation boundaries are authentication.mjs, oauth-http.mjs, the trusted host registry and the connection/provider modules under sf30-seller-sdk/oauth-connections.
