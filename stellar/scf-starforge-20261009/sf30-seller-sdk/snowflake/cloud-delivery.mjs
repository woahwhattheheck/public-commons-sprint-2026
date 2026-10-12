// MIT. Exact original partition handoff to the existing cloud-delivery workspace.
import { fault, fields } from './declaration.mjs';

const shortText = (value, name, maximum = 256) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value))
    throw fault('SNOWFLAKE_CLOUD_SCOPE_REQUIRED', 'Supply the actual ' + name + ' for the retained source.');
  return value;
};
export function snowflakeCloudDeliveryManifest(edition, operation, files, options) {
  fields(options, ['label', 'family', 'scope', 'provenance'], 'Cloud delivery');
  fields(options.scope, ['market', 'frequency', 'start', 'end'], 'Cloud source scope');
  fields(options.provenance, ['description', 'entitlement'], 'Cloud source provenance');
  const family = shortText(options.family, 'cloud family', 64);
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(family)) throw fault('SNOWFLAKE_CLOUD_FAMILY_INVALID');
  const scope = Object.fromEntries(['market', 'frequency', 'start', 'end']
    .map(name => [name, shortText(options.scope[name], name)]));
  if (![scope.start, scope.end].every(value => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) &&
      Number.isFinite(Date.parse(value))) || Date.parse(scope.end) <= Date.parse(scope.start))
    throw fault('SNOWFLAKE_CLOUD_INTERVAL_INVALID', 'Use the actual UTC start and exclusive end of the source selection.');
  return {
    schema: 'stellar-forge.coinmetrics-cloud-input.v1',
    label: shortText(options.label ?? edition.queryName, 'source label'),
    transport: 'retained-snowflake', capturedAt: edition.createdAt,
    provenance: { description: shortText(options.provenance.description, 'source description', 4096),
      entitlement: shortText(options.provenance.entitlement, 'source entitlement', 4096) },
    scope,
    files: files.map(file => ({ id: 'partition-' + String(file.partition).padStart(5, '0'),
      path: file.path, bytes: String(file.bytes), sha256: file.sha256,
      format: 'snowflake-json', role: 'data', family,
      origin: { statementHandle: edition.statementHandle, partition: file.partition,
        requestId: operation.requestId, accountOrigin: operation.origin,
        sourceId: edition.sourceId, editionId: edition.id, queryName: edition.queryName,
        context: { warehouse: operation.body.warehouse, database: operation.body.database,
          schema: operation.body.schema, role: operation.body.role },
        outputParameters: operation.body.parameters ?? {} } })),
    coverage: { kind: 'snowflake-query', groups: [{ family,
      pages: files.map(file => 'partition-' + String(file.partition).padStart(5, '0')) }] },
  };
}
