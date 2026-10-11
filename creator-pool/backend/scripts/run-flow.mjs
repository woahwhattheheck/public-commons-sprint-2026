// Focused local flow driver for the Creator Pool backend (`npm run flow`).
// Provenance: supervised engineering completion — this file was referenced by
// package.json but not delivered in either received response; written to match
// the brief's required flow against the LIVE local API. It asserts real chain
// state returned by /api/state and the route responses; it never invents
// results. Run after `npm run chain` + `npm run deploy:local` + `npm start`.
import { setTimeout as delay } from 'node:timers/promises';

const BASE = process.env.CP_API || 'http://127.0.0.1:8787';
const out = { startedUtc: new Date().toISOString(), base: BASE, steps: [], checks: [], verdict: null };
const step = (name, data) => { out.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data)); };
const check = (name, cond, detail) => {
  out.checks.push({ name, pass: !!cond, detail });
  console.log(cond ? 'PASS' : 'FAIL', name, detail ?? '');
  if (!cond) out.verdict = 'FAIL';
};

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  return { status: r.status, body: data };
}
const atomic = (v) => BigInt(v);
const state = async () => (await api('GET', '/api/state')).body;

async function main() {
  const s0 = await state();
  if (!s0 || s0.mode !== 'local') throw new Error('expected a running local-mode API on ' + BASE);
  step('state.ok', { mode: s0.mode, chainId: s0.network.chainId, asset: s0.asset.symbol });
  check('local mode + demo asset labelled', s0.asset.nonMonetaryDemo === true && s0.asset.symbol === 'CPDEMO');

  // 1. create campaign: budget 250_000_000, reward 100_000_000
  const budget = 250000000n, reward = 100000000n;
  const dl = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const cr = await api('POST', '/api/campaigns', {
    title: 'Launch clip series', brief: 'One original 30-60s product clip, no reused footage.',
    budgetAtomic: String(budget), rewardAtomic: String(reward), deadline: dl,
    operationId: 'flow-create-' + Date.now(),
  });
  check('campaign created', cr.status === 200 && cr.body.campaign.id, JSON.stringify(cr.body.error ?? cr.body.campaign?.id));
  const cid = cr.body.campaign.id;
  step('campaign', { id: cid, fundedAtomic: cr.body.campaign.fundedAtomic, availableAtomic: cr.body.campaign.availableAtomic });

  // 2. fund it
  const fu = await api('POST', `/api/campaigns/${cid}/fund`, {});
  check('funded to budget', fu.status === 200 && atomic(fu.body.campaign.fundedAtomic) === budget,
        JSON.stringify(fu.body.error ?? fu.body.campaign?.fundedAtomic));
  check('fund tx real', fu.body.txs?.length >= 1 && /^0x[0-9a-f]{64}$/i.test(fu.body.txs.at(-1).txHash));

  // 3. three submissions (creatorA x2, creatorB x1)
  const subs = [];
  for (const [creator, i] of [['creatorA', 1], ['creatorB', 2], ['creatorA', 3]]) {
    const r = await api('POST', `/api/campaigns/${cid}/submissions`, {
      creator, title: `Clip ${i}`, workUrl: `https://example.com/work/${i}`, notes: 'demo note',
      operationId: `flow-submit-${cid}-${i}-${Date.now()}`,
    });
    check(`submission ${i} created`, r.status === 200, JSON.stringify(r.body.error ?? r.body.submission?.id));
    subs.push(r.body.submission.id);
  }

  // 4. approve sub1 and sub2 -> committed 200M, available 50M < reward
  for (const i of [0, 1]) {
    const r = await api('POST', `/api/submissions/${subs[i]}/approve`, {});
    check(`approve ${subs[i]}`, r.status === 200 && r.body.submission.status === 'approved',
          JSON.stringify(r.body.error ?? r.body.submission?.status));
  }
  let s = await state();
  const camp = () => s.campaigns.find((c) => c.id === cid);
  check('committed = 2 rewards', atomic(camp().committedAtomic) === 2n * reward, camp().committedAtomic);
  check('available = budget - committed', atomic(camp().availableAtomic) === budget - 2n * reward, camp().availableAtomic);

  // 5. over-budget approval must be blocked by the real contract
  const over = await api('POST', `/api/submissions/${subs[2]}/approve`, {});
  check('over-budget approval blocked (409 chain_rejected)', over.status === 409 && over.body.error === 'chain_rejected',
        JSON.stringify(over.body));

  // 6. claim sub1 once -> paid; repeated claim blocked; same-operationId replays
  const balBefore = atomic(s.balances.creatorA);
  const claimId = 'flow-claim-' + subs[0] + '-' + Date.now();
  const cl = await api('POST', `/api/submissions/${subs[0]}/claim`, { operationId: claimId });
  check('claim pays once', cl.status === 200 && cl.body.submission.status === 'claimed', JSON.stringify(cl.body.error ?? cl.body.submission?.status));
  check('creator balance +reward', atomic(cl.body.creatorBalanceAtomic) === balBefore + reward,
        `${balBefore} -> ${cl.body.creatorBalanceAtomic}`);
  const cl2 = await api('POST', `/api/submissions/${subs[0]}/claim`, {});
  check('repeated claim blocked by chain', cl2.status === 409, JSON.stringify(cl2.body));
  const rep = await api('POST', `/api/submissions/${subs[0]}/claim`, { operationId: claimId });
  check('same operationId replays result, never resends', rep.status === 200 && rep.body.replayed === true,
        JSON.stringify(rep.body.error ?? rep.body.replayed));

  // 7. close: refunds ONLY the uncommitted remainder; reserved rewards survive
  const close = await api('POST', `/api/campaigns/${cid}/close`, {});
  check('closed', close.status === 200 && close.body.campaign.closed === true, JSON.stringify(close.body.error ?? ''));
  check('refunded = uncommitted only', atomic(close.body.refundedAtomic) === budget - 2n * reward,
        close.body.refundedAtomic);
  s = await state();
  check('reserved preserved at close', atomic(camp().reservedAtomic) === reward, camp().reservedAtomic);

  // 8. approved creator still claims after close
  const clB = await api('POST', `/api/submissions/${subs[1]}/claim`, {});
  check('post-close claim works', clB.status === 200 && clB.body.submission.status === 'claimed', JSON.stringify(clB.body.error ?? ''));

  s = await state();
  step('final', { funded: camp().fundedAtomic, paid: camp().paidAtomic, refunded: camp().refundedAtomic, reserved: camp().reservedAtomic });
  check('accounting identity: paid + refunded + reserved <= funded',
        atomic(camp().paidAtomic) + atomic(camp().refundedAtomic) + atomic(camp().reservedAtomic) <= atomic(camp().fundedAtomic));

  if (out.verdict !== 'FAIL') out.verdict = 'PASS';
  out.finishedUtc = new Date().toISOString();
  const fs = await import('node:fs');
  const reportUrl = new URL('../data/flow-report.json', import.meta.url);
  fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  fs.writeFileSync(reportUrl, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ verdict: out.verdict, checks: out.checks.length }));
  process.exit(out.verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  out.verdict = 'ERROR'; out.error = String(e && e.message || e);
  console.error('FLOW ERROR', out.error);
  process.exit(2);
});
