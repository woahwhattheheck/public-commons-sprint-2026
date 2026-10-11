// MIT. Reusable private launch settings for the original merchant desk.
import { constants } from 'node:fs';
import { lstat, realpath, mkdir, open, unlink, rmdir } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute, relative } from 'node:path';
import { readCheckout, need, object } from '../checkout-config.mjs';

const SCHEMA = 'stellar-forge.sf101.merchant-desk-workspace.v1';
const ENV = /^[A-Z][A-Z0-9_]{1,64}$/;
const MAX_SETTINGS_BYTES = 16384;

export async function privateDirectory(path) {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && path !== '/',
    'DESK_ABSOLUTE_DIRECTORY_REQUIRED');
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    (process.platform === 'win32' || (info.mode & 0o077) === 0), 'DESK_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}

async function privateFile(path, maxBytes) {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path,
    'DESK_ABSOLUTE_FILE_REQUIRED');
  need(await realpath(path) === path, 'DESK_REGULAR_FILE_REQUIRED');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    need(info.isFile() && info.size <= maxBytes &&
      (process.platform === 'win32' || (info.mode & 0o077) === 0), 'DESK_PRIVATE_FILE_REQUIRED');
    const bytes = await file.readFile();
    need(bytes.length <= maxBytes, 'DESK_SETTINGS_TOO_LARGE');
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  } finally { await file.close(); }
}

function within(child, parent) {
  const path = relative(parent, child);
  return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith('../');
}

function settings(input) {
  need(object(input) && input.schema === SCHEMA && Object.keys(input).every(key =>
    ['schema','config','filesRoot','outputRoot','claimEnvs','actor'].includes(key)), 'DESK_WORKSPACE_INVALID');
  for (const key of ['config','filesRoot','outputRoot']) need(typeof input[key] === 'string' &&
    isAbsolute(input[key]) && resolve(input[key]) === input[key], 'DESK_WORKSPACE_PATH_INVALID');
  need(Array.isArray(input.claimEnvs) && input.claimEnvs.length >= 1 && input.claimEnvs.length <= 32 &&
    input.claimEnvs.every(name => typeof name === 'string' && ENV.test(name)) &&
    new Set(input.claimEnvs).size === input.claimEnvs.length, 'DESK_CLAIM_ENV_NAMES_REQUIRED');
  need(typeof input.actor === 'string' && input.actor.length >= 1 && input.actor.length <= 120 &&
    !/[\u0000-\u001f\u007f]/.test(input.actor), 'DESK_ACTOR_INVALID');
  return structuredClone(input);
}

async function validateInputs(input) {
  const value = settings(input);
  await privateDirectory(value.filesRoot);
  await privateFile(value.config, 131072);
  const checkout = await readCheckout(value.config);
  const roots = [value.filesRoot, value.outputRoot, checkout.state, checkout.outbox];
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++)
    need(!within(roots[i], roots[j]) && !within(roots[j], roots[i]), 'DESK_ROOTS_MUST_BE_SEPARATE');
  need(!within(value.config, value.filesRoot), 'DESK_CONFIG_CANNOT_BE_SELLABLE_FILE');
  return {settings:value, checkout};
}

/** Creates launch settings only. Order and access state remain in merchant.sqlite3. */
export async function initializeDeskWorkspace({directory, config, filesRoot,
  claimEnvs = ['SF101_CLAIM_TOKEN'], actor = 'merchant-operator'}) {
  const workspace = resolve(directory), descriptor = join(workspace, 'desk.json');
  need(workspace !== '/', 'DESK_NEW_DIRECTORY_REQUIRED');
  const parent = dirname(workspace);
  need((await lstat(parent)).isDirectory() && await realpath(parent) === parent,
    'DESK_EXISTING_PARENT_REQUIRED');
  const compiled = await validateInputs({schema:SCHEMA, config:resolve(config), filesRoot:resolve(filesRoot),
    outputRoot:join(workspace, 'exports'), claimEnvs, actor});
  // Require a fresh directory; never repoint an existing merchant workspace.
  await mkdir(workspace, {mode:0o700});
  let descriptorCreated = false, exportsCreated = false;
  try {
    await mkdir(compiled.settings.outputRoot, {mode:0o700}); exportsCreated = true;
    const handle = await open(descriptor, 'wx', 0o600); descriptorCreated = true;
    try { await handle.writeFile(JSON.stringify(compiled.settings, null, 2) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
  } catch (error) {
    if (descriptorCreated) await unlink(descriptor).catch(() => {});
    if (exportsCreated) await rmdir(compiled.settings.outputRoot).catch(() => {});
    await rmdir(workspace).catch(() => {});
    throw error;
  }
  return {status:'MERCHANT_DESK_WORKSPACE_CREATED', workspace, descriptor,
    filesRoot:compiled.settings.filesRoot, outputRoot:compiled.settings.outputRoot,
    originalOrderStore:compiled.checkout.state, originalDeliveryOutbox:compiled.checkout.outbox};
}

export async function openDeskWorkspace(directory) {
  const workspace = await privateDirectory(resolve(directory));
  const compiled = await validateInputs(await privateFile(join(workspace, 'desk.json'), MAX_SETTINGS_BYTES));
  need(compiled.settings.outputRoot === join(workspace, 'exports'), 'DESK_WORKSPACE_EXPORT_ROOT_INVALID');
  await privateDirectory(compiled.settings.outputRoot);
  return {workspace, ...compiled};
}

export async function inspectDeskWorkspace(directory, {env = process.env} = {}) {
  const {workspace, settings:value, checkout} = await openDeskWorkspace(directory);
  return {status:'MERCHANT_DESK_WORKSPACE_VALID', workspace, config:value.config,
    filesRoot:value.filesRoot, outputRoot:value.outputRoot, actor:value.actor,
    claimEnvs:value.claimEnvs.map(name => ({name, available:typeof env[name] === 'string' && env[name].length > 0})),
    originalOrderStore:checkout.state, originalDeliveryOutbox:checkout.outbox,
    offer:checkout.service.routes[0].offer};
}
