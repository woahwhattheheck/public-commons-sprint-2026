'use strict';

/**
 * Execute complete retained ECMAScript modules using the original Acorn parser.
 * This is an explicit in-memory module host, not a security sandbox or Node VM.
 * CommonJS, filesystem and network capabilities remain caller-owned externals.
 */
const acorn = require('./vendor/acorn-source-closure/acorn.cjs');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const AMBIGUOUS = Symbol('ambiguous export');

class ConnectedModuleError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'ConnectedModuleError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}
function fail(code, message, detail) { throw new ConnectedModuleError(code, message, detail); }
function textName(node) { return node.name === undefined ? node.value : node.name; }
function blank(source) { return source.replace(/[^\r\n]/g, ' '); }

function resolveModuleId(specifier, referrer = '') {
  if (typeof specifier !== 'string' || !specifier || /[\u0000-\u001f\\]/.test(specifier))
    fail('MODULE_SPECIFIER', 'Use a complete, nonempty module specifier.', {specifier, referrer});
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return specifier;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(referrer)) {
    if (typeof URL !== 'function') fail('MODULE_URL', 'Supply a resolver for URL module identifiers.');
    return new URL(specifier, referrer).href;
  }
  const parts = referrer.split('/'); parts.pop();
  for (const part of specifier.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length || parts.at(-1) === '..') fail('MODULE_PATH', 'A relative import escapes the supplied module root.', {specifier, referrer});
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

function commonJsNamespace(value, names = []) {
  const ns = Object.create(null);
  Object.defineProperty(ns, 'default', {enumerable: true, get: () => value});
  for (const name of names) {
    if (typeof name !== 'string' || name === 'default' || own(ns, name))
      fail('COMMONJS_EXPORT', 'Select distinct named CommonJS exports.', {name});
    Object.defineProperty(ns, name, {enumerable: true, get: () => value[name]});
  }
  Object.defineProperty(ns, Symbol.toStringTag, {value: 'Module'});
  return Object.freeze(ns);
}

function childNodes(node, visit) {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') visit(child, key);
    } else if (value && typeof value.type === 'string') visit(value, key);
  }
}

/* Two passes: gather every lexical binding, then resolve actual references.
 * A separate parameter scope prevents function-body vars from capturing defaults.
 */
function lexicalScopes(ast) {
  const scopes = new WeakMap(), bindingNodes = new WeakSet();
  const make = (parent, variable = false) => ({parent, variable, bindings: new Map()});
  const root = make(null, true);
  function bind(pattern, scope, kind = 'local') {
    if (!pattern) return;
    if (pattern.type === 'Identifier') {
      bindingNodes.add(pattern); scope.bindings.set(pattern.name, kind); return;
    }
    if (pattern.type === 'RestElement') return bind(pattern.argument, scope, kind);
    if (pattern.type === 'AssignmentPattern') return bind(pattern.left, scope, kind);
    if (pattern.type === 'ArrayPattern') { for (const item of pattern.elements) bind(item, scope, kind); return; }
    if (pattern.type === 'ObjectPattern') {
      for (const item of pattern.properties) bind(item.type === 'RestElement' ? item.argument : item.value, scope, kind);
    }
  }
  function variableScope(scope) { while (!scope.variable) scope = scope.parent; return scope; }
  function walk(node, scope) {
    scopes.set(node, scope);
    if (node.type === 'Program') { for (const item of node.body) walk(item, scope); return; }
    if (node.type === 'ImportDeclaration') {
      for (const item of node.specifiers) bind(item.local, scope, 'import');
      childNodes(node, child => scopes.set(child, scope)); return;
    }
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) {
      if (node.type === 'FunctionDeclaration') bind(node.id, scope);
      const parameters = make(scope);
      if (node.type !== 'ArrowFunctionExpression') parameters.bindings.set('arguments', 'local');
      if (node.id) bind(node.id, parameters);
      for (const parameter of node.params) bind(parameter, parameters);
      for (const parameter of node.params) walk(parameter, parameters);
      const bodyScope = make(parameters, true);
      walk(node.body, bodyScope); return;
    }
    if (node.type === 'BlockStatement' || node.type === 'StaticBlock') {
      const block = make(scope, node.type === 'StaticBlock');
      scopes.set(node, block); for (const item of node.body) walk(item, block); return;
    }
    if (node.type === 'CatchClause') {
      const caught = make(scope); bind(node.param, caught);
      if (node.param) walk(node.param, caught); walk(node.body, caught); return;
    }
    if (node.type === 'SwitchStatement') {
      walk(node.discriminant, scope);
      const block = make(scope); scopes.set(node, block);
      for (const item of node.cases) walk(item, block);
      return;
    }
    if (/^(ForStatement|ForInStatement|ForOfStatement)$/.test(node.type)) {
      const block = make(scope); scopes.set(node, block);
      childNodes(node, child => walk(child, block)); return;
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.type === 'ClassDeclaration') bind(node.id, scope);
      const inside = make(scope); if (node.id) bind(node.id, inside);
      if (node.superClass) walk(node.superClass, inside); walk(node.body, inside); return;
    }
    if (node.type === 'VariableDeclaration') {
      for (const item of node.declarations) bind(item.id, node.kind === 'var' ? variableScope(scope) : scope);
    }
    childNodes(node, child => walk(child, scope));
  }
  walk(ast, root);
  return {
    scopes, bindingNodes,
    resolve(node, name) {
      let scope = scopes.get(node);
      while (scope) { if (scope.bindings.has(name)) return scope.bindings.get(name); scope = scope.parent; }
      return null;
    }
  };
}

function isReference(node, parent, key, bindingNodes) {
  if (bindingNodes.has(node) || !parent) return false;
  if (/^(ImportSpecifier|ImportDefaultSpecifier|ImportNamespaceSpecifier|ExportSpecifier|MetaProperty)$/.test(parent.type)) return false;
  if ((parent.type === 'MemberExpression' || parent.type === 'Property' ||
       parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') &&
      (key === 'property' || key === 'key') && !parent.computed) return false;
  if (/^(LabeledStatement|BreakStatement|ContinueStatement)$/.test(parent.type) && key === 'label') return false;
  return true;
}

function declaredNames(declaration) {
  const result = [];
  function pattern(node) {
    if (!node) return;
    if (node.type === 'Identifier') result.push(node.name);
    else if (node.type === 'RestElement') pattern(node.argument);
    else if (node.type === 'AssignmentPattern') pattern(node.left);
    else if (node.type === 'ArrayPattern') node.elements.forEach(pattern);
    else if (node.type === 'ObjectPattern') node.properties.forEach(item => pattern(item.type === 'RestElement' ? item.argument : item.value));
  }
  if (declaration.type === 'VariableDeclaration') declaration.declarations.forEach(item => pattern(item.id));
  else pattern(declaration.id);
  return result;
}

function applyEdits(source, edits) {
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let position = 0, result = '';
  for (const edit of edits) {
    if (edit.start < position) fail('MODULE_TRANSFORM', 'Module syntax edits overlap.', {edit});
    result += source.slice(position, edit.start) + edit.text;
    position = edit.end;
  }
  return result + source.slice(position);
}

function compileSource(source, id, resolve, globalNames) {
  let ast;
  try { ast = acorn.parse(source, {ecmaVersion: 'latest', sourceType: 'module', locations: true}); }
  catch (error) { fail('MODULE_PARSE', error.message, {id, line: error.loc?.line, column: error.loc?.column}); }
  const names = new Set();
  (function collect(node) { if (node.type === 'Identifier') names.add(node.name); childNodes(node, collect); })(ast);
  let index = 0;
  function fresh(label) {
    let name; do { name = '__connected_' + label + '_' + index++; } while (names.has(name));
    names.add(name); return name;
  }
  const helper = {scope: fresh('scope'), register: fresh('register'), dynamic: fresh('import'), meta: fresh('meta'), args: fresh('arguments')};
  const imports = new Map(), exports = new Map(), dependencies = [], stars = [], edits = [], removed = [];
  const defaultFunctions = [];
  const locals = new Set();
  function patch(start, end, text, kind) { edits.push({start, end, text, kind}); }
  function remove(node) { patch(node.start, node.end, blank(source.slice(node.start, node.end)), 'module-declaration'); removed.push(node); }
  function dependency(node) {
    const target = resolve(node.source.value, id);
    const attributes = Object.create(null);
    for (const item of node.attributes || []) {
      const key = textName(item.key);
      if (key !== 'type' || item.value.value !== 'json') fail('MODULE_ATTRIBUTE', 'Only the JSON type import attribute is supported.', {id, specifier: node.source.value, key});
      attributes[key] = item.value.value;
    }
    dependencies.push({id: target, specifier: node.source.value, attributes});
    return target;
  }
  function exported(name, descriptor) {
    exports.set(name, descriptor);
    if (descriptor.local) locals.add(descriptor.local);
  }
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      const target = dependency(node);
      for (const item of node.specifiers) {
        imports.set(item.local.name, {id: target, name: item.type === 'ImportNamespaceSpecifier' ? '*' :
          item.type === 'ImportDefaultSpecifier' ? 'default' : textName(item.imported)});
      }
      remove(node);
    } else if (node.type === 'ExportAllDeclaration') {
      const target = dependency(node);
      if (node.exported) exported(textName(node.exported), {namespace: target});
      else stars.push(target);
      remove(node);
    } else if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        patch(node.start, node.declaration.start, blank(source.slice(node.start, node.declaration.start)), 'export-prefix');
        for (const name of declaredNames(node.declaration)) exported(name, {local: name});
      } else {
        const target = node.source ? dependency(node) : null;
        for (const item of node.specifiers) exported(textName(item.exported), target ?
          {id: target, name: textName(item.local)} : {local: textName(item.local)});
        remove(node);
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      const declaration = node.declaration;
      if ((declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') && declaration.id) {
        exported('default', {local: declaration.id.name});
        patch(node.start, declaration.start, blank(source.slice(node.start, declaration.start)), 'export-prefix');
      } else {
        const name = fresh('default'); exported('default', {local: name});
        if (declaration.type === 'FunctionDeclaration') {
          patch(node.start, declaration.start, blank(source.slice(node.start, declaration.start)), 'export-prefix');
          const tokenizer = acorn.tokenizer(source.slice(declaration.start, declaration.end), {ecmaVersion: 'latest'});
          let token; do { token = tokenizer.getToken(); } while (token.type.label !== '(' && token.type.label !== 'eof');
          patch(declaration.start + token.start, declaration.start + token.start, ' ' + name, 'default-function-name');
          defaultFunctions.push(name);
        } else {
          const tokenizer = acorn.tokenizer(source.slice(node.start, node.end), {ecmaVersion: 'latest'});
          let keyword; do { keyword = tokenizer.getToken(); } while (keyword.value !== 'default' && keyword.type.label !== 'eof');
          const end = source[node.end - 1] === ';' ? node.end - 1 : node.end;
          patch(node.start, node.start + keyword.end, 'const ' + name + ' = ({default: (', 'default-value');
          patch(end, end, ')}).default;', 'default-value-end');
        }
      }
    }
  }
  if (source.startsWith('#!')) {
    const end = source.search(/[\r\n]/); patch(0, end < 0 ? source.length : end, blank(source.slice(0, end < 0 ? source.length : end)), 'hashbang');
  }
  let topLevelAwait = false;
  (function scan(node, functionDepth = 0) {
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) functionDepth++;
    if (!functionDepth && (node.type === 'AwaitExpression' || (node.type === 'ForOfStatement' && node.await))) topLevelAwait = true;
    childNodes(node, child => scan(child, functionDepth));
  })(ast);
  const lexical = lexicalScopes(ast);
  function walk(node, parent, key) {
    if (removed.includes(node)) return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'eval' && !node.optional)
      fail('MODULE_DIRECT_EVAL', 'Direct eval depends on a native module lexical environment; use an explicit evaluator or native module host for this source.', {id, offset: node.start});
    if (node.type === 'MetaProperty' && node.meta.name === 'import') {
      patch(node.start, node.end, helper.meta, 'import-meta'); return;
    }
    if (node.type === 'ImportExpression') patch(node.start, node.start + 6, helper.dynamic, 'dynamic-import');
    if (node.type === 'Identifier' && isReference(node, parent, key, lexical.bindingNodes)) {
      const binding = lexical.resolve(node, node.name);
      let replacement = null;
      if (node.name === 'arguments' && binding === null) replacement = helper.args;
      else if ((binding === 'import' || (binding === null && globalNames.has(node.name))) && ((parent.type === 'CallExpression' && key === 'callee') ||
        (parent.type === 'TaggedTemplateExpression' && key === 'tag'))) replacement = '(0, ' + node.name + ')';
      if (replacement !== null) {
        if (parent.type === 'Property' && parent.shorthand && key === 'value') replacement = node.name + ': ' + replacement;
        patch(node.start, node.end, replacement, 'reference');
      }
    }
    childNodes(node, (child, childKey) => walk(child, node, childKey));
  }
  walk(ast, null, '');
  const transformed = applyEdits(source, edits);
  const registration = '[' + [...locals].map(name => '[' + JSON.stringify(name) + ',()=>'+name+']').join(',') + ']';
  const body = 'with(' + helper.scope + '){return (' + (topLevelAwait ? 'async ' : '') + 'function*(){\n"use strict";\n' + helper.register + '(' + registration + ',[' + defaultFunctions.join(',') + ']);\n' +
    '\nyield;\n' + transformed + '\n}).call(undefined);}';
  let factory;
  try { factory = new Function(helper.scope, helper.register, helper.dynamic, helper.meta, body); }
  catch (error) { fail('MODULE_COMPILE', error.message, {id}); }
  return {imports, exports, dependencies, stars, locals, helper, factory, edits, transformed, topLevelAwait};
}

function createConnectedModuleHost({modules = {}, externals = {}, globals = {}, resolve = resolveModuleId} = {}) {
  if (typeof resolve !== 'function' || globals === null || typeof globals !== 'object')
    fail('MODULE_OPTIONS', 'Supply a resolver function and an object of explicit globals.');
  const inputs = new Map([...(modules instanceof Map ? modules : Object.entries(modules))].map(([id, value]) =>
    [id, value && typeof value === 'object' ? Object.freeze({source: value.source, type: value.type, url: value.url}) : value]));
  const externalInputs = new Map(externals instanceof Map ? externals : Object.entries(externals));
  for (const id of inputs.keys()) if (externalInputs.has(id)) fail('MODULE_COLLISION', 'A module cannot also be an external.', {id});
  const records = new Map();
  const globalNames = new Set(Object.getOwnPropertyNames(globals));
  let prepareQueue = Promise.resolve();
  function identifier(specifier, referrer = '') {
    const id = resolve(specifier, referrer);
    if (typeof id !== 'string' || !id) fail('MODULE_RESOLVER', 'The resolver must return a nonempty module identifier.', {specifier, referrer});
    return id;
  }
  function record(id) {
    if (records.has(id)) return records.get(id);
    const rec = {id, status: 'parsed', namespace: null, getters: new Map(), exports: new Map(), stars: [], dependencies: [], imports: new Map()};
    records.set(id, rec);
    try {
      if (externalInputs.has(id)) {
        const value = externalInputs.get(id);
        if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
          fail('MODULE_EXTERNAL', 'An external must be an explicit export namespace; wrap CommonJS with commonJsNamespace().', {id});
        rec.type = 'external';
        for (const name of Object.getOwnPropertyNames(value)) {
          rec.exports.set(name, {local: name}); rec.getters.set(name, () => value[name]);
        }
      } else {
        if (!inputs.has(id)) fail('MODULE_MISSING', 'The complete module source or explicit external is missing.', {id});
        const input = inputs.get(id);
        const descriptor = typeof input === 'string' ? {source: input, type: 'javascript'} : input;
        if (!descriptor || typeof descriptor.source !== 'string') fail('MODULE_SOURCE', 'Retain the complete original module source string.', {id});
        rec.source = descriptor.source; rec.url = descriptor.url || id; rec.type = descriptor.type || 'javascript';
        if (rec.type === 'json') {
          let value;
          try { value = JSON.parse(rec.source); } catch (error) { fail('MODULE_JSON', error.message, {id}); }
          rec.exports.set('default', {local: 'default'}); rec.getters.set('default', () => value);
        } else if (rec.type === 'javascript') Object.assign(rec, compileSource(rec.source, id, identifier, globalNames));
        else fail('MODULE_TYPE', 'Use javascript or json source, or an explicit external namespace.', {id, type: rec.type});
      }
      return rec;
    } catch (error) { rec.status = 'errored'; rec.error = error; throw error; }
  }
  function graph(entry) {
    const found = new Map();
    function visit(id) {
      if (found.has(id)) return;
      const rec = record(id);
      if (rec.status === 'errored') throw rec.error;
      found.set(id, rec);
      for (const dep of rec.dependencies) {
        const target = record(dep.id);
        if (dep.attributes.type === 'json' && target.type !== 'json')
          fail('MODULE_ATTRIBUTE', 'A JSON import attribute requires a declared JSON source module.', {id, target: dep.id});
        if (target.type === 'json' && dep.attributes.type !== 'json')
          fail('MODULE_ATTRIBUTE', 'Import JSON source with the type: json attribute.', {id, target: dep.id});
        visit(dep.id);
      }
    }
    visit(entry); return found;
  }
  function exportNames(rec, seen = new Set()) {
    if (seen.has(rec.id)) return new Set();
    const next = new Set(seen); next.add(rec.id);
    const result = new Set(rec.exports.keys());
    for (const id of rec.stars) for (const name of exportNames(record(id), next)) if (name !== 'default') result.add(name);
    return result;
  }
  function resolveExport(rec, name, seen = new Set()) {
    const key = JSON.stringify([rec.id, name]);
    if (seen.has(key)) return null;
    const next = new Set(seen); next.add(key);
    const item = rec.exports.get(name);
    if (item) {
      if (item.namespace) return {id: item.namespace, namespace: true};
      if (item.id) return resolveExport(record(item.id), item.name, next);
      const imported = rec.imports.get(item.local);
      if (imported) return imported.name === '*' ? {id: imported.id, namespace: true} :
        resolveExport(record(imported.id), imported.name, next);
      return {id: rec.id, name: item.local};
    }
    if (name === 'default') return null;
    let match = null;
    for (const id of rec.stars) {
      const candidate = resolveExport(record(id), name, next);
      if (candidate === AMBIGUOUS) return AMBIGUOUS;
      if (!candidate) continue;
      if (match && (match.id !== candidate.id || match.name !== candidate.name || Boolean(match.namespace) !== Boolean(candidate.namespace))) return AMBIGUOUS;
      match = candidate;
    }
    return match;
  }
  function bindingValue(binding) {
    const rec = record(binding.id);
    if (binding.namespace) return rec.namespace;
    const get = rec.getters.get(binding.name);
    if (!get) throw new ReferenceError("Cannot access '" + binding.name + "' before module initialization");
    return get();
  }
  function requireExport(rec, name, importer) {
    const binding = resolveExport(rec, name);
    if (!binding || binding === AMBIGUOUS) fail('MODULE_EXPORT', 'The requested export is missing or ambiguous.', {id: importer, source: rec.id, name});
    return binding;
  }
  function connectComponents(current) {
    let index = 0;
    const position = new Map(), low = new Map(), stack = [], onStack = new Set();
    function visit(rec) {
      position.set(rec.id, index); low.set(rec.id, index++); stack.push(rec); onStack.add(rec.id);
      for (const dep of rec.dependencies) {
        const target = record(dep.id);
        if (!position.has(target.id)) { visit(target); low.set(rec.id, Math.min(low.get(rec.id), low.get(target.id))); }
        else if (onStack.has(target.id)) low.set(rec.id, Math.min(low.get(rec.id), position.get(target.id)));
      }
      if (low.get(rec.id) !== position.get(rec.id)) return;
      const members = []; let member;
      do { member = stack.pop(); onStack.delete(member.id); members.push(member); } while (member !== rec);
      const retained = members.find(item => item.component)?.component;
      const component = retained || {members, status: 'instantiated', evaluation: null, error: null};
      for (const item of members) item.component = component;
    }
    for (const rec of current.values()) if (!position.has(rec.id)) visit(rec);
  }
  async function prepare(entry) {
    const current = graph(entry);
    for (const rec of current.values()) {
      for (const [name] of rec.exports) requireExport(rec, name, rec.id);
      for (const imported of rec.imports.values()) if (imported.name !== '*') requireExport(record(imported.id), imported.name, rec.id);
    }
    for (const rec of current.values()) if (!rec.namespace) {
      const namespace = Object.create(null);
      for (const name of [...exportNames(rec)].sort()) {
        const binding = resolveExport(rec, name);
        if (binding && binding !== AMBIGUOUS) Object.defineProperty(namespace, name, {enumerable: true, get: () => bindingValue(binding)});
      }
      Object.defineProperty(namespace, Symbol.toStringTag, {value: 'Module'});
      rec.namespace = Object.freeze(namespace);
    }
    for (const rec of current.values()) {
      if (rec.status !== 'parsed') continue;
      if (rec.type === 'javascript') {
        const imported = new Map();
        for (const [name, value] of rec.imports) imported.set(name, value.name === '*' ? {id: value.id, namespace: true} :
          requireExport(record(value.id), value.name, rec.id));
        const reserved = new Set(Object.values(rec.helper));
        reserved.delete(rec.helper.args);
        const scope = new Proxy(Object.create(null), {
          has(_target, key) {
            if (key === Symbol.unscopables || reserved.has(key)) return false;
            if (key === rec.helper.args) return own(globals, 'arguments') || 'arguments' in globalThis;
            return imported.has(key) || globalNames.has(key);
          },
          get(_target, key) {
            if (key === Symbol.unscopables) return undefined;
            if (key === rec.helper.args) return own(globals, 'arguments') ? globals.arguments : globalThis.arguments;
            if (imported.has(key)) return bindingValue(imported.get(key));
            return globals[key];
          },
          set(_target, key, value) {
            if (imported.has(key)) throw new TypeError('Cannot assign to imported binding ' + String(key));
            if (key === rec.helper.args) {
              if (own(globals, 'arguments')) globals.arguments = value; else globalThis.arguments = value;
            } else globals[key] = value;
            return true;
          }
        });
        const meta = Object.assign(Object.create(null), {url: rec.url, resolve: specifier => identifier(specifier, rec.id)});
        rec.iterator = rec.factory(scope, (entries, functions) => { for (const [name, get] of entries) rec.getters.set(name, get);
          for (const fn of functions) Object.defineProperty(fn, 'name', {value: 'default', configurable: true}); },
          (specifier, options) => importModule(specifier, rec.id, options), meta);
        const result = await rec.iterator.next();
        if (result.done) fail('MODULE_INSTANTIATE', 'The module did not reach its initialization boundary.', {id: rec.id});
      }
      rec.status = 'instantiated';
    }
    connectComponents(current);
    return record(entry);
  }
  // A synchronous dependency must finish before the next sibling starts.
  // Genuine async dependencies begin in DFS order and let later siblings run.
  // An outside importer waits for the entire static cycle's evaluation.
  function evaluate(rec) {
    const component = rec.component;
    if (component.status === 'errored') throw component.error;
    if (component.status === 'evaluated') return null;
    if (component.status === 'evaluating') return component.evaluation;
    component.status = 'evaluating';
    const visiting = new Set(), visited = new Set();
    function failed(item, error) { item.status = 'errored'; item.error = error; throw error; }
    function complete(item, result) {
      if (!result.done) fail('MODULE_EVALUATE', 'An unexpected yield escaped module evaluation.', {id: item.id});
      item.status = 'evaluated';
    }
    function run(item) {
      if (!item.iterator) { item.status = 'evaluated'; return null; }
      if (item.topLevelAwait)
        return item.iterator.next().then(result => complete(item, result)).catch(error => failed(item, error));
      try { complete(item, item.iterator.next()); return null; }
      catch (error) { return failed(item, error); }
    }
    function visit(item) {
      if (visiting.has(item.id)) return null;
      if (visited.has(item.id)) return item.evaluation || null;
      visiting.add(item.id); item.status = 'evaluating';
      const pending = [];
      try {
        for (const dep of item.dependencies) {
          const target = record(dep.id);
          const wait = target.component === component ? visit(target) : evaluate(target);
          if (wait) pending.push(wait);
        }
        item.evaluation = pending.length ? Promise.all(pending).then(() => run(item)).catch(error => failed(item, error)) : run(item);
        visiting.delete(item.id); visited.add(item.id);
        return item.evaluation;
      } catch (error) { return failed(item, error); }
    }
    try {
      visit(rec);
      const pending = component.members.map(item => item.evaluation).filter(Boolean);
      if (!pending.length) { component.status = 'evaluated'; return null; }
      component.evaluation = Promise.all(pending).then(() => {component.status = 'evaluated';})
        .catch(error => {component.status = 'errored'; component.error = error; throw error;});
      return component.evaluation;
    } catch (error) {
      component.status = 'errored'; component.error = error;
      for (const item of component.members) if (item.evaluation) item.evaluation.catch(() => undefined);
      throw error;
    }
  }
  async function importModule(specifier, referrer = '', options) {
    const id = identifier(typeof specifier === 'string' ? specifier : `${specifier}`, referrer);
    if (options !== undefined && (options === null || typeof options !== 'object'))
      fail('MODULE_ATTRIBUTE', 'Dynamic import options must be an object.', {id});
    const task = prepareQueue.then(() => prepare(id));
    prepareQueue = task.then(() => undefined, () => undefined);
    const rec = await task;
    const attributes = options?.with;
    if (attributes !== undefined && (attributes === null || typeof attributes !== 'object' ||
      Object.keys(attributes).some(key => key !== 'type') || attributes.type !== 'json'))
      fail('MODULE_ATTRIBUTE', 'Dynamic JSON imports use {with:{type:"json"}}.', {id});
    if (referrer && ((rec.type === 'json') !== (attributes?.type === 'json')))
      fail('MODULE_ATTRIBUTE', 'Dynamic import attributes must match the declared JSON module type.', {id});
    await evaluate(rec);
    return rec.namespace;
  }
  return Object.freeze({
    import: importModule,
    source(id) { const rec = record(id); return rec.source === undefined ? null : rec.source; },
    describe() {
      return [...records.values()].map(rec => ({id: rec.id, type: rec.type, status: rec.status,
        topLevelAwait: Boolean(rec.topLevelAwait), componentStatus: rec.component?.status || null,
        dependencies: rec.dependencies.map(dep => ({id: dep.id, specifier: dep.specifier})),
        exports: rec.namespace ? Object.keys(rec.namespace) : [...rec.exports.keys()],
        edits: (rec.edits || []).map(({start, end, kind}) => ({start, end, kind})),
        error: rec.error ? {name: rec.error.name, code: rec.error.code, message: rec.error.message} : null}));
    }
  });
}

module.exports = {createConnectedModuleHost, commonJsNamespace, resolveModuleId, ConnectedModuleError};
