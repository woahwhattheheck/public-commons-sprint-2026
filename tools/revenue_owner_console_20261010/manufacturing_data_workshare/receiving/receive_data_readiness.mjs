import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import * as core from '../data_readiness.mjs';
import * as comparison from '../data_comparison.mjs';

const need=(ok,message)=>{if(!ok)throw new Error(message);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
const clone=v=>JSON.parse(JSON.stringify(v));
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function exists(path){try{await readFile(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function retainedFile(row){
 need(row&&typeof row.path==='string'&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&/^[a-f0-9]{64}$/.test(row.sha256),'Supply a complete original file identity.');
 const path=resolve(row.path),body=await readFile(path);
 need(body.length===row.bytes&&sha(body)===row.sha256,'The complete selected file differs: '+path);
 return {path,body,bytes:body.length,sha256:sha(body)};
}
function utf8(body){return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(body);}
function identity(path,body){return {path,bytes:body.length,sha256:sha(body)};}
async function checkpoint(path,value){const next=path+'.'+randomUUID()+'.pending';await writeFile(next,json(value),{flag:'wx',mode:0o600});await rename(next,path);}
function deskEnvelope(workspace){
 const unit=workspace.unitMappingEditions.find(x=>x.id===workspace.activeUnitMapping);
 return {schema:'manufacturing-data-desk.v1',current:{workspace:clone(workspace),pending:[],unitText:JSON.stringify(unit?.mappings||[],null,2),actor:'Mechanical receiving example',notes:'Original operated mechanical workspace; not customer data.',dispositionDrafts:{},issueQuery:'',issueStatus:'all',tableKind:'items',selectedPending:''},history:[],incoming:[]};
}

/**
 * Operate the exact standalone desk and proposal on an existing equipped browser.
 * The caller owns the existing browser and original receiving operation.
 * Input schema manufacturing-data-receiving-input.v1:
 * {operationId, desk:{path,bytes,sha256}, proposal:{path,bytes,sha256},
 *  mechanicalWorkspace:{path,bytes,sha256},comparisonWorkspace:{path,bytes,sha256},
 *  core:{bytes,sha256},comparison:{bytes,sha256},authoredExample?:{path,bytes,sha256}}. Both workspaces are the supplied original pair.
 * Return actual downloads, original source identities and desktop/narrow images.
 * The producing peers must OPEN and VIEW those actual images and attachments.
 */
export async function runDataReadinessCourse({browser,inputFile,outputRoot,onProgress=()=>{}}){
 need(browser&&typeof browser.newContext==='function','Use the original equipped browser.');
 const inputBytes=await readFile(resolve(inputFile)),input=JSON.parse(utf8(inputBytes));
 need(input.schema==='manufacturing-data-receiving-input.v1'&&typeof input.operationId==='string'&&input.operationId,'Keep the original receiving operation identity.');
 const deskFile=await retainedFile(input.desk),proposalFile=await retainedFile(input.proposal),workspaceFile=await retainedFile(input.mechanicalWorkspace);
 const authoredExampleFile=input.authoredExample?await retainedFile(input.authoredExample):null;
 const coreFile=await retainedFile({...input.core,path:fileURLToPath(new URL('../data_readiness.mjs',import.meta.url))});
 const comparisonFile=await retainedFile(input.comparisonWorkspace);
 const comparisonModule=await retainedFile({...input.comparison,path:fileURLToPath(new URL('../data_comparison.mjs',import.meta.url))});
 const sourceWorkspace=body=>{const value=JSON.parse(utf8(body).replace(/^\uFEFF/,''));
  return core.importWorkspace(value?.schema==='manufacturing-data-desk.v1'?value.current?.workspace:value?.workspace||value);};
 const mechanical=sourceWorkspace(workspaceFile.body),successor=sourceWorkspace(comparisonFile.body);
 need(/mechanical.*example|example.*mechanical/i.test(mechanical.label),'The receiving record must identify itself as a mechanical example.');
 need(mechanical.revision===9,'Use the original operated revision 9 receiving workspace.');
 need(successor.id===mechanical.id&&successor.revision>mechanical.revision,'Supply the retained later original mechanical source edition for this exact workspace.');
 need(equal(successor.history.slice(0,mechanical.history.length),mechanical.history)&&
      equal(successor.requests.slice(0,mechanical.requests.length),mechanical.requests)&&
      mechanical.imports.every(source=>successor.imports.some(row=>equal(row,source))),
      'The supplied successor must retain the original revision 9 history, requests and complete source editions.');
 const expectedComparison=comparison.compareWorkspaces(mechanical,successor);
 const out=resolve(outputRoot);await mkdir(out,{recursive:true,mode:0o700});
 // Historical baseline-only receiving.json and source-comparison-receiving.json remain intact.
 const recordPath=join(out,'browser-recovery-receiving.json'),inputSha256=sha(inputBytes);
 let record;
 if(await exists(recordPath)){
  record=JSON.parse(await readFile(recordPath,'utf8'));
  need(record.inputSha256===inputSha256&&record.operationId===input.operationId,'This receiving directory belongs to another original input.');
  if(record.status==='COMPLETE'){
   for(const file of record.files)await retainedFile(file);
   return record;
  }
 }else record={schema:'manufacturing-data-browser-recovery-receiving-result.v1',operationId:input.operationId,inputSha256,status:'PREPARING',attempts:[]};
 const attempt={id:randomUUID(),startedAt:new Date().toISOString(),status:'RUNNING'};
 const work=join(out,attempt.id);await mkdir(work,{mode:0o700});attempt.directory=work;record.attempts.push(attempt);record.status='RUNNING';await checkpoint(recordPath,record);
 const files=[],screens=[],events=[],errors=[],contexts=[];
 const keep=async(name,body)=>{const path=join(work,name);await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,body,{flag:'wx',mode:0o600});const row=identity(path,Buffer.isBuffer(body)?body:Buffer.from(body,'utf8'));files.push(row);return row;};
 const event=async(name,value={})=>{const row={name,at:new Date().toISOString(),...value};events.push(row);await onProgress(row);};
 const newPage=async()=>{const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(context);
  await context.route('**/*',route=>/^https?:/i.test(route.request().url())?route.abort('blockedbyclient'):route.continue());
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));return page;};
 const status=async(page,expected)=>page.waitForFunction(text=>document.querySelector('#desk-status')?.textContent.includes(text),expected);
 const heading=async(page,expected)=>page.waitForFunction(text=>document.querySelector('h1')?.textContent===text,expected);
 const openSources=async page=>{const summary=page.getByText('All retained source editions',{exact:true});if(!await summary.evaluate(el=>el.parentElement.open))await summary.click();};
 const loadDesk=async page=>{await page.setContent(utf8(deskFile.body),{waitUntil:'load'});await page.locator('#desk-open').waitFor();};
 const download=async(page,locator,name)=>{const awaited=page.waitForEvent('download');await locator.click();const file=await awaited,path=join(work,name);await file.saveAs(path);need(!await file.failure(),'The original download failed.');const body=await readFile(path),row=identity(path,body);files.push(row);return {...row,body};};
 const working=async(page,name)=>{const file=await download(page,page.locator('[data-action="save"]'),name);const value=JSON.parse(utf8(file.body));core.importWorkspace(value.current.workspace);return {file,value};};
 const capture=async(page,name)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(()=>document.fonts?.ready);
   const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
   need(geometry.scrollWidth<=geometry.width+1,'The actual '+name+' document overflows its '+width+'px viewport.');
   const path=join(work,name+'-'+width+'.png');await page.screenshot({path,fullPage:true});const body=await readFile(path),row={...identity(path,body),viewport:{width,height:width===390?844:1000},documentHeight:geometry.height};files.push(row);screens.push(row);
  }await page.setViewportSize({width:1440,height:1000});};
 const viewText=async(page,name,title,text,type='text')=>{let body='<pre>'+escape(text)+'</pre>';
  if(type==='csv'){const parsed=core.inspectCSV(text);need(!parsed.errors.length,'Exported CSV cannot be reopened: '+name);body='<div class="scroll"><table><thead><tr>'+parsed.headers.map(x=>'<th>'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+parsed.rows.map(r=>'<tr>'+r.values.map(x=>'<td>'+escape(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
  await page.setContent('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:15px/1.5 system-ui;color:#17212b;background:#fff;margin:0;padding:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;min-width:600px}td,th{border:1px solid #aeb7c2;padding:8px;vertical-align:top;text-align:left}.scroll{overflow:auto;max-width:100%}h1{font-size:22px;overflow-wrap:anywhere}</style><h1>'+escape(title)+'</h1>'+body,{waitUntil:'load'});await capture(page,name);};
 try{
  const page=await newPage(),viewer=await newPage();await loadDesk(page);
  const empty=await working(page,'00-empty-customer-working.json');
  need(empty.value.current.workspace.revision===0&&empty.value.current.workspace.imports.length===0,'The customer startup must contain no customer or mechanical data.');
  const predecessorNote='Mechanical receiving: preserve this complete predecessor before opening the retained example.';
  await page.locator('#desk-notes').fill(predecessorNote);await page.locator('#desk-actor').fill('Mechanical receiving example');
  await capture(page,'01-empty-customer-desk');await event('empty_customer_opened',{workspaceId:empty.value.current.workspace.id});
  const wrapped=await keep('02-original-mechanical-working.json',json(deskEnvelope(mechanical)));
  await page.locator('#desk-open').setInputFiles(wrapped.path);
  await status(page,'The complete incoming desk is retained below.');
  const staged=await working(page,'03-incoming-staged-current-preserved.json');
  need(staged.value.current.workspace.id===empty.value.current.workspace.id&&staged.value.current.notes===predecessorNote,'Staging an incoming working file replaced current work.');
  const incoming=page.locator('.readonly').filter({hasText:mechanical.label}).filter({has:page.locator('[data-location="incoming"]')});
  await incoming.locator('[data-action="open-edition"]').click();await heading(page,mechanical.label);
  let current=await working(page,'04-mechanical-current-with-predecessor.json');
  need(equal(current.value.current.workspace,mechanical),'Opening changed the original mechanical workspace.');
  need(current.value.history.some(x=>x.state.workspace.id===empty.value.current.workspace.id&&x.state.notes===predecessorNote),'The displaced complete desk was not retained.');
  await event('original_workspace_opened',{revision:mechanical.revision,predecessorRetained:true});

  const inventory=mechanical.imports.find(x=>x.id===mechanical.activeSources.inventory);
  need(inventory&&inventory.csv.charCodeAt(0)!==0xfeff,'Use the retained original inventory for the explicit BOM exercise.');
  const bomCSV='\uFEFF'+inventory.csv,bomBytes=Buffer.from(bomCSV,'utf8'),bomFile=await keep('05-mechanical-inventory-utf8-bom.csv',bomBytes);
  await page.locator('#desk-kind').selectOption('inventory');await page.locator('#desk-csv').setInputFiles(bomFile.path);
  await status(page,'Original CSV retained.');
  await page.locator('[data-map="revision"]').selectOption({label:'Explicit blank revision (no source column)'});
  need(await page.locator('[data-map="revision"] option:checked').textContent()==='Explicit blank revision (no source column)','Explicit blank revision was not selected.');
  await page.locator('[data-map="revision"]').selectOption({label:'revision'});
  const pendingDownload=await download(page,page.locator('[data-action="pending-original"]'),'06-original-bom-download.csv');
  need(pendingDownload.body.equals(bomBytes),'The incoming original UTF-8 BOM or complete bytes changed.');
  await page.locator('[data-action="adopt"]').click();await status(page,'Selected source edition retained.');
  current=await working(page,'07-bom-source-adopted-working.json');
  const adopted=current.value.current.workspace.imports.find(x=>x.id===current.value.current.workspace.activeSources.inventory);
  need(adopted.csv===bomCSV&&adopted.sha256===sha(bomBytes),'Selected source did not retain its complete original UTF-8 bytes.');
  need(adopted.columns.revision==='revision','A deliberate restoration of the revision column was not retained.');

  const beforeFailure=clone(current.value.current.workspace),badFile=await keep('08-invalid-utf8-mechanical.csv',Buffer.from([0xff,0xfe,0x41,0x0a]));
  await page.locator('#desk-csv').setInputFiles(badFile.path);await status(page,'not valid UTF-8');
  const afterFailure=await working(page,'09-invalid-source-current-preserved.json');
  need(equal(afterFailure.value.current.workspace,beforeFailure),'An invalid source replaced the current workspace.');await capture(page,'10-original-source-error');

  const cycle=mechanical.imports.find(x=>x.id==='bom-cycle');
  need(cycle,'The exact operated cycle predecessor is absent.');
  await openSources(page);await page.locator('[data-action="restage"][data-source="'+cycle.id+'"]').click();
  await page.locator('[data-action="adopt"]').click();
  const cycleIssue=page.locator('details[data-issue]').filter({hasText:'BOM_CYCLE'});await cycleIssue.waitFor();
  await cycleIssue.locator('summary').click();await cycleIssue.locator('[data-decision-status]').selectOption('working');
  const decisionNote='Mechanical example: retain the circular source for review; use the earlier valid edition for the subsequent handover.';
  await cycleIssue.locator('[data-decision-note]').fill(decisionNote);await cycleIssue.locator('[data-action="decision"]').click();
  await status(page,'Decision retained with the original exception.');
  // Recording rerenders the details; reopen the actual current exception before capture.
  await page.locator('details[data-issue]').filter({hasText:'BOM_CYCLE'}).locator('summary').click();
  await capture(page,'11-populated-cycle-review');
  const issueExport=await download(page,page.locator('[data-action="exceptions"]'),'12-mechanical-cycle-exceptions.csv');
  const cycleReport=await download(page,page.locator('[data-action="report"]'),'13-mechanical-cycle-report.html');
  await viewer.setContent(utf8(cycleReport.body),{waitUntil:'load'});await capture(viewer,'14-full-cycle-report');
  await viewText(viewer,'15-reopened-exceptions','Complete exported exceptions',utf8(issueExport.body),'csv');

  const validBOM=mechanical.activeSources.bom;
  await openSources(page);await page.locator('[data-action="restage"][data-source="'+validBOM+'"]').click();await page.locator('[data-action="adopt"]').click();
  await status(page,'Selected source edition retained.');
  current=await working(page,'16-current-complete-working.json');
  const analysis=core.analyze(current.value.current.workspace);
  need(analysis.issues.length===0,'The retained valid sources did not recover their original clean mechanical analysis.');
  need(current.value.current.workspace.dispositions.some(x=>x.note===decisionNote),'The earlier review decision was lost.');
  await capture(page,'17-current-source-desk');
  const report=await download(page,page.locator('[data-action="report"]'),'18-current-readiness-report.html');
  await viewer.setContent(utf8(report.body),{waitUntil:'load'});await capture(viewer,'19-current-full-report');
  const handover=await download(page,page.locator('[data-action="handover"]'),'20-complete-data-handover.json');
  const openedHandover=JSON.parse(utf8(handover.body));need(equal(openedHandover.workspace,current.value.current.workspace),'Data handover changed its exact selected workspace.');
  need(equal(openedHandover.analysis,analysis),'Data handover differs from the current complete analysis.');
  for(const kind of core.KINDS){
   await page.locator('#desk-table-kind').selectOption(kind);
   const csv=await download(page,page.locator('[data-action="table-csv"]'),'canonical-'+kind+'.csv');
   need(utf8(csv.body)===core.exportCanonicalCSV(current.value.current.workspace,kind),'Canonical CSV differs from selected source: '+kind);
   const tableJSON=await download(page,page.locator('[data-action="table-json"]'),'canonical-'+kind+'.json');
   need(equal(JSON.parse(utf8(tableJSON.body)),analysis.tables[kind]),'Complete table JSON differs: '+kind);
   const source=current.value.current.workspace.imports.find(x=>x.id===current.value.current.workspace.activeSources[kind]);
   await openSources(page);const original=await download(page,page.locator('[data-action="source-original"][data-source="'+source.id+'"]'),'original-'+kind+'.csv');
   need(original.sha256===source.sha256&&original.bytes===source.bytes,'Original source download changed: '+kind);
   await viewText(viewer,'canonical-'+kind,'Complete '+kind+' CSV',utf8(csv.body),'csv');
   await viewText(viewer,'canonical-'+kind+'-json','Complete '+kind+' table JSON',utf8(tableJSON.body));
   await viewText(viewer,'original-'+kind,'Complete original '+kind+' CSV',utf8(original.body),'csv');
  }

  // Use the actual original pair through the normal retained-edition controls.
  const beforeComparison=clone(current.value.current.workspace);
  await page.locator('#desk-comparison-open').setInputFiles(workspaceFile.path);
  await status(page,'Complete comparison edition retained beside the current desk.');
  await page.locator('#desk-comparison-open').setInputFiles(comparisonFile.path);
  await status(page,'Complete comparison edition retained beside the current desk.');
  let comparedDesk=await working(page,'comparison-01-originals-retained-working.json');
  let comparisonState=comparedDesk.value.current.comparison;
  const baselineRecord=comparisonState.records.find(row=>row.raw===utf8(workspaceFile.body)&&row.sha256===workspaceFile.sha256);
  const successorRecord=comparisonState.records.find(row=>row.raw===utf8(comparisonFile.body)&&row.sha256===comparisonFile.sha256);
  need(baselineRecord&&successorRecord&&baselineRecord.id!==successorRecord.id,'Comparison did not retain both exact original supplied source files.');
  need(equal(comparedDesk.value.current.workspace,beforeComparison),'Comparison import changed the active source workspace.');
  await page.locator('#desk-comparison-baseline').selectOption(baselineRecord.id);
  await page.locator('#desk-comparison-target').selectOption(successorRecord.id);
  for(const filter of ['added','missing','changed','ambiguous','all']){
   await page.locator('#desk-comparison-status').selectOption(filter);
   await page.waitForFunction(value=>document.querySelector('#desk-comparison-status')?.value===value,filter);
  }
  const difference=expectedComparison.differences[0];
  if(difference){
  let card=page.locator('[data-comparison-difference="'+difference.id+'"]');
  await card.locator('summary').click();
  await card.locator('[data-comparison-review-status]').selectOption('working');
  const comparisonNote='Mechanical example: reconcile this exact returned-source difference with its original row references.';
  await card.locator('[data-comparison-review-note]').fill(comparisonNote);
  await card.locator('[data-action="comparison-review"]').click();
  await status(page,'Comparison review retained with the exact source pair.');
  // Retain an unfinished edit separately from the completed source-bound review.
  card=page.locator('[data-comparison-difference="'+difference.id+'"]');
  await card.locator('summary').click();
  const draftNote=comparisonNote+' Draft: awaiting the source owner response.';
  await card.locator('[data-comparison-review-note]').fill(draftNote);
  comparedDesk=await working(page,'comparison-02-reviewed-with-unfinished-note.json');
  comparisonState=comparedDesk.value.current.comparison;
  const reviewKey=expectedComparison.id+':'+difference.id;
  need(comparisonState.baselineId===baselineRecord.id&&comparisonState.targetId===successorRecord.id&&
       comparisonState.reviewHistory.length===1&&comparisonState.reviews[reviewKey]?.note===comparisonNote&&
       comparisonState.reviewDrafts[reviewKey]?.note===draftNote,'The exact pair, recorded review or unfinished draft was not retained.');
  }else{
   comparedDesk=await working(page,'comparison-02-no-source-differences-working.json');
   comparisonState=comparedDesk.value.current.comparison;
   need(comparisonState.reviewHistory.length===0,'A source review was fabricated where the actual comparison has no differences.');
  }
  const comparisonOptions={reviews:comparisonState.reviewHistory,reviewer:comparedDesk.value.current.actor,notes:comparedDesk.value.current.notes};
  await capture(page,'comparison-03-populated-source-review');
  const comparisonJSON=await download(page,page.locator('[data-action="comparison-json"]'),'comparison-complete.json');
  const comparisonCSV=await download(page,page.locator('[data-action="comparison-csv"]'),'comparison-differences.csv');
  const comparisonHTML=await download(page,page.locator('[data-action="comparison-report"]'),'comparison-report.html');
  need(utf8(comparisonJSON.body)===comparison.exportComparisonJSON(expectedComparison,comparisonOptions),'Comparison JSON differs from the actual selected source pair and recorded reviews.');
  need(utf8(comparisonCSV.body)===comparison.exportComparisonCSV(expectedComparison,comparisonOptions),'Comparison CSV omitted or changed an original difference, issue or review.');
  need(utf8(comparisonHTML.body)===comparison.reportHTML(expectedComparison,comparisonOptions),'Comparison report differs from the complete original selected result.');
  for(const [record,original,name]of [[baselineRecord,workspaceFile,'baseline'],[successorRecord,comparisonFile,'successor']]){
   const button=page.locator('[data-action="comparison-original"][data-edition="'+record.id+'"]');
   const details=button.locator('xpath=ancestor::details[1]');
   if(!await details.evaluate(el=>el.open))await details.locator('summary').click();
   const downloaded=await download(page,button,'comparison-original-'+name+'.json');
   need(downloaded.body.equals(original.body),'Comparison original download changed '+name+' source bytes.');
   await viewText(viewer,'comparison-original-'+name,'Complete original '+name+' workspace',utf8(downloaded.body));
  }
  await viewer.setContent(utf8(comparisonHTML.body),{waitUntil:'load'});await capture(viewer,'comparison-04-full-report');
  await viewText(viewer,'comparison-05-csv','Complete comparison differences and source exceptions',utf8(comparisonCSV.body),'csv');
  await viewText(viewer,'comparison-06-json','Complete comparison and retained review history',utf8(comparisonJSON.body));
  current=await working(page,'comparison-07-complete-working.json');
  need(equal(current.value.current.workspace,beforeComparison),'Reviewing or exporting a comparison changed the active original source workspace.');
  await event('original_source_pair_compared',{comparisonId:expectedComparison.id,baselineRevision:mechanical.revision,
   successorRevision:successor.revision,counts:expectedComparison.counts,recordedReviews:comparisonState.reviewHistory.length,
   unfinishedReviewRetained:Boolean(difference),reviewSkippedReason:difference?null:'The supplied source pair has no differences to review.'});

  const cold=await newPage();await loadDesk(cold);await cold.locator('#desk-open').setInputFiles(current.file.path);
  await status(cold,'The complete incoming desk is retained below.');
  await cold.locator('[data-action="open-edition"][data-location="incoming"]').first().click();
  await heading(cold,mechanical.label);
  const reopened=await working(cold,'21-cold-reopened-complete-working.json');
  need(equal(reopened.value.current,current.value.current),'Cold reopening changed the complete current editor or source.');
  for(const source of current.value.current.workspace.imports)need(reopened.value.current.workspace.imports.some(x=>equal(x,source)),'A previous exact source edition was lost.');
  await capture(cold,'22-cold-reopened-desk');

  // Recover the old UI's saved filter without changing any source or review record.
  const legacy=clone(current.value);legacy.current.comparison.status='unchanged';
  const legacyFile=await keep('comparison-08-legacy-unchanged-filter-working.json',json(legacy));
  const legacyPage=await newPage();await loadDesk(legacyPage);
  await legacyPage.locator('#desk-open').setInputFiles(legacyFile.path);
  await status(legacyPage,'The complete incoming desk is retained below.');
  await legacyPage.locator('[data-action="open-edition"][data-location="incoming"]').first().click();
  await heading(legacyPage,mechanical.label);
  const recoveredLegacy=await working(legacyPage,'comparison-09-recovered-legacy-filter-working.json');
  need(recoveredLegacy.value.current.comparison.status==='all'&&equal(recoveredLegacy.value.current,current.value.current),
       'Legacy unchanged-filter recovery lost the original pair, sources, reviews or unfinished editor.');
  await capture(legacyPage,'comparison-10-legacy-filter-recovered');
  await event('comparison_cold_reopened',{comparisonId:expectedComparison.id,legacyFilterRecovered:true,completeEditorRetained:true});


  // Operate the delivered controller on one literal loopback origin so two real
  // pages share the browser's actual localStorage. No alternate persistence model.
  const server=createServer((request,response)=>{
   if(request.method==='GET'&&request.url==='/desk'){
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    response.end(deskFile.body);
   }else{response.writeHead(404,{'Content-Type':'text/plain'});response.end('Not found');}
  });
  await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
  try{
   const origin='http://127.0.0.1:'+server.address().port;
   const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(context);
   await context.route('**/*',route=>route.request().url()===origin+'/desk'?route.continue():route.abort('blockedbyclient'));
   const openShared=async()=>{const p=await context.newPage();p.on('pageerror',error=>errors.push(error.message));await p.goto(origin+'/desk');await p.locator('#desk-open').waitFor();return p;};
   const first=await openShared();
   await first.locator('#desk-open').setInputFiles(current.file.path);
   await status(first,'The complete incoming desk is retained below.');
   await first.locator('[data-action="open-edition"][data-location="incoming"]').first().click();
   await heading(first,mechanical.label);
   const storageKey=await first.evaluate(()=>{
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.includes(':journal:'))continue;
     try{if(JSON.parse(localStorage.getItem(key)).schema==='manufacturing-data-desk.v1')return key;}catch{}}
    throw Error('The actual current browser desk was not saved.');
   });
   const second=await openShared();
   const initialSecond=await working(second,'browser-01-second-operator-original-working.json');
   need(equal(initialSecond.value.current,current.value.current),'The second page did not open the complete original browser workspace and comparison.');
   const firstNote='First operator: current published manufacturing review.';
   const secondNote='Second operator: unfinished independent inventory and source-comparison review.';
   await first.locator('#desk-notes').fill(firstNote);
   await first.waitForFunction(({key,note})=>JSON.parse(localStorage.getItem(key)).current.notes===note,{key:storageKey,note:firstNote});
   const firstHead=await first.evaluate(key=>localStorage.getItem(key),storageKey);
   await second.locator('#desk-notes').fill(secondNote);
   await second.waitForFunction(({key,note})=>Object.keys(localStorage).some(k=>{
    if(!k.startsWith(key+':journal:'))return false;try{return JSON.parse(localStorage.getItem(k)).desk.current.notes===note;}catch{return false;}
   }),{key:storageKey,note:secondNote});
   need(await second.evaluate(key=>localStorage.getItem(key),storageKey)===firstHead,'The stale second page replaced the first operator current browser copy.');
   const conflict=await working(second,'browser-02-conflicted-complete-working.json');
   need(conflict.value.current.notes===secondNote&&equal(conflict.value.current.comparison,current.value.current.comparison),
        'The conflict lost the current narrative, complete comparison or unfinished review.');
   await capture(second,'browser-03-actual-two-page-conflict');
   await second.locator('[data-action="browser-independent"]').click();
   const independentNote=secondNote+' Further independent working notes.';
   await second.locator('#desk-notes').fill(independentNote);
   await second.waitForFunction(({key,note})=>Object.keys(localStorage).some(k=>{
    if(!k.startsWith(key+':journal:'))return false;try{const row=JSON.parse(localStorage.getItem(k));return row.independent&&row.desk.current.notes===note;}catch{return false;}
   }),{key:storageKey,note:independentNote});
   need(await second.evaluate(key=>localStorage.getItem(key),storageKey)===firstHead,'Independent continuation changed the current browser copy.');
   await second.locator('[data-action="browser-use-head"]').click();
   await status(second,'Opened the current browser copy;');
   const restoredHead=await working(second,'browser-04-current-browser-opened-with-entire-draft-retained.json');
   need(restoredHead.value.current.notes===firstNote&&
        restoredHead.value.history.some(row=>row.state.notes===independentNote)&&
        restoredHead.value.recovery.some(row=>JSON.parse(row.raw).current.notes===independentNote),
        'Selecting the current browser copy lost the complete displaced independent editor.');
   need(equal(restoredHead.value.current.comparison,current.value.current.comparison),'Selecting the browser copy changed original comparison records or review drafts.');
   const secondHead=await second.evaluate(key=>localStorage.getItem(key),storageKey);
   const revisedFirst='First operator: a second stale edit that must remain recoverable.';
   await first.locator('#desk-notes').fill(revisedFirst);
   await first.waitForFunction(({key,note})=>Object.keys(localStorage).some(k=>{
    if(!k.startsWith(key+':journal:'))return false;try{return JSON.parse(localStorage.getItem(k)).desk.current.notes===note;}catch{return false;}
   }),{key:storageKey,note:revisedFirst});
   need(await first.evaluate(key=>localStorage.getItem(key),storageKey)===secondHead,'A later stale edit replaced the newer complete browser desk.');
   await first.locator('[data-action="browser-publish"]').click();
   await status(first,'This complete draft is the current browser copy;');
   const published=await working(first,'browser-05-explicit-publication-preserves-predecessor.json');
   need(published.value.current.notes===revisedFirst&&published.value.recovery.some(row=>row.kind==='browser-snapshot'&&equal(JSON.parse(row.raw).current,JSON.parse(secondHead).current)),
        'Explicit publication lost the exact complete displaced browser copy.');
   const third=await openShared();
   const journalId=await third.evaluate(({key,note})=>{
    for(const k of Object.keys(localStorage)){if(!k.startsWith(key+':journal:'))continue;
     const row=JSON.parse(localStorage.getItem(k));if(row.desk.history?.some(item=>item.state.notes===note))return row.id;}
    throw Error('The other operator complete journal is missing.');
   },{key:storageKey,note:independentNote});
   const journalCard=third.locator('#desk-recovery .readonly').filter({hasText:'Page draft '+journalId});
   await journalCard.locator('[data-action="browser-stage"]').click();
   await status(third,'The complete browser copy is staged beside current work.');
   const stagedJournal=await working(third,'browser-06-complete-other-page-journal-staged.json');
   const retainedEditor=stagedJournal.value.incoming.find(row=>row.state.notes===independentNote);
   need(stagedJournal.value.current.notes===revisedFirst&&retainedEditor,'Staging the other page journal replaced current work or omitted the displaced editor.');
   await third.locator('[data-action="open-edition"][data-location="incoming"][data-edition="'+retainedEditor.id+'"]').click();
   const recovered=await working(third,'browser-07-recovered-independent-operator-complete-working.json');
   need(recovered.value.current.notes===independentNote&&equal(recovered.value.current.comparison,current.value.current.comparison)&&
        equal(recovered.value.current.workspace,current.value.current.workspace),
        'The recovered operator draft lost original sources, complete comparisons or unfinished review text.');
   await capture(third,'browser-08-independent-operator-recovered');

   const publicationGrowth=[];
   for(let index=0;index<6;index++){
    const operator=index%2?first:second,note='Alternating complete operator draft '+index;
    await operator.locator('#desk-notes').fill(note);
    await operator.waitForFunction(({key,note})=>Object.keys(localStorage).some(k=>{
     if(!k.startsWith(key+':journal:'))return false;try{return JSON.parse(localStorage.getItem(k)).desk.current.notes===note;}catch{return false;}
    }),{key:storageKey,note});
    await operator.locator('[data-action="browser-publish"]').click();
    await status(operator,'This complete draft is the current browser copy;');
    const raw=await operator.evaluate(key=>localStorage.getItem(key),storageKey),value=JSON.parse(raw);
    publicationGrowth.push(Buffer.byteLength(raw));
    need(value.current.notes===note&&value.recovery.every(row=>row.kind!=='browser-snapshot'||!JSON.parse(row.raw).recovery),
         'Repeated browser publication changed the selected editor or recursively embedded its archive.');
    need(equal(value.current.workspace,current.value.current.workspace)&&equal(value.current.comparison,current.value.current.comparison),
         'Repeated publication changed original source records, complete comparisons or unfinished review text.');
    const notes=value.recovery.map(row=>JSON.parse(row.raw).current?.notes);
    for(let prior=0;prior<index;prior++)need(notes.includes('Alternating complete operator draft '+prior),'A complete prior operator draft was lost during repeated publication.');
   }
   need(publicationGrowth.at(-1)<publicationGrowth[0]*6+50000,'Repeated browser publication grows recursively.');
   await keep('browser-10-actual-repeated-publication-sizes.json',json({schema:'manufacturing-browser-publication-growth.v1',bytes:publicationGrowth}));

   const isolatedContext=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(isolatedContext);
   await isolatedContext.route('**/*',route=>route.request().url()===origin+'/desk'?route.continue():route.abort('blockedbyclient'));
   const isolated=await isolatedContext.newPage();isolated.on('pageerror',error=>errors.push(error.message));
   await isolated.goto(origin+'/desk');await isolated.locator('#desk-open').setInputFiles(recovered.file.path);
   await status(isolated,'The complete incoming desk is retained below.');
   await isolated.locator('[data-action="open-edition"][data-location="incoming"]').first().click();
   const portableRecovery=await working(isolated,'browser-09-independent-context-reopened-working.json');
   need(equal(portableRecovery.value.current,recovered.value.current),'Independent browser reopening changed the complete recovered current editor.');
   need(portableRecovery.value.recovery.some(row=>row.raw===utf8(recovered.file.body)),
        'Portable reopening did not retain the complete original recovery envelope.');
   await event('complete_browser_drafts_recovered',{twoStaleConflicts:true,independentContinuation:true,
    explicitPublicationPreservedPredecessor:true,completeJournalStaged:true,independentContextReopened:true,
    originalWorkspaceAndComparisonUnchanged:true,alternatingPublicationBytes:publicationGrowth});
  }finally{await new Promise(resolve=>server.close(resolve));}


  if(authoredExampleFile){
   const authored=JSON.parse(utf8(authoredExampleFile.body));
   need(authored.schema==='manufacturing-authored-operating-example-source.v1'&&Array.isArray(authored.files)&&
        authored.core?.sha256===coreFile.sha256,'The complete authored example must bind the unchanged current core.');
   const materialized=new Map();
   for(const member of authored.files){
    need(member&&typeof member.path==='string'&&/^example\/[a-zA-Z0-9._-]+$/.test(member.path)&&!materialized.has(member.path)&&
         typeof member.content==='string'&&Buffer.byteLength(member.content)===member.bytes&&sha(Buffer.from(member.content))===member.sha256,
         'An authored example member is incomplete, duplicated or changed.');
    materialized.set(member.path,await keep('authored-originals/'+member.path,member.content));
   }
   const member=path=>{const row=materialized.get(path);need(row,'The complete authored example member is missing: '+path);return row;};
   const initial=JSON.parse(await readFile(member('example/initial-desk.json').path,'utf8'));
   const expected=JSON.parse(await readFile(member('example/complete-desk.json').path,'utf8'));
   core.importWorkspace(initial.current.workspace);core.importWorkspace(expected.current.workspace);
   need(initial.current.workspace.revision===4&&initial.current.workspace.imports.length===4&&
        expected.current.workspace.revision===11&&expected.current.workspace.imports.length===8,
        'Retain the original authored initial and corrected eight-source example.');
   const authoredPage=await newPage();await loadDesk(authoredPage);
   await authoredPage.locator('#desk-open').setInputFiles(member('example/initial-desk.json').path);
   await status(authoredPage,'The complete incoming desk is retained below.');
   await authoredPage.locator('[data-action="open-edition"][data-location="incoming"]').first().click();
   await heading(authoredPage,initial.current.workspace.label);
   let operated=await working(authoredPage,'authored-01-initial-complete-working.json');
   need(equal(operated.value.current,initial.current)&&core.analyze(operated.value.current.workspace).counts.errors===9,
        'The authored initial source changed or its original nine errors were not reproduced.');
   await authoredPage.locator('[data-action="comparison-retain"]').click();
   await status(authoredPage,'Complete comparison edition retained beside the current desk.');
   for(const originalDecision of expected.current.workspace.dispositions){
    const card=authoredPage.locator('[data-issue="'+originalDecision.issueId+'"]');
    await card.locator('summary').click();
    await card.locator('[data-decision-status]').selectOption(originalDecision.status);
    await card.locator('[data-decision-note]').fill(originalDecision.note);
    await card.locator('[data-action="decision"]').click();
    await status(authoredPage,'Decision retained with the original exception.');
   }
   await authoredPage.locator('#desk-units').fill(expected.current.unitText);
   await authoredPage.locator('[data-action="units"]').click();await status(authoredPage,'Approved unit mappings retained.');
   operated=await working(authoredPage,'authored-02-reviewed-with-explicit-unit-mapping.json');
   need(core.analyze(operated.value.current.workspace).counts.errors===6&&operated.value.current.workspace.dispositions.length===2,
        'Authored review decisions or explicit cm-to-metre mapping did not retain the six remaining source errors.');
   for(const kind of core.KINDS){
    const sourceFile=member('example/corrected-'+kind+'.csv');
    await authoredPage.locator('#desk-kind').selectOption(kind);
    await authoredPage.locator('#desk-csv').setInputFiles(sourceFile.path);
    await status(authoredPage,'Original CSV retained.');
    await authoredPage.locator('[data-action="adopt"]').click();
    await status(authoredPage,'Selected source edition retained.');
   }
   operated=await working(authoredPage,'authored-03-corrected-complete-working.json');
   const actualAnalysis=core.analyze(operated.value.current.workspace),expectedAnalysis=core.analyze(expected.current.workspace);
   need(operated.value.current.workspace.revision===11&&operated.value.current.workspace.imports.length===8&&
        operated.value.current.workspace.dispositions.length===2&&actualAnalysis.counts.errors===0,
        'The actual authored correction did not retain all eight source editions and earlier decisions.');
   for(const kind of core.KINDS){
    const semantic=rows=>rows.map(row=>({values:row.values,derived:row.derived}));
    need(equal(semantic(actualAnalysis.tables[kind]),semantic(expectedAnalysis.tables[kind])),
         'Actual authored '+kind+' values or exact derived quantities differ from the unchanged core example.');
    for(const phase of ['initial','corrected']){
     const original=authored.files.find(row=>row.path==='example/'+phase+'-'+kind+'.csv');
     need(operated.value.current.workspace.imports.some(row=>row.kind===kind&&row.csv===original.content&&row.sha256===original.sha256),
          'An exact authored original source was lost: '+phase+' '+kind);
    }
   }
   const actualComparison=comparison.compareWorkspaces(initial.current.workspace,operated.value.current.workspace);
   const comparisonOptions={reviews:[],reviewer:operated.value.current.actor,notes:operated.value.current.notes};
   const completeComparison=await download(authoredPage,authoredPage.locator('[data-action="comparison-json"]'),'authored-04-complete-original-to-corrected-comparison.json');
   need(utf8(completeComparison.body)===comparison.exportComparisonJSON(actualComparison,comparisonOptions),
        'The authored source comparison differs from its actual original and operated corrected source.');
   const fullReport=await download(authoredPage,authoredPage.locator('[data-action="report"]'),'authored-05-complete-readiness-report.html');
   need(utf8(fullReport.body)===core.reportHTML(operated.value.current.workspace),'The authored final readiness report changed actual source data.');
   await capture(authoredPage,'authored-06-complete-corrected-source-desk');
   await viewer.setContent(utf8(fullReport.body),{waitUntil:'load'});await capture(viewer,'authored-07-complete-readiness-report');
   const reopenedPage=await newPage();await loadDesk(reopenedPage);
   await reopenedPage.locator('#desk-open').setInputFiles(operated.file.path);await status(reopenedPage,'The complete incoming desk is retained below.');
   await reopenedPage.locator('[data-action="open-edition"][data-location="incoming"]').first().click();
   const authoredReopened=await working(reopenedPage,'authored-08-independent-complete-reopened-working.json');
   need(equal(authoredReopened.value.current,operated.value.current),'Independent authored example reopen changed sources, decisions or comparison.');
   await event('authored_assembly_operated',{initialErrors:9,afterExplicitUnitMappingErrors:6,finalErrors:0,
    retainedSources:8,priorDecisions:2,actualRevision:11,completeComparisonId:actualComparison.id,independentReopen:true,
    originalAuthoredBank:identity(authoredExampleFile.path,authoredExampleFile.body)});
  }

  await viewer.setContent(utf8(proposalFile.body),{waitUntil:'load'});await capture(viewer,'23-original-customer-proposal');
  need(errors.length===0,'Actual browser errors: '+errors.join('; '));
  await event('full_course_complete',{workspaceId:mechanical.id,currentRevision:current.value.current.workspace.revision,sourceEditions:current.value.current.workspace.imports.length,actualScreenshots:screens.length});
  const result={schema:record.schema,operationId:record.operationId,inputSha256,status:'COMPLETE',completedAt:new Date().toISOString(),attempts:record.attempts,
   originalInputs:[identity(deskFile.path,deskFile.body),identity(proposalFile.path,proposalFile.body),identity(workspaceFile.path,workspaceFile.body),identity(coreFile.path,coreFile.body),identity(comparisonFile.path,comparisonFile.body),identity(comparisonModule.path,comparisonModule.body),...(authoredExampleFile?[identity(authoredExampleFile.path,authoredExampleFile.body)]:[])],
   comparisonId:expectedComparison.id,comparisonCounts:expectedComparison.counts,comparisonOriginalsRetained:true,
   comparisonExportsReopened:true,completeBrowserDraftRecovery:true,authoredAssemblyOperated:Boolean(authoredExampleFile),comparisonReviewAndDraftRetained:Boolean(difference),legacyComparisonFilterRecovered:true,
   files,screens,events,mechanicalWorkspaceId:mechanical.id,initialCustomerWorkspaceId:empty.value.current.workspace.id,
   currentRevision:current.value.current.workspace.revision,fullSourcesRetained:current.value.current.workspace.imports.length,
   sourceBOMPreserved:true,currentWorkPreservedOnInvalidInput:true,priorDeskRetained:true,originalDecisionRetained:true,coldReopened:true,
   producingPeerVisualInspection:'Open and LOOK at the actual returned images and every outgoing file; capture alone does not complete the owner instruction.'};
  attempt.status='COMPLETE';attempt.completedAt=result.completedAt;await checkpoint(recordPath,result);return result;
 }catch(error){attempt.status='INTERRUPTED';attempt.error={name:error.name,message:error.message};record.status='INTERRUPTED';record.files=files;record.screens=screens;record.events=events;await checkpoint(recordPath,record);throw error;}
 finally{for(const context of contexts.reverse())await context.close().catch(()=>{});}
}
