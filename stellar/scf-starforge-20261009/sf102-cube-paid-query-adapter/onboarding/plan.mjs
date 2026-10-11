// MIT. Offline composition of original SF102 templates and SF30 merchant offers.
import { compileCubeCatalog, renderCubeQuery } from '../cube-template.mjs';
import { compileUpstreamBindings } from '../../sf30-seller-sdk/upstream.mjs';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../../sf30-seller-sdk/seller.mjs';
import { compileSellerRoutes } from '../../sf30-seller-sdk/resource-server.mjs';
import { compileSellerOpenApi } from '../../sf30-seller-sdk/developer-portal.mjs';
import { bindCubeReport, compileCubeMetadata, plain, own, keys, text, fail } from './metadata.mjs';

export const PLAN_SCHEMA = 'stellar-forge.cube-merchant-plan.v1';
const REPORT_KEYS = ['description', 'query', 'inputs', 'range', 'payment', 'paymentOptions', 'outputExample'];
const UPSTREAM_KEYS = ['origin', 'path', 'authEnv', 'allowLoopback', 'timeoutMs', 'maxResponseBytes', 'maxInFlight', 'maxRows'];
export function compileCubeUpstream(value) {
  keys(value, UPSTREAM_KEYS, 'Cube upstream');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.authEnv ?? '')) fail('authEnv must name the environment variable containing the Cube Authorization header');
  if (own(value, 'allowLoopback') && typeof value.allowLoopback !== 'boolean') fail('allowLoopback must be boolean');
  const config = { schema: 'stellar-forge.cube-paid-query.v1', origin: value.origin,
    path: value.path ?? '/cubejs-api/v1/load', authEnv: value.authEnv,
    timeoutMs: value.timeoutMs ?? 10000, maxResponseBytes: value.maxResponseBytes ?? 262144,
    maxInFlight: value.maxInFlight ?? 8, maxRows: value.maxRows ?? 1000 };
  if (!Number.isSafeInteger(config.maxRows) || config.maxRows < 1 || config.maxRows > 10000) fail('maxRows must be 1–10000');
  if (typeof config.path !== 'string' || config.path.includes(':')) fail('Cube load path must be fixed');
  // Use the native endpoint/limit validators without reading any credential on an offline path.
  compileUpstreamBindings({ schema: 'stellar-forge.seller-upstreams.v1', bindings: {
    cube: { origin: config.origin, path: config.path, method: 'POST', query: [], responseMode: 'json',
      timeoutMs: config.timeoutMs, maxResponseBytes: config.maxResponseBytes, maxInFlight: config.maxInFlight },
  } }, { allowLoopback: value.allowLoopback === true, env: {} });
  return { config, allowLoopback: value.allowLoopback === true };
}

function inputDescription(name, value) {
  text(value.description, `${name} description`, 360);
  const constraint = value.type === 'enum' ? `Allowed values: ${value.values.map(item => JSON.stringify(item)).join(', ')}.` :
    value.type === 'date' ? 'Use a calendar date in YYYY-MM-DD format.' : `Integer from ${value.min} to ${value.max}.`;
  const description = value.description + ' ' + constraint;
  if (description.length > 512) fail(`${name}: public description and input constraints exceed the native 512 character limit`);
  return description;
}

/** All terms and queries originate in the merchant plan; no prices or data are inferred. */
export function compileCubeMerchantPlan(metadata, plan) {
  keys(plan, ['schema', 'serviceName', 'publicOrigin', 'tags', 'upstream', 'payment', 'paymentOptions', 'reports'], 'merchant plan');
  if (plan.schema !== PLAN_SCHEMA || !plain(plan.reports)) fail('Expected cube-merchant-plan.v1 with named reports');
  text(plan.serviceName, 'serviceName', 32);
  if (own(plan, 'payment') && own(plan, 'paymentOptions')) fail('Choose merchant payment or paymentOptions');
  const source = compileCubeMetadata(metadata), upstream = compileCubeUpstream(plan.upstream);
  const adapter = { ...upstream.config, reports: Object.create(null) }, inputsByReport = new Map();
  for (const [id, report] of Object.entries(plan.reports)) {
    keys(report, REPORT_KEYS, `report ${id}`);
    if (!plain(report.inputs)) fail(`${id}: inputs must be an object (use {} for a fixed report)`);
    const inputs = Object.create(null), publicInputs = [];
    for (const [name, spec] of Object.entries(report.inputs)) {
      keys(spec, ['type', 'values', 'min', 'max', 'description', 'example'], `input ${name}`);
      const { description, example, ...native } = spec;
      if (!own(spec, 'example')) fail(`${id}.${name}: an exact example is required`);
      inputs[name] = native;
      publicInputs.push({ name, ...structuredClone(spec) });
    }
    const query = structuredClone(report.query);
    if (!plain(query) || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > Math.min(1000, adapter.maxRows))
      fail(`${id}: set a fixed query.limit from 1 to min(1000, upstream.maxRows)`);
    adapter.reports[id] = { query, inputs, ...(own(report, 'range') ? { range: structuredClone(report.range) } : {}) };
    inputsByReport.set(id, publicInputs);
  }
  const catalog = compileCubeCatalog(adapter), routes = [], reports = [];
  for (const [id, native] of catalog) {
    const report = plan.reports[id], path = '/reports/' + id;
    const members = bindCubeReport(source, native, id);
    const publicInputs = inputsByReport.get(id), queryParams = Object.create(null);
    for (const input of publicInputs) {
      if (input.type === 'integer' ? !Number.isSafeInteger(input.example) : typeof input.example !== 'string')
        fail(`${id}.${input.name}: example must have its declared input type`);
      queryParams[input.name] = String(input.example);
    }
    const sampleUrl = new URL(path, plan.publicOrigin);
    for (const [name, value] of Object.entries(queryParams)) sampleUrl.searchParams.set(name, value);
    const query = renderCubeQuery(catalog, { method: 'GET', url: sampleUrl, query: queryParams });
    const selectedTerms = own(report, 'payment') || own(report, 'paymentOptions') ? report : plan;
    const payment = own(selectedTerms, 'payment') ? { payment: structuredClone(selectedTerms.payment) } :
      { paymentOptions: structuredClone(selectedTerms.paymentOptions) };
    if (own(report, 'payment') && own(report, 'paymentOptions')) fail(`${id}: choose payment or paymentOptions`);
    const definition = { method: 'GET', serviceName: plan.serviceName,
      description: text(report.description, `${id} description`, 2048),
      ...(own(plan, 'tags') ? { tags: structuredClone(plan.tags) } : {}), ...payment,
      queryParameters: publicInputs.map(input => ({ name: input.name, type: input.type === 'integer' ? 'integer' : 'string',
        required: true, description: inputDescription(input.name, input), example: input.example })),
      ...(own(report, 'outputExample') ? { outputExample: structuredClone(report.outputExample) } : {}) };
    const offer = compileHttpSellerOffer({ ...definition, url: new URL(path, plan.publicOrigin).href });
    paymentRequiredResponse(offer); // Refuse offers the original buyer cannot receive.
    routes.push({ id, path, definition, handler: 'cubeReport', admit: 'cubeAdmission' });
    reports.push({ id, path, description: report.description, inputs: publicInputs,
      range: native.range ?? null, query: structuredClone(native.query), renderedExample: query,
      exampleUrl: sampleUrl.href, queryParams, members, paymentOptions: offer.accepts });
  }
  const origin = new URL(plan.publicOrigin);
  if (typeof plan.publicOrigin !== 'string' || plan.publicOrigin !== origin.origin || origin.protocol !== 'https:' ||
      origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
    fail('publicOrigin must be a canonical HTTPS origin');
  const seller = { schema: 'stellar-forge.seller-service.v1', publicOrigin: plan.publicOrigin,
    handlerTimeoutMs: adapter.timeoutMs + 1000, maxResponseBytes: adapter.maxResponseBytes, routes };
  const admission = context => { try { renderCubeQuery(catalog, context); return true; } catch { return { status: 400, body: { error: 'REPORT_INPUT_INVALID' } }; } };
  const compiled = compileSellerRoutes(routes.map(route => ({ id: route.id,
    definition: { ...route.definition, url: plan.publicOrigin + route.path }, admit: admission,
    handler: async () => { throw new Error('Offline package compilation does not execute Cube'); } })));
  const offers = compiled.routes.map(route => structuredClone(route.offer));
  return { adapter, seller, catalog, reports, offers,
    openapi: compileSellerOpenApi(compiled), allowLoopback: upstream.allowLoopback,
    source: { cubeCount: source.cubes.length, memberCount: source.members.size, excludedMembers: source.excludedMembers },
    serviceName: plan.serviceName, publicOrigin: plan.publicOrigin };
}
