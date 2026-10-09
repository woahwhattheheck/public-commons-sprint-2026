import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, CATEGORIES, validateRequest } from './planner.mjs';

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

test('4,096 bounded synthetic cases preserve source identities under cross-category collisions', () => {
  const random = seededRandom(20261009);
  let collisions = 0;
  let returned = 0;
  for (let trial = 0; trial < 4096; trial++) {
    const input = validateRequest({
      city: 'Louisville',
      tastes: ['Sade', 'sade', 'Björk'].slice(0, Math.floor(random() * 3) + 1),
      mode: 'fixture',
    });
    let collisionPossible = false;
    const raw = Object.fromEntries(CATEGORIES.map(kind => [kind, Array.from(
      { length: Math.floor(random() * 17) }, (_, index) => {
        const id = random() < 0.23 ? 'shared:' + (index % 7) : kind + ':' + trial + ':' + index;
        if (id.startsWith('shared:')) collisionPossible = true;
        return { id, name: kind + ' synthetic ' + index, affinity: random() * 1.8 - .3 };
      },
    )]));
    const plan = buildSchedule(input, [{ id: 'seed:1', name: 'Sade', query: 'Sade' }], raw);
    const selected = plan.weeks.flatMap(week => Object.values(week.program)).filter(Boolean);
    assert.equal(plan.weeks.length, 4);
    assert.equal(plan.mode, 'fixture');
    assert.equal(new Set(selected.map(entity => entity.id)).size, selected.length,
      'duplicate source identity at trial ' + trial);
    for (const category of CATEGORIES) {
      assert.equal(plan.availableByCategory[category], new Set(raw[category].map(x => x.id)).size);
    }
    for (const entity of selected) {
      assert.ok(raw[entity.category].some(source => source.id === entity.id),
        'invented source identity at trial ' + trial);
    }
    for (const week of plan.weeks) {
      assert.equal(week.missingCategories.length,
        CATEGORIES.filter(category => !week.program[category]).length);
    }
    collisions += Number(collisionPossible);
    returned += selected.length;
  }
  assert.ok(collisions > 4000, 'adversarial shared-ID coverage');
  assert.ok(returned > 50000, 'substantial source-backed output coverage');
});
