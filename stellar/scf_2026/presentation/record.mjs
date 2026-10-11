// MIT. Record the original maintained MCP buyer and edited presentation cards.
import { mkdir, readFile, writeFile, rename, stat, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const input = process.argv[2];
if (!input) throw new Error('Usage: node record.mjs /private/capture-config.json');
const cfg = JSON.parse(await readFile(input, 'utf8'));
const film = JSON.parse(await readFile(new URL('./film.json', import.meta.url), 'utf8'));
for (const name of ['source', 'output', 'state', 'originalState', 'nativeOperation',
  'nativeInspection', 'nativeResponse', 'merchantPackage', 'sourceIdentity', 'playwright', 'chromium'])
  if (typeof cfg[name] !== 'string' || !cfg[name].startsWith('/')) throw new Error('Absolute configuration path required: ' + name);
if (resolve(cfg.state) === resolve(cfg.originalState)) throw new Error('Use a separate recording state directory.');
const fps = 6, width = 1440, height = 700;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function atomic(path, value) {
  const temporary = path + '.tmp-' + process.pid;
  await writeFile(temporary, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, path);
}
const operation = await json(cfg.nativeOperation), inspection = await json(cfg.nativeInspection);
const response = await readFile(cfg.nativeResponse), native = JSON.parse(response);
const sourceIdentity = await json(cfg.sourceIdentity);
check(operation.status === 'COMPLETE' && inspection.status === 'COMPLETED', 'The original operation and inspection must be complete.');
check(inspection.originalOperation === operation.operationId, 'Original operation reference mismatch.');
check(response.length === operation.result.bytes && sha(response) === operation.result.sha256, 'Original response identity mismatch.');
check(native._meta?.['x402/payment-response']?.transaction === operation.chain.hash, 'Original payment and response mismatch.');
check(native.structuredContent?.rowCount === 100 && native.structuredContent.columns?.length === 14 &&
  native.structuredContent.truncated === true && native.structuredContent.valueEncoding === 'mysql-exact-scalars',
  'The HPD source response shape changed.');
check(sourceIdentity.commit === film.sourceCommit && sourceIdentity.all_match === true, 'Published source identity mismatch.');
for (const file of sourceIdentity.files) {
  const bytes = await readFile(join(cfg.source, file.path));
  check(bytes.length === file.bytes && sha(bytes) === file.sha256, 'Recorded source changed: ' + file.path);
}
const packageRecord = await json(join(cfg.merchantPackage, 'mcp-package.json'));
const customer = await json(join(cfg.merchantPackage, 'customer/mcp.json'));
const mysql = await json(join(cfg.merchantPackage, 'mysql/package/source.json'));
for (const name of ['customer/mcp.json', 'mysql/package/source.json']) {
  const expected = packageRecord.files.find(file => file.file === name);
  const bytes = await readFile(join(cfg.merchantPackage, name));
  check(expected && expected.bytes === bytes.length && expected.sha256 === sha(bytes), 'Merchant source changed: ' + name);
}
check(packageRecord.reviewId === operation.mysqlPackageReopened.reviewId &&
  customer.reviewId === packageRecord.reviewId, 'Merchant review identity mismatch.');
const quoteId = operation.quoteId;
const originalObservation = inspection.observations.find(row => row.quoteId === quoteId);
check(originalObservation?.report.outcome === 'TRANSFER_MATCHED' &&
  originalObservation.report.transaction === operation.chain.hash &&
  originalObservation.report.ledger === operation.chain.ledger, 'Matched original transaction observation missing.');
const tool = customer.tools.find(row => row.name === operation.query);
check(tool && mysql.queries[tool.name], 'Original merchant query is missing.');

await mkdir(cfg.output, {recursive: true});
await mkdir(join(cfg.output, 'clips'), {recursive: true});
await mkdir(join(cfg.output, 'review'), {recursive: true});
await mkdir(cfg.state, {recursive: true, mode: 0o700});
await chmod(cfg.state, 0o700);
const moduleRoot = join(cfg.source, 'stellar-forge/mcp-paid-agent');
const {SqliteQuoteStore} = await import(pathToFileURL(join(moduleRoot, 'quote-store.mjs')));
const {McpResultStore, importRetainedMcpResult} = await import(pathToFileURL(join(moduleRoot, 'result-store.mjs')));
const {startMcpWorkspace} = await import(pathToFileURL(join(moduleRoot, 'serve.mjs')));
const playwrightModule = await import(pathToFileURL(cfg.playwright));
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
check(typeof chromium?.launch === 'function', 'The configured Playwright module has no Chromium launcher.');

let sourceStore;
let sourceQuotes;
try {
  sourceStore = new SqliteQuoteStore({directory: cfg.originalState, readOnly: true});
  sourceQuotes = sourceStore.load().filter(row => inspection.observations.some(item => item.quoteId === row.quoteId));
} finally { sourceStore?.close(); }
check(sourceQuotes.length === inspection.quoteCount, 'Original closed history is incomplete.');
const sourceQuote = sourceQuotes.find(row => row.quoteId === quoteId);
check(sourceQuote?.status === 'CONFIRMED_BY_SERVER' && sourceQuote.attempts === 1 &&
  sourceQuote.result?.reconciliation?.outcome === 'TRANSFER_MATCHED', 'Original completed quote changed.');
const expectedQuotes = sourceQuotes.map(row => ({quoteId: row.quoteId, status: row.status, attempts: row.attempts,
  bytes: row.result.responseFile.bytes, sha256: row.result.responseFile.sha256,
  observation: row.result.reconciliation?.outcome}));
let quoteStore, resultStore;
try {
  quoteStore = new SqliteQuoteStore({directory: cfg.state});
  resultStore = new McpResultStore({directory: join(cfg.state, 'results')});
  const existing = quoteStore.load();
  for (const original of sourceQuotes) {
    let copy = existing.find(row => row.quoteId === original.quoteId);
    if (!copy) {
      const bytes = await readFile(original.result.responseFile.path);
      check(bytes.length === original.result.responseFile.bytes && sha(bytes) === original.result.responseFile.sha256,
        'A retained source result changed.');
      copy = structuredClone(original);
      delete copy.result.responseFile;
      quoteStore.save(copy);
      await importRetainedMcpResult({quoteStore, resultStore, quoteId: copy.quoteId, bytes});
    } else {
      check(copy.status === original.status && copy.attempts === original.attempts &&
        copy.result?.responseFile?.sha256 === original.result.responseFile.sha256,
        'The existing recording state belongs to a different operation.');
    }
  }
} finally { await resultStore?.close(); quoteStore?.close(); }

const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;');
const mono = value => '<code>' + esc(value) + '</code>';
function card(body) {
  return '<!doctype html><html lang="en"><meta charset="utf-8"><title>Stellar Forge presentation</title><style>' +
  '*{box-sizing:border-box}body{margin:0;background:#fff;color:#202020;font:24px/1.4 Arial,sans-serif;padding:48px 64px}' +
  'h1{font-size:62px;line-height:1.1;letter-spacing:-1.8px;margin:16px 0 26px}h2{font-size:30px;line-height:1.2;margin:6px 0 16px}' +
  'p{margin:12px 0;color:#555}small,.eyebrow{font-size:15px;letter-spacing:1.5px;color:#666;text-transform:uppercase}' +
  '.line{height:1px;background:#ccc;margin:28px 0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}' +
  '.two{grid-template-columns:1fr 1fr}.cell{border:1px solid #bbb;padding:22px;min-height:170px}.small{font-size:20px}' +
  '.num{font-size:45px;letter-spacing:-1px}.tag{display:inline-block;border:1px solid #aaa;padding:6px 11px;font-size:16px;margin:0 9px 9px 0}' +
  'code,pre{font:19px/1.5 "DejaVu Sans Mono",monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap;padding:18px;border:1px solid #ccc;background:#f7f7f7;margin:12px 0}' +
  '.wide{font-size:17px}.receipt{display:grid;grid-template-columns:180px 1fr;gap:10px;font-size:19px}.receipt>span{color:#666}' +
  '</style><body>' + body + '</body></html>';
}
function cardFor(id) {
  if (id === 'title') return card('<div class="eyebrow">Stellar Community Fund · Open Track</div>' +
    '<h1>Stellar Discovery<br>Trust Layer</h1><p style="font-size:32px">From useful merchant data<br>to a paid, retained result.</p>' +
    '<div class="line"></div><span class="tag">Stellar Forge</span><span class="tag">Product walkthrough · 11 October 2026</span>');
  if (id === 'team') return card('<div class="eyebrow">Individual applicant · TokenJunkie Labs</div><h1>' +
    esc(film.founder) + '</h1><div class="grid two"><div class="cell"><h2>Product and delivery</h2><p class="small">' +
    'Product direction, commercial relationships and customer delivery.</p></div><div class="cell"><h2>AI-assisted engineering</h2>' +
    '<p class="small">Implementation, review, native operation and documentation.</p></div></div>' +
    '<div class="line"></div><p class="small">AI assistance is disclosed for the engineering, documentation and this captioned presentation.</p>');
  if (id === 'source') return card('<div class="eyebrow">Original reviewed merchant package · NYC HPD source</div>' +
    '<h1 style="font-size:48px">' + esc(tool.name) + '</h1><p class="small">' + esc(tool.description) + '</p>' +
    '<div class="grid two" style="margin-top:22px"><div class="cell"><small>Selected original arguments</small><pre>' +
    esc(JSON.stringify(operation.arguments, null, 2)) + '</pre></div><div class="cell"><small>Retained query configuration</small>' +
    '<h2>' + mysql.queries[tool.name].maxRows + ' rows · ' + mysql.queries[tool.name].columns.length + ' columns</h2>' +
    '<p class="small">Named read query · ' + esc(native.structuredContent.valueEncoding) + '</p><p class="small">' +
    esc(operation.source.source_row_count.toLocaleString('en-US')) + ' source project-event records</p></div></div>' +
    '<p class="wide">Source vintage: ' + esc(operation.source.data_as_of) + ' · Package review ' + mono(packageRecord.reviewId.slice(0,16)) + '</p>');
  if (id === 'reopening') return card('<div class="eyebrow">Continue the same original operation</div>' +
    '<h1>Reopen the buyer workspace.</h1><p style="font-size:30px">The completed quote and its saved result<br>remain in the same recording workspace.</p>' +
    '<div class="line"></div><div class="receipt"><span>Original quote</span>' + mono(quoteId) +
    '<span>Complete result</span><strong>' + response.length.toLocaleString('en-US') + ' bytes · ' +
    native.structuredContent.rowCount + ' rows</strong></div>');
  if (id === 'delivery') return card('<div class="eyebrow">Maintained source · Installed release</div>' +
    '<h1 style="font-size:48px">A product operators can continue.</h1><div class="grid">' +
    '<div class="cell"><small>Merchant</small><h2>Publish a useful tool</h2><p class="small">Reviewed MySQL query, customer declaration and exact payment terms.</p></div>' +
    '<div class="cell"><small>Buyer</small><h2>Use the result</h2><p class="small">Original quote, complete data, transaction observation and saved history.</p></div>' +
    '<div class="cell"><small>Receiving operator</small><h2>Install and hand over</h2><p class="small">Maintained CLI, source package, operating guides and recovery workflow.</p></div></div>' +
    '<p class="small" style="margin-top:24px">Release: ' + mono('0.1.0-source.g' + film.sourceCommit.slice(0,12)) + '</p>' +
    '<p class="wide">Merchant and buyer source: github.com/woahwhattheheck/public-commons-sprint-2026</p>');
  if (id === 'plan') return card('<div class="eyebrow">Proposed funded work · $38,000 · 400 future hours · 150 days</div>' +
    '<h1 style="font-size:47px">Independent operators. Repeated use.</h1><div class="grid">' +
    '<div class="cell"><small>Day 30</small><h2>Merchant use</h2><p class="small">Two independent merchant operators; installation and second-operator handover.</p></div>' +
    '<div class="cell"><small>Day 90</small><h2>Testnet use</h2><p class="small">Two independent buyers; two facilitators; 10 useful purchases over 7 consecutive days.</p></div>' +
    '<div class="cell"><small>Day 150</small><h2>Mainnet use</h2><p class="small">Two installations; 30 useful purchases over 14 consecutive days; both buyers return.</p></div></div>' +
    '<p class="small" style="margin-top:24px">Current baseline: seven team-operated testnet purchases with usable retained results.</p>' +
    '<p class="small">The request funds future deployment, operation, recovery and handover.</p>');
  if (id === 'close') return card('<div class="eyebrow">Open source · Stellar Forge</div><h1>Useful data.<br>Delivered and recoverable.</h1>' +
    '<p style="font-size:29px">Merchant operation · Stellar purchase · retained result</p><div class="line"></div><p>' +
    esc(film.founder) + ' · Individual applicant</p><p class="small">github.com/woahwhattheheck/public-commons-sprint-2026</p>');
  throw new Error('Unknown presentation card: ' + id);
}

const token = randomBytes(32).toString('base64url');
const environment = {
  BAZAAR_DISCOVERY_URL: customer.discoveryUrl,
  MCP_ACCESS_TOKEN: token, MCP_STATE_DIR: cfg.state, MCP_PORT: '0',
  MCP_PROVIDER_TIMEOUT_MS: '120000',
  PAID_RESOURCE_ORIGINS: [...new Set(sourceQuotes.map(row => new URL(row.url).origin))].join(',')
};
// Saved transaction observations are read from the original quote. The recording
// workspace needs no signer or observation adapter to reopen these existing files.
let workspace, browser, buyer, cards, context, encoder;
const errors = [], clips = [], chapters = [], steps = [];
const startedAt = new Date().toISOString();
let downloaded, reopened, completed = false;
const sourceFacts = [
  {label:'Original operation', value:operation.operationId},
  {label:'Recorded source commit', value:film.sourceCommit},
  {label:'Source files matched to the published release', value:sourceIdentity.file_count},
  {label:'Original quote', value:quoteId},
  {label:'Original native transaction', value:operation.chain.hash},
  {label:'Stellar testnet ledger', value:operation.chain.ledger},
  {label:'Original payment', value:'50000 stroops / 0.005 testnet XLM'},
  {label:'Matched observation recorded at', value:originalObservation.report.checkedAt},
  {label:'Original result', value:response.length + ' bytes; SHA-256 ' + sha(response)},
  {label:'Original result structure', value:'100 rows; 14 columns; configured truncation; mysql-exact-scalars'},
  {label:'Data source', value:operation.source.provider + '; ' + operation.source.scope, source:operation.source.url},
  {label:'Retained source vintage', value:operation.source.data_as_of},
  {label:'Merchant package review', value:packageRecord.reviewId},
  {label:'Recording method', value:'Edited captures of the original UI; chapter holds encoded directly into clips'},
  {label:'AI assistance', value:'Engineering, review, documentation and this presentation'}
];
async function checkpoint() {
  await atomic(join(cfg.output, 'capture.json'), {
    schema:'stellar-forge.presentation.capture/2', status: completed ? 'COMPLETE' : errors.length ? 'FAILED' : 'IN_PROGRESS',
    film, chapters, clips, errors, sourceCommit:film.sourceCommit, sourceRepository:film.sourceRepository,
    sourceFacts, startedAt, capturedAt:new Date().toISOString(), steps,
    originalQuoteStates:expectedQuotes, originalOperation:operation.operationId,
    transaction:operation.chain.hash, responseBytes:response.length, responseSha256:sha(response),
    paymentAdapterConnected:false, newAuthorizations:0, newPayments:0, downloaded, reopened
  });
}
async function startWorkspace() {
  workspace = await startMcpWorkspace({environment});
  check(workspace.paymentAdapterConnected === false, 'The recording workspace unexpectedly has a signer.');
}
async function connect() {
  await buyer.goto(workspace.consoleUrl);
  await buyer.locator('#access-token').fill(token);
  await buyer.getByRole('button', {name:'Connect', exact:true}).click();
  await buyer.locator('#workspace').waitFor({state:'visible'});
}
async function history() {
  await buyer.getByRole('button', {name:'Quote history', exact:true}).click();
  await buyer.locator('#history-list tr').filter({hasText:quoteId.slice(0,8)}).waitFor();
  await buyer.evaluate(() => window.scrollTo(0,0));
}
async function openQuote() {
  await history();
  await buyer.locator('#history-list tr').filter({hasText:quoteId.slice(0,8)})
    .getByRole('button', {name:'Open quote', exact:true}).click();
  await buyer.locator('#quote-detail').getByText(quoteId, {exact:true}).waitFor();
  await focus('#quote-detail');
}
async function focus(selector) {
  await buyer.locator(selector).evaluate(element => element.scrollIntoView({behavior:'instant', block:'start'}));
  await buyer.waitForTimeout(100);
}
async function openResult() {
  await buyer.getByRole('button', {name:'Read complete saved result', exact:true}).click();
  await buyer.getByRole('heading', {name:'Complete saved result', exact:true}).waitFor();
  await buyer.getByRole('tab', {name:'Structured data', exact:true}).click();
  await buyer.locator('#record-source').selectOption({label:'rows · 100 records'});
  await focus('#result-detail');
}
async function inspectResult() {
  await buyer.getByRole('tab', {name:'Complete JSON', exact:true}).click();
  const bytes = Buffer.from(await buyer.locator('#result-body pre').innerText());
  check(bytes.length === response.length && sha(bytes) === sha(response), 'The actual UI returned different result bytes.');
  return {bytes:bytes.length, sha256:sha(bytes)};
}
async function showCard(id, show, seconds) {
  await cards.setContent(cardFor(id));
  await show(cards, seconds);
}
async function recordChapter(spec, program) {
  const relative = 'clips/' + spec.id + '.mp4', output = join(cfg.output, relative);
  const temporary = output + '.partial.mp4';
  const args = ['-hide_banner','-loglevel','warning','-nostdin','-y',
    '-f','image2pipe','-framerate',String(fps),'-vcodec','mjpeg','-i','pipe:0','-an',
    '-c:v','libx264','-preset','ultrafast','-crf','18','-threads','1',
    '-x264-params','ref=1:bframes=0:rc-lookahead=0:sync-lookahead=0',
    '-pix_fmt','yuv420p','-r',String(fps),'-video_track_timescale','12288',
    '-movflags','+faststart',temporary];
  encoder = spawn(cfg.ffmpeg || 'ffmpeg', args, {stdio:['pipe','ignore','pipe']});
  const activeEncoder = encoder;
  let stderr = '', processFailure;
  activeEncoder.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
  activeEncoder.stdin.on('error', failure => { processFailure = failure; });
  activeEncoder.on('error', failure => { processFailure = failure; });
  const closed = new Promise(done => activeEncoder.once('close', (code, signal) => done({code,signal})));
  let frames = 0, lastImage, lastPage;
  const totalFrames = Math.round(spec.seconds * fps);
  async function emit(bytes, count) {
    for (let n = 0; n < count; n++) {
      if (processFailure || activeEncoder.exitCode !== null)
        throw new Error('Chapter encoder ended before capture: ' + spec.id + ' ' + stderr);
      if (!activeEncoder.stdin.write(bytes)) await once(activeEncoder.stdin, 'drain');
      frames++;
    }
  }
  async function show(page, seconds) {
    const count = Math.round(seconds * fps);
    check(count > 0 && frames + count <= totalFrames, 'Chapter timing exceeds the narrative: ' + spec.id);
    if (page === buyer) check(await buyer.locator('#workspace').isVisible(), 'Private connection form cannot be recorded.');
    lastPage = page;
    lastImage = await page.screenshot({type:'jpeg', quality:90, animations:'disabled'});
    await emit(lastImage, count);
  }
  try {
    await program(show);
    if (frames < totalFrames) { check(lastImage, 'A chapter has no actual capture.'); await emit(lastImage, totalFrames-frames); }
    await lastPage.screenshot({path:join(cfg.output,'review',spec.id+'.png'), animations:'disabled'});
    activeEncoder.stdin.end();
    const exit = await closed;
    check(exit.code === 0, 'Chapter encoder failed: ' + spec.id + '; exit ' + exit.code + '; signal ' + exit.signal + '; ' + stderr);
    await rename(temporary, output);
    const bytes = await readFile(output);
    check(bytes.length > 0, 'Chapter output is empty.');
    const start = chapters.length ? chapters.at(-1).end : 0;
    const duration = frames / fps;
    clips.push({id:spec.id,file:relative,frames,fps,width,height,duration,bytes:bytes.length,sha256:sha(bytes)});
    chapters.push({...spec,start,end:start+duration});
    steps.push({at:new Date().toISOString(),step:'Captured original chapter ' + spec.id});
    await checkpoint();
    process.stdout.write(JSON.stringify({chapter:spec.id,frames,seconds:duration,bytes:bytes.length}) + '\n');
  } catch (failure) {
    activeEncoder.stdin.destroy();
    activeEncoder.kill('SIGTERM');
    await closed;
    throw failure;
  } finally { encoder = undefined; }
}

try {
  await startWorkspace();
  browser = await chromium.launch({executablePath:cfg.chromium, headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--no-zygote','--renderer-process-limit=2'],
    env:{...process.env, ...(cfg.tmp ? {TMPDIR:cfg.tmp} : {})}});
  context = await browser.newContext({viewport:{width,height},deviceScaleFactor:1,acceptDownloads:true});
  cards = await context.newPage(); buyer = await context.newPage();
  buyer.on('pageerror', failure => errors.push(failure.message));
  await connect();
  await checkpoint();
  for (const spec of film.chapters) {
    await recordChapter(spec, async show => {
      if (['title','team','source','delivery','plan','close'].includes(spec.id))
        return showCard(spec.id,show,spec.seconds);
      if (spec.id === 'history') {
        await history(); await show(buyer,7);
        await openQuote(); await show(buyer,11);
      } else if (spec.id === 'terms') {
        await openQuote(); await show(buyer,8);
        await buyer.getByText('Complete invocation and arguments',{exact:true}).click();
        await focus('#quote-detail .detail-grid');
        await show(buyer,12);
      } else if (spec.id === 'transaction') {
        await openQuote(); await focus('#payment-inspection'); await show(buyer,8);
        await buyer.getByRole('heading',{name:'Stellar transaction observation',exact:true})
          .evaluate(element => element.scrollIntoView({behavior:'instant',block:'start'}));
        check((await buyer.locator('#payment-inspection').innerText()).includes('TRANSFER_MATCHED'),
          'The cached matched observation is absent from the original UI.');
        await show(buyer,12);
      } else if (spec.id === 'result') {
        await openQuote(); await openResult(); await show(buyer,9);
        await buyer.locator('#result-body .data-grid').evaluate(element => {element.scrollLeft = 410;});
        await focus('#result-detail'); await show(buyer,6);
        await buyer.getByRole('tab',{name:'Content',exact:true}).click();
        await focus('#result-detail'); await show(buyer,5);
        const result = await inspectResult();
        const pending = buyer.waitForEvent('download');
        await buyer.getByRole('button',{name:'Download complete JSON',exact:true}).click();
        const download = await pending;
        const bytes = await readFile(await download.path());
        check(bytes.length === response.length && sha(bytes) === sha(response),'The actual download changed the original response.');
        downloaded = {...result,actualBrowserDownload:true};
        await focus('#result-detail'); await show(buyer,8);
      } else if (spec.id === 'reopen') {
        await openQuote(); await openResult(); await show(buyer,5);
        await showCard('reopening',show,4);
        await buyer.getByRole('button',{name:'Disconnect',exact:true}).click();
        await workspace.close(); workspace = undefined;
        await startWorkspace(); await connect(); await history(); await show(buyer,6);
        await openQuote(); await openResult(); await show(buyer,9);
        const result = await inspectResult();
        const status = workspace.broker.status({quoteId});
        check(status.status === 'CONFIRMED_BY_SERVER' && status.attempts === 1 &&
          status.result.reconciliation.outcome === 'TRANSFER_MATCHED', 'Reopened original state changed.');
        reopened = {...result,status:status.status,attempts:status.attempts,
          observation:status.result.reconciliation.outcome,paymentAdapterConnected:workspace.paymentAdapterConnected};
      } else throw new Error('No actual chapter implementation: ' + spec.id);
    });
  }
  check(errors.length === 0 && downloaded && reopened, 'The complete native browser journey did not finish cleanly.');
  completed = true;
} catch (failure) {
  errors.push(failure.message);
  process.exitCode = 1;
  process.stderr.write('Presentation capture failed: ' + failure.message + '\n');
} finally {
  encoder?.kill('SIGTERM');
  try { await browser?.close(); } catch (failure) { errors.push('Browser close: ' + failure.message); }
  try { await workspace?.close(); } catch (failure) { errors.push('Workspace close: ' + failure.message); }
  if (errors.length) { completed=false; process.exitCode=1; }
  await checkpoint();
  process.stdout.write(JSON.stringify({status:completed?'COMPLETE':'FAILED',chapters:chapters.length,
    seconds:chapters.at(-1)?.end??0,responseBytes:response.length,responseSha256:sha(response),
    downloaded,reopened,errors})+'\n');
}
