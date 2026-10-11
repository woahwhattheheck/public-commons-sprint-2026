// MIT. Read-only SF30 runtime evidence packaging; does not call paid routes or a wallet.
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { supportsSellerMethod } from '../sf30-seller-sdk/http-methods.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 2_000_000;
const MAX_ROUTES = 103;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const iso = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const positive = n => Number.isSafeInteger(n) && n >= 0;
const invalid = reason => { throw new Error('SF93_SOURCE_INVALID: ' + reason); };
const text = value => String(value).replaceAll('|', '\\|').replace(/[\r\n\t]/g, ' ').replace(/[<>]/g, '');
const tableCell = value => text(value ?? 'n/a');

function loopbackOrigin(input, field) {
  let url;
  try { url = new URL(input); } catch { throw new TypeError(`${field} must be an explicit loopback HTTP origin`); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      !/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535 ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      input !== url.origin) {
    throw new TypeError(`${field} must be http://127.0.0.1:PORT with no path, query, credentials or fragment`);
  }
  return url.origin;
}

async function readLocal(origin, path, contentType) {
  const address = new URL(path, origin);
  const bytes = await new Promise((done, fail) => {
    const req = request(address, { method: 'GET', agent: false, timeout: 5000,
      headers: { accept: contentType, 'accept-encoding': 'identity' } }, res => {
      if (res.statusCode !== 200 || !String(res.headers['content-type'] ?? '').startsWith(contentType)) {
        res.resume(); fail(new Error(`SF93_ENDPOINT: ${path} returned HTTP ${res.statusCode} or unexpected type`)); return;
      }
      const chunks = []; let total = 0;
      res.on('data', b => {
        total += b.length;
        if (total > MAX_BYTES) { req.destroy(new Error(`SF93_SIZE: ${path} exceeds ${MAX_BYTES} bytes`)); return; }
        chunks.push(b);
      });
      res.once('end', () => done(Buffer.concat(chunks)));
      res.once('error', fail);
      res.once('aborted', () => fail(new Error(`SF93_ENDPOINT: ${path} aborted`)));
    });
    req.once('timeout', () => req.destroy(new Error(`SF93_TIMEOUT: ${path}`)));
    req.once('error', fail);
    req.end();
  });
  return { bytes, sha256: sha256(bytes), at: new Date().toISOString() };
}

function parseJson(receipt, name) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(receipt.bytes)); }
  catch { invalid(`${name} is not valid UTF-8 JSON`); }
}

function stats(row, id = 'stats') {
  if (!object(row) || !['started','completed','responses','inFlight','success','challenge',
      'clientError','serverError','other','disconnected'].every(k => positive(row[k]))) invalid(`${id} counters`);
  if (row.completed > row.started || row.inFlight !== row.started - row.completed ||
      row.responses + row.disconnected !== row.completed ||
      row.success + row.challenge + row.clientError + row.serverError + row.other !== row.responses) {
    invalid(`${id} counter conservation`);
  }
  if (!object(row.statuses) || Object.entries(row.statuses).some(([k,v]) => !/^[1-5]\d\d$/.test(k) || !positive(v)) ||
      Object.values(row.statuses).reduce((a,b) => a+b,0) !== row.responses) invalid(`${id} status totals`);
  for (const [k,v] of Object.entries(row.statuses)) {
    if (k === '402' && v > row.challenge) invalid(`${id} 402 challenge mismatch`);
  }
  const result = {};
  for (const key of ['id','method','path','started','completed','responses','inFlight','success',
    'challenge','clientError','serverError','other','disconnected','durationMeanMs','durationMaxMs',
    'latencyP95UpperBoundMs','httpSuccessPercent']) if (own(row,key)) result[key]=row[key];
  result.statuses = Object.fromEntries(Object.entries(row.statuses));
  return result;
}

export function compileBundle({ sellerHealth, sellerOffers, opsSnapshot, metrics, receipts, generatedAt }) {
  if (!object(sellerHealth) || sellerHealth.schema !== 'stellar-forge.seller-service.v1' ||
      !['CHALLENGE_ONLY','NATIVE_X402'].includes(sellerHealth.mode) ||
      !Array.isArray(sellerHealth.routes) || sellerHealth.routes.length < 1 || sellerHealth.routes.length > 64) {
    invalid('original seller health');
  }
  if (!Array.isArray(sellerOffers) || sellerOffers.length !== sellerHealth.routes.length) invalid('seller offer count mismatch');
  if (!object(opsSnapshot) || opsSnapshot.schema !== 'stellar-forge.seller-traffic.v1' ||
      !/^[0-9a-f-]{36}$/i.test(opsSnapshot.sessionId ?? '') || !iso(opsSnapshot.startedAt) ||
      !iso(opsSnapshot.capturedAt) || opsSnapshot.mode !== sellerHealth.mode ||
      !Array.isArray(opsSnapshot.routes) || opsSnapshot.routes.length !== sellerHealth.routes.length + 3 ||
      opsSnapshot.routes.length > MAX_ROUTES || !Array.isArray(opsSnapshot.recent) ||
      !Array.isArray(opsSnapshot.minutes) || opsSnapshot.minutes.length !== 60 ||
      !positive(opsSnapshot.recentLimit) || opsSnapshot.recent.length > opsSnapshot.recentLimit ||
      opsSnapshot.recentLimit > 2000 || !positive(opsSnapshot.observerErrors) ||
      !positive(opsSnapshot.ignoredMetadata) || typeof opsSnapshot.attached !== 'boolean') {
    invalid('original traffic snapshot schema');
  }
  if (typeof metrics !== 'string' || metrics.length > MAX_BYTES ||
      !metrics.includes('# TYPE sf30_http_requests_total counter') ||
      metrics.split('\n').some(line => line && !line.startsWith('#') && !/^sf30_http_(requests_total|active_requests|responses_total|aborted_total|request_duration_seconds_(bucket|sum|count))\{[^\r\n]*\} (\d+|\d+\.\d+|\d+e[+-]?\d+)$/i.test(line))) {
    invalid('original metrics format');
  }
  const keyOf = row => `${row.id}\u0000${row.method}`;
  const routes = opsSnapshot.routes.map(r => stats(r, `route ${r.id}`));
  const live = routes.filter(r => !r.id.startsWith('@'));
  const special = routes.filter(r => r.id.startsWith('@')).map(r => r.id).sort();
  if (JSON.stringify(special) !== JSON.stringify(['@invalid','@method','@unmatched'])) invalid('original traffic special buckets');
  const healthKeys = new Set();
  for (const h of sellerHealth.routes) {
    if (!object(h) || !/^[A-Za-z0-9_-]{1,80}$/.test(h.id) || !supportsSellerMethod(h.method) ||
        healthKeys.has(keyOf(h))) invalid('health route declaration');
    healthKeys.add(keyOf(h));
  }
  if (live.length !== healthKeys.size || live.some(r => !healthKeys.has(keyOf(r))) ||
      new Set(live.map(keyOf)).size !== live.length) invalid('health/traffic route mismatch');
  const totals = stats(opsSnapshot.totals,'totals');
  for (const field of ['started','completed','responses','inFlight','success','challenge','clientError',
      'serverError','other','disconnected']) {
    if (routes.reduce((sum,r) => sum + r[field],0) !== totals[field]) invalid(`aggregate mismatch: ${field}`);
  }
  const recent = opsSnapshot.recent.map(r => {
    if (!object(r) || !positive(r.requestId) || !iso(r.at) ||
        !routes.some(row => row.id === r.routeId) ||
        !['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS','CONNECT','TRACE','OTHER'].includes(r.method) ||
        !['success','challenge','clientError','serverError','other','disconnected'].includes(r.outcome) ||
        !(r.status === null || Number.isInteger(r.status) && r.status >= 100 && r.status <= 599) ||
        !Number.isFinite(r.durationMs) || r.durationMs < 0) invalid('bounded recent outcome');
    return {requestId:r.requestId,at:r.at,routeId:r.routeId,method:r.method,outcome:r.outcome,
      status:r.status,durationMs:r.durationMs};
  });
  const minutes = opsSnapshot.minutes.map(m => {
    // Minute buckets have starts and finishes on their respective event clocks.
    // A completion in this minute may belong to a request started in an earlier minute.
    if (!object(m) || !iso(m.minute) || !['started','completed','responses','success',
        'challenge','serverError','disconnected'].every(k => positive(m[k])) ||
        m.responses + m.disconnected !== m.completed) invalid('minute counters');
    return {minute:m.minute,started:m.started,completed:m.completed,responses:m.responses,
      success:m.success,challenge:m.challenge,serverError:m.serverError,disconnected:m.disconnected};
  });
  const alerts = [];
  if (!opsSnapshot.attached) alerts.push('Traffic observer detached: later requests are not included.');
  if (opsSnapshot.observerErrors) alerts.push(`Observer reported ${opsSnapshot.observerErrors} internal errors: counts can be incomplete.`);
  if (totals.serverError) alerts.push(`${totals.serverError} finished HTTP 5xx response(s): review original application and upstream errors.`);
  if (totals.disconnected) alerts.push(`${totals.disconnected} disconnected request(s): investigate timeout/abandonment.`);
  if (routes.some(r => r.id === '@invalid' && r.started)) alerts.push('Invalid request targets reached the listener.');
  if (!totals.started) alerts.push('No observed resource requests in this session: no buyer adoption conclusion.');
  if (totals.challenge) alerts.push(`${totals.challenge} payment challenges are normal unpaid 402 flows, not merchant transactions.`);
  if (!alerts.length) alerts.push('No HTTP error signals in the captured window. Payment and merchant acceptance remain separate.');
  const report = {
    schema:'stellar-forge.seller-support.v1', generatedAt, seller: {mode:sellerHealth.mode,
      advertisedRoutes:sellerHealth.routes.map(h=>({id:h.id,method:h.method, admission:Boolean(h.admission)})),
      offerCount:sellerOffers.length},
    observation:{sessionId:opsSnapshot.sessionId,startedAt:opsSnapshot.startedAt,capturedAt:opsSnapshot.capturedAt,
      attached:opsSnapshot.attached,observerErrors:opsSnapshot.observerErrors,ignoredMetadata:opsSnapshot.ignoredMetadata,
      recentLimit:opsSnapshot.recentLimit,totals,routes,recent,minutes},
    alerts, coverage:{sellerInfo:'original SF30 seller local metadata',
      traffic:'original SF30 in-memory observer since attachment',
      metrics:'original SF30 operations Prometheus collector, fetched separately',
      payment:'NOT VERIFIED: HTTP status is not an on-chain settlement or revenue receipt',
      merchant:'NOT VERIFIED: no signed contract or customer acceptance inferred',
      samples:'sequential endpoint reads, not an atomic multi-endpoint snapshot'},
    sourceDigests:Object.fromEntries(Object.entries(receipts).map(([path,r])=>[path,{sha256:r.sha256,bytes:r.bytes.length,readAt:r.at}]))
  };
  const top = [...live].sort((a,b) => b.serverError-a.serverError || b.disconnected-a.disconnected || b.started-a.started);
  const rows = top.map(r=>`| ${tableCell(r.id)} | ${tableCell(r.method)} | ${r.started} | ${r.statuses['402']??0} | ${r.serverError} | ${r.disconnected} | ${tableCell(r.latencyP95UpperBoundMs)} |`).join('\n');
  const brief = `# SF30 seller · private operator support handoff\n\nGenerated: ${generatedAt}  \nObserver session: \`${opsSnapshot.sessionId}\`  \nObserved since: ${opsSnapshot.startedAt}  \nSnapshot at: ${opsSnapshot.capturedAt}  \nSeller mode: **${sellerHealth.mode}**  \nAdvertised routes: **${sellerHealth.routes.length}**\n\n## Runtime outcomes\n\nRequests **${totals.started}**, completed **${totals.completed}**, still in flight **${totals.inFlight}**, 2xx **${totals.success}**, payment challenges **${totals.challenge}**, HTTP 5xx **${totals.serverError}**, disconnected **${totals.disconnected}**. A request is an HTTP attempt, not a buyer, on-chain payment, fulfilled order or dollar of revenue.\n\n| Merchant route | Method | Attempts | 402 | 5xx | Disconnects | p95 bin upper bound, ms |\n|---|---|---:|---:|---:|---:|---:|\n${rows || '| None | | | | | | |'}\n\n## Operational review\n\n${alerts.map(a=>'- '+a).join('\n')}\n\n## Custody and next handoff\n\n- The original seller health, full offers and operational snapshot were read from the operator’s own loopback listeners. **Full offer terms are not copied into this handoff**; hashes and advertised route identifiers are retained.\n- Use \`bundle.json\` for machine-readable source-bound counts, \`metrics.prom\` for the original Prometheus exposition, and \`manifest.json\` for per-file/source SHA-256.\n- Route IDs and templates are the ORIGINAL configured merchant labels. The bundle contains no request URLs, customer query values, bodies, headers, IPs, wallet keys or full offers. Treat traffic and route names as private merchant operational information.\n- The traffic snapshot and metrics are sequential reads, not an atomic view. Metrics counters may change after the JSON capture. A server-side 2xx finish does not establish client receipt or on-chain payment. Consult the actual native payment and independent ledger/receipt tools to make payment claims.\n- Share with the existing SF49 merchant owner only after reviewing the private operational content; never post real merchant logs, offers or commercial terms to a public repo or issue.\n`;
  return { report, brief };
}

export async function captureBundle({seller,ops,out}) {
  const sellerOrigin = loopbackOrigin(seller,'--seller');
  const opsOrigin = loopbackOrigin(ops,'--ops');
  const folder = resolve(out);
  if (!out || folder === '/' || folder === process.cwd()) throw new TypeError('--out must be a new private directory');
  const receipts = {};
  // Merchant metadata and operator evidence are fetched read-only; NO paid route or checkout request.
  for (const [name,origin,path,type] of [
    ['sellerHealth',sellerOrigin,'/_seller/health','application/json'],
    ['sellerOffers',sellerOrigin,'/_seller/offers','application/json'],
    ['opsSnapshot',opsOrigin,'/api/snapshot','application/json'],
    ['metrics',opsOrigin,'/metrics','text/plain']]) {
    receipts[name] = await readLocal(origin,path,type);
  }
  const generatedAt = new Date().toISOString();
  const {report,brief} = compileBundle({
    sellerHealth:parseJson(receipts.sellerHealth,'health'),
    sellerOffers:parseJson(receipts.sellerOffers,'offers'),
    opsSnapshot:parseJson(receipts.opsSnapshot,'ops snapshot'),
    metrics:new TextDecoder('utf-8',{fatal:true}).decode(receipts.metrics.bytes),
    receipts,generatedAt
  });
  const files = {
    'bundle.json':Buffer.from(JSON.stringify(report,null,2)+'\n'),
    'operator-brief.md':Buffer.from(brief),
    'metrics.prom':receipts.metrics.bytes
  };
  const entries = Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,{sha256:sha256(bytes),bytes:bytes.length}]));
  files['manifest.json'] = Buffer.from(JSON.stringify({schema:'stellar-forge.seller-support-manifest.v1',
    sessionId:report.observation.sessionId,generatedAt,files:entries,sourceDigests:report.sourceDigests},null,2)+'\n');
  await mkdir(folder,{mode:0o700}); // Create-only. A prior directory is never overwritten.
  for (const [name,bytes] of Object.entries(files)) await writeFile(resolve(folder,name),bytes,{flag:'wx',mode:0o600});
  return {out:folder,sessionId:report.observation.sessionId,files:Object.keys(files),alerts:report.alerts,
    sourceDigests:report.sourceDigests};
}

export function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return null;
  const options = {};
  for (let i=0;i<args.length;i+=2) {
    const key = args[i];
    if (!['--seller','--ops','--out'].includes(key) || !args[i+1] || own(options,key) || args[i+1].startsWith('--'))
      throw new TypeError('Usage: node bundle.mjs --seller http://127.0.0.1:8423 --ops http://127.0.0.1:8424 --out /private/NEW_DIR');
    options[key]=args[i+1];
  }
  if (Object.keys(options).length!==3) throw new TypeError('Required: --seller --ops --out');
  return {seller:options['--seller'],ops:options['--ops'],out:options['--out']};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=parseArgs(process.argv.slice(2));
    if (!args) console.log('Usage: node bundle.mjs --seller http://127.0.0.1:8423 --ops http://127.0.0.1:8424 --out /private/NEW_DIR');
    else captureBundle(args).then(result=>console.log(JSON.stringify(result)))
      .catch(err=>{console.error(err.message);process.exitCode=1;});
  } catch(err) {console.error(err.message);process.exitCode=1;}
}
