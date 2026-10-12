# Install the Flowable process and decision operations product

This selected release delivers the original Flowable transport, durable
process workspace, complete browser, typed client, command line, merchant
MCP provider and full customer receiving. It uses the maintained source
selection, distribution builder, runtime installer and Applications owner.

The `flowable-merchant.json` recipe selects these complete source-owned
contributions:

- `flowable-workspaces`: native process and decision operations, workspace, original
  browser and full source/history receiving.
- `merchant-provider-flowable-workspaces`: the same saved workspace
  through the maintained merchant MCP registry.
- `flowable-product`: installed profile, owned listener, typed client,
  Applications integration and customer guides.

The recipe includes the complete Flowable and installed-product components,
native source contracts, the authored engine/receiving commands, examples
and browser assets. Native process execution uses the actual Flowable
engine. The application's transport and storage use Node built-ins and the
original Linux flock helper; the merchant agent selects the MCP runtime.

## Build the selected release

Use an original repository, full committed source SHA and private output:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --ref FULL_ORIGINAL_COMMIT --selection flowable-merchant \
  --out /absolute/flowable-release --offline
~~~

Use `--offline` when the selected original Git objects are already present.
Keep the source commit, selection identity, generated archive name, complete
archive SHA-256 and original build result.

Resume an interrupted build in that same output directory:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --out /absolute/flowable-release --resume --offline
~~~

The original source packet receiver can materialize the selected exact Git
objects when a full repository checkout is unnecessary. It delegates
composition and packaging to this same maintained builder.

## Install and inspect the runtime

Use Node 24 and Linux flock. The original Applications runtime also includes
its maintained Python command support.

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /srv/private/flowable-runtime --archive /absolute/flowable-release/ORIGINAL.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /srv/private/flowable-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /srv/private/flowable-runtime --load --source

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /srv/private/flowable-runtime -- flowable-product --help
~~~

The original selected manifest and runtime profile determine dependency
versions and complete installed source. Reuse an existing compatible
dependency tree through the maintained `install --adopt-existing` path,
or use the installer's original cache/offline support. The
[runtime transfer guide](../RUNTIME_TRANSFER.md) covers a complete installed
runtime handover.

Keep the installed `sourceRoot`, `dependencyRoot`, runtime identity
and install result. The generated package exposes `starforge`,
`flowable-merchant` and the explicit product, managed-launch and typed-client
exports.

## Initialize the application

~~~sh
umask 077
mkdir -p /srv/private
chmod 700 /srv/private

starforge flowable-product init --dir /srv/private/process-operations \
  --name "Customer process operations"
starforge flowable-product review --dir /srv/private/process-operations
starforge flowable-product open --dir /srv/private/process-operations --port 0
~~~

Select an existing native workspace with
`--workspace /srv/private/original-flowable-workspace` during initialization.
Private initial engine declarations use the
[operating guide](../../../../products/flowable-merchant/OPERATING.md) format.

Supply the actual Flowable REST base URL and original host credential
variables. Initial declarations seed missing aliases; saved engine
revisions remain authoritative afterward. The first native Open establishes
the workspace UUID in its selected directory. Later Opens preserve that
identity and all source/history records.

## Launch through Applications

Register the READY runtime in the existing Runtime workspace. Choose
**Applications → Flowable process and decision operations**, select the initialized
private product directory and existing private environment file, then use
the maintained Review → Save → Start → Open flow.

Review binds the complete product and engine/browser source, private
configuration, original directory identities, selected port and existing
native workspace UUID. Startup verifies the returned product identity,
actual listener port, retained connection file, live workspace response
and original browser bytes.

Stop closes the same server and writer. A later Start opens the same saved
workspace and updates its private URL and connection record. The root
operation and customer history remain available across application restarts.

## Connect the optional merchant agent

With the product Open, retain its actual workspace UUID and
`browser-url.txt` path in the original connection document described by the
[operating guide](../../../../products/flowable-merchant/OPERATING.md).

~~~sh
starforge flowable-agent-init --dir /srv/private/flowable-agent \
  --connection /srv/private/flowable-agent-connection.json

starforge merchant-mcp serve \
  --config /srv/private/flowable-agent/merchant-mcp.json \
  --port 0 --token-env MCP_ACCESS_TOKEN
~~~

The provider connects to that exact original workspace through its current
private URL and declared UUID. Its native requests, immutable records and
receiving operations are shared with the GUI and typed client.

## Complete native receiving on an actual engine

The [original native receiving guide](../../sf30-seller-sdk/flowable/NATIVE_RECEIVING.md)
provides the executable complete customer journey. The maintained host can
acquire the exact publisher Flowable 8.0.0 distribution, extract its original
self-contained REST application and run it with Java 17 or later. It can
select an existing suitable Java runtime or acquire the original publisher
JRE with retained artifact identity. Node 24 and a real Playwright/Chromium
runtime support the browser and installed-client continuation.

The journey deploys the supplied original process examples, starts and
operates actual native work, validates and executes migrations, reads full
history, exports the complete handover, and cold-receives the saved
workspace. The installed application continuation uses the same engine and
original saved identities. Follow its existing operation and retained result
when resuming an interrupted run.

## Deliver and upgrade the customer's workspace

Use the [operating guide](../../../../products/flowable-merchant/OPERATING.md)
for the complete portfolio → release → process/task → migration workflow,
original request reviews and recovery.

Use the [receiving guide](../../../../products/flowable-merchant/RECEIVING.md)
for full NDJSON export, exact download, customer inspection, adoption and
same-directory reopen. Keep complete source, installed release and original
native history with the customer handover.

For an upgrade, install the new reviewed edition into a new runtime
directory while retaining the customer's original private product and
native workspace. Review that runtime through the same Applications
lifecycle before reopening the saved process history.

## Native decision operations

The same installed workspace includes original DMN deployment, native decision and decision-service evaluation, captured execution audits and full source/history receiving. Save the original DMN REST endpoint as a separate named connection. Use the **Decisions** page, `capture-decisions`, `decision-portfolio`, `decision-definition` and `decision-execution` commands, the typed client, or the eight native decision MCP actions.

See [Decision deployment, evaluation and operating history](../../../../products/flowable-merchant/DECISIONS.md) for the complete operator workflow, typed numeric input and native result semantics.
