/** Exact JSON at the native/file boundary; unsafe integers never become JS Numbers. */
export class ExactNumber {
  constructor(lexeme) {
    if (typeof lexeme !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(lexeme))
      throw new TypeError("VECTOR_EXACT_NUMBER_INVALID");
    this.lexeme = lexeme;
    Object.freeze(this);
  }
  toString() { return this.lexeme; }
  toJSON() { return this.lexeme; }
  [Symbol.toPrimitive](hint) {
    if (hint === "number") throw new TypeError("VECTOR_EXACT_NUMBER_REQUIRES_EXPLICIT_CONVERSION");
    return this.lexeme;
  }
}
export function parseExactJSON(text) {
  if (typeof text !== "string") throw new TypeError("VECTOR_JSON_TEXT_REQUIRED");
  let i = 0;
  const fail = message => { throw new SyntaxError(message + " at character " + i); };
  const ws = () => { while (i < text.length && /[\t\n\r ]/.test(text[i])) i++; };
  const string = () => {
    const start = i++;
    for (;;) {
      if (i >= text.length) fail("Unterminated JSON string");
      if (text[i] === '"') {
        i++;
        return JSON.parse(text.slice(start, i));
      }
      if (text[i] === "\\") i += 2;
      else i++;
    }
  };
  const value = (depth = 0) => {
    if (depth > 512) fail("JSON nesting exceeds 512");
    ws();
    const first = text[i];
    if (first === '"') return string();
    if (first === "{") {
      i++; ws();
      const result = Object.create(null);
      if (text[i] === "}") { i++; return result; }
      for (;;) {
        ws(); if (text[i] !== '"') fail("Object key required");
        const key = string();
        if (Object.hasOwn(result, key)) fail("Duplicate JSON key " + key);
        ws(); if (text[i++] !== ":") fail("Colon required");
        result[key] = value(depth + 1); ws();
        const end = text[i++];
        if (end === "}") return result;
        if (end !== ",") fail("Object separator required");
      }
    }
    if (first === "[") {
      i++; ws(); const result = [];
      if (text[i] === "]") { i++; return result; }
      for (;;) {
        result.push(value(depth + 1)); ws();
        const end = text[i++];
        if (end === "]") return result;
        if (end !== ",") fail("Array separator required");
      }
    }
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]]) {
      if (text.slice(i, i + literal.length) === literal) { i += literal.length; return result; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match) fail("JSON value required");
    i += match[0].length;
    const lexeme = match[0], number = Number(lexeme);
    if (/^-?(?:0|[1-9]\d*)$/.test(lexeme) && Number.isSafeInteger(number) && lexeme !== "-0") return number;
    return new ExactNumber(lexeme);
  };
  const result = value(); ws();
  if (i !== text.length) fail("Trailing JSON content");
  return result;
}
export function stringifyExactJSON(value, space = 0) {
  const indent = typeof space === "number" ? " ".repeat(Math.min(10, Math.max(0, space))) : String(space).slice(0, 10);
  const seen = new Set();
  const encode = (item, depth) => {
    if (item === null) return "null";
    if (item instanceof ExactNumber) return item.lexeme;
    if (typeof item === "bigint") return item.toString();
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item) || Number.isInteger(item) && !Number.isSafeInteger(item))
        throw new TypeError("VECTOR_UNSAFE_JSON_NUMBER: use ExactNumber or an original JSON file");
      return Object.is(item, -0) ? "-0" : String(item);
    }
    if (!item || typeof item !== "object") throw new TypeError("VECTOR_UNSUPPORTED_JSON_VALUE");
    if (seen.has(item)) throw new TypeError("VECTOR_CIRCULAR_JSON");
    seen.add(item);
    const next = indent.repeat(depth + 1), current = indent.repeat(depth);
    let body, open, close;
    if (Array.isArray(item)) {
      open = "["; close = "]";
      body = item.map(child => encode(child, depth + 1));
    } else {
      open = "{"; close = "}";
      body = Object.keys(item).filter(key => item[key] !== undefined).map(key =>
        JSON.stringify(key) + (indent ? ": " : ":") + encode(item[key], depth + 1));
    }
    seen.delete(item);
    if (!body.length) return open + close;
    return indent ? open + "\n" + next + body.join(",\n" + next) + "\n" + current + close : open + body.join(",") + close;
  };
  return encode(value, 0);
}
