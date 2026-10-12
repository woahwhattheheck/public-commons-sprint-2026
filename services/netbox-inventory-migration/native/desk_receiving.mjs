import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const OPERATION='NETBOX-INVENTORY-RECEIVING-20261012-B9D2';
const entry=JSON.parse(fs.readFileSync(process.env.NETBOX_DESK_ENTRY,'utf8'));
const fixture=JSON.parse(fs.readFileSync(entry.fixture,'utf8'));
const original=JSON.parse(fs.readFileSync(entry.receipt,'utf8'));
const require=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'package.json'));
const {chromium}=require('playwright');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const requireValue=(ok,message)=>{if(!ok)throw new Error(message);};
requireValue(fixture.operation_id===OPERATION&&fixture.actual_netbox_version==='4.7.2','Select the original actual4.7.2 receiving fixture.');
const progressPath=path.join(entry.output,'desk-progress.json');
const archiveSha=sha(fs.readFileSync(entry.archive));
const result=fs.existsSync(progressPath)?JSON.parse(fs.readFileSync(progressPath,'utf8')):{
  schema:'tjlabs.netbox.desk-native-receiving/v1',operation_id:OPERATION,
  product_source:'351dd7d53629417215154a75e47562c17cf74f2f',
  input_archive_sha256:archiveSha,original_receipt_sha256:original.receipt_sha256,
  steps:[],screenshots:[],downloads:[],page_errors:[],attempts:[]
};
requireValue(result.operation_id===OPERATION&&result.input_archive_sha256===archiveSha
  &&result.original_receipt_sha256===original.receipt_sha256,'The original receiving input changed.');
function atomic(file,value){
  const temp=file+'.partial-'+crypto.randomUUID(),raw=Buffer.from(JSON.stringify(value,null,2)+'\n');
  const fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function save(){atomic(progressPath,result);}
async function stage(name,fn){
  const retained=result.steps.find(item=>item.name===name);if(retained)return retained.value;
  result.current_stage=name;save();
  const value=await fn();result.steps.push({name,value,at:new Date().toISOString()});delete result.current_stage;save();
  console.log(JSON.stringify({operation_id:OPERATION,stage:name,state:'COMPLETE'}));return value;
}
result.attempts.push({at:new Date().toISOString(),driver_sha256:sha(fs.readFileSync(new URL(import.meta.url)))});
save();
const browser=await chromium.launch({headless:true,executablePath:entry.chromium||undefined,
  args:['--no-sandbox','--disable-dev-shm-usage']});
let context,page;
async function connect(width=1440){
  await context?.close();context=await browser.newContext({viewport:{width,height:width===390?844:1000},acceptDownloads:true});
  page=await context.newPage();page.on('pageerror',error=>{result.page_errors.push({at:new Date().toISOString(),message:error.message});save();});
  await page.goto(entry.url+'/#token='+entry.token);
  await page.getByRole('button',{name:'New project',exact:true}).waitFor({state:'attached'});
}
async function api(suffix,method='GET',body,raw=false){
  const response=await context.request.fetch(entry.url+suffix,{method,headers:{
    Authorization:'Bearer '+entry.token,'X-Workspace-Token':entry.token,Origin:entry.url},data:body});
  if(raw)return response;
  const value=await response.json();requireValue(response.ok()&&value.ok!==false,
    JSON.stringify({status:response.status(),code:value.code,error:value.error??value.message}));
  return value;
}
const projectPath=id=>'/api/projects/'+encodeURIComponent(id);
const editionPath=(id,edition)=>projectPath(id)+'/editions/'+encodeURIComponent(edition);
async function project(id){return(await api(projectPath(id))).project;}
async function detail(id,edition){return api(editionPath(id,edition));}
async function openProject(id,tab='Source files',edition){
  await page.setViewportSize({width:1440,height:1000});
  const current=await project(id);
  await page.locator('.project-button').filter({hasText:current.label}).click();
  await page.getByRole('button',{name:tab,exact:true}).click();
  if(edition)await page.getByLabel('Migration edition',{exact:true}).selectOption(edition);
  return current;
}
async function getOrCreate(label){
  let state=await api('/api/state');const matches=state.projects.filter(item=>item.label===label);
  requireValue(matches.length<=1,'The original named customer project is ambiguous.');
  if(matches.length)return matches[0];
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'New project',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Project name',{exact:true}).fill(label);
  await dialog.getByRole('button',{name:'Create project',exact:true}).click();
  // The first project's heading may already be present in a fresh browser.
  // Join the actual saved project by its unique label after this create.
  for(let n=0;n<120;n++){
    state=await api('/api/state');const selected=state.projects.filter(item=>item.label===label);
    requireValue(selected.length<=1,'The original browser-created project is ambiguous.');
    if(selected.length===1)return selected[0];
    await page.waitForTimeout(250);
  }
  throw new Error('The original create remains available for same-label reconciliation.');
}
async function screenshot(name,width=1440){
  await page.setViewportSize({width,height:width===390?844:1000});
  const geometry=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  requireValue(geometry.document<=geometry.viewport+1&&geometry.body<=geometry.viewport+1,name+' has horizontal overflow.');
  const file=path.join(entry.output,name);await page.screenshot({path:file,fullPage:true});
  const raw=fs.readFileSync(file),value={name,bytes:raw.length,sha256:sha(raw),geometry};
  result.screenshots=result.screenshots.filter(x=>x.name!==name).concat(value);save();return value;
}
function receivedEdition(projectValue,operation){
  const matches=projectValue.editions.filter(item=>item.kind==='received'&&item.operation_id===operation);
  requireValue(matches.length<=1,'The original received operation has ambiguous customer editions.');
  return matches[0];
}
async function restoreArchive(id,file){
  await openProject(id);
  await page.getByRole('button',{name:'Restore handover archive',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Handover archive',{exact:true}).setInputFiles(file);
  await dialog.getByRole('button',{name:'Restore archive',exact:true}).click();
  await page.getByRole('heading',{name:'Migration delivery',exact:true}).waitFor();
  return project(id);
}
async function waitEdition(id,edition,wanted){
  const resumed=new Set();
  for(let n=0;n<240;n++){
    const value=await detail(id,edition);
    const current=value.actions?.find(item=>item.id===value.edition.active_action_id);
    if(current?.state==='FAILED')throw new Error('Original saved action failed: '+JSON.stringify(current.error));
    if(wanted.includes(value.edition.state)){
      if(current&&!['COMPLETE','FAILED'].includes(current.state))return(await waitAction(id,edition,current.id)).detail;
      return value;
    }
    if(current?.state==='RECOVERY_REQUIRED'&&!resumed.has(current.id)){
      await openProject(id,'Native review',edition);
      const join=page.getByRole('button',{name:'Join saved action',exact:true});
      await join.waitFor();await join.click();resumed.add(current.id);
    }
    if(value.edition.state==='AWAITING_NATIVE_RESULT'&&(!current||current.state==='COMPLETE')){
      // A completed local action can still be waiting on its original native
      // job. Observe that same job/journal through a fresh read-only recovery.
      const observed=await nativeRecovery(id,edition);
      if(wanted.includes(observed.detail.edition.state))return observed.detail;
    }
    if(value.edition.state==='CORRECTION_REQUIRED')throw new Error('The original native edition requires its saved correction: '+JSON.stringify(value.corrections));
    await page.waitForTimeout(1500);
  }
  throw new Error('Continue the retained native action from this edition; it has not finished.');
}
async function waitAction(id,edition,identity){
  const resumed=new Set();
  for(let n=0;n<240;n++){
    const value=await detail(id,edition),action=value.actions.find(item=>item.id===identity);
    requireValue(action,'The original saved action disappeared.');
    if(action.state==='COMPLETE')return {action,detail:value};
    if(action.state==='FAILED')throw new Error('Original '+action.kind+' action failed: '+JSON.stringify(action.error));
    if(action.state==='RECOVERY_REQUIRED'&&!resumed.has(identity)){
      await openProject(id,'Native review',edition);
      await page.getByRole('button',{name:'Join saved action',exact:true}).click();
      resumed.add(identity);
    }
    await page.waitForTimeout(1500);
  }
  throw new Error('Continue the same retained '+identity+' action; it has not finished.');
}
async function nativeRecovery(id,edition){
  let value=await detail(id,edition),action=value.actions.filter(item=>item.kind==='recover').at(-1);
  if(action?.state==='COMPLETE'&&value.edition.state==='AWAITING_NATIVE_RESULT')action=null;
  if(!action){
    const priorIds=new Set(value.actions.map(item=>item.id));
    await openProject(id,'Native review',edition);
    await page.getByRole('button',{name:'Recover native result',exact:true}).click();
    for(let n=0;n<120;n++){
      value=await detail(id,edition);action=value.actions.filter(item=>item.kind==='recover'&&!priorIds.has(item.id)).at(-1);
      if(action)break;
      await page.waitForTimeout(250);
    }
  }
  requireValue(action,'The original recovery action has not reached its retained request; reopen the same browser intent.');
  return waitAction(id,edition,action.id);
}
async function localAction(id,edition,kind,button){
  let value=await detail(id,edition);
  const previous=value.actions.filter(item=>item.kind===kind).at(-1);
  if(previous?.state!=='COMPLETE'){
    await openProject(id,'Delivery',edition);
    if(previous&&['QUEUED','RUNNING','RECOVERY_REQUIRED'].includes(previous.state)){
      if(previous.state==='RECOVERY_REQUIRED')await page.getByRole('button',{name:'Join saved action',exact:true}).click();
    }else await page.getByRole('button',{name:button,exact:true}).click();
    for(let n=0;n<160;n++){
      value=await detail(id,edition);const action=value.actions.filter(item=>item.kind===kind).at(-1);
      if(action?.state==='COMPLETE')return action;
      if(action?.state==='FAILED')throw new Error('Original '+kind+' action failed: '+JSON.stringify(action.error));
      await page.waitForTimeout(500);
    }
    throw new Error('The original '+kind+' action remains available for continuation.');
  }
  return previous;
}
async function download(file,expectedName){
  await page.getByRole('button',{name:'Delivery',exact:true}).click();
  const awaiting=page.waitForEvent('download');await page.getByRole('button',{name:'Download '+file,exact:true}).click();
  const received=await awaiting;requireValue(received.suggestedFilename()===expectedName,'Original download filename differs: '+received.suggestedFilename());
  const target=path.join(entry.output,expectedName);await received.saveAs(target);
  const raw=fs.readFileSync(target),reference={selection:file,name:expectedName,path:target,bytes:raw.length,sha256:sha(raw)};
  result.downloads=result.downloads.filter(x=>x.selection!==file).concat(reference);save();return reference;
}
try{
  await connect();
  const selected=await stage('01-customer-project',async()=>getOrCreate('Native inventory receiving · b9d2'));
  const id=selected.id;
  await stage('02-original-csv-intake',async()=>{
    await openProject(id);
    const names=['sites.csv','racks.csv','devices.csv','interfaces.csv','ip_addresses.csv'];
    let value=await project(id);
    const missing=names.filter(name=>!value.uploads.some(item=>item.name===name&&item.sha256===sha(fs.readFileSync(path.join(entry.inputs,name)))));
    if(missing.length){
      await page.getByLabel('Source CSV files',{exact:true}).setInputFiles(missing.map(name=>path.join(entry.inputs,name)));
      for(let n=0;n<120;n++){value=await project(id);if(names.every(name=>value.uploads.some(x=>x.name===name)))break;await page.waitForTimeout(250);}
    }
    value=await project(id);
    requireValue(value.uploads.length===5,'The same five original source files must be retained.');
    for(const upload of value.uploads)requireValue(upload.sha256===sha(fs.readFileSync(path.join(entry.inputs,upload.name))),'A retained original CSV differs.');
    await page.locator('tbody tr').filter({hasText:'devices.csv'}).getByRole('button',{name:'Preview',exact:true}).click();
    await page.getByRole('dialog').locator('tbody tr').first().waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Choose',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByLabel('Catalogue search',{exact:true}).fill('b9d2-nbx-20261012');
    await dialog.getByRole('button',{name:'Search',exact:true}).click();
    await dialog.getByRole('button',{name:'Select b9d2-nbx-20261012',exact:true}).click();
    await page.getByRole('button',{name:'Save mapping',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Saved');
    value=await project(id);
    requireValue(value.tenant_id===fixture.tenant_id,'The selected actual tenant was not saved.');
    return {project_id:id,uploads:value.uploads.map(({name,bytes,row_count,sha256})=>({name,bytes,row_count,sha256})),
      actual_tenant_id:fixture.tenant_id};
  });
  const received=await stage('03-original-handover-receiving',async()=>{
    let value=await project(id),edition=receivedEdition(value,original.operation_id);
    if(!edition){value=await restoreArchive(id,entry.archive);edition=receivedEdition(value,original.operation_id);}
    requireValue(edition,'The original archive has no retained edition.');
    const actual=await detail(id,edition.id);
    requireValue(actual.result?.state==='APPLIED'&&actual.result.receipt_sha256===original.receipt_sha256,
      'The browser did not receive the original applied native receipt.');
    return {edition_id:edition.id,operation_id:edition.operation_id,receipt_sha256:actual.result.receipt_sha256};
  });
  await stage('04-corrected-mapping-and-catalogue',async()=>{
    let value=await openProject(id,'Delivery',received.edition_id);
    if(value.mapping.sources.length===0){
      await page.getByRole('button',{name:'Start a corrected draft',exact:true}).click();
      await page.getByRole('button',{name:'Check source mapping',exact:true}).waitFor();
    }else await page.getByRole('button',{name:'Mapping',exact:true}).click();
    value=await project(id);
    requireValue(value.mapping.sources.length===5&&value.tenant_id===fixture.tenant_id,'The corrected draft must preserve the five original mappings and native tenant.');
    await page.locator('.source-button').filter({hasText:'devices.csv'}).click();
    await page.getByLabel('Description source mode',{exact:true}).selectOption('value');
    await page.getByLabel('Description fixed value',{exact:true}).fill('Customer desk corrected edition · b9d2');
    await page.getByLabel('Serial conversion options',{exact:true}).click();
    await page.getByRole('dialog').getByLabel('Blank value behavior',{exact:true}).selectOption('empty');
    await page.getByRole('dialog').getByRole('button',{name:'Apply options',exact:true}).click();
    await page.getByRole('button',{name:'Save mapping',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Saved');
    value=await project(id);
    const devices=value.mapping.sources.find(x=>x.kind==='devices');
    requireValue(devices.fields.description.value==='Customer desk corrected edition · b9d2'&&devices.match_id,
      'The original matched devices and edited expression were not retained.');
    await screenshot('desk-desktop-mapping.png');await screenshot('desk-mobile-mapping.png',390);
    return {revision:value.revision,tenant_id:value.tenant_id,mappings:5,description:devices.fields.description};
  });
  const prepared=await stage('05-native-edition-preparation',async()=>{
    let value=await openProject(id,'Mapping');
    let edition=value.editions.find(item=>item.kind==='prepared');
    if(!edition){
      await page.getByRole('button',{name:'Check source mapping',exact:true}).click();
      await page.getByRole('button',{name:'Prepare native edition',exact:true}).waitFor();
      await page.getByRole('button',{name:'Prepare native edition',exact:true}).click();
      await page.getByRole('heading',{name:'Native inventory changes',exact:true}).waitFor();
      value=await project(id);edition=value.editions.find(item=>item.kind==='prepared');
    }
    requireValue(edition,'The exact corrected mapping has no original prepared edition.');
    const request=await api(editionPath(id,edition.id)+'/download/request.json');
    requireValue(request.operation_id===edition.operation_id&&request.objects.every(x=>x.match_id),
      'Every corrected object must retain its actual native ID.');
    return {edition_id:edition.id,operation_id:edition.operation_id,objects:request.objects.length};
  });
  const review=await stage('06-native-review',async()=>{
    let value=await detail(id,prepared.edition_id);
    await openProject(id,'Native review',prepared.edition_id);
    if(value.edition.state==='PREPARED'&&!value.edition.active_action_id)
      await page.getByRole('button',{name:'Review against NetBox',exact:true}).click();
    value=await waitEdition(id,prepared.edition_id,['REVIEWED','APPLIED']);
    requireValue(value.result.netbox_version==='4.7.2'&&value.result.counts.CREATE===0&&value.result.review_digest,
      'The actual review must update the original inventory without replacement objects.');
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await screenshot('desk-desktop-native-review.png');await screenshot('desk-mobile-native-review.png',390);
    return {review_digest:value.result.review_digest,counts:value.result.counts,
      actions:value.actions.map(({id,kind,state})=>({id,kind,state}))};
  });
  const applied=await stage('07-apply-lost-browser-reply-and-recovery',async()=>{
    let value=await detail(id,prepared.edition_id),intercepted=false;
    await openProject(id,'Native review',prepared.edition_id);
    const existing=value.actions.find(item=>item.kind==='apply');
    if(value.edition.state==='REVIEWED'&&!existing){
      await page.route('**/api/projects/*/editions/*/actions',async route=>{
        const request=route.request(),body=request.method()==='POST'?request.postDataJSON():null;
        if(body?.action!=='apply'||intercepted)return route.continue();
        intercepted=true;
        const response=await route.fetch(),raw=await response.body();
        requireValue(response.ok(),'The original apply action was rejected before the deliberate browser interruption.');
        const returned=JSON.parse(raw.toString('utf8'));
        atomic(path.join(entry.output,'browser-response-discarded.json'),{
          operation_id:OPERATION,request_id:body.request_id,review_digest:body.review_digest,
          action_id:returned.action.id,response_status:response.status(),response_sha256:sha(raw)});
        await route.abort('failed');
      });
      await page.getByRole('button',{name:'Apply reviewed changes',exact:true}).click();
      await page.getByRole('dialog').getByRole('button',{name:'Apply reviewed changes',exact:true}).click();
    }
    value=await waitEdition(id,prepared.edition_id,['APPLIED']);
    await page.unroute('**/api/projects/*/editions/*/actions');
    requireValue(value.result.review_digest===review.review_digest&&value.result.counts.CREATE===0,'The applied native receipt differs from the selected review.');
    const originalIds=original.resolved.map(x=>[x.kind,x.key,x.id].join(':')).sort();
    const actualIds=value.result.resolved.map(x=>[x.kind,x.key,x.id].join(':')).sort();
    requireValue(JSON.stringify(originalIds)===JSON.stringify(actualIds),'The corrected desk edition created replacement inventory.');
    const applyActions=value.actions.filter(item=>item.kind==='apply');
    requireValue(applyActions.length===1,'The browser recovery created a second apply action.');
    await waitAction(id,prepared.edition_id,applyActions[0].id);
    await page.reload();
    const recovered=await nativeRecovery(id,prepared.edition_id);
    value=recovered.detail;
    requireValue(value.edition.state==='APPLIED'&&recovered.action.state==='COMPLETE',
      'The original native recovery has not completed.');
    // Reopen the original saved action, including when the carrier ended before
    // the deliberate response-discard file could be written.
    const current=await detail(id,prepared.edition_id);
    requireValue(current.actions.filter(item=>item.kind==='apply').length===1&&current.result.receipt_sha256===value.result.receipt_sha256,
      'The same original receipt did not survive native recovery.');
    const marker=path.join(entry.output,'browser-response-discarded.json');
    return {operation_id:prepared.operation_id,review_digest:review.review_digest,
      receipt_sha256:current.result.receipt_sha256,journal:current.result.journal,
      resolved:current.result.resolved,apply_action_id:applyActions[0].id,
      transport:fs.existsSync(marker)?JSON.parse(fs.readFileSync(marker,'utf8')):
        {outcome:'ORIGINAL_APPLY_RECOVERED_AFTER_CARRIER_INTERRUPTION'}};
  });
  const delivery=await stage('08-report-and-complete-handover',async()=>{
    await localAction(id,prepared.edition_id,'report','Create report');
    await localAction(id,prepared.edition_id,'handover','Build handover');
    await openProject(id,'Delivery',prepared.edition_id);
    const files=[];
    for(const [choice,name]of [['handover.zip','inventory-handover.zip'],['report.html','inventory-review.html'],
      ['result.json','native-inventory-result.json'],['resolved.csv','resolved-objects.csv'],
      ['request.json','request.json'],['mapping.json','mapping.json']])files.push(await download(choice,name));
    const native=JSON.parse(fs.readFileSync(path.join(entry.output,'native-inventory-result.json'),'utf8'));
    requireValue(native.receipt_sha256===applied.receipt_sha256,'The delivered native JSON has another receipt.');
    requireValue(fs.readFileSync(path.join(entry.output,'inventory-review.html'),'utf8').includes(prepared.operation_id),
      'The readable report does not identify its actual operation.');
    await screenshot('desk-desktop-delivery.png');
    return {files,receipt_sha256:native.receipt_sha256};
  });
  await stage('09-fresh-customer-receiving-and-native-reopen',async()=>{
    await connect();
    const second=await getOrCreate('Received customer handover · b9d2');
    const file=delivery.files.find(item=>item.selection==='handover.zip');
    requireValue(sha(fs.readFileSync(file.path))===file.sha256,'The selected complete customer archive changed.');
    let value=await project(second.id),edition=receivedEdition(value,prepared.operation_id);
    if(!edition){value=await restoreArchive(second.id,file.path);edition=receivedEdition(value,prepared.operation_id);}
    requireValue(edition?.operation_id===prepared.operation_id,'The fresh customer workspace restored another operation.');
    await openProject(second.id,'Native review',edition.id);
    let current=await detail(second.id,edition.id);
    const recovered=await nativeRecovery(second.id,edition.id);
    current=recovered.detail;
    requireValue(recovered.action.state==='COMPLETE','The received native journal recovery has not completed.');
    requireValue(current.result.receipt_sha256===applied.receipt_sha256
      &&current.actions.every(item=>item.kind!=='apply'),'Fresh receiving must read the original native journal without another apply.');
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await screenshot('desk-mobile-customer-reopened.png',390);
    return {project_id:second.id,edition_id:edition.id,operation_id:edition.operation_id,
      receipt_sha256:current.result.receipt_sha256,journal:current.result.journal,
      actions:current.actions.map(({id,kind,state})=>({id,kind,state}))};
  });
  requireValue(result.page_errors.length===0,'The original browser emitted page errors.');
  result.state='COMPLETE';result.completed_at=new Date().toISOString();delete result.error;
  save();atomic(path.join(entry.output,'desk-result.json'),result);
}catch(error){
  result.state='CONTINUATION_REQUIRED';result.error={message:error.message,stack:error.stack};
  save();throw error;
}finally{
  await context?.close().catch(()=>{});await browser.close();
  console.log(JSON.stringify({operation_id:OPERATION,state:result.state,steps:result.steps.length,
    error:result.error?.message,output:entry.output}));
}
