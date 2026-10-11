// Focused check for the insight/guard contract (supervised addition, not provider text).
// The real validateDraftGrounding bounds one short line; the module must apply it
// per sentence so a normal multi-sentence insight can pass, while every
// quantitative rule still holds on each sentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeSnapshot} from '../src/engine.mjs';
import {createOpusCommentary, MODEL} from '../src/opus_commentary.mjs';
import {createFoundryAdmission} from '../src/foundry_quota.mjs';

const EVENTS = [
  {id: 'e001', second: 10, team: 'Harbor FC', type: 'loss', zone: 'attacking', player: 'H7'},
  {id: 'e002', second: 12, team: 'Harbor FC', type: 'pressure', zone: 'attacking', player: 'H9'},
  {id: 'e003', second: 14, team: 'Harbor FC', type: 'regain', zone: 'attacking', player: 'H9'},
];
const input = () => ({sessionId: 's1', count: 3, events: EVENTS,
  snapshot: makeSnapshot(EVENTS, {team: 'Harbor FC', audience: 'casual', locale: 'en'})});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'cp-opus-guard-'));
  await mkdir(join(root, 'work', 'api-spend-round'), {recursive: true});
  const runner = join(root, 'work', 'api-spend-round', 'run_paid_api.py');
  await writeFile(runner, '# stub runner, never executed\n');
  return {root, runner};
}
function make({root, runner}, responseText) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({cmd, args, opts});
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    setImmediate(async () => {
      const out = join(root, 'work', 'api-jobs', args[1]);
      await mkdir(out, {recursive: true});
      await writeFile(join(out, 'receipt.json'), JSON.stringify(
        {state: 'RESPONDED', stop_reason: 'end_turn', artifact_saved: true, actual_model: MODEL}));
      await writeFile(join(out, 'response.txt'), responseText);
      child.emit('close', 0);
    });
    return child;
  };
  // NOTE: real validateDraftGrounding — the default guard — is exercised here.
  const opus = createOpusCommentary({env: {CP_OPUS_BUDGET_RUNNER: runner, CP_OPUS_PYTHON: process.execPath},
    spawn, admission: createFoundryAdmission({maxPerHour: 8, maxInFlight: 1}), tmpRoot: root});
  return {opus, calls};
}
async function settle(opus, inp) {
  for (let i = 0; i < 200; i++) {
    const r = await opus.request(inp);
    if (r.state !== 'pending') return r;
    await new Promise(r2 => setTimeout(r2, 10));
  }
  throw new Error('still pending');
}

test('a normal multi-sentence insight passes the real guard and reaches ready', async () => {
  const r0 = await makeRoot();
  // Total length >135 chars (the guard's single-line bound) — this fails on the
  // unrepaired whole-insight guard call; each sentence alone is under the bound.
  const insight = 'Harbor FC pressed right after losing the ball in the attacking third. ' +
    'They won it back inside the window, which keeps the move alive and keeps the pressure on.';
  assert.ok(insight.length > 135, 'insight must exceed the single-line guard bound to discriminate');
  const {opus, calls} = make(r0, JSON.stringify({caption: 'Harbor FC win it back fast.', insight}));
  const r = await settle(opus, input());
  assert.equal(r.state, 'ready');
  assert.equal(calls.length, 1);
  assert.equal(r.caption, 'Harbor FC win it back fast.');
  assert.equal(r.text, insight);
});

test('an unsupported statistic inside one sentence is held', async () => {
  const r0 = await makeRoot();
  const {opus, calls} = make(r0, JSON.stringify({
    caption: 'Harbor FC push up.',
    insight: 'Harbor FC pressed hard. They scored a goal right after.'}));
  assert.equal((await settle(opus, input())).state, 'unavailable');
  assert.equal(calls.length, 1);
});

test('an unobserved quantity inside one sentence is held', async () => {
  const r0 = await makeRoot();
  const {opus, calls} = make(r0, JSON.stringify({
    caption: 'Harbor FC push up.',
    insight: 'Harbor FC pressed after 3 seconds. They kept the ball after that.'}));
  assert.equal((await settle(opus, input())).state, 'unavailable');
  assert.equal(calls.length, 1);
});

test('a single over-long sentence fails closed', async () => {
  const r0 = await makeRoot();
  const long = 'Harbor FC pressed right after losing the ball and won it back inside the window '.repeat(3);
  const {opus} = make(r0, JSON.stringify({caption: 'Harbor FC press.', insight: long}));
  assert.equal((await settle(opus, input())).state, 'unavailable');
});

test('an evidence id not in the overlay is held', async () => {
  const r0 = await makeRoot();
  const {opus} = make(r0, JSON.stringify({
    caption: 'Harbor FC push up.',
    insight: 'The play at e099 started it. Harbor FC pressed right after.'}));
  assert.equal((await settle(opus, input())).state, 'unavailable');
});

test('allowed numbers observed in the overlay still pass', async () => {
  const r0 = await makeRoot();
  const insight = 'The pressure run was 1 action inside the 8 second window at the attacking third. ' +
    'Harbor FC recovered in 4 seconds and kept the ball moving forward.';
  assert.ok(insight.length > 135, 'insight must exceed the single-line guard bound to discriminate');
  const {opus} = make(r0, JSON.stringify({caption: 'Harbor FC win it back fast.', insight}));
  assert.equal((await settle(opus, input())).state, 'ready');
});
