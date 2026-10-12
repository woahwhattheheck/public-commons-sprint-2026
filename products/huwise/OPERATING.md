# Operate and deliver a Huwise data product

Use one saved Huwise or Opendatasoft workbench from source discovery through
analyst review, tenant ingestion, publication, merchant operation and customer
receiving. The browser, command line and merchant agent operate that same
project. A customer delivery contains complete original files and can be
reopened after the host closes.

The Huwise source selection includes the complete Explore workflow, the
92-operation Automation API client, all 48 Huwise merchant actions, typed client
exports, tenant browser assets, the native receiving command, and the original
publisher, seller, buyer and runtime installation sources.

## Install the selected product

Use Linux, Node.js 24 or later, Python 3.11 or later, npm and util-linux flock.
Huwise preserves original JSON number tokens; keep the runtime's exact-JSON
support. Place installations and operating projects in separate directories
under an owned private parent. Use permissions 0700 for private directories and
0600 for connection and input files.

Build from the standalone source repository and the exact chosen Git commit:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \
  --selection huwise --out /absolute/private/huwise-release
~~~

Retain the returned archive path, SHA-256 and manifest. The package version binds
both its original commit and the huwise selection. The selection also retains
the original job-intake-browser and paid-job-operations source contributions
used by its shared buyer workspace. Their browser route manifests resolve the
shared file-input and resolution-limit modules to the same source served by
the native HTTP applications. The original SF66 JSON-RPC commerce and recovery
modules travel with their existing commerce importers.

When receiving a newer source edition from a retained Git object cache, keep
the original donor cache and its source receipt. Receive the corrected target's
exact commit, complete tree and required new blobs through the maintained Git
object receiver. Build that explicit target commit in a new output directory:
an earlier failed output remains bound to its earlier source commit. Reuse
the original operating project and retained customer intent after installing
the new package. Source receiving and installation do not require another
provider query or purchase.

It carries this guide as its
README and includes the original source specification, selected contribution
declarations, source file inventory and upstream license.

The maintained installer prepares the runtime used for publishing and payment:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/private/huwise-runtime \
  --archive /absolute/private/huwise-release/ORIGINAL.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/private/huwise-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/private/huwise-runtime --load --source
~~~

Replace the archive path and hash with the builder's actual result. Continue the
same runtime directory after interruption. An existing complete dependency tree
can be received with the installer's maintained --adopt-existing operation.
[Runtime installation](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)
covers package caches, installation recovery, native dependencies and upgrade.

All commands below use the installed starforge dispatcher. Define this function
in the current shell using the actual toolkit and prepared runtime:

~~~sh
starforge() {
  node /absolute/toolkit/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs \
    run --dir /absolute/private/huwise-runtime -- "$@"
}
starforge huwise --help
~~~

For a source-only installation, install the returned archive with
npm install --ignore-scripts --offline --omit=optional ORIGINAL.tgz and use
npx --no-install starforge. Source-only capture, review, Automation and the
normal bearer HTTP merchant transport use Node's built-in modules. Native
payment and optional stdio/OAuth facilities use their declared dependencies.
The installed starforge registrations and starforge source commands show the
actual selected command and source identity.

## Open or continue the original project

For a new public-portal project:

~~~sh
starforge huwise init \
  --project /absolute/private/huwise-project \
  --origin https://public.opendatasoft.com

starforge huwise serve \
  --project /absolute/private/huwise-project --port 0
~~~

Open the complete local capability URL returned by serve. An existing project
uses its same directory. For an authorized private portal, name the existing
credential environment variable through --auth-token-env at initialization and
supply its value in the host environment.

Search the actual catalog, select a dataset and inspect its schema. Save a
complete capture for the edition that will be reviewed and delivered. For the
public portal example, a private selection.json contains:

~~~json
{
  "datasetId": "open-data-sources",
  "lang": "en",
  "timezone": "UTC"
}
~~~

~~~sh
starforge huwise dataset --project /absolute/private/huwise-project \
  --dataset open-data-sources
starforge huwise capture --project /absolute/private/huwise-project \
  --input /absolute/private/selection.json
starforge huwise status --project /absolute/private/huwise-project
~~~

The completed capture returns its original edition and source identities. The
native export retains every selected row, full provider responses, field
metadata, rights, counts and source clocks. A records preview remains an
interactive catalog operation. Retain the returned edition ID and capture hash
for subsequent notes, publication and export.

## Review the complete edition

Use the saved edition to inspect rows and facets, write analyst and row notes,
and compare a later source refresh:

~~~sh
starforge huwise edition --project /absolute/private/huwise-project --id EDITION_ID
starforge huwise rows --project /absolute/private/huwise-project \
  --id EDITION_ID --offset 0 --limit 100
starforge huwise facets --project /absolute/private/huwise-project \
  --id EDITION_ID --field country --limit 50
starforge huwise notes --project /absolute/private/huwise-project \
  --id EDITION_ID --input /absolute/private/notes.json
starforge huwise compare --project /absolute/private/huwise-project \
  --before FIRST_EDITION_ID --after REFRESH_EDITION_ID --key url
~~~

Notes bind expectedCaptureSha256 and expectedRevision to the actual edition.
Use the current values returned by edition. Comparison uses a complete, unique,
non-null source key; select a key appropriate to the actual dataset.

The browser exposes these same saved reviews in a plain grayscale workspace.
Its complete source and analyst journey is in
[Huwise workspace](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/workspace/WORKSPACE.md).
Single-format exports use huwise export-edition with json, csv, geojson or html.
Use the complete merchant export below to deliver all four formats together.

## Ingest and publish in a Huwise tenant

Create a private host connection for the actual tenant:

~~~json
{
  "schema": "stellar-forge.opendatasoft-automation-connection.v1",
  "targets": {
    "delivery": {
      "label": "Delivery tenant",
      "origin": "https://tenant.example.com",
      "authTokenEnv": "HUWISE_DELIVERY_TOKEN",
      "timeoutMs": 30000,
      "maxResponseBytes": 67108864,
      "maxUploadBytes": 268435456
    }
  }
}
~~~

Supply the existing tenant token through HUWISE_DELIVERY_TOKEN in the host
environment. Start the same workbench with the connection:

~~~sh
starforge huwise serve \
  --project /absolute/private/huwise-project \
  --automation-connection /absolute/private/huwise-tenants.json --port 0
~~~

Choose Tenant ingestion. Select the complete source edition, named target,
dataset ID and intended visibility. For an existing dataset, find its actual
dataset UID and select the resource UID being replaced, or explicitly append
a resource. Author the complete native metadata, extractor, field, processor,
security and schedule configuration.

The tenant plan binds its source capture, notes revision and selected tenant.
Inspect saves the full actual configuration; review binds that inspected
preimage and plan to one review ID. Applying rechecks the original configuration,
uploads and verifies the entire original file, applies the native settings and
publishes the selected dataset. Native metadata templates and omitted existing
settings remain part of that comparison.

The corresponding saved-file CLI flow is:

~~~sh
starforge huwise tenant-targets --project /absolute/private/huwise-project \
  --automation-connection /absolute/private/huwise-tenants.json
starforge huwise tenant-prepare --project /absolute/private/huwise-project \
  --automation-connection /absolute/private/huwise-tenants.json \
  --input /absolute/private/tenant-plan.json
starforge huwise tenant-plan --project /absolute/private/huwise-project --id PLAN_ID
starforge huwise tenant-inspect --project /absolute/private/huwise-project \
  --automation-connection /absolute/private/huwise-tenants.json --id PLAN_ID
starforge huwise tenant-review --project /absolute/private/huwise-project \
  --id PLAN_ID --input /absolute/private/tenant-review.json
starforge huwise tenant-apply --project /absolute/private/huwise-project \
  --automation-connection /absolute/private/huwise-tenants.json \
  --id PLAN_ID --review-id REVIEW_ID
starforge huwise tenant-status --project /absolute/private/huwise-project \
  --automation-connection /absolute/private/huwise-tenants.json --id PLAN_ID
starforge huwise tenant-receive --project /absolute/private/huwise-project \
  --automation-connection /absolute/private/huwise-tenants.json --id PLAN_ID
starforge huwise tenant-export --project /absolute/private/huwise-project --id PLAN_ID
starforge huwise tenant-delivery --project /absolute/private/huwise-project --id EXPORT_ID
~~~

Use the actual returned IDs. The complete plan JSON and tenant-review.json
contracts, field and processor semantics, template discovery, native limits and
all recovery commands are included in
[Tenant ingestion](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/TENANT-INGESTION.md).
The review file contains planSha256 and configurationSha256 from the inspected
plan, with an optional note. Complete plan files preserve original JSON numeric
literals.

Receiving observes the new native publication, captures every published row and
compares it with the reviewed source or explicitly reviewed transformed output.
It also checks the complete native configuration and record errors. An
interrupted receive continues its original capture while the publication is
unchanged. A newer publication retains the earlier attempt and starts its own
receiving capture.

The Automation client exposes all 92 maintained SDK operations, including
dataset, resource, metadata, field, processor, security, schedule, attachment
and alternative-export operations. It follows complete native pagination and
retains whole upload/download responses. Its included
[API reference](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/automation/API.md)
links the complete original OpenAPI and UPSTREAM_LICENSE.txt.

## Publish a merchant from the reviewed source

The same project can select dataset fields, prepare a native publisher
candidate, inspect its actual query output, save a candidate review and publish
the reviewed data product. Continue through huwise select, prepare, inspect,
review and publish, then huwise export for the merchant package.

Use the actual payment network, asset, recipient and prices in that merchant
plan. huwise stage targets the same project's seller-releases directory;
huwise offer and huwise buyer bind the original exported merchant and its
customer request. The package contains the complete source capture, reviewed
projection, candidate, review, handler, API declarations and native receiving
guide.

The complete input shapes, original command sequence, deployment and customer
payment setup are in
[Merchant operation](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/MERCHANT.md).
Keep the workbench's original seller store when connecting the merchant agent.

## Review and stage the same service with a facilitator

The installed Huwise operator includes the original shared facilitator review
engine. Open the original workbench with --facilitators HOST_PROFILE_JSON and
choose Facilitators in its browser. Each source release must match its original
merchant package, immutable handler and capture. Review retains the provider's
complete native supported response, ordered payment alternatives and source
digest; stage uses that saved review through the existing SF82 release owner.

The original merchant controls continue to select, start, stop and roll back the
running seller. The same buyer query, intent and completed acquisition stay in
their original operation. Profile changes are host configuration; reopen the
actual workbench owner to read the updated file.

The full [facilitator operating and receiving guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/FACILITATORS.md)
includes complete installed CLI commands, browser operation, native recovery,
typed client and customer delivery. The original immutable export accepts
facilitatorReviewId together with merchantExportId and includes the complete
review, source binding and guide. Existing earlier exports remain unchanged.

## Operate the same project through the merchant agent

A private connection names the existing workbench and, when selected, its
tenant connection:

~~~json
{
  "schema": "stellar-forge.opendatasoft-workspace-connection.v1",
  "workspaces": {
    "portals": {
      "label": "Portal data product",
      "directory": "/absolute/private/huwise-project",
      "origin": "https://public.opendatasoft.com",
      "automationConnection": "/absolute/private/huwise-tenants.json",
      "imports": {},
      "merchants": {},
      "sellers": {}
    }
  }
}
~~~

Omit automationConnection when operating a project that only reads a portal.
Close an independently running workbench before opening it through the merchant
host; one owner retains its original project lease.

~~~sh
starforge merchant-mcp init-opendatasoft-workspaces \
  --dir /absolute/private/huwise-merchant \
  --connection /absolute/private/huwise-connection.json
starforge merchant-mcp serve \
  --config /absolute/private/huwise-merchant/merchant-mcp.json --port 3211
~~~

Supply the host's existing bearer token through MCP_ACCESS_TOKEN. The returned
host URL and its original credentials are the connection for the customer
client. The initializer retains any selected release and existing seller
history. A multi-project connection selects its primary seller with --workspace.

starforge merchant-huwise tools shows the 48 Huwise action contracts. Open
the named workspace and use its returned operation IDs to await running work.
The twelve tenant actions share the same native plan, reviewed configuration,
publication and receiving identities. The full
[merchant agent guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar-forge/mcp-merchant-operator/OPENDATASOFT.md)
contains the action table, typed client and exact export request contract.

Installed JavaScript and TypeScript clients import
@tokenjunkielabs/starforge-merchant/merchant/mcp/opendatasoft/client.
The selected package also exports seller/opendatasoft/automation,
seller/opendatasoft/automation/contract and
seller/opendatasoft/automation/workspace under that package name.

## Deliver every original customer file

Create one immutable analyst export at the selected edition, capture hash and
notes revision. It contains:

| File | Contents |
| --- | --- |
| data.json | Every original row, source metadata and analyst notes |
| data.csv | Every row, with each original cell encoded as JSON |
| data.geojson | Complete properties and selected geometry with native warnings |
| review.html | Complete offline review table and source attribution |
| DATASET-RECEIVING.md | Instructions for the selected source and delivery |
| Selected merchant files | Complete merchant.tar.gz, merchant receiving guide and original buyer request |
| Selected tenant files | Complete tenant.tar.gz and TENANT-INGESTION.md |

Select sourceId, merchantExportId and buyerRequestId when those original outputs
belong to the same edition. Select tenantExportId from tenant-export to include
the complete tenant operation. Its capture and notes revision must match the
analyst edition. The returned manifest identifies every file by size and hash.

~~~sh
starforge merchant-huwise call \
  --url "$MERCHANT_MCP_URL" --action export \
  --arguments /absolute/private/export-request.json
starforge merchant-huwise inspect \
  --url "$MERCHANT_MCP_URL" --export EXPORT_ID
starforge merchant-huwise download \
  --url "$MERCHANT_MCP_URL" --export EXPORT_ID \
  --directory /absolute/private/received-huwise \
  --manifest-sha256 "$EXPORT_MANIFEST_SHA256"
starforge merchant-huwise reopen \
  --export EXPORT_ID --directory /absolute/private/received-huwise \
  --manifest-sha256 "$EXPORT_MANIFEST_SHA256"
~~~

Use the original returned export ID and manifest hash. Download resumes each
retained file at its saved offset after checking the original prefix. Its
completion manifest is published after all files match. Reopen verifies those
same files locally after the merchant host closes.

For the complete maintained receiving journey against an existing project:

~~~sh
starforge merchant-huwise-receive \
  --directory /absolute/private/huwise-receiving \
  --project /absolute/private/huwise-project \
  --source-ref ORIGINAL_COMMIT
~~~

This reuses the existing complete edition, analyst notes and selected native
merchant/customer files. With no --project, the command creates its own project
and captures the complete live public open-data-sources dataset. Reuse the same
receiving directory after an interruption. It retains the original connection,
export request, complete downloaded files and native-receiving.json.

## Complete native facilitator commissioning and receiving

Use the installed merchant-huwise-facilitators-receive command for the full
original saved-review, SF82 stage, typed-client, desktop/phone browser and
offline customer workflow. It takes an existing completed project, original
merchant export/source release, exact host profiles and native selected-build
receipt. Its source cohort is verified against the actual installed package
manifest before a provider action.

~~~sh
starforge merchant-huwise-facilitators-receive \
  --directory /absolute/private/huwise-facilitator-receiving \
  --input /absolute/private/facilitator-receiving-input.json \
  --project /absolute/private/original-huwise-project \
  --profiles /absolute/private/facilitators.json \
  --source-ref ORIGINAL_COMPLETE_COMMIT \
  --build-result /absolute/private/huwise-build-result.json \
  --playwright-module /absolute/installed/playwright/index.mjs \
  --browser /absolute/installed/chromium
~~~

Keep the complete same receiving directory after interruption. The programme
adopts exact retained reviews and committed native stages, continues original
file checkpoints, retains every desktop/phone download and closes its own
resources. Complete files reopen locally after the merchant host closes.
Original capture, notes, purchases and seller selection keep their original
identities. A compatible review and staged release do not activate a seller
or produce another payment.

The [complete facilitator receiving guide](../../stellar-forge/mcp-merchant-operator/FACILITATOR_RECEIVING.md)
defines all input fields, exact source/profile/runtime binding, native failed
stage continuation, uncertain-review adoption, complete output files and
offline receiving. Provider incompatibility is a retained native outcome;
the command does not replace it with a successful result.

## Continue after interruption or upgrade

Keep the original project, runtime, tenant plan, merchant export and receiving
directories. The source package belongs in its installation directory; private
tokens, tenant connections, workbench state and customer output remain in their
original private locations.

Use huwise resume for an interrupted source edition. Use tenant-recover with
the original plan and tenant connection to adopt its saved acknowledgments or
actual native result. The tenant journal records the request before dispatch
and retains complete responses. A lost upload response is reconciled using the
original unique filename, actual file UID and complete downloaded hash.

Tenant delivery freezes its complete basis before bulk copying. A continuation
verifies existing complete files and the saved prefix of a partial file, then
continues that same preparation. A completed historical delivery preserves its
source and notes even after later workbench edits.

The distribution builder's --resume operation retains its original commit and
huwise selection. An omitted selection inherits that saved choice. A different
product or source version uses a new build output and installation directory,
then reopens the existing operating project. Retain the original archive,
manifest, source commit and customer delivery together.
