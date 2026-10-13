/** The original browser receiving course calls this guided source continuation.
 * It uses an isolated copy of the actual application and its retained illustrative
 * inputs, preserving the main financial course and all customer originals. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import * as E from '../../engine.mjs';
import * as W from '../../work-orders.mjs';
import {prepareMasterCapture} from './prepare-master.mjs';
import {prepareWorkOrderCapture} from './prepare-work-orders.mjs';
import {sha256Utf8} from '../../sha256.mjs';
import {createSourcePreparation} from './source-preparation-ui.mjs';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function members(bytes){
 const result=new Map();let at=0;
 while(at+30<=bytes.length&&bytes.readUInt32LE(at)===0x04034b50){
  const flags=bytes.readUInt16LE(at+6),method=bytes.readUInt16LE(at+8),size=bytes.readUInt32LE(at+18),n=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),start=at+30+n+extra;
  need(!(flags&8)&&method===0&&start+size<=bytes.length,'Use the complete maintained stored handover ZIP.');
  const name=bytes.subarray(at+30,at+30+n).toString('utf8');
  need(!result.has(name)&&!name.startsWith('/')&&!name.split('/').includes('..'),'Unsafe or duplicate handover member.');
  result.set(name,bytes.subarray(start,start+size));at=start+size;
 }
 need(at+4<=bytes.length&&bytes.readUInt32LE(at)===0x02014b50,'The full handover directory is missing.');return result;
}
export async function runSourcePreparationReceiving({context,outputDirectory,applicationPath}){
 need(path.isAbsolute(outputDirectory)&&path.isAbsolute(applicationPath),'Use the original absolute receiving paths.');
 const browser=context.browser();need(browser,'The existing receiving browser is required.');
 const original=await fs.readFile(applicationPath),html=original.toString('utf8');
 const match=/<script id="bootstrap" type="application\/json">([\s\S]*?)<\/script>/.exec(html);need(match,'The actual complete application bootstrap is absent.');
 const boot=JSON.parse(match[1]),bundle=boot.applicationSource;
 need(bundle?.files?.length&&boot.sourcePreparationUISource,'Receive the complete source-preparation application edition first.');
 const by=new Map(bundle.files.map(f=>[f.path,f]));
 for(const file of bundle.files)need(Buffer.byteLength(file.text)===file.bytes&&digest(Buffer.from(file.text))===file.sha256,'Original application source member differs: '+file.path);
 const prefix='services/fixed-asset-migration/integrations/business-central/',masterOriginal=by.get(prefix+'capture-example.json'),costOriginal=by.get(prefix+'work-order-capture-example.json');
 need(masterOriginal&&costOriginal,'Retain both original illustrative source captures.');
 const root=path.join(outputDirectory,'guided-source-'+randomUUID());await fs.mkdir(root,{recursive:true});
 const independentBoot={...boot,copyId:randomUUID(),portable:null,drafts:{},recovery:null};
 const app=path.join(root,'Guided_Source_Preparation_Receiving.html');
 await fs.writeFile(app,html.replace(match[0],'<script id="bootstrap" type="application/json">'+JSON.stringify(independentBoot).replaceAll('<','\\u003c')+'</script>'),{flag:'wx'});
 const own=await browser.newContext({acceptDownloads:true}),page=await own.newPage(),errors=[],outputs=[],screenshots=[];
 page.on('pageerror',e=>errors.push(String(e)));
 const model=createSourcePreparation({E,W,prepareMasterCapture,prepareWorkOrderCapture,sha256Utf8});
 const captureFile=path.join(root,'original-master-capture.json');await fs.writeFile(captureFile,masterOriginal.text,{flag:'wx'});
 async function download(selector,name){
  const wait=page.waitForEvent('download');await page.locator(selector).click();const file=await wait,target=path.join(root,name||file.suggestedFilename());await file.saveAs(target);const bytes=await fs.readFile(target);
  outputs.push({path:target,bytes:bytes.length,sha256:digest(bytes)});return{path:target,bytes};
 }
 const field=name=>page.locator('[data-sp-field="'+name+'"]');
 async function view(name){
  for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});const file=path.join(root,name+'-'+width+'.png');await page.screenshot({path:file,fullPage:true});screenshots.push(file);}
  await page.setViewportSize({width:1440,height:1000});
 }
 async function state(name){const file=await download('#top-json',name);return E.importWorkspace(file.bytes.toString('utf8'));}
 async function collectPreview(expected,label){
  const listed=await page.locator('#sp-file option').evaluateAll(nodes=>nodes.map(n=>n.value));need(JSON.stringify(listed)===JSON.stringify(expected.files.map(f=>f.path)),'The full preview omitted or reordered a file.');
  for(let i=0;i<expected.files.length;i++){
   const file=expected.files[i];await page.locator('#sp-file').selectOption(file.path);
   const actual=await download('#sp-download-file',label+'-'+String(i+1).padStart(2,'0')+'-'+file.path.replaceAll('/','--'));
   need(actual.bytes.equals(Buffer.from(file.text)),'An original preview download differs: '+file.path);
  }
  await page.locator('#sp-file').selectOption(expected.sourcePath);await view(label+'-complete-records');
 }
 try{
  await page.goto(pathToFileURL(app).href);await page.locator('[data-tab="preparation"]').click();
  await page.locator('#sp-capture-file').setInputFiles(captureFile);await page.locator('#sp-load-capture').click();
  await field('role').selectOption('source');await field('actor').fill('Illustrative receiving operator');await field('reason').fill('Review the complete original illustrative maintenance source; not Port tenant data.');
  await page.locator('#sp-preview-button').click();await page.locator('#sp-preview').waitFor();
  const masterDraft=model.receiveCapture(masterOriginal.text,path.basename(captureFile));masterDraft.role='source';masterDraft.actor='Illustrative receiving operator';masterDraft.reason='Review the complete original illustrative maintenance source; not Port tenant data.';
  // The guided field controls retain the selection attribution inside capture.
  masterDraft.capture.selection??={};masterDraft.capture.selection.actor=masterDraft.actor;masterDraft.capture.selection.reason=masterDraft.reason;
  const masterPreview=model.prepare(masterDraft);await collectPreview(masterPreview,'master');
  await page.locator('#sp-confirm').check();await page.locator('#sp-adopt').click();
  await page.getByRole('heading',{name:'Preparation adopted'}).waitFor();
  const masterWS=await state('master-adopted-workspace.json');
  need(masterWS.sources.length===1&&masterWS.sources[0].rows.length===2,'The complete two-page master population changed.');
  const masterExpected=model.adopt(E.createWorkspace({id:masterWS.id,title:masterWS.title,createdAt:masterWS.createdAt}),masterDraft,masterPreview,{operationId:masterWS.operations[0].id.split(':source-preparation:')[0],expectedRevision:0,at:masterWS.operations[0].at,confirmed:true});
  need(E.exportWorkspace(masterExpected.workspace)===E.exportWorkspace(masterWS),'Original master journal adoption differs.');
  await view('master-adopted');

  await page.locator('#sp-clear').click();await field('kind').selectOption('postedLedger');
  const cost=JSON.parse(costOriginal.text);
  for(const key of ['tenantId','environment','companyId','canonicalCompanyId','collectionUrl','observedAt'])await field(key).fill(cost[key]);
  await field('role').selectOption('source');await field('complete').selectOption(String(cost.population.complete));await field('description').fill(cost.population.description);
  await field('actor').fill('Illustrative receiving operator');await field('reason').fill('Review actual versus expected LCY and the unresolved original header; not Port tenant data.');
  await field('quantityField').selectOption(cost.selection.quantityField);await field('expenseLineCostField').selectOption(cost.selection.expenseLineCostField);
  const pageFiles=[];
  for(let i=0;i<cost.pages.length;i++){const file=path.join(root,'original-ledger-page-'+(i+1)+'.json');await fs.writeFile(file,cost.pages[i].bodyText,{flag:'wx'});pageFiles.push(file);}
  await page.locator('#sp-page-files').setInputFiles(pageFiles);await page.locator('#sp-add-pages').click();
  for(let i=0;i<cost.pages.length;i++){await field('page:'+i+':url').fill(cost.pages[i].url);await field('page:'+i+':status').fill(String(cost.pages[i].status));}
  const contextFile=path.join(root,'original-company-general-ledger-setup.json');await fs.writeFile(contextFile,cost.companyContext.bodyText,{flag:'wx'});
  await page.locator('#sp-context-file').setInputFiles(contextFile);await page.locator('#sp-load-context').click();
  await field('context:url').fill(cost.companyContext.url);await field('context:status').fill(String(cost.companyContext.status));
  await field('lcyCode').fill(cost.selection.lcyCode);await field('lcySourceReference').fill(cost.selection.lcySourceReference);
  // Save and cold-reopen unfinished choices before validating/adopting them.
  const draftFile=await download('#top-save','unfinished-source-preparation.html');
  await page.goto(pathToFileURL(draftFile.path).href);await page.locator('[data-tab="preparation"]').click();
  need(await field('companyId').inputValue()===cost.companyId&&await field('expenseLineCostField').inputValue()===cost.selection.expenseLineCostField,'Unfinished source/company/cost choices were lost on reopening.');
  const draftMatch=/<script id="bootstrap" type="application\/json">([\s\S]*?)<\/script>/.exec(draftFile.bytes.toString('utf8'));
  const actualDraft=JSON.parse(draftMatch[1]).drafts.sourcePreparation;
  need(actualDraft.capture.pages.every((p,i)=>p.bodyText===cost.pages[i].bodyText)&&actualDraft.capture.companyContext.bodyText===cost.companyContext.bodyText,'An unfinished original response changed.');
  await page.locator('#sp-preview-button').click();await page.locator('#sp-preview').waitFor();
  const costPreview=model.prepare(actualDraft);await collectPreview(costPreview,'ledger');
  await page.locator('#sp-file').selectOption('source-findings.csv');
  need((await page.locator('#sp-preview').innerText()).includes('work_order_id'),'The missing original work-order header was hidden.');
  await view('ledger-original-findings');
  await page.locator('#sp-confirm').check();await field('reason').fill(actualDraft.reason+' Rechecked.');
  need(await page.locator('#sp-preview').isHidden(),'Editing reviewed context kept an obsolete preview active.');
  await field('reason').fill(actualDraft.reason);await page.locator('#sp-preview-button').click();await page.locator('#sp-confirm').check();await page.locator('#sp-adopt').click();
  await page.getByRole('heading',{name:'Preparation adopted'}).waitFor();
  const finalWS=await state('source-preparation-complete-workspace.json'),wo=W.read(finalWS),source=wo.sources.find(f=>f.role==='source'&&f.domain==='costs');
  need(source?.rows.length===1&&source.text===costPreview.files.find(f=>f.path===costPreview.sourcePath).text,'The complete cost source changed.');
  const mapped=W.reconcile(finalWS).domains.source.costs[0].values;
  need(mapped.cost_amount==='-9007199254740993.123456789012345678'&&mapped.quantity==='1.23'&&mapped.work_order_id===''&&mapped.cost_basis==='actual','Exact amounts or missing original header meanings changed.');
  for(const f of [...masterPreview.files,...costPreview.files]){
   const retained=finalWS.supportingFiles.some(x=>x.bytes===f.bytes&&x.sha256===f.sha256&&Buffer.from(x.base64,'base64').equals(Buffer.from(f.text)));
   need(retained,'The full journal lost an original/prepared member: '+f.path);
  }
  need(JSON.stringify(finalWS.operations.slice(0,masterWS.revision))===JSON.stringify(masterWS.operations),'The earlier master history changed.');
  await page.locator('[data-tab="workorders"]').click();await view('adopted-work-order-desk');
  await page.locator('[data-tab="handover"]').click();await page.locator('#prepare-handover').click();
  const archive=await download('#zip','guided-source-complete-handover.zip'),entries=members(archive.bytes),manifest=JSON.parse(entries.get('MANIFEST.json').toString('utf8'));
  for(const f of manifest.files){const content=entries.get(f.path);need(content&&content.length===f.bytes&&digest(content)===f.sha256,'A complete outgoing member differs: '+f.path);}
  const received=E.importWorkspace(entries.get('workspace.json').toString('utf8'));need(E.exportWorkspace(received)===E.exportWorkspace(finalWS),'The complete ZIP workspace changed.');
  for(const f of bundle.files)need(entries.get('application/'+f.path)?.equals(Buffer.from(f.text)),'The full editable application source is missing: '+f.path);
  const extracted=path.join(root,'received');await fs.mkdir(extracted,{recursive:true});
  for(const [name,content]of entries){const file=path.resolve(extracted,name);need(file.startsWith(extracted+path.sep),'An archive member escapes the received root.');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content,{flag:'wx'});}
  const cold=await browser.newContext({acceptDownloads:true}),opened=await cold.newPage();opened.on('pageerror',e=>errors.push(String(e)));
  try{
   await opened.goto(pathToFileURL(path.join(extracted,'Fixed_Asset_Finance_Workspace.html')).href);await opened.locator('[data-tab="preparation"]').click();await opened.locator('#sp-preview-button').click();await opened.locator('#sp-preview').waitFor();
   for(const width of [1440,390]){await opened.setViewportSize({width,height:width===390?844:1000});const file=path.join(root,'cold-complete-preparation-'+width+'.png');await opened.screenshot({path:file,fullPage:true});screenshots.push(file);}
   const wait=opened.waitForEvent('download');await opened.locator('#top-json').click();const d=await wait,file=path.join(root,'cold-reopened-workspace.json');await d.saveAs(file);
   const bytes=await fs.readFile(file);need(E.exportWorkspace(E.importWorkspace(bytes.toString('utf8')))===E.exportWorkspace(finalWS),'The cold reopened source/mapping journal changed.');outputs.push({path:file,bytes:bytes.length,sha256:digest(bytes)});
  }finally{await cold.close();}
  need(!errors.length,'The actual guided receiving browser reported: '+errors.join('; '));
  const result={schema:'tjlabs.guided-source-preparation-receiving.v1',application:{path:applicationPath,bytes:original.length,sha256:digest(original)},sourceMeaning:'Original bundled illustrative master/posted-ledger responses, not Port tenant records.',masterRows:2,costRows:1,sourceFindings:costPreview.scope.findings,originalPagesUnchanged:true,exactCost:mapped.cost_amount,originalRevision:finalWS.revision,workspaceId:finalWS.id,outputs,screenshots,extractedApplication:path.join(extracted,'application'),pageErrors:errors,producerView:'Open and LOOK at actual desktop/narrow screens and use the full application, original source files, readable reports and extracted complete handover. These paths are observations, not a substitute for producer inspection.'};
  await fs.writeFile(path.join(root,'guided-source-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
 }finally{await own.close();}
}
