#!/usr/bin/env node
// MIT. The original merchant customer through saved Applications and the same console.
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { openRuntimeWorkspace } from '../../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import { absolute, need, digest, json, regular, privateDirectory, operationLease, readJSON, saveJSON } from '../../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { inspectMerchantConsoleDirectory } from '../console/managed.mjs';
import { receiveConsole } from './console-journey.mjs';

const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const SCHEMA = 'stellar-forge.merchant-console-applications-receiving.v1';
const finalPhase = run => run && !run.active && ['FAILED', 'CANCELLED', 'SUCCEEDED'].includes(run.phase);
async function waitFor(model, applicationId, predicate, description, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const application = (await model.applicationsState({ historyLimit: 30 })).applications
      .find(item => item.id === applicationId);
    need(application, 'MERCHANT_CONSOLE_RECEIVING_APPLICATION_MISSING');
    if (predicate(application)) return application;
    need(Date.now() - started < timeoutMs, 'MERCHANT_CONSOLE_RECEIVING_WAIT_EXPIRED',
      description + ' remains with its original application ' + applicationId + '.');
    await pause(250);
  }
}
async function responseBytes(session, path, token, maximum) {
  const response = await fetch(new URL('/operator/api/' + path, session.url), {
    headers: { authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  need(response.ok, 'MERCHANT_CONSOLE_RECEIVING_RESPONSE', 'Original console returned HTTP ' + response.status + '.');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength; need(total <= maximum, 'MERCHANT_CONSOLE_RECEIVING_RESPONSE_LIMIT');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

/** Receive completed original calls/files again without executing or creating them. */
async function receiveRetainedCustomer({ original, directory, openSession, record, persist,
  chromiumPath, playwrightModule, environment }) {
  need(original.schema === 'stellar-forge.merchant-operator-console-native-receiving.v1' &&
    original.result === 'PASS' && Array.isArray(original.calls) && Array.isArray(original.customerFiles) &&
    original.customer?.archiveSha256 && original.profileArchive?.sha256,
  'MERCHANT_CONSOLE_RECEIVING_ORIGINAL_REQUIRED');
  const profileBytes = await regular(join(directory, 'console-profile.json'), 32 * 1024 * 1024);
  need(digest(profileBytes) === original.profileArchive.sha256, 'MERCHANT_CONSOLE_RECEIVING_PROFILE_CHANGED');
  const packet = JSON.parse(profileBytes.toString('utf8'));
  need(packet.profile?.id && Array.isArray(packet.calls), 'MERCHANT_CONSOLE_RECEIVING_PROFILE_CHANGED');
  const token = environment.MCP_ACCESS_TOKEN;
  const { chromium } = createRequire(import.meta.url)(playwrightModule);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: chromiumPath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (let index = 0; index < 3; index++) {
      if (record.sessions[index]?.received && record.sessions[index]?.stopped) continue;
      const imported = index === 2;
      const session = await openSession({
        configPath: original.configuration, port: 0, environment,
        consoleDirectory: join(directory, imported ? 'imported-console' : 'console'),
        receivingIndex: index,
      });
      const cycle = record.sessions[index];
      let page;
      try {
        const host = JSON.parse((await responseBytes(session, 'host', token, 4 * 1024 * 1024)).toString('utf8'));
        need(host.console?.workspaceId === cycle.startup.workspaceId &&
          host.configurationFingerprint === original.coldHost.configurationFingerprint &&
          host.operator?.closing === false, 'MERCHANT_CONSOLE_RECEIVING_HOST_CHANGED');
        const profile = JSON.parse((await responseBytes(session, 'profile/' + encodeURIComponent(packet.profile.id),
          token, 32 * 1024 * 1024)).toString('utf8'));
        need(profile.calls.length === original.calls.length, 'MERCHANT_CONSOLE_RECEIVING_CALLS_CHANGED');
        const calls = [];
        for (const expected of original.calls) {
          const retained = profile.calls.find(call => call.id === expected.id);
          need(retained?.state === 'COMPLETE' && retained.custody === (imported ? 'IMPORTED' : 'LOCAL') &&
            retained.resultSha256 === expected.resultSha256, 'MERCHANT_CONSOLE_RECEIVING_CALL_CHANGED');
          const bytes = await responseBytes(session, 'result/' + encodeURIComponent(expected.id), token, 64 * 1024 * 1024);
          need(digest(bytes) === expected.resultSha256, 'MERCHANT_CONSOLE_RECEIVING_RETURN_CHANGED');
          calls.push({ id: expected.id, sha256: expected.resultSha256, bytes: bytes.length });
        }
        const files = [];
        let archive;
        if (!imported) {
          for (const expected of original.customerFiles) {
            const bytes = await responseBytes(session, 'customer-file/' + encodeURIComponent(original.customer.id) +
              '?file=' + encodeURIComponent(expected.name), token, expected.bytes);
            need(bytes.length === expected.bytes && digest(bytes) === expected.sha256,
              'MERCHANT_CONSOLE_RECEIVING_CUSTOMER_CHANGED');
            files.push({ name: expected.name, bytes: bytes.length, sha256: expected.sha256 });
          }
          const bytes = await responseBytes(session, 'customer-archive/' + encodeURIComponent(original.customer.id),
            token, original.customer.archiveBytes);
          need(bytes.length === original.customer.archiveBytes && digest(bytes) === original.customer.archiveSha256,
            'MERCHANT_CONSOLE_RECEIVING_ARCHIVE_CHANGED');
          archive = { bytes: bytes.length, sha256: original.customer.archiveSha256 };
        }
        page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
        page.setDefaultTimeout(15000);
        const browserErrors = [];
        page.on('pageerror', error => browserErrors.push(error.message));
        await page.goto(session.consoleUrl, { waitUntil: 'networkidle' });
        await page.locator('#access-token').fill(token);
        await page.locator('#connect-form button[type=submit]').click();
        await page.locator('#connected').waitFor({ state: 'visible' });
        await page.locator('#profiles').selectOption(packet.profile.id);
        await page.locator('[data-page=requests]').click();
        need(await page.evaluate(() => localStorage.length + sessionStorage.length) === 0,
          'MERCHANT_CONSOLE_RECEIVING_BROWSER_STORAGE');
        const screenshots = [];
        const screenshot = async name => {
          const path = join(directory, name);
          await page.screenshot({ path, fullPage: true, animations: 'disabled' });
          const bytes = await regular(path, 16 * 1024 * 1024);
          screenshots.push({ name, bytes: bytes.length, sha256: digest(bytes) });
        };
        await screenshot('console-applications-' + index + '-requests.png');
        if (index === 0) {
          await page.locator('[data-page=customers]').click();
          await page.locator('#refresh-customers').click();
          await page.locator('#customer-list button').first().click();
          await page.locator('#download-customer').waitFor({ state: 'visible' });
          await page.setViewportSize({ width: 390, height: 844 });
          need(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            'MERCHANT_CONSOLE_RECEIVING_VIEWPORT');
          await screenshot('console-applications-customer-mobile.png');
        }
        need(browserErrors.length === 0, 'MERCHANT_CONSOLE_RECEIVING_BROWSER_ERROR', browserErrors.join('; '));
        cycle.received = { completedAt: new Date().toISOString(), custody: imported ? 'IMPORTED' : 'LOCAL',
          workspaceId: host.console.workspaceId, profileId: packet.profile.id, calls, files,
          ...(archive ? { archive } : {}), screenshots };
        await persist();
      } finally { await page?.close(); await session.close(); }
    }
  } finally { await browser?.close(); }
}

/**
 * Continue the existing complete customer, or put its first original receiving
 * journey through Applications. Each accepted application/run ID is retained.
 */
export async function receiveMerchantConsoleApplications({
  runtimeWorkspaceDirectory, runtimeId, directory, chromiumPath, playwrightModule,
  sourceCommit, timeoutMs = 120000,
} = {}) {
  for (const path of [runtimeWorkspaceDirectory, directory, chromiumPath, playwrightModule]) absolute(path);
  need(/^[a-f0-9]{24}$/.test(runtimeId ?? ''), 'MERCHANT_CONSOLE_RECEIVING_RUNTIME_REQUIRED');
  need(/^[a-f0-9]{40}$/.test(sourceCommit ?? ''), 'MERCHANT_CONSOLE_RECEIVING_SOURCE_REQUIRED');
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000, 'MERCHANT_CONSOLE_RECEIVING_TIMEOUT');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await privateDirectory(directory);
  const lease = await operationLease(join(directory, 'console-applications-receiving.lock'));
  const recordPath = join(directory, 'console-applications-receiving.json');
  const environmentFile = join(directory, 'console-applications-environment.json');
  const input = { runtimeWorkspaceDirectory, runtimeId, directory, chromiumPath, playwrightModule, sourceCommit };
  const environment = { ...process.env,
    MCP_ACCESS_TOKEN: 'merchant-console-native-receiving-' + digest(directory).slice(0, 40) };
  let model, record; const opened = new Set();
  try {
    record = await readJSON(recordPath, true);
    if (record) need(record.schema === SCHEMA && JSON.stringify(record.input) === JSON.stringify(input),
      'MERCHANT_CONSOLE_RECEIVING_INPUT_CHANGED');
    else {
      const prior = await readJSON(join(directory, 'console-native-run.json'), true);
      record = { schema: SCHEMA, operationId: 'SCF-MERCHANT-CONSOLE-APPLICATIONS-E9B2-20261012',
        input, createdAt: new Date().toISOString(), mode: prior?.result === 'PASS' ? 'retained-customer' : 'original-customer',
        applications: [], sessions: [] };
      await saveJSON(recordPath, record);
    }
    if (record.completedAt) return { ...record, recordPath, reused: true };
    const persist = async () => { await saveJSON(recordPath, record, true); };
    const privateEnvironment = { MCP_ACCESS_TOKEN: environment.MCP_ACCESS_TOKEN };
    const priorEnvironment = await readJSON(environmentFile, true);
    if (priorEnvironment) need(JSON.stringify(priorEnvironment) === JSON.stringify(privateEnvironment),
      'MERCHANT_CONSOLE_RECEIVING_ENVIRONMENT_CHANGED');
    else await saveJSON(environmentFile, privateEnvironment);
    model = await openRuntimeWorkspace({ directory: runtimeWorkspaceDirectory });
    let position = 0;
    const openSession = async options => {
      const index = options.receivingIndex ?? position++;
      need(index >= 0 && index < 3 && Number.isInteger(index), 'MERCHANT_CONSOLE_RECEIVING_SESSION_LIMIT');
      const configPath = absolute(options.configPath), consoleDirectory = absolute(options.consoleDirectory);
      need(options.port === 0 && options.environment.MCP_ACCESS_TOKEN === environment.MCP_ACCESS_TOKEN,
        'MERCHANT_CONSOLE_RECEIVING_SELECTION_CHANGED');
      let application = record.applications.find(item => item.configPath === configPath && item.consoleDirectory === consoleDirectory);
      if (!application) {
        application = { configPath, consoleDirectory, saveRequestId: randomUUID() };
        record.applications.push(application); await persist();
      }
      if (!application.reviewId) {
        const review = await model.applicationsReview({ runtimeId, kind: 'merchant-console',
          label: consoleDirectory.endsWith('imported-console') ? 'Imported merchant operations' : 'Merchant customer operations',
          settings: { configurationFile: configPath, consoleDirectory, tokenEnv: 'MCP_ACCESS_TOKEN', environmentFile, port: 0 } });
        application.reviewId = review.id; await persist();
      }
      if (!application.applicationId) {
        const saved = await model.applicationsSave({ requestId: application.saveRequestId, reviewId: application.reviewId });
        need(saved.saved === true && saved.applicationId, 'MERCHANT_CONSOLE_RECEIVING_SAVE_FAILED');
        application.applicationId = saved.applicationId; application.revision = saved.revision; await persist();
        if (saved.connectionError) throw Object.assign(new Error(saved.connectionError.message), saved.connectionError);
      }
      await model.applicationsConnect({ applicationId: application.applicationId });
      const connected = await waitFor(model, application.applicationId, app => Boolean(app.release), 'Original runtime adoption', timeoutMs);
      application.release = connected.release;
      let cycle = record.sessions[index];
      if (!cycle) {
        const review = await model.applicationsStartReview({ applicationId: application.applicationId });
        cycle = { applicationId: application.applicationId, requestId: randomUUID(), reviewId: review.id,
          configPath, consoleDirectory };
        record.sessions[index] = cycle; await persist();
      }
      need(cycle.applicationId === application.applicationId && cycle.configPath === configPath &&
        cycle.consoleDirectory === consoleDirectory && !cycle.stopped, 'MERCHANT_CONSOLE_RECEIVING_SESSION_CHANGED',
      'Continue the retained customer operation at ' + cycle.requestId + '.');
      const current = (await model.applicationsState({ historyLimit: 30 })).applications
        .find(item => item.id === application.applicationId);
      const prior = current?.runs.find(run => run.id === cycle.requestId);
      if (prior) {
        need(!finalPhase(prior), 'MERCHANT_CONSOLE_RECEIVING_OPERATION_ENDED',
          'The original application run ended before receiving completed: ' + cycle.requestId);
        if (!prior.active) await model.applicationsRecover({ applicationId: application.applicationId, operationId: cycle.requestId });
      } else await model.applicationsStart({
        applicationId: application.applicationId, requestId: cycle.requestId, reviewId: cycle.reviewId,
      });
      const active = await waitFor(model, application.applicationId, app => {
        const run = app.runs.find(item => item.id === cycle.requestId);
        need(!finalPhase(run), 'MERCHANT_CONSOLE_RECEIVING_START_FAILED', 'Original run ended before Open: ' + cycle.requestId);
        return Boolean(run?.active && run.privateUrl && run.url?.original);
      }, 'Original merchant console startup', timeoutMs);
      const run = active.runs.find(item => item.id === cycle.requestId), startup = run.url.original;
      need(run.command === 'merchant-mcp' && startup.schema === 'stellar-forge.merchant-console-startup.v1' &&
        startup.binding?.consoleDirectory === consoleDirectory && startup.binding?.configurationFile === configPath,
      'MERCHANT_CONSOLE_RECEIVING_STARTUP_CHANGED');
      const { openUrl, ...retainedStartup } = startup;
      cycle.startup = retainedStartup; await persist();
      let closing;
      const session = { url: startup.mcpUrl, consoleUrl: startup.consoleUrl,
        close: () => {
          if (closing) return closing;
          closing = (async () => {
            cycle.stopRequestedAt ??= new Date().toISOString(); await persist();
            await model.applicationsStop({ applicationId: application.applicationId, operationId: cycle.requestId });
            const stopped = await waitFor(model, application.applicationId, app =>
              finalPhase(app.runs.find(item => item.id === cycle.requestId)), 'Original merchant console Stop', timeoutMs);
            const final = stopped.runs.find(item => item.id === cycle.requestId);
            need(final.phase === 'SUCCEEDED' && final.result?.state !== 'LAUNCH_FAILED',
              'MERCHANT_CONSOLE_RECEIVING_STOP_FAILED');
            const retained = await inspectMerchantConsoleDirectory(consoleDirectory);
            need(retained.workspaceId === startup.workspaceId, 'MERCHANT_CONSOLE_RECEIVING_REOPEN_CHANGED');
            cycle.stopped = { at: new Date().toISOString(), phase: final.phase,
              state: final.result?.state, workspaceId: retained.workspaceId };
            await persist(); opened.delete(session);
          })().catch(error => { closing = undefined; throw error; });
          return closing;
        } };
      opened.add(session); return session;
    };
    const prior = await readJSON(join(directory, 'console-native-run.json'), true);
    if (record.mode === 'retained-customer') {
      await receiveRetainedCustomer({ original: prior, directory, openSession, record, persist,
        chromiumPath, playwrightModule, environment });
      record.original = { operationId: prior.operationId, sourceCommit: prior.sourceCommit,
        completedAt: prior.completedAt, reportSha256: digest(await regular(join(directory, 'console-native-run.json'), 16 * 1024 * 1024)) };
    } else {
      const result = await receiveConsole({ directory, chromiumPath, playwrightModule, sourceCommit, openSession });
      need(result.result === 'PASS' && record.sessions.length === 3,
        'MERCHANT_CONSOLE_RECEIVING_ORIGINAL_INCOMPLETE');
      record.original = { operationId: result.operationId, sourceCommit: result.sourceCommit,
        completedAt: result.completedAt, reportSha256: digest(await regular(join(directory, 'console-native-run.json'), 16 * 1024 * 1024)) };
    }
    need(record.sessions.length === 3 && record.sessions.every(item => item.stopped) &&
      record.sessions[0].startup.workspaceId === record.sessions[1].startup.workspaceId &&
      record.sessions[0].startup.binding.instanceId !== record.sessions[1].startup.binding.instanceId &&
      record.sessions[0].startup.workspaceId !== record.sessions[2].startup.workspaceId,
    'MERCHANT_CONSOLE_RECEIVING_LIFECYCLE_INCOMPLETE');
    record.completedAt = new Date().toISOString(); record.result = 'PASS'; await persist();
    return { ...record, recordPath };
  } finally {
    await Promise.allSettled([...opened].map(session => session.close()));
    await model?.close(); await lease.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const values = process.argv.slice(2), flags = new Map();
  if (values.includes('--help')) process.stdout.write(
    'Usage: starforge merchant-console-application-receive --runtime-workspace ABS --runtime-id ID --directory ORIGINAL_RECEIVING_DIR --chromium ABS --playwright-module ABS --source-commit SHA\n');
  else {
    const allowed = new Set(['--runtime-workspace', '--runtime-id', '--directory', '--chromium', '--playwright-module', '--source-commit']);
    try {
      need(values.length % 2 === 0, 'MERCHANT_CONSOLE_RECEIVING_ARGUMENTS');
      for (let index = 0; index < values.length; index += 2) {
        need(allowed.has(values[index]) && !flags.has(values[index]) && values[index + 1],
          'MERCHANT_CONSOLE_RECEIVING_ARGUMENTS');
        flags.set(values[index], values[index + 1]);
      }
      await receiveMerchantConsoleApplications({
        runtimeWorkspaceDirectory: flags.get('--runtime-workspace'), runtimeId: flags.get('--runtime-id'),
        directory: flags.get('--directory'), chromiumPath: flags.get('--chromium') ?? process.env.STARFORGE_CHROMIUM,
        playwrightModule: flags.get('--playwright-module') ?? process.env.STARFORGE_PLAYWRIGHT_MODULE,
        sourceCommit: flags.get('--source-commit'),
      }).then(result => process.stdout.write(json(result)));
    } catch (error) {
      process.stderr.write(json({ error: error.code ?? 'MERCHANT_CONSOLE_RECEIVING', message: error.message }));
      process.exitCode = 1;
    }
  }
}
