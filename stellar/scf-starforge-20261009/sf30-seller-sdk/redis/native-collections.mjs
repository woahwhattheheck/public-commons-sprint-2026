// MIT. Collection products join the original Redis merchant/customer receiving operation.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const clone = value => structuredClone(value);
const binary = Buffer.from([255, 0, 239, 187, 191]);
const scalar = value => Buffer.isBuffer(value) ? { base64: value.toString('base64') } : value;
const identity = value => JSON.stringify(value);
const listValues = ['9007199254740993', binary, 'repeated', 'repeated', '', 'λ'];
const setValues = ['9007199254740993', binary, '', ...Array.from({ length: 129 }, (_, index) => 'member-' + index)];

async function traverse(read, kind) {
  let input = kind === 'list' ? { offset: '0' } : { cursor: '0' };
  const pages = [], rows = [];
  for (let index = 0; index < 256; index++) {
    const data = await read(input, index);
    assert.equal(data.kind, kind); assert.equal(data.rowCount, data.rows.length);
    if (kind === 'set') {
      assert.equal(typeof data.scanCursor, 'string');
      assert.equal(data.scanComplete, data.scanCursor === '0');
      assert.equal(data.truncated, !data.scanComplete);
      assert.equal(data.iterationConsistency, 'native-sscan');
      assert.equal(data.duplicatesPossible, true);
      if (!data.scanComplete) assert.equal(data.nextInput?.cursor, data.scanCursor);
    }
    rows.push(...data.rows);
    pages.push({ input, rows: data.rowCount, ...(kind === 'set' ? { cursor: data.scanCursor, complete: data.scanComplete } : {}) });
    if (!data.nextInput) {
      assert.equal(data.truncated, false, 'The complete fixture iteration must retain its next input.');
      if (kind === 'list') assert.deepEqual(rows, listValues.map((value, position) => ({ index: String(position), value: scalar(value) })));
      else assert.deepEqual([...new Set(rows.map(row => identity(row.member)))].sort(), setValues.map(value => identity(scalar(value))).sort());
      return { pages, rows: rows.length, ...(kind === 'set' ? { uniqueMembers: new Set(rows.map(row => identity(row.member))).size } : {}) };
    }
    input = data.nextInput;
  }
  throw new Error('REDIS_COLLECTION_FIXTURE_ITERATION_DID_NOT_FINISH');
}

export async function createRedisCollectionJourney({ database, key, http = false }) {
  const declaration = JSON.parse(await readFile(new URL('./example-collections-source.json', import.meta.url)));
  const plan = JSON.parse(await readFile(new URL('./example-collections-plan.json', import.meta.url)));
  const queries = declaration.queries;
  for (const query of Object.values(queries)) query.key = key(query.key);
  queries.list_feed.maxRows = 2;
  queries.member_catalog.scanCount = 16;
  queries.member_catalog.maxRows = 256;
  const compactKey = key('merchant:collections:compact'), largeListKey = key('merchant:collections:large-list');
  const largeSetKey = key('merchant:collections:large-set'), sparseSetKey = key('merchant:collections:sparse');
  if (http) {
    // Upstash's administrator fixture uses only generated data in its explicitly
    // selected ephemeral database. The merchant still uses the same EVAL_RO source.
    await database.sendCommand(['EVAL',
      "return redis.call('RPUSH',KEYS[1],ARGV[1],string.char(255,0,239,187,191),ARGV[2],ARGV[3],ARGV[4],ARGV[5])",
      '1', queries.list_feed.key, ...listValues.filter(value => !Buffer.isBuffer(value))]);
    await database.sendCommand(['EVAL',
      "return redis.call('SADD',KEYS[1],string.char(255,0,239,187,191),unpack(ARGV))",
      '1', queries.member_catalog.key, ...setValues.filter(value => !Buffer.isBuffer(value))]);
    await database.sendCommand(['EVAL',
      "return redis.call('SADD',KEYS[1],string.rep(string.char(255),800))", '1', largeSetKey]);
  } else {
    await database.sendCommand(['RPUSH', queries.list_feed.key, ...listValues]);
    await database.sendCommand(['SADD', queries.member_catalog.key, ...setValues]);
    await database.sendCommand(['SADD', largeSetKey, Buffer.alloc(800, 255)]);
  }
  await database.sendCommand(['SADD', compactKey, ...Array.from({ length: 32 }, (_, index) => String(index + 1))]);
  await database.sendCommand(['RPUSH', largeListKey, 'x'.repeat(1025)]);
  // Create a native empty, nonterminal scan batch by removing the first half of
  // an actual hash-table iteration. Retaining the other half avoids shrinking the
  // table, and all cursor positions originate in Redis's own SSCAN replies.
  const sparseMembers = Array.from({ length: 512 }, (_, index) => 'sparse-member-' + index), removed = new Set();
  await database.sendCommand(['SADD', sparseSetKey, ...sparseMembers]);
  let seedCursor = '0';
  do {
    const page = await database.sendCommand(['SSCAN', sparseSetKey, seedCursor, 'COUNT', '32']);
    seedCursor = String(page[0]);
    for (const member of page[1]) removed.add(String(member));
  } while (removed.size < 256 && seedCursor !== '0');
  // A provider can return the entire compact representation despite COUNT.
  // Preserve that actual behavior; a partial native traversal creates the sparse phase.
  if (removed.size === sparseMembers.length) { assert.equal(seedCursor, '0'); removed.clear(); }
  if (removed.size) await database.sendCommand(['SREM', sparseSetKey, ...removed]);
  const sparseExpected = sparseMembers.filter(member => !removed.has(member));
  const extraQueries = {
    compactMembers: { ...queries.member_catalog, key: compactKey, scanCount: 1, maxRows: 64 },
    sparseMembers: { ...queries.member_catalog, key: sparseSetKey, scanCount: 1, maxRows: 1000 },
    oversizedScanBatch: { ...queries.member_catalog, key: compactKey, scanCount: 1, maxRows: 4 },
    oversizedList: { ...queries.list_feed, key: largeListKey, maxBytes: 1024 },
    oversizedSet: { ...queries.member_catalog, key: largeSetKey, maxBytes: 1024 },
    missingList: { ...queries.list_feed, key: key('merchant:collections:missing-list') },
    missingSet: { ...queries.member_catalog, key: key('merchant:collections:missing-set') },
    wrongListType: { ...queries.list_feed, key: queries.member_catalog.key },
    wrongSetType: { ...queries.member_catalog, key: queries.list_feed.key },
    listInputBoundary: { ...queries.list_feed, parameters: { offset: { type: 'integer', minimum: '0', maximum: '10', enum: ['0', '4'], default: '0' } } },
    setInputBoundary: { ...queries.member_catalog, parameters: { cursor: { type: 'string', maxLength: 20, enum: ['0'], default: '0' } } },
  };
  let savedScan, workspaceResult;
  return {
    queries, routes: plan.routes, extraQueries,
    previews: [['list_feed', { offset: '0' }], ['member_catalog', { cursor: '0' }]],
    async source(source) {
      const list = await traverse(input => source.query('list_feed', input), 'list');
      const set = await traverse(input => source.query('member_catalog', input), 'set');
      const sparseRows = [], emptyPages = [], sparsePages = [];
      let sparseInput = { cursor: '0' };
      for (let index = 0; index < 1024; index++) {
        const page = await source.query('sparseMembers', sparseInput);
        sparseRows.push(...page.rows.map(row => row.member));
        sparsePages.push({ input: sparseInput, cursor: page.scanCursor, rows: page.rowCount, complete: page.scanComplete });
        if (page.rowCount === 0 && page.nextInput) emptyPages.push({ input: sparseInput, nextInput: page.nextInput });
        if (!page.nextInput) { assert.equal(page.scanComplete, true); break; }
        sparseInput = page.nextInput;
        assert.notEqual(index, 1023, 'The sparse native scan must terminate.');
      }
      if (removed.size) assert.ok(emptyPages.length > 0, 'The actual native scan must include a continued empty batch.');
      assert.deepEqual([...new Set(sparseRows)].sort(), sparseExpected.sort());
      const compact = await source.query('compactMembers', {});
      assert.equal(compact.rowCount, 32); assert.equal(compact.scanComplete, true);
      assert.ok(compact.rowCount > compact.scanCount, 'The native compact-set reply must exceed the COUNT hint.');
      assert.equal((await source.query('missingList', {})).rowCount, 0);
      const empty = await source.query('missingSet', {});
      assert.equal(empty.rowCount, 0); assert.equal(empty.scanCursor, '0'); assert.equal(empty.scanComplete, true);
      const excessive = await source.route('oversizedScanBatch').handler({ query: {} });
      assert.equal(excessive.status, 413); assert.equal(excessive.body.error, 'QUERY_SCAN_PAGE_TOO_LARGE');
      assert.equal((await source.query('compactMembers', {})).rowCount, 32, 'The rejected batch cannot consume members.');
      for (const name of ['oversizedList', 'oversizedSet']) assert.equal((await source.route(name).handler({ query: {} })).status, 413);
      for (const name of ['wrongListType', 'wrongSetType']) {
        const result = await source.route(name).handler({ query: {} });
        assert.equal(result.status, 503); assert.equal(result.body.error, 'QUERY_SOURCE_TYPE_CHANGED');
      }
      assert.equal((await source.query('listInputBoundary', {})).continuationUnavailable, 'INPUT_LIMIT');
      const limitedSet = await source.query('setInputBoundary', {});
      if (limitedSet.scanComplete) assert.equal(limitedSet.nextInput, undefined);
      else assert.equal(limitedSet.continuationUnavailable, 'INPUT_LIMIT');
      for (const cursor of ['01', '-1', '18446744073709551616', '', 0]) {
        const result = source.route('member_catalog').admit({ query: { cursor } });
        assert.equal(result.status, 422); assert.equal(result.body.field, 'cursor');
      }
      return { result: 'PASS', list, set, sparseIteration: { rows: sparseRows.length, removedMembers: removed.size, pages: sparsePages, emptyPages }, compactBatch: { rows: compact.rowCount, scanCount: compact.scanCount },
        emptySet: { rows: empty.rowCount, cursor: empty.scanCursor }, rowLimitStatus: excessive.status };
    },
    async browser({ page, workspace }) {
      const wait = message => page.locator('#status').filter({ hasText: message }).waitFor();
      await page.locator('#query-list button').filter({ hasText: 'list_feed' }).click();
      assert.equal(await page.locator('#query-kind').inputValue(), 'list');
      assert.equal(await page.locator('#offset-label').isVisible(), true);
      assert.deepEqual(JSON.parse(await page.locator('#query-columns').inputValue()), ['index', 'value']);
      await page.locator('#query-rows').fill('1');
      await page.locator('#query-form button[type=submit]').click();
      await page.locator('#save').click(); await wait('Revision saved.');
      await page.locator('#query-list button').filter({ hasText: 'member_catalog' }).click();
      assert.equal(await page.locator('#query-kind').inputValue(), 'set');
      assert.equal(await page.locator('#cursor-label').isVisible(), true);
      assert.equal(await page.locator('#query-cursor').inputValue(), 'cursor');
      await page.locator('#query-scan-count').fill('8');
      await page.locator('#query-form button[type=submit]').click();
      await page.locator('#review').click(); await page.locator('#detail-dialog').waitFor(); await page.locator('#close-detail').click();
      await page.locator('#save').click(); await wait('Revision saved.');
      const head = workspace.metadata().head, identity = workspace.metadata().id;
      await page.reload(); await wait('Workspace ready.');
      assert.equal(workspace.metadata().head, head); assert.equal(workspace.metadata().id, identity);
      await page.locator('[data-tab=preview]').click();
      await page.locator('#preview-version').selectOption(head);
      await page.locator('#preview-query').selectOption('list_feed');
      await page.locator('#preview-input').fill('{"offset":"0"}');
      await page.locator('#run-preview').click(); await wait('Live source preview completed.');
      assert.match(await page.locator('#preview-table').innerText(), /9007199254740993/);
      await page.locator('#next-preview').click(); await wait('Live source preview completed.');
      assert.ok((await page.locator('#preview-table').innerText()).includes(binary.toString('base64')));
      await page.locator('#preview-query').selectOption('member_catalog');
      await page.locator('#preview-input').fill('{"cursor":"0"}');
      await page.locator('#run-preview').click(); await wait('Live source preview completed.');
      let observed = JSON.parse(await page.locator('#preview-json').innerText());
      assert.equal(observed.data.kind, 'set'); assert.equal(observed.data.scanCount, 8);
      if (observed.data.nextInput) {
        const next = observed.data.nextInput;
        await page.locator('#next-preview').click(); await wait('Live source preview completed.');
        observed = JSON.parse(await page.locator('#preview-json').innerText());
        assert.deepEqual(observed.input, next);
      }
      // Read the exact public operation page already used by the original CLI.
      // Keep the retained request ID for cold recovery of this same preview.
      for (let after = ''; !savedScan;) {
        const records = workspace.page('operations', { after, limit: 100 });
        savedScan = records.items.find(row => row.kind === 'preview' && row.status === 'COMPLETED' &&
          row.result?.revisionId === observed.revisionId && row.result?.query === 'member_catalog' &&
          JSON.stringify(row.result?.input) === JSON.stringify(observed.input));
        if (savedScan || !records.nextCursor) break;
        after = records.nextCursor;
      }
      assert.ok(savedScan); savedScan = clone(savedScan);
      workspaceResult = { workspaceId: identity, revisionId: head, operationId: savedScan.id, input: savedScan.result.input,
        scanCursor: savedScan.result.data.scanCursor };
      await page.locator('[data-tab=products]').click();
      return workspaceResult;
    },
    async reopen(workspace) {
      const list = await workspace.preview({ requestId: 'collections-cold-list', revisionId: workspace.metadata().head,
        query: 'list_feed', input: { offset: '0' } });
      assert.equal(list.status, 'COMPLETED'); assert.equal(list.result.data.rows[0].value, '9007199254740993');
      if (savedScan) {
        const outcome = await workspace.preview(savedScan.input);
        assert.deepEqual(outcome, savedScan);
        assert.equal(workspace.metadata().id, workspaceResult.workspaceId);
        if (outcome.result.data.nextInput) {
          const continued = await workspace.preview({ requestId: 'collections-cold-scan-next', revisionId: outcome.result.revisionId,
            query: 'member_catalog', input: outcome.result.data.nextInput });
          assert.equal(continued.status, 'COMPLETED'); assert.deepEqual(continued.result.input, outcome.result.data.nextInput);
        }
      }
      return { result: 'PASS', ...(workspaceResult ?? {}), coldListRequest: list.id };
    },
    async customer(buy, amount) {
      return { result: 'PASS',
        list: await traverse((input, page) => buy('list_feed', input, amount, 'collection-list-' + page), 'list'),
        set: await traverse((input, page) => buy('member_catalog', input, amount, 'collection-set-' + page), 'set') };
    },
  };
}
