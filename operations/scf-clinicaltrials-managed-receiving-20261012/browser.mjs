// MIT. Render the original managed Applications and ClinicalTrials owner.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value, message) => { if (!value) throw new Error(message); };
export function clinicalTrialsManagedBrowser(options = {}) {
  return async ({ pass, runtime, applicationId, applicationWorkspace, url, state, expected, receivingDirectory }) => {
    const packagePath = options.playwrightPackage ?? process.env.SCF_PLAYWRIGHT_PACKAGE ??
      (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : null);
    const executablePath = options.browserExecutable ?? process.env.SCF_BROWSER_EXECUTABLE;
    need(packagePath && isAbsolute(packagePath) && executablePath && isAbsolute(executablePath),
      'Select the existing absolute Playwright package and Chromium executable');
    const { chromium } = require(packagePath);
    const { startRuntimeWorkspace } = await import(pathToFileURL(join(runtime.sourceRoot,
      'stellar/scf-starforge-20261009/distribution/runtime-workspace/server.mjs')));
    const report = { pass, applicationId, sections: [], reviews: [], pageErrors: [] };
    let listener, browser, context;
    try {
      listener = await startRuntimeWorkspace({ directory: applicationWorkspace, port: 0 });
      browser = await chromium.launch({ executablePath, headless: true,
        args: ['--disable-dev-shm-usage', '--no-sandbox'] });
      context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
      context.on('page', page => page.on('pageerror', error => report.pageErrors.push(String(error.message))));
      const applications = await context.newPage();
      await applications.goto(listener.url, { waitUntil: 'domcontentloaded' });
      await applications.locator('button[data-view="applications"]').click();
      const entry = applications.locator('[data-application-id="' + applicationId + '"]');
      await entry.waitFor({ state: 'visible', timeout: 120000 }); await entry.click();
      const open = applications.getByRole('link', { name: 'Open application', exact: true });
      await open.waitFor({ state: 'visible' });
      need(await open.getAttribute('href') === url, 'The Applications link is not the original live console');
      await applications.getByRole('heading', { name: 'Original operations', exact: true }).waitFor();
      need((await applications.locator('body').innerText()).includes(runtime.sourceCommit),
        'The Applications browser did not show the selected source commit');
      report.applicationView = { currentPhase: await entry.textContent(), selectedSourceCommit: runtime.sourceCommit,
        originalOperationsVisible: true };
      if (options.screenshots === true) await applications.screenshot({
        path: join(receivingDirectory, 'managed-applications.png'), fullPage: true });
      const opened = context.waitForEvent('page'); opened.catch(() => {});
      await open.click();
      const clinical = await opened; await clinical.waitForLoadState('domcontentloaded');
      await clinical.waitForFunction(id => document.getElementById('capture-select')?.value === id,
        expected.captureId, { timeout: 120000 });
      need((await clinical.locator('#workspace-summary').innerText()).includes(expected.rows + ' captured studies'),
        'The original captured cohort count is not rendered');
      need(await clinical.locator('#connection').isHidden(), 'The managed private connection was not accepted');
      for (const section of ['cohort', 'studies', 'mapping', 'prs', 'query', 'publisher', 'exports']) {
        await clinical.locator('button[data-section="' + section + '"]').click();
        await clinical.locator('#section-' + section).waitFor({ state: 'visible' });
        report.sections.push({ section, title: await clinical.locator('#section-' + section).locator('h1,h2').first().textContent() });
      }
      await clinical.locator('button[data-section="mapping"]').click();
      await clinical.waitForFunction(() => document.querySelectorAll('#mapping-columns tr').length > 0);
      need(await clinical.locator('#mapping-select').inputValue() === expected.planId,
        'The rendered mapping is not the retained original plan');
      report.mapping = { planId: expected.planId, columns: await clinical.locator('#mapping-columns tr').count(),
        editionRows: await clinical.locator('#editions-table tbody tr').count() };
      for (const review of expected.reviews) {
        await clinical.locator('button[data-section="studies"]').click();
        await clinical.locator('#study-search').fill(review.nctId);
        const response = clinical.waitForResponse(value =>
          value.url().includes('/api/clinical/studies?') && value.url().includes('query=' + review.nctId));
        response.catch(() => {});
        await clinical.getByRole('button', { name: 'Search studies', exact: true }).click();
        need((await response).ok(), 'The original retained study search failed');
        await clinical.getByRole('button', { name: review.nctId, exact: true }).click();
        await clinical.waitForFunction(id => document.getElementById('study-facts')?.textContent.includes(id),
          review.nctId);
        const history = await clinical.locator('#study-review-history').textContent();
        need(history.includes(review.id), 'The original reviewed study history is missing from the browser');
        const raw = await clinical.locator('#study-full-json').textContent();
        const sections = await clinical.locator('#study-section option').allTextContents();
        need(sections.length > 0 && raw.length > 0, 'The full original study source is not available');
        report.reviews.push({ nctId: review.nctId, reviewId: review.id,
          sourceSha256: hash(Buffer.from(raw)), bytes: Buffer.byteLength(raw), sections });
      }
      if (options.screenshots === true) await clinical.screenshot({
        path: join(receivingDirectory, 'clinicaltrials-retained-review.png'), fullPage: true });
      await clinical.locator('button[data-section="exports"]').click();
      const downloaded = clinical.waitForEvent('download'); downloaded.catch(() => {});
      await clinical.getByRole('button', { name: 'ProtocolRecordSchema.xsd', exact: true }).click();
      const file = await downloaded, target = join(receivingDirectory, 'browser-ProtocolRecordSchema.xsd');
      await file.saveAs(target);
      const bytes = await readFile(target), source = await readFile(join(runtime.sourceRoot,
        'stellar/scf-starforge-20261009/sf30-seller-sdk/clinicaltrials/contracts/ProtocolRecordSchema.xsd'));
      need(bytes.equals(source), 'The browser changed the original complete schema download');
      report.download = { name: file.suggestedFilename(), bytes: bytes.length, sha256: hash(bytes) };
      const beforeRefresh = JSON.parse(await clinical.locator('#state-details').textContent());
      await clinical.locator('#refresh').click();
      await clinical.waitForFunction(value => {
        const element = document.getElementById('state-details');
        if (!element?.textContent) return false;
        const state = JSON.parse(element.textContent);
        return state.revision === value.revision && state.activeBuild === value.buildId;
      }, { revision: state.revision, buildId: expected.buildId });
      const after = JSON.parse(await clinical.locator('#state-details').textContent());
      need(beforeRefresh.revision === state.revision && after.revision === state.revision &&
        after.reviews.length === state.reviews.length &&
        expected.reviews.every(review => after.reviews.some(row => row.id === review.id)),
      'Rendering or refreshing changed the saved original customer state');
      need(report.pageErrors.length === 0, 'The original managed browser returned a page error');
      report.revision = after.revision; report.activeBuild = after.activeBuild; report.status = 'COMPLETE';
      return report;
    } catch (error) {
      report.error = { message: String(error.message).slice(0, 2000) };
      error.managedBrowser = report;
      throw error;
    } finally {
      if (context) await context.close();
      if (browser) await browser.close();
      if (listener) await listener.close();
    }
  };
}
