// MIT. Public request examples and original SF96 cases for a merchant package.
import { createOpenApiResolver } from '../importer.mjs';
import { planProbes } from '../../sf96-seller-acceptance/audit.mjs';
import { createLiveRequestAdmission } from '../../sf89-live-request-admission/index.mjs';
import { requiresJsonBody } from '../../sf30-seller-sdk/http-methods.mjs';
import { openApiRequestBody } from '../request-body.mjs';
import { validateQueryParameter, queryFromSearchParams } from '../../sf30-seller-sdk/query-parameters.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const fail = message => { throw new TypeError(message); };

/** Annotate the explicit public facade; source assertions and source bytes stay intact. */
export function preparePublicOperation(document, item, operation, row, method) {
  const refs = createOpenApiResolver(document), result = structuredClone(operation);
  const description = row.publicDescription ?? operation.summary ?? operation.description;
  if (description !== undefined) {
    if (typeof description !== 'string') fail('Public description must be text');
    result.description = description.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();
  }
  if (row.requestExample === undefined && row.querySerialization === undefined) return result;
  const sample = row.requestExample ?? {};
  const serialization = row.querySerialization ?? {};
  if (!plain(serialization) || Object.keys(serialization).length > 128) fail('Query serialization must name declared parameters');
  const usedSerialization = new Set();
  if (!plain(sample) || Object.keys(sample).some(key => !['pathParams','query','body'].includes(key)))
    fail('Request example uses only pathParams, query and body');
  if (Buffer.byteLength(JSON.stringify(sample)) > 8192) fail('Request example must be at most 8 KiB');
  for (const key of ['pathParams','query']) if (own(sample, key) && !plain(sample[key]))
    fail(key + ' examples must be an object');
  if (own(sample, 'body') && !requiresJsonBody(method)) fail(method + ' request examples cannot have a body');
  const merged = new Map(), used = { path: new Set(), query: new Set() };
  for (const list of [item.parameters ?? [], operation.parameters ?? []]) {
    if (!Array.isArray(list)) fail('OpenAPI parameters must be an array');
    const seen = new Set();
    for (const raw of list) {
      const parameter = structuredClone(refs.reference(raw));
      const key = parameter.in + ':' + parameter.name;
      if (seen.has(key)) fail('Duplicate OpenAPI parameter: ' + key);
      seen.add(key); merged.set(key, parameter);
    }
  }
  for (const parameter of merged.values()) {
    if (parameter.in === 'query' && own(serialization, parameter.name)) {
      const rule = serialization[parameter.name];
      if (!plain(rule) || Object.keys(rule).some(key => !['style','explode'].includes(key)) ||
          rule.style !== 'form' || typeof rule.explode !== 'boolean')
        fail('A reviewed query serialization requires form style and boolean explode');
      parameter.style = rule.style; parameter.explode = rule.explode;
      usedSerialization.add(parameter.name);
    }
    const values = parameter.in === 'path' ? sample.pathParams : parameter.in === 'query' ? sample.query : undefined;
    if (values && own(values, parameter.name)) {
      const value = values[parameter.name];
      if (parameter.in === 'query') validateQueryParameter(refs.schema(parameter.schema), value, parameter.name);
      else if (!['string','number','boolean'].includes(typeof value)) fail('Path examples must be scalar');
      parameter.example = structuredClone(value); delete parameter.examples;
      used[parameter.in].add(parameter.name);
    }
  }
  for (const [location, values] of [['path', sample.pathParams], ['query', sample.query]])
    if (values && Object.keys(values).some(name => !used[location].has(name))) fail('Request example contains an undeclared ' + location + ' parameter');
  if (Object.keys(serialization).some(name => !usedSerialization.has(name))) fail('Query serialization contains an undeclared query parameter');
  if (merged.size) result.parameters = [...merged.values()];
  if (own(sample, 'body')) {
    const body = structuredClone(refs.reference(operation.requestBody));
    const declaration=openApiRequestBody(operation,refs);
    if (!declaration) fail('Request body example needs an original body declaration');
    body.content[declaration.mediaType].example = structuredClone(sample.body);
    delete body.content[declaration.mediaType].examples;
    result.requestBody = body;
  }
  return result;
}

/** Reuse the original planner and schema admission; this function sends no request. */
export function createMerchantCases(imported, service, plan) {
  const cases = { schema: 'scf.sf96.operator-cases.v1', routes: Object.create(null) };
  const routes = imported.offers.map((offer, index) => {
    const config = service.routes[index], row = plan.operations[index];
    const route = { id: config.id, method: offer.method, advertisedUrl: offer.seller.resource.url,
      template: offer.seller.extensions.bazaar.routeTemplate ?? null, offer: offer.seller };
    if (row.requestExample !== undefined && offer.seller.extensions.bazaar.info.input.bodyType!=='form-data') {
      const request = row.requestExample, example = { path: new URL(route.advertisedUrl).pathname,
        query: structuredClone(request.query ?? offer.seller.extensions.bazaar.info.input.queryParams ?? {}) };
      if (own(request, 'body')) example.body = structuredClone(request.body);
      if (offer.method === 'POST') example.allowPost = true;
      else if (['PUT','PATCH','DELETE'].includes(offer.method)) example.allowMethod = offer.method;
      cases.routes[config.id] = example;
    }
    return route;
  });
  const planned = planProbes(routes, cases.routes);
  const review = planned.map((request, index) => {
    if (request.skip) return { id: request.route.id, method: request.route.method,
      state:request.skip==='MULTIPART_REQUIRES_PRIVATE_FILE_REQUEST'?'PRIVATE_FILE_REQUEST':'NEEDS_EXAMPLE',reason: request.skip };
    const offer = request.route.offer, url = new URL(request.path, 'http://127.0.0.1');
    const query = queryFromSearchParams(url.searchParams);
    const context = { method: request.route.method, url, query,
      pathParams: structuredClone(offer.extensions.bazaar.info.input.pathParams ?? {}),
      ...(request.body !== undefined ? { body: JSON.parse(request.body) } : {}) };
    const decision = createLiveRequestAdmission(offer)(context);
    if (decision !== true) fail(request.route.method + ' ' + plan.operations[index].path + ': request example violates the original input schema (' +
      [decision.body.error, ...(decision.body.issues ?? [])].join('; ') + ')');
    return { id: request.route.id, method: request.route.method, state: 'READY', path: request.path };
  });
  if (Buffer.byteLength(JSON.stringify(cases)) > 65536) fail('Combined route-check cases exceed the original 64 KiB limit');
  return { cases, review };
}
