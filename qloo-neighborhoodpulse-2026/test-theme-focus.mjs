import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, CATEGORIES } from './planner.mjs';
import { fixtureResponses } from './fixtures.mjs';

const request = {
  city: 'Louisville', tastes: ['Nina Simone'], excludedIds: [], mode: 'fixture',
};

test('each theme receives its actual highest-scored Qloo candidate', () => {
  const { signals, raw } = fixtureResponses(request);
  const plan = buildSchedule(request, signals, raw);
  assert.equal(plan.weeks[0].program.artist?.id, 'sample-artist-1');
  assert.equal(plan.weeks[1].program.movie?.id, 'sample-movie-1');
  assert.equal(plan.weeks[2].program.book?.id, 'sample-book-1');
  assert.equal(plan.weeks[3].program.place?.id, 'sample-place-1');
  assert(plan.weeks.every(w => CATEGORIES.every(k => w.program[k] !== null)));
  for (const category of CATEGORIES) {
    const selected = plan.weeks.map(w => w.program[category].id);
    assert.equal(new Set(selected).size, 4);
  }
});

test('theme reservations follow actual source affinity and preserve negative feedback', () => {
  const { signals, raw } = fixtureResponses(request);
  raw.artist.results.entities[0].query.affinity = 0.1;
  raw.artist.results.entities[1].query.affinity = 0.8;
  const sourceDriven = buildSchedule(request, signals, raw);
  assert.equal(sourceDriven.weeks[0].program.artist?.id, 'sample-artist-2');
  const excluded = buildSchedule(
    { ...request, excludedIds: ['sample-movie-1'] }, signals, raw,
  );
  assert.equal(excluded.weeks[1].program.movie?.id, 'sample-movie-2');
  assert(excluded.weeks.every(w => w.program.movie?.id !== 'sample-movie-1'));
});

test('sparse genuine data leaves missing slots rather than repeating or inventing', () => {
  const raw = Object.fromEntries(CATEGORIES.map(k => [k, {
    results: { entities: [{id: `one-${k}`, name: `One ${k}`, query: {affinity: 0.7}}] },
  }]));
  const plan = buildSchedule(request, [], raw);
  const focus = ['artist', 'movie', 'book', 'place'];
  for (let w = 0; w < 4; w++) {
    assert.equal(plan.weeks[w].program[focus[w]]?.id, `one-${focus[w]}`);
    assert.equal(plan.weeks[w].missingCategories.length, 3);
  }
  const assigned = plan.weeks.flatMap(w => CATEGORIES.map(k => w.program[k]?.id).filter(Boolean));
  assert.equal(assigned.length, 4);
  assert.equal(new Set(assigned).size, 4);
});
