// MIT. SF73: source-retaining, corpus-aware search across native SF70 observations.
// Reuses the original SCF-23 Bazaar lexical ranker rather than maintaining a second scoring law.
import { rankBazaarEntries } from './ranking.mjs';

const string = value => typeof value === 'string' ? value : '';
const supported = row => row !== null && typeof row === 'object' && !Array.isArray(row);

/**
 * Return original native projection objects in relevance order. Preserve duplicate
 * provider observations as separate rows, including their complete payment options.
 * The ranker only sees searchable display metadata, never an inferred paid quote.
 */
export function rankFederatedListings(observations, query = '', provider = '') {
  if (!Array.isArray(observations)) throw new TypeError('Expected native resource observations');
  const rows = observations.filter(row =>
    supported(row) && (!provider || row.source === provider));
  if (!query || !String(query).trim()) return rows;
  const text = String(query).trim();
  if (text.length > 1024) return [];

  const original = new Map();
  const pairs = rows.map((row, index) => {
    // Index distinguishes repeated rows from the same provider.
    // Do not equate resources across unrelated providers by URL or price.
    const id = JSON.stringify([string(row.source), row.sourceRow ?? null, index]);
    original.set(id, row);
    return [id, {
      resource: {
        serviceName: string(row.label),
        description: string(row.description),
        url: string(row.url),
        tags: [row.kind, row.method].filter(value => typeof value === 'string' && value),
      },
      extensions: { bazaar: { info: { input: {
        toolName: string(row.toolName),
      } } } },
    }];
  });
  try {
    return rankBazaarEntries(pairs, text).map(hit => original.get(hit.key));
  } catch (error) {
    // Search-box punctuation alone is not a failed native provider.
    if (error instanceof RangeError) return [];
    throw error;
  }
}
