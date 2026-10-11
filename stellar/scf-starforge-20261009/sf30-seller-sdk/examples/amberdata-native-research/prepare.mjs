#!/usr/bin/env node
// MIT. Retained Amberdata application installed into the ORIGINAL Python workspace.
import { randomBytes } from 'node:crypto';
import { open, readFile, mkdir, lstat, realpath, link, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace, openWorkspace, importWorkspace } from '../../python/workspace/model.mjs';
import { main as workspaceMain } from '../../python/workspace/cli.mjs';
import { compilePlan, digest, merchantDeclaration, upstreamBindings } from './plan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = resolve(HERE, '../../../../..');
const OWNED_SCHEMA = 'stellar-forge.amberdata-installation.v1';
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const HELP = `Amberdata native research merchant (Node 22.13+ and Python 3.11+)

  prepare --plan PLAN.json --out NEW_DIRECTORY [--source-root ORIGINAL_SOURCE_ROOT]
  inspect --dir DIRECTORY
  workspace --dir DIRECTORY -- ORIGINAL_PYTHON_WORKSPACE_COMMAND [OPTIONS]
  adopt --bundle ORIGINAL_EXPORT.json --out NEW_DIRECTORY [--source-root ORIGINAL_SOURCE_ROOT]

prepare resumes only its own exact partially prepared directory. It creates an
original private Python workspace plus a private host pagination key. It does not
make a provider request, start a seller, create an account, or execute payment.

workspace supplies --workspace DIRECTORY/workspace and the original host runtime
environment. The original commands include serve, status, preview, stage, activate,
run, rollback and export; use "workspace --dir DIRECTORY -- help" for their syntax.
Set AMBERDATA_API_KEY privately before an explicit provider preview or native serve.

adopt imports the original complete workspace create-only, retaining its source,
revisions, preview results, releases and customer exports. Copy the original private
host/page.key separately if old pagination tokens must remain valid; a new host key
deliberately invalidates them. API credentials never enter the portable workspace.
`;

function parse(argv) {
  const at = argv.indexOf('--'), own = at < 0 ? argv : argv.slice(0, at), forward = at < 0 ? [] : argv.slice(at + 1);
  const command = own[0] ?? 'help', flags = {};
  for (let i = 1; i < own.length; i++) {
    const key = own[i];
    if (!key.startsWith('--') || Object.hasOwn(flags, key.slice(2)) || !own[i + 1] || own[i + 1].startsWith('--')) throw new TypeError('Use unique --name value options.');
    flags[key.slice(2)] = own[++i];
  }
  const allowed = { prepare: ['plan', 'out', 'source-root'], adopt: ['bundle', 'out', 'source-root'], inspect: ['dir'], workspace: ['dir'], help: [] };
  if (!allowed[command] || Object.keys(flags).some(key => !allowed[command].includes(key)) || (command !== 'workspace' && forward.length)) throw new TypeError(HELP);
  return { command, flags, forward };
}
async function regular(path, max = 1048576) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > max) throw new TypeError('Expected a regular file within the selected limit: ' + path);
  const bytes = await readFile(path);
  if (bytes.length > max) throw new RangeError('File grew beyond its limit: ' + path);
  return bytes;
}
async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function syncDirectory(path) { const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
async function writeNew(path, bytes) {
  const temporary = path + '.' + randomBytes(8).toString('hex') + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, path);
    await syncDirectory(dirname(path));
  } finally { await unlink(temporary); }
}
async function exactFile(path, bytes) {
  if (await exists(path)) {
    if (!(await regular(path, bytes.length + 1)).equals(bytes)) throw new Error('Existing prepared source differs; choose a new directory: ' + path);
    return;
  }
  await writeNew(path, bytes);
}
async function nativeSource(value = SOURCE_ROOT) {
  const sourceRoot = await realpath(resolve(value));
  const upstream = join(sourceRoot, 'stellar/scf-starforge-20261009/sf30-seller-sdk/upstream.mjs');
  const bytes = await regular(await realpath(upstream));
  return { sourceRoot, nodeExecutable: process.execPath, originalUpstreamSha256: digest(bytes) };
}
async function begin(root, marker) {
  try { await mkdir(root, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!(await lstat(root)).isDirectory()) throw new Error('The installation must use a real private directory.');
  const path = join(root, 'installation.json');
  if (await exists(path)) {
    const saved = JSON.parse(await regular(path));
    if (saved.schema !== OWNED_SCHEMA || saved.mode !== marker.mode || saved.inputSha256 !== marker.inputSha256 || saved.sourceRoot !== marker.sourceRoot) throw new Error('This directory belongs to another preparation or input.');
    return saved;
  }
  const { readdir } = await import('node:fs/promises');
  if ((await readdir(root)).length) throw new Error('Refusing to adopt an unowned populated directory.');
  const saved = { schema: OWNED_SCHEMA, ...marker, createdAt: new Date().toISOString() };
  await writeNew(path, jsonBytes(saved));
  return saved;
}
async function hostFiles(root, native) {
  const host = join(root, 'host');
  try { await mkdir(host, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!(await lstat(host)).isDirectory()) throw new Error('Host state requires a real directory.');
  const key = join(host, 'page.key');
  if (!(await exists(key))) await writeNew(key, Buffer.from(randomBytes(32).toString('hex') + '\n'));
  const value = (await regular(key, 100)).toString('utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Original private page key is invalid.');
  await exactFile(join(host, 'runtime.json'), jsonBytes(native));
}
async function completion(root, model, fields) {
  const metadata = model.metadata();
  const state = await model.state();
  const completed = { schema: 'stellar-forge.amberdata-preparation.v1', workspaceId: metadata.id,
    initialHead: metadata.head, workspace: join(root, 'workspace'), ...fields };
  const path = join(root, 'prepared.json');
  if (await exists(path)) {
    const original = JSON.parse(await regular(path));
    if (original.workspaceId !== metadata.id) throw new Error('The original prepared workspace identity changed.');
    return { ...original, currentState: state, resumed: true };
  }
  await writeNew(path, jsonBytes(completed));
  return { ...completed, currentState: state, resumed: false };
}

function stateSummary(state) {
  return {
    workspaceId: state.workspace.id, label: state.workspace.label, head: state.workspace.head,
    functions: Object.keys(JSON.parse(state.revision.declarationText).functions),
    counts: { revisions: state.revisions.length, previews: state.previews.length,
      stages: state.staged.length, customerExports: state.customerExports.length },
    release: { generation: state.release.state.generation, active: state.release.state.active,
      previous: state.release.state.previous, runtime: state.release.runtime.state },
  };
}

export async function prepareInstallation({ plan: planPath, out, sourceRoot } = {}) {
  if (!planPath || !out) throw new TypeError('--plan and --out are required.');
  const planBytes = await regular(resolve(planPath)), plan = compilePlan(JSON.parse(planBytes));
  const native = await nativeSource(sourceRoot), root = resolve(out);
  const declaration = merchantDeclaration(plan), bindings = upstreamBindings(plan);
  // Original binding compilation checks syntax with private stand-in header values;
  // the retained application supplies the fixed instrument to the original handler.
  const { compileUpstreamBindings } = await import('../../upstream.mjs');
  compileUpstreamBindings(bindings, { env: { AMBERDATA_API_KEY: 'syntax-inspection', AMBERDATA_API_VERSION: plan.provider.apiVersion } });
  const templateNames = ['application.py', 'contract.py', 'provider-bridge.mjs'];
  const source = Object.fromEntries(await Promise.all(templateNames.map(async name => [name, await regular(join(HERE, name))])));
  const files = { ...source, 'product.json': jsonBytes(plan), 'upstreams.json': jsonBytes(bindings), 'merchant.json': jsonBytes(declaration) };
  const fingerprint = digest({ planSha256: digest(planBytes), files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)])) });
  await begin(root, { mode: 'prepare', inputSha256: fingerprint, sourceRoot: native.sourceRoot, planSha256: digest(planBytes) });
  const application = join(root, 'application');
  try { await mkdir(application, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!(await lstat(application)).isDirectory()) throw new Error('The application source must be a real directory.');
  for (const [name, bytes] of Object.entries(files)) await exactFile(join(application, name), bytes);
  await hostFiles(root, native);
  const workspacePath = join(root, 'workspace');
  const model = await exists(workspacePath) ? await openWorkspace(workspacePath) : await createWorkspace(workspacePath, {
    config: join(application, 'merchant.json'), pythonRoot: application, label: plan.label,
  });
  try { return await completion(root, model, { selectionSha256: plan.selectionSha256, sourceFiles: Object.entries(files).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: digest(bytes) })) }); }
  finally { await model.close(); }
}

export async function adoptInstallation({ bundle: bundlePath, out, sourceRoot } = {}) {
  if (!bundlePath || !out) throw new TypeError('--bundle and --out are required.');
  const bytes = await regular(resolve(bundlePath), 256 * 1024 * 1024), bundle = JSON.parse(bytes);
  const native = await nativeSource(sourceRoot), root = resolve(out);
  await begin(root, { mode: 'adopt', inputSha256: digest(bytes), sourceRoot: native.sourceRoot });
  await hostFiles(root, native);
  const workspace = join(root, 'workspace');
  const model = await exists(workspace) ? await openWorkspace(workspace) : await importWorkspace(workspace, bundle);
  try { return await completion(root, model, { importedBytes: bytes.length, importedSha256: digest(bytes) }); }
  finally { await model.close(); }
}

export async function installationEnvironment(root) {
  root = resolve(root);
  const marker = JSON.parse(await regular(join(root, 'installation.json')));
  if (marker.schema !== OWNED_SCHEMA) throw new Error('Expected an original Amberdata installation.');
  const runtime = JSON.parse(await regular(join(root, 'host/runtime.json')));
  if (!isAbsolute(runtime.sourceRoot) || !isAbsolute(runtime.nodeExecutable)) throw new Error('Original host runtime paths are invalid.');
  await regular(await realpath(join(runtime.sourceRoot, 'stellar/scf-starforge-20261009/sf30-seller-sdk/upstream.mjs')));
  const key = (await regular(join(root, 'host/page.key'), 100)).toString('utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Original host page key is invalid.');
  return { AMBERDATA_SOURCE_ROOT: runtime.sourceRoot, AMBERDATA_NODE_EXECUTABLE: runtime.nodeExecutable, AMBERDATA_PAGE_KEY: key };
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || ['help', '--help', '-h'].includes(argv[0])) { process.stdout.write(HELP); return; }
  const { command, flags, forward } = parse(argv);
  if (command === 'prepare' || command === 'adopt') {
    const result = await (command === 'prepare' ? prepareInstallation : adoptInstallation)({ ...flags, sourceRoot: flags['source-root'] });
    process.stdout.write(JSON.stringify({ ...result, currentState: stateSummary(result.currentState) }, null, 2) + '\n');
    return result;
  }
  if (!flags.dir) throw new TypeError('--dir is required.');
  const root = resolve(flags.dir);
  if (command === 'workspace') {
    if (!forward.length) throw new TypeError('An original Python workspace command is required after --.');
    Object.assign(process.env, await installationEnvironment(root));
    return workspaceMain([forward[0], '--workspace', join(root, 'workspace'), ...forward.slice(1)]);
  }
  const environment = await installationEnvironment(root);
  const model = await openWorkspace(join(root, 'workspace'));
  try {
    const result = { installation: JSON.parse(await regular(join(root, 'installation.json'))),
      nativeSourceRoot: environment.AMBERDATA_SOURCE_ROOT, providerKeyConfigured: Boolean(process.env.AMBERDATA_API_KEY),
      pageKeyConfigured: true, state: stateSummary(await model.state()) };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  } finally { await model.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write((error instanceof Error ? error.message : 'AMBERDATA_COMMAND_FAILED') + '\n'); process.exitCode = 1;
});
