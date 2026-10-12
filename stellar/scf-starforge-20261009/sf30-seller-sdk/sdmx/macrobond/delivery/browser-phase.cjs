'use strict';

/* One real operator continuation. The owner supplies the existing page and
 * original services; this module creates neither a browser nor a catalog. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

function digest(file) {
  const bytes = fs.readFileSync(file);
  return {path: path.resolve(file), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')};
}
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = file + '.next';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
function readSaved(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function safeError(error) {
  return String(error?.stack || error?.message || error)
    .replace(/#[A-Za-z0-9_-]{20,}/g, '#[private]')
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/g, 'Bearer [private]');
}
function collection(value) { return value?.rows || []; }
function shortEdition(value) {
  return {id: value.id, title: value.title, operation_id: value.operation_id,
    series_count: value.series_count, row_count: value.row_count};
}
function current(value) { return typeof value.current === 'object' ? value.current?.id : value.current; }
function assertNumber(value, expected, message) { assert.equal(Number(value), expected, message); }

async function instrument(page) {
  await page.addInitScript(() => {
    if (window.__macrobondNativeResponses) return;
    const original = window.fetch.bind(window);
    window.__macrobondNativeResponses = [];
    window.__macrobondNativeSequence = 0;
    window.fetch = async function(input, init) {
      const target = new URL(typeof input === 'string' ? input : input.url, location.href);
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const observed = target.origin === location.origin && target.pathname.startsWith('/api/');
      const sequence = observed ? ++window.__macrobondNativeSequence : 0;
      let request = null;
      if (observed && typeof init?.body === 'string') {
        try { request = JSON.parse(init.body); } catch (_) {}
      }
      try {
        const response = await original(input, init);
        if (observed && (response.headers.get('content-type') || '').includes('application/json')) {
          response.clone().text().then(text => {
            let value;
            try { value = JSON.parse(text); } catch (_) {}
            window.__macrobondNativeResponses.push({sequence, path: target.pathname, method,
              request, status: response.status, value, text});
            if (window.__macrobondNativeResponses.length > 24) window.__macrobondNativeResponses.shift();
          }).catch(() => {});
        }
        return response;
      } catch (error) {
        if (observed) {
          window.__macrobondNativeResponses.push({sequence, path: target.pathname, method,
            request, status: 0, value: {error: error.message}});
          if (window.__macrobondNativeResponses.length > 24) window.__macrobondNativeResponses.shift();
        }
        throw error;
      }
    };
  });
}
async function uiEnvironment(args, filename) {
  const page = args.page;
  assert(page && args.operatorURL && args.outputRoot, 'Supply the existing page, private operatorURL and outputRoot');
  const file = path.join(args.outputRoot, filename);
  const result = readSaved(file) || {schema: 'stellar-forge.macrobond-browser.v1',
    run_id: crypto.randomUUID(), completed: [], phases: {}, status: 'RUNNING'};
  const errors = [];
  const onError = error => errors.push(safeError(error));
  page.on('pageerror', onError);
  await instrument(page);
  const save = () => writeJSON(file, result);
  const mark = phase => {
    result.status = 'RUNNING'; result.current_phase = phase;
    delete result.error; delete result.failure_page;
    save();
    process.stdout.write(JSON.stringify({event: 'macrobond_browser_phase', phase}) + '\n');
  };
  const idle = async () => {
    await page.waitForFunction(() => !document.body.classList.contains('busy'), null, {timeout: 120000});
  };
  const json = route => page.evaluate(async route => {
    const token = sessionStorage.getItem('starforge.macrobond.operator') || '';
    const response = await fetch(route, {headers: {Authorization: 'Bearer ' + token}, cache: 'no-store'});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Native read failed: ' + response.status);
    return value;
  }, route);
  const sequence = () => page.evaluate(() => window.__macrobondNativeSequence || 0);
  const captured = async (method, route, after, fields = {}) => {
    const argument = {method, route, after, fields};
    await page.waitForFunction(arg => (window.__macrobondNativeResponses || []).some(row =>
      row.sequence > arg.after && row.method === arg.method && row.path === arg.route &&
      Object.entries(arg.fields).every(([key, value]) => row.request?.[key] === value)),
      argument, {timeout: 120000});
    return page.evaluate(arg => (window.__macrobondNativeResponses || []).find(row =>
      row.sequence > arg.after && row.method === arg.method && row.path === arg.route &&
      Object.entries(arg.fields).every(([key, value]) => row.request?.[key] === value)), argument);
  };
  const click = async locator => { await idle(); await locator.click(); await idle(); };
  const capture = async (method, route, action, fields = {}) => {
    const after = await sequence();
    await action();
    const saved = await captured(method, route, after, fields);
    assert(saved.status >= 200 && saved.status < 300, saved.value?.error || route + ' returned ' + saved.status);
    await idle();
    return saved;
  };
  const step = async (name, run) => {
    mark(name);
    if (result.completed.includes(name)) return result.phases[name];
    const value = await run();
    result.phases[name] = value;
    result.completed.push(name);
    save();
    return value;
  };
  const navigation = label => click(page.getByRole('navigation', {name: 'Main navigation'})
    .getByRole('button', {name: label, exact: true}));
  const openEdition = async id => {
    await navigation('Saved editions');
    await click(page.locator('aside[aria-label="Saved editions"] button[data-edition-id="' + id + '"]'));
  };
  const fail = async error => {
    result.status = 'FAIL'; result.error = safeError(error); result.page_errors = errors;
    try {
      const location = new URL(page.url());
      result.failure_page = {url: location.origin + location.pathname,
        title: await page.title(), text: (await page.locator('body').innerText()).slice(0, 6000)};
    } catch (_) {}
    save();
  };
  await page.goto(args.operatorURL, {waitUntil: 'domcontentloaded', timeout: 45000});
  await page.getByRole('navigation', {name: 'Main navigation'}).waitFor({timeout: 120000});
  await idle();
  return {page, result, file, errors, save, mark, idle, json, sequence, captured, click,
    capture, step, navigation, openEdition, fail, close: () => page.off('pageerror', onError)};
}
async function downloadFile(env, trigger, destination) {
  const temporary = destination + '.receiving';
  const waiting = env.page.waitForEvent('download', {timeout: 120000});
  await trigger();
  const download = await waiting;
  await download.saveAs(temporary);
  const info = digest(temporary);
  if (fs.existsSync(destination)) {
    assert.equal(digest(destination).sha256, info.sha256, 'Preserve the already retained output');
    fs.unlinkSync(temporary);
  } else {
    fs.linkSync(temporary, destination); fs.unlinkSync(temporary);
  }
  return {...info, path: destination, filename: download.suggestedFilename()};
}
async function seriesRows(env, editionId) {
  const data = await env.json('/api/editions/' + encodeURIComponent(editionId) + '/series?offset=0&limit=200');
  assertNumber(data.total, data.rows.length, 'The native example series fit this complete reviewed page');
  return data.rows;
}
async function prepareProject(env, project, title) {
  await env.navigation('Source projects');
  const row = env.page.getByRole('row').filter({hasText: project.id})
    .filter({has: env.page.getByRole('button', {name: 'Use in edition', exact: true})});
  assertNumber(await row.count(), 1, 'Use the exact received source project');
  await env.click(row.getByRole('button', {name: 'Use in edition', exact: true}));
  await env.page.getByLabel('Edition title', {exact: true}).fill(title);
  await env.page.getByLabel(/^Review notes/).fill('Review the retained ECB 2025 reference-rate source and its original precision before customer publication.');
  await env.page.getByLabel(/^Source revision/).fill(String(project.revision));
  await env.page.getByLabel(/^Source revision/).press('Tab');
}
async function previewDraft(env, title) {
  const captured = await env.capture('POST', '/api/preview',
    () => env.click(env.page.getByRole('button', {name: 'Preview edition', exact: true})), {title});
  assert.equal((captured.value.issues || []).filter(issue => issue.severity === 'error').length, 0);
  return captured.value;
}
async function inspectObservation(env, editionId, series, expectedValue, nextPage) {
  await env.openEdition(editionId);
  await env.click(env.page.getByRole('tab', {name: 'Series and observations', exact: true}));
  const row = env.page.getByRole('row').filter({hasText: series.id})
    .filter({has: env.page.getByRole('button', {name: 'Observations', exact: true})});
  await env.click(row.getByRole('button', {name: 'Observations', exact: true}));
  await env.page.getByRole('columnheader', {name: 'Exact original value', exact: true}).waitFor();
  if (expectedValue) await env.page.getByRole('cell', {name: expectedValue, exact: true}).waitFor();
  if (nextPage) {
    const saved = await env.capture('GET', '/api/editions/' + editionId + '/observations',
      () => env.click(env.page.getByRole('button', {name: 'Next page', exact: true})));
    assertNumber(saved.value.offset, 50);
    assertNumber(saved.value.rows.length, 50);
  }
  return {id: series.id, series_key: series.series_key, observations: series.observation_count,
    exact_value: expectedValue || undefined, advanced_page: Boolean(nextPage)};
}
async function publish(env, id, wantedDifference) {
  await env.openEdition(id);
  const before = await env.json('/api/state');
  if (current(before) === id) return {current: id, revision: before.revision, recovered: true};
  const after = await env.sequence();
  await env.click(env.page.getByRole('button', {name: 'Review publication', exact: true}));
  await env.page.getByRole('button', {name: 'Use this edition', exact: true}).waitFor({timeout: 120000});
  let comparison = null;
  if (current(before)) {
    comparison = (await env.captured('POST', '/api/editions/compare', after,
      {before: current(before), after: id})).value;
    if (wantedDifference) {
      assertNumber(comparison.series_counts[wantedDifference.kind], wantedDifference.series);
      assertNumber(comparison.observation_counts[wantedDifference.kind], wantedDifference.rows);
    }
  }
  const saved = await env.capture('POST', '/api/editions/' + id + '/activate',
    () => env.click(env.page.getByRole('button', {name: 'Use this edition', exact: true})));
  assert.equal(saved.request.expected_current, current(before) || null);
  assertNumber(saved.request.expected_revision, before.revision);
  assert.equal(current(saved.value), id);
  assertNumber(saved.value.revision, before.revision + 1);
  const final = await env.json('/api/state');
  assert.equal(current(final), id);
  return {current: id, revision: final.revision, previous: current(before),
    comparison: comparison && {series_counts: comparison.series_counts, observation_counts: comparison.observation_counts}};
}

async function run(args) {
  const env = await uiEnvironment(args, 'browser-result.json');
  const {page, result} = env;
  try {
    const initial = await env.json('/api/state');
    if (result.catalog_id) assert.equal(initial.workspace.id, result.catalog_id, 'Resume the same original catalog');
    else {
      result.catalog_id = initial.workspace.id;
      result.baseline = {editions: initial.editions.length, publication_revision: initial.revision};
      env.save();
    }
    assert(args.projectPacket, 'Supply the original received SDMX project packet');
    const source = await env.step('receive_original_project', async () => {
      await env.navigation('Source projects');
      const form = page.locator('form').filter({has: page.getByRole('heading', {name: 'Receive SDMX project', exact: true})});
      await form.getByLabel('Original project packet', {exact: true}).setInputFiles(args.projectPacket);
      const saved = await env.capture('POST', '/api/projects/import',
        () => env.click(form.getByRole('button', {name: 'Import source project', exact: true})));
      assert(saved.value.project?.id);
      return {project: {id: saved.value.project.id, revision: saved.value.project.revision,
        title: saved.value.project.title}, packet: digest(args.projectPacket)};
    });
    const suffix = result.run_id.slice(0, 8);
    const fullTitle = 'ECB reference rates — full selection ' + suffix;
    const usdTitle = 'ECB reference rates — USD selection ' + suffix;
    const full = await env.step('save_full_and_recover_newer_draft', async () => {
      const pending = result.pending_full_save;
      if (pending) {
        const state = await env.json('/api/state');
        const existing = state.editions.find(item => item.operation_id === pending.operation_id);
        if (existing) {
          const retry = page.getByRole('button', {name: 'Retry exact edition save', exact: true});
          if (await retry.isVisible()) await env.click(retry);
          await env.openEdition(existing.id);
          const rows = await seriesRows(env, existing.id);
          assertNumber(existing.series_count, 8); assertNumber(existing.row_count, 544);
          return {edition: shortEdition(existing), series: rows, recovered: true};
        }
      }
      await prepareProject(env, source.project, fullTitle);
      const preview = await previewDraft(env, fullTitle);
      assertNumber(preview.series.length, 8); assertNumber(preview.row_count, 544);
      let delivered, rejectDelivery;
      const delivery = new Promise((resolve, reject) => { delivered = resolve; rejectDelivery = reject; });
      const routePattern = '**/api/editions';
      const intercept = async route => {
        try {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          const request = route.request().postDataJSON();
          const response = await route.fetch({timeout: 120000});
          const value = await response.json();
          if (!response.ok()) {
            await route.fulfill({response}); delivered({request, value, failed: true}); return;
          }
          result.pending_full_save = {operation_id: request.operation_id, edition_id: value.edition.id};
          env.save();
          await route.abort('failed');
          delivered({request, value});
        } catch (error) {
          try { await route.abort('failed'); } catch (_) {}
          rejectDelivery(error);
        }
      };
      await page.route(routePattern, intercept);
      let original;
      try {
        [, original] = await Promise.all([
          env.click(page.getByRole('button', {name: 'Save reviewed edition', exact: true})), delivery]);
      } finally { await page.unroute(routePattern, intercept); }
      assert(!original.failed, original.value?.error);
      await page.getByRole('button', {name: 'Retry exact edition save', exact: true}).waitFor();
      await page.getByLabel('Edition title', {exact: true}).fill(usdTitle);
      const recovered = await env.capture('POST', '/api/editions',
        () => env.click(page.getByRole('button', {name: 'Retry exact edition save', exact: true})),
        {operation_id: original.request.operation_id});
      assert.deepEqual(recovered.request, original.request, 'Retry the exact reviewed native request');
      assert.equal(recovered.value.edition.id, original.value.edition.id);
      const state = await env.json('/api/state');
      assertNumber(state.editions.filter(item => item.operation_id === original.request.operation_id).length, 1);
      await env.navigation('Prepare edition');
      assert.equal(await page.getByLabel('Edition title', {exact: true}).inputValue(), usdTitle,
        'Completing the earlier save retains the newer draft');
      return {edition: shortEdition(recovered.value.edition), series: preview.series,
        exact_retry: true, newer_draft_retained: true};
    });
    const usd = await env.step('select_and_save_original_usd_series', async () => {
      if (result.pending_usd_save) {
        const state = await env.json('/api/state');
        const existing = state.editions.find(item => item.operation_id === result.pending_usd_save);
        if (existing) return {edition: shortEdition(existing), series: await seriesRows(env, existing.id), recovered: true};
      }
      await env.navigation('Prepare edition');
      const title = page.getByLabel('Edition title', {exact: true});
      if (await title.inputValue() !== usdTitle) await prepareProject(env, source.project, usdTitle);
      const selection = page.getByLabel('Series selection', {exact: true});
      await selection.selectOption('selected'); await env.idle();
      for (const series of full.series) {
        const check = page.getByRole('checkbox', {name: 'Include ' + series.series_key, exact: true});
        await check.waitFor({timeout: 120000});
        await check.setChecked(series.dimensions?.CURRENCY === 'USD');
      }
      const preview = await previewDraft(env, usdTitle);
      assertNumber(preview.series.length, 4); assertNumber(preview.row_count, 272);
      assert(preview.series.every(series => series.dimensions.CURRENCY === 'USD'));
      result.pending_usd_save = preview.request.operation_id; env.save();
      const saved = await env.capture('POST', '/api/editions',
        () => env.click(page.getByRole('button', {name: 'Save reviewed edition', exact: true})),
        {operation_id: preview.request.operation_id});
      return {edition: shortEdition(saved.value.edition), series: preview.series};
    });
    await env.step('review_exact_original_values_and_pagination', async () => {
      const annual = full.series.find(series => series.dimensions.CURRENCY === 'GBP' && series.source_frequency === 'A');
      const daily = full.series.find(series => series.dimensions.CURRENCY === 'USD' && series.source_frequency === 'D');
      assert(annual && daily, 'Choose actual observed currency/frequency dimensions');
      const value = await inspectObservation(env, full.edition.id, annual, '0.8567923137255', false);
      const pageResult = await inspectObservation(env, full.edition.id, daily, null, true);
      await env.click(page.getByRole('tab', {name: 'Source references', exact: true}));
      await page.getByRole('cell', {name: source.project.id, exact: true}).waitFor();
      return {annual: value, daily: pageResult, source_revision: source.project.revision};
    });
    await env.step('publish_full_selection', () => publish(env, full.edition.id));
    await env.step('compare_and_publish_usd', () => publish(env, usd.edition.id, {kind: 'removed', series: 4, rows: 272}));
    await env.step('compare_and_restore_full', () => publish(env, full.edition.id, {kind: 'added', series: 4, rows: 272}));
    await env.step('browse_search_and_read_exact_provider_wire', async () => {
      await env.navigation('Client connection');
      const annualGBP = full.series.find(series => series.dimensions.CURRENCY === 'GBP' && series.source_frequency === 'A');
      const annualUSD = full.series.find(series => series.dimensions.CURRENCY === 'USD' && series.source_frequency === 'A');
      await env.click(page.getByRole('button', {name: 'Browse provider tree', exact: true}));
      await env.click(page.getByRole('button', {name: 'Open ' + annualGBP.flow, exact: true}));
      await env.click(page.getByRole('button', {name: 'List annual series', exact: true}));
      await page.getByRole('cell', {name: annualGBP.id, exact: true}).waitFor();
      const search = page.getByLabel('Find a published series', {exact: true});
      await search.fill(annualUSD.id);
      await env.click(page.getByRole('button', {name: 'Search provider', exact: true}));
      await page.getByRole('cell', {name: annualUSD.id, exact: true}).waitFor();
      await page.getByLabel('Provider method', {exact: true}).selectOption('loadseries');
      const absent = 'sdmx_' + '0'.repeat(32);
      assert(!full.series.some(series => series.id === absent));
      await page.getByLabel(/^Series identifiers in request order/).fill([annualGBP.id, absent, annualUSD.id].join('\n'));
      await env.click(page.getByRole('button', {name: 'Read provider response', exact: true}));
      const raw = await page.locator('pre.response').innerText();
      const values = JSON.parse(raw);
      assert.equal(values.length, 3);
      assert.equal(values[0].data.metaData.PrimName, annualGBP.id);
      assert.equal(typeof values[1].error, 'string');
      assert.equal(values[2].data.metaData.PrimName, annualUSD.id);
      assert.match(raw, /"values":\[0\.8567923137255(?:,|\])/);
      await page.getByLabel('Provider method', {exact: true}).selectOption('getcapabilities');
      await env.click(page.getByRole('button', {name: 'Read provider response', exact: true}));
      const capabilities = JSON.parse(await page.locator('pre.response').innerText());
      assert.equal(capabilities.browse, true); assert.equal(capabilities.search, true);
      assert.equal(capabilities.editSeries, false); assert.equal(capabilities.revisions, false);
      return {ordered_series: [annualGBP.id, absent, annualUSD.id], exact_numeric_literal: '0.8567923137255',
        capabilities};
    });
    await env.step('download_original_client_configuration', async () => {
      await env.navigation('Client connection');
      const info = await downloadFile(env,
        () => env.click(page.getByRole('button', {name: 'Download Macrobond configuration', exact: true})),
        path.join(args.outputRoot, 'macrobond-provider.xml'));
      const xml = fs.readFileSync(info.path, 'utf8');
      const state = await env.json('/api/state');
      assert(xml.includes('<web:Host>' + state.connection.provider_url.replace(/\/$/, '') + '</web:Host>'));
      assert(!/Bearer|password|Authorization/i.test(xml));
      return info;
    });
    const packet = await env.step('export_completed_catalog', async () => {
      await env.openEdition(full.edition.id);
      const state = await env.json('/api/state');
      const info = await downloadFile(env,
        () => env.click(page.getByRole('button', {name: 'Export catalog packet', exact: true})),
        path.join(args.outputRoot, 'macrobond-catalog-r' + state.revision + '.zip'));
      return {...info, catalog_id: state.workspace.id, current: current(state), revision: state.revision,
        edition_ids: state.editions.map(item => item.id), publication_count: state.publications.length};
    });
    await env.step('desktop_and_phone_operator_layout', async () => {
      const rows = [];
      for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}]) {
        await page.setViewportSize(viewport);
        await env.openEdition(full.edition.id);
        await env.click(page.getByRole('tab', {name: 'Publication', exact: true}));
        const measure = await page.evaluate(() => ({width: innerWidth,
          document_width: document.documentElement.scrollWidth, body_width: document.body.scrollWidth}));
        assert(measure.document_width <= viewport.width + 1 && measure.body_width <= viewport.width + 1,
          'The operator layout fits the viewport; source tables own horizontal scrolling');
        if (args.screenshots) await page.screenshot({path: path.join(args.outputRoot,
          'operator-' + viewport.width + '.png'), fullPage: false});
        rows.push(measure);
      }
      await page.setViewportSize({width: 1440, height: 1000});
      return rows;
    });
    const retained = await env.json('/api/state');
    assert.equal(current(retained), packet.current, 'The completed original publication remains selected');
    assertNumber(retained.revision, packet.revision);
    assert.deepEqual(retained.editions.map(item => item.id).sort(), [...packet.edition_ids].sort());
    assert.equal(env.errors.length, 0, 'The complete operator workflow has no uncaught page errors');
    result.status = 'PASS'; result.current_phase = 'complete'; result.page_errors = env.errors;
    result.packet = packet; result.full = full.edition; result.usd = usd.edition;
    result.finished_at = new Date().toISOString(); env.save();
    process.stdout.write(JSON.stringify({event: 'macrobond_browser_complete', result: env.file,
      full_series: full.edition.series_count, usd_series: usd.edition.series_count, publication_revision: packet.revision}) + '\n');
    return result;
  } catch (error) { await env.fail(error); throw error; }
  finally { env.close(); }
}

async function readback(args) {
  const original = typeof args.sourceResult === 'string' ? readSaved(args.sourceResult) : args.sourceResult;
  assert(original?.status === 'PASS' && original.packet && original.full, 'Use the completed original browser result');
  const packetPath = args.packetPath || original.packet.path;
  assert.equal(digest(packetPath).sha256, original.packet.sha256, 'Receive the exact exported catalog packet');
  const env = await uiEnvironment(args, 'receiving-browser-result.json');
  try {
    await env.step('receive_complete_original_catalog', async () => {
      const state = await env.json('/api/state');
      if (state.workspace.id === original.catalog_id && current(state) === original.full.id &&
          state.revision === original.packet.revision && state.editions.length === original.packet.edition_ids.length)
        return {recovered: true, catalog_id: state.workspace.id, revision: state.revision};
      await env.navigation('Client connection');
      await env.page.getByLabel('Complete catalog packet', {exact: true}).setInputFiles(packetPath);
      const saved = await env.capture('POST', '/api/catalog/import',
        () => env.click(env.page.getByRole('button', {name: 'Import catalog packet', exact: true})));
      assert.equal(saved.value.workspace.id, original.catalog_id);
      assert.equal(current(saved.value), original.full.id);
      assertNumber(saved.value.revision, original.packet.revision);
      assert.deepEqual(saved.value.editions.map(item => item.id).sort(), [...original.packet.edition_ids].sort());
      assertNumber(saved.value.publications.length, original.packet.publication_count);
      return {catalog_id: saved.value.workspace.id, revision: saved.value.revision,
        editions: saved.value.editions.length, publications: saved.value.publications.length};
    });
    await env.step('review_restored_original_observations', async () => {
      const rows = await seriesRows(env, original.full.id);
      assertNumber(rows.length, 8);
      const annual = rows.find(row => row.dimensions.CURRENCY === 'GBP' && row.source_frequency === 'A');
      return inspectObservation(env, original.full.id, annual, '0.8567923137255', false);
    });
    await env.step('read_restored_publication_history', async () => {
      await env.openEdition(original.full.id);
      await env.click(env.page.getByRole('tab', {name: 'Publication', exact: true}));
      await env.page.getByText('Retained publication history', {exact: true}).click();
      const state = await env.json('/api/state');
      assert.equal(current(state), original.full.id);
      assertNumber(state.publications.length, original.packet.publication_count);
      return {current: current(state), publication_revision: state.revision};
    });
    assert.equal(env.errors.length, 0);
    env.result.status = 'PASS'; env.result.current_phase = 'complete';
    env.result.page_errors = env.errors; env.result.finished_at = new Date().toISOString(); env.save();
    process.stdout.write(JSON.stringify({event: 'macrobond_receiving_browser_complete', result: env.file,
      current: original.full.id, revision: original.packet.revision}) + '\n');
    return env.result;
  } catch (error) { await env.fail(error); throw error; }
  finally { env.close(); }
}

module.exports = {run, readback};

if (require.main === module) {
  (async () => {
    const ready = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const dependencyRoot = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    const runtime = dependencyRoot ? require(path.join(dependencyRoot, 'playwright')) : require('playwright');
    const executablePath = process.env.MACROBOND_CHROMIUM_EXECUTABLE || process.env.SDMX_CHROMIUM_EXECUTABLE ||
      '/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell';
    const browser = await runtime.chromium.launch({headless: true, executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disk-cache-size=1048576',
        '--media-cache-size=1048576', '--disable-application-cache']});
    let context;
    try {
      context = await browser.newContext({acceptDownloads: true, viewport: {width: 1440, height: 1000}});
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      const first = await run({page, operatorURL: ready.primary.url, projectPacket: ready.project_packet,
        outputRoot: ready.output_root, screenshots: Boolean(ready.screenshots)});
      await readback({page, operatorURL: ready.receiver.url, sourceResult: first,
        outputRoot: ready.output_root});
    } finally {
      if (context) await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  })().catch(error => { process.stderr.write(safeError(error) + '\n'); process.exitCode = 1; });
}
