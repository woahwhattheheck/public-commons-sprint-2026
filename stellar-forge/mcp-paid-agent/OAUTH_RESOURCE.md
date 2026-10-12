# OAuth access for the existing MCP service

Stellar Forge can accept OAuth access tokens at its existing buyer and merchant HTTP MCP endpoints. An existing authorization server handles login, consent and token issuance. The resource server validates the token before the original MCP handler dispatches a request. Operators can prepare configuration, discover deployed metadata, connect Claude Code, and receive the complete tool catalog with the commands in this guide.

For an installed merchant package, use `starforge mcp-oauth` with the same five commands. Select `--feature mcp` through the maintained runtime installer; see [Installed OAuth MCP resource](../../stellar/scf-starforge-20261009/distribution/MCP_OAUTH.md) for archive/runtime setup, exact installed launch and recovery.

The implementation uses the MCP authorization specification dated **2026-07-28** and RFC 9728 protected-resource metadata. Its original JSON HTTP transport continues to negotiate **MCP 2025-11-25**. These version numbers describe different parts of the service. The current transport returns one JSON response per request and does not offer an SSE stream, server push or tasks. [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

## 1. Select the workspace and identity provider

Use the installed source/package with its declared dependencies and Node **22.13.0 or newer**, as required by the existing package manifest. The OAuth resource validator adds the maintained `jose` dependency. Fixed bearer and stdio deployments retain their existing access paths; OAuth is explicitly selected in the HTTP launchers.

Determine these values before creating configuration:

| Value | What to select |
| --- | --- |
| Resource | The final externally reachable HTTPS MCP URL, for example `https://mcp.example.com/mcp`. Use this exact value as the access-token audience/resource. |
| Issuer | The authorization server's exact issuer string. Trailing slashes are significant. |
| JWKS URL | The provider's published HTTPS public signing-key set. Pin this trusted location in configuration. |
| Access-token algorithm and type | Values from the provider's **access-token** configuration. Defaults are `RS256` and `at+jwt`. |
| Operator subjects | Exact `sub` values belonging to the users/service identities authorized for this particular shared workspace. Select each under its issuer. |
| Baseline and tool scopes | Scopes the provider can grant for this resource. Each request needs the baseline; a tool can add its own required scopes. |

Configure an API/resource at the existing provider for the exact resource URI and the desired scopes. Its access tokens must be signed JWTs with a matching issuer and audience, a subject and an expiration. Select the expected signing algorithm and token type explicitly. The validator also checks a supplied `nbf`, validates time bounds, and verifies the signature against the pinned public-key set. This implementation consumes JWT access tokens; providers that issue opaque access tokens require their own supported verification adapter before deployment here. MCP itself does not prescribe one token format. [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

The provider must support the browser client's authorization-code flow with PKCE S256. The client sends the MCP resource identifier during authorization and token exchange. Clients obtain their own token and manage its refresh with the authorization server. `offline_access`, when a provider/client needs it, belongs to that authorization flow; do not add it to the resource's required scopes. [MCP security requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) · [RFC 8707 resource indicators](https://www.rfc-editor.org/info/rfc8707/)

`id_token_signing_alg_values_supported` in OIDC discovery describes ID tokens; it is not the access-token algorithm contract. A provider using `typ: JWT` for access tokens can be configured with `--token-type JWT` when that is its documented access-token format. Configure an audience dedicated to this MCP resource. The default `at+jwt` check follows the access-token type convention, while the complete RFC 9068 profile includes additional claims and issuer requirements beyond this service's configurable validator. [RFC 9068](https://datatracker.ietf.org/doc/html/rfc9068)

**Workspace boundary:** both original launchers expose one operator workspace. Every configured issuer therefore requires explicit `allowedSubjects`. All those subjects share that workspace's quotes, results and configured provider authority. Applications serving separate customers must embed the authorizer with their existing current-user authorization and workspace selection; adding several subjects to a launcher does not create isolated customer workspaces.

## 2. Create and inspect private configuration

Run these commands from `stellar-forge/mcp-paid-agent`. Replace the example addresses and subject with the selected provider values. The output directory must already exist and be private to the service operator.

```bash
node oauth-resource-cli.mjs init \
  --resource https://mcp.example.com/mcp \
  --issuer https://identity.example.com/tenant \
  --jwks https://identity.example.com/tenant/jwks \
  --subject exact-provider-operator-subject \
  --scope mcp:read \
  --tool-scope bazaar_preview=mcp:prepare \
  --tool-scope bazaar_execute_approved=mcp:execute \
  --tool-scope sf43_discover_review_and_pay=mcp:execute \
  --tool-scope bazaar_cancel=mcp:manage \
  --tool-scope bazaar_recover_result=mcp:manage \
  --output /absolute/private/starforge/oauth-resource.json

node oauth-resource-cli.mjs describe \
  --config /absolute/private/starforge/oauth-resource.json
```

The tool scopes above use the **buyer** catalog. Choose the real tool names from the merchant catalog when configuring the merchant launcher. Repeating `--subject`, `--scope`, `--algorithm` or `--token-type` adds an explicit value. `--scope-claim scp` selects providers using an `scp` string or array; the default `scope` claim is a space-delimited string. Repeated `--tool-scope` entries for a tool combine its scopes.

An approved buyer request still goes through the existing quote, approval and signing flow. The incoming OAuth context supplies caller identity and scope authority; the original trusted operator module continues to decide approval and sign payments. Upstream merchant credentials remain in the original provider/host capabilities.

The generated configuration includes these operational defaults:

| Setting | Default | Purpose |
| --- | ---: | --- |
| `clockToleranceSeconds` | 30 | Tolerate a small difference between provider and host clocks. |
| `jwksTimeoutMs` | 5000 | Deadline for obtaining the complete signing-key response. |
| `jwksCacheMaxAgeMs` | 300000 | Refresh the maintained in-memory key cache after five minutes. |
| `jwksCooldownMs` | 30000 | Limit repeated key lookups while supporting provider key rotation. |
| `maxJwksBytes` | 262144 | Maximum complete published key-set response. |
| `maxTokenBytes` | 16384 | Maximum accepted access-token size. |

`describe` reports the exact resource, metadata path, issuer settings, scopes and current authorizer state without contacting the provider. `scopesSupported` may be set to a minimal resource scope set. The challenge emitted for an actual tool operation contains the baseline plus every scope that operation requires, allowing the client to request the current complete set. [MCP scope selection](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

## 3. Start the existing buyer or merchant

For the buyer, select the existing discovery service, durable workspace and approved operator module through their original configuration. Add the absolute OAuth configuration path:

```bash
env -u MCP_ACCESS_TOKEN \
  MCP_OAUTH_CONFIG=/absolute/private/starforge/oauth-resource.json \
  BAZAAR_DISCOVERY_URL=https://existing-discovery.example.com \
  MCP_STATE_DIR=/absolute/private/starforge/existing-buyer-state \
  MCP_PORT=3210 \
  node serve.mjs
```

Include the existing `MCP_OPERATOR_MODULE` and `PAID_RESOURCE_ORIGINS` settings for an installed paid buyer. Their meaning is unchanged. `MCP_CLIENT_ORIGINS` can select specific client Origin headers accepted by the original transport. Native desktop clients normally authenticate with the bearer header.

For the merchant, use its **existing** merchant MCP configuration and workspace:

```bash
env -u MCP_ACCESS_TOKEN \
  node ../mcp-merchant-operator/serve.mjs serve \
  --config /absolute/private/starforge/existing-merchant-mcp.json \
  --oauth-config /absolute/private/starforge/oauth-resource.json \
  --port 3211
```

The merchant also accepts `MCP_OAUTH_CONFIG`. Fixed bearer mode and OAuth mode are mutually exclusive. The original loopback browser console can use a current OAuth access token in its existing token field; browser login and token refresh are handled by the selected OAuth client/provider flow.

Both services listen on `127.0.0.1`. Put the selected service behind the deployment's existing HTTPS reverse proxy. For a resource ending in `/mcp`, route these two exact paths to that same listener:

| Public path | Route |
| --- | --- |
| `/mcp` | Original MCP handler, preserving `Authorization`, `Accept`, `Content-Type`, `Origin` and `MCP-Protocol-Version`. |
| `/.well-known/oauth-protected-resource/mcp` | Public protected-resource metadata generated by that same configured authorizer. |

Preserve `WWW-Authenticate` and `Retry-After` on responses. Keep the original console on its intended operator access path. Resource and issuer URLs come from trusted configuration rather than request `Host` or forwarded headers. A resource with another path gets the corresponding well-known path insertion; `describe` prints the exact deployment route.

An illustrative Nginx route inside the deployment's existing TLS server is:

```nginx
location = /mcp {
    proxy_pass http://127.0.0.1:3210;
    proxy_http_version 1.1;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Origin $http_origin;
    proxy_read_timeout 30s;
}
location = /.well-known/oauth-protected-resource/mcp {
    proxy_pass http://127.0.0.1:3210;
    proxy_http_version 1.1;
}
```

Select the existing valid certificate for the resource host. Metadata and authenticated requests require HTTPS. The operator does not follow redirects; point the resource and discovery configuration at the final endpoints.

## 4. Discover the deployed service

```bash
node oauth-resource-cli.mjs discover \
  --config /absolute/private/starforge/oauth-resource.json \
  --output /absolute/private/starforge/oauth-discovery.json
```

The command first reads the resource's Bearer challenge and follows its protected-resource metadata URL. It can fall back to the endpoint-specific and root protected-resource well-known locations. It then tries the current OAuth authorization-server and OIDC discovery locations in the specified order, checks the exact issuer identity, and reads the complete published JWKS. A 404 or 405 permits the documented discovery fallback. A successful document naming the wrong issuer/resource is an error. [MCP discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)

If the resource advertises several authorization servers, select one explicitly with `--issuer EXACT_ISSUER`. With `--config`, discovery also checks the selected issuer and JWKS against the pinned configuration. Alternatively, start from `--resource HTTPS_MCP_URL` to inspect a service before preparing local configuration.

The report includes the exact public URLs, complete response byte counts and hashes, public key identifiers/types, scopes, PKCE S256 availability and advertised client-registration capabilities. `compatible: false` includes the specific provider metadata that needs configuration and exits with status 2. The tool does not infer access-token algorithms from OIDC ID-token settings.

Public metadata uses the existing SF31 transport, which validates public DNS results and pins the connection to a permitted address. For an explicitly selected private HTTPS deployment or custom HTTPS port, name each necessary origin:

```bash
node oauth-resource-cli.mjs discover \
  --config /absolute/private/starforge/oauth-resource.json \
  --trusted-origin https://selected-mcp.internal.example:8443 \
  --trusted-origin https://selected-issuer.internal.example:8443
```

Those origins select the regular trusted HTTPS transport for **this diagnostic**. They do not alter the service's key-fetch configuration. An embedded service using a private provider supplies its trusted `oauthFetchImpl`/`fetchImpl` host capability explicitly. That implementation must honor the supplied abort signal through response consumption, preserve TLS verification and avoid credential forwarding. Use the host's selected CA configuration when private TLS requires it.

Each request has a default ten-second deadline covering headers and the complete response, and a one-MiB response limit. `--timeout-ms` and `--max-bytes` can increase these within their documented command limits. Provider 429/503 responses preserve a sanitized `Retry-After`; select the same operation again after the provider's interval. There is no automatic retry loop.

## 5. Register Claude Code and sign in

Create a native Claude Code HTTP registration:

```bash
node oauth-resource-cli.mjs client-config \
  --config /absolute/private/starforge/oauth-resource.json \
  --name stellar-forge \
  --output /absolute/private/starforge/claude-mcp.json
```

The generated entry is:

```json
{
  "mcpServers": {
    "stellar-forge": {
      "type": "http",
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

Use `--merge EXISTING_CLAUDE_CONFIG` with a separate new output to preserve other server entries and private settings. The command refuses a server-name collision. Configure the resulting entry at the chosen Claude Code scope, or use Claude Code's own registration command:

```bash
claude mcp add --transport http stellar-forge https://mcp.example.com/mcp
claude mcp login stellar-forge
```

Claude Code performs the browser OAuth flow and keeps its credentials in its own credential storage. Its interactive `/mcp` interface also offers authentication. For a headless receiving machine, `claude mcp login stellar-forge --no-browser` uses the client's documented authorization URL and redirect-paste flow. The generated configuration contains the server URL rather than a copied access token. [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)

An existing pre-registered OAuth client takes precedence. Otherwise, the current MCP registration preference uses Client ID Metadata Documents when the provider advertises support, with legacy dynamic registration available as a fallback. The provider's registered redirects must match the client's current callback exactly, and registration credentials remain associated with their issuer. Claude Code supports `--client-id`, a masked `--client-secret` prompt, and `--callback-port` when an administrator has pre-registered the client. Configure those through the client's own commands when needed. [MCP client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration) · [Claude Code MCP authentication](https://code.claude.com/docs/en/mcp)

## 6. Receive the complete protected endpoint

Use a current access token obtained through the selected provider's supported flow. Keep it in a dedicated environment variable or an owner-only file. The command takes the variable **name**, never its token value:

```bash
node oauth-resource-cli.mjs probe \
  --config /absolute/private/starforge/oauth-resource.json \
  --token-env STARFORGE_OAUTH_ACCESS_TOKEN \
  --output /absolute/private/starforge/oauth-receiving.json
```

Or select `--token-file /absolute/private/starforge/current-access-token` with mode 0600. A token file may end with one LF or CRLF. Any other whitespace or malformed bearer-token input is rejected. The client treats the token as opaque; verification belongs to the running resource server.

The probe sends `initialize`, then `notifications/initialized`, then every `tools/list` page through the original authenticated handler. Each request sends its token to the exact configured MCP resource. It verifies the negotiated protocol version, server identity, unique tool names and object schemas. A repeated cursor or unfinished page limit produces an error instead of a partial catalog marked complete.

The result records server identity, complete tool count, tool names and schema hashes. If the service creates an MCP session, the probe retains its identifier only in memory and attempts DELETE on that same resource at the end, including on a later failure. `termination` records `closed`, `unsupported` for HTTP 405, or `failed`. The original stateless JSON transport normally returns no session identifier, so termination is then unnecessary. Report fields and errors exclude the token, session identifier and provider description text that could echo credentials.

The connection probe is a read-only operator action. For a product receiving run, continue with the original buyer/merchant journey and its selected scopes, durable quote/result workspace and trusted approval/signing adapter. The `mcp:execute` scope permits a request to reach that existing approval flow; the original operator still decides whether its reviewed payment can proceed.

## Embedding and operating the service

Use `loadOAuthResourceHost({configPath, bearerToken, fetchImpl})` from `oauth-host.mjs` to share the launchers' existing configuration behavior. It returns `transportOptions`, `wrap(handler)`, `describe()` and `close()`. `wrap` serves the configured public metadata route before the existing handler. The buyer exposes `startMcpWorkspace({environment, oauthFetchImpl})`; the merchant exposes `startMerchantMcp({configPath, oauthConfigPath, oauthFetchImpl, ...})`.

For an application with its own user/workspace authority, construct `createOAuthResourceAuthorization(config, {fetchImpl, authorize})` directly and give it to `createMcpToolHandler(provider, {authorization})`. The optional `authorize({context, tool, arguments, signal})` callback runs for each control/tool operation and must return exactly `true`. Use current host authorization and workspace selection there. The immutable verified context contains `subject`, `issuer`, `audience`, `scopes`, `clientId`, `issuedAt` and `expiresAt`. The provider receives that same context in its third argument, `{authorization: context}`.

The authorizer fetches signing keys lazily and uses the maintained JOSE cache/rotation behavior. Update the existing provider key set through its normal key-rotation process. Configuration changes, including selected subjects/scopes/issuers, take effect when the original service is reopened with the reviewed configuration. Applications needing immediate changes to per-user permission can use their existing current-state host callback. Close the original service through its returned `close()` function so the listener, authorization requests and original product stores are drained together.

| Result | Operator action |
| --- | --- |
| 401 `invalid_token` | Obtain a current access token for this exact resource and issuer; check the configured algorithm/type and clock. |
| 403 `insufficient_scope` | Request the complete scope set in the Bearer challenge for the attempted operation. |
| 403 `access_denied` | Check that the current subject belongs to this selected workspace and the host permits that operation. |
| 503 with `Retry-After` | Inspect the selected provider's key endpoint and current service state, then resume after the indicated interval. |
| `ISSUER_MISMATCH` / `JWKS_MISMATCH` | Reconcile the selected provider's actual metadata with the explicit trusted configuration. |
| `REDIRECT_REFUSED` | Configure the final HTTPS endpoint and route it directly. |
| `MCP_CATALOG_LIMIT` | Increase `--max-pages` or response bytes only when the complete actual catalog requires it, then rerun the same receiving check. |

Every configuration/report output is published as a new mode-0600 file without replacing an existing path. A client-config merge reads the existing local document and publishes a separate complete result. Keep the selected configuration beside the original workspace's deployment material so another operator can reopen the same service and repeat discovery and receiving.
