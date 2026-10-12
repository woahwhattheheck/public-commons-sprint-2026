// MIT. Browser-local preparation for the original SF104 WooCommerce tools.
// Imported route exports retain their original bytes; native seller.mjs is the
// final compiler. This module creates no order, signature or payment.
export const WOO_DRAFT_SCHEMA = 'stellar-forge.frontdoor-woo.v2';
const LEGACY_WOO_DRAFT_SCHEMA = 'stellar-forge.frontdoor-woo.v1';
export const WOO_PACKET_SCHEMA = 'stellar-forge.frontdoor-woo-packet.v2';
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

export const WOO_CATALOG_SCHEMA = 'stellar-forge.sf104.basket-catalog.v1';
const EXPORT_TOTAL_BYTES = 1048576;
const DRAFT_BYTES = 4194304;
const canonicalCatalogValue = value => Array.isArray(value) ? value.map(canonicalCatalogValue)
  : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonicalCatalogValue(value[key])])) : value;

export function readBasketCatalog(text, label = 'Basket catalog') {
  const fail = message => { throw new WooSetupError([{field:'catalogs',message:label + ': ' + message}]); };
  if (typeof text !== 'string' || !text.length || encoder.encode(text).length > MAX_BYTES) fail('choose a nonempty catalog export within 256 KiB.');
  let catalog; try { catalog = JSON.parse(text.replace(/^\uFEFF/,'')); } catch { fail('the file is not valid JSON.'); }
  const required = ['schema','storeOrigin','routeId','url','method','limits','products','catalogDigest'];
  if (!keys(catalog,required) || !required.every(key => Object.hasOwn(catalog,key)) || catalog.schema !== WOO_CATALOG_SCHEMA)
    fail('use Download this exact basket catalog in the saved Woo gateway settings.');
  const shop = publicHttps(catalog.storeOrigin), resource = publicHttps(catalog.url);
  if (!shop || catalog.storeOrigin !== shop.origin || !resource || resource.search || resource.href.endsWith('?') ||
    resource.href !== catalog.url || !['GET','HEAD'].includes(catalog.method) ||
    typeof catalog.routeId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(catalog.routeId))
    fail('the saved shop origin and exact HTTPS basket endpoint are required.');
  if (!keys(catalog.limits,['maxLines','maxUnits']) || catalog.limits.maxLines !== 20 || catalog.limits.maxUnits !== 100)
    fail('use the original catalog with 20 lines and 100 units per order.');
  if (!Array.isArray(catalog.products) || !catalog.products.length || catalog.products.length > 64 ||
    typeof catalog.catalogDigest !== 'string' || !/^[a-f0-9]{64}$/.test(catalog.catalogDigest))
    fail('the original product list and catalog digest are required.');
  let previous, identity;
  for (const product of catalog.products) {
    if (!keys(product,['productId','name','storefront','expect']) ||
      typeof product.name !== 'string' || !product.name.length || product.name.length > 240 || /[\x00-\x1f\x7f]/.test(product.name) ||
      !keys(product.storefront,['currency','total']) || !/^[A-Z][A-Z0-9]{2,9}$/.test(product.storefront.currency ?? '') ||
      typeof product.storefront.total !== 'string' || !/^(0|[1-9][0-9]{0,17})(?:\.[0-9]{0,7}[1-9])?$/.test(product.storefront.total) ||
      /^0(?:\.0+)?$/.test(product.storefront.total))
      fail('every approved product needs its saved name, currency and positive canonical unit price.');
    try { readRoute(JSON.stringify({productId:product.productId,routeId:catalog.routeId,url:catalog.url,
      method:catalog.method,expect:product.expect}),label + ' / product ' + product.productId); }
    catch (error) { fail(error.message); }
    if (previous && (previous.length > product.productId.length ||
      previous.length === product.productId.length && previous >= product.productId))
      fail('the saved product IDs must be unique and ordered as exported.');
    previous = product.productId;
    const current = JSON.stringify([product.storefront.currency,product.expect.scheme,product.expect.network,product.expect.asset,product.expect.payTo]);
    if (identity && identity !== current) fail('all products in one catalog must retain one currency, network, asset and recipient.');
    identity = current;
  }
  return catalog;
}

export async function verifyBasketCatalog(text, label = 'Basket catalog') {
  const catalog = readBasketCatalog(text,label), body = structuredClone(catalog); delete body.catalogDigest;
  const bytes = encoder.encode(JSON.stringify(canonicalCatalogValue(body)));
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  const digest = [...hash].map(value => value.toString(16).padStart(2,'0')).join('');
  if (digest !== catalog.catalogDigest) throw new WooSetupError([{field:'catalogs',
    message:label + ': the catalog digest does not match its saved terms. Export the original catalog again.'}]);
  return catalog;
}

export async function verifyWooCatalogs(input) {
  for (const file of input.catalogs ?? []) await verifyBasketCatalog(file.text,file.name);
}

export const DEFAULT_WOO_SETUP = Object.freeze({schema:WOO_DRAFT_SCHEMA, folder:'woo-merchant',
  storeOrigin:'', admissionUrl:'', facilitatorUrl:'', privateDirectory:'', outboxDirectory:'', routes:[], catalogs:[]});

export function validateWooSetup(input) {
  const errors = [], add = (field,message) => errors.push({field,message});
  if (!keys(input,['schema','folder','storeOrigin','admissionUrl','facilitatorUrl','privateDirectory','outboxDirectory','routes','catalogs']) ||
    ![WOO_DRAFT_SCHEMA,LEGACY_WOO_DRAFT_SCHEMA].includes(input.schema))
    return {valid:false,errors:[{field:'import',message:'Choose a Stellar Forge Woo setup draft.'}]};
  if (typeof input.folder !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input.folder))
    add('folder','Use a packet folder name with letters, numbers, hyphens or underscores.');
  const store = publicHttps(input.storeOrigin);
  if (!store || store.pathname !== '/' || store.search || ![store.origin,store.origin + '/'].includes(input.storeOrigin))
    add('storeOrigin','Enter the public HTTPS shop origin without a path, for example https://shop.example.com.');
  const admission = publicHttps(input.admissionUrl || (store ? store.origin + ENDPOINT : ''));
  if (!admission || !store || admission.origin !== store.origin || admission.search || !admission.pathname.endsWith(ENDPOINT))
    add('admissionUrl','Use the shop’s exact same-origin /wp-json/stellar-forge/v1/checkout-admission URL. Include its WordPress subdirectory when needed.');
  const facilitator = publicHttps(input.facilitatorUrl);
  if (!facilitator || facilitator.search || facilitator.href.endsWith('?'))
    add('facilitatorUrl','Enter the actual configured facilitator HTTPS URL without credentials or a query string.');
  const privatePath = value => typeof value === 'string' && value.startsWith('/') && value.length <= 1024 &&
    !/[\x00-\x1f\x7f]/.test(value) && !value.slice(1).split('/').some(part => !part || part === '.' || part === '..');
  if (!privatePath(input.privateDirectory))
    add('privateDirectory','Choose a new absolute Linux directory outside the shop’s public files. No trailing slash or dot segments.');
  if (input.outboxDirectory !== undefined && input.outboxDirectory !== '' && (!privatePath(input.outboxDirectory) ||
    typeof input.privateDirectory === 'string' && (input.privateDirectory === input.outboxDirectory || input.privateDirectory.startsWith(input.outboxDirectory + '/'))))
    add('outboxDirectory','Select the existing absolute delivery outbox, with the new configuration directory outside it.');
  const routes = [], catalogs = [], products = new Set(), ids = new Set(), requests = new Set(), origins = new Set(), digests = new Set();
  let totalBytes = 0;
  if (!Array.isArray(input.routes) || input.routes.length > 64)
    add('routes','Import up to 64 saved product route JSON files.');
  else for (const file of input.routes) {
    if (!keys(file,['name','text']) || typeof file.name !== 'string' || file.name.length > 255) { add('routes','Choose a named route export.'); continue; }
    try {
      const route = readRoute(file.text,file.name), request = route.method + ' ' + route.url;
      if (products.has(route.productId) || ids.has(route.routeId) || requests.has(request))
        add('routes','Product ' + route.productId + ': each legacy product, route ID and method/URL must appear only once.');
      products.add(route.productId);ids.add(route.routeId);requests.add(request);origins.add(new URL(route.url).origin);
      totalBytes += encoder.encode(file.text).length; routes.push({route,text:file.text,name:file.name});
    } catch(error) { errors.push(...error.errors); }
  }
  const selectedCatalogs = input.catalogs ?? [];
  if (!Array.isArray(selectedCatalogs) || selectedCatalogs.length > 32)
    add('catalogs','Import up to 32 original basket catalog versions.');
  else for (const file of selectedCatalogs) {
    if (!keys(file,['name','text']) || typeof file.name !== 'string' || file.name.length > 255) { add('catalogs','Choose a named catalog export.'); continue; }
    try {
      const catalog = readBasketCatalog(file.text,file.name), first = catalogs[0]?.catalog;
      if (store && catalog.storeOrigin !== store.origin) add('catalogs','Every basket catalog must come from the configured shop.');
      if (digests.has(catalog.catalogDigest)) add('catalogs','That exact catalog version is already imported.');
      if (first && ['routeId','url','method'].some(key => first[key] !== catalog[key]))
        add('catalogs','Retained catalog versions must use the same basket route ID, endpoint and method.');
      if (ids.has(catalog.routeId) || routes.some(({route}) => new URL(route.url).pathname.toLowerCase() === new URL(catalog.url).pathname.toLowerCase()))
        add('catalogs','Use the distinct basket endpoint and route ID saved in Woo settings.');
      digests.add(catalog.catalogDigest);origins.add(new URL(catalog.url).origin);
      totalBytes += encoder.encode(file.text).length;catalogs.push({catalog,text:file.text,name:file.name});
    } catch(error) { errors.push(...error.errors); }
  }
  if (!routes.length && !catalogs.length) add('routes','Import a saved product route or a basket catalog from WooCommerce.');
  if (origins.size > 1) add('routes','All routes and catalog versions in one merchant service must use the same seller HTTPS origin.');
  if (totalBytes > EXPORT_TOTAL_BYTES) add('catalogs','Keep the combined original exports within 1 MiB.');
  return {valid:errors.length === 0,errors,routes,catalogs,storeOrigin:store?.origin,
    admissionUrl:admission?.href,settlementUrl:admission?.href.replace(/checkout-admission$/,'settlement'),
    facilitatorUrl:facilitator?.href,sellerOrigin:[...origins][0],totalBytes,
    outboxDirectory:input.outboxDirectory || input.privateDirectory + '/outbox'};
}

export function importWooDraft(text) {
  if (typeof text !== 'string' || encoder.encode(text).length > DRAFT_BYTES)
    throw new WooSetupError([{field:'import',message:'Choose a Woo setup draft within 4 MiB.'}]);
  let input;try { input = JSON.parse(text.replace(/^\uFEFF/,'')); }
  catch { throw new WooSetupError([{field:'import',message:'The setup draft is not valid JSON.'}]); }
  const fileList = (value,limit) => Array.isArray(value) && value.length <= limit &&
    value.every(file => keys(file,['name','text']) && typeof file.name === 'string' && typeof file.text === 'string');
  if (!keys(input,['schema','folder','storeOrigin','admissionUrl','facilitatorUrl','privateDirectory','outboxDirectory','routes','catalogs']) ||
    ![WOO_DRAFT_SCHEMA,LEGACY_WOO_DRAFT_SCHEMA].includes(input.schema) || !fileList(input.routes,64) ||
    !fileList(input.catalogs ?? [],32) || input.outboxDirectory !== undefined && typeof input.outboxDirectory !== 'string')
    throw new WooSetupError([{field:'import',message:'Choose an exported Woo setup-input.json with its original route and catalog bytes.'}]);
  for (const field of ['folder','storeOrigin','admissionUrl','facilitatorUrl','privateDirectory']) if (typeof input[field] !== 'string')
    throw new WooSetupError([{field:'import',message:'The draft is missing ' + field + '.'}]);
  return {...structuredClone(input),schema:WOO_DRAFT_SCHEMA,catalogs:input.catalogs ?? [],outboxDirectory:input.outboxDirectory ?? ''};
}

const shell = value => "'" + value.replace(/'/g, "'\\''") + "'";

function merchantProductGuide(value) {
  if (!value.catalogs.length) return [
    "Each imported route comes from this shop's saved simple virtual product.",
    "The declared storefront total and native atomic amount are explicit.",
    "A legacy checkout uses one mapped product at quantity one. Its existing",
    "route remains available for those original pending orders.",
    "Applicable tax must preserve the declared final amount. Save downloadable",
    "files through Woo's normal product settings and keep the frozen order terms.",
    "For multiple products or quantities, import the gateway's exact basket",
    "catalog here and follow its original BASKET.md.",
  ].join('\n');
  return [
    'This packet retains ' + value.catalogs.length + ' exact basket catalog version(s)',
    'and ' + value.routes.length + ' legacy product route(s). Each catalog declares approved',
    'simple virtual products, exact storefront unit prices and native atomic',
    'unit prices. A catalog has one currency, network, asset and recipient.',
    '',
    'In WooCommerce Payments, enable Digital baskets, save the approved product',
    'IDs and distinct endpoint, then export Download this exact basket catalog.',
    'Retain every older catalog still used by an unpaid order. New checkout',
    'orders use the currently enabled catalog; existing orders keep their own',
    'saved catalog and terms. BASKETS.md records this packet’s selected versions.',
    '',
    'One order supports up to 20 distinct products and 100 integer units. Exact',
    'tax-inclusive unit totals must match the real Woo order; coupons, fees,',
    'shipping and variations are outside this digital-product contract.',
    'The native seller obtains the authenticated frozen order quote and delegates',
    'its actual aggregate to the original payment engine. The original buyer',
    'shows every line and exact total before its normal native approval.',
  ].join('\n');
}

function basketGuide(input,value) {
  const lines = [
    '# Prepare and operate the retained Woo basket catalogs',
    '',
    '## Selected original versions',
    '',
    '| Catalog file | Products | Native network |',
    '| --- | ---: | --- |',
    ...value.catalogs.map(({catalog}) => '| catalogs/' + catalog.catalogDigest + '.json | ' +
      catalog.products.length + ' | ' + catalog.products[0].expect.network + ' |'),
    '',
    'Every listed file retains the exact imported export bytes. The browser',
    'checks its canonical catalog digest; the original native compiler checks',
    'the digest, sorted product list, payment identity and unit prices again',
    'before publishing the merchant configuration. Import order does not select',
    'a current catalog: the actual Woo gateway settings choose new-order terms.',
    '',
    '## Install and prepare',
    '',
    'Use the complete source/package edition containing the original native',
    'basket implementation. The prepared WordPress folder contains 16 original',
    'files, including checkout-basket.php and the full BASKET.md operating guide.',
    'Keep its WordPress and Node source on that same release.',
    'When ready for customer checkout, set WooCommerce Site visibility to Live.',
    'Check the order page and private handoff in the customer’s own session.',
    '',
    '~~~sh',
    'TOOLKIT=/absolute/path/to/checkout-or-installed-package',
    'node merchant.mjs prepare --toolkit "$TOOLKIT"',
    'node merchant.mjs inspect --toolkit "$TOOLKIT"',
    '~~~',
    '',
    'Prepared configuration: ' + input.privateDirectory + '/merchant.json',
    'Delivery outbox: ' + value.outboxDirectory,
    '',
    'The original seller compiler validates all catalogs and any retained legacy',
    'routes together. They share a seller origin; retained catalogs use one',
    'basket endpoint, method and route ID distinct from the old fixed routes.',
    'The complete configuration and catalog copies are published in the new',
    'private directory. An explicitly selected existing outbox is reused there.',
    '',
    '## Update a catalog while retaining pending orders',
    '',
    'Save the actual product/gateway changes in Woo and export the new catalog.',
    'Open this setup-input.json in the original Site. Retain the old catalogs',
    'for their pending orders, add the new export and select a new configuration',
    'directory. Set outboxDirectory to the merchant’s existing delivery outbox.',
    'Preparation requires that directory to exist and keeps it at the same path.',
    '',
    'Review and prepare that complete new packet. Drain the original seller using',
    'its normal shutdown, then start the selected new configuration behind the',
    'same HTTPS ingress. Continue the original SF98 worker, shared private key',
    'and operator against their same outbox and history. Existing agent connection',
    'and buyer workspace/inbox remain the original ones. AGENTS.md attaches that',
    'operator directly if a new support-client registration is needed.',
    '',
    'Keep a catalog until its original unpaid orders are settled, cancelled or',
    'explicitly reconciled. Repricing or removing a product in new settings does',
    'not change the frozen catalog, money, quantity or delivery terms of an',
    'existing order. Its same-order reset changes only the attempt generation',
    'after the original merchant-established non-settlement decision.',
    '',
    '## Buyer, release and monetary credits',
    '',
    'Classic and Blocks checkout use the original on-hold order and download',
    'handoff. The v2 buyer handoff shows each line, quantity and exact aggregate.',
    'Use the same BUYER.md inspect, prepare, original workspace and queue commands.',
    'The aggregate follows the original trusted native approval and budget.',
    '',
    'The native seller retrieves the authenticated quote, admits the original',
    'attempt after verification and writes the original settlement notice.',
    'The merchant reviews that payment and releases the same Woo order; Woo',
    'grants the normal per-product download permissions, limits and expiry.',
    'Changed delivery definitions are reconciled against the frozen original.',
    '',
    'REFUNDS.md and the existing refund commands continue to record verified',
    'whole-order monetary credits. Choose the explicit store-currency allocation.',
    'Item returns and entitlement decisions use the native merchant workflow;',
    'a fully refunded native order can lose download access through its status.',
    '',
    'Complete source guide:',
    'https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/' +
      WOO_SOURCE + '/sf104-woocommerce-merchant-bridge/BASKET.md',
    '',
  ];
  return lines.join('\n');
}

function merchantGuide(input, value) {
  return `# WooCommerce merchant setup

For agent operation, the included AGENTS.md and agent-input.json connect this
same merchant to the original 20-tool MCP provider and installed stdio client.

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
checkout-basket.php, OPERATIONS.md, NATIVE_REVIEW.md, REFUNDS.md and BASKET.md. Copy all 16 files in that folder
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
When the shop is ready for customers, set WooCommerce → Settings → Site visibility
to Live. Check checkout and the order page in the customer's own session, including
its private payment-instructions download. Coming soon visibility can hide that
page even when the administrator can see the complete order.

${merchantProductGuide(value)}

Full original guide: ${WOO_GUIDE}

## 3. Connect the existing HTTPS ingress

Shop origin: ${value.storeOrigin}
Admission: ${value.admissionUrl}
Settlement receiver: ${value.settlementUrl}
Seller origin: ${value.sellerOrigin}
Facilitator: ${value.facilitatorUrl}
Delivery outbox: ${value.outboxDirectory}

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

setup-input.json reopens this preparation in the developer Site. routes/ and
catalogs/ keep the exact source bytes imported there. Retained catalog digests
are checked by the original native compiler. A selected existing outbox remains
at its original path when preparing the new configuration. setup.json records only public merchant
configuration and the chosen private directory. merchant.mjs forwards the
original CLI with argument arrays and inherits its normal terminal approval.
No wallet, signer, customer handoff or HMAC key belongs in this setup packet.

A later route import or different setup packet does not migrate existing orders,
terms, outbox or ledgers. Use the original merchant upgrade/reconciliation
procedure and an explicitly new configuration when changing routes. For a
catalog update, import the old pending-order catalogs with the new one and select
the merchant's existing outboxDirectory. Drain the original seller, then use
its new configuration with the same original delivery worker and operator.
`;
}


function agentGuide(input, value) {
  const directory = input.privateDirectory + '/agents';
  return [
    '# Connect the Woo merchant to an agent',
    '',
    'This packet connects the existing WordPress store to the original merchant',
    'MCP provider. The same operator keeps order reviews, release attempts, partial',
    'refunds and complete customer exports. The provider exposes 20 Woo tools.',
    '',
    '## 1. Select the original private inputs',
    '',
    'For a new operator, finish merchant preparation in README.md. An existing',
    'operator can be attached directly. Open agent-input.json locally.',
    'Its directory is a NEW private agent directory; the default is:',
    '',
    '    ' + directory,
    '',
    'The default creates the original Woo operator configuration against this',
    'packet’s WordPress URL and prepared SF98 outbox. The new review/refund',
    'workspace lives inside that agent directory. Set usernameEnv and',
    'applicationPasswordEnv to the NAMES of the existing manager environment',
    'variables. The WordPress account requires manage_woocommerce and an',
    'Application Password. Supply the actual values through the MCP host’s',
    'private environment; keep values out of this JSON and the downloaded packet.',
    '',
    'If this merchant already has an operator, preserve its original workspace:',
    'remove usernameEnv and applicationPasswordEnv, then add the absolute',
    'operator JSON path as the operator property. Its exact WordPress URL must',
    'match this packet. It retains its original SF98 outbox and review/refund IDs',
    'for the agent, including merchants prepared before this packet.',
    '',
    'Optional records aliases select original native checkout receipts. Each',
    'entry has file (absolute original JSON path), payer (the trusted original',
    '56-character Stellar account), and optional label, rpcEndpoint and',
    'maxEventPages. Copy the payer from the original retained checkout record.',
    'For example, the record key original-order becomes the source argument to',
    'merchant_woo_review_source. An operator can use store/queue/history without',
    'registering any receipt first.',
    '',
    'Optional adjustments aliases select existing accounting export roots:',
    '',
    '~~~json',
    '{"sales":{"directory":"/private/accounting/workspace/exports","label":"Original accounting exports"}}',
    '~~~',
    '',
    'Put that object in adjustments. Each export remains at',
    '<root>/<original-export-UUID>/adjustments.json; the original accounting',
    'engine retains its request, transfer proof and adjustment UUID. Empty',
    'records and adjustments are valid. You can add their actual references to',
    'the saved woocommerce.json and restart this same host when they are ready.',
    '',
    '## 2. Prepare and reopen the original host',
    '',
    'From this extracted packet, using the same selected toolkit as README.md:',
    '',
    '~~~sh',
    'TOOLKIT=/absolute/path/to/checkout-or-installed-package',
    'node merchant.mjs agent-init --toolkit "$TOOLKIT"',
    'node merchant.mjs agent-inspect --toolkit "$TOOLKIT" --dir ' + shell(directory),
    '~~~',
    '',
    'Use --input /absolute/agent-input.json for an explicitly selected local',
    'input file. Preparation validates the original Woo configuration, calls',
    'the existing init-woocommerce implementation, and publishes the complete',
    'new directory. It retains agent-input.json, woocommerce.json, the original',
    'host stores, client.json and agent-setup.json. A new operator additionally',
    'has operator.json and its own empty review/refund workspace. All generated',
    'JSON is mode 0600 and directories are private.',
    '',
    'agent-inspect reopens the canonical configuration and lists the actual',
    'declared store, receipt/accounting aliases, credential environment names',
    'and 20 tool names. It makes no store request. If preparation loses its',
    'reply, run agent-inspect against the same directory; a repeated init',
    'preserves an existing directory and asks you to reopen it.',
    '',
    '## 3. Register the installed stdio client',
    '',
    'The generated client.json is a complete MCP host configuration containing',
    'one named server. Its command is the Node executable that prepared the',
    'packet; its entry is the selected toolkit’s ORIGINAL stdio.mjs. Its only',
    'generated environment value is MCP_MERCHANT_CONFIG. Import it using your',
    'MCP host’s existing local-server configuration and secure environment.',
    '',
    'For a host that already has other servers, create a complete merged file:',
    '',
    '~~~sh',
    'node merchant.mjs agent-client --toolkit "$TOOLKIT" --dir ' + shell(directory) + ' -- \\',
    '  --merge /private/existing-mcp-host.json --output /private/host-with-woo.json',
    '~~~',
    '',
    'This invokes the original client-config.mjs. It preserves every existing',
    'host field and named server, rejects an already-used server name, and',
    'creates the selected new private output. Add --name AN_UNUSED_NAME after',
    '-- when the default starforge-woo name is already registered. Review and',
    'select the resulting file in the same host, then restart its Woo server.',
    '',
    'For an explicit foreground subprocess using this same configuration:',
    '',
    '~~~sh',
    'node merchant.mjs agent-stdio --toolkit "$TOOLKIT" --dir ' + shell(directory),
    '~~~',
    '',
    'An MCP client sends newline-delimited JSON-RPC on stdin and receives its',
    'protocol on stdout; diagnostics go to stderr. The existing merchant stdio',
    'transport owns and closes its private loopback host. Keep the selected',
    'toolkit path stable across restarts. For an intentional source relocation,',
    'the new toolkit’s original client-config.mjs can register the saved',
    'host/merchant-mcp.json at that new installed source path.',
    '',
    '## 4. Use the actual merchant',
    '',
    'Ask the connected agent to call merchant_woo_stores, then',
    'merchant_woo_store_status with store: "shop" (or your chosen alias).',
    'The live status returns the real WordPress manager, readiness, currency,',
    'storage mode and native journal counts. Call merchant_woo_queue to select',
    'an actual order, then merchant_woo_order with that returned decimal ID.',
    'A live request uses the original manager environment and HTTPS transport.',
    '',
    'For release, select a declared receipt with merchant_woo_review_source,',
    'retain its exact recordSha256, and use a stable reviewId with the original',
    'order. Inspect the native review before merchant_woo_release, which requires',
    'its exact review SHA and the same order ID in confirmOrder.',
    '',
    'For refunds, inspect the canonical accounting source and original Woo',
    'refund snapshot. Prepare the selected verified adjustment UUID with the',
    'exact source hash, explicit Woo amount and currency. Apply only the saved',
    'prepared review hash and selected order ID. Recover through the same',
    'original IDs after interruption; retained offline status/history and',
    'complete export/file tools reopen the same original bytes.',
    '',
    'The original WOO_COMMERCE.md describes every argument, native recovery,',
    'pagination, file download resumption and complete receiving. REFUNDS.md',
    'documents Woo order-credit behavior and download access after a full refund.',
    '',
    'Original source guides:',
    '- https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/mcp-merchant-operator/WOO_COMMERCE.md',
    '- https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/mcp-merchant-operator/STDIO.md',
    '- ' + WOO_GUIDE,
    '',
  ].join('\n');
}

function buyerGuide() {
  return `# Use the original buyer for a Woo order

A basket handoff lists every product, quantity, storefront total and native
atomic aggregate. Review those exact line terms with the same original buyer;
its timeout is the minimum saved timeout across the selected lines.

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
checkout-basket.php, refund-networks.json and all four operating guides into the new output directory's
starforge-sf98-woo folder. It makes no network request or store change.
Copy that folder to WordPress wp-content/plugins using the shop's normal
deployment process, or zip the folder and use WordPress Upload Plugin.
Activate Starforge SF98 WooCommerce Merchant Bridge. Open WooCommerce → Stellar
merchant operations for native orders, payment review and verified order credits.
Retain all 16 delivered files when upgrading an existing plugin. REFUNDS.md covers
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
When ready to accept customers, open WooCommerce → Settings → Site visibility
and select Live. Use the customer's own session to check the order page and
its private payment-instructions download before accepting orders.
Use Download saved merchant route on the saved product. For a digital basket,
enable Digital baskets in the original payment gateway settings, select the
approved product IDs and distinct seller endpoint, save, then use Download this
exact basket catalog. Retain earlier catalogs for their existing pending orders.

Return to /woo.html in the original developer Site, import those route/catalog exports,
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
  const catalogs = value.catalogs.map(({catalog,text,name}) => ({path:`catalogs/${catalog.catalogDigest}.json`,catalog,text,name}));
  const config = {schema:WOO_PACKET_SCHEMA, storeOrigin:value.storeOrigin, admissionUrl:value.admissionUrl,
    settlementUrl:value.settlementUrl, facilitatorUrl:value.facilitatorUrl,
    privateDirectory:input.privateDirectory, routes:routes.map(({path}) => path),baskets:catalogs.map(({path}) => path),
    ...(input.outboxDirectory ? {outboxDirectory:input.outboxDirectory} : {})};
  const files = [...routes,...catalogs].map(({path,text}) => ({path:root + path, content:text}));
  files.push({path:root + 'setup.json',content:JSON.stringify(config,null,2) + '\n'},
    {path:root + 'setup-input.json',content:JSON.stringify(input,null,2) + '\n'},
    {path:root + 'merchant.mjs',content:runnerSource},
    {path:root + 'README.md',content:merchantGuide(input,value)},
    {path:root + 'BUYER.md',content:buyerGuide()},
    {path:root + 'agent-input.json',content:JSON.stringify({
      schema:'stellar-forge.frontdoor-woo-agents.v1',
      directory:input.privateDirectory + '/agents',store:'shop',label:'Woo merchant',
      serverName:'starforge-woo',usernameEnv:'WOO_OPERATOR_USERNAME',
      applicationPasswordEnv:'WOO_OPERATOR_APPLICATION_PASSWORD',records:{},adjustments:{},
    },null,2) + '\n'},
    {path:root + 'AGENTS.md',content:agentGuide(input,value)},
    {path:root + '.gitignore',content:'*\n'});
  if (catalogs.length) files.push({path:root + 'BASKETS.md',content:basketGuide(input,value)});
  return {files, config, summary:{folder:input.folder, routeCount:routes.length, routes:routes.map(({route}) => route),
    catalogCount:catalogs.length,catalogs:catalogs.map(({catalog}) => catalog),outboxDirectory:value.outboxDirectory,
    sellerOrigin:value.sellerOrigin, storeOrigin:value.storeOrigin, admissionUrl:value.admissionUrl,
    settlementUrl:value.settlementUrl, facilitatorUrl:value.facilitatorUrl, privateDirectory:input.privateDirectory}};
}
