/**
 * SignalGuard agent: four-step Qloo evidence-gathering & bounded analysis.
 * This algorithm never describes synthetic data as Qloo evidence.
 */
const seedTypes = new Set(['urn:entity:movie', 'urn:entity:artist', 'urn:entity:book']);
const targets = new Set(['urn:entity:movie', 'urn:entity:artist', 'urn:entity:book']);

function numberInRange(value, lo, hi) {
  // An empty string, boolean or array coerces to 0/1: NOT a Qloo measurement.
  if (value === null || value === undefined ||
      (typeof value !== 'string' && typeof value !== 'number')) return null;
  if (typeof value === 'string') {
    const decimal = value.trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(decimal)) return null;
    value = decimal;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

const isRecord = item => item !== null && typeof item === 'object' && !Array.isArray(item);
function uniqueIds(rows) {
  const seen = new Set();
  return rows.filter(row => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export function normalizeCandidates(payload) {
  const results = payload?.results;
  const raw = Array.isArray(results?.entities) ? results.entities
    : Array.isArray(results) ? results
    : Array.isArray(payload?.entities) ? payload.entities : [];
  return uniqueIds(raw.slice(0, 30).filter(isRecord).map(item => ({
    id: String(item.entity_id ?? item.id ?? item.entity?.entity_id ?? ''),
    name: String(item.name ?? item.entity?.name ?? ''),
    type: String(item.subtype ?? item.type ?? item.entity?.subtype ?? ''),
  })).filter(row => row.id && row.name));
}

export function normalizeInsights(payload) {
  const entities = payload?.results?.entities;
  if (!Array.isArray(entities)) throw new Error('Unexpected Qloo Insights response; entities[] is missing');
  return uniqueIds(entities.slice(0, 40).filter(isRecord).map(item => ({
    id: String(item.entity_id ?? item.id ?? ''),
    name: String(item.name ?? ''),
    popularity: numberInRange(item.popularity, 0, 1),
    type: String(item.subtype ?? ''),
    description: String(item.properties?.description ?? '').slice(0, 210),
  })).filter(row => row.id && row.name));
}

const median = xs => {
  const sorted = [...xs].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const h = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function segment(rows, baseline) {
  const b = new Set(baseline.map(r => r.id));
  return {
    count: rows.length,
    newVsBaseline: rows.filter(row => !b.has(row.id)).length,
    overlapWithBaseline: rows.filter(row => b.has(row.id)).length,
    results: rows,
  };
}

export async function audit({ seed, seedType, target }, provider) {
  if (typeof seed !== 'string' || seed.trim().length < 2 || seed.trim().length > 100)
    throw new Error('Enter a seed title or artist name between 2 and 100 characters');
  if (!seedTypes.has(seedType) || !targets.has(target)) throw new Error('Unsupported Qloo entity category');
  if (!provider || typeof provider.search !== 'function' || typeof provider.insights !== 'function')
    throw new Error('A search and insights provider is required');

  const trace = [];
  const normalizedSeed = seed.trim();
  trace.push({ step: 'resolve', detail: 'Resolving the supplied title to a Qloo entity ID' });
  const candidates = normalizeCandidates(await provider.search(normalizedSeed, seedType));
  if (!candidates.length) return { status: 'abstained', reason: 'No matching Qloo entity ID was returned', trace };
  const exact = candidates.find(c => c.name.toLowerCase() === normalizedSeed.toLowerCase());
  const selected = exact ?? candidates[0];
  trace.push({ step: 'baseline', detail: `Querying ${target} against a Qloo entity signal` });
  const baseline = normalizeInsights(await provider.insights({ target, entityId: selected.id, take: 15 }));
  if (!baseline.length) return { status: 'abstained', reason: 'Qloo returned no baseline entities; an evidence-based audit is not possible', seed: selected, trace };

  const availablePops = baseline.map(row => row.popularity).filter(n => n !== null);
  const med = median(availablePops);
  const pivot = med === null ? 0.55 : Math.round(clamp(med, 0.25, 0.8) * 100) / 100;
  const notes = [];
  if (med === null) notes.push('Qloo omitted popularity for these baseline entities; the 0.55 threshold is a neutral fallback, not a measured distribution.');
  trace.push({ step: 'probe', detail: `Auditing low/high popularity slices around ${pivot.toFixed(2)} (two independent Qloo Insights queries)` });
  const settled = await Promise.allSettled([
    provider.insights({ target, entityId: selected.id, take: 15, maxPopularity: pivot }),
    provider.insights({ target, entityId: selected.id, take: 15, minPopularity: pivot }),
  ]);
  const status = { low: 'ok', high: 'ok' };
  const rows = [];
  for (let i = 0; i < settled.length; i++) {
    const key = i === 0 ? 'low' : 'high';
    try {
      if (settled[i].status !== 'fulfilled') throw settled[i].reason;
      rows.push(normalizeInsights(settled[i].value));
    } catch (err) {
      status[key] = 'unavailable';
      rows.push([]);
      notes.push(`${key === 'low' ? 'Lower' : 'Higher'}-popularity segment unavailable: ${String(err?.message ?? err).slice(0,140)}.`);
    }
  }
  if (status.low !== 'ok' && status.high !== 'ok')
    notes.push('Both slice calls failed; do not infer audience balance or overlap from missing probes.');
  const low = segment(rows[0], baseline);
  const high = segment(rows[1], baseline);
  const highShare = availablePops.length ? availablePops.filter(v => v >= pivot).length / availablePops.length : null;
  trace.push({ step: 'audit', detail: 'Compared actual Qloo entity IDs; no invented affinity score or causal inference' });

  let summary;
  if (status.low === 'ok' && status.high === 'ok') {
    summary = `Baseline contains ${baseline.length} ${target.split(':').pop()} entities. The Qloo lower-popularity query returned ${low.count} (${low.newVsBaseline} outside the baseline top list) and the higher-popularity query returned ${high.count} (${high.newVsBaseline} outside that list). These are retrieval differences under changed filters, not audience percentages or causal effects.`;
  } else {
    summary = `Baseline retrieved ${baseline.length} entities. One or more popularity probes failed; the audit cannot establish the full segment comparison.`;
  }
  const actions = [
    'Inspect lower-popularity entities independently before planning a campaign; novelty is not evidence of demand.',
    'Compare the retrieved names and popularity metadata against the actual creative brief and available rights.',
    'Do not equate entity retrieval rank, top-list intersection or Qloo popularity with conversion, fairness or revenue.',
  ];
  return {
    status: 'complete',
    seed: selected,
    lookup: exact ? 'exact name' : 'best available name match',
    target,
    pivot,
    summary,
    metrics: { baselineCount: baseline.length, reportedPopularity: availablePops.length, medianPopularity: med, highShare },
    segments: { baseline: segment(baseline, baseline), low: { ...low, status: status.low }, high: { ...high, status: status.high } },
    notes, actions, trace,
    evidence: 'Qloo entity IDs and popularity filters only; no invented individual-level or demographic data',
  };
}
