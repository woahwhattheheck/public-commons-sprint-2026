/**
 * SF-26: bind x402 Bazaar MCP listings to an authenticated MCP tools/list
 * capability snapshot before publishing them through the accepted SF-25/SF-46
 * catalog path.
 *
 * This module does not authenticate an MCP server, verify payment settlement,
 * or call a tool. Its caller must supply a snapshot obtained through an
 * authenticated MCP session and the existing settlement hook contract.
 */
import { createHash } from 'node:crypto';
import { PaymentAutoCatalog } from '../payment-auto-catalog/auto-catalog.mjs';

export const SOURCE_PINS = Object.freeze({
  bazaarSpecBlob: '442708e76d5a129e0c1393471d8ed71e3604c94e',
  hearthlineToolsBlob: '73c4aec69fef0f5864f266bb601ab6ed69aec666',
  hearthlineServerBlob: '0c34a9c7809eb60f3fce16c1d4ce61d4b03a6d27',
});

const TRANSPORTS = new Set(['streamable-http', 'sse']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

const stable = value => JSON.stringify(canonical(value));
const digest = value => createHash('sha256').update(stable(value)).digest('hex');

function safeText(value, max = 512) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

function canonicalURL(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
    return url.href;
  } catch { throw new TypeError('MCP_RESOURCE_URL_INVALID'); }
}

function inspectTree(value, depth = 0, state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > 2_048 || depth > 16) throw new TypeError('MCP_METADATA_COMPLEXITY_LIMIT');
  if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > 8_192) throw new TypeError('MCP_METADATA_STRING_LIMIT');
  if (Array.isArray(value)) {
    if (value.length > 512) throw new TypeError('MCP_METADATA_ARRAY_LIMIT');
    for (const item of value) inspectTree(item, depth + 1, state);
    return;
  }
  if (!plain(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new TypeError('MCP_METADATA_FORBIDDEN_KEY');
    if (Buffer.byteLength(key, 'utf8') > 256) throw new TypeError('MCP_METADATA_KEY_LIMIT');
    inspectTree(child, depth + 1, state);
  }
}

function normalizeTool(raw) {
  if (!plain(raw) || !safeText(raw.name, 128) || !/^[A-Za-z0-9_.-]+$/.test(raw.name)) {
    throw new TypeError('MCP_TOOL_NAME_INVALID');
  }
  if (!plain(raw.inputSchema) || raw.inputSchema.type !== 'object') throw new TypeError('MCP_TOOL_SCHEMA_INVALID');
  inspectTree(raw.inputSchema);
  if (raw.inputSchema.properties !== undefined && !plain(raw.inputSchema.properties)) {
    throw new TypeError('MCP_TOOL_SCHEMA_PROPERTIES_INVALID');
  }
  if (raw.inputSchema.required !== undefined &&
      (!Array.isArray(raw.inputSchema.required) || new Set(raw.inputSchema.required).size !== raw.inputSchema.required.length ||
       raw.inputSchema.required.some(name => typeof name !== 'string'))) {
    throw new TypeError('MCP_TOOL_SCHEMA_REQUIRED_INVALID');
  }
  return {
    name: raw.name,
    inputSchema: canonical(raw.inputSchema),
    ...(safeText(raw.title, 256) ? { title: raw.title } : {}),
    ...(safeText(raw.description, 2_048) ? { description: raw.description } : {}),
    ...(plain(raw.annotations) ? { annotations: canonical(raw.annotations) } : {}),
  };
}

export function normalizeMcpCapabilitySnapshot(snapshot) {
  if (!plain(snapshot)) throw new TypeError('MCP_CAPABILITY_SNAPSHOT_INVALID');
  const resourceURL = canonicalURL(snapshot.resourceURL);
  const transport = snapshot.transport ?? 'streamable-http';
  if (!TRANSPORTS.has(transport)) throw new TypeError('MCP_TRANSPORT_UNSUPPORTED');
  if (!safeText(snapshot.protocolVersion, 64)) throw new TypeError('MCP_PROTOCOL_VERSION_INVALID');
  if (!plain(snapshot.serverInfo) || !safeText(snapshot.serverInfo.name, 256) || !safeText(snapshot.serverInfo.version, 128)) {
    throw new TypeError('MCP_SERVER_INFO_INVALID');
  }
  if (!plain(snapshot.capabilities) || !Array.isArray(snapshot.tools) || snapshot.tools.length === 0 || snapshot.tools.length > 256) {
    throw new TypeError('MCP_CAPABILITIES_INVALID');
  }
  inspectTree(snapshot.capabilities);
  const tools = snapshot.tools.map(normalizeTool).sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new TypeError('MCP_TOOL_NAME_CONFLICT');
  if (!plain(snapshot.source) || !safeText(snapshot.source.url, 4_096) ||
      !/^[a-f0-9]{40}$/.test(snapshot.source.toolsBlob ?? '') ||
      !/^[a-f0-9]{40}$/.test(snapshot.source.serverBlob ?? '')) {
    throw new TypeError('MCP_CAPABILITY_SOURCE_INVALID');
  }
  const normalized = canonical({
    resourceURL,
    transport,
    protocolVersion: snapshot.protocolVersion,
    serverInfo: snapshot.serverInfo,
    capabilities: snapshot.capabilities,
    tools,
    source: snapshot.source,
  });
  return { ...normalized, capabilityDigest: digest(normalized) };
}

function marketplaceKey(resourceURL, toolName) { return `${canonicalURL(resourceURL)}|${toolName}`; }

function enrich(rows, capabilities) {
  return rows.map(row => {
    const input = row.extensions?.bazaar?.info?.input;
    if (input?.type !== 'mcp') return row;
    const linked = capabilities.get(marketplaceKey(row.resource?.url, input.toolName));
    return linked ? { ...row, mcpServer: clone(linked) } : row;
  });
}

export class McpMarketplaceCatalog {
  #catalog;
  #links = new Map();

  constructor(catalog = new PaymentAutoCatalog()) { this.#catalog = catalog; }

  ingest({ paymentPayload, settlement, sequence, mcpSnapshot }) {
    const input = paymentPayload?.extensions?.bazaar?.info?.input;
    if (input?.type !== 'mcp') return this.#catalog.ingest({ paymentPayload, settlement, sequence });

    let snapshot;
    try { snapshot = normalizeMcpCapabilitySnapshot(mcpSnapshot); }
    catch (error) { return { decision: 'reject', reason: error?.message ?? 'MCP_CAPABILITY_SNAPSHOT_INVALID' }; }
    let resourceURL;
    try { resourceURL = canonicalURL(paymentPayload?.resource?.url); }
    catch (error) { return { decision: 'reject', reason: error.message }; }
    if (resourceURL !== snapshot.resourceURL) return { decision: 'reject', reason: 'MCP_RESOURCE_CAPABILITY_MISMATCH' };
    const transport = input.transport ?? 'streamable-http';
    if (transport !== snapshot.transport) return { decision: 'reject', reason: 'MCP_TRANSPORT_CAPABILITY_MISMATCH' };
    const tool = snapshot.tools.find(item => item.name === input.toolName);
    if (!tool) return { decision: 'reject', reason: 'MCP_TOOL_NOT_ADVERTISED' };
    if (!plain(input.inputSchema) || stable(input.inputSchema) !== stable(tool.inputSchema)) {
      return { decision: 'reject', reason: 'MCP_TOOL_SCHEMA_MISMATCH' };
    }

    const result = this.#catalog.ingest({ paymentPayload, settlement, sequence });
    if (result.decision === 'accepted') {
      this.#links.set(marketplaceKey(resourceURL, input.toolName), Object.freeze({
        capabilityDigest: snapshot.capabilityDigest,
        transport: snapshot.transport,
        protocolVersion: snapshot.protocolVersion,
        serverInfo: clone(snapshot.serverInfo),
        toolsListChanged: snapshot.capabilities?.tools?.listChanged ?? null,
        toolSchemaDigest: digest(tool.inputSchema),
        source: clone(snapshot.source),
      }));
    }
    return result.decision === 'accepted' ? { ...result, capabilityDigest: snapshot.capabilityDigest } : result;
  }

  list(params = new URLSearchParams()) {
    const result = this.#catalog.list(params);
    return { ...result, resources: enrich(result.resources, this.#links) };
  }

  search(params = new URLSearchParams()) {
    const result = this.#catalog.search(params);
    return { ...result, resources: enrich(result.resources, this.#links) };
  }

  get size() { return this.#catalog.size; }
  get version() { return this.#catalog.version; }
}
