// MIT. Shared read-only selection of the original normalized recovery host paths.
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code, status: 409 }); };
const absolute = value => {
  need(typeof value === 'string' && value.length <= 4096 && isAbsolute(value) &&
    resolve(value) === value && value !== '/' && !/[\u0000-\u001f\u007f]/.test(value),
  'RECOVERY_HOST_PATH_INVALID');
  return value;
};

/** Receive only readRecoveryConfiguration().host, preserving its original paths. */
export function recoveryHostPaths(host) {
  need(host && Array.isArray(host.profiles) && host.profiles.length <= 32, 'RECOVERY_HOST_PROFILES_REQUIRED');
  const rows = [];
  for (const profile of host.profiles) {
    need(ID.test(profile.id ?? ''), 'RECOVERY_HOST_PROFILE_INVALID');
    const add = (path, kind, role, required = false, selectionId = null, custody = 'captured') => {
      if (path == null) return;
      rows.push({ path: absolute(path), kind, required, role, profileId: profile.id, selectionId, custody });
    };
    add(profile.storeConfig, 'file', 'provider-configuration', true, null, 'external');
    add(profile.operations, 'directory', 'transfer-operations', true);
    add(profile.downloadRoot, 'directory', 'download-root', true);
    add(profile.restoreRoot, 'directory', 'restore-root', true);
    for (const row of profile.bundleRoots ?? []) add(row.directory, 'directory', 'bundle-root', true, row.id);
    for (const row of profile.capturePlans ?? []) add(row.planFile, 'file', 'capture-plan', false, row.id);
    for (const [key, role] of [['publisherRestores', 'publisher'], ['fleetRestores', 'fleet']])
      for (const row of profile[key] ?? []) {
        add(row.bundleDirectory, 'directory', role + '-restore-bundle', false, row.id);
        add(row.restoreDirectory, 'directory', role + '-restore-directory', false, row.id);
      }
    for (const row of profile.fleetTargets ?? []) {
      add(row.targetFile, 'file', 'fleet-target-private', true, row.id, 'external');
      add(row.operationDirectory, 'directory', 'fleet-receiving-operations', false, row.id);
    }
    add(profile.casesDirectory, 'directory', 'support-cases');
    add(profile.caseSourceDirectory, 'directory', 'support-source-deliveries');
    for (const row of profile.objectBundleArchives ?? []) add(row.path, 'file', 'object-archive', false, row.id);
    for (const row of profile.objectSessions ?? []) {
      add(row.stateRoot, 'directory', 'object-state-root', false, row.id);
      add(row.directory, 'directory', 'object-directory', false, row.id);
      for (const path of row.include ?? []) add(path, 'entry', 'object-include', false, row.id);
      add(row.bundle, 'directory', 'object-bundle', false, row.id);
    }
  }
  need(rows.length <= 4096, 'RECOVERY_HOST_PATH_LIMIT');
  return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

/** Observe absence through its nearest existing canonical ancestor, without mkdir. */
export async function observeRecoveryPath(row) {
  const path = absolute(row.path);
  need(['file', 'directory', 'entry'].includes(row.kind), 'RECOVERY_HOST_PATH_KIND_INVALID');
  let selected = path, info;
  for (;;) {
    try { info = await lstat(selected); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(selected);
      need(parent !== selected, 'RECOVERY_HOST_PATH_PARENT_MISSING'); selected = parent;
    }
  }
  need(!info.isSymbolicLink() && await realpath(selected) === selected,
    'RECOVERY_HOST_PATH_ALIAS_REJECTED');
  const exists = selected === path;
  if (!exists) need(info.isDirectory(), 'RECOVERY_HOST_PATH_PARENT_INVALID');
  if (exists) need((info.isDirectory() || info.isFile()) &&
    (row.kind === 'entry' || (row.kind === 'directory' ? info.isDirectory() : info.isFile())) &&
    (!info.isFile() || info.nlink === 1), 'RECOVERY_HOST_PATH_KIND_CHANGED');
  return { ...row, exists, ancestor: exists ? dirname(path) : selected,
    ...(exists ? { actualKind: info.isDirectory() ? 'directory' : 'file', dev: info.dev, ino: info.ino,
      bytes: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs } : {}) };
}
