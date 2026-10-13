// Native Grant Operations client and browser receiving for the retained original case.
import {readFile,writeFile,mkdir,open,rename,stat,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const OPERATION='SCF-GRANTOPS-SETTLEMENT-RECEIVING-20261012-F3BE';
const SCHEMA='scf.grantops.settlement-client-browser-receiving.v1';
const require=(condition,message)=>{if(!condition)throw new Error(message);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const json=value=>Buffer.from(JSON.stringify(ordered(value),null,2)+'\n');
const selectionPath=resolve(process.argv[2]??'');
require(process.argv[2], 'Select the retained original receiving input.');
const selected=JSON.parse(await readFile(selectionPath,'utf8'));
require(selected.operation===OPERATION&&selected.schema===SCHEMA+'.selection',
  'Use the same original settlement receiving selection.');
const output=resolve(selected.output), source=resolve(selected.sourceRoot);
await mkdir(output,{recursive:true,mode:0o700});
async function put(path,bytes){
  try {const info=await lstat(path);require(info.isFile()&&!info.isSymbolicLink(),'Retain a regular receiving output.');
    require((await readFile(path)).equals(bytes),'The retained receiving output differs: '+path);return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=path+'.pending-'+process.pid;
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  await rename(temporary,path);
}
async function record(path,value){await put(join(output,path),json(value));}
const artifacts=[];
async function artifact(name,bytes,kind){
  const path=join(output,name);
  await put(path,bytes);
  const result={path:name,bytes:bytes.length,sha256:hash(bytes),kind};
  artifacts.push(result);return result;
}
const result={schema:SCHEMA,operation:OPERATION,selectionSha256:hash(await readFile(selectionPath)),
  startedAt:new Date().toISOString(),caseId:selected.caseIds.caseId,
  sourceManifestSha256:selected.sourceManifestSha256,phases:[],artifacts,pageErrors:[]};
const phase=(name,details={})=>{result.phases.push({phase:name,at:new Date().toISOString(),...details});
  process.stdout.write(JSON.stringify({operation:OPERATION,phase:name})+'\n');};
const clientModule=join(source,'stellar/scf_2026/sf47_budget_model/workspace/agent-client.mjs');
const {inspectGrantAgentBinding,GrantWorkspaceClient}=await import(pathToFileURL(clientModule).href);
const binding=await inspectGrantAgentBinding({directory:resolve(selected.workspace),
  scenarioFile:join(source,'stellar/scf_2026/sf47_budget_model/sf10_current_candidate.json'),
  pythonExecutable:resolve(selected.python),allowStart:true,label:'Original received settlement workspace'});
const client=new GrantWorkspaceClient(binding);
let browser,closed;
try{
  const opened=await client.open({expectedSelectionSha256:binding.selectionSha256});
  result.binding={selectionSha256:binding.selectionSha256,original:opened.original};
  phase('original-managed-service-opened',{instanceId:opened.original.instanceId});
  const plans=await client.read('plans');
  const caseResponse=await client.read('case',{caseId:selected.caseIds.caseId});
  const saved=await client.read('settlements',{caseId:selected.caseIds.caseId});
  const current=await client.read('settlement',{caseId:selected.caseIds.caseId,
    reviewId:selected.caseIds.correctedPeriodReview});
  require(plans.status===200&&caseResponse.status===200&&saved.status===200&&current.status===200,
    'The original native client did not return the retained case.');
  require(caseResponse.value.program.id===selected.caseIds.caseId
    &&saved.value.items.length===4&&current.value.review.id===selected.caseIds.correctedPeriodReview,
    'The original native client returned a different case/review history.');
  const currentCash=current.value.currentCash;
  require(currentCash.length===1&&currentCash[0].id===selected.caseIds.replacementCash
    &&currentCash[0].state==='OBSERVED'&&currentCash[0].currency==='XLM'
    &&currentCash[0].date==='2026-10-11'&&currentCash[0].category==='OTHER'
    &&currentCash[0].usdValue===null,
    'The native client lost the current original corrected cash.');
  await artifact('client-case.json',caseResponse.bytes,'native-client-json');
  await artifact('client-settlements.json',saved.bytes,'native-client-json');
  await artifact('client-selected-settlement.json',current.bytes,'native-client-json');
  phase('original-client-reopened',{caseVersion:caseResponse.value.program.version,
    reviewId:current.value.review.id,cashId:currentCash[0].id});
  const received=await client.importBundle('case',await readFile(selected.originalCaseArchive),{
    name:selected.restore.name,requestId:selected.restore.requestId,actor:selected.restore.actor});
  require(received.value.id===selected.caseIds.caseId
    &&JSON.stringify(ordered(received.value))===JSON.stringify(ordered(selected.restore.result)),
    'The original HTTP import did not recover the retained receiving request.');
  await artifact('client-import-recovered.json',received.bytes,'native-client-original-request');
  phase('same-original-import-recovered',{requestId:selected.restore.requestId,caseId:received.value.id});
  const exported=await client.download('settlement',{caseId:selected.caseIds.caseId,
    reviewId:selected.caseIds.correctedPeriodReview});
  require(exported.status===200&&exported.sha256===selected.expectedSelectedExportSha256,
    'The original client selected export differs from the native selected review.');
  await artifact('client-selected-settlement.zip',exported.bytes,'native-client-selected-export');
  const original=await client.download('source',{caseId:selected.caseIds.caseId,
    sourceId:current.value.downloadSourceId});
  require(original.bytes.length===61440
    &&original.sha256==='5a203656b68b8772cc04327674ef88da3c7e521727b42938fb1a0e66a35abc03',
    'The original client source download changed the paid-period TAR.');
  await artifact('client-original-paid-period.tar',original.bytes,'native-client-original-source');
  phase('original-client-exports-received',{selectedSha256:exported.sha256,sourceSha256:original.sha256});
  const playwright=await import(pathToFileURL(resolve(selected.playwright)).href);
  browser=await playwright.chromium.launch({executablePath:resolve(selected.chromium),headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',error=>result.pageErrors.push(error.message));
  const privateView=await client.browser();
  await page.goto(privateView.url,{waitUntil:'networkidle'});
  await page.locator('#plan-select').selectOption(selected.caseIds.planId);
  await page.locator('[data-tab="operations"]').click();
  const caseSelect=page.locator('[name="caseSelect"]');
  await caseSelect.waitFor({state:'visible'});
  await caseSelect.selectOption(selected.caseIds.caseId);
  await page.locator('[data-ops-tab="settlements"]').click();
  const desk=page.getByRole('region',{name:'Merchant settlements',exact:true});
  const savedHeading=desk.getByRole('heading',{name:'Saved settlement reviews',exact:true});
  await savedHeading.waitFor();
  const savedList=desk.locator('section.settlement-section').filter({has:savedHeading});
  const savedButtons=savedList.locator('[data-settlement-action="open-review"]');
  await savedButtons.nth(3).waitFor({state:'visible'});
  require(await savedButtons.count()===4,
    'The browser must reopen all four native source/review editions.');
  await desk.getByRole('heading',{name:'Saved settlement reviews',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:join(output,'01-saved-source-editions.png'),fullPage:false});
  phase('browser-source-editions-reopened',{reviews:4});
  await desk.locator('[data-settlement-action="open-review"][data-review="'+selected.caseIds.correctedPeriodReview+'"]').first().click();
  await desk.getByRole('heading',{name:'Original complete paid-period source',exact:true}).waitFor();
  await desk.getByRole('heading',{name:'Original complete paid-period source',exact:true}).scrollIntoViewIfNeeded();
  await desk.getByText('0.005 · XLM · OBSERVED',{exact:true}).waitFor();
  require((await desk.innerText()).includes('0.005 · XLM · OBSERVED'),
    'The browser must show the current exact corrected transfer quantity.');
  await desk.locator('summary').filter({hasText:'Original review and correction history'}).click();
  await page.screenshot({path:join(output,'02-corrected-period-current-cash.png'),fullPage:false});
  phase('browser-corrected-current-cash-reopened',{reviewId:selected.caseIds.correctedPeriodReview});
  const downloadEvent=page.waitForEvent('download');
  await desk.locator('[data-settlement-action="export-review"][data-review="'+selected.caseIds.correctedPeriodReview+'"]').last().click();
  const downloaded=await downloadEvent;
  require(await downloaded.failure()===null,'The browser selected export did not finish.');
  const browserZip=join(output,'browser-selected-settlement.zip');
  await downloaded.saveAs(browserZip);
  const browserRaw=await readFile(browserZip);
  require(hash(browserRaw)===selected.expectedSelectedExportSha256,
    'The actual browser download differs from the original selected native export.');
  artifacts.push({path:'browser-selected-settlement.zip',bytes:browserRaw.length,
    sha256:hash(browserRaw),kind:'native-browser-download'});
  await desk.locator('[data-settlement-action="open-review"][data-review="'+selected.caseIds.periodReview+'"]').first().click();
  await desk.getByRole('heading',{name:'Original complete paid-period source',exact:true}).waitFor();
  await desk.getByText('0.005 · XLM · VOID',{exact:true}).waitFor();
  require((await desk.innerText()).includes('0.005 · XLM · VOID'),
    'The prior accepted source edition must retain the voided original cash history.');
  await desk.getByRole('heading',{name:'Original complete paid-period source',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:join(output,'03-original-cash-history.png'),fullPage:false});
  phase('browser-original-cash-history-reopened',{reviewId:selected.caseIds.periodReview});
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-tab="operations"]').click();
  await page.locator('[name="caseSelect"]').selectOption(selected.caseIds.caseId);
  await page.locator('[data-ops-tab="settlements"]').click();
  const reopened=page.getByRole('region',{name:'Merchant settlements',exact:true});
  await reopened.locator('[data-settlement-action="open-review"][data-review="'+selected.caseIds.correctedPeriodReview+'"]').first().click();
  await reopened.getByText('0.005 · XLM · OBSERVED',{exact:true}).waitFor();
  require((await reopened.innerText()).includes('0.005 · XLM · OBSERVED'),
    'Browser reopen must recover the same current replacement cash.');
  phase('browser-saved-case-reopened');
  require(result.pageErrors.length===0,'The native operator browser returned a page error.');
  for(const name of ['01-saved-source-editions.png','02-corrected-period-current-cash.png','03-original-cash-history.png']){
    const raw=await readFile(join(output,name));artifacts.push({path:name,bytes:raw.length,sha256:hash(raw),kind:'native-browser-screenshot'});
  }
  const finalCase=await client.read('case',{caseId:selected.caseIds.caseId});
  const finalReview=await client.read('settlement',{caseId:selected.caseIds.caseId,
    reviewId:selected.caseIds.correctedPeriodReview});
  require(finalCase.status===200&&finalReview.status===200
    &&finalCase.value.program.version===caseResponse.value.program.version
    &&JSON.stringify(ordered(finalCase.value.records))===JSON.stringify(ordered(caseResponse.value.records))
    &&JSON.stringify(ordered(finalCase.value.sources))===JSON.stringify(ordered(caseResponse.value.sources))
    &&finalReview.value.review.sha256===current.value.review.sha256
    &&JSON.stringify(ordered(finalReview.value.currentCash))===JSON.stringify(ordered(current.value.currentCash)),
    'The original current case changed during native browser receiving.');
  await artifact('client-final-case.json',finalCase.bytes,'native-client-final-json');
  await artifact('client-final-selected-settlement.json',finalReview.bytes,'native-client-final-json');
  result.finalState={caseId:finalCase.value.program.id,version:finalCase.value.program.version,
    reviewId:finalReview.value.review.id,reviewSha256:finalReview.value.review.sha256,
    cash:finalReview.value.currentCash[0],sourceSha256:finalReview.value.source.sha256};
  phase('original-client-final-state-reopened',{caseVersion:result.finalState.version,
    reviewId:result.finalState.reviewId,cashId:result.finalState.cash.id});
  await context.close();
  await browser.close();browser=null;
  closed=await client.close();
  require(closed.state==='OWNED_ORIGINAL_SERVICE_CLOSED'||closed.state==='BORROWED_CONNECTION_RELEASED',
    'The original managed client did not close its owned service or release its connection.');
  result.serviceClose=closed;
  result.completedAt=new Date().toISOString();result.passed=true;
  await record('CLIENT_BROWSER_RESULT.json',result);
  process.stdout.write(JSON.stringify({operation:OPERATION,passed:true,caseId:result.caseId,
    result:join(output,'CLIENT_BROWSER_RESULT.json')})+'\n');
}catch(error){
  result.passed=false;result.error={code:error.code??null,message:error.message};result.failedAt=new Date().toISOString();
  await writeFile(join(output,'CLIENT_BROWSER_FAILURE.json'),json(result),{mode:0o600});
  throw error;
}finally{
  if(browser)await browser.close();
  if(!closed)await client.close();
}
