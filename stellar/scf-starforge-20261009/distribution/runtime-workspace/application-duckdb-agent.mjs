// MIT. Original DuckDB customer browser and native buyer MCP in Applications.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, regular, digest, need, plain } from './storage.mjs';

const ROOT = 'stellar-forge/mcp-paid-agent/';
const NATIVE = 'stellar-forge.mcp-native-workspace.v1';
const BINDING = 'stellar-forge.mcp-native-duckdb.v1';
const ID = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const ALIAS = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const DUCKDB_AGENT_STARTUP_SCHEMA = 'stellar-forge.duckdb-agent-workspace-startup.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({name, label, type, required, description});

export function duckdbAgentApplication(common) {
  return {
    id:'duckdb-agent', command:'mcp-native', title:'DuckDB customer and agent', terminal:false,
    requiredSource:ROOT + 'native-duckdb.mjs',
    description:'Work with received reports, saved SQL, edition comparisons and complete exports in the existing DuckDB browser and agent connection.',
    fields:[
      field('nativeDirectory', 'Native buyer MCP workspace', 'path', true,
        'Select the existing private native MCP directory around the original buyer and inbox.'),
      field('descriptionFile', 'DuckDB connection JSON', 'path', true,
        'Select the private registration for the running customer workspace and its saved source reports.'),
      ...common.map(item => item.name === 'port'
        ? {...item, label:'Agent port', description:'Use 0 for an available local MCP port. The existing DuckDB browser keeps its own port.'}
        : item),
    ],
  };
}

async function pinnedJSON(input, maximum) {
  const raw = await regular(input.path, maximum);
  need(HASH.test(input.sha256 ?? '') && digest(raw) === input.sha256,
    'APPLICATION_DUCKDB_INPUT_CHANGED', 'Review the current original connection file.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)); }
  catch { need(false, 'APPLICATION_DUCKDB_JSON_REQUIRED'); }
  need(plain(value), 'APPLICATION_DUCKDB_JSON_REQUIRED');
  return value;
}

export async function prepareDuckDBAgentApplication(settings, inputPath, runtimeDirectory) {
  const nativeDirectory = absolute(settings.nativeDirectory);
  const descriptionFile = absolute(settings.descriptionFile);
  const nativeInput = await inputPath(nativeDirectory, 'directory', false, true);
  const manifestInput = await inputPath(join(nativeDirectory, 'native-workspace.json'), 'file');
  const descriptionInput = await inputPath(descriptionFile, 'file');
  const manifest = await pinnedJSON(manifestInput, 2 * 1024 * 1024);
  need(manifest.schema === NATIVE && manifest.directory === nativeDirectory &&
    typeof manifest.workspace === 'string' && manifest.workspace === absolute(manifest.workspace),
    'APPLICATION_DUCKDB_NATIVE_WORKSPACE_REQUIRED',
    'Select the original initialized native buyer MCP workspace.');
  const description = await pinnedJSON(descriptionInput, 256 * 1024);
  need(Object.keys(description).every(key => ['name','database','sources'].includes(key)) &&
    ALIAS.test(description.name ?? '') && typeof description.database === 'string' &&
    description.database === absolute(description.database) &&
    (description.sources === undefined || Array.isArray(description.sources)),
    'APPLICATION_DUCKDB_DESCRIPTION_REQUIRED',
    'Select the original DuckDB registration with its customer directory and source aliases.');
  const {inspectMerchantRuntime} = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtimeDirectory, {load:false});
  const modulePath = join(selected.sourceRoot, ROOT + 'native-duckdb.mjs');
  const inputs = [nativeInput, manifestInput, descriptionInput,
    await inputPath(manifest.workspace, 'directory', false, true),
    await inputPath(description.database, 'directory', false, true)];
  for (const name of ['native-duckdb.mjs','native-duckdb-schema.mjs','native-workspace.mjs',
    'native-workspace-cli.mjs','serve.mjs']) {
    inputs.push(await inputPath(join(selected.sourceRoot, ROOT + name), 'file'));
  }
  for (const source of description.sources ?? []) {
    need(plain(source) && ALIAS.test(source.name ?? '') && HASH.test(source.sha256 ?? '') &&
      typeof source.reportPath === 'string' && source.reportPath === absolute(source.reportPath),
      'APPLICATION_DUCKDB_SOURCE_REQUIRED');
    const report = await inputPath(source.reportPath, 'file');
    // The original inspector hashes every complete report (up to its own 8MiB
    // limit). Large reports retain the declared hash through pinned description
    // bytes even when the generic input fingerprint omits a >4MiB file digest.
    need(report.sha256 === undefined || report.sha256 === source.sha256,
      'APPLICATION_DUCKDB_SOURCE_CHANGED', 'Review the original saved report and exact SHA-256.');
    if (!inputs.some(item => item.path === report.path)) inputs.push(report);
  }
  const {inspectDuckDBRegistration} = await import(pathToFileURL(modulePath).href);
  need(typeof inspectDuckDBRegistration === 'function', 'APPLICATION_DUCKDB_BINDING_UNAVAILABLE',
    'Choose a runtime containing the native DuckDB customer connection.');
  const binding = await inspectDuckDBRegistration(description);
  need(plain(binding) && binding.schema === BINDING && binding.status === 'ORIGINAL_DUCKDB_INSPECTED' &&
    binding.name === description.name && binding.database === description.database &&
    ID.test(binding.workspaceId ?? '') && Array.isArray(binding.sources) &&
    binding.sources.length === (description.sources ?? []).length,
    'APPLICATION_DUCKDB_BINDING_CHANGED', 'Review the running original DuckDB customer workspace.');
  // Pin stable identity and selected source descriptions, not changing database
  // pages or the rotating browser capability in duckdb-launch.json.
  return {
    args:['serve','--dir',nativeDirectory,'--duckdb-description',descriptionFile,
      '--duckdb-description-sha256',descriptionInput.sha256,
      '--duckdb-workspace-id',binding.workspaceId],
    inputs,
  };
}

function selectedValue(request, name) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_DUCKDB_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
function localUrl(value, path, selectedPort, capability = false) {
  let url;
  try { url = new URL(value); } catch { need(false, 'APPLICATION_DUCKDB_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    port >= 1 && port <= 65535 && url.pathname === path &&
    !url.username && !url.password && !url.search &&
    (capability ? /^[A-Za-z0-9_-]{24,128}$/.test(url.hash.slice(1)) : !url.hash),
    'APPLICATION_DUCKDB_STARTUP_CHANGED', 'Use the original private browser and MCP listeners.');
  if (selectedPort !== undefined) {
    need(/^(0|[1-9][0-9]*)$/.test(selectedPort) && Number(selectedPort) <= 65535 &&
      (selectedPort === '0' || port === Number(selectedPort)), 'APPLICATION_DUCKDB_STARTUP_CHANGED');
  }
  return url.href;
}

export function duckdbAgentStartup(request, text) {
  if (request.command !== 'mcp-native' || !Array.isArray(request.args) ||
    request.args[0] !== 'serve' || typeof text !== 'string' || text.length > 65536 ||
    !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== DUCKDB_AGENT_STARTUP_SCHEMA ||
    value.status !== 'NATIVE_MCP_LISTENING') return null;
  const directory = absolute(selectedValue(request, '--dir'));
  const descriptionFile = absolute(selectedValue(request, '--duckdb-description'));
  const descriptionSha256 = selectedValue(request, '--duckdb-description-sha256');
  const workspaceId = selectedValue(request, '--duckdb-workspace-id');
  const duckdb = value.duckdb;
  need(HASH.test(descriptionSha256) && ID.test(workspaceId) &&
    value.directory === directory && value.descriptionFile === descriptionFile &&
    value.descriptionSha256 === descriptionSha256 && value.tool === 'sf43_discover_review_and_pay' &&
    typeof value.originalWorkspace === 'string' && value.originalWorkspace === absolute(value.originalWorkspace) &&
    plain(duckdb) && duckdb.schema === BINDING && duckdb.status === 'ORIGINAL_DUCKDB_REGISTERED' &&
    ALIAS.test(duckdb.name ?? '') && duckdb.workspaceId === workspaceId &&
    typeof duckdb.database === 'string' && duckdb.database === absolute(duckdb.database) &&
    Number.isSafeInteger(duckdb.sourceCount) && duckdb.sourceCount >= 0 && duckdb.sourceCount <= 256,
    'APPLICATION_DUCKDB_STARTUP_CHANGED', 'The original launch must match the reviewed DuckDB connection.');
  const mcpUrl = localUrl(value.url, '/mcp', selectedValue(request, '--port'));
  const consoleUrl = localUrl(value.consoleUrl, '/console/', selectedValue(request, '--port'));
  const browserUrl = localUrl(duckdb.browserUrl, '/', undefined, true);
  need(new URL(mcpUrl).origin === new URL(consoleUrl).origin &&
    new URL(browserUrl).origin !== new URL(mcpUrl).origin, 'APPLICATION_DUCKDB_STARTUP_CHANGED');
  return {
    url:browserUrl,
    links:[{id:'agent-mcp',label:'Agent MCP endpoint',url:mcpUrl},
      {id:'buyer-console',label:'Buyer console',url:consoleUrl}],
    original:{schema:DUCKDB_AGENT_STARTUP_SCHEMA,directory,descriptionFile,descriptionSha256,
      originalWorkspace:value.originalWorkspace,workspaceId,duckdbWorkspace:duckdb.name,
      database:duckdb.database,sourceCount:duckdb.sourceCount,mcpUrl,consoleUrl},
  };
}
