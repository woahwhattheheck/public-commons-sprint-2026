// MIT. Deterministic, dependency-free lexical/fuzzy ranking for validated x402 Bazaar records.
// This module only reads already trusted catalog rows; it never ingests payment payloads.
const STOP = new Set([
  'a','an','and','are','can','could','find','for','get','give','i','in','is','me',
  'my','of','on','or','please','show','that','the','to','want','which','with','you'
]);
const NORMALIZE = s => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
export const tokenize = s => NORMALIZE(s).match(/[\p{L}\p{N}]+/gu) ?? [];
const words = s => tokenize(typeof s === 'string' ? s.slice(0,2048) : '');
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const field = (text, weight) => ({ tokens: words(text).slice(0,128), weight });

// Input annotations share the original parameter field's 2048-character /
// 128-token budget. Walk only request schemas that the seller actually emits.
// Request examples, defaults and response payloads do not contribute terms.
const SCHEMA_NODES = 128;
const SCHEMA_DEPTH = 16;
const SCHEMA_CHILDREN = 32;
const PARAMETER_CHARS = 2048;
const HTTP_PARAMETER_GROUPS = ['queryParams', 'body', 'pathParams', 'headers'];

function localSchemaReference(root, reference) {
  if (typeof reference !== 'string' || reference.length > 2048 ||
      !reference.startsWith('#')) return null;
  let pointer;
  try { pointer = decodeURIComponent(reference.slice(1)); }
  catch { return null; }
  if (pointer === '') return root;
  if (!pointer.startsWith('/')) return null;
  const parts = pointer.slice(1).split('/');
  if (parts.length > SCHEMA_DEPTH * 2) return null;
  let node = root;
  for (const part of parts) {
    if (/~(?:[^01]|$)/.test(part)) return null;
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, key)) return null;
    node = node[key];
  }
  return object(node) ? node : null;
}

function schemaAlternatives(schema, root) {
  const alternatives = [];
  const reference = localSchemaReference(root, schema.$ref);
  if (reference) alternatives.push(reference);
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(schema[keyword]))
      alternatives.push(...schema[keyword].slice(0, SCHEMA_CHILDREN).filter(object));
  }
  return alternatives;
}

/** Locate the actual HTTP input groups, including composed/local-ref containers. */
function httpParameterSchemas(root) {
  if (!object(root)) return [];
  const queue = [{ schema: root, step: 0, depth: 0 }], result = [];
  const seen = new WeakMap();
  const enqueue = (schema, step, depth) => {
    if (object(schema) && depth <= SCHEMA_DEPTH && queue.length < SCHEMA_NODES)
      queue.push({ schema, step, depth });
  };
  for (let at = 0; at < queue.length; at++) {
    const { schema, step, depth } = queue[at];
    const visits = seen.get(schema) ?? new Set();
    if (visits.has(step)) continue;
    visits.add(step); seen.set(schema, visits);
    if (step === 2) { result.push(schema); continue; }
    const properties = object(schema.properties) ? schema.properties : {};
    for (const name of step === 0 ? ['input'] : HTTP_PARAMETER_GROUPS)
      if (Object.hasOwn(properties, name)) enqueue(properties[name], step + 1, depth + 1);
    for (const alternative of schemaAlternatives(schema, root))
      enqueue(alternative, step, depth + 1);
  }
  return result;
}

/**
 * Breadth-first traversal keeps top-level parameters ahead of deep schemas.
 * Local JSON pointers resolve only inside their original schema document;
 * unreachable definitions and remote references do not contribute terms.
 */
function inputParameterText(row, input) {
  const bazaarSchema = row.extensions?.bazaar?.schema;
  const roots = input.type === 'http'
    ? httpParameterSchemas(bazaarSchema).map(schema => ({ schema, root: bazaarSchema }))
    : object(input.inputSchema) ? [{ schema: input.inputSchema, root: input.inputSchema }] : [];
  const queue = [], seen = new WeakSet();
  let text = '';
  const append = value => {
    if (typeof value !== 'string' || !value.length) return;
    const separator = text.length ? ' ' : '';
    const available = PARAMETER_CHARS - text.length - separator.length;
    if (available > 0) text += separator + value.slice(0, available);
  };
  const enqueue = (schema, root, depth, name = '') => {
    if (depth <= SCHEMA_DEPTH && queue.length < SCHEMA_NODES && (object(schema) || name))
      queue.push({ schema, root, depth, name });
  };
  for (const { schema, root } of roots) enqueue(schema, root, 0);
  for (let at = 0; at < queue.length && text.length < PARAMETER_CHARS; at++) {
    const { schema, root, depth, name } = queue[at];
    append(name);
    if (!object(schema) || seen.has(schema)) continue;
    seen.add(schema);
    append(schema.description);
    append(schema.title);
    if (object(schema.properties)) {
      let count = 0;
      for (const property in schema.properties) {
        if (!Object.hasOwn(schema.properties, property)) continue;
        if (count++ === SCHEMA_CHILDREN) break;
        enqueue(schema.properties[property], root, depth + 1, property);
      }
    }
    for (const alternative of schemaAlternatives(schema, root))
      enqueue(alternative, root, depth + 1);
    const items = Array.isArray(schema.items) ? schema.items.slice(0, SCHEMA_CHILDREN) : [schema.items];
    for (const item of items) enqueue(item, root, depth + 1);
    if (Array.isArray(schema.prefixItems))
      for (const item of schema.prefixItems.slice(0, SCHEMA_CHILDREN)) enqueue(item, root, depth + 1);
    for (const keyword of ['additionalProperties', 'unevaluatedProperties'])
      enqueue(schema[keyword], root, depth + 1);
    if (object(schema.patternProperties)) {
      let count = 0;
      for (const pattern in schema.patternProperties) {
        if (!Object.hasOwn(schema.patternProperties, pattern)) continue;
        if (count++ === SCHEMA_CHILDREN) break;
        enqueue(schema.patternProperties[pattern], root, depth + 1);
      }
    }
  }
  return text;
}

function toFields(row) {
  const resource = object(row.resource) ? row.resource : {};
  const info = object(row.extensions?.bazaar?.info) ? row.extensions.bazaar.info : {};
  const input = object(info.input) ? info.input : {};
  const parameters = inputParameterText(row, input);
  return [
    field(resource.serviceName, 9),
    field(Array.isArray(resource.tags) ? resource.tags.filter(x => typeof x === 'string').slice(0,16).join(' ') : '', 7),
    field(input.toolName, 8),
    field(input.description, 4),
    field(resource.description, 4),
    field(parameters, 2),
    field(resource.url, 0.6)
  ];
}

// Small, bounded edit distance prevents a misspelled merchant/tool name from vanishing.
// Never uses fuzzy scores as proof of semantic equivalence.
function editDistanceWithin(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return false;
  if (a === b) return true;
  // The caller permits at most one or two substitutions/insertions/deletions.
  // Cells farther than `limit` from the diagonal cannot change the answer;
  // only allocate/visit that narrow band, rather than O(a.length*b.length).
  const beyond = limit + 1;
  const n = b.length;
  let previousStart = 0;
  let previousEnd = Math.min(n, limit);
  let previous = Array.from({length:previousEnd+1}, (_,j)=>j);
  for (let i=1;i<=a.length;i++) {
    const start = Math.max(0, i-limit);
    const end = Math.min(n, i+limit);
    const current = new Array(end-start+1);
    let rowMin = beyond;
    for (let j=start;j<=end;j++) {
      let value;
      if (j === 0) value = i;
      else {
        const above = j >= previousStart && j <= previousEnd
          ? previous[j-previousStart] + 1 : beyond;
        const left = j > start ? current[j-1-start] + 1 : beyond;
        const diagonal = j-1 >= previousStart && j-1 <= previousEnd
          ? previous[j-1-previousStart] + (a[i-1] === b[j-1] ? 0 : 1) : beyond;
        value = Math.min(above, left, diagonal);
      }
      current[j-start] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return false;
    previous = current;
    previousStart = start;
    previousEnd = end;
  }
  return b.length >= previousStart && b.length <= previousEnd &&
    previous[b.length-previousStart] <= limit;
}

export function analyzeQuery(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 1024) throw new RangeError('query is required (max 1024 chars)');
  const raw = [...new Set(words(query))].slice(0,32);
  if (!raw.length) throw new RangeError('query requires searchable terms');
  const meaningful = raw.filter(t=>!STOP.has(t));
  return meaningful.length ? meaningful : raw;
}

function prepareDocument(key, row, indexFuzzy = false) {
  const fields = toFields(row).map(f => {
    const tf = new Map();
    for (const t of f.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { ...f, tf };
  });
  return { key, row, fields,
    vocabulary: new Set(fields.flatMap(f => [...f.tf.keys()])),
    fuzzyVocabulary: indexFuzzy ? new Set(fields.slice(0, 5).flatMap(f =>
      [...f.tf.keys()].filter(t => t.length >= 5))) : null };
}

function averageLengths(docs) {
  return docs[0].fields.map((_, i) =>
    Math.max(1, docs.reduce((sum, d) => sum + d.fields[i].tokens.length, 0) / docs.length));
}

// Both the one-shot API and the catalog index use this exact scoring path.
// The corpus statistics include EVERY filtered row, even rows with no match.
function rankPreparedDocuments(documents, q, avg, df, total, fuzzyMatches = null) {
  const ranked = [];
  for (const prepared of documents) {
    const doc = { ...prepared, fields: prepared.fields.map((f, i) => ({
      ...f, normalizedWeight: f.weight / (0.25 + 0.75 * f.tokens.length / avg[i])
    })) };
    let score = 0, coverage = 0, exactHits = 0;
    for (const t of q) {
      let weighted = 0;
      for (const f of doc.fields) weighted += Math.min(3, f.tf.get(t) ?? 0) * f.normalizedWeight;
      if (weighted) { coverage++; exactHits++; }
      else if (t.length >= 5) {
        let best = 0;
        const limit = t.length >= 8 ? 2 : 1;
        const matchingTerms = fuzzyMatches?.get(t);
        for (const f of doc.fields.slice(0, 5)) for (const v of f.tf.keys()) {
          if (v.length < 5 || v[0] !== t[0] ||
              (matchingTerms ? !matchingTerms.has(v) : !editDistanceWithin(t, v, limit))) continue;
          best = Math.max(best, 0.22 * f.normalizedWeight);
        }
        weighted = best;
        if (best) coverage++;
      }
      if (weighted) {
        const idf = Math.log1p((total - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += idf * (2.2 * weighted / (1.2 + weighted));
      }
    }
    if (!coverage) continue;
    const phrase = q.join(' ');
    const hasPhrase = q.length >= 2 &&
      doc.fields.slice(0, 5).some(f => f.tokens.join(' ').includes(phrase));
    score *= 1 + 0.45 * coverage / q.length;
    if (hasPhrase) score += 1.4;
    if (exactHits === q.length) score += 0.4;
    ranked.push({ key: doc.key, row: doc.row, score });
  }
  return ranked.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

/**
 * Rank already-validated [canonicalKey, row] pairs. Corpus statistics come from
 * these exact entries. The one-shot API owns no persistent cache and never
 * mutates the supplied rows. Payment and ownership filters remain upstream.
 */
export function rankBazaarEntries(entries, query) {
  const q = analyzeQuery(query);
  const docs = [...entries].map(([key, row]) => prepareDocument(key, row));
  if (!docs.length) return [];
  const avg = averageLengths(docs);
  const df = new Map(q.map(t => [t, 0]));
  for (const doc of docs)
    for (const t of q) if (doc.vocabulary.has(t)) df.set(t, df.get(t) + 1);
  return rankPreparedDocuments(docs, q, avg, df, docs.length);
}

/**
 * Catalog-owned lexical state. Rows belong to the authoritative Map and are
 * replaced, never mutated in place. changed() follows each Map write. A clone
 * owns a fresh index. No row, query text or posting is exposed by diagnostics.
 */
export class BazaarRankingIndex {
  #entries;
  #docs = new Map();
  #postings = new Map();
  #fuzzyUses = new Map();
  #fuzzyBuckets = new Map();
  #lengths = Array(7).fill(0);
  #references = 0;
  #ready = false;
  #counts = { rankingIndexBuilds: 0, rankingPreparedRows: 0,
    rankingQueries: 0, rankingCorpusRows: 0, rankingCandidateRows: 0,
    rankingTermLookups: 0, rankingFuzzyComparisons: 0 };

  constructor(entries) { this.#entries = entries; }

  #add(id, row) {
    const doc = prepareDocument(id, row, true);
    this.#docs.set(id, doc);
    for (let i = 0; i < this.#lengths.length; i++)
      this.#lengths[i] += doc.fields[i].tokens.length;
    for (const term of doc.vocabulary) {
      let ids = this.#postings.get(term);
      if (!ids) this.#postings.set(term, ids = new Set());
      ids.add(id); this.#references++;
    }
    for (const term of doc.fuzzyVocabulary) {
      const previous = this.#fuzzyUses.get(term) ?? 0;
      this.#fuzzyUses.set(term, previous + 1);
      if (previous) continue;
      let lengths = this.#fuzzyBuckets.get(term[0]);
      if (!lengths) this.#fuzzyBuckets.set(term[0], lengths = new Map());
      let terms = lengths.get(term.length);
      if (!terms) lengths.set(term.length, terms = new Set());
      terms.add(term);
    }
    this.#counts.rankingPreparedRows++;
  }

  #remove(id) {
    const doc = this.#docs.get(id);
    if (!doc) return;
    for (let i = 0; i < this.#lengths.length; i++)
      this.#lengths[i] -= doc.fields[i].tokens.length;
    for (const term of doc.vocabulary) {
      const ids = this.#postings.get(term);
      ids.delete(id); this.#references--;
      if (!ids.size) this.#postings.delete(term);
    }
    for (const term of doc.fuzzyVocabulary) {
      const count = this.#fuzzyUses.get(term) - 1;
      if (count) this.#fuzzyUses.set(term, count);
      else {
        this.#fuzzyUses.delete(term);
        const lengths = this.#fuzzyBuckets.get(term[0]), terms = lengths.get(term.length);
        terms.delete(term);
        if (!terms.size) lengths.delete(term.length);
        if (!lengths.size) this.#fuzzyBuckets.delete(term[0]);
      }
    }
    this.#docs.delete(id);
  }

  #ensure(ids) {
    if (!this.#ready) {
      this.#ready = true;
      this.#counts.rankingIndexBuilds++;
    }
    // A first selective search prepares only its selected rows. Later queries
    // reuse those fields and add newly selected rows as needed.
    for (const id of ids) if (!this.#docs.has(id)) {
      const row = this.#entries.get(id);
      if (row === undefined) throw new RangeError('Unknown internal catalog key');
      this.#add(id, row);
    }
  }

  changed(id, before, after) {
    // Unsearched rows need no lexical work on writes. A prepared replacement
    // updates only its own postings; retirement releases its retained fields.
    if (!this.#docs.has(id)) return;
    this.#remove(id);
    if (after !== undefined) this.#add(id, after);
  }

  #fuzzyMatches(term) {
    const matches = new Set();
    if (term.length < 5) return matches;
    const limit = term.length >= 8 ? 2 : 1;
    const lengths = this.#fuzzyBuckets.get(term[0]);
    if (!lengths) return matches;
    for (let length = Math.max(5, term.length - limit); length <= term.length + limit; length++) {
      for (const word of lengths.get(length) ?? []) {
        this.#counts.rankingFuzzyComparisons++;
        if (editDistanceWithin(term, word, limit)) matches.add(word);
      }
    }
    return matches;
  }

  rank(ids, query) {
    const q = analyzeQuery(query);
    this.#counts.rankingQueries++;
    this.#counts.rankingCorpusRows += ids.length;
    if (!ids.length) return [];
    this.#ensure(ids);
    // ids is the complete, unique subset selected by CatalogQueryIndex, not a
    // lexical shortlist. When it selects all prepared rows, statistics can
    // reuse maintained totals, even if other catalog rows remain unsearched.
    const all = ids.length === this.#docs.size;
    const selected = all ? null : new Set(ids);
    const inCorpus = id => selected === null || selected.has(id);
    const avg = all ? this.#lengths.map(sum => Math.max(1, sum / ids.length))
      : averageLengths(ids.map(id => this.#docs.get(id)));
    const df = new Map(), candidates = new Set(), fuzzy = new Map();
    const addPosting = term => {
      this.#counts.rankingTermLookups++;
      for (const id of this.#postings.get(term) ?? [])
        if (inCorpus(id)) candidates.add(id);
    };
    for (const term of q) {
      const posting = this.#postings.get(term);
      let frequency = 0;
      if (posting) {
        if (all) frequency = posting.size;
        else for (const id of posting) if (selected.has(id)) frequency++;
      }
      df.set(term, frequency);
      addPosting(term);
      const matches = this.#fuzzyMatches(term);
      fuzzy.set(term, matches);
      // A global posting can include a URL-only occurrence. Keeping that row is
      // conservative: the common scorer still fuzzes only the original fields.
      for (const word of matches) if (word !== term) addPosting(word);
    }
    // Keep the supplied corpus order, including replacement and delete/reinsert
    // behavior and locale ties. No query-dependent preparation order can leak.
    const docs = ids.filter(id => candidates.has(id)).map(id => this.#docs.get(id));
    this.#counts.rankingCandidateRows += docs.length;
    return rankPreparedDocuments(docs, q, avg, df, ids.length, fuzzy);
  }

  get stats() {
    return { ...this.#counts, rankingDocuments: this.#docs.size,
      rankingUniqueTerms: this.#postings.size, rankingFuzzyTerms: this.#fuzzyUses.size,
      rankingStoredTokens: this.#lengths.reduce((sum, n) => sum + n, 0),
      rankingPostingReferences: this.#references };
  }
}
