/**
 * Operate the original CanadaBuys desk through a caller-owned Playwright Page.
 *
 * The caller supplies the running application and its retained notice. This module
 * starts no server, installs no dependencies, and has no replacement API or feed.
 * Optional review/workshare objects are actual edits; supplied nested arrays replace
 * those arrays through the visible form. Without them, existing saved records open.
 *
 * import { operateCanadaBuysDesk } from './operator/OPERATING_JOURNEY.mjs';
 * const result = await operateCanadaBuysDesk({
 *   page, url: originalServerUrl, noticeId: originalNoticeId,
 *   workshareId: savedWorkshareId, outputDirectory: originalCaseDirectory,
 *   receivingUrl: originalReceivingServerUrl
 * });
 *
 * The returned directory contains source bytes, original rows, visible browser text,
 * screenshots, saved identities, reports, and the same package used for receiving.
 */
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const quote = value => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ').replace(/\r/g, '\\d ') + '"';
const recordSelector = (attribute, value) => '[' + attribute + '=' + quote(value) + ']';

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function amountInput(cents) {
  requireCondition(Number.isSafeInteger(cents) && cents >= 0, 'Amounts must be non-negative integer cents.');
  return Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
}

function objectDiff(expected, actual, prefix = '') {
  const out = [];
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      out.push({ field: prefix, expected, actual: actual ?? null });
      return out;
    }
    expected.forEach((value, index) => out.push(...objectDiff(value, actual[index], prefix + '[' + index + ']')));
    return out;
  }
  if (expected && typeof expected === 'object') {
    for (const [key, value] of Object.entries(expected)) {
      out.push(...objectDiff(value, actual?.[key], prefix ? prefix + '.' + key : key));
    }
    return out;
  }
  if (expected !== actual) out.push({ field: prefix, expected: expected ?? null, actual: actual ?? null });
  return out;
}

async function responseJson(response, label) {
  let raw;
  try { raw = await response.text(); } finally { if (typeof response.dispose === 'function') await response.dispose(); }
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error(label + ' returned non-JSON HTTP ' + response.status() + '.'); }
  if (!response.ok()) {
    const error = new Error(label + ': ' + (value?.error?.message || response.status()));
    error.code = value?.error?.code;
    error.details = value?.error?.details;
    error.status = response.status();
    throw error;
  }
  return value;
}

async function jsonRead(page, baseUrl, route) {
  const response = await page.request.get(new URL(route, baseUrl).href, { failOnStatusCode: false });
  return responseJson(response, route);
}

async function submit(page, route, method, control) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === route && response.request().method() === method),
    control.click()
  ]);
  const result = await responseJson(response, method + ' ' + route);
  requireCondition(result?.workspace && Array.isArray(result.notices), 'The saved operation did not return the complete workspace.');
  await page.waitForFunction(revision => {
    const status = document.getElementById('status')?.textContent || '';
    return status.includes('revision ' + revision) && !document.querySelector('[data-write-fieldset]:disabled');
  }, result.workspace.revision);
  return { result, request: response.request().postDataJSON(), status: response.status() };
}

async function fillFields(page, object, mapping) {
  for (const [key, selector] of Object.entries(mapping)) {
    if (owns(object, key)) await page.locator(selector).fill(String(object[key] ?? ''));
  }
}

async function removeRows(page, selector) {
  const rows = page.locator(selector);
  while (await rows.count()) await rows.last().getByRole('button', { name: 'Remove', exact: true }).click();
}

async function applyReview(page, input) {
  await fillFields(page, input, {
    owner: '#review-owner', nextAction: '#review-next-action', note: '#review-note'
  });
  if (owns(input, 'disposition')) await page.locator('#review-disposition').selectOption(input.disposition);
  if (owns(input, 'shortlisted')) await page.locator('#review-shortlisted').setChecked(Boolean(input.shortlisted));
  const qualification = input.qualification || {};
  await fillFields(page, qualification, {
    capability: '#qualification-capability', eligibility: '#qualification-eligibility',
    commercial: '#qualification-commercial', timing: '#qualification-timing'
  });
  if (owns(qualification, 'requirements')) {
    requireCondition(Array.isArray(qualification.requirements), 'qualification.requirements must be an array.');
    await removeRows(page, '#qualification-form [data-requirement-id]');
    for (const [index, row] of qualification.requirements.entries()) {
      await page.locator('#add-requirement').click();
      await fillFields(page, row, {
        requirement: '#requirement-' + index,
        source: '#requirement-source-' + index,
        note: '#requirement-note-' + index
      });
      if (owns(row, 'status')) await page.locator('#requirement-state-' + index).selectOption(row.status);
    }
  }
}

async function applyWorkshare(page, input) {
  await fillFields(page, input, {
    title: '#workshare-title', owner: '#workshare-owner', partner: '#workshare-partner',
    currency: '#workshare-currency', scope: '#workshare-scope',
    deliverables: '#workshare-deliverables', partnerResponsibilities: '#workshare-partner-responsibilities',
    inputs: '#workshare-inputs', acceptance: '#workshare-acceptance',
    estimatedHours: '#workshare-estimated-hours', partnerHours: '#workshare-partner-hours',
    availableFrom: '#workshare-available-from', deliveryDays: '#workshare-delivery-days', note: '#workshare-note'
  });
  if (owns(input, 'status')) await page.locator('#workshare-status').selectOption(input.status);
  if (owns(input, 'feeCents')) await page.locator('#workshare-fee').fill(amountInput(input.feeCents));
  if (owns(input, 'milestones')) {
    requireCondition(Array.isArray(input.milestones), 'workshare.milestones must be an array.');
    await removeRows(page, '#workshare-form [data-milestone-id]');
    for (const [index, row] of input.milestones.entries()) {
      await page.locator('#add-milestone').click();
      await fillFields(page, row, {
        title: '#milestone-title-' + index, due: '#milestone-due-' + index,
        acceptance: '#milestone-acceptance-' + index
      });
      await page.locator('#milestone-amount-' + index).fill(amountInput(row.amountCents));
    }
  }
  if (owns(input, 'costs')) {
    requireCondition(Array.isArray(input.costs), 'workshare.costs must be an array.');
    await removeRows(page, '#workshare-form [data-cost-id]');
    for (const [index, row] of input.costs.entries()) {
      await page.locator('#add-cost').click();
      await page.locator('#cost-title-' + index).fill(String(row.title ?? ''));
      await page.locator('#cost-amount-' + index).fill(amountInput(row.amountCents));
    }
  }
}

async function openDesk(page, baseUrl, noticeId) {
  const target = new URL(baseUrl);
  target.hash = new URLSearchParams({ notice: noticeId }).toString();
  await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  await page.locator('#search').waitFor({ state: 'visible' });
  await page.waitForFunction(() => /revision \d+/.test(document.getElementById('status')?.textContent || ''));
  await page.locator('#search').fill(noticeId);
  await page.locator(recordSelector('data-notice-id', noticeId)).click();
  await page.locator('#notice-language').selectOption('both');
  await page.locator('#tab-source').click();
  await page.locator('#download-original-source').waitFor({ state: 'visible' });
}

async function saveDownload(page, button, directory, name) {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = join(directory, name);
  await download.saveAs(path);
  const failure = await download.failure();
  if (failure) throw new Error('Download ' + name + ': ' + failure);
  const bytes = await readFile(path);
  return { file: name, path, suggestedFilename: download.suggestedFilename(), bytes: bytes.length, sha256: sha256(bytes) };
}

async function originalFields(page) {
  const card = page.locator('#active-panel .card').filter({
    has: page.getByRole('heading', { name: 'Original CSV fields', exact: true })
  });
  return card.locator('tbody tr').evaluateAll(rows => rows.map(row => {
    const cells = row.querySelectorAll('td');
    return [cells[0]?.textContent || '', cells[1]?.textContent || ''];
  }));
}

async function openSavedWorkshare(page, workshareId) {
  await page.locator('#tab-workshare').click();
  const choice = page.locator(recordSelector('data-workshare-id', workshareId));
  if (await choice.count()) await choice.click();
  await page.locator('#workshare-form').waitFor({ state: 'visible' });
  const visibleId = await page.locator('#workshare-form .identity code').textContent();
  requireCondition(visibleId === workshareId, 'The browser opened a different workshare identity.');
}

function reviewContent(record) {
  return {
    disposition: record?.disposition ?? 'unreviewed',
    owner: record?.owner ?? '', nextAction: record?.nextAction ?? '',
    note: record?.note ?? '', shortlisted: record?.shortlisted ?? false,
    qualification: record?.qualification ?? { requirements: [], capability: '', eligibility: '', commercial: '', timing: '' }
  };
}

function workshareContent(record) {
  if (!record) return null;
  const keys = [
    'noticeId', 'title', 'status', 'partner', 'owner', 'currency', 'feeCents',
    'estimatedHours', 'partnerHours', 'availableFrom', 'deliveryDays',
    'scope', 'deliverables', 'partnerResponsibilities', 'inputs', 'acceptance',
    'milestones', 'costs', 'note'
  ];
  return Object.fromEntries(keys.filter(key => owns(record, key)).map(key => [key, record[key]]));
}

/**
 * @param {object} options
 * @param {import('playwright').Page} options.page Existing browser page.
 * @param {string} options.url Original running CanadaBuys operator URL.
 * @param {string} options.noticeId A retained original notice identity.
 * @param {string} options.outputDirectory Parent directory of the original case.
 * @param {string} [options.workshareId] Existing saved workshare to operate.
 * @param {object} [options.review] Actual supplied review changes.
 * @param {object} [options.workshare] Actual supplied new/existing workshare changes.
 * @param {string} [options.receivingUrl] Existing original receiving application.
 * @returns {Promise<object>} Actual browser results and durable-case member paths.
 */
export async function operateCanadaBuysDesk({
  page, url, noticeId, outputDirectory, workshareId = null,
  review, workshare, receivingUrl
}) {
  requireCondition(page?.goto && page?.request && page?.locator, 'Supply the existing Playwright Page.');
  requireCondition(typeof noticeId === 'string' && noticeId.length > 0, 'Supply an actual retained notice ID.');
  requireCondition(typeof outputDirectory === 'string' && outputDirectory.length > 0, 'Supply the original case output directory.');
  requireCondition(['http:', 'https:'].includes(new URL(url).protocol), 'The original workspace URL must be HTTP or HTTPS.');
  if (workshare?.noticeId) requireCondition(workshare.noticeId === noticeId, 'The workshare must belong to the selected original notice.');
  if (workshare?.id && workshareId) requireCondition(workshare.id === workshareId, 'The supplied existing workshare IDs differ.');

  await mkdir(resolve(outputDirectory), { recursive: true });
  const directory = await mkdtemp(join(resolve(outputDirectory), 'canadabuys-operator-'));
  const result = {
    schema: 'commons.canadabuys.operator-journey.v1',
    startedAt: new Date().toISOString(), directory, url, noticeId,
    stage: 'open-original', status: 'running', downloads: {}, screenshots: [],
    saved: {}, browserErrors: []
  };
  const saveJSON = async (name, value) => {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await writeFile(join(directory, name), bytes);
    return { file: name, path: join(directory, name), bytes: bytes.length, sha256: sha256(bytes) };
  };
  const checkpoint = async () => saveJSON('result.json', result);
  const screenshot = async (target, name) => {
    const path = join(directory, name);
    await target.screenshot({ path, fullPage: true });
    const bytes = await readFile(path);
    const record = { file: name, path, bytes: bytes.length, sha256: sha256(bytes) };
    result.screenshots.push(record);
    return record;
  };
  const pageError = error => result.browserErrors.push({ page: 'operator', message: String(error.message || error) });
  page.on('pageerror', pageError);
  let receiver;
  let receiverError;
  try {
    const initial = await jsonRead(page, url, '/api/workspace');
    requireCondition(initial.workspace && Array.isArray(initial.notices), 'The original server did not return a CanadaBuys workspace.');
    requireCondition(initial.notices.some(notice => notice.id === noticeId), 'The selected notice is not retained in this workspace.');
    result.workspace = plain(initial.workspace);
    const detailRead = await jsonRead(page, url, '/api/notices/' + encodeURIComponent(noticeId));
    const original = detailRead.notice || detailRead;
    requireCondition(original.id === noticeId && original.currentEntry?.row && Array.isArray(original.history),
      'The original notice lacks its complete current row or source history.');
    result.originalNotice = await saveJSON('original-notice.json', original);
    const sourceId = original.currentEntry.sourceId;
    const sourceRead = await jsonRead(page, url, '/api/sources/' + encodeURIComponent(sourceId));
    const source = sourceRead.source || sourceRead;
    requireCondition(typeof source.rawText === 'string', 'The original source response lacks complete rawText.');
    result.source = {
      id: sourceId, stream: source.stream, label: source.label,
      url: source.url, retrievedAt: source.retrievedAt, bytes: source.bytes,
      sha256: source.sha256, rowCount: source.rowCount,
      currentEntryId: original.currentEntry.id, rowNumber: original.currentEntry.rowNumber
    };
    await openDesk(page, url, noticeId);
    const shownFields = await originalFields(page);
    const expectedFields = Object.entries(original.currentEntry.row).map(([heading, value]) => [heading, String(value ?? '')]);
    requireCondition(JSON.stringify(shownFields) === JSON.stringify(expectedFields),
      'The visible original-row table differs from the selected complete source row.');
    result.originalFields = await saveJSON('visible-original-fields.json', shownFields);
    result.downloads.originalSource = await saveDownload(page, page.locator('#download-original-source'), directory, 'original-source.csv');
    const originalBytes = Buffer.from(source.rawText, 'utf8');
    requireCondition(result.downloads.originalSource.bytes === originalBytes.length &&
      result.downloads.originalSource.sha256 === sha256(originalBytes),
      'The browser source download differs from the native retained original bytes.');
    if (Number.isSafeInteger(source.bytes)) requireCondition(source.bytes === originalBytes.length, 'The source length differs from its metadata.');
    if (source.sha256) requireCondition(source.sha256.toLowerCase() === sha256(originalBytes), 'The source SHA-256 differs from its metadata.');
    await screenshot(page, '01-original-source.png');

    result.stage = 'read-bilingual-notice';
    await page.locator('#tab-notice').click();
    const noticeText = await page.locator('#active-panel').innerText();
    result.noticeText = await saveJSON('visible-bilingual-notice.json', {
      noticeId, currentEntryId: original.currentEntry.id,
      text: noticeText,
      descriptions: await page.locator('#active-panel section[lang]').evaluateAll(sections => sections.map(section => ({
        language: section.lang, text: section.textContent
      }))),
      closing: original.currentEntry.summary?.closing || original.summary?.closing,
      noticeType: original.currentEntry.summary?.noticeType || original.summary?.noticeType
    });
    await screenshot(page, '02-bilingual-notice.png');
    await checkpoint();

    result.stage = 'qualification';
    await page.locator('#tab-qualification').click();
    if (review !== undefined) {
      requireCondition(review && typeof review === 'object' && !Array.isArray(review), 'review must be an object of actual changes.');
      await applyReview(page, review);
      if (await page.locator('#save-review').isEnabled()) {
        const saved = await submit(page, '/api/notices/' + encodeURIComponent(noticeId) + '/review', 'PATCH', page.locator('#save-review'));
        result.saved.reviewOperation = {
          status: saved.status, expectedRevision: saved.request.expectedRevision,
          workspaceRevision: saved.result.workspace.revision
        };
        const row = saved.result.notices.find(notice => notice.id === noticeId);
        requireCondition(row, 'The saved workspace omitted the reviewed notice.');
        const expected = plain(review);
        for (const key of ['id','revision','createdAt','updatedAt','history','expectedRevision']) delete expected[key];
        if (expected.qualification?.requirements) expected.qualification.requirements =
          expected.qualification.requirements.map(({id,...fields})=>fields);
        const differences = [
          ...objectDiff(expected, row.review),
          ...objectDiff(reviewContent(saved.request), reviewContent(row.review))
        ];
        requireCondition(differences.length === 0, 'The saved review differs from supplied form values: ' + JSON.stringify(differences));
      }
    }
    const reviewedWorkspace = await jsonRead(page, url, '/api/workspace');
    const reviewed = reviewedWorkspace.notices.find(notice => notice.id === noticeId);
    result.saved.review = plain(reviewed.review || reviewContent(null));
    result.reviewRecord = await saveJSON('saved-review.json', result.saved.review);
    result.qualificationText = await page.locator('#qualification-form').innerText();
    await screenshot(page, '03-qualification.png');
    await checkpoint();

    result.stage = 'partner-workshare';
    if (workshareId) {
      const existingRead = await jsonRead(page, url, '/api/workshares/' + encodeURIComponent(workshareId));
      const existing = existingRead.workshare || existingRead;
      requireCondition(existing.noticeId === noticeId, 'The saved workshare belongs to another notice.');
      await openSavedWorkshare(page, workshareId);
    } else if (workshare !== undefined) {
      await page.locator('#tab-workshare').click();
      await page.locator('#prepare-workshare').click();
      await page.locator('#workshare-form').waitFor({ state: 'visible' });
    }
    if (workshare !== undefined) {
      requireCondition(workshare && typeof workshare === 'object' && !Array.isArray(workshare), 'workshare must be an object of actual changes.');
      await applyWorkshare(page, workshare);
      if (await page.locator('#save-workshare').isEnabled()) {
        const route = workshareId ? '/api/workshares/' + encodeURIComponent(workshareId) : '/api/workshares';
        const saved = await submit(page, route, workshareId ? 'PATCH' : 'POST', page.locator('#save-workshare'));
        workshareId = saved.result.workshare?.id || saved.request.id;
        requireCondition(typeof workshareId === 'string' && workshareId.length > 0, 'The saved workshare request lacks its original identity.');
        const actual = saved.result.workshares.find(record => record.id === workshareId);
        requireCondition(actual, 'The saved workspace omitted the workshare.');
        const expected = workshareContent(workshare);
        for (const key of ['milestones','costs']) if (expected[key]) expected[key] = expected[key].map(({id,...fields})=>fields);
        if (expected.currency) expected.currency = expected.currency.toUpperCase();
        const differences = [...objectDiff(expected, actual), ...objectDiff(workshareContent(saved.request), workshareContent(actual))];
        requireCondition(differences.length === 0, 'The saved workshare differs from supplied form values: ' + JSON.stringify(differences));
        result.saved.workshareOperation = {
          status: saved.status, id: workshareId, expectedRevision: saved.request.expectedRevision,
          workspaceRevision: saved.result.workspace.revision, recordRevision: actual.revision
        };
      }
    }
    if (workshareId) {
      const savedRead = await jsonRead(page, url, '/api/workshares/' + encodeURIComponent(workshareId));
      const saved = savedRead.workshare || savedRead;
      result.saved.workshare = {
        id: saved.id, noticeId: saved.noticeId, revision: saved.revision,
        title: saved.title, status: saved.status, currency: saved.currency, feeCents: saved.feeCents
      };
      result.workshareRecord = await saveJSON('saved-workshare.json', saved);
      result.workshareValues = workshareContent(saved);
      result.workshareVisible = await saveJSON('visible-workshare.json', {
        text: await page.locator('#workshare-form').innerText(),
        budget: await page.locator('#workshare-budget').innerText(),
        values: await page.locator('#workshare-form input, #workshare-form textarea, #workshare-form select')
          .evaluateAll(controls => Object.fromEntries(controls.map(control => [control.id, control.value])))
      });
      result.downloads.workshareHandover = await saveDownload(page,
        page.getByRole('button', { name: 'Download saved handover', exact: true }),
        directory, 'partner-workshare.html');
      const handover = await readFile(result.downloads.workshareHandover.path, 'utf8');
      requireCondition(handover.includes(saved.id), 'The downloaded handover omits its saved workshare identity.');
      await screenshot(page, '04-partner-workshare.png');
    }
    await checkpoint();

    result.stage = 'reports-and-package';
    await page.locator('[data-mode="reports"]').click();
    await page.locator('#report-scope').selectOption('all');
    for (const format of ['html', 'csv', 'json']) {
      result.downloads['report_' + format] = await saveDownload(page,
        page.locator('#export-' + format), directory, 'canadabuys-report.' + format);
    }
    result.downloads.workspacePackage = await saveDownload(page,
      page.locator('#export-whole-package'), directory, 'canadabuys-workspace.json');
    const pkg = JSON.parse(await readFile(result.downloads.workspacePackage.path, 'utf8'));
    result.package = {
      schema: pkg.schema, packageId: pkg.packageId,
      bytes: result.downloads.workspacePackage.bytes, sha256: result.downloads.workspacePackage.sha256
    };
    await screenshot(page, '05-reports.png');
    await checkpoint();

    if (receivingUrl) {
      result.stage = 'receive-same-package';
      receiver = await page.context().newPage();
      receiverError = error => result.browserErrors.push({ page: 'receiver', message: String(error.message || error) });
      receiver.on('pageerror', receiverError);
      await receiver.goto(receivingUrl, { waitUntil: 'domcontentloaded' });
      await receiver.waitForFunction(() => /revision \d+/.test(document.getElementById('status')?.textContent || ''));
      const before = await jsonRead(receiver, receivingUrl, '/api/workspace');
      await receiver.locator('#receive-workspace').click();
      await receiver.locator('#receive-file').setInputFiles(result.downloads.workspacePackage.path);
      await receiver.waitForFunction(() => (document.getElementById('receive-info')?.textContent || '').includes(' bytes'));
      const receipt = await submit(receiver, '/api/receive', 'POST', receiver.locator('#submit-receive'));
      requireCondition(receipt.request.package?.packageId === pkg.packageId, 'The receiving form submitted a different package identity.');
      requireCondition(sha256(Buffer.from(JSON.stringify(receipt.request.package))) === sha256(Buffer.from(JSON.stringify(pkg))),
        'The receiving form changed the saved package content.');
      result.receiving = {
        url: receivingUrl, before: before.workspace,
        after: receipt.result.workspace, receiving: receipt.result.receiving || null,
        expectedRevision: receipt.request.expectedRevision, packageId: pkg.packageId
      };
      await saveJSON('receiving-operation.json', result.receiving);
      await openDesk(receiver, receivingUrl, noticeId);
      const receivedRead = await jsonRead(receiver, receivingUrl, '/api/notices/' + encodeURIComponent(noticeId));
      const receivedNotice = receivedRead.notice || receivedRead;
      requireCondition(receivedNotice.history?.some(entry => entry.id === original.currentEntry.id && entry.sourceId === sourceId),
        'The receiver did not retain the original notice source identity.');
      const receivedSourceRead = await jsonRead(receiver, receivingUrl, '/api/sources/' + encodeURIComponent(sourceId));
      const receivedSource = receivedSourceRead.source || receivedSourceRead;
      requireCondition(typeof receivedSource.rawText === 'string' &&
        sha256(Buffer.from(receivedSource.rawText, 'utf8')) === sha256(originalBytes),
        'The receiver changed the retained original source bytes.');
      result.receiving.sourceMatches = true;
      result.receiving.notice = await saveJSON('received-notice.json', receivedNotice);
      result.receiving.reviewDifferences = objectDiff(reviewContent(result.saved.review), reviewContent(receivedNotice.review));
      await screenshot(receiver, '06-received-original-source.png');
      if (workshareId) {
        await openSavedWorkshare(receiver, workshareId);
        const receivedWorkshareRead = await jsonRead(receiver, receivingUrl, '/api/workshares/' + encodeURIComponent(workshareId));
        const receivedWorkshare = receivedWorkshareRead.workshare || receivedWorkshareRead;
        result.receiving.workshare = await saveJSON('received-workshare.json', receivedWorkshare);
        result.receiving.workshareDifferences = objectDiff(result.workshareValues, workshareContent(receivedWorkshare));
        result.receiving.workshareIdentity = { id: receivedWorkshare.id, noticeId: receivedWorkshare.noticeId, revision: receivedWorkshare.revision };
        await screenshot(receiver, '07-received-partner-workshare.png');
      }
      if (pkg.packageId) {
        const retainedReceiving = await jsonRead(receiver, receivingUrl, '/api/receiving/' + encodeURIComponent(pkg.packageId));
        result.receiving.record = await saveJSON('retained-receiving-record.json', retainedReceiving.receiving || retainedReceiving);
      }
      await saveJSON('receiving-operation.json', result.receiving);
    }
    result.stage = 'complete';
    result.status = 'completed';
    result.completedAt = new Date().toISOString();
    await checkpoint();
    return result;
  } catch (error) {
    result.status = 'failed';
    result.failedAt = new Date().toISOString();
    result.error = { message: error.message, code: error.code, status: error.status, details: error.details };
    try { await screenshot(receiver || page, 'failure-at-' + result.stage + '.png'); } catch {}
    await checkpoint();
    error.operatorJourneyDirectory = directory;
    error.operatorJourneyResult = result;
    throw error;
  } finally {
    page.off('pageerror', pageError);
    if (receiver && receiverError) receiver.off('pageerror', receiverError);
    if (receiver) await receiver.close().catch(() => {});
  }
}
