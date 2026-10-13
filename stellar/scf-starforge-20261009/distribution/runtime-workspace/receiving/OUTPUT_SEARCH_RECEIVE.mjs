// MIT. One complete source-derived continuation for the original native Runtime receiving course.
import { mkdir, readFile, open, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { writeApplicationOutputDownload } from '../application-output.mjs';
import { openRuntimeWorkspace } from '../model.mjs';
const check = (condition, message) => { if (!condition) throw new Error(message); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function save(path, value) { await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
async function exact(handle, start, length) {
  const bytes = Buffer.alloc(length); let read = 0;
  while (read < length) {
    const item = await handle.read(bytes, read, length - read, start + read);
    check(item.bytesRead, 'Retained original output ended inside an expected byte range.'); read += item.bytesRead;
  }
  return bytes;
}
export async function receiveCompleteOutputSearch({
  page, model, outputDirectory, source, query, openOutput, kind = 'runtime',
}) {
  check(page && model && typeof openOutput === 'function', 'Use the current native browser, writer and original source selector.');
  check(['runtime', 'application'].includes(kind), 'Choose the original output kind.');
  check(typeof query === 'string' && Buffer.byteLength(query) > 0, 'Supply a useful literal from this actual original output.');
  const directory = join(outputDirectory, 'complete-output-search', randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const prefix = kind === 'application' ? 'applications' : 'runtime';
  const method = prefix + 'Output', files = [];
  for (const relative of ['application-output.mjs', 'runtime-output.mjs', 'output-search-core.mjs', 'output-search-cli.mjs',
    'model.mjs', 'server.mjs', 'cli.mjs', 'public/application-output.mjs', 'public/runtime-output.mjs',
    'public/output-search.mjs', 'public/output-search.css', 'browser-assets.json', 'OUTPUT_SEARCH.md',
    'receiving/OUTPUT_SEARCH_RECEIVE.mjs']) {
    const bytes = await readFile(fileURLToPath(new URL('../' + relative, import.meta.url)));
    files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
  }
  const selected = await model[method + 'Page']({ ...source, offset: 0 });
  const input = { ...source, selection: selected.selection, query, contextBytes: 96 };
  await save(join(directory, 'input.json'), { kind, source, query, selected, sourceFiles: files });
  const original = await writeApplicationOutputDownload(await model[method + 'Download']({
    ...source, selection: selected.selection }), join(directory, 'original-selected.log'));
  const exported = await writeApplicationOutputDownload(await model[method + 'SearchDownload'](input),
    join(directory, 'complete-search.jsonl'));
  const needle = Buffer.from(query), output = await open(original.output, 'r');
  let first = null, final = null, matches = 0, prior = -1;
  try {
    const lines = createInterface({ input: createReadStream(exported.output), crlfDelay: Infinity });
    for await (const line of lines) {
      const value = JSON.parse(line);
      if (value.type === 'selection') { check(!first, 'Duplicate selection header.'); first = value; continue; }
      if (value.type === 'complete') { check(!final, 'Duplicate complete marker.'); final = value; continue; }
      check(!final && value.type === 'page' && value.selection === selected.selection &&
        value.query === query, 'Search page changed original selection or followed its complete marker.');
      for (const match of value.matches) {
        check(match.offset > prior && match.endOffset === match.offset + needle.length, 'Original match coordinates changed.');
        check((await exact(output, match.offset, needle.length)).equals(needle), 'Match is not the actual original literal.');
        const context = await exact(output, match.context.offset, match.context.endOffset - match.context.offset);
        check(context.length === match.context.bytes && context.equals(Buffer.from(match.context.base64, 'base64')) &&
          hash(context) === match.context.sha256 && context.toString('utf8') === match.context.text,
        'Original context bytes changed in complete search export.');
        prior = match.offset; matches++;
      }
    }
    check(first && final && final.done === true && final.selection === selected.selection &&
      final.matches === matches && first.endOffset === original.bytes, 'Complete original search export is incomplete.');
    // Independent streamed literal count over the downloaded original file.
    let tail = Buffer.alloc(0), seen = 0, expected = 0;
    for await (const chunk of createReadStream(original.output, { highWaterMark: 65536 })) {
      const joined = Buffer.concat([tail, chunk]), base = seen - tail.length;
      for (let at = joined.indexOf(needle); at >= 0; at = joined.indexOf(needle, at + 1))
        if (base + at + needle.length > seen) expected++;
      seen += chunk.length; tail = joined.subarray(Math.max(0, joined.length - needle.length + 1));
    }
    check(seen === original.bytes && expected === matches, 'Search omitted or duplicated an actual overlapping source match.');
  } finally { await output.close(); }
  check(matches > 0, 'Choose a literal that occurs in this actual source for the browser match journey.');
  await openOutput(page, source);
  const desk = page.locator('.output-search-desk:visible');
  check(await desk.count() === 1, 'Open one original output reader.');
  // Select the same fixed-end original through the reader's own retained state.
  await desk.locator('[data-output-search="query"]').fill(query);
  const route = kind === 'application' ? '/api/applications/output-search' : '/api/runtime-output/search';
  const response = page.waitForResponse(value => value.url().endsWith(route) && value.request().method() === 'POST');
  await desk.locator('[data-output-search="start"]').click();
  const accepted = await response, firstPage = await accepted.json();
  check(accepted.ok() && firstPage.query === query && firstPage.selection, 'Native browser search was not accepted.');
  await desk.locator('[data-output-search-offset]').first().waitFor();
  const browserMatch = Number(await desk.locator('[data-output-search-offset]').first().getAttribute('data-output-search-offset'));
  const pageRoute = kind === 'application' ? '/api/applications/output-page' : '/api/runtime-output/page';
  const jumped = page.waitForResponse(value => new URL(value.url()).pathname === pageRoute &&
    new URL(value.url()).searchParams.get('selection') === firstPage.selection &&
    new URL(value.url()).searchParams.get('offset') === String(browserMatch));
  await desk.locator('[data-output-search-offset]').first().click();
  const jumpResponse = await jumped, actualPage = await jumpResponse.json();
  check(jumpResponse.ok() && actualPage.selection === firstPage.selection &&
    actualPage.offset <= browserMatch && actualPage.nextOffset > browserMatch, 'Match did not open its exact original byte page.');
  const screenshots = [];
  for (const width of [1360, 390]) {
    await page.setViewportSize({ width, height: 960 });
    const path = join(directory, 'search-' + width + '.png'); await page.screenshot({ path, fullPage: true }); screenshots.push(path);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Original search controls overflow the receiving viewport.');
  }
  const browserDownload = page.waitForEvent('download'); await desk.locator('[data-output-search="export"]').click();
  const downloaded = await browserDownload, downloadedPath = join(directory, 'browser-complete-search.jsonl');
  await downloaded.saveAs(downloadedPath);
  const browserHash = createHash('sha256'); let browserBytes = 0, browserHeader = null, browserComplete = null;
  for await (const bytes of createReadStream(downloadedPath)) { browserHash.update(bytes); browserBytes += bytes.length; }
  const browserLines = createInterface({ input: createReadStream(downloadedPath), crlfDelay: Infinity });
  for await (const line of browserLines) {
    const row = JSON.parse(line);
    if (!browserHeader) browserHeader = row;
    if (row.type === 'complete') browserComplete = row;
    else check(!browserComplete, 'Browser search contains rows after its completion.');
  }
  check(browserHeader?.selection === firstPage.selection && browserComplete?.type === 'complete' &&
    browserComplete.done === true && browserComplete.selection === firstPage.selection,
    'Browser download did not retain its complete selected search.');
  await page.reload(); await openOutput(page, source);
  await page.waitForFunction(selection => [...document.querySelectorAll('.output-search-desk')]
    .some(node => node.textContent.includes('exact query') &&
      [...document.querySelectorAll('pre')].some(pre => pre.textContent !== '') &&
      Object.values(sessionStorage).some(raw => raw.includes(selection))), firstPage.selection);
  check((await desk.locator('[data-output-search="query"]').inputValue()) === query, 'Original exact query did not reopen.');
  const reopened = await openRuntimeWorkspace({ directory: model.directory });
  let reopenedSearch;
  try { reopenedSearch = await reopened[method + 'Search']({ ...source, query, selection: firstPage.selection, contextBytes: 96, limit: 100 }); }
  finally { await reopened.close(); }
  check(reopenedSearch.selection === firstPage.selection && reopenedSearch.query === query,
    'Native reopened search changed original identities.');
  const result = { schema: 'stellar-forge.output-search-receiving.v1', kind, source, query,
    original, exported, matches, firstPage, actualPage, reopenedSearch, screenshots,
    browserDownload: { path: downloadedPath, bytes: browserBytes, sha256: browserHash.digest('hex') },
    renderedInspection: { screenshots, required: 'Open and inspect these actual desktop/narrow screenshots and downloaded originals in the existing receiving session.' } };
  await save(join(directory, 'result.json'), result); return { directory, ...result };
}
