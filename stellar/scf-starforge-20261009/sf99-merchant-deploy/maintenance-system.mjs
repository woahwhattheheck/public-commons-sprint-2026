// MIT. Linux host operations for the original SF99 merchant deployment.
import { constants } from 'node:fs';
import { lstat, readFile, open, rename, unlink, mkdir, realpath, readdir, chmod, chown } from 'node:fs/promises';
import { resolve, isAbsolute, join, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkBundle, prepare } from './host.mjs';

const exec = promisify(execFile);
export const MAINTENANCE_SCHEMA = 'stellar-forge.merchant-maintenance.v1';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const inside = (root, file) => file === root || file.startsWith(root + '/');
export const need = (yes, message) => { if (!yes) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed, name) => need(object(value) && Object.keys(value).every(k => allowed.includes(k)), 'Invalid ' + name);
export function absolute(value, name = 'path') {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !/[\\\x00-\x1f\x7f]/.test(value), 'Normalized absolute ' + name + ' required');
  return value;
}
export async function regular(file, maximum = 4 * 1024 * 1024) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    need(info.isFile() && info.nlink === 1 && info.size <= maximum, 'Regular bounded file required: ' + file);
    const bytes = await handle.readFile(); need(bytes.length <= maximum, 'File grew beyond its limit');
    return bytes;
  } finally { await handle.close(); }
}
export const jsonFile = async file => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(file)));
export async function privateDirectory(file) {
  absolute(file); const info = await lstat(file);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(file) === file &&
    !(info.mode & 0o077), 'Real private 0700 directory required: ' + file);
}
async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
/** Compare the existing owned bytes before replacing a single file. */
export async function atomicFile(file, value, { allowed, mode = 0o600, uid, gid } = {}) {
  let previous = null, info;
  try { previous = digest(await regular(file)); info = await lstat(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (allowed) need(allowed.includes(previous), 'Owned file changed: ' + file);
  const parent = dirname(file), parentInfo = await lstat(parent);
  need(parentInfo.isDirectory() && !parentInfo.isSymbolicLink() && await realpath(parent) === parent,
    'Real parent directory required: ' + parent);
  const temporary = join(parent, '.sf99-' + randomUUID());
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    if (uid !== undefined || info) await handle.chown(uid ?? info.uid, gid ?? info.gid);
    await handle.chmod(mode); await handle.writeFile(value); await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, file); await syncDirectory(parent);
  } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export const atomicJSON = (file, value) => atomicFile(file, JSON.stringify(value, null, 2) + '\n');
export async function removeOwned(file, expected) {
  try { need(digest(await regular(file)) === expected, 'Owned file changed: ' + file); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  await unlink(file); await syncDirectory(dirname(file));
}

export async function loadMaintenance(file) {
  file = absolute(resolve(file), 'maintenance plan');
  const rawBytes = await regular(file), raw = JSON.parse(rawBytes);
  fields(raw, ['schema','bundle','operationsRoot','systemdDirectory','caddy','extraWriterUnits','writerTemplates',
    'recoveryPlan','passphraseEnv','runtime'], 'maintenance plan fields');
  need(raw.schema === MAINTENANCE_SCHEMA, 'Original merchant maintenance schema required');
  const p = await checkBundle(absolute(raw.bundle, 'deployment bundle'));
  // The original host plan is not itself one of its service inputs. Bind it now.
  const repeated = await prepare(p.planFile, { sourceRoot: p.sourceRoot });
  for (const key of Object.keys(repeated)) need(JSON.stringify(repeated[key]) === JSON.stringify(p[key]),
    'Original host plan no longer reproduces the installed bundle: ' + key);
  const operationsRoot = absolute(raw.operationsRoot, 'operationsRoot');
  await privateDirectory(operationsRoot);
  need((await lstat(operationsRoot)).uid === 0, 'Operation journal must belong to the host administrator');
  const systemdDirectory = absolute(raw.systemdDirectory ?? '/etc/systemd/system', 'systemdDirectory');
  need(await realpath(systemdDirectory) === systemdDirectory, 'Real systemd directory required');
  fields(raw.caddy, ['fragment','config','unit','binary'], 'Caddy configuration');
  const caddy = { fragment: absolute(raw.caddy.fragment, 'merchant fragment'), config: absolute(raw.caddy.config, 'Caddy config'),
    unit: raw.caddy.unit ?? 'caddy.service', binary: absolute(raw.caddy.binary ?? '/usr/bin/caddy', 'Caddy binary') };
  need(caddy.fragment !== caddy.config && /^[A-Za-z0-9_.@:-]+\.service$/.test(caddy.unit), 'Separate imported merchant fragment and Caddy service required');
  await regular(caddy.config); await regular(caddy.fragment);
  const ownUnits = [...p.services.map(s => s.unit), p.target];
  const extra = raw.extraWriterUnits ?? [];
  need(Array.isArray(extra) && extra.length <= 32 && new Set(extra).size === extra.length &&
    extra.every(s => typeof s === 'string' && /^[A-Za-z0-9_@:-][A-Za-z0-9_.@:-]*\.(service|timer|socket|path)$/.test(s) &&
      !ownUnits.includes(s) && s !== caddy.unit), 'List the distinct owned external writer/activation units');
  const recoveryPlan = absolute(raw.recoveryPlan ?? join(p.bundle, 'recovery-plan.json'), 'recovery plan');
  const recoveryBytes = await regular(recoveryPlan), recovery = JSON.parse(recoveryBytes);
  need(recovery.schema === 'stellar-forge.merchant-recovery-plan.v1' && Array.isArray(recovery.roots) &&
    recovery.roots.length > 0 && recovery.roots.length <= 20, 'Original SF101 recovery plan required');
  for (const root of recovery.roots) absolute(root.path, 'recovery root');
  const selected = [p.stateRoot, ...p.inputFiles.map(f => f.path)];
  for (const file of selected) need(recovery.roots.some(root => inside(root.path, file)), 'Recovery plan omits selected merchant state/configuration: ' + file);
  for (const root of recovery.roots) {
    need(!inside(root.path, operationsRoot) && !inside(operationsRoot, root.path), 'Operation journal must be outside every recovered root');
    need(!p.environmentFile || !inside(root.path, p.environmentFile), 'Keep the service environment in its original secret store');
  }
  for (const directory of [p.sourceRoot, p.bundle, p.stateRoot, systemdDirectory, dirname(caddy.fragment)])
    need(!inside(directory, operationsRoot) && !inside(operationsRoot, directory), 'Operation journal overlaps another host component');
  const passphraseEnv = raw.passphraseEnv ?? 'SF101_RECOVERY_PASSPHRASE';
  need(/^[A-Z][A-Z0-9_]{4,63}$/.test(passphraseEnv), 'Original SF101 passphrase variable name required');
  const runtime = raw.runtime ?? {};
  fields(runtime, ['systemctl','systemdAnalyze','runuser','getent'], 'maintenance runtime');
  const binaries = { systemctl: '/usr/bin/systemctl', systemdAnalyze: '/usr/bin/systemd-analyze', runuser: '/usr/sbin/runuser', getent: '/usr/bin/getent', ...runtime };
  for (const [name, binary] of Object.entries(binaries)) absolute(binary, name);
  return { file, raw, planDigest: digest(rawBytes), p, operationsRoot, systemdDirectory, caddy,
    ownUnits, units: [...ownUnits, ...extra], extraWriterUnits: extra, recoveryPlan, recovery,
    recoveryDigest: digest(recoveryBytes), passphraseEnv, binaries };
}

export const maintenanceFragment = (p, id) => `${p.publicOrigin} {\n  header Cache-Control "no-store"\n  header Retry-After "60"\n  header X-Stellar-Forge-Maintenance "${id}"\n  respond "Merchant maintenance" 503\n}\n`;
// This directive takes its whole raw path, unlike ExecStart word lists. Quoting
// it makes systemd ignore the condition as non-absolute (even with exit code 0).
export const guardText = marker => '[Unit]\nConditionPathExists=!' + absolute(marker).replaceAll('%', '%%') + '\n';

export function createLinuxHost(plan) {
  need(process.platform === 'linux' && process.getuid?.() === 0, 'Run host maintenance as the existing Linux host administrator');
  const { p, caddy, binaries, systemdDirectory } = plan;
  const command = async (binary, args, timeout = 330000) => {
    try { return (await exec(binary, args, { timeout, maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8' }, shell: false })).stdout; }
    catch { throw new Error('HOST_COMMAND_FAILED: ' + binary + ' ' + args[0]); }
  };
  const ctl = (...args) => command(binaries.systemctl, args);
  async function states(units = plan.units) {
    const output = await ctl('show', '--property=Id,LoadState,ActiveState,SubState,MainPID,ControlPID,FragmentPath,DropInPaths,User,Group,DynamicUser', '--', ...units);
    const records = output.trim().split(/\n\s*\n/).map(block => Object.fromEntries(block.split('\n').filter(Boolean).map(line => {
      const n = line.indexOf('='); return [line.slice(0, n), line.slice(n + 1)];
    })));
    return units.map(unit => { const record = records.find(r => r.Id === unit);
      need(record && record.LoadState === 'loaded', 'Original host unit not loaded: ' + unit);
      return { ...record, MainPID: Number(record.MainPID ?? 0), ControlPID: Number(record.ControlPID ?? 0) };
    });
  }
  const stopped = rows => rows.every(r => ['inactive','failed'].includes(r.ActiveState) && r.MainPID === 0 && r.ControlPID === 0);
  async function assertStopped() { need(stopped(await states()), 'Owned writer group has not stopped'); }
  const dropin = unit => join(systemdDirectory, unit + '.d', '90-stellar-forge-maintenance.conf');
  async function guards(units, marker, present) {
    for (const unit of units) {
      const file = dropin(unit), text = guardText(marker);
      if (present) {
        try { await mkdir(dirname(file), { mode: 0o755 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        await atomicFile(file, text, { allowed: [null, digest(text)], mode: 0o644 });
      } else await removeOwned(file, digest(text));
    }
    await ctl('daemon-reload');
  }
  async function reloadProxy() {
    const live = (await states([caddy.unit]))[0]; need(live.ActiveState === 'active', 'Existing shared Caddy service must be active');
    await command(caddy.binary, ['validate','--adapter','caddyfile','--config',caddy.config], 60000);
    await command(caddy.binary, ['reload','--adapter','caddyfile','--config',caddy.config], 60000);
  }
  async function publicRequest(path) {
    const response = await fetch(p.publicOrigin + path, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    await response.body?.cancel(); return response;
  }
  async function account(name) {
    const entry = (await command(binaries.getent, ['passwd',name], 10000)).trim().split(':');
    const uid = Number(entry[2]);
    need(entry.length >= 7 && Number.isSafeInteger(uid) && uid >= 0, 'Resolve the existing service account: ' + name);
    return uid;
  }
  async function writerFiles(writers, restore = false) {
    for (const file of writers.files) {
      const bytes = restore ? Buffer.from(file.original.bytesBase64, 'base64') : await regular(file.candidate);
      need(digest(bytes) === (restore ? file.original.sha256 : file.sha256), 'Retained writer bytes changed: ' + file.path);
      await atomicFile(file.path, bytes, { allowed: [file.original.sha256, ...(file.sha256 ? [file.sha256] : [])],
        mode: file.original.mode, uid: file.original.uid, gid: file.original.gid });
    }
    await ctl('daemon-reload');
  }
  return {
    states, assertStopped,
    async validateInstalled() {
      const rows = await states();
      for (const name of plan.ownUnits) {
        const row = rows.find(r => r.Id === name), installed = join(systemdDirectory, name);
        need(row.FragmentPath === installed && !row.DropInPaths, 'Use the original generated unit without untracked overrides: ' + name);
        need(digest(await regular(installed)) === p.artifacts[name], 'Installed unit differs from its deployment bundle: ' + name);
      }
      need(digest(await regular(caddy.fragment)) === p.artifacts.Caddyfile, 'Imported Caddy fragment differs from the original bundle');
      need(rows.filter(r => plan.ownUnits.includes(r.Id)).every(r => r.ActiveState === 'active'), 'Start from the running original merchant component group');
      return rows;
    },
    async validateWriters(templates, rows) {
      const merchantUid = await account(p.serviceUser);
      for (const unit of templates.units) {
        const row = rows.find(record => record.Id === unit), files = templates.files.filter(file => file.unit === unit);
        const installed = join(systemdDirectory, unit);
        const dropins = files.map(file => file.path).filter(file => file !== installed).sort();
        need(row?.FragmentPath === installed && row.DropInPaths === dropins.join(' '),
          'Loaded writer fragment/drop-ins differ from the pinned files: ' + unit);
        if (/\.(service|socket)$/.test(unit)) {
          need(row.DynamicUser !== 'yes', 'Use the existing stable merchant/root account for a migrated writer: ' + unit);
          const uid = row.User ? await account(row.User) : 0;
          need(uid === 0 || uid === merchantUid, 'Writer must own the restored private state as the existing merchant account: ' + unit);
        }
      }
    },
    async pause(id, expectedFragments) {
      const text = maintenanceFragment(p, id);
      await atomicFile(caddy.fragment, text, { allowed: [...expectedFragments, digest(text)], mode: 0o644 });
      await reloadProxy();
      const deadline = Date.now() + 15000;
      do {
        try {
          const response = await publicRequest('/_seller/openapi.json');
          if (response.status === 503 && response.headers.get('x-stellar-forge-maintenance') === id) return;
        } catch { /* A proxy reload can close a previously pooled read connection. */ }
        await new Promise(done => setTimeout(done, 150));
      } while (Date.now() < deadline);
      throw new Error('Public ingress did not enter this operation\'s maintenance mode');
    },
    async expose(bundle, id) {
      const current = await checkBundle(bundle), text = await regular(join(bundle, 'Caddyfile'));
      await atomicFile(caddy.fragment, text, { allowed: [digest(maintenanceFragment(p, id)), current.artifacts.Caddyfile], mode: 0o644 });
      await reloadProxy();
    },
    guards,
    async stop() { await ctl('stop', '--', ...plan.units); await assertStopped(); },
    async install(bundle, previousCandidate) {
      const next = await checkBundle(bundle);
      const prior = previousCandidate ? await checkBundle(previousCandidate) : null;
      need(next.merchant === p.merchant && next.publicOrigin === p.publicOrigin && next.kind === p.kind && next.mode === p.mode &&
        next.serviceUser === p.serviceUser && next.serviceGroup === p.serviceGroup &&
        JSON.stringify(next.services.map(s => s.unit)) === JSON.stringify(p.services.map(s => s.unit)), 'Restored host changes the merchant/service identity');
      await command(binaries.systemdAnalyze, ['verify','--man=no',...plan.ownUnits.map(name => join(bundle, name))], 60000);
      for (const name of plan.ownUnits) await atomicFile(join(systemdDirectory, name), await regular(join(bundle, name)),
        { allowed: [p.artifacts[name], next.artifacts[name], ...(prior ? [prior.artifacts[name]] : [])], mode: 0o644 });
      await ctl('daemon-reload');
    },
    async installWriters(writers, bundle) {
      // Parse all selected fragments with their original drop-ins before any
      // writer is restarted. Staged paths preserve the systemd unit hierarchy.
      await command(binaries.systemdAnalyze, ['verify','--man=no',
        ...plan.ownUnits.map(name => join(bundle, name)),
        ...writers.units.map(name => join(writers.directory, 'units', name))], 60000);
      await writerFiles(writers);
    },
    async restoreWriters(templates, candidate) { await writerFiles(candidate ?? templates, true); },
    async grantRestoredAccess(destination, candidate) {
      const pw = (await command(binaries.getent, ['passwd',p.serviceUser], 10000)).trim().split(':');
      const group = (await command(binaries.getent, ['group',p.serviceGroup], 10000)).trim().split(':');
      const uid = Number(pw[2]), gid = Number(group[2]);
      need(pw[0] === p.serviceUser && group[0] === p.serviceGroup && Number.isSafeInteger(uid) && uid > 0 && Number.isSafeInteger(gid) && gid > 0,
        'Original unprivileged service account and group must exist');
      let entries = 0;
      const walk = async (file, rootOwned = false) => {
        need(++entries <= 22000, 'Restored host exceeds original recovery file limit');
        const st = await lstat(file);
        need(!st.isSymbolicLink() && (st.isDirectory() || st.isFile() && st.nlink === 1), 'Unsafe restored host entry');
        const control = rootOwned || file === candidate.bundle || file === candidate.planFile || file === candidate.writers?.directory;
        await chown(file, control ? 0 : uid, gid); await chmod(file, st.isDirectory() ? control ? 0o750 : 0o700 : control ? 0o640 : 0o600);
        if (st.isDirectory()) for (const child of await readdir(file)) await walk(join(file, child), control);
      };
      // Only the newly created destination is changed; original source/state stay intact.
      for (const child of await readdir(destination)) await walk(join(destination, child));
      await chown(destination, 0, gid); await chmod(destination, 0o750);
      const next = await checkBundle(candidate.bundle);
      await command(binaries.runuser, ['-u',p.serviceUser,'-g',p.serviceGroup,'--',next.node,
        join(next.sourceRoot,'stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs'),'check','--bundle',candidate.bundle], 30000);
      if (candidate.writers) {
        const rows = await states(candidate.writers.units);
        for (const row of rows.filter(record => /\.(service|socket)$/.test(record.Id))) {
          if (!row.User || await account(row.User) === 0) continue;
          const user = (await command(binaries.getent, ['passwd',row.User], 10000)).trim().split(':');
          const group = (await command(binaries.getent, ['group',row.Group || user[3]], 10000)).trim().split(':');
          need(user[0] && group[0], 'Resolve the original external writer identity: ' + row.Id);
          const selected = candidate.writers.files.filter(file => file.unit === row.Id)
            .flatMap(file => file.changes.map(change => change.to));
          // Observe traversal under the writer's original account and group.
          // A future output path is checked through its nearest existing parent.
          const check = 'const fs=require("node:fs"),p=require("node:path");for(let f of JSON.parse(process.argv[1])){let s;'
            + 'for(;;){try{s=fs.statSync(f);break;}catch(e){if(e.code!=="ENOENT"||f===p.dirname(f))throw e;f=p.dirname(f);}}'
            + 'fs.accessSync(f,fs.constants.R_OK);fs.accessSync(s.isDirectory()?f:p.dirname(f),fs.constants.X_OK);}';
          await command(binaries.runuser, ['-u',user[0],'-g',group[0],'--',next.node,'-e',check,JSON.stringify(selected)], 30000);
        }
      }
    },
    async startReaders(bundle, marker) {
      const current = await checkBundle(bundle);
      const readers = current.services.filter(s => s.role !== 'delivery').map(s => s.unit);
      await guards(readers, marker, false);
      await ctl('start', '--', ...readers);
      const rows = await states(readers); need(rows.every(r => r.ActiveState === 'active' && r.MainPID > 0), 'Restored merchant reader services are not active');
    },
    async startOriginalGroup(originalStates, marker) {
      await guards(plan.units, marker, false);
      const active = originalStates.filter(r => r.ActiveState === 'active').map(r => r.Id);
      if (active.length) await ctl('start', '--', ...active);
      const rows = await states(active); need(rows.every(r => r.ActiveState === 'active'), 'Original active service group did not resume');
    },
    async smoke(bundle, publicOrigin = false) {
      const { smoke } = await import('./cli.mjs');
      const deadline = Date.now() + 30000;
      do {
        const result = await smoke(bundle, { publicOrigin });
        if (result.passed) return result;
        await new Promise(done => setTimeout(done, 250));
      } while (Date.now() < deadline);
      throw new Error('Original merchant readiness/public confinement check failed');
    },
  };
}
