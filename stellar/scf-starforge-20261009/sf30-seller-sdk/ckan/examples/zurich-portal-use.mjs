#!/usr/bin/env node
// MIT. Original Zurich source -> reviewed CKAN editions -> complete native customer pages.
import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openCkanWorkbench } from '../model.mjs';
import { readCkanCapture, ExactCkanNumber } from '../capture.mjs';
import { inspectCkanWorkspaceArchive, receiveCkanWorkspaceArchive } from '../archive.mjs';
import { inspectCkanMerchantPackage } from '../publisher/release.mjs';
import { init, append, scan, finalize } from '../../../sf100-buyer-dataset-delivery/deliver.mjs';

const OPERATION = 'LIIP-CKAN-WORKSHARE-814B-20261013';
const ORIGIN = 'https://data.stadt-zuerich.ch';
const PACKAGE = 'e9daec62-5224-4698-87c4-a48644aee724';
const RESOURCE = '35b3d9e2-966f-40fd-a3fc-0daeeae0d66b';
const PERIODS = [
  { date: '2026-10-10', rows: 3821, capture: 'af0bb60022ee9b9e47fbc126f531f6c0ea82b5cdc80d0bd62a56f86dc86e05d7' },
  { date: '2026-10-11', rows: 4389, capture: '0e2cf339299fbaaaf3b1ed478084d9c59b279caeb0f6fe87b538f872920356e7' },
];
const require = (ok, message) => { if (!ok) throw new Error(message); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = value => JSON.stringify(value, null, 2) + '\n';
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
async function privateDir(path) {
  const missing = []; let current = resolve(path);
  while (true) {
    try { await lstat(current); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; missing.push(current); current = dirname(current); }
  }
  for (const created of missing.reverse()) await mkdir(created, { mode: 0o700 });
  const info = await lstat(path);
  require(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077), 'Use a private real directory: ' + path);
}
async function optional(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function save(path, value) {
  const temporary = path + '.next';
  await writeFile(temporary, encoded(value), { mode: 0o600 });
  await rename(temporary, path);
}
async function keep(path, value) {
  const raw = typeof value === 'string' || Buffer.isBuffer(value) ? value : encoded(value);
  try { await writeFile(path, raw, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    require((await readFile(path)).equals(Buffer.from(raw)), 'Saved output changed: ' + path);
  }
  return { file: path, bytes: Buffer.byteLength(raw), sha256: sha(raw) };
}
async function complete(launch) {
  const operation = await launch.completion;
  require(operation.state === 'COMPLETE', (operation.error?.code ?? 'CKAN_OPERATION_INCOMPLETE') + ': ' + (operation.error?.message ?? operation.kind));
  return operation.result;
}
function count(value, name) {
  const text = value instanceof ExactCkanNumber ? value.source : String(value);
  require(/^(?:0|[1-9][0-9]*)$/.test(text), 'Original nonnegative integer required: ' + name);
  const number = Number(text);
  require(Number.isSafeInteger(number), 'Exact integer outside the supported analysis range: ' + name);
  return number;
}
function projection(captures) {
  const fields = captures[0].fields.map(field => field.id);
  require(captures.every(capture => canonical(capture.fields.map(field => field.id)) === canonical(fields)), 'Period source fields changed');
  return Object.fromEntries(fields.map(field => {
    const values = captures.flatMap(capture => capture.rows.map(row => row[field]));
    require(values.every(value => value !== undefined), 'Source field is absent: ' + field);
    const present = values.filter(value => value !== null);
    const nulls = values.some(value => value === null), empty = values.some(value => value === '');
    const kinds = new Set(present.map(value => typeof value));
    let type = kinds.size === 1 ? ({ string: 'string', number: 'number', boolean: 'boolean' }[[...kinds][0]] ?? 'string') : 'string';
    if (type === 'number' && present.every(Number.isSafeInteger)) type = 'integer';
    const encoding = kinds.size !== 1 || kinds.has('object') || nulls && empty ? 'json' : 'native';
    if (encoding === 'json') type = 'string';
    return [field === '_id' ? 'record_id' : field, { field, type, encoding, nullable: encoding === 'json' ? false : nulls }];
  }));
}
function meanings(document) {
  require(document?.source?.packageDictionary?.profile === 'zurich-ssz-fields.v1', 'Original Zurich source dictionary required');
  const defined = document.columns.filter(column => column.dictionarySource?.profile === 'zurich-ssz-fields.v1');
  require(defined.length === 9, 'All nine original Zurich definitions must reach the customer');
  require(defined.some(column => column.sourceField === 'hit_count') && defined.some(column => column.sourceField === 'distinct_ips'), 'Original request and IP meanings are required');
  return document;
}
export async function runZurichPortalUse({ captures: capturesDirectory, directory, out }) {
  capturesDirectory = resolve(capturesDirectory); directory = resolve(directory); out = resolve(out);
  await privateDir(dirname(directory)); await privateDir(directory); await privateDir(out);
  const project = join(directory, 'publisher'), received = join(directory, 'publisher-received');
  const binding = { operation: OPERATION, capturesDirectory, directory, out,
    periods: PERIODS, catalogue: ORIGIN, packageId: PACKAGE, resourceId: RESOURCE };
  const recordPath = join(out, 'publisher-programme.json');
  let record = await optional(recordPath);
  if (record) require(canonical(record.binding) === canonical(binding), 'Resume this original programme and its source paths');
  else record = { schema: 'stellar-forge.zurich-portal-use.v1', binding, state: 'RUNNING', periods: [], steps: [] };
  const note = async (name, value) => {
    record.steps.push({ name, at: new Date().toISOString(), ...value });
    await save(recordPath, record);
    console.log(JSON.stringify({ operation: OPERATION, phase: name, ...value }));
  };
  const captures = [];
  for (const period of PERIODS) {
    const original = await readCkanCapture(join(capturesDirectory, 'captures', period.date, 'capture.json'), period.capture);
    require(original.manifest.catalogOrigin === ORIGIN && original.manifest.packageId === PACKAGE &&
      original.manifest.resourceId === RESOURCE && original.rows.length === period.rows, 'Original selected capture changed');
    const ids = new Set(); let hitCount = 0, missingResourceId = 0, emptySql = 0;
    for (const row of original.rows) {
      require(row.date === period.date && !ids.has(row._id), 'Period or original record identity differs');
      ids.add(row._id); hitCount += count(row.hit_count, 'hit_count');
      require(Number.isSafeInteger(hitCount), 'Request total outside the exact range');
      count(row.distinct_ips, 'distinct_ips');
      if (row.resource_id === null || row.resource_id === '') missingResourceId++;
      if (row.datastore_search_sql_query === null || row.datastore_search_sql_query === '') emptySql++;
    }
    captures.push(original);
    const existing = record.periods.find(item => item.date === period.date);
    const selected = { date: period.date, rows: period.rows, captureSha256: period.capture, hitCount, missingResourceId, emptySql };
    if (existing) for (const [key, value] of Object.entries(selected)) require(existing[key] === value, 'Retained period identity changed');
    else record.periods.push(selected);
  }
  const selectedProjection = projection(captures);
  if (record.projection) require(canonical(record.projection) === canonical(selectedProjection), 'Reviewed projection changed');
  record.projection = selectedProjection;
  await save(recordPath, record);
  const termsFile = new URL('../../../sf61-openapi-seller-import/service-selections.example.json', import.meta.url);
  const termsSource = await readFile(termsFile), terms = JSON.parse(termsSource)[0].accepts[0];
  require(terms.asset === 'DEMO_NONPAYABLE_ASSET' && terms.payTo === 'DEMO_NONPAYABLE_RECIPIENT', 'Use the original unchanged onboarding terms');
  record.onboarding = { source: 'sf61-openapi-seller-import/service-selections.example.json', sourceSha256: sha(termsSource),
    terms, purpose: 'Original package compilation; customer analysis uses the retained public source rows.' };
  const policy = { filters: ['date', 'dataset_name', 'resource_id'], ranges: [], sorts: ['record_id'],
    defaultLimit: 250, maxLimit: 250, order: [{ column: 'record_id', direction: 'asc' }],
    maxRows: 10000, maxBytes: 32 * 1024 * 1024, timeoutMs: 120000 };
  let workbench;
  try {
    workbench = await openCkanWorkbench({ directory: project, create: !(await optional(join(project, 'workbench.json'))), origin: ORIGIN });
    for (let index = 0; index < PERIODS.length; index++) {
      const period = PERIODS[index], saved = record.periods[index];
      let edition = workbench.status().editions.find(item => item.manifestSha256 === period.capture);
      if (!edition) edition = await complete(workbench.importCapture(join(capturesDirectory, 'captures', period.date, 'capture.json'),
        { expectedManifestSha256: period.capture }));
      saved.editionId = edition.id;
      const preview = meanings(await workbench.previewSemantics(edition.id, selectedProjection));
      saved.semanticSha256 = preview.sha256; saved.definitionSha256 = preview.definitionSha256;
      let source;
      if (index === 0) {
        source = workbench.status().sources.find(item => item.editionId === edition.id && item.query === 'portal_use');
        if (!source) source = await complete(workbench.saveSource(edition.id, { expectedCaptureSha256: period.capture,
          title: 'Zurich portal use ' + period.date, query: 'portal_use', projection: selectedProjection }));
      } else {
        const previous = record.periods[index - 1];
        const beforeSource = workbench.status().sources.find(item => item.id === previous.sourceId);
        require(beforeSource, 'Original first-period source is required');
        let refresh = await complete(workbench.prepareRefresh(beforeSource.id, { afterEditionId: edition.id,
          expectedSourceSha256: beforeSource.sha256, expectedAfterCaptureSha256: period.capture,
          previousPublicationId: previous.publicationId, keys: ['_id'] }));
        const detail = await workbench.refresh(refresh.id);
        record.refresh = { id: refresh.id, comparisonSha256: refresh.comparisonSha256, comparison: detail.comparison };
        if (refresh.state !== 'ACCEPTED') {
          const view = await workbench.previewRefresh(refresh.id, { expectedComparisonSha256: refresh.comparisonSha256,
            title: 'Zurich portal use ' + period.date, query: 'portal_use', projection: selectedProjection });
          refresh = await complete(workbench.reviewRefresh(refresh.id, { expectedComparisonSha256: refresh.comparisonSha256,
            expectedProjectionSha256: view.projectionSha256, expectedSemanticsSha256: view.semanticReview?.sha256 ?? null,
            expectedDefinitionSha256: view.semanticReview?.definitionSha256 ?? null,
            decision: 'accept', reviewer: '814B original Liip workshare operator',
            note: 'Accept the next selected calendar-date edition. Removed and added row IDs compare different date selections. Preserve all original definitions, null/empty distinctions and request counts.',
            title: view.title, query: view.query, projection: view.projection }));
        }
        source = workbench.status().sources.find(item => item.id === refresh.acceptedSourceId);
        require(source, 'The reviewed refresh must select its original accepted source');
        record.refresh.decisionSha256 = refresh.decisionSha256;
      }
      const sourceMeaning = meanings(await workbench.sourceSemantics(source.id));
      require(sourceMeaning.sha256 === preview.sha256, 'Saved source meaning changed after review');
      saved.sourceId = source.id; saved.sourceSha256 = source.sha256;
      await note('reviewed source ' + period.date, { sourceId: source.id, rows: period.rows, semantics: preview.sha256 });
      let publication = workbench.status().publications.find(item => item.sourceId === source.id);
      if (!publication) publication = await complete(workbench.createPublication(source.id, policy));
      if (['FAILED', 'INTERRUPTED', 'CANCELLED', 'PUBLICATION_UNKNOWN'].includes(publication.state))
        publication = await complete(workbench.recoverPublication(publication.id));
      let detail = await workbench.publication(publication.id);
      const candidate = detail.run.data.candidate;
      require(candidate.dataset.rowCount === period.rows, 'Published candidate omitted source rows');
      if (!['REVIEWED', 'PUBLISHED'].includes(detail.run.state)) {
        await complete(workbench.reviewPublication(publication.id, { expectedCandidateDigest: candidate.candidateDigest,
          reviewer: '814B original Liip workshare operator',
          note: 'Review all selected rows, original Zurich definitions and CC0 source. The report counts requests, retains source IP aggregates and keeps the selected date.' }));
        detail = await workbench.publication(publication.id);
      }
      if (detail.run.state !== 'PUBLISHED') await complete(workbench.publishDataset(publication.id, detail.run.data.review.id));
      saved.publicationId = publication.id; saved.candidateDigest = candidate.candidateDigest; saved.snapshot = candidate.dataset.snapshot;
      let exported = workbench.status().exports.find(item => item.publicationId === publication.id);
      if (!exported) exported = await complete(workbench.exportMerchant(publication.id, {
        expectedCandidateDigest: candidate.candidateDigest, payment: terms,
        origin: 'https://zurich-portal-use.example.org', path: '/data' }));
      await inspectCkanMerchantPackage(exported.directory, exported.manifestSha256);
      saved.exportId = exported.id; saved.exportManifestSha256 = exported.manifestSha256;
      const handlers = await import(pathToFileURL(join(exported.directory, 'handlers.mjs')).href);
      const delivery = join(out, 'customer-pages', period.date), rawRoot = join(out, 'original-responses', period.date);
      await privateDir(dirname(delivery)); await privateDir(rawRoot);
      if (!(await optional(join(delivery, 'session.json')))) await init(delivery);
      let current = await scan(delivery, { retainPayload: false });
      if (!current.finalized) {
        while (current.pages.length === 0 || current.nextCursor !== null) {
          const query = new URLSearchParams({ limit: '250', sort: 'record_id', snapshot: saved.snapshot,
            semantics: saved.semanticSha256 });
          if (current.nextCursor !== null) query.set('cursor', current.nextCursor);
          const context = { query };
          require(handlers.admitDataset(context) === true, 'Original merchant rejected its selected customer page');
          const response = handlers.queryDataset(context);
          require(response.status === 200 && response.body.semantics.sha256 === saved.semanticSha256, 'Original customer response failed');
          const file = join(rawRoot, String(current.pages.length).padStart(6, '0') + '.json');
          await keep(file, response.body);
          await append(delivery, { page: file, intent: 'liip-zurich-' + period.date + '-page-' + current.pages.length,
            ...(current.pages.length ? { cursor: current.nextCursor } : {}) });
          current = await scan(delivery, { retainPayload: false });
        }
        await finalize(delivery);
      }
      current = await scan(delivery, { retainPayload: false });
      require(current.finalized && current.nextCursor === null && current.count === period.rows, 'Complete original customer delivery required');
      meanings(current.semanticDocument);
      saved.customer = { directory: delivery, pages: current.pages.length, rows: current.count,
        chain: current.chain, scan: join(out, 'scan-' + period.date + '.json') };
      await save(saved.customer.scan, current);
      await note('complete customer pages ' + period.date, { publicationId: publication.id, exportId: exported.id,
        rows: current.count, pages: current.pages.length });
    }
    require(record.periods[0].definitionSha256 === record.periods[1].definitionSha256, 'Original meaning definition changed between the two selected periods');
    if (!record.publisherArchive) {
      record.publisherArchive = await complete(workbench.archiveWorkspace({ out: join(out, 'Zurich_Publisher_Workspace.ckanw'),
        maxBytes: 512 * 1024 * 1024, maxFiles: 20000 }));
      await note('complete publisher workspace exported', { sha256: record.publisherArchive.sha256 });
    }
    await workbench.close(); workbench = null;
    const inspected = await inspectCkanWorkspaceArchive({ file: record.publisherArchive.file,
      expectedSha256: record.publisherArchive.sha256 });
    if (!(await optional(join(received, 'workbench.json'))))
      record.publisherReceiving = await receiveCkanWorkspaceArchive({ file: record.publisherArchive.file,
        directory: received, expectedSha256: record.publisherArchive.sha256 });
    workbench = await openCkanWorkbench({ directory: received });
    const reopened = workbench.status();
    require(reopened.editions.length === 2 && reopened.sources.length === 2 && reopened.publications.length === 2 &&
      reopened.exports.length === 2 && reopened.refreshes.length === 1, 'Cold-received project history differs');
    for (const period of record.periods) {
      const meaning = meanings(await workbench.sourceSemantics(period.sourceId));
      require(meaning.sha256 === period.semanticSha256, 'Cold-received source meaning changed');
      const publication = await workbench.publication(period.publicationId, 'limit=1&sort=record_id');
      require(publication.run.state === 'PUBLISHED' && publication.detail.preview.page.total === period.rows, 'Cold-received dataset changed');
      const exported = reopened.exports.find(item => item.id === period.exportId);
      const verified = await inspectCkanMerchantPackage(exported.directory, period.exportManifestSha256);
      require(verified.manifest.dataset.rowCount === period.rows, 'Cold-received complete merchant changed');
    }
    await note('cold publisher workspace reopened', { editions: 2, sources: 2, publications: 2, files: inspected.files });
    record.state = 'COMPLETE'; record.completedAt = new Date().toISOString(); delete record.error;
    await save(recordPath, record);
    return record;
  } catch (error) {
    record.state = 'INCOMPLETE'; record.error = { code: error.code ?? 'ZURICH_PROGRAMME_FAILED', message: error.message };
    await save(recordPath, record); throw error;
  } finally { await workbench?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) console.log('node zurich-portal-use.mjs --captures ORIGINAL_CAPTURE_ROOT --directory PRIVATE_PROJECT_ROOT --out PRIVATE_DELIVERY_ROOT');
  else {
    const values = {};
    for (let i = 0; i < args.length; i += 2) {
      require(['--captures', '--directory', '--out'].includes(args[i]) && args[i + 1] && !Object.hasOwn(values, args[i]), 'Use --help for the original programme arguments');
      values[args[i]] = args[i + 1];
    }
    require(values['--captures'] && values['--directory'] && values['--out'], 'All original directory arguments are required');
    await runZurichPortalUse({ captures: values['--captures'], directory: values['--directory'], out: values['--out'] })
      .then(record => console.log(JSON.stringify({ state: record.state, operation: OPERATION,
        periods: record.periods.map(({ date, rows, hitCount }) => ({ date, rows, hitCount })) })))
      .catch(error => { console.error(error.stack); process.exitCode = 1; });
  }
}
