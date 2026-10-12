// MIT. Browser continuation over the completed original receiver; existing paid requests reopen.
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { privateDirectory, atomicJson } from '../routescan/quota.mjs';
import { readBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { need } from './model.mjs';
import { hash } from './source.mjs';
import { readFredProject } from './project.mjs';
import { startFredWorkspace } from './workspace.mjs';
import { retainReceiverFile } from './receiver.mjs';

export async function inspectFredReceiverBrowser({ directory, receiverDirectory, state, settings,
  settingsDirectory, buyerConfig, signal } = {}) {
  const allowed = ['module', 'executablePath', 'headless', 'timeoutMs', 'args'];
  need(settings && typeof settings === 'object' && !Array.isArray(settings) &&
    Object.keys(settings).every(key => allowed.includes(key)), 'Select the existing browser module and executable.');
  const module = settings.module ?? 'playwright';
  need(typeof module === 'string' && module.length > 0, 'Select the existing Playwright module.');
  const imported = await import(isAbsolute(module) || module.startsWith('.') ? pathToFileURL(resolve(settingsDirectory, module)).href : module);
  const chromium = imported.chromium ?? imported.default?.chromium;
  need(chromium?.launch, 'The selected original browser installation must export chromium.');
  const timeout = settings.timeoutMs ?? 30000;
  need(Number.isSafeInteger(timeout) && timeout >= 1000 && timeout <= 120000, 'Use a browser action timeout between one and 120 seconds.');
  need(settings.headless === undefined || typeof settings.headless === 'boolean', 'Select a boolean browser headless mode.');
  need(settings.args === undefined || Array.isArray(settings.args) && settings.args.length <= 32 &&
    settings.args.every(value => typeof value === 'string' && !value.includes('\0')), 'Use the existing browser argument list.');
  const root = await privateDirectory(join(receiverDirectory, 'browser-' + randomUUID()));
  const result = { schema: 'stellar-forge.fred-receiver-browser.v1', projectId: state.results.project.projectId,
    captureId: state.results.capture.captureId, publicationId: state.results.publication.publicationId,
    startedAt: new Date().toISOString(), screenshots: [], downloads: [], stages: [] };
  const checkpoint = async () => atomicJson(receiverDirectory, 'browser-current.json', { ...result, directory: root });
  await checkpoint();
  let browser, workspace;
  const errors = [];
  const aborted = () => { browser?.close().catch(() => {}); };
  const active = () => need(!signal?.aborted, 'Continue the retained browser phase after interruption.', 'FRED_RECEIVER_BROWSER_INTERRUPTED');
  const screenshot = async (page, name) => {
    active(); result.screenshots.push(await retainReceiverFile(root, name, await page.screenshot({ fullPage: true }))); await checkpoint();
  };
  const downloaded = async (page, control, name, expected) => {
    active();
    const completed = page.waitForEvent('download');
    await page.locator(control).click();
    const file = await completed;
    need(await file.failure() === null, 'The original browser download did not complete.');
    const bytes = await readBytes(await file.path(), expected.bytes);
    need(bytes.length === expected.bytes && hash(bytes) === expected.sha256, 'The browser download differs from its original retained artifact.');
    result.downloads.push(await retainReceiverFile(root, name, bytes)); await checkpoint();
  };
  try {
    active();
    browser = await chromium.launch({ headless: settings.headless ?? true,
      ...(settings.executablePath ? { executablePath: resolve(settingsDirectory, settings.executablePath) } : {}),
      ...(settings.args ? { args: settings.args } : {}) });
    signal?.addEventListener('abort', aborted, { once: true }); active();
    for (const [kind, projectDirectory] of [['original', directory], ['received', state.results.received.directory]]) {
      active();
      const project = await readFredProject(projectDirectory);
      need(project.id === result.projectId && project.captures.some(item => item.id === result.captureId) &&
        project.publications.some(item => item.id === result.publicationId), 'Open the original complete project and its received edition.');
      workspace = await startFredWorkspace({ directory: projectDirectory,
        ...(kind === 'original' ? { buyerConfig } : {}) });
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage(); page.setDefaultTimeout(timeout);
      page.on('pageerror', error => errors.push({ kind, name: error.name, message: error.message.slice(0, 400) }));
      await page.goto(workspace.url, { waitUntil: 'domcontentloaded', timeout });
      await page.locator('#capture-select option[value="' + result.captureId + '"]').waitFor({ state: 'attached' });
      await page.locator('[data-tab="editions"]').click();
      await page.locator('#capture-select').selectOption(result.captureId);
      await page.waitForFunction(rows => document.getElementById('row-count').textContent.startsWith(rows + ' observations'),
        state.results.nativeComplete.rowCount, { timeout });
      const visibleRows = await page.locator('#observations tbody tr').count();
      need(visibleRows === Math.min(100, state.results.nativeComplete.rowCount), 'The original browser source page row count changed.');
      result.stages.push({ workspace: kind, stage: 'original-source', visibleRows, rowCount: state.results.nativeComplete.rowCount });
      await screenshot(page, kind + '-source.png');
      await downloaded(page, '#download-source', kind + '-original-capture.json', state.results.input);
      await page.locator('[data-tab="publication"]').click();
      await page.locator('#publication-select').selectOption(result.publicationId);
      await page.locator('#open-publication').click();
      await page.waitForFunction(edition => document.getElementById('publication-detail').textContent.includes(edition),
        state.results.received.editionId, { timeout });
      need(await page.locator('#review-select option[value="' + state.results.review.reviewId + '"]').count() === 1,
        'The original saved review must remain selectable after reopen.');
      result.stages.push({ workspace: kind, stage: 'saved-review-and-merchant', editionId: state.results.received.editionId });
      await screenshot(page, kind + '-merchant.png');
      if (kind === 'original') {
        await page.locator('[data-tab="customer"]').click();
        await page.locator('#customer-publication').selectOption(result.publicationId);
        await page.locator('#request-select option[value="' + state.results.page1.intentId + '"]').waitFor({ state: 'attached' });
        await page.locator('#request-select').selectOption(state.results.page1.intentId);
        await page.locator('#open-request').click();
        await page.locator('#recover').click();
        await page.waitForFunction(intent => {
          try { const value = JSON.parse(document.getElementById('customer-result').textContent);
            return value.state === 'DELIVERED' && value.intentId === intent; } catch { return false; }
        }, state.results.page1.intentId, { timeout });
        const rows = await page.locator('#customer-rows tbody tr').count();
        need(rows === state.results.page1.metadata.returned, 'The browser must reopen the original native page rows.');
        await downloaded(page, '#download-customer', 'original-paid-page.json', state.results.page1.response);
        await screenshot(page, 'original-customer.png');
        result.stages.push({ workspace: kind, stage: 'original-paid-page-recovered', intentId: state.results.page1.intentId, rows });
      }
      await page.locator('[data-tab="recovery"]').click();
      await downloaded(page, '#download-bundle', kind + '-project-bundle.json', state.results.export);
      await screenshot(page, kind + '-history.png');
      result.stages.push({ workspace: kind, stage: 'complete-project-export', bundleSha256: state.results.export.bundleSha256 });
      await context.close(); await workspace.close(); workspace = null;
    }
    need(errors.length === 0, 'The original browser application reported a page error.', 'FRED_RECEIVER_BROWSER_PAGE_ERROR');
    result.state = 'COMPLETE'; result.completedAt = new Date().toISOString();
    await checkpoint(); return { ...result, directory: root };
  } catch (error) {
    result.state = 'INTERRUPTED'; result.lastError = { code: error.code ?? 'FRED_RECEIVER_BROWSER_INTERRUPTED', at: new Date().toISOString() };
    await checkpoint(); throw error;
  } finally {
    signal?.removeEventListener('abort', aborted);
    try { if (workspace) await workspace.close(); }
    finally { await browser?.close(); }
  }
}
