// MIT. Explicit extraction ordering over the original Sheet Best projection.
import { object, fault } from '../../postgres/publisher/files.mjs';
import { compileQueries, only } from '../declaration.mjs';
import { datasetExtractionOptions } from '../../postgres/publisher/stream.mjs';

export function projectionOrders(queries, supplied, { allowEmpty = false } = {}) {
  if (allowEmpty && object(queries) && !Object.keys(queries).length) {
    if (supplied !== undefined && (!object(supplied) || Object.keys(supplied).length))
      throw fault('SHEETBEST_ORDER_QUERY_UNKNOWN');
    return {};
  }
  const compiled = compileQueries(queries);
  if (!object(supplied) || Object.keys(supplied).length !== Object.keys(compiled).length ||
      Object.keys(supplied).some(name => !Object.hasOwn(compiled, name)))
    throw fault('SHEETBEST_PROJECTION_ORDER_REQUIRED', 'Choose an explicit original extraction order for every query.');
  return Object.fromEntries(Object.entries(compiled).map(([name, query]) => {
    if (!Array.isArray(supplied[name]) || !supplied[name].length) throw fault('SHEETBEST_PROJECTION_ORDER_REQUIRED');
    for (const row of supplied[name]) only(row, ['column','direction'], 'SHEETBEST_PROJECTION_ORDER_INVALID');
    return [name, datasetExtractionOptions(query, { order: supplied[name] }).order];
  }));
}
export function initialOrders(queries) {
  return Object.fromEntries(Object.entries(queries).map(([name, query]) =>
    [name, [{ column: Object.keys(query.columns)[0], direction: 'asc' }]]));
}
