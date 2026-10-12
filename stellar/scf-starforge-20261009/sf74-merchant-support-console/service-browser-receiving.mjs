// MIT. Actual browser continuation for the original SF74 service operating case.
// Parent service-journey owns the native SF30/SF93 processes and this browser context.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {parseWorkspace} from './workspace-file.mjs';
import {validateServiceRecord, renderServiceReport, serviceReportCsv} from './service-commitments.mjs';

const SCHEMA='stellar-forge.service-browser-receiving.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  value!==null&&typeof value==='object'?
    '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':
    JSON.stringify(value);
const equal=(left,right)=>canonical(left)===canonical(right);
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const now=()=>new Date().toISOString();
const assert=(value,message)=>{if(!value)throw new Error(message);};
const clip=(value,bytes)=>{let out='';for(const character of value){if(Buffer.byteLength(out+character)>bytes)break;out+=character;}return out;};
const termsFields=['id','title','customer','owner','reference','status','incidentSourceId','merchantId',
  'merchantBinding','effectiveFrom','effectiveUntil','calendar','targets','reviewedBy','note'];
const termContent=value=>Object.fromEntries(termsFields.map(key=>[key,value[key]??null]));
const selectionContent=value=>({...value,captureSha256s:[...value.captureSha256s].sort(),exclusionIds:[...value.exclusionIds].sort()});

function consoleOrigin(value,label){
  const url=new URL(value);
  assert(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&
    !url.username&&!url.password&&(!url.pathname||url.pathname==='/')&&!url.search&&!url.hash,
    label+' must name the actual original loopback SF74 console.');
  return url.origin;
}
async function optionalJSON(file){
  try{return JSON.parse(await fs.readFile(file,'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function atomic(file,bytes){
  const temporary=file+'.'+randomUUID()+'.tmp';
  await fs.writeFile(temporary,bytes,{mode:0o600});
  await fs.rename(temporary,file);
}
function calendarMonth(timestamp,timeZone){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit'})
    .formatToParts(new Date(timestamp)).map(row=>[row.type,row.value]));
  const month=parts.year+'-'+parts.month;
  const last=new Date(Date.UTC(Number(parts.year),Number(parts.month),0)).getUTCDate();
  return {month,from:month+'-01',through:month+'-'+String(last).padStart(2,'0')};
}
function retainedHistory(before,after){
  for(const collection of ['terms','captures','exclusions','reports','operations']){
    const present=new Set((after[collection]??[]).map(canonical));
    for(const row of before[collection]??[])
      assert(present.has(canonical(row)),'Original service '+collection+' history changed during the browser operation.');
  }
}
function findEdition(record,plan){
  const candidates=record.terms.filter(row=>row.id===plan.terms.id&&row.revision===plan.termsRevision);
  assert(candidates.length<=1,'The original service record contains duplicate edition identities.');
  if(!candidates.length)return null;
  assert(equal(termContent(candidates[0]),plan.terms),'The planned service edition identity contains different terms.');
  return candidates[0];
}
function findReport(record,plan){
  const found=record.reports.filter(row=>row.reviewedBy===plan.reportReviewedBy&&row.note===plan.reportNote&&
    equal(selectionContent(row.preview.selection),selectionContent(plan.selection)));
  assert(found.length<=1,'The original case contains more than one report for this retained browser request.');
  return found[0]??null;
}

/**
 * Continue one actual service case. The caller launches a persistent context with
 * acceptDownloads:true, owns its lifetime and supplies the original-store transfer.
 * Reuse the same directory/caseId/reportId after an interruption.
 */
export async function receiveServiceBrowser({context,sourceUrl,receivingUrl,caseId,reportId,directory,transfer}){
  assert(context&&typeof context.newPage==='function'&&context.request,'An actual Playwright BrowserContext is required.');
  assert(UUID.test(caseId)&&UUID.test(reportId),'Original case and report UUIDs are required.');
  assert(typeof directory==='string'&&path.isAbsolute(directory),'Use the original absolute private receiving directory.');
  assert(typeof transfer==='function','The original complete-case transfer callback is required.');
  const sourceOrigin=consoleOrigin(sourceUrl,'Source'),receivingOrigin=consoleOrigin(receivingUrl,'Receiver');
  assert(sourceOrigin!==receivingOrigin,'Source and receiver must be distinct original SF74 listeners.');
  const root=path.join(directory,'service-browser');
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const checkpointPath=path.join(root,'service-browser-state.json');
  let state=await optionalJSON(checkpointPath);
  if(state)assert(state.schema===SCHEMA&&state.caseId===caseId&&state.originalReportId===reportId,
    'This receiving directory belongs to another original service case/report.');
  else state={schema:SCHEMA,caseId,originalReportId:reportId,startedAt:now(),plan:null,phases:{},artifacts:{},
    observations:[],browserErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[]};
  const checkpoint=async()=>{state.updatedAt=now();await atomic(checkpointPath,json(state));};
  const phase=async(name,result)=>{state.phases[name]={at:now(),...result};await checkpoint();};
  const artifact=async(key,filename,bytes,contentType)=>{
    const full=path.join(root,filename);
    assert(path.dirname(full)===root,'Receiving artifact names must stay in the original private directory.');
    const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
    await atomic(full,data);
    state.artifacts[key]={path:full,bytes:data.length,sha256:digest(data),contentType};
    return state.artifacts[key];
  };
  const retainJSON=(key,filename,value)=>artifact(key,filename,json(value),'application/json');
  if(state.completedAt){
    let retained=true;
    for(const entry of Object.values(state.artifacts)){
      try{const bytes=await fs.readFile(entry.path);if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)retained=false;}
      catch(error){if(error.code==='ENOENT')retained=false;else throw error;}
    }
    if(retained)return {...state,checkpointPath,reused:true};
  }
  state.observations.push({at:now(),sourceUrl:sourceOrigin,receivingUrl:receivingOrigin});
  state.completedAt=null;
  await checkpoint();

  async function readCase(origin){
    const response=await context.request.get(origin+'/api/cases/'+caseId,{headers:{accept:'application/json','cache-control':'no-cache'}});
    let body;
    try{body=await response.json();}
    finally{await response.dispose();}
    assert(response.ok(),'Original case read returned HTTP '+response.status()+': '+(body.detail??body.error??'unavailable'));
    assert(body.id===caseId&&typeof body.workspaceText==='string'&&typeof body.revision==='string',
      'The original case endpoint did not return the selected complete case.');
    const workspace=await parseWorkspace(body.workspaceText);
    assert(workspace.service,'The selected case has no original service record.');
    const service=await validateServiceRecord(workspace.service);
    return {item:body,workspace,service};
  }
  let initial=await readCase(sourceOrigin);
  if(!state.plan){
    const original=initial.service.reports.find(row=>row.id===reportId);
    assert(original,'The original orchestration report is missing from this case.');
    const base=initial.service.terms.filter(row=>row.id===original.preview.selection.termsId)
      .sort((a,b)=>a.revision-b.revision).at(-1);
    assert(base,'The original report has no complete retained agreement.');
    const captureIds=original.preview.selection.captureSha256s;
    const captures=captureIds.map(sha=>initial.service.captures.find(row=>row.sha256===sha));
    assert(captures.length>0&&captures.every(Boolean),'The original report capture set is incomplete.');
    const cutoff=captures.map(row=>row.snapshot.capturedAt).sort().at(-1);
    const period=calendarMonth(cutoff,base.calendar.timeZone);
    const terms={...termContent(base),calendar:{...base.calendar,week:Array.from({length:7},(_,index)=>({
        day:index+1,windows:base.calendar.week.find(row=>row.day===index+1)?.windows??[]}))},
      title:clip(base.title+' — operating review',390),
      reviewedBy:'Native service receiving operator',
      note:'Original service desk revision for receiving case '+caseId+'.'};
    const draftNote='Unfinished next-period service review for case '+caseId+
      '. The effective start is still awaiting the operator’s entry.';
    state.plan={
      originalCaseRevision:initial.item.revision,originalReportSha256:original.sha256,
      baseTermsRevision:base.revision,baseTermsSha256:base.sha256,
      termsRevision:base.revision+1,terms,
      selection:{termsId:base.id,termsRevision:base.revision+1,from:period.from,through:period.through,
        asOf:cutoff,captureSha256s:[...captureIds],exclusionIds:[...original.preview.selection.exclusionIds]},
      month:period.month,reportReviewedBy:'Native service receiving operator',
      reportNote:'Monthly operating review retained through the original service desk for case '+caseId+
        ' from capture '+cutoff+'.',
      draft:{note:draftNote,effectiveFrom:''},
    };
    await retainJSON('baselineCase','source-original-case.json',initial.item);
    await retainJSON('baselineService','source-original-service.json',initial.service);
    await phase('original_case',{revision:initial.item.revision,reportId,reportSha256:original.sha256,
      captureSha256s:captures.map(row=>row.sha256),termsId:base.id,termsRevision:base.revision});
  }
  const plan=state.plan;
  const baseline=JSON.parse(await fs.readFile(state.artifacts.baselineService.path,'utf8'));
  retainedHistory(baseline,initial.service);
  assert(initial.service.reports.some(row=>row.id===reportId&&row.sha256===plan.originalReportSha256),
    'The original native report no longer matches this browser operation.');

  const page=await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  const currentErrors={browser:[],console:[],requests:[],http:[]};
  const onPageError=error=>currentErrors.browser.push({at:now(),message:error.message,stack:error.stack??null});
  const onConsole=message=>{if(message.type()==='error')currentErrors.console.push({at:now(),message:message.text(),location:message.location()});};
  const onRequestFailed=request=>currentErrors.requests.push({at:now(),method:request.method(),url:request.url(),error:request.failure()?.errorText??null});
  const onResponse=response=>{
    if(response.status()>=400&&new URL(response.url()).pathname!=='/favicon.ico')
      currentErrors.http.push({at:now(),status:response.status(),url:response.url()});
  };
  const onDialog=dialog=>{if(dialog.type()==='beforeunload')void dialog.accept();else void dialog.dismiss();};
  page.on('pageerror',onPageError);page.on('console',onConsole);
  page.on('requestfailed',onRequestFailed);page.on('response',onResponse);page.on('dialog',onDialog);
  let activeOrigin=null;
  const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const waitService=()=>page.waitForFunction(()=>{
    const root=document.querySelector('#service-operations');
    return root?.dataset.ready==='true'&&root.getAttribute('aria-busy')==='false';
  });
  async function serviceMessage(prefix){
    await page.waitForFunction(prefix=>{
      const root=document.querySelector('#service-operations'),status=document.querySelector('#service-status');
      return root?.dataset.ready==='true'&&root.getAttribute('aria-busy')==='false'&&
        (status?.textContent??'').startsWith(prefix);
    },prefix);
  }
  async function openCase(origin,readback,{reload=false}={}){
    const item=readback.item;
    if(reload&&activeOrigin===origin)await page.reload({waitUntil:'domcontentloaded'});
    else await page.goto(origin,{waitUntil:'domcontentloaded'});
    activeOrigin=origin;
    await page.locator('#case-search').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#case-save')?.disabled===false);
    await page.locator('#case-search').fill(item.name);
    await page.locator('#case-filter-status').selectOption(item.metadata.status);
    const listed=page.waitForResponse(response=>{
      const url=new URL(response.url());
      return url.origin===origin&&url.pathname==='/api/cases'&&response.request().method()==='GET'&&
        url.searchParams.get('q')===item.name&&url.searchParams.get('status')===item.metadata.status;
    });
    await page.locator('[aria-label="Find merchant cases"] button[type="submit"]').click();
    const listResponse=await listed,list=await listResponse.json();
    assert(listResponse.ok()&&list.enabled&&Array.isArray(list.cases),'The original browser case list did not open.');
    const index=list.cases.findIndex(row=>row.id===caseId);
    assert(index>=0,'The exact original case is absent from its filtered browser list.');
    await frames();
    const buttons=page.locator('[aria-label="Saved merchant cases"] button.case-link');
    assert(await buttons.count()===list.cases.length,'The rendered case list differs from the original list response.');
    for(let i=0;i<list.cases.length;i++)
      assert((await buttons.nth(i).textContent())===list.cases[i].name,'The rendered original case order changed before selection.');
    const opened=page.waitForResponse(response=>new URL(response.url()).origin===origin&&
      new URL(response.url()).pathname==='/api/cases/'+caseId&&response.request().method()==='GET');
    await buttons.nth(index).click();
    const opening=await opened,body=await opening.json();
    assert(opening.ok()&&body.id===caseId&&body.revision===item.revision,
      'The browser selected a different original case revision.');
    await page.waitForFunction(title=>{
      const status=document.querySelector('#case-status'),button=document.querySelector('#case-save');
      return document.querySelector('#case-current-title')?.textContent==='Current case · '+title&&
        (status?.textContent??'').startsWith('Case opened.')&&button?.disabled===false&&
        document.querySelector('.case-editor')?.dataset.dirty==='false';
    },item.name);
    await waitService();
    const terms=await page.locator('#service-terms-edition option').evaluateAll(rows=>rows.map(row=>row.value));
    assert(terms.includes(plan.terms.id+':'+plan.baseTermsRevision),'The browser omitted the original retained service edition.');
    assert(await page.locator('[data-service-report-id="'+reportId+'"]').count()===1,
      'The browser omitted the original native report from the case.');
  }
  async function saveCase(label){
    await waitService();
    const responsePromise=page.waitForResponse(response=>new URL(response.url()).origin===activeOrigin&&
      new URL(response.url()).pathname==='/api/cases'&&response.request().method()==='POST');
    await page.locator('#case-save').click();
    const response=await responsePromise,body=await response.json();
    assert(response.ok()&&body.case?.id===caseId,
      label+' did not save the selected original case: HTTP '+response.status()+' '+(body.detail??body.error??''));
    await page.waitForFunction(()=>document.querySelector('#case-save')?.disabled===false&&
      document.querySelector('.case-editor')?.dataset.dirty==='false'&&
      (document.querySelector('#case-status')?.textContent??'').startsWith('Case saved.'));
    await waitService();
    const durable=await readCase(activeOrigin);
    assert(durable.item.revision===body.case.revision,label+' saved a different current original case revision.');
    retainedHistory(baseline,durable.service);
    return durable;
  }
  async function selectedReport(id){
    const selected=await page.locator('#service-saved-report').evaluate((node,id)=>{
      if(node.hidden)return false;
      return [...node.querySelectorAll('dd')].some(row=>row.textContent===id);
    },id);
    if(!selected){
      await page.locator('[data-service-report-id="'+id+'"]').click();
      await page.locator('#service-report-json').waitFor({state:'visible'});
    }
    const matches=await page.locator('#service-saved-report').evaluate((node,id)=>
      !node.hidden&&[...node.querySelectorAll('dd')].some(row=>row.textContent===id),id);
    assert(matches,'The actual retained report did not open in the browser.');
  }
  async function setChoices(selector,attribute,selected){
    const inputs=page.locator(selector);
    const actual=await inputs.evaluateAll((rows,attribute)=>rows.map(row=>({value:row.getAttribute(attribute),disabled:row.disabled})),attribute);
    for(const wanted of selected)assert(actual.some(row=>row.value===wanted&&!row.disabled),
      'The original report selection is unavailable in this browser: '+wanted);
    for(let i=0;i<actual.length;i++){
      if(actual[i].disabled)continue;
      await inputs.nth(i).setChecked(selected.includes(actual[i].value));
    }
  }
  async function download(button,key,filename,contentType){
    const downloaded=page.waitForEvent('download');
    await page.locator(button).click();
    const received=await downloaded,failure=await received.failure();
    assert(!failure,'The original browser download failed: '+failure);
    const temporary=path.join(root,'.download-'+randomUUID());
    await received.saveAs(temporary);
    const bytes=await fs.readFile(temporary);
    const entry=await artifact(key,filename,bytes,contentType);
    entry.originalFilename=received.suggestedFilename();
    await fs.unlink(temporary);
    return {bytes,entry};
  }
  async function downloads(prefix,record,report){
    await selectedReport(report.id);
    const reportJSON=await download('#service-report-json',prefix+'ReportJSON',prefix+'-report.json','application/json');
    const csv=await download('#service-report-csv',prefix+'ReportCSV',prefix+'-incidents.csv','text/csv');
    const html=await download('#service-report-html',prefix+'ReportHTML',prefix+'-report.html','text/html');
    const complete=await download('#service-record-json',prefix+'ServiceJSON',prefix+'-complete-service.json','application/json');
    assert(equal(JSON.parse(reportJSON.bytes.toString('utf8')),report),'The downloaded report is not the complete retained report.');
    assert(csv.bytes.equals(Buffer.from(serviceReportCsv(report))),'The downloaded incident CSV differs from the original complete native report.');
    assert(html.bytes.equals(Buffer.from(renderServiceReport(report))),'The downloaded printable report differs from the original complete native report.');
    const decoded=await validateServiceRecord(JSON.parse(complete.bytes.toString('utf8')));
    assert(equal(decoded,record),'The downloaded complete service record differs from the original saved case.');
    return {reportId:report.id,reportSha256:report.sha256,
      json:reportJSON.entry,csv:csv.entry,html:html.entry,service:complete.entry};
  }
  async function screenshots(prefix){
    await page.setViewportSize({width:1440,height:1000});
    await frames();
    await artifact(prefix+'Desktop',prefix+'-desktop.png',await page.screenshot({fullPage:true}),'image/png');
    await page.setViewportSize({width:390,height:844});
    await frames();
    await artifact(prefix+'Mobile',prefix+'-mobile.png',await page.screenshot({fullPage:true}),'image/png');
    const layout=await page.locator('#service-operations').evaluate(root=>({
      viewport:window.innerWidth,rootWidth:root.getBoundingClientRect().width,
      documentWidth:document.documentElement.scrollWidth,
      ready:root.dataset.ready,busy:root.getAttribute('aria-busy'),
      title:root.querySelector('h2')?.textContent??null,
    }));
    await page.setViewportSize({width:1440,height:1000});
    assert(layout.ready==='true'&&layout.busy==='false','The mobile service view did not complete its original render.');
    return layout;
  }
  async function verifyDraft(record){
    assert(record.draft?.terms?.note===plan.draft.note&&record.draft.terms.effectiveFrom==='',
      'The incomplete original service form did not survive the saved case.');
    assert(await page.locator('#service-terms-note').inputValue()===plan.draft.note&&
      await page.locator('#service-terms-from').inputValue()==='',
      'The browser did not reopen the original unfinished service values.');
    assert(await page.locator('#service-report-month').inputValue()===plan.month,'The selected report month changed on reopen.');
    const cutoff=await page.locator('#service-report-as-of').inputValue();
    assert(new Date(cutoff+'Z').toISOString()===plan.selection.asOf,'The actual retained report cutoff changed on reopen.');
  }

  try{
    await page.setViewportSize({width:1440,height:1000});
    await openCase(sourceOrigin,initial);
    let source=initial,edition=findEdition(source.service,plan);
    if(!edition){
      const latest=source.service.terms.filter(row=>row.id===plan.terms.id).sort((a,b)=>a.revision-b.revision).at(-1);
      assert(latest?.revision===plan.baseTermsRevision&&latest.sha256===plan.baseTermsSha256,
        'The original service agreement advanced before its prepared browser revision.');
      await page.locator('#service-terms-edition').selectOption(plan.terms.id+':'+plan.baseTermsRevision);
      await page.locator('#service-terms-open').click();
      await page.locator('#service-terms-title').fill(plan.terms.title);
      await page.locator('#service-terms-reviewer').fill(plan.terms.reviewedBy);
      await page.locator('#service-terms-note').fill(plan.terms.note);
      await page.locator('#service-terms-save').click();
      await serviceMessage('Retained service edition '+plan.termsRevision+'.');
      source=await saveCase('Browser service edition');
      edition=findEdition(source.service,plan);
      assert(edition,'The original case did not retain the browser’s service edition.');
    }
    await phase('service_edition',{caseRevision:source.item.revision,termsId:edition.id,
      termsRevision:edition.revision,termsSha256:edition.sha256});
    let report=findReport(source.service,plan);
    if(!report){
      await page.locator('#service-report-terms').selectOption(plan.terms.id+':'+plan.termsRevision);
      await page.locator('#service-report-month').fill(plan.month);
      await page.locator('#service-report-as-of').fill(plan.selection.asOf.slice(0,-1));
      await setChoices('#service-report-captures [data-service-capture]','data-service-capture',plan.selection.captureSha256s);
      await setChoices('#service-report-exclusions [data-service-exclusion]','data-service-exclusion',plan.selection.exclusionIds);
      await page.locator('#service-report-preview').click();
      await serviceMessage('Review the complete month and its ');
      await page.locator('#service-report-retain-form').waitFor({state:'visible'});
      await page.locator('#service-report-reviewer').fill(plan.reportReviewedBy);
      await page.locator('#service-report-note').fill(plan.reportNote);
      await page.locator('#service-report-retain').click();
      await serviceMessage('Retained the reviewed monthly report.');
      source=await saveCase('Browser monthly service report');
      report=findReport(source.service,plan);
      assert(report,'The original case did not retain the reviewed browser report.');
    }
    await phase('monthly_report',{caseRevision:source.item.revision,reportId:report.id,reportSha256:report.sha256,
      previewSha256:report.preview.previewSha256,selection:report.preview.selection,summary:report.preview.summary});
    // Deliberately leave one required future-edition field unfinished. Save case
    // preserves it as a draft; the immutable agreed editions remain complete.
    await selectedReport(report.id);
    if(source.service.draft?.terms?.note!==plan.draft.note||source.service.draft?.terms?.effectiveFrom!==''){
      await page.locator('#service-terms-note').fill(plan.draft.note);
      await page.locator('#service-terms-from').fill('');
      source=await saveCase('Unfinished service form');
    }else if(await page.locator('.case-editor').getAttribute('data-dirty')==='true'){
      source=await saveCase('Retained report selection');
    }
    await verifyDraft(source.service);
    await retainJSON('sourceCase','source-complete-case.json',source.item);
    await retainJSON('sourceService','source-complete-service.json',source.service);
    await phase('unfinished_draft',{caseRevision:source.item.revision,termsDraft:plan.draft,
      retainedTerms:source.service.terms.length,retainedReports:source.service.reports.length});
    const exported=await downloads('source',source.service,report);
    await phase('source_downloads',exported);
    source=await readCase(sourceOrigin);
    await openCase(sourceOrigin,source,{reload:true});
    await verifyDraft(source.service);
    const reopenedReport=findReport(source.service,plan);
    assert(reopenedReport?.id===report.id,'The saved browser report identity changed on reload.');
    await selectedReport(report.id);
    assert(await page.locator('.case-editor').getAttribute('data-dirty')==='false',
      'Reopening the saved selected report unexpectedly altered its original case.');
    const sourceLayout=await screenshots('source');
    await phase('source_reopen',{caseRevision:source.item.revision,reportId:report.id,mobile:sourceLayout});

    // Readback first resolves an already accepted original transfer after a lost
    // response, so a rerun does not create an unnecessary receiving case version.
    let receiving=await readCase(receivingOrigin);
    const sameCase=()=>receiving.item.workspaceText===source.item.workspaceText&&
      receiving.item.supportText===source.item.supportText&&equal(receiving.item.metadata,source.item.metadata);
    if(!sameCase()){
      state.transferIntent={at:now(),caseId,sourceRevision:source.item.revision,
        workspaceSha256:digest(source.item.workspaceText),supportSha256:digest(source.item.supportText??''),
        receivingRevision:receiving.item.revision};
      await checkpoint();
      const transferred=await transfer();
      assert(transferred?.caseId===caseId&&typeof transferred.revision==='string',
        'The original transfer did not return the same saved case identity.');
      receiving=await readCase(receivingOrigin);
      assert(receiving.item.revision===transferred.revision,'The receiving readback differs from the accepted original transfer.');
    }
    assert(sameCase(),'The receiving store did not retain the complete original workspace, support bytes and metadata.');
    assert(equal(receiving.service,source.service),'The complete received service record differs from the original saved record.');
    retainedHistory(baseline,receiving.service);
    await retainJSON('receivingCase','receiving-complete-case.json',receiving.item);
    await phase('complete_case_transfer',{caseId,sourceRevision:source.item.revision,receivingRevision:receiving.item.revision,
      workspaceSha256:digest(source.item.workspaceText),supportSha256:digest(source.item.supportText??'')});
    await openCase(receivingOrigin,receiving);
    await verifyDraft(receiving.service);
    const receivedEdition=findEdition(receiving.service,plan),receivedReport=findReport(receiving.service,plan);
    assert(receivedEdition.sha256===edition.sha256&&receivedReport?.id===report.id&&receivedReport.sha256===report.sha256,
      'The received immutable terms/report identities differ from the original case.');
    const receivedExports=await downloads('receiving',receiving.service,receivedReport);
    for(const kind of ['ReportJSON','ReportCSV','ReportHTML','ServiceJSON'])
      assert(state.artifacts['source'+kind].sha256===state.artifacts['receiving'+kind].sha256,
        'The complete receiving download differs from the original source '+kind+'.');
    const receiverLayout=await screenshots('receiving');
    await phase('receiving_reopen',{caseId,caseRevision:receiving.item.revision,reportId:receivedReport.id,
      termsSha256:receivedEdition.sha256,retainedCaptures:receiving.service.captures.length,
      retainedExclusions:receiving.service.exclusions.length,retainedReports:receiving.service.reports.length,
      downloads:receivedExports,mobile:receiverLayout});
    assert(!currentErrors.browser.length,'The actual service browser emitted an uncaught page error.');
    assert(!currentErrors.http.length,'The actual service browser returned an unsuccessful application response.');
    state.completedAt=now();
    state.result={caseId,originalReportId:reportId,reportId:report.id,termsId:edition.id,termsRevision:edition.revision,
      sourceRevision:source.item.revision,receivingRevision:receiving.item.revision,
      sourceServiceSha256:digest(canonical(source.service)),receivingServiceSha256:digest(canonical(receiving.service)),
      sourceWorkspaceSha256:digest(source.item.workspaceText),receivingWorkspaceSha256:digest(receiving.item.workspaceText)};
    return {...state,checkpointPath,reused:false};
  }catch(error){
    state.lastError={at:now(),message:error.message,stack:error.stack??null,url:page.url()};
    if(!page.isClosed()){
      try{await artifact('failureHTML','browser-last-failure.html',await page.content(),'text/html');}catch{}
      try{await artifact('failureScreenshot','browser-last-failure.png',await page.screenshot(),'image/png');}catch{}
    }
    throw error;
  }finally{
    state.browserErrors.push(...currentErrors.browser);state.consoleErrors.push(...currentErrors.console);
    state.failedRequests.push(...currentErrors.requests);state.httpErrors.push(...currentErrors.http);
    page.off('pageerror',onPageError);page.off('console',onConsole);page.off('requestfailed',onRequestFailed);page.off('response',onResponse);
    await checkpoint();
    // The caller owns the persistent context. Retaining this page avoids closing
    // the final page of single-process Chromium while the native parent continues.
  }
}
