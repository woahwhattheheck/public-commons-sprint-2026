import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const receivingSource = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] || join(process.cwd(), 'vip-receiving'));
const source = resolve(process.argv[3] || join(receivingSource, '..', '..'));
const childFile = resolve(process.argv[4] || join(receivingSource, 'server-child.mjs'));
const { exampleRecords, exampleSchemas, exampleConfig } = await import(pathToFileURL(join(source, 'workspace/example.mjs')));
const { calendarBoundary } = await import(pathToFileURL(join(source, 'workspace/automation.mjs')));
const { digest: canonicalDigest } = await import(pathToFileURL(join(source, 'workspace/common.mjs')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (condition, message) => { if (!condition) throw Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
await mkdir(root, { recursive: true, mode: 0o700 });
const progressFile = join(root, 'progress.json');
let p; try { p = JSON.parse(await readFile(progressFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
p ??= { schema: 'vip-continuous-operating-case/v1', createdAt: now(), stages: {}, requests: {}, events: [],
  clockOffsetMs: 0, providerPort: null, projectId: null, receiverId: null, source, nativeCase: 'VIP-CONTINUOUS-MANAGER-RECEIVING-07476-20261012' };
check(p.source === source, 'Reopen the original selected source');
async function save() { const temp = progressFile + '.new'; await writeFile(temp, JSON.stringify(p, null, 2) + '\n', { mode: 0o600 }); await rename(temp, progressFile); }
async function stage(name, value) { p.stages[name] = { ...value, completedAt: now() }; await save(); process.stdout.write(JSON.stringify({ stage: name, ...value }) + '\n'); }
async function artifact(name, bytes) { await writeFile(join(root, name), bytes, { mode: 0o600 }); return { path: name, bytes: bytes.length, sha256: sha(bytes) }; }
if (!p.sourceFreeze) {
  const names = ['triage.mjs','workspace/source.mjs','workspace/store.mjs','workspace/actions.mjs','workspace/model.mjs','workspace/automation.mjs',
    'workspace/server.mjs','workspace/cli.mjs','workspace/public/app.mjs','workspace/public/automation.mjs','workspace/README.md'];
  p.sourceFreeze = {};
  for (const name of names) { const b = await readFile(join(source, name)); p.sourceFreeze[name] = { bytes: b.length, sha256: sha(b) }; }
  await save();
} else for (const [name, pin] of Object.entries(p.sourceFreeze)) check(sha(await readFile(join(source, name))) === pin.sha256, 'The original operating source changed: ' + name);

let holdSecond = !p.stages.sourceInterrupted, providerMode = 'normal', fixtureVersion = 1, active = null;
const heldResponses = new Set();
const provider = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1'), event = { method: req.method, path: url.pathname + url.search, at: now() };
  p.events.push(event);
  const send = (status, value) => {
    const bytes = Buffer.from(JSON.stringify(value)); event.status = status; event.sha256 = sha(bytes); event.bytes = bytes.length;
    if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(bytes); }
  };
  if (req.method !== 'GET') return send(405, { message: 'This development source is read only' });
  if (providerMode === 'denied') return send(403, { status: 'error', category: 'MISSING_SCOPES', message: 'Selected development capture lacks its required read scope' });
  const schemas = exampleSchemas();
  if (url.pathname === '/crm/v3/properties/deals') return send(200, schemas.properties);
  if (url.pathname === '/crm/v3/pipelines/deals') return send(200, schemas.pipelines);
  if (url.pathname !== '/crm/v3/objects/deals') return send(404, { message: 'Unknown original native route' });
  if (url.searchParams.get('archived') !== 'false' || url.searchParams.get('limit') !== '100') return send(400, { message: 'Original source query differs' });
  const records = exampleRecords(fixtureVersion), after = url.searchParams.get('after');
  if (after === null) return send(200, { results: records.slice(0, 32), paging: { next: { after: 'retained-page-2' } } });
  if (after !== 'retained-page-2') return send(400, { message: 'Opaque original cursor changed' });
  if (holdSecond) { heldResponses.add(res); await new Promise(resolve => res.once('close', resolve)); heldResponses.delete(res); return; }
  return send(200, { results: records.slice(32) });
});
await new Promise((resolve, reject) => { provider.once('error', reject); provider.listen(p.providerPort ?? 0, '127.0.0.1', resolve); });
p.providerPort = provider.address().port;
const providerOrigin = 'http://127.0.0.1:' + p.providerPort;
await save();

async function start() {
  check(!active, 'Close the preceding original service process before reopening');
  const child = spawn(process.execPath, [childFile, JSON.stringify({ source, directory: join(root, 'state'), providerOrigin, clockOffsetMs: p.clockOffsetMs })],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: process.env });
  const state = { child, url: null, stdout: '', stderr: '', messages: new Map() }; active = state;
  child.stdout.on('data', bytes => {
    state.stdout += bytes.toString(); const lines = state.stdout.split('\n'); state.stdout = lines.pop();
    for (const line of lines) if (line) { const value = JSON.parse(line); if (value.type === 'ready') state.url = value.url; else process.stdout.write(line + '\n'); }
  });
  child.stderr.on('data', bytes => { state.stderr += bytes.toString(); });
  child.on('message', message => { const waiter = state.messages.get(message.reply); if (waiter) { state.messages.delete(message.reply); message.error ? waiter.reject(Error(message.error)) : waiter.resolve(message); } });
  child.once('exit', () => { for (const waiter of state.messages.values()) waiter.reject(Error('The original service process ended before its control reply')); state.messages.clear(); });
  await until(async () => { if (child.exitCode !== null || child.signalCode) throw Error('Original service failed to start: ' + state.stderr); return state.url; }, 'original service opening', 30000);
  p.serviceOpenings = (p.serviceOpenings ?? 0) + 1; await save(); return state;
}
async function stop(hard = false) {
  if (!active) return;
  const current = active; active = null;
  if (current.child.exitCode === null && !current.child.signalCode) { current.child.kill(hard ? 'SIGKILL' : 'SIGTERM'); await once(current.child, 'exit'); }
  p.events.push({ kind: hard ? 'actual_service_process_killed' : 'original_service_closed', at: now(), pid: current.child.pid,
    exitCode: current.child.exitCode, signal: current.child.signalCode });
  await save();
}
async function control(kind, value) {
  const id = randomUUID(), state = active;
  check(state?.child.connected, 'The original service control channel is closed');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { state.messages.delete(id); reject(Error('The original service control reply timed out')); }, 30000);
    const finish = fn => value => { clearTimeout(timer); fn(value); };
    state.messages.set(id, { resolve: finish(resolve), reject: finish(reject) });
    state.child.send({ id, kind, value }, error => { if (error) { const waiter = state.messages.get(id); state.messages.delete(id); waiter?.reject(error); } });
  });
}
async function clock(value) { p.clockOffsetMs = value - Date.now(); await save(); await control('clock', value); await control('tick'); }
async function until(fn, label, timeout = 30000) {
  const started = Date.now(); let previous;
  while (Date.now() - started < timeout) { previous = await fn(); if (previous) return previous; await sleep(100); }
  throw Error('Original operation did not reach ' + label + ': ' + JSON.stringify(previous));
}
async function get(path, raw = false) {
  const response = await fetch(active.url + path);
  const bytes = Buffer.from(await response.arrayBuffer());
  check(response.ok, path + ' returned ' + response.status + ': ' + bytes.toString());
  return raw ? bytes : JSON.parse(bytes);
}
async function post(path, body, expected = 200) {
  const response = await fetch(active.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Request': '1' }, body: JSON.stringify(body) });
  const value = await response.json();
  check(response.status === expected || expected === 200 && response.status === 201, path + ' returned ' + response.status + ': ' + JSON.stringify(value));
  return value;
}
async function request(name, values) {
  if (!p.requests[name]) { p.requests[name] = { actor: 'Native operating manager', requestId: randomUUID(), ...values }; await save(); }
  return p.requests[name];
}
const projectPath = () => '/api/projects/' + p.projectId;
async function view(id = p.projectId) { return get('/api/projects/' + id); }
async function monitor(id = p.projectId) { return get('/api/projects/' + id + '/monitor'); }

try {
  await start();
  if (!p.projectId) {
    const result = await post('/api/projects', await request('project', { name: 'Continuous leasing manager development operation' }));
    p.projectId = result.project.id; await save();
  }
  if (!p.stages.configured) {
    let current = await view();
    await post(projectPath() + '/config', await request('config', { revision: current.project.revision, config: exampleConfig() }));
    current = await view();
    const target = new Date(Date.now() + 120000), bits = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(target).map(x => [x.type, x.value]));
    const weekday = new Date(bits.year + '-' + bits.month + '-' + bits.day + 'T12:00:00Z').getUTCDay();
    const settings = { captureEveryMinutes: 60, timeZone: 'Europe/London', daily: { enabled: true, time: bits.hour + ':' + bits.minute },
      weekly: { enabled: true, weekday, time: bits.hour + ':' + bits.minute } };
    const configured = await post(projectPath() + '/monitor/configure', await request('schedule', { revision: current.project.revision, version: 0, enabled: true, settings, note: 'Continuous original-source observation and frozen manager reports' }));
    p.settings = configured.schedule.settings; p.scheduleId = configured.schedule.id; await stage('configured', { scheduleId: p.scheduleId, settings: p.settings });
  }
  if (!p.stages.sourceInterrupted) {
    const current = await monitor();
    const a = await request('manual-wake-a', { version: current.schedule.version }), b = await request('manual-wake-b', { version: current.schedule.version });
    const results = await Promise.all([post(projectPath() + '/monitor/trigger', a), post(projectPath() + '/monitor/trigger', b), control('tick')]);
    check(results[0].cycle.id === results[1].cycle.id, 'Concurrent original wakes selected different cycles');
    p.cycleId = results[0].cycle.id; await save();
    const observed = await until(async () => { const value = await get('/api/monitor-cycles/' + p.cycleId); return value.job?.pages === 1 && value.job.nextAfter === 'retained-page-2' ? value : null; }, 'committed original first page');
    p.sourceJobId = observed.job.id; p.originalPageFiles = observed.job.pageFiles; await save();
    await stop(true); for (const response of heldResponses) response.destroy(); holdSecond = false;
    await stage('sourceInterrupted', { cycleId: p.cycleId, jobId: p.sourceJobId, committedPages: 1, cursor: 'retained-page-2', originalPageFiles: p.originalPageFiles });
    await start();
  }
  holdSecond = false;
  if (!p.stages.originalCycle) {
    const result = await until(async () => { const value = await get('/api/monitor-cycles/' + p.cycleId); return value.cycle.status === 'completed' ? value : null; }, 'same original capture and analysis completion', 60000);
    check(result.job.id === p.sourceJobId && result.job.pages === 2 && result.job.pageFiles[0] === p.originalPageFiles[0], 'Source recovery replaced the original job or first page');
    check(result.run.summary.inputCount === 64 && result.run.summary.alerts === 24, 'Original development triage counts changed');
    p.runId = result.run.id; p.snapshotId = result.cycle.snapshotId;
    const original = await get('/api/runs/' + p.runId + '/report', true);
    p.report = await artifact('original-report.json', original);
    await stage('originalCycle', { cycleId: p.cycleId, jobId: p.sourceJobId, snapshotId: p.snapshotId, runId: p.runId, inputCount: 64, alerts: 24, report: p.report });
  }
  if (!p.stages.namedReview) {
    const alerts = await get('/api/runs/' + p.runId + '/alerts?limit=100'), selected = alerts.alerts[0];
    const result = await post('/api/runs/' + p.runId + '/alerts/' + selected.dealId + '/review', await request('review', { version: selected.review.version, status: 'confirmed',
      note: 'Review the exact declared next-action source with the assigned manager', assignee: 'Native pipeline reviewer', dueAt: null }));
    await stage('namedReview', { dealId: selected.dealId, result });
  }
  if (!p.stages.lateSourceCutoff) {
    const cutoff = p.lateCutoff ?? now(); p.lateCutoff = cutoff; await save();
    let current = await view();
    const imported = await post(projectPath() + '/import', await request('late-import', { revision: current.project.revision, name: 'Later received original development export',
      filename: 'later-native-deals.json', declaredComplete: true, contentBase64: Buffer.from(JSON.stringify({ results: exampleRecords(2) })).toString('base64') }));
    p.lateSnapshotId = imported.snapshot.id; await save(); current = await view();
    const analysis = await post(projectPath() + '/runs', await request('late-run', { revision: current.project.revision, snapshotId: p.lateSnapshotId,
      name: 'Later source with explicitly earlier analysis time', asOf: new Date(Date.parse(cutoff) - 60000).toISOString() }));
    p.lateRunId = analysis.run.id; await save();
    await until(async () => (await get('/api/runs/' + p.lateRunId)).run.status === 'completed', 'later original analysis');
    const input = await request('cutoff-digest', { kind: 'daily', name: 'Original availability cutoff', cutoff });
    const first = await post(projectPath() + '/monitor/digests', input), repeated = await post(projectPath() + '/monitor/digests', input);
    check(first.digest.id === repeated.digest.id && first.digest.sha256 === repeated.digest.sha256, 'Exact digest request replay created another report');
    const report = await get('/api/manager-digests/' + first.digest.id);
    check(report.report.selected.runId === p.runId && report.report.coverage.unavailableAtCutoff.some(x => x.runId === p.lateRunId), 'A later captured backdated source entered the earlier cutoff');
    p.digestId = first.digest.id; p.digestSha256 = first.digest.sha256;
    await artifact('availability-cutoff-digest.json', await get('/api/manager-digests/' + p.digestId + '/download?format=json', true));
    await stage('lateSourceCutoff', { cutoff, selectedRunId: p.runId, excludedRunId: p.lateRunId, digestId: p.digestId, digestSha256: p.digestSha256, sameRequestReplay: true });
  }
  if (!p.stages.digestReview) {
    const result = await post('/api/manager-digests/' + p.digestId + '/review', await request('digest-review', { version: 0, sha256: p.digestSha256, status: 'follow_up',
      note: 'Keep the exact cutoff report and review the late source in its own receiving period' }));
    await stage('digestReview', { digestId: p.digestId, version: result.review.version, status: result.review.status });
  }
  if (!p.stages.failureDigests) {
    providerMode = 'denied';
    let current = await monitor();
    const triggered = await post(projectPath() + '/monitor/trigger', await request('denied-cycle', { version: current.schedule.version }));
    p.failedCycleId = triggered.cycle.id; await save();
    const failed = await until(async () => { const state = await monitor(); return state.schedule.status === 'needs_review' ? state : null; }, 'retained original source denial');
    if (!p.failureDigestBoundaries) {
      p.failureDigestBoundaries = { daily: failed.schedule.nextDigest.daily.at, weekly: failed.schedule.nextDigest.weekly.at };
      p.failureDigestCutoff = Math.max(...Object.values(p.failureDigestBoundaries).map(Date.parse)); await save();
    }
    await clock(p.failureDigestCutoff + 1000);
    const select = (value, kind) => value.digests.find(x => x.mode === 'scheduled' && x.kind === kind && x.cutoff === p.failureDigestBoundaries[kind]);
    const after = await until(async () => { const value = await monitor(); return select(value, 'daily') && select(value, 'weekly') ? value : null; }, 'daily and weekly status digests during capture review');
    check(after.schedule.status === 'needs_review', 'Status reporting silently restarted a stopped source');
    const daily = select(after, 'daily'), weekly = select(after, 'weekly');
    const dailyBody = (await get('/api/manager-digests/' + daily.id)).report;
    check(dailyBody.pending.some(x => x.status === 'failed' && x.kind === 'capture'), 'Status digest hid the actual failed original source');
    await stage('failureDigests', { failedCycleId: p.failedCycleId, dailyId: daily.id, weeklyId: weekly.id, dailyCutoff: daily.cutoff, weeklyCutoff: weekly.cutoff,
      namedReviewTime: dailyBody.decisions.observedAt, selectedSourceAvailableAt: dailyBody.selected.sourceAvailableAt, selectedAnalysisAvailableAt: dailyBody.selected.analysisAvailableAt });
  }
  if (!p.stages.paused) {
    const current = await monitor();
    await post(projectPath() + '/monitor/pause', await request('pause', { version: current.schedule.version, note: 'Pause both capture and report cadence for handover' }));
    const before = await monitor(); await clock(Date.now() + p.clockOffsetMs + 86400000); await control('tick');
    const after = await monitor();
    check(after.cycles.length === before.cycles.length && after.digests.length === before.digests.length, 'Explicit pause did not stop both cadences');
    await stage('paused', { status: after.schedule.status, cycles: after.cycles.length, digests: after.digests.length });
  }
  if (!p.stages.calendar) {
    const settings = { ...p.settings, daily: { enabled: true, time: '01:30' } };
    const fold = calendarBoundary(settings, 'daily', '2026-10-24T23:00:00Z'), foldNext = calendarBoundary(settings, 'daily', fold.at);
    const gap = calendarBoundary(settings, 'daily', '2027-03-27T23:00:00Z');
    check(fold.at === '2026-10-25T00:30:00.000Z' && fold.repeatedTime && foldNext.localDate === '2026-10-26', 'Autumn repeated local report boundary duplicated');
    check(gap.at === '2027-03-28T01:30:00.000Z' && gap.adjustmentMinutes === 60, 'Spring missing local report boundary did not use the actual gap');
    await stage('calendar', { timeZone: settings.timeZone, fold, nextAfterFold: foldNext, gap });
  }
  if (!p.stages.exported) {
    const current = await view(), result = await post(projectPath() + '/exports', await request('handover', { revision: current.project.revision, name: 'Complete continuous manager receiving', runId: p.runId }));
    p.exportId = result.export.id; p.exportArtifact = await artifact('complete-manager-project.json.gz', await get('/api/exports/' + p.exportId + '/download', true));
    const archive = JSON.parse(gunzipSync(await readFile(join(root, p.exportArtifact.path)))), { contentSha256, ...body } = archive;
    check(canonicalDigest(body) === contentSha256, 'Complete retained project digest changed');
    for (const file of body.files) check(sha(Buffer.from(file.contentBase64, 'base64')) === file.sha256, 'Original export file changed: ' + file.name);
    await stage('exported', { export: p.exportArtifact, sourceFiles: body.files.length, objects: body.objects.length, originalSnapshots: body.objects.filter(x => x.kind === 'snapshot').length });
  }
  if (!p.receiverId) {
    const restored = await post('/api/restore', await request('receive', { name: 'Received continuous manager operation', filename: p.exportArtifact.path,
      contentBase64: (await readFile(join(root, p.exportArtifact.path))).toString('base64') }));
    p.receiverId = restored.project.id; await save();
  }
  if (!p.stages.received) {
    const received = await monitor(p.receiverId), original = await monitor();
    check(received.schedule.status === 'paused' && !received.schedule.activeCycleId, 'Received schedule started without receiving binding');
    check(received.cycles.some(x => x.status === 'received_interrupted') && (await view(p.receiverId)).jobs.some(x => x.status === 'historical'), 'Received unfinished original capture lost its history');
    const selected = received.digests.find(x => x.sourceDigestId === p.digestId);
    check(selected?.sha256 === p.digestSha256, 'Receiving changed the original frozen digest');
    const body = await get('/api/manager-digests/' + selected.id);
    check(body.report.selected.runId === p.runId && body.bindings.some(x => x.originalRunId === p.runId && x.runId !== p.runId), 'Received drilldown lost original/current source identities');
    check(body.review?.digestSha256 === p.digestSha256 && body.review.status === 'follow_up', 'Received named digest review lost its exact byte binding');
    p.receivedDigestId = selected.id;
    await stage('received', { projectId: p.receiverId, status: received.schedule.status, historicalCycles: received.cycles.filter(x => x.status === 'received_interrupted').length,
      originalDigestId: p.digestId, receivedDigestId: selected.id, digestSha256: selected.sha256, bindings: body.bindings });
  }
  if (!p.stages.rebound) {
    fixtureVersion = 2; providerMode = 'normal';
    let received = await view(p.receiverId);
    if (!p.receivingBindingChecked) {
      const noBinding = await post('/api/projects/' + p.receiverId + '/monitor/resume', await request('receive-missing-binding', { revision: received.project.revision,
        version: received.automation.schedule.version, note: 'Inspect binding requirement' }), 400);
      check(noBinding.error === 'AUTOMATION_REBIND', 'Received schedule did not require explicit source binding');
      p.receivingBindingChecked = true; await save();
    }
    await post('/api/projects/' + p.receiverId + '/monitor/resume', await request('receive-bind', { revision: received.project.revision,
      version: received.automation.schedule.version, bindCurrentProviderAndDefinitions: true, note: 'Bind this receiving host to its selected native development provider and definitions' }));
    const result = await until(async () => { const value = await monitor(p.receiverId); const cycle = value.cycles.find(x => x.status === 'completed' && !x.originalId); return cycle ? { value, cycle } : null; }, 'receiving original-source capture', 60000);
    check(result.cycle.runId !== p.runId && result.cycle.snapshotId !== p.snapshotId, 'Received capture reused an old source identity');
    const latest = await get('/api/monitor-cycles/' + result.cycle.id);
    check(latest.run.summary.inputCount === 64, 'Received original data source is incomplete');
    p.receivedCycleId = result.cycle.id; p.receivedRunId = result.cycle.runId;
    await post('/api/projects/' + p.receiverId + '/monitor/pause', await request('receive-pause', { version: result.value.schedule.version, note: 'Retain the completed receiving operation for handover inspection' }));
    await stage('rebound', { cycleId: p.receivedCycleId, runId: p.receivedRunId, snapshotId: result.cycle.snapshotId, inputCount: latest.run.summary.inputCount, alerts: latest.run.summary.alerts });
  }
  if (!p.stages.cliReopened) {
    await stop();
    async function cli(args) {
      const child = spawn(process.execPath, [join(source, 'workspace/cli.mjs'), ...args, '--state', join(root, 'state')], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', error = ''; child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { error += b; });
      const [code] = await once(child, 'exit'); check(code === 0, 'Original CLI failed: ' + error); return JSON.parse(out);
    }
    const original = await cli(['monitor-status', '--project', p.projectId]), received = await cli(['monitor-status', '--project', p.receiverId]);
    const paths = ['cli-original-digest.json', 'cli-received-digest.json'];
    for (const [index, identity] of [p.digestId, p.receivedDigestId].entries()) {
      const file = join(root, paths[index]); try { await stat(file); } catch (error) { if (error.code !== 'ENOENT') throw error;
        await cli(['digest-download', '--digest', identity, '--format', 'json', '--out', file]); }
      check(sha(await readFile(file)) === p.digestSha256, 'Fresh CLI did not reopen the original frozen digest bytes');
    }
    const exact = await cli(['digest-status', '--digest', p.receivedDigestId]);
    check(exact.review.status === 'follow_up' && original.schedule.status === 'paused' && received.schedule.status === 'paused', 'Fresh CLI lost retained receiving state');
    await stage('cliReopened', { originalProjectId: p.projectId, receivedProjectId: p.receiverId, digestSha256: p.digestSha256, separateOriginalCliProcesses: 5 });
  }
  const result = { ...p, completedAt: now(), result: 'PASS', interpretation: 'One original retained operating case, using the product’s generated 64-record development source through actual native-shaped HTTP routes. Calendar advancement is explicit engineering-clock control. Source and analysis availability retain their actual observed timestamps.',
    providerWrites: p.events.filter(x => x.method && x.method !== 'GET').length,
    nativeSourceRequests: p.events.filter(x => x.method === 'GET').length };
  check(result.providerWrites === 0, 'Monitoring performed a native provider write');
  await artifact('operation.json', Buffer.from(JSON.stringify(result, null, 2) + '\n'));
  process.stdout.write(JSON.stringify({ result: 'PASS', projectId: p.projectId, receiverId: p.receiverId, stages: Object.keys(p.stages), output: join(root, 'operation.json') }) + '\n');
} catch (error) {
  p.lastError = { message: error.message, stack: error.stack, at: now() }; await save(); process.stderr.write(error.stack + '\n'); process.exitCode = 1;
} finally {
  await stop(); for (const response of heldResponses) response.destroy();
  await new Promise(resolve => { provider.close(resolve); provider.closeAllConnections(); }); await save();
}
