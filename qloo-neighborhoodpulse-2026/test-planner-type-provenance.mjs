import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, normalizeEntities, buildSchedule } from './planner.mjs';

const slug = kind => `urn:entity:${kind}`;

test('explicitly contradictory Qloo types cannot be assigned to the requested category', () => {
  const raw = { results: { entities: [
    { id: 'shared', name: 'Book in artist feed', type: slug('book') },
    { id: 'shared', name: 'The actual artist', type: slug('artist'), affinity: .8 },
    { id: 'movie', name: 'Another movie', entity_type: 'movie' },
    { id: 'known', name: 'Another artist', entity_type: slug('artist'), query: { affinity: .7 } },
    { id: 'conflict', name: 'Conflicting metadata', type: slug('artist'), entity_type: slug('place') },
  ] } };
  const out = normalizeEntities(raw, 'artist');
  assert.deepEqual(out.map(x => x.id), ['shared', 'known']);
  assert.deepEqual(out.map(x => x.rank), [2, 4]);
  assert.equal(out[0].affinity, .8);
  assert.equal(out[1].affinity, .7);
  assert.equal(out[0].qlooType, slug('artist'));
});

test('unknown/untyped Qloo rows preserve compatibility, exclusions and source rank', () => {
  const raw = { results: [
    { id: 'opaque', name: 'Opaque type', type: 'urn:entity:special' },
    { id: 'untagged', name: 'Legacy row' },
    { id: 'typed', name: 'Explicit match', type: 'BOOK' },
    { id: 'skip', name: 'Excluded', type: slug('book') },
  ] };
  const out = normalizeEntities(raw, 'book', ['skip']);
  assert.deepEqual(out.map(x => x.id), ['opaque', 'untagged', 'typed']);
  assert.deepEqual(out.map(x => x.rank), [1, 2, 3]);
});

test('four-week plan reports missing artist inventory instead of mislabeling a book', () => {
  const raw = Object.fromEntries(CATEGORIES.map(k => [k, { results: { entities: [] } }]));
  raw.artist.results.entities.push({ id: 'book-only', name: 'Misrouted book', type: slug('book'), query: { affinity: 1 } });
  raw.book.results.entities.push({ id: 'book-only', name: 'Actual book', type: slug('book'), query: { affinity: 1 } });
  const plan = buildSchedule({ city: 'Louisville', tastes: ['Jazz'], excludedIds: [], mode: 'live' }, [], raw);
  assert.equal(plan.availableByCategory.artist, 0);
  assert.equal(plan.availableByCategory.book, 1);
  assert(plan.weeks.every(x => x.program.artist === null && x.missingCategories.includes('artist')));
  assert.equal(plan.weeks[2].program.book.id, 'book-only');
});

// 1:1 execution of the real shipped normalizer across a diverse, reproducible
// Qloo-shaped input panel; this is not an external API or hidden competition run.
test('4,096 deterministic mixed-type panels retain source order without cross-category relabeling', t => {
  let seed = 20261009;
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const options = ['artist', 'movie', 'book', 'place', 'unknown', null];
  let rows = 0; let expectedDropped = 0; let keptUntyped = 0;
  for (let panel = 0; panel < 4096; panel++) {
    for (const category of CATEGORIES) {
      const raw = [];
      const length = 3 + (next() % 20);
      for (let j = 0; j < length; j++) {
        const kind = options[next() % options.length];
        const value = kind === null ? undefined : (next() % 2 ? kind : slug(kind));
        const row = { id: `p${panel}-${category}-${j}`, name: `Qloo candidate ${j}`, query: { affinity: (next() % 100) / 100 } };
        if (value !== undefined) row[next() % 2 ? 'type' : 'entity_type'] = value;
        raw.push(row);
      }
      rows += raw.length;
      const out = normalizeEntities({ results: { entities: raw } }, category);
      let previousRank = 0;
      for (const item of out) {
        assert(item.rank > previousRank, 'API return order is preserved');
        previousRank = item.rank;
        assert.equal(item.category, category);
        const source = raw[item.rank - 1];
        assert.equal(item.id, source.id);
        for (const field of ['type', 'entity_type']) {
          const tag = source[field]?.toLowerCase().replace(/^urn:entity:/, '');
          assert(!CATEGORIES.includes(tag) || tag === category,
            `mislabeled ${tag} as ${category}`);
        }
      }
      const independent = raw.filter(x => {
        const t = (x.type ?? x.entity_type)?.toLowerCase().replace(/^urn:entity:/, '');
        return !CATEGORIES.includes(t) || t === category;
      });
      assert.deepEqual(out.map(x => x.id), independent.map(x => x.id));
      expectedDropped += raw.length - independent.length;
      keptUntyped += out.filter(x => !raw[x.rank - 1].type && !raw[x.rank - 1].entity_type).length;
    }
  }
  assert(expectedDropped > 0 && keptUntyped > 0);
  t.diagnostic(`panels=4096 source_rows=${rows} dropped_contradictory=${expectedDropped} retained_untyped=${keptUntyped} final_seed=${seed >>> 0}`);
});
