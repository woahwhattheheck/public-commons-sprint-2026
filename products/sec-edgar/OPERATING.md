# Operate and hand over the SEC EDGAR merchant

This guide carries original SEC captures through product authoring, merchant
operation, complete customer receiving and transfer of the whole operator
workspace. Keep private source and workspace directories outside the installed
package so the same state remains available across package updates.

## Select and reopen the installed runtime

Follow the build and installation commands in [README.md](README.md).
A completed build retains its source commit, source recipe, complete file
inventory and archive identity. Continue an interrupted build using its same
output:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --out /absolute/private/sec-edgar-release --resume --offline
~~~

The original runtime runner forwards the installed commands:

~~~sh
starforge runtime-install run --dir /absolute/private/sec-edgar-runtime -- source
starforge runtime-install run --dir /absolute/private/sec-edgar-runtime -- registrations --source sec-edgar
starforge runtime-install run --dir /absolute/private/sec-edgar-runtime -- merchant-providers inspect edgar-workspaces
starforge runtime-install run --dir /absolute/private/sec-edgar-runtime -- sec-edgar-workspace --help
~~~

For a managed browser, initialize the existing runtime console, attach this
installed runtime and select its SEC EDGAR application:

~~~sh
starforge runtime-workspace init \
  --workspace /absolute/private/runtime-console \
  --runtime-home /absolute/private/runtimes

starforge runtime-workspace attach \
  --workspace /absolute/private/runtime-console \
  --runtime /absolute/private/sec-edgar-runtime --label "SEC EDGAR"

starforge runtime-workspace serve \
  --workspace /absolute/private/runtime-console
~~~

Choose the original private operator and source-store paths. Use the existing
Review, Save, Connect, Review Start and Start actions. The SEC adapter checks
the selected directory, original workspace identity and current source review
against the live operator listener. Stop and reopen use the same native lifecycle.

## Retain the actual issuer source

Import a complete downloaded Company Facts capture:

~~~sh
starforge sec-edgar import \
  --store /absolute/private/sec-edgar/captures \
  --id apple-facts-20261011 --kind facts --cik 320193 \
  --input /absolute/private/sec-edgar/inputs/CIK0000320193.json \
  --source-url https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json

starforge sec-edgar editions \
  --store /absolute/private/sec-edgar/captures
~~~

Supply --captured-at and --source-sha256 when those original acquisition values
are available. A submissions capture uses --kind filings; a named historical
shard remains its own source edition.

For new acquisition, configure the organization's contact User-Agent in
SEC_EDGAR_USER_AGENT and use the existing shared SEC quota directory:

~~~sh
starforge sec-edgar acquire \
  --store /absolute/private/sec-edgar/captures \
  --id apple-facts-next --kind facts --cik 320193 \
  --quota-dir /absolute/private/supplier-quotas/sec-edgar
~~~

The original adapter retains its provider limits and cooldown behavior.
A repeated compatible import keeps its saved edition. New bytes use a new
edition name.

## Author and publish the product

~~~sh
starforge sec-edgar workspace \
  --workspace /absolute/private/sec-edgar/operator \
  --store /absolute/private/sec-edgar/captures
~~~

Open the returned private local URL. In **Products**, select the actual edition,
product ID and route. Choose its offered concepts or filing forms, example query
and page maximum. Set the public merchant origin and actual merchant's Stellar
payment terms. Preview the returned records, apply product changes and save.

For example, a facts product named appleFacts can select us-gaap:Assets and the
original USD unit. Download its saved merchant configuration from **Handoff**:

~~~sh
starforge sec-edgar review \
  --config /absolute/private/sec-edgar/merchant.json

starforge sec-edgar query \
  --store /absolute/private/sec-edgar/captures \
  --config /absolute/private/sec-edgar/merchant.json --product appleFacts \
  --query '{"taxonomy":"us-gaap","concept":"Assets","unit":"USD","limit":"25"}'
~~~

Cursors belong to the original edition and product selection. Consume the
source's numeric text, units, accessions and missing fields directly.
The original source guide defines query parameters and filing-shard scope.

## Deliver and operate the complete customer package

Export the same saved product:

~~~sh
starforge sec-edgar export \
  --store /absolute/private/sec-edgar/captures \
  --config /absolute/private/sec-edgar/merchant.json \
  --out /absolute/private/sec-edgar/customer-release
~~~

Keep the entire output directory. It includes the selected complete source
store, merchant configuration, review, OpenAPI, buyer handoff, generated client
and native manifest. New native manifests also enumerate original edition
records and raw captures. Existing completed exports retain their original
manifest bytes when reopened or repeated.

Start the merchant from that exact export with the actual facilitator and
existing merchant HTTPS ingress:

~~~sh
starforge sec-edgar serve \
  --store /absolute/private/sec-edgar/customer-release/source-store \
  --config /absolute/private/sec-edgar/customer-release/merchant.json \
  --port 8787 --operations-port 8788 \
  --facilitator https://ACTUAL_FACILITATOR
~~~

The original seller prints its runtime snapshot. Its native buyer and generated
client own payment approval, signing, spending limits and acquisition state.
Use the existing availability and history directories when operating those
stores. SIGINT or SIGTERM closes the seller normally.

The merchant MCP provider offers the complete import, acquisition, product,
preview, revision, customer export and receiving workflow. Configure its private
connection using the [SEC MCP guide](../../stellar-forge/mcp-merchant-operator/SEC_EDGAR.md).
Customers can inspect, continue and reopen the complete retained export:

~~~sh
starforge sec-edgar-download inspect \
  --url ORIGINAL_MCP_URL --workspace ORIGINAL_ALIAS --export ORIGINAL_EXPORT_ID

starforge sec-edgar-download download \
  --url ORIGINAL_MCP_URL --workspace ORIGINAL_ALIAS --export ORIGINAL_EXPORT_ID \
  --manifest-sha256 ORIGINAL_TRANSFER_MANIFEST_SHA256 \
  --out /absolute/private/sec-customer

starforge sec-edgar-download reopen --out /absolute/private/sec-customer
~~~

Use the original MCP access-token environment variable. Repeating download
continues the saved byte prefix; reopen verifies the received native files and
opens the original compiler and source store offline.

## Move the whole authoring workspace

In **Handoff**, save current edits and choose **Review saved workspace**.
The page shows the saved revision, complete history count, imported editions,
distinct captures and source bytes. Choose **Save complete handover** and
download the ZIP and manifest.

An export name identifies one complete saved selection. A retained export
continues after a lost return or subsequent draft change. **Open retained export**
reopens that named completed output. A new selection uses a new name.

The same operation is available from the command line:

~~~sh
starforge sec-edgar-workspace review \
  --workspace /absolute/private/sec-edgar/operator \
  --store /absolute/private/sec-edgar/captures

starforge sec-edgar-workspace export \
  --workspace /absolute/private/sec-edgar/operator \
  --store /absolute/private/sec-edgar/captures \
  --out /absolute/private/sec-edgar/operator-handover
~~~

For an earlier reviewed selection, supply its --review SHA256.
Repeating the same output uses its original retained selection. The complete
archive is operator-handover/sec-edgar-workspace.zip; the command reports its
exact SHA-256 and byte count.

The handover includes every original workspace/versions/*.json file from
revision zero through the selected saved revision. It also contains every
original imported edition record and each distinct raw source blob. Each file
keeps its exact bytes. A source store outside the original workspace is carried
alongside the operator history.

## Receive and continue the same operator

Install this product on the receiving machine, then inspect and receive the ZIP:

~~~sh
starforge sec-edgar-workspace inspect \
  --archive /absolute/incoming/sec-edgar-workspace.zip \
  --sha256 ORIGINAL_ARCHIVE_SHA256

starforge sec-edgar-workspace receive \
  --archive /absolute/incoming/sec-edgar-workspace.zip \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --out /absolute/private/received-sec-workspace

starforge sec-edgar-workspace open \
  --root /absolute/private/received-sec-workspace
~~~

Receiving uses the maintained source archive engine to stream and verify the
full ZIP. The original SEC engine reads every imported source and saved product
binding before publishing a new receiver. Its original workspace ID and first
revision are preserved. The browser opens its saved draft and complete history.

A repeated archive reuses identical originals. Receiving an earlier handover
into an advanced copy keeps later local revisions and additional editions.
A newer handover appends a matching native history prefix. Conflicting original
files remain a concrete reconciliation error. The result reports the selected
revision separately from its current revision.

To manage a received operator through Applications, select these paths:

| Setting | Received path |
| --- | --- |
| Operator workspace | /absolute/private/received-sec-workspace/workspace |
| SEC source store | /absolute/private/received-sec-workspace/source-store |

Review the receiving machine's paths through the normal Applications controls.
The original opener creates the new local session and managed-launch files.

## Embedded receiving API

~~~js
import {
  reviewEdgarOperator, exportEdgarOperator, receiveEdgarOperator
} from '@tokenjunkielabs/starforge-merchant/seller/sec-edgar/receiving';

const original = {
  directory: '/absolute/private/sec-edgar/operator',
  storeDirectory: '/absolute/private/sec-edgar/captures',
};
const review = await reviewEdgarOperator(original);
const saved = await exportEdgarOperator({
  ...original,
  outputDirectory: '/absolute/private/sec-edgar/operator-handover',
  expectedReviewSha256: review.summary.reviewSha256,
});
const received = await receiveEdgarOperator({
  archivePath: saved.archivePath,
  expectedArchiveSha256: saved.archive.sha256,
  directory: '/absolute/private/received-sec-workspace',
});
console.log(received.workspaceId, received.selectedRevision, received.currentRevision);
~~~

Node 24 runs the native SEC parser. Python 3.10+ supplies the shared archive
engine; set PYTHON or use --python for a particular installed interpreter.
Each raw capture retains the original 32 MiB source limit. Whole workspace
archives stream up to 8 GiB and 100,000 members. Export reports an explicit size
or inventory error before exceeding those limits.
