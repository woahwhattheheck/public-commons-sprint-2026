# Installed Stellar agent application

The maintained toolkit includes the complete receiving application, industrial
browser, original HTTP buyer, governed remote MCP buyer and original transport.
Its installed command selects the runtime shipped in that same package.

## Install and identify the original runtime

Use Node 24 or newer, Python 3.11 or newer, and the original runtime installer.
The maintained native and MCP profiles select the actual dependency versions.

~~~sh
starforge runtime-install prepare --dir /srv/private/starforge/runtime \
  --archive /srv/private/downloads/original-starforge.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --native --feature mcp --operator
starforge runtime-install install --dir /srv/private/starforge/runtime
starforge runtime-install run --dir /srv/private/starforge/runtime -- doctor --native --feature mcp
starforge runtime-install run --dir /srv/private/starforge/runtime -- stellar-application paths
~~~

Use that installation's command for the remaining operations. The printed paths
identify the original application, SF88 runtime and both receiving guides.

## Prepare the receiving application

Keep the complete original merchant handoff in its private directory. It carries
the selected request bodies, native terms and release identities. The supplied
reference and original merchant preparation are in [OPERATOR.md](OPERATOR.md).

For a remote MCP capability, prepare the original
stellar-forge.application-remote-mcp.v1 selection with its discovery resource,
tool, arguments and complete accepted payment option. Select the governed
operator module produced by starforge mcp-spending setup. Its SF36 policy,
ledger, host keys and native signer remain in their existing private locations.

~~~sh
install -d -m 0700 /srv/private/stellar-applications
starforge stellar-application init \
  --dir /srv/private/stellar-applications/client-data \
  --id client-stellar-data \
  --subject tenant-01:operator-01 \
  --handoff /srv/private/merchant-handoff \
  --profile /srv/private/original-buyer-profile.json \
  --authorization /srv/private/current-application-grants.mjs \
  --remote /srv/private/selected-remote-mcp.json
~~~

Profile, authorization and remote are optional. Choose the fields needed by the
selected application. A standalone configuration authorizes its named local
subject; an existing product supplies its current authorization lookup.

Initialization inspects the complete selected source before creating the new
directory. It writes private application.json and creates private state/.
Existing destinations are preserved. Source inspection does not load the
selected signer or authorization modules and does not call a provider.

~~~sh
starforge stellar-application inspect --config /srv/private/stellar-applications/client-data/application.json
starforge stellar-application verify-source --config /srv/private/stellar-applications/client-data/application.json
starforge stellar-application list --config /srv/private/stellar-applications/client-data/application.json
~~~

Inspect returns the exact source selection digest, source references, original
handoff and private state. The native application's saved-request bindings
continue to govern already prepared operations.

## Browser, approval and saved results

Set STELLAR_APP_ACCESS_TOKEN to a private random value of at least 24 characters
in the receiving process environment. Start from the original approval terminal:

~~~sh
starforge stellar-application serve \
  --config /srv/private/stellar-applications/client-data/application.json \
  --port 0
~~~

Open the printed loopback origin and enter the token in the browser's existing
connection field. The application lists the original HTTP and remote MCP
requests together. Review the exact selected request, execute it through the
original approval, inspect the retained operation and read or download its
complete saved response.

Remote requests also expose cancellation, aggregate spending and original
payment reconciliation. Host authorization is checked again after terminal
approval and immediately before signing. The original SF36 governor reserves
funds before the original signer produces a payment.

A reviewed host launch can pass its exact source selection:

~~~sh
starforge stellar-application serve --config PRIVATE_APPLICATION_JSON \
  --expected-selection-sha256 ORIGINAL_REVIEWED_SELECTION_SHA256 --port 0
~~~

The launcher verifies that selection before and after opening the application and
compares the server's actual opened configuration and source identity. Managed
launches retain the original selected runtime and compare every executed application
module and browser asset in the copied release with that original selection.
Structured startup names the actual listener, selected and executed source directories,
application, private state, handoff and reviewed digest. The token stays in the process environment and
browser Authorization header.

## Original command line and MCP operations

The installed command forwards these actions to the maintained application CLI:

~~~sh
starforge stellar-application review --config PRIVATE_APPLICATION_JSON --intent ORIGINAL_INTENT
starforge stellar-application execute --config PRIVATE_APPLICATION_JSON --intent ORIGINAL_INTENT
starforge stellar-application status --config PRIVATE_APPLICATION_JSON --intent ORIGINAL_INTENT
starforge stellar-application recover --config PRIVATE_APPLICATION_JSON --intent ORIGINAL_INTENT
starforge stellar-application read --config PRIVATE_APPLICATION_JSON --intent ORIGINAL_INTENT --format json
starforge stellar-application export --config PRIVATE_APPLICATION_JSON --intent ORIGINAL_INTENT --out NEW_ABSOLUTE_FILE
~~~

Remote MCP results retain their original representation and support complete
consumption up to the native 2 MiB limit through the original verified range
reader. Cancel, spending and reconcile use the original application's actions
and argument contracts documented in [OPERATOR.md](OPERATOR.md).

The existing authenticated /mcp endpoint operates the same original intents,
subjects, authority checks and saved results. Application tool arguments cannot
replace host paths, selected payment terms or the governed operator module.

## Managed Applications launch

Select a READY runtime containing this command and its matching Applications
adapter. Choose **Stellar agent application**, the original application.json,
the original terminal Python and an optional private environment JSON.
That environment supplies STELLAR_APP_ACCESS_TOKEN and the native operator's
required environment references.

The existing Applications review retains exact source identities and argv.
Its managed worker owns the controlling terminal and original process.
**Open application** appears after the command prints its bound startup; enter
the access token in the application. Stop, terminal input, original process
recovery and reopening use the existing managed workflow.

Configurations selecting the same original application state share one resource
key, so that Applications workspace cannot launch overlapping owners of it.

## Receiving and continued operation

Keep the application directory, complete handoff, remote selection, governed
operator configuration and original buyer/governor workspaces in the existing
operating backup. Preserve private environment and signer custody through
their original setup.

A saved application pins its original installed runtime directory. Reopen it
through that same runtime and configuration. A new installation can initialize
a new receiving application; moving an existing one follows the original
buyer's recovery and source-selection rules.

| Installed export | Capability |
| --- | --- |
| @tokenjunkielabs/starforge-merchant/partners/stellar-application | Application engine and fixed tools |
| @tokenjunkielabs/starforge-merchant/partners/stellar-application/remote-mcp | Governed remote MCP application |
| @tokenjunkielabs/starforge-merchant/partners/stellar-application/configuration | Trusted configuration and application loading |
| @tokenjunkielabs/starforge-merchant/partners/stellar-application/server | Original HTTP, browser and MCP host |
| @tokenjunkielabs/starforge-merchant/partners/stellar-application/installed | Installed paths, initialization, inspection and launch |

The [workshare scope](SCOPE.md) preserves commercial terms and selected receiving
inputs. Its engineering handoff uses this complete source and original native
receiving operation.
