#!/usr/bin/env node
// MIT. The original worksheet/policy operation continued through Console workflows and complete receiving.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { runOperationPolicyJourney } from '../openapi-operation-policies-journey.mjs';
import { OpenApiWorkflowClient, writeOpenApiWorkflowFile } from './openapi-workflow-client.mjs';
import { main as workflowCli } from './openapi-workflow-cli.mjs';
import { reopenOpenApiPackageDownload } from '../openapi-workspace-client.mjs';
import { readPackage } from '../../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/model.mjs';
import { parseMerchantPackageExport } from '../../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/package-export-format.mjs';

const OPERATION = 'ASTRA-D76C-SCF-OPENAPI-POLICY-WORKFLOW-20261012';
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = value => createHash('sha256').update(value).digest('hex');
const file = (path, value) => writeFile(path, value, { mode: 0o600 });
const execute = promisify(execFile);
const clientFor = context => new OpenApiWorkflowClient({
  url: context.mcp.consoleUrl, tokenEnv: 'WORKSHEET_NATIVE_TOKEN', environment: context.environment
});
async function completeFolder(directory, selected) {
  const bytes = await readFile(join(directory, 'package-export.json'));
  assert.equal(sha(bytes), selected.expectedManifestSha256);
  const manifest = parseMerchantPackageExport(bytes, selected.exportId);
  for (const entry of manifest.files) {
    const content = await readFile(join(directory, entry.name));
    assert.equal(content.length, entry.bytes, entry.name);
    assert.equal(sha(content), entry.sha256, entry.name);
  }
  return manifest;
}
async function chromiumExecutable() {
  for (const path of [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, process.env.CHROMIUM_PATH,
    '/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell',
    '/workspace/scratch/883218df7be2/browser-runtime/chrome-headless-shell'
  ].filter(Boolean)) {
    try { const info = await lstat(path); if (info.isFile()) { await access(path, constants.X_OK); return path; } } catch {}
  }
}
async function browserReceiving(context, client, profileId, runId, selected) {
  const { chromium } = await import('playwright');
  const executablePath = await chromiumExecutable();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
    page.setDefaultTimeout(60000);
    await page.goto(context.mcp.consoleUrl + '#token=' + encodeURIComponent(context.environment.WORKSHEET_NATIVE_TOKEN));
    await page.locator('#connected').waitFor({ state: 'visible' });
    await page.locator('#profiles').selectOption(profileId);
    await page.locator('[data-page="workflows"]').click();
    await page.locator('#refresh-workflows').click();
    await page.locator('#workflow-runs > button').filter({ hasText: runId }).click();
    await page.waitForFunction(() => document.getElementById('workflow-run-state').textContent === 'COMPLETE');
    await page.locator('#workflow-run-steps').getByRole('button', { name: 'Prepare customer', exact: true }).click();
    assert.equal(await page.locator('#customer-family').inputValue(), 'openapi');
    assert.equal(await page.locator('#customer-workspace').inputValue(), selected.workspace);
    assert.equal(await page.locator('#customer-export').inputValue(), selected.exportId);
    assert.equal(await page.locator('#customer-sha').inputValue(), selected.expectedManifestSha256);
    const receiving = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/operator/api/customers' && response.request().method() === 'POST');
    await page.locator('#customer-form button[type="submit"]').click();
    const response = await receiving;
    assert.equal(response.status(), 202);
    const started = await response.json();
    const { delivery } = await client.waitCustomer(profileId, started.delivery.id, { timeoutMs: 120000 });
    assert.equal(delivery.state, 'COMPLETE');
    await page.locator('#refresh-customers').click();
    await page.waitForFunction(() => document.getElementById('customer-state').textContent === 'COMPLETE');
    assert.equal(await page.locator('#customer-files tr').count(), delivery.files.length);
    const original = delivery.files[0];
    const downloading = page.waitForEvent('download');
    await page.locator('#customer-files tr').first().getByRole('button', { name: 'Download', exact: true }).click();
    const downloaded = await downloading;
    const output = join(context.root, 'openapi-customer-browser-file');
    await downloaded.saveAs(output);
    const bytes = await readFile(output);
    assert.equal(bytes.length, original.bytes); assert.equal(sha(bytes), original.sha256);
    const screenshot = join(context.root, 'openapi-workflow-customer.png');
    await page.screenshot({ path: screenshot, fullPage: false });
    return { delivery, screenshot, browserFile: { name: original.name, bytes: bytes.length, sha256: sha(bytes) },
      chromium: executablePath ?? 'original-playwright-installed-browser' };
  } finally { await browser.close(); }
}
async function finishRun(client, request, expected = 'COMPLETE') {
  await client.start(request);
  const result = await client.waitRun(request.request.id, { timeoutMs: 120000 });
  assert.equal(result.run.state, expected, JSON.stringify(result.run.error));
  return result.run;
}
export async function runOpenApiWorkflowJourney({ parent } = {}) {
  const paths = {};
  const outcome = await runOperationPolicyJourney({ parent, operatorConsole: true, extension: {
    async prepare(context) {
      paths.download = join(context.downloads, 'workflow-package');
      paths.archive = join(context.downloads, 'workflow-package.tar.gz');
      paths.unpack = join(context.downloads, 'workflow-archive');
      context.deliveries.workflow = { directory: paths.download };
      context.deliveries.workflow_archive = { directory: join(paths.unpack, 'package') };
      assert.ok(context.report.installation.commands.includes('merchant-openapi-workflows'));
      assert.ok(context.report.installation.exports.includes('./merchant/console/openapi-workflows'));
      context.report.consoleWorkflow = {
        schema: 'stellar-forge.openapi-console-workflow-native.v1', operation: OPERATION, steps: []
      };
      for (const name of [
        'openapi-workflow-recipes.mjs', 'openapi-workflow-client.mjs', 'openapi-workflow-cli.mjs',
        'openapi-workflow-journey.mjs', 'openapi-customer-records.mjs', 'openapi-customers.mjs',
        'customers.mjs', 'store.mjs', 'service.mjs', 'workflow-recipes.mjs', 'workflow-records.mjs', 'workflows.mjs',
        'public/app.mjs', 'public/workflows.mjs', 'public/index.html'
      ]) context.report.source['console/' + name] = sha(await readFile(new URL(name, import.meta.url)));
    },
    async run(context) {
      const report = context.report.consoleWorkflow;
      const step = (name, data = {}) => {
        report.steps.push({ name, completedAt: new Date().toISOString(), ...data });
        context.step('console-' + name, data);
      };
      let current = context, client = clientFor(current);
      const profileId = 'openapi-native-operations', installationId = 'openapi-maintenance-native';
      const runId = 'openapi-maintenance-native-run', outputName = 'policy-workflow-published';
      const originalFetch = context.originalFetch;
      globalThis.fetch = originalFetch;
      try {
        assert.ok(current.mcp.consoleUrl);
        await client.createProfile({ id: profileId, name: 'API policy operations and customer receiving' });
        const prepared = await client.prepare({
          kind: 'maintenance', id: installationId, profileId, name: 'Forecast reviewed maintenance',
          request: { workspace: 'sender', baseName: context.policyPackage,
            policy: { id: context.firstPolicy.policy.id, sha256: context.firstPolicy.sha256 },
            targets: [{ method: 'GET', path: context.forecast.path }],
            overrides: [{ method: 'GET', path: context.forecast.path, set: { timeoutMs: 7100 } }] },
          package: outputName
        });
        assert.equal(prepared.review.canInstall, true, JSON.stringify(prepared.review));
        const retained = await writeOpenApiWorkflowFile(join(context.root, 'workflow-prepared.json'), prepared);
        const sameFile = await writeOpenApiWorkflowFile(join(context.root, 'workflow-prepared.json'), prepared);
        assert.equal(sameFile.state, 'REOPENED'); assert.equal(sameFile.sha256, retained.sha256);
        let discarded = null;
        globalThis.fetch = async (target, options) => {
          const response = await originalFetch(target, options);
          const url = new URL(typeof target === 'string' ? target : target.url ?? target.href);
          if (!discarded && url.pathname === '/operator/api/workflow-recipe-install' && options?.method === 'POST' && response.ok) {
            discarded = await response.clone().json(); await response.body?.cancel();
            throw Object.assign(new Error('Discard the response after the original installation committed.'), { code: 'NATIVE_RESPONSE_DISCARDED' });
          }
          return response;
        };
        await assert.rejects(client.install(prepared), error => error.outcomeUnknown === true);
        globalThis.fetch = originalFetch;
        assert.equal(discarded.installation.id, installationId);
        const installed = await client.install(prepared);
        assert.equal(installed.reused, true); assert.equal(installed.definition.revision, 1);
        const earlier = await client.exportProfile(profileId);
        await writeOpenApiWorkflowFile(join(context.root, 'workflow-profile-earlier.json'), earlier.bytes);
        const revised = await client.saveWorkflow({
          id: installed.definition.id, profileId, name: 'Forecast reviewed maintenance, receiving edition',
          expectedRevision: installed.definition.revision, steps: installed.definition.steps
        });
        assert.equal(revised.definition.revision, 2);
        const replay = await client.install(prepared);
        assert.equal(replay.definition.revision, 1); assert.equal(replay.currentDefinitionRevision, 2);
        step('recipe-install-discarded-return-and-later-edition', {
          recipeSha256: prepared.recipe.contentSha256, installationId, originalEdition: 1, laterEdition: 2,
          exactInstallReplay: true, preparationSha256: retained.sha256
        });

        const runInput = join(context.root, 'workflow-run-input.json');
        const runOutput = join(context.root, 'workflow-run-prepared.json');
        await file(runInput, json({ id: runId, installationId, workflowRevision: 2 }));
        const previous = process.env.WORKSHEET_NATIVE_TOKEN;
        let runRequest;
        process.env.WORKSHEET_NATIVE_TOKEN = context.environment.WORKSHEET_NATIVE_TOKEN;
        try {
          runRequest = await workflowCli(['run-prepare', '--url', current.mcp.consoleUrl,
            '--token-env', 'WORKSHEET_NATIVE_TOKEN', '--input', runInput, '--output', runOutput]);
        } finally {
          if (previous === undefined) delete process.env.WORKSHEET_NATIVE_TOKEN;
          else process.env.WORKSHEET_NATIVE_TOKEN = previous;
        }
        const paused = await finishRun(client, runRequest, 'PAUSED');
        const reviewStep = paused.steps.find(value => value.id === 'review');
        const reviewCall = await client.json('call/' + encodeURIComponent(reviewStep.callId));
        const nativeReview = JSON.parse(reviewCall.resultJson);
        assert.equal(nativeReview.review.policySha256, context.firstPolicy.sha256);
        const changed = nativeReview.plan.operations.find(value => value.path === context.forecast.path);
        assert.equal(changed.timeoutMs, 7100);
        const source = await readPackage(context.senderRoot, context.policyPackage);
        assert.equal(changed.amountAtomic, source.plan.operations.find(value => value.path === context.forecast.path).amountAtomic);
        await client.continueReviewed({ id: runId, expectedRevision: paused.revision,
          expectedReviewSha256: nativeReview.review.sha256 });
        const complete = await client.waitRun(runId, { timeoutMs: 120000 });
        assert.equal(complete.run.state, 'COMPLETE', JSON.stringify(complete.run.error));
        const repeated = await client.start(runRequest);
        assert.equal(repeated.reused, true);
        assert.equal(repeated.run.revision, complete.run.revision);
        assert.deepEqual(repeated.run.steps.map(value => value.callId), complete.run.steps.map(value => value.callId));
        const selected = await client.exportedPackage(runId);
        const saved = await readPackage(context.senderRoot, outputName);
        assert.equal(selected.package.id, saved.manifest.id);
        assert.equal(saved.operationPolicy.review.sha256, nativeReview.review.sha256);
        step('original-cli-run-native-review-package-and-export', {
          runId, workflowRevision: 2, reviewSha256: nativeReview.review.sha256,
          exportId: selected.exportId, manifestSha256: selected.expectedManifestSha256,
          packageId: saved.manifest.id, exactPrice: changed.amountAtomic, exactRunReplay: true
        });

        const browser = await browserReceiving(current, client, profileId, runId, selected);
        assert.equal(browser.delivery.identity.expectedManifestSha256, selected.expectedManifestSha256);
        const archive = await client.downloadCustomerArchive({ profileId, deliveryId: browser.delivery.id, output: paths.archive });
        const archiveAgain = await client.downloadCustomerArchive({ profileId, deliveryId: browser.delivery.id, output: paths.archive });
        assert.equal(archiveAgain.state, 'REOPENED'); assert.equal(archiveAgain.sha256, archive.sha256);
        await mkdir(paths.unpack, { mode: 0o700 });
        await execute('tar', ['-xzf', paths.archive, '-C', paths.unpack], { maxBuffer: 1024 * 1024 });
        const completeManifest = await completeFolder(join(paths.unpack, 'package'), selected);
        const controller = new AbortController(); let progress = 0;
        await assert.rejects(client.downloadPackage(runId, {
          url: current.mcp.url, tokenEnv: 'WORKSHEET_NATIVE_TOKEN', environment: context.environment,
          directory: paths.download, chunkSize: 65536, signal: controller.signal,
          onProgress: () => { if (++progress === 1) controller.abort(new Error('Continue the same original package download.')); }
        }));
        assert.ok(progress > 0);
        const resumed = await client.downloadPackage(runId, {
          url: current.mcp.url, tokenEnv: 'WORKSHEET_NATIVE_TOKEN', environment: context.environment,
          directory: paths.download, chunkSize: 65536
        });
        assert.equal(resumed.state, 'COMPLETE');
        const reopened = await reopenOpenApiPackageDownload({
          directory: paths.download, expectedManifestSha256: selected.expectedManifestSha256
        });
        assert.equal(reopened.package.id, saved.manifest.id);
        await completeFolder(paths.download, selected);
        step('browser-full-customer-archive-and-resumable-files', {
          deliveryId: browser.delivery.id, files: completeManifest.files.length,
          bytes: completeManifest.totalBytes, archiveBytes: archive.bytes, archiveSha256: archive.sha256,
          screenshot: browser.screenshot, browserFile: browser.browserFile, chromium: browser.chromium,
          completedFileReplay: true, originalChunkRecovery: true
        });

        const latest = await client.exportProfile(profileId);
        await writeOpenApiWorkflowFile(join(context.root, 'workflow-profile-complete.json'), latest.bytes);
        const sourceHost = await client.host();
        client.close();
        current = { ...context, ...await context.reopen({ consoleDirectory: join(context.root, 'operator-console-received') }) };
        client = clientFor(current);
        await client.importProfile(earlier.archive);
        assert.equal((await client.definition(installationId)).definition.revision, 1);
        await client.importProfile(latest.archive);
        await client.importProfile(earlier.archive);
        assert.equal((await client.definition(installationId)).definition.revision, 2);
        const originalInstall = await client.install(prepared);
        assert.equal(originalInstall.definition.revision, 1); assert.equal(originalInstall.currentDefinitionRevision, 2);
        const originalRun = await client.start(runRequest);
        assert.equal(originalRun.reused, true); assert.equal(originalRun.run.state, 'COMPLETE');
        assert.deepEqual(originalRun.run.steps.map(value => value.callId), complete.run.steps.map(value => value.callId));
        const receivedProfile = await client.profile(profileId), destinationHost = await client.host();
        if (receivedProfile.profile.hostFingerprint !== destinationHost.configurationFingerprint)
          await client.bindProfile({ id: profileId, expectedRevision: receivedProfile.profile.revision,
            expectedHostFingerprint: destinationHost.configurationFingerprint });
        const receiving = await client.prepare({
          kind: 'receiving', id: 'openapi-package-receiving-native', profileId,
          workspace: 'receiver', delivery: 'workflow_archive', package: 'workflow-received',
          expectedManifestSha256: selected.expectedManifestSha256, releaseId: 'workflow-received'
        });
        assert.equal(receiving.review.canInstall, true, JSON.stringify(receiving.review));
        const receivedInstall = await client.install(receiving);
        const receivingRun = await client.prepareRun({ id: 'openapi-package-receiving-native-run',
          installationId: receivedInstall.installation.id });
        const receivedComplete = await finishRun(client, receivingRun);
        assert.equal((await client.start(receivingRun)).reused, true);
        const receivedPackage = await readPackage(context.receiverRoot, 'workflow-received');
        assert.equal(receivedPackage.manifest.id, saved.manifest.id);
        assert.deepEqual(receivedPackage.operationPolicy, saved.operationPolicy);
        const stage = receivedComplete.steps.find(value => value.id === 'stage');
        const stagedCall = await client.json('call/' + encodeURIComponent(stage.callId));
        assert.equal(JSON.parse(stagedCall.resultJson).native.state, 'STAGED');
        const currentHost = await client.host();
        const transferred = await client.receiveCustomer(runId, { expectedHostFingerprint: currentHost.configurationFingerprint });
        const completedCustomer = await client.waitCustomer(profileId, transferred.delivery.id);
        assert.equal(completedCustomer.delivery.state, 'COMPLETE');
        assert.equal(completedCustomer.delivery.localFiles, true);
        step('cold-profile-later-edition-and-original-package-receiving', {
          originalWorkspaceId: sourceHost.console.workspaceId, receivingWorkspaceId: destinationHost.console.workspaceId,
          preservedDefinitionRevision: 2, originalInstallationRevision: 1,
          preservedCallIds: complete.run.steps.map(value => value.callId), receivingRunId: receivedComplete.id,
          packageId: receivedPackage.manifest.id, policyApplicationPreserved: true, releaseState: 'STAGED',
          receivedCustomerId: completedCustomer.delivery.id
        });
        report.state = 'PASSED'; report.completedAt = new Date().toISOString();
      } catch (error) {
        report.state = 'FAILED'; report.failure = { code: error.code ?? null, message: error.message }; throw error;
      } finally { globalThis.fetch = originalFetch; client.close(); }
    }
  } });
  console.log(JSON.stringify({ operation: OPERATION, state: outcome.report.consoleWorkflow.state,
    result: outcome.result, steps: outcome.report.consoleWorkflow.steps.length }));
  return outcome;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [parent, ...extra] = process.argv.slice(2);
  if (!parent || extra.length) {
    console.error('Usage: node console/openapi-workflow-journey.mjs EXISTING_PRIVATE_PARENT');
    process.exitCode = 1;
  } else runOpenApiWorkflowJourney({ parent }).catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
