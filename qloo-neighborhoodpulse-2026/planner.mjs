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
  // An explicit typo must not silently enter live mode and spend Qloo quota.
  // Retain the historical live default only when mode is omitted.
  if (value.mode !== undefined && value.mode !== 'fixture' && value.mode !== 'live') {
    throw new Error('Mode must be "fixture" or "live".');
  }
  const mode = value.mode ?? 'live';
  // Case-variant repeats resolve to the same upstream taste and cost extra
  // /search calls. Preserve the spelling of the first distinct reference.
  const seenTastes = new Set();
  const uniqueTastes = tastes.filter(t => {
    const key = t.toLocaleLowerCase('en-US');
    if (seenTastes.has(key)) return false;
    seenTastes.add(key);
    return true;
  });
  return { city, tastes: uniqueTastes, excludedIds: [...new Set(excluded)], mode };
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

function scoreCandidate(e) {
  const affinity = e.affinity !== null ? Math.max(-2, Math.min(2, e.affinity)) : 0;
  // Rank breaks close affinity ties, but it is not a probability or confidence.
  return affinity + 1 / Math.sqrt(e.rank || 1);
}

/** Generate four distinct briefs with deliberate empty slots if Qloo returns too little.
 * The algorithm never repeats an entity to pad a program; it reports missing data instead.
 */
export function buildSchedule({ city, tastes, excludedIds = [], mode }, signals, raw) {
  const excluded = new Set(excludedIds);
  const pools = Object.fromEntries(CATEGORIES.map(k => [k, normalizeEntities(raw[k], k, excludedIds)]));
  const ordered = Object.fromEntries(CATEGORIES.map(kind => [
    kind, [...pools[kind]].sort((a, b) => scoreCandidate(b) - scoreCandidate(a) || a.rank - b.rank),
  ]));
  const programs = WEEKS.map(() => Object.fromEntries(CATEGORIES.map(k => [k, null])));
  const used = new Set();

  // The former focus "boost" was identical for every candidate in a category:
  // it never affected ranking and silently put all strongest matches in week 1.
  // Reserve each category's best available real Qloo entity for its focus week.
  for (let w = 0; w < WEEKS.length; w++) {
    const kind = WEEKS[w].focus;
    const best = ordered[kind].find(x => !used.has(x.id));
    if (best) {
      programs[w][kind] = best;
      used.add(best.id);
    }
  }
  // Then fill cross-domain companion slots from actual remaining results.
  // Global used IDs prevent duplicate recommendations, even across categories.
  for (let w = 0; w < WEEKS.length; w++) {
    for (const kind of CATEGORIES) {
      if (programs[w][kind]) continue;
      const best = ordered[kind].find(x => !used.has(x.id));
      if (best) {
        programs[w][kind] = best;
        used.add(best.id);
      }
    }
  }
  const weeks = WEEKS.map((week, w) => ({
    week: w + 1, title: week.name, format: week.explanation,
    program: programs[w], missingCategories: CATEGORIES.filter(k => !programs[w][k]),
    notice: 'Planning concept only: no venue, event, rights, reservations, accessibility, or opening hours are verified.',
  }));
  const totals = Object.fromEntries(CATEGORIES.map(k => [k, pools[k].length]));
  return {
    product: 'NeighborhoodPulse', schemaVersion: 1, mode,
    sourceLabel: SOURCE_MODES[mode], city, tastes,
    signals: signals.map(x => ({ query: x.query, id: x.id, name: x.name, type: x.type || null })),
    weeks, availableByCategory: totals, excludedIds: [...excluded],
    methodology: {
      insightTypes: TYPE_TO_SLUG,
      method: 'Top source-backed Qloo candidate for each category reserved for its themed week; remaining category slots filled by rank and available affinity without reuse or fabrication.',
      scoreSemantics: 'affinity is displayed only if explicitly numeric in Qloo response; rank is API return order and is not probability.',
      locality: 'The named-city filter applies to place results only.',
      factsNotVerified: ['opening hours', 'event schedules', 'ticket prices', 'accessibility', 'venue availability', 'broadcast rights', 'sponsorship'],
    },
    generatedAt: new Date().toISOString(),
  };
}

export const TYPES = TYPE_TO_SLUG;
