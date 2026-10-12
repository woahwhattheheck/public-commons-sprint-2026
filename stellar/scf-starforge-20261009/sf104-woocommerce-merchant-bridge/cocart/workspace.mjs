// MIT. Persistent CoCart customer integration, joined to the original SF104 handoff.
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {validateHandoff} from '../buyer.mjs';

export const SCHEMA = 'stellar-forge.cocart.workspace.v1';
export const RECEIVING_SCHEMA = 'stellar-forge.cocart.receiving.v1';
export const SOURCE = Object.freeze({
  adapter: 'stellar-forge.sf104.cocart.v1',
  sdk: {package: '@cocartheadless/sdk', version: '1.2.1', repository: 'cocart-headless/cocart-js', commit: '936a77b52f355654b4bdd165317caec00146924e'},
  plugin: {kind: 'legacy', version: '4.9.7', repository: 'cocart-headless/cocart-community', commit: '6a3a613936c1abc1d5d8b78cc920d862b1ae542d'},
  sf104: {repository: 'woahwhattheheck/public-commons-sprint-2026', commit: '8bc1c6168fce0392f74bfea8b7d0efd387cd48f2'},
  money: 'minor-unit-integer-strings',
  loadCart: {replace: 'keep-cart=false', merge: 'keep-cart=true'}
});

export class CartError extends Error {
  constructor(code, message, details = {}, status = 400) { super(message); this.name = 'CartError'; this.code = code; this.details = details; this.status = status; }
  toJSON() { return {error: this.code, message: this.message, details: this.details}; }
}
const need = (ok, code, message, details = {}, status = 400) => { if (!ok) throw new CartError(code, message, details, status); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const now = () => new Date().toISOString();
const id = prefix => prefix + '-' + randomUUID();
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function canonical(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { need(Number.isFinite(v), 'NUMBER_INVALID', 'Use finite numbers.'); return JSON.stringify(v); }
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  need(object(v), 'VALUE_INVALID', 'The saved value must be JSON.');
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
const digest = value => sha256(canonical(value));
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/^\d+$/.test(value);
const safeId = v => (typeof v === 'string' && /^[1-9]\d{0,17}$/.test(v)) || (Number.isSafeInteger(v) && v > 0);
const label = v => { need(typeof v === 'string' && v.trim().length > 0 && v.length <= 160, 'LABEL_INVALID', 'Enter a label of 1–160 characters.'); return v.trim(); };

export function minor(value) {
  need(typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value) && value.length <= 80, 'MONEY_CONTRACT', 'Expected a nonnegative minor-unit integer string from the selected CoCart source.', {value});
  return BigInt(value);
}
export function decimalToMinor(value, precision) {
  need(typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && value.length <= 90, 'DECIMAL_INVALID', 'Use an exact nonnegative decimal string.', {value});
  need(Number.isInteger(precision) && precision >= 0 && precision <= 8, 'PRECISION_INVALID', 'Currency precision must be an integer from 0 to 8.');
  const [whole, fraction = ''] = value.split('.');
  need(fraction.length <= precision || /^0*$/.test(fraction.slice(precision)), 'DECIMAL_PRECISION', 'The amount has a nonzero digit beyond the selected currency precision.', {value, precision});
  return BigInt(whole) * 10n ** BigInt(precision) + BigInt((fraction.slice(0, precision).padEnd(precision, '0')) || '0');
}
export function displayMinor(value, precision) {
  const n = minor(value); need(Number.isInteger(precision) && precision >= 0 && precision <= 8, 'PRECISION_INVALID', 'Unsupported currency precision.');
  if (!precision) return n.toString();
  const s = n.toString().padStart(precision + 1, '0');
  return s.slice(0, -precision) + '.' + s.slice(-precision);
}
function absoluteUrl(value, name) {
  let u; try { u = new URL(value); } catch { throw new CartError('URL_INVALID', name + ' must be an absolute URL.'); }
  need(['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && !u.hash, 'URL_INVALID', name + ' must use HTTP(S), with no credentials or fragment.');
  return u;
}
const loopback = u => ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname);
export function validateProfile(raw) {
  need(object(raw), 'PROFILE_REQUIRED', 'Provide the selected store profile.');
  const p = clone(raw), store = absoluteUrl(p.store_url, 'Store URL'), checkout = absoluteUrl(p.checkout_url, 'Checkout URL');
  need(!store.search && checkout.origin === store.origin, 'STORE_ORIGIN_MISMATCH', 'Checkout and API must use the same selected transport origin.');
  need(store.protocol === 'https:' || (p.transport === 'loopback_receiving' && loopback(store)), 'HTTPS_REQUIRED', 'Use HTTPS, or explicitly select loopback_receiving for a local native receiver.');
  const canonicalStore = absoluteUrl(p.merchant_origin || store.origin, 'Merchant origin');
  need(canonicalStore.protocol === 'https:' && canonicalStore.pathname === '/' && !canonicalStore.search, 'MERCHANT_ORIGIN_INVALID', 'Use the canonical HTTPS Woo store origin.');
  need(canonicalStore.origin === store.origin || (p.transport === 'loopback_receiving' && loopback(store)), 'MERCHANT_ORIGIN_MISMATCH', 'A different merchant origin requires the explicit local receiving transport.');
  need((p.plugin || 'legacy') === 'legacy', 'PLUGIN_PROFILE_UNAVAILABLE', 'This source profile operates CoCart Community 4.9.7 through its legacy v2 namespace.');
  need((p.expected_plugin_version || SOURCE.plugin.version) === SOURCE.plugin.version, 'PLUGIN_VERSION_UNAVAILABLE', 'Select the operated Community 4.9.7 source profile.');
  p.store_url = store.href.replace(/\/+$/, ''); p.checkout_url = checkout.href;
  p.merchant_origin = canonicalStore.origin; p.plugin = 'legacy'; p.expected_plugin_version = SOURCE.plugin.version;
  p.timeout_ms = p.timeout_ms === undefined ? 20000 : p.timeout_ms;
  need(Number.isInteger(p.timeout_ms) && p.timeout_ms >= 1000 && p.timeout_ms <= 60000, 'TIMEOUT_INVALID', 'Use a timeout between 1 and 60 seconds.');
  for (const k of Object.keys(p)) need(['label','store_url','checkout_url','merchant_origin','transport','plugin','expected_plugin_version','timeout_ms','gateway_mapping','route_export','notes','environment'].includes(k), 'PROFILE_FIELD_INVALID', 'Unrecognized store profile field.', {field:k});
  p.label = label(p.label || 'Selected Woo store');
  if (p.gateway_mapping) validateMapping(p.gateway_mapping, p.route_export);
  return p;
}
function validateMapping(m, route) {
  need(object(m) && safeId(m.productId) && m.enabled === 'yes' && object(m.storefront), 'MAPPING_INVALID', 'Import the original enabled product mapping with its actual product ID.');
  need(typeof m.storefront.currency === 'string' && /^[A-Z][A-Z0-9]{2,9}$/.test(m.storefront.currency), 'MAPPING_CURRENCY', 'The mapping needs its saved store currency.');
  need(decimalToMinor(m.storefront.total, 8) > 0n, 'MAPPING_TOTAL', 'The saved merchant total must be positive.');
  need(/^[A-Za-z0-9_-]{1,64}$/.test(m.routeId || '') && ['GET','HEAD'].includes(m.method), 'MAPPING_ROUTE', 'The mapping needs its original route and method.');
  const u = absoluteUrl(m.url, 'Seller resource'); need(u.protocol === 'https:' && !u.search, 'MAPPING_RESOURCE', 'Use the original fixed HTTPS seller resource URL.');
  need(['stellar:testnet','stellar:pubnet'].includes(m.network) && /^C[A-Z2-7]{55}$/.test(m.asset || '') && /^[GC][A-Z2-7]{55}$/.test(m.payTo || ''), 'MAPPING_TERMS', 'Retain the original selected network, asset and receiving account.');
  need(typeof m.amountAtomic === 'string' && /^[1-9]\d*$/.test(m.amountAtomic) && Number.isInteger(m.maxTimeoutSeconds) && m.maxTimeoutSeconds >= 1 && m.maxTimeoutSeconds <= 86400, 'MAPPING_AMOUNT', 'Retain the positive atomic amount and native timeout.');
  need(Number.isInteger(m.approvedBy) && m.approvedBy > 0 && typeof m.approvedAt === 'string', 'MAPPING_APPROVAL', 'Import the mapping saved by the Woo merchant.');
  if (route) {
    const expected = {productId:String(m.productId), routeId:m.routeId, url:m.url, method:m.method,
      expect:{scheme:'exact',network:m.network,asset:m.asset,payTo:m.payTo,maxAtomic:m.amountAtomic,maxTimeoutSeconds:m.maxTimeoutSeconds}};
    need(object(route) && Object.keys(expected).every(k => digest(route[k] ?? null) === digest(expected[k])), 'ROUTE_MAPPING_MISMATCH', 'The merchant route export and product mapping must describe the same saved terms.');
  }
  return m;
}
function itemArray(v, field) {
  if (Array.isArray(v)) return v;
  need(object(v), 'CART_SHAPE', 'The native ' + field + ' must be an array or object.');
  return Object.values(v);
}
export function projectCart(data, expectedKey = null) {
  need(object(data) && opaque(data.cart_key), 'CART_KEY_MISSING', 'The original response needs an opaque guest cart key.');
  need(!expectedKey || data.cart_key === expectedKey, 'CART_KEY_CHANGED', 'The response belongs to a different cart session.', {expected:expectedKey, actual:data.cart_key});
  const c = data.currency; need(object(c) && /^[A-Z][A-Z0-9]{2,9}$/.test(c.currency_code || '') && Number.isInteger(c.currency_minor_unit) && c.currency_minor_unit >= 0 && c.currency_minor_unit <= 8, 'CURRENCY_CONTRACT', 'The native currency code and precision are required.');
  need(object(data.totals), 'TOTALS_MISSING', 'The native cart totals are required.');
  const totals = {}; for (const key of ['subtotal','subtotal_tax','fee_total','fee_tax','discount_total','discount_tax','shipping_total','shipping_tax','total','total_tax']) {
    need(own(data.totals, key), 'TOTAL_MISSING', 'A required native total is missing.', {field:key}); minor(data.totals[key]); totals[key] = data.totals[key];
  }
  const items = itemArray(data.items, 'items').map(x => {
    need(object(x) && typeof x.item_key === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x.item_key) && safeId(x.id) && object(x.quantity) && Number.isSafeInteger(x.quantity.value) && x.quantity.value >= 0, 'ITEM_CONTRACT', 'A native line needs its item key, product ID and integer quantity.');
    minor(x.price);
    return {item_key:x.item_key, product_id:String(x.id), name:String(x.name || x.title || x.id), quantity:x.quantity.value, unit_minor:x.price,
      sku:String(x.meta?.sku || ''), product_type:String(x.meta?.product_type || ''), raw_totals:clone(x.totals || {})};
  });
  need(new Set(items.map(x => x.item_key)).size === items.length, 'ITEM_KEY_DUPLICATE', 'The native cart returned duplicate line keys.');
  const coupons = itemArray(data.coupons ?? [], 'coupons'), fees = itemArray(data.fees ?? [], 'fees');
  const removed = itemArray(data.removed_items ?? [], 'removed_items');
  return {cart_key:data.cart_key, cart_hash:typeof data.cart_hash === 'string' ? data.cart_hash : null, currency:c.currency_code, precision:c.currency_minor_unit,
    totals, total_display:displayMinor(totals.total, c.currency_minor_unit), items, item_count:items.reduce((n,x)=>n+x.quantity,0), coupon_count:coupons.length, fee_count:fees.length,
    needs_shipping:data.needs_shipping === true, needs_payment:data.needs_payment === true, removed_items:removed.map(x=>({item_key:x.item_key,id:x.id,name:x.name || x.title || '',quantity:x.quantity?.value ?? x.quantity})),
    fingerprint:digest({cart_key:data.cart_key, currency:c, totals:data.totals, items:data.items, coupons:data.coupons, fees:data.fees, needs_shipping:data.needs_shipping})};
}
export function admission(cart, profile) {
  const m = profile.gateway_mapping, reasons = [];
  if (!m) reasons.push({code:'MAPPING_NEEDED', message:'Import this product’s original saved Woo mapping to compare the selected Stellar method.'});
  if (cart.items.length !== 1) reasons.push({code:'SINGLE_PRODUCT', message:'The released Stellar gateway admits one mapped simple virtual product.'});
  if (cart.items.some(x => x.quantity !== 1 || x.product_type !== 'simple')) reasons.push({code:'SIMPLE_QUANTITY_ONE', message:'The mapped simple product must have quantity one.'});
  if (cart.needs_shipping) reasons.push({code:'SHIPPING', message:'The selected native gateway requires a virtual cart with no shipping.'});
  if (cart.coupon_count || minor(cart.totals.discount_total) !== 0n) reasons.push({code:'DISCOUNT', message:'The selected native gateway requires its saved price without discounts.'});
  if (cart.fee_count || minor(cart.totals.fee_total) !== 0n || minor(cart.totals.fee_tax) !== 0n) reasons.push({code:'FEES', message:'The selected native gateway requires no fees.'});
  if (m) {
    if (cart.items.some(x=>x.product_id !== String(m.productId))) reasons.push({code:'PRODUCT_MAPPING', message:'The cart and selected merchant mapping have different product IDs.'});
    if (cart.currency !== m.storefront.currency) reasons.push({code:'CURRENCY_MAPPING', message:'The native cart currency differs from the saved mapping.'});
    if (minor(cart.totals.total) !== decimalToMinor(m.storefront.total, cart.precision)) reasons.push({code:'TOTAL_MAPPING', message:'The current cart total differs from the merchant’s exact saved total.'});
  }
  return {eligible:reasons.length===0, reasons, mapping_sha256:m ? digest(m) : null, qualification:'Headless comparison; Woo performs its original admission on the actual order.'};
}
function atomic(path, bytes, exclusive = false) {
  mkdirSync(dirname(path), {recursive:true, mode:0o700});
  const temp = path + '.new-' + randomUUID(); let fd;
  try { fd=openSync(temp,'wx',0o600); writeFileSync(fd,bytes); fsyncSync(fd); closeSync(fd); fd=undefined;
    if (exclusive) need(!existsSync(path), 'DESTINATION_EXISTS', 'Use a new receiving destination.', {}, 409);
    renameSync(temp,path);
    const dir=openSync(dirname(path),'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally { if(fd!==undefined) closeSync(fd); if(existsSync(temp)) unlinkSync(temp); }
}
function parseJSON(bytes, what) { try {return JSON.parse(bytes.toString('utf8'));} catch {throw new CartError('JSON_INVALID', what + ' is not valid UTF-8 JSON.');} }


/** Validate an original complete export before source review, recovery or receiving. */
export function inspectReceiving(bytes) {
  const b=parseJSON(bytes,'Receiving export');
  need(b.schema===RECEIVING_SCHEMA&&Array.isArray(b.objects)&&b.objects.length<=100000,'RECEIVING_INVALID','Use an original CoCart receiving export.');
  const {content_sha256,...body}=b;
  need(content_sha256===digest(body),'RECEIVING_DIGEST','The complete receiving export has changed.');
  need(b.workspace?.schema===SCHEMA&&Number.isSafeInteger(b.workspace.revision)&&Array.isArray(b.workspace.carts)&&Array.isArray(b.workspace.events)&&Array.isArray(b.workspace.catalogs),'WORKSPACE_INVALID','The receiving export needs its original workspace.');
  validateProfile(b.workspace.profile);
  need(sha256(JSON.stringify(b.workspace,null,2)+'\n')===b.workspace_version,'RECEIVING_WORKSPACE_CHANGED','The original workspace bytes differ from its saved revision.');
    const seen=new Set();for(const o of b.objects){need(typeof o.sha256==='string'&&/^[a-f0-9]{64}$/.test(o.sha256)&&!seen.has(o.sha256),'OBJECT_ID_INVALID','Receiving object identities must be unique.');seen.add(o.sha256);const data=Buffer.from(o.base64,'base64');need(data.length===o.bytes&&sha256(data)===o.sha256,'RECEIVING_OBJECT_DAMAGED','A receiving object has changed.',{sha256:o.sha256});}
    // Validate complete reachable closure before writing a new manifest.
    const map=new Map(b.objects.map(o=>[o.sha256,o])),walk=v=>{if(Array.isArray(v)){v.forEach(walk);return;}if(!object(v))return;if(typeof v.sha256==='string'&&Number.isSafeInteger(v.bytes)&&typeof v.kind==='string'){const o=map.get(v.sha256);need(o&&o.bytes===v.bytes,'RECEIVING_OBJECT_MISSING','The complete receiving object closure is required.',{sha256:v.sha256});}Object.values(v).forEach(walk);};
    walk(b.workspace);for(const o of b.objects){try{walk(JSON.parse(Buffer.from(o.base64,'base64').toString('utf8')));}catch(e){if(e instanceof CartError)throw e;}}
  return b;
}

export class CartWorkspace {
  constructor({root, CoCart, MemoryStorage, create=false, profile=null, profileBytes=null, receivingTransport=null}) {
    this.root=resolve(root); this.path=join(this.root,'workspace.json'); this.sdk={CoCart,MemoryStorage}; this.active=false;
    if (create) {
      need(!existsSync(this.path), 'WORKSPACE_EXISTS', 'Open the existing workspace.', {}, 409);
      const original=validateProfile(profile), at=now(), events=[]; let p=original;
      if(profileBytes)need(digest(parseJSON(profileBytes,'Native store profile'))===digest(profile),'PROFILE_SOURCE_MISMATCH','The original profile bytes and selected profile differ.');
      if(receivingTransport!==null) {
        need(object(receivingTransport)&&Object.keys(receivingTransport).every(k=>['store_url','checkout_url','reason'].includes(k)),'RECEIVING_TRANSPORT_INVALID','Select only the local receiving URLs and the reason for this transport.');
        const reason=label(receivingTransport.reason);
        p=validateProfile({...original,store_url:receivingTransport.store_url,checkout_url:receivingTransport.checkout_url,transport:'loopback_receiving'});
        need(loopback(new URL(p.store_url)),'RECEIVING_LOOPBACK_REQUIRED','The explicit receiving transport must use a loopback host.');
        events.push({sequence:1,at,type:'transport.receiving_selected',detail:{from:{store_url:original.store_url,checkout_url:original.checkout_url},to:{store_url:p.store_url,checkout_url:p.checkout_url},reason}});
      }
      const profileSource=profileBytes?this.storeObject(profileBytes,'native-store-profile'):null;
      atomic(this.path, JSON.stringify({schema:SCHEMA,revision:0,created_at:at,updated_at:at,profile:p,profile_source:profileSource,source:SOURCE,carts:[],catalogs:[],events},null,2)+'\n',true);
    }
    need(existsSync(this.path),'WORKSPACE_MISSING','Create or receive the workspace first.',{},404);
    this.read();
  }
  read() {
    const bytes=readFileSync(this.path), state=parseJSON(bytes,'Workspace');
    need(state.schema===SCHEMA && Number.isSafeInteger(state.revision) && Array.isArray(state.carts) && Array.isArray(state.events),'WORKSPACE_INVALID','Unrecognized saved workspace.');
    validateProfile(state.profile); return {state,version:sha256(bytes)};
  }
  view() { const {state,version}=this.read(); return {...state,version}; }
  save(state) { state.revision++; state.updated_at=now(); atomic(this.path,JSON.stringify(state,null,2)+'\n'); return this.view(); }
  event(state,type,detail) { state.events.push({sequence:state.events.length+1,at:now(),type,detail:clone(detail)}); }
  findCart(state,cartId) {const c=state.carts.find(x=>x.id===cartId);need(c,'CART_NOT_FOUND','Select an existing customer cart.',{},404);return c;}
  storeObject(bytes,kind,mime='application/json') {
    bytes=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes,'utf8'); const hash=sha256(bytes), path=join(this.root,'objects',hash);
    if (!existsSync(path)) atomic(path,bytes,true); else need(sha256(readFileSync(path))===hash,'OBJECT_DAMAGED','A retained object no longer matches its hash.');
    return {sha256:hash,bytes:bytes.length,kind,mime_type:mime};
  }
  readObject(hash) {need(/^[a-f0-9]{64}$/.test(hash),'OBJECT_ID_INVALID','Use an exact object hash.');const path=join(this.root,'objects',hash);need(existsSync(path),'OBJECT_MISSING','The retained object is unavailable.',{sha256:hash},404);const b=readFileSync(path);need(sha256(b)===hash,'OBJECT_DAMAGED','The retained bytes differ from their hash.',{sha256:hash});return b;}
  async locked(expected, fn) {
    need(!this.active,'WORKSPACE_BUSY','This workspace already has an operation in progress.',{},409);
    let fd; try {fd=openSync(join(this.root,'writer.lock'),'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,at:now()}));} catch(e) {if(fd!==undefined)closeSync(fd);if(e.code==='EEXIST')throw new CartError('WORKSPACE_BUSY','The original writer owns this workspace. Reconcile its process before reopening.',{},409);throw e;}
    this.active=true;
    try {const {state,version}=this.read();need(typeof expected==='string'&&expected===version,'REVISION_CHANGED','Refresh the original workspace before this action.',{current_version:version},409);return await fn(state);}
    finally {this.active=false;closeSync(fd);unlinkSync(join(this.root,'writer.lock'));}
  }
  client(profile,key=null,events=[]) {
    const {CoCart,MemoryStorage}=this.sdk;
    need(typeof CoCart==='function'&&typeof MemoryStorage==='function','SDK_REQUIRED','Load the original @cocartheadless/sdk distribution.');
    need(CoCart.VERSION===SOURCE.sdk.version,'SDK_VERSION_MISMATCH','Use the selected original SDK 1.2.1.',{actual:CoCart.VERSION});
    const client=new CoCart(profile.store_url,{mainPlugin:'legacy',cartKey:key||undefined,storage:new MemoryStorage(),maxRetries:0,etag:false,timeout:profile.timeout_ms,debug:false});
    client.on('request',e=>events.push({kind:'request',at:now(),method:e.method,url:e.url,headers:clone(e.headers),body:e.body??null}));
    client.on('response',e=>events.push({kind:'response_event',at:now(),...e}));
    client.on('error',e=>events.push({kind:'error_event',at:now(),method:e.method,url:e.url,error:{name:e.error?.name,message:e.error?.message,code:e.error?.code}}));
    return client;
  }
  async request(state,key,method,endpoint,data=null,params=null) {
    const events=[],client=this.client(state.profile,key,events);let response=null,error=null;
    try {response=await client.request(method,endpoint,params||undefined,data);}
    catch(e) {response=client.getLastResponse();error={name:e.name||'Error',message:e.message||String(e),code:e.code??null,http_code:e.httpCode??null};}
    const receipt={schema:'stellar-forge.cocart.exchange.v1',at:now(),source:SOURCE,method,endpoint,cart_key:key,
      request_events:events,response:response?{status:response.statusCode,headers:Object.fromEntries(response.headers.entries()),body_ref:this.storeObject(response.body,'native-response','application/json')}:null,error};
    const ref=this.storeObject(JSON.stringify(receipt,null,2)+'\n','native-exchange');
    // Save the exchange before decoding. A first cart may not exist yet, and a
    // native refusal or schema error still belongs to this receiving closure.
    this.event(state,'native.exchange_retained',{method,endpoint,cart_key:key,exchange:ref,status:response?.statusCode??null,error});
    this.save(state);
    return {client,response,error,ref,receipt};
  }
  decodeCart(state,result,key) {
    try {
      need(result.response && result.response.isSuccessful() && !result.error,'NATIVE_REQUEST_FAILED','The original CoCart request did not return a successful cart.',{error:result.error,status:result.response?.statusCode},502);
      const version=result.response.getHeader('CoCart-Version');
      // Pinned Community 4.9.7 set_global_headers emits this header only when
      // WP_DEBUG is true. The native product profile supplies the source pin;
      // validate an observed header without requiring production debug mode.
      const present=version!==null&&version!==undefined;
      need(!present||version===state.profile.expected_plugin_version,'NATIVE_VERSION_CHANGED','The observed plugin version differs from the selected native source profile.',{actual:version,expected:state.profile.expected_plugin_version},409);
      const data=parseJSON(Buffer.from(result.response.body),'Native cart response');
      const projection=projectCart(data,key);
      const header=result.response.getHeader('CoCart-API-Cart-Key')||result.response.getHeader('Cart-Key');
      need(!header||header===projection.cart_key,'CART_HEADER_MISMATCH','The native header and body identify different carts.');
      return {...projection,native_version:{profile:state.profile.expected_plugin_version,header:present?version:null,observation:present?'RESPONSE_HEADER':'NATIVE_PROFILE_HEADER_NOT_EMITTED'}};
    } catch(error) {
      if(error instanceof CartError)error.details={...error.details,exchange:result.ref};
      throw error;
    }
  }
  captureCart(state,cart,result,kind) {
    const projection=this.decodeCart(state,result,cart.cart_key), snapshot={id:id('snapshot'),at:now(),kind,exchange:result.ref,projection};
    cart.snapshots.push(snapshot);cart.current_snapshot=snapshot.id;cart.updated_at=now();return snapshot;
  }
  latest(cart) {return cart.snapshots.find(x=>x.id===cart.current_snapshot)||null;}
  async refreshIn(state,cart,kind='refresh') {const result=await this.request(state,cart.cart_key,'GET','cart');return this.captureCart(state,cart,result,kind);}
  pending(cart) {return cart.operations.filter(x=>['DISPATCHING','UNCERTAIN'].includes(x.status));}

  async createCart(payload,version) {
    return this.locked(version,async state=>{
      const cartLabel=label(payload.label),key=payload.cart_key||null;need(!key||opaque(key),'GUEST_KEY_REQUIRED','Use an opaque guest cart key.');
      need(!key||!state.carts.some(x=>x.cart_key===key),'CART_ALREADY_PRESENT','This guest session is already in the original workspace.',{},409);
      const result=await this.request(state,key,'GET','cart'), projection=this.decodeCart(state,result,key);
      const at=now(),snapshot={id:id('snapshot'),at,kind:key?'attach':'create',exchange:result.ref,projection};
      const cart={id:id('cart'),label:cartLabel,cart_key:projection.cart_key,created_at:at,updated_at:at,snapshots:[snapshot],current_snapshot:snapshot.id,operations:[],handoffs:[]};
      need(!state.carts.some(x=>x.cart_key===cart.cart_key),'CART_ALREADY_PRESENT','The returned session already belongs to a saved customer cart.',{},409);
      state.carts.push(cart);this.event(state,'cart.created',{cart_id:cart.id,exchange:result.ref.sha256});const view=this.save(state);return {cart,workspace:view};
    });
  }
  async refresh(cartId,version) {return this.locked(version,async state=>{const cart=this.findCart(state,cartId);const snapshot=await this.refreshIn(state,cart);this.event(state,'cart.refreshed',{cart_id:cart.id,snapshot_id:snapshot.id});return {snapshot,workspace:this.save(state)};});}
  actionPlan(cart,payload) {
    const action=payload.action;let endpoint,method='POST',body=null;
    const quantity=payload.quantity;
    if(action==='add') {need(safeId(payload.product_id),'PRODUCT_ID_INVALID','Select the actual numeric Woo product ID.');need(Number.isSafeInteger(quantity)&&quantity>0&&quantity<=100000,'QUANTITY_INVALID','Use a positive integer quantity.');endpoint='cart/add-item';body={id:String(payload.product_id),quantity:String(quantity)};}
    else if(['quantity','remove','restore'].includes(action)) {
      need(typeof payload.item_key==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(payload.item_key),'ITEM_KEY_INVALID','Select the original native cart item key.');
      const live=this.latest(cart)?.projection, candidates=action==='restore'?live?.removed_items:live?.items;
      need(candidates?.some(x=>x.item_key===payload.item_key),'ITEM_NOT_CURRENT','Select a line from the current cart or its removed-items list.',{},409);
      endpoint='cart/item/'+payload.item_key;
      if(action==='quantity'){need(Number.isSafeInteger(quantity)&&quantity>=0&&quantity<=100000,'QUANTITY_INVALID','Use a nonnegative integer quantity.');body={quantity:String(quantity)};}
      else method=action==='remove'?'DELETE':'PUT';
    } else if(action==='calculate') endpoint='cart/calculate';
    else if(action==='clear') endpoint='cart/clear';
    else throw new CartError('ACTION_UNKNOWN','Choose add, quantity, remove, restore, calculate or clear.');
    return {action,method,endpoint,body,source:SOURCE};
  }
  async prepare(cartId,payload,version) {return this.locked(version,async state=>{
    const cart=this.findCart(state,cartId);
    const intent=clone({action:payload.action,product_id:payload.product_id,quantity:payload.quantity,item_key:payload.item_key}), intentDigest=digest(intent);
    const requestId=payload.request_id || id('request');
    need(typeof requestId==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(requestId),'REQUEST_ID_INVALID','Use a stable request identity.');
    const prior=cart.operations.find(x=>x.request_id===requestId);
    if(prior){need(prior.intent_digest===intentDigest,'REQUEST_REUSED','The original request identity has different cart instructions.',{},409);return {operation:prior,reused:true,workspace:{...state,version:this.read().version}};}
    need(this.pending(cart).length===0,'RECONCILE_REQUIRED','Reconcile the original uncertain dispatch before another cart mutation.',{operations:this.pending(cart).map(x=>x.id)},409);
    const before=await this.refreshIn(state,cart,'before-prepare'), plan=this.actionPlan(cart,payload);
    const op={id:id('operation'),request_id:requestId,intent_digest:intentDigest,created_at:now(),status:'PREPARED',plan,before_snapshot:before.id,before_fingerprint:before.projection.fingerprint,exchanges:[]};
    cart.operations.push(op);this.event(state,'operation.prepared',{cart_id:cartId,operation_id:op.id});return {operation:op,workspace:this.save(state)};
  });}
  async mutate(cartId,payload,version) {
    const prepared=await this.prepare(cartId,payload,version);
    return this.apply(cartId,prepared.operation.id,prepared.workspace.version);
  }
  async apply(cartId,operationId,version) {return this.locked(version,async state=>{
    const cart=this.findCart(state,cartId),op=cart.operations.find(x=>x.id===operationId);need(op,'OPERATION_MISSING','Select an original prepared operation.',{},404);
    if(op.status!=='PREPARED')return {operation:op,reused:true,workspace:{...state,version:this.read().version}};
    need(this.pending(cart).length===0,'RECONCILE_REQUIRED','An earlier dispatch still requires reconciliation.',{},409);
    const before=await this.refreshIn(state,cart,'before-apply');
    if(before.projection.fingerprint!==op.before_fingerprint){op.status='STALE';op.stale_snapshot=before.id;this.event(state,'operation.stale',{cart_id:cartId,operation_id:op.id});return {operation:op,workspace:this.save(state)};}
    op.status='DISPATCHING';op.dispatch_started_at=now();this.event(state,'operation.dispatching',{cart_id:cartId,operation_id:op.id,plan:op.plan});
    this.save(state); // Durable intent precedes the original SDK request; an interrupted Apply is not replayed.
    const result=await this.request(state,cart.cart_key,op.plan.method,op.plan.endpoint,op.plan.body);
    op.exchanges.push(result.ref);op.response_status=result.response?.statusCode??null;op.completed_at=now();op.error=result.error;
    if(!result.response)op.status='UNCERTAIN';
    else if(!result.response.isSuccessful()||result.error)op.status='NATIVE_REJECTED';
    else {
      op.status='APPLIED';
      try {const after=await this.refreshIn(state,cart,'after-apply');op.after_snapshot=after.id;}
      catch(e){op.status='APPLIED_REFRESH_REQUIRED';op.refresh_error=e.toJSON?.()||{message:e.message};}
    }
    this.event(state,'operation.outcome',{cart_id:cartId,operation_id:op.id,status:op.status});return {operation:op,workspace:this.save(state)};
  });}
  async reconcile(cartId,operationId,payload,version) {return this.locked(version,async state=>{
    const cart=this.findCart(state,cartId),op=cart.operations.find(x=>x.id===operationId);need(op,'OPERATION_MISSING','Select the original operation.',{},404);
    const snapshot=await this.refreshIn(state,cart,'reconciliation');
    op.reconciliations ||= []; const review={id:id('reconciliation'),at:now(),snapshot_id:snapshot.id,current_fingerprint:snapshot.projection.fingerprint,
      before_fingerprint:op.before_fingerprint,decision:payload.decision||'inspect',reason:payload.reason||''};
    need(['inspect','accept_current','confirmed_not_applied'].includes(review.decision),'DECISION_INVALID','Choose inspect, accept_current or confirmed_not_applied.');
    if(review.decision!=='inspect') {
      need(['DISPATCHING','UNCERTAIN','APPLIED_REFRESH_REQUIRED'].includes(op.status),'RESOLUTION_UNNEEDED','This original operation has a recorded final native outcome.');
      need(typeof review.reason==='string'&&review.reason.trim().length>=8&&review.reason.length<=2000,'REASON_REQUIRED','Record the native observation supporting this resolution.');
      op.status=review.decision==='accept_current'?'RESOLVED_CURRENT':'RESOLVED_NOT_APPLIED';op.resolved_at=now();
    }
    op.reconciliations.push(review);this.event(state,'operation.reconciled',{cart_id:cartId,operation_id:op.id,decision:review.decision});
    return {operation:op,snapshot,workspace:this.save(state)};
  });}
  async products(params,version) {return this.locked(version,async state=>{
    const q={page:String(params.page||1),per_page:String(params.per_page||20)};
    need(/^[1-9]\d*$/.test(q.page)&&Number(q.page)<=10000&&/^[1-9]\d*$/.test(q.per_page)&&Number(q.per_page)<=100,'PAGE_INVALID','Choose a valid product page and page size.');
    if(params.search) {need(typeof params.search==='string'&&params.search.length<=200,'SEARCH_INVALID','Use a short product search.');q.search=params.search;}
    const result=await this.request(state,null,'GET','products',null,q);
    need(result.response?.isSuccessful()&&!result.error,'PRODUCT_REQUEST_FAILED','The native product request failed.',{exchange:result.ref,error:result.error},502);
    const data=parseJSON(Buffer.from(result.response.body),'Native product response');
    const products=Array.isArray(data)?data:(Array.isArray(data.products)?data.products:null);
    need(products,'PRODUCT_SHAPE','The original response does not contain a product array.',{exchange:result.ref});
    const catalog={id:id('catalog'),at:now(),query:q,exchange:result.ref,total:result.response.getHeader('X-WP-Total'),total_pages:result.response.getHeader('X-WP-TotalPages'),
      products:products.map(p=>({id:p.id,name:p.name,sku:p.sku,type:p.type,prices:p.prices,price:p.price,in_stock:p.is_in_stock??p.in_stock,permalink:p.permalink}))};
    // Undefined optional vendor fields are omitted by JSON encoding, preserving original body in its object.
    const clean=clone(catalog);state.catalogs.push(clean);this.event(state,'products.loaded',{catalog_id:clean.id,exchange:result.ref.sha256});
    return {catalog:clean,workspace:this.save(state)};
  });}
  async prepareCheckout(cartId,payload,version) {return this.locked(version,async state=>{
    const cart=this.findCart(state,cartId);need(this.pending(cart).length===0,'RECONCILE_REQUIRED','Resolve the original cart dispatch before preparing checkout.',{},409);
    need(['replace','merge'].includes(payload.mode),'LOAD_MODE_REQUIRED','Choose replace or merge explicitly.');
    const snapshot=await this.refreshIn(state,cart,'checkout-preview'),comparison=admission(snapshot.projection,state.profile);
    const u=new URL(state.profile.checkout_url);u.searchParams.set('cocart-load-cart',cart.cart_key);u.searchParams.set('keep-cart',payload.mode==='merge'?'true':'false');u.searchParams.set('notify','1');
    const handoff={schema:'stellar-forge.cocart.checkout-preview.v1',id:id('checkout'),created_at:now(),cart_id:cartId,snapshot_id:snapshot.id,
      cart_fingerprint:snapshot.projection.fingerprint,cart_key:cart.cart_key,source:SOURCE,mode:payload.mode,checkout_url:u.href,admission:comparison,
      storefront:{currency:snapshot.projection.currency,minor_total:snapshot.projection.totals.total,precision:snapshot.projection.precision,total:snapshot.projection.total_display},
      customer_details:'Enter or confirm customer details in the native Woo checkout.',orders:[]};
    cart.handoffs.push(handoff);this.event(state,'checkout.prepared',{cart_id:cartId,handoff_id:handoff.id,mode:payload.mode});
    return {handoff,workspace:this.save(state)};
  });}
  async attachWooHandoff(cartId,previewId,rawBytes,version) {return this.locked(version,async state=>{
    const cart=this.findCart(state,cartId),preview=cart.handoffs.find(x=>x.id===previewId);need(preview,'CHECKOUT_PREVIEW_MISSING','Select the cart checkout preview that produced the Woo order.',{},404);
    const h=validateHandoff(parseJSON(rawBytes,'Original Woo handoff')); // Same maintained validator and native order/intent contract.
    const m=state.profile.gateway_mapping;need(m,'MAPPING_NEEDED','Import the actual saved merchant mapping before receiving its native handoff.');
    need(h.storeOrigin===state.profile.merchant_origin&&h.productId===String(m.productId)&&h.routeId===m.routeId,'WOO_BINDING_MISMATCH','The actual order handoff differs from the selected store/product/route.');
    need(h.storefront.currency===preview.storefront.currency&&decimalToMinor(h.storefront.total,preview.storefront.precision)===minor(preview.storefront.minor_total),'WOO_TOTAL_CHANGED','The native order total differs from the original cart preview.',{cart:preview.storefront,order:h.storefront},409);
    const expect={scheme:'exact',network:m.network,asset:m.asset,payTo:m.payTo,maxAtomic:m.amountAtomic,maxTimeoutSeconds:m.maxTimeoutSeconds};
    need(digest(h.operation.expect)===digest(expect)&&h.operation.method===m.method,'WOO_TERMS_CHANGED','The native order uses different payment terms.',{},409);
    const base=new URL(h.operation.url);base.search='';need(base.href===new URL(m.url).href,'WOO_RESOURCE_CHANGED','The native order uses a different seller resource.');
    const ref=this.storeObject(rawBytes,'original-woo-checkout-handoff'),existing=preview.orders.find(x=>x.source.sha256===ref.sha256);
    if(existing)return {order:existing,reused:true,workspace:{...state,version:this.read().version}};
    const order={id:id('woo-order'),received_at:now(),order_reference:h.orderReference,attempt_generation:h.attemptGeneration,source:ref,store_origin:h.storeOrigin,product_id:h.productId,storefront:h.storefront,
      original_buyer_intent:'woo:'+sha256(h.storeOrigin).slice(0,24)+':'+h.orderReference+':g'+h.attemptGeneration};
    preview.orders.push(order);this.event(state,'woo.handoff_received',{cart_id:cartId,preview_id:previewId,order_reference:h.orderReference,source:ref.sha256});
    return {order,workspace:this.save(state)};
  });}
  async rebindTransport(payload,version) {return this.locked(version,async state=>{
    need(state.profile.transport==='loopback_receiving','TRANSPORT_FIXED','Production profiles keep their selected origin.');
    const old=clone(state.profile),next=validateProfile({...state.profile,store_url:payload.store_url,checkout_url:payload.checkout_url});
    need(loopback(new URL(next.store_url)),'RECEIVING_LOOPBACK_REQUIRED','The receiving transport must remain loopback.');
    state.profile=next;this.event(state,'transport.rebound',{from:{store_url:old.store_url,checkout_url:old.checkout_url},to:{store_url:next.store_url,checkout_url:next.checkout_url},reason:label(payload.reason)});
    return {workspace:this.save(state)};
  });}
  receivingBundle() {
    need(!this.active,'WORKSPACE_BUSY','Finish the active operation before creating a receiving export.',{},409);
    const {state,version}=this.read(); const refs=new Set();
    const scan=v=>{if(Array.isArray(v)){v.forEach(scan);return;}if(!object(v))return;if(typeof v.sha256==='string'&&Number.isSafeInteger(v.bytes)&&typeof v.kind==='string')refs.add(v.sha256);Object.values(v).forEach(scan);};scan(state);
    const objects=[],queue=[...refs];
    for(let i=0;i<queue.length;i++){const hash=queue[i],bytes=this.readObject(hash);objects.push({sha256:hash,bytes:bytes.length,base64:bytes.toString('base64')});
      let decoded;try{decoded=JSON.parse(bytes.toString('utf8'));}catch{continue;}const n=refs.size;scan(decoded);if(refs.size!==n)for(const h of refs)if(!queue.includes(h))queue.push(h);
    }
    const body={schema:RECEIVING_SCHEMA,created_at:now(),source:SOURCE,workspace:state,workspace_version:version,objects};
    return Buffer.from(JSON.stringify({...body,content_sha256:digest(body)},null,2)+'\n');
  }
  static receive({root,bytes,CoCart,MemoryStorage}) {
    const b=inspectReceiving(bytes), {content_sha256}=b;
    const target=resolve(root),markerPath=join(target,'receiving.json');
    if(existsSync(markerPath)) {
      const marker=parseJSON(readFileSync(markerPath),'Receiving marker');
      need(marker.content_sha256===content_sha256&&marker.workspace_version===b.workspace_version,'RECEIVING_INPUT_CHANGED','Continue with the same original receiving input.',{},409);
      if(existsSync(join(target,'workspace.json'))) return new CartWorkspace({root:target,CoCart,MemoryStorage});
    } else {
      need(!existsSync(target)||readdirSync(target).length===0,'DESTINATION_EXISTS','Use an empty directory for the first receiving attempt.',{},409);
    }
    if(!existsSync(markerPath))atomic(markerPath,JSON.stringify({schema:'stellar-forge.cocart.receiving-marker.v1',content_sha256,workspace_version:b.workspace_version,started_at:now()},null,2)+'\n',true);
    for(const o of b.objects) {
      const path=join(target,'objects',o.sha256),bytes=Buffer.from(o.base64,'base64');
      if(existsSync(path))need(sha256(readFileSync(path))===o.sha256,'RECEIVING_OBJECT_DAMAGED','The previously received object has changed.',{sha256:o.sha256});
      else atomic(path,bytes,true);
    }
    atomic(join(target,'workspace.json'),JSON.stringify(b.workspace,null,2)+'\n',true);
    const workspace=new CartWorkspace({root:target,CoCart,MemoryStorage});need(workspace.read().version===b.workspace_version,'RECEIVING_WORKSPACE_CHANGED','The received original workspace bytes differ from its saved revision.');return workspace;
  }
}
