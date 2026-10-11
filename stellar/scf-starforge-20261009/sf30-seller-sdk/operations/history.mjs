// MIT. Local aggregate history for the ORIGINAL SF30 observer. No request or payment data.
import { open, mkdir, readdir, lstat, readFile, rename, unlink, link, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';

const DAY = 86400000;
const COUNTS = ['started', 'completed', 'responses', 'success', 'challenge', 'clientError',
  'serverError', 'other', 'disconnected'];
const BOUNDS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 15000, null];
const SESSION_SCHEMA = 'stellar-forge.seller-usage-session.v1';
const REPORT_SCHEMA = 'stellar-forge.seller-usage-history.v1';
const COVERAGE_FORMAT = 'stellar-forge.seller-usage-day-routes.v1';
const SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/;
const FILE = /^session-([A-Za-z0-9_-]{1,80})\.json$/;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_LOADED_BYTES = 256 * 1024 * 1024;
const MAX_SESSIONS = 4096;

function fail(message, code = 'HISTORY_INVALID_DATA') {
  const error = new Error(message); error.code = code; throw error;
}
function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('History counters must be nonnegative safe integers');
  return value;
}
function finite(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    fail('History durations must be finite and nonnegative');
  return value;
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    fail('History requires original ISO UTC timestamps');
  return value;
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) ||
      new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) !== value)
    fail('Use a valid YYYY-MM-DD UTC date');
  return value;
}
function routeDefinition(row) {
  if (!row || typeof row.id !== 'string' ||
      !(/^[A-Za-z0-9_-]{1,80}$/.test(row.id) || ['@unmatched', '@method', '@invalid'].includes(row.id)) ||
      typeof row.path !== 'string' || row.path.length > 2048 || /[\u0000-\u001f]/.test(row.path) ||
      !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', '-'].includes(row.method))
    fail('Original configured route metadata required');
  return { id: row.id, method: row.method, path: row.path };
}
function routeKey(row) {
  return createHash('sha256').update(JSON.stringify([row.id, row.method, row.path])).digest('hex').slice(0, 24);
}
function empty() {
  return { ...Object.fromEntries(COUNTS.map(key => [key, 0])), durationMaxMs: 0,
    durationHistogram: { count: 0, sumMs: 0, buckets: BOUNDS.map(upperBoundMs => ({ upperBoundMs, count: 0 })) },
    statuses: {} };
}
function metrics(row) {
  if (!row || typeof row !== 'object') fail('Original observer aggregates required');
  const result = Object.fromEntries(COUNTS.map(key => [key, count(row[key])]));
  const responses = result.success + result.challenge + result.clientError + result.serverError + result.other;
  if (responses !== result.responses || result.completed !== result.responses + result.disconnected)
    fail('Original observer outcome counters do not conserve');
  result.durationMaxMs = finite(row.durationMaxMs);
  const histogram = row.durationHistogram;
  if (!histogram || !Array.isArray(histogram.buckets) || histogram.buckets.length !== BOUNDS.length)
    fail('Original duration histogram required');
  result.durationHistogram = { count: count(histogram.count), sumMs: finite(histogram.sumMs),
    buckets: histogram.buckets.map((bin, i) => {
      if (!bin || bin.upperBoundMs !== BOUNDS[i]) fail('Original histogram bucket bounds required');
      return { upperBoundMs: BOUNDS[i], count: count(bin.count) };
    }) };
  if (histogram.count !== result.completed ||
      result.durationHistogram.buckets.reduce((total, bin) => total + bin.count, 0) !== result.completed)
    fail('Original histogram population does not match completions');
  result.statuses = {};
  if (!row.statuses || typeof row.statuses !== 'object' || Array.isArray(row.statuses))
    fail('Original finished HTTP status counters required');
  for (const [status, value] of Object.entries(row.statuses)) {
    if (!/^[1-9]\d{2}$/.test(status)) fail('Invalid finished HTTP status');
    result.statuses[status] = count(value);
  }
  if (Object.values(result.statuses).reduce((a, b) => a + b, 0) !== result.responses)
    fail('Original status counters do not match finished responses');
  return result;
}
function add(target, source) {
  for (const key of COUNTS) target[key] = count(target[key] + source[key]);
  target.durationMaxMs = Math.max(target.durationMaxMs, source.durationMaxMs);
  target.durationHistogram.count = target.completed;
  target.durationHistogram.sumMs = finite(target.durationHistogram.sumMs + source.durationHistogram.sumMs);
  source.durationHistogram.buckets.forEach((bin, i) => {
    target.durationHistogram.buckets[i].count = count(target.durationHistogram.buckets[i].count + bin.count);
  });
  for (const [status, value] of Object.entries(source.statuses))
    target.statuses[status] = count((target.statuses[status] ?? 0) + value);
  return target;
}
function cumulative(next, previous) {
  for (const key of COUNTS) if (next[key] < previous[key])
    fail('Original cumulative counters moved backwards', 'HISTORY_COUNTER_REGRESSION');
  if (next.durationHistogram.sumMs < previous.durationHistogram.sumMs ||
      next.durationMaxMs < previous.durationMaxMs ||
      next.durationHistogram.buckets.some((bin, i) => bin.count < previous.durationHistogram.buckets[i].count) ||
      Object.entries(previous.statuses).some(([status, value]) => (next.statuses[status] ?? 0) < value))
    fail('Original cumulative histogram or status counters moved backwards', 'HISTORY_COUNTER_REGRESSION');
}
function view(row) {
  const result = structuredClone(row), target = Math.ceil(row.completed * 0.95);
  let cumulative = 0, p95 = null;
  if (target) for (const bin of row.durationHistogram.buckets) {
    cumulative += bin.count;
    if (cumulative >= target) { p95 = bin.upperBoundMs ?? '>15000'; break; }
  }
  return { ...result,
    durationMeanMs: row.completed ? Math.round(row.durationHistogram.sumMs / row.completed * 100) / 100 : null,
    latencyP95UpperBoundMs: p95,
    httpSuccessPercent: row.responses ? Math.round(row.success / row.responses * 10000) / 100 : null };
}
function normalizeDays(days, definitions) {
  if (!Array.isArray(days) || days.length > 366) fail('Original observer UTC daily aggregates required');
  const seen = new Set();
  return days.map(entry => {
    const date = day(entry?.day);
    if (seen.has(date)) fail('Duplicate observer day');
    seen.add(date);
    if (!Array.isArray(entry.routes) || entry.routes.length > definitions.size)
      fail('Original daily route aggregates required');
    const routeIds = new Set(), total = empty();
    const routes = entry.routes.map(row => {
      const definition = routeDefinition(row), original = definitions.get(definition.id);
      if (!original || JSON.stringify(original) !== JSON.stringify(definition) || routeIds.has(definition.id))
        fail('Daily route identity differs from the original session');
      routeIds.add(definition.id);
      const value = metrics(row); add(total, value);
      return { ...definition, ...value };
    });
    const originalTotal = metrics(entry.totals);
    for (const key of COUNTS) if (total[key] !== originalTotal[key])
      fail('Daily route counts do not match the original daily total');
    for (let i = 0; i < BOUNDS.length; i++)
      if (total.durationHistogram.buckets[i].count !== originalTotal.durationHistogram.buckets[i].count)
        fail('Daily route histogram does not match the original total');
    if ([...new Set([...Object.keys(total.statuses), ...Object.keys(originalTotal.statuses)])]
        .some(status => (total.statuses[status] ?? 0) !== (originalTotal.statuses[status] ?? 0)))
      fail('Daily route status counters do not match the original total');
    return { day: date, totals: originalTotal, routes };
  }).sort((a, b) => a.day.localeCompare(b.day));
}
function normalizeSnapshot(snapshot) {
  if (snapshot?.schema !== 'stellar-forge.seller-traffic.v1' || !SESSION_ID.test(snapshot.sessionId ?? '') ||
      !['NATIVE_X402', 'CHALLENGE_ONLY', 'UNKNOWN'].includes(snapshot.mode) ||
      !Array.isArray(snapshot.routes) || snapshot.routes.length > 103 || !snapshot.routes.length)
    fail('Original SF30 traffic snapshot with UTC days required');
  const definitions = new Map();
  for (const row of snapshot.routes) {
    const definition = routeDefinition(row);
    if (definitions.has(definition.id)) fail('Duplicate original route identity');
    definitions.set(definition.id, definition);
  }
  const totals = metrics(snapshot.totals);
  if (totals.completed > totals.started || count(snapshot.totals.inFlight) !== totals.started - totals.completed)
    fail('Original session in-flight count does not conserve');
  return { sessionId: snapshot.sessionId, startedAt: instant(snapshot.startedAt),
    capturedAt: instant(snapshot.capturedAt), mode: snapshot.mode,
    observerErrors: count(snapshot.observerErrors), ignoredMetadata: count(snapshot.ignoredMetadata),
    totals, outstandingAtCheckpoint: snapshot.totals.inFlight,
    routes: [...definitions.values()], days: normalizeDays(snapshot.days, definitions) };
}
function normalizeSaved(record, filenameId) {
  if (record?.schema !== SESSION_SCHEMA || record.sessionId !== filenameId ||
      !['ACTIVE', 'FINALIZED'].includes(record.state)) fail('Invalid history session record');
  // Reuse the ORIGINAL schema checks, including whitelisting out unknown/request fields.
  const normalized = normalizeSnapshot({ ...record, schema: 'stellar-forge.seller-traffic.v1',
    totals: { ...record.totals, inFlight: record.outstandingAtCheckpoint } });
  return { schema: SESSION_SCHEMA, ...normalized, state: record.state,
    savedAt: instant(record.savedAt), finalizedAt: record.state === 'FINALIZED' ? instant(record.finalizedAt) : null };
}

function matchingMetrics(actual, expected, label) {
  const left = metrics(actual), right = metrics(expected);
  if (COUNTS.some(key => left[key] !== right[key]) ||
      left.durationMaxMs !== right.durationMaxMs ||
      left.durationHistogram.buckets.some((bin, i) => bin.count !== right.durationHistogram.buckets[i].count) ||
      [...new Set([...Object.keys(left.statuses), ...Object.keys(right.statuses)])]
        .some(status => (left.statuses[status] ?? 0) !== (right.statuses[status] ?? 0)))
    fail(label + ' differs from the original retained day aggregates');
  // Summing the same floating-point durations by route or by day may change the
  // final rounding bit. Integer counters and histogram populations remain exact.
  const tolerance = 1e-9 * Math.max(1, left.durationHistogram.sumMs, right.durationHistogram.sumMs);
  if (Math.abs(left.durationHistogram.sumMs - right.durationHistogram.sumMs) > tolerance)
    fail(label + ' duration sum differs from the original retained days');
}
function reportRoutes(input) {
  if (!Array.isArray(input) || input.length > MAX_SESSIONS * 103)
    fail('Original retained route variants required');
  const seen = new Set();
  return input.map(row => {
    const definition = routeDefinition(row), key = routeKey(definition);
    if (row.routeKey !== key || seen.has(key) ||
        (definition.id.startsWith('@') ? definition.method !== '-' : definition.method === '-'))
      fail('Invalid or duplicate retained route key');
    seen.add(key);
    return { routeKey: key, ...definition, ...view(metrics(row)) };
  });
}

/** Validate a saved or live ORIGINAL history export without opening its writer. */
export function normalizeTrafficHistoryReport(input) {
  if (input?.schema !== REPORT_SCHEMA || input.enabled !== true)
    fail('Enabled original SF30 usage history export required', 'HISTORY_EXPORT_REQUIRED');
  if (input.coverageFormat != null && input.coverageFormat !== COVERAGE_FORMAT)
    fail('Unsupported original history coverage format', 'HISTORY_COVERAGE_FORMAT');
  const generatedAt = instant(input.generatedAt), selected = input.range;
  if (!selected || !Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 365)
    fail('Original history selection and retention required');
  const from = day(selected.from), to = day(selected.to);
  if (from > to || Date.parse(to) - Date.parse(from) > 365 * DAY)
    fail('History selection must be ordered and no longer than 366 days');
  const routeId = selected.routeId ?? null;
  if (routeId !== null && !(typeof routeId === 'string' &&
      (SESSION_ID.test(routeId) || ['@unmatched', '@method', '@invalid'].includes(routeId))))
    fail('Invalid original history route selection');
  const outsideRetention = selected.outsideRetention === true;
  const effectiveFrom = outsideRetention ? null : day(selected.effectiveFrom ?? from);
  const effectiveTo = outsideRetention ? null : day(selected.effectiveTo ?? to);
  if (!outsideRetention && (effectiveFrom < from || effectiveTo > to || effectiveFrom > effectiveTo))
    fail('Invalid effective retained history range');
  const range = { from, to, routeId, requestedFrom: day(selected.requestedFrom ?? from),
    truncatedByRetention: selected.truncatedByRetention === true,
    retainedFrom: day(selected.retainedFrom ?? from), effectiveFrom, effectiveTo, outsideRetention };
  if (!Array.isArray(input.days) || input.days.length > 366 ||
      !Array.isArray(input.sessions) || input.sessions.length > MAX_SESSIONS)
    fail('Original retained days and sessions required');
  const seenDays = new Set(), routesByKey = new Map(), combined = empty();
  const days = input.days.map(entry => {
    const date = day(entry?.day);
    if (seenDays.has(date) || outsideRetention || date < effectiveFrom || date > effectiveTo)
      fail('Duplicate or unselected retained history day');
    seenDays.add(date);
    const routes = reportRoutes(entry.routes), total = empty();
    if (!routes.length || count(entry.sessions) < 1) fail('Retained day has no original route or session');
    for (const row of routes) {
      if (routeId !== null && row.id !== routeId) fail('Retained route differs from the selected route');
      add(total, row);
      if (!routesByKey.has(row.routeKey)) routesByKey.set(row.routeKey,
        { routeKey: row.routeKey, ...routeDefinition(row), ...empty() });
      add(routesByKey.get(row.routeKey), row);
    }
    matchingMetrics(entry.totals, total, 'Retained day total');
    add(combined, total);
    return { day: date, totals: view(metrics(entry.totals)), routes, sessions: entry.sessions };
  }).sort((a, b) => a.day.localeCompare(b.day));
  matchingMetrics(input.totals, combined, 'History total');
  const routes = reportRoutes(input.routes);
  if (routes.length !== routesByKey.size) fail('History route variants differ from retained days');
  for (const row of routes) {
    const combinedRoute = routesByKey.get(row.routeKey);
    if (!combinedRoute) fail('History route has no retained day');
    matchingMetrics(row, combinedRoute, 'History route total');
  }
  const dayById = new Map(days.map(entry => [entry.day, entry]));
  const seenSessions = new Set(), modes = new Set();
  const sessions = input.sessions.map(record => {
    if (!SESSION_ID.test(record?.sessionId ?? '') || seenSessions.has(record.sessionId) ||
        !['ACTIVE', 'FINALIZED', 'INTERRUPTED'].includes(record.state) ||
        !['NATIVE_X402', 'CHALLENGE_ONLY', 'UNKNOWN'].includes(record.mode) ||
        count(record.matchingDays) < 1 || record.matchingDays > days.length)
      fail('Invalid original retained session');
    seenSessions.add(record.sessionId); modes.add(record.mode);
    const startedAt = instant(record.startedAt), capturedAt = instant(record.capturedAt);
    if (startedAt > capturedAt) fail('Original retained session interval is reversed');
    let retainedDays = null;
    if (record.retainedDays != null) {
      if (!Array.isArray(record.retainedDays) || record.retainedDays.length !== record.matchingDays)
        fail('Original session day coverage differs from its selection');
      const selectedDays = new Set();
      retainedDays = record.retainedDays.map(entry => {
        const date = day(entry?.day), originalDay = dayById.get(date);
        if (!originalDay || selectedDays.has(date) || date < startedAt.slice(0, 10) ||
            date > capturedAt.slice(0, 10) || !Array.isArray(entry.routeKeys) || !entry.routeKeys.length)
          fail('Invalid original session day coverage');
        selectedDays.add(date);
        const keys = new Set(entry.routeKeys);
        if (keys.size !== entry.routeKeys.length ||
            entry.routeKeys.some(key => !originalDay.routes.some(row => row.routeKey === key)))
          fail('Original session coverage refers to an unknown route variant');
        return { day: date, routeKeys: [...keys].sort() };
      }).sort((a, b) => a.day.localeCompare(b.day));
    } else if (input.coverageFormat === COVERAGE_FORMAT) {
      fail('Original session day coverage is missing');
    }
    return { sessionId: record.sessionId, mode: record.mode, startedAt, capturedAt,
      savedAt: instant(record.savedAt),
      finalizedAt: record.state === 'FINALIZED' ? instant(record.finalizedAt) : null,
      state: record.state, outstandingAtCheckpoint: count(record.outstandingAtCheckpoint),
      observerErrors: count(record.observerErrors), matchingDays: record.matchingDays, retainedDays };
  });
  if (!Array.isArray(input.modes) || new Set(input.modes).size !== input.modes.length ||
      input.modes.length !== modes.size || input.modes.some(mode => !modes.has(mode)))
    fail('History modes differ from the original retained sessions');
  if (days.length && !sessions.length) fail('Retained observations have no original sessions');
  if (sessions.every(session => session.retainedDays !== null)) {
    for (const entry of days) {
      const covered = sessions.flatMap(session => session.retainedDays.filter(row => row.day === entry.day));
      if (covered.length !== entry.sessions || entry.routes.some(row =>
        !covered.some(coverage => coverage.routeKeys.includes(row.routeKey))))
        fail('Retained day and original session coverage do not agree');
    }
  }
  return { schema: REPORT_SCHEMA, enabled: true, generatedAt, retentionDays: input.retentionDays,
    coverageFormat: input.coverageFormat ?? null, range, totals: view(metrics(input.totals)),
    routes, days, sessions, modes: [...modes].sort(),
    storage: structuredClone(input.storage ?? {}), semantics: structuredClone(input.semantics ?? {}) };
}
async function privateFile(path, maxBytes = MAX_FILE_BYTES) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes)
    fail('History storage requires regular size-limited files', 'HISTORY_STORAGE_FILE');
  if (process.platform !== 'win32' && ((info.mode & 0o077) ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())))
    fail('History files must be owned by this user with private permissions', 'HISTORY_STORAGE_PERMISSIONS');
  return { info, bytes: await readFile(path) };
}
async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const fd = await open(directory, 'r');
  try { await fd.sync(); } finally { await fd.close(); }
}
async function atomicWrite(directory, filename, record) {
  const temporary = join(directory, `.checkpoint-${randomUUID()}.tmp`);
  const bytes = Buffer.from(JSON.stringify(record) + '\n');
  if (bytes.length > MAX_FILE_BYTES) fail('History session exceeds storage capacity', 'HISTORY_CAPACITY');
  let fd;
  try {
    fd = await open(temporary, 'wx', 0o600);
    await fd.writeFile(bytes); await fd.sync(); await fd.close(); fd = null;
    await rename(temporary, join(directory, filename)); await syncDirectory(directory);
  } finally {
    await fd?.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
function livePid(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
function processStat(text) {
  // comm is parenthesized and can itself contain spaces or ')'. Field 22 is
  // starttime; keep its clock ticks as text rather than rounding a large integer.
  const pid = Number(/^([1-9]\d*) \(/.exec(text)?.[1]);
  const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
  if (!Number.isSafeInteger(pid) || pid < 1 || fields[0]?.length !== 1 ||
      !/^\d{1,20}$/.test(fields[19] ?? '')) throw new Error('Unrecognized Linux process identity');
  return { pid, state: fields[0], startTicks: fields[19] };
}
export async function linuxProcessIdentity() {
  if (process.platform !== 'linux') return null;
  try {
    const [selfText, bootText, proc] = await Promise.all([
      readFile('/proc/self/stat', 'utf8'), readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      lstat('/proc', { bigint: true }),
    ]);
    const self = processStat(selfText), bootId = bootText.trim();
    if (!/^[a-f0-9-]{36}$/.test(bootId) || !proc.isDirectory()) return null;
    const addressable = processStat(await readFile(`/proc/${self.pid}/stat`, 'utf8'));
    if (addressable.pid !== self.pid || addressable.startTicks !== self.startTicks) return null;
    // A container can expose a parent procfs while process.pid is namespace-local.
    // Read the PID from that procfs itself; never signal it as a runtime PID.
    return { schema: 'linux-proc.v1', procPid: self.pid, startTicks: self.startTicks,
      bootId, procDevice: String(proc.dev) };
  } catch { return null; }
}
export async function liveOwner(owner, current) {
  if (owner.host !== current.host) return true;
  if (!owner.processIdentity) return livePid(owner.pid); // Existing/non-Linux lock compatibility.
  const old = owner.processIdentity, local = current.processIdentity;
  if (!local || old.bootId !== local.bootId || old.procDevice !== local.procDevice) return true;
  try {
    const actual = processStat(await readFile(`/proc/${old.procPid}/stat`, 'utf8'));
    if (actual.pid !== old.procPid) return true;
    return actual.startTicks === old.startTicks && !['Z', 'X', 'x'].includes(actual.state);
  } catch (error) {
    // A denied or unfamiliar process read cannot establish that its writer died.
    return !['ENOENT', 'ESRCH'].includes(error.code);
  }
}
function lockOwner(bytes) {
  const owner = JSON.parse(bytes.toString('utf8'));
  if (owner?.schema !== 'stellar-forge.seller-usage-lock.v1' ||
      typeof owner.host !== 'string' || !/^[a-f0-9-]{36}$/.test(owner.token ?? '') ||
      !Number.isSafeInteger(owner.pid) || owner.pid < 1) fail('Unrecognized history lock', 'HISTORY_LOCK_INVALID');
  const identity = owner.processIdentity;
  if (identity != null && (identity.schema !== 'linux-proc.v1' ||
      !Number.isSafeInteger(identity.procPid) || identity.procPid < 1 ||
      typeof identity.startTicks !== 'string' || !/^\d{1,20}$/.test(identity.startTicks) ||
      typeof identity.bootId !== 'string' || !/^[a-f0-9-]{36}$/.test(identity.bootId) ||
      typeof identity.procDevice !== 'string' || !/^\d{1,20}$/.test(identity.procDevice)))
    fail('Unrecognized history process identity', 'HISTORY_LOCK_INVALID');
  return owner;
}
async function publishLock(directory, path, owner) {
  // A published lock is always complete. A crash during preparation leaves only an
  // unreferenced private temporary file, never an unreadable owner at the lock path.
  const temporary = join(directory, `.lock-${randomUUID()}.tmp`);
  let fd, published = false;
  try {
    fd = await open(temporary, 'wx', 0o600);
    await fd.writeFile(JSON.stringify(owner)); await fd.sync();
    const info = await fd.stat();
    await link(temporary, path); // Atomic exclusive publication; EEXIST leaves the existing owner intact.
    published = true;
    await unlink(temporary); await syncDirectory(directory);
    return { fd, info };
  } catch (error) {
    await fd?.close().catch(() => {});
    if (published) await unlink(path).catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
async function acquireLock(directory) {
  const path = join(directory, '.usage-writer.lock');
  const owner = { schema: 'stellar-forge.seller-usage-lock.v1', host: hostname(),
    pid: process.pid, token: randomUUID(), processIdentity: await linuxProcessIdentity() };
  let recovered = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    let fd;
    try {
      const published = await publishLock(directory, path, owner);
      fd = published.fd;
      const ownedInfo = published.info;
      return { recovered, async release() {
        await fd.close();
        const current = await privateFile(path, 4096);
        if (current.info.ino !== ownedInfo.ino || lockOwner(current.bytes).token !== owner.token)
          fail('History writer ownership changed', 'HISTORY_LOCK_LOST');
        await unlink(path); await syncDirectory(directory);
      } };
    } catch (error) {
      await fd?.close().catch(() => {});
      if (error.code !== 'EEXIST') throw error;
    }
    let previous;
    try { previous = await privateFile(path, 4096); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const old = lockOwner(previous.bytes);
    if (await liveOwner(old, owner))
      fail('Another live or nonlocal process owns this history directory', 'HISTORY_IN_USE');
    // An exclusive per-old-owner recovery marker serializes ordinary stale-lock recovery.
    const recoveryPath = join(directory, `.usage-reclaim-${old.token}.lock`);
    let recovery;
    try {
      recovery = (await publishLock(directory, recoveryPath, owner)).fd;
    } catch (error) {
      await recovery?.close().catch(() => {});
      if (error.code !== 'EEXIST') throw error;
      const pending = await privateFile(recoveryPath, 4096), recoveryOwner = lockOwner(pending.bytes);
      if (await liveOwner(recoveryOwner, owner))
        fail('History stale-writer recovery is already running', 'HISTORY_RECOVERY_IN_USE');
      const again = await privateFile(recoveryPath, 4096);
      if (again.info.ino === pending.info.ino && lockOwner(again.bytes).token === recoveryOwner.token)
        await unlink(recoveryPath);
      continue;
    }
    try {
      const current = await privateFile(path, 4096), currentOwner = lockOwner(current.bytes);
      if (current.info.ino === previous.info.ino && currentOwner.token === old.token &&
          !(await liveOwner(currentOwner, owner))) {
        await unlink(path); recovered = true;
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { await recovery.close(); await unlink(recoveryPath).catch(() => {}); }
  }
  fail('History directory ownership changed during startup; retry startup', 'HISTORY_LOCK_RACE');
}

/** Reuse this lifetime for an already validated private directory; no usage session is created. */
export { acquireLock as acquirePrivateDirectoryWriter };

/** One writer, many saved sessions. Call only with snapshots from observeSellerTraffic(). */
export async function createTrafficHistory({ directory, retentionDays = 90, now = Date.now } = {}) {
  if (typeof directory !== 'string' || !directory.trim() || directory.includes('\0') ||
      !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365 || typeof now !== 'function')
    fail('History needs a local directory and 1–365 retention days', 'HISTORY_OPTIONS');
  const timestamp = () => {
    const value = now();
    if (!Number.isFinite(value)) fail('History clock must return epoch milliseconds');
    return new Date(value).toISOString();
  };
  const cutoff = () => new Date(Date.parse(timestamp().slice(0, 10) + 'T00:00:00.000Z') -
    (retentionDays - 1) * DAY).toISOString().slice(0, 10);
  const requested = resolve(directory);
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const info = await lstat(requested);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' &&
      ((info.mode & 0o077) || (typeof process.getuid === 'function' && info.uid !== process.getuid()))))
    fail('History directory must be a private directory owned by this user', 'HISTORY_STORAGE_PERMISSIONS');
  directory = await realpath(requested);
  const lock = await acquireLock(directory), records = new Map(), damaged = [];
  let activeSessionId = null, lastCheckpointAt = null, lastError = null,
    checkpointFailures = 0, closed = false, closing = false, closePromise,
    tail = Promise.resolve();
  const filename = id => `session-${id}.json`;
  try {
    const names = (await readdir(directory)).filter(name => FILE.test(name));
    if (names.length > MAX_SESSIONS) fail('History directory has too many sessions', 'HISTORY_CAPACITY');
    let bytesLoaded = 0;
    for (const name of names) {
      try {
        const file = await privateFile(join(directory, name));
        bytesLoaded += file.info.size;
        if (bytesLoaded > MAX_LOADED_BYTES) fail('History exceeds loading capacity', 'HISTORY_CAPACITY');
        const record = normalizeSaved(JSON.parse(file.bytes.toString('utf8')), FILE.exec(name)[1]);
        records.set(record.sessionId, record);
      } catch (error) {
        if (error.code === 'HISTORY_CAPACITY') throw error;
        damaged.push({ sessionId: FILE.exec(name)[1], code: error.code ?? 'HISTORY_INVALID_DATA' });
      }
    }
  } catch (error) { await lock.release().catch(() => {}); throw error; }

  const status = () => ({ enabled: true, healthy: !lastError && damaged.length === 0,
    activeSessionId, lastCheckpointAt, checkpointFailures, lastError,
    loadedSessions: records.size, damagedSessions: structuredClone(damaged),
    recoveredStaleWriter: lock.recovered, retentionDays, closed });
  async function prune() {
    const first = cutoff();
    for (const [id, record] of records) {
      const retained = record.days.filter(entry => entry.day >= first);
      if (!retained.length && record.capturedAt.slice(0, 10) < first && id !== activeSessionId) {
        await unlink(join(directory, filename(id))); records.delete(id);
      } else if (retained.length !== record.days.length) {
        const replacement = { ...record, days: retained };
        await atomicWrite(directory, filename(id), replacement); records.set(id, replacement);
      }
    }
  }
  try { await prune(); }
  catch (error) { lastError = `History retention could not finish (${error.code ?? 'IO_ERROR'})`; }

  async function save(snapshot, final) {
    const input = normalizeSnapshot(snapshot), previous = records.get(input.sessionId);
    if (activeSessionId && activeSessionId !== input.sessionId)
      fail('One original observer session per history writer', 'HISTORY_SESSION_CHANGED');
    if (!activeSessionId && previous)
      fail('A saved session ID cannot be reused by a new observer', 'HISTORY_SESSION_REUSED');
    if (previous) {
      if (previous.startedAt !== input.startedAt || previous.mode !== input.mode ||
          JSON.stringify(previous.routes) !== JSON.stringify(input.routes))
        fail('Original session metadata changed', 'HISTORY_SESSION_CHANGED');
      if (previous.state === 'FINALIZED' && !final)
        fail('A finalized session cannot become active again', 'HISTORY_SESSION_FINALIZED');
      cumulative(input.totals, previous.totals);
    }
    const days = new Map((previous?.days ?? []).map(entry => [entry.day, entry]));
    for (const entry of input.days) {
      const old = days.get(entry.day);
      if (old) {
        cumulative(entry.totals, old.totals);
        const nextRoutes = new Map(entry.routes.map(row => [row.id, row]));
        for (const row of old.routes) cumulative(nextRoutes.get(row.id) ?? empty(), row);
      }
      days.set(entry.day, entry); // REPLACE a cumulative native day; never sum repeated checkpoints.
    }
    const savedAt = timestamp(), record = { schema: SESSION_SCHEMA, ...input,
      days: [...days.values()].filter(entry => entry.day >= cutoff()).sort((a, b) => a.day.localeCompare(b.day)),
      state: final ? 'FINALIZED' : 'ACTIVE', savedAt,
      finalizedAt: final ? savedAt : null };
    if (!previous && records.size >= MAX_SESSIONS) fail('History session capacity reached', 'HISTORY_CAPACITY');
    await atomicWrite(directory, filename(input.sessionId), record);
    records.set(input.sessionId, record); activeSessionId = input.sessionId;
    lastCheckpointAt = savedAt; lastError = null;
    await prune();
    return status();
  }
  function enqueue(snapshot, final) {
    const task = tail.then(() => save(snapshot, final)).catch(error => {
      checkpointFailures++;
      lastError = `Usage checkpoint unavailable (${error.code ?? 'IO_ERROR'})`;
      throw error;
    });
    tail = task.catch(() => {}); return task;
  }
  function query({ from = cutoff(), to = timestamp().slice(0, 10), routeId } = {}) {
    const requestedFrom = day(from); to = day(to);
    if (from > to || Date.parse(to) - Date.parse(from) > 365 * DAY)
      fail('History range must be ordered and no longer than 366 days', 'HISTORY_QUERY');
    if (routeId !== undefined && !(typeof routeId === 'string' &&
        (/^[A-Za-z0-9_-]{1,80}$/.test(routeId) || ['@unmatched', '@method', '@invalid'].includes(routeId))))
      fail('Invalid history route filter', 'HISTORY_QUERY');
    const retainedFrom = cutoff(), outsideRetention = to < retainedFrom;
    const effectiveFrom = outsideRetention ? null : from < retainedFrom ? retainedFrom : from;
    // An entirely expired request remains an ordered, reusable selection. Its
    // effective retained interval is empty, not an inverted From/Through pair.
    from = outsideRetention ? requestedFrom : effectiveFrom;
    const days = new Map(), routes = new Map(), sessions = [], modes = new Set(), totals = empty();
    function addRoute(collection, row) {
      const key = routeKey(row);
      if (!collection.has(key)) collection.set(key, { routeKey: key, ...routeDefinition(row), ...empty() });
      add(collection.get(key), row);
    }
    for (const record of records.values()) {
      let matchingDays = 0;
      const retainedDays = [];
      for (const entry of record.days) {
        if (outsideRetention || entry.day < effectiveFrom || entry.day > to) continue;
        const selected = entry.routes.filter(row => routeId === undefined || row.id === routeId);
        if (!selected.length) continue;
        matchingDays++; modes.add(record.mode);
        retainedDays.push({ day: entry.day, routeKeys: selected.map(routeKey).sort() });
        if (!days.has(entry.day)) days.set(entry.day, { day: entry.day, totals: empty(), routes: new Map(), sessionIds: new Set() });
        const aggregate = days.get(entry.day); aggregate.sessionIds.add(record.sessionId);
        for (const row of selected) {
          add(totals, row); add(aggregate.totals, row); addRoute(routes, row); addRoute(aggregate.routes, row);
        }
      }
      if (matchingDays) sessions.push({ sessionId: record.sessionId, mode: record.mode,
        startedAt: record.startedAt, capturedAt: record.capturedAt, savedAt: record.savedAt,
        finalizedAt: record.finalizedAt,
        state: record.state === 'FINALIZED' ? 'FINALIZED' :
          record.sessionId === activeSessionId && !closed ? 'ACTIVE' : 'INTERRUPTED',
        outstandingAtCheckpoint: record.outstandingAtCheckpoint, observerErrors: record.observerErrors,
        matchingDays, retainedDays });
    }
    const routeViews = collection => [...collection.values()].sort((a, b) =>
      a.id.localeCompare(b.id) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method)).map(view);
    return { schema: REPORT_SCHEMA, enabled: true, generatedAt: timestamp(), retentionDays,
      coverageFormat: COVERAGE_FORMAT,
      range: { from, to, routeId: routeId ?? null, requestedFrom,
        truncatedByRetention: requestedFrom < retainedFrom, retainedFrom,
        effectiveFrom, effectiveTo: outsideRetention ? null : to, outsideRetention },
      totals: view(totals), routes: routeViews(routes),
      days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map(entry => ({
        day: entry.day, totals: view(entry.totals), routes: routeViews(entry.routes), sessions: entry.sessionIds.size })),
      sessions: sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt)), modes: [...modes].sort(),
      storage: status(), semantics: {
        counts: 'HTTP attempts and finished/disconnected responses, not buyers, verified payments or revenue',
        days: 'UTC request starts and response completions use their own original event dates; absent days have no saved observations',
        persistence: 'One replacing checkpoint per original session; totals include only successfully saved retained UTC days',
        interruptions: 'An interrupted session can lose observations after its last saved checkpoint; outstanding requests are not converted to completed responses',
        routes: 'Only configured route IDs, methods and templates; changed method/path variants remain separate',
        latency: 'Combined original finish-or-disconnect histograms; P95 is a bin upper bound, not an exact percentile',
      } };
  }
  return { status, query,
    checkpoint(snapshot, { final = false } = {}) {
      if (closing || closed) return Promise.reject(Object.assign(new Error('History writer is closing'), { code: 'HISTORY_CLOSED' }));
      return enqueue(snapshot, final);
    },
    close(snapshot) {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        try { if (snapshot) await enqueue(snapshot, true); else await tail; }
        finally { closed = true; await lock.release(); }
      })();
      return closePromise;
    },
  };
}

/** One row per UTC day and configured route variant; spreadsheet formula cells are escaped. */
export function historyCsv(report) {
  if (report?.schema !== REPORT_SCHEMA || !Array.isArray(report.days)) fail('History report required');
  const columns = ['day', 'routeKey', 'id', 'method', 'path', ...COUNTS,
    'durationMeanMs', 'durationMaxMs', 'latencyP95UpperBoundMs', 'httpSuccessPercent'];
  const cell = value => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [columns, ...report.days.flatMap(entry => entry.routes.map(row =>
    columns.map(key => key === 'day' ? entry.day : row[key])))].map(row => row.map(cell).join(','))
    .join('\r\n') + '\r\n';
}
