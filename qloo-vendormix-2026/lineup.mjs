// SPDX-License-Identifier: MIT
// Pure, offline VendorMix planner. Labels are observed Qloo tags, not verified business types.

export function categoryKey(raw) {
  const label = typeof raw === 'string' ? raw.normalize('NFKC').trim().replace(/\s+/gu, ' ') : '';
  return (label || 'Unclassified').toLocaleLowerCase('en-US');
}

export function parseCategoryCap(raw, slots) {
  if (raw === undefined) return null; // Existing API requests preserve soft-variety mode.
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > slots) {
    throw new Error('Category cap must be a whole number between 1 and the requested slots');
  }
  return raw;
}

/**
 * Optional hard limit per *observed category label* (including Unclassified).
 * It cannot guarantee meaningful business categories if a provider's tags are sparse.
 * Selection never fills with excluded/duplicate candidates to bypass a cap.
 */
export function rankLineup(candidates, input) {
  const excluded = new Set(input.exclusions);
  const remaining = candidates.filter(c => !excluded.has(c.name.toLowerCase()));
  const chosen = [];
  const counts = new Map(); // Prior soft-variety logic ignores Unclassified.
  const capCounts = new Map(); // Hard constraint still treats unknown tags as one bucket.
  const weights = input.mode === 'taste' ? { taste: 0.92, new: 0.08, repeat: 0.04 }
    : input.mode === 'discovery' ? { taste: 0.52, new: 0.48, repeat: 0.24 }
      : { taste: 0.70, new: 0.30, repeat: 0.14 };
  const seen = new Set();
  while (chosen.length < input.slots) {
    const options = remaining.filter(c =>
      !seen.has(c.id) &&
      !chosen.some(v => v.name.toLowerCase() === c.name.toLowerCase()) &&
      (input.categoryCap === null || (capCounts.get(categoryKey(c.category)) || 0) < input.categoryCap)
    ).map(c => {
      const key = categoryKey(c.category);
      const verifiedTag = key !== 'unclassified';
      const duplicates = verifiedTag ? (counts.get(key) || 0) : 0;
      const diversity = verifiedTag && duplicates === 0 ? 1 : 0;
      const utility = weights.taste * c.signal + weights.new * diversity - weights.repeat * duplicates;
      return { ...c, utility, diversity, repeats: duplicates };
    });
    if (!options.length) break;
    options.sort((a, b) => b.utility - a.utility || a.ordinal - b.ordinal || a.name.localeCompare(b.name));
    const pick = options[0];
    chosen.push({ ...pick, explanation: `${pick.evidence}. ${pick.diversity ? 'New observed category for this lineup.' : (pick.repeats ? 'Category repeats; scored with a variety penalty.' : 'No verified category tag; variety bonus withheld.')}` });
    seen.add(pick.id);
    const key = categoryKey(pick.category);
    capCounts.set(key, (capCounts.get(key) || 0) + 1);
    if (key !== 'unclassified') counts.set(key, (counts.get(key) || 0) + 1);
  }
  const covered = [...counts.keys()].filter(key => key !== 'unclassified').length;
  const shortfall = chosen.length < input.slots;
  return {
    selected: chosen,
    alternatives: remaining.filter(c => !chosen.some(v => v.id === c.id)).slice(0, 8),
    summary: {
      requested: input.slots, filled: chosen.length, observedCategories: covered,
      analyzed: remaining.length, strategy: input.mode, categoryCap: input.categoryCap,
      shortfallNote: shortfall ? 'Not enough distinct eligible candidates to fill the requested slots under the selected exclusions and category cap; no invented vendors added.' : null,
      warning: 'Taste affinity and observed category tags are not proof of vendor availability, safety, dietary suitability, booking or expected sales.'
    }
  };
}
