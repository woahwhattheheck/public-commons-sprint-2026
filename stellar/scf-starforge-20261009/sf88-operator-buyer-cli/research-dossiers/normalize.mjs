// MIT — Interpret retained research metadata and the original provider's live view.
import { createHash } from 'node:crypto';
import { need, object, parseJson } from '../node/store.mjs';

export const SCHEMA = 'sf88-research-results-v1';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const string = value => typeof value === 'string' ? value : '';
const display = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

export function canonicalSource(item, fallback) {
  let doi = string(item.doi).trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
  if (doi) return 'doi:' + doi;
  if (string(item.url)) {
    try { const url = new URL(item.url); url.hash = ''; return 'url:' + url.href; } catch { /* Preserve the original value below. */ }
  }
  if (string(item.id)) return 'provider:' + string(item.provider) + ':' + item.id;
  return 'occurrence:' + fallback;
}

function abstract(index) {
  if (!object(index)) return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (Number.isSafeInteger(position) && position >= 0 && position < 200000) words[position] = word;
    }
  }
  return words.join(' ').trim();
}

function item(row, index, provider) {
  need(object(row), 'RESEARCH_RESULT_OBJECT_REQUIRED');
  const content = row.content ?? row.abstract ?? row.description ?? '';
  need(typeof content === 'string' || object(content) ||
    (Array.isArray(content) && content.every(object)), 'RESEARCH_CONTENT_SHAPE_INVALID');
  return {
    key: String(index), id: string(row.id), provider,
    title: string(row.title) || string(row.display_name) || 'Untitled source',
    url: string(row.url), doi: string(row.doi),
    content, snippet: string(row.description) || string(row.abstract) || display(content).slice(0, 360),
    publishedAt: string(row.publication_date) || string(row.publishedAt),
    authors: Array.isArray(row.authors) ? row.authors : [],
    citation: row.citation ?? null, references: row.references ?? null,
    metadata: row.metadata ?? {}, original: row,
  };
}

export function normalizeResponse(raw, provider = 'research') {
  // The original fatal UTF-8 parser omits one leading BOM without changing the retained input.
  const response = parseJson(typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw);
  need(object(response), 'RESEARCH_RESPONSE_OBJECT_REQUIRED');
  provider = String(provider).toLowerCase();
  // Valyu output is opened through its maintained entitlement-aware edition reader.
  need(provider !== 'valyu' && !(Object.hasOwn(response, 'tx_id') &&
    Object.hasOwn(response, 'total_deduction_dollars')), 'VALYU_EDITION_REFERENCE_REQUIRED');
  if (provider === 'openalex') {
    need(Array.isArray(response.results) && object(response.meta), 'OPENALEX_WORKS_RESPONSE_REQUIRED');
    const items = response.results.map((row, index) => {
      const location = row.primary_location ?? {};
      const normalized = {
        id: row.id, title: row.title || row.display_name, url: row.doi || row.id,
        doi: row.doi ?? '', content: abstract(row.abstract_inverted_index),
        publication_date: row.publication_date,
        references: row.referenced_works ?? [],
        authors: (row.authorships ?? []).map(auth => auth.author?.display_name).filter(Boolean),
        metadata: {
          type: row.type ?? null, cited_by_count: row.cited_by_count ?? null,
          open_access: row.open_access ?? null, primary_location: location,
          locations: row.locations ?? [], topics: row.topics ?? [],
        },
      };
      return { ...item(normalized, index, provider), original: row };
    });
    return {
      provider, query: string(response.query), status: 'AVAILABLE', items,
      usage: { totalResults: response.meta.count ?? items.length, page: response.meta.page ?? null },
      sourceTerms: 'OpenAlex metadata: CC0; linked full text retains its own licence.',
      warnings: [], raw: response,
    };
  }
  need(response.schema === SCHEMA && Array.isArray(response.results), 'RESEARCH_ENVELOPE_REQUIRED');
  need(typeof response.sourceTerms === 'string' && response.sourceTerms.trim().length > 0,
    'RESEARCH_SOURCE_TERMS_REQUIRED');
  const name = string(response.provider) || provider;
  return {
    provider: name, query: string(response.query), status: response.success === false ? 'PROVIDER_ERROR' : 'AVAILABLE',
    items: response.results.map((row, index) => item(row, index, name)),
    usage: object(response.usage) ? response.usage : {},
    sourceTerms: response.sourceTerms, warnings: Array.isArray(response.warnings) ? response.warnings : [],
    error: response.error ?? null, raw: response,
  };
}

export function normalizeProjection(value, provider) {
  need(object(value), 'EDITION_VIEW_INVALID');
  const status = string(value.status) || 'UNAVAILABLE';
  const live = status === 'AVAILABLE' || status === 'PARTIAL';
  const sourceItems = live && Array.isArray(value.items) ? value.items : [];
  const items = sourceItems.map((row, index) => {
    const normalized = item(row, index, provider);
    if (Object.hasOwn(row, 'original')) normalized.original = row.original;
    normalized.key = typeof row.key === 'string' || typeof row.key === 'number' ? String(row.key) : String(index);
    need(normalized.key.length > 0 && normalized.key.length <= 512, 'EDITION_OCCURRENCE_KEY_INVALID');
    return normalized;
  });
  need(new Set(items.map(row => row.key)).size === items.length, 'EDITION_OCCURRENCE_KEY_DUPLICATE');
  return {
    provider, status, items, usage: object(value.usage) ? value.usage : {},
    warnings: Array.isArray(value.warnings) ? value.warnings : [],
    error: value.error ?? null, availableUntil: value.availableUntil ?? null,
    retention: value.retention ?? 'ORIGINAL_EDITION_ACCESS',
  };
}

export function sourceView(editions, projections, selections) {
  const groups = new Map();
  for (const edition of editions) {
    const projection = projections.get(edition.id);
    for (const row of projection?.items ?? []) {
      const occurrenceId = 'o_' + hash(edition.id + '\n' + row.key);
      const key = canonicalSource(row, occurrenceId);
      const sourceId = 's_' + hash(key);
      let group = groups.get(sourceId);
      if (!group) {
        group = { id: sourceId, title: row.title, url: row.url, doi: row.doi,
          snippet: row.snippet, content: row.content, provider: row.provider,
          publishedAt: row.publishedAt, metadata: row.metadata, authors: row.authors,
          citations: [], variants: [], selected: false, note: '', classification: 'unreviewed',
          occurrenceIds: [], retained: true };
        groups.set(sourceId, group);
      }
      const contentDigest = hash(JSON.stringify(row.content));
      const citation = {
        occurrenceId, editionId: edition.id, questionId: edition.questionId, key: row.key,
        title: row.title, url: row.url, doi: row.doi, contentDigest, provider: row.provider,
        publishedAt: row.publishedAt, citation: row.citation, references: row.references,
        original: row.original,
        retained: edition.mode === 'retained',
      };
      group.citations.push(citation); group.occurrenceIds.push(occurrenceId);
      group.retained &&= edition.mode === 'retained';
      if (!group.variants.some(variant => variant.contentDigest === contentDigest)) {
        group.variants.push({ contentDigest, content: row.content, editionId: edition.id,
          title: row.title, url: row.url, original: row.original });
      }
      // The newest edition supplies the displayed revision, with older variants kept above.
      Object.assign(group, { title: row.title, url: row.url, snippet: row.snippet, content: row.content,
        publishedAt: row.publishedAt, metadata: row.metadata, authors: row.authors });
      const selection = selections.find(entry => entry.occurrenceId === occurrenceId);
      if (selection) {
        group.selected ||= selection.selected;
        if (selection.note && !group.note.split('\n\n').includes(selection.note)) {
          group.note = [group.note, selection.note].filter(Boolean).join('\n\n');
        }
        if (selection.classification !== 'unreviewed') group.classification = selection.classification;
      }
    }
  }
  return [...groups.values()];
}

export function compareViews(before, after) {
  const left = new Map(before.sources.map(source => [source.id, source]));
  const right = new Map(after.sources.map(source => [source.id, source]));
  const added = after.sources.filter(source => !left.has(source.id));
  const removed = before.sources.filter(source => !right.has(source.id));
  const changed = [];
  for (const [id, source] of right) {
    const old = left.get(id);
    if (!old) continue;
    const changes = [];
    if (hash(JSON.stringify(old.content)) !== hash(JSON.stringify(source.content))) changes.push('content');
    if (old.citations.length !== source.citations.length) changes.push('citations');
    if (old.selected !== source.selected) changes.push('selection');
    if (old.note !== source.note) changes.push('note');
    if (old.classification !== source.classification) changes.push('classification');
    if (changes.length) changed.push({ id, title: source.title, changes, before: old, after: source });
  }
  const questionMap = new Map(before.questions.map(question => [question.id, question]));
  const questions = after.questions.filter(question => JSON.stringify(questionMap.get(question.id)) !== JSON.stringify(question));
  const leftFindings = new Map(before.findings.map(finding => [finding.id, finding]));
  const rightFindings = new Map(after.findings.map(finding => [finding.id, finding]));
  const findingFields = ['questionId', 'title', 'text', 'occurrenceIds', 'sourceIds', 'unavailableSources'];
  const findings = {
    added: after.findings.filter(finding => !leftFindings.has(finding.id)),
    removed: before.findings.filter(finding => !rightFindings.has(finding.id)),
    changed: after.findings.flatMap(finding => {
      const old = leftFindings.get(finding.id);
      if (!old) return [];
      const changes = findingFields.filter(key => JSON.stringify(old[key]) !== JSON.stringify(finding[key]));
      return changes.length ? [{ id: finding.id, changes, before: old, after: finding }] : [];
    }),
  };
  return {
    before: before.revision, after: after.revision, added, removed, changed, questions, findings,
    editions: after.editions.filter(edition => !before.editions.some(old => old.id === edition.id)),
    availability: after.editions.filter(edition => !['AVAILABLE', 'PARTIAL'].includes(edition.status)),
  };
}

