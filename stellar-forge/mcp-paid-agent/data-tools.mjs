/** MIT. Adapt original prepared SF30 query routes to native paid MCP tools. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireValue = (value, code) => { if (!value) throw Object.assign(new TypeError(code), {code}); };
const equalNames = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const copy = value => structuredClone(value);

function sourceResult(response, query) {
  requireValue(object(response) && Number.isInteger(response.status) && object(response.body),
    'DATA_MCP_SOURCE_RESPONSE_INVALID');
  const failed = response.status < 200 || response.status >= 300;
  const body = copy(response.body);
  // Include the complete original body once. Duplicating a large table in text
  // and structuredContent could exceed the buyer's native transport limit.
  const text = failed ? JSON.stringify(body) :
    `${query}: ${body.rowCount} rows${body.truncated === true ? ' (truncated at the configured source limit)' : ''}. ` +
    'Complete original data and encodings are in structuredContent.';
  return {content:[{type:'text', text}], structuredContent:body,
    ...(failed ? {isError:true} : {}), _meta:{'stellar-forge/source-status':response.status}};
}

/**
 * Compile the ORIGINAL prepared source description, service and bindings without
 * opening a source or signer. Preparation and runtime share the same selection
 * checks; no substitute route or handler is created for offline review.
 */
export function compileDataToolDeclarations({description, serviceConfig, bindings, selections} = {}) {
  requireValue(object(description) && Array.isArray(serviceConfig?.routes) && object(bindings) && Array.isArray(selections) &&
    selections.length > 0 && selections.length <= 32, 'DATA_MCP_BINDINGS_REQUIRED');
  const queries = description.schema === 'stellar-forge.duckdb-description.v1' ? description.queries : description;
  requireValue(object(queries), 'DATA_MCP_SOURCE_DESCRIPTION_INVALID');
  const names = new Set(), selectedRoutes = new Set();
  return selections.map(selection => {
    requireValue(object(selection) && Object.keys(selection).every(key => ['routeId','name','accepts'].includes(key)) &&
      typeof selection.routeId === 'string' && !selectedRoutes.has(selection.routeId), 'DATA_MCP_SELECTION_INVALID');
    const route = serviceConfig.routes.find(item => item.id === selection.routeId);
    const binding = bindings[selection.routeId];
    requireValue(object(route) && typeof route.handler === 'string' && object(route.offer) &&
      !['response','responseFile','responseAsset'].some(key => Object.hasOwn(route, key)) &&
      object(binding) && typeof binding.query === 'string' && Object.hasOwn(queries, binding.query),
      'DATA_MCP_PREPARED_ROUTE_REQUIRED');
    const input = binding.input ?? 'query';
    requireValue(['query','body'].includes(input), 'DATA_MCP_INPUT_BINDING_INVALID');
    const declaration = route.offer.extensions?.bazaar;
    const wireInput = declaration?.info?.input;
    requireValue(wireInput?.type === 'http' && (input === 'query' ? wireInput.method === 'GET' :
      ['POST','PUT','PATCH'].includes(wireInput.method)), 'DATA_MCP_PREPARED_METHOD_INVALID');
    const key = input === 'query' ? 'queryParams' : 'body';
    const inputSchema = declaration?.schema?.properties?.input?.properties?.[key];
    const parameters = queries[binding.query].parameters;
    requireValue(object(inputSchema) && inputSchema.type === 'object' && object(inputSchema.properties) &&
      inputSchema.additionalProperties === false && object(parameters) &&
      equalNames(Object.keys(inputSchema.properties), Object.keys(parameters)) &&
      Array.isArray(inputSchema.required ?? []) && equalNames(inputSchema.required ?? [],
        Object.keys(parameters).filter(name => !Object.hasOwn(parameters[name], 'default'))),
      'DATA_MCP_PREPARED_PARAMETERS_MISMATCH');
    const name = selection.name ?? route.id;
    requireValue(typeof name === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(name) && !names.has(name),
      'DATA_MCP_TOOL_NAME_INVALID');
    const accepts = selection.accepts ?? route.offer.accepts;
    requireValue(Array.isArray(accepts) && accepts.length > 0, 'DATA_MCP_NATIVE_TERMS_REQUIRED');
    names.add(name); selectedRoutes.add(selection.routeId);
    const example = wireInput[key];
    return {routeId:selection.routeId, query:binding.query, name,
      description:route.offer.resource.description, accepts:copy(accepts), inputSchema:copy(inputSchema),
      ...(example === undefined ? {} : {example:copy(example)}),
      annotations:{readOnlyHint:true, destructiveHint:false, idempotentHint:false, openWorldHint:false}};
  });
}

/** Bind original callbacks after the same preparation compiler accepts them. */
export function createDataSourceTools({source, serviceConfig, bindings, selections} = {}) {
  requireValue(typeof source?.route === 'function' && typeof source?.describe === 'function',
    'DATA_MCP_BINDINGS_REQUIRED');
  const declarations = compileDataToolDeclarations({description:source.describe(), serviceConfig, bindings, selections});
  return declarations.map(({routeId, query, ...tool}) => {
    // All providers already expose this body route. Its original binder supplies
    // defaults, exact values, null/enum semantics, unknown-field checks and limits.
    const original = source.route(query, {input:'body'});
    requireValue(typeof original.admit === 'function' && typeof original.handler === 'function',
      'DATA_MCP_SOURCE_ROUTE_INVALID');
    const context = (args, extra) => ({method:'POST', body:args, signal:extra.signal});
    return {...tool,
      async admit(args, extra) {
        try {
          const response = await original.admit(context(args, extra));
          return response === true ? true : sourceResult(response, query);
        } catch (issue) {
          if (!['SOURCE_CLOSED','SOURCE_BUSY'].includes(issue?.code)) throw issue;
          return sourceResult({status:issue.code === 'SOURCE_BUSY' ? 429 : 503, body:{error:issue.code}}, query);
        }
      },
      async handler(args, extra) { return sourceResult(await original.handler(context(args, extra)), query); }};
  });
}

/** Drain the original paid wrappers before closing their original data source. */
export async function startDataToolServer({source, serviceConfig, bindings, selections, ...serverOptions} = {}) {
  requireValue(typeof source?.close === 'function', 'DATA_MCP_SOURCE_CLOSE_REQUIRED');
  try {
    const tools = createDataSourceTools({source, serviceConfig, bindings, selections});
    const {startNativePaidToolServer} = await import('./paid-tool-server.mjs');
    const server = await startNativePaidToolServer({...serverOptions, tools});
    let closing;
    return Object.freeze({...server,
      sourceStatus:() => copy(source.status?.() ?? source.stats?.() ?? {state:'OPEN'}),
      close:() => closing ??= server.close().finally(() => source.close())});
  } catch (issue) { await source.close(); throw issue; }
}
