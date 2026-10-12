# Reviewed OAuth connections for an existing API merchant

This adapter connects an upstream API that declares the OAuth authorization-code flow in its original OpenAPI document. The operator authorizes the provider account, reviews the granted scopes, and selects that exact reviewed connection in the existing SF61 workspace. The original SF30 seller continues to own payment admission, request validation, upstream calls, caching, and delivery.

The generic adapter supports an OAuth access grant, not a provider account identity assertion. The provider's registered application, account access, declared scopes, API permissions, and endpoint support determine what that grant can do.

## QuickBooks company and merchant accounting

The maintained [QuickBooks connection guide](./QUICKBOOKS.md) uses this same controller for Intuit consent, reviewed callback realm, refresh-token rotation, and revocation. Its company selector reads actual native settings and all account pages, saves the reviewed company, and launches the original accounting workspace with that grant. Use `oauth-connection quickbooks --help` for the CLI or the typed `seller/oauth-connections/quickbooks` export. The explicit Intuit profile uses the provider's confidential-client flow and registered localhost or HTTPS callback.

## What is installed

Use Node 22 or later and the normal merchant source dependencies. The entry point is `sf30-seller-sdk/oauth-connections/cli.mjs`. There is no extra OAuth package to install.

The original client-credentials option remains in `sf30-seller-sdk/OAUTH.md`. The separate Google Sheets connector retains its existing setup and grant lifecycle. For the browser source/compiler workflow, use `sf61-openapi-seller-import/workspace/AUTHENTICATION.md`. Receiving-host preparation is documented with the original SF99 host tooling.

An authorization-code connection consists of three distinct things:

| Part | Content | Where it belongs |
| --- | --- | --- |
| Registered profile | Original source hash and security scheme; public client ID; endpoints, scopes, origins and provider parameters | Operator configuration |
| Private connection | Reviewed access/refresh grant, exact mutation receipts and pending remote cleanup | A dedicated private directory on the receiving host |
| Compiled reference | Environment variable name, profile hash, reviewed grant ID and required operation scopes | The original merchant plan and upstream binding |

The compiled package does not contain an access token, refresh token, client secret, private directory value, authorization code, PKCE verifier, or provider session.

## 1. Register the provider application and exact source

Read the provider's own registration and API documentation. The generic profile uses authorization code with PKCE S256, a public client or one of the provider's supported confidential-client methods, and a loopback callback at an explicitly selected port.

Select the original OpenAPI file, its OAuth security scheme and the operation scopes. Keep the original file bytes: changing formatting also changes its source hash. If the provider publishes another document version, create and review a new matching profile.

A public profile has this shape:

~~~json
{
  "schema": "stellar-forge.oauth-authorization-profile.v1",
  "label": "Records provider",
  "source": {
    "sha256": "REPLACE_WITH_THE_64_CHARACTER_ORIGINAL_FILE_SHA256",
    "scheme": "recordsOAuth"
  },
  "authorizationEndpoint": "https://login.provider.example/oauth/authorize",
  "tokenEndpoint": "https://login.provider.example/oauth/token",
  "revocationEndpoint": "https://login.provider.example/oauth/revoke",
  "issuer": "https://login.provider.example/",
  "clientId": "THE_REGISTERED_PUBLIC_CLIENT_ID",
  "authMethod": "none",
  "scopes": ["records.read"],
  "resourceOrigins": ["https://api.provider.example"],
  "authorizationParameters": {},
  "resourceParameters": [],
  "pkceMethod": "S256"
}
~~~

These are illustrative registration values. Use the selected provider's exact endpoints and scopes. Omit optional `revocationEndpoint` or `issuer` when the provider does not supply them. An issuer, when supplied, is compared with an issuer returned by the authorization response.

For a confidential application, select `client_secret_basic` or `client_secret_post` and add `"clientSecretEnv":"RECORDS_CLIENT_SECRET"`. Provision that variable privately in the same host environment used by the console and seller. The profile names the variable; it never contains the secret value.

`authorizationParameters` holds reviewed provider extras such as a documented prompt choice. It cannot replace reserved OAuth protocol parameters. `resourceParameters` holds explicitly reviewed resource indicator values when the provider supports them. The compiler still checks the exact source document, scheme, declared endpoints, required scopes, and upstream origin.

Normal provider endpoints require HTTPS on the default port and public DNS addresses. Token and revocation requests do not follow redirects. Plain HTTP is supported only for an explicitly enabled development provider on `127.0.0.1` with a port; `--allow-loopback` does not authorize arbitrary private-network endpoints.

## 2. Initialize the private store

Create a dedicated directory accessible only to the operator account. It must be separate from public source, compiled artifacts, logs, general recovery exports and any served directory.

~~~sh
mkdir -m 700 /private/merchant/records-oauth
node sf30-seller-sdk/oauth-connections/cli.mjs init \
  --directory /private/merchant/records-oauth \
  --profile /private/merchant/records-profile.json
node sf30-seller-sdk/oauth-connections/cli.mjs status \
  --directory /private/merchant/records-oauth
~~~

Initialization writes one private, atomic `connection.json` with mode 0600. Repeating initialization with the same normalized profile is harmless; another profile requires a separate store.

The status output includes `profileSha256` and the exact provider-specific `callbackPath`. Choose the local console port, then register:

~~~text
http://127.0.0.1:CHOSEN_PORT/oauth/callback/PROFILE_SPECIFIC_PATH_SUFFIX
~~~

Use the exact returned path, literal loopback host, and port. The browser workspace uses its own listener port for this same source-specific callback. The command-line connect flow uses the port supplied to `--port`. Do not register a broad callback prefix or substitute a different host.

## 3. Authorize and review

For a terminal flow:

~~~sh
node sf30-seller-sdk/oauth-connections/cli.mjs connect \
  --directory /private/merchant/records-oauth \
  --port 8419 \
  --actor "Named operator" \
  --reference "Provider account authorization, change record 42"
~~~

The command starts the exact local callback listener and prints the authorization URL. Open it in the account browser, complete the provider's normal login/consent, and return to the terminal. Inspect the provider-approved scope set, access-token expiry, and refresh capability. Type the requested approval only after that review.

The callback validates its state, one-time authorization code, PKCE S256 binding, redirect URI, and a returned issuer when a profile issuer is configured. Authorization codes, state, verifiers, and unapproved tokens stay in process memory. The callback returns to a script-free completion page without putting the workspace capability or provider tokens into the redirect.

There is a ten-minute authorization/review lifetime. This is separate from `tokenExpiresAt`, the actual granted access-token expiry. The adapter requires a usable Bearer token. When `expires_in` is returned, it must be a finite positive lifetime; an omitted expiry is shown as unknown. It rejects malformed, unsupported or already-expired grants. A provider that omits a refresh token can still be used until a supplied expiry or a provider rejection, with no automatic renewal available.

Approving a replacement produces a new grant ID. An existing reviewed grant remains usable while a new authorization is awaiting review; it changes only after explicit approval. Closing the process discards an unfinished authorization flow. Restart a new authorization if no approved result was committed.

## 4. Use the existing browser workspace

Configure trusted host aliases:

~~~json
{
  "schema": "stellar-forge.oauth-host-connections.v1",
  "connections": [
    {"alias": "records", "directoryEnv": "RECORDS_OAUTH_DIRECTORY"}
  ]
}
~~~

The host environment value for `RECORDS_OAUTH_DIRECTORY` is the actual private directory. The host configuration file contains only the alias and variable name. Select a real private 0700 store owned by the receiving operator; a request body cannot select an arbitrary path.

Start the original workspace with its private output parent and `--oauth-connections` file. Use the existing workspace's documented CLI and source import:

1. Import the original OpenAPI file and inspect the declared operation.
2. Open its authorization-code connection controls and select the configured alias.
3. Begin the provider authorization, then refresh the returned authorization status.
4. Review and approve the pending grant with the named operator and reference.
5. Select that current connection for the operation and inspect the public compilation preview.
6. Save the original merchant package and use the existing revision/stage/start workflow.

A saved plan includes the normalized public profile and exact raw connection reference. The trusted registry verifies the original source hash, security scheme, selected origin and operation scopes again on preview, save and start. Changing the account grant requires a new explicit selection and reviewed package revision.

The compiled upstream reference is:

~~~json
{
  "directoryEnv": "RECORDS_OAUTH_DIRECTORY",
  "profileSha256": "THE_APPROVED_PROFILE_SHA256",
  "grantId": "THE_APPROVED_GRANT_ID",
  "requiredScopes": ["records.read"]
}
~~~

A confidential profile also retains its `clientSecretEnv` reference. The binding is mutually exclusive with the original client-credentials binding and a separately supplied Authorization header.

## 5. Run on the receiving host

Provision the same reviewed private store and required environment references on the selected receiving host. Use the existing SF82 release preparation and SF99 host preparation. Its OAuth directory declaration must match the actual directory environment value.

The receiving checks inspect the profile identity, reviewed grant, required scopes and permitted API origin without making a provider request or printing token material. The generated service grants write access to the selected OAuth directory so atomic refresh and receipt persistence work. The original container mount preparation uses the same exact directory as an explicit writable bind and does not create a missing host directory.

Keep these surfaces separate: immutable source, merchant state/recovery, the private OAuth store, and environment/host configuration. Installing or restoring an ordinary merchant package does not silently replace an account grant. Use the original host guide for ownership and service-account setup.

At runtime, unpaid requests still reach the original payment challenge without obtaining an upstream credential or calling the provider API. Once the original application handler is invoked, this adapter obtains the token for the exact current profile/grant/origin/scopes. It then lets the original handler perform the request. No new payment verification, signing, settlement or paid-request retry engine is introduced.

## 6. Renew, reconnect and disconnect

The status output provides the current revision and grant ID. Mutating commands require those expected values and a caller-chosen request ID:

~~~sh
node sf30-seller-sdk/oauth-connections/cli.mjs refresh \
  --directory /private/merchant/records-oauth \
  --revision CURRENT_REVISION --grant CURRENT_GRANT_ID \
  --request-id renewal-change-42

node sf30-seller-sdk/oauth-connections/cli.mjs disconnect \
  --directory /private/merchant/records-oauth \
  --revision CURRENT_REVISION --grant CURRENT_GRANT_ID \
  --request-id disconnect-change-43 --revoke
~~~

Renewal retains the same approved grant identity and increments its generation. Rotated refresh tokens are committed atomically with the result. A known provider rejection, a response lost after dispatch, and a local atomic-save uncertainty remain distinguishable.

If a rotating refresh result is unknown, the old refresh token is not blindly reused. The connection becomes an explicit reconnect task; authorize and approve a new grant in the same connection controls. The previous compiled grant reference will then fail its identity check until the operator selects the new reviewed connection.

A backend 401 invalidates only the bearer used by that attempt. The original backend request is not automatically replayed. A late failure from an older token cannot invalidate a newer generation. Concurrent requests share a bounded acquisition; one cancelled caller does not discard another caller's refresh result.

Disconnect removes local access before remote cleanup is attempted. A failed or uncertain provider revocation remains in the private cleanup queue with its exact old grant and request identity. Status shows safe cleanup metadata; it does not reveal the retained token.

To retry a particular retained cleanup:

~~~sh
node sf30-seller-sdk/oauth-connections/cli.mjs revoke \
  --directory /private/merchant/records-oauth \
  --revision CURRENT_REVISION \
  --request-id cleanup-change-44 \
  --revocation-grant THE_OLDER_GRANT_ID
~~~

A newer connected grant must first be explicitly disconnected before an older remote cleanup can be sent. Provider revocation can affect related tokens; this prevents an old cleanup from unexpectedly revoking the newly connected account family. An omitted grant selector means the latest disconnected grant only, never an arbitrary older queue entry.

The queue retains at most 16 unfinished cleanup records and 64 records in total. Confirmed older entries can be retired. At capacity, the operator can complete retained cleanup or choose a local disconnect without requesting another remote revocation; the application does not silently discard an unfinished cleanup.

## Recovery and operational limits

Keep the exact request ID and command body after an unknown response. Refresh status, then retry that same operation rather than minting a new ID. The private store records recent completed results in the same atomic file as the grant, and replays a matching retained request before applying a new revision check. A reused ID with a different command is rejected. This is a bounded recent-operation journal, not indefinite historical storage.

If the command reports `OAUTH_CONNECTION_SAVE_UNKNOWN`, the filesystem may already contain the completed result. Read current status and retain the original request for reconciliation. If the process stopped after a refresh was sent but before a usable result was saved, reconnect rather than reusing a possibly consumed refresh token.

Connection acquisition is bounded by a 30-second request timeout, response limits, and the original upstream deadline. Token/refresh responses are never copied into ordinary error messages. Closing a runtime waits for its owned in-flight exchange/save to drain; it does not turn an uncertain provider result into a successful grant.

Private directory backups contain account access material. Keep them under the operator's existing access controls. Public packages, support exports and source repositories contain only profiles/references and safe status. Do not paste tokens, callback URLs containing codes, or private environment values into a ticket.

## Protocol references

- [OAuth security best current practice, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)
- [Native applications and loopback redirects, RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)
- [Proof Key for Code Exchange, RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html)
- [Token revocation, RFC 7009](https://www.rfc-editor.org/rfc/rfc7009.html)
- [Resource indicators, RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)
- [OpenAPI 3.1 OAuth flow declarations](https://spec.openapis.org/oas/v3.1.1.html#oauth-flow-object)

These references explain the protocol choices. The supported provider features and exact endpoint values still come from the selected provider's documentation and the retained original OpenAPI source.
