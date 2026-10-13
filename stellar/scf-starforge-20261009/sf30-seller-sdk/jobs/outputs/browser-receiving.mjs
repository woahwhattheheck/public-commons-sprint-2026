// MIT. Render the same running customer and merchant workspaces with their actual result files.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateDirectory, writeJson, digest } from '../../../sf88-operator-buyer-cli/node/store.mjs';

export async function reviewOutputFileWorkspaces({ customer, merchant, entryId, jobId, files,
  directory, browserModule, browserExecutable }) {
  for (const value of [directory, browserModule, browserExecutable])
    assert.ok(typeof value === 'string' && isAbsolute(value), 'Select actual absolute browser and output paths.');
  assert.equal(await realpath(browserExecutable), browserExecutable);
  await privateDirectory(directory);
  const loaded = await import(pathToFileURL(browserModule).href);
  const chromium = loaded.chromium ?? loaded.default?.chromium;
  assert.equal(typeof chromium?.launch, 'function', 'Use the installed original Playwright module.');
  const browser = await chromium.launch({ executablePath: browserExecutable, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const screenshots = [], downloads = [], pageErrors = [];
  try {
    for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 },
      { name: 'phone', width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, acceptDownloads: true });
      const page = await context.newPage();
      page.on('pageerror', error => pageErrors.push({ viewport: viewport.name, message: String(error.message) }));
      const capture = async name => {
        await page.waitForLoadState('networkidle', { timeout: 15000 });
        await page.locator('h1').first().waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
          name + ' should fit the selected viewport; tables keep their own scroll area.');
        const path = join(directory, viewport.name + '-' + name + '.png');
        await page.screenshot({ path, fullPage: true });
        const bytes = await readFile(path);
        screenshots.push({ view: name, viewport: viewport.name, path, bytes: bytes.length, sha256: digest(bytes) });
      };
      try {
        const jobs = new URL(customer.url); jobs.searchParams.set('entry', entryId);
        await page.goto(jobs.href);
        await page.locator('#outputFilesButton:enabled').waitFor();
        await page.locator('#outputFilesButton').click();
        await page.waitForFunction(() => document.querySelectorAll('#outputFiles tr').length === 3);
        const report = files.find(file => file.slot === 'report');
        const reportRow = page.locator('#outputFiles tr').filter({ hasText: report.filename });
        await reportRow.getByRole('button', { name: 'Preview', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#preview')?.textContent.includes('supplier-invoice-reconciliation.v1'));
        const pending = page.waitForEvent('download');
        await reportRow.getByRole('button', { name: 'Download', exact: true }).click();
        const download = await pending, path = join(directory, viewport.name + '-download-' + report.filename);
        await download.saveAs(path);
        const bytes = await readFile(path);
        assert.equal(bytes.length, report.bytes); assert.equal(digest(bytes), report.sha256);
        downloads.push({ side: 'customer', viewport: viewport.name, slot: report.slot, path,
          bytes: bytes.length, sha256: digest(bytes) });
        await capture('customer-output-files');
        await reportRow.getByRole('button', { name: 'Open in library', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/');
        await capture('customer-library-member');
        for (const [name, url] of [
          ['customer-request', customer.intakeUrl], ['customer-checkout', customer.checkoutUrl],
          ['customer-collections', customer.collectionsUrl], ['customer-resolutions', customer.resolutionUrl]]) {
          await page.goto(url); await capture(name);
        }
        await page.goto(merchant.url);
        const jobRow = page.locator('#job-rows tr').filter({ hasText: jobId });
        await jobRow.getByRole('button').click();
        await page.locator('#result-files-open').click();
        await page.waitForFunction(() => document.querySelectorAll('#result-files-rows tr').length === 3);
        const totals = files.find(file => file.slot === 'totals');
        const totalRow = page.locator('#result-files-rows tr').filter({ hasText: totals.filename });
        const receiving = page.waitForEvent('download');
        await totalRow.getByRole('button', { name: 'Download', exact: true }).click();
        const original = await receiving, target = join(directory, viewport.name + '-download-' + totals.filename);
        await original.saveAs(target);
        const csv = await readFile(target);
        assert.equal(csv.length, totals.bytes); assert.equal(digest(csv), totals.sha256);
        downloads.push({ side: 'merchant', viewport: viewport.name, slot: totals.slot, path: target,
          bytes: csv.length, sha256: digest(csv) });
        await capture('merchant-output-files');
        for (const [name, path] of [['merchant-inputs', '/inputs/'], ['merchant-resolutions', '/resolutions/']]) {
          await page.goto(merchant.origin + path + '#' + merchant.token); await capture(name);
        }
      } finally { await context.close(); }
    }
    assert.deepEqual(pageErrors, []);
    const result = { schema: 'stellar-forge.job-output-browser-receiving.v1', result: 'PASS',
      jobId, entryId, browserVersion: browser.version(), screenshots, downloads, pageErrors,
      review: 'Desktop and 390px views reopened the original workspaces; named preview and downloads matched the same paid result.' };
    await writeJson(join(directory, 'browser-result.json'), result);
    return result;
  } finally { await browser.close(); }
}
