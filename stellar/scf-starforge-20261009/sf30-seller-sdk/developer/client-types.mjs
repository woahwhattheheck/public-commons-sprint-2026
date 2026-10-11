// MIT. TypeScript declarations for the original compiled seller client snapshot.
// No network, signer, schema execution, or response inference.
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const quote = value => JSON.stringify(value);
const MAX_DEPTH = 40;
const MAX_NODES = 12000;

function joinTypes(values, operator, fallback = 'JsonValue') {
  let types = [...new Set(values.filter(Boolean))];
  if (!types.length) return fallback;
  if (operator === '&') {
    if (types.includes('never')) return 'never';
    if (types.length > 1) {
      const remaining = types.filter(value => value !== fallback);
      if (remaining.length && remaining.length !== types.length) return joinTypes(remaining, operator, fallback);
    }
  } else {
    types = types.filter(value => value !== 'never');
    if (!types.length) return 'never';
    if (fallback !== 'never' && types.includes(fallback)) return fallback;
  }
  if (types.length === 1) return types[0];
  return '(' + types.join(` ${operator} `) + ')';
}

function localReference(reference, root) {
  if (typeof reference !== 'string' || !reference.startsWith('#')) return undefined;
  let fragment;
  try { fragment = decodeURIComponent(reference.slice(1)); } catch { return undefined; }
  if (!fragment) return root;
  if (!fragment.startsWith('/')) return undefined;
  let current = root;
  for (const token of fragment.slice(1).split('/')) {
    if (/~(?![01])/u.test(token)) return undefined;
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if ((!object(current) && !Array.isArray(current)) || !own(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function enter(node, state, seen) {
  if (++state.nodes > MAX_NODES || seen.size >= MAX_DEPTH || seen.has(node)) return null;
  return new Set([...seen, node]);
}

// Project one property through document-local references and schema composition.
// A branch without that property leaves its value unconstrained, rather than
// accidentally making the property impossible or inheriting a sibling branch.
function propertySchema(node, key, root, seen = new Set()) {
  if (node === false) return false;
  if (!object(node) || seen.size >= MAX_DEPTH || seen.has(node)) return true;
  const next = new Set([...seen, node]), parts = [];
  if (object(node.properties) && own(node.properties, key)) parts.push(node.properties[key]);
  if (own(node, '$ref')) {
    const target = localReference(node.$ref, root);
    parts.push(target === undefined ? true : propertySchema(target, key, root, next));
  }
  for (const kind of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(node[kind])) parts.push({
      [kind]: node[kind].map(child => propertySchema(child, key, root, next)),
    });
  }
  if (own(node, 'const')) {
    if (object(node.const) && own(node.const, key)) parts.push({ const: node.const[key] });
  } else if (Array.isArray(node.enum) && node.enum.length) {
    const values = node.enum.filter(object);
    if (values.length === node.enum.length && values.every(value => own(value, key)))
      parts.push({ enum: values.map(value => value[key]) });
  }
  return parts.length ? (parts.length === 1 ? parts[0] : { allOf: parts }) : true;
}

function literalType(value, depth = 0) {
  if (depth > MAX_DEPTH) return 'JsonValue';
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return quote(value);
  if (typeof value === 'number') return Number.isFinite(value) ? quote(value) : 'JsonValue';
  if (Array.isArray(value)) return 'readonly [' + value.map(item => literalType(item, depth + 1)).join(', ') + ']';
  if (object(value)) return Object.keys(value).length ? '{ ' + Object.entries(value).map(([key, child]) =>
    `readonly ${quote(key)}: ${literalType(child, depth + 1)};`).join(' ') + ' }' : 'Readonly<Record<string, never>>';
  return 'JsonValue';
}

function schemaType(node, state, seen = new Set(), query = false) {
  const fallback = query ? 'QueryParameters' : 'JsonValue';
  if (node === false) return 'never';
  if (!object(node)) return fallback;
  const next = enter(node, state, seen);
  if (!next) return fallback;
  const parts = [];
  if (own(node, '$ref')) {
    const target = localReference(node.$ref, state.root);
    parts.push(target === undefined ? fallback : schemaType(target, state, next, query));
  }
  for (const kind of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(node[kind])) {
      const values = node[kind].map(child => schemaType(child, state, next, query));
      parts.push(joinTypes(values, kind === 'allOf' ? '&' : '|', kind === 'allOf' ? fallback : 'never'));
    }
  }
  if (own(node, 'const')) parts.push(query ? queryLiteral(node.const) : literalType(node.const));
  else if (Array.isArray(node.enum))
    parts.push(joinTypes(node.enum.map(value => query ? queryLiteral(value) : literalType(value)), '|', 'never'));

  const types = Array.isArray(node.type) ? node.type : typeof node.type === 'string' ? [node.type] : null;
  if (query) {
    // HTTP query values remain text even when a metadata example looks numeric.
    if (types && !types.includes('object')) parts.push('never');
    else parts.push(objectType(node, state, next, true));
  } else if (types) {
    parts.push(joinTypes(types.map(type => {
      if (type === 'object') return objectType(node, state, next);
      if (type === 'array') return arrayType(node, state, next);
      if (type === 'integer' || type === 'number') return 'number';
      if (['string', 'boolean', 'null'].includes(type)) return type;
      return fallback;
    }), '|', fallback));
  } else {
    // JSON Schema object/array keywords do not reject other JSON kinds on their
    // own. Preserve that behavior instead of silently inferring a missing type.
    const constrainsObject = ['properties', 'required', 'additionalProperties', 'patternProperties']
      .some(key => own(node, key));
    const constrainsArray = ['items', 'prefixItems', 'minItems', 'maxItems'].some(key => own(node, key));
    if (constrainsObject || constrainsArray) parts.push(joinTypes([
      'JsonPrimitive', constrainsObject ? objectType(node, state, next) : 'JsonObject',
      constrainsArray ? arrayType(node, state, next) : 'readonly JsonValue[]',
    ], '|', fallback));
  }
  return joinTypes(parts, '&', fallback);
}

function queryLiteral(value) {
  if (!object(value)) return 'never';
  return Object.keys(value).length ? '{ ' + Object.keys(value).map(key => `readonly ${quote(key)}: QueryValue;`).join(' ') + ' }' :
    'Readonly<Record<string, never>>';
}

function objectType(node, state, seen, query = false) {
  const properties = object(node.properties) ? node.properties : {};
  const required = new Set(Array.isArray(node.required) ? node.required.filter(value => typeof value === 'string') : []);
  const keys = [...new Set([...Object.keys(properties), ...required])].sort();
  const values = [], members = [];
  for (const key of keys) {
    const field = own(properties, key) ? properties[key] : true;
    const type = query ? (field === false ? 'never' : 'QueryValue') : schemaType(field, state, seen);
    values.push(type);
    members.push(`readonly ${quote(key)}${required.has(key) ? '' : '?'}: ${type};`);
  }
  const base = members.length ? '{ ' + members.join(' ') + ' }' : null;
  const hasPatterns = object(node.patternProperties) && Object.keys(node.patternProperties).length > 0;
  if (node.additionalProperties === false && !hasPatterns)
    return base ?? 'Readonly<Record<string, never>>';
  let additional = query ? 'QueryValue' : hasPatterns ? 'JsonValue' : schemaType(node.additionalProperties, state, seen);
  // A string index signature also covers the explicitly declared properties.
  // Include their types so valid named fields are not rejected merely because
  // the schema gives *additional* fields a narrower, different type.
  additional = joinTypes([...values, additional], '|', query ? 'QueryValue' : 'JsonValue');
  const index = `Readonly<Record<string, ${additional}>>`;
  return base ? `(${base} & ${index})` : index;
}

function arrayType(node, state, seen) {
  const prefixes = Array.isArray(node.prefixItems) ? node.prefixItems : [];
  const min = Number.isSafeInteger(node.minItems) && node.minItems >= 0 ? node.minItems : 0;
  const max = Number.isSafeInteger(node.maxItems) && node.maxItems >= 0 ? node.maxItems : Infinity;
  if (min > max) return 'never';
  if (!prefixes.length) return node.items === false ? (min ? 'never' : 'readonly []') :
    `ReadonlyArray<${schemaType(node.items, state, seen)}>`;
  if (prefixes.length > 64 || min > 64) return 'readonly JsonValue[]';
  if (node.items === false && min > prefixes.length) return 'never';
  const length = Math.min(Math.max(prefixes.length, min), max);
  const slots = [];
  for (let index = 0; index < length; index++) {
    const type = schemaType(index < prefixes.length ? prefixes[index] : node.items, state, seen);
    slots.push(`${index < min ? type : `(${type})?`}`);
  }
  if (node.items !== false && max > length) slots.push(`...(${schemaType(node.items, state, seen)})[]`);
  return 'readonly [' + slots.join(', ') + ']';
}

function requiredNames(node, root, seen = new Set()) {
  if (!object(node) || seen.size >= MAX_DEPTH || seen.has(node)) return new Set();
  const next = new Set([...seen, node]);
  const required = new Set(Array.isArray(node.required) ? node.required.filter(value => typeof value === 'string') : []);
  const include = names => { for (const name of names) required.add(name); };
  if (own(node, '$ref')) include(requiredNames(localReference(node.$ref, root), root, next));
  for (const child of Array.isArray(node.allOf) ? node.allOf : []) include(requiredNames(child, root, next));
  for (const key of ['anyOf', 'oneOf']) {
    if (!Array.isArray(node[key]) || !node[key].length) continue;
    const alternatives = node[key].map(child => requiredNames(child, root, next));
    include([...alternatives[0]].filter(name => alternatives.every(names => names.has(name))));
  }
  if (object(node.const)) include(Object.keys(node.const));
  else if (Array.isArray(node.enum) && node.enum.length && node.enum.every(object))
    include(Object.keys(node.enum[0]).filter(name => node.enum.every(value => own(value, name))));
  return required;
}

function emptyQueryAllowed(node, root, seen = new Set()) {
  if (node === false) return false;
  if (!object(node) || seen.size >= MAX_DEPTH || seen.has(node)) return true;
  const next = new Set([...seen, node]);
  if (Array.isArray(node.required) && node.required.length) return false;
  if (typeof node.minProperties === 'number' && node.minProperties > 0) return false;
  const types = Array.isArray(node.type) ? node.type : typeof node.type === 'string' ? [node.type] : null;
  if (types && !types.includes('object')) return false;
  if (own(node, 'const') && (!object(node.const) || Object.keys(node.const).length)) return false;
  if (Array.isArray(node.enum) && !node.enum.some(value => object(value) && !Object.keys(value).length)) return false;
  if (own(node, '$ref') && !emptyQueryAllowed(localReference(node.$ref, root), root, next)) return false;
  if (Array.isArray(node.allOf) && !node.allOf.every(child => emptyQueryAllowed(child, root, next))) return false;
  for (const kind of ['anyOf', 'oneOf'])
    if (Array.isArray(node[kind]) && !node[kind].some(child => emptyQueryAllowed(child, root, next))) return false;
  return true;
}

function inputType(operation) {
  const root = operation.offer?.extensions?.bazaar?.schema ?? true;
  const input = propertySchema(root, 'input', root);
  const query = propertySchema(input, 'queryParams', root);
  const body = propertySchema(input, 'body', root);
  const pathNames = [...new Set(operation.pathNames)];
  const state = { root, nodes: 0 };
  const queryRequired = requiredNames(query, root).size > 0 || !emptyQueryAllowed(query, root) ||
    (operation.requiredQuery?.length ?? 0) > 0;
  const fields = [pathNames.length ? `readonly path: { ${pathNames.map(name => `readonly ${quote(name)}: string;`).join(' ')} };` :
    'readonly path?: Readonly<Record<string, never>>;'];
  let queryType = schemaType(query, state, new Set(), true);
  if (operation.requiredQuery?.length) queryType = joinTypes([queryType,
    '{ ' + [...new Set(operation.requiredQuery)].map(name => `readonly ${quote(name)}: QueryValue;`).join(' ') + ' }',
  ], '&', 'QueryParameters');
  fields.push(`readonly query${queryRequired ? '' : '?'}: ${queryType};`);
  const common='{ '+fields.join(' ')+' }';
  if (!['POST','PUT','PATCH'].includes(operation.method)) return common+' & { readonly body?: never; readonly multipart?: never; readonly omitBody?: never; }';
  const form=operation.offer?.extensions?.bazaar?.info?.input?.bodyType==='form-data';
  const present=form?'readonly multipart: { readonly body: Uint8Array; readonly contentType: string }; readonly body?: never;':
    `readonly body: ${schemaType(body,state)}; readonly multipart?: never;`;
  const absent=operation.bodyRequired===false?' | { readonly omitBody: true; readonly body?: never; readonly multipart?: never; }':'';
  return common+' & ({ '+present+' readonly omitBody?: false; }'+absent+')';
}

const contracts = `export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [name: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export type QueryValue = string | readonly string[];
export type QueryParameters = Readonly<Record<string, QueryValue>>;

export interface PaymentRequirement {
  readonly scheme: string;
  readonly network: string;
  readonly asset: string;
  readonly payTo: string;
  readonly amount: string;
  readonly maxTimeoutSeconds: number;
  readonly extra?: JsonObject;
}
export interface PaymentRequired {
  readonly x402Version: 2;
  readonly accepts: readonly PaymentRequirement[];
  readonly resource: JsonObject & { readonly url: string };
  readonly extensions?: JsonObject;
}
export interface BuyerIntent {
  readonly intentId: string;
  readonly url: string;
  readonly method: string;
  readonly scheme: string;
  readonly network: string;
  readonly asset: string;
  readonly payTo: string;
  readonly amount: string;
  readonly maxAtomic: string;
  readonly maxTimeoutSeconds: number;
  readonly acceptedTerms: PaymentRequirement;
  readonly bodyPresent: boolean;
  readonly bodyBytes: number;
  readonly bodySha256: string;
}
export interface SigningRequest {
  readonly intent: BuyerIntent;
  readonly challenge: PaymentRequired;
  readonly accepted: PaymentRequirement;
}
export interface SignedPayment {
  readonly x402Version: 2;
  readonly payload: JsonObject;
  readonly accepted: PaymentRequirement;
  readonly resource: JsonObject & { readonly url: string };
  readonly extensions?: JsonObject;
}
export interface RequestAuthorization {
  /** Canonical unsigned atomic integer; validated by the generated runtime. */
  readonly maxAtomic: string;
  /** Stable, explicit caller intent identifier. */
  readonly intentId: string;
  /** Explicit original option index; required when an operation has several options. */
  readonly acceptIndex?: number;
  /** Defaults to authorization. Upfront must be explicitly permitted. */
  readonly paymentFlow?: 'authorization' | 'upfront';
  readonly approve?: (intent: BuyerIntent) => boolean | PromiseLike<boolean>;
  readonly sign?: (request: SigningRequest) => SignedPayment | PromiseLike<SignedPayment>;
  readonly signal?: AbortSignal;
}
export interface BuyerRequest {
  readonly url: string;
  readonly method: 'GET' | 'HEAD' | 'DELETE' | 'POST' | 'PUT' | 'PATCH';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly expect: {
    readonly scheme: string;
    readonly network: string;
    readonly asset: string;
    readonly payTo: string;
    readonly maxAtomic: string;
    readonly maxTimeoutSeconds: number;
    readonly paymentFlow?: 'authorization' | 'upfront';
  };
  readonly intentId: string;
  readonly approve?: RequestAuthorization['approve'];
  readonly sign?: RequestAuthorization['sign'];
  readonly signal?: AbortSignal;
}
export interface Buyer<TResult = unknown> { call(request: BuyerRequest): TResult; }
export interface SellerClient<TResult = unknown> {
  readonly source: typeof source;
  readonly operations: typeof operations;
  request<Id extends OperationId>(id: Id, inputs: OperationInputs[Id], authorization: OperationAuthorizations[Id]): BuyerRequest;
  call<Id extends OperationId>(id: Id, inputs: OperationInputs[Id], authorization: OperationAuthorizations[Id]): TResult;
}
`;

/** Generate declarations matching the standalone customer module, without inferring response types. */
export function generateClientDeclarations(snapshot) {
  if (!object(snapshot) || snapshot.schema !== 'stellar-forge.seller-client.v1' ||
      !Array.isArray(snapshot.operations) || !snapshot.operations.length)
    throw new TypeError('Original seller client snapshot required');
  const ids = new Set();
  for (const operation of snapshot.operations) {
    if (!object(operation) || typeof operation.id !== 'string' || !operation.id || ids.has(operation.id) ||
        !['GET', 'HEAD', 'DELETE', 'POST', 'PUT', 'PATCH'].includes(operation.method) || typeof operation.path !== 'string' ||
        !Array.isArray(operation.pathNames) || !operation.pathNames.every(name => typeof name === 'string') ||
        (operation.requiredQuery !== undefined && (!Array.isArray(operation.requiredQuery) ||
          !operation.requiredQuery.every(name => typeof name === 'string'))))
      throw new TypeError('Invalid seller client operation');
    ids.add(operation.id);
  }
  const metadata = Object.fromEntries(['schema', 'sourceSha256', 'mode', 'title', 'origin'].map(key => {
    if (typeof snapshot[key] !== 'string') throw new TypeError(`Seller client ${key} required`);
    return [key, snapshot[key]];
  }));
  const inputs = snapshot.operations.map(operation => `  readonly ${quote(operation.id)}: ${inputType(operation)};`).join('\n');
  const authorizations = snapshot.operations.map(operation => {
    const choices = operation.offer.accepts.map((_value, index) => String(index));
    return `  readonly ${quote(operation.id)}: RequestAuthorization & { readonly acceptIndex${choices.length > 1 ? '' : '?'}: ${choices.join(' | ')} };`;
  }).join('\n');
  const descriptors = snapshot.operations.map(operation => '{ ' + [
    `readonly id: ${quote(operation.id)};`, `readonly method: ${quote(operation.method)};`,
    `readonly path: ${quote(operation.path)};`, `readonly pathNames: ${literalType(operation.pathNames)};`,
    'readonly offer: PaymentRequired;', 'readonly requiredQuery?: readonly string[];',
  ].join(' ') + ' }');
  return '// Generated from the original seller offer snapshot. JSON Schema remains authoritative for runtime constraints.\n' +
    '// Buyer results are inferred from the injected buyer; advertised examples do not become response contracts.\n\n' +
    contracts + '\nexport interface OperationInputs {\n' + inputs + '\n}\n' +
    '\nexport interface OperationAuthorizations {\n' + authorizations + '\n}\n' +
    'export type OperationId = keyof OperationInputs;\n' +
    'export type SellerOperation = ' + descriptors.join('\n  | ') + ';\n' +
    `export declare const source: ${literalType(metadata)};\n` +
    'export declare const operations: readonly SellerOperation[];\n' +
    'export declare function buildRequest<Id extends OperationId>(id: Id, inputs: OperationInputs[Id], authorization: OperationAuthorizations[Id]): BuyerRequest;\n' +
    'export declare function createSellerClient<TResult>(options: { readonly buyer: Buyer<TResult> }): SellerClient<TResult>;\n';
}
