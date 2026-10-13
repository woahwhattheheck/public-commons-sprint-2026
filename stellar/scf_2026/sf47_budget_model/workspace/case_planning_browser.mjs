// MIT. One complete original-case browser continuation; no replacement business writers.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const input=JSON.parse(await readFile(option('--context'),'utf8')),mode=option('--mode')||'operate';
const portfolioMode=mode==='portfolio'||mode==='portfolio-cold';
assert.match(input.caseId,/^operation-[a-f0-9]{32}$/);
assert.match(input.asOfDate,/^\d{4}-\d{2}-\d{2}$/);
const root=resolve(input.directory),out=join(root,portfolioMode?(mode==='portfolio-cold'?'browser-portfolio-cold':'browser-portfolio'):(mode==='cold'?'browser-cold':'browser'));
const exportsDirectory=join(out,'exports');
await mkdir(exportsDirectory,{recursive:true,mode:0o700});
const json=value=>JSON.stringify(value,null,2)+'\n';
const stamp=()=>new Date().toISOString();
const sha=value=>createHash('sha256').update(value).digest('hex');
async function atomic(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});
  const pending=path+'.pending-'+randomUUID();await writeFile(pending,typeof value==='string'||Buffer.isBuffer(value)?value:json(value),{mode:0o600});await rename(pending,path);}
async function exists(path){try{await stat(path);return true;}catch{return false;}}
async function fileIdentity(path){const data=await readFile(path);return {path,bytes:data.length,sha256:sha(data)};}
async function native(path,{binary=false}={}){
  const response=await fetch(input.baseUrl+path,{headers:{Authorization:'Bearer '+input.ownerKey}});
  if(!response.ok)throw new Error('Original native read '+path+' returned '+response.status+': '+(await response.text()).slice(0,1000));
  return binary?Buffer.from(await response.arrayBuffer()):response.json();
}
const progressPath=join(root,portfolioMode?(mode==='portfolio-cold'?'browser-portfolio-cold-progress.json':'browser-portfolio-progress.json'):(mode==='cold'?'browser-cold-progress.json':'browser-progress.json'));
let progress=await exists(progressPath)?JSON.parse(await readFile(progressPath,'utf8')):
  {schema:'stellar-forge.sf47-case-workbook-browser.v1',operationId:input.operationId,caseId:input.caseId,planId:input.planId,asOfDate:input.asOfDate,startedAt:stamp(),phases:{},files:{}};
assert.equal(progress.caseId,input.caseId);assert.equal(progress.planId,input.planId);assert.equal(progress.asOfDate,input.asOfDate);
const saveProgress=()=>atomic(progressPath,progress);
async function phase(name,work){
  if(progress.phases[name]?.complete)return progress.phases[name].result;
  progress.currentPhase=name;progress.phases[name]={...progress.phases[name],startedAt:progress.phases[name]?.startedAt||stamp(),complete:false};
  await saveProgress();process.stdout.write(json({phase:name,state:'running'}));
  const result=await work();progress.phases[name]={...progress.phases[name],complete:true,completedAt:stamp(),result};
  await saveProgress();process.stdout.write(json({phase:name,state:'complete'}));return result;
}
const modulePath=process.env.SF47_PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js';
const chrome=process.env.SF47_CHROMIUM||'/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell';
const {chromium}=await import(pathToFileURL(modulePath).href);
const browser=await chromium.launchPersistentContext(join(root,portfolioMode?'portfolio-browser-profile':(mode==='cold'?'cold-browser-profile':'browser-profile')),{
  executablePath:chrome,headless:true,viewport:{width:1440,height:1000},acceptDownloads:true,
  args:['--no-sandbox','--disable-dev-shm-usage']});
const page=browser.pages()[0]||await browser.newPage();
page.setDefaultTimeout(45000);
const pageErrors=[];
page.on('pageerror',error=>pageErrors.push({at:stamp(),message:error.message}));
page.on('console',message=>{if(message.type()==='error')pageErrors.push({at:stamp(),message:message.text().replaceAll(input.ownerKey,'[private]')});});
let dialogDecision='accept';
page.on('dialog',async dialog=>{if(dialog.type()==='beforeunload'||dialogDecision==='accept')await dialog.accept();else await dialog.dismiss();});
async function waitFor(check,message,timeout=45000){
  const until=Date.now()+timeout;let last;
  while(Date.now()<until){try{const value=await check();if(value)return value;}catch(error){last=error;}
    await new Promise(resolve=>setTimeout(resolve,150));}
  const alerts=await page.locator('#message,[role=alert],[data-amend-error],.calendar-error').allTextContents().catch(()=>[]);
  throw new Error(message+'; '+(last?.message||'')+' '+alerts.filter(Boolean).join(' | '));
}
async function ready(){await page.locator('#workbench').waitFor({state:'visible'});await waitFor(()=>page.locator('#workbench').getAttribute('aria-busy').then(v=>v!=='true'),'Original application is still receiving');}
async function click(selector){const control=typeof selector==='string'?page.locator(selector):selector;
  await waitFor(()=>control.isEnabled(),'The original action is unavailable');await control.click();await ready();}
function labelled(name){return page.getByRole('button',{name,exact:true});}
async function download(action,filename){
  const pending=page.waitForEvent('download',{timeout:120000});await action();const received=await pending;
  const path=join(exportsDirectory,filename);await received.saveAs(path);const result=await fileIdentity(path);
  progress.files[filename]=result;await saveProgress();return result;
}
async function screenshot(filename,viewport={width:1440,height:1000}){
  await page.setViewportSize(viewport);await ready();const path=join(out,filename);await page.screenshot({path,fullPage:true});
  const result=await fileIdentity(path);progress.visualReview??={};
  progress.visualReview[filename]={filename,bytes:result.bytes,sha256:result.sha256,viewport,stage:'CAPTURED_FOR_INTERNAL_REVIEW'};
  await saveProgress();return result;
}
async function openApplication(){
  await page.goto(input.baseUrl+'/#access='+encodeURIComponent(input.ownerKey),{waitUntil:'domcontentloaded'});await ready();
}
async function openCase(tab='overview'){
  if(!(await page.locator('[name=caseSelect]').count()))await click('[data-tab=operations]');
  const choice=page.locator('[name=caseSelect]');await choice.waitFor();
  if(await choice.inputValue()!==input.caseId){await choice.selectOption(input.caseId);await waitFor(()=>choice.inputValue().then(v=>v===input.caseId),'Select original case');}
  const label={overview:'Plan / actual',amendments:'Plan amendments',calendar:'Delivery calendar',completion:'Tranche completion'}[tab];
  const navigation=page.locator('[data-ops-navigation]');
  let candidates=page.locator('[data-ops-tab="'+tab+'"]');
  if(await navigation.count()){
    const browse=navigation.getByRole('button',{name:'Browse sections',exact:true});
    if(await browse.count()&&await browse.isVisible()&&await browse.getAttribute('aria-expanded')!=='true')await click(browse);
    candidates=navigation.locator('[data-nav-section="'+tab+'"]');
    let shown=false;for(const control of await candidates.all())if(await control.isVisible()){shown=true;break;}
    if(!shown){
      const group=navigation.locator('details[data-nav-group]').filter({has:navigation.locator('[data-nav-section="'+tab+'"]')}).first();
      if(await group.count()&&!(await group.evaluate(node=>node.open)))await group.locator('summary').click();
    }
  }
  await waitFor(async()=>{for(const control of await candidates.all())if(await control.isVisible())return control;return null;},'Open original '+(label||tab)+' section').then(click);
}
async function storedCaseDraft(){
  return page.evaluate(async expected=>{
    const {casePlanningBrowserStore}=await import('/case-planning.mjs');
    const session=await (await fetch('/api/staff/session')).json();
    const ownerId=session.principal.id;
    const pointer=sessionStorage.getItem('sf47.case-planning.'+ownerId);
    const rows=await casePlanningBrowserStore.list(ownerId);
    const selected=rows.find(row=>row.id===pointer&&row.caseId===expected.caseId)||
      rows.find(row=>row.id===expected.draftId)||rows.find(row=>row.caseId===expected.caseId&&row.planId===expected.planId);
    return selected?casePlanningBrowserStore.read(selected.id):null;
  },{caseId:input.caseId,planId:input.planId,draftId:progress.draftId});
}
async function amendDrafts(){
  return page.evaluate(async caseId=>{
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('sf47-plan-amendment-drafts-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'id'});
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const db=request.result,r=db.transaction('drafts').objectStore('drafts').getAll();
        r.onsuccess=()=>{db.close();resolve(r.result.filter(row=>row.caseId===caseId));};r.onerror=()=>reject(r.error);};
    });
  },input.caseId);
}
async function settledDraft(predicate=()=>true){return waitFor(async()=>{const value=await storedCaseDraft();return value&&predicate(value)?value:null;},'Receive the complete retained case draft');}
async function openRetainedDraft(){
  if(await page.locator('.case-planning-route').isVisible().catch(()=>false))return;
  await click(labelled('Saved case planning work'));
  await click('[data-case-planning-draft="'+progress.draftId+'"]');
  await page.locator('.case-planning-route').waitFor({state:'visible'});
}
async function selectAmendment(){
  await openRetainedDraft();
  if(!(await page.locator('[data-amend-form]').count()))await click('[data-case-planning-action=amendments]');
  await page.locator('[data-amend-form]').waitFor();
  return waitFor(async()=>{const value=await storedCaseDraft();const rows=await amendDrafts();
    return rows.find(row=>row.planningReturn?.id===value.returnSelection?.id);},'Open the original amendment draft for this exact returned revision');
}
async function receivePendingAmendment(){
  const rows=await amendDrafts(),desk=rows.find(row=>row.id===progress.amendmentDraftId);
  if(desk?.pending)await click('[data-amend-action=retry]');
}
const editWorkbookProgram="import sys,zipfile,xml.etree.ElementTree as ET,json,hashlib,os\nfrom pathlib import Path\narchive=Path(sys.argv[1]);output=Path(sys.argv[2]);plan=json.loads(Path(sys.argv[3]).read_text())\nns={\"m\":\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"}\nwith zipfile.ZipFile(archive) as z:\n raw=z.read(\"planning.xlsx\")\nwith zipfile.ZipFile(__import__(\"io\").BytesIO(raw)) as z:\n files={x.filename:z.read(x) for x in z.infolist()}\nworkbook=ET.fromstring(files[\"xl/workbook.xml\"])\nsheet=next(x for x in workbook.find(\"m:sheets\",ns) if x.attrib[\"name\"]==\"Work packages\")\nrid=sheet.attrib[\"{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id\"]\nrels=ET.fromstring(files[\"xl/_rels/workbook.xml.rels\"])\ntarget=next(x.attrib[\"Target\"] for x in rels if x.attrib[\"Id\"]==rid)\npath=target.lstrip(\"/\") if target.startswith(\"/\") else \"xl/\"+target\nsheetxml=ET.fromstring(files[path])\nshared=[]\nif \"xl/sharedStrings.xml\" in files:\n for si in ET.fromstring(files[\"xl/sharedStrings.xml\"]):shared.append(\"\".join(t.text or \"\" for t in si.findall(\".//m:t\",ns)))\ndef value(cell):\n if cell.attrib.get(\"t\")==\"inlineStr\":return \"\".join(t.text or \"\" for t in cell.findall(\".//m:t\",ns))\n v=cell.find(\"m:v\",ns)\n if v is None:return \"\"\n return shared[int(v.text)] if cell.attrib.get(\"t\")==\"s\" else v.text or \"\"\nrows=sheetxml.find(\"m:sheetData\",ns)\nheaders={__import__(\"re\").sub(r\"\\d\",\"\",c.attrib[\"r\"]):value(c) for c in rows[0]}\nedited=None\nfor row in list(rows)[1:]:\n cells={headers.get(__import__(\"re\").sub(r\"\\d\",\"\",c.attrib[\"r\"])):c for c in row}\n if not all(k in cells for k in (\"id\",\"start_day\",\"end_day\")):continue\n start,end=int(value(cells[\"start_day\"])),int(value(cells[\"end_day\"]))\n if end<=start:continue\n original=value(cells[\"end_day\"]);cell=cells[\"end_day\"]\n for child in list(cell):cell.remove(child)\n cell.attrib[\"t\"]=\"inlineStr\"\n inline=ET.SubElement(cell,\"{\"+ns[\"m\"]+\"}is\");text=ET.SubElement(inline,\"{\"+ns[\"m\"]+\"}t\");text.text=str(end-1)\n edited={\"sheet\":\"Work packages\",\"cell\":cell.attrib[\"r\"],\"costId\":value(cells[\"id\"]),\"field\":\"end_day\",\n         \"before\":original,\"after\":str(end-1),\"reason\":\"Original calendar walkthrough: review one earlier planned package finish while retaining hours, prices, assignments and actual payment records.\"}\n break\nif not edited:raise ValueError(\"The original plan has no multi-day package for this receiving edit; choose an explicit complete workbook edit.\")\nfiles[path]=ET.tostring(sheetxml,encoding=\"utf-8\",xml_declaration=True)\noutput.parent.mkdir(parents=True,exist_ok=True)\nwith zipfile.ZipFile(output,\"w\",zipfile.ZIP_DEFLATED) as z:\n for name,data in files.items():z.writestr(name,data)\nos.chmod(output,0o600)\nprint(json.dumps({\"edit\":edited,\"originalWorkbookSha256\":hashlib.sha256(raw).hexdigest(),\"returnedWorkbookSha256\":hashlib.sha256(output.read_bytes()).hexdigest(),\"bytes\":output.stat().st_size}))\n";

function agendaComparable(report){
  const copy=structuredClone(report);delete copy.generatedAt;delete copy.sha256;
  for(const item of copy.cases){delete item.calendar.generatedAt;delete item.calendar.sha256;}
  return copy;
}
async function operateDeliveryAgenda(prefix){
  const directory=(await native('/api/operations')).cases;
  const received=directory.find(row=>row.id!==input.caseId&&row.name==='SCF retained grant case - calendar receiving');
  assert.ok(received,'Use the original calendar handover with its retained receiving case and operated walkthrough.');
  const caseIds=[input.caseId,received.id],query=new URLSearchParams({asOfDate:input.asOfDate});
  for(const id of caseIds)query.append('caseId',id);
  const report=await native('/api/operations/delivery-agenda?'+query);
  assert.deepEqual(report.selection.caseIds,caseIds);assert.equal(report.asOfDate,input.asOfDate);
  const calendars={};
  for(const id of caseIds){
    calendars[id]=await native('/api/operations/'+id+'/delivery-calendar?asOfDate='+input.asOfDate);
    for(const collection of ['entries','undated'])assert.deepEqual(
      report[collection].filter(row=>row.caseId===id).sort((a,b)=>a.position-b.position).map(row=>row.entry),
      calendars[id][collection]);
  }
  const originalDraft=await storedCaseDraft();
  async function openAgenda({select=false}={}){
    await click('[data-tab=agenda]');
    const root=page.locator('.delivery-agenda');await root.waitFor();
    await waitFor(()=>root.getAttribute('aria-busy').then(value=>value!=='true'),'Original multi-case agenda');
    if(select){
      await click('[data-agenda-action=clear-cases]');
      for(const id of caseIds)await page.locator('[data-agenda-case="'+id+'"]').check();
      await page.locator('[data-agenda-field=asOfDate]').fill(input.asOfDate);
      await page.locator('[data-agenda-field=asOfDate]').dispatchEvent('change');
      await click('[data-agenda-action=open]');
    }
    await waitFor(()=>page.locator('.delivery-agenda-shown').textContent().then(value=>value.includes(input.asOfDate)&&value.includes('2 original cases')),'Selected original agenda and clock');
    await waitFor(()=>root.getAttribute('aria-busy').then(value=>value!=='true'),'Complete original agenda');
    return root;
  }
  await page.setViewportSize({width:1440,height:1000});await openAgenda({select:true});
  await click('[data-agenda-action=clear-filters]');
  await page.locator('[data-agenda-field=filterCase]').selectOption(input.caseId);
  await page.locator('[data-agenda-field=kind]').selectOption('PAYMENT');
  const exported=await download(()=>click('[data-agenda-action=export-json]'),prefix+'-all-cases.json');
  const exportedReport=JSON.parse(await readFile(exported.path,'utf8'));
  assert.deepEqual(agendaComparable(exportedReport),agendaComparable(report));
  await download(()=>click('[data-agenda-action=export-csv]'),prefix+'-all-cases.csv');
  const exportedIcs=await download(()=>click('[data-agenda-action=export-ics]'),prefix+'-all-cases.ics');
  const combined=(await readFile(exportedIcs.path,'utf8')).replace(/\r\n[ \t]/g,'');
  const receivedUids=[...combined.matchAll(/^UID:(.*)$/gm)].map(match=>match[1].trim()).sort();
  const originalUids=[];
  for(const id of caseIds){
    const raw=await native('/api/operations/'+id+'/delivery-calendar/export.ics?asOfDate='+input.asOfDate,{binary:true});
    const source=raw.toString('utf8').replace(/\r\n[ \t]/g,'');
    originalUids.push(...[...source.matchAll(/^UID:(.*)$/gm)].map(match=>match[1].trim()));
  }
  assert.deepEqual(receivedUids,originalUids.sort());
  const cash=report.entries.find(row=>row.caseId===input.caseId&&row.entry.kind==='GRANT_RECEIPT');
  assert.ok(cash,'Original operated case retains its grant receipt.');
  await page.locator('[data-agenda-field=showInactive]').check();
  await click(page.locator('[data-agenda-action=source][data-agenda-id="'+cash.id+'"]').first());
  await page.locator('[name=caseSelect]').waitFor();assert.equal(await page.locator('[name=caseSelect]').inputValue(),input.caseId);
  await waitFor(()=>page.locator('.cash-account-desk').textContent().then(value=>value.includes(cash.entry.sourceId)),'Open the actual original agenda payment');
  await openAgenda();await click('[data-agenda-action=clear-filters]');
  await click('[data-agenda-action=view-month]');await click('[data-agenda-action=reviewed-month]');
  await screenshot(prefix+'-month-desktop.png');
  await page.setViewportSize({width:390,height:844});await screenshot(prefix+'-month-phone.png',{width:390,height:844});
  await click('[data-agenda-action=view-agenda]');
  await page.locator('[data-agenda-field=filterCase]').selectOption(input.caseId);
  await page.locator('[data-agenda-field=kind]').selectOption('DEADLINE');
  await page.locator('[data-agenda-field=showInactive]').check();
  const deadline=report.entries.find(row=>row.caseId===input.caseId&&row.entry.kind==='SUBMISSION_DEADLINE'&&row.entry.active)||
    report.entries.find(row=>row.caseId===input.caseId&&row.entry.kind==='SUBMISSION_DEADLINE');
  assert.ok(deadline);await click(page.locator('[data-agenda-action=select][data-agenda-id="'+deadline.id+'"]').first());
  await screenshot(prefix+'-entry-phone.png',{width:390,height:844});
  await click(page.locator('.delivery-agenda-detail [data-agenda-action=source]'));
  await page.locator('[name=completionAsOfDate]').waitFor();
  assert.equal(await page.locator('[name=caseSelect]').inputValue(),input.caseId);
  assert.equal(await page.locator('[name=completionAsOfDate]').inputValue(),input.asOfDate);
  assert.equal(await page.locator('[name=completionReceipt]').inputValue(),deadline.entry.sourceId);
  assert.equal(Number(await page.locator('[name=completionTranche]').inputValue()),deadline.entry.tranche);
  await openAgenda();
  await click(page.locator('.delivery-agenda-detail [data-agenda-action=open-case]'));
  await page.locator('[data-calendar-setting=asOfDate]').waitFor();
  assert.equal(await page.locator('[name=caseSelect]').inputValue(),input.caseId);
  assert.equal(await page.locator('[data-calendar-setting=asOfDate]').inputValue(),input.asOfDate);
  if(originalDraft){
    const current=await settledDraft(value=>value.id===originalDraft.id);
    assert.deepEqual(current.caseBasis,originalDraft.caseBasis);
    assert.deepEqual(current.savedSelection,originalDraft.savedSelection);
    assert.deepEqual(current.draft,originalDraft.draft);
    assert.equal(current.asOfDate,originalDraft.asOfDate);
  }
  await openAgenda();await click('[data-agenda-action=clear-filters]');
  await page.reload({waitUntil:'domcontentloaded'});await ready();
  await openAgenda();
  for(const id of caseIds)assert.equal(await page.locator('[data-agenda-case="'+id+'"]').isChecked(),true);
  assert.equal(await page.locator('[data-agenda-field=asOfDate]').inputValue(),input.asOfDate);
  await screenshot(prefix+'-agenda-phone.png',{width:390,height:844});
  await screenshot(prefix+'-agenda-desktop.png');
  await atomic(join(out,prefix+'-native.json'),report);
  await openCase('completion');
  return {selection:report.selection,entries:report.entries.length,undated:report.undated.length,
    nativeRowsUnchanged:true,originalUids:receivedUids.length,completeExportsWithDisplayFilters:true,
    receiptId:deadline.entry.sourceId,tranche:deadline.entry.tranche,planningDraftPreserved:originalDraft?.id||null};
}

try{
  await openApplication();
  if(portfolioMode){
    const {operatePortfolioWorkingCopies}=await import('./portfolio-working-copies-browser.mjs');
    const result=await operatePortfolioWorkingCopies({page,browser,input,out,progress,phase,saveProgress,native,screenshot,atomic,fileIdentity,mode});
    result.pageErrors=pageErrors;
    await atomic(join(root,mode==='portfolio-cold'?'browser-portfolio-cold-result.json':'browser-portfolio-result.json'),result);
  }else if(mode==='cold'){
    await phase('cold-original-case',async()=>{
      const actual=await native('/api/operations/'+input.caseId);
      assert.equal(actual.plan.revision,input.selectedRevision);assert.equal(actual.plan.contentSha256,input.selectedContentSha256);
      await openCase('calendar');await page.locator('[data-calendar-setting=asOfDate]').fill(input.asOfDate);
      await page.locator('[data-calendar-setting=asOfDate]').dispatchEvent('change');
      await waitFor(()=>page.locator('.calendar-source').textContent().then(v=>v.includes(input.asOfDate)),'Original cold calendar date');
      return {caseId:actual.program.id,version:actual.program.version,planId:actual.plan.id,revision:actual.plan.revision,contentSha256:actual.plan.contentSha256};
    });
    await phase('cold-working-draft-reopen',async()=>{
      const chooser=page.waitForEvent('filechooser');await click(labelled('Open case planning draft'));
      await (await chooser).setFiles(input.workingDraft);await page.locator('.case-planning-route').waitFor({state:'visible'});
      const draft=await settledDraft(value=>value.savedSelection?.revision===input.selectedRevision);
      assert.equal(draft.savedSelection.contentSha256,input.selectedContentSha256);assert.equal(draft.caseBasis.id,input.caseId);
      await screenshot('cold-planning-desktop.png');return {draftId:draft.id,caseId:draft.caseBasis.id,revision:draft.savedSelection.revision};
    });
    await phase('cold-calendar-and-completion',async()=>{
      await openCase('calendar');await page.locator('[data-calendar-setting=asOfDate]').fill(input.asOfDate);
      await page.locator('[data-calendar-setting=asOfDate]').dispatchEvent('change');
      await waitFor(()=>page.locator('.calendar-source').textContent().then(v=>v.includes(input.asOfDate)),'Cold selected date');
      await screenshot('cold-calendar-phone.png',{width:390,height:844});
      await click('[data-calendar-action=completion]');await page.locator('[name=completionAsOfDate]').waitFor();
      assert.equal(await page.locator('[name=completionAsOfDate]').inputValue(),input.asOfDate);
      await screenshot('cold-completion-phone.png',{width:390,height:844});
      return {asOfDate:input.asOfDate};
    });
    await phase('cold-complete-multi-case-agenda',()=>operateDeliveryAgenda('cold-delivery-agenda'));
    const result={schema:progress.schema,operationId:input.operationId,caseId:input.caseId,planId:input.planId,
      savedRevision:input.selectedRevision,savedContentSha256:input.selectedContentSha256,asOfDate:input.asOfDate,
      completedAt:stamp(),phases:progress.phases,files:progress.files,visualReview:progress.visualReview||{},pageErrors};
    await atomic(join(root,'browser-cold-result.json'),result);
  }else{
    await phase('open-original-case-and-clock',async()=>{
      const before=await native('/api/operations/'+input.caseId),plan=await native('/api/plans/'+input.planId);
      assert.equal(before.program.mode,'WALKTHROUGH');assert.equal(before.program.planId,input.planId);
      await atomic(join(out,'case-before.json'),before);await atomic(join(out,'plan-before.json'),plan);
      await openCase('calendar');
      await page.locator('[data-calendar-setting=asOfDate]').fill(input.asOfDate);
      await page.locator('[data-calendar-setting=asOfDate]').dispatchEvent('change');
      await waitFor(()=>page.locator('.calendar-source').textContent().then(v=>v.includes(input.asOfDate)),'Original calendar clock');
      const calendar=await native('/api/operations/'+input.caseId+'/delivery-calendar?asOfDate='+input.asOfDate);
      await atomic(join(out,'calendar-before.json'),calendar);
      await screenshot('original-calendar-desktop.png');
      return {caseId:before.program.id,caseVersion:before.program.version,planId:plan.id,revision:plan.revision,
        contentSha256:plan.contentSha256,asOfDate:calendar.asOfDate,dated:calendar.entries.length,undated:calendar.undated.length};
    });
    await phase('open-complete-case-planning',async()=>{
      await openCase('calendar');await click(labelled('Edit plan and workbook for this case'));
      const draft=await settledDraft(value=>value.tab==='source-tables');
      progress.draftId=draft.id;await saveProgress();
      assert.equal(draft.caseBasis.id,input.caseId);assert.equal(draft.asOfDate,input.asOfDate);
      if(await (labelled('Create source tables from saved plan')).count())await click(labelled('Create source tables from saved plan'));
      return {draftId:draft.id,planRevision:draft.plan.revision,caseVersion:draft.caseBasis.version};
    });
    progress.draftId=progress.draftId||progress.phases['open-complete-case-planning'].result.draftId;
    await openRetainedDraft();
    if(!progress.phases['calculate-and-apply-complete-workbook']?.complete&&!(await storedCaseDraft())?.pending)await click('[data-case-planning-action=planning]');
    await phase('export-original-complete-workbook',async()=>{
      await click(labelled('Export saved plan workbook'));
      const file=await download(()=>click(labelled('Download complete handover again')),'original-planning-workbook-handover.zip');
      await click(labelled('Use exported source project'));
      const draft=await settledDraft(value=>Boolean(value.draft.planning.sourceTables));
      await atomic(join(out,'exported-source-draft.json'),draft);
      return file;
    });
    const returnedPath=join(exportsDirectory,'returned-planning.xlsx');
    await phase('edit-original-workbook',async()=>{
      const original=progress.phases['export-original-complete-workbook'].result.path;
      const result=JSON.parse(execFileSync(input.python||'python3',['-c',editWorkbookProgram,original,returnedPath,join(out,'plan-before.json')],{encoding:'utf8',timeout:60000}));
      await atomic(join(exportsDirectory,'returned-workbook-edit.json'),result);return result;
    });
    await phase('receive-and-review-all-workbook-tables',async()=>{
      const edit=progress.phases['edit-original-workbook'].result;
      const draft=await storedCaseDraft();
      const already=JSON.stringify(draft.draft.planning.sourceTables||{}).includes(edit.returnedWorkbookSha256);
      if(!already){
        const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Receive an edited workbook$/})}).first();
        if(!(await details.getAttribute('open')))await details.locator('summary').click();
        await page.getByLabel('Returned workbook review note',{exact:true}).fill(edit.edit.reason);
        await page.getByLabel('Returned workbook review note',{exact:true}).dispatchEvent('change');
        const chooser=page.waitForEvent('filechooser');await click(labelled('Receive returned workbook'));
        await (await chooser).setFiles(returnedPath);
        await settledDraft(value=>JSON.stringify(value.draft.planning.sourceTables||{}).includes(edit.returnedWorkbookSha256));
      }
      for(const name of ['Work packages','Milestones','Contributors','Assignments']){
        await click(labelled(name+' · source retained'));
        await click(labelled('Review current table mapping'));
      }
      const project=await download(()=>click(labelled('Download source project')),'reviewed-returned-source-project.json');
      await screenshot('reviewed-workbook-desktop.png');
      return {returnedWorkbookSha256:edit.returnedWorkbookSha256,roles:['packages','milestones','contributors','assignments'],project};
    });
    await phase('calculate-and-apply-complete-workbook',async()=>{
      const draft=await storedCaseDraft(),edit=progress.phases['edit-original-workbook'].result.edit;
      const row=draft.draft.scenario.future_costs.find(item=>item.id===edit.costId);
      if(String(row?.end_day)!==edit.after){
        await click(labelled('Calculate native preview'));
        await page.getByLabel('Source-import review note',{exact:true}).waitFor();
        await download(()=>click(labelled('Download complete native preview')),'complete-workbook-native-preview.json');
        await page.getByLabel('Source-import review note',{exact:true}).fill(edit.reason);
        await page.getByLabel('Source-import review note',{exact:true}).dispatchEvent('change');
        await page.getByLabel('I have reviewed the complete native result and these exact changes.',{exact:true}).check();
        await click(labelled('Apply reviewed changes to working plan'));
      }
      await page.locator('#change-note').fill(edit.reason);await page.locator('#change-note').dispatchEvent('input');
      const applied=await settledDraft(value=>value.dirty&&String(value.draft.scenario.future_costs.find(row=>row.id===edit.costId)?.end_day)===edit.after&&value.note===edit.reason);
      await download(()=>click('[data-case-planning-action=export]'),'case-planning-before-save.json');
      const sourceBefore=JSON.stringify(applied.draft.planning.sourceTables);
      await page.reload({waitUntil:'domcontentloaded'});await ready();
      const reopened=await settledDraft(value=>value.id===progress.draftId&&value.dirty);
      assert.equal(JSON.stringify(reopened.draft.planning.sourceTables),sourceBefore);assert.equal(reopened.note,edit.reason);
      return {draftId:applied.id,note:applied.note,costId:edit.costId,plannedFinish:edit.after,sourceProjectSha256:sha(sourceBefore),reopened:true};
    });
    await phase('receive-original-save-after-lost-response',async()=>{
      let draft=await storedCaseDraft();
      const requestPath=join(out,'original-save-request.json'),responsePath=join(out,'original-save-response.json');
      if(!draft.pending&&draft.dirty){
        const routePattern='**/api/plans/'+input.planId+'/save';
        await page.route(routePattern,async route=>{
          const body=route.request().postDataJSON();await atomic(requestPath,body);
          const response=await route.fetch();const raw=await response.body();
          await atomic(responsePath,raw);
          await route.abort('failed');
        },{times:1});
        await click('[data-action=save]');
        draft=await settledDraft(value=>Boolean(value.pending));
        await page.unroute(routePattern);
      }
      if(draft.pending){
        const pending=draft.pending.body;
        if(await exists(requestPath))assert.deepEqual(pending,JSON.parse(await readFile(requestPath,'utf8')));
        else await atomic(requestPath,pending);
        await page.reload({waitUntil:'domcontentloaded'});await ready();
        const reopened=await settledDraft(value=>Boolean(value.pending));
        assert.deepEqual(reopened.pending.body,pending);
        await click('[data-case-planning-action=receive]');
        draft=await settledDraft(value=>!value.pending&&!value.dirty&&Boolean(value.savedSelection));
      }
      assert.equal(draft.dirty,false);assert.ok(draft.savedSelection);
      const request=JSON.parse(await readFile(requestPath,'utf8'));
      const receipt=draft.receipts.find(row=>row.requestId===request.requestId||row.request?.requestId===request.requestId);
      assert.ok(receipt,'The original saved request remains in the complete case-planning receipts');
      const selected=await native('/api/plans/'+input.planId+'/revision/'+draft.savedSelection.revision);
      assert.equal(selected.contentSha256,draft.savedSelection.contentSha256);
      assert.equal(selected.revision,request.expectedRevision+1);
      const history=await native('/api/plans/'+input.planId+'/history');
      assert.equal(history.revisions.filter(row=>row.revision===selected.revision).length,1);
      if(await exists(responsePath))assert.equal(JSON.parse(await readFile(responsePath,'utf8')).contentSha256,selected.contentSha256);
      await atomic(join(out,'received-save-draft.json'),draft);await atomic(join(out,'selected-plan.json'),selected);
      return {requestId:request.requestId,expectedRevision:request.expectedRevision,savedRevision:selected.revision,
        contentSha256:selected.contentSha256,originalResponseRecovered:true};
    });
    const saved=progress.phases['receive-original-save-after-lost-response'].result;
    await phase('preserve-unrelated-unsaved-planning-switch',async()=>{
      if(await page.locator('.case-planning-route').isVisible())await click('[data-case-planning-action=detach]');
      await click('[data-tab=work]');
      const textarea=page.locator('textarea[data-path]').first();await textarea.waitFor();
      const before=await textarea.inputValue(),entered=before+'\nReceiving-only unsaved planner transition.';
      await textarea.fill(entered);await textarea.dispatchEvent('input');
      dialogDecision='dismiss';await click(labelled('Saved case planning work'));
      await click('[data-case-planning-draft="'+progress.draftId+'"]');
      assert.equal(await textarea.inputValue(),entered);
      assert.equal(await page.locator('.case-planning-route').isVisible(),false);
      assert.equal(await page.locator('dialog[open]').count(),1);
      dialogDecision='accept';await click('[data-case-planning-draft="'+progress.draftId+'"]');
      await page.locator('.case-planning-route').waitFor({state:'visible'});
      assert.equal((await storedCaseDraft()).savedSelection.contentSha256,saved.contentSha256);
      return {declinedSwitchPreservedFullDraft:true,acceptedSwitchReopenedOriginal:progress.draftId};
    });
    await phase('return-exact-saved-revision-to-original-amendment',async()=>{
      await click('[data-case-planning-action=amendments]');
      const original=await selectAmendment();progress.amendmentDraftId=original.id;await saveProgress();
      assert.equal(original.draft.inputs.selectedRevision,saved.savedRevision);
      assert.equal(original.draft.inputs.expectedContentSha256,saved.contentSha256);
      assert.equal(original.draft.inputs.asOfDate,input.asOfDate);
      await page.reload({waitUntil:'domcontentloaded'});await ready();
      await click('[data-case-planning-action=amendments]');
      const reopened=await selectAmendment();assert.equal(reopened.id,original.id);
      const rows=await amendDrafts();
      assert.equal(rows.filter(row=>row.planningReturn?.id===original.planningReturn.id).length,1);
      return {draftId:original.id,selection:original.planningReturn};
    });
    progress.amendmentDraftId=progress.amendmentDraftId||progress.phases['return-exact-saved-revision-to-original-amendment'].result.draftId;
    await selectAmendment();await receivePendingAmendment();
    await phase('review-complete-proposal-and-paired-calendars',async()=>{
      await click('[data-amend-action=preview]');
      await waitFor(()=>page.locator('[data-amend-action=save]').isEnabled(),'Complete native amendment preview');
      const exportFile=await download(()=>click('[data-amend-action=calendar-export][data-calendar-scope=draft]'),'before-proposed-calendars-complete-case.zip');
      await download(()=>click('[data-amend-action=draft-export]'),'original-amendment-draft.json');
      await screenshot('complete-amendment-preview-desktop.png');
      return {pairedCalendarDelivery:exportFile};
    });
    await phase('save-and-review-original-amendment',async()=>{
      let desk=(await amendDrafts()).find(row=>row.id===progress.amendmentDraftId);
      if(!desk.selection){
        await click('[data-amend-action=preview]');await click('[data-amend-action=save]');
        desk=await waitFor(async()=>{const row=(await amendDrafts()).find(item=>item.id===progress.amendmentDraftId);return row?.selection&&!row.pending?row:null;},'Receive original amendment save');
      }
      const current=await native('/api/operations/'+input.caseId);
      const head=current.amendments.find(row=>row.id===desk.selection.id);
      if(!['REVIEWED','APPLIED'].includes(head?.state)&&await page.locator('[data-amend-action=review]').count()){
        await page.locator('[name="review.statement"]').fill('Reviewed the complete returned workbook, retained source rows and mappings, native planning calculation, original recorded work and invoices, and both original payment-based calendars. Select this exact saved planning edition for the same walkthrough case.');
        await page.locator('[name="review.note"]').fill('Complete case workbook receiving: approve the exact original native amendment and retained source decision.');
        await click('[data-amend-action=review]');
        await waitFor(()=>page.locator('[data-amend-action=apply]').count(),'Receive exact amendment review');
      }
      desk=(await amendDrafts()).find(row=>row.id===progress.amendmentDraftId);
      await download(()=>click('[data-amend-action=saved-export]'),'reviewed-original-amendment.json');
      return {amendmentId:desk.selection.id,amendmentRevision:desk.selection.revision};
    });
    await phase('apply-reviewed-baseline-to-same-case',async()=>{
      let current=await native('/api/operations/'+input.caseId);
      if(current.plan.revision!==saved.savedRevision||current.plan.contentSha256!==saved.contentSha256){
        await page.locator('[name=applyNote]').fill('Apply the complete reviewed workbook revision to the original calendar walkthrough; continue original cash, assignments, history and completion records.');
        await page.locator('[name=acknowledgeBaselineChange]').check();
        await click('[data-amend-action=apply]');
        current=await waitFor(async()=>{const value=await native('/api/operations/'+input.caseId);return value.plan.revision===saved.savedRevision&&value.plan.contentSha256===saved.contentSha256?value:null;},'Receive original case baseline application');
      }
      await atomic(join(out,'case-after-amendment.json'),current);
      return {caseId:current.program.id,caseVersion:current.program.version,planId:current.plan.id,revision:current.plan.revision,contentSha256:current.plan.contentSha256};
    });
    await phase('complete-calendar-and-native-completion-joins',async()=>{
      await openCase('calendar');await page.locator('[data-calendar-setting=asOfDate]').fill(input.asOfDate);
      await page.locator('[data-calendar-setting=asOfDate]').dispatchEvent('change');
      await waitFor(()=>page.locator('.calendar-source').textContent().then(v=>v.includes(input.asOfDate)),'Applied original case calendar');
      const report=await native('/api/operations/'+input.caseId+'/delivery-calendar?asOfDate='+input.asOfDate);
      const before=JSON.parse(await readFile(join(out,'calendar-before.json'),'utf8'));
      const payments=report.entries.filter(row=>['GRANT_RECEIPT','SUBMISSION_DEADLINE','FORM_SUBMISSION','EXTENSION_CONFIRMATION'].includes(row.kind));
      const originalPayments=before.entries.filter(row=>['GRANT_RECEIPT','SUBMISSION_DEADLINE','FORM_SUBMISSION','EXTENSION_CONFIRMATION'].includes(row.kind));
      assert.deepEqual(payments,originalPayments);
      await page.locator('[data-calendar-setting=view]').selectOption('agenda');await screenshot('applied-calendar-agenda-desktop.png');
      await page.locator('[data-calendar-setting=view]').selectOption('month');await screenshot('applied-calendar-month-desktop.png');
      for(const extension of ['ics','csv','json'])await download(()=>click('[data-calendar-action=export-'+extension+']'),'complete-calendar.'+extension);
      await page.setViewportSize({width:390,height:844});await page.locator('[data-calendar-setting=view]').selectOption('agenda');
      await screenshot('applied-calendar-phone.png',{width:390,height:844});
      const deadline=report.entries.find(row=>row.kind==='SUBMISSION_DEADLINE'&&row.active)||
        report.entries.find(row=>row.kind==='SUBMISSION_DEADLINE');
      assert.ok(deadline,'Original received payment provides the complete native deadline link');
      await click('[data-calendar-action=clear-filters]');
      await page.locator('[data-calendar-setting=kind]').selectOption('SUBMISSION_DEADLINE');
      await page.locator('[data-calendar-setting=showInactive]').check();
      await click(page.locator('[data-calendar-action=source][data-calendar-id="'+deadline.id+'"]').first());
      await page.locator('[name=completionAsOfDate]').waitFor();
      assert.equal(await page.locator('[name=completionAsOfDate]').inputValue(),input.asOfDate);
      assert.equal(await page.locator('[name=completionReceipt]').inputValue(),deadline.sourceId);
      assert.equal(Number(await page.locator('[name=completionTranche]').inputValue()),deadline.tranche);
      await screenshot('selected-completion-phone.png',{width:390,height:844});
      await screenshot('selected-completion-desktop.png');
      await atomic(join(out,'calendar-after.json'),report);
      return {asOfDate:report.asOfDate,dated:report.entries.length,undated:report.undated.length,
        originalPaymentRows:payments.length,receiptId:deadline.sourceId,tranche:deadline.tranche,sourceEntryId:deadline.id};
    });
    await phase('complete-multi-case-agenda-and-original-sources',()=>operateDeliveryAgenda('delivery-agenda'));
    await phase('deliver-exact-selected-plan-case-and-working-draft',async()=>{
      await download(()=>click('[data-case-planning-action=export]'),'case-planning-final.json');
      await download(()=>click('[data-action=export]'),'selected-planning-workspace.zip');
      for(const filename of ['scenario.json','daily.csv','costs.csv']){
        const path=join(exportsDirectory,filename);await atomic(path,await native('/api/plans/'+input.planId+'/'+filename+'?revision='+saved.savedRevision,{binary:true}));
        progress.files[filename]=await fileIdentity(path);
      }
      await download(()=>click(labelled('Export complete case')),'original-case-complete.zip');
      await click('[data-case-planning-action=planning]');
      await click(labelled('Export saved plan workbook'));
      await download(()=>click(labelled('Download complete handover again')),'selected-complete-workbook-handover.zip');
      const draft=await storedCaseDraft();
      assert.equal(draft.savedSelection.contentSha256,saved.contentSha256);
      return {savedRevision:saved.savedRevision,savedContentSha256:saved.contentSha256,draftId:draft.id};
    });
    const result={schema:progress.schema,operationId:input.operationId,caseId:input.caseId,planId:input.planId,asOfDate:input.asOfDate,
      draftId:progress.draftId,amendmentDraftId:progress.amendmentDraftId,
      savedRevision:saved.savedRevision,savedContentSha256:saved.contentSha256,originalSaveRequestId:saved.requestId,
      completedAt:stamp(),phases:progress.phases,files:progress.files,visualReview:progress.visualReview||{},pageErrors};
    await atomic(join(root,'browser-result.json'),result);
  }
}catch(error){
  progress.interruption={at:stamp(),phase:progress.currentPhase,type:error.name,message:error.message};
  await saveProgress();
  await page.screenshot({path:join(out,'interrupted-current-view.png'),fullPage:true}).catch(()=>{});
  await atomic(join(out,'page-errors.json'),pageErrors);
  process.stderr.write(error.stack+'\n');process.exitCode=1;
}finally{await browser.close();}
