// MIT. Validate frozen operator cases against the original OpenSearch declarations.
import { record } from '../../sqlite/parameters.mjs';
import { fields, bounded, validateOpenSearchSource, compileOpenSearchQueries } from '../declaration.mjs';
import { bindOpenSearchQuery } from '../source.mjs';

const INT32_MAX = 2147483647;
const identity = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const metricDefinitions = [
  { key: 'precision', label: 'Precision at k',
    defaults: { k: 10, relevant_rating_threshold: 1, ignore_unlabeled: false },
    fields: ['k', 'relevant_rating_threshold', 'ignore_unlabeled'] },
  { key: 'recall', label: 'Recall against supplied judgments',
    defaults: { k: 10, relevant_rating_threshold: 1 },
    fields: ['k', 'relevant_rating_threshold'] },
  { key: 'mean_reciprocal_rank', label: 'Mean reciprocal rank',
    defaults: { k: 10, relevant_rating_threshold: 1 },
    fields: ['k', 'relevant_rating_threshold'] },
  { key: 'dcg', label: 'Discounted cumulative gain',
    defaults: { k: 10, normalize: false },
    fields: ['k', 'normalize', 'unknown_doc_rating'] },
  { key: 'expected_reciprocal_rank', label: 'Expected reciprocal rank',
    defaults: { k: 10, maximum_relevance: 3 },
    fields: ['k', 'maximum_relevance', 'unknown_doc_rating'] },
];
export function describeRelevanceMetrics() {
  return { schema: 'stellar-forge.opensearch-relevance-metrics.v1',
    metrics: structuredClone(metricDefinitions),
    limits: { variants: 8, cases: 100, judgmentsPerCase: 5000, maximumK: 1000,
      maximumNativeRequestBytes: 262144, maximumNativeResponseBytes: 33554432,
      maximumDcgGrade: 1000, maximumErrRelevance: 1023 },
    semantics: 'Scores come from native OpenSearch. Grade zero is a judgment; omitted ratings are unjudged. Native aggregates exclude failed requests.' };
}
function named(value, code) {
  if (typeof value !== 'string' || !identity.test(value) || reserved.has(value)) throw new TypeError(code);
  return value;
}
function nativeIdentity(value, limit, code) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > limit ||
      /[\x00-\x1f\x7f]/.test(value)) throw new TypeError(code);
  return value;
}
function nonempty(items, maximum, code) {
  if (!Array.isArray(items) || !items.length || items.length > maximum) throw new TypeError(code);
}
function unique(items, key, code) {
  if (new Set(items.map(key)).size !== items.length) throw new TypeError(code);
}
function metric(raw) {
  if (!record(raw) || Object.keys(raw).length !== 1) throw new TypeError('OPENSEARCH_RELEVANCE_METRIC_REQUIRED');
  const key = Object.keys(raw)[0], definition = metricDefinitions.find(item => item.key === key);
  if (!definition) throw new TypeError('OPENSEARCH_RELEVANCE_METRIC_UNSUPPORTED');
  fields(raw[key], definition.fields, 'OPENSEARCH_RELEVANCE_METRIC_FIELDS_INVALID');
  // ERR's denominator is required by the native parser. The catalog sample
  // does not silently supply a scale for an imported judgment set.
  if (key === 'expected_reciprocal_rank' && !Object.hasOwn(raw[key], 'maximum_relevance'))
    throw new TypeError('OPENSEARCH_RELEVANCE_MAXIMUM_REQUIRED');
  const options = { ...definition.defaults, ...structuredClone(raw[key]) };
  options.k = bounded(options.k, 1, 1000, 'OPENSEARCH_RELEVANCE_K_INVALID');
  if (Object.hasOwn(options, 'relevant_rating_threshold'))
    bounded(options.relevant_rating_threshold, 0, INT32_MAX, 'OPENSEARCH_RELEVANCE_THRESHOLD_INVALID');
  for (const name of ['ignore_unlabeled', 'normalize'])
    if (Object.hasOwn(options, name) && typeof options[name] !== 'boolean')
      throw new TypeError('OPENSEARCH_RELEVANCE_METRIC_BOOLEAN_INVALID');
  if (Object.hasOwn(options, 'maximum_relevance'))
    bounded(options.maximum_relevance, 0, 1023, 'OPENSEARCH_RELEVANCE_MAXIMUM_INVALID');
  if (Object.hasOwn(options, 'unknown_doc_rating'))
    bounded(options.unknown_doc_rating, 0, key === 'dcg' ? 1000 : options.maximum_relevance,
      'OPENSEARCH_RELEVANCE_UNKNOWN_GRADE_INVALID');
  return { key, options, value: { [key]: options } };
}
export function validateRelevanceSuite(input) {
  fields(input, ['config', 'variants', 'cases', 'metric'], 'OPENSEARCH_RELEVANCE_SUITE_FIELDS_INVALID');
  nonempty(input.variants, 8, 'OPENSEARCH_RELEVANCE_VARIANTS_REQUIRED');
  nonempty(input.cases, 100, 'OPENSEARCH_RELEVANCE_CASES_REQUIRED');
  const selected = metric(input.metric);
  const variants = input.variants.map((value, index) => {
    fields(value, ['id', 'label', 'queryName', 'query'], 'OPENSEARCH_RELEVANCE_VARIANT_FIELDS_INVALID');
    const id = named(value.id, 'OPENSEARCH_RELEVANCE_VARIANT_ID_INVALID');
    if (typeof value.queryName !== 'string') throw new TypeError('OPENSEARCH_RELEVANCE_QUERY_REQUIRED');
    const compiled = compileOpenSearchQueries({ [value.queryName]: value.query })[value.queryName];
    if (selected.options.k > compiled.maxHits) throw new RangeError('OPENSEARCH_RELEVANCE_K_EXCEEDS_QUERY_LIMIT');
    const label = value.label ?? id;
    if (typeof label !== 'string' || !label.trim() || label.length > 120 || /[\x00-\x1f\x7f]/.test(label))
      throw new TypeError('OPENSEARCH_RELEVANCE_VARIANT_LABEL_INVALID');
    return { id, label, queryName: value.queryName, query: structuredClone(value.query), compiled,
      internalName: 'evaluation_' + index };
  });
  unique(variants, row => row.id, 'OPENSEARCH_RELEVANCE_DUPLICATE_VARIANT');
  const cases = input.cases.map(value => {
    fields(value, ['id', 'input', 'ratings'], 'OPENSEARCH_RELEVANCE_CASE_FIELDS_INVALID');
    const id = named(value.id, 'OPENSEARCH_RELEVANCE_CASE_ID_INVALID');
    if (!record(value.input) || !Array.isArray(value.ratings) || value.ratings.length > 5000)
      throw new TypeError('OPENSEARCH_RELEVANCE_CASE_INVALID');
    const ratings = value.ratings.map(row => {
      fields(row, ['_index', '_id', 'rating'], 'OPENSEARCH_RELEVANCE_RATING_FIELDS_INVALID');
      const rating = bounded(row.rating, 0, INT32_MAX, 'OPENSEARCH_RELEVANCE_RATING_INVALID');
      if (selected.key === 'dcg' && rating > 1000 ||
          selected.key === 'expected_reciprocal_rank' && rating > selected.options.maximum_relevance)
        throw new RangeError('OPENSEARCH_RELEVANCE_GRADE_EXCEEDS_METRIC_SCALE');
      return { _index: nativeIdentity(row._index, 255, 'OPENSEARCH_RELEVANCE_RATING_INDEX_INVALID'),
        _id: nativeIdentity(row._id, 512, 'OPENSEARCH_RELEVANCE_RATING_ID_INVALID'), rating };
    });
    unique(ratings, row => JSON.stringify([row._index, row._id]), 'OPENSEARCH_RELEVANCE_DUPLICATE_RATING');
    for (const variant of variants) bindOpenSearchQuery(variant.compiled, value.input);
    return { id, input: structuredClone(value.input), ratings };
  });
  unique(cases, row => row.id, 'OPENSEARCH_RELEVANCE_DUPLICATE_CASE');
  if (!record(input.config)) throw new TypeError('OPENSEARCH_RELEVANCE_SOURCE_REQUIRED');
  const config = validateOpenSearchSource({ ...input.config,
    queries: Object.fromEntries(variants.map(row => [row.internalName, row.query])), bindings: {} });
  return { config, variants, cases, metric: selected.value, metricKey: selected.key, k: selected.options.k };
}
