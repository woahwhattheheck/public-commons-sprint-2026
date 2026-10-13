// Continue the completed original HTTP customer through its source-owned browser UI.
import { readFile, mkdir, writeFile, open, rename, unlink, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const root = process.env.CANADABUYS_CASE_ROOT;
const base = join(root, 'source/stellar/scf-starforge-20261009/sf30-seller-sdk/canadabuys');
const load = name => import(pathToFileURL(join(base, name)));
const need = (value, message) => { if (!value) throw new Error(message); };
const path = join(root, 'case-result.json');
const result = JSON.parse(await readFile(path, 'utf8'));
need(result.operation === 'SCF-CANADABUYS-PROCUREMENT-9FCD-20261012' &&
  result.status === 'complete' && result.operator?.status === 'completed' &&
  result.source?.records === 908 && result.source?.columns === 67,
  'Continue the completed original HTTP customer and its retained source.');
const workshareId = result.operator.saved.workshare.id;
const noticeId = result.operator.saved.workshare.noticeId;
let stage = 'original-browser-reopen', browser, server, receiving;
async function save() {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(result, null, 2) + '\n');
    await handle.sync(); await handle.close(); await rename(temporary, path);
  } catch (error) {
    await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error;
  }
  console.log(JSON.stringify({stage, status:result.browserContinuation?.status, memory:process.memoryUsage()}));
}
if (result.browser?.status === 'completed' && result.browser.renderedDelivery?.status === 'captured' && result.responseReview?.status === 'completed') {
  console.log(JSON.stringify({stage:'original-browser-complete', status:'completed-retained', directory:result.browser.directory}));
} else try {
  const attempts = join(root, 'original-case-attempts');
  await mkdir(attempts, {recursive:true, mode:0o700});
  await writeFile(join(attempts, 'before-browser-' + Date.now() + '.json'), JSON.stringify(result, null, 2) + '\n', {mode:0o600});
  result.browserContinuation = {status:'running', startedAt:new Date().toISOString(), workshareId, noticeId, stage};
  await save();
  const {startCanadaBuysServer} = await load('server.mjs');
  const {operateCanadaBuysDesk} = await load('operator/OPERATING_JOURNEY.mjs');
  const {renderCanadaBuysDelivery} = await load('operator/RENDERED_DELIVERY.mjs');
  const {continueApm2ResponseReview} = await load('response-review/APM2_JOURNEY.mjs');
  server = await startCanadaBuysServer({directory:join(root,'operator-workspace'),operator:'TJLabs browser receiving',title:'CanadaBuys procurement desk'});
  receiving = await startCanadaBuysServer({directory:join(root,'receiving-workspace'),operator:'TJLabs browser receiving',title:'CanadaBuys receiving desk'});
  const expectedOperatorId=result.operator.saved.workshare.workspaceId ||
    result.stages.find(item=>item.stage==='reopen-original-customer')?.operator?.id;
  const expectedReceivingId=result.operator.receiving.after?.id || result.operator.receiving.before?.id ||
    result.stages.find(item=>item.stage==='reopen-original-customer')?.receiver?.id;
  need(expectedOperatorId && expectedReceivingId &&
    server.workspace.metadata().id===expectedOperatorId && receiving.workspace.metadata().id===expectedReceivingId,
    'Both browser workspaces must match the original saved customer identities.');
  need(server.workspace.getWorkshare(workshareId).noticeId === noticeId &&
    receiving.workspace.getWorkshare(workshareId).feeCents === 720000,
    'The browser must use the original saved and received workshare.');
  const executable = [process.env.CANADABUYS_BROWSER_EXECUTABLE,
    '/workspace/scratch/6cf60819dc7c/grant-browser-runtime/headless-shell-155.0.8059.39/chrome-headless-shell-linux64/chrome-headless-shell',
    '/tmp/chromium'].filter(Boolean).find(existsSync);
  need(executable, 'Materialize the original accepted Headless Shell runtime for this customer.');
  stage = 'original-browser-launch'; result.browserContinuation.stage = stage;
  result.browserContinuation.executable = executable; await save(); globalThis.gc?.();
  const require = createRequire(import.meta.url);
  const playwright = require(require.resolve('playwright', {paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES]}));
  browser = await playwright.chromium.launch({headless:true, executablePath:executable,
    args:['--no-sandbox','--disable-dev-shm-usage'], env:process.env});
  const context = await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  stage = 'original-browser-operating-and-receiving'; result.browserContinuation.stage = stage; await save();
  const journey = result.browser?.status === 'completed'
    ? JSON.parse(await readFile(join(result.browser.directory,'result.json'),'utf8'))
    : await operateCanadaBuysDesk({page, url:server.url, noticeId, workshareId,
      outputDirectory:join(root,'operator-journey'), receivingUrl:receiving.url});
  need(journey.status === 'completed' && journey.browserErrors.length === 0 &&
    journey.receiving?.sourceMatches && journey.receiving.reviewDifferences.length === 0 &&
    journey.receiving.workshareDifferences.length === 0 &&
    journey.saved.workshare.id === workshareId && journey.saved.workshare.feeCents === 720000,
    'Complete the original visible operator and source-preserving receiving workflow.');
  // Preserve the completed browser receiving before rendering its retained outgoing files.
  result.browser = {interface:'browser',status:journey.status,executable,directory:journey.directory,
    saved:journey.saved,package:journey.package,receiving:journey.receiving,screenshots:journey.screenshots,errors:journey.browserErrors};
  stage='original-browser-outgoing-delivery'; await save(); globalThis.gc?.();
  const responsePath=join(root,'apm2-bidder-response-result.json');
  const bidderResponse=existsSync(responsePath)?JSON.parse(await readFile(responsePath,'utf8')):undefined;
  const rendered=await renderCanadaBuysDelivery({page,url:server.url,receivingUrl:receiving.url,
    journey,bidderResponse,outputDirectory:join(root,'rendered-delivery')});
  result.browser.renderedDelivery=rendered;
  await save();
  stage='original-response-review-and-return';result.browserContinuation.stage=stage;await save();
  result.responseReview=await continueApm2ResponseReview({page,server,receiving,bidderResponse,root});await save();
  const inspectionDirectory = join('/workspace/scratch/9fcdd28e6390/canadabuys-original-native-artifacts','browser-inspection');
  const inspections = [];
  try {
    await mkdir(inspectionDirectory, {recursive:true, mode:0o700});
    for (const screenshot of [...journey.screenshots,...rendered.screenshots,...result.responseReview.journey.views.map(value=>({...value,file:basename(value.path)}))]) {
      const destination = join(inspectionDirectory, basename(screenshot.file));
      await copyFile(screenshot.path, destination);
      inspections.push({...screenshot, path:destination});
    }
  } catch (error) {
    result.browserInspectionCopy = {message:error.message, code:error.code, originalDirectory:journey.directory};
  }
  result.browser = {interface:'browser', status:journey.status, executable, directory:journey.directory,
    saved:journey.saved, package:journey.package, receiving:journey.receiving, screenshots:journey.screenshots,
    inspectionScreenshots:inspections, renderedDelivery:rendered, errors:journey.browserErrors};
  result.browserContinuation = {...result.browserContinuation, status:'completed', completedAt:new Date().toISOString()};
  result.stages = result.stages.filter(item => item.stage !== 'original-browser-operating-and-receiving');
  result.stages.push({stage:'original-browser-operating-and-receiving', executable, packageId:journey.package.packageId,
    workshareId, browserErrors:0, screenshots:journey.screenshots.length+rendered.screenshots.length,
    producerInspection:rendered.producerInspection.status,layoutFindings:rendered.layoutFindings});
  result.completedInterfaces = [...new Set([...(result.completedInterfaces || []), 'browser'])];
  stage = 'original-browser-complete'; await save();
  console.log(JSON.stringify({originalBrowserScreenshots:inspections, originalBrowserDirectory:journey.directory}));
} catch (error) {
  result.browserContinuation = {...result.browserContinuation, status:'failed', stage, failedAt:new Date().toISOString(),
    error:{message:error.message, code:error.code, stack:error.stack}, directory:error.operatorJourneyDirectory};
  await save(); process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
  if (receiving) await receiving.close().catch(() => {});
}
