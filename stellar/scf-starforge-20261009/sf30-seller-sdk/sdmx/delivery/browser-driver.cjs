/* Original ECB capture through one local SDMX operator browser. */
'use strict';
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');

async function main() {
  const readyPath = path.resolve(process.argv[2] || '');
  const ready = JSON.parse(await fs.readFile(readyPath, 'utf8'));
  const output = path.resolve(ready.output_directory);
  await fs.mkdir(output, {recursive: true, mode: 0o700});
  const resultPath = path.join(output, 'browser-result.json');
  let result = {schema: 'stellar-forge.sdmx-browser-operation.v1', status: 'RUNNING', phases: {}, downloads: {},
    page_errors: [], dialogs: [], project: null, started_at: new Date().toISOString()};
  try { result = {...result, ...JSON.parse(await fs.readFile(resultPath, 'utf8')), status: 'RUNNING'}; } catch {}
  const secret = new URL(ready.url).hash.slice(1);
  const safe = value => String(value).split(secret).join('[private capability]');
  const persist = async () => {
    const temporary = resultPath + '.pending';
    await fs.writeFile(temporary, JSON.stringify(result, null, 2) + '\n', {mode: 0o600});
    await fs.rename(temporary, resultPath);
  };
  const hash = data => crypto.createHash('sha256').update(data).digest('hex');
  const nodeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  const requireRuntime = createRequire(path.join(nodeModules || process.cwd(), 'package.json'));
  const {chromium} = ready.playwright_module ? require(ready.playwright_module) :
    nodeModules ? requireRuntime(path.join(nodeModules, 'playwright')) : require('playwright');
  const executablePath = process.env.SDMX_CHROMIUM_EXECUTABLE ||
    '/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell';
  const browser = await chromium.launch({headless: true, executablePath, args: [
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-default-browser-check',
    '--disk-cache-size=1048576', '--media-cache-size=1048576', '--disable-application-cache',
    '--disable-features=BackForwardCache,MediaRouter,OptimizationHints'
  ]});
  const context = await browser.newContext({acceptDownloads: true, viewport: {width: 1440, height: 720}});
  const page = await context.newPage();
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const observed = new Set(['/api/sources/upload', '/api/projects', '/api/query', '/api/comparisons', '/api/import']);
    window.__sdmxNativeResponses = {sequence: 0, items: []};
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const requested = args[0] instanceof Request ? args[0].url : String(args[0]);
      const method = String(args[1]?.method || (args[0] instanceof Request ? args[0].method : 'GET')).toUpperCase();
      const endpoint = new URL(requested, location.href).pathname;
      if (method === 'POST' && observed.has(endpoint)) {
        const copy = response.clone();
        copy.json().then(body => {
          if (body.build) body.build = {id: body.build.id, dataset: body.build.dataset,
            snapshot: body.build.snapshot, engineBlob: body.build.engineBlob};
          const capture = window.__sdmxNativeResponses;
          capture.items.push({sequence: ++capture.sequence, endpoint, status: response.status, body});
          if (capture.items.length > 4) capture.items.shift();
        }).catch(() => {});
      }
      return response;
    };
  });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => result.page_errors.push(safe(error.message)));
  page.on('dialog', async dialog => {
    result.dialogs.push({type: dialog.type(), message: safe(dialog.message())});
    await dialog.dismiss();
  });
  const button = (name, scope = page) => scope.getByRole('button', {name, exact: true});
  const idle = async () => {
    await page.locator('.shell[aria-busy="false"]').waitFor();
    const error = page.getByRole('alert');
    if (await error.count()) throw Error(await error.first().innerText());
  };
  const click = async (name, scope = page) => { await button(name, scope).click(); await idle(); };
  const mainNav = name => click(name, page.getByRole('navigation', {name: 'Main navigation'}));
  const tab = (section, name) => click(name, page.getByRole('navigation', {name: section}));
  const read = endpoint => page.evaluate(async url => {
    const response = await fetch(url, {headers: {
      Authorization: 'Bearer ' + sessionStorage.getItem('sf30-sdmx-capability')
    }, cache: 'no-store', credentials: 'omit'});
    const body = await response.json();
    if (!response.ok) throw Error(body.error || String(response.status));
    return body;
  }, endpoint);
  const jsonAction = async (endpoint, perform) => {
    const sequence = await page.evaluate(() => window.__sdmxNativeResponses.sequence);
    await perform();
    await page.waitForFunction(({endpoint, sequence}) => window.__sdmxNativeResponses.items.some(
      item => item.endpoint === endpoint && item.sequence > sequence), {endpoint, sequence});
    const value = await page.evaluate(({endpoint, sequence}) => {
      const capture = window.__sdmxNativeResponses;
      const at = capture.items.findIndex(item => item.endpoint === endpoint && item.sequence > sequence);
      return capture.items.splice(at, 1)[0];
    }, {endpoint, sequence});
    await idle();
    assert.ok(value.status >= 200 && value.status < 300, JSON.stringify(value.body));
    return value.body;
  };
  const phase = async (name, run) => {
    result.current_phase = name; result.status = 'RUNNING'; delete result.error; delete result.page; await persist();
    if (result.phases[name]?.status === 'PASS') return;
    const details = await run();
    result.phases[name] = {status: 'PASS', completed_at: new Date().toISOString(), ...details};
    await persist();
    process.stdout.write(JSON.stringify({phase: name, status: 'PASS'}) + '\n');
  };
  const sourceButton = async id => {
    await mainNav('Sources');
    const state = await read('/api/state');
    const source = state.sources.find(item => item.id === id);
    assert.ok(source, 'Retained original source is available');
    await page.getByRole('complementary', {name: 'Retained sources'}).getByRole('button')
      .filter({hasText: source.label || source.name}).click();
    await idle();
    return source;
  };
  const openProject = async id => {
    await mainNav('Projects');
    if (await button('All projects').count()) await click('All projects');
    const state = await read('/api/state');
    const project = state.projects.find(item => item.id === id);
    assert.ok(project, 'Saved project exists');
    const row = page.locator('tbody tr').filter({has: page.getByRole('cell', {name: project.title, exact: true})});
    assert.equal(await row.count(), 1, 'One original saved project row');
    await click('Open project', row);
    return project;
  };
  const download = async (name, filename) => {
    const target = path.join(output, filename);
    if (result.downloads[filename] && fss.existsSync(target)) {
      assert.equal(hash(await fs.readFile(target)), result.downloads[filename].sha256);
      return result.downloads[filename];
    }
    const [event] = await Promise.all([page.waitForEvent('download'), button(name).click()]);
    await event.saveAs(target); await idle();
    const data = await fs.readFile(target);
    const record = {path: target, bytes: data.length, sha256: hash(data)};
    result.downloads[filename] = record; await persist(); return record;
  };
  const upload = async entry => {
    await mainNav('Sources');
    if (await button('Add another source').count()) await click('Add another source');
    await page.getByLabel('Original SDMX file', {exact: true}).setInputFiles(entry.path);
    await page.getByLabel('Source label', {exact: true}).fill(entry.label);
    await page.getByLabel('Source kind', {exact: true}).selectOption(entry.kind || 'auto');
    await page.getByLabel('Original provider URL', {exact: true}).fill(entry.origin || '');
    const saved = await jsonAction('/api/sources/upload', () => button('Retain source').click());
    assert.equal(saved.id, hash(await fs.readFile(entry.path)), 'Original uploaded bytes retained');
    return saved;
  };
  try {
    result.current_phase = 'browser_startup'; delete result.error; delete result.page; await persist();
    await page.goto(ready.url, {waitUntil: 'domcontentloaded'}); await idle();
    assert.equal(new URL(page.url()).hash, '', 'Private capability removed from address bar');
    await phase('catalog_structure_and_original_codes', async () => {
      const catalog = await upload(ready.sources.catalog);
      await tab('Source sections', 'Metadata');
      await click('Next dataflows'); await click('Previous dataflows');
      await page.getByLabel('Find a dataflow', {exact: true}).fill('EXR');
      await click('Find dataflows');
      assert.ok(await page.locator('td').getByText('Exchange Rates', {exact: true}).count());
      const metadata = await upload(ready.sources.metadata);
      await tab('Source sections', 'Metadata');
      const structureOptions = await page.getByLabel('Data structure', {exact: true})
        .locator('option').evaluateAll(nodes => nodes.map(node => node.value));
      const structure = structureOptions.find(value => value.includes('ECB_EXR1'));
      assert.ok(structure); await page.getByLabel('Data structure', {exact: true}).selectOption(structure);
      const lists = await page.getByLabel('Code list', {exact: true})
        .locator('option').evaluateAll(nodes => nodes.map(node => node.value));
      await page.getByLabel('Code list', {exact: true}).selectOption(lists.find(value => /CL_FREQ\(/.test(value)));
      await page.getByLabel('Find a code or label', {exact: true}).fill('Monthly');
      await click('Find codes');
      assert.ok(await page.locator('td code').filter({hasText: /^M$/}).count());
      await page.getByLabel('Find a code or label', {exact: true}).fill('');
      await click('Find codes');
      for (const key of ['A','B','D','H','M','Q','S','W'])
        assert.ok(await page.locator('td code').filter({hasText: new RegExp('^' + key + '$')}).count(), 'Original frequency code ' + key);
      return {catalog_source: catalog.id, metadata_source: metadata.id, structure};
    });
    await phase('source_series_and_exact_observations', async () => {
      const saved = await upload(ready.sources.generic);
      assert.equal(saved.series_count, 8); assert.equal(saved.observation_count, 544);
      await tab('Source sections', 'Series');
      await page.getByLabel('Find a series', {exact: true}).fill('M.USD');
      await click('Find series');
      let rows = page.locator('tbody tr').filter({has: button('Observations')});
      if (await rows.count() !== 1) {
        await page.getByLabel('Find a series', {exact: true}).fill('USD');
        await click('Find series');
        rows = page.locator('tbody tr').filter({hasText: 'M.USD'});
      }
      assert.equal(await rows.count(), 1, 'The actual monthly USD series is selected');
      await click('Observations', rows);
      assert.ok(await page.getByText('1.1708714285714283', {exact: true}).count(), 'Original December digits are visible');
      await click('All observations');
      await click('Next observations'); await click('Previous observations');
      return {source: saved.id, series: 8, observations: 544, decimal_value: '1.1708714285714283'};
    });
    await phase('explicit_project_selection_and_save', async () => {
      const state = await read('/api/state');
      const existing = state.projects.find(project => project.title === ready.review_title);
      if (existing) { result.project = {id: existing.id, revision: existing.revision}; return {project_id: existing.id, recovered: true}; }
      await sourceButton(ready.sources.generic.id);
      await tab('Source sections', 'Overview');
      await click('Create project from this source');
      await page.getByLabel('Project title', {exact: true}).fill(ready.review_title);
      const metadata = state.sources.find(source => source.id === ready.sources.metadata.id);
      await page.getByLabel((metadata.label || metadata.name) + ' · ' + metadata.kind, {exact: true}).check();
      await idle();
      await page.getByLabel('Dataflow', {exact: true}).selectOption('ECB:EXR(1.0)');
      await page.getByLabel('Dataset coverage', {exact: true}).selectOption('selected');
      await page.getByLabel('Include dataset 1', {exact: true}).check();
      await page.getByLabel('Series coverage', {exact: true}).selectOption('selected');
      await click('Select this page');
      await page.getByLabel('Project notes', {exact: true}).fill(
        'Operator review of the complete captured 2025 GBP/USD annual, daily, monthly and quarterly series. Original values and provider code labels retained.');
      const saved = await jsonAction('/api/projects', () => button('Save project').click());
      assert.equal(saved.build.dataset.rowCount, 544);
      assert.deepEqual(saved.project.selection.dataset_ids, ['1']);
      assert.equal(saved.project.selection.series_keys.length, 8);
      result.project = {id: saved.project.id, revision: saved.project.revision};
      return {project_id: saved.project.id, revision: saved.project.revision, snapshot: saved.build.snapshot,
        rows: 544, selected_series: 8, selected_datasets: ['1']};
    });
    await phase('native_query_paging_ranges_and_lexical_values', async () => {
      await openProject(result.project.id); await tab('Project sections', 'Query');
      const keep = new Set(['series_key','time_period','frequency','observation_value','period_start','dim_currency','decimals']);
      const inputs = page.locator('.checks input[type=checkbox]');
      for (let i = 0; i < await inputs.count(); i++) {
        const input = inputs.nth(i);
        const label = (await input.locator('..').innerText()).split(' · ')[0];
        if (!keep.has(label)) await input.uncheck();
      }
      await page.getByLabel('Rows per page', {exact: true}).fill('5');
      await page.getByLabel('Order', {exact: true}).selectOption('time_period');
      await click('Add filter'); await page.getByLabel('Filter field 1', {exact: true}).selectOption('frequency');
      await page.getByLabel('Filter value 1', {exact: true}).fill('M');
      await click('Add filter'); await page.getByLabel('Filter field 2', {exact: true}).selectOption('dim_currency');
      await page.getByLabel('Filter value 2', {exact: true}).fill('USD');
      let query = await jsonAction('/api/query', () => button('Run native query').click());
      assert.equal(query.response.status, 200); assert.equal(query.response.body.page.total, 12);
      assert.equal(query.response.body.page.returned, 5);
      query = await jsonAction('/api/query', () => button('Next query page').click());
      assert.equal(query.response.body.page.returned, 5);
      query = await jsonAction('/api/query', () => button('Next query page').click());
      assert.equal(query.response.body.page.returned, 2);
      const december = query.response.body.rows.find(row => row.time_period === '2025-12');
      assert.equal(december.observation_value, '1.1708714285714283');
      assert.ok(await page.getByText(december.observation_value, {exact: true}).count());
      await jsonAction('/api/query', () => button('Previous query page').click());
      await click('Add filter'); await page.getByLabel('Filter field 3', {exact: true}).selectOption('period_start');
      await page.getByLabel('Filter condition 3', {exact: true}).selectOption('gte');
      await page.getByLabel('Filter value 3', {exact: true}).fill('2025-12-01');
      query = await jsonAction('/api/query', () => button('Run native query').click());
      assert.equal(query.response.body.page.total, 1);
      assert.equal(query.response.body.rows[0].observation_value, december.observation_value);
      return {monthly_usd_rows: 12, pages: [5,5,2], ranged_rows: 1, decimal_value: december.observation_value,
        engine_source: query.engineBlob, snapshot: query.dataset.snapshot};
    });
    await phase('second_original_edition_and_revision_history', async () => {
      await upload(ready.sources.csv);
      const savedView = await read('/api/projects/' + result.project.id);
      if (savedView.project.revision >= 2) {
        result.project.revision = savedView.project.revision;
        return {project_id: result.project.id, revision: savedView.project.revision, recovered: true};
      }
      await openProject(result.project.id);
      await page.getByLabel('Retained data source', {exact: true}).selectOption(ready.sources.csv.id); await idle();
      await page.getByLabel('Dataset coverage', {exact: true}).selectOption('selected');
      await page.getByLabel('Include dataset 1', {exact: true}).check();
      await page.getByLabel('Series coverage', {exact: true}).selectOption('selected');
      await click('Select this page');
      await page.getByLabel('Project notes', {exact: true}).fill(
        'Second retained edition uses the provider CSV response for the identical actual 2025 selection. Compare all original observation values and attributes with revision 1.');
      const saved = await jsonAction('/api/projects', () => button('Save new revision').click());
      assert.equal(saved.project.revision, 2); assert.equal(saved.build.dataset.rowCount, 544);
      assert.deepEqual(saved.project.selection.dataset_ids, ['1']);
      assert.equal(saved.project.selection.series_keys.length, 8);
      result.project.revision = 2;
      await tab('Project sections', 'History'); await click('Open revision 1');
      assert.ok(await page.getByText('Revision 1 · retained historical view', {exact: true}).count());
      assert.equal(await button('Save new revision').count(), 0);
      await tab('Project sections', 'History'); await click('Open revision 2');
      assert.equal(await page.getByLabel('Dataset coverage', {exact: true}).inputValue(), 'selected');
      return {project_id: saved.project.id, revision: 2, snapshot: saved.build.snapshot, rows: 544,
        selected_datasets: saved.project.selection.dataset_ids};
    });
    await phase('retained_edition_comparison', async () => {
      await openProject(result.project.id); await tab('Project sections', 'History'); await click('Compare revisions');
      await page.getByLabel('Before revision', {exact: true}).fill('1');
      await page.getByLabel('After revision', {exact: true}).fill('2');
      const compared = await jsonAction('/api/comparisons', () => button('Compare editions').click());
      assert.deepEqual(compared.counts, {added: 0, absent: 0, changed: 0, unchanged: 544});
      assert.equal(compared.metadata_changed, false);
      result.comparison_id = compared.id;
      return {comparison_id: compared.id, counts: compared.counts,
        selection_equivalent: compared.selection_equivalent, metadata_changed: compared.metadata_changed};
    });
    await phase('native_downloads_and_portable_reopen', async () => {
      await openProject(result.project.id);
      const dataset = await download('Download dataset', 'operator-dataset.zip');
      const packet = await download('Download portable project', 'operator-project.sdmx.zip');
      await mainNav('Sources');
      if (await button('Add another source').count()) await click('Add another source');
      await page.getByLabel('Portable project ZIP', {exact: true}).setInputFiles(packet.path);
      const reopened = await jsonAction('/api/import', () => button('Import retained project').click());
      assert.equal(reopened.project.id, result.project.id); assert.equal(reopened.project.revision, 2);
      assert.equal(reopened.build.dataset.rowCount, 544); assert.equal(reopened.revision_count, 2);
      const original = await read('/api/projects/' + ready.original_project.id);
      assert.equal(original.project.revision, ready.original_project.revision);
      assert.equal(original.build.snapshot, ready.original_snapshot);
      return {dataset, packet, project_id: reopened.project.id, revision: reopened.project.revision,
        rows: 544, revision_count: reopened.revision_count};
    });
    await phase('responsive_layout_and_operator_reopen', async () => {
      await openProject(result.project.id);
      const layouts = [];
      for (const width of [1440,390]) {
        await page.setViewportSize({width, height: 720});
        const measure = await page.evaluate(() => ({viewport: window.innerWidth,
          document: document.documentElement.scrollWidth, body: document.body.scrollWidth}));
        assert.ok(measure.document <= measure.viewport + 1 && measure.body <= measure.viewport + 1,
          'The operator shell fits its viewport while tables scroll inside their own containers');
        layouts.push(measure);
      }
      await page.reload({waitUntil: 'domcontentloaded'}); await idle(); await openProject(result.project.id);
      const saved = await read('/api/projects/' + result.project.id);
      assert.equal(saved.project.revision, 2);
      assert.deepEqual(saved.project.selection.dataset_ids, ['1']);
      assert.equal(saved.project.selection.series_keys.length, 8);
      assert.equal(result.page_errors.length, 0, 'No application page errors');
      return {layouts, retained_revision: 2, page_errors: result.page_errors.length};
    });
    result.status = 'PASS'; result.completed_at = new Date().toISOString(); delete result.current_phase;
    await persist();
    process.stdout.write(JSON.stringify({status: 'PASS', result: resultPath, project: result.project,
      phases: Object.keys(result.phases).length, downloads: Object.values(result.downloads)}) + '\n');
  } catch (error) {
    result.status = 'FAILED'; result.error = safe(error.stack || error.message || error);
    try {
      result.page = {url: new URL(page.url()).origin + new URL(page.url()).pathname,
        title: await page.title(), text: (await page.locator('body').innerText()).slice(0,10000)};
    } catch {}
    await persist();
    process.stderr.write(JSON.stringify({status: 'FAILED', phase: result.current_phase, error: result.error,
      result: resultPath}) + '\n');
    process.exitCode = 1;
  } finally {
    await context.close(); await browser.close();
  }
}
main().catch(error => { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1; });
