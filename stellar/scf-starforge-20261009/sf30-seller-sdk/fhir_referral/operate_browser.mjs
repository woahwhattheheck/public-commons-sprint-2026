#!/usr/bin/env node
// MIT. Complete original Gravity UI operation and portable editable receiving.
import { createReadStream, constants } from 'node:fs';
import { mkdir, lstat, readFile, writeFile, chmod } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  absolute, privateDirectory, readJSON, saveJSON, operationLease, need, now, regular,
} from '../../distribution/runtime-workspace/storage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = 'stellar-forge.gravity-referral-browser-operated.v1';
const OPERATION = 'SCF-GRAVITY-REFERRAL-BROWSER-450E-20261012';
const NATIVE = 'SCF-GRAVITY-REFERRAL-WORKSPACE-450E-20261012';
const ACTOR = 'Gravity original browser receiving operator';
const WORKSPACE = 'stellar-forge.eltss-workspace.v1';
const REFERRAL = 'stellar-forge.gravity-referral.v1';
const R = '/api/referrals';
const SHA = /^[a-f0-9]{64}$/;
const scalarHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const RECORD_GROUPS = {
  configurationIds: 'configurations', editionIds: 'editions', reviewIds: 'reviews',
  assessmentIds: 'assessments', decisionIds: 'decisions', correctionIds: 'corrections',
  comparisonIds: 'comparisons', handoffIds: 'handoffs', receivingIds: 'receivings',
  exchangeRequestIds: 'exchangeRequests', exchangeOperationIds: 'exchangeOperations',
  monitoringIds: 'monitoring',
};

export function originalGravityReceiving(value) {
  need(plain(value) && value.schema === 'stellar-forge.gravity-referral-operated.v1' &&
    value.operation === NATIVE && typeof value.completedAt === 'string' &&
    typeof value.workspace === 'string' && UUID.test(value.workspaceId),
    'GRAVITY_BROWSER_NATIVE_RECEIVING_REQUIRED', 'Open the completed original Gravity native receiving record.');
  absolute(value.workspace);
  for (const key of ['sourceIds', 'configurationIds', 'editionIds', 'reviewIds', 'assessmentIds',
    'decisionIds', 'correctionIds', 'comparisonIds', 'handoffIds', 'receivingIds',
    'exchangeRequestIds', 'monitoringIds', 'buildIds', 'artifactIds', 'connectionIds', 'discoveryIds']) {
    need(Array.isArray(value[key]) && value[key].length > 0 &&
      value[key].every(id => typeof id === 'string' && SHA.test(id)),
      'GRAVITY_BROWSER_ORIGINAL_RECORDS_REQUIRED', 'Retain the original complete ' + key + '.');
  }
  for (const key of ['exchangeOperationIds', 'acquisitionOperationIds'])
    need(Array.isArray(value[key]) && value[key].length && value[key].every(id => UUID.test(id)),
      'GRAVITY_BROWSER_ORIGINAL_OPERATIONS_REQUIRED', 'Retain the actual original ' + key + '.');
  for (const key of ['baseSourceId', 'baseEditionId', 'baseAssessmentId', 'correctedSourceId',
    'correctedEditionId', 'correctedAssessmentId', 'selectedOriginalTaskId', 'selectedCorrectedTaskId', 'reviewId'])
    need(SHA.test(value[key]), 'GRAVITY_BROWSER_ORIGINAL_SELECTION_REQUIRED', key);
  need(plain(value.workspacePacket) && SHA.test(value.workspacePacket.sha256) &&
    Number.isSafeInteger(value.workspacePacket.bytes) && value.workspacePacket.bytes > 0,
    'GRAVITY_BROWSER_COMPLETE_PACKET_REQUIRED');
  return value;
}

function privateURL(value) {
  const url = new URL(value);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username &&
    !url.password && url.pathname === '/' && !url.search && /^#[A-Za-z0-9_-]{43}$/.test(url.hash),
    'GRAVITY_BROWSER_PRIVATE_URL_REQUIRED', 'Use the current private address from the original Gravity operator.');
  return url;
}
async function nativeJSON(urlText, path) {
  const url = privateURL(urlText);
  need(typeof path === 'string' && path.startsWith('/api/') && !path.startsWith('//'),
    'GRAVITY_BROWSER_NATIVE_ROUTE_REQUIRED');
  const response = await fetch(new URL(path, url), {
    headers: { Authorization: 'Bearer ' + url.hash.slice(1) }, redirect: 'error',
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); }
  catch { throw Object.assign(new Error('The original operator did not return complete JSON.'), { code: 'GRAVITY_BROWSER_NATIVE_JSON' }); }
  need(response.ok, 'GRAVITY_BROWSER_NATIVE_READ_FAILED', value?.error || ('HTTP ' + response.status));
  return value;
}
function retainsOriginals(state, original, label = 'workspace') {
  need(state?.schema === WORKSPACE && state.workspaceId === original.workspaceId &&
    state.referral?.schema === REFERRAL && state.referral.workspaceId === original.workspaceId,
    'GRAVITY_BROWSER_WORKSPACE_CHANGED', 'The ' + label + ' differs from the selected original Gravity UUID.');
  for (const [key, nativeKey] of [['sources', 'sourceIds'], ['builds', 'buildIds'],
    ['artifacts', 'artifactIds'], ['connections', 'connectionIds'], ['discoveries', 'discoveryIds']]) {
    const observed = new Set((state[key] ?? []).map(row => row.id));
    need((original[nativeKey] ?? []).every(id => observed.has(id)),
      'GRAVITY_BROWSER_ORIGINAL_RECORD_MISSING', 'The original ' + key + ' selection is missing from ' + label + '.');
  }
  for (const [nativeKey, key] of Object.entries(RECORD_GROUPS)) {
    const observed = new Set((state.referral[key] ?? []).map(row => row.id));
    need((original[nativeKey] ?? []).every(id => observed.has(id)),
      'GRAVITY_BROWSER_ORIGINAL_RECORD_MISSING', 'The original referral ' + key + ' is missing from ' + label + '.');
  }
  const operations = new Set((state.operations ?? []).map(row => row.operationId));
  need(original.acquisitionOperationIds.every(id => operations.has(id)),
    'GRAVITY_BROWSER_ORIGINAL_OPERATION_MISSING');
  return state;
}
export async function originalGravityState(urlText, receiving, { workspace } = {}) {
  originalGravityReceiving(receiving);
  const selected = absolute(workspace ?? receiving.workspace);
  const operator = await nativeJSON(urlText, '/api/operator');
  need(operator.schema === 'stellar-forge.gravity-referral-operator-connection.v1' && operator.active === true &&
    operator.workspaceId === receiving.workspaceId && operator.workspace === selected &&
    UUID.test(operator.instanceId) && Number.isSafeInteger(operator.processId),
    'GRAVITY_BROWSER_ORIGINAL_OPERATOR_CHANGED', 'Use the current Gravity operator for the explicitly selected received workspace.');
  const state = await nativeJSON(urlText, '/api/state');
  return retainsOriginals(state, receiving);
}
export async function gravityBrowserReady(page) {
  await page.waitForFunction(() => {
    const error = document.querySelector('#notice[data-kind="error"]');
    if (error?.textContent.trim()) return true;
    return document.body.dataset.ready === 'true' &&
      document.querySelector('#content')?.getAttribute('aria-busy') === 'false' &&
      document.body.getAttribute('aria-busy') !== 'true';
  }, null, { timeout: 180000 });
  const error = await page.locator('#notice').evaluate(node => node.dataset.kind === 'error' ? node.textContent : '').catch(() => '');
  need(!error?.trim(), 'GRAVITY_BROWSER_OPERATOR_ERROR', error);
}
async function fileIdentity(path) {
  const info = await lstat(path);
  need(info.isFile() && !info.isSymbolicLink(), 'GRAVITY_BROWSER_FILE_REQUIRED');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path, { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) {
    bytes += chunk.length; hash.update(chunk);
  }
  const after = await lstat(path);
  need(bytes === info.size && after.size === info.size && after.mtimeMs === info.mtimeMs &&
    after.ctimeMs === info.ctimeMs, 'GRAVITY_BROWSER_FILE_CHANGED');
  return { file: path, bytes, sha256: hash.digest('hex') };
}
async function sameFile(saved) {
  const current = await fileIdentity(saved.file);
  need(current.bytes === saved.bytes && current.sha256 === saved.sha256,
    'GRAVITY_BROWSER_RETAINED_FILE_CHANGED', 'A complete retained browser output changed.');
  return saved;
}
async function pagePrivateURL(page) {
  const selected = await page.evaluate(() => {
    const token = sessionStorage.getItem('gravity.operator.' + location.origin);
    return token ? location.origin + '/#' + token : location.href;
  });
  privateURL(selected); return selected;
}
async function startOriginalOperator(workspace, expectedWorkspaceId = null) {
  const args = [join(HERE, 'cli.mjs'), 'serve', '--workspace', absolute(workspace), '--port', '0'];
  if (expectedWorkspaceId) args.push('--expected-workspace-id', expectedWorkspaceId);
  const child = spawn(process.env.SF30_REFERRAL_NODE || process.execPath, args, {
    cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  let stderr = '', buffer = '', settled = false, startup;
  child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { stderr = (stderr + text).slice(-16000); });
  const promise = new Promise((resolveStart, reject) => {
    const timer = setTimeout(() => {
      if (!settled) { settled = true; child.kill('SIGTERM'); reject(new Error('The original receiving operator did not start. ' + stderr)); }
    }, 120000);
    child.once('error', error => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(new Error('The original receiving operator exited ' + code + '/' + signal + '. ' + stderr)); }
    });
    child.stdout.setEncoding('utf8'); child.stdout.on('data', text => {
      buffer += text;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (value?.schema !== 'stellar-forge.gravity-referral-startup.v1') continue;
        try {
          privateURL(value.url);
          need(value.workspace === workspace && (!expectedWorkspaceId || value.workspaceId === expectedWorkspaceId),
            'GRAVITY_BROWSER_RECEIVER_STARTUP_CHANGED');
          if (!settled) { settled = true; startup = value; clearTimeout(timer); resolveStart(value); }
        } catch (error) { clearTimeout(timer); if (!settled) { settled = true; child.kill('SIGTERM'); reject(error); } }
      }
    });
  });
  const close = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolveClose => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      child.once('exit', () => { clearTimeout(timer); resolveClose(); });
      child.kill('SIGTERM');
    });
  };
  try { await promise; return { child, startup, close }; }
  catch (error) { await close().catch(() => {}); throw error; }
}

export async function operateGravityBrowser({
  page, browser, receiving, native = null, output, workspace, url: suppliedURL,
}) {
  originalGravityReceiving(receiving);
  workspace = absolute(workspace ?? receiving.workspace);
  output = absolute(output ?? join(workspace, 'referral-browser-receiving'));
  need(browser && page, 'GRAVITY_BROWSER_SURFACE_REQUIRED');
  await mkdir(output, { recursive: true, mode: 0o700 }); await privateDirectory(output);
  const lease = await operationLease(join(output, 'browser.lock'));
  const journalPath = join(output, 'BROWSER_JOURNEY.json');
  const resultPath = join(output, 'OPERATED_GRAVITY_BROWSER.json');
  const binding = { nativeOperation: receiving.operation, nativeCompletedAt: receiving.completedAt,
    originalReceivingSha256: scalarHash(receiving), originalWorkspace: receiving.workspace,
    workspace, workspaceId: receiving.workspaceId, sourceIds: receiving.sourceIds,
    editionIds: receiving.editionIds, reviewIds: receiving.reviewIds, assessmentIds: receiving.assessmentIds,
    exchangeOperationIds: receiving.exchangeOperationIds, originalWorkspacePacket: receiving.workspacePacket };
  let journal, url, child = null, receivingPage = null;
  const errors = [];
  const onError = error => errors.push({ at: now(), message: error.message });
  page.on('pageerror', onError);
  const checkpoint = async () => { journal.updatedAt = now(); await saveJSON(journalPath, journal, true); };
  const save = async (name, value) => {
    const path = join(output, name); await saveJSON(path, value, true); return fileIdentity(path);
  };
  const progress = async message => {
    journal.activeStep = { at: now(), message }; await checkpoint();
    process.stdout.write(JSON.stringify({ operation: OPERATION, workspaceId: receiving.workspaceId, step: message }) + '\n');
  };
  const closeDialog = async (target = page) => {
    if (await target.locator('#detail').evaluate(node => node.open).catch(() => false))
      await target.locator('#close-detail').click();
  };
  const nav = async (view, target = page) => {
    await closeDialog(target); await gravityBrowserReady(target);
    await target.locator('[data-nav="' + view + '"]').click();
    await target.locator('[data-nav="' + view + '"][aria-current="page"]').waitFor();
    await gravityBrowserReady(target);
  };
  const screen = async name => {
    const path = join(output, name + '.png');
    await page.screenshot({ path, fullPage: true });
    journal.screens[name] = await fileIdentity(path); await checkpoint(); return journal.screens[name];
  };
  const fill = async (form, name, value) => {
    const control = form.locator('[name="' + name + '"]');
    const type = await control.evaluate(node => ({ tag: node.tagName, type: node.type }));
    if (type.tag === 'SELECT') await control.selectOption(value ?? '');
    else if (type.type === 'checkbox') await control.setChecked(Boolean(value));
    else await control.fill(String(value ?? ''));
  };
  const response = async (action, path, { method = 'POST', target = page } = {}) => {
    const startedAt = now();
    const [reply] = await Promise.all([
      target.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === method, { timeout: 180000 }),
      action(),
    ]);
    const raw = await reply.text();
    let value;
    try { value = JSON.parse(raw); }
    catch { throw new Error('Original UI response was not complete JSON at ' + path); }
    const request = reply.request(), contentType = request.headers()['content-type'] || '';
    const receipt = { schema: 'stellar-forge.gravity-referral-browser-http.v1',
      startedAt, completedAt: now(), request: { method, path,
        body: contentType.includes('json') ? request.postData() : null, contentType },
      response: { status: reply.status(), headers: reply.headers(), body: raw } };
    const name = 'NATIVE_RESPONSE_' + String(journal.responses.length + 1).padStart(3, '0') + '.json';
    const file = await save(name, receipt); journal.responses.push({ path, method, ...file }); await checkpoint();
    need(reply.ok(), 'GRAVITY_BROWSER_NATIVE_ACTION_FAILED', value?.error || JSON.stringify(value));
    await gravityBrowserReady(target);
    return value;
  };
  const submit = async (id, path, options = {}) => {
    const target = options.target ?? page;
    const form = target.locator('form[id="' + id + '"]');
    need(await form.count() === 1, 'GRAVITY_BROWSER_ORIGINAL_FORM_MISSING', id);
    return response(() => form.locator('button[type="submit"]').click(), path, options);
  };
  const state = () => originalGravityState(url, receiving, { workspace });
  const record = (kind, id) => nativeJSON(url, R + '/records/' + kind + '/' + id);
  const labelFor = key => journal.labelPrefix + ' · ' + key;
  const actualRecord = async (kind, key, create) => {
    const label = labelFor(key);
    const rows = (await state()).referral[kind].filter(r => r.label === label);
    need(rows.length <= 1, 'GRAVITY_BROWSER_SELECTION_AMBIGUOUS', 'The retained original browser label has multiple records.');
    if (rows.length) {
      const old = await record(kind, rows[0].id);
      need((old.actor ?? old.request?.actor) === ACTOR, 'GRAVITY_BROWSER_ORIGINAL_ACTOR_CHANGED');
      return old;
    }
    return create(label);
  };
  const rowByLabel = (label, target = page) =>
    target.locator('tbody tr').filter({ has: target.getByText(label, { exact: true }) });
  const openSaved = async (kind, id, view, button = /^(Open|Selected)$/) => {
    const saved = await record(kind, id);
    await nav(view);
    const row = rowByLabel(saved.label);
    need(await row.count() === 1, 'GRAVITY_BROWSER_SELECTION_AMBIGUOUS', kind + '/' + id);
    await row.getByRole('button', { name: button }).click(); await gravityBrowserReady(page);
    return saved;
  };
  const selectSource = async id => {
    const before = await state(), source = before.sources.find(r => r.id === id);
    need(source, 'GRAVITY_BROWSER_ORIGINAL_SOURCE_MISSING');
    await nav('sources');
    const row = rowByLabel(source.label);
    need(await row.count() === 1, 'GRAVITY_BROWSER_SOURCE_LABEL_AMBIGUOUS');
    await row.getByRole('button', { name: /^(Open|Selected)$/ }).click(); await gravityBrowserReady(page);
    need((await page.locator('.selection').textContent()).includes(id), 'GRAVITY_BROWSER_SOURCE_SELECTION_CHANGED');
    return source;
  };
  const useEdition = async id => {
    const value = await record('editions', id);
    await nav('editions');
    const row = rowByLabel(value.label);
    need(await row.count() === 1, 'GRAVITY_BROWSER_EDITION_LABEL_AMBIGUOUS');
    await row.getByRole('button', { name: 'Use', exact: true }).click(); await gravityBrowserReady(page);
    return value;
  };
  const download = async (key, action, filename, expected = null, target = page) => {
    if (journal.downloads[key]) return sameFile(journal.downloads[key]);
    await progress('Receive complete file: ' + key); await closeDialog(target);
    const [transfer] = await Promise.all([target.waitForEvent('download', { timeout: 180000 }), action()]);
    const path = join(output, filename);
    await transfer.saveAs(path); await chmod(path, 0o600);
    need(await transfer.failure() === null, 'GRAVITY_BROWSER_COMPLETE_DOWNLOAD_FAILED');
    const saved = await fileIdentity(path);
    if (expected) need(saved.bytes === expected.bytes && (!expected.sha256 || saved.sha256 === expected.sha256),
      'GRAVITY_BROWSER_ORIGINAL_FILE_CHANGED', key);
    journal.downloads[key] = saved; await checkpoint(); await gravityBrowserReady(target); return saved;
  };
  const phase = async (key, action) => {
    let row = journal.phases.find(item => item.key === key);
    if (!row) {
      row = { key, startedAt: now(), state: 'running', operationId: randomUUID() };
      journal.phases.push(row); await checkpoint();
    }
    if (row.state === 'complete') return row.value;
    await progress(key);
    const value = await action(row);
    row.state = 'complete'; row.completedAt = now(); row.value = value; await checkpoint();
    return value;
  };
  try {
    try { journal = await readJSON(journalPath); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      journal = { schema: SCHEMA, operation: OPERATION, binding, startedAt: now(),
        labelPrefix: 'Gravity browser receiving ' + randomUUID(), screens: {}, downloads: {},
        responses: [], phases: [], observations: {}, failures: [] };
      await checkpoint();
    }
    need(JSON.stringify(journal.binding) === JSON.stringify(binding),
      'GRAVITY_BROWSER_RECEIVING_CHANGED', 'Continue the exact original receiving and explicit workspace selection.');
    if (suppliedURL) { privateURL(suppliedURL); await page.goto(suppliedURL); }
    await gravityBrowserReady(page); url = suppliedURL || await pagePrivateURL(page);
    const before = await state();
    if (native) retainsOriginals(native, receiving, 'supplied native state');
    if (journal.completedAt) {
      const result = JSON.parse(await regular(resultPath, 64 * 1024 * 1024));
      for (const saved of [...Object.values(result.screens), ...Object.values(result.downloads)])
        await sameFile(saved);
      retainsOriginals(before, receiving);
      return result;
    }
    if (!journal.observations.before) journal.observations.before = await save('ORIGINAL_WORKSPACE_BEFORE.json', before);
    if (!journal.observations.receiving) journal.observations.receiving = await save('ORIGINAL_NATIVE_RECEIVING.json', receiving);
    await checkpoint();
    await page.locator('#operator-actor').fill(ACTOR);
    await page.locator('#operator-actor').dispatchEvent('change');

    const originals = await phase('original-queue-source-and-complete-intake', async () => {
      const selected = await openSaved('assessments', receiving.baseAssessmentId, 'queue');
      const tasks = await nativeJSON(url, R + '/assessments/' + selected.id + '/tasks?limit=100');
      need(tasks.total > 0 && tasks.rows.length === tasks.total, 'GRAVITY_BROWSER_COMPLETE_REFERRAL_QUEUE_REQUIRED');
      const row = page.locator('tbody tr').filter({ hasText: receiving.selectedLogicalId });
      need(await row.count() === 1, 'GRAVITY_BROWSER_ORIGINAL_TASK_SELECTION_REQUIRED');
      await response(() => row.getByRole('button', { name: 'Referral detail', exact: true }).click(),
        R + '/assessments/' + selected.id + '/cells', { method: 'GET' });
      need(await page.locator('#detail-body tbody tr').count() === 24,
        'GRAVITY_BROWSER_ALL_FIELD_ROWS_REQUIRED', 'The original referral must retain all24 source-field observations.');
      await screen('01-original-referral-and24-fields'); await closeDialog();
      const source = await selectSource(receiving.baseSourceId);
      const packet = await download('original-source',
        () => page.getByRole('button', { name: 'Download complete original', exact: true }).click(),
        'Gravity_Complete_Original_Source_Packet.zip', { bytes: source.bytes, sha256: source.id });
      const form = page.locator('#source-intake');
      await fill(form, 'label', source.label);
      await form.locator('[name="file"]').setInputFiles({ name: source.name, mimeType: 'application/zip', buffer: await readFile(packet.file) });
      const retained = await submit('source-intake', '/api/sources');
      need(retained.id === receiving.baseSourceId, 'GRAVITY_BROWSER_SOURCE_REINTAKE_CHANGED');
      await screen('02-complete-original-source-intake');
      return { sourceId: source.id, queueTasks: tasks.total, fieldCount: 24, packet };
    });

    const review = await phase('all81-review-rows-draft-reopen-and-successor', async row => {
      const selected = await openSaved('reviews', receiving.reviewId, 'requirements');
      const formId = 'review-editor-' + selected.id;
      let form = page.locator('form[id="' + formId + '"]');
      need(await form.locator('[data-review-group="requirements"]').count() === 57 &&
        await form.locator('[data-review-group="fields"]').count() === 24,
        'GRAVITY_BROWSER_ALL_REVIEW_ROWS_REQUIRED');
      const fieldKey = selected.fields[0].key, reason = 'Source-selected browser receiving: the exact original field remains applicable; retain the native observation and receiving lineage.';
      const edited = 'fields__' + fieldKey + '__';
      await fill(form, 'label', labelFor('complete reviewed field successor'));
      await fill(form, edited + 'status', 'applicable');
      await fill(form, edited + 'reason', reason);
      await fill(form, edited + 'owner', ACTOR);
      await fill(form, edited + 'reviewer', ACTOR);
      await fill(form, edited + 'reviewedAt', row.startedAt);
      await fill(form, 'note', 'Complete57requirement/24field edition. This browser operation records one explicit applicable field disposition and preserves every other original review row.');
      await nav('queue'); await nav('requirements'); await page.reload(); await gravityBrowserReady(page);
      await openSaved('reviews', selected.id, 'requirements');
      form = page.locator('form[id="' + formId + '"]');
      need(await form.locator('[name="' + edited + 'reason"]').inputValue() === reason,
        'GRAVITY_BROWSER_LOCAL_DRAFT_REOPEN_FAILED');
      await page.getByRole('button', { name: 'Fields (24)', exact: true }).click(); await gravityBrowserReady(page);
      await screen('03-retained-field-review-draft');
      await page.getByRole('button', { name: 'Show all', exact: true }).click(); await gravityBrowserReady(page);
      const saved = await actualRecord('reviews', 'complete reviewed field successor', async () => submit(formId, R + '/reviews'));
      need(saved.requirements.length === 57 && saved.fields.length === 24 && saved.predecessorId === selected.id,
        'GRAVITY_BROWSER_COMPLETE_REVIEW_SUCCESSOR_REQUIRED');
      const oldOther = selected.fields.filter(v => v.key !== fieldKey), newOther = saved.fields.filter(v => v.key !== fieldKey);
      need(JSON.stringify(selected.requirements) === JSON.stringify(saved.requirements) &&
        JSON.stringify(oldOther) === JSON.stringify(newOther), 'GRAVITY_BROWSER_UNSELECTED_REVIEW_ROWS_CHANGED');
      await screen('04-complete81-row-successor');
      return { id: saved.id, predecessorId: selected.id, fieldKey, requirementCount: 57, fieldCount: 24 };
    });

    const topology = await phase('explicit-source-host-topology-and-referral-cohort', async () => {
      const predecessor = await record('configurations', receiving.topologyReview.configurationId);
      const saved = await actualRecord('configurations', 'selected direct-light receiving topology', async label => {
        await nav('topology'); const form = page.locator('#topology-form');
        await fill(form, 'label', label); await fill(form, 'topology', 'direct-light');
        await fill(form, 'recipientHostRole', 'source'); await fill(form, 'sourceVersion', '3.0.0');
        await fill(form, 'classification', 'operator_transformation'); await fill(form, 'predecessorId', predecessor.id);
        for (const role of predecessor.roles.filter(r => r.role !== 'intermediary')) {
          await fill(form, role.role + 'Organization', role.organization);
          await fill(form, role.role + 'Owner', ACTOR);
          await fill(form, role.role + 'Connection', role.connectionId);
          await fill(form, role.role + 'Note', 'Original published actor reference; this separately reviewed topology selects the source-hosted direct-light receiver.');
        }
        await fill(form, 'monitorMode', 'manual'); await fill(form, 'intervalMinutes', '');
        await fill(form, 'monitorOwner', ACTOR); await fill(form, 'monitorReason', 'Manual operation of the received published-source workspace.');
        await fill(form, 'note', 'Explicit source-hosted direct-light selection for this authored receiving edition.');
        return submit('topology-form', R + '/configurations');
      });
      need(saved.topology === 'direct-light' && saved.recipientHostRole === 'source' &&
        saved.predecessorId === predecessor.id && saved.roles.length === 2,
        'GRAVITY_BROWSER_TOPOLOGY_SELECTION_CHANGED');
      const parent = await record('editions', receiving.correctedEditionId);
      const cohort = await actualRecord('editions', 'received full referral cohort', async label => {
        await selectSource(parent.sourceId); await nav('editions');
        const formId = 'edition-form-' + parent.sourceId, form = page.locator('form[id="' + formId + '"]');
        await fill(form, 'label', label); await fill(form, 'configurationId', saved.id);
        await fill(form, 'predecessorId', parent.id);
        for (const control of await form.locator('[name="taskId"]').all()) await control.uncheck();
        for (const id of parent.taskIds) await form.locator('[name="taskId"][value="' + id + '"]').check();
        await fill(form, 'referencePolicy', parent.referencePolicy); await fill(form, 'baseUrl', parent.baseUrl);
        await fill(form, 'note', 'Every original selected Task is preserved under the separately authored source-hosted topology.');
        return submit(formId, R + '/editions');
      });
      need(cohort.sourceId === parent.sourceId && cohort.configurationId === saved.id &&
        JSON.stringify(cohort.taskIds) === JSON.stringify(parent.taskIds) && cohort.predecessorId === parent.id,
        'GRAVITY_BROWSER_ORIGINAL_COHORT_CHANGED');
      await screen('05-selected-topology-and-full-cohort');
      return { configurationId: saved.id, editionId: cohort.id, sourceId: cohort.sourceId,
        taskIds: cohort.taskIds, graphId: cohort.graphId, predecessorId: parent.id };
    });

    const decision = await phase('scoped-referral-ownership-and-original-source-citation', async row => {
      const saved = await actualRecord('decisions', 'scoped source receiving ownership', async label => {
        await useEdition(topology.editionId); await nav('decisions');
        const formId = 'decision-form-' + topology.editionId, form = page.locator('form[id="' + formId + '"]');
        const sourceRow = await nativeJSON(url, '/api/sources/' + topology.sourceId + '/rows/' + receiving.selectedCorrectedTaskId);
        await fill(form, 'label', label); await fill(form, 'kind', 'ownership'); await fill(form, 'outcome', 'accepted');
        await fill(form, 'owner', ACTOR); await fill(form, 'purpose', 'Review and receive this original published-source referral edition.');
        await form.locator('[name="taskId"][value="' + receiving.selectedCorrectedTaskId + '"]').check();
        await fill(form, 'reason', 'The receiving operator owns the local source review and handover for this exact Task. Its original requester, owner, subject and consent resources remain unchanged.');
        await fill(form, 'recordedAt', row.startedAt);
        await fill(form, 'sourceRefs', JSON.stringify([{ sourceId: topology.sourceId,
          recordId: receiving.selectedCorrectedTaskId, pointer: sourceRow.entryPointer }]));
        await fill(form, 'assessmentId', '');
        return submit(formId, R + '/decisions');
      });
      need(saved.editionId === topology.editionId &&
        saved.taskIds.includes(receiving.selectedCorrectedTaskId) && saved.kind === 'ownership',
        'GRAVITY_BROWSER_DECISION_SCOPE_CHANGED');
      await screen('06-original-scoped-ownership');
      return { id: saved.id, taskIds: saved.taskIds, editionId: saved.editionId };
    });

    const corrected = await phase('reviewed-source-status-correction-and-full-comparison', async () => {
      const sourceRow = await nativeJSON(url, '/api/sources/' + topology.sourceId + '/rows/' + receiving.selectedCorrectedTaskId);
      const sourceResource = JSON.parse(sourceRow.jsonText);
      need(sourceResource.resourceType === 'Task' && sourceResource.id === receiving.selectedLogicalId &&
        sourceResource.status === 'in-progress', 'GRAVITY_BROWSER_ORIGINAL_CORRECTION_PREIMAGE_CHANGED');
      const preview = await actualRecord('correctionPreviews', 'reviewed original on-hold successor', async label => {
        await useEdition(topology.editionId); await nav('corrections');
        const formId = 'correction-form-' + topology.editionId, form = page.locator('form[id="' + formId + '"]');
        await fill(form, 'label', label); await fill(form, 'recordId', receiving.selectedCorrectedTaskId);
        await fill(form, 'otherRecordId', ''); await fill(form, 'path', '/status'); await fill(form, 'action', 'replace');
        await fill(form, 'valueJson', '"on-hold"');
        await fill(form, 'extraPatches', JSON.stringify([{ recordId: receiving.selectedCorrectedTaskId,
          path: '/statusReason', action: Object.hasOwn(sourceResource, 'statusReason') ? 'replace' : 'add',
          valueJson: JSON.stringify({ text: 'The local receiving exercise pauses this referral while its complete source handover is reopened.' }) }]));
        await fill(form, 'reason', 'Explicit local receiving correction of the selected published Task; preserve the complete original source and original in-progress edition.');
        await fill(form, 'note', 'This authored correction belongs to the original local operating exercise.');
        return submit(formId, R + '/corrections/preview');
      });
      need(preview.request.editionId === topology.editionId && preview.request.patches.length === 2,
        'GRAVITY_BROWSER_REVIEWED_PREVIEW_CHANGED');
      await closeDialog();
      const prior = (await state()).referral.corrections.filter(r => r.previewId === preview.id);
      need(prior.length <= 1, 'GRAVITY_BROWSER_CORRECTION_RECONCILIATION_AMBIGUOUS');
      let applied = prior.length ? await record('corrections', prior[0].id) : null;
      if (!applied) {
        await nav('corrections'); const row = rowByLabel(preview.label);
        need(await row.count() === 1, 'GRAVITY_BROWSER_ORIGINAL_PREVIEW_MISSING');
        applied = await response(() => row.getByRole('button', { name: 'Apply reviewed preview', exact: true }).click(), R + '/corrections/apply');
      }
      need(applied.previewId === preview.id && applied.sourceEditionId === topology.editionId,
        'GRAVITY_BROWSER_CORRECTION_SOURCE_CHANGED');
      const taskId = applied.recordMap[receiving.selectedCorrectedTaskId];
      need(SHA.test(taskId), 'GRAVITY_BROWSER_CORRECTED_TASK_MAP_REQUIRED');
      const actual = await nativeJSON(url, '/api/sources/' + applied.sourceId + '/rows/' + taskId);
      const after = JSON.parse(actual.jsonText);
      need(after.id === sourceResource.id && after.status === 'on-hold' && after.statusReason?.text,
        'GRAVITY_BROWSER_CORRECTED_RESOURCE_NOT_RECEIVED');
      const comparison = await actualRecord('comparisons', 'complete original receiving correction', async label => {
        await nav('corrections'); const form = page.locator('#edition-compare-form');
        await fill(form, 'label', label); await fill(form, 'beforeId', topology.editionId);
        await fill(form, 'afterId', applied.editionId); await fill(form, 'note', 'Compare the exact original cohort with the reviewed two-field Task successor.');
        return submit('edition-compare-form', R + '/edition-comparisons');
      });
      await screen('07-original-correction-and-complete-comparison');
      return { id: applied.id, previewId: preview.id, editionId: applied.editionId,
        sourceId: applied.sourceId, taskId, comparisonId: comparison.id, summary: comparison.summary };
    });

    const assessment = await phase('complete-successor-queue-and-native-observations', async () => {
      const saved = await actualRecord('assessments', 'full receiving successor assessment', async label => {
        await useEdition(corrected.editionId); await nav('queue');
        const form = page.locator('#assess-form');
        await fill(form, 'label', label); await fill(form, 'editionId', corrected.editionId);
        await fill(form, 'reviewId', review.id);
        await fill(form, 'note', 'Complete original cohort and all24 source fields under the saved81row review, exact source-hosted topology and reviewed successor.');
        return submit('assess-form', R + '/assessments');
      });
      need(saved.editionId === corrected.editionId && saved.reviewId === review.id &&
        saved.summary.tasks === topology.taskIds.length, 'GRAVITY_BROWSER_COMPLETE_ASSESSMENT_CHANGED');
      await openSaved('assessments', saved.id, 'queue');
      const packet = await download('authored-assessment',
        () => page.getByRole('button', { name: 'Download complete assessment', exact: true }).click(),
        'Gravity_Complete_Browser_Assessment.json');
      const value = JSON.parse(await regular(packet.file, 64 * 1024 * 1024));
      need(value.tasks.length === topology.taskIds.length && value.cells.length === topology.taskIds.length * 24,
        'GRAVITY_BROWSER_FULL_ASSESSMENT_FILE_REQUIRED');
      await screen('08-complete-receiving-referral-queue');
      return { id: saved.id, sourceId: saved.sourceId, editionId: saved.editionId,
        taskCount: value.tasks.length, cellCount: value.cells.length, packet };
    });

    const exchanged = await phase('reopen-original-complete-exchange-and-source-history', async () => {
      const original = receiving.exchange?.writeOperation;
      need(original?.state === 'complete' && UUID.test(original.id) && SHA.test(original.requestId),
        'GRAVITY_BROWSER_COMPLETED_EXCHANGE_REQUIRED');
      await nav('exchange'); const form = page.locator('#exchange-advance-form');
      await fill(form, 'requestId', original.requestId); await fill(form, 'operationId', original.id);
      const result = await submit('exchange-advance-form', R + '/exchange-requests/' + original.requestId + '/advance');
      need(result.id === original.id && result.state === 'complete' && result.requestSha256 === original.requestSha256 &&
        result.sourceId === original.sourceId, 'GRAVITY_BROWSER_EXCHANGE_REOPEN_CHANGED');
      await closeDialog();
      const row = page.locator('tbody tr').filter({ has: page.getByText(original.id, { exact: true }) });
      need(await row.count() === 1, 'GRAVITY_BROWSER_EXCHANGE_ROW_REQUIRED');
      const packet = await download('original-exchange',
        () => row.getByRole('button', { name: 'All original files', exact: true }).click(),
        'Gravity_Complete_Browser_Original_Exchange.zip');
      const history = receiving.exchange.history;
      need(history?.state === 'complete' && UUID.test(history.operationId) && SHA.test(history.requestId),
        'GRAVITY_BROWSER_ORIGINAL_HISTORY_REQUIRED');
      const sourceForm = page.locator('#source-advance-form');
      await fill(sourceForm, 'requestId', history.requestId); await fill(sourceForm, 'operationId', history.operationId);
      const reopened = await submit('source-advance-form', '/api/requests/' + history.requestId + '/advance');
      need(reopened.operationId === history.operationId && reopened.state === 'complete' && reopened.sourceId === history.sourceId,
        'GRAVITY_BROWSER_HISTORY_REOPEN_CHANGED');
      await screen('09-original-exchange-and-source-history'); await closeDialog();
      return { operationId: result.id, requestId: result.requestId, sourceId: result.sourceId,
        historyOperationId: reopened.operationId, historySourceId: reopened.sourceId, packet };
    });

    const dataset = await phase('native-dataset-query-and-complete-customer-files', async () => {
      await nav('datasets'); const buildId = receiving.buildIds.at(-1);
      const form = page.locator('#dataset-query-form');
      await fill(form, 'buildId', buildId);
      await fill(form, 'query', '{"limit":"5","sort":"resource_id","fields":"resource_type,resource_id,resource_json"}');
      const query = await response(() => form.locator('button[type="submit"]').click(),
        '/api/builds/' + buildId + '/query', { method: 'GET' });
      need(query.response?.status === 200, 'GRAVITY_BROWSER_NATIVE_QUERY_FAILED');
      const queryFile = await save('BROWSER_NATIVE_QUERY.json', query);
      await screen('10-complete-native-query'); await closeDialog();
      const row = page.locator('tbody tr').filter({ has: page.getByText(buildId.slice(0, 12), { exact: true }) });
      need(await row.count() === 1, 'GRAVITY_BROWSER_NATIVE_BUILD_REQUIRED');
      const customer = await download('customer-dataset',
        () => row.getByRole('button', { name: 'Complete customer packet', exact: true }).click(),
        'Gravity_Complete_Customer_Dataset.zip');
      const merchant = await download('native-merchant-dataset',
        () => row.getByRole('button', { name: 'Native merchant files', exact: true }).click(),
        'Gravity_Complete_Native_Merchant_Dataset.zip');
      return { buildId, query: queryFile, customer, merchant };
    });

    const handoff = await phase('full-frozen-handoff-and-actual-downloaded-file-receipt', async row => {
      const selected = await actualRecord('handoffs', 'complete browser referral handoff', async label => {
        await nav('receiving'); const form = page.locator('#handoff-form');
        await fill(form, 'label', label); await fill(form, 'editionId', corrected.editionId);
        await fill(form, 'assessmentId', assessment.id);
        await fill(form, 'receiver', 'Original local Gravity browser receiving workspace');
        await fill(form, 'purpose', 'Reopen the complete source, authored topology, reviewed referral and original native files.');
        await fill(form, 'scope', 'complete-workspace');
        await fill(form, 'note', 'Complete original application data and source-native receiving history retained for the explicit local recipient.');
        return submit('handoff-form', R + '/handoffs');
      });
      await nav('receiving'); const savedRow = rowByLabel(selected.label);
      need(await savedRow.count() === 1, 'GRAVITY_BROWSER_HANDOFF_REQUIRED');
      const packet = await download('authored-handoff',
        () => savedRow.getByRole('button', { name: 'Complete editable handoff', exact: true }).click(),
        'Gravity_Complete_Referral_Handoff.zip');
      if (!row.receiptFile) {
        row.receiptFile = await save('ACTUAL_BROWSER_HANDOFF_RECEIPT.json', {
          schema: 'stellar-forge.gravity-referral-browser-file-receipt.v1',
          operation: row.operationId, receivedAt: now(), workspaceId: receiving.workspaceId,
          handoffId: selected.id, receiver: 'Original local browser download destination',
          originalCompleteFile: packet, method: 'Actual private operator download and complete saved-byte SHA-256',
        });
        await checkpoint();
      }
      await sameFile(row.receiptFile);
      let artifact = (await state()).artifacts.find(item => item.id === row.receiptFile.sha256);
      if (!artifact) {
        const form = page.locator('#receiving-artifact-form');
        await fill(form, 'label', labelFor('actual complete handoff download'));
        await form.locator('[name="file"]').setInputFiles(row.receiptFile.file);
        artifact = await submit('receiving-artifact-form', '/api/artifacts');
      }
      need(artifact.id === row.receiptFile.sha256 && artifact.bytes === row.receiptFile.bytes,
        'GRAVITY_BROWSER_ORIGINAL_RECEIPT_CHANGED');
      const received = await actualRecord('receivings', 'actual original handoff download', async label => {
        await nav('receiving'); const form = page.locator('#receiving-result-form');
        await fill(form, 'label', label); await fill(form, 'handoffId', selected.id);
        await fill(form, 'receiver', 'Original local browser download destination');
        await fill(form, 'state', 'received'); await fill(form, 'artifactId', artifact.id);
        await fill(form, 'destinationObjectId', packet.file); await fill(form, 'operationId', row.operationId);
        await fill(form, 'receivedAt', row.startedAt);
        await fill(form, 'note', 'The full handoff archive was downloaded and its complete bytes hashed locally. The complete editable workspace is received and reopened in the following native UI phase.');
        return submit('receiving-result-form', R + '/receivings');
      });
      need(received.operationId === row.operationId && received.handoffId === selected.id &&
        received.artifactId === artifact.id, 'GRAVITY_BROWSER_RECEIVING_IDENTITY_CHANGED');
      const exportForm = page.locator('#export-prepare-form');
      await fill(exportForm, 'kind', 'assessment'); await fill(exportForm, 'id', assessment.id);
      await fill(exportForm, 'label', labelFor('complete retained assessment delivery'));
      const prepared = await submit('export-prepare-form', R + '/exports');
      need(prepared.artifact?.id && prepared.artifact.bytes > 0, 'GRAVITY_BROWSER_NATIVE_FILE_DESCRIPTOR_REQUIRED');
      await screen('11-complete-handoff-and-file-receiving'); await closeDialog();
      return { id: selected.id, packet, receivingId: received.id, artifactId: artifact.id,
        preparedArtifactId: prepared.artifact.id, receiptFile: row.receiptFile };
    });

    const guidance = await phase('complete-original-source-guidance-receiving', async () => {
      await nav('guidance');
      const packet = await download('source-guidance',
        () => page.getByRole('button', { name: 'Download every original source file and index', exact: true }).click(),
        'Gravity_Complete_Original_Source.json');
      const source = JSON.parse(await regular(packet.file, 16 * 1024 * 1024));
      need(Array.isArray(source.files) && source.files.length === 191 &&
        source.files.every(file => typeof file.content === 'string' && SHA.test(file.sha256)),
        'GRAVITY_BROWSER_COMPLETE_SOURCE_GUIDANCE_REQUIRED');
      for (const file of source.files) {
        const bytes = Buffer.from(file.content, 'utf8');
        need(bytes.length === file.bytes && createHash('sha256').update(bytes).digest('hex') === file.sha256,
          'GRAVITY_BROWSER_SOURCE_GUIDANCE_BYTES_CHANGED', file.path);
      }
      await screen('12-complete191-file-guidance');
      return { packet, originalFiles: source.files.length };
    });

    const receivedWorkspace = await phase('complete-editable-ui-receive-and-native-reopen', async row => {
      await nav('receiving');
      const expected = await state();
      if (!row.expectedFile) { row.expectedFile = await save('FULL_WORKSPACE_BEFORE_BROWSER_EXPORT.json', expected); await checkpoint(); }
      const frozen = JSON.parse(await regular(row.expectedFile.file, 64 * 1024 * 1024));
      const packet = await download('workspace',
        () => page.getByRole('button', { name: 'Download complete editable workspace', exact: true }).click(),
        'Gravity_Complete_Editable_Workspace.zip');
      const target = absolute(join(output, 'received-workspace'));
      child = await startOriginalOperator(target);
      if (!row.initialWorkspaceId) { row.initialWorkspaceId = child.startup.workspaceId; await checkpoint(); }
      need([row.initialWorkspaceId, receiving.workspaceId].includes(child.startup.workspaceId),
        'GRAVITY_BROWSER_RECEIVING_TARGET_CHANGED');
      receivingPage = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1080 } });
      receivingPage.on('pageerror', onError);
      await receivingPage.goto(child.startup.url); await gravityBrowserReady(receivingPage);
      const current = await nativeJSON(child.startup.url, '/api/state');
      if (current.workspaceId !== receiving.workspaceId) {
        need(current.sources.length === 0 && current.builds.length === 0 && current.artifacts.length === 0 &&
          current.referral.editions.length === 0, 'GRAVITY_BROWSER_EMPTY_RECEIVER_REQUIRED');
        await nav('receiving', receivingPage);
        const form = receivingPage.locator('#workspace-receive-form');
        await fill(form, 'kind', 'workspace');
        await form.locator('[name="file"]').setInputFiles(packet.file);
        const actual = await submit('workspace-receive-form', R + '/workspace/packet', { target: receivingPage });
        need(actual.workspaceId === receiving.workspaceId, 'GRAVITY_BROWSER_RECEIVED_WORKSPACE_ID_CHANGED');
        row.importResult = actual; await checkpoint();
      } else {
        retainsOriginals(current, receiving, 'same original UI receiving continuation');
        const imported = current.referral.receives.filter(item => item.archiveSha256 === packet.sha256);
        need(imported.length === 1 && imported[0].state === 'complete', 'GRAVITY_BROWSER_RECEIVING_ARCHIVE_NOT_RECONCILED');
        row.importResult ??= imported[0]; await checkpoint();
      }
      const actual = await originalGravityState(child.startup.url, receiving, { workspace: target });
      const collectionCounts = {};
      for (const [key, rows] of Object.entries(frozen.referral)) {
        if (!Array.isArray(rows) || key === 'receives') continue;
        const ids = new Set(actual.referral[key].map(item => item.id));
        need(rows.every(item => ids.has(item.id)), 'GRAVITY_BROWSER_AUTHORED_REFERRAL_NOT_RECEIVED', key);
        collectionCounts[key] = actual.referral[key].length;
      }
      for (const key of ['sources', 'plans', 'builds', 'artifacts', 'connections', 'discoveries']) {
        const ids = new Set((actual[key] ?? []).map(item => item.id));
        need((frozen[key] ?? []).every(item => ids.has(item.id)),
          'GRAVITY_BROWSER_AUTHORED_NATIVE_RECORD_NOT_RECEIVED', key);
        collectionCounts[key] = (actual[key] ?? []).length;
      }
      for (const [kind, id] of [['configurations', topology.configurationId], ['editions', topology.editionId],
        ['reviews', review.id], ['decisions', decision.id], ['corrections', corrected.id],
        ['editions', corrected.editionId], ['assessments', assessment.id], ['handoffs', handoff.id],
        ['receivings', handoff.receivingId]]) {
        const original = await record(kind, id);
        const reopened = await nativeJSON(child.startup.url, R + '/records/' + kind + '/' + id);
        need(JSON.stringify(original) === JSON.stringify(reopened), 'GRAVITY_BROWSER_COMPLETE_AUTHORED_BODY_CHANGED', kind + '/' + id);
      }
      await receivingPage.locator('#operator-actor').fill(ACTOR);
      await receivingPage.locator('#operator-actor').dispatchEvent('change');
      await nav('queue', receivingPage);
      await receivingPage.screenshot({ path: join(output, '13-received-original-and-authored-workspace.png'), fullPage: true });
      journal.screens['13-received-original-and-authored-workspace'] =
        await fileIdentity(join(output, '13-received-original-and-authored-workspace.png'));
      await receivingPage.close(); receivingPage = null; await child.close(); child = null;

      child = await startOriginalOperator(target, receiving.workspaceId);
      receivingPage = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1080 } });
      receivingPage.on('pageerror', onError);
      await receivingPage.goto(child.startup.url); await gravityBrowserReady(receivingPage);
      const reopened = await originalGravityState(child.startup.url, receiving, { workspace: target });
      need(reopened.referral.editions.some(item => item.id === corrected.editionId) &&
        reopened.referral.handoffs.some(item => item.id === handoff.id) &&
        reopened.referral.receivings.some(item => item.id === handoff.receivingId),
        'GRAVITY_BROWSER_SECOND_NATIVE_REOPEN_FAILED');
      await nav('receiving', receivingPage);
      await receivingPage.screenshot({ path: join(output, '14-native-reopened-complete-receiving.png'), fullPage: true });
      journal.screens['14-native-reopened-complete-receiving'] =
        await fileIdentity(join(output, '14-native-reopened-complete-receiving.png'));
      await receivingPage.close(); receivingPage = null; await child.close(); child = null;
      return { workspace: target, workspaceId: receiving.workspaceId, archive: packet,
        initialWorkspaceId: row.initialWorkspaceId, received: row.importResult,
        completeCollections: collectionCounts, reopened: true,
        stateFile: await save('RECEIVED_WORKSPACE_AFTER_NATIVE_REOPEN.json', reopened) };
    });

    await phase('compact-browser-and-original-operator-reopen', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await nav('queue');
      await screen('15-compact-referral-queue');
      await page.setViewportSize({ width: 1440, height: 1080 });
      await page.reload(); await gravityBrowserReady(page);
      const reopened = await state();
      need(reopened.referral.editions.some(item => item.id === corrected.editionId) &&
        reopened.referral.reviews.some(item => item.id === review.id),
        'GRAVITY_BROWSER_AUTHORING_LOST_ON_RELOAD');
      await screen('16-original-operator-reopened');
      return { workspaceId: reopened.workspaceId, originalAndAuthoredRecordsRetained: true };
    });
    const finalWorkspace = await state();
    const result = { schema: SCHEMA, operation: OPERATION, completedAt: now(), binding,
      workspace, workspaceId: receiving.workspaceId, sourceRoot: resolve(HERE, '..'),
      originalReceiving: journal.observations.receiving, nativeOperation: receiving.operation,
      originals, review, topology, decision, correction: corrected, assessment, exchange: exchanged,
      dataset, handoff, guidance, receivedWorkspace, finalWorkspace,
      workspacePacket: journal.downloads.workspace, downloads: journal.downloads,
      screens: journal.screens, responses: journal.responses, browserErrors: errors,
      phases: journal.phases.map(row => ({ key: row.key, startedAt: row.startedAt,
        completedAt: row.completedAt, operationId: row.operationId, state: row.state })),
      journey: journalPath };
    need(errors.length === 0, 'GRAVITY_BROWSER_SCRIPT_FAILED', JSON.stringify(errors));
    await saveJSON(resultPath, result, true);
    journal.completedAt = result.completedAt; await checkpoint();
    return result;
  } catch (error) {
    if (journal) {
      journal.failures.push({ at: now(), step: journal.activeStep?.message,
        code: error.code ?? null, message: error.message });
      await checkpoint().catch(() => {});
    }
    throw error;
  } finally {
    if (receivingPage) await receivingPage.close().catch(() => {});
    if (child) await child.close().catch(() => {});
    page.off('pageerror', onError); await lease.close();
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    process.stdout.write('Operate the complete original Gravity UI and receive its full editable archive.\n' +
      'node operate_browser.mjs --url ORIGINAL_PRIVATE_OPERATOR_URL --receiving ABS/OPERATED_GRAVITY_REFERRAL.json ' +
      '--output ABS_BROWSER_OUTPUT [--workspace RECEIVED_PRIVATE_WORKSPACE] [--chromium ABS_CHROMIUM] [--playwright ABS_PLAYWRIGHT_MODULE]\n');
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    need(['--url', '--receiving', '--output', '--workspace', '--chromium', '--playwright'].includes(key) &&
      value && !value.startsWith('--') && !Object.hasOwn(options, key),
      'GRAVITY_BROWSER_ARGUMENTS', 'Use the documented exact receiving and current private operator.');
    options[key] = key === '--url' ? value : absolute(value);
  }
  for (const key of ['--url', '--receiving', '--output'])
    need(options[key], 'GRAVITY_BROWSER_ARGUMENT_REQUIRED', key + ' is required.');
  need(Number(process.versions.node.split('.')[0]) >= 22, 'GRAVITY_BROWSER_NODE_REQUIRED');
  const receiving = originalGravityReceiving(JSON.parse(await regular(options['--receiving'], 64 * 1024 * 1024)));
  const selectedWorkspace = options['--workspace'] ?? receiving.workspace;
  const native = await originalGravityState(options['--url'], receiving, { workspace: selectedWorkspace });
  let playwright;
  if (options['--playwright']) playwright = await import(pathToFileURL(options['--playwright']).href);
  else {
    try { playwright = await import('playwright'); }
    catch {
      need(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'GRAVITY_BROWSER_PLAYWRIGHT_REQUIRED');
      playwright = createRequire(import.meta.url)(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
    }
  }
  const browser = await playwright.chromium.launch({
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(options['--chromium'] ? { executablePath: options['--chromium'] } : {}),
  });
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1080 } });
    const page = await context.newPage();
    const result = await operateGravityBrowser({ page, browser, receiving, native,
      output: options['--output'], workspace: selectedWorkspace, url: options['--url'] });
    process.stdout.write(JSON.stringify({ operation: result.operation, state: 'complete',
      workspaceId: result.workspaceId, result: join(options['--output'], 'OPERATED_GRAVITY_BROWSER.json'),
      screenshots: Object.keys(result.screens).length, completeFiles: Object.keys(result.downloads).length,
      receivedWorkspace: result.receivedWorkspace.workspace, nativeReopened: result.receivedWorkspace.reopened }) + '\n');
  } finally { await browser.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'GRAVITY_BROWSER', message: error.message }) + '\n');
    process.exitCode = 1;
  });
