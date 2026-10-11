// MIT. Immutable original facilitator configuration files in a host-selected directory.
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateConfig, reviewConfig } from '../config.mjs';
import { absolute, parseJson, readPrivateFile } from '../../sf103-native-buyer-signer/operator.mjs';

const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const digest = value => createHash('sha256').update(value).digest('hex');
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
export function fail(code, status = 400) { throw Object.assign(new Error(code), {code, status}); }
export function requireValue(value, code, status) { if (!value) fail(code, status); }
export async function privateDirectory(path, create = false) {
  absolute(path);
  if (create) await mkdir(path, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    (process.platform === 'win32' || (info.uid === process.getuid() && (info.mode & 0o077) === 0)),
  'FACILITATOR_WORKSPACE_PRIVATE_DIRECTORY_REQUIRED');
}
function profileName(name) {
  requireValue(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name),
    'FACILITATOR_PROFILE_NAME_INVALID');
  return name;
}

/** File names and the shared account-ownership directory are fixed by the host. */
export async function openProfileStore({directory, ownershipDirectory, create = false}) {
  await privateDirectory(directory, create);
  await privateDirectory(ownershipDirectory, create);
  const profiles = join(directory, 'profiles');
  await privateDirectory(profiles, true);
  function review(value) {
    const validated = validateConfig(value);
    const supplied = validated.operations.ownershipDirectory;
    requireValue(supplied === undefined || supplied === null || supplied === ownershipDirectory,
      'FACILITATOR_PROFILE_USES_HOST_OWNERSHIP_DIRECTORY');
    const config = validateConfig({...validated, operations:{...validated.operations, ownershipDirectory}});
    const source = bytes(config);
    requireValue(source.length <= 65536, 'CONFIG_FILE_TOO_LARGE');
    return {config, sha256:digest(source), bytes:source.length, summary:reviewConfig(config)};
  }
  async function read(name) {
    profileName(name);
    const path = join(profiles, name + '.json');
    const source = await readPrivateFile(path);
    const config = parseJson(source), reviewed = review(config);
    requireValue(isDeepStrictEqual(reviewed.config, config) && digest(source) === reviewed.sha256,
      'FACILITATOR_PROFILE_CHANGED');
    return {name, path, ...reviewed, commands:{
      review:[process.execPath, cli, '--review', '--config', path],
      serve:[process.execPath, cli, '--serve', '--config', path],
    }};
  }
  async function save({name, config, expectedSha256}) {
    profileName(name);
    const reviewed = review(config);
    requireValue(expectedSha256 === reviewed.sha256, 'FACILITATOR_REVIEW_CHANGED', 409);
    const path = join(profiles, name + '.json');
    const temporary = join(profiles, '.' + randomUUID() + '.partial');
    let file, reused = false;
    try {
      file = await open(temporary, 'wx', 0o600);
      await file.writeFile(bytes(reviewed.config)); await file.sync(); await file.close(); file = null;
      try { await link(temporary, path); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await read(name);
        requireValue(existing.sha256 === reviewed.sha256, 'FACILITATOR_PROFILE_NAME_ALREADY_EXISTS', 409);
        reused = true;
      }
      const parent = await open(profiles, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
      return {...await read(name), reused};
    } finally {
      await file?.close().catch(() => {});
      await rm(temporary, {force:true}).catch(() => {});
    }
  }
  async function list({after = '', limit = 30} = {}) {
    requireValue(after === '' || profileName(after), 'FACILITATOR_PROFILE_CURSOR_INVALID');
    requireValue(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'FACILITATOR_PROFILE_PAGE_INVALID');
    const names = (await readdir(profiles, {withFileTypes:true})).filter(entry => entry.isFile() &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/.test(entry.name)).map(entry => entry.name.slice(0,-5)).sort();
    const selected = names.filter(name => name > after).slice(0,limit), items = [];
    for (const name of selected) {
      try { const value = await read(name); items.push({name, sha256:value.sha256, bytes:value.bytes, summary:value.summary}); }
      catch (error) { items.push({name, unavailable:true, error:error.code ?? 'FACILITATOR_PROFILE_UNAVAILABLE'}); }
    }
    return {items, next:selected.length && names.some(name => name > selected.at(-1)) ? selected.at(-1) : null};
  }
  return Object.freeze({directory, ownershipDirectory, review, read, save, list});
}
