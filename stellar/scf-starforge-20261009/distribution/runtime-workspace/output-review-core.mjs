// Copyright (c) 2026 TokenJunkie Labs. MIT License.
// Complete original fixed-end output review, independent of its former worker.
import { scanOutputSelection } from './output-search-core.mjs';

const SCHEMA = 'stellar-forge.runtime-output-review.v1';
const MAXIMUM_BYTES = 24 * 1024 * 1024;
const FIELDS = ['schema', 'query', 'contextBytes', 'endOffset', 'complete', 'matches'];
function need(condition, code, message) {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}
function integer(value, minimum, maximum, name) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'OUTPUT_REVIEW_ARGUMENT', name + ' must be an exact integer from ' + minimum + ' through ' + maximum + '.');
  return value;
}
// Reject unpaired UTF-16 rather than silently replacing the operator's query.
// The module also runs in source-receiving V8 contexts without TextEncoder.
function utf8(text) {
  const result = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = text.charCodeAt(i + 1);
      need(low >= 0xdc00 && low <= 0xdfff, 'OUTPUT_REVIEW_QUERY_UTF8',
        'Retain the exact valid UTF-8 query.');
      code = 0x10000 + (code - 0xd800) * 0x400 + low - 0xdc00; i++;
    } else need(code < 0xdc00 || code > 0xdfff, 'OUTPUT_REVIEW_QUERY_UTF8',
      'Retain the exact valid UTF-8 query.');
    if (code < 0x80) result.push(code);
    else if (code < 0x800) result.push(0xc0 | code >> 6, 0x80 | code & 0x3f);
    else if (code < 0x10000) result.push(0xe0 | code >> 12, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f);
    else result.push(0xf0 | code >> 18, 0x80 | code >> 12 & 0x3f,
      0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f);
  }
  return new Uint8Array(result);
}
function parameters({ read, endOffset, query, contextBytes, maximumBytes }) {
  need(typeof read === 'function', 'OUTPUT_REVIEW_READER', 'Use the original retained byte reader.');
  integer(endOffset, 0, Number.MAX_SAFE_INTEGER, 'endOffset');
  integer(contextBytes, 0, 4096, 'contextBytes');
  integer(maximumBytes, 1, MAXIMUM_BYTES, 'maximumBytes');
  need(typeof query === 'string' && query.length > 0 && query.length <= 4096,
    'OUTPUT_REVIEW_QUERY', 'Enter exact UTF-8 text between 1 and 4096 bytes.');
  const needle = utf8(query);
  integer(needle.length, 1, 4096, 'query byte length');
  return needle;
}
/**
 * Every match is [start, end, contextStart, contextEnd] in original bytes.
 * Raw source bytes and their source/selection/digest are carried separately by
 * the existing Operating file. maximumBytes limits the exact UTF-8 byte length
 * of JSON.stringify(result), excluding an optional receiving-file newline.
 */
export async function projectOutputReview({
  read, endOffset, query, contextBytes = 96, maximumBytes = MAXIMUM_BYTES
} = {}) {
  const needle = parameters({ read, endOffset, query, contextBytes, maximumBytes });
  const review = { schema: SCHEMA, query, contextBytes, endOffset, complete: true, matches: [] };
  let bytes = utf8(JSON.stringify(review)).length, offset = 0;
  need(bytes <= maximumBytes, 'OUTPUT_REVIEW_CAPACITY',
    'The complete selected review exceeds the available Operating file capacity.');
  while (true) {
    const page = await scanOutputSelection({ read, endOffset, offset, needle,
      limit: 200, maxBytes: 8 * 1024 * 1024, contextBytes });
    for (const match of page.matches) {
      const tuple = [match.offset, match.endOffset, match.context.offset, match.context.endOffset];
      // Tuple JSON contains only original nonnegative integer coordinates.
      const next = bytes + JSON.stringify(tuple).length + (review.matches.length ? 1 : 0);
      need(next <= maximumBytes, 'OUTPUT_REVIEW_CAPACITY',
        'The complete selected review exceeds the available Operating file capacity. Use a more specific exact query or keep the full original output download.');
      bytes = next; review.matches.push(tuple);
    }
    if (page.done) break;
    need(page.nextOffset > offset, 'OUTPUT_REVIEW_NO_PROGRESS',
      'The original scanner did not advance its selected byte position.');
    offset = page.nextOffset;
  }
  return review;
}
/**
 * endOffset comes from the independently read full carried file, never solely
 * from the supplied review. Unknown fields and partial/reordered results fail.
 * Returns a fresh verified complete projection.
 */
export async function verifyOutputReview(review, {
  read, endOffset, maximumBytes = MAXIMUM_BYTES
} = {}) {
  need(review && typeof review === 'object' && !Array.isArray(review) &&
    Object.keys(review).length === FIELDS.length && FIELDS.every(key => Object.hasOwn(review, key)) &&
    review.schema === SCHEMA && review.complete === true && Array.isArray(review.matches),
    'OUTPUT_REVIEW_STRUCTURE', 'Reopen the complete original output review.');
  integer(endOffset, 0, Number.MAX_SAFE_INTEGER, 'carried source byte length');
  need(review.endOffset === endOffset, 'OUTPUT_REVIEW_SOURCE_LENGTH',
    'The review differs from the complete carried original source length.');
  const expected = await projectOutputReview({ read, endOffset, query: review.query,
    contextBytes: review.contextBytes, maximumBytes });
  need(review.matches.length === expected.matches.length, 'OUTPUT_REVIEW_MATCHES',
    'The retained review has missing or additional original matches.');
  for (let i = 0; i < expected.matches.length; i++) {
    const actual = review.matches[i], wanted = expected.matches[i];
    need(Array.isArray(actual) && actual.length === 4 && Object.keys(actual).length === 4 &&
      wanted.every((value, column) => Object.hasOwn(actual, column) && actual[column] === value),
      'OUTPUT_REVIEW_MATCHES', 'The retained match or original context differs at result ' + (i + 1) + '.');
  }
  return expected;
}
