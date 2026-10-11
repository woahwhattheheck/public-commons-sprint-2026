#!/usr/bin/env node
// MIT. Docker Compose host operations for the original merchant maintenance engine.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readdir, chown, chmod, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { checkBundle, prepare } from './host.mjs';
import { prepareRestoredHost } from './restore-host.mjs';
import { runMaintenance } from './maintenance.mjs';
import { MAINTENANCE_SCHEMA, absolute, privateDirectory, regular, jsonFile,
  atomicFile, atomicJSON, removeOwned, digest, inside, need, maintenanceFragment } from './maintenance-system.mjs';

const exec = promisify(execFile);
const SELECTION_SCHEMA = 'stellar-forge.merchant-container-selection.v1';
const MARKER_SCHEMA = 'stellar-forge.merchant-container-maintenance.v1';
const CONTAINER_SCHEMA = 'stellar-forge.merchant-container.v1';
const BASE = 'stellar/scf-starforge-20261009/sf99-merchant-deploy/';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, names, description) => need(isObject(value) &&
  Object.keys(value).every(key => names.includes(key)), 'Invalid ' + description);
const exists = async file => { try { await lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const containerAPI = () => import('./container.mjs');
const markerPath = p => join(p.stateRoot, '.container-runtime', 'maintenance.json');
const operationId = id => {
  need(typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(id), 'Original maintenance operation ID required');
  return id;
};

/** Read a Compose deployment without reinterpreting its original host inputs. */
export async function loadContainerMaintenance(planFile) {
  const file = absolute(resolve(planFile), 'maintenance plan'), rawBytes = await regular(file);
  const raw = JSON.parse(rawBytes);
  fields(raw, ['schema', 'bundle', 'containerBundle', 'operationsRoot', 'caddy', 'recoveryPlan',
    'passphraseEnv', 'runtime', 'restoreContainer'], 'container maintenance plan');
  need(raw.schema === MAINTENANCE_SCHEMA, 'Original merchant maintenance schema required');
  const { checkContainer, validateContainerSpec } = await containerAPI();
  const selected = await checkContainer(absolute(raw.containerBundle, 'container bundle'));
  const p = selected.host, container = selected.container;
  need(p.bundle === absolute(raw.bundle, 'original host bundle') && container.hostBundle === p.bundle,
    'Select the original nested host bundle of this container deployment');
  const repeated = await prepare(p.planFile, { sourceRoot: p.sourceRoot });
  for (const key of Object.keys(repeated)) need(JSON.stringify(repeated[key]) === JSON.stringify(p[key]),
    'Original host plan no longer reproduces the installed bundle: ' + key);
  const operationsRoot = absolute(raw.operationsRoot, 'operationsRoot');
  await privateDirectory(operationsRoot);
  need((await lstat(operationsRoot)).uid === 0, 'Operation journal must belong to the host administrator');
  fields(raw.caddy, ['fragment', 'config', 'binary'], 'Caddy configuration');
  const caddy = { fragment: absolute(raw.caddy.fragment, 'merchant fragment'),
    config: absolute(raw.caddy.config, 'Caddy config'), binary: absolute(raw.caddy.binary ?? '/usr/bin/caddy', 'Caddy binary') };
  need(caddy.fragment !== caddy.config, 'Select the merchant fragment imported by the existing Caddy configuration');
  await regular(caddy.fragment); await regular(caddy.config);
  fields(raw.runtime ?? {}, ['docker'], 'container maintenance runtime');
  const docker = absolute(raw.runtime?.docker ?? '/usr/bin/docker', 'Docker executable');
  const recoveryPlan = absolute(raw.recoveryPlan ?? join(p.bundle, 'recovery-plan.json'), 'recovery plan');
  const recoveryBytes = await regular(recoveryPlan), recovery = JSON.parse(recoveryBytes);
  need(recovery.schema === 'stellar-forge.merchant-recovery-plan.v1' && Array.isArray(recovery.roots) &&
    recovery.roots.length > 0 && recovery.roots.length <= 20, 'Original SF101 recovery plan required');
  for (const root of recovery.roots) absolute(root.path, 'recovery root');
  for (const path of [p.stateRoot, ...p.inputFiles.map(input => input.path)])
    need(recovery.roots.some(root => inside(root.path, path)), 'Recovery plan omits original merchant state or configuration: ' + path);
  for (const root of recovery.roots) {
    need(!inside(root.path, operationsRoot) && !inside(operationsRoot, root.path), 'Journal overlaps a recovery root');
    need(!p.environmentFile || !inside(root.path, p.environmentFile), 'Keep the service environment in its original secret store');
  }
  for (const directory of [p.sourceRoot, p.stateRoot, container.bundle, dirname(caddy.fragment)])
    need(!inside(directory, operationsRoot) && !inside(operationsRoot, directory), 'Journal overlaps another deployment component');
  const passphraseEnv = raw.passphraseEnv ?? 'SF101_RECOVERY_PASSPHRASE';
  need(/^[A-Z][A-Z0-9_]{4,63}$/.test(passphraseEnv), 'Original recovery passphrase variable name required');
  if (raw.restoreContainer !== undefined) {
    fields(raw.restoreContainer, ['image', 'sourceMode', 'readOnlyRoots', 'startupTimeoutSeconds', 'temporaryMiB'], 'restored container selection');
    validateContainerSpec({ ...container.spec, ...raw.restoreContainer });
  }
  return { file, raw, p, container, operationsRoot, caddy, docker, recoveryPlan, recovery,
    recoveryDigest: digest(recoveryBytes), planDigest: digest(rawBytes), passphraseEnv,
    ownUnits: [...p.services.map(service => service.unit), p.target],
    units: [...p.services.map(service => service.unit), p.target], extraWriterUnits: [] };
}

/** Accept both current JSON-lines and previous JSON-array Compose ps output. */
export function parseComposeStatus(output) {
  const text = String(output).trim();
  if (!text) return [];
  let rows;
  if (text.startsWith('[')) rows = JSON.parse(text);
  else rows = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  need(Array.isArray(rows) && rows.every(row => isObject(row) && typeof row.ID === 'string' &&
    typeof row.Service === 'string' && typeof row.State === 'string'), 'Unrecognized original Compose status response');
  return rows;
}

/** Reuse the restore engine's exact path map for declared read-only inputs. */
export function restoredReadOnlyRoots(roots, mappings, stateRoot) {
  const selected = [];
  for (const root of roots) {
    const enclosing = mappings.filter(mapping => inside(mapping.from, root))
      .sort((a, b) => b.from.length - a.from.length)[0];
    if (enclosing) selected.push(join(enclosing.to, relative(enclosing.from, root)));
    else {
      selected.push(root);
      // A declared parent may contain both a moved recovery selection and
      // separately retained original files. Preserve both actual locations.
      for (const mapping of mappings.filter(item => inside(root, item.from))) selected.push(mapping.to);
    }
  }
  const unique = [...new Set(selected)].filter(root => !inside(stateRoot, root));
  return unique.filter(root => !unique.some(other => other !== root && inside(other, root)));
}

export function createComposeHost(plan, { execute = exec } = {}) {
  need(process.platform === 'linux' && process.getuid?.() === 0,
    'Run container maintenance as the existing Linux host administrator');
  const { p, caddy } = plan;
  const selectionFile = join(plan.operationsRoot, 'container-selection.json');
  const overrideFile = join(plan.operationsRoot, 'container-maintenance-override.json');
  let current = { bundle: plan.container.bundle, hostBundle: p.bundle, mode: 'all' };
  const command = async (binary, args, timeout = 330000) => {
    try {
      const result = await execute(binary, args, { timeout, maxBuffer: 2 * 1024 * 1024, shell: false,
        env: { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: process.env.HOME } });
      return result.stdout;
    } catch { throw new Error('COMPOSE_HOST_COMMAND_FAILED: ' + basename(binary) + ' ' + args[0]); }
  };
  async function selected() {
    if (await exists(selectionFile)) {
      const saved = await jsonFile(selectionFile);
      need(saved.schema === SELECTION_SCHEMA && saved.merchant === p.merchant &&
        saved.project === plan.container.project && ['all', 'readers'].includes(saved.mode),
      'Unexpected retained container selection');
      current = { bundle: absolute(saved.bundle), hostBundle: absolute(saved.hostBundle), mode: saved.mode };
    }
    const { checkContainer } = await containerAPI();
    const result = await checkContainer(current.bundle);
    const next = result.host, c = result.container;
    need(next.bundle === current.hostBundle && c.project === plan.container.project && c.service === plan.container.service &&
      c.uid === plan.container.uid && c.gid === plan.container.gid && next.merchant === p.merchant &&
      next.publicOrigin === p.publicOrigin && next.kind === p.kind && next.mode === p.mode &&
      JSON.stringify(next.services.map(service => service.unit)) === JSON.stringify(p.services.map(service => service.unit)),
    'Restored container changes the original merchant or service identity');
    return { ...result, mode: current.mode };
  }
  async function saveSelection(containerBundle, mode) {
    const { checkContainer } = await containerAPI();
    const next = await checkContainer(containerBundle);
    await atomicJSON(selectionFile, { schema: SELECTION_SCHEMA, merchant: p.merchant,
      project: plan.container.project, bundle: next.container.bundle, hostBundle: next.host.bundle, mode });
    current = { bundle: next.container.bundle, hostBundle: next.host.bundle, mode };
    return selected();
  }
  async function compose(args, { timeout = 330000, override = true } = {}) {
    const { container: c } = await selected();
    const files = ['--file', join(c.bundle, 'compose.json')];
    if (override && await exists(overrideFile)) files.push('--file', overrideFile);
    return command(plan.docker, ['compose', '--project-name', c.project, '--project-directory', c.bundle, ...files, ...args], timeout);
  }
  async function rows() {
    const { container: c } = await selected();
    const result = parseComposeStatus(await compose(['ps', '--all', '--format', 'json'], { override: false }));
    need(result.length <= 1 && result.every(row => row.Service === c.service &&
      (!row.Project || row.Project === c.project) && /^[a-f0-9]{12,64}$/.test(row.ID)),
    'Unexpected service or replica in this merchant Compose project');
    return result;
  }
  async function stopped() {
    return (await rows()).every(row => ['exited', 'dead', 'created'].includes(row.State));
  }
  async function assertStopped() { need(await stopped(), 'Original merchant container has not stopped'); }
  async function runtimeStatus() {
    const { host, container: c } = await selected();
    return JSON.parse(await compose(['exec', '--interactive=false', '-T', c.service, host.node,
      join(host.sourceRoot, BASE + 'container-runtime.mjs'), 'status', '--bundle', host.bundle], { timeout: 45000 }));
  }
  async function states() {
    const list = await rows();
    if (!list.length || ['exited', 'dead', 'created'].includes(list[0].State))
      return plan.units.map(Id => ({ Id, ActiveState: 'inactive', MainPID: 0, ControlPID: 0 }));
    need(list[0].State === 'running', 'Original merchant container is not running');
    const runtime = await runtimeStatus();
    need(runtime.merchant === p.merchant && Array.isArray(runtime.children), 'Original container runtime identity required');
    return plan.units.map(Id => {
      const child = runtime.children.find(record => record.unit === Id);
      const active = Id === p.target ? runtime.active : child && !child.exited && child.pid > 0;
      return { Id, ActiveState: active ? 'active' : 'inactive',
        MainPID: active ? Id === p.target ? runtime.supervisorPid : child.pid : 0, ControlPID: 0,
        containerId: list[0].ID, runtimeId: runtime.runtimeId };
    });
  }
  async function verifyImage() {
    const { container: c } = await selected();
    const list = await rows(); need(list.length === 1 && list[0].State === 'running', 'Original merchant container is not running');
    const wanted = (await command(plan.docker, ['image', 'inspect', '--format', '{{.Id}}', c.image], 30000)).trim();
    need(/^sha256:[a-f0-9]{64}$/.test(wanted), 'Native immutable image ID required');
    const template = '{"image":{{json .Image}},"hostname":{{json .Config.Hostname}},"labels":{{json .Config.Labels}}}';
    const actual = JSON.parse(await command(plan.docker, ['inspect', '--format', template, list[0].ID], 30000));
    need(actual.image === wanted && actual.hostname === c.hostname &&
      actual.labels?.['com.docker.compose.project'] === c.project &&
      actual.labels?.['com.docker.compose.service'] === c.service, 'Running container does not match the selected original image and project');
  }
  async function reloadProxy() {
    await command(caddy.binary, ['validate', '--adapter', 'caddyfile', '--config', caddy.config], 60000);
    await command(caddy.binary, ['reload', '--adapter', 'caddyfile', '--config', caddy.config], 60000);
  }
  async function writeMode(mode) {
    const { host, container: c } = await selected();
    const args = ['run', '--bundle', host.bundle,
      '--startup-timeout-seconds', String(c.startupTimeoutSeconds ?? c.spec?.startupTimeoutSeconds ?? 90),
      ...(mode === 'readers' ? ['--readers-only'] : [])];
    const literal = value => value.replaceAll('$', () => '$$');
    await atomicJSON(overrideFile, { services: { [c.service]: {
      entrypoint: [host.node, join(host.sourceRoot, BASE + 'container-runtime.mjs')].map(literal),
      command: args.map(literal), restart: 'no',
      stop_grace_period: String(host.services.reduce((sum, service) => sum + service.stopSeconds, 15)) + 's' } } });
    await saveSelection(c.bundle, mode);
  }
  async function marker(host, id, present) {
    const path = markerPath(host), directory = dirname(path), owner = await lstat(host.stateRoot);
    if (present) {
      try { await mkdir(directory, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      await privateDirectory(directory); await chown(directory, owner.uid, owner.gid);
      let previous = null;
      if (await exists(path)) {
        const bytes = await regular(path), prior = JSON.parse(bytes);
        need(prior.schema === MARKER_SCHEMA && prior.merchant === p.merchant && prior.operationId === id,
          'A different original operation owns the container maintenance marker');
        previous = digest(bytes);
      }
      await atomicFile(path, JSON.stringify({ schema: MARKER_SCHEMA, merchant: p.merchant, operationId: id }) + '\n',
        { allowed: [previous], mode: 0o600, uid: owner.uid, gid: owner.gid });
    } else if (await exists(path)) {
      const bytes = await regular(path), prior = JSON.parse(bytes);
      need(prior.schema === MARKER_SCHEMA && prior.merchant === p.merchant && prior.operationId === id,
        'Container maintenance marker belongs to another original operation');
      await removeOwned(path, digest(bytes));
    }
  }
  async function selectHostBundle(bundle) {
    if (bundle === p.bundle) return saveSelection(plan.container.bundle, 'all');
    const candidateOuter = dirname(bundle);
    const { checkContainer } = await containerAPI();
    const next = await checkContainer(candidateOuter);
    need(next.host.bundle === bundle, 'Restored host is not its original generated container host');
    return saveSelection(candidateOuter, 'readers');
  }
  const hostAdapter = {
    states, assertStopped,
    async validateInstalled() {
      const current = await selected();
      need(current.host.bundle === p.bundle && current.container.bundle === plan.container.bundle,
        'Use the maintenance plan for the currently selected container deployment');
      need(digest(await regular(caddy.fragment)) === p.artifacts.Caddyfile,
        'Imported Caddy fragment differs from the original deployment');
      await verifyImage();
      const runtime = await runtimeStatus();
      need(runtime.active && runtime.ready && runtime.mode === 'all', 'Start from the healthy complete original container service group');
      const installed = await states();
      need(installed.every(row => row.ActiveState === 'active'), 'Original merchant component group is not running');
      return installed;
    },
    async pause(id, fragments) {
      operationId(id);
      const text = maintenanceFragment(p, id);
      await atomicFile(caddy.fragment, text, { allowed: [...fragments, digest(text)], mode: 0o644 });
      await reloadProxy();
      const deadline = Date.now() + 15000;
      do {
        try {
          const response = await fetch(p.publicOrigin + '/_seller/openapi.json',
            { redirect: 'error', signal: AbortSignal.timeout(5000) });
          await response.body?.cancel();
          if (response.status === 503 && response.headers.get('x-stellar-forge-maintenance') === id) return;
        } catch { /* Original proxy may close a connection while reloading. */ }
        await delay(150);
      } while (Date.now() < deadline);
      throw new Error('Public ingress did not enter this original maintenance operation');
    },
    async expose(bundle, id) {
      const next = await checkBundle(bundle);
      await atomicFile(caddy.fragment, await regular(join(bundle, 'Caddyfile')),
        { allowed: [digest(maintenanceFragment(p, id)), next.artifacts.Caddyfile], mode: 0o644 });
      await reloadProxy();
    },
    async guards(units, operationMarker, present) {
      need(JSON.stringify(units) === JSON.stringify(plan.units), 'Container maintenance owns its entire original component group');
      const id = operationId(basename(dirname(operationMarker)));
      const current = await selected(); await marker(current.host, id, present);
    },
    async stop() {
      const { host, container: c } = await selected();
      const seconds = host.services.reduce((sum, service) => sum + service.stopSeconds, 15);
      await compose(['stop', '--timeout', String(seconds), c.service], { timeout: (seconds + 30) * 1000 });
      await assertStopped();
    },
    async install(bundle) {
      await assertStopped();
      const next = await selectHostBundle(bundle);
      await writeMode(next.mode);
      // Native Compose resolves the actual selected image/mount/command document.
      // --quiet keeps provider environment and resolved private paths out of output.
      await compose(['config', '--quiet'], { timeout: 30000 });
    },
    async grantRestoredAccess(destination, candidate) {
      const uid = plan.container.uid, gid = plan.container.gid;
      need(Number.isInteger(uid) && uid > 0 && Number.isInteger(gid) && gid > 0,
        'Original unprivileged container account and group required');
      let count = 0;
      const controls = [candidate.bundle, candidate.containerBundle, candidate.originalHostBundle, candidate.planFile, candidate.containerSpec].filter(Boolean);
      const walk = async file => {
        need(++count <= 22000, 'Restored host exceeds original recovery file limit');
        const info = await lstat(file);
        need(!info.isSymbolicLink() && (info.isDirectory() || info.isFile() && info.nlink === 1), 'Unsafe restored host entry');
        const control = controls.some(root => inside(root, file));
        await chown(file, control ? 0 : uid, gid);
        await chmod(file, info.isDirectory() ? control ? 0o750 : 0o700 : control ? 0o640 : 0o600);
        if (info.isDirectory()) for (const child of await readdir(file)) await walk(join(file, child));
      };
      for (const child of await readdir(destination)) await walk(join(destination, child));
      await chown(destination, 0, gid); await chmod(destination, 0o750);
    },
    async startReaders(bundle) {
      const next = await selectHostBundle(bundle);
      await writeMode('readers');
      await compose(['up', '--detach', '--no-build', '--pull', 'never', '--no-deps', '--force-recreate', next.container.service]);
      await verifyImage();
      await hostAdapter.smoke(bundle);
    },
    async startOriginalGroup(originalStates, operationMarker) {
      need(originalStates.every(row => plan.units.includes(row.Id)), 'Unexpected original service state');
      const current = await selected();
      // Recreate from the reviewed full command after the durable COMMITTED
      // transition. A crash resumes forward using the same original state.
      await hostAdapter.stop();
      await marker(current.host, operationId(basename(dirname(operationMarker))), false);
      await writeMode('all');
      await compose(['up', '--detach', '--no-build', '--pull', 'never', '--no-deps', '--force-recreate', current.container.service]);
      await verifyImage();
    },
    async smoke(bundle, publicOrigin = false) {
      const { host, container: c, mode } = await selected();
      need(host.bundle === bundle, 'Readiness must address the selected original container host');
      const healthy = runtime => runtime.active && runtime.ready && runtime.mode === mode &&
        runtime.merchant === host.merchant && runtime.bundle === host.bundle;
      const deadline = Date.now() + (c.startupTimeoutSeconds ?? c.spec?.startupTimeoutSeconds ?? 90) * 1000;
      do {
        try {
          const before = await runtimeStatus();
          if (!healthy(before)) { await delay(250); continue; }
          const result = JSON.parse(await compose(['exec', '--interactive=false', '-T', c.service, host.node,
            join(host.sourceRoot, BASE + 'cli.mjs'), 'smoke', '--bundle', bundle,
            ...(publicOrigin ? ['--public'] : [])], { timeout: 30000 }));
          const after = await runtimeStatus();
          if (result.passed && healthy(after) && after.runtimeId === before.runtimeId)
            return { ...result, runtime: { runtimeId: after.runtimeId, mode: after.mode, ready: true } };
        } catch { /* The same native process group is still opening its listeners. */ }
        await delay(250);
      } while (Date.now() < deadline);
      throw new Error('Original container readiness/public confinement check failed');
    },
    async prepareRestoredHost(options) {
      const candidate = await prepareRestoredHost(options);
      // The original encrypted restore writes administrator-owned private files.
      // The original container mount check observes the real selected service
      // owner, so grant the NEW authenticated destination before generation.
      await hostAdapter.grantRestoredAccess(options.destination, candidate);
      const source = plan.container.spec ?? plan.container;
      const spec = { schema: CONTAINER_SCHEMA, hostPlan: candidate.planFile, image: source.image,
        uid: source.uid, gid: source.gid, readOnlyRoots: source.readOnlyRoots ?? [],
        sourceMode: source.sourceMode ?? 'bind', temporaryMiB: source.temporaryMiB ?? 128,
        startupTimeoutSeconds: source.startupTimeoutSeconds ?? 90, ...(plan.raw.restoreContainer ?? {}) };
      spec.readOnlyRoots = restoredReadOnlyRoots(spec.readOnlyRoots, candidate.mappings, candidate.stateRoot);
      const specFile = join(options.destination, 'container-spec.json');
      await atomicJSON(specFile, spec);
      const outer = join(options.destination, 'container');
      const { generateContainer, checkContainer } = await containerAPI();
      await generateContainer(specFile, outer, { sourceRoot: options.sourceRoot });
      const next = await checkContainer(outer);
      need(next.host.planFile === candidate.planFile && next.host.stateRoot === candidate.stateRoot &&
        next.host.sourceRoot === options.sourceRoot && next.container.project === plan.container.project,
      'Generated restored container does not select the original restored host');
      return { ...candidate, originalHostBundle: candidate.bundle, bundle: next.host.bundle,
        containerBundle: next.container.bundle, containerSpec: specFile };
    },
    async nextMaintenancePlan(state, next) {
      need(state.candidate?.containerBundle, 'Original restored container selection is missing');
      return { ...next, containerBundle: state.candidate.containerBundle };
    },
  };
  return hostAdapter;
}

/** Keep snapshot/restore/rollback phases in maintenance.mjs, shared with systemd. */
export async function runContainerMaintenance(planFile, options) {
  if (options.command === 'status') return runMaintenance(planFile, options);
  const plan = await loadContainerMaintenance(planFile), host = createComposeHost(plan);
  return runMaintenance(plan.file, options, { host, loadPlan: async () => plan });
}

const HELP = `node cli.mjs container maintenance template
node cli.mjs container maintenance inspect --plan PRIVATE_MAINTENANCE.json
node cli.mjs container maintenance backup --plan PRIVATE_MAINTENANCE.json --id STABLE_ID
node cli.mjs container maintenance migrate --plan PRIVATE_MAINTENANCE.json --id STABLE_ID
     --destination NEW_ABSOLUTE_DIRECTORY [--source-root IMMUTABLE_RELEASE]
node cli.mjs container maintenance status|resume|rollback --plan PRIVATE_MAINTENANCE.json --id STABLE_ID

Operate the selected original Compose merchant and existing Caddy ingress.
The original encrypted recovery engine keeps the same operation journal,
quiesced outbox lease, precommit rollback and committed forward recovery.`;

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help') { console.log(HELP); return 0; }
  const [command, ...rest] = args;
  if (command === 'template' && !rest.length) {
    console.log(JSON.stringify({ schema: MAINTENANCE_SCHEMA, bundle: '/private/deployments/merchant-container/host',
      containerBundle: '/private/deployments/merchant-container', operationsRoot: '/var/lib/stellar-maintenance/merchant',
      caddy: { fragment: '/etc/caddy/merchants/merchant.caddy', config: '/etc/caddy/Caddyfile', binary: '/usr/bin/caddy' },
      runtime: { docker: '/usr/bin/docker' }, passphraseEnv: 'SF101_RECOVERY_PASSPHRASE' }, null, 2));
    return 0;
  }
  const allowed = { inspect: ['--plan'], backup: ['--plan', '--id'],
    migrate: ['--plan', '--id', '--destination', '--source-root'],
    status: ['--plan', '--id'], resume: ['--plan', '--id'], rollback: ['--plan', '--id'] }[command];
  if (!allowed) throw new Error(HELP);
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (!allowed.includes(key) || Object.hasOwn(values, key) || !value || value.startsWith('--')) throw new Error(HELP);
    values[key] = value;
  }
  if (!values['--plan'] || command !== 'inspect' && !values['--id'] ||
    command === 'migrate' && !values['--destination']) throw new Error(HELP);
  const result = await runContainerMaintenance(resolve(values['--plan']), { command, id: values['--id'],
    destination: values['--destination'], sourceRoot: values['--source-root'] });
  console.log(JSON.stringify(result, null, 2)); return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(JSON.stringify({ error: error.message, ...(error.operation ? { operation: error.operation } : {}) }, null, 2));
    process.exitCode = 1;
  });
