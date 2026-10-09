import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, CATEGORIES, validateRequest } from './planner.mjs';

const valid = (overrides = {}) => ({ city: 'Louisville', tastes: ['Massive Attack'], mode: 'fixture', ...overrides });

test('explicit fixture mode remains synthetic and omitted mode keeps the old live default', () => {
  assert.equal(validateRequest(valid()).mode, 'fixture');
  assert.equal(validateRequest(valid({ mode: 'live' })).mode, 'live');
  const omitted = valid();
  delete omitted.mode;
  assert.equal(validateRequest(omitted).mode, 'live');
});

test('unknown explicit modes fail closed before a Qloo request could be assembled', () => {
  for (const mode of ['fixutre', 'LIVE', 'preview', '', null, false, 0, {}, []]) {
    assert.throws(() => validateRequest(valid({ mode })), /Mode must be/);
  }
});

test('case-variant taste references are resolved once; first spelling and input retained', () => {
  const input = valid({ tastes: [' Massive Attack ', 'massive attack', 'MASSIVE ATTACK'] });
  const output = validateRequest(input);
  assert.deepEqual(output.tastes, ['Massive Attack']);
  assert.deepEqual(input.tastes, [' Massive Attack ', 'massive attack', 'MASSIVE ATTACK']);
});

test('case-insensitive dedupe keeps distinct cultural references in order', () => {
  const got = validateRequest(valid({ tastes: ['Björk', 'björk', 'Sade'] }));
  assert.deepEqual(got.tastes, ['Björk', 'Sade']);
});

test('baseline shape, exclusions and 1–3 references limit remain unchanged', () => {
  const got = validateRequest(valid({ excludedIds: ['same.id', 'same.id'] }));
  assert.deepEqual(got.excludedIds, ['same.id']);
  assert.throws(() => validateRequest(valid({ tastes: [] })), /Supply 1–3/);
  assert.throws(() => validateRequest(valid({ tastes: ['a', 'b', 'c', 'd'] })), /Supply 1–3/);
  assert.throws(() => validateRequest(valid({ excludedIds: ['<script>'] })), /Excluded/);
});

test('256 offline synthetic allocation fixtures preserve uniqueness, source IDs and themed-best placement', () => {
  const kinds = [...CATEGORIES];
  let trials = 0;
  for (let trial = 0; trial < 256; trial++) {
    const input = validateRequest(valid({ tastes: ['Sade', 'sade'] }));
    const raw = Object.fromEntries(kinds.map((kind, k) => {
      const count = (trial + 3 * k) % 8;
      return [kind, Array.from({ length: count }, (_, i) => ({
        id: `${kind}:${trial}:${i}`, name: `${kind} fixture ${i}`,
        affinity: 1 - i * .1,
      }))];
    }));
    const plan = buildSchedule(input, [{ query: 'Sade', id: 'seed:1', name: 'Sade' }], raw);
    assert.equal(plan.weeks.length, 4);
    assert.equal(plan.mode, 'fixture');
    assert.deepEqual(plan.tastes, ['Sade']);
    const nonEmpty = plan.weeks.flatMap(w => Object.values(w.program)).filter(Boolean);
    assert.equal(new Set(nonEmpty.map(x => x.id)).size, nonEmpty.length, 'no duplicate Qloo IDs');
    for (const [index, kind] of ['artist', 'movie', 'book', 'place'].entries()) {
      const available = raw[kind];
      assert.equal(plan.availableByCategory[kind], available.length);
      if (available.length) {
        assert.equal(plan.weeks[index].program[kind]?.id, available[0].id, 'best candidate reserved for theme');
      }
    }
    for (const item of nonEmpty) assert.ok(raw[item.category].some(x => x.id === item.id), 'each entity source-backed');
    trials++;
  }
  assert.equal(trials, 256);
});
