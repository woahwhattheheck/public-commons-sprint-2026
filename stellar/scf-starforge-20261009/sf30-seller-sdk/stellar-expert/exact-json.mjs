// MIT. Preserve JSON number tokens before JavaScript can round them.
export function parseExactJSON(text) {
  if (typeof text !== 'string') throw new TypeError('JSON text required');
  let at = 0;
  const fail = () => { throw new TypeError('Invalid source JSON at character ' + at); };
  const ws = () => { while (/[ \t\r\n]/.test(text[at] ?? '') && at < text.length) at++; };
  function string() {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '"') return JSON.parse(text.slice(start, at));
      if (c === '\\') at++;
    }
    fail();
  }
  function value(depth = 0) {
    if (depth > 80) throw new TypeError('Source JSON nesting exceeds 80');
    ws(); const c = text[at];
    if (c === '"') return string();
    if (c === '{') {
      at++; const out = Object.create(null); ws();
      if (text[at] === '}') { at++; return out; }
      while (at < text.length) {
        ws(); if (text[at] !== '"') fail(); const key = string();
        if (Object.hasOwn(out, key)) throw new TypeError('Duplicate source JSON key');
        ws(); if (text[at++] !== ':') fail(); out[key] = value(depth + 1);
        ws(); const next = text[at++]; if (next === '}') return out; if (next !== ',') fail();
      }
      fail();
    }
    if (c === '[') {
      at++; const out = []; ws(); if (text[at] === ']') { at++; return out; }
      while (at < text.length) {
        out.push(value(depth + 1)); ws(); const next = text[at++];
        if (next === ']') return out; if (next !== ',') fail();
      }
      fail();
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]])
      if (text.slice(at, at + literal.length) === literal) { at += literal.length; return result; }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
    if (!number) fail();
    at += number[0].length;
    // All numeric source tokens stay strings, including small counts and decimals.
    // Schema-aware consumers may explicitly validate/convert safe counters.
    return number[0];
  }
  const result = value(); ws(); if (at !== text.length) fail(); return result;
}
export function decimalUnits(stroops) {
  if (typeof stroops !== 'string' || !/^-?\d+$/.test(stroops)) return null;
  const negative = stroops.startsWith('-'), raw = (negative ? stroops.slice(1) : stroops).replace(/^0+(?=\d)/, '');
  const digits = raw.padStart(8, '0');
  return (negative ? '-' : '') + digits.slice(0, -7) + '.' + digits.slice(-7);
}
export function exactPercentage(numerator, denominator) {
  if (!/^\d+$/.test(numerator ?? '') || !/^\d+$/.test(denominator ?? '') || BigInt(denominator) === 0n) return null;
  const scaled = BigInt(numerator) * 1000000n / BigInt(denominator);
  return (scaled / 10000n).toString() + '.' + (scaled % 10000n).toString().padStart(4, '0');
}
