// Creator Pool API bridge.
// local mode: unlocked loopback Ganache demo actors only (local demo actor selection is NOT authentication).
// public mode: the server holds no keys and returns unsigned wallet transactions; authority = actual tx sender, enforced on-chain.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODE = process.env.CP_MODE === 'public' ? 'public' : 'local';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
const DATA = process.env.CP_DATA_DIR || path.join(HERE, 'data');
const WEB = path.resolve(HERE, '..', 'web');
const LOOP = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);
const MAX_BODY = 32 * 1024;

function die(m) { console.error(m); process.exit(1); }
if (MODE === 'local') {
  if (!LOOP.has(HOST)) die('local demo mode binds loopback only');
  if (!LOOP.has(new URL(RPC).hostname)) die('local demo mode requires a loopback RPC');
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const DEP_FILE = path.join(DATA, 'deployment.json');
const ABI_FILE = path.join(DATA, 'abi.json');
if (!fs.existsSync(DEP_FILE) || !fs.existsSync(ABI_FILE)) die('No deployment found. Run: npm run deploy:local');
const dep = readJson(DEP_FILE);
const abi = readJson(ABI_FILE);
if (dep.mode !== MODE) die(`deployment mode ${dep.mode} does not match CP_MODE ${MODE}`);

const provider = new ethers.JsonRpcProvider(RPC);
const pool = new ethers.Contract(dep.poolAddress, abi.CreatorPool, provider);
const token = new ethers.Contract(dep.tokenAddress, abi.DemoToken, provider);
const POOL_LC = dep.poolAddress.toLowerCase();

// ---------- persistent off-chain metadata + operation journal ----------
const STATE_FILE = path.join(DATA, 'state.json');
let db = { version: 1, poolAddress: dep.poolAddress, chainId: String(dep.chainId), campaigns: {}, submissions: {}, pendingMeta: {}, ops: {} };
if (fs.existsSync(STATE_FILE)) {
  const old = readJson(STATE_FILE);
  if (old.poolAddress === dep.poolAddress && String(old.chainId) === String(dep.chainId)) db = { ...db, ...old };
  else fs.renameSync(STATE_FILE, STATE_FILE + '.superseded-' + Date.now());
}
function save() { const tmp = STATE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 1)); fs.renameSync(tmp, STATE_FILE); }

// ---------- errors + validation ----------
class HttpError extends Error { constructor(status, code, detail) { super(code); this.status = status; this.code = code; this.detail = detail; } }
const fail = (s, c, d) => { throw new HttpError(s, c, d); };
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
function text(v, name, min, max) {
  if (typeof v !== 'string') fail(400, 'invalid_' + name, 'string required');
  const s = v.trim();
  if (s.length < min || s.length > max || CTRL.test(s)) fail(400, 'invalid_' + name, `${min}-${max} characters, no control characters`);
  return s;
}
function atomic(v, name) {
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,40}$/.test(v)) fail(400, 'invalid_' + name, 'positive integer string of atomic units');
  const b = BigInt(v);
  if (b >= 2n ** 128n) fail(400, 'invalid_' + name, 'too large');
  return b;
}
function deadlineSec(v) {
  let ms = NaN;
  if (typeof v === 'string' && /^[0-9]{9,11}$/.test(v)) ms = Number(v) * 1000;
  else if (typeof v === 'string' && v.length <= 40) ms = Date.parse(v);
  if (!Number.isFinite(ms)) fail(400, 'invalid_deadline', 'ISO-8601 or unix-seconds string');
  const s = Math.floor(ms / 1000), now = Math.floor(Date.now() / 1000);
  if (s < now + 300 || s > now + 400 * 86400) fail(400, 'invalid_deadline', 'must be 5 minutes to 400 days in the future');
  return s;
}
function workUrl(v) {
  const s = text(v, 'workUrl', 8, 2048);
  let u;
  try { u = new URL(s); } catch { fail(400, 'invalid_workUrl', 'not a URL'); }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || !u.hostname) fail(400, 'invalid_workUrl', 'public http(s) URL without credentials');
  return u.toString(); // stored only; never fetched by this server
}
function idParam(v, name) { if (!/^[1-9][0-9]{0,15}$/.test(v)) fail(404, name + '_not_found'); return BigInt(v); }

// ---------- local demo actors ----------
let actors = null;
async function initActors() {
  if (MODE !== 'local') return;
  const acc = await provider.send('eth_accounts', []);
  if (acc.length < 3) die('need 3 unlocked local dev accounts');
  actors = { sponsor: ethers.getAddress(acc[0]), creatorA: ethers.getAddress(acc[1]), creatorB: ethers.getAddress(acc[2]) };
}
function actorAddr(name) {
  if (!actors || typeof name !== 'string' || !Object.hasOwn(actors, name)) fail(400, 'invalid_actor', 'local demo actor: sponsor, creatorA or creatorB');
  return actors[name];
}
function actorName(addr) { if (!actors) return null; for (const [k, a] of Object.entries(actors)) if (a === addr) return k; return null; }

// ---------- chain readback ----------
const SUB_STATUS = ['none', 'submitted', 'approved', 'claimed'];
async function chainNow() { return BigInt((await provider.getBlock('latest')).timestamp); }
async function readCampaign(id, now) {
  if (now === undefined) now = await chainNow();
  const c = await pool.getCampaign(BigInt(id));
  if (c.sponsor === ethers.ZeroAddress) return null;
  const meta = db.campaigns[String(id)];
  const ok = !!meta && meta.metaHash === c.metaHash;
  const available = c.funded - c.committed - c.refunded;
  return {
    id: String(id), sponsor: c.sponsor, sponsorActor: actorName(c.sponsor), token: c.token,
    title: ok ? meta.title : null, brief: ok ? meta.brief : null, metadataMatches: ok,
    rewardAtomic: c.reward.toString(), budgetAtomic: c.budget.toString(),
    deadline: new Date(Number(c.deadline) * 1000).toISOString(), deadlineUnix: c.deadline.toString(),
    closed: c.closed, status: c.closed ? 'closed' : now >= c.deadline ? 'deadline_passed' : 'open',
    fundedAtomic: c.funded.toString(), unfundedAtomic: (c.budget - c.funded).toString(),
    availableAtomic: available.toString(), reservedAtomic: (c.committed - c.paid).toString(),
    committedAtomic: c.committed.toString(), paidAtomic: c.paid.toString(), refundedAtomic: c.refunded.toString(),
    remainingApprovals: (available / c.reward).toString(), createTx: ok ? meta.createTx || null : null
  };
}
async function readSubmission(id) {
  const s = await pool.getSubmission(BigInt(id));
  if (s.status === 0n) return null;
  const meta = db.submissions[String(id)];
  const ok = !!meta && meta.contentHash === s.contentHash;
  return {
    id: String(id), campaignId: s.campaignId.toString(), creator: s.creator, creatorActor: actorName(s.creator),
    title: ok ? meta.title : null, workUrl: ok ? meta.workUrl : null, notes: ok ? meta.notes : null, metadataMatches: ok,
    status: SUB_STATUS[Number(s.status)] || 'unknown'
  };
}
async function readLedger() {
  const logs = await pool.queryFilter('*', Number(dep.deployBlock || 0));
  return logs.filter((l) => l.fragment).map((l) => ({
    id: `${l.transactionHash}:${l.index}`, txHash: l.transactionHash, logIndex: l.index, blockNumber: l.blockNumber, event: l.eventName,
    args: Object.fromEntries(l.fragment.inputs.map((inp, i) => [inp.name, String(l.args[i])]))
  }));
}

// ---------- transaction journal ----------
const chainReason = (e) => (e && e.revert && e.revert.args && e.revert.args[0]) || (e && e.reason) || (e && e.shortMessage) || 'execution reverted';
function events(r) {
  return r.logs.filter((l) => l.address.toLowerCase() === POOL_LC).map((l) => { try { return pool.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
}
const txRef = (r) => ({ txHash: r.hash, blockNumber: r.blockNumber });

// Sends one step of an operation. A step with a stored hash is reconciled from its receipt and never re-sent.
async function sendTx(op, step, from, contract, method, args) {
  const prev = op.txs.find((t) => t.step === step);
  if (prev) {
    const r = await provider.getTransactionReceipt(prev.hash);
    if (!r) fail(409, 'tx_pending_reconcile', { txHash: prev.hash });
    if (r.status !== 1) fail(409, 'tx_reverted', { txHash: prev.hash });
    return r;
  }
  if (op.sendingStep) fail(409, 'operation_unknown_send_state', 'A transaction may have been sent without a stored hash. Inspect /api/state and use a new operationId.');
  const c = contract.connect(await provider.getSigner(from));
  try { await c[method].staticCall(...args); } catch (e) { fail(409, 'chain_rejected', chainReason(e)); }
  op.sendingStep = step; save();
  const tx = await c[method](...args); // on throw, sendingStep stays set: outcome unknown, never replayed
  op.txs.push({ step, hash: tx.hash }); delete op.sendingStep; save();
  const r = await tx.wait(1);
  if (!r || r.status !== 1) fail(409, 'tx_reverted', { txHash: tx.hash });
  return r;
}

const inflight = new Set();
function opId(body, kind, params) {
  if (body.operationId !== undefined) {
    if (typeof body.operationId !== 'string' || !/^[A-Za-z0-9._:-]{8,100}$/.test(body.operationId)) fail(400, 'invalid_operationId', '8-100 chars [A-Za-z0-9._:-]');
    return body.operationId;
  }
  return kind + ':' + crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 32);
}
async function runOp(id, kind, fn) {
  if (inflight.has(id)) fail(409, 'operation_in_progress');
  let op = db.ops[id];
  if (op) {
    if (op.kind !== kind) fail(409, 'operation_id_reused');
    if (op.status === 'done') return { ...op.result, replayed: true };
    if (op.status === 'failed') fail(409, 'operation_failed', op.error);
  } else { op = db.ops[id] = { kind, status: 'pending', txs: [], createdAt: new Date().toISOString() }; save(); }
  inflight.add(id);
  try {
    const result = await fn(op);
    op.status = 'done'; op.result = result; save();
    return result;
  } catch (e) {
    if (!op.txs.length && !op.sendingStep) { delete db.ops[id]; save(); }
    else if (e instanceof HttpError && e.code === 'tx_reverted') { op.status = 'failed'; op.error = e.detail; save(); }
    throw e;
  } finally { inflight.delete(id); }
}

let queue = Promise.resolve();
function serial(fn) { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; }

function unsigned(txs) {
  return {
    status: 'wallet_signature_required',
    note: 'Sign and broadcast with the acting wallet, then POST /api/reconcile {txHash}. The server holds no keys.',
    chainId: String(dep.chainId),
    transactions: txs.map((t) => ({ ...t, value: '0' }))
  };
}
const poolTx = (label, fn, args) => ({ label, to: dep.poolAddress, data: pool.interface.encodeFunctionData(fn, args) });
function rememberMeta(hash, m) {
  const keys = Object.keys(db.pendingMeta);
  if (keys.length >= 500) delete db.pendingMeta[keys[0]];
  db.pendingMeta[hash] = m; save();
}

// ---------- handlers ----------
async function hCreate(body) {
  const title = text(body.title, 'title', 1, 140), brief = text(body.brief, 'brief', 1, 4000);
  const budget = atomic(body.budgetAtomic, 'budgetAtomic'), reward = atomic(body.rewardAtomic, 'rewardAtomic');
  if (reward > budget) fail(400, 'invalid_rewardAtomic', 'reward must not exceed budget');
  const dl = deadlineSec(body.deadline);
  const metaHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ title, brief })));
  const args = [dep.tokenAddress, reward, budget, dl, metaHash];
  if (MODE === 'public') { rememberMeta(metaHash, { kind: 'campaign', title, brief }); return unsigned([poolTx('createCampaign', 'createCampaign', args)]); }
  const id = opId(body, 'create', { title, brief, b: String(budget), r: String(reward), dl });
  return runOp(id, 'create', async (op) => {
    const r = await sendTx(op, 'create', actors.sponsor, pool, 'createCampaign', args);
    const ev = events(r).find((e) => e.name === 'CampaignCreated');
    const cid = String(ev.args.campaignId);
    db.campaigns[cid] = { title, brief, metaHash, createTx: r.hash }; save();
    return { operationId: id, campaign: await readCampaign(cid), tx: txRef(r) };
  });
}

async function hFund(cidS, body) {
  const cid = idParam(cidS, 'campaign');
  const c = await pool.getCampaign(cid);
  if (c.sponsor === ethers.ZeroAddress) fail(404, 'campaign_not_found');
  const amount = body.amountAtomic === undefined ? c.budget - c.funded : atomic(body.amountAtomic, 'amountAtomic');
  if (amount <= 0n) fail(409, 'already_fully_funded');
  if (MODE === 'public') {
    return unsigned([
      { label: 'approveToken', to: dep.tokenAddress, data: token.interface.encodeFunctionData('approve', [dep.poolAddress, amount]) },
      poolTx('fund', 'fund', [cid, amount])
    ]);
  }
  if (c.sponsor !== actors.sponsor) fail(403, 'not_campaign_sponsor');
  const id = opId(body, 'fund', { cid: cidS, a: String(amount), f: String(c.funded) });
  return runOp(id, 'fund', async (op) => {
    let ar = null;
    const allowance = await token.allowance(actors.sponsor, dep.poolAddress);
    if (op.txs.find((t) => t.step === 'allow') || allowance < amount) ar = await sendTx(op, 'allow', actors.sponsor, token, 'approve', [dep.poolAddress, amount]);
    const r = await sendTx(op, 'fund', actors.sponsor, pool, 'fund', [cid, amount]);
    return { operationId: id, campaign: await readCampaign(cidS), txs: [ar && txRef(ar), txRef(r)].filter(Boolean) };
  });
}

async function hSubmit(cidS, body) {
  const cid = idParam(cidS, 'campaign');
  const c = await pool.getCampaign(cid);
  if (c.sponsor === ethers.ZeroAddress) fail(404, 'campaign_not_found');
  const title = text(body.title, 'title', 1, 140), url = workUrl(body.workUrl), notes = text(body.notes ?? '', 'notes', 0, 1000);
  const contentHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ campaignId: cidS, title, workUrl: url, notes })));
  if (MODE === 'public') { rememberMeta(contentHash, { kind: 'submission', campaignId: cidS, title, workUrl: url, notes }); return unsigned([poolTx('submit', 'submit', [cid, contentHash])]); }
  const from = actorAddr(body.creator);
  const id = opId(body, 'submit', { cid: cidS, from, contentHash });
  return runOp(id, 'submit', async (op) => {
    const r = await sendTx(op, 'submit', from, pool, 'submit', [cid, contentHash]);
    const ev = events(r).find((e) => e.name === 'SubmissionCreated');
    const sid = String(ev.args.submissionId);
    db.submissions[sid] = { campaignId: cidS, title, workUrl: url, notes, contentHash, submitTx: r.hash }; save();
    return { operationId: id, submission: await readSubmission(sid), tx: txRef(r) };
  });
}

async function loadSub(sidS) {
  const sid = idParam(sidS, 'submission');
  const s = await pool.getSubmission(sid);
  if (s.status === 0n) fail(404, 'submission_not_found');
  return { sid, s, c: await pool.getCampaign(s.campaignId) };
}

async function hApprove(sidS, body) {
  const { sid, s, c } = await loadSub(sidS);
  if (MODE === 'public') return unsigned([poolTx('approve', 'approve', [sid])]);
  if (c.sponsor !== actors.sponsor) fail(403, 'not_campaign_sponsor');
  const id = opId(body, 'approve', { sid: sidS });
  return runOp(id, 'approve', async (op) => {
    const r = await sendTx(op, 'approve', actors.sponsor, pool, 'approve', [sid]);
    return { operationId: id, submission: await readSubmission(sidS), campaign: await readCampaign(s.campaignId.toString()), tx: txRef(r) };
  });
}

async function hClaim(sidS, body) {
  const { sid, s } = await loadSub(sidS);
  if (MODE === 'public') return unsigned([poolTx('claim', 'claim', [sid])]);
  if (!actorName(s.creator)) fail(403, 'creator_not_local_demo_actor');
  if (body.actor !== undefined && actorAddr(body.actor) !== s.creator) fail(403, 'not_submission_creator');
  const id = opId(body, 'claim', { sid: sidS });
  return runOp(id, 'claim', async (op) => {
    const r = await sendTx(op, 'claim', s.creator, pool, 'claim', [sid]);
    return { operationId: id, submission: await readSubmission(sidS), campaign: await readCampaign(s.campaignId.toString()), creatorBalanceAtomic: (await token.balanceOf(s.creator)).toString(), tx: txRef(r) };
  });
}

async function hClose(cidS, body) {
  const cid = idParam(cidS, 'campaign');
  const c = await pool.getCampaign(cid);
  if (c.sponsor === ethers.ZeroAddress) fail(404, 'campaign_not_found');
  if (MODE === 'public') return unsigned([poolTx('close', 'close', [cid])]);
  if (c.sponsor !== actors.sponsor) fail(403, 'not_campaign_sponsor');
  const id = opId(body, 'close', { cid: cidS });
  return runOp(id, 'close', async (op) => {
    const r = await sendTx(op, 'close', actors.sponsor, pool, 'close', [cid]);
    const ev = events(r).find((e) => e.name === 'CampaignClosed');
    return { operationId: id, refundedAtomic: ev ? ev.args.refunded.toString() : '0', campaign: await readCampaign(cidS), tx: txRef(r) };
  });
}

// Attaches off-chain metadata to a wallet-signed transaction, using only its actual mined receipt.
async function hReconcile(body) {
  if (typeof body.txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) fail(400, 'invalid_txHash');
  const r = await provider.getTransactionReceipt(body.txHash);
  if (!r) fail(404, 'receipt_not_found_yet');
  if (r.status !== 1) fail(409, 'tx_reverted');
  if ((r.to || '').toLowerCase() !== POOL_LC) fail(400, 'not_pool_transaction');
  const found = [];
  for (const ev of events(r)) {
    found.push(ev.name);
    if (ev.name === 'CampaignCreated') {
      const cid = String(ev.args.campaignId), m = db.pendingMeta[ev.args.metaHash];
      if (m && m.kind === 'campaign' && !db.campaigns[cid]) db.campaigns[cid] = { title: m.title, brief: m.brief, metaHash: ev.args.metaHash, createTx: r.hash };
    }
    if (ev.name === 'SubmissionCreated') {
      const sid = String(ev.args.submissionId), m = db.pendingMeta[ev.args.contentHash];
      if (m && m.kind === 'submission' && m.campaignId === String(ev.args.campaignId) && !db.submissions[sid]) db.submissions[sid] = { campaignId: m.campaignId, title: m.title, workUrl: m.workUrl, notes: m.notes, contentHash: ev.args.contentHash, submitTx: r.hash };
    }
  }
  save();
  return { txHash: r.hash, blockNumber: r.blockNumber, events: found };
}

let asset = null;
async function buildState() {
  const blk = await provider.getBlock('latest');
  const now = BigInt(blk.timestamp);
  const cc = Number(await pool.campaignCount()), sc = Number(await pool.submissionCount());
  const ledger = await readLedger();
  const txBySub = {}, txByCampaign = {};
  for (const e of ledger) {
    if (e.args.submissionId) (txBySub[e.args.submissionId] ||= {})[e.event] = e.txHash;
    else if (e.args.campaignId) ((txByCampaign[e.args.campaignId] ||= {})[e.event] ||= []).push(e.txHash);
  }
  const campaigns = [];
  for (let i = cc; i >= 1; i--) { const c = await readCampaign(String(i), now); c.txs = txByCampaign[c.id] || {}; campaigns.push(c); }
  const submissions = [];
  for (let i = sc; i >= 1; i--) { const s = await readSubmission(String(i)); s.txs = txBySub[s.id] || {}; submissions.push(s); }
  let balances = null;
  if (actors) { balances = {}; for (const [k, a] of Object.entries(actors)) balances[k] = (await token.balanceOf(a)).toString(); }
  const operations = Object.entries(db.ops).filter(([, o]) => o.status !== 'done').map(([id, o]) => ({
    operationId: id, kind: o.kind, status: o.sendingStep ? 'unknown_send_state' : o.status, txHashes: o.txs.map((t) => t.hash), error: o.error || null
  }));
  return {
    mode: MODE,
    network: { name: dep.network || (MODE === 'local' ? 'Local Ganache EVM (development only)' : 'unconfigured'), chainId: String(dep.chainId) },
    asset, decimals: asset.decimals,
    contracts: { pool: dep.poolAddress, token: dep.tokenAddress },
    actors, actorNotice: actors ? 'Local demo actors (unlocked Ganache accounts). Not authentication.' : null,
    balances, poolBalanceAtomic: (await token.balanceOf(dep.poolAddress)).toString(),
    blockNumber: blk.number, blockTime: new Date(Number(now) * 1000).toISOString(),
    campaigns, submissions, ledger, operations
  };
}

const routes = [
  ['GET', /^\/api\/state$/, () => buildState()],
  ['POST', /^\/api\/campaigns$/, (m, b) => hCreate(b)],
  ['POST', /^\/api\/campaigns\/([0-9]+)\/fund$/, (m, b) => hFund(m[1], b)],
  ['POST', /^\/api\/campaigns\/([0-9]+)\/submissions$/, (m, b) => hSubmit(m[1], b)],
  ['POST', /^\/api\/campaigns\/([0-9]+)\/close$/, (m, b) => hClose(m[1], b)],
  ['POST', /^\/api\/submissions\/([0-9]+)\/approve$/, (m, b) => hApprove(m[1], b)],
  ['POST', /^\/api\/submissions\/([0-9]+)\/claim$/, (m, b) => hClaim(m[1], b)],
  ['POST', /^\/api\/reconcile$/, (m, b) => hReconcile(b)]
];

// ---------- HTTP ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (!ct.startsWith('application/json')) { req.resume(); return reject(new HttpError(415, 'json_required')); }
    let size = 0, over = false; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) over = true; else chunks.push(c); });
    req.on('end', () => {
      if (over) return reject(new HttpError(413, 'body_too_large'));
      try {
        const s = Buffer.concat(chunks).toString('utf8');
        const v = s ? JSON.parse(s) : {};
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('shape');
        resolve(v);
      } catch { reject(new HttpError(400, 'invalid_json')); }
    });
    req.on('error', () => reject(new HttpError(400, 'bad_request')));
  });
}
function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(obj));
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function serveStatic(p, res, method) {
  if (method !== 'GET' && method !== 'HEAD') fail(405, 'method_not_allowed');
  let rel;
  try { rel = decodeURIComponent(p); } catch { fail(400, 'bad_path'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const f = path.resolve(WEB, '.' + rel);
  if (!f.startsWith(WEB + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) fail(404, 'not_found');
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
  if (method === 'HEAD') return res.end();
  fs.createReadStream(f).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    let host;
    try { host = new URL('http://' + (req.headers.host || '')).hostname; } catch { fail(400, 'bad_host'); }
    if (MODE === 'local' && !LOOP.has(host)) fail(403, 'loopback_only');
    if (req.method === 'POST' && req.headers.origin) {
      let oh = null;
      try { oh = new URL(req.headers.origin).host; } catch { /* rejected below */ }
      if (oh !== req.headers.host) fail(403, 'cross_origin_rejected');
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const rt = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!rt) fail(404, 'not_found');
      const body = req.method === 'POST' ? await readBody(req) : {};
      const m = url.pathname.match(rt[1]);
      const out = req.method === 'POST' ? await serial(() => rt[2](m, body)) : await rt[2](m, body);
      return send(res, out && out.status === 'wallet_signature_required' ? 202 : 200, out);
    }
    return serveStatic(url.pathname, res, req.method);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.code, detail: e.detail ?? null });
    console.error('internal error:', (e && (e.shortMessage || e.code)) || 'unknown');
    return send(res, 500, { error: 'internal_error' });
  }
});

// ---------- startup ----------
const net = await provider.getNetwork();
if (String(net.chainId) !== String(dep.chainId)) die(`RPC chainId ${net.chainId} does not match deployment ${dep.chainId}`);
if ((await provider.getCode(dep.poolAddress)) === '0x') die('Pool contract not found on this chain. If Ganache was reset, run npm run deploy:local again.');
await initActors();
asset = { address: dep.tokenAddress, name: await token.name(), symbol: await token.symbol(), decimals: Number(await token.decimals()), nonMonetaryDemo: MODE === 'local' };
const stuck = Object.values(db.ops).filter((o) => o.status === 'pending').length;
server.listen(PORT, HOST, () => console.log(`Creator Pool API (${MODE}) on http://${HOST}:${PORT} pool=${dep.poolAddress} chainId=${dep.chainId} pendingOps=${stuck}`));
