# Install the Tyk API operations product

This selected product delivers the original Gateway and Dashboard transport,
saved portfolio and rollout workspace, complete browser, typed SDK, merchant
MCP provider and native customer handover. It uses the maintained source
selection, distribution builder, runtime installer and Applications lifecycle.

The recipe is `tyk-merchant.json`, schema
`stellar-forge.distribution-source-selection.v1`. It selects the complete
`tyk-workspaces`, `merchant-provider-tyk-workspaces` and
`tyk-product` contributions, the whole original Tyk source component and
the complete installed product. The original Tyk transport uses Node built-ins;
the optional merchant agent uses the MCP runtime feature.

## Build one selected release

Use the original complete source repository, a full committed SHA and a
private output directory:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --ref FULL_ORIGINAL_COMMIT --selection tyk-merchant \
  --out /absolute/tyk-release --offline
~~~

Use `--offline` when the required original Git objects are already present.
Retain the returned source commit, selected recipe identity, archive path,
complete archive SHA-256 and installed byte count.

Continue an interrupted build in that same original output:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --out /absolute/tyk-release --resume --offline
~~~

## Receive the runtime

Use Node 24, Linux flock and the original runtime installer. Applications also
uses the maintained operator runtime and its Python command support.

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /srv/private/tyk-runtime --archive /absolute/tyk-release/ORIGINAL.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /srv/private/tyk-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /srv/private/tyk-runtime --load --source

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /srv/private/tyk-runtime -- tyk-product --help
~~~

The original selected package manifest and runtime profile determine the exact
dependency closure. Reuse an existing installed dependency tree through the
original `install --adopt-existing` option when its versions, lock and probes
match this edition. An available original npm cache supports the installer's
offline path. Full runtime transfer uses the maintained
[runtime transfer guide](../RUNTIME_TRANSFER.md).

Retain the returned `sourceRoot`, `dependencyRoot`, runtime identity and
installation result. The generated package exposes `starforge`,
`tyk-merchant` and the explicit product/managed/client package exports.

## Initialize one product and original workspace

~~~sh
umask 077
mkdir -p /srv/private
chmod 700 /srv/private

starforge tyk-product init --dir /srv/private/api-operations \
  --name "Customer API operations"
starforge tyk-product review --dir /srv/private/api-operations
starforge tyk-product open --dir /srv/private/api-operations --port 0
~~~

An existing native workspace can be selected with
`--workspace /srv/private/original-tyk-workspace` during initialization.
Optional private initial connection declarations use the documented
[operating guide](../../../../products/tyk-merchant/OPERATING.md) format.
Provide the selected native credential variables through the existing process
environment.

The product creates complete private metadata and retains the native directory
as a distinct owner. Initial declarations seed missing aliases; saved
connection revisions stay authoritative afterward. The first native Open
creates the original workspace identity file. Subsequent Opens preserve that
workspace UUID and its full history.

## Launch through Applications

Register the READY runtime in the existing Runtime workspace. Choose
**Applications → Tyk API operations**, select the initialized private product
directory and its private environment file, then complete the existing
Review → Save → Start → Open flow.

Review binds the complete product and Tyk runtime/browser source, original
private configuration, directory identities, selected port and the existing
native workspace UUID. Startup must return that same product and native
workspace. The Applications observer verifies the retained connection file,
live original workspace response and complete original browser source before
offering its URL.

Stop reaches the same native server and writer. A later Start opens the same
saved state and refreshes the private browser URL and connection record.

## Configure the optional merchant agent

Once the product is Open, retain its actual workspace UUID and private
`browser-url.txt` path in the connection document described by the
[operating guide](../../../../products/tyk-merchant/OPERATING.md).
Then use the original initializer and merchant server:

~~~sh
starforge tyk-agent-init --dir /srv/private/tyk-agent \
  --connection /srv/private/tyk-agent-connection.json

starforge merchant-mcp serve --config /srv/private/tyk-agent/merchant-mcp.json \
  --port 0 --token-env MCP_ACCESS_TOKEN
~~~

The selected provider uses this same workspace's HTTP connection and original
request/receiving history. Its complete original native action schemas remain
available through the browser, `tyk-product actions` and typed package export.

## Complete the customer operation

The [operating guide](../../../../products/tyk-merchant/OPERATING.md) covers full
inventory capture, native definition adaptation, saved cohorts, exact request
preparation, Dashboard migration, Gateway activation and recovery of an
interrupted original request.

The [receiving guide](../../../../products/tyk-merchant/RECEIVING.md) carries the
whole original NDJSON handover through exact-byte download, customer
inspection, native adoption and same-directory reopen. Its typed client and
CLI keep the original record, request, source and manifest identities through
each step.

Upgrade an installed edition into a new runtime directory while retaining the
customer's original private product and workspace. Review that new source
through the same Applications lifecycle, then continue the saved portfolio and
customer receiving records.

## Complete two-Gateway commissioning selection

This selection carries the Gateway commissioning kernel, leased-store bindings, complete editable-intake/review browser and typed five-action client. The original browser manifest registers both new modules. The native receiving helper remains beside the existing native journey in complete source receiving and is excluded from the ordinary installed runtime source selection. [Gateway commissioning](../../../../products/tyk-merchant/GATEWAY_COMMISSIONING.md) is retained as an explicit support file. All native operations use the original Tyk controller and both Gateway targets' original environment references.
