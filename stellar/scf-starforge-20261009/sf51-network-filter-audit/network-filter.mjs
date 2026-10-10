// MIT. SF-51: analyze ORIGINAL Bazaar GET capture bytes, no HTTP or payments.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const SCHEMA = 'stellar-scf51/network-filter-original-response-v1';
const sha = raw => createHash('sha256').update(raw).digest('hex');
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const failure = (code, detail) => { throw new Error(code + (detail ? ': ' + detail : '')); };
const stamp = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) && /^\d{4}-\d\d-\d\dT/.test(x);

export function rawPage(bytes) {
  const raw = Buffer.from(bytes);
  if (raw.length > 64 * 1024 * 1024) failure('PAGE_TOO_LARGE');
  let doc;
  try { doc = JSON.parse(raw.toString('utf8')); } catch { failure('PAGE_INVALID_JSON'); }
  if (!obj(doc)) failure('PAGE_NOT_OBJECT');
  const items = Array.isArray(doc.items) ? doc.items : Array.isArray(doc.resources) ? doc.resources : null;
  if (!items) failure('PAGE_ITEMS_MISSING');
  const total = doc.pagination?.total;
  if (total !== undefined && (!Number.isSafeInteger(total) || total < 0)) failure('PAGE_TOTAL_INVALID');
  return { doc, items, raw_sha256: sha(raw), bytes: raw.length, total: total ?? null };
}

export function validatePairUrls(filteredUrl, controlUrl, network) {
  if (typeof network !== 'string' || !/^[a-z0-9][a-z0-9.-]*:[A-Za-z0-9._-]+$/.test(network)) failure('NETWORK_CAIP2_INVALID');
  let filtered, control;
  try { filtered = new URL(filteredUrl); control = new URL(controlUrl); }
  catch { failure('SOURCE_URL_INVALID'); }
  if (filtered.protocol !== 'https:' || control.protocol !== 'https:' ||
    filtered.username || control.username || filtered.password || control.password ||
    filtered.hash || control.hash || !filtered.pathname.endsWith('/discovery/resources') ||
    filtered.origin !== control.origin || filtered.pathname !== control.pathname) {
    failure('SOURCE_PAIR_NOT_SAME_HTTPS_DISCOVERY');
  }
  if (filtered.searchParams.getAll('network').length !== 1 ||
    filtered.searchParams.get('network') !== network ||
    control.searchParams.getAll('network').length !== 1 ||
    control.searchParams.get('network') === network) failure('SOURCE_PAIR_NETWORK_FILTER_INVALID');
  const other = url => [...url.searchParams.entries()]
    .filter(([k]) => k !== 'network').sort(([ak,av],[bk,bv]) => (ak+av).localeCompare(bk+bv));
  if (JSON.stringify(other(filtered)) !== JSON.stringify(other(control))) failure('SOURCE_PAIR_OTHER_PARAMS_DIFFER');
  if (!['',null].includes(filtered.searchParams.get('offset')) &&
    !/^\d+$/.test(filtered.searchParams.get('offset'))) failure('OFFSET_INVALID');
  return { filtered_url:filtered.href, control_url:control.href,
    expected_network:network, control_network:control.searchParams.get('network') };
}

export function eligibleNetworkOffers(row, network) {
  if (!obj(row) || !Array.isArray(row.accepts)) return [];
  return row.accepts.filter(t => obj(t) && t.network === network);
}

export function selectNetworkResources(items, network) {
  if (!Array.isArray(items)) failure('INVALID_RESOURCE_LIST');
  // This is a network-only eligibility filter. Auth, asset/amount, seller,
  // price freshness, and payment authorization are separate requirements.
  return items.filter(row => eligibleNetworkOffers(row,network).length > 0)
    .map(row => ({ ...structuredClone(row), accepts: structuredClone(eligibleNetworkOffers(row,network)) }));
}

function sameIdentities(a, b) {
  const ids = p => p.items.map(r => JSON.stringify([r?.type ?? null,r?.resource ?? null,
    r?.extensions?.bazaar?.info?.input?.toolName ?? null]));
  return JSON.stringify(ids(a)) === JSON.stringify(ids(b));
}

export function auditPair({ filteredBytes, controlBytes, filteredUrl, controlUrl, network,
  filteredAt, controlAt }) {
  const source = validatePairUrls(filteredUrl,controlUrl,network);
  if (!stamp(filteredAt) || !stamp(controlAt)) failure('CAPTURE_TIME_INVALID');
  const filtered = rawPage(filteredBytes), control = rawPage(controlBytes);
  const anomalies=[];
  for (const [index,row] of filtered.items.entries()) {
    if (!obj(row) || !Array.isArray(row.accepts) || !row.accepts.length) {
      anomalies.push({index,reason:'MISSING_ACCEPTS',resource:obj(row)?row.resource??null:null});
    } else if (!eligibleNetworkOffers(row,network).length) {
      anomalies.push({index,reason:'NO_REQUESTED_NETWORK',resource:row.resource??null,
        offered_networks:[...new Set(row.accepts.filter(obj).map(x=>x.network??null))]});
    }
  }
  const safe = selectNetworkResources(filtered.items,network);
  const countSame = sameIdentities(filtered,control);
  const identicalByteSha = filtered.raw_sha256 === control.raw_sha256;
  const equalTotal = filtered.total !== null && filtered.total === control.total;
  return {
    schema:SCHEMA,kind:'read-only-original-provider-filter-audit',
    specification:'https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md',
    source:{...source,filtered_captured_at:new Date(filteredAt).toISOString(),
      control_captured_at:new Date(controlAt).toISOString(),
      filtered_sha256:filtered.raw_sha256,control_sha256:control.raw_sha256,
      filtered_bytes:filtered.bytes,control_bytes:control.bytes},
    observed:{requested_network:network,filtered_rows:filtered.items.length,
      filtered_total:filtered.total,control_rows:control.items.length,
      control_total:control.total,matching_network_rows:safe.length,
      nonmatching_rows:anomalies.length,same_page_identities:countSame,
      identical_raw_page_bytes:identicalByteSha,equal_pagination_total:equalTotal},
    finding:anomalies.length ? 'RETURNED_ROWS_WITHOUT_REQUESTED_NETWORK' :
      filtered.items.length ? 'OBSERVED_FILTERED_PAGE_COMPATIBLE' : 'EMPTY_FILTERED_PAGE',
    anomalies,
    buyer_safe_candidates:safe.map(r=>({resource:r.resource??null,
      type:r.type??null,tool_name:r.extensions?.bazaar?.info?.input?.toolName??null,
      matching_accepts:r.accepts.length})),
    caveat:'This evaluates supplied captured original GET page bytes only. A network match is necessary, not sufficient, to purchase: authenticate seller/recipient/asset/price and apply the user spend governor. No origin purchase, verify, settle, Stellar transaction, or grant eligibility claim.'
  };
}

const option = (a,key) => {const i=a.indexOf(key);return i<0?null:a[i+1];};
const required=(a,key)=>option(a,key)||failure('MISSING_OPTION',key);

export async function cli(a=process.argv.slice(2)) {
  if (a.includes('--help')) {
    process.stdout.write('node network-filter.mjs --filtered raw-stellar.json --control raw-base.json --filtered-url https://host/discovery/resources?network=stellar%3Atestnet\&limit=2 --control-url https://host/discovery/resources?network=eip155%3A8453\&limit=2 --network stellar:testnet --filtered-at 2026-10-10T06:00:00Z --control-at 2026-10-10T06:00:10Z --out report.json\n');
    return 0;
  }
  const result=auditPair({
    filteredBytes:await readFile(required(a,'--filtered')),
    controlBytes:await readFile(required(a,'--control')),
    filteredUrl:required(a,'--filtered-url'),controlUrl:required(a,'--control-url'),
    network:required(a,'--network'),filteredAt:required(a,'--filtered-at'),
    controlAt:required(a,'--control-at')
  });
  await writeFile(required(a,'--out'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify({finding:result.finding,...result.observed,
    source:result.source.filtered_url},null,2)+'\n');
  // Audit is a reporter: non-compliance is a finding, not a silent runtime exception.
  // Downstream CI/operator can choose to fail on finding via the JSON field.
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch(error=>{process.stderr.write('SF51: '+String(error.message||error)+'\n');process.exitCode=2;});
}
