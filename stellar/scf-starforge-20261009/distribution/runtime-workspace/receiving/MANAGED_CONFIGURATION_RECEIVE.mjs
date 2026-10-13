// MIT. Complete phase for the existing isolated Runtime native receiving course.
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openRuntimeWorkspace } from '../model.mjs';
import { saveJSON } from '../storage.mjs';
const check = (value, message) => { if (!value) throw new Error(message); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function receiveManagedConfiguration({ page, model, outputDirectory, homeId, paths }) {
  check(Array.isArray(paths) && paths.length === 2 && new Set(paths).size === 2, 'Choose two original receiving configuration files.');
  const directory = join(outputDirectory, 'managed-configuration', randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
  const source = [];
  for (const path of ['managed-configuration-history.mjs', 'managed-workspace.mjs', 'model.mjs', 'server.mjs',
    'cli.mjs', 'public/managed.mjs', 'public/managed-configuration.mjs',
    'public/managed-configuration-drafts.mjs', 'public/managed-configuration.css',
    'browser-assets.json', 'MANAGED_CONFIGURATION.md', 'receiving/MANAGED_CONFIGURATION_RECEIVE.mjs']) {
    const bytes = await readFile(join(sourceRoot, path)); source.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
  const initial = await Promise.all(paths.map(path => model.managedConfig({ homeId, path })));
  check(initial.every(value => value.exists && value.bytes < 19995 && typeof value.content === 'string'),
    'Both selected receiving files must exist and fit the original editor.');
  const input = { homeId, paths, initial, source };
  await saveJSON(join(directory, 'input.json'), input);
  const screenshots = [], downloads = [], operations = [];
  const pane = page.locator('#managed-configuration-desk');
  await page.locator('[data-view="managed"]').click();
  await page.locator('#managed-home').selectOption(homeId);
  await pane.locator('[data-field="path"]').waitFor();
  async function openFile(path) {
    await pane.locator('[data-field="path"]').fill(path);
    await pane.locator('[data-form="open"] button').click();
    await page.waitForFunction(path => document.querySelector('#managed-configuration-desk [data-field="identity"]')?.textContent.startsWith(path + ' ·'), path);
  }
  async function screenshot(name, width) {
    await page.setViewportSize({ width, height: 960 });
    const file = join(directory, name + '.png'); await page.screenshot({ path: file, fullPage: true }); screenshots.push(file);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Configuration controls overflow the viewport.');
  }
  async function submitClick(button) {
    const pending = page.waitForResponse(response => response.url().endsWith('/api/operation') && response.request().method() === 'POST');
    await button.click();
    const response = await pending, value = await response.json();
    check(response.ok() && value.operationId, 'Original configuration admission failed: ' + JSON.stringify(value));
    return value.operationId;
  }
  async function completeSelected(id) {
    let status;
    for (let attempt = 0; attempt < 240; attempt++) {
      status = await model.operationStatus({ operationId: id });
      if (status.phase === 'SUCCEEDED' || status.phase === 'FAILED') break;
      await page.waitForTimeout(250);
    }
    check(status?.phase === 'SUCCEEDED', 'Original managed operation did not succeed: ' + JSON.stringify(status));
    if (await pane.locator('[data-act="recover"]').isEnabled())
      await pane.locator('[data-act="recover"]').click();
    await page.waitForFunction(() => !document.querySelector('#managed-configuration-desk [data-field="pending"]')?.textContent);
    operations.push({ id, status });
    return id;
  }
  // Original two-file editing exercises the previously overwritten draft.
  await openFile(paths[0]); await pane.locator('[data-field="content"]').fill(initial[0].content + '\n');
  await openFile(paths[1]); await pane.locator('[data-field="content"]').fill(initial[1].content + '\n');
  await openFile(paths[0]);
  check(await pane.locator('[data-field="content"]').inputValue() === initial[0].content + '\n', 'First file entered bytes were lost.');
  await pane.locator('[data-act="compare"]').click();
  await pane.locator('[data-field="comparison"] pre').first().waitFor();
  await screenshot('desktop-two-entered-files', 1360);
  const draftEvent = page.waitForEvent('download'); await pane.locator('[data-act="draft-export"]').click();
  const draftDownload = await draftEvent, draftPath = join(directory, 'entered-files.json');
  await draftDownload.saveAs(draftPath);
  const entered = JSON.parse(await readFile(draftPath, 'utf8'));
  check(paths.every((path, index) => entered.files.some(file => file.path === path && file.content === initial[index].content + '\n')),
    'Downloaded entered-file set omitted original drafts.');
  downloads.push(draftPath);
  // Hold only the response to this actual first native save. The original
  // worker remains authoritative while the operator switches to another file.
  let releaseReply, acceptedResolve, acceptedReject, finishedResolve;
  const replyGate = new Promise(resolve => { releaseReply = resolve; });
  const admission = new Promise((resolve, reject) => { acceptedResolve = resolve; acceptedReject = reject; });
  const finished = new Promise(resolve => { finishedResolve = resolve; });
  let held = false;
  const routePattern = '**/api/operation';
  const holdReply = async route => {
    const request = route.request().postDataJSON();
    if (held || request.operation !== 'managed-config-save' || request.homeId !== homeId || request.path !== paths[0])
      return route.continue();
    held = true;
    try {
      const response = await route.fetch(), value = await response.json();
      check(response.ok() && value.operationId, 'Actual first native save was not admitted.');
      acceptedResolve(value.operationId);
      await replyGate; await route.fulfill({ response });
    } catch (error) { acceptedReject(error); throw error; }
    finally { finishedResolve(); }
  };
  let firstId;
  await page.route(routePattern, holdReply);
  try {
    await pane.locator('[data-act="save"]').click(); firstId = await admission;
    await openFile(paths[1]);
    check(await pane.locator('[data-field="content"]').isEnabled() &&
      await pane.locator('[data-field="content"]').inputValue() === initial[1].content + '\n',
    'Switching during a pending original save disabled or replaced the other file draft.');
  } finally {
    releaseReply(); if (held) await finished;
    await page.unroute(routePattern, holdReply);
  }
  for (let index = 0; index < paths.length; index++) {
    await openFile(paths[index]);
    const id = await completeSelected(index === 0 ? firstId : await submitClick(pane.locator('[data-act="save"]')));
    const entry = await model.managedConfigurationHistory({ homeId, operationId: id });
    check(entry.intent.before.sha256 === initial[index].sha256 &&
      entry.intent.before.content === initial[index].content &&
      entry.intent.after.content === initial[index].content + '\n' && entry.result,
    'Native history omitted exact original before/after bytes.');
    const row = pane.locator('[data-field="history"] article').filter({ hasText: id });
    await row.getByRole('button', { name: 'Open complete edition', exact: true }).click();
    await pane.getByRole('button', { name: 'Restore before bytes', exact: true }).waitFor();
    await screenshot('phone-complete-edition-' + index, 390);
    await completeSelected(await submitClick(pane.getByRole('button', { name: 'Restore before bytes', exact: true })));
    const restored = await model.managedConfig({ homeId, path: paths[index] });
    check(restored.sha256 === initial[index].sha256 && restored.content === initial[index].content,
      'Historical restoration did not recover the complete original file.');
    const downloadEvent = page.waitForEvent('download'); await pane.locator('[data-act="export"]').click();
    const archive = await downloadEvent, path = join(directory, 'history-' + index + '.jsonl');
    await archive.saveAs(path); downloads.push(path);
    const rows = (await readFile(path, 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line));
    check(rows.at(-1).schema === 'stellar-forge.managed-configuration-export-complete.v1' &&
      rows.at(-1).editions === rows.length - 2 &&
      rows.some(row => row.intent?.operationId === id && row.intent.before.sha256 === initial[index].sha256),
    'Complete JSONL export lost an original edition or completion record.');
  }
  await page.reload(); await page.locator('[data-view="managed"]').click();
  await page.locator('#managed-home').selectOption(homeId); await openFile(paths[0]);
  await pane.locator('[data-act="history"]').click();
  await pane.locator('[data-field="history"] article').first().waitFor();
  await screenshot('desktop-reopened-original-history', 1360);
  const reopened = await openRuntimeWorkspace({ directory: model.directory });
  try {
    for (let index = 0; index < paths.length; index++)
      check((await reopened.managedConfig({ homeId, path: paths[index] })).sha256 === initial[index].sha256,
        'Reopened native workspace changed original configuration.');
  } finally { await reopened.close(); }
  const output = { schema: 'stellar-forge.managed-configuration-receiving.v1',
    directory, homeId, paths, source, operations, screenshots, downloads,
    originalFilesRestored: true,
    historyPaths: operations.map(value => 'managed-configuration-history/' + homeId + '/' + value.id),
    visualObservation: 'The existing producing operator must open/view these actual screenshots and outgoing downloads.' };
  await saveJSON(join(directory, 'receiving.json'), output); return output;
}
