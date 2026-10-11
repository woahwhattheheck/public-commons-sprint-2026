# OAuth API merchant setup

The API workspace can configure an OpenAPI `oauth2` security scheme with a
declared `clientCredentials` flow. Authorization-code grants use the companion
[authorization connection workflow](AUTHORIZATION_CONNECTIONS.md) in the same workspace.
The saved merchant uses the original SF30
OAuth provider for token acquisition and renewal, the original upstream for
backend requests, and the existing native seller for each delivery.

Start the [existing workspace](README.md#start), load the API's original JSON
description, and choose the routes and backend server. Each route retains its
own security alternative and required scopes.

## Configure the selected route

1. In **Backend credentials and response settings**, select the declared
   security alternative. An alternative containing several schemes requires
   all of them; a different alternative is a separate choice.
2. Open **Backend OAuth authorization** and choose **Client credentials** when both flows are declared. Review the **Declared token endpoint**.
   Relative token URLs resolve against the selected original backend server.
   The public address of the paid seller does not change that resolution.
3. Enter two distinct environment-variable names for the client ID and client
   secret. Configure their values in the environment that launches the
   workspace or saved seller. The form accepts references such as
   `MERCHANT_API_CLIENT_ID` and `MERCHANT_API_CLIENT_SECRET`.
4. Select the provider's documented token authentication method: HTTP Basic
   (`client_secret_basic`) or credentials in the form body
   (`client_secret_post`). OpenAPI declares the flow and endpoint; this method
   is an explicit operator choice. Enter an audience only when the provider
   requires one.
5. Required scopes are selected and marked **required**. Select additional
   scopes only from the flow's declared list when needed. The compiler checks
   that the requested set contains the operation's required scopes and no
   undeclared scopes.
6. Review token lifecycle limits if the provider needs different settings.
   Leave the fallback lifetime empty when responses include `expires_in`.
   A fallback should come from that provider's documented expiry policy.
7. **Validate configuration**, review the exact endpoint, scopes, method and
   environment references, then **Save new package**. Start the saved seller
   through the existing workspace or its printed native command.

For an alternative that combines OAuth with a header API key, configure that
API key's environment reference in the existing header map. OAuth supplies the
`authorization` header itself. Two simultaneous schemes that both need that
header require a different declared alternative or a trusted custom handler.

The source inspector reports unsupported flows with the relevant scheme name.
Declared authorization-code flows use an explicitly configured host connection and
reviewed grant; follow [the complete operator guide](AUTHORIZATION_CONNECTIONS.md).
Implicit, password and OpenID Connect login flows need their own trusted application
integration. They are not converted into client credentials by this workspace.

## Saved plan and launch environment

The existing `stellar-forge.api-merchant-plan.v1` operation accepts the original
`oauth2` configuration. For example, an operation whose source requires
`records:read` can retain:

~~~json
{
  "method": "GET",
  "path": "/records",
  "amountAtomic": "20000",
  "securityAlternative": 0,
  "oauth2": {
    "clientIdEnv": "MERCHANT_API_CLIENT_ID",
    "clientSecretEnv": "MERCHANT_API_CLIENT_SECRET",
    "authMethod": "client_secret_basic",
    "scope": "records:read"
  }
}
~~~

The original source supplies the token URL. If a plan also supplies
`oauth2.tokenEndpoint`, it must match the source flow resolved against the
selected backend. The generated `upstreams.json` retains the resolved endpoint,
normalized policy and environment references. Original source bytes, public
request examples, response contracts and native route cases remain in the same
private package and manifest.

Validation and package creation use the original provider's policy compiler
with temporary placeholders. They read no credential values and make no token
request. Starting the original seller resolves its required environment
variables. The provider obtains a token when a backend request is dispatched.
The unpaid route checker continues to call the existing challenge preview.

Reopen a saved package to inspect the same server, endpoint, scope selections,
credential references and lifecycle choices. Save changed configuration under
a new package name. When changing from a sandbox server to a production server,
review both the backend target and the resolved token endpoint.

## Renewal and shared reads

The original provider coordinates concurrent renewal requests, applies the
configured expiry margin and token-failure delay, and observes the current
client credential environment. A restarted seller starts with a fresh token
provider. Update the launch environment and restart through the existing
workspace or SF82 release manager when rotating deployed credentials.

GET and HEAD can use the existing explicit shared-read policy. The original
runtime resolves credentials before choosing its cache generation, so expired
or rotated credentials cannot keep selecting an old authenticated result.
Source scope and token endpoint are part of the configured provider identity.
Payment and request admission still happen through the native seller for each
delivery.

The **Backend OAuth lifecycle** table in the existing runtime section shows
each binding's original provider state, renewal and expiry countdown, waiting
requests, token requests, successful token exchanges and failures. Challenge preview leaves the
provider empty. Identical provider configurations share a lifecycle, so the
same counters may appear on several routes. The view reports no token contents,
credential values or credential fingerprints.

The original provider reports its state and counters without token contents.
Its errors distinguish unavailable credential references, token rejection,
insufficient returned scope, expiry, cancellation and retry delay. Fix the
provider configuration or launch environment through the same saved merchant
workflow. An upstream authentication failure does not cause an automatic
mutation retry.

## Source examples

PayPal maintains original OpenAPI descriptions for
[Catalog Products](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/catalogs_products_v1.json)
and [Transaction Search](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/reporting_transactions_v1.json).
They declare client credentials, a relative token URL and operation-specific
scope requirements, making them useful source-import examples. PayPal's
[authentication documentation](https://developer.paypal.com/api/rest/authentication/)
specifies HTTP Basic for its client-credentials token request.

These descriptions retain `pattern`, provider-specific `format` and directional
property annotations. The original SF25 validator evaluates the supported
string patterns through pinned RE2JS 2.8.6; source checkouts should first run
`npm ci --prefix stellar-forge/payment-auto-catalog --ignore-scripts` from the
repository root. See the [schema support and dependency guide](../../../../stellar-forge/payment-auto-catalog/README.md).
OpenAPI 3.0 applies required read-only and write-only fields by direction;
OpenAPI 3.1 retains JSON Schema required semantics. Format names remain
annotations, including PayPal's provider-defined names.

The OpenAPI specification defines
[OAuth flows and scopes](https://spec.openapis.org/oas/v3.1.1.html#oauth-flow-object)
and [relative API URLs](https://spec.openapis.org/oas/v3.1.1.html#relative-references-in-api-urls).
Runtime policy remains in the original
[OAuth provider](../../sf30-seller-sdk/oauth-client-credentials.mjs).
