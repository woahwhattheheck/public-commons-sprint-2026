// MIT. Deterministic catalog handover and queries through the original OpenSearch seller.
import { WorkspaceError, clone, digest } from '../workspace/store.mjs';
import { validateOpenSearchSource, compileOpenSearchQueries } from '../declaration.mjs';

const fail = (code, message, status = 422) => { throw new WorkspaceError(code, message, status); };
const json = value => JSON.stringify(value, null, 2) + '\n';
export function catalogIndex(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,199}$/.test(value))
    fail('CATALOG_INDEX_REQUIRED', 'Select one explicit lowercase index name, starting with a letter or number.');
  return value;
}
export function catalogDocumentId(catalog, material) { return digest([catalog.id, material.key]); }
export function catalogIndexDefinition(catalog) {
  const keyword = { type: 'keyword', ignore_above: 4096 };
  const identity = { ...keyword, ...(catalog.mapping.identifierPolicy === 'casefold' ? { normalizer: 'material_identifier' } : {}) };
  return {
    settings: { number_of_shards: 1, number_of_replicas: 0,
      ...(catalog.mapping.identifierPolicy === 'casefold' ? { analysis: { normalizer: {
        material_identifier: { type: 'custom', filter: ['lowercase'] } } } } : {}) },
    mappings: { dynamic: 'strict', _meta: { schema: 'stellar-forge.material-catalog-index.v1',
      catalogId: catalog.id, tenantId: catalog.tenantId, mappingSha256: catalog.mappingSha256,
      documentIdentity: 'SHA-256([catalogId, SHA-256([tenantId, originalMaterialId])])' },
      properties: {
        catalog_id: keyword, tenant_id: keyword, edition_id: keyword, material_key: keyword,
        material_id: identity, part_number: identity, reference_values: identity,
        title: { type: 'text', fields: { exact: keyword } }, description: { type: 'text' },
        manufacturer: keyword, category: keyword, unit: keyword, original_unit: keyword,
        sales_unit: keyword, original_sales_unit: keyword, material_sha256: keyword,
        sales_to_base: { type: 'object', enabled: false }, references: { type: 'object', enabled: false },
        attributes: { type: 'object', enabled: false }
      }
    }
  };
}
export function catalogDocument(catalog, edition, material) {
  return { catalog_id: catalog.id, tenant_id: catalog.tenantId, edition_id: edition.id, material_key: material.key,
    material_id: material.materialId, part_number: material.partNumber, reference_values: material.references.map(item => item.value),
    title: material.title, description: material.description, manufacturer: material.manufacturer, category: material.category,
    unit: material.unit, original_unit: material.originalUnit, sales_unit: material.salesUnit, original_sales_unit: material.originalSalesUnit,
    sales_to_base: material.salesToBase, references: material.references, attributes: material.attributes, material_sha256: material.sha256 };
}
export function catalogQuery(catalog, index, { variant = 'identifiers', facet, probe = 'material' } = {}) {
  catalogIndex(index);
  if (!['baseline','identifiers'].includes(variant)) fail('CATALOG_QUERY_VARIANT_INVALID', 'Choose the baseline or identifier-aware query.');
  if (facet && !['category','manufacturer','unit'].includes(facet)) fail('CATALOG_FACET_INVALID', 'Choose category, manufacturer, or quantity unit.');
  const term = { '$param': 'term' };
  const text = { multi_match: { query: term, fields: variant === 'baseline' ? ['title','description'] : ['title^3','description'],
    type: 'best_fields', operator: 'or', minimum_should_match: '2<75%',
    ...(variant === 'identifiers' ? { fuzziness: 'AUTO:3,6', prefix_length: 1, max_expansions: 30 } : {}) } };
  const should = variant === 'baseline' ? [text] : [
    { term: { material_id: { value: term, boost: 16 } } },
    { term: { part_number: { value: term, boost: 12 } } },
    { term: { reference_values: { value: term, boost: 10 } } }, text
  ];
  const filter = [{ term: { tenant_id: catalog.tenantId } }, { term: { catalog_id: catalog.id } }];
  if (facet) filter.push({ term: { [facet]: { '$param': facet } } });
  return { indices: [index], query: { bool: { filter, should, minimum_should_match: 1 } },
    parameters: { term: { type: 'string', minLength: 1, maxLength: 1000 },
      ...(facet ? { [facet]: { type: 'string', minLength: 1, maxLength: 256 } } : {}) },
    fields: ['catalog_id','tenant_id','edition_id','material_key','material_id','part_number','reference_values',
      'title','description','manufacturer','category','unit','original_unit','sales_unit','original_sales_unit',
      'sales_to_base','references','attributes','material_sha256'],
    sort: [], pageSize: 100, maxHits: 1000, maxBytes: 8 * 1024 * 1024, timeoutMs: 15000,
    probe: { term: probe, ...(facet ? { [facet]: 'SELECT_ORIGINAL_FACET_VALUE' } : {}) } };
}
function selected(workspace, catalogId, options) {
  const catalog = workspace.catalog(catalogId);
  const editionId = options.editionId ?? catalog.activeEditionId;
  if (!editionId) fail('CATALOG_EDITION_REQUIRED', 'Select a reviewed catalog edition before exporting.');
  const edition = workspace.edition(editionId);
  if (edition.catalogId !== catalog.id) fail('CATALOG_EDITION_FOREIGN', 'The edition belongs to another catalog.');
  // Historical exports use their original mapping even after a later mapping revision.
  const original = { ...catalog, mapping: edition.mapping, mappingSha256: edition.mappingSha256 };
  return { catalog: original, edition };
}
function* materials(workspace, editionId) {
  for (const row of workspace.db.prepare('SELECT record_json FROM catalog_materials WHERE edition_id=? ORDER BY material_key').iterate(editionId))
    yield JSON.parse(row.record_json);
}
function csv(value) {
  // Exact interchange values, including leading-zero IDs and decimal strings.
  // Use the supplied JSONL when a spreadsheet application's type inference is unwanted.
  const text = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return '"' + text.replaceAll('"','""') + '"';
}
function* catalogCSV(workspace, edition) {
  const fields = ['materialId','title','description','partNumber','manufacturer','category','unit','originalUnit',
    'salesUnit','originalSalesUnit','salesToBase','references','attributes','sha256'];
  yield fields.map(csv).join(',') + '\r\n';
  for (const material of materials(workspace, edition.id)) yield fields.map(field => csv(material[field])).join(',') + '\r\n';
}
function* catalogJSONL(workspace, edition) { for (const material of materials(workspace, edition.id)) yield JSON.stringify(material) + '\n'; }
function* bulk(workspace, catalog, edition, index) {
  for (const material of materials(workspace, edition.id)) {
    yield JSON.stringify({ index: { _index: index, _id: catalogDocumentId(catalog, material) } }) + '\n';
    yield JSON.stringify(catalogDocument(catalog, edition, material)) + '\n';
  }
}
function* delta(workspace, catalog, edition, index) {
  let offset = 0;
  do {
    const result = workspace.changes({ editionId: edition.id, offset, limit: 500 });
    for (const row of result.rows) {
      const material = row.after ?? row.before;
      if (!row.after) yield JSON.stringify({ delete: { _index: index, _id: catalogDocumentId(catalog, material) } }) + '\n';
      else {
        yield JSON.stringify({ index: { _index: index, _id: catalogDocumentId(catalog, material) } }) + '\n';
        yield JSON.stringify(catalogDocument(catalog, edition, material)) + '\n';
      }
    }
    offset = result.nextOffset;
  } while (offset !== null);
}
function* approvedCSV(workspace, catalog) {
  yield ['customerId','description','materialId','materialSha256','unit','salesUnit','numerator','denominator','decisionId','decisionRevision','editionId','note'].map(csv).join(',') + '\r\n';
  for (const row of workspace.db.prepare('SELECT record_json FROM catalog_decisions WHERE catalog_id=? ORDER BY context_key').iterate(catalog.id)) {
    const item = workspace.decisionView(JSON.parse(row.record_json), catalog);
    if (item.currentStatus !== 'APPROVED') continue;
    const material = item.currentMaterial;
    yield [item.customerId,item.description,item.materialId,item.materialSha256,material.unit,material.salesUnit,
      material.salesToBase?.numerator,material.salesToBase?.denominator,item.id,item.revision,item.editionId,item.note].map(csv).join(',') + '\r\n';
  }
}
function clientSource(catalog) {
  const context = JSON.stringify({ catalogId: catalog.id, tenantId: catalog.tenantId });
  return [
    '// MIT. Typed material search over the original generated seller client.',
    '// The injected call retains the original buyer, authorization, payment and receiving outcome.',
    'export const catalogContext = Object.freeze(' + context + ');',
    'export interface MaterialSearchInput { term: string }',
    'export interface MaterialDocument {',
    '  catalog_id: string; tenant_id: string; edition_id: string; material_key: string;',
    '  material_id: string; part_number: string | null; title: string; description: string;',
    '  manufacturer: string | null; category: string | null; unit: string | null;',
    '  original_unit: string | null; sales_unit: string | null; original_sales_unit: string | null;',
    '  sales_to_base: { numerator: string; denominator: string } | null;',
    '  reference_values: string[]; references: Array<{ kind: string; value: string }>;',
    '  attributes: Record<string, unknown>; material_sha256: string;',
    '}',
    'export interface MaterialHit { _index: string; _id: string; _score: number | null; _source: MaterialDocument }',
    'export interface MaterialResult { hits: MaterialHit[]; total: unknown; truncated: boolean; [field: string]: unknown }',
    'export function readMaterialResult(input: unknown): MaterialResult {',
    "  if (!input || typeof input !== 'object' || !Array.isArray((input as MaterialResult).hits)) throw new TypeError('Expected the original material result payload');",
    '  for (const hit of (input as MaterialResult).hits) {',
    '    const row = hit?._source;',
    "    if (!row || row.catalog_id !== catalogContext.catalogId || row.tenant_id !== catalogContext.tenantId || typeof row.material_id !== 'string' || typeof row.material_sha256 !== 'string') throw new TypeError('Material result belongs to a different catalog or tenant');",
    '  }',
    '  return input as MaterialResult;',
    '}',
    'export function createMaterialCatalogClient<Authorization, Outcome>(',
    "  originalCall: (operationId: 'material_search', input: { query: MaterialSearchInput }, authorization: Authorization) => Promise<Outcome>",
    ') {',
    '  return Object.freeze({ context: catalogContext, readResult: readMaterialResult,',
    '    search(input: MaterialSearchInput, authorization: Authorization): Promise<Outcome> {',
    "      if (!input || Object.keys(input).some(key => key !== 'term') || typeof input.term !== 'string' || !input.term.length || input.term.length > 1000 || input.term.includes('\\0')) throw new TypeError('Supply one material description or part number');",
    "      return originalCall('material_search', { query: { term: input.term } }, authorization);",
    '    }',
    '  });',
    '}',
    ''
  ].join('\n');
}
export function exportCatalog(workspace, catalogId, format, options = {}) {
  const { catalog, edition } = selected(workspace, catalogId, options);
  const index = catalogIndex(options.index ?? 'materials-' + catalog.id.toLowerCase());
  const filename = 'materials-' + catalog.id + '-' + edition.id + '-';
  const make = (type, body) => ({ filename: filename + format, type, body });
  if (format === 'catalog.csv') return make('text/csv; charset=utf-8', catalogCSV(workspace, edition));
  if (format === 'catalog.jsonl') return make('application/x-ndjson; charset=utf-8', catalogJSONL(workspace, edition));
  if (format === 'approved-matches.csv') return make('text/csv; charset=utf-8', approvedCSV(workspace, catalog));
  if (format === 'index.json') return make('application/json; charset=utf-8', json(catalogIndexDefinition(catalog)));
  if (format === 'bulk.ndjson') return make('application/x-ndjson; charset=utf-8', bulk(workspace, catalog, edition, index));
  if (format === 'delta.ndjson') return make('application/x-ndjson; charset=utf-8', delta(workspace, catalog, edition, index));
  if (format === 'facets.json') return make('application/json; charset=utf-8', json(workspace.facets({ catalogId: catalog.id, editionId: edition.id })));
  if (format === 'search-client.ts') return make('text/typescript; charset=utf-8', clientSource(catalog));
  if (format === 'source.json') {
    const { queries: _queries, ...connection } = clone(workspace.workspace.config);
    const first = workspace.materials({ editionId: edition.id, limit: 1 }).rows[0];
    const probe = first?.materialId ?? 'material';
    const queries = { material_search: catalogQuery(catalog, index, { probe }) };
    for (const facet of ['category','manufacturer','unit']) {
      const value = workspace.facets({ catalogId: catalog.id, editionId: edition.id }).facets[facet][0]?.value;
      if (!value) continue;
      queries['material_search_by_' + facet] = catalogQuery(catalog, index, { probe, facet });
      queries['material_search_by_' + facet].probe[facet] = value;
    }
    const result = { ...connection, queries }; validateOpenSearchSource(result);
    return make('application/json; charset=utf-8', json(result));
  }
  fail('CATALOG_EXPORT_FORMAT_INVALID', 'Select a supported catalog, index, delta, query, client, or match export.');
}
export function createCatalogQueryDraft(workspace, request) {
  if (!Number.isSafeInteger(request.expectedRevision)) fail('CATALOG_REVISION_REQUIRED', 'Select the current saved catalog revision.');
  const catalog = workspace.catalog(request.catalogId, request.expectedRevision);
  if (!catalog.activeEditionId) fail('CATALOG_EDITION_REQUIRED', 'Select a reviewed edition before creating the source query.');
  const edition = workspace.edition(catalog.activeEditionId);
  if (catalog.mappingSha256 !== edition.mappingSha256) fail('CATALOG_MAPPING_CHANGED', 'Review and select an edition using the current mapping first.', 409);
  const probe = workspace.materials({ editionId: edition.id, limit: 1 }).rows[0]?.materialId ?? 'material';
  const query = catalogQuery(catalog, request.index, { variant: request.variant, probe });
  compileOpenSearchQueries({ material_search: query });
  const plan = clone(workspace.workspace.templatePlan);
  plan.routes = [{ id: 'material_search', path: '/materials/search', method: 'GET', query: 'material_search',
    serviceName: 'Material catalog search', description: 'Search the selected material catalog by customer description or original part identifier.',
    tags: ['materials','catalog'], example: { term: probe }, parameterDescriptions: {
      term: 'Customer description or original material/part identifier. Catalog and tenant are fixed by this service.' } }];
  return workspace.workspace.save({ requestId: request.requestId, queryName: 'material_search',
    title: request.title ?? catalog.title + ' — ' + (request.variant === 'baseline' ? 'baseline' : 'identifiers'),
    query, input: { term: probe }, plan });
}
