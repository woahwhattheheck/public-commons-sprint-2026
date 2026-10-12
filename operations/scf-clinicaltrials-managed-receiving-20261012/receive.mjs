// MIT. Receive the original retained ClinicalTrials cohort through managed Applications.
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { request as httpRequest, createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = 'stellar/scf-starforge-20261009/';
const SCHEMA = 'stellar-forge.clinicaltrials-applications-receiving.v1';
const run = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value, message) => { if (!value) throw new Error(message); };
const moduleAt = (root, file) => import(pathToFileURL(join(root, ROOT + file)).href);

/** Reuses one original dataset operation, installed runtime and saved application. */
export async function receiveClinicalTrialsApplications(config, { onProgress = () => {}, onOpen } = {}) {
  for (const key of ['runtimeDirectory', 'sourcePacket', 'workspaceDirectory', 'pythonExecutable', 'receivingDirectory'])
    need(typeof config[key] === 'string' && isAbsolute(config[key]), 'Select an absolute ' + key);
  need(/^[a-f0-9]{64}$/.test(config.packetSha256 ?? ''), 'Select the original complete packet SHA256');
  const packetBytes = await readFile(config.sourcePacket);
  need(hash(packetBytes) === config.packetSha256, 'The retained complete ClinicalTrials packet changed');
  const expected = config.expected ?? {
    captureId: 'capture-fb551338-f35d-46b3-b257-1138ba449c28',
    sourceId: '30df480b1dc4f295eec7c536a9158cd1ad45ddde1eb684cbcd33862754199130',
    planId: '95c873ac240646d41df5ebe26e8081bfd6fbda5ff553851bc41994913f5bf0af',
    buildId: '94f5417fe4cd79239d12af4b309d8ae1940adfca869ce840e0ac36708528371c',
    snapshot: 'ade2c08954dc92830e14d152290d2543a8c6bd7335dbb949bf57a4e605a4b0a4',
    rows: 165, pages: 4,
    reviews: [
      { nctId: 'NCT03529110', id: '7f82857ab38977b3fea662d329fbb66175c891726507a1309661ca4f3cf7ce3c' },
      { nctId: 'NCT00141453', id: '01577be1c3e1105ff0beb101b707539a1832cf9670dc7268b9f8a694901c3522' }
    ]
  };
  const workspaceDirectory = await realpath(config.workspaceDirectory);
  const bootstrap = config.bootstrapSourceRoot ?? join(config.runtimeDirectory, 'package', 'source');
  const { inspectMerchantRuntime } = await moduleAt(bootstrap, 'sf46-release/runtime-package.mjs');
  const runtime = await inspectMerchantRuntime(config.runtimeDirectory, { load: false });
  if (config.expectedSourceCommit)
    need(runtime.sourceCommit === config.expectedSourceCommit, 'The selected installed source changed');
  const { createRuntimeWorkspace, openRuntimeWorkspace } =
    await moduleAt(runtime.sourceRoot, 'distribution/runtime-workspace/model.mjs');
  const { makePrivate, privateDirectory, readJSON, saveJSON, operationLease, canonical } =
    await moduleAt(runtime.sourceRoot, 'distribution/runtime-workspace/storage.mjs');
  const { applicationEnvironment } =
    await moduleAt(runtime.sourceRoot, 'distribution/runtime-workspace/application-command.mjs');
  const { managedCommandAlive } =
    await moduleAt(runtime.sourceRoot, 'distribution/runtime-workspace/managed-workspace.mjs');
  const { environment } = await applicationEnvironment(config.environmentFile);
  const inspectBinding = async () => {
    const observed = await run(config.pythonExecutable, [
      join(runtime.sourceRoot, ROOT + 'sf30-seller-sdk/clinicaltrials/cli.py'),
      '--workspace', workspaceDirectory, 'binding',
    ], { encoding: 'utf8', env: environment, timeout: 15000, maxBuffer: 65536 });
    return JSON.parse(observed.stdout);
  };
  const original = await inspectBinding();
  need(original.schema === 'stellar-forge.clinicaltrials-managed-binding.v1',
    'The selected runtime must include the complete original managed ClinicalTrials producer');
  try { await makePrivate(config.receivingDirectory); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(config.receivingDirectory); }
  const lease = await operationLease(join(config.receivingDirectory, 'receiving.lock'));
  const receiptPath = join(config.receivingDirectory, 'receiving.json');
  const selection = {
    runtimeDirectory: runtime.directory, sourceCommit: runtime.sourceCommit,
    installationId: runtime.installationId, sourceManifestSha256: runtime.sourceManifestSha256,
    sourcePacketSha256: config.packetSha256, expected, workspaceDirectory,
    pythonExecutable: config.pythonExecutable, bindingSha256: original.sha256,
    environmentFile: config.environmentFile ?? null,
    applicationWorkspace: config.applicationWorkspace ?? join(config.receivingDirectory, 'applications'),
    connectionFile: join(config.receivingDirectory, 'console-url'),
  };
  let journal, model, stage = 'OPEN';
  try {
    journal = await readJSON(receiptPath, true);
    if (journal) {
      need(journal.schema === SCHEMA &&
        JSON.stringify(canonical(journal.selection)) === JSON.stringify(canonical(selection)),
      'Continue this receiving operation with its original retained selection');
      if (journal.completedAt) return journal;
    } else {
      journal = { schema: SCHEMA, createdAt: new Date().toISOString(), selection,
        saveRequestId: randomUUID(), passes: ['first-open', 'reopen'].map(name => ({ name, requestId: randomUUID() })) };
      await saveJSON(receiptPath, journal);
    }
    const persist = async () => {
      journal.updatedAt = new Date().toISOString(); await saveJSON(receiptPath, journal, true);
    };
    const progress = phase => onProgress({ stage, phase, applicationId: journal.applicationId ?? null });
    try { await readFile(join(selection.applicationWorkspace, 'workspace.json')); }
    catch (error) {
      if (error.code !== 'ENOENT' || config.applicationWorkspace) throw error;
      await createRuntimeWorkspace({ directory: selection.applicationWorkspace });
    }
    model = await openRuntimeWorkspace({ directory: selection.applicationWorkspace });
    const attached = await model.attach({ directory: runtime.directory, label: 'ClinicalTrials retained cohort' });
    const application = async () => {
      const item = (await model.applicationsState()).applications.find(value => value.id === journal.applicationId);
      need(item, 'The saved original ClinicalTrials application is missing'); return item;
    };
    const waitFor = async (accept, recover) => {
      const began = Date.now(), attempted = new Set(); let nextProgress = began;
      for (;;) {
        const item = await application();
        if (accept(item)) return item;
        const operation = item.current ?? item.adoption;
        const recoverable = operation && ['PENDING', 'QUEUED', 'INTERRUPTED'].includes(operation.phase);
        const alive = operation?.state ? await managedCommandAlive(operation.state) : false;
        if (recoverable && !operation.active && !alive && recover && !attempted.has(operation.id)) {
          attempted.add(operation.id); await recover(item); continue;
        }
        need(!['FAILED', 'UNAVAILABLE'].includes(item.phase) &&
          item.adoption?.phase !== 'FAILED', 'The original operation failed; reopen its recorded output');
        need(Date.now() - began < 180000, 'The original operation remains recorded; continue this same receiving');
        if (Date.now() >= nextProgress) { progress(item.phase); nextProgress = Date.now() + 15000; }
        await delay(500);
      }
    };
    if (!journal.reviewId) {
      stage = 'REVIEW';
      const review = await model.applicationsReview({ runtimeId: attached.runtimeId, kind: 'clinicaltrials',
        label: config.label ?? 'Retained ClinicalTrials portfolio', ...(config.homeId ? { homeId: config.homeId } : {}),
        settings: { workspaceDirectory, pythonExecutable: config.pythonExecutable,
          connectionFile: selection.connectionFile, port: 0,
          ...(config.environmentFile ? { environmentFile: config.environmentFile } : {}) } });
      need(review.command.command === 'clinicaltrials', 'The original source command changed');
      journal.reviewId = review.id; await persist();
    }
    if (!journal.applicationId) {
      stage = 'SAVE';
      const saved = await model.applicationsSave({ requestId: journal.saveRequestId, reviewId: journal.reviewId });
      journal.applicationId = saved.applicationId; await persist();
      if (saved.connectionError) throw new Error(saved.connectionError.message);
    }
    stage = 'ADOPT';
    await model.applicationsConnect({ applicationId: journal.applicationId });
    const attachedApp = await application();
    if (!attachedApp.release && attachedApp.adoption && !attachedApp.adoption.active) {
      const op = attachedApp.adoption;
      if (op.phase === 'QUEUED') await model.resumeQueued(op.id);
      else if (op.phase === 'INTERRUPTED') await model.recoverManagedOperation(op.id);
    }
    await waitFor(item => Boolean(item.release), async item => {
      if (item.adoption?.id) await model.recoverManagedOperation(item.adoption.id);
    });
    for (const pass of journal.passes) {
      if (pass.stoppedAt) continue;
      await model.close(); model = await openRuntimeWorkspace({ directory: selection.applicationWorkspace });
      if (!pass.opened) {
        stage = 'START_' + pass.name;
        if (!pass.reviewId) {
          pass.reviewId = (await model.applicationsStartReview({ applicationId: journal.applicationId })).id;
          await persist();
        }
        const selected = await application();
        const recover = () => model.applicationsRecover({
          applicationId: journal.applicationId, operationId: pass.requestId });
        if (!selected.runs.some(item => item.id === pass.requestId))
          await model.applicationsStart({ applicationId: journal.applicationId,
            requestId: pass.requestId, reviewId: pass.reviewId });
        else if (['PENDING', 'QUEUED', 'INTERRUPTED'].includes(selected.current?.phase) &&
          !selected.current.active) await recover();
        const active = await waitFor(item => item.current?.id === pass.requestId &&
          Boolean(item.current.privateUrl), recover);
        const url = new URL(active.current.privateUrl);
        need(url.hostname === '127.0.0.1' && /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)),
          'The original console URL is missing');
        need((await readFile(selection.connectionFile, 'utf8')).trim() === url.href,
          'The original MCP connection file differs from the opened console');
        const request = (path, body) => new Promise((resolveRequest, reject) => {
          const target = new URL(path, url), chunks = [];
          const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
          let size = 0;
          const request = httpRequest(target, {
            method: payload ? 'POST' : 'GET', agent: false,
            headers: { authorization: 'Bearer ' + url.hash.slice(1), origin: url.origin,
              ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}) }
          }, response => {
            response.on('data', chunk => {
              size += chunk.length;
              if (size > 4 * 1024 * 1024) { request.destroy(new Error('Original managed response exceeded 4 MiB')); return; }
              chunks.push(chunk);
            });
            response.once('error', reject);
            response.once('end', () => {
              const bytes = Buffer.concat(chunks);
              if (response.statusCode !== 200) { reject(new Error('Original console ' + path + ' returned HTTP ' + response.statusCode)); return; }
              const declared = response.headers['content-length'];
              if (declared !== undefined && Number(declared) !== bytes.length) { reject(new Error('Original complete response length changed')); return; }
              resolveRequest({ bytes, type: response.headers['content-type'] ?? '' });
            });
          });
          request.setTimeout(30000, () => request.destroy(new Error('Original managed console request timed out')));
          request.once('error', reject); request.end(payload);
        });
        const get = async path => JSON.parse((await request(path)).bytes);
        const launch = await get('/api/launch'), state = await get('/api/state');
        need(launch.schema === 'stellar-forge.clinicaltrials-workspace-launch.v1' &&
          launch.bindingSha256 === selection.bindingSha256 && launch.workspace === workspaceDirectory,
          'The original live ClinicalTrials workspace binding changed');
        const capture = state.captures.find(value => value.id === expected.captureId);
        const build = state.builds.find(value => value.id === expected.buildId);
        need(capture?.status === 'completed' && capture.rowCount === expected.rows &&
          capture.pageCount === expected.pages && capture.source === expected.sourceId &&
          build?.native?.snapshot === expected.snapshot && state.activeBuild === expected.buildId &&
          state.sources.some(value => value.id === expected.sourceId) &&
          state.plans.some(value => value.id === expected.planId),
          'The original complete cohort, mapping or native edition changed');
        for (const review of expected.reviews)
          need(state.reviews.some(value => value.id === review.id && value.nctId === review.nctId),
            'An original reviewed study changed: ' + review.nctId);
        const reviewed = [];
        for (const review of expected.reviews) {
          const source = await get('/api/clinical/study?' + new URLSearchParams({
            captureId: expected.captureId, nctId: review.nctId
          }));
          need(typeof source.json === 'string' && hash(Buffer.from(source.json)) === source.sourceSha256,
            'The full retained original study JSON changed');
          reviewed.push({ nctId: review.nctId, reviewId: review.id, bytes: Buffer.byteLength(source.json),
            sourceSha256: source.sourceSha256 });
        }
        const moduleDirectory = join(runtime.sourceRoot, 'stellar-forge/mcp-merchant-operator');
        const { MerchantClinicalTrialsWorkspaces, clinicalTrialsWorkspaceTools,
          readClinicalTrialsWorkspaceConfiguration } = await import(pathToFileURL(join(moduleDirectory, 'clinicaltrials-workspace.mjs')));
        const { openClinicalTrialsClient, downloadClinicalTrialsExport,
          reopenClinicalTrialsExport } = await import(pathToFileURL(join(moduleDirectory, 'clinicaltrials-client.mjs')));
        const { createMcpToolHandler } = await import(pathToFileURL(join(runtime.sourceRoot, 'stellar-forge/mcp-paid-agent/http-tools.mjs')));
        const directory = join(config.receivingDirectory, pass.name);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const connectionPath = join(directory, 'connection.json');
        await writeFile(connectionPath, JSON.stringify({
          schema: 'stellar-forge.clinicaltrials-workspace-connection.v1',
          workspaces: { portfolio: { label: 'Managed original ClinicalTrials portfolio',
            consoleUrlFile: selection.connectionFile, files: {} } }
        }) + '\n', { mode: 0o600 });
        const exportRoot = join(directory, 'mcp-exports');
        await mkdir(exportRoot, { recursive: true, mode: 0o700 });
        const configuration = { clinicalTrialsWorkspaces: await readClinicalTrialsWorkspaceConfiguration(connectionPath),
          exportsDirectory: exportRoot };
        const toolDefinitions = clinicalTrialsWorkspaceTools((name, description, properties = {}, required = [], hints = {}) => ({
          name, description, annotations: { readOnlyHint: hints.readOnly ?? false,
            idempotentHint: hints.idempotent ?? false, destructiveHint: hints.destructive ?? false,
            openWorldHint: hints.openWorld ?? false },
          inputSchema: { type: 'object', properties, required, additionalProperties: false }
        }));
        need(toolDefinitions.length === 42, 'The complete original 42-tool ClinicalTrials interface is missing');
        const mcpEnvironment = { CLINICAL_MANAGED_MCP_TOKEN: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '') };
        const adapter = new MerchantClinicalTrialsWorkspaces(configuration);
        const handler = createMcpToolHandler({ tools: toolDefinitions, call: adapter.call.bind(adapter) }, {
          bearerToken: mcpEnvironment.CLINICAL_MANAGED_MCP_TOKEN, serverName: 'starforge-clinicaltrials-managed-receiving',
          serverVersion: '0.1.0', instructions: 'Use the exact original managed ClinicalTrials owner and retained source.'
        });
        const mcp = createServer(handler);
        const sockets = new Set();
        mcp.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
        let endpoint, client, download;
        try {
          await new Promise((done, reject) => { mcp.once('error', reject); mcp.listen(0, '127.0.0.1', done); });
          endpoint = 'http://127.0.0.1:' + mcp.address().port + '/mcp';
          client = await openClinicalTrialsClient({ url: endpoint, tokenEnv: 'CLINICAL_MANAGED_MCP_TOKEN', environment: mcpEnvironment });
          const attachedState = (await client.status({ workspace: 'portfolio' })).state;
          need(attachedState.activeBuild === expected.buildId &&
            expected.reviews.every(review => attachedState.reviews.some(row => row.id === review.id)),
            'The MCP attachment opened a different original owner');
          const rows = []; let offset = 0;
          do {
            const page = (await client.studies({ workspace: 'portfolio', captureId: expected.captureId, offset, limit: 50 })).native;
            need(page.offset === offset && page.total === expected.rows, 'Original MCP study page identity changed');
            rows.push(...page.rows); offset = page.nextOffset;
          } while (offset !== null);
          need(rows.length === expected.rows && new Set(rows.map(row => row.nctId)).size === expected.rows,
            'The original MCP retained cohort lost or repeated a study');
          const prepared = await client.filePrepare({ workspace: 'portfolio', kind: 'contract', name: 'ProtocolRecordSchema.xsd' });
          const target = join(directory, 'received-contract');
          download = await downloadClinicalTrialsExport({ url: endpoint, tokenEnv: 'CLINICAL_MANAGED_MCP_TOKEN',
            environment: mcpEnvironment, exportId: prepared.exportId,
            expectedManifestSha256: prepared.manifestSha256, directory: target });
          need(download.state === 'COMPLETE', 'The original complete managed MCP source download did not finish');
          const reopened = await reopenClinicalTrialsExport({ directory: target, exportId: prepared.exportId,
            expectedManifestSha256: prepared.manifestSha256 });
          need(reopened.state === 'REOPENED' && reopened.bytes === download.bytes, 'The exact managed download did not reopen');
          download = { state: download.state, bytes: download.bytes, exportId: prepared.exportId,
            manifestSha256: prepared.manifestSha256, reopened: reopened.state };
        } finally {
          await adapter.close();
          if (mcp.listening) {
            const closed = new Promise(done => mcp.close(done)); mcp.closeIdleConnections();
            for (const socket of sockets) socket.destroy();
            await closed;
          }
        }
        const afterDetach = await get('/api/state');
        need(afterDetach.revision === state.revision &&
          afterDetach.reviews.length === state.reviews.length,
          'Closing the MCP borrower changed the original owner or retained reviews');
        const rendered = onOpen ? await onOpen({
          pass: pass.name, model, runtime, applicationId: journal.applicationId,
          applicationWorkspace: selection.applicationWorkspace, url: url.href, state,
          expected, receivingDirectory: directory
        }) : null;
        if (rendered) need(rendered.status === 'COMPLETE' &&
          rendered.reviews.length === reviewed.length && rendered.reviews.every(row =>
            reviewed.some(original => original.nctId === row.nctId && original.reviewId === row.reviewId &&
              original.sourceSha256 === row.sourceSha256 && original.bytes === row.bytes)),
        'The rendered original study source differs from the native receiving source');
        const sourceIdentity = { captureId: capture.id, rows: capture.rowCount, pages: capture.pageCount,
          sourceId: capture.source, buildId: state.activeBuild, snapshot: build.native.snapshot, reviews: reviewed };
        pass.opened = { at: new Date().toISOString(), sourceIdentity,
          sourceIdentitySha256: hash(JSON.stringify(canonical(sourceIdentity))),
          bindingSha256: launch.bindingSha256, executedSourceRoot: launch.sourceRoot,
          privateUrlSha256: hash(url.href), listener: url.origin, pid: launch.pid,
          prs: launch.prs, toolCount: toolDefinitions.length, download, rendered };
        await persist(); progress('OPEN');
      }
      stage = 'STOP_' + pass.name;
      await model.applicationsStop({ applicationId: journal.applicationId, operationId: pass.requestId });
      const stopped = await waitFor(item => item.phase === 'STOPPED' &&
        item.current?.id === pass.requestId && !item.current.active);
      need((await inspectBinding()).sha256 === selection.bindingSha256, 'The retained workspace binding changed');
      try { await readFile(selection.connectionFile); throw new Error('The stopped console retained its connection'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      let pidEnded = false;
      try { process.kill(pass.opened.pid, 0); } catch (error) { if (error.code === 'ESRCH') pidEnded = true; else throw error; }
      need(pidEnded, 'The original ClinicalTrials process has not ended');
      const listenerClosed = await new Promise(resolveClosed => {
        const request = httpRequest(new URL('/api/launch', pass.opened.listener), { agent: false }, response => {
          response.resume(); response.once('end', () => resolveClosed(false));
        });
        request.once('error', error => resolveClosed(error.code === 'ECONNREFUSED'));
        request.setTimeout(3000, () => { request.destroy(); resolveClosed(false); }); request.end();
      });
      need(listenerClosed, 'The original ClinicalTrials listener has not closed');
      pass.stoppedAt = new Date().toISOString(); pass.phase = stopped.current.phase;
      pass.closed = { connectionFileRemoved: true, pidEnded, listenerClosed };

      await persist(); progress('STOPPED');
    }
    for (const key of ['sourceIdentitySha256', 'bindingSha256'])
      need(journal.passes[0].opened[key] === journal.passes[1].opened[key],
        'The original retained customer changed across reopen: ' + key);
    need(journal.passes[0].opened.privateUrlSha256 !== journal.passes[1].opened.privateUrlSha256,
      'The original console session did not reopen');
    journal.completedAt = new Date().toISOString(); delete journal.issue; await persist(); return journal;
  } catch (error) {
    if (journal) {
      journal.issue = { stage, at: new Date().toISOString(), message: String(error.message).slice(0, 700) };
      await saveJSON(receiptPath, journal, true).catch(() => {});
    }
    throw error;
  } finally { if (model) await model.close(); await lease.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
  const result = await receiveClinicalTrialsApplications(config, {
    onProgress: value => process.stdout.write(JSON.stringify(value) + '\n'),
  });
  process.stdout.write(JSON.stringify({ schema: result.schema, status: 'COMPLETED',
    applicationId: result.applicationId, sourceCommit: result.selection.sourceCommit,
    bindingSha256: result.selection.bindingSha256, passes: result.passes }) + '\n');
}
