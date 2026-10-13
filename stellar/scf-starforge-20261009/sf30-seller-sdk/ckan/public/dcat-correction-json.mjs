// MIT. Exact-text JSON editing for the existing catalogue correction workbench.
// Values are never passed through Number or JSON.stringify during an edit.
const fail = (code, message) => { throw Object.assign(new Error(message || code), { code }); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export const correctionPointer = parts => parts.length ? '/' + parts.map(value => String(value).replaceAll('~', '~0').replaceAll('/', '~1')).join('/') : '';
export function correctionTokens(pointer) {
  if (typeof pointer !== 'string' || pointer.length > 16384 || pointer !== '' && !pointer.startsWith('/'))
    fail('DCAT_CORRECTION_POINTER_INVALID', 'Use an absolute JSON pointer, or an empty pointer for the complete document.');
  return pointer === '' ? [] : pointer.slice(1).split('/').map(part => {
    if (/~(?:[^01]|$)/.test(part)) fail('DCAT_CORRECTION_POINTER_INVALID', 'Escape a tilde as ~0 and a slash as ~1.');
    return part.replaceAll('~1', '/').replaceAll('~0', '~');
  });
}
export function parseCorrectionDocument(source) {
  if (typeof source !== 'string') fail('DCAT_CORRECTION_JSON_INVALID');
  for (let index = 0; index < source.length; index++) {
    const unit = source.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const following = source.charCodeAt(++index);
      if (!(following >= 0xdc00 && following <= 0xdfff)) fail('DCAT_CORRECTION_UNPAIRED_SURROGATE',
        'Enter Unicode text with complete characters, or use an explicit JSON \\u escape for a surrogate value.');
    } else if (unit >= 0xdc00 && unit <= 0xdfff) fail('DCAT_CORRECTION_UNPAIRED_SURROGATE',
      'Enter Unicode text with complete characters, or use an explicit JSON \\u escape for a surrogate value.');
  }
  let offset = source.charCodeAt(0) === 0xfeff ? 1 : 0, count = 0;
  const whitespace = () => { while (offset < source.length && /[\t\r\n ]/.test(source[offset])) offset++; };
  function string() {
    const start = offset++;
    while (offset < source.length) {
      const character = source[offset++];
      if (character === '"') {
        try { return { value: JSON.parse(source.slice(start, offset)), start, end: offset }; }
        catch { fail('DCAT_CORRECTION_JSON_INVALID', 'The document contains an invalid JSON string.'); }
      }
      if (character === '\\') offset++;
      else if (character.charCodeAt(0) < 32) fail('DCAT_CORRECTION_JSON_INVALID');
    }
    fail('DCAT_CORRECTION_JSON_INVALID', 'The JSON string is incomplete.');
  }
  function value(depth) {
    if (depth > 256 || ++count > 2000000) fail('DCAT_CORRECTION_JSON_COMPLEXITY', 'This editor supports up to 256 nested levels and two million JSON values.');
    whitespace();
    const start = offset, first = source[offset];
    if (first === '"') { string(); return { type: 'string', start, end: offset }; }
    if (first === '{' || first === '[') {
      const object = first === '{', end = object ? '}' : ']', children = [], keys = new Set();
      offset++; whitespace();
      if (source[offset] === end) { offset++; return { type: object ? 'object' : 'array', start, end: offset, children }; }
      while (offset < source.length) {
        whitespace(); const memberStart = offset;
        let key = String(children.length);
        if (object) {
          if (source[offset] !== '"') fail('DCAT_CORRECTION_JSON_INVALID');
          key = string().value;
          if (keys.has(key)) fail('DCAT_CORRECTION_DUPLICATE_KEY', 'This document contains duplicate object keys. Choose an unambiguous corrected source before editing it.');
          keys.add(key); whitespace();
          if (source[offset++] !== ':') fail('DCAT_CORRECTION_JSON_INVALID');
        }
        const node = value(depth + 1);
        children.push({ key, memberStart, memberEnd: node.end, node });
        whitespace(); const separator = source[offset++];
        if (separator === end) return { type: object ? 'object' : 'array', start, end: offset, children };
        if (separator !== ',') fail('DCAT_CORRECTION_JSON_INVALID');
        whitespace();
      }
      fail('DCAT_CORRECTION_JSON_INVALID');
    }
    for (const [literal, type] of [['true', 'boolean'], ['false', 'boolean'], ['null', 'null']]) {
      if (source.startsWith(literal, offset)) { offset += literal.length; return { type, start, end: offset }; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(offset));
    if (!match) fail('DCAT_CORRECTION_JSON_INVALID', 'Enter one complete JSON value.');
    offset += match[0].length;
    return { type: 'number', start, end: offset };
  }
  const root = value(0); whitespace();
  if (offset !== source.length) fail('DCAT_CORRECTION_JSON_INVALID', 'The document has trailing content or invalid JSON.');
  return { source, root };
}
export function findCorrectionNode(document, pointer) {
  let node = document.root;
  for (const token of correctionTokens(pointer)) {
    if (!node.children) fail('DCAT_CORRECTION_POINTER_MISSING', 'The selected path is not present in this revision.');
    if (node.type === 'array' && !/^(?:0|[1-9]\d*)$/.test(token))
      fail('DCAT_CORRECTION_POINTER_MISSING', 'Use the exact array index shown in this revision.');
    const child = node.children.find(item => item.key === token);
    if (!child) fail('DCAT_CORRECTION_POINTER_MISSING', 'The selected path is not present in this revision.');
    node = child.node;
  }
  return node;
}
export const correctionRaw = (document, node) => document.source.slice(node.start, node.end);
function childLocation(document, pointer, adding = false) {
  const parts = correctionTokens(pointer);
  if (!parts.length) return { root: true, node: document.root };
  const key = parts.pop(), parent = findCorrectionNode(document, correctionPointer(parts));
  if (!parent.children) fail('DCAT_CORRECTION_PARENT_INVALID', 'Choose an object or array as the destination.');
  if (parent.type === 'array' && !(adding && key === '-') && !/^(?:0|[1-9]\d*)$/.test(key))
    fail('DCAT_CORRECTION_ARRAY_INDEX', 'Use an array index, or - to append an item.');
  const index = parent.type === 'array' && adding ? key === '-' ? parent.children.length : Number(key) :
    parent.children.findIndex(item => item.key === key);
  if (parent.type === 'array' && adding && (!Number.isSafeInteger(index) || index > parent.children.length))
    fail('DCAT_CORRECTION_ARRAY_INDEX', 'The insertion position is outside this array.');
  return { root: false, parent, key, index, child: parent.children.find(item => item.key === key) };
}
function splice(source, start, end, replacement) { return source.slice(0, start) + replacement + source.slice(end); }
function removeAt(document, pointer) {
  const place = childLocation(document, pointer);
  if (place.root) fail('DCAT_CORRECTION_ROOT_REMOVE', 'Replace the complete document instead of removing it.');
  if (!place.child) fail('DCAT_CORRECTION_POINTER_MISSING');
  const entries = place.parent.children, index = entries.indexOf(place.child);
  const start = index === entries.length - 1 && index > 0 ? entries[index - 1].memberEnd : place.child.memberStart;
  const end = index < entries.length - 1 ? entries[index + 1].memberStart : place.child.memberEnd;
  return splice(document.source, start, end, '');
}
function addAt(document, pointer, jsonText) {
  const place = childLocation(document, pointer, true);
  if (place.root) fail('DCAT_CORRECTION_ROOT_ADD', 'Use replace to change the complete document.');
  const { parent, key, index } = place, entries = parent.children;
  if (parent.type === 'object') {
    if (place.child) fail('DCAT_CORRECTION_FIELD_EXISTS', 'This field already exists. Use replace to change its value.');
    const text = JSON.stringify(key) + ': ' + jsonText;
    return entries.length ? splice(document.source, entries.at(-1).memberEnd, entries.at(-1).memberEnd, ', ' + text) :
      splice(document.source, parent.start + 1, parent.start + 1, text);
  }
  if (!entries.length) return splice(document.source, parent.start + 1, parent.start + 1, jsonText);
  if (index === entries.length) return splice(document.source, entries.at(-1).memberEnd, entries.at(-1).memberEnd, ', ' + jsonText);
  return splice(document.source, entries[index].memberStart, entries[index].memberStart, jsonText + ', ');
}
function literal(value) {
  if (typeof value !== 'string') fail('DCAT_CORRECTION_VALUE_REQUIRED', 'Enter the replacement as a JSON literal, preserving its intended type.');
  const doc = parseCorrectionDocument(value);
  if (value.charCodeAt(0) === 0xfeff) fail('DCAT_CORRECTION_VALUE_INVALID');
  return correctionRaw(doc, doc.root);
}
export function applyCorrectionOperations(source, operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 1000)
    fail('DCAT_CORRECTION_OPERATIONS_INVALID', 'Supply between one and 1,000 ordered edits for this saved revision.');
  let document = parseCorrectionDocument(source);
  const changes = [];
  for (const operation of operations) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation) ||
        !['add', 'replace', 'remove', 'move'].includes(operation.op))
      fail('DCAT_CORRECTION_OPERATION_INVALID', 'Choose add, replace, remove or move.');
    correctionTokens(operation.path);
    const allowed = new Set(['op', 'path', ...(operation.op === 'move' ? ['from'] : operation.op === 'add' || operation.op === 'replace' ? ['valueText'] : [])]);
    if (Object.keys(operation).some(key => !allowed.has(key))) fail('DCAT_CORRECTION_OPERATION_INVALID', 'The edit contains an unsupported field.');
    let next, beforeText = null, afterText = null;
    if (operation.op === 'replace') {
      const node = findCorrectionNode(document, operation.path);
      beforeText = correctionRaw(document, node); afterText = literal(operation.valueText);
      next = splice(document.source, node.start, node.end, afterText);
    } else if (operation.op === 'add') {
      afterText = literal(operation.valueText); next = addAt(document, operation.path, afterText);
    } else if (operation.op === 'remove') {
      beforeText = correctionRaw(document, findCorrectionNode(document, operation.path));
      next = removeAt(document, operation.path);
    } else {
      const from = correctionTokens(operation.from), to = correctionTokens(operation.path);
      if (!from.length || !to.length || from.length <= to.length && from.every((part, index) => part === to[index]))
        fail('DCAT_CORRECTION_MOVE_INVALID', 'Move a value to a different destination outside itself.');
      beforeText = correctionRaw(document, findCorrectionNode(document, operation.from)); afterText = beforeText;
      const removed = parseCorrectionDocument(removeAt(document, operation.from));
      next = addAt(removed, operation.path, beforeText);
    }
    document = parseCorrectionDocument(next);
    changes.push({ ...operation, beforeText, afterText });
  }
  if (document.root.type !== 'object') fail('DCAT_CORRECTION_CATALOG_OBJECT', 'The complete catalogue must remain a JSON object.');
  return { text: document.source, changes };
}
export function inspectCorrectionDocument(source, { pointer = '', offset = 0, limit = 50, query = '', literalLimit = 4194304 } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
      typeof query !== 'string' || query.length > 2000) fail('DCAT_CORRECTION_PAGE_INVALID');
  const document = parseCorrectionDocument(source), node = findCorrectionNode(document, pointer), raw = correctionRaw(document, node);
  const tokens = correctionTokens(pointer), lower = query.toLocaleLowerCase();
  function descriptor(child) {
    const literal = correctionRaw(document, child.node);
    let label = child.key;
    if (child.node.type === 'object') {
      const title = child.node.children.find(item => ['title', 'dct:title', 'identifier', '@id'].includes(item.key) && item.node.type === 'string');
      if (title) label += ' · ' + JSON.parse(correctionRaw(document, title.node));
    }
    return { key: child.key, pointer: correctionPointer([...tokens, child.key]), type: child.node.type,
      label, characters: literal.length, childCount: child.node.children?.length ?? null,
      preview: literal.slice(0, 512), previewComplete: literal.length <= 512 };
  }
  const rows = (node.children ?? []).filter(child => !lower || child.key.toLocaleLowerCase().includes(lower) ||
    correctionRaw(document, child.node).toLocaleLowerCase().includes(lower)).map(descriptor);
  return { pointer, parentPointer: tokens.length ? correctionPointer(tokens.slice(0, -1)) : null,
    type: node.type, characters: raw.length, literalText: raw.length <= literalLimit ? raw : null,
    literalComplete: raw.length <= literalLimit, childCount: node.children?.length ?? 0,
    offset, limit, total: rows.length, rows: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null };
}
