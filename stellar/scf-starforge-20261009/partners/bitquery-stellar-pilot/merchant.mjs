// MIT. Configure the ORIGINAL SF30 query and immutable-file routes from a derived release.
import { createReadStream } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDatasetConfig } from '../../sf30-seller-sdk/dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../../sf30-seller-sdk/dataset-cli.mjs';
import { compileHttpSellerOffer, normalizeSellerPaymentOptions } from '../../sf30-seller-sdk/seller.mjs';
import { compileAssetRouteOffer, MAX_ASSET_BYTES, MAX_ASSET_BUDGET } from '../../sf30-seller-sdk/response-asset.mjs';

const DATASETS = Object.freeze({
  ledger_activity: ['queryLedger', 'admitLedger'],
  payment_flows: ['queryPayments', 'admitPayments'],
  balance_changes: ['queryBalances', 'admitBalances'],
});
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const fail = message => { throw new TypeError(message); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function jsonFile(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > 8*1024*1024) fail('Configuration must be a regular JSON file within 8 MiB');
  const bytes = await readFile(path);
  if (bytes.length > 8*1024*1024) fail('Configuration changed while reading');
  return {value: JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)), bytes};
}
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Validate release identity, then load the maintained dataset engine once per product. */
export async function loadRelease(directory) {
  directory = resolve(directory);
  const {value: manifest, bytes} = await jsonFile(join(directory,'manifest.json'));
  if (manifest?.schema !== 'stellar-forge.bitquery-release.v1' || !plain(manifest.datasets) ||
      Object.keys(manifest.datasets).sort().join(',') !== Object.keys(DATASETS).sort().join(','))
    fail('Expected the three original derived Bitquery datasets');
  const datasets = {};
  for (const name of Object.keys(DATASETS)) {
    const entry = manifest.datasets[name];
    if (!plain(entry) || entry.dataset !== name+'.json' || entry.csv !== name+'.csv' ||
        !/^[a-f0-9]{64}$/.test(entry.datasetSha256) || !/^[a-f0-9]{64}$/.test(entry.csvSha256) ||
        !Number.isSafeInteger(entry.rows) || entry.rows < 0 ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) fail('Invalid derived dataset entry');
    const configPath = join(directory,entry.dataset), csvPath = join(directory,entry.csv);
    const config = await jsonFile(configPath);
    if (sha(config.bytes) !== entry.datasetSha256 || config.value.file !== entry.csv ||
        await fileHash(csvPath) !== entry.csvSha256 || (await stat(csvPath)).size !== entry.bytes)
      fail('Derived dataset content does not match its release');
    const loaded = await loadDatasetConfig(configPath);
    if (loaded.describe().rowCount !== entry.rows || await fileHash(csvPath) !== entry.csvSha256)
      fail('Derived dataset changed while loading');
    datasets[name] = loaded;
  }
  return {directory, manifest, manifestSha256: sha(bytes), datasets};
}

export async function configureMerchant(directory, merchant) {
  if (!plain(merchant) || merchant.schema !== 'stellar-forge.bitquery-merchant.v1' ||
      !Array.isArray(merchant.products) || !merchant.products.length || merchant.products.length > 64)
    fail('Expected a merchant plan with 1–64 selected query/download products');
  const release = await loadRelease(directory), ids = new Set(), paths = new Set();
  const routes = [];
  let assetBytes = 0, responseBytes = 1024*1024;
  for (const product of merchant.products) {
    if (!plain(product) || !own(DATASETS,product.dataset) || !['query','download'].includes(product.kind) ||
        typeof product.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(product.id) || ids.has(product.id) || paths.has(product.path))
      fail('Each product needs a distinct route ID/path, derived dataset and query/download kind');
    ids.add(product.id); paths.add(product.path);
    const paymentInput = own(product,'payment') || own(product,'paymentOptions') ? product : merchant;
    const paymentOptions = normalizeSellerPaymentOptions(paymentInput);
    // The maintained builder validates the HTTPS origin, route and advertised query contract.
    const first = Object.fromEntries(['scheme','network','asset','amount','payTo','maxTimeoutSeconds'].map(k => [k,paymentOptions[0][k]]));
    const compiled = await buildDatasetSellerConfig(release.datasets[product.dataset],
      {payment:first,origin:merchant.publicOrigin,path:product.path});
    const route = compiled.routes[0];
    route.id = product.id;
    delete route.definition.payment;
    route.definition.paymentOptions = paymentOptions;
    route.definition.serviceName = 'Bitquery Stellar derived data';
    route.definition.tags = ['stellar','bitquery','dataset'];
    if (product.kind === 'query') {
      [route.handler,route.admit] = DATASETS[product.dataset];
      compileHttpSellerOffer({...route.definition,url:compiled.publicOrigin+route.path});
    } else {
      const entry = release.manifest.datasets[product.dataset];
      if (entry.bytes > MAX_ASSET_BYTES) fail('Selected download exceeds the original seller file limit; use its query product');
      delete route.handler; delete route.admit;
      delete route.definition.outputExample; delete route.definition.queryParameters;
      route.definition.description = release.datasets[product.dataset].describe().name + ': complete immutable derived CSV.';
      route.responseAsset = {file:join(release.directory,entry.csv),sha256:entry.csvSha256,
        contentType:'text/csv',downloadName:entry.csv};
      compileAssetRouteOffer(route,compiled.publicOrigin,compileHttpSellerOffer);
      assetBytes += entry.bytes;
      responseBytes = Math.max(responseBytes,entry.bytes);
    }
    routes.push(route);
  }
  if (assetBytes > MAX_ASSET_BUDGET) fail('Selected downloads exceed the original seller retained asset budget');
  return {config:{schema:'stellar-forge.seller-service.v1',publicOrigin:new URL(merchant.publicOrigin).origin,
    maxResponseBytes:responseBytes,assetBudgetBytes:Math.max(32*1024*1024,assetBytes),routes},
    release:{manifestSha256:release.manifestSha256,coverage:release.manifest.coverage,
      datasets:Object.fromEntries(Object.entries(release.datasets).map(([k,v]) => [k,v.describe()]))}};
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('inspect --release DIRECTORY\nconfigure --release DIRECTORY --merchant PLAN_JSON --out NEW_SELLER_JSON');
    return;
  }
  const [command,...rest] = args;
  const allowed = command === 'inspect' ? ['--release'] : command === 'configure' ? ['--release','--merchant','--out'] : null;
  if (!allowed) fail('Use inspect or configure; see --help');
  const options = {};
  for (let i=0;i<rest.length;i+=2) {
    if (!allowed.includes(rest[i]) || own(options,rest[i]) || !rest[i+1] || rest[i+1].startsWith('--'))
      fail('Unknown, repeated or missing option');
    options[rest[i]] = rest[i+1];
  }
  if (allowed.some(k => !options[k])) fail('Missing required option');
  if (command === 'inspect') {
    const release = await loadRelease(options['--release']);
    console.log(JSON.stringify({manifestSha256:release.manifestSha256,coverage:release.manifest.coverage,
      datasets:Object.fromEntries(Object.entries(release.datasets).map(([k,v]) => [k,v.describe()]))},null,2));
  } else {
    const {config,release} = await configureMerchant(options['--release'],(await jsonFile(options['--merchant'])).value);
    await writeFile(options['--out'],JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({created:resolve(options['--out']),routes:config.routes.length,
      manifestSha256:release.manifestSha256,mode:'ORIGINAL_SELLER_CONFIG_READY'},null,2));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('Bitquery merchant: '+error.message);process.exitCode=1; });
