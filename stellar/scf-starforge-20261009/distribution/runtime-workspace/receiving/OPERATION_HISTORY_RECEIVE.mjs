// MIT. Read-only phase for the existing Runtime receiver and its actual workspace.
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { saveJSON } from '../storage.mjs';
const check = (value, message) => { if (!value) throw new Error(message); };
const withoutObservationTime = value => JSON.stringify(value, (key, item) => key === 'checkedAt' ? undefined : item);

/**
 * Use the caller's already-running page, native model and original receiving root.
 * This phase never creates an operation, record fixture, runtime or command.
 * Screens must subsequently be viewed by the producing/receiving operator.
 */
export async function receiveOperationHistory({ page, model, outputDirectory }) {
  const directory = join(outputDirectory, 'operation-history', randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url)), sourceFiles = [];
  for (const path of ['model.mjs', 'operation-records.mjs', 'operation-observations.mjs',
    'server.mjs', 'cli.mjs', 'browser-assets.json', 'public/app.mjs', 'public/style.css',
    'public/operation-history-model.mjs', 'public/operation-history.mjs', 'receiving/OPERATION_HISTORY_RECEIVE.mjs']) {
    const body = await readFile(join(sourceRoot, path));
    sourceFiles.push({ path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });
  }
  const initial = await model.state({ operationDetail: 'summary' });
  const pageResults = [], ids = [], cursors = new Set();
  let cursor = null;
  do {
    const value = await model.operationHistory({ limit: 20, ...(cursor ? { cursor } : {}) });
    check(value.workspaceId === initial.workspaceId, 'Operation history belongs to a different workspace.');
    for (const item of value.items) {
      check(!Object.hasOwn(item, 'result') && !Object.hasOwn(item, 'commandResult'), 'Summary carries a complete result body.');
      check(!ids.includes(item.id), 'Original operation appeared twice while paging.');
      ids.push(item.id);
    }
    pageResults.push(value); cursor = value.nextCursor;
    if (cursor) { check(!cursors.has(cursor), 'Operation history cursor repeated.'); cursors.add(cursor); }
  } while (cursor);
  const apiHistory = await page.evaluate(async () => {
    const response = await fetch('/api/operations?limit=20', { headers: {
      'x-runtime-workspace-token': sessionStorage.getItem('starforge-runtime-capability'),
    } });
    const value = await response.json(); if (!response.ok) throw Error(value.message ?? value.error);
    return value;
  });
  check(apiHistory.workspaceId === initial.workspaceId && apiHistory.items.length <= 20,
    'Authenticated history API returned a different workspace or unbounded page.');
  await page.setViewportSize({ width: 1360, height: 950 });
  await page.locator('[data-view="operations"]').click();
  await page.locator('#operations form').waitFor();
  const pane = page.locator('#operations'), screenshots = [];
  async function screen(name) {
    const path = join(directory, name + '.png'); await page.screenshot({ path, fullPage: true }); screenshots.push(path);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Operations workspace overflows the actual viewport.');
  }
  await pane.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#operations input[type="search"]')?.value === '' &&
    document.querySelector('#operations [role="status"]')?.textContent.includes(' matching of '));
  await screen('desktop-existing-history');
  if (apiHistory.hasMore) {
    const before = await pane.locator('article[data-operation-id]').evaluateAll(nodes => nodes.map(node => node.dataset.operationId));
    await pane.getByRole('button', { name: 'Older operations', exact: true }).click();
    await page.waitForFunction(previous => {
      const rows = [...document.querySelectorAll('#operations article[data-operation-id]')];
      return rows.length > 0 && rows.every(node => !previous.includes(node.dataset.operationId));
    }, before);
    const after = await pane.locator('article[data-operation-id]').evaluateAll(nodes => nodes.map(node => node.dataset.operationId));
    check(after.length > 0 && after.every(id => !before.includes(id)), 'Browser page did not advance across original operations.');
    await pane.getByRole('button', { name: 'Previous page', exact: true }).click();
    await page.waitForFunction(id => Boolean(document.querySelector('#operations article[data-operation-id="' + id + '"]')), before[0]);
  }
  await pane.getByLabel('Find an operation', { exact: true }).fill('absent-operation-' + randomUUID());
  await pane.getByRole('button', { name: 'Find operations', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('#operations article[data-operation-id]').length === 0);
  check(await pane.locator('article[data-operation-id]').count() === 0, 'Empty history selection retained previous cards.');
  await screen('desktop-empty-filter');
  await pane.getByRole('button', { name: 'Clear filters', exact: true }).click();
  const candidate = initial.operations.find(item => item.phase === 'SUCCEEDED') ?? initial.operations[0];
  let selected = null, download = null, errorState = null;
  if (candidate) {
    await pane.getByLabel('Find an operation', { exact: true }).fill(candidate.id);
    await pane.getByRole('button', { name: 'Find operations', exact: true }).click();
    const row = pane.locator('article[data-operation-id="' + candidate.id + '"]');
    await row.waitFor();
    const originalReads = [];
    const listen = async response => {
      if (response.url().includes('/api/operation-status?') && response.ok()) {
        try { const value = await response.json(); if (value.id === candidate.id) originalReads.push(value); } catch {}
      }
    };
    page.on('response', listen);
    try {
      await row.getByRole('button', { name: 'Open complete operation', exact: true }).click();
      const detail = pane.getByRole('region', { name: 'Complete original operation', exact: true });
      await detail.locator('pre[data-operation-record]').waitFor();
      selected = JSON.parse(await detail.locator('pre[data-operation-record]').innerText());
      check(selected.id === candidate.id, 'Selected original operation changed.');
      const waiting = page.waitForEvent('download');
      await detail.getByRole('button', { name: 'Download complete operation JSON', exact: true }).click();
      const received = await waiting, destination = join(directory, received.suggestedFilename());
      await received.saveAs(destination);
      const bytes = await readFile(destination), value = JSON.parse(bytes.toString('utf8'));
      check(value.id === candidate.id && (withoutObservationTime(value) === withoutObservationTime(selected) ||
        originalReads.some(item => withoutObservationTime(item) === withoutObservationTime(value))),
        'Complete operation download differs from every observed original read.');
      download = { path: destination, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      await screen('desktop-complete-original-operation');
      // Delay and then fail only this read route. Original records and all native
      // actions remain untouched; the last complete body must remain available.
      let delayed = null;
      await page.route('**/api/operation-status?**', route => { if (delayed) return route.continue(); delayed = route; });
      try {
        await detail.getByRole('button', { name: 'Refresh selected operation', exact: true }).click();
        await detail.getByText('Refreshing the same original operation.', { exact: true }).waitFor();
        await screen('desktop-refreshing-original');
        check(delayed, 'The selected read was not observed.');
        await delayed.fulfill({ status: 503, contentType: 'application/json',
          body: JSON.stringify({ error: 'RECEIVING_READ_UNAVAILABLE', message: 'The receiving course interrupted this read.' }) });
        await detail.getByText('The current read failed. Any previously opened complete operation remains available below.', { exact: true }).waitFor();
        errorState = JSON.parse(await detail.locator('pre[data-operation-record]').innerText());
        check(withoutObservationTime(errorState) === withoutObservationTime(selected) ||
          originalReads.some(item => withoutObservationTime(item) === withoutObservationTime(errorState)),
          'Failed refresh displaced the last complete operation.');
        await screen('desktop-read-error-with-retained-original');
      } finally {
        if (delayed) await delayed.continue().catch(() => {});
        await page.unroute('**/api/operation-status?**');
      }
      const refreshed = page.waitForResponse(response => response.ok() &&
        response.url().includes('/api/operation-status?') && new URL(response.url()).searchParams.get('operationId') === candidate.id);
      await detail.getByRole('button', { name: 'Refresh selected operation', exact: true }).click();
      const receivedRefresh = await (await refreshed).json();
      await page.waitForFunction(value => {
        const panel = document.querySelector('#operations section[aria-label="Complete original operation"]');
        if (!panel?.querySelector('pre[data-operation-record]')) return false;
        let original; try { original = JSON.parse(panel.querySelector('pre[data-operation-record]').textContent); } catch { return false; }
        return original.id === value.id && (original.observation?.checkedAt ?? '') >= (value.observation?.checkedAt ?? '') &&
          !panel.textContent.includes('Refreshing the same original operation.') &&
          !panel.textContent.includes('The current read failed.');
      }, receivedRefresh);
      await page.reload();
      await pane.getByRole('region', { name: 'Complete original operation', exact: true }).locator('pre[data-operation-record]').waitFor();
      const reopened = JSON.parse(await pane.getByRole('region', { name: 'Complete original operation', exact: true }).locator('pre[data-operation-record]').innerText());
      check(reopened.id === candidate.id, 'Reopening lost the selected original operation.');
      await page.setViewportSize({ width: 390, height: 844 });
      await screen('phone-original-operation');
    } finally { page.off('response', listen); }
  } else {
    await page.setViewportSize({ width: 390, height: 844 }); await screen('phone-existing-empty-history');
  }
  const result = { schema: 'stellar-forge.runtime-operation-history-receiving.v1',
    workspaceId: initial.workspaceId, sourceFiles, observedAt: new Date().toISOString(),
    existingOperationIds: ids, pages: pageResults, apiHistory, selectedOperationId: selected?.id ?? null,
    completeOperation: selected, download, errorStateRetained: Boolean(errorState), screenshots,
    renderedInspection: { state: 'AWAITING_OPERATOR_VIEW', instruction:
      'Open and look at these exact screens and the downloaded original file. Check desktop and 390px layout, populated/empty/loading/error states, original recovery/navigation and reopening. Repair visible defects before calling the outgoing product ready.' } };
  await saveJSON(join(directory, 'OPERATION_HISTORY_RECEIVING.json'), result);
  return { directory, report: join(directory, 'OPERATION_HISTORY_RECEIVING.json'), workspaceId: initial.workspaceId,
    observedOperations: ids.length, selectedOperationId: selected?.id ?? null, download, screenshots,
    renderedInspection: result.renderedInspection };
}
