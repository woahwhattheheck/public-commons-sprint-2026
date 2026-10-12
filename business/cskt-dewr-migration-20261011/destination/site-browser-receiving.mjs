/**
 * Complete receiving of reviewed site records in an already running WordPress.
 * The caller owns the original browser, site, credentials, backup and lifetime.
 * No sample identities, browser launch, service process or controller is created.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) :
  Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
    '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
const same = (a, b) => canonical(a) === canonical(b);
const check = (ok, message) => { if (!ok) throw new Error(message); };
async function syncDirectory(directory) { const h = await fs.open(directory, 'r'); try { await h.sync(); } finally { await h.close(); } }
async function atomic(file, bytes, immutable = false) {
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.stage-' + randomUUID();
  const h = await fs.open(temporary, 'wx', 0o600);
  try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
  try {
    if (immutable) {
      try { await fs.link(temporary, file); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const stat = await fs.lstat(file);
        check(stat.isFile() && !stat.isSymbolicLink(), 'The retained receiving artifact is not a regular file.');
        check(digest(await fs.readFile(file)) === digest(bytes), 'An immutable receiving artifact has different bytes: ' + path.basename(file));
      }
    } else await fs.rename(temporary, file);
    await syncDirectory(path.dirname(file));
  } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function readJson(file) {
  try {
    const stat = await fs.lstat(file); check(stat.isFile() && !stat.isSymbolicLink(), 'Receiving state is not a regular file.');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function inputCheck(input) {
  check(input?.schema === 'cskt.site.receiving.input.v1', 'Use the complete reviewed site receiving input.');
  check(typeof input.operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{5,119}$/.test(input.operationId), 'Retain the original receiving operation ID.');
  check(input.review && /^[0-9a-f]{64}$/.test(input.review.sourceSha256 || '') &&
    typeof input.review.sourceReference === 'string' && input.review.sourceReference.trim() &&
    typeof input.review.reviewedBy === 'string' && input.review.reviewedBy.trim() &&
    Number.isFinite(Date.parse(input.review.reviewedAt)), 'Supply the actual source and review identity; this receiver has no sample staff or vacancies.');
  check(Array.isArray(input.records) && input.records.length >= 2, 'Select the complete reviewed staff and available opportunity records.');
  const keys = new Set();
  for (const record of input.records) {
    check(/^[a-z][a-z0-9_-]{0,59}$/.test(record.key || '') && !keys.has(record.key), 'Each reviewed record needs a distinct stable key.'); keys.add(record.key);
    check(['cskt_staff', 'cskt_opportunity'].includes(record.type), 'Use a native staff or opportunity type.');
    check(record.id == null || Number.isSafeInteger(record.id) && record.id > 0, 'Use the actual native record ID, or omit it for reviewed new content.');
    for (const key of ['title', 'content', 'excerpt']) check(typeof record[key] === 'string', 'Retain the complete reviewed ' + key + '.');
    check(record.title.trim() && record.details && !Array.isArray(record.details), 'Supply the reviewed title and complete native public details.');
    check(Array.isArray(record.departmentIds) && Array.isArray(record.topicIds) &&
      [...record.departmentIds, ...record.topicIds].every(id => Number.isSafeInteger(id) && id > 0), 'Use selected native department/topic IDs.');
    if (record.type === 'cskt_opportunity') check(Array.isArray(record.details.attachmentIds), 'Retain the complete selected native file IDs.');
  }
  check(input.records.some(r => r.type === 'cskt_staff') && input.records.some(r => r.type === 'cskt_opportunity'), 'Include real reviewed staff and available opportunity source. An absent vacancy is not fabricated for receiving.');
  check(input.settings && typeof input.settings.reportingEnabled === 'boolean', 'Supply the complete reviewed site settings.');
  check(input.settings.reportingEnabled === true, 'This receiving checks the enabled aggregate reporting workflow.');
  check(typeof input.searchQuery === 'string' && input.searchQuery.trim() && input.searchQuery.length <= 200, 'Choose a real source-based public search query.');
}
async function api(page, endpoint, method = 'GET', data) {
  return page.evaluate(async ({ endpoint, method, data }) => {
    if (!window.wp?.apiFetch) throw new Error('The native WordPress authenticated API has not loaded.');
    return window.wp.apiFetch({ path: endpoint, method, ...(data === undefined ? {} : { data }) });
  }, { endpoint, method, data });
}
async function waitFor(checker, message, timeout = 45000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    try { const value = await checker(); if (value) return value; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(message + (last ? ': ' + last.message : ''));
}
async function postId(page) {
  return page.evaluate(() => Number(document.querySelector('#post_ID')?.value || window.wp?.data?.select('core/editor')?.getCurrentPostId()));
}
async function readyEditor(page) {
  await page.locator('.cskt-site-editor').waitFor({ state: 'attached' });
  await waitFor(() => page.evaluate(() => !!window.wp?.apiFetch), 'The original native editor API did not become available.');
}
async function fillNamed(page, name, value) { await page.locator('[name="' + name + '"]').fill(value == null ? '' : String(value)); }
async function localDate(page, key, utc) {
  if (!utc) return '';
  const help = await page.locator('[name="cskt_site_details[' + key + ']"]').locator('..').innerText();
  const zone = /Local time in (.+?)\./.exec(help)?.[1];
  check(zone, 'The native form did not expose its selected WordPress time zone.');
  const date = new Date(utc); check(Number.isFinite(date.valueOf()), 'The reviewed UTC opportunity date is invalid.');
  if (/^[+-]\d{2}:\d{2}$/.test(zone)) {
    const offset = (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6))) * (zone[0] === '-' ? -1 : 1);
    return new Date(date.valueOf() + offset * 60000).toISOString().slice(0, 19);
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(p => [p.type, p.value]));
  return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute + ':' + parts.second;
}
async function fillPost(page, record) {
  const classic = await page.locator('#title').isVisible().catch(() => false);
  if (classic) {
    await page.locator('#title').fill(record.title);
    await page.evaluate(content => {
      const editor = window.tinymce?.get('content');
      if (editor && !editor.isHidden()) { editor.setContent(content); editor.save(); }
      const field = document.querySelector('#content'); if (field) field.value = content;
    }, record.content);
    await fillNamed(page, 'excerpt', record.excerpt);
    for (const [taxonomy, selected] of [['cskt_department', record.departmentIds], ['cskt_topic', record.topicIds]]) {
      const boxes = page.locator('[name="tax_input[' + taxonomy + '][]"][type="checkbox"]');
      for (const box of await boxes.all()) await box.setChecked(selected.includes(Number(await box.inputValue())));
      for (const id of selected) check(await boxes.locator('xpath=self::*[@value="' + id + '"]').count(), 'The reviewed native taxonomy ID is not in this editor.');
    }
  } else {
    // This is WordPress's own editor state; the actual Publish/Update and detail
    // metabox submissions below remain the original UI and original native hooks.
    await page.evaluate(record => {
      const editor = window.wp.data.dispatch('core/editor');
      editor.editPost({ title: record.title, content: record.content, excerpt: record.excerpt,
        cskt_department: record.departmentIds, cskt_topic: record.topicIds });
    }, record);
  }
  for (const [key, value] of Object.entries(record.details)) {
    const name = 'cskt_site_details[' + key + ']';
    if (key === 'attachmentIds') continue;
    if (['state', 'kind'].includes(key)) await page.locator('[name="' + name + '"]').selectOption(value);
    else await fillNamed(page, name, ['opensAt', 'closesAt'].includes(key) ? await localDate(page, key, value) : value);
  }
  if (record.type === 'cskt_staff') await page.locator('[name="cskt_site_archived"]').setChecked(false);
  if (record.type === 'cskt_opportunity') {
    await page.getByRole('button', { name: 'Choose media files', exact: true }).click();
    await page.locator('.media-modal').waitFor({ state: 'visible' });
    await page.evaluate(async ids => {
      const frame = window.wp.media.frame;
      const selection = frame.state().get('selection'); selection.reset();
      for (const id of ids) {
        const item = window.wp.media.attachment(id); await item.fetch(); selection.add(item);
      }
    }, record.details.attachmentIds);
    await page.getByRole('button', { name: 'Use selected files', exact: true }).click();
    check(same(JSON.parse(await page.locator('[data-cskt-site-files]').inputValue()), record.details.attachmentIds), 'The native media picker did not preserve the reviewed attachment order.');
  }
}
async function clickSave(page) {
  const classic = page.locator('#publish');
  if (await classic.isVisible().catch(() => false)) { await classic.click(); return; }
  const update = page.locator('.editor-post-publish-button').filter({ visible: true });
  if (await update.count()) { await update.first().click(); return; }
  const toggle = page.locator('.editor-post-publish-panel__toggle').filter({ visible: true });
  check(await toggle.count(), 'The native WordPress Publish/Update control is unavailable.');
  await toggle.first().click();
  await page.locator('.editor-post-publish-button').filter({ visible: true }).first().click();
}
function detailsOf(post) {
  const key = post.type === 'cskt_staff' ? '_cskt_staff' : '_cskt_opportunity';
  return JSON.parse(post.meta[key] || '{}');
}
function matches(post, record, archived = false) {
  const details = { ...record.details };
  if (record.type === 'cskt_opportunity' && archived) details.state = 'archived';
  return post.status === 'publish' && post.title.raw === record.title &&
    post.content.raw === record.content && post.excerpt.raw === record.excerpt &&
    same(detailsOf(post), details) && (post.meta._cskt_archive === '1') === archived &&
    same([...(post.cskt_department || [])].sort((a, b) => a - b), [...record.departmentIds].sort((a, b) => a - b)) &&
    same([...(post.cskt_topic || [])].sort((a, b) => a - b), [...record.topicIds].sort((a, b) => a - b));
}
async function allCollection(context, site, endpoint, filters) {
  const items = []; let next = 1; const seen = new Set();
  while (next !== null) {
    check(Number.isSafeInteger(next) && !seen.has(next), 'The native collection repeated its pagination cursor.'); seen.add(next);
    const url = new URL('wp-json/cskt-site/v1/' + endpoint, site);
    for (const [k, v] of Object.entries({ ...filters, page: next, perPage: 100 })) url.searchParams.set(k, String(v));
    const response = await context.request.get(url.href); check(response.ok(), 'Native public collection read failed: ' + response.status());
    const page = await response.json(); check(Array.isArray(page.items), 'The complete collection page is missing.');
    items.push(...page.items); next = page.next;
  }
  return items;
}
async function downloadReport(page, directory, format) {
  const name = 'site-report.' + format;
  const retained = await fs.readFile(path.join(directory, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (retained) return { path: name, bytes: retained.length, sha256: digest(retained), retained: true };
  const pending = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download complete ' + format.toUpperCase(), exact: true }).click();
  const file = await pending;
  const stream = await file.createReadStream(); check(stream, 'The native report download did not expose its actual bytes.');
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  await atomic(path.join(directory, name), bytes, true);
  return { path: name, bytes: bytes.length, sha256: digest(bytes) };
}

/**
 * Input records are supplied by the original native owner from reviewed sources.
 * An existing record ID is preserved; new records use the native auto-draft ID
 * captured before Publish. On uncertain writes, the callback reads that same ID.
 */
export async function receiveSiteCMS({ browser, adminContext, input, directory }) {
  inputCheck(input);
  const site = new URL(input.siteUrl);
  check(['http:', 'https:'].includes(site.protocol) && !site.username && !site.password, 'Choose the original WordPress URL without credentials.');
  check(browser && adminContext, 'The original native owner must supply its existing browser and authenticated administrator context.');
  directory = path.resolve(directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const journalPath = path.join(directory, 'SITE_RECEIVING_STATE.json');
  const inputSha256 = digest(canonical(input));
  const completed = await readJson(path.join(directory, 'SITE_RECEIVING_RESULT.json'));
  if (completed) { check(completed.state === 'PASS' && completed.operationId === input.operationId && completed.inputSha256 === inputSha256, 'The completed receiving belongs to different original inputs.'); return completed; }
  let state = await readJson(journalPath);
  if (!state) state = { schema: 'cskt.site.receiving.state.v1', operationId: input.operationId, inputSha256,
    siteUrl: site.href, records: {}, phases: {}, startedAt: new Date().toISOString() };
  check(state.operationId === input.operationId && state.inputSha256 === inputSha256 && state.siteUrl === site.href, 'Reopen the exact original site, review source and receiving operation.');
  const save = async () => atomic(journalPath, JSON.stringify(state, null, 2) + '\n');
  await save();
  const pages = []; let visitor;
  let apiPage;
  const open = async url => { const p = await adminContext.newPage(); pages.push(p); await p.goto(url, { waitUntil: 'domcontentloaded' }); return p; };
  const nativePost = (type, id) => api(apiPage, '/wp/v2/' + type + '/' + id + '?context=edit');
  const phase = async (name, reconcile, perform) => {
    const old = state.phases[name];
    if (old?.state === 'COMPLETE') return old.result;
    if (old?.state === 'SUBMITTED') {
      const result = await reconcile();
      check(result, 'The prior ' + name + ' submission requires review of its retained native ID before another write. Its request has not been replayed.');
      old.state = 'COMPLETE'; old.result = result; old.completedAt = new Date().toISOString(); await save(); return result;
    }
    const result = await perform(async intent => {
      state.phases[name] = { state: 'SUBMITTED', intent, submittedAt: new Date().toISOString() }; await save();
    });
    state.phases[name] = { ...(state.phases[name] || {}), state: 'COMPLETE', result, completedAt: new Date().toISOString() }; await save(); return result;
  };
  try {
    for (const record of input.records) {
      let id = state.records[record.key]?.id || record.id;
      const editor = await open(new URL(id ? 'wp-admin/post.php?post=' + id + '&action=edit' : 'wp-admin/post-new.php?post_type=' + record.type, site).href);
      await readyEditor(editor); if (!apiPage) apiPage = editor;
      if (!id) {
        id = await postId(editor); check(Number.isSafeInteger(id) && id > 0, 'The actual native auto-draft ID was not returned.');
        state.records[record.key] = { id, type: record.type }; await save();
      } else { state.records[record.key] ||= { id, type: record.type }; await save(); }
      const initial = await nativePost(record.type, id);
      check(initial.type === record.type, 'The retained native ID changed content type.');
      if (!state.records[record.key].before) {
        state.records[record.key].before = initial; await save();
      }
      await phase(record.key + ':publish', async () => {
        const current = await nativePost(record.type, id); return matches(current, record) ? current : null;
      }, async submitted => {
        await fillPost(editor, record);
        await submitted({ id, type: record.type, expectedDetails: record.details });
        await clickSave(editor);
        return waitFor(async () => {
          const current = await nativePost(record.type, id); return matches(current, record) ? current : null;
        }, 'The normal native save did not retain the complete reviewed record.');
      });
      const revisions = await api(apiPage, '/wp/v2/' + record.type + '/' + id + '/revisions?per_page=100&context=edit');
      if (!state.records[record.key].restoreRevision) {
        const revision = revisions.find(r => {
          const key = record.type === 'cskt_staff' ? '_cskt_staff' : '_cskt_opportunity';
          try { return r.meta && same(JSON.parse(r.meta[key] || '{}'), record.details) && r.meta._cskt_archive !== '1'; } catch { return false; }
        });
        check(revision, 'WordPress did not retain the published detail metadata in a native revision.');
        state.records[record.key].restoreRevision = revision.id; await save();
      }
      await phase(record.key + ':archive', async () => {
        const current = await nativePost(record.type, id); return matches(current, record, true) ? current : null;
      }, async submitted => {
        // Archive is the second meaningful Save in this SAME editor DOM, which
        // exercises accepted metadata confirmation without a hidden-field reload.
        await readyEditor(editor);
        if (record.type === 'cskt_staff') await editor.locator('[name="cskt_site_archived"]').setChecked(true);
        else await editor.locator('[name="cskt_site_details[state]"]').selectOption('archived');
        await submitted({ id, restoreRevision: state.records[record.key].restoreRevision });
        await clickSave(editor);
        return waitFor(async () => {
          const current = await nativePost(record.type, id); return matches(current, record, true) ? current : null;
        }, 'The native archive control did not retain the record.');
      });
      if (!state.phases[record.key + ':restore-revision']) {
        const archived = await allCollection(adminContext, site, record.type === 'cskt_staff' ? 'staff' : 'opportunities',
          record.type === 'cskt_staff' ? { archive: 'archived' } : { opportunityState: 'archived' });
        check(archived.some(r => r.id === id), 'The public archived collection omitted the actual native archived record.');
      }
      await phase(record.key + ':restore-revision', async () => {
        const current = await nativePost(record.type, id); return matches(current, record) ? current : null;
      }, async submitted => {
        const revisionId = state.records[record.key].restoreRevision;
        const p = await open(new URL('wp-admin/revision.php?revision=' + revisionId, site).href);
        const restore = p.getByRole('button', { name: /Restore This Revision/i });
        await restore.waitFor({ state: 'visible' });
        await submitted({ id, revisionId }); await restore.click();
        return waitFor(async () => {
          const current = await nativePost(record.type, id); return matches(current, record) ? current : null;
        }, 'Native revision restore did not return the exact accepted public details and archive flag.');
      });
      state.records[record.key].final = await nativePost(record.type, id); await save();
    }
    // The settings form owns its native UUID, revision and exact menu selection.
    const settingsPage = await open(new URL('wp-admin/options-general.php?page=cskt-site-settings', site).href);
    await phase('settings', async () => {
      const current = await api(apiPage, '/cskt-site/v1/settings');
      const id = state.phases.settings.intent.operationId;
      return current.record.operations[id]?.result || null;
    }, async submitted => {
      for (const [key, value] of Object.entries(input.settings.contact)) await fillNamed(settingsPage, 'contact[' + key + ']', value);
      for (const field of ['pages', 'menus']) for (const [key, value] of Object.entries(input.settings[field])) {
        await settingsPage.locator('[name="' + field + '[' + key + ']"]').selectOption(String(value));
      }
      await settingsPage.locator('[name="announcementNoticeId"]').selectOption(String(input.settings.announcementNoticeId));
      await settingsPage.locator('[name="reportingEnabled"]').setChecked(input.settings.reportingEnabled);
      const operationId = await settingsPage.locator('[name="operationId"]').inputValue();
      const expectedRevision = await settingsPage.locator('[name="expectedRevision"]').inputValue();
      await submitted({ operationId, expectedRevision });
      await settingsPage.getByRole('button', { name: 'Save public site settings', exact: true }).click();
      return waitFor(async () => {
        const current = await api(apiPage, '/cskt-site/v1/settings');
        return current.record.operations[operationId]?.result || null;
      }, 'The native settings form did not retain its original operation.');
    });
    const currentSettings = await api(apiPage, '/cskt-site/v1/settings');
    check(same(currentSettings.record.values, (({ menus, ...v }) => v)(input.settings)) &&
      same(currentSettings.menus, input.settings.menus), 'The complete native public settings or menu selection differs from its reviewed input.');
    if (!state.report) {
    const reportBefore = await api(apiPage, '/cskt-site/v1/report');
    state.reportBefore ||= reportBefore; await save();
    visitor = await browser.newContext({ acceptDownloads: true });
    const publicPage = await visitor.newPage();
    const capturedEvents = [];
    publicPage.on('response', response => {
      try {
        if (new URL(response.url()).pathname.endsWith('/cskt-site/v1/events') && response.request().method() === 'POST') {
          capturedEvents.push({ request: response.request().postDataJSON(), response });
        }
      } catch { /* A different response is not a site metric. */ }
    });
    for (const record of input.records) {
      const id = state.records[record.key].id;
      const response = await visitor.request.get(new URL('wp-json/cskt-site/v1/entries/' + id, site).href);
      check(response.ok(), 'The actual reviewed native record is not public.');
      const entry = await response.json();
      await publicPage.goto(entry.url, { waitUntil: 'networkidle' });
      await publicPage.locator('.cskt-site-details').waitFor({ state: 'visible' });
      check(await publicPage.locator('.cskt-site-details').count() === 1, 'The theme duplicated the plugin detail panel.');
      state.records[record.key].public = entry;
      const collection = await allCollection(visitor, site, record.type === 'cskt_staff' ? 'staff' : 'opportunities',
        { archive: 'all', ...(record.type === 'cskt_opportunity' ? { opportunityState: 'all', opportunityKind: record.details.kind } : {}) });
      check(collection.some(r => r.id === id), 'The complete public collection omitted its reviewed native record.');
      for (const departmentId of record.departmentIds) {
        const filtered = await allCollection(visitor, site, record.type === 'cskt_staff' ? 'staff' : 'opportunities',
          { departmentId, archive: 'all', ...(record.type === 'cskt_opportunity' ? { opportunityState: 'all' } : {}) });
        check(filtered.some(r => r.id === id) && filtered.every(r => r.departments.some(t => t.id === departmentId)), 'The native department query did not preserve its exact term selection.');
      }
    }
    for (const kind of ['career', 'procurement']) {
      const collection = await allCollection(visitor, site, 'opportunities', { archive: 'all', opportunityState: 'all', opportunityKind: kind });
      check(collection.every(r => r.opportunity.kind === kind), 'The native opportunity kind filter mixed career and procurement records.');
    }
    const search = new URL(site); search.searchParams.set('s', input.searchQuery); search.searchParams.set('post_type', 'cskt_staff');
    await publicPage.goto(search.href, { waitUntil: 'networkidle' });
    const downloadOwner = input.records.find(r => r.type === 'cskt_opportunity' && r.details.attachmentIds.length);
    check(downloadOwner, 'Select a real native opportunity attachment for complete file receiving.');
    const downloadEntry = state.records[downloadOwner.key].public;
    const file = downloadEntry.opportunity.attachments.find(f => f.id === downloadOwner.details.attachmentIds[0]);
    check(file, 'The reviewed opportunity attachment was not a selected public native file.');
    await publicPage.goto(downloadEntry.url, { waitUntil: 'networkidle' });
    const click = publicPage.locator('.cskt-site-details a[data-cskt-site-event]').filter({ hasText: file.title || file.downloadName }).first();
    await click.click();
    const fileResponse = await visitor.request.get(file.url); check(fileResponse.ok(), 'The original native attachment did not download.');
    const originalBytes = await fileResponse.body();
    check(file.bytes === null || file.bytes === originalBytes.length, 'The published attachment descriptor did not match the actual native bytes.');
    if (input.attachmentSha256?.[file.id]) check(digest(originalBytes) === input.attachmentSha256[file.id], 'The actual native file changed from the reviewed original source.');
    state.download = { id: file.id, bytes: originalBytes.length, sha256: digest(originalBytes), url: file.url };
    await waitFor(async () => {
      const report = await api(apiPage, '/cskt-site/v1/report');
      return report.totals.pageViews > state.reportBefore.totals.pageViews &&
        report.totals.searches > state.reportBefore.totals.searches &&
        report.totals.downloadClicks > state.reportBefore.totals.downloadClicks ? report : null;
    }, 'Actual public page/search/download events did not reach the original native reporting desk.');
    await waitFor(() => capturedEvents.some(e => e.request?.descriptor?.kind === 'download'), 'The actual click event response was not observed.');
    const duplicate = capturedEvents.find(e => e.request.descriptor.kind === 'download').request;
    await publicPage.goto(downloadEntry.url, { waitUntil: 'networkidle' });
    const replay = await publicPage.evaluate(async event => {
      const response = await fetch(window.CSKTSiteMetrics.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event), credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Native event replay was rejected: ' + response.status);
      return response.json();
    }, duplicate);
    check(replay.recorded === true && replay.replayed === true, 'The original event ID did not replay without adding another click.');
    await visitor.close(); visitor = null;
    state.report = await api(apiPage, '/cskt-site/v1/report'); await save();
    }
    const reportPage = await open(new URL('wp-admin/index.php?page=cskt-site-report', site).href);
    await reportPage.getByRole('heading', { name: 'Site reporting', exact: true }).waitFor();
    state.exports = [];
    for (const format of ['csv', 'json']) state.exports.push(await downloadReport(reportPage, directory, format));
    const exported = JSON.parse(await fs.readFile(path.join(directory, 'site-report.json'), 'utf8'));
    check(same(exported.totals, state.report.totals) && same(exported.content, state.report.content) &&
      same(exported.searchOutcomes, state.report.searchOutcomes), 'The actual report export did not retain the complete native aggregates.');
    const result = { schema: 'cskt.site.receiving.result.v1', state: 'PASS', operationId: input.operationId,
      inputSha256, completedAt: new Date().toISOString(), records: state.records, settings: currentSettings,
      report: state.report, exports: state.exports, download: state.download,
      basis: 'Original WordPress editor and metadata forms, native publishing/revisions, original public queries, selected native attachments, first-party event records and complete native report downloads.' };
    await atomic(path.join(directory, 'SITE_RECEIVING_RESULT.json'), JSON.stringify(result, null, 2) + '\n', true);
    state.complete = true; await save(); return result;
  } catch (error) {
    state.lastError = { at: new Date().toISOString(), message: error.message };
    try { await save(); } catch (storageError) { error.receivingStateError = storageError.message; }
    throw error;
  } finally {
    if (visitor) await visitor.close();
    for (const p of pages) await p.close().catch(() => {});
  }
}

/** Read-only receiving after the original owner closes and restores its same DB. */
export async function inspectReceivedSiteCMS({ adminContext, siteUrl, directory }) {
  directory = path.resolve(directory);
  const resultPath = path.join(directory, 'SITE_RECEIVING_RESULT.json');
  const result = await readJson(resultPath);
  check(result?.state === 'PASS', 'Complete the original receiving before restored-site inspection.');
  const originalResultSha256 = digest(await fs.readFile(resultPath));
  const accepted = await readJson(path.join(directory, 'SITE_REOPEN_RESULT.json'));
  if (accepted) check(accepted.state === 'PASS' && accepted.operationId === result.operationId &&
    accepted.originalResultSha256 === originalResultSha256, 'The retained reopen receipt belongs to a different original receiving result.');
  const rows = Object.values(result.records); check(rows.length, 'The original native IDs are missing.');
  const page = await adminContext.newPage();
  try {
    await page.goto(new URL('wp-admin/post.php?post=' + rows[0].id + '&action=edit', siteUrl).href);
    await readyEditor(page);
    for (const row of rows) {
      const current = await api(page, '/wp/v2/' + row.type + '/' + row.id + '?context=edit');
      check(current.type === row.final.type && current.status === row.final.status &&
        same(current.meta, row.final.meta) && current.content.raw === row.final.content.raw &&
        current.title.raw === row.final.title.raw && current.excerpt.raw === row.final.excerpt.raw &&
        same([...(current.cskt_department || [])].sort((a, b) => a - b), [...(row.final.cskt_department || [])].sort((a, b) => a - b)) &&
        same([...(current.cskt_topic || [])].sort((a, b) => a - b), [...(row.final.cskt_topic || [])].sort((a, b) => a - b)),
        'Restored native content, taxonomy selection or metadata differs from the original received record.');
      const revision = await api(page, '/wp/v2/' + row.type + '/' + row.id + '/revisions/' + row.restoreRevision + '?context=edit');
      const key = row.type === 'cskt_staff' ? '_cskt_staff' : '_cskt_opportunity';
      check(revision.id === row.restoreRevision && revision.parent === row.id &&
        revision.title.raw === row.final.title.raw && revision.content.raw === row.final.content.raw &&
        revision.excerpt.raw === row.final.excerpt.raw &&
        same(JSON.parse(revision.meta?.[key] || '{}'), JSON.parse(row.final.meta[key] || '{}')) &&
        revision.meta?._cskt_archive === row.final.meta._cskt_archive,
        'The restored original revision does not retain its accepted native text and public metadata.');
    }
    const downloadOwner = rows.find(row => row.type === 'cskt_opportunity' &&
      detailsOf(row.final).attachmentIds.includes(result.download.id));
    check(downloadOwner, 'The original downloaded file is not bound to a retained opportunity.');
    const entry = await api(page, '/cskt-site/v1/entries/' + downloadOwner.id);
    const file = entry.opportunity?.attachments.find(item => item.id === result.download.id);
    check(file, 'The restored public opportunity no longer selects the original native attachment.');
    const response = await adminContext.request.get(file.url);
    check(response.ok(), 'The restored original native attachment is unavailable: ' + response.status());
    const bytes = await response.body();
    check(bytes.length === result.download.bytes && digest(bytes) === result.download.sha256 &&
      (file.bytes === null || file.bytes === bytes.length),
      'The restored native attachment bytes differ from the original downloaded file.');
    const settings = await api(page, '/cskt-site/v1/settings');
    check(same(settings.record, result.settings.record) && same(settings.menus, result.settings.menus), 'Restored settings history or native menu selections differ.');
    const report = await api(page, '/cskt-site/v1/report?from=' + result.report.from + '&to=' + result.report.to);
    check(same(report.totals, result.report.totals) && same(report.days, result.report.days) &&
      same(report.content, result.report.content) && same(report.searchOutcomes, result.report.searchOutcomes),
      'Restored native reporting does not retain its complete aggregate records.');
    if (accepted) return accepted;
    const returned = { state: 'PASS', operationId: result.operationId, originalResultSha256,
      revisionIds: rows.map(row => row.restoreRevision), download: { id: file.id, bytes: bytes.length, sha256: digest(bytes) },
      inspectedAt: new Date().toISOString() };
    await atomic(path.join(directory, 'SITE_REOPEN_RESULT.json'), JSON.stringify(returned, null, 2) + '\n', true); return returned;
  } finally { await page.close(); }
}
