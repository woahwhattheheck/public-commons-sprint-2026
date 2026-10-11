// MIT. Browser declarations for the original retained fleet bootstrap.
export const FLEET_DRAFT_SCHEMA = 'stellar-forge.frontdoor-fleet.v1';
export const FLEET_BOOTSTRAP_SCHEMA = 'stellar-forge.fleet-bootstrap.v1';
export const SOURCE_LABELS = Object.freeze({ workspace: 'API workspace', python: 'Python application',
  duckdbPackage: 'DuckDB / Parquet', s3Package: 'S3 objects', jsonrpcPackage: 'Stellar RPC' });
const SOURCE_KEYS = Object.keys(SOURCE_LABELS);
const GUIDE = 'https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/merchant-fleet-gateway/';
const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const TENANT = /^[a-z][a-z0-9-]{1,39}$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const LIMIT_RANGES = Object.freeze({ maxInFlight: [1, 512], maxRequestBytes: [1024, 4194304],
  maxResponseBytes: [1024, 16777216], timeoutMs: [1000, 60000] });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = value => new TextEncoder().encode(value).length;
const json = value => JSON.stringify(value, null, 2) + '\n';
const text = (value, max) => typeof value === 'string' && value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value) && new TextDecoder().decode(new TextEncoder().encode(value)) === value;
const path = value => text(value, 4096) && value.trim().length > 0;
const absolute = value => path(value) && value.startsWith('/') && value !== '/' &&
  !value.endsWith('/') && !value.split('/').slice(1).some(part => !part || part === '.' || part === '..');
export class FleetSetupError extends Error {
  constructor(errors) { super(errors.map(row => row.message).join(' ')); this.name = 'FleetSetupError'; this.errors = errors; }
}
function keys(value, allowed, field) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new FleetSetupError([{ field, message: `${field}: expected the supported setup fields.` }]);
}
function draftShape(input) {
  keys(input, ['schema', 'folder', 'directory', 'mcpDirectory', 'workspacePort', 'gatewayPort',
    'adminPort', 'merchantPortStart', 'slots', 'tenants'], 'setup');
  if (input.schema !== FLEET_DRAFT_SCHEMA || !Array.isArray(input.tenants) || input.tenants.length > 32)
    throw new FleetSetupError([{ field: 'tenants', message: 'Open a supported fleet draft with at most 32 merchants.' }]);
  input.tenants.forEach((tenant, index) => {
    const field = `tenants.${index}`;
    keys(tenant, ['id', 'host', 'initialPackage', 'releaseId', 'label', 'sources', 'limits'], field);
    if (!Array.isArray(tenant.sources) || tenant.sources.length > 32)
      throw new FleetSetupError([{ field, message: 'Each merchant supports at most 32 registered sources.' }]);
    keys(tenant.limits ?? {}, Object.keys(LIMIT_RANGES), field + '.limits');
    tenant.sources.forEach((source, n) => keys(source, ['name', 'kind', 'path', 'pythonRoot', 'duckdbPython',
      'facilitator', 'allowLocalFacilitator', 'allowLoopbackUpstream'], field + '.sources.' + n));
  });
}
export function newFleetSource(name = 'current', kind = 'workspace') {
  return { name, kind, path: '', pythonRoot: '', duckdbPython: '', facilitator: '' };
}
export function newFleetTenant(id = 'merchant', kind = 'workspace') {
  return { id, host: '', initialPackage: 'current', releaseId: 'initial', label: '',
    sources: [newFleetSource('current', kind)], limits: {} };
}
export function createFleetDraft() {
  return { schema: FLEET_DRAFT_SCHEMA, folder: 'merchant-fleet', directory: '/var/lib/stellar-fleet',
    mcpDirectory: '/var/lib/stellar-fleet-mcp', workspacePort: 8402, gatewayPort: 8400, adminPort: 8401,
    merchantPortStart: 8521, slots: ['blue', 'green'],
    tenants: [newFleetTenant('data', 'duckdbPackage'), newFleetTenant('analysis', 'python')] };
}
/** Validate portable declarations; the original host APIs inspect source files and origins. */
export function validateFleetDraft(input) {
  const errors = [], assignments = [];
  const add = (field, message) => errors.push({ field, message });
  try { draftShape(input); } catch (error) { return { valid: false, errors: error.errors, assignments }; }
  const integer = (value, min, max, field) => {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (!Number.isSafeInteger(n) || n < min || n > max) add(field, `${field}: enter an integer from ${min} to ${max}.`);
    return n;
  };
  if (typeof input.folder !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.folder))
    add('folder', 'Use a packet folder of 1–64 lowercase letters, numbers or hyphens.');
  if (!absolute(input.directory)) add('directory', 'Enter a canonical absolute Linux path for the private fleet directory.');
  if (!absolute(input.mcpDirectory)) add('mcpDirectory', 'Enter a canonical absolute Linux path for the merchant MCP directory.');
  if (typeof input.directory === 'string' && typeof input.mcpDirectory === 'string' &&
      (input.directory === input.mcpDirectory || input.directory.startsWith(input.mcpDirectory + '/')))
    add('mcpDirectory', 'Choose a new MCP directory that is neither the fleet directory nor one of its parent directories.');
  const gateway = { port: integer(input.gatewayPort, 1, 65535, 'gatewayPort'),
    adminPort: integer(input.adminPort, 1, 65535, 'adminPort') };
  const workspacePort = integer(input.workspacePort, 0, 65535, 'workspacePort');
  const merchantPortStart = integer(input.merchantPortStart, 1, 65535, 'merchantPortStart');
  const slots = typeof input.slots === 'string' ? input.slots.split(',').map(value => value.trim()) : input.slots;
  if (!Array.isArray(slots) || slots.length < 2 || slots.length > 4 ||
      slots.some(value => typeof value !== 'string' || !NAME.test(value)) || new Set(slots).size !== slots.length)
    add('slots', 'Use 2–4 distinct slot names, each starting with a lowercase letter and using letters, numbers or hyphens.');
  if (input.tenants.length < 2) add('tenants', 'Register at least two merchants in this fleet.');
  const ids = new Set(), hosts = new Set();
  const tenants = input.tenants.map((row, index) => {
    const field = `tenants.${index}`, display = `Merchant ${index + 1}`;
    if (typeof row.id !== 'string' || !TENANT.test(row.id) || ids.has(row.id))
      add(field + '.id', `${display}: use a distinct 2–40 character lowercase merchant ID.`);
    if (typeof row.host !== 'string' || row.host.length > 253 || !HOST.test(row.host) || hosts.has(row.host))
      add(field + '.host', `${display}: enter a distinct lowercase public DNS host without a URL scheme or path.`);
    ids.add(row.id); hosts.add(row.host);
    if (typeof row.releaseId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.releaseId))
      add(field + '.releaseId', `${display}: use a 1–64 character lowercase initial release ID.`);
    if (row.label !== undefined && row.label !== '' && (!text(row.label, 240) || !row.label.trim()))
      add(field + '.label', `${display}: use a single-line release label of up to 240 characters.`);
    if (!row.sources.length) add(field + '.sources', `${display}: register at least one source package.`);
    const packages = Object.create(null);
    row.sources.forEach((source, n) => {
      const at = field + '.sources.' + n;
      if (typeof source.name !== 'string' || !NAME.test(source.name) || Object.hasOwn(packages, source.name))
        add(at + '.name', `${display}, source ${n + 1}: use a distinct lowercase package alias of up to 40 characters.`);
      if (!SOURCE_KEYS.includes(source.kind)) add(at + '.kind', `${display}: choose a supported source type.`);
      if (!path(source.path)) add(at + '.path', `${display}, source ${n + 1}: enter the source path on the merchant host.`);
      const native = { [source.kind]: source.path }, runtime = {};
      for (const [key, kind] of [['pythonRoot', 'python'], ['duckdbPython', 'duckdbPackage']]) {
        if (source[key] !== undefined && source[key] !== '') {
          if (source.kind !== kind || !path(source[key]) || key === 'duckdbPython' && source[key].startsWith('-'))
            add(at + '.' + key, `${display}: ${key} must be a valid path for its matching source type.`);
          native[key] = source[key];
        }
      }
      for (const key of ['allowLocalFacilitator', 'allowLoopbackUpstream']) {
        if (source[key] !== undefined) {
          if (typeof source[key] !== 'boolean') add(at + '.' + key, `${display}: ${key} must be true or false.`);
          runtime[key] = source[key];
        }
      }
      if (!['workspace', 'jsonrpcPackage'].includes(source.kind) && source.allowLoopbackUpstream)
        add(at + '.allowLoopbackUpstream', `${display}: native package types manage their own process bindings.`);
      if (source.facilitator !== undefined && source.facilitator !== '') {
        try {
          if (!text(source.facilitator, 4096)) throw new Error();
          const url = new URL(source.facilitator);
          const local = url.hostname === '127.0.0.1';
          if (url.username || url.password || url.hash || url.search ||
              !(url.protocol === 'https:' || url.protocol === 'http:' && local && source.allowLocalFacilitator === true))
            throw new Error();
          runtime.facilitator = source.facilitator;
        } catch { add(at + '.facilitator', `${display}: use an HTTPS facilitator, or explicitly allow an HTTP facilitator at 127.0.0.1.`); }
      }
      if (source.allowLocalFacilitator === true && !runtime.facilitator)
        add(at + '.facilitator', `${display}: the local facilitator option requires its explicit endpoint URL.`);
      packages[source.name] = { ...native, runtime };
    });
    if (typeof row.initialPackage !== 'string' || !Object.hasOwn(packages, row.initialPackage))
      add(field + '.initialPackage', `${display}: choose one of its registered packages for the initial release.`);
    const limits = {};
    for (const [key, value] of Object.entries(row.limits ?? {})) {
      if (value !== '' && value !== undefined) limits[key] = integer(value, ...LIMIT_RANGES[key], field + '.limits.' + key);
    }
    return { id: row.id, host: row.host, packages,
      initial: { package: row.initialPackage, releaseId: row.releaseId,
        ...(typeof row.label === 'string' && row.label.trim() ? { label: row.label.trim() } : {}) },
      ...(Object.keys(limits).length ? { limits } : {}) };
  });
  const ports = new Set();
  for (const port of [gateway.port, gateway.adminPort, ...(workspacePort ? [workspacePort] : [])]) {
    if (ports.has(port)) add('ports', `Port ${port} is assigned to more than one listener.`);
    ports.add(port);
  }
  if (Array.isArray(slots) && slots.length <= 4) {
    let port = merchantPortStart;
    for (const tenant of tenants) for (const slot of slots) {
      if (port > 65535 || ports.has(port)) add('ports', `Merchant slot port ${port} conflicts with another listener or exceeds 65535.`);
      ports.add(port);
      assignments.push({ tenant: tenant.id, host: tenant.host, slot, port: port++, startup: slot === slots[0],
        store: `${input.directory}/stores/${tenant.id}/${slot}` });
    }
  }
  const declaration = { schema: FLEET_BOOTSTRAP_SCHEMA, gateway, merchantPortStart, slots, tenants };
  if (bytes(json(declaration)) > 1024 * 1024) add('setup', 'The native setup declaration must fit within 1 MiB.');
  return { valid: errors.length === 0, errors, declaration, assignments, workspacePort,
    planFile: input.directory + '/fleet-plan.json', mcpConfig: input.mcpDirectory + '/merchant-mcp.json' };
}
function importNative(input) {
  keys(input, ['schema', 'gateway', 'merchantPortStart', 'slots', 'tenants'], 'setup');
  keys(input.gateway ?? {}, ['port', 'adminPort'], 'gateway');
  if (!Array.isArray(input.tenants) || input.tenants.length > 32)
    throw new FleetSetupError([{ field: 'tenants', message: 'The declaration must contain at most 32 merchants.' }]);
  const draft = createFleetDraft();
  draft.gatewayPort = input.gateway?.port ?? 8400; draft.adminPort = input.gateway?.adminPort ?? 8401;
  draft.merchantPortStart = input.merchantPortStart ?? 8521; draft.slots = input.slots ?? ['blue', 'green'];
  draft.tenants = input.tenants.map((tenant, index) => {
    keys(tenant, ['id', 'host', 'packages', 'initial', 'limits'], 'merchant ' + (index + 1));
    keys(tenant.initial, ['package', 'releaseId', 'label'], 'initial release');
    if (!object(tenant.packages) || Object.keys(tenant.packages).length > 32)
      throw new FleetSetupError([{ field: 'sources', message: 'Register at most 32 packages per merchant.' }]);
    const sources = Object.entries(tenant.packages).map(([name, native]) => {
      keys(native, [...SOURCE_KEYS, 'pythonRoot', 'duckdbPython', 'runtime'], 'package ' + name);
      keys(native.runtime ?? {}, ['facilitator', 'allowLocalFacilitator', 'allowLoopbackUpstream'], 'runtime');
      const selected = SOURCE_KEYS.filter(key => Object.hasOwn(native, key));
      if (selected.length !== 1) throw new FleetSetupError([{ field: 'sources', message: 'Each registered package must select one source type.' }]);
      return { ...newFleetSource(name, selected[0]), path: native[selected[0]],
        ...(native.pythonRoot !== undefined ? { pythonRoot: native.pythonRoot } : {}),
        ...(native.duckdbPython !== undefined ? { duckdbPython: native.duckdbPython } : {}), ...native.runtime };
    });
    return { id: tenant.id, host: tenant.host, sources, initialPackage: tenant.initial.package,
      releaseId: tenant.initial.releaseId, label: tenant.initial.label ?? '', limits: tenant.limits ?? {} };
  });
  return draft;
}
export function importFleetDraft(contents) {
  if (typeof contents !== 'string' || bytes(contents) > 2 * 1024 * 1024)
    throw new FleetSetupError([{ field: 'setup', message: 'Choose a JSON setup file of at most 2 MiB.' }]);
  let input;
  try { input = JSON.parse(contents.replace(/^\uFEFF/, '')); }
  catch { throw new FleetSetupError([{ field: 'setup', message: 'The selected file is not valid JSON.' }]); }
  const draft = input?.schema === FLEET_BOOTSTRAP_SCHEMA ? importNative(input) : input;
  draftShape(draft);
  return structuredClone(draft);
}
/** Argument arrays are also machine-readable; shell display quotes every argument. */
export function fleetCommands(input, result = validateFleetDraft(input)) {
  return [
    { id: 'setup', title: 'Prepare or resume the original fleet', args: ['fleet-release', 'setup', '--declaration', './fleet-setup.json', '--directory', input.directory] },
    { id: 'workspace', title: 'Open the browser workspace', args: ['merchant-fleet-workspace', '--releases', result.planFile, '--release-state', input.directory, '--port', String(result.workspacePort)] },
    { id: 'terminal', title: 'Run from the terminal', args: ['fleet-release', 'start', '--plan', result.planFile, '--directory', input.directory] },
    { id: 'mcp-init', title: 'Connect merchant MCP to the same fleet', args: ['merchant-mcp', 'init-fleet', '--dir', input.mcpDirectory, '--plan', result.planFile, '--fleet-directory', input.directory] },
    { id: 'mcp-host', title: 'Write the native MCP host registration', args: ['merchant-mcp-client-config', '--config', result.mcpConfig, '--name', 'stellar-fleet', '--output', input.mcpDirectory + '/mcp-host.json'] },
  ].map(command => ({ ...command, command: 'starforge' }));
}
export function commandText(command) {
  const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
  return [command.command, ...command.args.map(quote)].join(' ');
}
function guide(input, result, commands) {
  const command = id => '```sh\n' + commandText(commands.find(row => row.id === id)) + '\n```';
  return `# Merchant fleet launch\n\n` +
    `Prepare ${input.tenants.length} merchants with ${result.assignments.length} original release stores.\n\n` +
    `## Prepare the host\n\nUse the current complete Stellar Forge toolkit on Linux with Node.js 22.16 or later and the native flock utility. Follow its [distribution instructions](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/distribution/README.md). The commands below use the installed starforge executable; when installed in a local npm application, invoke it as npx --no-install starforge. Install the native requirements for the selected source types.\n\n` +
    `Prepare sources through the original API workspace, Python, DuckDB/Parquet, S3 or Stellar RPC authoring commands. Each source must declare its merchant's public HTTPS origin. Keep payment and provider credentials in the original host environment. For Python, provide the application description and its source root; interpreter and input paths use the original package rules. RPC packages retain their separate data and payment network selections.\n\n` +
    `Extract this packet and run the commands from its folder. Relative source paths resolve from fleet-setup.json. Keep that declaration at the same location for setup recovery. Review the absolute fleet and MCP paths for your host.\n\n` +
    `## Prepare the retained stores\n\n${command('setup')}\n\n` +
    `Repeat this same command to resume interrupted setup. It retains staging and initial activation progress in bootstrap.json, validates the original source packages, then publishes fleet-plan.json. Each merchant starts in the first declared slot. A completed setup preserves later release selections.\n\n` +
    `## Open the fleet\n\nChoose a foreground interface and close it before opening another. Every interface below uses the same plan and retained directory.\n\n### Browser workspace\n\n${command('workspace')}\n\nOpen the loopback URL printed by the original workspace.\n\n### Terminal operator\n\n${command('terminal')}\n\n### Merchant MCP\n\n${command('mcp-init')}\n\nRun MCP initialization once in its new configuration directory; its parent directory must already exist on the host. Its fleet reference points to the retained setup directory. Then create the original stdio host registration:\n\n${command('mcp-host')}\n\nUse mcp-host.json in your MCP client. The native registration command also supports --merge EXISTING_JSON with --output NEW_JSON to preserve other named servers. Starting a host connection loads the tools; the original fleet start tool starts the merchant processes explicitly.\n\n` +
    `## Host and port map\n\nGateway ingress: ${result.declaration.gateway.port}. Private gateway control: ${result.declaration.gateway.adminPort}. Browser workspace: ${result.workspacePort || 'automatically allocated'}.\n\n` +
    `| Merchant | Public host | Slot | Port | Initial |\n|---|---|---|---:|---|\n` +
    result.assignments.map(row => `| ${row.tenant} | ${row.host} | ${row.slot} | ${row.port} | ${row.startup ? 'Yes' : ''} |`).join('\n') +
    `\n\nEach store is retained at PRIVATE_FLEET_DIRECTORY/stores/MERCHANT/SLOT. Route HTTPS traffic for the declared public hosts to gateway ingress through your host's reverse proxy. Keep the control and workspace listeners private.\n\n` +
    `## Later releases\n\nUse the registered aliases with the original operator's stage, review, activate, drain, retire and rollback flow. See the [bootstrap guide](${GUIDE}BOOTSTRAP.md) and [release operator guide](${GUIDE}RELEASE_OPERATOR.md).\n\n` +
    `## Packet files\n\n- setup-input.json: editable workbench draft, including host handoff settings.\n- fleet-setup.json: original native bootstrap declaration.\n- commands.json: exact native command argument arrays.\n- README.md: host preparation, recovery and interface handoff.\n`;
}
export function createFleetPacket(input) {
  const result = validateFleetDraft(input);
  if (!result.valid) throw new FleetSetupError(result.errors);
  const commands = fleetCommands(input, result), folder = input.folder;
  const files = [
    ['setup-input.json', json(input)], ['fleet-setup.json', json(result.declaration)],
    ['commands.json', json({ schema: 'stellar-forge.fleet-launch-commands.v1', commands })],
    ['README.md', guide(input, result, commands)],
  ].map(([name, content]) => ({ path: folder + '/' + name, content }));
  return { ...result, commands, folder, files };
}
