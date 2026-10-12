# Installed OAuth MCP resource

Use the maintained merchant package to configure and operate incoming OAuth on
the original buyer or merchant MCP service. The installed `mcp-oauth` command
dispatches directly to `stellar-forge/mcp-paid-agent/oauth-resource-cli.mjs`.
Its five operations use the same resource validator, host configuration,
discovery transport and complete-catalog probe as the original source.

The original [OAuth resource guide](../../../stellar-forge/mcp-paid-agent/OAUTH_RESOURCE.md)
covers provider registration, issuer subjects, scopes, access-token formats,
HTTPS routing and client authorization. This guide connects those operations
to the selected archive, installed dependencies and maintained runtime lifecycle.

## Commands and imports

| Installed entry | Original operation |
| --- | --- |
| `starforge mcp-oauth init` | Create a private configuration for the exact resource, issuer, signing-key location, workspace subjects and scopes. |
| `starforge mcp-oauth describe` | Inspect that configuration and its exact protected-resource metadata route. |
| `starforge mcp-oauth discover` | Receive the deployed resource challenge, protected-resource and provider metadata, and complete public signing-key set. |
| `starforge mcp-oauth probe` | Authenticate to the selected resource, initialize MCP and receive every tools/list page. |
| `starforge mcp-oauth client-config` | Create a Claude Code HTTP registration, or merge one named registration into a separate copy of an existing configuration. |
| `@tokenjunkielabs/starforge-merchant/mcp/oauth-resource` | Original validator, metadata and authorization API, with the original `.d.mts` definitions. |
| `@tokenjunkielabs/starforge-merchant/mcp/oauth-host` | Original private configuration loader and service metadata wrapper, with its `.d.mts` definitions. |
| `@tokenjunkielabs/starforge-merchant/mcp/oauth-discovery` | Original discovery and authenticated receiving functions. |
| `@tokenjunkielabs/starforge-merchant/mcp/oauth-operator` | Original configuration, client-registration, private-output and CLI functions. |

Run `starforge mcp-oauth --help` for the exact flags. The maintained dispatcher
passes the original argument array unchanged, uses its selected Node executable
and forwards process signals to the original command. Every configuration or
report is a new mode-0600 file; select an unused output path for a later operation.

## 1. Select and install the complete runtime

Start with the actual maintained source archive that contains `mcp-oauth`.
Keep its full SHA-256 from the producer alongside the archive. A source-only
installation made with `--omit=optional` carries the source and documentation;
prepare its runtime through the same installed `runtime-install` command.

The original `runtimePackageManifests.mcp` entry reads
`stellar-forge/mcp-paid-agent/package.json`. The source declares
`jose: 6.2.12` beside its existing MCP and x402 dependencies. The maintained
builder carries those declarations into the archive, and the runtime profile
selects the same exact versions from that archive. Keep the manifest and profile
together when changing releases.

Use Linux, the Node version required by the selected profile, Python 3.11 or newer,
npm and `flock`. Create the private parent directories through the host's normal
deployment setup. Select a **new child** for this installation:

```sh
export STARFORGE_OAUTH_RUNTIME=/srv/starforge/runtimes/mcp-oauth-01
export STARFORGE_OAUTH_ARCHIVE=/srv/starforge/downloads/original-merchant.tgz
export STARFORGE_OAUTH_ARCHIVE_SHA256=REPLACE_WITH_THE_FULL_ORIGINAL_ARCHIVE_SHA256

starforge runtime-install prepare \
  --dir "$STARFORGE_OAUTH_RUNTIME" \
  --archive "$STARFORGE_OAUTH_ARCHIVE" \
  --sha256 "$STARFORGE_OAUTH_ARCHIVE_SHA256" \
  --native --feature mcp --operator

starforge runtime-install install --dir "$STARFORGE_OAUTH_RUNTIME"

starforge runtime-install inspect \
  --dir "$STARFORGE_OAUTH_RUNTIME" --load --source

starforge runtime-install run \
  --dir "$STARFORGE_OAUTH_RUNTIME" -- mcp-oauth --help
```

The original installer retains source at `RUNTIME/package/source/` and installs
dependencies at `RUNTIME/node_modules/`. Node resolves JOSE and the original
MCP peers through those source ancestors. Its inspection checks actual versions,
imports, the retained source and dependency lock before the runtime is ready.
Select additional original adapter features when the existing merchant uses
them, such as `--feature postgres`; the runtime catalog shows the selected
archive's complete available groups.

`starforge runtime-install run` opens that ready runtime and executes its
**own** installed dispatcher. This also prevents an older `starforge` command
on the operator's PATH from silently selecting its own source for a new service.
The installed package can be inspected directly:

```sh
starforge runtime-install run \
  --dir "$STARFORGE_OAUTH_RUNTIME" -- source

starforge runtime-install run \
  --dir "$STARFORGE_OAUTH_RUNTIME" -- runtime-profile resolve --feature mcp
```

The profile identifies JOSE under the `mcp` group and retains the byte count and
hash of its original declaration. The second command describes the MCP feature
selection; the completed installation's `runtime-profile.json` also retains its
selected native payment and operator requirements.

For an interrupted installation, use the original directory and its current
operation:

```sh
starforge runtime-install resume --dir "$STARFORGE_OAUTH_RUNTIME"
```

When using an existing populated npm cache, the same command accepts
`--offline --cache /absolute/original-cache`. The full
[installation and recovery guide](RUNTIME_INSTALL.md) describes the retained
kernel lock, original npm attempt, private logs and new-directory recovery.

## 2. Configure the original workspace

Select the existing provider's final HTTPS issuer and JWKS addresses, its
access-token algorithm/type, and the exact subjects that may operate this
particular workspace. Resource and issuer strings are explicit configuration;
do not derive them from forwarded request headers.

The buyer and merchant launchers each expose one original operator workspace.
Every allowed subject shares that workspace's existing authority. Use the
application's own workspace selection and current host authorization when
embedding the resource for separate customers.

Keep OAuth configuration outside the installed package and outside its dependency
directory. The output's parent must already exist and be private to the operator:

```sh
export STARFORGE_OAUTH_CONFIG=/srv/starforge/config/mcp-oauth.json

starforge runtime-install run --dir "$STARFORGE_OAUTH_RUNTIME" -- \
  mcp-oauth init \
  --resource https://mcp.example.com/mcp \
  --issuer https://identity.example.com/tenant \
  --jwks https://identity.example.com/tenant/jwks \
  --subject exact-provider-workspace-subject \
  --scope mcp:read \
  --tool-scope bazaar_preview=mcp:prepare \
  --tool-scope bazaar_execute_approved=mcp:execute \
  --output "$STARFORGE_OAUTH_CONFIG"

starforge runtime-install run --dir "$STARFORGE_OAUTH_RUNTIME" -- \
  mcp-oauth describe --config "$STARFORGE_OAUTH_CONFIG"
```

Those tool names belong to the original buyer catalog. Select the actual merchant
tool names for a merchant deployment. Repeated `--subject`, `--scope`,
`--algorithm` and `--token-type` flags add explicit values. The defaults are
`RS256`, `at+jwt` and the `scope` claim; choose the actual access-token
contract at the provider. The supported resource validator consumes signed JWT
access tokens; an opaque token deployment needs its provider's supported
verification adapter.

OAuth caller identity reaches the existing tool provider and current host
authorization. The original buyer quote, human/operator approval, payment
signer, retained results and recovery paths continue to decide and execute
the product operation.

## 3. Run the installed buyer or merchant

For the buyer, use its existing private workspace, approved operator module,
discovery service and paid-resource allowlist. Set their original values in the
service's existing environment:

```sh
env -u MCP_ACCESS_TOKEN \
  MCP_OAUTH_CONFIG="$STARFORGE_OAUTH_CONFIG" \
  MCP_STATE_DIR=/srv/starforge/workspaces/existing-buyer \
  BAZAAR_DISCOVERY_URL=https://existing-discovery.example.com \
  MCP_PORT=3210 \
  starforge runtime-install run --dir "$STARFORGE_OAUTH_RUNTIME" -- mcp-buyer
```

Retain the current `MCP_OPERATOR_MODULE` and `PAID_RESOURCE_ORIGINS` settings
when the original buyer uses them. For the merchant, select its existing
configuration and workspace through the original command:

```sh
env -u MCP_ACCESS_TOKEN \
  starforge runtime-install run --dir "$STARFORGE_OAUTH_RUNTIME" -- \
  merchant-mcp serve \
  --config /srv/starforge/config/existing-merchant-mcp.json \
  --oauth-config "$STARFORGE_OAUTH_CONFIG" \
  --port 3211
```

Both original launchers listen on loopback. Use the existing HTTPS reverse proxy
for the configured resource URI. Route the MCP path and the exact metadata path
printed by `describe` to that same service. For the example resource above,
these are `/mcp` and `/.well-known/oauth-protected-resource/mcp`. Preserve
the original Authorization, content negotiation, MCP protocol headers,
WWW-Authenticate and Retry-After behavior. The
[original deployment guide](../../../stellar-forge/mcp-paid-agent/OAUTH_RESOURCE.md#3-start-the-existing-buyer-or-merchant)
contains the complete routing example and provider configuration.

Keep fixed bearer mode and incoming OAuth mode mutually exclusive, as required
by the original launchers. A bearer access token obtained by the configured
OAuth client can be used by the original private operator console's existing
token field. The selected OAuth client/provider owns browser login and refresh.

## 4. Discover, register the client and receive the installed service

Use a new report path for the selected receiving operation:

```sh
starforge runtime-install run --dir "$STARFORGE_OAUTH_RUNTIME" -- \
  mcp-oauth discover --config "$STARFORGE_OAUTH_CONFIG" \
  --output /srv/starforge/receiving/oauth-discovery.json

starforge runtime-install run --dir "$STARFORGE_OAUTH_RUNTIME" -- \
  mcp-oauth client-config --config "$STARFORGE_OAUTH_CONFIG" \
  --name stellar-forge \
  --output /srv/starforge/receiving/claude-mcp.json
```

Discovery follows the original resource challenge and metadata contract, validates
the exact resource/issuer and pinned JWKS, and reports provider PKCE and client
registration capabilities. Its public metadata transport is the original SF31
transport. For a selected private HTTPS or custom-port diagnostic, repeat
`--trusted-origin EXACT_HTTPS_ORIGIN` for each required resource/provider
origin. That diagnostic setting is separate from the running host's selected
key-fetch capability and CA configuration.

A generated client entry contains the HTTP server URL. Use
`--merge /absolute/existing-claude-config.json` with a different new output
to preserve its other registrations and settings; choose an unused server name.
Use Claude Code's native MCP registration and login workflow described in the
original guide to obtain the resource-specific token.

For the same endpoint's authenticated receiving step, obtain a current access
token through the selected provider. Store it in the existing secret environment
or an owner-only token file. Pass the environment variable **name**, never the
token value:

```sh
starforge runtime-install run --dir "$STARFORGE_OAUTH_RUNTIME" -- \
  mcp-oauth probe --config "$STARFORGE_OAUTH_CONFIG" \
  --token-env STARFORGE_OAUTH_ACCESS_TOKEN \
  --output /srv/starforge/receiving/oauth-probe.json
```

Alternatively use `--token-file /absolute/private/current-access-token` with
mode 0600. The original probe sends initialize, notifications/initialized and
every tools/list page, retaining the selected resource and negotiated protocol.
It reports complete catalog identity and schema hashes. It also closes an
offered MCP session through the same resource when supported. Its reports
exclude the token and session identifier.

A useful receiving handoff retains the selected archive identity, complete
installation result, described configuration, discovery report, generated client
registration and successful complete-catalog probe. Continue the original
product purchase, approval and recovery workflow under its selected scopes
when receiving the complete buyer or merchant application.

### Receive the selected archive with the retained reference application

The maintained source also carries
`stellar-forge/mcp-paid-agent/operations/oauth-resource-receiving.mjs`.
It can exercise the actual installed operator command against the same
reference application's retained four request selections. Use the existing
application configuration and its original component source supplied with that
customer/source handoff. Keep their original workspace, request bodies and
purchase states in place.

Select the complete installed `sourceRoot` returned by the runtime installer,
its own distribution CLI, and a new private receiving output directory whose
parent already exists. Use the same Node executable accepted by that runtime:

```sh
export STARFORGE_OAUTH_SOURCE="$STARFORGE_OAUTH_RUNTIME/package/source"
export STARFORGE_OAUTH_NODE=/absolute/selected/node
export STARFORGE_RECEIVING_APPLICATION_CONFIG=/absolute/original/application.json
export STARFORGE_RECEIVING_APPLICATION_SOURCE=/absolute/original/application-component
export STARFORGE_OAUTH_RECEIVING_OUTPUT=/absolute/private/installed-oauth-receiving

"$STARFORGE_OAUTH_NODE" \
  "$STARFORGE_OAUTH_SOURCE/stellar-forge/mcp-paid-agent/operations/oauth-resource-receiving.mjs" \
  --application-config "$STARFORGE_RECEIVING_APPLICATION_CONFIG" \
  --application-source "$STARFORGE_RECEIVING_APPLICATION_SOURCE" \
  --output "$STARFORGE_OAUTH_RECEIVING_OUTPUT" \
  --source-root "$STARFORGE_OAUTH_SOURCE" \
  --installed-cli "$STARFORGE_OAUTH_SOURCE/stellar/scf-starforge-20261009/distribution/cli.mjs"
```

The source selection loads the original resource, host, transport, discovery,
operator and JOSE from that exact source root. `--installed-cli` runs each
real child as `node SELECTED_ENTRY mcp-oauth ...`, so init, describe, discover,
client-config and probe travel through the installed dispatcher. The same
receiving process supplies its owned local issuer/resource listeners, native
JOSE signatures, selected-origin transport and private token environment.
The application's original provider data and four saved requests remain the
reference for the complete receiving operation.

The retained `operation.json` records selected source/module hashes, original
request identities, all receiving stages, actual installed command outputs and
normal closure of the resource, issuer, authorization lifetime and application.
Its `cli-*.json` reports and merged `claude-code-mcp.json` retain the
corresponding private operator outputs.

If this receiving operation is interrupted, repeat its exact selected paths
and append `--resume` to continue the incomplete journal. A completed journal
retains its original source identity. Use a new receiving output for a later
installed edition while continuing to select the same original reference
application and request records.


## 5. Embedding the same installed APIs

For an application that installs the merchant package in its normal
`node_modules`, the public imports select these same original modules:

```js
import {
  createOAuthResourceAuthorization,
  validateOAuthResourceConfig,
  resourceMetadataLocation,
} from '@tokenjunkielabs/starforge-merchant/mcp/oauth-resource';
import {
  loadOAuthResourceHost,
} from '@tokenjunkielabs/starforge-merchant/mcp/oauth-host';
import {
  discoverOAuthResource,
  probeOAuthResource,
} from '@tokenjunkielabs/starforge-merchant/mcp/oauth-discovery';
import {
  createOAuthOperatorConfiguration,
  createOAuthClientConfiguration,
} from '@tokenjunkielabs/starforge-merchant/mcp/oauth-operator';
```

For a maintained private runtime, its package is intentionally retained outside
`node_modules`. Use the original absolute `sourceRoot` returned by that
installation for an application-owned dynamic import:

```js
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const sourceRoot = '/srv/starforge/runtimes/mcp-oauth-01/package/source';
const { loadOAuthResourceHost } = await import(pathToFileURL(resolve(
  sourceRoot, 'stellar-forge/mcp-paid-agent/oauth-host.mjs'
)).href);

const oauth = await loadOAuthResourceHost({
  configPath: '/srv/starforge/config/mcp-oauth.json',
  // fetchImpl: existing selected host HTTPS capability, when required
});

// Give oauth.transportOptions to the original createMcpToolHandler.
// Wrap that handler with oauth.wrap(originalHandler) on the existing server.
// The server's ordinary close path awaits oauth.close() with its other stores.
```

The original buyer and merchant server imports remain available as
`@tokenjunkielabs/starforge-merchant/buyer/mcp/server` and
`@tokenjunkielabs/starforge-merchant/merchant/mcp/server`.
An application with current per-user workspace authority can construct the
resource authorizer with its existing `authorize` callback and pass
`authorization` to the maintained MCP transport. The source guide defines
that verified caller context and exact callback contract.

## 6. Reopen, rotate and recover

Keep the provider configuration and original product workspace separate from
the installed source. When subjects, scopes or pinned provider settings change,
write the reviewed replacement configuration to a new path and reopen the same
original service with that path. JOSE uses the original in-memory key cache and
rotation behavior; the provider's published signing-key set remains its source.

On a runtime upgrade, prepare the next archive in a new runtime directory with
the existing feature selection, inspect it and use the original deployment
workflow to select its returned source/dependency roots. The previous runtime
and retained product workspace remain available for that workflow's recovery.
The original `runtime-install upgrade`, `compare` and `recover` commands
retain their contracts in [RUNTIME_INSTALL.md](RUNTIME_INSTALL.md).

| Actual receiving result | Continue the original operation |
| --- | --- |
| Missing JOSE or a mismatched selected version | Inspect the selected runtime/profile; resume that installation or prepare its supported new-directory recovery. |
| 401 invalid_token | Obtain a current access token for the exact configured resource/issuer and selected algorithm/type. |
| 403 insufficient_scope | Request the complete scope set in that operation's Bearer challenge. |
| 403 access_denied | Reconcile the selected issuer subject and the current application's workspace authority. |
| Discovery issuer/JWKS mismatch | Review the original provider's actual metadata against the pinned configuration. |
| Provider 429/503 with Retry-After | Resume the same diagnostic after the provider interval; keep its original report. |
| Interrupted installer | Inspect and resume the same retained installation; its original kernel lock protects a running npm attempt. |
| Source/lock changed after a ready installation | Use the original new-directory recovery and retained previous runtime. |

The incoming OAuth component, complete operator guide and installed entries
are selected by the original cumulative merchant producer. Source publication,
native receiving and archive installation retain their respective exact source
identities. Use the complete current archive supplied by that producer for the
installed customer journey.

