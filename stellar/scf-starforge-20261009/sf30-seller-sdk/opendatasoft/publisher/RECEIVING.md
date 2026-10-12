# Huwise merchant package receiving

This directory contains one reviewed dataset edition and the files used to serve it through the original Stellar Forge seller. The merchant manifest binds the source capture, published snapshot, reviewed projection, public resource, payment offer and handler files.

Use the package manifest SHA-256 supplied in the delivery or companion guide. The dataset package archive and the Stellar Forge runtime distribution are separate deliverables: the dataset archive carries this edition; the runtime distribution supplies the maintained seller, installation and buyer commands.

## 1. Install the supplied runtime

Use Linux, Node 24 or newer, Python 3.11 or newer, npm, util-linux flock and tar. The receiving operator owns an existing private parent directory. Keep the runtime, received dataset, seller release store and customer operation in separate subdirectories.

If an installed matching Stellar Forge runtime is already available, continue with its original source root. To install the supplied distribution on a new host, substitute the actual distribution archive path and its complete SHA-256:

~~~sh
umask 077
mkdir /absolute/private/ods-toolkit
cd /absolute/private/ods-toolkit
npm install --ignore-scripts --offline --omit=optional /absolute/private/original-merchant.tgz

npx --no-install starforge runtime-install prepare \
  --dir /absolute/private/ods-runtime \
  --archive /absolute/private/original-merchant.tgz \
  --sha256 ORIGINAL_DISTRIBUTION_ARCHIVE_SHA256 \
  --native --operator

npx --no-install starforge runtime-install install \
  --dir /absolute/private/ods-runtime

npx --no-install starforge runtime-install inspect \
  --dir /absolute/private/ods-runtime --load --source
~~~

The installer uses the selected distribution's dependency declarations and retains its exact source under ods-runtime/package/source. For an offline dependency installation, pass the installer --offline and --cache options for the receiving host's populated npm cache.

An interrupted installation resumes in the same directory with runtime-install resume. The installation-specific RUNBOOK.md records its original source, dependencies and commands. For this distribution, set the application source root to:

~~~sh
export ODS_SOURCE_ROOT=/absolute/private/ods-runtime/package/source/stellar/scf-starforge-20261009
~~~

Use the installed source and dependency tree together. A complete source checkout with the same prepared native dependencies can supply ODS_SOURCE_ROOT directly.

## 2. Receive and inspect this exact dataset package

Create a new private directory and extract the complete dataset archive. Use the dataset archive supplied by the merchant:

~~~sh
umask 077
mkdir /absolute/private/received-ods-package
tar --no-same-owner --no-same-permissions -xzf /absolute/private/opendatasoft-merchant.tar.gz \
  -C /absolute/private/received-ods-package

export ODS_PACKAGE=/absolute/private/received-ods-package
export ODS_MANIFEST_SHA256=EXPECTED_MERCHANT_MANIFEST_SHA256
~~~

ODS_MANIFEST_SHA256 is the hash of merchant-manifest.json supplied by the sender. It is distinct from the archive checksum and the dataset snapshot. The workspace's companion download records the selected manifest, handler, source and dataset identities.

Inspect the received files with the original package inspector:

~~~sh
node --input-type=module <<'JS'
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = await realpath(process.env.ODS_SOURCE_ROOT);
const { inspectOpendatasoftMerchantPackage } = await import(pathToFileURL(
  join(root, 'sf30-seller-sdk/opendatasoft/publisher/release.mjs')).href);
const retained = await inspectOpendatasoftMerchantPackage(
  process.env.ODS_PACKAGE, process.env.ODS_MANIFEST_SHA256);
console.log(JSON.stringify({
  directory: retained.directory,
  manifestSha256: retained.manifestSha256,
  handlerSha256: retained.handlerSha256,
  resource: retained.manifest.resource,
  snapshot: retained.manifest.dataset.snapshot,
  rowCount: retained.manifest.dataset.rowCount,
  capture: retained.manifest.capture,
  review: retained.manifest.review,
  files: retained.manifest.files
}, null, 2));
JS
~~~

The inspector checks each declared member's byte length and SHA-256, the generated handler, and the dataset's snapshot and row count. Received files must be regular private files with mode 0600, in their original relative layout. Use real absolute directories; the maintained inspector checks file identity and private permissions.

The package contains:

| File or directory | Purpose |
| --- | --- |
| merchant-manifest.json | Selected resource, dataset snapshot, original capture, review and file identities |
| data.csv and dataset.json | Complete reviewed customer dataset and original dataset query policy |
| source.json and original-source.json | Reviewed field mapping and retained source declaration |
| reviewed-plan.json, candidate.json and review.json | Native extraction, candidate and recorded review |
| capture/ | Complete original capture manifest and every referenced provider response |
| openapi.json, selections.json and route-bindings.json | Advertised API, six public payment fields and original input admission |
| handlers.mjs and runtime/ | Relative, retained dataset handler used by the original seller |
| RECEIVING.md | These operating instructions for editions exported with the receiving-guide update |

Older retained packages can use this guide as a companion. Their original manifest remains their identity. The guide download adds the selected package identities at the end for reference.

## 3. Stage the received package in the original seller store

The original Opendatasoft receiving function verifies this directory and copies it into the selected SF82 release store before staging. That store retains the package independently of the download directory.

Choose the actual release store and one new release ID:

~~~sh
export ODS_RELEASE_STORE=/absolute/private/ods-seller-releases
export ODS_RELEASE_ID=opendatasoft-edition-001
~~~

For a new store, initialize it once:

~~~sh
node "$ODS_SOURCE_ROOT/sf82-seller-pilot/release-cli.mjs" init \
  --store "$ODS_RELEASE_STORE"
~~~

For an existing store, inspect its current state with the status command and continue from that saved generation.

Create a private runtime JSON file at /absolute/private/ods-seller-runtime.json. The public facilitator URL selects the existing payment verification and settlement service:

~~~json
{
  "port": 8423,
  "facilitator": "https://YOUR_CONFIGURED_FACILITATOR"
}
~~~

Use the facilitator configured for the package's advertised payment network and asset. A local native facilitator uses its actual loopback URL and the explicit runtime field "allowLocalFacilitator": true. Omitting facilitator selects the original offer-only service mode. Wallet credentials belong to the existing private native facilitator or buyer setup.

The dataset's payment object remains the six public fields in selections.json: scheme, network, asset, amount, payTo and maxTimeoutSeconds. Payment amounts are whole base-unit strings. The receiving runtime settings choose how that retained offer operates.

Stage the exact package:

~~~sh
export ODS_RUNTIME_FILE=/absolute/private/ods-seller-runtime.json

node --input-type=module <<'JS'
import { join } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = await realpath(process.env.ODS_SOURCE_ROOT);
const { stageOpendatasoftMerchantRelease } = await import(pathToFileURL(
  join(root, 'sf30-seller-sdk/opendatasoft/publisher/release.mjs')).href);
const runtime = JSON.parse(await readFile(process.env.ODS_RUNTIME_FILE, 'utf8'));
const staged = await stageOpendatasoftMerchantRelease(process.env.ODS_RELEASE_STORE, {
  packageDirectory: process.env.ODS_PACKAGE,
  expectedManifestSha256: process.env.ODS_MANIFEST_SHA256,
  id: process.env.ODS_RELEASE_ID,
  label: 'Received Huwise dataset edition',
  runtime
});
console.log(JSON.stringify(staged, null, 2));
JS
~~~

Keep the returned release, copied package directory, manifest SHA-256 and snapshot. Reopening an existing release uses its retained ID and generation.

## 4. Activate and run the original seller

The release console supplies inspection, activation, seller start/stop, facilitator selection and customer handoff:

~~~sh
node "$ODS_SOURCE_ROOT/sf82-seller-pilot/release-cli.mjs" console \
  --store "$ODS_RELEASE_STORE" --port 8425
~~~

Open its complete printed private URL. Inspect the selected release and public payment terms, then activate and run that release through the console.

The equivalent original CLI commands are:

~~~sh
node "$ODS_SOURCE_ROOT/sf82-seller-pilot/release-cli.mjs" inspect \
  --store "$ODS_RELEASE_STORE" --id "$ODS_RELEASE_ID"
node "$ODS_SOURCE_ROOT/sf82-seller-pilot/release-cli.mjs" status \
  --store "$ODS_RELEASE_STORE"

node "$ODS_SOURCE_ROOT/sf82-seller-pilot/release-cli.mjs" activate \
  --store "$ODS_RELEASE_STORE" --id "$ODS_RELEASE_ID" \
  --expect CURRENT_GENERATION --reason "Activate received Huwise edition"

node "$ODS_SOURCE_ROOT/sf82-seller-pilot/release-cli.mjs" run \
  --store "$ODS_RELEASE_STORE" --expect GENERATION_AFTER_ACTIVATION
~~~

Use the generations returned by the original status and activation operations. The running service prints its actual loopback address. Its health and current offer identify the selected service mode and payment alternatives.

Keep the public HTTPS origin and resource from this package's manifest when configuring the existing merchant deployment. Loopback is the local service address; the manifest resource is the URL advertised to customers.

## 5. Read the actual customer offer

Set the running seller address printed by the original seller and the first-page query for the published dataset:

~~~sh
export ODS_SELLER=http://127.0.0.1:8423
export ODS_QUERY='where_country=United%20States&limit=250'
~~~

Use only fields and query parameters advertised by this package's original dataset policy. The example assumes an exposed country equality filter. The upstream Huwise Explore service uses ODSQL where expressions; the published dataset uses parameters such as where_country. The page size must fit this dataset's retained maximum.

Read the existing seller's health and offer through the native handoff:

~~~sh
node --input-type=module <<'JS'
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = await realpath(process.env.ODS_SOURCE_ROOT);
const { readOpendatasoftMerchantBuyerOffer } = await import(pathToFileURL(
  join(root, 'sf30-seller-sdk/opendatasoft/publisher/release.mjs')).href);
const offer = await readOpendatasoftMerchantBuyerOffer({
  packageDirectory: process.env.ODS_PACKAGE,
  expectedManifestSha256: process.env.ODS_MANIFEST_SHA256,
  seller: process.env.ODS_SELLER,
  query: process.env.ODS_QUERY ?? ''
});
console.log(JSON.stringify(offer, null, 2));
JS
~~~

The returned offer records the exact resource, snapshot, selected URL, advertised payment alternatives and offerSha256. Review the actual amount, network, asset, pay-to address, timeout and selected alternative before preparing the customer configuration.

## 6. Prepare and continue one buyer intent

Use one buyer intent ID for this operation and the advertised alternative's zero-based index. Set ODS_OFFER_SHA256 from the offer just read:

~~~sh
export ODS_INTENT_ID=received-opendatasoft-customer-001
export ODS_ACCEPT_INDEX=0
export ODS_OFFER_SHA256=ACTUAL_OFFER_SHA256
export ODS_BUYER_CONFIG=/absolute/private/opendatasoft-buyer.json

node --input-type=module <<'JS'
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = await realpath(process.env.ODS_SOURCE_ROOT);
const { prepareOpendatasoftMerchantBuyer } = await import(pathToFileURL(
  join(root, 'sf30-seller-sdk/opendatasoft/publisher/release.mjs')).href);
const prepared = await prepareOpendatasoftMerchantBuyer({
  packageDirectory: process.env.ODS_PACKAGE,
  expectedManifestSha256: process.env.ODS_MANIFEST_SHA256,
  seller: process.env.ODS_SELLER,
  query: process.env.ODS_QUERY ?? '',
  intentId: process.env.ODS_INTENT_ID,
  acceptIndex: Number(process.env.ODS_ACCEPT_INDEX),
  offerSha256: process.env.ODS_OFFER_SHA256,
  out: process.env.ODS_BUYER_CONFIG
});
console.log(JSON.stringify({
  path: prepared.path,
  configSha256: prepared.configSha256,
  offerSha256: prepared.offerSha256,
  snapshot: prepared.snapshot,
  url: prepared.url,
  mode: prepared.mode
}, null, 2));
JS
~~~

Preparation rereads the seller and binds the exact reviewed offer, snapshot, query and intent. The output is an original SF88 configuration saved with create-only semantics.

Review the prepared configuration with the original buyer:

~~~sh
node "$ODS_SOURCE_ROOT/sf88-operator-buyer-cli/cli.mjs" --review \
  --config "$ODS_BUYER_CONFIG"
~~~

Continue through the existing SF88 operator, spending policy, signer and receiving workspace. The original buyer keeps the same intent and saved operation. For a new native testnet customer workspace, use the prepared configuration and the customer's existing public payer address:

~~~sh
export ODS_BUYER_WORKSPACE=/absolute/private/opendatasoft-customer
node "$ODS_SOURCE_ROOT/sf88-operator-buyer-cli/cli.mjs" --init-workspace \
  --config "$ODS_BUYER_CONFIG" --dir "$ODS_BUYER_WORKSPACE" \
  --actor ACTUAL_OPERATOR_ID --service ACTUAL_MERCHANT_SERVICE_ID \
  --payer ACTUAL_EXISTING_TESTNET_PUBLIC_ADDRESS --python /usr/bin/python3 \
  --total-atomic REVIEWED_TOTAL_BASE_UNITS --daily-atomic REVIEWED_DAILY_BASE_UNITS

node "$ODS_SOURCE_ROOT/sf88-operator-buyer-cli/cli.mjs" \
  --review-workspace --dir "$ODS_BUYER_WORKSPACE"
node "$ODS_SOURCE_ROOT/sf88-operator-buyer-cli/cli.mjs" \
  --diagnose-workspace --dir "$ODS_BUYER_WORKSPACE"
~~~

Use the chosen payment network's existing operator setup. The default initializer in the example uses testnet. The installed sf88-operator-buyer-cli/MAINNET.md describes the original mainnet workspace. An established customer workspace retains its existing ledger and signer; reopen it through the original workflow instead of initializing over it. The installed sf88-operator-buyer-cli/README.md describes the existing signer-provider option and private wallet-variable setup.

For the complete dataset, create one original dataset session with explicit page, row and total-payment limits. Set the snapshot to the selected manifest's dataset.snapshot:

~~~sh
export ODS_DATASET_SESSION=/absolute/private/opendatasoft-dataset-session
node "$ODS_SOURCE_ROOT/sf88-operator-buyer-cli/dataset-cli.mjs" init \
  --session "$ODS_DATASET_SESSION" --workspace "$ODS_BUYER_WORKSPACE" \
  --max-pages REVIEWED_MAXIMUM_PAGES \
  --max-total-atomic REVIEWED_TOTAL_BASE_UNITS \
  --max-rows REVIEWED_MAXIMUM_ROWS --snapshot SELECTED_DATASET_SNAPSHOT

node "$ODS_SOURCE_ROOT/sf88-operator-buyer-cli/dataset-cli.mjs" run \
  --session "$ODS_DATASET_SESSION" --workspace "$ODS_BUYER_WORKSPACE"
node "$ODS_SOURCE_ROOT/sf88-operator-buyer-cli/dataset-cli.mjs" status \
  --session "$ODS_DATASET_SESSION"
~~~

Run from the original operator terminal so the existing per-page payment review is available. The dataset session follows returned continuations and retains each delivered page with its payment outcome. Payment applies per requested page; the total cap must cover the reviewed whole result.

After completion, hand over the assembled original dataset:

~~~sh
node "$ODS_SOURCE_ROOT/sf88-operator-buyer-cli/dataset-cli.mjs" export \
  --session "$ODS_DATASET_SESSION" --out /absolute/private/dataset-manifest.json
node "$ODS_SOURCE_ROOT/sf88-operator-buyer-cli/dataset-cli.mjs" deliver \
  --session "$ODS_DATASET_SESSION" --out /absolute/private/dataset-data-room
~~~

After an interruption, the same dataset-cli recover --session command reconciles the retained session before the original run resumes. Its accounting and finalize commands continue the recorded original purchases.

If this handoff already includes a buyer configuration and retained operation directory, reopen that same operation. Downloading an existing configuration from the research workspace retains its original intent and offer binding.

## 7. Open the complete source edition for research

The capture directory can be received independently of merchant activation. The following CLI reads its original manifest and creates a new research project on the same portal:

~~~sh
node "$ODS_SOURCE_ROOT/sf30-seller-sdk/opendatasoft/cli.mjs" inspect-capture \
  --capture "$ODS_PACKAGE/capture/capture.json"

node "$ODS_SOURCE_ROOT/sf30-seller-sdk/opendatasoft/cli.mjs" init \
  --project /absolute/private/received-ods-project \
  --origin PORTAL_ORIGIN_FROM_CAPTURE

node "$ODS_SOURCE_ROOT/sf30-seller-sdk/opendatasoft/cli.mjs" import \
  --project /absolute/private/received-ods-project \
  --capture "$ODS_PACKAGE/capture/capture.json"

node "$ODS_SOURCE_ROOT/sf30-seller-sdk/opendatasoft/cli.mjs" serve \
  --project /absolute/private/received-ods-project --port 0
~~~

Use capture.catalogOrigin from the inspected merchant manifest as PORTAL_ORIGIN_FROM_CAPTURE. For an existing project on that portal, use its current directory and import there. Import recognizes an already retained identical capture.

Open the printed workspace URL to inspect every original row, native field, geographic value and source right. Saved edition and row notes travel with the workspace's complete JSON, HTML and GeoJSON reports. The merchant's original capture remains unchanged. CSV exports use JSON value cells to preserve source nulls, empty text and structured values.

Refreshes create a new source edition. Compare the complete editions with a verified unique original key, review the new projection and publish through the same dataset pipeline.

## 8. Preserve and recover the receiving work

Keep the complete dataset archive, expected manifest SHA-256 and handler SHA-256 with the runtime distribution identity. The seller release store retains its copied package, selected generation and runtime configuration. The buyer keeps its exact configuration, original operation directory, response files and settlement state.

After an interruption, inspect the existing seller status and original buyer operation before continuing them. Resume an interrupted runtime installation in its original install directory. Receiving research uses the same project and capture identities. The original components supply recovery and rollback for their retained state.

## Maintained source references

The installed distribution contains the source files these instructions call. Their public repository paths are:

- [Opendatasoft merchant export and receiving functions](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/publisher/release.mjs)
- [Original seller release commands](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs)
- [Original dataset buyer handoff](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/buyer-handoff.mjs)
- [Runtime installation and recovery](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)
- [Complete browser operating guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/workspace/WORKSPACE.md)
