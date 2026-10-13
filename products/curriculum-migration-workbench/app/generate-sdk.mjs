// Pure source-bound SDK generation; no network, filesystem or dependency imports.
export function generateSdk(edition) {
  if (!edition || typeof edition !== "object" || typeof edition.id !== "string") throw new Error("An edition with its original id is required.");
  const parse = (v, label) => { const x = typeof v === "string" ? JSON.parse(v) : v; if (!x || typeof x !== "object") throw new Error(label + " must contain the original JSON source."); return x; };
  const surface = parse(edition.surface, "REST surface");
  const bulk = parse(edition.bulkSchema, "Bulk schema");
  const graphql = parse(edition.graphql, "GraphQL inventory");
  if (!surface.paths || typeof surface.server !== "string" || !surface.server.startsWith("/") || surface.server.startsWith("//")) throw new Error("The REST surface must declare paths and a relative server path.");
  const diagnostics = [], seenDiagnostics = new Set();
  const note = (code, path, message) => { const key = code + "\n" + path; if (!seenDiagnostics.has(key)) { seenDiagnostics.add(key); diagnostics.push({ code, path, message }); } };
  const quote = JSON.stringify;
  const safeComment = v => String(v).replace(/\*\//g, "* /").replace(/[\r\n\u2028\u2029]+/g, " ");
  const identifier = v => { const s = String(v).replace(/[^A-Za-z0-9_$]/g, "_"); return /^[A-Za-z_$]/.test(s) ? s : "_" + s; };
  const cap = v => { const s = identifier(v); return s[0].toUpperCase() + s.slice(1); };
  const pointer = (root, ref) => { if (!ref.startsWith("#/")) return undefined; let at = root; try { for (const p of decodeURIComponent(ref.slice(2)).split("/").map(x => x.replace(/~1/g, "/").replace(/~0/g, "~"))) { if (!at || !Object.prototype.hasOwnProperty.call(at, p)) return undefined; at = at[p]; } return at; } catch { return undefined; } };
  const join = (parts, op, empty) => [...new Set(parts)].length ? [...new Set(parts)].map(x => "(" + x + ")").join(" " + op + " ") : empty;
  const declarations = [], usedNames = new Set(["BulkExport", "OakOperations", "OakRedirect", "OakOpaqueRedirect", "OakJsonResponse"]);
  const unique = preferred => { let n = preferred, i = 2; while (usedNames.has(n)) n = preferred + i++; usedNames.add(n); return n; };
  const bulkRefs = new Map(), restRefs = new Map();
  for (const [scope, root, refs] of [["Bulk", bulk, bulkRefs], ["Rest", surface, restRefs]]) {
    for (const section of ["$defs", "definitions"]) for (const name of Object.keys(root[section] || {})) refs.set("#/" + section + "/" + name.replace(/~/g, "~0").replace(/\//g, "~1"), unique(scope + cap(name)));
    for (const name of Object.keys(root.components?.schemas || {})) refs.set("#/components/schemas/" + name.replace(/~/g, "~0").replace(/\//g, "~1"), unique(scope + cap(name)));
  }
  function literal(v) {
    if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number") return quote(v);
    if (Array.isArray(v)) return "[" + v.map(literal).join(", ") + "]";
    if (v && typeof v === "object") return "{ " + Object.entries(v).map(([k,x]) => quote(k) + ": " + literal(x) + ";").join(" ") + " }";
    return "unknown";
  }
  function render(s, root, refs, path, stack = []) {
    if (s === true || s == null) return "unknown";
    if (s === false) return "never";
    if (typeof s !== "object" || Array.isArray(s)) { note("INVALID_SCHEMA", path, "Schema was not an object or boolean; emitted unknown."); return "unknown"; }
    const parts = [];
    if (s.$ref) {
      const ref = s.$ref;
      if (refs.has(ref)) parts.push(refs.get(ref));
      else {
        const resolved = pointer(root, ref);
        if (resolved === undefined) { note("UNRESOLVED_REF", path, "The captured source omits " + ref + "; the type remains unknown."); parts.push("unknown"); }
        else if (stack.includes(ref)) { note("UNNAMED_RECURSIVE_REF", path, "Recursive reference without a declared alias remains unknown: " + ref); parts.push("unknown"); }
        else parts.push(render(resolved, root, refs, ref, [...stack, ref]));
      }
    }
    if (Object.prototype.hasOwnProperty.call(s, "const")) parts.push(literal(s.const));
    if (Array.isArray(s.enum)) parts.push(join(s.enum.map(literal), "|", "never"));
    const supported = new Set(["$schema", "$id", "$ref", "$defs", "definitions", "title", "description", "default", "examples", "example", "deprecated", "readOnly", "writeOnly", "type", "nullable", "const", "enum", "properties", "required", "additionalProperties", "items", "prefixItems", "minItems", "maxItems", "uniqueItems", "oneOf", "anyOf", "allOf", "format", "pattern", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minProperties", "maxProperties"]);
    for (const k of Object.keys(s)) if (!supported.has(k)) note("TYPE_KEYWORD_UNREPRESENTED", path + "/" + k, "The original keyword is retained in inventory; TypeScript does not model it.");
    for (const k of ["format", "pattern", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties"]) if (k in s) note("VALUE_CONSTRAINT", path + "/" + k, "Value constraint retained in the schema; generated static types are not a runtime validator.");
    const typeList = Array.isArray(s.type) ? s.type : s.type ? [s.type] : s.properties || s.additionalProperties !== undefined || s.required ? ["object"] : s.items || s.prefixItems ? ["array"] : [];
    const variants = [];
    for (const type of typeList) {
      if (type === "null") variants.push("null");
      else if (type === "string" || type === "boolean" || type === "number") variants.push(type);
      else if (type === "integer") { variants.push("number"); note("INTEGER_TYPE", path, "TypeScript represents integer values as number; the source retains integer constraints."); }
      else if (type === "array") {
        if (Array.isArray(s.prefixItems) || Array.isArray(s.items)) {
          const prefix = s.prefixItems || s.items;
          const rest = s.prefixItems ? s.items : s.additionalItems;
          const minimum = Number.isInteger(s.minItems) ? s.minItems : 0;
          const tuple = prefix.map((x,i) => render(x,root,refs,path+"/items/"+i,stack) + (i >= minimum ? "?" : ""));
          if (rest !== false) tuple.push("...Array<" + render(rest === undefined ? true : rest,root,refs,path+"/items",stack) + ">");
          variants.push("[" + tuple.join(", ") + "]");
        } else variants.push("Array<" + render(s.items === undefined ? true : s.items,root,refs,path+"/items",stack) + ">");
      } else if (type === "object") {
        const properties = s.properties || {}, required = new Set(Array.isArray(s.required) ? s.required : []);
        const fields = Object.entries(properties).map(([k,v]) => {
          const d = v && typeof v === "object" && v.description ? "/** " + safeComment(v.description) + " */ " : "";
          return d + quote(k) + (required.has(k) ? "" : "?") + ": " + render(v,root,refs,path+"/properties/"+k,stack) + ";";
        });
        for (const k of required) if (!(k in properties)) fields.push(quote(k) + ": unknown;");
        if (s.additionalProperties !== false) {
          const extra = s.additionalProperties && typeof s.additionalProperties === "object" ? render(s.additionalProperties,root,refs,path+"/additionalProperties",stack) : "unknown";
          // Explicit properties must also fit the index signature in TypeScript.
          const known = Object.values(properties).map(v=>render(v,root,refs,path+"/known-property",stack));
          if (Object.keys(properties).some(k=>!required.has(k))) known.push("undefined");
          fields.push("[key: string]: " + join([extra,...known], "|", "unknown") + ";");
          if (extra !== "unknown" && known.length) note("INDEX_SIGNATURE_WIDENED", path, "TypeScript's index signature includes declared property types; source additionalProperties remains exact in inventory.");
        }
        variants.push(fields.length ? "{ " + fields.join(" ") + " }" : "Record<string, never>");
      } else { note("UNKNOWN_TYPE", path, "Unknown schema type " + type); variants.push("unknown"); }
    }
    if (variants.length) parts.push(join(variants,"|","unknown"));
    for (const k of ["allOf","anyOf","oneOf"]) if (Array.isArray(s[k])) parts.push(join(s[k].map((x,i)=>render(x,root,refs,path+"/"+k+"/"+i,stack)),k==="allOf"?"&":"|",k==="allOf"?"unknown":"never"));
    if (s.oneOf) note("ONE_OF_EXCLUSIVITY", path, "Static union models the alternatives; exact oneOf exclusivity stays in the original schema.");
    let value = join(parts.filter(x=>x!=="unknown"),"&","unknown");
    if (s.nullable === true) value = "(" + value + ") | null";
    return value;
  }
  for (const [root,refs] of [[bulk,bulkRefs],[surface,restRefs]]) for (const [ref,name] of refs) declarations.push("/** " + safeComment(ref) + " */\nexport type " + name + " = " + render(pointer(root,ref),root,refs,ref,[ref]) + ";");
  declarations.push("export type BulkExport = " + render(bulk,bulk,bulkRefs,"bulk") + ";");
  const operations = [], runtime = Object.create(null);
  for (const [path, item] of Object.entries(surface.paths)) for (const [method, op] of Object.entries(item)) {
    if (!["get","post","put","patch","delete","head","options"].includes(method)) continue;
    if (!op || typeof op.operationId !== "string" || Object.prototype.hasOwnProperty.call(runtime,op.operationId)) throw new Error("Unique operationId required at " + method + " " + path);
    const params = [...(item.parameters || []), ...(op.parameters || [])], grouped = {path:[],query:[],header:[],cookie:[]};
    const merged = new Map(); for (const param of params) { if (!param || !grouped[param.in] || typeof param.name !== "string") throw new Error("Unsupported parameter at " + path); merged.set(param.in+":"+param.name,param); }
    for (const param of merged.values()) grouped[param.in].push(param);
    if (!path.startsWith("/") || /[?#]/.test(path)) throw new Error("REST paths must be relative API paths without query or fragment.");
    const name = unique(cap(op.operationId));
    const request = [];
    for (const [location, list] of Object.entries(grouped)) if (list.length) {
      request.push(quote(location) + (list.some(p=>p.required || location==="path") ? "" : "?") + ": { " + list.map(p=>quote(p.name)+(p.required||location==="path"?"":"?")+": "+render(p.schema,surface,restRefs,op.operationId+"/"+location+"/"+p.name)+";").join(" ") + " };");
      for (const p of list) if ((location==="query" && p.style && p.style!=="form") || (location==="path" && p.style && p.style!=="simple") || location==="cookie") note("REQUEST_SERIALIZATION_UNSUPPORTED",op.operationId+"/"+location+"/"+p.name,"Generated runtime rejects this serialization rather than guessing.");
    }
    const rawBody = op.requestBody, bodyContent = rawBody?.content || rawBody || null;
    const bodySchema = bodyContent?.["application/json"]?.schema ?? bodyContent?.["application/json"];
    const bodyRequired = rawBody?.required === true;
    if (bodySchema !== undefined) {
      request.push("body" + (bodyRequired?"":"?") + ": " + render(bodySchema,surface,restRefs,op.operationId+"/body") + ";");
      if (rawBody.required === undefined) note("BODY_PRESENCE_UNSPECIFIED",op.operationId,"Captured body schema omits requestBody.required. Body presence is optional; supplied body fields follow their original required list.");
    } else if (rawBody) { note("UNSUPPORTED_BODY_MEDIA",op.operationId,"No application/json request body is captured; generated runtime rejects a supplied body."); }
    const inputName = name+"Request", responseName=name+"Response", errorName=name+"ErrorBody";
    declarations.push("export type "+inputName+" = "+(request.length?"{ "+request.join(" ")+" }":"Record<string, never>")+";");
    const success = [], error = [], responses = [];
    for (const [status, response] of Object.entries(op.responses || {})) {
      const content=response.content || {}, schema=content["application/json"]?.schema ?? content["application/json"];
      const bodyType=schema===undefined?"unknown":render(schema,surface,restRefs,op.operationId+"/responses/"+status);
      const numeric=/^\d{3}$/.test(status)?Number(status):null;
      if (numeric!==null && numeric>=200 && numeric<300) success.push("OakJsonResponse<"+numeric+", "+bodyType+">");
      else if (numeric!==null && numeric>=300 && numeric<400) success.push("OakRedirect<"+numeric+"> | OakOpaqueRedirect");
      else error.push(bodyType);
      responses.push({status,schema:schema??null,mediaTypes:Object.keys(content),kind:numeric>=300&&numeric<400?"redirect":numeric>=200&&numeric<300?"success":"error"});
    }
    declarations.push("export type "+responseName+" = "+join(success,"|","never")+";");
    declarations.push("export type "+errorName+" = "+join(error,"|","unknown")+";");
    const requiredInput = Object.values(grouped).some(a=>a.some(p=>p.required||p.in==="path")) || bodyRequired;
    const metadata={operationId:op.operationId,method:method.toUpperCase(),path,parameters:[...merged.values()],bodyRequired,bodySchema:bodySchema??null,responses:Object.keys(op.responses||{}),security:op.security??surface.security??[],requestBody:rawBody??null};
    runtime[op.operationId]=metadata;
    operations.push({...metadata,requestType:inputName,responseType:responseName,errorBodyType:errorName,requiredInput,tags:op.tags||[],responseSchemas:responses});
  }
  const sourceTypes=graphql.data?.__schema?.types || graphql.__schema?.types || [];
  if (!Array.isArray(sourceTypes)) throw new Error("GraphQL type inventory is invalid.");
  const relationLike=sourceTypes.filter(x=>typeof x.description==="string" && /^columns and relationships of /.test(x.description)).map(x=>({name:x.name,description:x.description,fieldsPublished:Array.isArray(x.fields),fields:Array.isArray(x.fields)?x.fields:null}));
  const constants=[];
  for (const m of String(edition.owaSource || "").matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"\r\n]*)\2\s*;/g)) constants.push({name:m[1],value:m[3]});
  note("GRAPHQL_INVENTORY_ONLY","graphql","The source records type names and descriptions. Relation-like descriptions do not establish database tables, fields, keys, nullability, permissions or migration DDL.");
  note("RESPONSES_ARE_STATIC_TYPES","rest","JSON results are parsed but not runtime-schema-validated. Retain inventory.json schemas for the workbench's explicit validation; absent error definitions remain unknown.");
  const inventory = {schema:"oak.generated-sdk-inventory.v1",editionId:edition.id,provenance:edition.provenance||null,rest:{server:surface.server,securitySchemes:surface.securitySchemes||{},operations,originalSurface:surface},bulk:{definitionNames:[...bulkRefs.values()],schema:bulk},graphql:{mode:sourceTypes.every(x=>!Object.prototype.hasOwnProperty.call(x,"fields"))?"names-and-descriptions-only":"partial-introspection",typeCount:sourceTypes.length,types:sourceTypes,relationLike,publishedRelationLikeCount:relationLike.filter(x=>x.name.startsWith("published_")).length,limitations:["No SQL schema or DDL generated.","No GraphQL query fields or permissions inferred."]},owa:{constants,sourceKind:"captured TypeScript declarations",runtimeSecretValuesIncluded:false},diagnostics};
  const types = "// Generated from the selected source edition. Do not edit by hand.\n// Values remain subject to the original schemas in inventory.json.\n\n"+
    "export interface OakJsonResponse<S extends number, T> { kind: 'json'; status: S; data: T; headers: Headers; url: string; }\n"+
    "export interface OakRedirect<S extends number = number> { kind: 'redirect'; status: S; location: string | null; headers: Headers; url: string; }\n"+
    "export interface OakOpaqueRedirect { kind: 'opaque-redirect'; status: 0; location: null; headers: Headers; url: string; }\n\n"+
    declarations.join("\n\n")+"\n\nexport interface OakOperations {\n"+operations.map(o=>quote(o.operationId)+": { request: "+o.requestType+"; response: "+o.responseType+"; errorBody: "+o.errorBodyType+" };").join("\n")+"\n}\n";
  const requestReferences = Object.create(null);
  function collectRequestRefs(schema, seen = new Set()) {
    if (!schema || typeof schema !== "object") return;
    if (typeof schema.$ref === "string" && !seen.has(schema.$ref)) {
      seen.add(schema.$ref);
      const target = pointer(surface, schema.$ref);
      if (target !== undefined) { requestReferences[schema.$ref] = target; collectRequestRefs(target, seen); }
    }
    for (const [key, value] of Object.entries(schema)) if (key !== "$ref") {
      if (Array.isArray(value)) value.forEach(v=>collectRequestRefs(v,seen));
      else if (value && typeof value === "object") collectRequestRefs(value,seen);
    }
  }
  for (const op of Object.values(runtime)) { for (const p of op.parameters) collectRequestRefs(p.schema); collectRequestRefs(op.bodySchema); }
  const clientHead="import type * as T from './types.js';\nexport type * from './types.js';\n\nexport const SOURCE_EDITION = "+quote(edition.id)+" as const;\nexport const SOURCE_PROVENANCE = "+JSON.stringify(edition.provenance||null,null,2)+" as const;\nexport const SERVER_PATH = "+quote(surface.server)+" as const;\nconst OPERATIONS: Record<string, Operation> = "+JSON.stringify(runtime,null,2)+";\nconst REQUEST_REFERENCES: Record<string, any> = "+JSON.stringify(requestReferences,null,2)+";\n";
  const clientRuntime=String.raw`
type Schema = boolean | { [key: string]: unknown };
type Parameter = { name: string; in: string; required?: boolean; schema?: any; style?: string; explode?: boolean; allowReserved?: boolean };
type Operation = { operationId: string; method: string; path: string; parameters: Parameter[]; bodyRequired: boolean; bodySchema: any; responses: string[]; security: unknown[]; requestBody: unknown };
export interface OakClientOptions {
  /** Absolute API base URL including the selected server path, e.g. https://your-host/api/v1. */
  baseUrl: string;
  token?: string | (() => string | Promise<string>);
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit;
}
export interface OakRequestOptions { signal?: AbortSignal; headers?: HeadersInit; }
export class OakApiError extends Error {
  readonly name = 'OakApiError';
  constructor(readonly operationId: string, readonly status: number, readonly body: unknown, readonly rawBody: string, readonly headers: Headers, readonly url: string) {
    super(operationId + ' returned HTTP ' + status);
  }
}
export class OakProtocolError extends Error {
  readonly name = 'OakProtocolError';
  constructor(message: string, readonly operationId: string, readonly status: number, readonly rawBody: string) { super(message); }
}
function scalar(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value === null) return 'null';
  throw new TypeError('A parameter must be a finite number, string, boolean or declared nullable value.');
}
function check(value: unknown, schema: any, path: string): void {
  if (schema === true || schema === undefined || schema === null) return;
  if (schema === false) throw new TypeError(path + ' is disallowed by the source schema.');
  if (schema.$ref) {
    if (!Object.prototype.hasOwnProperty.call(REQUEST_REFERENCES,schema.$ref)) throw new TypeError(path + ' has an unresolved source reference: ' + schema.$ref);
    check(value,REQUEST_REFERENCES[schema.$ref],path);
  }
  if (Object.prototype.hasOwnProperty.call(schema,'const') && JSON.stringify(value) !== JSON.stringify(schema.const)) throw new TypeError(path + ' does not equal its declared constant.');
  if (value === null && schema.nullable) return;
  if (schema.enum && !schema.enum.some((x: unknown) => JSON.stringify(x) === JSON.stringify(value))) throw new TypeError(path + ' is outside its declared enum.');
  const types: string[] = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some(t => t === 'null' ? value === null : t === 'array' ? Array.isArray(value) : t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : t === 'integer' ? typeof value === 'number' && Number.isInteger(value) : t === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === t)) throw new TypeError(path + ' has an invalid type.');
  for (const key of ['allOf', 'anyOf', 'oneOf']) if (schema[key]) {
    const matches = schema[key].filter((s: unknown) => { try { check(value,s,path); return true; } catch { return false; } }).length;
    if ((key === 'allOf' && matches !== schema[key].length) || (key === 'anyOf' && !matches) || (key === 'oneOf' && matches !== 1)) throw new TypeError(path + ' does not satisfy ' + key);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) throw new TypeError(path + ' has an invalid array length.');
    if (schema.items !== undefined) value.forEach((x,i) => check(x,schema.items,path + '[' + i + ']'));
  } else if (value !== null && typeof value === 'object') {
    const v = value as Record<string, unknown>, props = schema.properties || {};
    for (const key of schema.required || []) if (!Object.prototype.hasOwnProperty.call(v,key) || v[key] === undefined) throw new TypeError(path + '.' + key + ' is required.');
    for (const [key,x] of Object.entries(v)) if (x !== undefined) {
      if (Object.prototype.hasOwnProperty.call(props,key)) check(x,props[key],path + '.' + key);
      else if (schema.additionalProperties === false) throw new TypeError(path + '.' + key + ' is not declared.');
      else if (typeof schema.additionalProperties === 'object') check(x,schema.additionalProperties,path + '.' + key);
    }
  }
}
export class OakClient {
  private readonly base: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly options: OakClientOptions;
  constructor(options: OakClientOptions) {
    const base = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new TypeError('baseUrl must be an HTTP(S) API base without credentials, query or fragment.');
    this.base = base.href.replace(/\/+$/, '');
    this.options = options;
    this.fetcher = options.fetch || globalThis.fetch;
    if (typeof this.fetcher !== 'function') throw new TypeError('Provide a Fetch-compatible implementation.');
  }
  /** One original request. No retries, automatic pagination, payments or redirect following. */
  async request<K extends keyof T.OakOperations>(operationId: K, input: T.OakOperations[K]['request'], options: OakRequestOptions = {}): Promise<T.OakOperations[K]['response']> {
    const operation = Object.prototype.hasOwnProperty.call(OPERATIONS,operationId) ? OPERATIONS[operationId] : undefined;
    if (!operation) throw new TypeError('Unknown captured operation: ' + String(operationId));
    const args = (input || {}) as Record<string, any>;
    for (const key of Object.keys(args)) if (!['path','query','header','cookie','body'].includes(key)) throw new TypeError('Unknown request input: ' + key);
    let path = operation.path;
    const query = new URLSearchParams(), headers = new Headers(this.options.headers);
    new Headers(options.headers).forEach((v,k) => headers.set(k,v));
    headers.set('Accept','application/json');
    for (const group of ['path','query','header','cookie']) {
      const supplied = args[group] || {};
      for (const key of Object.keys(supplied)) if (!operation.parameters.some(p=>p.in===group && p.name===key)) throw new TypeError('Unknown ' + group + ' parameter: ' + key);
    }
    for (const p of operation.parameters) {
      const value = args[p.in]?.[p.name];
      if (value === undefined) { if (p.required || p.in === 'path') throw new TypeError(p.in + '.' + p.name + ' is required.'); continue; }
      check(value,p.schema,p.in + '.' + p.name);
      if (p.in === 'path') {
        if (p.style && p.style !== 'simple') throw new TypeError('Unsupported path style: ' + p.style);
        const segments = Array.isArray(value) ? value.map(scalar) : [scalar(value)];
        if (segments.some(x=>x === '.' || x === '..')) throw new TypeError('Dot path segments cannot be represented faithfully by Fetch.');
        const encoded = segments.map(x=>encodeURIComponent(x)).join(',');
        path = path.split('{' + p.name + '}').join(encoded);
      } else if (p.in === 'query') {
        if (p.style && p.style !== 'form' || p.allowReserved) throw new TypeError('Unsupported query serialization.');
        if (Array.isArray(value)) {
          if (p.explode === false) query.append(p.name,value.map(scalar).join(','));
          else value.forEach(x=>query.append(p.name,scalar(x)));
        } else query.append(p.name,scalar(value));
      } else if (p.in === 'header') headers.set(p.name,Array.isArray(value) ? value.map(scalar).join(',') : scalar(value));
      else throw new TypeError('Cookie parameters require an explicitly supported host transport.');
    }
    if (/\{[^}]+\}/.test(path)) throw new TypeError('A source path parameter is missing.');
    const token = typeof this.options.token === 'function' ? await this.options.token() : this.options.token;
    if (token !== undefined) { if (!token || /[\r\n]/.test(token)) throw new TypeError('Invalid bearer token.'); headers.set('Authorization','Bearer ' + token); }
    let body: string | undefined;
    if (args.body !== undefined) {
      if (operation.bodySchema === null) throw new TypeError('This operation has no captured JSON request body.');
      check(args.body,operation.bodySchema,'body');
      body=JSON.stringify(args.body); headers.set('Content-Type','application/json');
    } else if (operation.bodyRequired) throw new TypeError('body is required.');
    const url=this.base + path + (query.size ? '?' + query.toString() : '');
    const response=await this.fetcher(url,{method:operation.method,headers,body,signal:options.signal,redirect:'manual',credentials:'omit'});
    const hasRedirect=operation.responses.some(s=>/^3\d\d$/.test(s));
    if (response.type === 'opaqueredirect' && hasRedirect) return {kind:'opaque-redirect',status:0,location:null,headers:response.headers,url:response.url || url} as T.OakOperations[K]['response'];
    if (response.status >= 300 && response.status < 400 && operation.responses.includes(String(response.status))) return {kind:'redirect',status:response.status,location:response.headers.get('location'),headers:response.headers,url:response.url || url} as T.OakOperations[K]['response'];
    const raw=await response.text();
    let data: unknown=raw;
    if (raw) { try { data=JSON.parse(raw); } catch { if (response.ok && operation.responses.includes(String(response.status))) throw new OakProtocolError('Expected the captured JSON response.',operationId,response.status,raw); } }
    else data=undefined;
    if (!response.ok || !operation.responses.includes(String(response.status))) throw new OakApiError(operationId,response.status,data,raw,response.headers,response.url || url);
    if (!raw) throw new OakProtocolError('Expected a JSON response body.',operationId,response.status,raw);
    return {kind:'json',status:response.status,data,headers:response.headers,url:response.url || url} as T.OakOperations[K]['response'];
  }
`;
  const methods=operations.map(o=>"  "+quote(o.operationId)+"(input: T."+o.requestType+(o.requiredInput?"":" = {}")+", options: OakRequestOptions = {}): Promise<T."+o.responseType+"> { return this.request("+quote(o.operationId)+", input, options); }").join("\n");
  const client=clientHead+clientRuntime+methods+"\n}\n";
  const files=[{path:"client.ts",content:client},{path:"types.ts",content:types},{path:"inventory.json",content:JSON.stringify(inventory,null,2)+"\n"}];
  return {files,client,types,inventory,diagnostics};
}
