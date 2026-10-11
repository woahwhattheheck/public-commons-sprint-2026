# Private OAuth connections on the merchant host

This guide joins the original authorization-code connection, SF61 operator workspace, SF82 release and SF99 Linux/container deployment. The application package carries a public profile identity, approved grant ID, required scopes and environment names. The host keeps the actual connection directory and tokens.

## Installed command and SDK

An installed Starforge package exposes the same maintained connection commands as `starforge oauth-connection`. For example, `starforge oauth-connection status --directory /var/lib/merchant-oauth/provider` reads the original private connection, and `starforge oauth-connection connect` accepts the same options shown below. Use the installed command in place of the repository-relative `node …/cli.mjs` prefix in the examples; its arguments and terminal approval flow are unchanged.

The package also exports `./seller/oauth-connections`, `./seller/oauth-connections/profile` and `./seller/oauth-connections/host` for callers embedding the connection lifecycle, public profile compiler or operator registry. The existing seller, API workspace, release and merchant-host commands consume that same connection state.

## Prepare and authorize the receiving connection

Use the exact OpenAPI document selected in the original API workspace. Register a client with that provider for its declared authorization-code flow and PKCE S256. The profile must name the actual authorization/token endpoints, required scopes, permitted backend origins and the source document's SHA-256/security-scheme name. Copy the normalized profile format from the connection guide. Supply a secret through its declared environment name when the provider requires a confidential client; do not put its value in the profile.

Create the connection under the account that will operate it. For a service deployment this is the configured unprivileged service account, with a private 0700 directory and private original state files. For example, after its administrator provisions the empty directory:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/cli.mjs init \
  --directory /var/lib/merchant-oauth/provider --profile /private/provider-profile.json
node stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/cli.mjs connect \
  --directory /var/lib/merchant-oauth/provider --port 8255 \
  --actor merchant-operator --reference initial-provider-authorization
```

Run these commands in that account's actual private environment. `connect` prints the authorization URL, receives the provider's one-time callback, shows the returned grant's actual scopes and requires terminal approval before saving it. The callback is the exact source-specific `http://127.0.0.1:8255/oauth/callback/…` path; register the path printed by the original connection status with the provider. On a remote receiving host, an authorized operator can forward that same port with `ssh -L 8255:127.0.0.1:8255 HOST` before opening the URL in their own browser. Keep that forwarding bound to local loopback.

An existing approved connection should be reopened through `status`, rather than initialized again. The app records a reviewed authorization grant; it does not infer the person's identity from OAuth token responses.

## Make the connection available to the original workspace

Provision `PROVIDER_OAUTH_DIRECTORY` in the workspace's host environment with the private absolute canonical directory. The trusted host configuration contains only names:

```json
{
  "schema": "stellar-forge.oauth-host-connections.v1",
  "connections": [{"alias": "provider", "directoryEnv": "PROVIDER_OAUTH_DIRECTORY"}]
}
```

Pass this file to the original workspace's `--oauth-connections FILE` option, or pass the validated array as `startWorkspace({oauthConnections, env})`. The file must be a regular file at its canonical path, without group/world write access. Aliases and environment names are unique. Only these configured aliases can be used by the HTTP/browser interface; requests cannot choose a host path.

The workspace's connection controls use that same core for authorization, returned-grant review, refresh, local disconnect and remote revocation. The route selection retains its explicit `oauthAlias`, public profile and upstream connection reference. Preview, save and launch check the same configured alias against the current source/profile/grant. A saved package can be reopened to revise a stale selection.

Before producing a runtime binding, the registry checks the original source SHA and security scheme, profile identity, selected backend origin, required scopes and the current explicitly approved grant. The original importer additionally checks the source's actual authorization/token endpoints. The directory must remain the same private inode for that open workspace. Replacing it requires reopening the workspace and reviewing the actual connection.

## Stage and review the original release

Use the original SF61 save and SF82 stage workflow. `upstreams.json` retains only:

```json
{
  "oauthConnection": {
    "directoryEnv": "PROVIDER_OAUTH_DIRECTORY",
    "profileSha256": "the-actual-64-character-profile-digest",
    "grantId": "the-actual-approved-grant-id",
    "requiredScopes": ["the.actual.required.scope"]
  }
}
```

A confidential client also includes its declared `clientSecretEnv` name. Use the actual compiler-generated values, not the illustrative markers above. SF82's immutable upstream review includes this public connection reference and lists both required directory and secret environment references. Staging does not resolve their values, inspect a private grant directory or contact a provider.

The release retains the selected grant ID. A successful token refresh preserves that ID. A newly approved reconnect creates a new ID, so the earlier package cannot silently adopt a different authorization grant. Save and stage the intended new selection using the original workflow.

## Configure systemd or the existing merchant container

Add an explicit `oauthDirectories` map to the existing SF99 host plan:

```json
{
  "environmentFile": "/etc/merchant/private.env",
  "oauthDirectories": {
    "PROVIDER_OAUTH_DIRECTORY": "/var/lib/merchant-oauth/provider"
  }
}
```

This is a fragment of the existing host plan. Preserve its original schema, seller/release selection, approved payment configuration, source path and service account. Its directory names must match exactly those used by the selected original upstreams. Each store must be separate from the source release, merchant state, configuration files, other stores and generated bundle.

Provision the original private `EnvironmentFile` so the selected directory environment reference equals this reviewed path exactly. Keep client secrets in their own declared references. The generator reads neither the environment file's contents nor token state. It creates no connection directory and initiates no provider authorization.

For systemd, the generated seller unit adds only its declared OAuth stores to `ReadWritePaths`; other original service units retain their existing writable paths. The original bundle check runs first, then `oauth-connections/host-check.mjs` runs in the actual seller account/environment before launch. The preflight checks directory ownership, 0700 access, profile identity, approved grant, origin and scopes without token exchange, refresh or revocation.

For the existing SF99 container, each selected store must already exist and belong to the configured numeric container UID. The exact-path mount is writable, does not create missing host paths, and cannot overlap a read-only source/bundle/extra mount. The container remains the original combined merchant process tree; this adds no separate token container or daemon. Its existing environment reader provisions the same references, and the same connection preflight runs before a seller is started. The existing maintenance mode can operate its selected non-seller services independently.

Build contexts and customer downloads contain code and public references only. Neither the workspace package, source image, host bundle nor original merchant recovery selection includes the private connection directory. Its explicit mount remains outside the image-owned source even when the original container uses `sourceMode: "image"`.

## Operate and recover

The original upstream handler requests credentials only when it performs an authorized backend operation. The unpaid challenge path does not exchange or refresh an OAuth token. Cache generation and rejected-token invalidation continue through the original credential-provider interface, and the integration introduces no automatic paid-request replay.

Use the original connection CLI or workspace controls to refresh or disconnect. Durable commands retain their expected revision, grant ID and original request ID; after an uncertain response, retry that same operation. The original connection store serializes cross-process changes. An interrupted rotating refresh requires its explicit recovery/reconnect path; an old refresh token is not silently replayed.

Local disconnect immediately ends use of that grant. Remote revocation has its own retained outcome. An unresolved older cleanup remains visible if a new grant is approved, and must be explicitly selected for retry after the newer local grant has been disconnected. The provider may revoke a token family, so the UI does not silently revoke an older grant during a newer active connection.

The original merchant backup/restore covers the same merchant state and configuration. Keep the current separate connection store intact during a same-host merchant restore; do not roll rotating token state back with application data. For a new host, initialize and approve the receiving connection through the actual provider flow, then compile/stage its actual new grant and regenerate the host plan. This keeps restored merchant behavior bound to a current reviewed authorization.

## Source interfaces

`readOAuthHostConnections(file)` returns the validated alias array. `openOAuthConnectionRegistry` exposes async `list`, `status`, `begin`, `complete`, `approve`, `discard`, `refresh`, `disconnect`, `revoke`, `binding` and `close`. List/status add only the configured alias and directory environment name to the original safe status. Other operations retain their core result shapes. Neither surface returns resolved filesystem paths or tokens.

`prepareOAuthHostDirectories` is a pure planner over public upstream requirements. `validateOAuthHostDirectories` checks the retained host topology. `checkOAuthHostConnections` runs under the actual service environment and returns public profile/grant identities and counts, without credential values or network requests. Both original systemd and container startup use this one receiving-host check.
