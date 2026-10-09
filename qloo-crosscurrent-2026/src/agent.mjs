// SPDX-License-Identifier: MIT
// Agent: evidence-grounded cross-category query -> revise -> shortlist.
export const DOMAINS = Object.freeze(['place', 'artist', 'movie', 'book', 'brand']);

function bestSeed(search, seed) {
  const normalize = value => value.normalize('NFKD').replace(/[\p{M}\W_]/gu, '').toLowerCase();
  const target = normalize(seed);
  return search.find(item => normalize(item.name) === target) ?? search[0] ?? null;
}

function pickAcrossDomains(results) {
  const used = new Set();
  return Object.entries(results).flatMap(([category, entities]) =>
    entities.slice(0, 4).map((entity, order) => ({...entity, category, order})))
    .filter(entity => { if (used.has(entity.id)) return false; used.add(entity.id); return true; });
}

export async function makeCulturalPlan({seed, city = '', goal = 'community-night'}, client) {
  if (!['community-night', 'independent-venue', 'pop-up-market'].includes(goal)) throw new Error('INVALID_GOAL');
  const trace = [];
  // Per-plan logical lookups, not QlooClient's process-lifetime network counter.
  // Cached or singleflight-backed requests can share an HTTP fetch across plans.
  let lookups = 0;
  const search = (...args) => { lookups += 1; return client.search(...args); };
  const insightsForPlan = (...args) => { lookups += 1; return client.insights(...args); };
  const usage = () => ({qloo_requests: lookups, qloo_request_metric: 'logical_plan_lookups'});
  const found = await search(seed);
  const selected = bestSeed(found, seed);
  trace.push({stage: 'SEARCH', result: selected ? 'FOUND_QLOO_ENTITY' : 'NO_ENTITY_MATCH', candidates: found.length});
  if (!selected) return {status: 'NO_ENTITY_MATCH', source: 'qloo-live', seed, trace, panels: [], proposals: [], ...usage()};

  const insights = {};
  // Bounded Qloo spend: each domain at most one query. Partial failures are not silently replaced.
  const runs = await Promise.allSettled(DOMAINS.map(category =>
    insightsForPlan(category, [selected.id], {city: category === 'place' ? city : ''})));
  // A local admission denial is NOT an empty provider result. Reject the
  // entire live plan rather than publishing a partially sampled concept.
  const budgetDenial = runs.find(run => run.status === 'rejected' && run.reason?.code === 'QLOO_LOCAL_BUDGET');
  if (budgetDenial) throw budgetDenial.reason;
  runs.forEach((result, index) => {
    const category = DOMAINS[index];
    if (result.status === 'fulfilled') {
      insights[category] = result.value.filter(e => e.id !== selected.id);
      trace.push({stage: 'INSIGHTS', category, result: insights[category].length ? 'RESULTS' : 'EMPTY',
        count: insights[category].length});
    } else {
      insights[category] = [];
      trace.push({stage: 'INSIGHTS', category, result: result.reason?.code ?? 'UPSTREAM_UNAVAILABLE', count: 0});
    }
  });

  const candidates = pickAcrossDomains(insights);
  // A resolved search ID alone is not evidence that any venue or community program fits.
  // Do not report successful live recommendations when upstream insights are entirely
  // unavailable, when a cross-domain signal is missing, or when no place was returned.
  const noProposal = status => ({
    status, source: 'qloo-live', seed, city, goal, resolved_seed: selected,
    proposals: [], panels: DOMAINS.map(category => ({category, entities: insights[category]})),
    bridge_places: [], trace, ...usage()
  });
  if (runs.every(result => result.status === 'rejected'))
    return noProposal('UPSTREAM_INSIGHTS_UNAVAILABLE');
  if (!candidates.length) return noProposal('NO_CULTURAL_MATCH');
  const culturalAnchor = candidates.find(e => e.category === 'artist' || e.category === 'movie' || e.category === 'book');
  if (!culturalAnchor) return noProposal('NO_CULTURAL_ANCHOR');
  let bridge = [];
  if (culturalAnchor) {
    try {
      // Second inference hop: a place fit should reflect two taste signals, not only the initial seed.
      bridge = (await insightsForPlan('place', [selected.id, culturalAnchor.id], {city, take: 5}))
        .filter(e => e.id !== selected.id && e.id !== culturalAnchor.id);
      trace.push({stage: 'BRIDGE', result: bridge.length ? 'TWO_SIGNAL_PLACE_MATCHES' : 'EMPTY',
        count: bridge.length, signals: [selected.id, culturalAnchor.id]});
    } catch (error) {
      if (error?.code === 'QLOO_LOCAL_BUDGET') throw error;
      trace.push({stage: 'BRIDGE', result: error?.code ?? 'UPSTREAM_UNAVAILABLE', count: 0});
    }
  }
  const place = bridge[0] ?? insights.place[0] ?? null;
  if (!place) return noProposal('NO_VERIFIED_PLACE');
  const artist = culturalAnchor;
  const partner = insights.brand[0] ?? null;
  const pitchByGoal = {
    'community-night': 'Host an intimate cross-scene discovery night.',
    'independent-venue': 'Test a distinct neighborhood venue programming partnership.',
    'pop-up-market': 'Curate a pop-up market around intersecting cultural interests.'
  };
  const proposal = {
    title: `${artist?.name ?? selected.name} × ${place?.name ?? 'local discovery'}`,
    idea: pitchByGoal[goal],
    evidence: [{role: 'seed', entity: selected.name, id: selected.id},
      ...(artist ? [{role: 'cultural bridge', entity: artist.name, id: artist.id}] : []),
      ...(place ? [{role: 'place fit', entity: place.name, id: place.id}] : []),
      ...(partner ? [{role: 'potential brand fit', entity: partner.name, id: partner.id}] : [])],
    caveat: 'Affinities are suggestions, not audience forecasts, confirmed venue partnerships, or attendance predictions.'
  };
  return {
    status: 'LIVE_QLOO_EVIDENCE', source: 'qloo-live', seed,
    city, goal, resolved_seed: selected, proposals: [proposal],
    panels: DOMAINS.map(category => ({category, entities: insights[category]})),
    bridge_places: bridge, trace, ...usage()
  };
}

// A deliberately labeled local demonstration; these fictional items are NOT Qloo output.
export function makeSyntheticDemo({seed, city = '', goal = 'community-night'}) {
  const names = ['Afterglow Collective', 'Moonlit Cinema', 'Paper Lantern Library', 'Field Notes Market', 'Indigo Sound Room'];
  const proposals = [{
    title: `${seed || 'Your cultural seed'} × ${city || 'an independent venue'}`,
    idea: 'Illustrative program: pair a listening session with a film conversation, independent booksellers and local makers.',
    evidence: names.map((name, i) => ({role: ['music','film','books','retail','venue'][i], entity: name, id: `fictional-demo-${i}`})),
    caveat: '100% synthetic fixture. No Qloo search, preference graph, score or live API call has occurred.'
  }];
  return {status: 'OFFLINE_SYNTHETIC_DEMO', source: 'fictional-fixture', seed, city, goal, proposals,
    panels: [], bridge_places: [], trace: [{stage: 'DEMO', result: 'FICTIONAL_NON_QLOO_DATA'}], qloo_requests: 0,
    qloo_request_metric: 'logical_plan_lookups'};
}
