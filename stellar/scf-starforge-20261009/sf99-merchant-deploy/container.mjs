// MIT. Compose deployment of the original SF99 merchant and its retained runtime.
import { readFile, lstat, mkdir, writeFile, realpath } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { prepare, generate, checkBundle, ROOT, shellWord } from './host.mjs';
import { prepareMounts, checkMounts } from './container-mounts.mjs';

export const CONTAINER_SCHEMA = 'stellar-forge.merchant-container.v1';
const BASE = 'stellar/scf-starforge-20261009/sf99-merchant-deploy/';
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const inside = (root, file) => file === root || file.startsWith(root + '/');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function absolute(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !/[\\\x00-\x1f\x7f]/.test(value), label + ' must be an absolute normalized path');
  return value;
}
function integer(value, fallback, min, max, name) {
  value ??= fallback;
  need(Number.isSafeInteger(value) && value >= min && value <= max, 'Invalid ' + name);
  return value;
}
async function bytes(file, limit = 2 * 1024 * 1024) {
  const stat = await lstat(file);
  need(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, 'Regular source file required: ' + file);
  const value = await readFile(file);
  need(value.length <= limit, 'Source file grew beyond its size limit: ' + file);
  return value;
}
const json = async file => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(file)));

export function validateContainerSpec(value) {
  const fields = ['schema', 'hostPlan', 'image', 'uid', 'gid', 'sourceMode', 'readOnlyRoots',
    'startupTimeoutSeconds', 'temporaryMiB'];
  need(object(value) && Object.keys(value).every(key => fields.includes(key)), 'Unknown or invalid container plan field');
  need(value.schema === CONTAINER_SCHEMA, 'Original merchant container schema required');
  need(typeof value.image === 'string' && /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64})$/.test(value.image),
    'Select the immutable local image ID sha256:... or a registry image pinned with @sha256:...');
  const sourceMode = value.sourceMode ?? 'bind';
  need(sourceMode === 'bind' || sourceMode === 'image', 'sourceMode must be bind or image');
  const readOnlyRoots = value.readOnlyRoots ?? [];
  need(Array.isArray(readOnlyRoots) && readOnlyRoots.length <= 128, 'readOnlyRoots must list the selected external source roots');
  const roots = readOnlyRoots.map((file, index) => absolute(file, 'readOnlyRoots[' + index + ']'));
  need(new Set(roots).size === roots.length, 'readOnlyRoots contains a repeated path');
  return { schema: CONTAINER_SCHEMA, hostPlan: absolute(value.hostPlan, 'hostPlan'), image: value.image,
    uid: integer(value.uid, undefined, 1, 2147483647, 'uid'),
    gid: integer(value.gid, undefined, 1, 2147483647, 'gid'), sourceMode, readOnlyRoots: roots,
    startupTimeoutSeconds: integer(value.startupTimeoutSeconds, 90, 1, 600, 'startupTimeoutSeconds'),
    temporaryMiB: integer(value.temporaryMiB, 128, 16, 8192, 'temporaryMiB') };
}

export async function prepareContainer(planFile, { sourceRoot = ROOT } = {}) {
  planFile = absolute(resolve(planFile), 'container plan');
  const specBytes = await bytes(planFile);
  const spec = validateContainerSpec(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(specBytes)));
  const host = await prepare(spec.hostPlan, { sourceRoot });
  return { spec, host, specFile: planFile, specSha256: hash(specBytes) };
}

// Compose interpolates strings in JSON as well as YAML. Escape literal dollars
// at the serialization boundary; paths/argv in our retained manifests stay exact.
function composeLiteral(value) {
  if (typeof value === 'string') return value.replaceAll('$', () => '$$');
  if (Array.isArray(value)) return value.map(composeLiteral);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, composeLiteral(item)]));
  return value;
}

export function composeDocument(host, container, mounts) {
  const runtime = join(host.sourceRoot, BASE + 'container-runtime.mjs');
  const grace = host.services.reduce((sum, service) => sum + service.stopSeconds, 0) + 15;
  return composeLiteral({ name: container.project, services: { [container.service]: {
    image: container.image, pull_policy: 'never', hostname: container.hostname,
    user: String(container.uid) + ':' + String(container.gid), working_dir: host.sourceRoot,
    network_mode: 'host', init: true, read_only: true, restart: 'no',
    entrypoint: [host.node, runtime],
    command: ['run', '--bundle', container.hostBundle, '--startup-timeout-seconds', String(container.startupTimeoutSeconds)],
    environment: { PYTHONDONTWRITEBYTECODE: '1' },
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:rw,nosuid,nodev,mode=1777,size=' + container.temporaryMiB + 'm',
      '/run:rw,nosuid,nodev,mode=0755,size=4m'],
    volumes: mounts, stop_signal: 'SIGTERM', stop_grace_period: grace + 's',
    healthcheck: { test: ['CMD', host.node, runtime, 'health', '--bundle', container.hostBundle],
      interval: '30s', timeout: '15s', start_period: (container.startupTimeoutSeconds + 5) + 's', retries: 3 },
    logging: { driver: 'local', options: { 'max-size': '10m', 'max-file': '3' } },
    labels: { 'org.stellar-forge.merchant': host.merchant, 'org.stellar-forge.kind': host.kind,
      'org.stellar-forge.host-schema': host.schema }
  } } });
}

function manifestSettings(host, spec, bundle) {
  return { ...spec, bundle, hostBundle: join(bundle, 'host'), hostPlan: spec.hostPlan,
    sourceRoot: host.sourceRoot, stateRoot: host.stateRoot,
    project: 'stellar-forge-' + host.merchant, service: 'merchant',
    hostname: 'stellar-forge-' + host.merchant, networkMode: 'host',
    composeFile: join(bundle, 'compose.json'),
    stopGraceSeconds: host.services.reduce((sum, service) => sum + service.stopSeconds, 0) + 15 };
}

function runbook(host, container) {
  const q = shellWord, root = host.sourceRoot, bundle = container.bundle;
  const cli = q(host.node) + ' ' + q(join(root, BASE + 'cli.mjs'));
  const compose = 'docker compose --project-name ' + q(container.project) +
    ' --project-directory ' + q(container.bundle) + ' -f ' + q(container.composeFile);
  const runtime = q(host.node) + ' ' + q(join(root, BASE + 'container-runtime.mjs'));
  const lines = [
    '# ' + host.merchant + ' container operation', '',
    'This bundle runs the original ' + host.kind + ' merchant in one Linux container. Its seller, receiver, discovery and delivery processes share one PID namespace and retain their original commands, stores and shutdown handlers. The host network keeps the original loopback listeners and existing Caddy routes.', '',
    '## Selected deployment', '',
    '| Selection | Value |', '| --- | --- |',
    '| Image | `' + container.image + '` |',
    '| Runtime user | `' + container.uid + ':' + container.gid + '` |',
    '| Public origin | ' + host.publicOrigin + ' |',
    '| Source mode | `' + container.sourceMode + '` |',
    '| Source root | `' + host.sourceRoot + '` |',
    '| Private state | `' + host.stateRoot + '` |',
    '| Stop grace | ' + container.stopGraceSeconds + ' seconds |', '',
    'The selected image must already contain the exact Node/Python paths and native dependencies used by this source. Image mode also requires the selected source at its original absolute path. Bind mode exposes that immutable host source read-only. Extra declared roots retain sibling imports, response assets and external dependency paths.', '',
    '## Install and start', '',
    '1. Keep this directory at its generated path. Give runtime UID ' + container.uid + ' access to the bundle, its nested host files, source and declared read-only roots. Keep the bundle immutable to the running service, and keep its writable state owned by that UID. A root-owned deployment can use group ' + container.gid + ' with directories 0750 and files 0640. The private environment file must be owned and readable by UID ' + container.uid + ' at 0600; the runtime reads it after dropping privileges.', '',
    '2. Load the already selected immutable image with the existing image workflow. Review the exact mounts and original host plan before startup. The Compose file has no build or implicit pull.', '',
    '```sh', cli + ' container check --bundle ' + q(bundle),
    'docker image inspect ' + q(container.image) + ' --format ' + q('{{.Id}}'),
    compose + ' config --quiet', '```', '',
    '3. Start with this merchant’s ingress paused. Its original services start receiver/discovery before delivery and seller; startup fails if an original writer is already busy.', '',
    '```sh', compose + ' up -d --no-build --pull never', compose + ' ps --all',
    compose + ' exec -T merchant ' + runtime + ' health --bundle ' + q(container.hostBundle),
    compose + ' exec -T merchant ' + runtime + ' status --bundle ' + q(container.hostBundle), '```', '',
    '4. Install `host/Caddyfile` through the existing Caddy site workflow, validate the full proxy configuration, and restore only this merchant’s ingress. Its exact declared paid routes, public documentation, signed discovery and approved delivery paths retain the original routing. Caddy remains on the host. Run the original public read checks from the same running container:', '',
    '```sh', compose + ' exec -T merchant ' + cli + ' smoke --bundle ' + q(container.hostBundle) + ' --public', '```', '',
    '## Observe and stop', '',
    'Run original retained process checks inside this same container. A separate `docker compose run` container has a different PID namespace and cannot establish the current writer’s identity. Inspect logs and the supervisor status for the actual component outcome.', '',
    '```sh', compose + ' logs --tail 100 merchant', compose + ' ps --all', '```', '',
    'Pause this merchant’s ingress before stopping. The supervisor drains the seller, then closes delivery and the remaining original readers. Compose allows the sum of their native stop deadlines plus 15 seconds.', '',
    '```sh', compose + ' stop merchant', compose + ' ps --all', '```', '',
    'The container uses `restart: no` so a busy original delivery lease (exit 75) cannot become an automatic restart loop. Inspect the original owner and outcome, then use the same explicit start command when the conflict or startup failure is resolved. Original ledgers and locks remain with their existing engines.', '',
    '## Backup, move and restore', '',
    'The nested `host/recovery-plan.json` is the original encrypted-recovery selection. Its state and configuration roots are unchanged. Include separately owned response assets and external writer roots in your existing recovery plan before a move. Keep credentials under their existing recovery procedure.', '',
    'Use the joined container maintenance operation to pause this merchant’s Caddy ingress, stop its original writers, take and verify the original encrypted snapshot, prepare the original rebased host, and generate the next container bundle. It retains the same maintenance operation for interruption recovery and rollback:', '',
    '```sh', cli + ' container maintenance --help', '```', '',
    'The maintenance plan selects `bundle: ' + container.hostBundle + '` and `containerBundle: ' + bundle + '`, the existing operations root, exact Caddy fragment/configuration/binary and Docker binary. Follow the complete CONTAINERS.md and MAINTENANCE.md guides in this source release. Maintenance uses the original restore engine for checkout orders, response assets, outbox and retained release/discovery stores; it does not install the nested systemd units.', '',
    '## Upgrade and rollback', '',
    'Select the next immutable source/image through the existing distribution workflow. Review the original release changes and payment terms, update the existing host selection, generate a new private container bundle, then stop the old deployment and start the new one against the current compatible state. The stable project and hostname retain original local identity. Keep the previous image, source and bundle for code rollback. Never overwrite current payment or order state with an old backup during a code rollback.', '',
    'Original host instructions and complete recovery commands are in `host/RUNBOOK.md`; their systemd install/activation steps belong to the systemd deployment. This container uses the exact original source, configuration, Caddy fragment and recovery engines through Compose.', ''
  ];
  return lines.join('\n');
}

export async function generateContainer(planFile, output, options = {}) {
  const prepared = await prepareContainer(planFile, options);
  const { host, spec } = prepared;
  const bundle = absolute(resolve(output), 'container output');
  need(!inside(host.sourceRoot, bundle) && !inside(bundle, host.sourceRoot) &&
    !inside(host.stateRoot, bundle) && !inside(bundle, host.stateRoot) &&
    !inside(bundle, prepared.specFile) && !inside(bundle, host.planFile) &&
    !host.inputFiles.some(item => inside(bundle, item.path)),
    'Container bundle must be separate from its source, plans, inputs and writable state');
  const parent = await realpath(resolve(bundle, '..'));
  need(parent === resolve(bundle, '..'), 'Create the bundle under its real canonical parent directory');
  const container = manifestSettings(host, spec, bundle);
  let created = false;
  try {
    await mkdir(bundle, { mode: 0o700 }); created = true;
    await generate(spec.hostPlan, container.hostBundle, { sourceRoot: host.sourceRoot });
    const retainedHost = await checkBundle(container.hostBundle);
    // Original preparation is deliberately repeated by its generator. Preserve
    // the actual generated snapshot if another operator changed a mutable input.
    need(same(host, Object.fromEntries(Object.entries(retainedHost).filter(([key]) => !['bundle', 'artifacts'].includes(key)))),
      'Merchant source changed during generation; inspect its current selection and generate a new bundle');
    const mounts = await prepareMounts(retainedHost, container, bundle);
    const entries = ['container.mjs', 'container-mounts.mjs', 'container-runtime.mjs', 'container-cli.mjs', 'container-operations.mjs'];
    const sourceEntries = await Promise.all(entries.map(async name => {
      const file = join(host.sourceRoot, BASE + name);
      return { path: file, sha256: hash(await bytes(file)) };
    }));
    const compose = JSON.stringify(composeDocument(retainedHost, container, mounts), null, 2) + '\n';
    const artifacts = new Map([['compose.json', compose], ['RUNBOOK.md', runbook(retainedHost, container)]]);
    for (const [name, content] of artifacts) await writeFile(join(bundle, name), content, { mode: 0o600, flag: 'wx' });
    const manifest = { ...container, schema: CONTAINER_SCHEMA, spec,
      specFile: prepared.specFile, specSha256: prepared.specSha256, mounts, sourceEntries,
      hostManifestSha256: hash(await bytes(join(container.hostBundle, 'deployment.json'))),
      artifacts: Object.fromEntries([...artifacts].map(([name, content]) => [name, hash(content)])) };
    await writeFile(join(bundle, 'container.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return { bundle, hostBundle: container.hostBundle, composeFile: container.composeFile,
      merchant: retainedHost.merchant, kind: retainedHost.kind, mode: retainedHost.mode,
      image: spec.image, sourceMode: spec.sourceMode, project: container.project,
      service: container.service, files: artifacts.size + 1, originalHostFiles: Object.keys(retainedHost.artifacts).length + 1 };
  } catch (error) {
    if (created) {
      error.bundle = bundle;
      error.message += '; prepared container files remain at ' + bundle;
    }
    throw error;
  }
}

export async function checkContainer(bundle) {
  bundle = absolute(resolve(bundle), 'container bundle');
  const container = await json(join(bundle, 'container.json'));
  need(container.schema === CONTAINER_SCHEMA && container.bundle === bundle && object(container.spec),
    'Original container manifest required at its generated path');
  const spec = validateContainerSpec(container.spec);
  need(container.hostBundle === join(bundle, 'host'), 'The container must select its original nested host bundle');
  need(hash(await bytes(join(container.hostBundle, 'deployment.json'))) === container.hostManifestSha256,
    'Original host manifest changed; regenerate the container bundle');
  const host = await checkBundle(container.hostBundle);
  const settings = manifestSettings(host, spec, bundle);
  for (const [key, value] of Object.entries(settings)) need(same(container[key], value), 'Container selection changed: ' + key);
  need(object(container.artifacts) && same(Object.keys(container.artifacts).sort(), ['RUNBOOK.md', 'compose.json']),
    'Original container artifacts required');
  for (const [name, expected] of Object.entries(container.artifacts))
    need(hash(await bytes(join(bundle, name))) === expected, 'Container artifact changed: ' + name);
  need(Array.isArray(container.sourceEntries) && container.sourceEntries.length === 5, 'Original container source entries required');
  for (const [index, name] of ['container.mjs', 'container-mounts.mjs', 'container-runtime.mjs', 'container-cli.mjs', 'container-operations.mjs'].entries()) {
    const entry = container.sourceEntries[index];
    need(entry?.path === join(host.sourceRoot, BASE + name) && hash(await bytes(entry.path)) === entry.sha256,
      'Container source changed; select a new immutable source/image and regenerate: ' + name);
  }
  await checkMounts(host, container, bundle, container.mounts);
  need(same(await json(container.composeFile), composeDocument(host, container, container.mounts)),
    'Compose services no longer match the retained original merchant');
  return { host, container, bundle };
}
