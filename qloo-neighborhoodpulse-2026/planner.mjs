/** NeighborhoodPulse: deterministic, explainable cross-domain programming planner.
 * All entity identities and displayed affinities originate in supplied Qloo responses.
 * Event formats and calendar weeks are original planning suggestions, not Qloo claims.
 */
const TYPE_TO_SLUG = Object.freeze({
  artist: 'urn:entity:artist', book: 'urn:entity:book',
  movie: 'urn:entity:movie', place: 'urn:entity:place',
});
export const CATEGORIES = Object.keys(TYPE_TO_SLUG);
export const SOURCE_MODES = Object.freeze({ fixture: 'SYNTHETIC FIXTURE', live: 'QLOO LIVE' });
const WEEKS = Object.freeze([
  { name: 'Listening Room', focus: 'artist', explanation: 'Explore music, stories, and locally relevant culture together.' },
  { name: 'Screen & Discuss', focus: 'movie', explanation: 'Host a film-inspired discussion with cross-domain cultural connections.' },
  { name: 'Reading Salon', focus: 'book', explanation: 'Build a moderated reading and storytelling salon.' },
  { name: 'Neighborhood Remix', focus: 'place', explanation: 'Explore cultural partnerships and possible community locations.' },
]);

export function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON request object.');
  const city = String(value.city ?? '').trim();
  if (city.length < 2 || city.length > 100 || /[\u0000-\u001f]/.test(city)) throw new Error('City must be 2–100 valid characters.');
  if (!Array.isArray(value.tastes) || value.tastes.length < 1 || value.tastes.length > 3) throw new Error('Supply 1–3 culture reference names.');
  const tastes = value.tastes.map((t) => typeof t === 'string' ? t.trim() : '');
  if (tastes.some(t => t.length < 2 || t.length > 110 || /[\u0000-\u001f]/.test(t))) throw new Error('Each culture reference must be 2–110 valid characters.');
  const excluded = value.excludedIds ?? [];
  if (!Array.isArray(excluded) || excluded.length > 40 || excluded.some(x => typeof x !== 'string' || !/^[A-Za-z0-9_:\-.]{1,130}$/.test(x))) {
    throw new Error('Excluded entities must be an array of at most 40 valid Qloo IDs.');
  }
  const mode = value.mode === 'fixture' ? 'fixture' : 'live';
  return { city, tastes: [...new Set(tastes)], excludedIds: [...new Set(excluded)], mode };
}

function safeName(x) {
  const val = x?.name ?? x?.title ?? x?.properties?.name ?? x?.properties?.title;
  return typeof val === 'string' ? val.trim().slice(0, 160) : '';
}
function safeId(x) {
  const val = x?.entity_id ?? x?.entityId ?? x?.id ?? x?.qloo_id;
  return typeof val === 'string' || typeof val === 'number' ? String(val).slice(0, 130) : '';
}
function arrayCandidates(raw) {
  const fields = [raw, raw?.results?.entities, raw?.results?.items, raw?.results?.results,
    raw?.results, raw?.data?.entities, raw?.data?.results, raw?.data, raw?.entities, raw?.items];
  return fields.find(Array.isArray) ?? [];
}
function readAffinity(x) {
  const possible = [x?.query?.affinity, x?.query?.affinity_score, x?.query?.score,
    x?.affinity, x?.affinity_score, x?.query?.affinity?.score];
  for (const n of possible) if (typeof n === 'number' && Number.isFinite(n)) return Math.round(n * 1000) / 1000;
  return null;
}
/** Never synthesize Qloo entity names, IDs or affinity metrics. */
export function normalizeEntities(raw, category, excludedIds = []) {
  const excluded = new Set(excludedIds);
  const seen = new Set();
  return arrayCandidates(raw).flatMap((x, rank) => {
    if (!x || typeof x !== 'object') return [];
    const id = safeId(x); const name = safeName(x);
    if (!id || !name || seen.has(id) || excluded.has(id)) return [];
    seen.add(id);
    const categoryType = typeof x.type === 'string' ? x.type : (x.entity_type || null);
    const affinity = readAffinity(x);
    const address = x?.properties?.address || x?.address;
    return [{ id, name, category, qlooType: categoryType, affinity,
      rank: rank + 1, address: category === 'place' && typeof address === 'string' ? address.slice(0, 200) : null }];
  });
}

function scoreCandidate(e, week, used, category, pinnedIds) {
  const affinity = e.affinity !== null ? Math.max(-2, Math.min(2, e.affinity)) : 0;
  const positionScore = 1 / Math.sqrt(e.rank || 1);
  const concentrationPenalty = used.has(e.id) ? 9 : 0;
  const categoryBoost = week.focus === category ? 0.55 : 0;
  return affinity + positionScore + categoryBoost + (pinnedIds.includes(e.id) ? 3 : 0) - concentrationPenalty;
}

/** Generate four distinct briefs with deliberate empty slots if Qloo returns too little.
 * The algorithm never repeats an entity to pad a program; it reports missing data instead.
 */
export function buildSchedule({ city, tastes, excludedIds = [], mode }, signals, raw) {
  const excluded = new Set(excludedIds);
  const pools = Object.fromEntries(CATEGORIES.map(k => [k, normalizeEntities(raw[k], k, excludedIds)]));
  const weeks = [];
  const used = new Set();
  for (let w = 0; w < WEEKS.length; w++) {
    const week = WEEKS[w];
    const choices = {};
    for (const kind of CATEGORIES) {
      const eligible = pools[kind].filter(x => !used.has(x.id) && !excluded.has(x.id));
      eligible.sort((a, b) => scoreCandidate(b, week, used, kind, []) - scoreCandidate(a, week, used, kind, []));
      choices[kind] = eligible[0] ?? null;
      if (choices[kind]) used.add(choices[kind].id);
    }
    weeks.push({ week: w + 1, title: week.name, format: week.explanation,
      program: choices, missingCategories: CATEGORIES.filter(k => !choices[k]),
      notice: 'Planning concept only: no venue, event, rights, reservations, accessibility, or opening hours are verified.' });
  }
  const totals = Object.fromEntries(CATEGORIES.map(k => [k, pools[k].length]));
  return {
    product: 'NeighborhoodPulse', schemaVersion: 1, mode,
    sourceLabel: SOURCE_MODES[mode], city, tastes,
    signals: signals.map(x => ({ query: x.query, id: x.id, name: x.name, type: x.type || null })),
    weeks, availableByCategory: totals, excludedIds: [...excluded],
    methodology: {
      insightTypes: TYPE_TO_SLUG,
      method: 'Qloo-ranked recommendations allocated once per category across four original event-format briefs; no entity fabrication.',
      scoreSemantics: 'affinity is displayed only if explicitly numeric in Qloo response; rank is API return order and is not probability.',
      locality: 'The named-city filter applies to place results only.',
      factsNotVerified: ['opening hours', 'event schedules', 'ticket prices', 'accessibility', 'venue availability', 'broadcast rights', 'sponsorship'],
    },
    generatedAt: new Date().toISOString(),
  };
}

export const TYPES = TYPE_TO_SLUG;
