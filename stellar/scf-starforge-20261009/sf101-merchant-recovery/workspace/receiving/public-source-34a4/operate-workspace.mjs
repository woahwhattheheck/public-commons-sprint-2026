// Actual operator continuation for the retained public-source recovery snapshot.
import { readFile, writeFile, mkdir, access, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'source/stellar/scf-starforge-20261009/sf101-merchant-recovery');
const remoteCli = join(source, 'remote-cli.mjs');
const original = '/dev/shm/scf-remote-recovery-34a4/public-source-operation';
const resultFile = join(here, 'operation-result.json');
const chromiumExecutable = process.argv[2] ?? process.env.SCF_RECOVERY_CHROMIUM ?? '/tmp/chromium';
let report;
try { report = JSON.parse(await readFile(resultFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (report?.status === 'COMPLETE') {
  process.stdout.write(JSON.stringify({ status: 'COMPLETE', alreadyComplete: true, resultFile, snapshotId: report.snapshotId }) + '\n');
} else {
  const retained = JSON.parse(await readFile(join(original, 'operation-result.json'), 'utf8'));
  if (retained.status !== 'COMPLETE') throw new Error('Original public-source operation is not complete');
  const identity = JSON.parse(await readFile(join(original, 'operation-identity.json'), 'utf8'));
  const sdkConfig = JSON.parse(await readFile('/dev/shm/scf101-minio-public-config-34a4.json', 'utf8'));
  const passEnv = 'SCF_PUBLIC_SOURCE_RECOVERY_PASSPHRASE';
  const childEnv = { ...process.env, AWS_ACCESS_KEY_ID: sdkConfig.credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: sdkConfig.credentials.secretAccessKey, [passEnv]: identity.passphrase };
  const redact = text => {
    let value = String(text).replace(/#token=[a-f0-9]{64}/g, '#token=[session]');
    for (const secret of [identity.passphrase, sdkConfig.credentials.accessKeyId, sdkConfig.credentials.secretAccessKey])
      if (secret) value = value.split(secret).join('[private]');
    return value;
  };
  const configFile = join(here, 'host.json'), directory = join(here, 'operator-state');
  const downloads = join(here, 'downloads'), restores = join(here, 'restores');
  for (const path of [downloads, restores]) await mkdir(path, { recursive: true, mode: 0o700 });
  const host = { schema: 'stellar-forge.recovery-workspace.v1', title: 'Merchant recovery',
    profiles: [{ id: 'public-source', label: 'Retained public source', storeConfig: join(original, 'remote.json'),
      operations: join(original, 'operations'), passEnv,
      bundleRoots: [{ id: 'retained', label: 'Original public-source snapshots', directory: original },
        { id: 'received', label: 'Received encrypted snapshots', directory: downloads }],
      downloadRoot: downloads, restoreRoot: restores }] };
  try { await writeFile(configFile, JSON.stringify(host, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (JSON.stringify(JSON.parse(await readFile(configFile, 'utf8'))) !== JSON.stringify(host))
      throw new Error('Retained workspace host configuration differs from its original selection');
  }
  report ??= { schema: 'stellar-forge.recovery-workspace-operation.v1',
    operationId: 'SF101-WORKSPACE-PUBLIC-SOURCE-34A4-20261011',
    sourceCommit: '999edce11e44f11c7b0855cb300438080175ae90',
    originalResult: join(original, 'operation-result.json'), snapshotId: retained.snapshotId,
    startedAt: new Date().toISOString(), steps: [], attempts: 0 };
  report.attempts++; report.status = 'RUNNING'; delete report.error;
  const save = async () => writeFile(resultFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const step = async (name, value) => {
    report.steps.push({ name, at: new Date().toISOString(), result: value }); await save();
    process.stdout.write(JSON.stringify({ step: name, status: value?.status ?? 'COMPLETE' }) + '\n');
  };
  const capture = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [remoteCli, ...args], { cwd: here, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error('Original CLI failed: ' + redact(error.slice(-2000)))));
  });
  let server, browser, page;
  const shutdownServer = () => new Promise(resolve => {
    if (!server || server.exitCode !== null) { resolve(); return; }
    server.once('exit', resolve); server.kill('SIGTERM');
  });
  try {
    await save();
    const playwrightModules = process.env.SCF_RECOVERY_PLAYWRIGHT_MODULES ?? '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules';
    const require = createRequire(join(playwrightModules, 'playwright/package.json'));
    const { chromium } = require('playwright');
    await access(chromiumExecutable);
    const browserFile = await stat(chromiumExecutable);
    if (!browserFile.isFile() || browserFile.size === 0) throw new Error('The selected Chromium executable is empty or not a regular file: ' + chromiumExecutable);
    let stdout = '', stderr = '';
    const started = new Promise((resolve, reject) => {
      server = spawn(process.execPath, [remoteCli, 'workspace', 'serve', '--config', configFile,
        '--directory', directory, '--port', '0'], { cwd: here, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      server.stdout.on('data', chunk => {
        stdout += chunk;
        const url = stdout.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]{64}/)?.[0];
        if (url) resolve(url);
      });
      server.stderr.on('data', chunk => { stderr += chunk; });
      server.once('error', reject);
      server.once('exit', code => reject(new Error('Workspace server exited before launch: ' + code + ' ' + redact(stderr.slice(-2000)))));
    });
    const browserUrl = await started;
    browser = await chromium.launch({ executablePath: chromiumExecutable, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--renderer-process-limit=1'],
      env: { ...process.env, TMPDIR: join(here, 'tmp') }, timeout: 60000 });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'en-US' });
    page = await context.newPage(); page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', error => { errors.push(redact(error.message)); });
    await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#profile').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.getElementById('profile').disabled === false);
    await page.locator('#operation-rows').getByText('public-source-push', { exact: true }).waitFor();
    await step('open original command workspace', { status: 'OPEN', browser: browser.version(),
      chromiumExecutable, chromiumBytes: browserFile.size,
      node: process.version, command: 'merchant-recovery-remote workspace serve',
      workspace: directory, headings: await page.locator('h1,h2').allTextContents() });

    const pushRow = page.locator('#operation-rows tr').filter({ hasText: 'public-source-push' });
    const reviewRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/review' && response.request().method() === 'POST');
    await pushRow.getByRole('button', { name: 'Review continuation', exact: true }).click();
    const originalReview = await (await reviewRead).json();
    if (originalReview.snapshotId !== retained.snapshotId || originalReview.originalStatus !== 'COMPLETE')
      throw new Error('Original completed upload selection differs from the retained result');
    const adoptedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/start');
    await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
    await adoptedResponse;
    await page.waitForFunction(() => [...document.querySelectorAll('#request-list .request')].some(row =>
      row.querySelector('h3')?.textContent === 'public-source-push' && row.querySelector('.badge')?.textContent === 'COMPLETE'));
    await step('adopt original completed upload', { status: 'COMPLETE', operationId: 'public-source-push', snapshotId: originalReview.snapshotId });

    const inventoryResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/inventory');
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click();
    const inventory = await (await inventoryResponse).json();
    if (!inventory.snapshots.some(row => row.snapshotId === retained.snapshotId)) throw new Error('Retained snapshot was not returned by the actual remote store');
    await step('read actual remote inventory', inventory);

    const transfer = async (action, id, destination, stopOnce = false) => {
      const snapshotRow = page.locator('#inventory-rows tr').filter({ hasText: retained.snapshotId });
      await snapshotRow.getByRole('button', { name: action === 'pull' ? 'Download' : 'Restore', exact: true }).click();
      await page.locator('#operation-id').fill(id); await page.locator('#destination').fill(destination);
      if (action === 'restore') {
        await page.getByRole('button', { name: 'Refresh bundles', exact: true }).click();
        await page.locator('#bundle option[value="received/public-source-download"]').waitFor({ state: 'attached' });
        await page.locator('#bundle').selectOption('received/public-source-download');
      }
      const reviewedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/review');
      await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
      const selection = await (await reviewedResponse).json();
      if (selection.error) throw new Error(selection.error.code + ': ' + selection.error.message);
      if (selection.snapshotId !== retained.snapshotId || selection.operationId !== id) throw new Error('Workspace reviewed a different selection');
      await step('review ' + action, { status: 'REVIEWED', selection });
      const startedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/start');
      await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
      const accepted = await (await startedResponse).json();
      if (accepted.error) throw new Error(accepted.error.code + ': ' + accepted.error.message);
      const row = page.locator('#request-list .request').filter({ has: page.locator('h3', { hasText: id }) });
      await row.waitFor();
      if (stopOnce && !report.steps.some(step => step.name === 'request owned download stop')) {
        const stop = row.getByRole('button', { name: 'Stop transfer', exact: true });
        if (await stop.count()) {
          const stoppedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/cancel');
          await stop.click(); const stopped = await (await stoppedResponse).json();
          await step('request owned download stop', { status: 'STOP_REQUESTED', operationId: id, result: stopped });
        }
      }
      await page.waitForFunction(selectedId => {
        const row = [...document.querySelectorAll('#request-list .request')].find(row => row.querySelector('h3')?.textContent === selectedId);
        return row && ['COMPLETE', 'INTERRUPTED', 'FAILED'].includes(row.querySelector('.badge')?.textContent);
      }, id, { timeout: 180000 });
      const phase = await row.locator('.badge').textContent();
      if (phase === 'INTERRUPTED') {
        const resumedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/resume');
        await row.getByRole('button', { name: 'Continue operation', exact: true }).click();
        const continued = await (await resumedResponse).json();
        if (continued.error) throw new Error(continued.error.code + ': ' + continued.error.message);
        await step('continue original download ID', { status: 'CONTINUED', operationId: id, attempts: continued.attempts });
        await page.waitForFunction(selectedId => {
          const row = [...document.querySelectorAll('#request-list .request')].find(row => row.querySelector('h3')?.textContent === selectedId);
          return row && row.querySelector('.badge')?.textContent === 'COMPLETE';
        }, id, { timeout: 180000 });
      }
      const refreshed = await capture(['status', '--operations', join(original, 'operations'), '--id', id]);
      if (refreshed.status !== 'COMPLETE') throw new Error('Original operation did not complete: ' + JSON.stringify(refreshed.lastError ?? refreshed.status));
      await step('complete original ' + action, refreshed);
      return refreshed;
    };
    const pulled = await transfer('pull', 'workspace-public-source-pull', 'public-source-download', true);
    const restored = await transfer('restore', 'workspace-public-source-restore', 'public-source-cold-restore');
    const files = [];
    for (const file of retained.sourceFiles) {
      const data = await readFile(join(restored.destination, 'source', file.name));
      const digest = createHash('sha256').update(data).digest('hex');
      if (digest !== file.sha256) throw new Error('Restored original source bytes differ: ' + file.name);
      files.push({ name: file.name, bytes: data.length, sha256: file.sha256, restoredSha256: digest });
    }
    await step('read restored original public files', { status: 'MATCH', files,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0) });
    await page.getByRole('button', { name: 'Refresh progress', exact: true }).click();
    await page.screenshot({ path: join(here, 'workspace.png'), fullPage: true });
    await browser.close(); browser = null; await shutdownServer(); server = null;
    const shown = await capture(['workspace', 'show', '--config', configFile, '--directory', directory]);
    const originalIds = ['public-source-push', pulled.operationId, restored.operationId];
    for (const id of originalIds) {
      if (!shown.requests.some(row => row.operationId === id && row.phase === 'COMPLETE' && row.operation?.status === 'COMPLETE'))
        throw new Error('Reopened workspace did not retain original completion: ' + id);
    }
    await step('reopen original workspace through show command', { status: 'COMPLETE', workspaceId: shown.id,
      retainedOperations: shown.requests.map(row => ({ operationId: row.operationId, phase: row.phase, originalStatus: row.operation?.status })),
      readOnly: shown.readOnly, browserErrors: errors });
    report.status = 'COMPLETE'; report.completedAt = new Date().toISOString();
    report.sourceFiles = files; report.originalOperations = originalIds;
    report.screenshot = join(here, 'workspace.png'); await save();
  } catch (error) {
    report.status = 'FAILED'; report.error = { name: error.name, code: error.code, message: redact(error.message) };
    report.failedAt = new Date().toISOString(); await save(); process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {}); await shutdownServer();
  }
  process.stdout.write(JSON.stringify({ status: report.status, resultFile, snapshotId: report.snapshotId,
    originalOperations: report.originalOperations, error: report.error ?? null }) + '\n');
}
