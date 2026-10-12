// MIT. Capture an actual Linux child identity once, at native launch.
// PID alone never authorizes recovery. Missing or raced observations stay explicit.
import { readFile, readlink, readdir, stat } from 'node:fs/promises';

const SCHEMA = 'stellar-forge.node-process-identity.v1';
const vanished = error => ['ENOENT', 'ESRCH'].includes(error?.code);

function procStat(raw) {
  const close = raw.lastIndexOf(')');
  if (close < 1) throw new Error('PROCESS_STAT_INVALID');
  const pid = Number(raw.slice(0, raw.indexOf(' ')));
  const fields = raw.slice(close + 2).trim().split(/\s+/);
  if (!Number.isSafeInteger(pid) || pid < 1 || fields.length < 20 ||
      !/^\d+$/.test(fields[19]) || !/^\d+$/.test(fields[1]))
    throw new Error('PROCESS_STAT_INVALID');
  return { procPid: pid, parentProcPid: Number(fields[1]), startTicks: fields[19] };
}

async function sample(procPid) {
  const base = '/proc/' + procPid;
  const before = procStat(await readFile(base + '/stat', 'utf8'));
  const [namespace, status] = await Promise.all([
    readlink(base + '/ns/pid'), readFile(base + '/status', 'utf8'),
  ]);
  const match = /^NSpid:\s+([0-9 \t]+)$/m.exec(status);
  if (!match || !/^pid:\[\d+\]$/.test(namespace)) throw new Error('PROCESS_NAMESPACE_UNAVAILABLE');
  const namespacePids = match[1].trim().split(/\s+/).map(Number);
  const after = procStat(await readFile(base + '/stat', 'utf8'));
  if (before.procPid !== after.procPid || before.startTicks !== after.startTicks ||
      before.parentProcPid !== after.parentProcPid)
    throw new Error('PROCESS_IDENTITY_CHANGED');
  return { ...after, namespace, namespacePids };
}

export async function captureChildProcessIdentity(pid) {
  const unavailable = reason => ({ schema: SCHEMA, status: 'UNAVAILABLE', pid, reason });
  if (process.platform !== 'linux') return unavailable('LINUX_PROCESS_IDENTITY_UNAVAILABLE');
  if (!Number.isSafeInteger(pid) || pid < 1) return unavailable('CHILD_PID_INVALID');
  try {
    const procfsDevice = (await stat('/proc', { bigint: true })).dev.toString();
    const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
    if (!/^[a-f0-9-]{36}$/.test(bootId)) return unavailable('BOOT_ID_UNAVAILABLE');
    const ownStat = procStat(await readFile('/proc/self/stat', 'utf8'));
    const ownNamespace = await readlink('/proc/self/ns/pid');
    const own = await sample(ownStat.procPid);
    const matches = candidate => candidate.namespace === ownNamespace &&
      candidate.namespacePids.at(-1) === pid && candidate.parentProcPid === own.procPid;
    const childCandidate = async procPid => {
      // A container PID may name an unrelated host process in this procfs.
      // Establish parent ownership before following a namespace link.
      const candidate = procStat(await readFile('/proc/' + procPid + '/stat', 'utf8'));
      if (candidate.parentProcPid !== own.procPid) return null;
      return sample(procPid);
    };
    let child = null;
    try { const direct = await childCandidate(pid); if (direct && matches(direct)) child = direct; }
    catch (error) { if (!vanished(error)) throw error; }
    if (!child) {
      // A container may expose a parent namespace's procfs. Resolve the child's
      // actual NSpid and namespace once, rather than treating an aliased PID as it.
      const entries = (await readdir('/proc')).filter(name => /^[1-9]\d*$/.test(name));
      if (entries.length > 131072) return unavailable('PROCESS_TABLE_LIMIT');
      for (const name of entries) {
        let candidate;
        try { candidate = await childCandidate(Number(name)); }
        catch (error) { if (vanished(error)) continue; throw error; }
        if (!candidate || !matches(candidate)) continue;
        if (child) return unavailable('CHILD_IDENTITY_AMBIGUOUS');
        child = candidate;
      }
    }
    if (!child) return unavailable('CHILD_ENDED_BEFORE_IDENTITY_CAPTURE');
    const checked = await sample(child.procPid);
    const parent = await sample(own.procPid);
    if (!matches(checked) || checked.startTicks !== child.startTicks ||
        parent.startTicks !== own.startTicks ||
        (await stat('/proc', { bigint: true })).dev.toString() !== procfsDevice ||
        (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() !== bootId)
      return unavailable('PROCESS_IDENTITY_CHANGED');
    return {
      schema: SCHEMA, status: 'RECORDED', pid, procPid: checked.procPid,
      startTicks: checked.startTicks, namespace: checked.namespace, bootId, procfsDevice,
      parent: { procPid: parent.procPid, startTicks: parent.startTicks, namespace: parent.namespace },
      capturedAt: new Date().toISOString(),
    };
  } catch (error) {
    return unavailable(vanished(error) ? 'CHILD_ENDED_BEFORE_IDENTITY_CAPTURE' : 'PROCESS_IDENTITY_NOT_OBSERVED');
  }
}

