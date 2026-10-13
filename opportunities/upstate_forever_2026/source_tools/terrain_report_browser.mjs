/** Original Terrain response → Sources → received editable Study browser chapter.
 * TokenJunkieLabs. No preparation, comparison or native-model actions are issued.
 */
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

function requireValue(value, message) { if (!value) throw Error(message); }
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(
    key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const same = (a, b, message) => requireValue(canonical(a) === canonical(b), message);
const core = value => Object.fromEntries(Object.entries(value).filter(
  ([key]) => !['_downloads', 'workspace_key', 'report_sources', 'progress'].includes(key)));

export async function runTerrainReportReceivingChapter({
  page, receipt, outputDirectory, sourcesDesk, previewSources, originalJSON, download, shot,
}) {
  const chapter = receipt.terrain;
  if (!chapter) return null;
  requireValue(chapter.schema === 'upstate.terrain-report-receiving/v1' &&
    chapter.project_id === receipt.project_id && receipt.selected_study_receiving &&
    chapter.report_source?.source && chapter.inputs?.case?.id && chapter.inputs?.response?.id,
    'Open the completed original Terrain source and selected Study receipt.');
  same(receipt.sources, [chapter.source], 'The report contains a different original Terrain source.');
  const journal = { schema: 'upstate.terrain-report-browser/v1', case_id: chapter.inputs.case.id,
    response_id: chapter.inputs.response.id, report_source_id: chapter.report_source.id,
    source: chapter.source, workspaces: [], attachment_views: [],
    personal_visual_acceptance: 'pending producing owner inspection of the exact outgoing files' };
  const origin = new URL(page.url()).origin;
  function responseAt(action, id) {
    return response => {
      const url = new URL(response.url());
      return url.origin === origin && url.pathname === '/api/terrain-conditioning' &&
        url.searchParams.get('action') === action && (!id || url.searchParams.get('id') === id);
    };
  }
  async function readWithClick(action, id, locator, label) {
    const pending = page.waitForResponse(responseAt(action, id));
    await locator.click();
    return originalJSON(await pending, label);
  }
  async function openResponse(workspace) {
    await sourcesDesk(workspace);
    await page.locator('[data-view="terrain-conditioning"]').click();
    const caseButton = page.locator('[data-open="' + chapter.inputs.case.id + '"]');
    await caseButton.waitFor({ state: 'visible' });
    const caseValue = await readWithClick('get', chapter.inputs.case.id, caseButton, 'Original Terrain case');
    requireValue(caseValue.workspace_key === workspace, 'Terrain opened another Workspace.');
    same(core(caseValue), chapter.inputs.case, 'Terrain opened a different original saved case.');
    const response = await readWithClick('response', chapter.inputs.response.id,
      page.locator('[data-response="' + chapter.inputs.response.id + '"]'), 'Original Terrain response');
    same(core(response), chapter.inputs.response, 'Terrain changed the completed original native response.');
    requireValue(response.workspace_key === workspace, 'Terrain response belongs to another Workspace.');
    await page.locator('[data-report-field="title"]').waitFor({ state: 'visible' });
  }
  const selectedKey = receipt.selected_study_receiving.workspace_key;
  for (const [label, workspace] of [['original', receipt.original_workspace_key],
      ['full-received', receipt.restored_workspace_key], ['selected-study', selectedKey]]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openResponse(workspace);
    await page.locator('[data-report-field="title"]').fill(chapter.request.selection.title);
    await page.locator('[data-report-field="reason"]').fill(chapter.request.selection.reason);
    const pending = page.waitForResponse(response =>
      new URL(response.url()).origin === origin &&
      new URL(response.url()).pathname === '/api/terrain-conditioning/report-source-preview');
    await page.locator('[data-report-preview]').click();
    const preview = await originalJSON(await pending, 'Terrain scientific source preview');
    requireValue(preview.workspace_key === workspace && preview.id === chapter.report_source.id,
      'The Terrain preview changed its original scientific source.');
    same(preview.selection, chapter.request.selection, 'The authored Terrain choices changed.');
    same(preview.binding, chapter.report_source.binding, 'The preview changed original native Terrain support.');
    await page.locator('#tc-report-source').selectOption(chapter.report_source.id);
    const detail = await readWithClick('report-source', chapter.report_source.id,
      page.locator('[data-report-open]'), 'Retained Terrain report source');
    same(core(detail), chapter.report_source, 'The restored Terrain report source differs.');
    requireValue(detail.workspace_key === workspace, 'Terrain source belongs to another Workspace.');
    await page.locator('[data-report-compose]').waitFor({ state: 'visible' });
    await shot('terrain-' + label + '-desktop', '#tc-native-response');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot('terrain-' + label + '-narrow', '#tc-native-response');
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (workspace === selectedKey) {
      const pendingRecord = page.waitForEvent('download');
      await page.locator('[data-report-download]').click();
      const recordDownload = await pendingRecord;
      const recordPath = join(outputDirectory, 'downloads', 'terrain-source-record.json');
      await recordDownload.saveAs(recordPath);
      requireValue(!(await recordDownload.failure()), 'The complete Terrain source record did not download.');
      same(core(JSON.parse(await readFile(recordPath, 'utf8'))), chapter.report_source,
        'The downloaded Terrain source record changed.');
      const tickets = detail._downloads || [];
      requireValue(tickets.length === chapter.report_source.files.length,
        'The received Terrain source omitted original attachments.');
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i], member = chapter.report_source.files[i];
        requireValue(ticket.bytes === member.bytes && ticket.sha256 === member.sha256,
          'A received Terrain file ticket changed.');
        const links = page.locator('#tc-report-result a[download]');
        const index = await links.evaluateAll((nodes, url) =>
          nodes.findIndex(node => node.getAttribute('href') === url + '?download=1'), ticket.url);
        requireValue(index >= 0, 'The Terrain source omitted its original download control.');
        const enclosing = links.nth(index).locator('xpath=ancestor::details');
        if (await enclosing.count() && !(await enclosing.evaluate(node => node.open)))
          await enclosing.locator('summary').click();
        await download(links.nth(index), member,
          'terrain-' + String(i).padStart(3, '0') + '-' + ticket.filename,
          'terrain_source_' + i);
      }
    }
    await page.locator('[data-report-compose]').click();
    await page.locator('.scientific-report-editions').waitFor({ state: 'visible' });
    await previewSources([chapter.source], workspace);
    await shot('terrain-' + label + '-ordered-composer', '.scientific-report-editions');
    journal.workspaces.push({ label, workspace_key: workspace, source_id: detail.id });
  }
  // Reopen the same local completed files downloaded through native tickets.
  // Browser policy failures remain failures; no alternative navigation route.
  for (const item of chapter.downloads) {
    const extension = item.path.toLowerCase().split('.').pop();
    if (!['html', 'svg', 'png', 'jpg', 'jpeg', 'pdf'].includes(extension)) continue;
    const view = await page.context().newPage();
    try {
      await view.goto(pathToFileURL(item.path).href, { waitUntil: 'load' });
      if (extension === 'html') await view.locator('body').waitFor({ state: 'visible' });
      if (extension === 'svg') await view.locator('svg').waitFor({ state: 'visible' });
      const name = 'terrain-attachment-' + String(journal.attachment_views.length).padStart(3, '0') + '.png';
      const path = join(outputDirectory, name);
      await view.screenshot({ path, fullPage: true, animations: 'disabled' });
      journal.attachment_views.push({ path: item.path, bytes: item.bytes, sha256: item.sha256,
        screenshot: relative(outputDirectory, path), pdf_all_pages_personally_viewed: false });
    } finally { await view.close(); }
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openResponse(selectedKey);
  await page.locator('#tc-report-result [data-report-compose]').waitFor({ state: 'visible' });
  requireValue(await page.locator('#tc-report-source').inputValue() === chapter.report_source.id,
    'Reload lost the exact received Terrain source choice.');
  same({ title: await page.locator('[data-report-field="title"]').inputValue(),
         reason: await page.locator('[data-report-field="reason"]').inputValue() },
       { title: chapter.request.selection.title, reason: chapter.request.selection.reason },
       'Reload changed the original Terrain interpretation draft.');
  await shot('terrain-selected-study-reopened', '#tc-native-response');
  journal.state = 'complete';
  return journal;
}
