// SPDX-License-Identifier: MIT
// One original plan template for the CLI, source workbench and typed clients.
import { fault } from '../postgres/publisher/files.mjs';
export function frictionlessPlanInput(source, queryName) {
  const query = source.queries?.[queryName];
  if (!query) throw fault('QUERY_NOT_FOUND');
  const columns = Object.fromEntries(Object.entries(query.projection).map(([alias, spec]) =>
    [alias, { type: spec.type, nullable: spec.missing === 'null' }]));
  return { title: queryName + ' retained package edition', query: queryName, input: {}, sourceHash: source.hash,
    dataset: { name: queryName, columns, filters: [], ranges: [], sorts: [], defaultLimit: 50, maxLimit: 250,
      maxCellChars: 65536, maxPageBytes: 921600 },
    extraction: { order: [{ column: query.columns[0], direction: 'asc' }], maxRows: 250000,
      maxBytes: 67108864, maxRowBytes: 1048576, timeoutMs: 300000 } };
}
