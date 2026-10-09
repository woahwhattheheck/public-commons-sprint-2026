import test from 'node:test';
import assert from 'node:assert/strict';
import { seedEvent } from '../seed.mjs';
import { proposeCoverage, applyProposal, parseIntent } from '../planner.mjs';

test('explicit without-Iris constraint removes top-ranked suggestion but preserves qualified complete coverage', () => {
  const initial = seedEvent();
  const proposal = proposeCoverage(initial, 'Cover welcome desk without Iris');
  assert.equal(proposal.ok, true);
  assert.deepEqual(proposal.chosen.map(v => v.id), ['zoe']);
  assert.equal(proposal.rejected.excluded, 1);
  assert.ok(proposal.trace.some(step => step.tool === 'explicit_exclusion' && /Iris/.test(step.result)));
  assert.match(proposal.trace.at(-1).result, /human approval/i);
  assert.equal(initial.revision, 0);
  assert.deepEqual(initial.shifts.find(s => s.id === 'welcome').assigned, ['maya']);
  const approved = applyProposal(initial, proposal);
  assert.deepEqual(approved.shifts.find(s => s.id === 'welcome').assigned, ['maya', 'zoe']);
  assert.equal(approved.revision, 1);
});

test('positive original intent and real absence semantics keep their source behavior', () => {
  const initial = seedEvent();
  assert.deepEqual(proposeCoverage(initial, 'Cover welcome desk').chosen.map(v => v.id), ['iris']);
  const absent = proposeCoverage(initial, "Maya can't make the welcome desk");
  assert.equal(absent.ok, true);
  assert.deepEqual(absent.chosen.map(v => v.id), ['iris', 'zoe']);
  assert.equal(absent.changes[0].action, 'remove');
  assert.equal(initial.revision, 0);
});

test('alternative explicit exclusion wording never selects excluded volunteer', () => {
  for (const command of [
    'Cover welcome desk do not assign Iris',
    "Cover welcome desk don't choose Iris",
    'Cover welcome desk except Iris',
    'Cover welcome desk skip Iris',
  ]) {
    const intent = parseIntent(command, seedEvent());
    assert.equal(intent.excludedVolunteerId, 'iris', command);
    const plan = proposeCoverage(seedEvent(), command);
    assert.equal(plan.ok, true, command);
    assert.deepEqual(plan.chosen.map(x => x.id), ['zoe'], command);
  }
});

test('negative constraints on already booked, unknown, or multiple people clarify without approval', () => {
  for (const command of [
    'Cover welcome desk without Maya',
    'Cover welcome desk without Jamie',
    'Cover welcome desk without Iris and Zoe',
    'Cover welcome desk without Iris, Zoe',
    'Cover welcome desk without',
  ]) {
    const plan = proposeCoverage(seedEvent(), command);
    assert.equal(plan.ok, false, command);
    assert.ok(!plan.changes?.length, command);
  }
});
