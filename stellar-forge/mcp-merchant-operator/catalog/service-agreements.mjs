// MIT. Source-owned service-agreement tool metadata over original accounting.
import {MAX_RETAINED_CHUNK_BYTES} from '../retained-file-contracts.mjs';

export const SERVICE_AGREEMENT_PREFIX = 'merchant_service_agreements_';
export const SERVICE_AGREEMENT_REQUEST_BYTES = 2_000_000;
const text = (maximum, minimum = 0) => ({type: 'string', minLength: minimum, maxLength: maximum});
const alias = {type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$'};
const uuid = {type: 'string', pattern: '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'};
const revision = {type: 'integer', minimum: 1}, date = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const hash = {type: 'string', pattern: '^[a-f0-9]{64}$'};
const workspace = {workspace: alias}, agreement = {...workspace, agreementId: uuid};
const requestId = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'};
const mutation = {...workspace, revision, workspaceId: hash, actor: text(1000, 1), requestId};
const change = {...agreement, ...mutation, expectedVersion: revision};
const terms = {billingMonths: {type: 'integer', minimum: 1, maximum: 12},
  invoiceTiming: {type: 'string', enum: ['START', 'END']}, dueDays: {type: 'integer', minimum: 0, maximum: 365}};
const source = {quoteContent: text(SERVICE_AGREEMENT_REQUEST_BYTES, 1),
  responseContent: text(SERVICE_AGREEMENT_REQUEST_BYTES, 1), renewalJson: text(SERVICE_AGREEMENT_REQUEST_BYTES, 1)};
const file = {type: 'string', minLength: 1, maxLength: 255, pattern: '^[^/\\\\\\u0000-\\u001f]+$'};
const range = {readId: uuid, expectedSha256: hash, offset: {type: 'integer', minimum: 0},
  limit: {type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES}};
const descriptions = [
  ['workspaces', 'List the existing configured accounting workspace aliases for service agreements.', {}, [], true],
  ['open', 'Open the original accounting workspace and initialize its service-agreement controller under the same lease.',
    workspace, ['workspace'], false],
  ['close', 'Release agreement file reads and close this original accounting workspace.', workspace, ['workspace'], false],
  ['state', 'Read the complete dated agreement calendar, customer identities and original workspace revision.',
    {...workspace, asOf: date}, ['workspace'], true],
  ['agreement', 'Read one complete original agreement, its quotation editions, billing periods and history.',
    {...agreement, asOf: date}, ['workspace', 'agreementId'], true],
  ['preview', 'Preview the exact original billing period and retain its agreement version, digest and any existing recovery request.',
    {...agreement, periodId: text(240, 1), asOf: date}, ['workspace', 'agreementId', 'periodId'], true],
  ['create', 'Create an agreement from a complete original quotation and its accepted customer response, optionally joined to the complete accepted SF74 renewal handover.',
    {...mutation, reference: text(120, 1), title: text(500, 1), customerId: uuid, startDate: date,
      termMonths: {type: 'integer', minimum: 1, maximum: 120}, ...terms,
      currencyScale: {type: 'integer', minimum: 0, maximum: 6}, ...source},
    ['workspace', 'revision', 'actor', 'requestId', 'reference', 'title', 'customerId', 'startDate',
      'termMonths', 'quoteContent', 'responseContent'], false],
  ['amend', 'Retain an accepted quotation edition at an original monthly boundary, with its reason, reviewed agreement version and optional complete accepted SF74 renewal handover.',
    {...change, ...terms, ...source, effectiveDate: date, reason: text(4000, 1)},
    ['workspace', 'agreementId', 'revision', 'actor', 'requestId', 'expectedVersion',
      'effectiveDate', 'reason', 'quoteContent', 'responseContent'], false],
  ['renew', 'Extend the original agreement by an explicit count of whole monthly periods.',
    {...change, additionalMonths: {type: 'integer', minimum: 1, maximum: 120}, reason: text(4000, 1)},
    ['workspace', 'agreementId', 'revision', 'actor', 'requestId', 'expectedVersion', 'additionalMonths', 'reason'], false],
  ['cancel', 'End future agreement billing at an original monthly boundary while preserving billed periods and accepted sources.',
    {...change, effectiveDate: date, reason: text(4000, 1)},
    ['workspace', 'agreementId', 'revision', 'actor', 'requestId', 'expectedVersion', 'effectiveDate', 'reason'], false],
  ['bill', 'Create the original receivables draft for the reviewed period. Reuse an existing PREPARING recovery request unchanged with the current workspace revision.',
    {...change, periodId: text(240, 1), previewSha256: hash},
    ['workspace', 'agreementId', 'revision', 'actor', 'requestId', 'expectedVersion', 'periodId', 'previewSha256'], false],
  ['source_file', 'Read a selected original quotation, response, renewal handover or review through the existing complete file-range reader.',
    {...agreement, sourceId: uuid, file, ...range}, ['workspace', 'agreementId', 'sourceId', 'file'], true],
  ['export', 'Describe every original agreement export file and the complete TAR archive, with exact byte counts and SHA256 values.',
    {...agreement, asOf: date}, ['workspace', 'agreementId'], true],
  ['export_file', 'Download one original export file or agreement.tar using its exact export date and SHA256.',
    {...agreement, asOf: date, file, ...range},
    ['workspace', 'agreementId', 'asOf', 'file', 'expectedSha256'], true],
  ['file_release', 'Release this original file read after a completed or interrupted transfer.',
    {...workspace, readId: uuid}, ['workspace', 'readId'], false],
];
export const serviceAgreementDefinitions = Object.freeze(descriptions.map(
  ([action, description, properties, required, readOnly]) =>
    Object.freeze({name: SERVICE_AGREEMENT_PREFIX + action, action, description, properties, required, readOnly})));
const byName = new Map(serviceAgreementDefinitions.map(value => [value.name, value]));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function accepted(schema, value) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'integer') return Number.isSafeInteger(value) &&
    value >= (schema.minimum ?? 0) && value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER);
  if (schema.type === 'string') return typeof value === 'string' &&
    value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity) &&
    (!schema.pattern || new RegExp(schema.pattern).test(value));
  return false;
}
export function validateServiceAgreementArguments(name, args = {}) {
  const definition = byName.get(name);
  const fail = message => {throw Object.assign(new TypeError(message), {code: 'SERVICE_AGREEMENTS_INVALID_ARGUMENTS'});};
  if (!definition) fail('Choose a declared service-agreement operation.');
  if (!plain(args) || definition.required.some(key => !Object.hasOwn(args, key)) ||
      Object.keys(args).some(key => !Object.hasOwn(definition.properties, key)))
    fail('Supply the declared service-agreement arguments and every required field.');
  for (const [key, value] of Object.entries(args))
    if (!accepted(definition.properties[key], value)) fail('Check the declared service-agreement argument: ' + key + '.');
  if (Buffer.byteLength(JSON.stringify(args)) > SERVICE_AGREEMENT_REQUEST_BYTES)
    fail('The complete service-agreement request exceeds its source limit.');
  return definition.action;
}
export function serviceAgreementTools(tool) {
  return serviceAgreementDefinitions.map(value => tool(value.name, value.description, value.properties,
    value.required, {readOnly: value.readOnly, idempotent: true, openWorld: false}));
}
