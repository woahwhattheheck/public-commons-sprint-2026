// MIT. SF72 x402 merchant GET-input contract triage.
// Offline only: reads previously captured native Bazaar catalog and SF52 JSON; never fetches, pays, signs, or calls a seller.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const MAX_SOURCE_BYTES = 8_000_000;
const MAX_ROWS = 5_000;
const KEY_LIMIT = 64;
const RESOURCE_LIMIT = 4096;
const IDENT = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

function object(x) {return x !== null && typeof x === 'object' && !Array.isArray(x) ? x : null;}
function str(x) {return typeof x === 'string' ? x : null;}
function validUrl(x) {
  const s = str(x);
  if (!s || s.length > RESOURCE_LIMIT) return null;
  try {
    const u = new URL(s);
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) return null;
    u.hash = '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.href;
  } catch {return null;}
}
function itemResource(item) {
  const resource = item?.resource;
  return validUrl(typeof resource === 'string' ? resource : object(resource)?.url);
}
function safeKeys(list) {
  if (!Array.isArray(list) || list.length > KEY_LIMIT || !list.every(k => typeof k === 'string' && IDENT.test(k))) return null;
  return [...new Set(list)].sort();
}
function schemaInputRequirements(item, requestUrl = null) {
  const bazaar = object(item?.extensions?.bazaar);
  const input = object(bazaar?.info?.input);
  const method = str(input?.method)?.toUpperCase() ?? null;
  const type = str(input?.type) ?? str(item?.type);
  if (type !== 'http' || method !== 'GET') return {declaredMethod:method, declaredType:type, kind:'NON_GET_OR_UNKNOWN'};

  // Native Vellar v2 publishes both queryParams and pathParams at these exact
  // JSON Schema locations. The railway /inspect/:address route uses pathParams.
  const schemaInput = object(bazaar?.schema?.properties?.input?.properties);
  const query = object(schemaInput?.queryParams);
  const path = object(schemaInput?.pathParams);
  const requiredQuery = query && Array.isArray(query.required) ? safeKeys(query.required) : null;
  const requiredPath = path && Array.isArray(path.required) ? safeKeys(path.required) : null;
  const requirementsKnown = requiredQuery !== null || requiredPath !== null;
  const queryKeys = requiredQuery ?? [], pathKeys = requiredPath ?? [];
  const definedQuery = Object.keys(object(query?.properties) || {}).filter(x => IDENT.test(x)).sort().slice(0, KEY_LIMIT);
  const definedPath = Object.keys(object(path?.properties) || {}).filter(x => IDENT.test(x)).sort().slice(0, KEY_LIMIT);
  const inputQueryKeys = Object.keys(object(input?.queryParams) || {}).filter(x => IDENT.test(x)).sort().slice(0, KEY_LIMIT);
  const inputPathKeys = Object.keys(object(input?.pathParams) || {}).filter(x => IDENT.test(x)).sort().slice(0, KEY_LIMIT);
  // No example values are copied, because an example is not a real authorized request.
  let missingQueryKeys = [], unresolvedPathKeys = [];
  if (requestUrl) {
    const requested = new URL(requestUrl);
    missingQueryKeys = queryKeys.filter(k => !requested.searchParams.has(k));
    // Treat only *unresolved template tokens* as missing path values.
    // A concrete /inspect/G... path is not missing merely because the schema
    // declares the parameter "address".
    unresolvedPathKeys = pathKeys.filter(k => requested.pathname.split('/').includes(':'+k));
  }
  const missingForRequest = missingQueryKeys.length > 0 || unresolvedPathKeys.length > 0;
  return {
    declaredMethod:'GET', declaredType:type,
    kind:!requirementsKnown ? 'INPUT_REQUIREMENT_UNKNOWN' :
      queryKeys.length || pathKeys.length ? 'REQUIRED_INPUT_DECLARED' : 'NO_REQUIRED_INPUT_DECLARED',
    requiredQueryKeys:queryKeys, requiredPathKeys:pathKeys,
    propertyQueryKeys:definedQuery, propertyPathKeys:definedPath,
    exampleQueryKeys:inputQueryKeys, examplePathKeys:inputPathKeys,
    missingQueryKeys, unresolvedPathKeys, missingForRequest,
    source:requirementsKnown ? 'extensions.bazaar.schema.properties.input.properties.{queryParams,pathParams}.required' : null
  };
}

function matchesPayment(item, report) {
  const network = str(report?.network), payTo = str(report?.desiredPayTo);
  const options = Array.isArray(item?.accepts) ? item.accepts : [];
  if (!network && !payTo) return true;
  return options.some(x => object(x) && (!network || x.network === network) &&
    (!payTo || str(x.payTo)?.toLowerCase() === payTo.toLowerCase()));
}
export function analyzeNativeCatalog(catalog, sf52 = null, {capturedAt = null, sha256 = null} = {}) {
  const records = Array.isArray(catalog?.items) ? catalog.items : catalog?.resources;
  if (!Array.isArray(records) || records.length > MAX_ROWS) throw new TypeError('Expected original native Bazaar items/resources array');
  if (sf52 !== null && (object(sf52) === null || sf52.schema !== 'stellar-forge.seller-visibility.v1' ||
      sf52.mode !== 'READ_ONLY_UNAUTHENTICATED' || !validUrl(sf52.seller) ||
      !object(sf52.challenge) || !object(sf52.catalog))) {
    throw new TypeError('Expected genuine original SF52 diagnostic report');
  }
  const resourceTarget = sf52 ? validUrl(sf52.seller) : null;
  const rows = records.map(item => ({resource:itemResource(item), item})).filter(x => x.resource &&
    (!resourceTarget || x.resource === resourceTarget) && (!sf52 || matchesPayment(x.item,sf52)));
  const analyzed = rows.map(({resource,item}) => ({resource, ...schemaInputRequirements(item,resourceTarget)}));
  const getRows = analyzed.filter(x => x.declaredMethod === 'GET' && x.declaredType === 'http');
  const everyGetRequiresKeys = getRows.length > 0 && getRows.every(x => x.missingForRequest === true);
  const unknownGetContracts = getRows.filter(x => x.kind === 'INPUT_REQUIREMENT_UNKNOWN').length;
  const queryKeys = [...new Set(getRows.flatMap(x => x.requiredQueryKeys ?? []))].sort();
  const pathKeys = [...new Set(getRows.flatMap(x => x.requiredPathKeys ?? []))].sort();
  // Require one exhaustive original provider snapshot, not an arbitrary first
  // page mislabeled complete by some other crawl. Live Vellar declares 27/27.
  const declaredTotal = catalog?.pagination?.total;
  const nativeCatalogComplete = Number.isSafeInteger(declaredTotal) && declaredTotal >= 0 && records.length === declaredTotal;
  const alignedWithSF52 = sf52?.catalog?.rawRows === undefined || sf52?.catalog?.rawRows === records.length;
  const complete = sf52?.catalog?.complete === true && nativeCatalogComplete && alignedWithSF52;
  const bareGet = sf52 ? (new URL(sf52.seller).search === '') : false;
  const challenge = sf52?.challenge ?? null;
  const badRequest = challenge?.state === 'NOT_HTTP_402' && challenge?.httpStatus === 400;
  // Never assert that a 400 was CAUSED by missing parameters: it might reflect unrelated validation.
  const classified = badRequest && complete && everyGetRequiresKeys ?
    'GET_400_WITH_DECLARED_MISSING_INPUT' : badRequest ? 'GET_400_CAUSE_UNRESOLVED' :
    challenge ? 'NO_400_RECLASSIFICATION' : 'SCHEMA_ONLY';
  const noResponseProof = 'Catalog input metadata is a declared contract, not evidence that seller fulfillment, payment or checkout works.';
  const next = classified === 'GET_400_WITH_DECLARED_MISSING_INPUT' ?
    'The original GET returned HTTP 400 and every matched GET contract has at least one required query key or unresolved path template. This does not establish the cause of the HTTP 400 or a checkout failure. Ask the seller for an authorized valid request and independently inspect its unpaid 402 challenge.' :
    classified === 'GET_400_CAUSE_UNRESOLVED' ?
    'An HTTP 400 was observed, but an exhaustive aligned input contract with actual missing parameters was not established. Preserve the original severity and request the actual seller API contract.' :
    'No original bare-GET HTTP 400 was provided. Input requirements are documentation, not a new seller-liveness verdict.';
  const result = {
    schema:'stellar-forge.sf72.merchant-get-input.v1', mode:'OFFLINE_SOURCE_ONLY',
    generatedFrom:{catalogCapturedAt:capturedAt, originalCatalogSha256:sha256},
    targetSeller:resourceTarget, nativeCatalogRows:records.length, nativeDeclaredTotal:Number.isSafeInteger(declaredTotal)?declaredTotal:null,
    nativeCatalogComplete,alignedWithSF52, originalRequestIsBareGet:bareGet, matchedPaymentRows:analyzed.length,
    matchedGetOperations:getRows.length, unknownGetContracts, allMatchedGetRequireInput:everyGetRequiresKeys,
    catalogCompleteFromSF52:complete, originalSF52Status:challenge?.state ?? null,
    originalSF52HttpStatus:challenge?.httpStatus ?? null,
    originalCatalogVerdict:sf52?.verdict ?? null,
    declaredRequiredQueryKeyUnion:queryKeys, declaredRequiredPathKeyUnion:pathKeys, triage:classified,
    explanation:next, caveat:noResponseProof,
    operations:analyzed.map(({resource,kind,requiredQueryKeys=[],requiredPathKeys=[],propertyQueryKeys=[],
      propertyPathKeys=[],exampleQueryKeys=[],examplePathKeys=[],missingQueryKeys=[],unresolvedPathKeys=[],
      source,declaredMethod,declaredType})=>({resource,declaredType,declaredMethod,kind,
      requiredQueryKeys,requiredPathKeys,propertyQueryKeys,propertyPathKeys,exampleQueryKeys,
      examplePathKeys,missingQueryKeys,unresolvedPathKeys,source:source??null})),
    exclusions:['No outbound HTTP requests','No paid seller invocation or wallet','No confidential example parameter values','No modification to original SF52 evidence']
  };
  return result;
}

export function renderMerchantHtml(result) {
  const h = x => String(x ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const rows = result.operations.map(x => `<tr><td>${h(x.resource)}</td><td>${h(x.declaredMethod||'Unknown')}</td><td>${h(x.kind)}</td><td>${h(x.requiredQueryKeys.join(', ')||'None declared')}</td><td>${h(x.requiredPathKeys.join(', ')||'None declared')}</td><td>${h([...x.missingQueryKeys,...x.unresolvedPathKeys].join(', ')||'Not established')}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Merchant input triage · SF72</title><style>body{max-width:1080px;margin:3rem auto;padding:0 1rem;font:16px/1.55 system-ui;color:#182336;background:#f8fafc}h1{line-height:1.2}header,p,aside{max-width:70ch}.chip{display:inline-block;background:#e5ecfa;border-radius:99px;padding:.35rem .8rem}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;border-bottom:1px solid #dbe3ee;padding:.7rem;word-break:break-word}th{background:#eef3fc}aside{padding:1rem;border-left:4px solid #385d94;background:#fff}small{color:#4c596f}</style><header><small>Stellar Forge · SCF merchant integration</small><h1>Required-input diagnosis</h1><p class="chip">${h(result.triage)}</p><p>${h(result.explanation)}</p></header><p><strong>Seller:</strong> ${h(result.targetSeller || 'Catalogue-wide')} · <strong>Matched offers:</strong> ${result.matchedPaymentRows} · <strong>GET operations:</strong> ${result.matchedGetOperations} · <strong>Original HTTP status:</strong> ${h(result.originalSF52HttpStatus ?? 'not supplied')}</p><h2>Declared operation contracts</h2><table><thead><tr><th>Resource</th><th>HTTP method</th><th>Metadata</th><th>Required query</th><th>Required path</th><th>Missing from request</th></tr></thead><tbody>${rows}</tbody></table><aside><strong>Interpretation boundary</strong><p>${h(result.caveat)}</p></aside></html>`;
}

async function loadJson(filename) {
  const bytes = await readFile(filename);
  if (bytes.length > MAX_SOURCE_BYTES) throw new RangeError('Source file exceeds 8 MB input limit');
  return {data:JSON.parse(bytes.toString('utf8')),sha256:createHash('sha256').update(bytes).digest('hex')};
}
async function main(argv) {
  let catalogFile = null, sf52File = null, jsonOut = null, htmlOut = null;
  for (let i=0;i<argv.length;i++) {
    const key=argv[i], val=argv[++i];
    if (!['--catalog','--sf52','--json-out','--html-out'].includes(key) || !val || val.startsWith('--')) throw new Error('Usage: node input-hints.mjs --catalog native.json [--sf52 original-sf52.json] [--json-out result.json] [--html-out report.html]');
    ({'--catalog':x=>catalogFile=x,'--sf52':x=>sf52File=x,'--json-out':x=>jsonOut=x,'--html-out':x=>htmlOut=x})[key](val);
  }
  if (!catalogFile) throw new Error('--catalog original native provider JSON is required');
  const catalog = await loadJson(catalogFile);
  const sf52 = sf52File ? (await loadJson(sf52File)).data : null;
  const result = analyzeNativeCatalog(catalog.data,sf52,{sha256:catalog.sha256});
  const json = JSON.stringify(result,null,2)+'\n';
  if (jsonOut) await writeFile(jsonOut,json);else process.stdout.write(json);
  if (htmlOut) await writeFile(htmlOut,renderMerchantHtml(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(e=>{process.stderr.write('SF72: '+e.message+'\n');process.exitCode=1;});
