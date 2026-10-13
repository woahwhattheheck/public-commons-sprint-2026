import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
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
 *  core:{bytes,sha256},comparison:{bytes,sha256}}. Both workspaces are the supplied original pair.
 * Return actual downloads, original source identities and desktop/narrow images.
 * The producing peers must OPEN and VIEW those actual images and attachments.
 */
export async function runDataReadinessCourse({browser,inputFile,outputRoot,onProgress=()=>{}}){
 need(browser&&typeof browser.newContext==='function','Use the original equipped browser.');
 const inputBytes=await readFile(resolve(inputFile)),input=JSON.parse(utf8(inputBytes));
 need(input.schema==='manufacturing-data-receiving-input.v1'&&typeof input.operationId==='string'&&input.operationId,'Keep the original receiving operation identity.');
 const deskFile=await retainedFile(input.desk),proposalFile=await retainedFile(input.proposal),workspaceFile=await retainedFile(input.mechanicalWorkspace);
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
 // Historical baseline-only receiving.json remains intact, including completed results.
 const recordPath=join(out,'source-comparison-receiving.json'),inputSha256=sha(inputBytes);
 let record;
 if(await exists(recordPath)){
  record=JSON.parse(await readFile(recordPath,'utf8'));
  need(record.inputSha256===inputSha256&&record.operationId===input.operationId,'This receiving directory belongs to another original input.');
  if(record.status==='COMPLETE'){
   for(const file of record.files)await retainedFile(file);
   return record;
  }
 }else record={schema:'manufacturing-data-comparison-receiving-result.v1',operationId:input.operationId,inputSha256,status:'PREPARING',attempts:[]};
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

  await viewer.setContent(utf8(proposalFile.body),{waitUntil:'load'});await capture(viewer,'23-original-customer-proposal');
  need(errors.length===0,'Actual browser errors: '+errors.join('; '));
  await event('full_course_complete',{workspaceId:mechanical.id,currentRevision:current.value.current.workspace.revision,sourceEditions:current.value.current.workspace.imports.length,actualScreenshots:screens.length});
  const result={schema:record.schema,operationId:record.operationId,inputSha256,status:'COMPLETE',completedAt:new Date().toISOString(),attempts:record.attempts,
   originalInputs:[identity(deskFile.path,deskFile.body),identity(proposalFile.path,proposalFile.body),identity(workspaceFile.path,workspaceFile.body),identity(coreFile.path,coreFile.body),identity(comparisonFile.path,comparisonFile.body),identity(comparisonModule.path,comparisonModule.body)],
   comparisonId:expectedComparison.id,comparisonCounts:expectedComparison.counts,comparisonOriginalsRetained:true,
   comparisonExportsReopened:true,comparisonReviewAndDraftRetained:Boolean(difference),legacyComparisonFilterRecovered:true,
   files,screens,events,mechanicalWorkspaceId:mechanical.id,initialCustomerWorkspaceId:empty.value.current.workspace.id,
   currentRevision:current.value.current.workspace.revision,fullSourcesRetained:current.value.current.workspace.imports.length,
   sourceBOMPreserved:true,currentWorkPreservedOnInvalidInput:true,priorDeskRetained:true,originalDecisionRetained:true,coldReopened:true,
   producingPeerVisualInspection:'Open and LOOK at the actual returned images and every outgoing file; capture alone does not complete the owner instruction.'};
  attempt.status='COMPLETE';attempt.completedAt=result.completedAt;await checkpoint(recordPath,result);return result;
 }catch(error){attempt.status='INTERRUPTED';attempt.error={name:error.name,message:error.message};record.status='INTERRUPTED';record.files=files;record.screens=screens;record.events=events;await checkpoint(recordPath,record);throw error;}
 finally{for(const context of contexts.reverse())await context.close().catch(()=>{});}
}
