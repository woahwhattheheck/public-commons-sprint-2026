import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, mkdir, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeSnapshot} from '../src/engine.mjs';
import {createOpusCommentary, MODEL, MAX_OUTPUT_TOKENS} from '../src/opus_commentary.mjs';
import {createFoundryAdmission} from '../src/foundry_quota.mjs';

const EVENTS = [
  {id: 'e001', second: 10, team: 'Harbor FC', type: 'loss', zone: 'attacking', player: 'H7'},
  {id: 'e002', second: 12, team: 'Harbor FC', type: 'pressure', zone: 'attacking', player: 'H9'},
  {id: 'e003', second: 14, team: 'Harbor FC', type: 'regain', zone: 'attacking', player: 'H9'},
];
const input = () => ({sessionId: 's1', count: 3, events: EVENTS,
  snapshot: makeSnapshot(EVENTS, {team: 'Harbor FC', audience: 'casual', locale: 'en'})});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'cp-opus-test-'));
  await mkdir(join(root, 'work', 'api-spend-round'), {recursive: true});
  const runner = join(root, 'work', 'api-spend-round', 'run_paid_api.py');
  await writeFile(runner, '# stub runner, never executed\n');
  return {root, runner};
}
function make({root, runner}, behave) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({cmd, args, opts});
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    setImmediate(async () => {
      const out = join(root, 'work', 'api-jobs', args[1]);
      await mkdir(out, {recursive: true});
      await behave(out, args);
      child.emit('close', 0);
    });
    return child;
  };
  const opus = createOpusCommentary({env: {CP_OPUS_BUDGET_RUNNER: runner, CP_OPUS_PYTHON: process.execPath},
    spawn, guard: () => ({ok: true}), admission: createFoundryAdmission({maxPerHour: 8, maxInFlight: 1}), tmpRoot: root});
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
const receipt = (out, extra) => writeFile(join(out, 'receipt.json'), JSON.stringify({state: 'RESPONDED', stop_reason: 'end_turn', artifact_saved: true, actual_model: MODEL, ...extra}));

test('explicit request goes through the runner once and returns grounded provenance', async () => {
  const r0 = await makeRoot();
  let promptSeen = '';
  const {opus, calls} = make(r0, async (out, args) => {
    promptSeen = await readFile(args[3], 'utf8');
    await receipt(out, {});
    await writeFile(join(out, 'response.txt'), JSON.stringify({caption: 'Harbor FC win it back fast.', insight: 'Harbor FC pressed right after losing the ball. They won it back within the window.'}));
  });
  const r = await settle(opus, input());
  assert.equal(r.state, 'ready');
  assert.equal(r.recordedCount, 3);
  assert.equal(r.frameSecond, 14);
  assert.equal(r.sessionId, 's1');
  assert.equal(r.promptVersion, 'cp-opus-insight-v1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.shell, false);
  assert.deepEqual(calls[0].args.slice(4), ['--model', MODEL, '--max-tokens', String(MAX_OUTPUT_TOKENS), '--effort', 'low']);
  assert.match(promptSeen, /SYNTHETIC MATCH/);
  assert.ok(!promptSeen.includes(r0.root));
  assert.ok(!JSON.stringify(r).includes(r0.root));
  const again = await opus.request(input());
  assert.equal(again.text, r.text);
  assert.equal(calls.length, 1);
});

test('max_tokens result is held and never re-sent', async () => {
  const r0 = await makeRoot();
  const {opus, calls} = make(r0, out => receipt(out, {stop_reason: 'max_tokens'}));
  assert.equal((await settle(opus, input())).state, 'unavailable');
  assert.equal((await opus.request(input())).state, 'unavailable');
  assert.equal(calls.length, 1);
});

test('existing uncertain receipt from an earlier process is never re-dispatched', async () => {
  const r0 = await makeRoot();
  const first = make(r0, out => writeFile(join(out, 'receipt.json'), JSON.stringify({state: 'EFFECT_UNKNOWN'})));
  assert.equal((await settle(first.opus, input())).state, 'unavailable');
  const second = make(r0, () => { throw new Error('must not spawn'); });
  assert.equal((await second.opus.request(input())).state, 'unavailable');
  assert.equal(second.calls.length, 0);
});

test('not configured is a normal state with no spawn', async () => {
  const opus = createOpusCommentary({env: {}, spawn: () => { throw new Error('no'); }});
  assert.equal(opus.configured(), false);
  assert.equal((await opus.request(input())).state, 'unavailable');
});
