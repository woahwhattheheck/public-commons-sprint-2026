// MIT. Private read-side acceleration for the authoritative BazaarCatalog Map.
// Indexes narrow candidates; they never validate, admit, retire or pay for an offer.
import { rankBazaarEntries } from './ranking.mjs';

const PAYMENT_KEYS = ['payTo', 'network', 'scheme', 'asset'];
const MAX_RESULTS = 64;
const MAX_REFERENCES = 200_000;

function matches(row, filters) {
  if (Object.hasOwn(filters, 'type') && row.extensions?.bazaar?.info?.input?.type !== filters.type) return false;
  if (Object.hasOwn(filters, 'extensions') && !Object.hasOwn(row.extensions, filters.extensions)) return false;
  // Intersecting per-field postings is only a candidate reduction: all payment
  // fields MUST still match the SAME original accepted option, never a hybrid.
  const keys = PAYMENT_KEYS.filter(key => Object.hasOwn(filters, key));
  return !keys.length || row.accepts.some(option =>
    keys.every(key => option?.[key] === filters[key]));
}

function dimensions(row) {
  const result = new Map([
    ['type', new Set([row.extensions?.bazaar?.info?.input?.type])],
    ['extensions', new Set(Object.keys(row.extensions))],
  ]);
  for (const key of PAYMENT_KEYS) result.set(key, new Set(row.accepts
    .map(option => option[key]).filter(value => typeof value === 'string')));
  return result;
}

/** Internal ownership contract: entries and returned row references stay inside
 * BazaarCatalog. Its public reads clone pages. Call changed AFTER each Map write;
 * a catalog clone owns a fresh Map and a fresh index, never another clone's cache.
 */
export class CatalogQueryIndex {
  #entries;
  #postings = new Map();
  #ordinals = new Map();
  #nextOrdinal = 0;
  #ready = false;
  #ordered = null;
  #cache = new Map();
  #references = 0;
  #counts = { indexBuilds: 0, orderBuilds: 0, candidateChecks: 0,
    listHits: 0, listMisses: 0, searchHits: 0, searchMisses: 0, rankRuns: 0,
    evictions: 0, invalidations: 0 };

  constructor(entries) { this.#entries = entries; }

  #post(id, row, add) {
    for (const [field, values] of dimensions(row)) {
      let fieldIndex = this.#postings.get(field);
      if (!fieldIndex && add) this.#postings.set(field, fieldIndex = new Map());
      if (!fieldIndex) continue;
      for (const value of values) {
        let ids = fieldIndex.get(value);
        if (add) {
          if (!ids) fieldIndex.set(value, ids = new Set());
          ids.add(id);
        } else if (ids) {
          ids.delete(id);
          if (!ids.size) fieldIndex.delete(value);
        }
      }
      if (!fieldIndex.size) this.#postings.delete(field);
    }
  }

  #ensureIndex() {
    if (this.#ready) return;
    for (const [id, row] of this.#entries) {
      this.#ordinals.set(id, this.#nextOrdinal++);
      this.#post(id, row, true);
    }
    this.#ready = true;
    this.#counts.indexBuilds++;
  }

  changed(id, before, after) {
    // An update replaces the Map's value without changing its insertion order.
    // Delete/reinsert DOES get a new ordinal, exactly like the original Map.
    if (this.#ready) {
      if (before !== undefined) this.#post(id, before, false);
      if (after !== undefined) {
        if (before === undefined) this.#ordinals.set(id, this.#nextOrdinal++);
        this.#post(id, after, true);
      } else this.#ordinals.delete(id);
    }
    if (before === undefined || after === undefined) this.#ordered = null;
    this.#cache.clear();
    this.#references = 0;
    this.#counts.invalidations++;
  }

  #candidateIds(filters) {
    const fields = Object.entries(filters);
    if (!fields.length) return [...this.#entries.keys()];
    this.#ensureIndex();
    const sets = [];
    for (const [field, value] of fields) {
      const ids = this.#postings.get(field)?.get(value);
      if (!ids) return [];
      sets.push(ids);
    }
    sets.sort((a, b) => a.size - b.size);
    const [smallest, ...rest] = sets, result = [];
    for (const id of smallest) {
      if (!rest.every(ids => ids.has(id))) continue;
      this.#counts.candidateChecks++;
      if (matches(this.#entries.get(id), filters)) result.push(id);
    }
    return result;
  }

  #memo(kind, filters, query, compute) {
    // Offset, limit and cursor select a page, not a different result set. The
    // caller checks cursor generation BEFORE this lookup; hits cannot revive it.
    const key = JSON.stringify([kind, query, Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))]);
    const hit = this.#cache.get(key);
    if (hit !== undefined) {
      this.#cache.delete(key); this.#cache.set(key, hit);
      this.#counts[kind + 'Hits']++;
      return hit;
    }
    this.#counts[kind + 'Misses']++;
    const result = compute(); // Invalid queries are not retained as cache entries.
    if (result.length <= MAX_REFERENCES) {
      while (this.#cache.size >= MAX_RESULTS || this.#references + result.length > MAX_REFERENCES) {
        const oldest = this.#cache.keys().next().value;
        this.#references -= this.#cache.get(oldest).length;
        this.#cache.delete(oldest); this.#counts.evictions++;
      }
      this.#cache.set(key, result); this.#references += result.length;
    }
    return result;
  }

  list(filters) {
    return this.#memo('list', filters, null, () => {
      let ids;
      if (!Object.keys(filters).length) {
        if (this.#ordered === null) {
          this.#ordered = [...this.#entries.keys()].sort((a, b) => a.localeCompare(b));
          this.#counts.orderBuilds++;
        }
        ids = this.#ordered;
      } else {
        ids = this.#candidateIds(filters);
        // Locale comparison can tie for distinct Unicode keys. Use Map insertion
        // order for that tie, matching the original stable full-catalog sort.
        ids.sort((a, b) => a.localeCompare(b) || this.#ordinals.get(a) - this.#ordinals.get(b));
      }
      return ids.map(id => this.#entries.get(id));
    });
  }

  search(filters, query) {
    return this.#memo('search', filters, query, () => {
      const ids = this.#candidateIds(filters);
      // Preserve the original corpus iteration order as well as corpus membership:
      // ranking's floating-point reductions and stable ties must remain identical.
      if (Object.keys(filters).length) ids.sort((a, b) => this.#ordinals.get(a) - this.#ordinals.get(b));
      this.#counts.rankRuns++;
      return rankBazaarEntries(ids.map(id => [id, this.#entries.get(id)]), query).map(item => item.row);
    });
  }

  get stats() {
    return { ...this.#counts, indexedEntries: this.#ready ? this.#ordinals.size : 0,
      cachedResults: this.#cache.size, cachedReferences: this.#references,
      maxCachedResults: MAX_RESULTS, maxCachedReferences: MAX_REFERENCES };
  }
}
