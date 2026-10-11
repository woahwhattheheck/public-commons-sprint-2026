// SF56: read-only, source-connected Vellar x402 Bazaar catalog comparison.
// This module never sends payment, signature, seller-resource or facilitator mutation requests.
import { createHash } from 'node:crypto';

export const PROVIDER = 'https://vellar-facilitator-testnet-production.up.railway.app';
export const NETWORK = 'stellar:testnet';
const LIMIT = 100;
const MAX_PAGES = 200;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const I128_MAX = (1n << 127n) - 1n;
const CONTRACT = /^C[A-Z2-7]{55}$/;
const ACCOUNT = /^G[A-Z2-7]{55}$/;

function obj(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function boundedString(value, max = 2048) { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function cleanStr(value, max = 1024) { return boundedString(value, max) ? value : ''; }
function hexSha(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }
function stableSort(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function resourceUrl(input) {
  if (!boundedString(input, 2048)) return null;
  try {
    const u = new URL(input);
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password || u.hash) return null;
    if (/\.$/.test(u.hostname) || u.hostname === 'localhost' || u.hostname.endsWith('.localhost')) return null;
    // Deliberately do not resolve or GET the merchant host. URL shape does not establish merchant authority.
    return u.href;
  } catch { return null; }
}

function atomicAmount(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,38}$/.test(value)) return false;
  try { return BigInt(value) <= I128_MAX; } catch { return false; }
}

function canonicalMethod(row) {
  const m = row?.extensions?.bazaar?.info?.input?.method;
  return typeof m === 'string' && /^[A-Z]{3,7}$/.test(m) ? m : null;
}

export function inspectListing(row, rowIndex, network = NETWORK) {
  const errors = [];
  if (!obj(row)) return { offers: [], quarantine: { index: rowIndex, resource: null, reasons: ['NOT_OBJECT'] } };
  const url = resourceUrl(row.resource);
  if (!url) errors.push('INVALID_RESOURCE_URL');
  if (row.x402Version !== 2) errors.push('NOT_X402_V2');
  if (row.type !== 'http') errors.push('NOT_HTTP_RESOURCE');
  const method = canonicalMethod(row);
  if (!method) errors.push('MISSING_BAZAAR_HTTP_METHOD');
  if (!Array.isArray(row.accepts) || row.accepts.length === 0 || row.accepts.length > 30) errors.push('INVALID_ACCEPTS');
  const routes = [];
  const sameOptionFingerprints = new Set();
  if (Array.isArray(row.accepts) && row.accepts.length <= 30) {
    row.accepts.forEach((a, optionIndex) => {
      if (!obj(a)) { errors.push(`OPTION_${optionIndex}_NOT_OBJECT`); return; }
      if (a.network !== network) return;
      if (a.scheme !== 'exact') { errors.push(`OPTION_${optionIndex}_UNSUPPORTED_SCHEME`); return; }
      if (!CONTRACT.test(a.asset ?? '')) errors.push(`OPTION_${optionIndex}_ASSET_SHAPE`);
      if (!ACCOUNT.test(a.payTo ?? '')) errors.push(`OPTION_${optionIndex}_PAYTO_SHAPE`);
      if (!atomicAmount(a.amount)) errors.push(`OPTION_${optionIndex}_ATOMIC_AMOUNT`);
      if (!CONTRACT.test(a.asset ?? '') || !ACCOUNT.test(a.payTo ?? '') || !atomicAmount(a.amount)) return;
      const tuple = [a.network, a.scheme, a.asset, a.amount, a.payTo].join('|');
      if (sameOptionFingerprints.has(tuple)) errors.push(`OPTION_${optionIndex}_DUPLICATE`);
      sameOptionFingerprints.add(tuple);
      routes.push({ network: a.network, scheme: a.scheme, asset: a.asset, amount: a.amount, payTo: a.payTo });
    });
  }
  if (errors.length) return { offers: [], quarantine: { index: rowIndex, resource: cleanStr(row.resource), reasons: errors } };
  const display = {
    resource: url, method, serviceName: cleanStr(row.serviceName, 180) || new URL(url).hostname,
    description: cleanStr(row.description, 700), tags: Array.isArray(row.tags) ? row.tags.filter(x => cleanStr(x, 70)).slice(0, 12) : [],
    lastUpdated: Number.isFinite(Date.parse(row.lastUpdated)) ? new Date(row.lastUpdated).toISOString() : null,
    // Provider-published trust metadata is shown as-is, never elevated to independently verified status.
    providerOwnerVerified: row.trust?.ownerVerified === true,
    providerVerification: cleanStr(row.trust?.verification, 80) || 'unknown'
  };
  return { offers: routes.map(r => ({ ...display, ...r })), quarantine: null };
}

function vendorPayload(item) {
  // The original HTTP bytes are authoritative when both a raw body and an
  // independently derived payload are present. Never inspect a substituted
  // flattened payload while hashing different source bytes.
  if (obj(item) && typeof item.body === 'string') return JSON.parse(item.body);
  if (obj(item) && obj(item.payload)) return item.payload;
  return item;
}

// Vellar's first-party x402 v2 discovery has pagination.total, while early
// local fixtures used a flat total. Preserve both without rewriting the
// original response or manufacturing a declared count.
function declaredPageTotal(page, offset) {
  if (page.pagination !== undefined) {
    if (!obj(page.pagination)) throw Error('Invalid provider pagination metadata');
    if (page.pagination.offset !== undefined && page.pagination.offset !== offset)
      throw Error('Provider pagination offset mismatch');
    if (page.pagination.limit !== undefined && page.pagination.limit !== LIMIT)
      throw Error('Provider pagination limit mismatch');
  }
  const flat = page.total, native = page.pagination?.total;
  if (flat !== undefined && native !== undefined && flat !== native)
    throw Error('Conflicting provider totals');
  const total = flat ?? native;
  if (!Number.isSafeInteger(total) || total < 0)
    throw Error('Missing safe provider pagination total');
  return total;
}

export function analyzePages(pages, { source = PROVIDER, network = NETWORK, capturedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_PAGES) throw Error('Invalid page count');
  if (source !== PROVIDER || network !== NETWORK) throw Error('Wrong provider or network');
  const observed = Number.isFinite(Date.parse(capturedAt)) ? new Date(capturedAt).toISOString() : null;
  if (!observed) throw Error('Invalid capturedAt');
  const quarantined = [], offers = [], seenResource = new Set(), pageHashes = [];
  let expectedTotal = null, scanned = 0;
  for (const [i, item] of pages.entries()) {
    const page = vendorPayload(item);
    if (!obj(page) || !Array.isArray(page.items)) throw Error(`Vellar page ${i} must have items[]`);
    if (page.items.length > LIMIT) throw Error(`Vellar page ${i} exceeds page limit`);
    const offset = item?.offset ?? i * LIMIT;
    if (!Number.isSafeInteger(offset) || offset !== i * LIMIT) throw Error('Missing or out-of-order page offset');
    const total = declaredPageTotal(page, offset);
    if (expectedTotal !== null && expectedTotal !== total) throw Error('Total changed during pagination');
    expectedTotal = total;
    const bytes = typeof item?.body === 'string' ? Buffer.byteLength(item.body, 'utf8') : Buffer.byteLength(JSON.stringify(page), 'utf8');
    if (bytes > MAX_PAGE_BYTES) throw Error('Oversized provider page');
    pageHashes.push({ offset, sha256: hexSha(typeof item?.body === 'string' ? item.body : JSON.stringify(page)), bytes });
    for (const row of page.items) {
      const inspected = inspectListing(row, scanned, network);
      const url = typeof row?.resource === 'string' ? row.resource : `missing-index-${scanned}`;
      if (seenResource.has(url)) {
        quarantined.push({ index: scanned, resource: url, reasons: ['DUPLICATE_RESOURCE_ACROSS_PAGES'] });
      } else {
        seenResource.add(url);
        if (inspected.quarantine) quarantined.push(inspected.quarantine);
        else offers.push(...inspected.offers);
      }
      scanned++;
    }
  }
  // If actual captures are truncated or provider mutates under offset pagination, do not publish a complete snapshot.
  if (scanned !== expectedTotal) throw Error(`Incomplete original provider snapshot: fetched ${scanned}, declared ${expectedTotal}`);
  const ids = new Set();
  for (const o of offers) {
    const id = offerId(o);
    if (ids.has(id)) throw Error('Duplicate canonical payment option');
    ids.add(id);
  }
  offers.sort((a,b) => stableSort(a.resource, b.resource) || stableSort(offerId(a),offerId(b)));
  return { schemaVersion: 1, source, network, capturedAt: observed, declaredTotal: expectedTotal,
    rowCount: scanned, offerCount: offers.length, quarantinedCount: quarantined.length, pageHashes, offers, quarantined,
    canApprovePayment: false, sourceTrust: 'third_party_advertised_not_wallet_verified' };
}

export function offerId(o) { return [o.resource, o.method, o.network, o.scheme, o.asset, o.amount, o.payTo].join('|'); }
function offerFamily(o) { return [o.resource, o.method, o.network, o.scheme, o.asset].join('|'); }

export function diffSnapshots(before, after) {
  if (!obj(before) || !obj(after) || before.schemaVersion !== 1 || after.schemaVersion !== 1 ||
    before.source !== PROVIDER || after.source !== PROVIDER || before.network !== NETWORK || after.network !== NETWORK ||
    !Array.isArray(before.offers) || !Array.isArray(after.offers)) throw Error('Incompatible source snapshots');
  const prior = new Map(before.offers.map(o => [offerId(o), o]));
  const current = new Map(after.offers.map(o => [offerId(o), o]));
  if (prior.size !== before.offers.length || current.size !== after.offers.length) throw Error('Duplicate options in snapshot');
  const additions = after.offers.filter(o => !prior.has(offerId(o)));
  const removals = before.offers.filter(o => !current.has(offerId(o)));
  const oldFamilies = new Map(), newFamilies = new Map();
  for (const o of removals) { const k=offerFamily(o); oldFamilies.set(k,[...(oldFamilies.get(k)||[]),o]); }
  for (const o of additions) { const k=offerFamily(o); newFamilies.set(k,[...(newFamilies.get(k)||[]),o]); }
  const changes=[]; const usedOld = new Set(), usedNew = new Set();
  for (const [family, newRows] of newFamilies) {
    const oldRows=oldFamilies.get(family) || [];
    // Pair only unique same-resource/method/network/scheme/asset options; never match amounts/payees across unrelated routes.
    if (oldRows.length === 1 && newRows.length === 1) {
      const a=oldRows[0], b=newRows[0];
      const kinds=[];
      if (a.amount !== b.amount) kinds.push('PRICE_CHANGED');
      if (a.payTo !== b.payTo) kinds.push('PAYEE_CHANGED');
      if (kinds.length) { changes.push({ kind:kinds.join('+'), resource:b.resource, method:b.method, asset:b.asset,
        previousAmount:a.amount, currentAmount:b.amount, previousPayTo:a.payTo, currentPayTo:b.payTo });
        usedOld.add(offerId(a)); usedNew.add(offerId(b)); }
    } else if (oldRows.length && newRows.length) {
      changes.push({ kind:'AMBIGUOUS_MULTIOFFER_CHANGED', resource:newRows[0].resource, optionCountBefore:oldRows.length, optionCountAfter:newRows.length });
    }
  }
  const newOffers=additions.filter(o=>!usedNew.has(offerId(o)));
  const removedOffers=removals.filter(o=>!usedOld.has(offerId(o)));
  changes.sort((a,b)=>stableSort(a.resource,b.resource));
  return { schemaVersion:1, source:PROVIDER, network:NETWORK, beforeCapturedAt:before.capturedAt,
    afterCapturedAt:after.capturedAt, summary:{ previousOffers:before.offerCount, currentOffers:after.offerCount,
    changed:changes.length, newOffers:newOffers.length, removedOffers:removedOffers.length,
    quarantined:after.quarantinedCount }, changes, newOffers, removedOffers, quarantined:after.quarantined,
    canApprovePayment:false };
}

async function boundedResponse(response) {
  if (!response.ok || response.status !== 200) throw Error(`Discovery GET returned HTTP ${response.status}`);
  const type=response.headers.get('content-type')||'';
  if (!type.toLowerCase().includes('json')) throw Error('Discovery response is not JSON');
  const reader=response.body?.getReader();
  if (!reader) throw Error('Discovery returned no body');
  let bytes=0; const chunks=[];
  try { while (true) { const {done,value}=await reader.read(); if(done) break; bytes+=value.byteLength;
    if(bytes>MAX_PAGE_BYTES) { await reader.cancel(); throw Error('Oversized streamed provider page'); }
    chunks.push(value); } } finally { reader.releaseLock(); }
  const all=Buffer.concat(chunks.map(x=>Buffer.from(x)),bytes);
  const body=all.toString('utf8');
  if (!Buffer.from(body,'utf8').equals(all)) throw Error('Non-UTF8 provider page');
  return body;
}

export async function fetchVellar({ fetchImpl = globalThis.fetch, timeoutMs = 25_000,
  capturedAt = new Date().toISOString() } = {}) {
  if (typeof fetchImpl !== 'function') throw Error('Missing fetch');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 90_000) throw Error('Invalid timeout');
  const pages=[];
  let declaredTotal=null;
  for(let offset=0;offset<MAX_PAGES*LIMIT;offset+=LIMIT) {
    const url=new URL('/discovery/resources', PROVIDER);
    url.searchParams.set('network',NETWORK);url.searchParams.set('limit',String(LIMIT));url.searchParams.set('offset',String(offset));
    const response=await fetchImpl(url.href,{method:'GET',redirect:'error',headers:{accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});
    const body=await boundedResponse(response);
    let payload;try{payload=JSON.parse(body);}catch{throw Error('Malformed discovery JSON');}
    if (!obj(payload) || !Array.isArray(payload.items)) throw Error('Malformed Vellar pagination envelope');
    let total;
    try { total = declaredPageTotal(payload, offset); }
    catch (error) { throw Error(`Malformed Vellar pagination envelope: ${error.message}`); }
    if (declaredTotal !== null && declaredTotal !== total) throw Error('Provider total changed across pages');
    declaredTotal = total;
    pages.push({offset,body,payload,requestUrl:url.href});
    if(offset+payload.items.length>=declaredTotal) break;
    if(payload.items.length!==LIMIT) throw Error('Premature short page');
  }
  if(pages.reduce((s,p)=>s+p.payload.items.length,0)!==declaredTotal) throw Error('Pagination incomplete');
  return {pages, snapshot:analyzePages(pages,{capturedAt})};
}

const escapeHtml=(value)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function rowCells(values) { return `<tr>${values.map(x=>`<td>${escapeHtml(x)}</td>`).join('')}</tr>`; }
export function renderReportHtml(snapshot, delta = null) {
  const offers=snapshot.offers;
  const changes=delta?.changes||[];
  const cards = [['Resource rows',snapshot.rowCount],['Matching exact offers', snapshot.offerCount],['Quarantined',snapshot.quarantinedCount],['Quote changes',changes.length]];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>SF56 · Stellar Bazaar quote review</title><style>
  :root{font-family:ui-sans-serif,system-ui,sans-serif;color-scheme:dark;background:#101722;color:#e9f0f7}*{box-sizing:border-box}body{max-width:1340px;margin:0 auto;padding:32px 24px 70px}h1{font-size:clamp(28px,5vw,42px);margin:10px 0}h2{margin-top:44px;font-size:21px}p,.muted{color:#a7b6c6;line-height:1.6}small{color:#9babbd}.eyebrow{letter-spacing:.17em;text-transform:uppercase;color:#65dcce;font-weight:700;font-size:12px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:28px 0}.stat{border:1px solid #2d4054;border-radius:12px;padding:19px;background:#172332}.stat strong{font-size:32px;display:block;line-height:1.3}.stat span{color:#9eb1c4;font-size:13px}.warning{background:#362817;border-left:4px solid #ffca70;padding:16px 20px;border-radius:6px;color:#ffe5ae}table{border-collapse:collapse;width:100%;min-width:800px;text-align:left}td,th{border-bottom:1px solid #273749;padding:12px 10px;vertical-align:top;overflow-wrap:anywhere;font-size:13px}th{color:#75dccd;font-size:12px;text-transform:uppercase;letter-spacing:.06em}code{color:#b5d5ed}section{overflow:auto}.small{font-size:12px}footer{margin-top:45px;border-top:1px solid #293c4e;padding-top:24px;color:#a7b6c6}</style></head><body>
  <div class="eyebrow">Stellar Forge / SF56 / independent provider</div><h1>Live Bazaar quote review</h1>
  <p>Third-party advertised Stellar testnet discovery, compared without touching seller URLs or executing a wallet operation.</p>
  <p class="small">Source: ${escapeHtml(snapshot.source)} · Network: ${escapeHtml(snapshot.network)} · Captured ${escapeHtml(snapshot.capturedAt)}</p>
  <div class="warning"><b>Inspection only.</b> Listings and provider trust indicators do not prove merchant ownership, availability, payable quotes, authorization or settlement. Every payment remains disabled; human review and original x402 validation are required.</div>
  <div class="summary">${cards.map(([k,v])=>`<div class="stat"><strong>${escapeHtml(v)}</strong><span>${escapeHtml(k)}</span></div>`).join('')}</div>
  ${delta?`<h2>Changes since ${escapeHtml(delta.beforeCapturedAt)}</h2><p>${escapeHtml(delta.summary.newOffers)} new offers · ${escapeHtml(delta.summary.removedOffers)} removed offers · ${escapeHtml(delta.summary.changed)} changed families. Changed payee or amount requires independent quote re-approval.</p><section><table><thead><tr><th>Change</th><th>Resource</th><th>Before</th><th>After</th></tr></thead><tbody>${changes.map(c=>rowCells([c.kind,c.resource,`${c.previousAmount||''} ${c.previousPayTo||''}`,`${c.currentAmount||''} ${c.currentPayTo||''}`])).join('')||'<tr><td colspan="4">No uniquely matchable price/payee changes.</td></tr>'}</tbody></table></section>`:''}
  <h2>Advertised offers</h2><section><table><thead><tr><th>Service</th><th>Resource URL</th><th>Method</th><th>Asset</th><th>Atomic amount</th><th>Payee</th><th>Provider trust</th></tr></thead><tbody>${offers.map(o=>rowCells([o.serviceName,o.resource,o.method,o.asset,o.amount,o.payTo,`${o.providerVerification}; owner verified=${o.providerOwnerVerified}`])).join('')||'<tr><td colspan="7">No matching clean offers.</td></tr>'}</tbody></table></section>
  <h2>Quarantine review</h2><section><table><thead><tr><th>Index</th><th>Advertised URL</th><th>Reasons</th></tr></thead><tbody>${snapshot.quarantined.map(q=>rowCells([q.index,q.resource,q.reasons.join(', ')])).join('')||'<tr><td colspan="3">No structurally quarantined rows.</td></tr>'}</tbody></table></section>
  <footer>Read-only source data. Raw provider capture hashes and complete parsed snapshot are in the accompanying JSON, not embedded as executable markup. No JavaScript, cookies, analytics, outbound requests, or payment buttons.</footer></body></html>`;
}
