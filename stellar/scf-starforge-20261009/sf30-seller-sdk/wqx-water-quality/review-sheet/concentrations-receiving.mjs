#!/usr/bin/env node
// MIT. One retained source → native CLI → browser → portable receiving operation.
import { constants } from 'node:fs';
import { open, lstat, realpath, readFile, unlink, link, chmod } from 'node:fs/promises';
import { dirname, join, resolve, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { privateDirectory, readPrivateJson, atomicJson, withPrivateLock } from '../../routescan/quota.mjs';
import { writeBytes } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { openWaterQualityProject } from '../project.mjs';
import { startWaterQualityWorkspace } from '../workspace.mjs';
import { openWatersHash, openWatersCanonical } from '../openwaters.mjs';
import { REVIEW_SHEET_SCHEMA, normalizeReviewSheetDocument, iterateReviewSheetTargets } from './model.mjs';
import { reviewSheetCsv, reviewSheetTsv, parseReviewSheetCsv, parseReviewSheetTsv } from './csv.mjs';
import { previewReviewSheet, readReviewSheet, exportReviewSheet } from './workflow.mjs';
import { concentrationSourceGroups, concentrationReportForDocument, concentrationReportCsv } from './concentrations.mjs';

export const CONCENTRATION_RECEIVING_SCHEMA = 'starforge.wqx-concentration-receiving.v1';
const HERE = dirname(fileURLToPath(import.meta.url));
const FORMATS = ['json','csv','tsv','report','bundle','native-locations','native-results','native-crosswalk','native-report','native-references','native-bundle'];
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a,b) => openWatersCanonical(a) === openWatersCanonical(b);
const need = (value,message) => { if (!value) throw Object.assign(new Error(message), {code:'WQX_CONCENTRATION_RECEIVING'}); };
const gc = () => global.gc?.();
const retainedTransport = {request:async () => { throw new Error('This operation uses the retained original capture.'); }};
const rawLimits = row => (row.limits ?? []).map(({targetField,choiceReason,...value}) => value);
async function identity(path, maximum = 128 * 1024 * 1024) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    need(before.isFile() && before.nlink === 1 && !(before.mode & 0o077) && before.size <= maximum,
      'Use a complete private regular retained file: ' + path);
    const digest = createHash('sha256'); let bytes = 0;
    for await (const chunk of file.createReadStream({autoClose:false})) { bytes += chunk.length; digest.update(chunk); }
    const after = await file.stat(), named = await lstat(path);
    need(bytes === before.size && before.dev === after.dev && before.ino === after.ino &&
      before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs &&
      named.dev === before.dev && named.ino === before.ino && !named.isSymbolicLink(), 'A retained receiving file changed.');
    return {file:path,bytes,sha256:digest.digest('hex')};
  } finally { await file.close(); }
}
async function maybe(path) { try { return await readPrivateJson(path, 128 * 1024 * 1024); } catch(error) { if(error.code === 'ENOENT') return null; throw error; } }
async function immutable(path, bytes) {
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  await privateDirectory(dirname(path));
  try { await writeBytes(path,bytes,{exclusive:true}); }
  catch(error) {
    if(error.code !== 'EEXIST') throw error;
    const retained = await identity(path);
    need(retained.bytes === bytes.length && retained.sha256 === sha(bytes), 'A retained operation member belongs to different bytes: ' + path);
  }
  return identity(path);
}
async function immutableJson(path,value) { return immutable(path,Buffer.from(json(value))); }
async function child(command,args) {
  await new Promise((yes,no) => {
    const process = spawn(command,args,{stdio:'inherit',env:globalThis.process.env});
    process.once('error',no);
    process.once('exit',(code,signal) => code === 0 ? yes() : no(new Error('Original child ended: ' + command + ' / ' + (signal ?? code))));
  });
}
function settings(raw) {
  need(raw?.schema === CONCENTRATION_RECEIVING_SCHEMA && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(raw.operationId ?? ''),
    'Use the complete retained concentration receiving configuration.');
  for(const key of ['directory','sourceCarrier']) need(isAbsolute(raw[key] ?? '') && resolve(raw[key]) === raw[key] && raw[key] !== '/',
    'Choose an absolute ' + key + '.');
  need(/^[0-9a-f]{64}$/.test(raw.sourceCarrierSha256 ?? '') && /^[0-9a-f]{64}$/.test(raw.sourcePlanSha256 ?? '') &&
    /^[0-9a-f]{64}$/.test(raw.reviewSha256 ?? '') && /^[0-9a-f]{64}$/.test(raw.captureSha256 ?? ''), 'Bind the complete original source graph.');
  need(raw.targetUnit === 'ug/L' && raw.sourceGroups?.length === 3 &&
    same(raw.sourceGroups.map(x=>[x.unit,x.count]),[['mg/L',220],['ug/L',40],['ng/L',38]]) &&
    raw.limitOnlyCount === 452 && raw.supportedLimitOnlyCount === 451 && raw.consideredResults === 750 && raw.selectedResults === 749 && raw.sourceResults === 1035 && raw.originalLimits === 1112,
    'Use the retained complete Potomac cohort and its exact unit projection.');
  for(const key of ['sourcePlanId','newPlanId','reviewId']) need(/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(raw[key] ?? ''), 'Keep the original ' + key + '.');
  need(raw.newPlanId !== raw.sourcePlanId && typeof raw.reason === 'string' && raw.reason.length > 0 && raw.reason.length <= 600,
    'Retain a new receiving plan and explicit conversion reason.');
  return {...raw,nodeHeapMiB:raw.nodeHeapMiB ?? 768};
}
function layout(config) {
  const root=config.directory;
  return {root,graph:join(root,'source-graph'),author:join(root,'project'),receiver:join(root,'received-project'),
    cli:join(root,'cli'),exports:join(root,'exports'),browser:join(root,'browser'),sourceReady:join(root,'source-ready.json'),
    browserReady:join(root,'browser-ready.json'),result:join(root,'result.json')};
}
async function boundReceipt(path,requestSha256) {
  const value=await maybe(path); if(!value) return null;
  need(value.requestSha256 === requestSha256, 'This retained phase belongs to another original input.');
  for(const file of value.files ?? []) {
    const actual=await identity(file.file); need(actual.bytes===file.bytes && actual.sha256===file.sha256, 'A completed phase member changed.');
  }
  return value;
}
async function cli(config,args) {
  await child(process.execPath,['--expose-gc','--max-old-space-size='+config.nodeHeapMiB,join(HERE,'cli.mjs'),...args]);
}
async function sourcePhase(config,paths,requestSha256) {
  const previous=await boundReceipt(paths.sourceReady,requestSha256); if(previous) return previous;
  const graphInput=await identity(config.sourceCarrier,8*1024*1024);
  need(graphInput.sha256===config.sourceCarrierSha256,'The original source carrier changed.');
  await child(config.python ?? 'python3',[join(HERE,'concentration-source.py'),'--source',config.sourceCarrier,
    '--sha256',config.sourceCarrierSha256,'--directory',paths.graph]);
  const project=await openWaterQualityProject(paths.author,{transport:retainedTransport});
  try {
    let originalReview=await maybe(join(paths.graph,'source','potomac-quarter-open-waters-review.json'));
    need(originalReview.reviewSha256===config.reviewSha256 && originalReview.captureSha256===config.captureSha256,'The retained scientific review changed.');
    const current=await project.read();
    await project.importCapture({sourceDirectory:join(paths.graph,'source','capture'),expectedRevision:current?.revision??0,title:originalReview.title});
    let review=await project.saveReview({reviewId:originalReview.reviewId,captureId:originalReview.captureId,
      options:originalReview.requestedOptions,note:originalReview.note,comparisonCaptureId:originalReview.comparisonCaptureId,
      expectedCaptureSha256:config.captureSha256});
    need(review.reviewSha256===config.reviewSha256,'The original scientific source did not reproduce.');
    originalReview=null;review=null;gc();
    const options=await maybe(join(paths.graph,'mapping','options.json'));
    let plan=await project.saveOpenWaters({planId:config.sourcePlanId,reviewId:'potomac-quarter-open-waters',options,
      expectedReviewSha256:config.reviewSha256});
    need(plan.planSha256===config.sourcePlanSha256 && plan.captureSha256===config.captureSha256,'The corrected source plan did not reproduce.');
    const catalog=concentrationSourceGroups(plan);
    need(catalog.sourceResults===config.sourceResults && catalog.limitOnly.count===config.limitOnlyCount && catalog.limitOnly.supportedCount===config.supportedLimitOnlyCount,'The original result/limit-only selection changed.');
    for(const group of config.sourceGroups) need(catalog.groups.find(x=>x.unit===group.unit)?.count===group.count,'The exact source-unit group changed.');
    need(plan.results.reduce((n,row)=>n+(row.limits??[]).length,0)===config.originalLimits,'The complete reported limit source changed.');
    await immutableJson(join(paths.cli,'units.json'),catalog);
    await immutableJson(join(paths.cli,'draft-0.json'),{schema:REVIEW_SHEET_SCHEMA,sourcePlanId:plan.planId,sourcePlanSha256:plan.planSha256,decisions:[]});
    plan=null;gc();
  } finally { await project.close(); }
  gc();
  const selections=[...config.sourceGroups.map(row=>({key:row.unit.replace('/','-'),count:row.count,args:['--from-unit',row.unit]})),
    {key:'reported-limits-only',count:config.supportedLimitOnlyCount,args:['--reported-limits-only']}];
  for(let index=0;index<selections.length;index++) {
    const selection=selections[index], input=join(paths.cli,'draft-'+index+'.json'), output=join(paths.cli,'draft-'+(index+1)+'.json');
    const reportFile=join(paths.cli,'conversion-'+selection.key+'.json');
    let report=await maybe(reportFile);
    if(!report) {
      await cli(config,['standardize','--project',paths.author,'--document',input,...selection.args,
        '--target-unit',config.targetUnit,'--reason',config.reason,'--out',output,'--report',reportFile]);
      report=await maybe(reportFile);
    }
    const {proposalSha256,...reportBody}=report;
    need(openWatersHash(reportBody)===proposalSha256 && report.state==='PREPARED' && report.issues.length===0 &&
      report.targetUnit===config.targetUnit && report.reason===config.reason && report.summary.selectedResults===selection.count &&
      report.source.sourcePlanSha256===config.sourcePlanSha256,'The original complete conversion proposal changed.');
    const inputDocument=normalizeReviewSheetDocument(await maybe(input));
    need(same(report.inputDocument,inputDocument) && report.inputDocumentSha256===openWatersHash(inputDocument),
      'The conversion no longer starts from the preceding original draft.');
    await immutableJson(output,report.document); report=null;gc();
  }
  const verified=await openWaterQualityProject(paths.author,{transport:retainedTransport});
  let files=[];
  try {
    let plan=await verified.readOpenWaters(config.sourcePlanId);
    let document=normalizeReviewSheetDocument(await maybe(join(paths.cli,'draft-4.json')));
    const preservedId='wqx-record-11d4710939ec7646c8fe39b90e5e9589924e15cef1824024e388b1d0111498af';
    let target;
    for(const row of iterateReviewSheetTargets(plan,{kind:'result',attentionOnly:false})) {
      if(row.sourceKey===preservedId&&row.field==='RESULT_MSR_UNIT') {target=row;break;}
    }
    need(target,'The original Turbidity decision target changed.');
    document=normalizeReviewSheetDocument({...document,decisions:[...document.decisions,{targetId:target.targetId,action:'keep',
      reason:'Preserve this original Turbidity non-detect and its 2.0/2 NTRU optical reporting limits. NTRU is outside the selected mass-per-volume conversion profile; keep the blank result/unit and original optical quantities.'}]});
    let preview=await previewReviewSheet({project:verified,document,newPlanId:config.newPlanId});
    let report=concentrationReportForDocument(plan,document,{resultPlan:preview.plan});
    const scientific=checkCohort(config,plan,preview.plan,report);
    files.push(await immutableJson(join(paths.cli,'decisions.json'),document));
    files.push(await immutableJson(join(paths.cli,'expected-report.json'),report));
    files.push(await immutable(join(paths.cli,'expected-report.csv'),concentrationReportCsv(report)));
    for(const [format,render,parse] of [['csv',reviewSheetCsv,parseReviewSheetCsv],['tsv',reviewSheetTsv,parseReviewSheetTsv]]) {
      let table=render(plan,document,{attentionOnly:false});
      need(same(parse(table),document),'The complete '+format+' decision table did not retain every paired choice and reason.');
      files.push(await immutable(join(paths.cli,'decisions.'+format),table));table=null;gc();
    }
    const result={schema:CONCENTRATION_RECEIVING_SCHEMA,status:'SOURCE_PREPARED',operationId:config.operationId,requestSha256,
      sourcePlanId:plan.planId,sourcePlanSha256:plan.planSha256,captureSha256:plan.captureSha256,reviewSha256:plan.reviewSha256,
      newPlanId:config.newPlanId,reviewId:config.reviewId,previewSha256:preview.previewSha256,
      newPlanSha256:preview.newPlanSha256,documentSha256:openWatersHash(document),reportSha256:report.proposalSha256,
      scientific,files,completedAt:new Date().toISOString()};
    await immutableJson(paths.sourceReady,result);return result;
  } finally { await verified.close(); }
}
function checkCohort(config,source,result,report) {
  need(source.planSha256===config.sourcePlanSha256 && result.captureSha256===config.captureSha256 &&
    result.reviewSha256===config.reviewSha256 && source.results.length===config.sourceResults &&
    result.results.length===config.sourceResults && report.summary.selectedResults===config.selectedResults &&
    report.issues.length===0,'The complete original result cohort changed.');
  const originals=new Map(source.results.map(row=>[row.sourceRecordId,row]));
  let limits=0;
  for(const row of result.results) {
    const before=originals.get(row.sourceRecordId);
    need(before && same(rawLimits(before),rawLimits(row)),'An original reported limit or result identity changed.');
    for(const field of ['RESULT_MSR_QUAL','RESULT_DETECT_CONDITION','RESULT_VALUE_TYPE','RESULT_STATUS'])
      need((before.fields[field]??'')===(row.fields[field]??''),'A scientific qualifier or detection condition changed.');
    limits+=(row.limits??[]).length;
  }
  need(limits===config.originalLimits,'A reported limit was lost.');
  const limitOnly=report.rows.filter(row=>!row.before.RESULT_MSR && !row.before.RESULT_MSR_UNIT);
  need(limitOnly.length===config.supportedLimitOnlyCount && limitOnly.every(row=>row.after.RESULT_MSR==='' && row.after.RESULT_MSR_UNIT===''),
    'Limit-only records must preserve the exact blank result and unspecified result unit.');
  const preservedId='wqx-record-11d4710939ec7646c8fe39b90e5e9589924e15cef1824024e388b1d0111498af';
  const opticalBefore=originals.get(preservedId),opticalAfter=result.results.find(row=>row.sourceRecordId===preservedId);
  need(opticalBefore?.fields.CHAR_NAME==='Turbidity'&&opticalBefore.fields.DETECTION_LIMIT_UNIT==='NTRU'&&
    same(opticalBefore.fields,opticalAfter?.fields)&&same(rawLimits(opticalBefore),rawLimits(opticalAfter)),
    'The original optical Turbidity quantities must remain exact.');
  const unspecified=source.results.filter(row=>!(row.fields.RESULT_MSR??'').trim()&&!row.fields.RESULT_MSR_UNIT&&(row.limits??[]).some(limit=>String(limit.value??'').trim()));
  need(unspecified.length===config.limitOnlyCount&&unspecified.every(row=>{const after=result.results.find(item=>item.sourceRecordId===row.sourceRecordId);return !(after.fields.RESULT_MSR??'')&&!(after.fields.RESULT_MSR_UNIT??'');}),
    'An originally unspecified non-detect result/unit was invented.');
  const silica=report.rows.find(row=>row.sourceRecordId==='wqx-record-e7dcd103f470f706bc66c0589322d6de9cc4925e950981da060ab9c41c2bfbb4');
  need(silica?.before.RESULT_MSR==='4.65' && silica.after.RESULT_MSR==='4650' && silica.after.RESULT_MSR_UNIT==='ug/L' &&
    silica.reportedLimits.length===1 && silica.reportedLimits[0].original.value==='0.06' &&
    silica.reportedLimits[0].converted.value==='60' && silica.reportedLimits[0].converted.unit==='ug/L',
    'The original populated Silica result and attached limit did not convert exactly.');
  return {sourceResults:source.results.length,convertedResults:report.rows.length,reportedLimits:limits,
    unspecifiedResultUnits:unspecified.length,convertedLimitOnlyResults:limitOnly.length,consideredResults:config.consideredResults,
    preservedOpticalResults:1,preservedOpticalUnit:'NTRU',convertedReportedLimits:report.summary.reportedLimits,
    nativeLimitQuantities:report.summary.nativeLimits,unchangedQualifierAndDetectionContext:true,
    silica:{before:'4.65 mg/L',after:'4650 ug/L',limitBefore:'0.06 mg/L',limitAfter:'60 ug/L'}};
}
async function browserPhase(config,paths,requestSha256) {
  const previous=await boundReceipt(paths.browserReady,requestSha256); if(previous) return previous;
  const prepared=await boundReceipt(paths.sourceReady,requestSha256);need(prepared,'Prepare the complete original source first.');
  const progressFile=join(paths.browser,'progress.json');
  let progress=await maybe(progressFile)??{schema:CONCENTRATION_RECEIVING_SCHEMA,requestSha256,exports:{author:{},receiver:{}},reports:{},screenshots:{},panel:[]};
  need(progress.requestSha256===requestSha256,'The original browser operation changed.');
  const checkpoint=async stage=>{progress.stage=stage;await atomicJson(paths.browser,'progress.json',progress);};
  const temporary=await privateDirectory(config.browserTemporaryDirectory ?? join(paths.browser,'temporary'));
  const {chromium}=createRequire(import.meta.url)(config.playwrightModule ?? process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  const browser=await chromium.launch({headless:true,executablePath:config.chromiumExecutable,
    args:['--no-sandbox','--disable-dev-shm-usage',...(config.chromiumArgs??[])],
    env:{...process.env,TMPDIR:temporary,...(config.chromiumLibraryPath?{LD_LIBRARY_PATH:config.chromiumLibraryPath+(process.env.LD_LIBRARY_PATH?':'+process.env.LD_LIBRARY_PATH:'')}:{})}});
  let workspace,context,page;const errors=[];
  async function stop() {await context?.close();context=null;page=null;await workspace?.close();workspace=null;gc();}
  async function begin(directory) {
    workspace=await startWaterQualityWorkspace({directory,port:0,transport:retainedTransport});
    context=await browser.newContext({viewport:{width:1440,height:1040},acceptDownloads:true});
    page=await context.newPage();page.setDefaultTimeout(180000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(workspace.url,{waitUntil:'domcontentloaded'});
    await page.locator('[data-tab="review-sheets"]').click();await idle();
  }
  async function idle() {await page.waitForFunction(()=>document.getElementById('tab-review-sheets').getAttribute('aria-busy')==='false');}
  async function visible(selector) {
    const summaries=await page.locator(selector).evaluate(element=>{
      const result=[];for(let node=element.parentElement;node;node=node.parentElement)
        if(node.tagName==='DETAILS'&&!node.open){node.open=true;result.push(node.tagName);}return result;
    });return summaries;
  }
  async function clickJson(selector,path,method='POST') {
    await visible(selector);
    const pending=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()===method);
    await page.locator(selector).click();const response=await pending;const value=await response.json();
    need(response.ok(),value.error?.message??value.error??('Original UI request failed: '+path));
    await idle();return value;
  }
  async function download(selector,destination,expected=null) {
    await visible(selector);await privateDirectory(destination);
    const pending=page.waitForEvent('download');await page.locator(selector).click();
    const selected=await pending,name=selected.suggestedFilename();
    need(name===basename(name)&&name&&!name.includes('\\'),'The original export filename changed.');
    const temporaryFile=join(temporary,'download-'+randomUUID());
    try {
      await selected.saveAs(temporaryFile);await chmod(temporaryFile,0o600);
      need(await selected.failure()===null,'The native browser download failed.');
      const result=await identity(temporaryFile);
      if(expected)need(result.bytes===expected.bytes&&result.sha256===expected.sha256,'The full downloaded output differs from its original member.');
      const target=join(destination,name);
      try {await link(temporaryFile,target);}
      catch(error){if(error.code!=='EEXIST')throw error;const existing=await identity(target);need(existing.sha256===result.sha256&&existing.bytes===result.bytes,'An existing downloaded member differs.');}
      await unlink(temporaryFile);return{file:target,filename:name,bytes:result.bytes,sha256:result.sha256};
    } finally {await unlink(temporaryFile).catch(error=>{if(error.code!=='ENOENT')throw error;});await selected.delete();}
  }
  async function openSaved() {
    await page.locator('#rs-saved-review').selectOption(config.reviewId);
    return clickJson('#rs-open-saved','/api/review-sheets/'+encodeURIComponent(config.reviewId),'GET');
  }
  async function takeReports(role) {
    const expectedJson=await identity(join(paths.cli,'expected-report.json')),expectedCsv=await identity(join(paths.cli,'expected-report.csv'));
    progress.reports[role]={json:await download('#cu-json',join(paths.exports,role),expectedJson),
      csv:await download('#cu-csv',join(paths.exports,role),expectedCsv)};
    need((await page.locator('#cu-summary').textContent()).includes(config.selectedResults.toLocaleString()),'The full saved conversion is absent from the original UI.');
    for(const format of FORMATS) {
      const retained=progress.exports[role][format];
      if(retained){const actual=await identity(retained.file);need(actual.sha256===retained.sha256&&actual.bytes===retained.bytes,'A retained browser export changed.');continue;}
      const href='/api/review-sheets/'+encodeURIComponent(config.reviewId)+'/'+format;
      progress.exports[role][format]=await download('#rs-downloads a[href="'+href+'"]',join(paths.exports,role),
        role==='receiver'?progress.exports.author[format]:null);
      await checkpoint(role+'-'+format);
    }
    await visible('#cu-output');
    progress.screenshots[role+'-desktop']=await immutable(join(paths.browser,role+'-desktop.png'),await page.screenshot({fullPage:true}));
    await page.setViewportSize({width:390,height:844});
    const width=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth}));
    need(width.page<=width.viewport,'The concentration workspace overflows its mobile viewport.');
    progress.screenshots[role+'-mobile']=await immutable(join(paths.browser,role+'-mobile.png'),await page.screenshot({fullPage:true}));
    await page.setViewportSize({width:1440,height:1040});await checkpoint(role+'-downloads');
  }
  try {
    await begin(paths.author);
    let saved=null;
    try {saved=await readReviewSheet({project:workspace.project,reviewId:config.reviewId});}
    catch(error){if(error.code!=='WQX_REVIEW_SHEET_NOT_FOUND')throw error;}
    if(saved?.status==='COMPLETE') await openSaved();
    else {
      await page.locator('#rs-source-plan').selectOption(config.sourcePlanId);
      await clickJson('#rs-load','/api/review-sheets/source/'+encodeURIComponent(config.sourcePlanId),'GET');
      {
        for(const sample of [{scope:'unit',unit:'mg/L',count:220},{scope:'limits',count:config.supportedLimitOnlyCount}]) {
          if(progress.panel.some(row=>row.scope===sample.scope)) continue;
          await visible('#cu-scope');await page.locator('#cu-scope').selectOption(sample.scope);
          if(sample.unit)await page.locator('#cu-source-unit').selectOption(sample.unit);
          await page.locator('#cu-target-unit').selectOption(config.targetUnit);
          await page.locator('#cu-reason').fill(config.reason);
          let report=await clickJson('#cu-prepare','/api/review-sheets/concentrations');
          need(report.state==='PREPARED'&&report.issues.length===0&&report.summary.selectedResults===sample.count,'The native concentration panel did not prepare its complete group.');
          await page.locator('#cu-apply').click();await idle();
          need(await page.locator('#cu-undo').isEnabled(),'The preceding full draft is unavailable after applying.');
          await page.locator('#cu-undo').click();await idle();
          const draft=await download('#rs-export-json',join(paths.exports,'panel-'+sample.scope));
          need(same(await maybe(draft.file),await maybe(join(paths.cli,'draft-0.json'))),'Restore preceding draft lost original choices.');
          progress.panel.push({scope:sample.scope,selectedResults:report.summary.selectedResults,proposalSha256:report.proposalSha256,restoredDraft:draft});
          report=null;await checkpoint('panel-'+sample.scope);gc();
        }
      }
      await visible('#rs-import-file');await page.locator('#rs-import-file').setInputFiles(join(paths.cli,'decisions.json'));
      await page.locator('#rs-import-form button[type="submit"]').click();await idle();
      await page.locator('#rs-new-plan').fill(config.newPlanId);await page.locator('#rs-review-id').fill(config.reviewId);
      let preview=await clickJson('#rs-preview','/api/review-sheets/preview');
      need(preview.previewSha256===prepared.previewSha256&&preview.newPlanSha256===prepared.newPlanSha256,'The whole CLI/browser native preview changed.');
      preview=null;gc();
      saved=await clickJson('#rs-save','/api/review-sheets');
      need(saved.status==='COMPLETE'&&saved.newPlanSha256===prepared.newPlanSha256,'The original full decision save failed.');
    }
    need(saved?.reviewId===config.reviewId&&saved.newPlanSha256===prepared.newPlanSha256,'The saved original operation changed.');
    progress.saved={reviewId:saved.reviewId,reviewSha256:saved.reviewSha256,newPlanId:saved.newPlanId,newPlanSha256:saved.newPlanSha256};
    saved=null;gc();await takeReports('author');await stop();
    // Original authoring process closes before the independent receiving project is opened.
    await begin(paths.receiver);
    const bundle=progress.exports.author.bundle;
    await visible('#rs-receive-file');await page.locator('#rs-receive-file').setInputFiles(bundle.file);
    const received=await clickJson('#rs-receive-form button[type="submit"]','/api/review-sheets/receive');
    need(received.reviewSha256===progress.saved.reviewSha256&&received.newPlanSha256===prepared.newPlanSha256,
      'Portable UI receiving changed the complete original operation.');
    await takeReports('receiver');await stop();
    // Cold reopen uses the received native files, with the same review identity.
    await begin(paths.receiver);const reopened=await openSaved();
    need(reopened.reviewSha256===progress.saved.reviewSha256&&reopened.newPlanSha256===prepared.newPlanSha256,'Cold receiving reopen changed.');
    need((await page.locator('#cu-state').textContent())==='Saved conversion choices','Cold reopen lost the complete conversion report.');
    await stop();await browser.close();
    need(!errors.length,'The native browser reported: '+errors.join('; '));
    const files=[...Object.values(progress.exports.author),...Object.values(progress.exports.receiver),
      ...Object.values(progress.reports).flatMap(row=>[row.json,row.csv]),...Object.values(progress.screenshots)];
    const result={schema:CONCENTRATION_RECEIVING_SCHEMA,status:'BROWSER_RECEIVED',operationId:config.operationId,requestSha256,
      saved:progress.saved,panel:progress.panel,files,exports:progress.exports,reports:progress.reports,
      screenshots:progress.screenshots,errors,browserVersion:browser.version(),coldReopen:true,
      finalState:{author:'CLOSED',receiver:'CLOSED',browser:'CLOSED'},completedAt:new Date().toISOString()};
    await immutableJson(paths.browserReady,result);return result;
  } finally {await stop().catch(()=>{});await browser.close().catch(()=>{});}
}
async function verifyPhase(config,paths,requestSha256) {
  const existing=await boundReceipt(paths.result,requestSha256);if(existing)return existing;
  const prepared=await boundReceipt(paths.sourceReady,requestSha256),browser=await boundReceipt(paths.browserReady,requestSha256);
  need(prepared&&browser,'Complete the original source and browser receiving phases.');
  let scientific,files=[],review;
  for(const [role,directory] of [['author',paths.author],['receiver',paths.receiver]]) {
    const project=await openWaterQualityProject(directory,{transport:retainedTransport});
    try {
      review=await readReviewSheet({project,reviewId:config.reviewId});
      need(review.status==='COMPLETE'&&review.reviewSha256===browser.saved.reviewSha256,'The saved original decision review changed.');
      let source=await project.readOpenWaters(config.sourcePlanId),result=await project.readOpenWaters(config.newPlanId);
      let report=concentrationReportForDocument(source,review.document,{resultPlan:result});
      scientific=checkCohort(config,source,result,report);
      need(report.proposalSha256===prepared.reportSha256,'The full saved conversion report changed after receiving.');
      source=null;result=null;report=null;gc();
      for(const format of FORMATS) {
        let original=await exportReviewSheet({project,reviewId:config.reviewId,format}),observed=browser.exports[role][format];
        need(original.filename===observed.filename&&original.bytes.length===observed.bytes&&sha(original.bytes)===observed.sha256,
          'The browser download differs from its original native '+format+' export.');
        original=null;gc();
      }
    } finally {await project.close();}
    gc();
    for(const format of ['json','csv']) {
      const out=join(paths.cli,role+'-reopened-report.'+format);
      let retained;
      try {retained=await identity(out);} catch(error){if(error.code!=='ENOENT')throw error;}
      if(!retained) await cli(config,['unit-report','--project',directory,'--review',config.reviewId,'--format',format,'--out',out]);
      const actual=retained??await identity(out),expected=browser.reports[role][format];
      need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'The original CLI and browser conversion reports differ.');
      files.push(actual);
    }
  }
  const result={schema:CONCENTRATION_RECEIVING_SCHEMA,status:'PASS',operationId:config.operationId,requestSha256,
    source:{captureSha256:config.captureSha256,reviewSha256:config.reviewSha256,planSha256:config.sourcePlanSha256},
    saved:browser.saved,scientific,sourcePrepared:prepared.completedAt,browserCompleted:browser.completedAt,
    sourceDownloads:FORMATS.length,receivedDownloads:FORMATS.length,cliReportReopens:4,
    decisionTableRoundTrips:['csv','tsv'],files:[...prepared.files,...browser.files,...files],
    browserErrors:browser.errors,finalState:browser.finalState,completedAt:new Date().toISOString()};
  await immutableJson(paths.result,result);return result;
}
export async function main(argv=process.argv.slice(2)) {
  const {values}=parseArgs({args:argv,options:{config:{type:'string'},phase:{type:'string',default:'all'},help:{type:'boolean'}}});
  if(values.help||!values.config){process.stdout.write('node concentrations-receiving.mjs --config /private/receiving.json [--phase source|browser|verify|all]\n');return;}
  const configFile=resolve(values.config),config=settings(JSON.parse(await readFile(configFile,'utf8'))),paths=layout(config);
  await privateDirectory(paths.root);for(const name of ['cli','exports','browser'])await privateDirectory(paths[name]);
  const request={schema:CONCENTRATION_RECEIVING_SCHEMA,configuration:config},requestSha256=openWatersHash(request);
  await immutableJson(join(paths.root,'input.json'),{...request,requestSha256});
  if(values.phase==='all'){
    for(const phase of ['source','browser','verify'])
      await child(process.execPath,['--expose-gc','--max-old-space-size='+config.nodeHeapMiB,fileURLToPath(import.meta.url),'--config',configFile,'--phase',phase]);
    const result=await boundReceipt(paths.result,requestSha256);need(result,'The complete receiving result is absent.');
    process.stdout.write(json({status:result.status,operationId:config.operationId,scientific:result.scientific,result:paths.result}));return;
  }
  const phase={source:sourcePhase,browser:browserPhase,verify:verifyPhase}[values.phase];need(phase,'Choose an original receiving phase.');
  const result=await withPrivateLock(paths.root,'concentrations-receiving.lock',()=>phase(config,paths,requestSha256));
  process.stdout.write(json({status:result.status,operationId:config.operationId,phase:values.phase,requestSha256}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(json({error:error.message,code:error.code??null}));process.exitCode=1;});
