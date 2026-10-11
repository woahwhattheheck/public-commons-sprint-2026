// MIT. Deploy the original managed fleet and private workspace as one host owner.
import { lstat, readFile, realpath, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFleetReleasePlan } from './release-operator.mjs';
import { unitWord, shellWord } from '../sf99-merchant-deploy/host.mjs';

export const FLEET_HOST_SCHEMA = 'stellar-forge.fleet-host.v1';
export const SOURCE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const COMPONENT = 'stellar/scf-starforge-20261009/merchant-fleet-gateway';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const inside = (root, path) => path === root || path.startsWith(root + '/');
const overlap = (a, b) => inside(a, b) || inside(b, a);
function fields(value, names, label) {
  need(object(value) && Object.keys(value).every(key => names.includes(key)), 'Invalid ' + label + ' fields');
}
function absolute(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && value === resolve(value) && value !== '/' &&
    !/[\\\x00-\x1f\x7f]/.test(value), label + ' must be an absolute normalized Linux path');
  return value;
}
function integer(value, low, high, label) {
  need(Number.isSafeInteger(value) && value >= low && value <= high, 'Invalid ' + label);
  return value;
}
async function regular(file, maximum = 1024 * 1024) {
  absolute(file, 'file');
  const info = await lstat(file);
  need(info.isFile() && !info.isSymbolicLink() && info.size <= maximum, 'Expected a bounded regular file: ' + file);
  const bytes = await readFile(file);
  need(bytes.length <= maximum, 'File grew beyond its size limit: ' + file);
  return bytes;
}
async function json(file) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(file)));
}
async function directory(path, label, { privateMode = false } = {}) {
  absolute(path, label);
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path,
    label + ' must be an existing real directory');
  need(!privateMode || (info.mode & 0o077) === 0, label + ' must have private permissions');
  return info;
}

/** Read the original retained plan; never start sellers, initialize stores or read secrets. */
export async function prepareFleetDeployment(deploymentFile, { sourceRoot = SOURCE_ROOT } = {}) {
  deploymentFile = absolute(resolve(deploymentFile), 'deployment declaration');
  sourceRoot = absolute(await realpath(sourceRoot), 'source release');
  await directory(sourceRoot, 'source release');
  const raw = await json(deploymentFile);
  fields(raw, ['schema', 'fleet', 'planFile', 'stateRoot', 'releaseDirectory', 'gatewayStateDirectory',
    'workspacePort', 'serviceUser', 'serviceGroup', 'serviceUid', 'serviceGid', 'node', 'environmentFile',
    'stopSeconds', 'readOnlyRoots', 'container', 'recoveryRoots'], 'fleet deployment');
  need(raw.schema === FLEET_HOST_SCHEMA && /^[a-z][a-z0-9-]{0,39}$/.test(raw.fleet ?? ''),
    'Fleet deployment schema and name required');
  const serviceUser = raw.serviceUser, serviceGroup = raw.serviceGroup ?? serviceUser;
  for (const [label, value] of [['serviceUser', serviceUser], ['serviceGroup', serviceGroup]])
    need(/^[a-z_][a-z0-9_-]{0,30}$/.test(value ?? '') && value !== 'root', 'Existing unprivileged ' + label + ' required');
  const stateRoot = absolute(raw.stateRoot, 'stateRoot');
  need(!overlap(sourceRoot, stateRoot), 'Keep fleet state separate from the immutable source release');
  const owner = await directory(stateRoot, 'stateRoot', { privateMode: true });
  const serviceUid = integer(raw.serviceUid ?? owner.uid, 1, 4294967294, 'serviceUid');
  const serviceGid = integer(raw.serviceGid ?? owner.gid, 1, 4294967294, 'serviceGid');
  need(owner.uid === serviceUid && owner.gid === serviceGid, 'stateRoot must belong to the declared service identity');
  const releaseDirectory = absolute(raw.releaseDirectory ?? stateRoot, 'releaseDirectory');
  const gatewayStateDirectory = absolute(raw.gatewayStateDirectory ?? join(releaseDirectory, 'gateway'), 'gatewayStateDirectory');
  need(inside(stateRoot, releaseDirectory) && inside(stateRoot, gatewayStateDirectory) &&
    releaseDirectory !== gatewayStateDirectory, 'Original manager and gateway state must be distinct within stateRoot');
  const manager = await directory(releaseDirectory, 'releaseDirectory', { privateMode: true });
  need(manager.uid === serviceUid, 'The original fleet manager must belong to the declared service identity');
  try {
    const gateway = await directory(gatewayStateDirectory, 'gatewayStateDirectory', { privateMode: true });
    need(gateway.uid === serviceUid, 'The original gateway state must belong to the declared service identity');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const planFile = absolute(raw.planFile, 'planFile');
  need(!inside(sourceRoot, planFile), 'Keep the private original fleet plan outside source');
  const plan = await readFleetReleasePlan(planFile);
  const ports = new Set([plan.gateway.port, plan.gateway.adminPort]);
  for (const tenant of plan.tenants) for (const slot of Object.values(tenant.slots)) {
    need(inside(stateRoot, slot.store) && slot.store !== stateRoot,
      'Every original slot store must remain inside the selected stateRoot');
    const info = await directory(slot.store, 'original slot store', { privateMode: true });
    need(info.uid === serviceUid, 'Every original slot store must belong to the declared service identity');
    ports.add(slot.port);
  }
  for (const port of ports) integer(port, 1024, 65535, 'unprivileged fleet port');
  const workspacePort = integer(raw.workspacePort ?? 8402, 1024, 65535, 'workspacePort');
  need(!ports.has(workspacePort), 'Workspace port collides with an original gateway or slot');
  const node = absolute(raw.node ?? '/usr/bin/node', 'Node executable');
  const stopSeconds = integer(raw.stopSeconds ?? 180, 90, 3600, 'stopSeconds');
  const environmentFile = raw.environmentFile === undefined ? null : absolute(raw.environmentFile, 'environmentFile');
  if (environmentFile) {
    need(!inside(stateRoot, environmentFile) && !inside(sourceRoot, environmentFile) &&
      ![planFile, deploymentFile].includes(environmentFile), 'Keep environmentFile separate from state, source and declarations');
    const info = await lstat(environmentFile);
    need(info.isFile() && !info.isSymbolicLink() && await realpath(environmentFile) === environmentFile &&
      !(info.mode & 0o077) && info.uid === serviceUid && info.size <= 1024 * 1024,
      'environmentFile must be a private regular file owned by the service identity');
  }
  const readOnlyRoots = raw.readOnlyRoots ?? [];
  need(Array.isArray(readOnlyRoots) && readOnlyRoots.length <= 32 && new Set(readOnlyRoots).size === readOnlyRoots.length,
    'Declare at most 32 distinct readOnlyRoots');
  for (const root of readOnlyRoots) {
    absolute(root, 'readOnlyRoots entry');
    const info = await lstat(root);
    need((info.isFile() || info.isDirectory()) && !info.isSymbolicLink() && await realpath(root) === root,
      'A read-only mount must be an existing real file or directory');
    need(!overlap(root, stateRoot) && !overlap(root, sourceRoot) &&
      !readOnlyRoots.some(other => other !== root && overlap(root, other)),
      'Additional read-only mounts must be separate from source, state and each other');
  }
  let container = null;
  if (raw.container !== undefined) {
    fields(raw.container, ['image', 'node'], 'container');
    need(typeof raw.container.image === 'string' &&
      /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64})$/.test(raw.container.image),
      'Select an existing immutable container image ID or digest');
    container = { image: raw.container.image, node: absolute(raw.container.node ?? node, 'container Node executable') };
  }
  const recoveryRoots = [{ name: 'fleetState', path: stateRoot }];
  for (const [name, path] of [['fleetPlan', planFile], ['deployment', deploymentFile]])
    if (!recoveryRoots.some(root => inside(root.path, path))) recoveryRoots.push({ name, path });
  need(Array.isArray(raw.recoveryRoots ?? []) && (raw.recoveryRoots?.length ?? 0) <= 16,
    'Declare at most 16 additional recoveryRoots');
  for (const root of raw.recoveryRoots ?? []) {
    fields(root, ['name', 'path'], 'recovery root');
    need(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(root.name ?? ''), 'Invalid recovery root name');
    absolute(root.path, 'recovery root');
    const info = await lstat(root.path);
    need((info.isFile() || info.isDirectory()) && !info.isSymbolicLink(), 'Recovery roots must be real files or directories');
    need(!recoveryRoots.some(existing => existing.name === root.name || overlap(existing.path, root.path)) &&
      !overlap(sourceRoot, root.path) && (!environmentFile || !inside(root.path, environmentFile)),
      'Recovery roots must be separate from source, environment values and other roots');
    recoveryRoots.push({ name: root.name, path: root.path });
  }
  const inputFiles = await Promise.all([...new Set([deploymentFile, planFile])]
    .map(async path => ({ path, sha256: sha(await regular(path)) })));
  const sourceEntries = await Promise.all(['deploy.mjs', 'deploy-cli.mjs', 'deploy-runtime.mjs',
    'release-operator.mjs', 'gateway.mjs', 'workspace/server.mjs', 'workspace/browser.mjs',
    'workspace/index.html', 'workspace/style.css'].map(async name => {
    const path = join(sourceRoot, COMPONENT, name);
    return { path, sha256: sha(await regular(path, 4 * 1024 * 1024)) };
  }));
  return { schema: FLEET_HOST_SCHEMA, fleet: raw.fleet, deploymentFile, sourceRoot,
    planFile, planDigest: plan.digest, stateRoot, releaseDirectory, gatewayStateDirectory,
    workspacePort, serviceUser, serviceGroup, serviceUid, serviceGid, node, environmentFile,
    stopSeconds, readOnlyRoots: [...readOnlyRoots], container, recoveryRoots, inputFiles, sourceEntries,
    unit: 'stellar-forge-fleet-' + raw.fleet + '.service',
    hosts: plan.tenants.map(tenant => tenant.host), gateway: plan.gateway };
}

export function fleetCaddyfile(p) {
  return '# Import this merchant-fleet site into the existing operator Caddyfile.\n' +
    '# Original Host and payment headers reach the existing exact-authority gateway.\n' +
    p.hosts.map(host => 'https://' + host).join(', ') + ' {\n' +
    '  reverse_proxy 127.0.0.1:' + p.gateway.port + ' {\n' +
    '    transport http {\n      keepalive off\n    }\n  }\n}\n';
}
const unitCommand = args => args.map((arg, index) => unitWord(arg, index > 0)).join(' ');
export function fleetServiceUnit(p, bundle) {
  const runtime = join(p.sourceRoot, COMPONENT, 'deploy-runtime.mjs');
  return `[Unit]\nDescription=Stellar Forge managed fleet ${p.fleet}\nWants=network-online.target\nAfter=network-online.target\n\n` +
    `[Service]\nType=exec\nUser=${p.serviceUser}\nGroup=${p.serviceGroup}\nUMask=0077\n` +
    `WorkingDirectory=${unitWord(p.sourceRoot)}\nEnvironment=PYTHONDONTWRITEBYTECODE=1\n` +
    `ExecStart=${unitCommand([p.node, runtime, 'run', '--bundle', bundle])}\n` +
    `Restart=on-failure\nRestartSec=5\nKillMode=mixed\nTimeoutStopSec=${p.stopSeconds}\n` +
    `NoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=read-only\n` +
    `ReadWritePaths=${unitWord(p.stateRoot)}\n\n[Install]\nWantedBy=multi-user.target\n`;
}
// Compose expands dollar signs even in JSON strings. Escape every string once.
function composeLiteral(value) {
  if (typeof value === 'string') return value.replaceAll('$', '$$');
  if (Array.isArray(value)) return value.map(composeLiteral);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, composeLiteral(item)]));
  return value;
}
export function fleetCompose(p, bundle) {
  need(p.container, 'A selected container image is required');
  const mounts = new Map();
  const mount = (path, readOnly) => mounts.set(path, { type: 'bind', source: path, target: path,
    read_only: readOnly, bind: { create_host_path: false } });
  mount(p.sourceRoot, true); mount(p.stateRoot, false); mount(bundle, true);
  for (const path of [...p.readOnlyRoots, p.deploymentFile, p.planFile, ...(p.environmentFile ? [p.environmentFile] : [])])
    if (!inside(p.sourceRoot, path) && !inside(bundle, path)) mount(path, true);
  const runtime = join(p.sourceRoot, COMPONENT, 'deploy-runtime.mjs');
  const service = {
    image: p.container.image, pull_policy: 'never', user: p.serviceUid + ':' + p.serviceGid,
    // Original SF82 ownership records retain the host hostname and process IDs.
    network_mode: 'host', pid: 'host', uts: 'host', userns_mode: 'host',
    read_only: true, restart: 'on-failure',
    working_dir: p.sourceRoot, entrypoint: [p.container.node, runtime], command: ['run', '--bundle', bundle],
    environment: { PYTHONDONTWRITEBYTECODE: '1' },
    volumes: [...mounts.values()], tmpfs: ['/tmp:rw,nosuid,nodev,mode=1777,size=67108864'],
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    stop_signal: 'SIGTERM', stop_grace_period: p.stopSeconds + 's',
    healthcheck: { test: ['CMD', p.container.node, runtime, 'health', '--bundle', bundle],
      interval: '30s', timeout: '20s', start_period: '60s', retries: 3 },
    logging: { driver: 'local', options: { 'max-size': '10m', 'max-file': '3' } },
  };
  return composeLiteral({ name: 'stellar-forge-fleet-' + p.fleet, services: { fleet: service } });
}

export function fleetDeploymentRunbook(p, bundle) {
  const q = shellWord, cli = join(p.sourceRoot, COMPONENT, 'deploy-cli.mjs');
  const runtime = join(p.sourceRoot, COMPONENT, 'deploy-runtime.mjs');
  const originalRecovery = join(p.sourceRoot, 'stellar/scf-starforge-20261009/sf101-merchant-recovery/recover.mjs');
  const base = q(p.node) + ' ' + q(cli), health = q(p.node) + ' ' + q(runtime) + ' health --bundle ' + q(bundle);
  let text = `# ${p.fleet}: managed merchant fleet\n\n` +
    `This bundle starts the original private fleet workspace and its complete managed release operator in one process. ` +
    `${p.hosts.length} merchants retain their own stores, slots, payment terms and original seller handles.\n\n` +
    `Public hosts: ${p.hosts.join(', ')}. Gateway: 127.0.0.1:${p.gateway.port}; private gateway control: ` +
    `127.0.0.1:${p.gateway.adminPort}; operator workspace: http://127.0.0.1:${p.workspacePort}.\n\n` +
    `## Prepare the service identity and source\n\n` +
    `Use the selected immutable source at ${q(p.sourceRoot)}, Node 22.16 or newer, Linux flock, and the original ` +
    `provider dependencies for these retained merchants. The Linux account ${p.serviceUser}:${p.serviceGroup} must resolve ` +
    `to UID ${p.serviceUid}, GID ${p.serviceGid}. All original stores and manager state are within ${q(p.stateRoot)}. ` +
    `Keep this directory private and owned by that account. Original retained releases govern their own contents.\n\n` +
    `The generated bundle starts private. Install its files read-only to the service group before startup:\n\n` +
    '```sh\n' + `chown -R root:${p.serviceGroup} ${q(bundle)}\nchmod 0750 ${q(bundle)}\n` +
    `find ${q(bundle)} -maxdepth 1 -type f -exec chmod 0640 {} +\n` +
    `sudo -u ${p.serviceUser} ${base} check --bundle ${q(bundle)}\n` + '```\n\n' +
    (p.environmentFile ? `The selected ${q(p.environmentFile)} is loaded by Node's native process.loadEnvFile before the original ` +
      `operator is opened. Use Node .env syntax, with 0600 permissions owned by UID ${p.serviceUid}. This same parser is used ` +
      `under systemd and Compose. Existing process environment values take precedence. Secret values stay in this file.\n\n` : '') +
    `## Native systemd service\n\n` + '```sh\n' +
    `install -o root -g root -m 0644 ${q(join(bundle, p.unit))} ${q('/etc/systemd/system/' + p.unit)}\n` +
    `systemctl daemon-reload\nsystemctl enable --now ${p.unit}\n${health}\n` +
    `systemctl status ${p.unit}\njournalctl -u ${p.unit} -n 50\n` + '```\n\n' +
    `Use the returned health report to confirm the original managed plan and every serving merchant. ` +
    `Inspect the original browser workspace to stage, review, activate, retire and roll back releases. ` +
    `From another computer, forward the identical local port with your existing SSH host alias:\n\n` +
    '```sh\n' + `ssh -N -L 127.0.0.1:${p.workspacePort}:127.0.0.1:${p.workspacePort} YOUR_EXISTING_HOST_ALIAS\n` + '```\n\n' +
    `Open http://127.0.0.1:${p.workspacePort} locally. Keeping the port identical preserves the original workspace Host/Origin ` +
    `and merchant navigation checks. The workspace owns the running fleet; use its current controls for changes.\n\n`;
  if (p.container) text += `## Docker Compose on the same Linux host\n\n` +
    `The selected cached runtime image is ${p.container.image}; its Node executable is ${q(p.container.node)}. ` +
    `It must include Linux flock and all original provider interpreters/libraries at their retained paths. ` +
    `The selected source and extra read-only inputs are bound at the same absolute paths. One container owns the complete fleet; ` +
    `Use Linux Docker Engine with Compose 2.15.1 or later. Host network, PID, UTS and user namespaces preserve ` +
    `the original loopback listeners, hostname/PID lease identities and numeric state ownership across container replacement. ` +
    `The signal-owning Node runtime runs directly under the declared non-root UID/GID.\n\n` +
    '```sh\n' + `docker compose -f ${q(join(bundle, 'compose.json'))} config --quiet\n` +
    `docker compose -f ${q(join(bundle, 'compose.json'))} up -d --pull never --wait --wait-timeout 180\n` +
    `docker compose -f ${q(join(bundle, 'compose.json'))} ps\n` +
    `docker compose -f ${q(join(bundle, 'compose.json'))} logs --tail 50 fleet\n` + '```\n\n' +
    `Choose systemd or Compose for this state. Stop the existing owner before changing service manager; ` +
    `the original fleet lease also enforces single ownership. Docker engine access stays with the host operator. ` +
    `The generated container gets only source, bundle, declared input and state bindings.\n\n`;
  text += `## Public HTTPS ingress\n\n` +
    `Point these declared merchant DNS names to your existing TLS host. Import ${q(join(bundle, 'Caddyfile'))} into that host's ` +
    `current Caddyfile, validate the complete configuration and reload through your existing proxy operation. ` +
    `The gateway applies its original exact-authority and route checks. Backend keepalive is disabled to prevent an implicit ` +
    `paid-GET retry on a stale reused connection. Only the fleet ingress is proxied.\n\n` +
    `## Drain, upgrade and reopen\n\n` +
    `Remove this fleet's public ingress from service first. Stop its chosen manager:\n\n` + '```sh\n' +
    `systemctl stop ${p.unit}\n` + (p.container ? `# For the Compose installation instead:\ndocker compose -f ${q(join(bundle, 'compose.json'))} stop\n` : '') +
    '```\n\n' +
    `The native workspace cancels its owned pending stage and finishes original operations, then the gateway drains admitted ` +
    `requests before its original SF82 sessions close. The service manager allows ${p.stopSeconds} seconds; set a larger ` +
    `stopSeconds in a new declaration when your provider's original shutdown needs longer. After an unsuccessful or forced stop, ` +
    `inspect the original fleet and provider journals before reopening.\n\n` +
    `Select the next retained source with the existing distributor; generate a new bundle from this declaration, install its ` +
    `service or select its runtime image, start and check health, then restore ingress. The original plan digest stays ` +
    `${p.planDigest}. Live stage/activate changes preserve it; host/slot/package-registration edits require a new declaration review. ` +
    `An unchanged restart reopens the original fleet mapping and revisions.\n\n` +
    `## Encrypted recovery\n\n` +
    `After the native owner has fully stopped, close external database/file writers selected by the recovery plan. ` +
    `Use the existing private recovery passphrase environment and the original SF101 engine:\n\n` + '```sh\n' +
    `${q(p.node)} ${q(originalRecovery)} snapshot --plan ${q(join(bundle, 'recovery-plan.json'))} ` +
    `--out /private/backups/NEW_FLEET_BACKUP --pass-env SF101_RECOVERY_PASSPHRASE --quiesced\n` +
    `${q(p.node)} ${q(originalRecovery)} verify --bundle /private/backups/NEW_FLEET_BACKUP --pass-env SF101_RECOVERY_PASSPHRASE\n` +
    `${q(p.node)} ${q(originalRecovery)} restore --bundle /private/backups/NEW_FLEET_BACKUP ` +
    `--out /private/restores/NEW_FLEET_RESTORE --pass-env SF101_RECOVERY_PASSPHRASE\n` + '```\n\n' +
    `Restore produces a new private directory with these logical roots:\n\n` +
    p.recoveryRoots.map(root => `- ${root.name}: ${q(root.path)}`).join('\n') + '\n\n' +
    `For host recovery, retain the original absolute locations on the replacement host. Install the verified source/runtime, ` +
    `place each authenticated restored root at its corresponding absent original path, restore service UID/GID ownership, ` +
    `and supply environment values through their existing separate mechanism. Regenerate the bundle at its original location ` +
    `or choose a new bundle directory and install it. Reopen, inspect original health/release mapping, then restore public ingress. ` +
    `The state contains the original absolute store references and plan digest, so relocating those stores is a separate ` +
    `original fleet migration operation. Add selected external file/data roots through recoveryRoots before capture; ` +
    `source images and live external databases keep their existing distribution and native recovery procedures.\n`;
  return text;
}

export async function generateFleetDeployment(deploymentFile, output, options) {
  const p = await prepareFleetDeployment(deploymentFile, options), bundle = absolute(resolve(output), 'bundle');
  need(!overlap(bundle, p.sourceRoot) && !overlap(bundle, p.stateRoot) &&
    !p.inputFiles.some(file => inside(bundle, file.path)) &&
    !p.readOnlyRoots.some(root => overlap(bundle, root)) &&
    (!p.environmentFile || !inside(bundle, p.environmentFile)), 'Keep the new bundle separate from source, state and inputs');
  const files = new Map([
    ['Caddyfile', fleetCaddyfile(p)], [p.unit, fleetServiceUnit(p, bundle)],
    ['recovery-plan.json', JSON.stringify({ schema: 'stellar-forge.merchant-recovery-plan.v1', roots: p.recoveryRoots }, null, 2) + '\n'],
    ['RUNBOOK.md', fleetDeploymentRunbook(p, bundle)],
  ]);
  if (p.container) files.set('compose.json', JSON.stringify(fleetCompose(p, bundle), null, 2) + '\n');
  const manifest = { ...p, bundle, artifacts: Object.fromEntries([...files].map(([name, bytes]) => [name, sha(bytes)])) };
  let created = false;
  try {
    await mkdir(bundle, { mode: 0o700 }); created = true;
    for (const [name, bytes] of files) await writeFile(join(bundle, name), bytes, { flag: 'wx', mode: 0o600 });
    await writeFile(join(bundle, 'fleet-deployment.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) { if (created) await rm(bundle, { recursive: true, force: true }); throw error; }
  return { bundle, fleet: p.fleet, planDigest: p.planDigest, unit: p.unit, hosts: p.hosts,
    workspace: 'http://127.0.0.1:' + p.workspacePort, files: files.size + 1, container: Boolean(p.container) };
}

/** Check retained declaration, native plan and generated bytes without opening a fleet. */
export async function checkFleetBundle(bundle) {
  bundle = absolute(resolve(bundle), 'bundle');
  const saved = await json(join(bundle, 'fleet-deployment.json'));
  need(saved.schema === FLEET_HOST_SCHEMA && saved.bundle === bundle && object(saved.artifacts),
    'Original fleet deployment manifest required at its generated location');
  const prepared = await prepareFleetDeployment(saved.deploymentFile, { sourceRoot: saved.sourceRoot });
  const { bundle: ignoredBundle, artifacts, ...retained } = saved;
  need(JSON.stringify(retained) === JSON.stringify(prepared),
    'Fleet deployment declaration, source or plan changed; generate a new bundle');
  const required = ['Caddyfile', saved.unit, 'recovery-plan.json', 'RUNBOOK.md', ...(saved.container ? ['compose.json'] : [])];
  need(Object.keys(artifacts).length === required.length && required.every(name => Object.hasOwn(artifacts, name)),
    'Fleet deployment artifact set changed');
  for (const [name, expected] of Object.entries(artifacts)) {
    need(/^[A-Za-z0-9_.-]+$/.test(name) && /^[a-f0-9]{64}$/.test(expected), 'Invalid deployment artifact');
    need(sha(await regular(join(bundle, name), 4 * 1024 * 1024)) === expected, 'Fleet deployment artifact changed: ' + name);
  }
  const plan = await readFleetReleasePlan(saved.planFile);
  need(plan.digest === saved.planDigest, 'Original fleet plan changed during deployment inspection');
  return { ...saved, plan };
}
