// MIT. SF102: portable recovery for the existing SF30 static Stellar x402 seller.
// Runs offline except explicit loopback-only live-vs-standby offer comparison.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, stat, lstat, readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileHttpSellerOffer, normalizeSellerPaymentOptions } from '../sf30-seller-sdk/seller.mjs';
import { compileServicePath } from '../sf30-seller-sdk/route-path.mjs';
import { supportsSellerMethod } from '../sf30-seller-sdk/http-methods.mjs';

const SCHEMA = 'stellar-forge.sf102.seller-recovery.v1';
const CONFIG_SCHEMA = 'stellar-forge.seller-service.v1';
const PAYMENT_IDENTITY = 'stellar-forge.sf102.ordered-payment-options.v1';
const MAX_CONFIG = 1024 * 1024, MAX_ASSET = 1024 * 1024, MAX_REMOTE = 2 * 1024 * 1024;
const LIMIT_ROUTES = 64;
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const stable = x => JSON.stringify(x, (_, v) => obj(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const bad = message => { throw new Error(message); };
const usage = `Usage:
  node recovery.mjs pack --config ORIGINAL/seller.json --out NEW_PRIVATE_BUNDLE
  node recovery.mjs verify --bundle EXISTING_BUNDLE
  node recovery.mjs restore --bundle EXISTING_BUNDLE --to NEW_PRIVATE_DIRECTORY
  node recovery.mjs probe --bundle EXISTING_BUNDLE --current http://127.0.0.1:PORT --standby http://127.0.0.1:PORT

Works with existing SF30 static inline JSON and responseFile JSON routes. Full payment
identity and publicOrigin remain unchanged. Live probe compares the ORIGINAL seller
/_seller/offers and /_seller/health on two loopback hosts against the saved config.
Payment drift returns structured diagnostics and CLI exit 2; no paid request is sent.
Dynamic handler routes need their original application code and are deliberately not packaged.`;

function argumentsOf(args) {
  const [command, ...rest] = args;
  if (command === '--help' || !command) return { command: 'help', options: {} };
  if (!['pack', 'verify', 'restore', 'probe'].includes(command)) bad(usage);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--[a-z-]+$/.test(rest[i]) || options[rest[i]] !== undefined || !rest[i + 1] || rest[i + 1].startsWith('--')) bad(usage);
    options[rest[i]] = rest[i + 1];
  }
  const allowed = {
    pack: ['--config', '--out'], verify: ['--bundle'],
    restore: ['--bundle', '--to'], probe: ['--bundle', '--current', '--standby'],
  }[command];
  if (Object.keys(options).length !== allowed.length || allowed.some(k => !options[k]) ||
      Object.keys(options).some(k => !allowed.includes(k))) bad(usage);
  return { command, options };
}

async function regularBytes(path, max) {
  const link = await lstat(path);
  if (!link.isFile() || link.isSymbolicLink() || link.size > max) bad(`Unsafe, missing or oversized regular file: ${path}`);
  const h = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const st = await h.stat();
    if (!st.isFile() || st.size > max) bad(`Changed or oversized file: ${path}`);
    const bytes = await h.readFile();
    if (bytes.length > max) bad(`Oversized file: ${path}`);
    return bytes;
  } finally { await h.close(); }
}
function parseJson(bytes, name) {
  try { return JSON.parse(utf8(bytes)); }
  catch { bad(`Invalid UTF-8 JSON in ${name}`); }
}
function validateConfig(config) {
  if (!obj(config) || config.schema !== CONFIG_SCHEMA || !Array.isArray(config.routes) ||
      !config.routes.length || config.routes.length > LIMIT_ROUTES) bad('Original SF30 seller-service.v1 config required');
  const ids = new Set();
  const publicOrigin = configuredOrigin(config);
  for (const route of config.routes) {
    if (!obj(route) || typeof route.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(route.id) ||
        ids.has(route.id) || typeof route.path !== 'string' || !route.path.startsWith('/') ||
        route.path.startsWith('/_seller/') ||
        (own(route, 'definition') === own(route, 'offer')) ||
        ['response', 'responseFile', 'handler'].filter(k => own(route, k)).length !== 1) bad('Unsupported or invalid SF30 route');
    if (own(route, 'handler')) bad(`Route ${route.id} uses an application handler; package its trusted app separately, not as a static snapshot`);
    if (own(route,'definition')) {
      if (!obj(route.definition) || own(route.definition,'url') || route.path.includes(':'))
        bad(`Route ${route.id} must use its original fixed definition path and publicOrigin`);
    } else {
      if (!obj(route.offer) || !publicOrigin ||
          new URL(route.offer.resource?.url).origin !== publicOrigin ||
          compileServicePath(route.offer).path !== route.path)
        bad(`Imported route ${route.id} must match its configured publicOrigin and service path`);
    }
    if (!supportsSellerMethod(routeMethod(route))) bad(`Unsupported original seller method: ${route.id}`);
    ids.add(route.id);
  }
  return config;
}
function configuredOrigin(config) {
  if (config.publicOrigin === undefined) return null;
  const raw=config.publicOrigin;
  if (typeof raw!=='string') bad('Invalid original publicOrigin');
  const u=new URL(raw);
  if (u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||
      u.origin!==raw.replace(/\/$/,'')) bad('Invalid original publicOrigin');
  return u.origin;
}
function routeMethod(route) {
  return own(route,'definition') ? String(route.definition?.method??'').toUpperCase()
    : route.offer?.extensions?.bazaar?.info?.input?.method;
}
function routePayments(route) {
  return normalizeSellerPaymentOptions(own(route,'definition') ? route.definition
    : {paymentOptions:route.offer?.accepts});
}
function safeDirName(path) {
  if (typeof path !== 'string' || !path || path === '.' || path === '..' || path.includes('/') || path.includes('\\')) bad('Invalid bundle member name');
  return path;
}
function isInside(root, path) {
  const rel = relative(root, path);
  return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function createPrivateDir(dir) {
  await mkdir(dir, { recursive: false, mode: 0o700 });
  await mkdir(join(dir, 'assets'), { mode: 0o700 });
}
async function privateFile(path, bytes) {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}
function legacyRouteBrief(config) {
  return config.routes.map(route => ({ id: route.id, path: route.path,
    method: (route.offer?.extensions?.bazaar?.info?.input?.method ?? route.definition?.method ?? null),
    paymentHash: hash(Buffer.from(stable(route.offer?.accepts?.[0] ?? route.definition?.payment ?? null))),
  }));
}
function routeBrief(config) {
  return config.routes.map(route => {
    const options=routePayments(route);
    return {id:route.id,path:route.path,method:routeMethod(route),
      paymentHash:hash(Buffer.from(stable(options))),paymentOptionCount:options.length,
      optionHashes:options.map(option=>hash(Buffer.from(stable(option))))};
  });
}

export async function pack(configPath, outputPath) {
  const source = resolve(configPath), root = await realpath(dirname(source)), dest = resolve(outputPath);
  if (isInside(root, dest) && dirname(dest) === root) { /* Creating a sibling private folder is fine. */ }
  if (dest === root || dest === source) bad('Bundle cannot replace its input');
  const raw = await regularBytes(source, MAX_CONFIG);
  const config = validateConfig(parseJson(raw, 'seller config'));
  const rebased = structuredClone(config), assets = [];
  const staged = new Map();
  for (const route of rebased.routes) {
    if (!own(route, 'responseFile')) continue;
    const file = route.responseFile;
    if (typeof file !== 'string' || !file) bad(`Missing responseFile for ${route.id}`);
    const absolute = resolve(root, file), original = await realpath(absolute);
    if (!isInside(root, original)) bad(`Route ${route.id} points outside the config directory: stage data inside this directory first`);
    const bytes = await regularBytes(absolute, MAX_ASSET);
    parseJson(bytes, route.id);
    const member = safeDirName(route.id) + '.json';
    const relativeFile = `assets/${member}`;
    route.responseFile = `./${relativeFile}`;
    staged.set(relativeFile, bytes);
    assets.push({ routeId: route.id, file: relativeFile, sha256: hash(bytes), bytes: bytes.length });
  }
  const sellerBytes = Buffer.from(JSON.stringify(rebased, null, 2) + '\n');
  if (sellerBytes.length > MAX_CONFIG) bad('Staged seller config too large');
  const routes = routeBrief(config);
  const manifest = {
    schema: SCHEMA, createdAt: new Date().toISOString(),
    sellerSchema: CONFIG_SCHEMA, originalConfigSha256: hash(raw),
    sellerConfigSha256: hash(sellerBytes), publicOrigin: config.publicOrigin ?? null,
    paymentIdentity: PAYMENT_IDENTITY, routes, assets,
    note: 'Only the original SF30 seller may validate/pay/settle. No wallet or facilitator state included.',
  };
  const entries = new Map([['seller.json', sellerBytes],
    ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')], ...staged]);
  // Stage in a private adjacent temporary directory; creation is exclusive, never replace an existing target.
  await createPrivateDir(dest);
  try {
    for (const [member, bytes] of entries) await privateFile(join(dest, member), bytes);
  } catch (e) {
    await rm(dest, { recursive: true, force: true });
    throw e;
  }
  return { bundle: dest, routes: manifest.routes.length, assets: assets.length,
    paymentOptions:routes.reduce((n,r)=>n+r.paymentOptionCount,0),paymentIdentity:PAYMENT_IDENTITY,
    configSha256: manifest.sellerConfigSha256 };
}

export async function verify(bundlePath) {
  const root = await realpath(resolve(bundlePath));
  if (!(await stat(root)).isDirectory()) bad('Bundle is not a directory');
  const manifest = parseJson(await regularBytes(join(root, 'manifest.json'), MAX_CONFIG), 'manifest');
  if (!obj(manifest) || manifest.schema !== SCHEMA || manifest.sellerSchema !== CONFIG_SCHEMA ||
      typeof manifest.sellerConfigSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sellerConfigSha256) ||
      !Array.isArray(manifest.assets) || !Array.isArray(manifest.routes)) bad('Invalid SF102 manifest');
  const sellerBytes = await regularBytes(join(root, 'seller.json'), MAX_CONFIG);
  if (hash(sellerBytes) !== manifest.sellerConfigSha256) bad('Seller config hash mismatch');
  const config = validateConfig(parseJson(sellerBytes, 'seller.json'));
  if (own(manifest,'paymentIdentity') && manifest.paymentIdentity!==PAYMENT_IDENTITY)
    bad('Unsupported seller payment identity format');
  const modernRoutes=routeBrief(config);
  const expectedRoutes=own(manifest,'paymentIdentity')?modernRoutes:legacyRouteBrief(config);
  if (stable(expectedRoutes) !== stable(manifest.routes) ||
      (config.publicOrigin ?? null) !== manifest.publicOrigin) bad('Seller terms or route identity drift');
  if (!(await lstat(join(root, 'assets'))).isDirectory()) bad('Unsafe assets directory');
  const expected = new Set(['seller.json', 'manifest.json']), assetIds = new Set();
  for (const entry of manifest.assets) {
    if (!obj(entry) || typeof entry.routeId !== 'string' || assetIds.has(entry.routeId) ||
        typeof entry.file !== 'string' || entry.file !== `assets/${safeDirName(entry.routeId)}.json` ||
        !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_ASSET) bad('Invalid asset manifest');
    const route = config.routes.find(r => r.id === entry.routeId);
    if (!route || route.responseFile !== `./${entry.file}`) bad('Asset not bound to original route');
    assetIds.add(entry.routeId); expected.add(entry.file);
    const bytes = await regularBytes(join(root, entry.file), MAX_ASSET);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) bad(`Dataset hash mismatch: ${entry.routeId}`);
    parseJson(bytes, entry.file);
  }
  for (const route of config.routes) {
    if (own(route, 'responseFile') && !assetIds.has(route.id)) bad(`Missing dataset for ${route.id}`);
  }
  // Explicitly refuse undeclared files/symlinks; otherwise an untrusted handoff could smuggle content.
  for (const file of await readdir(root)) {
    if (file === 'assets') continue;
    if (!expected.has(file)) bad(`Unexpected root member: ${file}`);
  }
  for (const file of await readdir(join(root, 'assets'))) {
    if (!expected.has(`assets/${file}`)) bad(`Unexpected asset: ${file}`);
  }
  return { root, manifest, config, routes: config.routes.length, assets: manifest.assets.length,
    paymentOptions:modernRoutes.reduce((n,r)=>n+r.paymentOptionCount,0),
    paymentIdentity:manifest.paymentIdentity??'LEGACY_ROUTE_FINGERPRINT' };
}

export async function restore(bundlePath, destPath) {
  const { root, manifest, paymentOptions, paymentIdentity } = await verify(bundlePath), dest = resolve(destPath);
  if (dest === root || isInside(root, dest) || isInside(dest, root)) bad('Restore destination must be separate from bundle');
  await createPrivateDir(dest);
  try {
    await privateFile(join(dest, 'seller.json'), await regularBytes(join(root, 'seller.json'), MAX_CONFIG));
    for (const item of manifest.assets) await privateFile(join(dest, item.file), await regularBytes(join(root, item.file), MAX_ASSET));
    await privateFile(join(dest, 'RECOVERY-SOURCE.json'), Buffer.from(JSON.stringify({
      schema: 'stellar-forge.sf102.restored-source.v1',
      recoveredAt: new Date().toISOString(), sellerConfigSha256: manifest.sellerConfigSha256,
      paymentIdentity, paymentOptions,
      note: 'Use the original SF30 server with this config. HTTPS proxy, facilitator, wallet and app deployment are managed separately.',
    }, null, 2) + '\n'));
  } catch (e) { await rm(dest, { recursive: true, force: true }); throw e; }
  return { restored: dest, config: join(dest, 'seller.json'), assets: manifest.assets.length,
    publicOrigin: manifest.publicOrigin, paymentIdentity, paymentOptions };
}

function loopbackUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || u.username || u.password ||
      u.pathname !== '/' || u.search || u.hash || u.origin !== value.replace(/\/$/, '')) bad('Only exact http://127.0.0.1:PORT loopback origins permitted');
  return u.origin;
}
async function getJson(origin, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(origin + path, { redirect: 'manual', headers: { accept: 'application/json' }, signal: controller.signal });
    if (response.status !== 200 || !(response.headers.get('content-type') ?? '').includes('application/json')) bad(`Original seller ${path}: status/type mismatch`);
    if (Number(response.headers.get('content-length') || 0) > MAX_REMOTE) bad('Oversized original seller response');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_REMOTE) bad('Oversized original seller response');
    return parseJson(bytes, path);
  } finally { clearTimeout(timer); }
}
function expectedOffer(config, route, listenerOrigin) {
  const publicOrigin=configuredOrigin(config);
  if (own(route,'offer')) return structuredClone(route.offer);
  // These are the actual endpoint origin and original compiler used by SF30,
  // not a placeholder resource or a second seller implementation.
  return compileHttpSellerOffer({...route.definition,url:(publicOrigin??listenerOrigin)+route.path},
    {allowLocalhost:publicOrigin===null});
}
function changedKeys(expected, observed) {
  if (!obj(expected)||!obj(observed)) return ['value'];
  return [...new Set([...Object.keys(expected),...Object.keys(observed)])]
    .filter(key=>stable(expected[key])!==stable(observed[key])).map(key=>key.slice(0,96)).slice(0,32);
}
function offerDrift(expected, observed) {
  const drift=[];
  if (!obj(observed)) return [{code:'INVALID_LIVE_OFFER'}];
  for (const field of ['x402Version','error','resource','extensions']) {
    if (stable(expected[field])!==stable(observed[field]))
      drift.push({code:'OFFER_METADATA_DRIFT',field,
        changedFields:changedKeys(expected[field],observed[field])});
  }
  const otherKeys=[...new Set([...Object.keys(expected),...Object.keys(observed)])]
    .filter(key=>!['x402Version','error','resource','extensions','accepts'].includes(key));
  if (otherKeys.some(key=>stable(expected[key])!==stable(observed[key])))
    drift.push({code:'OFFER_ADDITIONAL_FIELDS_DRIFT'});
  if (!Array.isArray(observed.accepts)) return [...drift,{code:'INVALID_LIVE_PAYMENT_OPTIONS'}];
  if (expected.accepts.length!==observed.accepts.length)
    drift.push({code:'PAYMENT_OPTION_COUNT_DRIFT',expectedCount:expected.accepts.length,observedCount:observed.accepts.length});
  for (let i=0;i<Math.min(expected.accepts.length,observed.accepts.length);i++) {
    if (stable(expected.accepts[i])===stable(observed.accepts[i])) continue;
    drift.push({code:'PAYMENT_OPTION_DRIFT',optionIndex:i+1,
      changedFields:changedKeys(expected.accepts[i],observed.accepts[i]),
      expectedSha256:hash(Buffer.from(stable(expected.accepts[i]))),
      observedSha256:hash(Buffer.from(stable(observed.accepts[i])))});
  }
  return drift;
}
async function captureEndpoint(endpoint, origin) {
  const reads=await Promise.allSettled([
    getJson(origin,'/_seller/health'),getJson(origin,'/_seller/offers'),
  ]);
  const result={endpoint,origin,errors:[]};
  for (const [index,key] of ['health','offers'].entries()) {
    if (reads[index].status==='fulfilled') result[key]=reads[index].value;
    else result.errors.push({endpoint,code:'SOURCE_READ_FAILED',surface:key,
      reason:['TimeoutError','AbortError'].includes(reads[index].reason?.name)?'DEADLINE':'HTTP_OR_JSON_SOURCE'});
  }
  return result;
}
function compareEndpoint(config, source) {
  const drift=[...source.errors], rows=[];
  const add=(code,details={})=>drift.push({endpoint:source.endpoint,code,...details});
  const health=source.health, offers=source.offers;
  const mode=['CHALLENGE_ONLY','NATIVE_X402'].includes(health?.mode)?health.mode:null;
  const summary={endpoint:source.endpoint,mode,matchedRoutes:0,routes:rows,
    offersSha256:offers===undefined?null:hash(Buffer.from(stable(offers)))};
  if (!obj(health)||!Array.isArray(health.routes)) {
    if (health!==undefined) add('INVALID_LIVE_HEALTH');
    return {summary,drift};
  }
  if (!mode) add('INVALID_LIVE_MODE');
  if (!Array.isArray(offers)) {
    if (offers!==undefined) add('INVALID_LIVE_OFFERS');
    return {summary,drift};
  }
  if (health.routes.length!==config.routes.length)
    add('HEALTH_ROUTE_COUNT_DRIFT',{expectedCount:config.routes.length,observedCount:health.routes.length});
  if (offers.length!==config.routes.length)
    add('OFFER_ROUTE_COUNT_DRIFT',{expectedCount:config.routes.length,observedCount:offers.length});
  const healthById=new Map(),usedOffers=new Set();
  for (const route of health.routes) {
    if (!obj(route)||typeof route.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(route.id)||
        typeof route.url!=='string'||!supportsSellerMethod(route.method)) {
      add('INVALID_LIVE_HEALTH_ROUTE'); continue;
    }
    const values=healthById.get(route.id)??[]; values.push(route); healthById.set(route.id,values);
  }
  let advertisedOrigin=source.origin;
  if (configuredOrigin(config)===null) {
    // An SSH-forwarded probe port can differ from the actual local listener.
    // Only definition-only configs can omit a fixed public origin, and then
    // every advertised URL must use one actual canonical loopback origin.
    const origins=new Set();
    for (const values of healthById.values()) for (const route of values) {
      try {
        const u=new URL(route.url);
        if (u.username||u.password||u.search||u.hash||u.href!==route.url) throw new Error();
        origins.add(loopbackUrl(u.origin));
      } catch { add('INVALID_DEFINITION_LOCAL_ORIGIN',{routeId:route.id}); }
    }
    if (origins.size!==1) add('INCONSISTENT_DEFINITION_LOCAL_ORIGINS',{count:origins.size});
    else advertisedOrigin=[...origins][0];
    summary.definitionListenerOrigin=origins.size===1?advertisedOrigin:null;
  }
  for (const route of config.routes) {
    const expected=expectedOffer(config,route,advertisedOrigin), before=drift.length;
    const row={routeId:route.id,method:routeMethod(route),paymentOptionCount:expected.accepts.length,
      expectedOfferSha256:hash(Buffer.from(stable(expected))),observedOfferSha256:null,matched:false};
    rows.push(row);
    const metadata=healthById.get(route.id)??[];
    if (metadata.length!==1) {
      add(metadata.length?'DUPLICATE_LIVE_ROUTE':'MISSING_LIVE_ROUTE',{routeId:route.id}); continue;
    }
    const observed=metadata[0], healthFields=[];
    if (observed.method!==row.method) healthFields.push('method');
    if (observed.url!==expected.resource.url) healthFields.push('url');
    if ((observed.routeTemplate??null)!==(expected.extensions.bazaar.routeTemplate??null)) healthFields.push('routeTemplate');
    if (healthFields.length) add('HEALTH_ROUTE_IDENTITY_DRIFT',{routeId:route.id,changedFields:healthFields});
    const candidates=offers.map((offer,index)=>({offer,index})).filter(({offer})=>
      obj(offer)&&offer.resource?.url===observed.url&&
      offer.extensions?.bazaar?.info?.input?.method===observed.method);
    if (candidates.length!==1) {
      add(candidates.length?'AMBIGUOUS_LIVE_OFFER':'MISSING_LIVE_OFFER',{routeId:route.id,candidateCount:candidates.length}); continue;
    }
    const {offer,index}=candidates[0];
    if (usedOffers.has(index)) add('LIVE_OFFER_SHARED_BY_ROUTES',{routeId:route.id});
    usedOffers.add(index);
    row.observedOfferSha256=hash(Buffer.from(stable(offer)));
    for (const detail of offerDrift(expected,offer)) add(detail.code,{routeId:route.id,...detail});
    row.matched=before===drift.length;
  }
  for (const id of healthById.keys()) {
    if (!config.routes.some(route=>route.id===id)) add('UNEXPECTED_LIVE_ROUTE',{routeId:id});
  }
  if (usedOffers.size!==offers.length) add('UNASSIGNED_LIVE_OFFERS',{count:offers.length-usedOffers.size});
  summary.matchedRoutes=rows.filter(row=>row.matched).length;
  return {summary,drift};
}
export async function probe(bundlePath, currentUrl, standbyUrl) {
  const { config, manifest, paymentOptions, paymentIdentity } = await verify(bundlePath);
  const current = loopbackUrl(currentUrl), standby = loopbackUrl(standbyUrl);
  if (current === standby) bad('Current and standby must be different listeners');
  const sources = await Promise.all([
    captureEndpoint('current',current),captureEndpoint('standby',standby),
  ]);
  const comparisons=sources.map(source=>compareEndpoint(config,source));
  const drift=comparisons.flatMap(item=>item.drift);
  if (comparisons[0].summary.mode!==comparisons[1].summary.mode) {
    drift.push({endpoint:'pair',code:'SELLER_MODE_DRIFT',
      currentMode:comparisons[0].summary.mode,standbyMode:comparisons[1].summary.mode});
  }
  const result={cutoverParity:drift.length===0,mode:comparisons[0].summary.mode,
    routeCount:config.routes.length,paymentOptions,paymentIdentity,
    offersSha256:comparisons[0].summary.offersSha256,
    standbyOffersSha256:comparisons[1].summary.offersSha256,
    sellerConfigSha256:manifest.sellerConfigSha256,publicOrigin:manifest.publicOrigin,
    originBinding:configuredOrigin(config)?'SAVED_PUBLIC_ORIGIN':'DEFINITION_LISTENER_ORIGINS',
    endpoints:comparisons.map(item=>item.summary),drift,
    note:'Both original seller metadata snapshots are checked against the saved config; proxy, settlement, backend and data cutover remain operator tasks.'};
  if (drift.length) throw Object.assign(new Error('SF102_CUTOVER_DRIFT'),{code:'SF102_CUTOVER_DRIFT',report:result});
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const { command, options } = argumentsOf(args);
  if (command === 'help') { console.log(usage); return; }
  const result = command === 'pack' ? await pack(options['--config'], options['--out']) :
    command === 'verify' ? (() => verify(options['--bundle']).then(r => ({
      verified: true, routes: r.routes, assets: r.assets, configSha256: r.manifest.sellerConfigSha256,
      paymentOptions:r.paymentOptions,paymentIdentity:r.paymentIdentity,
    })))() :
    command === 'restore' ? restore(options['--bundle'], options['--to']) :
    probe(options['--bundle'], options['--current'], options['--standby']);
  console.log(JSON.stringify(await result));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    if (e.code==='SF102_CUTOVER_DRIFT') console.log(JSON.stringify(e.report));
    console.error(e.message); process.exitCode = e.code==='SF102_CUTOVER_DRIFT'?2:1;
  });
}
