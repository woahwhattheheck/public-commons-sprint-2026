// MIT. Bounded ECMAScript-compatible pattern assertions, evaluated by RE2JS.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let engine;
function patternEngine() {
  if (!engine) {
    try { engine = require('re2js').RE2JS; }
    catch { throw new TypeError('SCHEMA_PATTERN_ENGINE_UNAVAILABLE'); }
  }
  return engine;
}

const cache = new Map();
const MAX_PATTERN_LENGTH = 4096, MAX_PROGRAM = 8192, MAX_CACHED_PROGRAM = 32768;
let cachedProgram = 0;
// ECMA-262 WhiteSpace and LineTerminator characters. RE2's own \s is narrower.
const SPACE = '\\x09-\\x0d\\x20\\x{a0}\\x{1680}\\x{2000}-\\x{200a}\\x{2028}\\x{2029}\\x{202f}\\x{205f}\\x{3000}\\x{feff}';
const fail = reason => { throw new TypeError(reason); };

function translate(pattern, RE2JS) {
  // Syntax inspection does not run JavaScript's backtracking matcher.
  try { new RegExp(pattern, 'u'); } catch { fail('SCHEMA_PATTERN_INVALID'); }
  let result = '', inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i];
    if (character === '\\') {
      const next = pattern[++i];
      // No backreferences, lookarounds, Unicode property dialect differences,
      // or surrogate escapes. Unsupported assertions are never discarded.
      if (/[1-9kpP]/.test(next)) fail('SCHEMA_PATTERN_SYNTAX_UNSUPPORTED');
      if (next === 'u') {
        const text = pattern[i + 1] === '{' ? pattern.slice(i + 2, pattern.indexOf('}', i + 2)) : pattern.slice(i + 1, i + 5);
        const codepoint = Number.parseInt(text, 16);
        if (codepoint >= 0xd800 && codepoint <= 0xdfff) fail('SCHEMA_PATTERN_SYNTAX_UNSUPPORTED');
      }
      if (next === 's') result += inClass ? SPACE : '[' + SPACE + ']';
      else if (next === 'S') {
        if (inClass) fail('SCHEMA_PATTERN_SYNTAX_UNSUPPORTED');
        result += '[^' + SPACE + ']';
      } else if (next === 'b' && inClass) result += '\\x08';
      else if (next === '0') result += '\\x00';
      else result += '\\' + next;
      continue;
    }
    if (character === '[') inClass = true;
    else if (character === ']') inClass = false;
    else if (!inClass && character === '(' && pattern[i + 1] === '?' && pattern[i + 2] !== ':')
      fail('SCHEMA_PATTERN_SYNTAX_UNSUPPORTED');
    if (!inClass && character === '.') result += '[^\\n\\r\\x{2028}\\x{2029}]';
    else {
      const codepoint = pattern.codePointAt(i);
      if (codepoint >= 0xd800 && codepoint <= 0xdfff) fail('SCHEMA_PATTERN_SYNTAX_UNSUPPORTED');
      result += String.fromCodePoint(codepoint);
      if (codepoint > 0xffff) i++;
    }
  }
  return RE2JS.translateRegExp(result);
}

/** Matching remains unanchored unless the source pattern contains ^ or $. */
export function compileSchemaPattern(pattern) {
  if (typeof pattern !== 'string') fail('SCHEMA_PATTERN_INVALID');
  if (pattern.length > MAX_PATTERN_LENGTH) fail('SCHEMA_PATTERN_COMPLEXITY_LIMIT');
  const retained = cache.get(pattern);
  if (retained) { cache.delete(pattern); cache.set(pattern, retained); return retained; }
  const RE2JS = patternEngine(), translated = translate(pattern, RE2JS);
  let compiled;
  try { compiled = RE2JS.compile(translated); }
  catch { fail('SCHEMA_PATTERN_SYNTAX_UNSUPPORTED'); }
  const size = compiled.programSize();
  if (size > MAX_PROGRAM) fail('SCHEMA_PATTERN_COMPLEXITY_LIMIT');
  while (cache.size && (cache.size >= 128 || cachedProgram + size > MAX_CACHED_PROGRAM)) {
    const oldest = cache.keys().next().value;
    cachedProgram -= cache.get(oldest).programSize(); cache.delete(oldest);
  }
  cache.set(pattern, compiled); cachedProgram += size;
  return compiled;
}
