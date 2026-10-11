// MIT. Generate an operator-owned Linux host configuration for the original product.
import { readFile, lstat, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readSellerConfig } from '../sf30-seller-sdk/serve.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { readCheckout } from '../sf101-merchant-receiver/checkout-config.mjs';

export const SCHEMA = 'stellar-forge.merchant-host.v1';
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BASE = 'stellar/scf-starforge-20261009/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const need = (yes, message) => { if (!yes) throw new Error(message); };
const inside = (root, path) => path === root || path.startsWith(root + '/');
const keys = (x, allowed, name) => need(object(x) && Object.keys(x).every(k => allowed.includes(k)), 'Unknown or invalid ' + name + ' field');
function path(value, name) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !/[\\\x00-\x1f\x7f]/.test(value), name + ' must be an absolute normalized path');
  return value;
}
function integer(value, fallback, low, high, name) {
  value ??= fallback;
  need(Number.isInteger(value) && value >= low && value <= high, 'Invalid ' + name);
  return value;
}
function origin(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Canonical public HTTPS origin required'); }
  need(url.protocol === 'https:' && url.origin === value && !url.port && !url.username && !url.password &&
    url.pathname === '/' && !url.search && !url.hash && url.hostname.length <= 253 &&
    url.hostname.includes('.') && url.hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !/^\d+(?:\.\d+){3}$/.test(url.hostname), 'Use the exact public HTTPS DNS origin, without a port or path');
  return url;
}
function https(value, name) {
  let u; try { u = new URL(value); } catch { throw new Error('Invalid ' + name); }
  need(u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search && u.href === value,
    name + ' must be a canonical HTTPS URL without credentials, query or fragment');
  return u;
}
async function bytes(file, maximum = 1024 * 1024) {
  const info = await lstat(file);
  need(info.isFile() && !info.isSymbolicLink() && info.size <= maximum, 'Regular bounded source file required: ' + file);
  const result = await readFile(file);
  need(result.length <= maximum, 'Input grew beyond size limit');
  return result;
}
const json = async file => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(file)));
// systemd specifier and environment expansion are independent from shell quoting.
export const unitWord = (value, command = false) => '"' + String(value).replaceAll('%', '%%')
  .replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', () => command ? '$$' : '$') + '"';
export const shellWord = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
// systemd expands environment variables in arguments, not the executable token.
const commandLine = args => args.map((value, index) => unitWord(value, index > 0)).join(' ');
const regex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const routePattern = binding => '^' + binding.segments.map(segment => segment.startsWith(':') ? '[^/]+' : regex(segment)).join('/') + '$';

export async function prepare(planFile, { sourceRoot = ROOT } = {}) {
  planFile = path(resolve(planFile), 'plan'); sourceRoot = path(await realpath(sourceRoot), 'sourceRoot');
  const raw = await json(planFile);
  keys(raw, ['schema','merchant','serviceUser','serviceGroup','kind','mode','config','privateRoot',
    'environmentFile','facilitator','handlers','upstreams','allowLoopbackUpstream','ports','runtime',
    'delivery','maxInFlight','drainGraceMs','historyDays'], 'host plan');
  need(raw.schema === SCHEMA && /^[a-z][a-z0-9-]{0,39}$/.test(raw.merchant ?? ''), 'Host schema and merchant ID required');
  need(/^[a-z_][a-z0-9_-]{0,30}$/.test(raw.serviceUser ?? '') && raw.serviceUser !== 'root', 'Existing unprivileged serviceUser required');
  const group = raw.serviceGroup ?? raw.serviceUser;
  need(/^[a-z_][a-z0-9_-]{0,30}$/.test(group) && group !== 'root', 'Unprivileged serviceGroup required');
  need(['api','paid-file'].includes(raw.kind) && ['challenge','native'].includes(raw.mode), 'Explicit kind and mode required');
  const configPath = path(raw.config, 'config'), stateRoot = path(raw.privateRoot, 'privateRoot');
  need(!inside(sourceRoot, stateRoot) && !inside(stateRoot, sourceRoot), 'Merchant state must be outside the source release');
  const runtime = raw.runtime ?? {}; keys(runtime, ['node','python'], 'runtime');
  const node = path(runtime.node ?? process.execPath, 'Node executable');
  const python = path(runtime.python ?? '/usr/bin/python3', 'Python executable');
  const ports = raw.ports ?? {}; keys(ports, ['seller','operations','receiver'], 'ports');
  const sellerPort = integer(ports.seller, 8423, 1024, 65535, 'seller port');
  const operationsPort = integer(ports.operations, 8424, 1024, 65535, 'operations port');
  const receiverPort = integer(ports.receiver, 8472, 1024, 65535, 'receiver port');
  need(new Set([sellerPort, operationsPort, ...(raw.kind === 'paid-file' ? [receiverPort] : [])]).size ===
    (raw.kind === 'paid-file' ? 3 : 2), 'Component ports must differ');
  const maxInFlight = integer(raw.maxInFlight, 64, 1, 1024, 'maxInFlight');
  const drainGraceMs = integer(raw.drainGraceMs, 60000, 1000, 300000, 'drainGraceMs');
  const historyDays = integer(raw.historyDays, 90, 1, 365, 'historyDays');
  if (raw.kind === 'paid-file') need(raw.handlers === undefined && raw.upstreams === undefined &&
    raw.allowLoopbackUpstream === undefined && raw.historyDays === undefined && raw.maxInFlight === undefined &&
    raw.drainGraceMs === undefined, 'Paid-file checkout keeps its original runtime options');
  need(!(raw.handlers && raw.upstreams), 'Choose handlers or upstreams');
  need(raw.allowLoopbackUpstream === undefined || typeof raw.allowLoopbackUpstream === 'boolean', 'Invalid allowLoopbackUpstream');
  need(!raw.allowLoopbackUpstream || raw.upstreams, 'Loopback upstream requires bindings');
  const inputs = [configPath];
  for (const name of ['handlers','upstreams']) if (raw[name]) inputs.push(path(raw[name], name));
  const checkout = raw.kind === 'paid-file' ? await readCheckout(configPath) : null;
  const config = checkout ? checkout.service : await readSellerConfig(configPath);
  const publicUrl = origin(config.publicOrigin);
  const compiled = compileSellerRoutes(config.routes.map(route => ({ id: route.id,
    ...(route.offer ? { offer: route.offer } : { definition: { ...route.definition, url: publicUrl.origin + route.path } }),
    handler: async () => { throw new Error('Deployment preparation does not execute a merchant operation'); },
  })));
  if (!checkout && config.routes.some(route => route.handler || route.admit))
    need(raw.handlers || raw.upstreams, 'Configured application exports require handlers or upstream bindings');
  if (raw.mode === 'native') {
    need(raw.facilitator, 'Native deployment requires the selected facilitator');
    https(raw.facilitator.endsWith('/') ? raw.facilitator : raw.facilitator + '/', 'facilitator');
    for (const route of compiled.routes) for (const terms of route.offer.accepts)
      need(!/UNVERIFIED_DEMO_|REPLACE_|YOUR_ASSET|YOUR_RECIPIENT/i.test(terms.asset + ' ' + terms.payTo),
        'Replace demonstration payment markers with the merchant\'s approved native terms');
  } else need(raw.facilitator === undefined, 'Challenge mode does not select a facilitator');
  const outbox = checkout?.outbox ?? join(stateRoot, 'outbox');
  const receiverState = checkout?.state ?? null;
  need(inside(stateRoot, outbox) && outbox !== stateRoot && (!receiverState ||
    inside(stateRoot, receiverState) && receiverState !== stateRoot && !inside(outbox, receiverState) && !inside(receiverState, outbox)),
    'Original outbox and receiver store must be separate descendants of privateRoot');
  let delivery = raw.delivery;
  if (checkout) delivery ??= {};
  if (delivery !== undefined) {
    keys(delivery, ['url','allowHost','limit','concurrency','pollMs','timeoutMs'], 'delivery');
    const url = checkout ? publicUrl.origin + '/internal/x402-events' : delivery.url;
    need(!checkout || delivery.url === undefined && delivery.allowHost === undefined,
      'Paid-file delivery uses its original merchant origin and generated receiver route');
    const target = https(url, 'webhook');
    const allowHost = checkout ? publicUrl.hostname : delivery.allowHost;
    need(allowHost === target.hostname, 'Webhook allowHost must equal the selected URL hostname');
    delivery = { url, allowHost, limit: integer(delivery.limit, 20, 1, 100, 'delivery limit'),
      concurrency: integer(delivery.concurrency, 1, 1, 16, 'delivery concurrency'),
      pollMs: integer(delivery.pollMs, 5000, 50, 60000, 'delivery pollMs'),
      timeoutMs: integer(delivery.timeoutMs, 7000, 100, 60000, 'delivery timeoutMs') };
  }
  const environmentFile = raw.environmentFile === undefined ? null : path(raw.environmentFile, 'environmentFile');
  need(!environmentFile || !/\s$/.test(environmentFile), 'Environment-file path must not end with config-line whitespace');
  need(!delivery || environmentFile, 'Signed delivery requires the private shared environmentFile path');
  need(!environmentFile || !inside(stateRoot, environmentFile) && !inside(sourceRoot, environmentFile) &&
    !inputs.includes(environmentFile), 'Keep environmentFile outside source, state and selected configuration files');
  const prefix = 'stellar-forge-' + raw.merchant;
  const entry = name => join(sourceRoot, BASE + name);
  const sellerArgs = checkout ? [node, entry('sf101-merchant-receiver/checkout.mjs'), 'serve', '--config', configPath,
    '--port', sellerPort, '--operations-port', operationsPort, ...(raw.mode === 'native' ? ['--facilitator', raw.facilitator] : [])] :
    raw.mode === 'native' ? [node, entry('sf30-seller-sdk/operations/merchant-launch.mjs'), '--config', configPath,
      '--state', outbox, '--facilitator', raw.facilitator, '--port', sellerPort, '--operations-port', operationsPort,
      '--max-in-flight', maxInFlight, '--drain-grace-ms', drainGraceMs,
      '--history-dir', join(stateRoot, 'usage'), '--history-days', historyDays,
      ...(raw.handlers ? ['--handlers', raw.handlers] : []), ...(raw.upstreams ? ['--upstreams', raw.upstreams] : []),
      ...(raw.allowLoopbackUpstream ? ['--allow-loopback-upstream'] : [])] :
    [node, entry('sf30-seller-sdk/operations/launch.mjs'), '--operations-port', operationsPort, '--',
      '--config', configPath, '--port', sellerPort, '--max-in-flight', maxInFlight, '--drain-grace-ms', drainGraceMs,
      ...(raw.handlers ? ['--handlers', raw.handlers] : [])];
  need(raw.mode !== 'challenge' || !raw.upstreams, 'Challenge API profile supports original static/configured handlers; use native for upstream bindings');
  const services = [{ role: 'seller', unit: prefix + '-seller.service', args: sellerArgs.map(String),
    stopSeconds: Math.ceil(drainGraceMs / 1000) + 20 }];
  if (checkout) services.push({ role: 'receiver', unit: prefix + '-receiver.service',
    args: [python, entry('sf101-merchant-receiver/receiver.py'), 'serve', '--state', receiverState,
      '--host','127.0.0.1','--port',String(receiverPort),'--secret-env','SF98_WEBHOOK_SECRET'],
    initialize: [python, entry('sf101-merchant-receiver/receiver.py'),'init','--state',receiverState], stopSeconds: 20 });
  if (delivery) services.push({ role: 'delivery', unit: prefix + '-delivery.service',
    args: [node, entry('sf98-merchant-delivery/worker.mjs'),'run','--state',outbox,'--url',delivery.url,
      '--allow-host',delivery.allowHost,'--secret-env','SF98_WEBHOOK_SECRET','--limit',String(delivery.limit),
      '--concurrency',String(delivery.concurrency),'--poll-ms',String(delivery.pollMs),'--timeout-ms',String(delivery.timeoutMs)], stopSeconds: 20 });
  const sourceFiles = [...new Set(services.flatMap(s => [s.args[1], ...(s.initialize ? [s.initialize[1]] : [])]))];
  const inputFiles = await Promise.all(inputs.map(async file => ({ path: file, sha256: hash(await bytes(file)) })));
  const sourceEntries = await Promise.all(sourceFiles.map(async file => ({ path: file, sha256: hash(await bytes(file, 4 * 1024 * 1024)) })));
  const routes = compiled.routes.map(route => ({ id: route.id, method: route.method, path: route.path,
    pattern: routePattern(route.binding), samplePath: route.binding.samplePath }));
  if (checkout) need(!routes.some(r => ['/internal/x402-events','/sf98/events','/deliver'].includes(r.path) ||
    r.path.startsWith('/deliver/')), 'Checkout route collides with its original file delivery routes');
  return { schema: SCHEMA, merchant: raw.merchant, kind: raw.kind, mode: raw.mode, sourceRoot,
    serviceUser: raw.serviceUser, serviceGroup: group, configPath, stateRoot, environmentFile,
    node, python, publicOrigin: publicUrl.origin, hostname: publicUrl.hostname, sellerPort, operationsPort,
    receiverPort: checkout ? receiverPort : null, outbox, receiverState, delivery: delivery ?? null,
    target: prefix + '.target', services, routes, inputFiles, sourceEntries, planFile };
}

const DOC_PATHS = ['/_seller/offers','/_seller/docs','/_seller/docs/','/_seller/openapi.json',
  '/_seller/developer/browser.mjs','/_seller/developer/request.mjs','/_seller/developer/style.css',
  '/_seller/client/seller-client.mjs','/_seller/client/seller-client.d.mts','/_seller/client/README.md','/_seller/client/package.json'];
export function caddyfile(p) {
  const blocks = p.routes.map((r, i) => `  @route${i} {\n    method ${r.method}\n    path_regexp route${i} ${JSON.stringify(r.pattern)}\n  }\n  handle @route${i} {\n    reverse_proxy 127.0.0.1:${p.sellerPort} {\n      transport http {\n        keepalive off\n      }\n    }\n  }`);
  blocks.push(`  @documentation {\n    method GET HEAD\n    path ${DOC_PATHS.join(' ')}\n  }\n  handle @documentation {\n    reverse_proxy 127.0.0.1:${p.sellerPort} {\n      transport http {\n        keepalive off\n      }\n    }\n  }`);
  if (p.receiverState) blocks.push(
    `  @settledEvent {\n    method POST\n    path /internal/x402-events\n  }\n  handle @settledEvent {\n    rewrite * /sf98/events\n    reverse_proxy 127.0.0.1:${p.receiverPort} {\n      transport http {\n        keepalive off\n      }\n    }\n  }`,
    `  @approvedFile {\n    method GET\n    path_regexp approvedFile ^/deliver/[A-Za-z0-9._:-]{1,80}$\n  }\n  handle @approvedFile {\n    reverse_proxy 127.0.0.1:${p.receiverPort} {\n      transport http {\n        keepalive off\n      }\n    }\n  }`);
  return `# Import this site's fragment into the existing Caddyfile.\n# Query, payment, order and bearer headers pass unchanged. No automatic retries or access log.\n${p.publicOrigin} {\n${blocks.join('\n')}\n  handle {\n    respond "Not found" 404\n  }\n}\n`;
}

export function serviceUnit(p, s, bundle) {
  // Start receiver -> sender -> seller; stop seller -> sender -> receiver.
  const predecessor = s.role === 'seller' && p.delivery ? p.services.find(x => x.role === 'delivery')?.unit :
    s.role === 'delivery' && p.receiverState ? p.services.find(x => x.role === 'receiver')?.unit : null;
  const check = [p.node, join(p.sourceRoot, BASE + 'sf99-merchant-deploy/cli.mjs'), 'check', '--bundle', bundle];
  return `[Unit]\nDescription=Stellar Forge ${p.merchant} ${s.role}\nWants=network-online.target\nAfter=network-online.target${predecessor ? ' ' + predecessor : ''}\nPartOf=${p.target}\n\n[Service]\nType=exec\nUser=${p.serviceUser}\nGroup=${p.serviceGroup}\nWorkingDirectory=${(/\s$/.test(p.sourceRoot) ? p.sourceRoot + '/.' : p.sourceRoot).replaceAll('%', '%%')}\nUMask=0077\n${p.environmentFile ? 'EnvironmentFile=' + p.environmentFile.replaceAll('%', '%%') + '\n' : ''}Environment=PYTHONDONTWRITEBYTECODE=1\nExecStartPre=${commandLine(check)}\n${s.initialize ? 'ExecStartPre=' + commandLine(s.initialize) + '\n' : ''}ExecStart=${commandLine(s.args)}\nRestart=on-failure\nRestartSec=5\n${s.role === 'delivery' ? 'RestartPreventExitStatus=75\n' : ''}KillMode=mixed\nTimeoutStopSec=${s.stopSeconds}\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=read-only\nReadWritePaths=${unitWord(p.stateRoot)}\n\n[Install]\nWantedBy=${p.target}\n`;
}
export function recoveryPlan(p) {
  const roots = [{ name: 'merchantState', path: p.stateRoot }];
  for (const [i, input] of p.inputFiles.entries()) if (!inside(p.stateRoot, input.path)) roots.push({ name: 'configuration' + i, path: input.path });
  return { schema: 'stellar-forge.merchant-recovery-plan.v1', roots };
}
export async function generate(planFile, output, options) {
  const p = await prepare(planFile, options), out = path(resolve(output), 'output');
  need(!inside(p.sourceRoot, out) && !inside(p.stateRoot, out) && !inside(out, p.stateRoot) &&
    !p.inputFiles.some(f => inside(out, f.path)), 'Deployment bundle must be separate from code, inputs and merchant state');
  const artifacts = new Map([['Caddyfile', caddyfile(p)], [p.target,
    `[Unit]\nDescription=Stellar Forge ${p.merchant} merchant services\nWants=${p.services.map(s => s.unit).join(' ')}\nAfter=network-online.target\n\n[Install]\nWantedBy=multi-user.target\n`],
    ['recovery-plan.json', JSON.stringify(recoveryPlan(p), null, 2) + '\n']]);
  for (const s of p.services) artifacts.set(s.unit, serviceUnit(p, s, out));
  const { renderRunbook } = await import('./runbook.mjs');
  artifacts.set('RUNBOOK.md', renderRunbook(p, out));
  const manifest = { ...p, bundle: out, artifacts: Object.fromEntries([...artifacts].map(([name, value]) => [name, hash(value)])) };
  let created = false;
  try {
    await mkdir(out, { mode: 0o700 }); created = true;
    for (const [name, value] of artifacts) await writeFile(join(out, name), value, { flag: 'wx', mode: 0o600 });
    await writeFile(join(out, 'deployment.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { bundle: out, merchant: p.merchant, kind: p.kind, mode: p.mode, publicOrigin: p.publicOrigin,
      target: p.target, services: p.services.map(s => s.unit), routes: p.routes.length, files: artifacts.size + 1 };
  } catch (error) { if (created) await rm(out, { recursive: true, force: true }); throw error; }
}

export async function checkBundle(bundle) {
  bundle = path(resolve(bundle), 'bundle');
  const p = await json(join(bundle, 'deployment.json'));
  need(p.schema === SCHEMA && p.bundle === bundle && object(p.artifacts) &&
    Array.isArray(p.inputFiles) && Array.isArray(p.sourceEntries), 'Original deployment manifest required at its generated path');
  for (const [name, expected] of Object.entries(p.artifacts)) {
    need(/^[A-Za-z0-9_.-]+$/.test(name) && /^[a-f0-9]{64}$/.test(expected), 'Invalid deployment artifact');
    need(hash(await bytes(join(bundle, name), 4 * 1024 * 1024)) === expected, 'Deployment artifact changed: ' + name);
  }
  for (const item of [...p.inputFiles, ...p.sourceEntries]) {
    path(item.path, 'retained input');
    need(hash(await bytes(item.path, 4 * 1024 * 1024)) === item.sha256, 'Source/configuration changed; regenerate the host bundle: ' + item.path);
  }
  if (p.environmentFile) {
    const env = await lstat(p.environmentFile);
    need(env.isFile() && !env.isSymbolicLink() && (env.mode & 0o077) === 0,
      'Use a private regular environmentFile with no group or world access');
  }
  return p;
}
