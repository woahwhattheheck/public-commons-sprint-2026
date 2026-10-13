// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const SCHEMA = 'gravitee.commissioning.v1';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const copy = value => JSON.parse(JSON.stringify(value));
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const hashJSON = value => sha256(JSON.stringify(canonical(value)));
export function requireValue(value, code, message, status = 400) { if (!value) throw Object.assign(new Error(message ?? code), { code, status }); }
export function text(value, name, maximum = 4096) { requireValue(typeof value === 'string' && value.length > 0 && value.length <= maximum && !value.includes('\0'), 'INVALID_' + name.toUpperCase(), name + ' must be a nonempty string.'); return value; }
export function opaqueId(value, name = 'identifier') { text(value, name, 512); requireValue(value !== '.' && value !== '..', 'INVALID_IDENTIFIER'); return value; }
export function publicError(error) { return { code: error.code ?? 'OPERATION_FAILED', message: String(error.message ?? error), status: error.status ?? null, outcomeUnknown: error.outcomeUnknown === true }; }
export async function readContract(specification) {
  const bundled = JSON.parse(await readFile(new URL('./contracts/apim-4.12.21.json', import.meta.url), 'utf8'));
  if (!specification) return bundled;
  requireValue(object(specification) && specification.openapi?.startsWith('3.') && object(specification.paths), 'MANAGEMENT_OPENAPI_REQUIRED', 'Select the installed Management API v2 OpenAPI JSON.');
  const resolve = value => value?.$ref?.startsWith('#/') ? value.$ref.slice(2).split('/').reduce((v, k) => v?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], specification) : value;
  const operations = {};
  for (const [path, resource] of Object.entries(specification.paths)) for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const operation = resource[method];
    if (!operation || !Object.hasOwn(bundled.operations,operation.operationId)) continue;
    requireValue(path.startsWith('/environments/{envId}/'), 'MANAGEMENT_ENVIRONMENT_PATH_REQUIRED');
    const parameters = [...(resource.parameters ?? []), ...(operation.parameters ?? [])].map(resolve);
    const body = resolve(operation.requestBody);
    operations[operation.operationId] = {
      method: method.toUpperCase(), path, summary: operation.summary ?? operation.operationId,
      successStatuses: Object.keys(operation.responses ?? {}).filter(v => /^2\d\d$/.test(v)).map(Number),
      schemaRef: body?.content?.['application/json']?.schema?.$ref ?? null,
      requestBodyRequired: body?.required === true,
      queryParameters: parameters.filter(p => p?.in === 'query').map(p => p.name),
    };
  }
  requireValue(operations.getApi && operations.listApis && operations.createApi, 'MANAGEMENT_V4_OPERATIONS_REQUIRED');
  return { schema: bundled.schema, release: 'installed:' + (specification.info?.version ?? 'unspecified'),
    source: 'Operator-selected Management API specification', sourceSha256: hashJSON(specification),
    basePath: '/management/v2', organizationPath: '/organizations/{orgId}', operations };
}
function envName(value, label) {
  text(value, label, 128);
  requireValue(/^[A-Za-z_][A-Za-z0-9_]*$/.test(value), 'INVALID_CREDENTIAL_VARIABLE', label + ' must name an environment variable.');
  return value;
}
export function normalizeConnection(input) {
  requireValue(object(input), 'CONNECTION_REQUIRED');
  const url = new URL(text(input.managementUrl, 'managementUrl'));
  requireValue(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash,
    'MANAGEMENT_URL_INVALID', 'Use the Management API v2 base URL without credentials, query or fragment.');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  requireValue(url.protocol === 'https:' || loopback || input.allowHttp === true,
    'MANAGEMENT_TLS_REQUIRED', 'Use HTTPS, or explicitly configure HTTP for the intended private deployment.');
  url.pathname = url.pathname.replace(/\/+$/, '');
  requireValue(url.pathname.endsWith('/management/v2'), 'MANAGEMENT_V2_BASE_REQUIRED', 'The base URL must end in /management/v2; organisation and environment are separate.');
  const auth = input.auth ?? { type: 'bearer', tokenEnv: 'GRAVITEE_MANAGEMENT_TOKEN' };
  requireValue(['bearer', 'basic'].includes(auth.type), 'AUTHENTICATION_TYPE_INVALID');
  const safeAuth = auth.type === 'bearer'
    ? { type: 'bearer', tokenEnv: envName(auth.tokenEnv, 'tokenEnv') }
    : { type: 'basic', usernameEnv: envName(auth.usernameEnv, 'usernameEnv'), passwordEnv: envName(auth.passwordEnv, 'passwordEnv') };
  const gatewayUrls = (input.gatewayUrls ?? []).map(value => {
    const gateway = new URL(text(value, 'gatewayUrl'));
    requireValue(['http:', 'https:'].includes(gateway.protocol) && !gateway.username && !gateway.password && !gateway.hash && !gateway.search, 'GATEWAY_URL_INVALID');
    return gateway.href.replace(/\/+$/, '');
  });
  const connection = { label: text(input.label ?? url.host, 'label', 256), managementUrl: url.href.replace(/\/+$/, ''),
    organizationId: opaqueId(input.organizationId ?? 'DEFAULT', 'organizationId'),
    environmentId: opaqueId(input.environmentId ?? 'DEFAULT', 'environmentId'),
    auth: safeAuth, allowHttp: input.allowHttp === true, gatewayUrls,
    contract: input.contract ?? null, requestTimeoutMs: input.requestTimeoutMs ?? 120000,
    maximumResponseBytes: input.maximumResponseBytes ?? 128 * 1024 * 1024 };
  requireValue(Number.isSafeInteger(connection.requestTimeoutMs) && connection.requestTimeoutMs >= 1000 && connection.requestTimeoutMs <= 900000, 'REQUEST_TIMEOUT_INVALID');
  requireValue(Number.isSafeInteger(connection.maximumResponseBytes) && connection.maximumResponseBytes >= 1024 && connection.maximumResponseBytes <= 128 * 1024 * 1024, 'RESPONSE_LIMIT_INVALID');
  return { ...connection, id: hashJSON(connection).slice(0, 24) };
}
export function credential(connection, environment = process.env) {
  if (connection.auth.type === 'bearer') return 'Bearer ' + text(environment[connection.auth.tokenEnv], 'configured management token', 65536);
  return 'Basic ' + Buffer.from(text(environment[connection.auth.usernameEnv], 'configured username', 65536) + ':' + text(environment[connection.auth.passwordEnv], 'configured password', 65536)).toString('base64');
}
export function validateNativeBody(operationId, body) {
  if (body === undefined || body === null) return;
  requireValue(object(body), 'NATIVE_BODY_OBJECT_REQUIRED');
  const api = operationId.includes('WithDefinition') || operationId === 'createApiWithImportDefinition' ? body.api : body;
  if (['createApi', 'updateApi', 'createApiWithImportDefinition', 'updateApiWithDefinition'].includes(operationId)) {
    requireValue(object(api) && api.definitionVersion === 'V4' && api.type === 'PROXY', 'HTTP_PROXY_V4_REQUIRED', 'This commissioning application operates native v4 HTTP proxy APIs.');
    for (const key of ['name', 'apiVersion']) text(api[key], key, 4096);
    requireValue(Array.isArray(api.listeners) && api.listeners.length && api.listeners.every(x => x.type === 'HTTP'), 'HTTP_LISTENERS_REQUIRED');
    requireValue(Array.isArray(api.endpointGroups) && api.endpointGroups.length, 'ENDPOINT_GROUPS_REQUIRED');
  }
  if (['createApiPlan', 'updateApiPlan'].includes(operationId)) requireValue(body.definitionVersion === 'V4', 'V4_PLAN_REQUIRED');
  if (operationId === 'createApiDeployment' && body.deploymentLabel !== undefined) requireValue(typeof body.deploymentLabel === 'string' && body.deploymentLabel.length <= 32, 'DEPLOYMENT_LABEL_TOO_LONG');
  if (operationId === 'rollbackApi') opaqueId(body.eventId, 'eventId');
  if (operationId === 'createApiFromSwagger') text(body.payload, 'payload', 128 * 1024 * 1024);
}
export function planRequest(connection, contract, operationId, input = {}) {
  const operation = Object.hasOwn(contract.operations,operationId) ? contract.operations[operationId] : null;
  requireValue(operation, 'OPERATION_NOT_IN_SELECTED_CONTRACT', operationId + ' is absent from the selected Management API contract.');
  const parameters = { ...input, envId: connection.environmentId, orgId: connection.organizationId };
  const path = operation.path.replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(opaqueId(parameters[key], key)));
  const url = new URL(connection.managementUrl + '/organizations/' + encodeURIComponent(connection.organizationId) + path);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    requireValue(operation.queryParameters.includes(key), 'QUERY_NOT_IN_CONTRACT', key + ' is not a declared query parameter for ' + operationId + '.');
    if (Array.isArray(value)) { for (const item of value) url.searchParams.append(key, String(item)); }
    else if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  if (operation.requestBodyRequired) requireValue(input.body !== undefined && input.body !== null, 'NATIVE_BODY_REQUIRED');
  validateNativeBody(operationId, input.body);
  const bodyText = input.body === undefined || input.body === null ? null : JSON.stringify(input.body);
  const publicHeaders = {};
  if (input.ifMatch !== undefined) { requireValue(operation.supportsIfMatch === true && typeof input.ifMatch === 'string' && !/[\r\n]/.test(input.ifMatch), 'CONDITIONAL_REQUEST_INVALID'); publicHeaders['if-match'] = input.ifMatch; }
  const plan = { schema: 'gravitee.native-request.v1', connectionId: connection.id, operationId, publicHeaders,
    method: operation.method, url: url.href, bodyText, bodySha256: bodyText === null ? null : sha256(bodyText),
    contractRelease: contract.release, contractSha256: hashJSON(contract), parameters: copy(input),
    expectedStatuses: operation.successStatuses, changesProvider: operation.method !== 'GET' && !operationId.startsWith('verify') };
  return { ...plan, sha256: hashJSON(plan) };
}
