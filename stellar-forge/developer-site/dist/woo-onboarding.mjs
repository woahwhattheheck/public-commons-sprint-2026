// MIT. Browser-local preparation for the original SF104 WooCommerce tools.
// Imported route exports retain their original bytes; native seller.mjs is the
// final compiler. This module creates no order, signature or payment.
export const WOO_DRAFT_SCHEMA = 'stellar-forge.frontdoor-woo.v1';
export const WOO_PACKET_SCHEMA = 'stellar-forge.frontdoor-woo-packet.v1';
export const WOO_SOURCE = 'stellar/scf-starforge-20261009';
export const WOO_GUIDE = 'https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/' + WOO_SOURCE + '/sf104-woocommerce-merchant-bridge/GATEWAY.md';
const ENDPOINT = '/wp-json/stellar-forge/v1/checkout-admission';
const MAX_BYTES = 262144;
const I128 = 170141183460469231731687303715884105727n;
const encoder = new TextEncoder();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));

export class WooSetupError extends Error {
  constructor(errors) { super(errors[0]?.message || 'Complete the WooCommerce setup.'); this.name = 'WooSetupError'; this.errors = errors; }
}

export function publicHttps(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) return null;
  let url; try { url = new URL(value); } catch { return null; }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
    (url.port && url.port !== '443') || !host.includes('.') || /^[0-9.]+$/.test(host) ||
    host.length > 253 || !host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
    ['localhost','local','localdomain','internal','home.arpa'].some(name => host === name || host.endsWith('.' + name))) return null;
  return url;
}

export function readRoute(text, label = 'Route export') {
  const fail = message => { throw new WooSetupError([{field:'routes', message:label + ': ' + message}]); };
  if (typeof text !== 'string' || !text.length || encoder.encode(text).length > MAX_BYTES) fail('choose a nonempty JSON export smaller than 256 KiB.');
  let route; try { route = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { fail('the file is not valid JSON.'); }
  if (!keys(route, ['productId','routeId','url','method','expect','description'])) fail('use the saved product route export, not an order handoff, wallet or merchant configuration.');
  if (typeof route.productId !== 'string' || !/^[1-9][0-9]{0,17}$/.test(route.productId) ||
    typeof route.routeId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(route.routeId)) fail('the saved product ID and route ID are required.');
  const url = publicHttps(route.url);
  if (!url || url.search || url.href.endsWith('?') || url.href !== route.url || !['GET','HEAD'].includes(route.method)) fail('the resource must be the exact saved HTTPS GET or HEAD URL without order query parameters.');
  const terms = route.expect;
  if (!keys(terms, ['scheme','network','asset','payTo','maxAtomic','maxTimeoutSeconds']) ||
    terms.scheme !== 'exact' || !['stellar:testnet','stellar:pubnet'].includes(terms.network)) fail('exact Stellar payment terms are required.');
  if (typeof terms.asset !== 'string' || !/^C[A-Z2-7]{55}$/.test(terms.asset) ||
    typeof terms.payTo !== 'string' || !/^[GC][A-Z2-7]{55}$/.test(terms.payTo)) fail('use the asset contract and recipient saved in the Woo product.');
  if (typeof terms.maxAtomic !== 'string' || !/^[1-9][0-9]*$/.test(terms.maxAtomic) ||
    terms.maxAtomic.length > 39 || BigInt(terms.maxAtomic) > I128) fail('the native amount must be a positive decimal integer within i128.');
  if (!Number.isInteger(terms.maxTimeoutSeconds) || terms.maxTimeoutSeconds < 1 || terms.maxTimeoutSeconds > 86400) fail('the payment timeout must be 1–86400 seconds.');
  if (route.description !== undefined && (typeof route.description !== 'string' || route.description.length > 4096)) fail('the product description must be text.');
  return route;
}

export const DEFAULT_WOO_SETUP = Object.freeze({schema:WOO_DRAFT_SCHEMA, folder:'woo-merchant',
  storeOrigin:'', admissionUrl:'', facilitatorUrl:'', privateDirectory:'', routes:[]});

export function validateWooSetup(input) {
  const errors = [], add = (field, message) => errors.push({field,message});
  if (!keys(input, ['schema','folder','storeOrigin','admissionUrl','facilitatorUrl','privateDirectory','routes']) || input.schema !== WOO_DRAFT_SCHEMA)
    return {valid:false, errors:[{field:'import',message:'Choose a Stellar Forge Woo setup draft.'}]};
  if (typeof input.folder !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input.folder)) add('folder', 'Use a packet folder name with letters, numbers, hyphens or underscores.');
  const store = publicHttps(input.storeOrigin);
  if (!store || store.pathname !== '/' || store.search || ![store.origin,store.origin + '/'].includes(input.storeOrigin)) add('storeOrigin', 'Enter the public HTTPS shop origin without a path, for example https://shop.example.com.');
  const admission = publicHttps(input.admissionUrl || (store ? store.origin + ENDPOINT : ''));
  if (!admission || !store || admission.origin !== store.origin || admission.search ||
    !admission.pathname.endsWith(ENDPOINT)) add('admissionUrl', 'Use the shop’s exact same-origin /wp-json/stellar-forge/v1/checkout-admission URL. Include its WordPress subdirectory when needed.');
  const facilitator = publicHttps(input.facilitatorUrl);
  if (!facilitator || facilitator.search || facilitator.href.endsWith('?')) add('facilitatorUrl', 'Enter the actual configured facilitator HTTPS URL without credentials or a query string.');
  if (typeof input.privateDirectory !== 'string' || !input.privateDirectory.startsWith('/') || input.privateDirectory.length > 1024 ||
    /[\x00-\x1f\x7f]/.test(input.privateDirectory) || input.privateDirectory.slice(1).split('/').some(part => !part || part === '.' || part === '..'))
    add('privateDirectory', 'Choose a new absolute Linux directory outside the shop’s public files. No trailing slash or dot segments.');
  const routes = [], products = new Set(), ids = new Set(), requests = new Set(), origins = new Set();
  let totalBytes = 0;
  if (!Array.isArray(input.routes) || input.routes.length < 1 || input.routes.length > 64) add('routes', 'Import 1–64 route JSON files exported from saved Woo products.');
  else for (let index = 0; index < input.routes.length; index++) {
    const file = input.routes[index];
    if (!keys(file, ['name','text']) || typeof file.name !== 'string' || file.name.length > 255) { add('routes', 'Choose a named route export.'); continue; }
    try {
      const route = readRoute(file.text, file.name), request = route.method + ' ' + route.url;
      if (products.has(route.productId) || ids.has(route.routeId) || requests.has(request)) add('routes', `Product ${route.productId}: each product, route ID and method/URL must appear only once.`);
      products.add(route.productId); ids.add(route.routeId); requests.add(request); origins.add(new URL(route.url).origin);
      totalBytes += encoder.encode(file.text).length; routes.push({route, text:file.text, name:file.name});
    } catch (error) { errors.push(...error.errors); }
  }
  if (origins.size > 1) add('routes', 'All saved products in one merchant service must use the same seller HTTPS origin.');
  if (totalBytes > MAX_BYTES) add('routes', 'Keep the combined route exports within 256 KiB.');
  return {valid:errors.length === 0, errors, routes, storeOrigin:store?.origin,
    admissionUrl:admission?.href, settlementUrl:admission?.href.replace(/checkout-admission$/, 'settlement'),
    facilitatorUrl:facilitator?.href, sellerOrigin:[...origins][0], totalBytes};
}

export function importWooDraft(text) {
  if (typeof text !== 'string' || encoder.encode(text).length > 524288) throw new WooSetupError([{field:'import',message:'Choose a Woo setup draft smaller than 512 KiB.'}]);
  let input; try { input = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new WooSetupError([{field:'import',message:'The setup draft is not valid JSON.'}]); }
  if (!keys(input, ['schema','folder','storeOrigin','admissionUrl','facilitatorUrl','privateDirectory','routes']) || input.schema !== WOO_DRAFT_SCHEMA ||
    !Array.isArray(input.routes) || input.routes.length > 64 || input.routes.some(file => !keys(file, ['name','text']) || typeof file.name !== 'string' || typeof file.text !== 'string'))
    throw new WooSetupError([{field:'import',message:'Choose an exported Woo setup-input.json. Product settings and order handoffs have different formats.'}]);
  for (const field of ['folder','storeOrigin','admissionUrl','facilitatorUrl','privateDirectory']) if (typeof input[field] !== 'string')
    throw new WooSetupError([{field:'import',message:`The draft is missing ${field}.`}]);
  return structuredClone(input);
}

const shell = value => "'" + value.replace(/'/g, "'\\''") + "'";

function merchantGuide(input, value) {
  return `# WooCommerce merchant setup

This packet uses the original SF104 seller and buyer, original SF88 workspace
and original SF98 delivery worker. It contains your saved public route exports
and local setup choices. Preparing it creates no order or payment.

## 1. Use the complete original toolkit

Use Node.js 22.16+, Linux with util-linux flock, and the original native SDK
dependencies. Select a maintained source checkout or the root of the installed
@tokenjunkielabs/starforge-merchant source package. The runner accepts either
layout and checks that the complete Woo plugin and native entrypoints exist.
Older packages missing SF104 must be upgraded through the maintained
distribution; this packet does not install a replacement payment engine.

Distribution: https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/${WOO_SOURCE}/distribution/README.md
Native dependencies: https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/${WOO_SOURCE}/sf88-operator-buyer-cli/NATIVE_SIGNER.md

From this extracted packet:

\`\`\`sh
TOOLKIT=/absolute/path/to/checkout-or-installed-package
node merchant.mjs prepare --toolkit "$TOOLKIT"
node merchant.mjs inspect --toolkit "$TOOLKIT"
\`\`\`

Preparation validates the actual routes through the original seller compiler,
creates ${shell(input.privateDirectory)} as a NEW private directory, writes
merchant.json and copies the complete original plugin and its operating guide without editing them.
It refuses an existing directory. Inspect and later commands reuse that same
configuration and outbox. Keep this packet for normal startup and recovery.

## 2. Install and configure the original Woo plugin

The prepared directory contains wordpress-plugin/starforge-sf98-woo/ with
the original receiver, checkout/admission, merchant-console PHP/JS/CSS,
merchant-operator.php, merchant-refunds PHP/JS/CSS, refund-networks.json,
OPERATIONS.md, NATIVE_REVIEW.md and REFUNDS.md. Copy all 14 files in that folder
to the shop's wp-content/plugins using its ordinary deployment
process. Alternatively zip that single folder and use WordPress Upload Plugin.
Activate Starforge SF98 WooCommerce Merchant Bridge. PHP 8.0+, WooCommerce and
real MySQL/MariaDB named locks are required. HPOS is supported.

WordPress reads the PHP CONSTANT SF98_WEBHOOK_SECRET. Define it in wp-config.php
from the merchant’s private key, for example from the private PHP environment:

\`\`\`php
define('SF98_WEBHOOK_SECRET', (string) getenv('SF98_WEBHOOK_SECRET'));
\`\`\`

Provide that SAME private 32–1024-byte value as the SF98_WEBHOOK_SECRET
environment variable in both Node services. Merely setting a PHP-FPM environment
variable without defining the constant does not configure the plugin. The key
never belongs in this packet, product JSON, command arguments or a public folder.
Enable the Stellar Forge native checkout gateway in WooCommerce Payments.

Each imported file must come from THIS shop's saved simple virtual product.
The product declares its exact storefront currency/total and native atomic
amount separately; no exchange rate is calculated. One mapped product, qty 1,
per checkout; no mixed cart, coupons, shipping, fees or variation. Any
applicable tax must preserve the deliberately mapped final total. Upload a
private downloadable file through ordinary Woo settings when applicable.
Keep the saved price/native mapping unchanged for an order already created.
Export the route again if configuring a different product or seller.

Full original guide: ${WOO_GUIDE}

## 3. Connect the existing HTTPS ingress

Shop origin: ${value.storeOrigin}
Admission: ${value.admissionUrl}
Settlement receiver: ${value.settlementUrl}
Seller origin: ${value.sellerOrigin}
Facilitator: ${value.facilitatorUrl}

Enable WordPress pretty permalinks and server rewrites for the actual REST
routes. Preserve original request bytes and x-sf98-timestamp / x-sf98-signature.
The unsigned preflight below sends only {} and expects the plugin's 401 JSON
INVALID_SIGNATURE_OR_TIMESTAMP response. It creates no order or reservation.
This checks routing, not whether the shared key matches between the store and
services.

\`\`\`sh
node merchant.mjs preflight --toolkit "$TOOLKIT"
\`\`\`

The native seller listens on loopback 8423. Point the seller's existing HTTPS
ingress at it and preserve the exact exported path, method and order query.
Keep the operations interface on loopback 8424/private operator access.

## 4. Run the seller and the original delivery service

With SF98_WEBHOOK_SECRET set privately in each process environment, start two
foreground processes under the existing merchant service account:

\`\`\`sh
node merchant.mjs serve --toolkit "$TOOLKIT"
# In a second terminal:
node merchant.mjs deliver --toolkit "$TOOLKIT"
# In an operator terminal:
node merchant.mjs status --toolkit "$TOOLKIT"
\`\`\`

serve uses the original native facilitator and SF30 seller. deliver runs the
original continuous SF98 worker against the SAME outbox and shop receiver.
Ctrl-C/SIGTERM stops each original process; restart with this same packet,
private directory, key and journals. Do not run a second sender against its
active outbox. The original SERVICE.md supplies normal systemd installation.

## 5. Complete a customer order

A real classic or Blocks checkout creates an unpaid on-hold order. The buyer
downloads its private handoff from the order page, then follows BUYER.md with
the original native buyer. The JSON binds shop/order/product/generation and
exact terms; it contains no Woo order key. The store checks the still-current
order before native verification and reserves one verified attempt before
settlement. No timer silently unlocks it.

After native settlement, the original signed worker sends its durable notice.
WordPress retains it for merchant review; an accepted webhook alone does not
release the file. In WooCommerce → Stellar Forge delivery, independently
reconcile the actual order/payment, then use the original release action once.
Woo's own payment completion and downloadable permission grant the file.

For an uncertain/failed attempt, reconcile the original native result first.
Only a merchant-attested non-settlement reset advances the attempt generation.
The buyer downloads the newly available handoff and uses the SAME original
workspace, budget ledger and inbox. Old attempts remain retained. See BUYER.md.

## Verified order credits

For a verified merchant refund, use the original accounting workspace's exported
adjustments.json and the installed plugin's REFUNDS.md. Keep its original bytes.
The native reverse transfer amount and chosen order-currency credit remain explicit.
The packet forwards the original refund CLI with the existing merchant operator
configuration:

\`\`\`sh
node merchant.mjs refund --toolkit "$TOOLKIT" -- inspect --config /private/woo-operator.json --order 123
node merchant.mjs refund --toolkit "$TOOLKIT" -- prepare --config /private/woo-operator.json --adjustments /private/adjustments.json --adjustment UUID --order 123 --woo-amount 4.25
node merchant.mjs refund --toolkit "$TOOLKIT" -- apply --config /private/woo-operator.json --adjustment UUID --confirm-order 123
node merchant.mjs refund --toolkit "$TOOLKIT" -- recover --config /private/woo-operator.json --adjustment UUID
\`\`\`

Replace UUID and the example order/credit with the actual saved adjustment and
reviewed store allocation. The operation records an amount-only Woo credit through
native refund hooks. A full refunded order can lose download access through its
native order status; item restock decisions remain in the merchant's Woo workflow.

## Files and updates

setup-input.json reopens this preparation in the developer Site. routes/ keeps
the exact source bytes imported there. setup.json records only public merchant
configuration and the chosen private directory. merchant.mjs forwards the
original CLI with argument arrays and inherits its normal terminal approval.
No wallet, signer, customer handoff or HMAC key belongs in this setup packet.

A later route import or different setup packet does not migrate existing orders,
terms, outbox or ledgers. Use the original merchant upgrade/reconciliation
procedure and an explicitly new configuration when changing routes.
`;
}

function buyerGuide() {
  return `# Use the original buyer for a Woo order

Keep the downloaded order handoff private. Choose the toolkit on the BUYER's
own machine; no merchant key or WordPress order key is entered in this Site.
The forwarding commands below call the original SF104, SF88 and queue CLI.

## First order: inspect, prepare, review

\`\`\`sh
TOOLKIT=/absolute/path/to/checkout-or-installed-package
node merchant.mjs buyer --toolkit "$TOOLKIT" -- inspect \\
  --handoff /private/woo-order.json
node merchant.mjs buyer --toolkit "$TOOLKIT" -- prepare \\
  --handoff /private/woo-order.json --out /private/woo-review.json
node merchant.mjs operator --toolkit "$TOOLKIT" -- \\
  --review --config /private/woo-review.json
\`\`\`

Inspect the exact operation.intentId printed by prepare. It is bound to the
shop, order and merchant-approved attempt generation. Reimporting that same
handoff does not create another payment identity.

Initialize the ORIGINAL private workspace for those exact terms. Choose the
existing payer public address on the handoff's selected network. Both
stellar:testnet and explicitly selected stellar:pubnet are supported; a saved
workspace's network cannot be switched. Follow NATIVE_SIGNER.md / MAINNET.md
for the existing wallet's secret environment or external signer provider.

\`\`\`sh
node merchant.mjs operator --toolkit "$TOOLKIT" -- \\
  --init-workspace --config /private/woo-review.json \\
  --dir /private/woo-operator --actor owner-operator \\
  --service woo-merchant --payer ACTUAL_EXISTING_PUBLIC_PAYER \\
  --python /usr/bin/python3 --secret-env EXISTING_WALLET_SECRET_ENV
node merchant.mjs operator --toolkit "$TOOLKIT" -- \\
  --review-workspace --dir /private/woo-operator
node merchant.mjs operator --toolkit "$TOOLKIT" -- \\
  --diagnose-workspace --dir /private/woo-operator

# Initialize once; retain the same inbox thereafter.
node merchant.mjs queue --toolkit "$TOOLKIT" -- init --root /private/woo-inbox
node merchant.mjs queue --toolkit "$TOOLKIT" -- enqueue \\
  --root /private/woo-inbox --config /private/woo-operator/operator.json

# Set INTENT to the exact full operation.intentId printed by prepare.
node merchant.mjs queue --toolkit "$TOOLKIT" -- show \\
  --root /private/woo-inbox --intent "$INTENT"
node merchant.mjs queue --toolkit "$TOOLKIT" -- execute \\
  --root /private/woo-inbox --intent "$INTENT" --workspace /private/woo-operator
node merchant.mjs queue --toolkit "$TOOLKIT" -- finalize \\
  --root /private/woo-inbox --intent "$INTENT" --workspace /private/woo-operator
\`\`\`

Execution retains original interactive approval, durable budget reservation,
native signing and the exact live offer. Native finalization/accounting and
merchant delivery review remain separate original steps. Inspect the actual
result before proceeding; a command returning is not proof of delivery.

## Second order or merchant-approved recovery

The merchant must independently establish non-settlement before using the
original Woo attempt reset. That reset advances the generation while keeping
the original order terms. It does not clear the buyer's prior budget reservation.
Reconcile the original buyer outcome/ledger before authorizing another attempt.

Download the current handoff. Reuse the original workspace and inbox:

\`\`\`sh
node merchant.mjs buyer --toolkit "$TOOLKIT" -- prepare \\
  --handoff /private/current-woo-order.json --workspace /private/woo-operator \\
  --out /private/current-woo-inbox-config.json
node merchant.mjs operator --toolkit "$TOOLKIT" -- \\
  --review --config /private/current-woo-inbox-config.json
node merchant.mjs queue --toolkit "$TOOLKIT" -- enqueue \\
  --root /private/woo-inbox --config /private/current-woo-inbox-config.json
# Set INTENT to the new exact identity, including its current generation.
node merchant.mjs queue --toolkit "$TOOLKIT" -- show \\
  --root /private/woo-inbox --intent "$INTENT"
node merchant.mjs queue --toolkit "$TOOLKIT" -- execute \\
  --root /private/woo-inbox --intent "$INTENT" --workspace /private/woo-operator
node merchant.mjs queue --toolkit "$TOOLKIT" -- finalize \\
  --root /private/woo-inbox --intent "$INTENT" --workspace /private/woo-operator
\`\`\`

Original workspace import enforces matching scheme/network/asset/recipient,
amount caps and transport origin. New orders do not replace its signer, wallet,
policy or evidence. Do not create another ledger to bypass a retained attempt.
A completed merchant release enables the normal Woo order/download page.

Original operating guide: ${WOO_GUIDE}
Native signer: https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/${WOO_SOURCE}/sf88-operator-buyer-cli/NATIVE_SIGNER.md
Explicit pubnet setup: https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/${WOO_SOURCE}/sf88-operator-buyer-cli/MAINNET.md
Accounting/recovery: https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/${WOO_SOURCE}/sf88-operator-buyer-cli/FINALIZATION.md
`;
}

function requireRunner(runnerSource) {
  if (typeof runnerSource !== 'string' || !runnerSource.includes('stellar-forge.frontdoor-woo-packet.v1') || runnerSource.length > 65536)
    throw new WooSetupError([{field:'export',message:'The setup runner could not load. Reload this page and export again.'}]);
}

export function createWooPluginPacket(runnerSource) {
  requireRunner(runnerSource);
  const guide = `# Prepare the original WooCommerce plugin

Use this before creating the saved product route needed by the merchant setup
page. Select the maintained original source checkout or installed source-package
root with Node.js 22.16+. An older archive without SF104 must be upgraded through
the maintained distribution. No merchant configuration or wallet is needed.

From this extracted directory:

\`\`\`sh
TOOLKIT=/absolute/path/to/checkout-or-installed-package
node merchant.mjs plugin --toolkit "$TOOLKIT" --out /private/new-plugin-files
\`\`\`

The command copies the exact original receiver, checkout/admission files,
merchant-console PHP/JS/CSS, merchant-operator.php, merchant-refunds PHP/JS/CSS,
refund-networks.json and all three operating guides into the new output directory's
starforge-sf98-woo folder. It makes no network request or store change.
Copy that folder to WordPress wp-content/plugins using the shop's normal
deployment process, or zip the folder and use WordPress Upload Plugin.
Activate Starforge SF98 WooCommerce Merchant Bridge. Open WooCommerce → Stellar
merchant operations for native orders, payment review and verified order credits.
Retain all 14 delivered files when upgrading an existing plugin. REFUNDS.md covers
partial/full monetary credits from the original verified accounting adjustments,
explicit store amounts and recovery of the same saved native refund.

The original plugin requires WooCommerce, PHP 8.0+ and actual MySQL/MariaDB
named locks. Define SF98_WEBHOOK_SECRET as a PHP constant in wp-config.php from
the existing private 32–1024-byte key. For a private PHP environment variable:

\`\`\`php
define('SF98_WEBHOOK_SECRET', (string) getenv('SF98_WEBHOOK_SECRET'));
\`\`\`

The native seller and original SF98 delivery worker later need that same value
in their SF98_WEBHOOK_SECRET environment. No private value belongs in this ZIP.

In WooCommerce, create the actual simple virtual product (optionally
downloadable), set its actual storefront currency/total, then save its exact
Stellar Forge route, GET/HEAD method, network, asset contract, recipient,
atomic amount and timeout. The mapping declares the native price directly;
no exchange rate is calculated. Enable the native gateway in Payments.
Use Download saved merchant route on the saved product.

Return to /woo.html in the original developer Site, import those route exports,
review the actual shop/facilitator/service directory and download the complete
merchant setup packet. That packet runs the original seller, worker and buyer
workflow and explains merchant review, file release and same-ledger recovery.

Original integration: ${WOO_GUIDE}
Maintained distribution: https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/${WOO_SOURCE}/distribution/README.md
`;
  return {files:[{path:'woo-plugin/merchant.mjs',content:runnerSource},
    {path:'woo-plugin/INSTALL.md',content:guide},{path:'woo-plugin/.gitignore',content:'*\n'}]};
}

export function createWooPacket(input, runnerSource) {
  const value = validateWooSetup(input);
  if (!value.valid) throw new WooSetupError(value.errors);
  requireRunner(runnerSource);
  const root = input.folder + '/';
  const routes = value.routes.map(({route,text}) => ({path:`routes/product-${route.productId}.json`,route,text}));
  const config = {schema:WOO_PACKET_SCHEMA, storeOrigin:value.storeOrigin, admissionUrl:value.admissionUrl,
    settlementUrl:value.settlementUrl, facilitatorUrl:value.facilitatorUrl,
    privateDirectory:input.privateDirectory, routes:routes.map(({path}) => path)};
  const files = routes.map(({path,text}) => ({path:root + path, content:text}));
  files.push({path:root + 'setup.json',content:JSON.stringify(config,null,2) + '\n'},
    {path:root + 'setup-input.json',content:JSON.stringify(input,null,2) + '\n'},
    {path:root + 'merchant.mjs',content:runnerSource},
    {path:root + 'README.md',content:merchantGuide(input,value)},
    {path:root + 'BUYER.md',content:buyerGuide()},
    {path:root + '.gitignore',content:'*\n'});
  return {files, config, summary:{folder:input.folder, routeCount:routes.length, routes:routes.map(({route}) => route),
    sellerOrigin:value.sellerOrigin, storeOrigin:value.storeOrigin, admissionUrl:value.admissionUrl,
    settlementUrl:value.settlementUrl, facilitatorUrl:value.facilitatorUrl, privateDirectory:input.privateDirectory}};
}
