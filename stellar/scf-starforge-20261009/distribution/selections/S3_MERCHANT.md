# S3 merchant installation and customer handover

This product packages the S3 authoring workspace, seller releases,
merchant MCP, Object Buyer and managed Applications from one committed source
selection. A merchant edits real object locations and payment terms, reviews
the selected object versions, publishes a release, and delivers the original
customer files. The customer can then acquire, resume and assemble those exact
objects through the existing Stellar buyer.

The recipe is `s3-merchant.json`. Its source composition at
`21829b6af0dfa89f2bcf28e56fe294bc0a7a13ee` contains 27 commands, 47 named
exports, four Applications and seven merchant providers. The four Applications
are S3 object merchant, Object Buyer, Buyer Runbook and Merchant console.
The build receipt supplies the measured file and archive sizes.

## 1. Build the selected source

Use a complete checkout containing the commit you intend to release. The
selected commit must contain this recipe and guide. Run the maintained builder
from that source:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/starforge-checkout --ref ORIGINAL_COMMIT_SHA \
  --selection s3-merchant --out /absolute/s3-release
```

Keep the returned archive and its SHA-256 together. The source manifest binds
the source commit, complete file inventory, distribution inputs and exact recipe
path, Git blob, SHA-256 and byte length. The selected version includes
`.selection.s3-merchant`; the package name remains
`@tokenjunkielabs/starforge-merchant`.

If the build is interrupted, continue its output:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/starforge-checkout --out /absolute/s3-release --resume
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/s3-release --status
```

An omitted selection on resume retains the recipe. The same output
rejects a different explicit selection. A completed matching output returns its
retained archive. Use `--offline` when the required Git objects are
already available in that checkout.

## 2. Prepare and receive the runtime

The maintained installer uses Linux, Node 22.16 or newer, Python 3.11 or newer,
npm and `flock`. Prepare this complete runtime profile:

| Selection | Original capability |
| --- | --- |
| `--native` | Stellar SDK and the x402 server, buyer and extension peers |
| `--feature s3` | Original S3 package, including AWS SDK 3.1149.0 |
| `--feature schema` | Original offer and route schema support |
| `--feature openapi` | Original API metadata and shared merchant source support |
| `--feature mcp` | Original MCP transport, SDK 1.32.1 and declared MCP dependencies |
| `--operator` | Managed Applications and operator workflows |

The source-selected manifests determine exact dependency resolution. Retain the
resulting profile and complete lock with the runtime.

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /private/s3-runtime \
  --archive /absolute/s3-release/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature s3 --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /private/s3-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /private/s3-runtime --load --source
```

Use the actual archive path and digest returned by the builder. The final
inspection must return the selected source and a READY runtime. It validates
the retained source/profile/lock and loads the dependencies.

For an existing cache, use the same `install` or `resume` command with
`--offline --cache /absolute/original-npm-cache`. If the dependency
receiving workflow has already placed the complete compatible `node_modules`
and its lock in this installation, use
`install --dir /private/s3-runtime --adopt-existing`. The maintained installer
checks their selected profile, exact imports and native operations under its
existing lease. That option receives an installed dependency graph and does
not run npm.

Keep this installation's source, dependency tree, profile and lock together.
The `runtime-transfer` workflow supplies complete portable receiving;
its selected archive and dependency graph remain bound to the runtime.
For a new source edition use `runtime-install upgrade` or `recover` into a new
directory and retain the previous operating runtime while its merchant releases
are still in use.

The examples below use the selected runtime through the command
forwarder. Set these two task-specific paths once:

```sh
S3_TOOLS=/absolute/starforge-checkout/stellar/scf-starforge-20261009/distribution
S3_RUNTIME=/private/s3-runtime
s3_starforge() {
  node "$S3_TOOLS/runtime-install-cli.mjs" run --dir "$S3_RUNTIME" -- "$@"
}

s3_starforge source
s3_starforge registrations
s3_starforge --help
```

The same commands are available as `starforge` when that selected package's
existing bin is on the host PATH.

## 3. Open the Applications operator

Create an operator workspace, attach the READY runtime and open its private
browser:

```sh
s3_starforge runtime-workspace init --workspace /private/s3-operator
s3_starforge runtime-workspace attach \
  --workspace /private/s3-operator --runtime /private/s3-runtime \
  --label "S3 merchant runtime"
s3_starforge runtime-workspace serve \
  --workspace /private/s3-operator --port 8465
```

Open the exact private URL printed by the server. In Applications,
choose **S3 object merchant**, select the attached runtime and enter the
merchant's actual settings:

| Setting | Selected input |
| --- | --- |
| Private S3 merchant workspace | The existing authoring directory, or a new directory inside an existing private parent |
| Original release store | The workspace's retained SF82 store; first use defaults to its `releases/` child |
| Initial S3 source JSON | Original source file for the first saved revision |
| Initial Stellar payment JSON | Original shared terms or per-object `stellar-forge.s3-payments.v1` terms |
| Initial public HTTPS origin | The merchant's deployed public origin |
| Private environment file | The host's existing approved AWS/facilitator environment, when required |
| Authoring port | Use `0` to retain the workspace's saved authoring port after first launch |
| Local release console port | Use `0` for an available distinct release-console port |

Source, payment and public origin are imported together only when the workspace
has no saved revision. An established merchant starts from its saved revision,
so moving those initial import files does not replace or erase its work.

Use **Review application**, **Save application**, **Review start**, then
**Start reviewed application**. The reviewed startup binds the original
workspace UUID, release-store path, source inputs and saved authoring port.
Open the application's private authoring link. Its separate **Open merchant
releases** link points to the same SF82 store.

The Runtime operator keeps the application and native operation identities.
Use its existing **Connect**, output and recovery controls when reopening a
running application. An existing live native operation remains the selected
operation.

## 4. Configure and review the merchant's real products

Start with the [S3 source contract](../../sf30-seller-sdk/s3/README.md)
and [saved authoring guide](../../sf30-seller-sdk/s3/workspace/README.md).

Set the actual region, bucket and approved object keys. The existing AWS SDK
resolves credentials on the merchant host. With
`credentialProvider: "environment"`, use the host's selected
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and optional
`AWS_SESSION_TOKEN`. With `"default"`, the SDK uses the host's
existing role or profile chain. The source JSON retains credential-provider
selection, bucket and object locations; credential values stay in the host
environment.

An S3-compatible endpoint uses the source's HTTPS endpoint,
path-style and expected-owner settings. Select actual version IDs, ETags and
known whole-file SHA-256 values when available. ETags remain opaque validators;
the source keeps its separate content digest field.

For each product, select its public ID and route, filename, MIME type, whole or
chunk mode, and maximum response size. Whole products use one GET without a
query, including empty files. Chunk products use exact offset/length requests
and price each request according to their offer. The S3 source
contract defines the current per-response and concurrency limits.

Enter the merchant's approved network, asset, recipient and atomic-string
amount. Use the per-object payment document when products have
different terms. Save the entire source, payment and origin as one revision.

**Inspect saved objects** performs the authenticated HEAD selection.
Review the actual byte counts, snapshots, version pins and compiled payment
offers. Retain the selected revision and review. Preparing that review consumes
its saved pins and produces the four files without a second HEAD:

| Private package file | Meaning |
| --- | --- |
| `source.json` | Original source with the selected object identities |
| `service.json` | Original SF30 routes and compiled payment offers |
| `handlers.mjs` | Original SF30 handler and admission bindings |
| `objects.json` | Original public object descriptions for the customer |

Package generation runs on the deployment host. Its handler module
records the selected installed-source and private-package paths. When moving
an installation, use the maintained source/runtime receiving and regenerate
the package from the saved review on that host.

## 5. Stage, operate and deliver the release

Stage the prepared package with a chosen release ID and the merchant's original
runtime settings. In **Open merchant releases**, compare the staged version,
activate it against the current selection generation, and start the original
seller. Configure the host's selected facilitator for native payment operation
and the existing public HTTPS deployment for customers.

The release console owns the seller it starts. Its health, offers, developer
surface, restart, drain and rollback remain the SF30/SF82 operations.
The active release retains its exact package and digest.

Download that release's `objects.json` and `offers.json` from the
authoring browser. The browser verifies the complete file digests. These
customer descriptions remain available from the retained release after its
seller stops and after the preparation directory moves.

Keep the customer descriptions with their release ID and digest. They are the
input to the existing Object Buyer, alongside the customer's approved
buyer configuration, spending controls and signer selection.

## 6. Use the same authoring model from an agent

The selected package includes the original
[S3 MCP workflow](../../../../stellar-forge/mcp-merchant-operator/S3_WORKSPACE.md).
Create a private connection file that names the same authoring and release
directories:

```json
{
  "schema": "stellar-forge.s3-workspace-connection.v1",
  "releaseStore": "/private/s3-authoring/releases",
  "workspaces": {
    "reports": {
      "label": "Reports merchant",
      "directory": "/private/s3-authoring",
      "runtime": { "port": 0 }
    }
  }
}
```

Use the actual saved release store. The connection file is an owned regular
file with mode `0600`; workspace directories have mode `0700`.

```sh
s3_starforge merchant-mcp init-s3-workspaces \
  --dir /private/s3-mcp \
  --connection /private/s3-connection.json \
  --name "Reports merchant"
s3_starforge merchant-mcp serve \
  --config /private/s3-mcp/merchant-mcp.json --port 3211
```

Set the `MCP_ACCESS_TOKEN` through the selected host environment before
serving. The same saved configuration can be operated through the included
Merchant console Application and its source-owned managed lifecycle.

The S3 provider exposes the thirteen authoring/customer operations:

| Operation group | Original tools |
| --- | --- |
| Open and inspect | `merchant_s3_status`, `merchant_s3_open`, `merchant_s3_close` |
| Retained edits | `merchant_s3_history`, `merchant_s3_revision`, `merchant_s3_save` |
| Object selection | `merchant_s3_review`, `merchant_s3_review_status` |
| Package and stage | `merchant_s3_prepare`, `merchant_s3_package`, `merchant_s3_stage` |
| Complete customer files | `merchant_s3_customer`, `merchant_s3_customer_file` |

The shared merchant lifecycle supplies `merchant_compare`,
`merchant_activate`, `merchant_start`, `merchant_catalog` and
`merchant_stop`. The selected client-export, discovery, facilitator,
publisher and receiving families remain available through that same host.

Save operations use the current expected revision and a retained operation ID.
Review, preparation and staging use their exact IDs and inputs.
Reopening the browser or MCP client continues the same native model. A
conflicting revision is reconciled against the retained current head before
saving the complete intended edit.

The installed downloader receives both customer files:

```sh
s3_starforge merchant-mcp inspect-s3 \
  --url http://127.0.0.1:3211 --workspace reports --release-id reports-v1
s3_starforge merchant-mcp download-s3 \
  --url http://127.0.0.1:3211 --workspace reports --release-id reports-v1 \
  --release-digest ORIGINAL_RELEASE_DIGEST --out /private/customer/reports-v1
```

It verifies each range and the complete SHA-256 before publishing a file.
Repeat the same command and output directory after an interruption: completed
matching files are reused, and the saved download selection binds the original
endpoint, workspace, release and file identities.

## 7. Complete the customer acquisition

The included **Object Buyer workspace** reopens the customer's existing object
state and profile. Its managed Application accepts the state directory,
product profile and operator settings. The existing terminal handles explicit
approval for each new acquisition; saved responses, reports and completed files
reopen from the customer state.

For direct CLI operation, select one row from the delivered object
description and the customer's existing approved buyer configuration:

```sh
s3_starforge buyer-object init \
  --session /private/customer/report-session \
  --config /private/customer/buyer.json \
  --description /private/customer/reports-v1/objects.json \
  --object report --max-total-atomic APPROVED_TOTAL_ATOMIC

s3_starforge buyer-object run --session /private/customer/report-session
s3_starforge buyer-object status --session /private/customer/report-session
s3_starforge buyer-object assemble \
  --session /private/customer/report-session --out /private/customer/report.pdf
s3_starforge buyer-object export \
  --session /private/customer/report-session --out /private/customer/report-state.json
```

Replace the object ID, approved total, buyer configuration and output names with
the actual customer selection. Follow the original
[object acquisition guide](../../sf88-operator-buyer-cli/OBJECTS.md) for its
approved-route configuration, whole/chunk contract and native account setup.

The buyer checks the snapshot, full byte count, each exact byte range
and content hashes. Completed responses are reused after restart. Its original
`recover` and accounting/finalization operations handle interrupted native
requests and spending reservations. Assembly writes the complete selected file
to a new destination.

The `report-state.json` export is one saved OBJECT_STATE_JSON document. It
describes that session; its referenced response bodies and downloaded parts
remain in their retained files.

For a complete movable customer handover, use the existing Object Buyer
workspace's encrypted backup. Review its actual state, complete customer root
and optional original profile, stop its active buyer/analysis workers, then
create the reviewed quiesced bundle:

```sh
s3_starforge buyer-object backup-review \
  --state ORIGINAL_OBJECT_WORKSPACE --state-root ORIGINAL_CUSTOMER_ROOT
s3_starforge buyer-object backup \
  --state ORIGINAL_OBJECT_WORKSPACE --state-root ORIGINAL_CUSTOMER_ROOT \
  --out /private/customer-handover.backup \
  --review BACKUP_REVIEW_SHA256 --quiesced \
  --pass-env SF88_BACKUP_PASSPHRASE
s3_starforge buyer-object backup-verify \
  --bundle /private/customer-handover.backup --expect BACKUP_RECORD_SHA256 \
  --pass-env SF88_BACKUP_PASSPHRASE
```

Use the review digest returned by `backup-review` and the retained record digest
from the completed backup. Supply the passphrase through the host environment.
If the existing workspace uses a separate profile, select that same profile
with the command's `--profile` option during review and backup.

The bundle retains the received products, response bodies, downloaded parts,
native operator and purchase journals, and completed objects selected by the
backup review. On the receiving host, verify the same bundle and restore into
its original absent or empty customer state root:

```sh
s3_starforge buyer-object backup-restore \
  --bundle /private/customer-handover.backup --expect BACKUP_RECORD_SHA256 \
  --pass-env SF88_BACKUP_PASSPHRASE
```

Reopen the saved Object Buyer workspace and inspect its existing sessions and
files. The full backup/receiving contract is documented in
[OBJECTS.md](../../sf88-operator-buyer-cli/OBJECTS.md).

The included Buyer Runbook and `buyer-agent` use the same buyer intent,
governor and payment workflows for agent-operated purchasing.

## 8. Stop and reopen the same merchant

Before stopping, retain any intended edit in the existing authoring tab. Stop
the S3 Application from the Runtime operator and wait for its stop
result. The authoring controller drains accepted work and its owned release
console/seller, then closes its store.

Start that same saved Application again. Port `0` reuses the workspace's
retained authoring port, so the authoring tab keeps its browser origin and
stored draft. Use the new private link returned by the application to reconnect
the tab with the new session token. Restore its retained edit and pending
operation IDs, then save against the current revision. A deliberately selected
different fixed port chooses a different browser origin.

The database keeps the workspace UUID, release-store binding, revisions,
reviews, package operations and authoring port. Retained releases and customer
files remain the same objects. The merchant MCP owner and the
Applications owner each stop the native runtimes they themselves started;
use the instance controls when transferring operation between them.

## Source ownership and receiving

This recipe selects whole S3, SF82, SF88, buyer/governor, Operations,
developer, MCP and Runtime components. It also retains the four SF30 starter
files loaded through computed paths, browser mappings and the
source-owned provider declarations. The selector closes static imports
and binds all selected runtime manifests.

The full installed operating continuation is maintained in the public
[Apps receiving source](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/operations/scf-s3-installed-applications-20261012).
It receives the actual source/runtime, opens the normal Applications
browser, completes merchant/customer delivery, and retains the dirty authoring
tab through Stop and fresh Start. A selected build supplies its own committed
archive/profile/READY identity to that receiving workflow.

Preserve the actual build receipt, runtime installation/profile/lock, saved
merchant and release store, customer inputs and final downloaded bytes together.
These are the complete operating handover for the selected S3 product.
