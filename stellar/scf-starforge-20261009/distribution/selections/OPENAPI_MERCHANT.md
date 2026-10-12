# API merchant authoring and receiving

This product installs the original Starforge API merchant workflow: OpenAPI JSON
or YAML, Postman and HAR source authoring; complete route inventory and exact
prices; reusable operating-policy editions; native package export and receiving;
seller releases; and the private merchant and Buyer applications. Browser, MCP,
CLI and Node clients operate the same retained workspaces.

The source selection is **openapi-merchant**. Its installed README is this guide.
Use the source commit, archive and hashes from the actual completed distribution
receipt for your installation.

## 1. Receive the source and prepare the runtime

Use the maintained source distribution builder on the selected committed source:

~~~sh
node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/original/checkout \
  --ref COMPLETE_SOURCE_COMMIT \
  --selection openapi-merchant \
  --out /absolute/releases/openapi-merchant
~~~

The result retains the original archive path, SHA-256, source commit, source
selection and every packaged file identity. Continue that same output with
--resume after an interruption; --status inspects its retained state. A different
commit or product uses a new output directory.

The customer host needs Linux, Node.js 22.16 or newer, Python 3.11 or newer, npm
and util-linux flock. Use a newer Node version when the selected archive's
resolved profile requires it. The private runtime parent must already exist.
Prepare the original archive with these features:

~~~sh
node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /srv/starforge/runtimes/openapi-01 \
  --archive /srv/starforge/downloads/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /srv/starforge/runtimes/openapi-01

node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /srv/starforge/runtimes/openapi-01 --load --source
~~~

The native group supplies the original Stellar and x402 dependencies. The schema
group supplies the original schema validator dependency; openapi supplies the
source YAML parser; mcp supplies the original MCP transport and its declared
dependencies. The operator profile records Linux, Python and flock. The installer
derives exact package versions from the selected original source, retains its
resolved lock, and verifies the selected imports before returning READY.

An existing complete dependency tree and its lock can use the original
install --adopt-existing option in that prepared runtime. The original installer
checks the selected profile and actual tree under its lease. For cache-only
installation, add --offline --cache ABSOLUTE_CACHE_DIRECTORY. Keep the same
runtime directory for install/resume; recover an incompatible or changed runtime
through the original fresh-directory recovery command.

### Run the selected installed commands

The examples below use the installed starforge command. A shell can bind that
name to the selected runtime without a global package installation:

~~~sh
starforge() {
  node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
    --dir /srv/starforge/runtimes/openapi-01 -- "$@"
}
starforge source
starforge registrations
starforge registrations --command merchant-operation-policies
starforge merchant-providers list
starforge merchant-providers inspect openapi-workspaces
~~~

Confirm sourceSelection.id is openapi-merchant in the original source manifest.
The selected Applications are API merchant authoring, Buyer and Merchant
operator. The selected merchant providers are openapi-workspaces,
har-workspaces, cache, discovery, facilitators, publishers, receiving and
buyer-runbook-workspaces. The OpenAPI provider includes the complete route
worksheet and six reusable-policy operations.

Keep the original package and its dependency root together:

| Runtime input | Example |
| --- | --- |
| Installed original sourceRoot | /srv/starforge/runtimes/openapi-01/package/source |
| dependencyRoot | /srv/starforge/runtimes/openapi-01 |
| Original source CLI | package/source/stellar/scf-starforge-20261009/distribution/cli.mjs |
| Customer authoring projects | /srv/starforge/workspaces/api-projects |
| Merchant configuration and operator history | /srv/starforge/workspaces/api-operator |
| Complete customer downloads | /srv/starforge/receiving |

The runtime is the installed program. Customer projects, source captures,
credentials, policy libraries, release stores and received files use the
customer's original private directories.

## 2. Open the managed authoring application

Create or reopen the original Runtime workspace, attach the READY runtime, and
serve its private browser:

~~~sh
starforge runtime-workspace init \
  --workspace /srv/starforge/workspaces/runtime-operator
starforge runtime-workspace attach \
  --workspace /srv/starforge/workspaces/runtime-operator \
  --runtime /srv/starforge/runtimes/openapi-01 \
  --label "API merchant runtime"
starforge runtime-workspace serve \
  --workspace /srv/starforge/workspaces/runtime-operator --port 8465
~~~

For an existing Runtime workspace, use its same directory and attach record.
In **Applications**, select **API merchant authoring** and the attached runtime.
Choose a private merchant projects directory, review the selected paths and
save. Review Start, Start and Open operate the saved original application.

Port 0 selects an available loopback listener. An OAuth provider with a registered
callback uses its original fixed nonzero port. The optional original OAuth host
configuration identifies trusted provider aliases and private profile-directory
environment references. **Set up provider connections** creates or reopens the
original reviewed registration editions. Supply its private environment file
through the application settings. The original managed launcher binds these
paths, source files, registrations and startup identity before it exposes Open.

The direct foreground authoring entry remains available:

~~~sh
starforge openapi-workspace \
  --out-parent /srv/starforge/workspaces/api-projects --port 0
~~~

Use the printed private address in the browser. Choose the managed application
or its direct original foreground owner for a given projects directory. In the
managed application, Stop and subsequent Start retain the original project
directories and provide a new current console URL. Applications history and
application-output retain the corresponding original operation.

## 3. Author the original merchant and reusable policies

Import the complete OpenAPI JSON/YAML source, or use the original Postman or HAR
source workflow. A captured source retains its original capture and decision
history through review and package saving. The browser displays the original
source inventory and compiler findings.

Use the route worksheet to search and page the complete inventory. Select the
actual method/path coordinates, choose which routes to include, and set exact
atomic prices. The worksheet keeps the full source and plan identities. Its
reconciliation identifies changes when a later source edition moves or removes
an operation. Explicit keep, remap and drop decisions remain part of the
original source-revision workflow.

In **Reusable operation policies**:

1. Create or open a named policy edition. Select its applicable HTTP methods
   and the native operating fields to set.
2. Save the edition against the displayed current head. Opening a historical
   edition continues to select its immutable SHA.
3. Choose explicitly selected and priced routes. Newly selected worksheet
   routes can receive the policy in the same review.
4. Add any per-route overrides. Each set replaces the complete top-level field;
   each unset removes that optional field. For example, a cache override replaces
   the complete cache object.
5. Review the full before/after records and the original native preview. The
   review binds source, plan, worksheet, exact policy edition, targets, overrides
   and any original captured-source selection.
6. Use **Save package** with a new package name. This saves the exact reviewed
   native candidate through the original package writer.

The route worksheet controls inclusion and price. Policy application preserves
the selected method, path, route ID and amountAtomic. All 23 original optional
operation fields remain available, including request/response limits, headers,
cache, availability, response contracts, OAuth, idempotency, streaming and
transport. The original compiler checks their nested structure and compatibility.

**Apply to editor** is a secondary editing path. It checks that the existing form
can preserve the reviewed candidate. Further edits need a fresh review before
that form saves. The policy panel's exact Save package path preserves reviewed
field omissions and values.

A lost package response retains **Reopen submitted package** for that submitted
request even when the current editor changes. Reopen uses the original name and
complete submitted input. A completed exact retry returns the saved package;
different input requires its own name or review.

A reusable document can be as small as:

~~~json
{
  "schema": "stellar-forge.api-operation-policy.v1",
  "id": "JsonRead",
  "title": "Selected JSON read settings",
  "description": "Operating settings for explicitly selected JSON reads.",
  "methods": ["GET"],
  "settings": {
    "timeoutMs": 8000,
    "maxResponseBytes": 262144,
    "maxInFlight": 8
  }
}
~~~

Use the original source's methods and compatible settings. Policy export includes
the complete canonical document and SHA-256. A saved merchant's
operation-policy.json includes the complete application context and native
review, so another workspace can receive and review it without changing its
own policy library head.

## 4. Attach the same workspace to merchant MCP and the operator console

Give the original merchant host a private connection file. This example names
an authoring workspace and a receiving workspace:

~~~json
{
  "schema": "stellar-forge.sf61-workspace-connection.v1",
  "workspaces": {
    "authoring": {
      "label": "API authoring",
      "consoleUrlFile": "./authoring-url.json",
      "files": {
        "api": {"kind": "source", "path": "./inputs/api.yaml"},
        "plan": {"kind": "plan", "path": "./inputs/plan.json"},
        "worksheet": {"kind": "packet", "path": "./inputs/worksheet.json"},
        "policy": {"kind": "packet", "path": "./inputs/policy.json"},
        "targets": {"kind": "packet", "path": "./inputs/targets.json"},
        "overrides": {"kind": "packet", "path": "./inputs/overrides.json"}
      }
    },
    "receiver": {
      "label": "Receiving merchant",
      "consoleUrlFile": "./receiver-url.json",
      "deliveries": {
        "package": {"directory": "/srv/starforge/receiving/api-package"}
      },
      "files": {
        "api": {"kind": "source", "path": "./inputs/received-api.yaml"},
        "application": {"kind": "packet", "path": "./inputs/operation-policy.json"}
      }
    }
  }
}
~~~

Each console URL file is the original Applications application-url.json record
or a private file containing the original printed URL. Select the actual
managed record for the current run. A configured stable connection file is
reread for each operation, so the host can update its URL selection after a
managed restart. A consoleUrlEnv reference is also supported.

Set the connection and URL files to mode 0600. Paths are resolved beside the
connection file. Optional file sha256 values pin exact inputs; an optional
delivery manifestSha256 pins the complete received package. MCP callers use
the declared aliases. Add full source, plan, worksheet, policy, target or
override files to these existing host declarations when the request would
exceed the merchant provider's 128 KiB request limit.

Initialize this original provider with a complete options file:

~~~json
{
  "directory": "/srv/starforge/workspaces/api-operator",
  "connection": "/srv/starforge/config/api-connections.json",
  "name": "API merchant operator"
}
~~~

~~~sh
starforge merchant-providers init openapi-workspaces \
  --options /srv/starforge/config/api-operator-setup.json
~~~

The result returns the original merchant-mcp.json configuration and SF82 release
store. An existing release store can be selected through the initializer's
releaseStore option. The original HAR initializer can attach captured-source
access and the OpenAPI connection together; its options are documented in the
included HAR_WORKSPACE.md.

In Runtime **Applications**, choose **Merchant operator**, this generated
configuration, a private saved operator workspace, the existing token
environment name or original OAuth resource configuration, and its private
environment file. Review, Save, Start and Open use the original authenticated
merchant service. The Tools, Requests and Customers views retain their original
request revisions, native returns, complete downloads and recovery operations.
The existing merchant-mcp, merchant-mcp-stdio and merchant-mcp-client-config
commands remain available for direct and agent-host use.

### Worksheet and policy commands

Use complete request files with the returned original merchant endpoint and its
existing MCP_ACCESS_TOKEN environment selection:

~~~sh
starforge merchant-route-worksheet inventory \
  --url http://127.0.0.1:ACTUAL_PORT/mcp \
  --request-file /srv/starforge/requests/routes.json

starforge merchant-operation-policies save \
  --url http://127.0.0.1:ACTUAL_PORT/mcp \
  --request-file /srv/starforge/requests/policy-save.json
~~~

An initial policy-save request is:

~~~json
{"workspace":"authoring","policyFile":"policy","expectedHeadSha256":null}
~~~

For a policy change, use the exact head returned by the library load instead of
null. A review request may select the saved base package or complete source and
plan handles. For explicitly selected worksheet routes:

~~~json
{
  "workspace": "authoring",
  "specFile": "api",
  "planFile": "plan",
  "worksheetFile": "worksheet",
  "policyFile": "policy",
  "targetsFile": "targets",
  "overridesFile": "overrides"
}
~~~

Call merchant-operation-policies review with that complete file. Add the new
name and returned expectedReviewSha256 to the same request, then call package.
Keep that exact file to reopen a completed submission after an interrupted
response. Use the original route worksheet commands inventory, reconcile,
review, save and export for inclusion, price and source changes.

The included OPENAPI_OPERATION_POLICIES.md and OPENAPI_ROUTE_WORKSHEETS.md give
the complete request fields, paging, full-file handles and Node client APIs.

## 5. Receive complete files and reopen them locally

Export the saved original package through merchant_openapi_export. Retain the
returned export ID and full manifest SHA. Then use the original downloader:

~~~sh
starforge merchant-mcp download-openapi \
  --url http://127.0.0.1:ACTUAL_PORT/mcp \
  --workspace authoring \
  --export-id ORIGINAL_EXPORT_SHA256 \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --out /srv/starforge/receiving/api-package
~~~

Repeat that exact command and destination to continue its durable file offsets.
The original receiving code verifies each complete file and writes the original
completion manifest last. inspect-openapi and reopen-openapi remain available
through merchant-mcp. The Node entry
@tokenjunkielabs/starforge-merchant/merchant/mcp/openapi/client exposes
downloadOpenApiPackage, inspectOpenApiPackageDownload and
reopenOpenApiPackageDownload. Its retained state includes the selected original
workspace and export identity.

A reusable library edition or the application record can also travel as a whole
file. For a saved package application, a request is:

~~~json
{"workspace":"authoring","kind":"application","name":"api-policy-v1"}
~~~

~~~sh
starforge merchant-operation-policies export \
  --url http://127.0.0.1:ACTUAL_PORT/mcp \
  --request-file /srv/starforge/requests/policy-export.json \
  --out /srv/starforge/receiving/operation-policy.json

starforge merchant-operation-policies read \
  --file /srv/starforge/receiving/operation-policy.json --kind application
~~~

Use kind policy and the selected policyId/policySha256 for a library edition.
The first response selects an exact file, subsequent chunks keep that identity,
and the client publishes only the complete verified bytes. The named package
exports ./merchant/openapi-operation-policies and
./merchant/openapi-route-worksheet retain the original source-owned clients.
Their file-format and local receiving imports use the shared small Node
helpers; native authoring continues through the original server.

For a complete package already in a receiving delivery handle, call:

~~~json
{
  "workspace": "receiver",
  "delivery": "package",
  "name": "api-received-v1",
  "expectedManifestSha256": "ORIGINAL_MANIFEST_SHA256"
}
~~~

Use this as the original merchant_openapi_receive request. The receiving
workspace retains the original package UUID, source, compiled files, revision
lineage and policy application. Repeating the exact same receiving operation
reopens the completed package.

For an application file alone, select its applicationFile handle and original
specFile in the target policy review. The original record supplies its base
plan, worksheet, policy, targets, overrides and capture context. Review and save
through that target's original package operation. A HAR-derived source follows
its original capture receiving and current authorization workflow.

## 6. Stage and operate the native seller

The same received package can be staged into the original release store:

~~~sh
starforge releases stage \
  --store /srv/starforge/workspaces/api-operator/releases \
  --id api-received-v1 \
  --workspace /srv/starforge/workspaces/receiving-projects/api-received-v1
starforge releases inspect \
  --store /srv/starforge/workspaces/api-operator/releases --id api-received-v1
starforge releases diff \
  --store /srv/starforge/workspaces/api-operator/releases --to api-received-v1
starforge releases console \
  --store /srv/starforge/workspaces/api-operator/releases --port 0
~~~

Use the actual received package path. The release console reviews the
configuration and selects the exact release digest and current generation.
Activate selects the next run. Start operates that selected seller; Stop ends
its owned process. A running seller retains its current release until stopped.
Rollback selects an original previous release for the next run.

The merchant MCP equivalents merchant_openapi_stage, merchant_inspect,
merchant_compare, merchant_activate, merchant_start and merchant_stop use this
same release store. The authoring console's challenge preview and its
merchant_openapi_start/status/stop tools keep their own original runtime ID.
The source, route-review cases and generated RUN.md remain with each saved
package.

For paid operation, use the actual merchant's asset, network, recipient,
facilitator and provider credentials through its existing configuration.
The original Buyer application opens the selected offers, prepares the exact
request and payment review, executes an approved request and reopens its saved
result. Its client export and complete customer files use the retained seller
and buyer identities.

Live cache operations retain their original instance/generation and operating
workspace revision. Capture, review, apply and recover use the same saved
operation. A live retention change can be preserved as a new package through
the existing cache-policy revision workflow before a future seller restart.

## 7. Transfer the runtime and the customer's work

For a host with an existing READY installation, runtime-transfer packages its
exact original source archive, selected profile, accepted lock and public npm
tarballs. Review the existing runtime, export against its returned lock SHA,
then receive the manifest and every part on the customer host. Use the original
transfer inspect --verify, complete and install commands in RUNTIME_TRANSFER.md.
This preserves the selected archive and lock while the installer verifies the
receiving host.

Hand the customer these complete original materials:

| Material | Receiving action |
| --- | --- |
| Selected source archive, distribution receipt and archive SHA | Prepare/install; inspect --load --source; reopen the same source selection. |
| Installation profile, accepted lock and returned roots | Reattach the READY runtime; use the original runtime handoff for deployment. |
| Complete saved merchant package and export manifest | Receive, inspect and reopen the original package. |
| Policy edition and operation-policy.json, when selected | Read the complete files; reopen their exact edition or target review. |
| Source capture, source revision and worksheet | Continue the original source/price decisions and retained lineage. |
| Release selection and original operating instructions | Compare, activate, start, observe and stop through the same release controls. |
| Received customer outputs and their original manifests | Verify complete files and reopen the existing Buyer/customer operation. |
| Host connection aliases and credential setup references | Configure the customer's existing private environment and registered callbacks. |

Use the original workspace's history and exports to retain this handover.
A runtime upgrade prepares a new installation; it keeps the existing authoring
directories, release store, policy library and customer receiving directories.
Applications can review the new runtime against those same retained paths.
Keep the previous runtime available for the original rollback/recovery flow.

## Maintainer source closure and receiving

The committed recipe selects whole original components for files loaded after
the initial imports. The builder's static-module and browser-manifest resolution
then follows the original source.

| Original source area | Retained runtime use |
| --- | --- |
| distribution, runtime-workspace and selected provider declarations | Source/profile reading, installer/unpacker, Applications, managed worker, transfer and product README. |
| sf61-openapi-seller-import | JSON/YAML/Postman/HAR sources, route worksheet, complete policy library/browser/API, templates, compiled package and portable receiving. |
| sf30-seller-sdk operations/developer/dataset-refresh, response-cache, OAuth, TLS and availability | Original operator HTML, generated clients, runtime control, managed provider setup and credential/profile readers. |
| sf30-seller-discovery, sf96-seller-pilot-ops and sf96-seller-acceptance | Original compiler bytes, generated package launch command and route-review command. |
| sf82-seller-pilot, sf46-release and support components | Source/package release staging, managed launch, release console, discovery and saved support files. |
| mcp-merchant-operator | Selected descriptor hooks, policy/worksheet/client commands, shared Node file helpers, console browser assets and original receiving drivers. |
| Buyer, native signer, merchant receiver and original commerce support | Native request/payment review, durable result recovery and complete customer files. |
| Four explicit SF30 example files | Original dataset/application/upstream starter creation through the installed CLI. |

The explicit browser mappings retain the original SF61 policy panel and route
worksheet assets, cache workspace, Buyer collections and API access browser.
The original distribution root export is excluded; the selected named exports
identify their actual source files.

The source selection and 15 complete selected contributions are retained in the
ordinary distribution manifest. Source inspections can list the exact command,
export, provider and feature registrations for the selected commit. Build
receipts provide actual source/archive byte counts.

Continue the existing combined worksheet/policy receiving operation with this
selected source. It covers original authoring, policy create/reopen/update,
exact native review and save, complete file receiving, target reopening and
seller lifecycle. Its integration reads the maintained source-selection and
composition functions against the same original recipe. The original managed
OpenAPI and merchant-console receiving modules also travel with the product for
their existing application operations.

Included source guides, relative to package/source:

- stellar-forge/mcp-merchant-operator/OPENAPI_OPERATION_POLICIES.md
- stellar-forge/mcp-merchant-operator/OPENAPI_ROUTE_WORKSHEETS.md
- stellar-forge/mcp-merchant-operator/OPENAPI_WORKSPACES.md
- stellar-forge/mcp-merchant-operator/HAR_WORKSPACE.md
- stellar-forge/mcp-merchant-operator/console/APPLICATIONS.md
- stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/PACKAGE_TRANSFER.md
- stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/CACHE_POLICY_REVISIONS.md
- stellar/scf-starforge-20261009/distribution/runtime-workspace/APPLICATIONS.md
- stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md
- stellar/scf-starforge-20261009/distribution/RUNTIME_TRANSFER.md
