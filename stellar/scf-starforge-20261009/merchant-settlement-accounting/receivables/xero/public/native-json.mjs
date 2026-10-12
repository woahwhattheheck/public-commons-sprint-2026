// MIT. Shared browser/Node reader for unchanged Xero Accounting JSON.
// Numbers are source strings. numericTokens records their original JSON pointers and lexemes.
export function parseXeroNativeJson(text) {
  const fail = (code, message, pointer = '') => {
    throw Object.assign(new Error(message + ' At ' + (pointer || '/') + '.'), {code, status:400});
  };
  if (typeof text !== 'string' || text.length === 0)
    fail('XERO_NATIVE_JSON_EMPTY', 'Choose a complete original JSON response');
  if (text.length > 8 * 1024 * 1024)
    fail('XERO_NATIVE_JSON_LIMIT', 'The native response exceeds the 8 MiB file limit');
  let cursor = text.charCodeAt(0) === 0xfeff ? 1 : 0, nodes = 0;
  const numericTokens = [];
  const child = (pointer, key) => pointer + '/' + String(key).replace(/~/g,'~0').replace(/\//g,'~1');
  const white = () => { while (cursor < text.length && /[ \t\r\n]/.test(text[cursor])) cursor++; };
  function string(pointer) {
    const start = cursor++;
    while (cursor < text.length) {
      const current = text[cursor++];
      if (current === '\\') { cursor++; continue; }
      if (current === '"') {
        try { return JSON.parse(text.slice(start, cursor)); }
        catch { fail('XERO_NATIVE_JSON_SYNTAX', 'The response contains an invalid JSON string', pointer); }
      }
    }
    fail('XERO_NATIVE_JSON_SYNTAX', 'The response ends inside a JSON string', pointer);
  }
  function value(pointer, depth) {
    if (++nodes > 500000 || depth > 64)
      fail('XERO_NATIVE_JSON_COMPLEXITY', 'The native response exceeds the structured JSON limit', pointer);
    white();
    const current = text[cursor];
    if (current === '"') return string(pointer);
    if (current === '{') {
      cursor++; white();
      const result = {};
      if (text[cursor] === '}') { cursor++; return result; }
      for (;;) {
        if (text[cursor] !== '"')
          fail('XERO_NATIVE_JSON_SYNTAX', 'A JSON object field name is missing', pointer);
        const key = string(pointer), nextPointer = child(pointer, key);
        if (Object.hasOwn(result, key))
          fail('XERO_NATIVE_JSON_DUPLICATE_KEY', 'A duplicate JSON field would make the original value ambiguous', nextPointer);
        white();
        if (text[cursor++] !== ':')
          fail('XERO_NATIVE_JSON_SYNTAX', 'A JSON object field separator is missing', nextPointer);
        const item = value(nextPointer, depth + 1);
        Object.defineProperty(result, key, {value:item, enumerable:true, writable:true, configurable:true});
        white();
        if (text[cursor] === '}') { cursor++; return result; }
        if (text[cursor++] !== ',')
          fail('XERO_NATIVE_JSON_SYNTAX', 'A JSON object comma or closing brace is missing', pointer);
        white();
      }
    }
    if (current === '[') {
      cursor++; white();
      const result = [];
      if (text[cursor] === ']') { cursor++; return result; }
      for (;;) {
        result.push(value(child(pointer, result.length), depth + 1)); white();
        if (text[cursor] === ']') { cursor++; return result; }
        if (text[cursor++] !== ',')
          fail('XERO_NATIVE_JSON_SYNTAX', 'A JSON array comma or closing bracket is missing', pointer);
      }
    }
    for (const [literal, result] of [['true',true],['false',false],['null',null]]) {
      if (text.slice(cursor, cursor + literal.length) === literal) {
        cursor += literal.length; return result;
      }
    }
    if (current === '-' || (current >= '0' && current <= '9')) {
      const start = cursor;
      if (text[cursor] === '-') cursor++;
      if (text[cursor] === '0') cursor++;
      else {
        if (!(text[cursor] >= '1' && text[cursor] <= '9'))
          fail('XERO_NATIVE_JSON_SYNTAX', 'A JSON number has no integer digits', pointer);
        while (text[cursor] >= '0' && text[cursor] <= '9') cursor++;
      }
      if (text[cursor] === '.') {
        cursor++;
        const startFraction = cursor;
        while (text[cursor] >= '0' && text[cursor] <= '9') cursor++;
        if (cursor === startFraction)
          fail('XERO_NATIVE_JSON_SYNTAX', 'A JSON number has no fractional digits', pointer);
      }
      if (text[cursor] === 'e' || text[cursor] === 'E') {
        cursor++;
        if (text[cursor] === '+' || text[cursor] === '-') cursor++;
        const startExponent = cursor;
        while (text[cursor] >= '0' && text[cursor] <= '9') cursor++;
        if (cursor === startExponent)
          fail('XERO_NATIVE_JSON_SYNTAX', 'A JSON number has no exponent digits', pointer);
      }
      const lexeme = text.slice(start, cursor);
      if (lexeme.length > 2048)
        fail('XERO_NATIVE_JSON_NUMBER_LIMIT', 'A JSON number exceeds the exact numeric-token limit', pointer);
      numericTokens.push({pointer, lexeme});
      return lexeme;
    }
    fail('XERO_NATIVE_JSON_SYNTAX', 'The response contains an invalid or incomplete JSON value', pointer);
  }
  const parsed = value('', 0); white();
  if (cursor !== text.length)
    fail('XERO_NATIVE_JSON_SYNTAX', 'The response contains additional content after its JSON document');
  return {value:parsed, numericTokens};
}
