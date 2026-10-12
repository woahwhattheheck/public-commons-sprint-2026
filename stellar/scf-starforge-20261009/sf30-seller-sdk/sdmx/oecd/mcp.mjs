/** MIT. MCP stdio control of the same retained OECD application. */
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchOecd, createOecdClient, readOecdConnection } from './client.mjs';

const string = { type: 'string' }, identity = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const selection = {
  operation_id: string, capture_id: identity, countries: { type: 'array', items: string, minItems: 1 },
  start_period: string, end_period: { type: ['string', 'null'] }, title: string, notes: string,
  project_id: { type: ['string', 'null'] }, expected_revision: { type: ['integer', 'null'], minimum: 0 },
};
function tool(name, description, properties, required = [], readOnly = false) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: !name.includes('refresh'), openWorldHint: name === 'oecd_refresh' } };
}
export const OECD_TOOLS = [
  tool('oecd_state', 'Read the same project, retained captures, analyst briefings and native publication.', {}, [], true),
  tool('oecd_connection', 'Read this original operator process binding for opening its local browser.', {}, [], true),
  tool('oecd_seed', 'Import all 15 unchanged bundled original OECD source files into this project.', { operation_id: string }),
  tool('oecd_capture', 'Import a complete retained OECD data and metadata source bundle.', {
    schema: { const: 'stellar-forge.oecd-source-bundle.v1' }, operation_id: string, label: string,
    files: { type: 'array', minItems: 3, maxItems: 32, items: { type: 'object',
      properties: { name: string, kind: { enum: ['data', 'structure', 'catalog'] }, origin: string,
        sha256: identity, bytes: { type: 'integer', minimum: 1 }, content_base64: string,
        receipt: { type: 'object', additionalProperties: true } },
      required: ['name', 'kind', 'origin', 'sha256', 'content_base64'], additionalProperties: false } }
  }, ['schema', 'operation_id', 'label', 'files']),
  tool('oecd_refresh', 'Acquire one new original OECD response using the retained metadata and country selection.', {
    operation_id: string, capture_id: identity, start_period: string, end_period: { type: ['string', 'null'] }, label: string
  }, ['operation_id', 'capture_id']),
  tool('oecd_preview', 'Review the selected captured country series and original project revision before saving.', selection, ['operation_id', 'capture_id'], true),
  tool('oecd_save', 'Save the full native project revision, customer edition and exact HTML/JSON/CSV analyst report.', selection, ['operation_id', 'capture_id']),
  tool('oecd_briefing', 'Read a complete saved briefing with its original monthly values and metadata.', { briefing_id: identity }, ['briefing_id'], true),
  tool('oecd_source_rows', 'Read every original normalized source observation in the selected native customer edition.', { briefing_id: identity }, ['briefing_id'], true),
  tool('oecd_compare', 'Compare two original customer editions and all selected report revisions, additions and removals.', { before: identity, after: identity }, ['before', 'after'], true),
  tool('oecd_activate', 'Publish or restore a saved native customer edition using the current publication revision.', {
    briefing_id: identity, expected_revision: { type: 'integer', minimum: 0 }, expected_current: { type: ['string', 'null'] }
  }, ['briefing_id', 'expected_revision', 'expected_current']),
  tool('oecd_export_dataset', 'Materialize the original SDMX native dataset and lineage for the maintained merchant.', { briefing_id: identity }, ['briefing_id']),
  tool('oecd_export_customer', 'Save a complete original Macrobond customer source/catalog packet.', { briefing_id: identity, destination: string }, ['briefing_id', 'destination']),
  tool('oecd_export_project', 'Save the entire source/customer/report packet for exact reopening in an original project.', { briefing_id: identity, destination: string }, ['briefing_id', 'destination']),
  tool('oecd_report_file', 'Save a standalone original HTML, JSON or CSV report file.', { briefing_id: identity,
    name: { enum: ['briefing.html', 'briefing.json', 'observations.csv'] }, destination: string }, ['briefing_id', 'name', 'destination']),
  tool('oecd_import_project', 'Reopen a complete original OECD project packet through the maintained catalog engine.', { path: string }, ['path']),
  tool('oecd_provider', 'Read the maintained original Macrobond provider using the current customer edition.', {
    command: { enum: ['getcapabilities', 'loadseries', 'loadmeta', 'searchseries', 'loadtree', 'listseries'] },
    parameters: { type: 'object', additionalProperties: { type: ['string', 'number', 'array'], items: string } }
  }, ['command'], true),
];
async function saveDownload(destination, download) {
  const path = resolve(destination);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try { await writeFile(path, download.body, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST' || !Buffer.from(await readFile(path)).equals(download.body)) throw error;
  }
  return { path, bytes: download.body.length, content_type: download.contentType };
}
export async function serveOecdMcp({ client, connection, input = process.stdin, output = process.stdout }) {
  let initialized = false;
  const send = value => output.write(JSON.stringify(value) + '\n');
  async function execute(name, args) {
    switch (name) {
      case 'oecd_state': return client.state();
      case 'oecd_connection': return connection;
      case 'oecd_seed': return client.seed(args);
      case 'oecd_capture': return client.capture(args);
      case 'oecd_refresh': return client.refresh(args);
      case 'oecd_preview': return client.preview(args);
      case 'oecd_save': return client.save(args);
      case 'oecd_briefing': return client.briefing(args.briefing_id);
      case 'oecd_source_rows': return client.sourceRows(args.briefing_id);
      case 'oecd_compare': return client.compare(args.before, args.after);
      case 'oecd_activate': return client.activate(args);
      case 'oecd_export_dataset': return client.exportDataset(args.briefing_id);
      case 'oecd_export_customer': return saveDownload(args.destination, await client.exportCustomer(args.briefing_id));
      case 'oecd_export_project': return saveDownload(args.destination, await client.exportProject(args.briefing_id));
      case 'oecd_report_file': return saveDownload(args.destination, await client.reportFile(args.briefing_id, args.name));
      case 'oecd_import_project': return client.importProject(await readFile(resolve(args.path)));
      case 'oecd_provider': return client.provider(args.command, args.parameters);
      default: throw new Error('Unknown OECD tool');
    }
  }
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try {
      if (Buffer.byteLength(line) > 48 * 1024 * 1024) throw new Error('MCP request exceeds 48 MiB');
      request = JSON.parse(line);
      if (request.jsonrpc !== '2.0') throw new Error('Expected JSON-RPC 2.0');
      if (request.method === 'notifications/initialized' || request.method === 'notifications/cancelled') continue;
      if (request.method === 'initialize') {
        initialized = true;
        if (request.id !== undefined) send({ jsonrpc: '2.0', id: request.id, result: {
          protocolVersion: '2024-11-05', capabilities: { tools: {} },
          serverInfo: { name: 'stellar-forge-oecd', version: '1.0.0' },
          instructions: 'Use the original retained project and explicit operation IDs. Read state before native publication. The complete bundled source can be imported with oecd_seed.',
        } });
      } else if (request.method === 'ping') {
        if (request.id !== undefined) send({ jsonrpc: '2.0', id: request.id, result: {} });
      } else if (!initialized) {
        throw new Error('Initialize the MCP connection first');
      } else if (request.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: request.id, result: { tools: OECD_TOOLS } });
      } else if (request.method === 'tools/call') {
        try {
          const descriptor = OECD_TOOLS.find(t => t.name === request.params?.name);
          if (!descriptor) throw new Error('Unknown OECD tool');
          const args = request.params.arguments ?? {};
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
          if (Object.keys(args).some(k => !(k in descriptor.inputSchema.properties))) throw new Error('Unknown tool argument');
          if (descriptor.inputSchema.required.some(k => !(k in args))) throw new Error('A required tool argument is missing');
          const result = await execute(descriptor.name, args);
          send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false } });
        } catch (error) {
          send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: error.message }], isError: true } });
        }
      } else {
        send({ jsonrpc: '2.0', id: request.id ?? null, error: { code: -32601, message: 'Unknown MCP method' } });
      }
    } catch (error) {
      send({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32600, message: error.message } });
    }
  }
}
export async function runOecdMcp(options) {
  let launched;
  try {
    const connection = options.connectionFile ? await readOecdConnection(options.connectionFile)
      : (launched = await launchOecd(options)).connection;
    const client = launched?.client ?? createOecdClient({ baseUrl: connection.base_url, token: connection.token });
    await serveOecdMcp({ client, connection });
  } finally { if (launched) await launched.close(); }
}
