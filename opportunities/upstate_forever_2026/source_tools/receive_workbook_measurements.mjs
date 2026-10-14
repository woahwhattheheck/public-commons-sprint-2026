/** Continue an original authenticated Workbench receiving course; no new host/browser. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function receiveWorkbookMeasurements({page,api,openView,workspace,
  sourceCollectionId,sourceId,kind,label,reviewer,mapping,interpretation='',identifierColumns=[],output}){
  assert(page&&typeof api==='function'&&typeof openView==='function');
  assert(['wqp','stations'].includes(kind)&&label&&reviewer);
  assert(Array.isArray(identifierColumns)&&identifierColumns.length<=16384&&
    identifierColumns.every(value=>typeof value==='string'&&/^c(?:0|[1-9][0-9]*)$/.test(value))&&
    new Set(identifierColumns).size===identifierColumns.length,'Choose each original identifier column once.');
  identifierColumns=[...identifierColumns].sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
  const root=resolve(output);await mkdir(root,{recursive:true});
  const checkpoint=join(root,'workbook-measurements-operation.json');
  let record;try{record=JSON.parse(await readFile(checkpoint,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const intent={workspace,sourceCollectionId,sourceId,kind,label,reviewer,mapping,interpretation};
  // Empty choices preserve the exact original checkpoint shape.
  if(identifierColumns.length)intent.identifierColumns=identifierColumns;
  if(record)assert.deepEqual(record.intent,intent,'Keep the original complete receiving selection.');
  else record={schema:'eco.workbook-measurements-receiving/v1',intent,createdAt:new Date().toISOString(),artifacts:[]};
  async function save(){const pending=checkpoint+'.pending';await writeFile(pending,JSON.stringify(record,null,2)+'\n');await rename(pending,checkpoint);}
  async function artifact(path){const raw=await readFile(path);const value={path,bytes:raw.length,sha256:sha(raw)};record.artifacts=record.artifacts.filter(x=>x.path!==path);record.artifacts.push(value);await save();return raw;}
  async function image(name){const path=join(root,name);await page.screenshot({path,fullPage:true});await artifact(path);}
  async function native(path,method='GET',payload){
    const value=await api('/api/measurements/rpc',{method:'POST',body:{workspace,method,path,payload}});
    assert(value.status<400,JSON.stringify(value));return JSON.parse(value.body);
  }
  async function download(control,name){
    const waiting=page.waitForEvent('download',{timeout:30000});await control.click();
    const file=await waiting,path=join(root,name);await file.saveAs(path);return artifact(path);
  }
  async function catalog(){return api('/api/client-measurement/catalog',{method:'POST',body:{workspace}});}
  const original=await catalog(),source=original.sources.find(s=>s.source_collection_id===sourceCollectionId&&s.source_id===sourceId);
  assert(source,'Receive the actual retained worksheet in this original workspace.');
  if(record.complete){
    for(const file of record.artifacts){const raw=await readFile(file.path);assert.equal(raw.length,file.bytes);assert.equal(sha(raw),file.sha256);}
    const saved=await native('/intake/'+record.preparationId+'/export');
    assert.equal(saved.workspaceId,record.targetWorkspaceId);
    const edition=saved.editions.find(e=>e.id===record.preparationId&&e.revision===record.importReceipt.revision);
    assert(edition);assert.deepEqual(edition.value.lineage?.identifier_formatting?.columns||[],identifierColumns);
    assert(saved.receipts.some(r=>JSON.stringify(r)===JSON.stringify(record.importReceipt)));
    const copied=await native('/intake/'+record.copyId+'/export');assert.deepEqual(copied.originals,saved.originals);
    return record;
  }
  await page.setViewportSize({width:1440,height:1000});
  await openView('client-measurement-sources');
  const desk=page.locator('.ci-desk').filter({has:page.getByRole('heading',{name:'Prepare workbook measurements',exact:true})});
  await desk.locator('select[name=source]').selectOption(sourceCollectionId+'|'+sourceId);
  await desk.locator('select[name=kind]').selectOption(kind);
  const identifierInputs=desk.locator('[name=identifier_column]');
  const availableIdentifiers=await identifierInputs.evaluateAll(inputs=>inputs.map(input=>input.value));
  assert(identifierColumns.every(value=>availableIdentifiers.includes(value)),
    'Select identifier columns from this actual retained workbook.');
  for(let index=0;index<availableIdentifiers.length;index++)
    await identifierInputs.nth(index).setChecked(identifierColumns.includes(availableIdentifiers[index]));
  await desk.locator('[name=label]').fill(label);await desk.locator('[name=reviewer]').fill(reviewer);
  await desk.locator('[name=note]').fill('Original retained workbook receiving; scientific mapping is reviewed in Measurements.');
  if(!record.taskId){
    if(record.submitted)throw Error('The original UI submission has an unresolved receipt. Recover its original task ID from the retained workbench queue before continuing; do not click again.');
    record.submitted=true;record.targetWorkspaceId=original.target_workspace_id;await save();
    const receiving=page.waitForResponse(response=>{
      const request=response.request();if(request.method()!=='POST'||!new URL(response.url()).pathname.endsWith('/api/actions'))return false;
      try{const body=request.postDataJSON();return body.action==='client-measurement.prepare'&&body.payload?.source_id===sourceId&&body.payload?.source_collection_id===sourceCollectionId&&body.payload?.label===label;}catch{return false;}
    },{timeout:30000});
    await desk.getByRole('button',{name:'Save worksheet preparation',exact:true}).click();
    const response=await receiving;assert(response.ok());
    const task=await response.json();assert(task.id);
    record.taskId=task.id;await save();
  }
  let prepared;
  const start=Date.now();
  for(;;){
    const visible=(await catalog()).operations.some(row=>row.id===record.taskId);
    const value=visible?await api('/api/client-measurement/result',{method:'POST',body:{workspace,id:record.taskId}}):{state:'not-visible'};
    if(value.state==='complete'){prepared=value;break;}
    if(value.state==='failed')throw Error('Continue the original preparation failure: '+JSON.stringify(value.error));
    assert(Date.now()-start<600000,'Retain the original queued operation; it has not completed yet.');await sleep(750);
  }
  record.preparationId=prepared.preparation_id;assert.equal(prepared.target_workspace_id,record.targetWorkspaceId);await save();
  const unedited=await native('/intake/'+record.preparationId);
  assert.equal(unedited.value.lineage.original.sha256,source.sha256);
  assert.equal(unedited.value.lineage.source_collection_id,sourceCollectionId);
  assert.equal(unedited.value.lineage.source_id,sourceId);
  assert.deepEqual(unedited.value.lineage.identifier_formatting?.columns||[],identifierColumns,
    'The saved preparation must retain this exact reviewed identifier choice.');
  // Review in the actual existing Measurements component, not a recreated form.
  await openView('measured-observations');
  const guided=page.locator('.mi.mw-panel');await guided.locator('[data-select]').selectOption(record.preparationId);
  await guided.locator('[data-edit]').waitFor();
  for(const [field,column]of Object.entries(mapping))await guided.locator('[data-map="'+field+'"]').selectOption(column);
  if(interpretation)await guided.locator('[name=interpretation]').selectOption(interpretation);
  await guided.locator('[data-action=preview]').click();
  await guided.locator('[data-confirm]').waitFor();
  const beforeImport=await native('/intake/'+record.preparationId);
  const preview=await native('/intake/'+record.preparationId+'/preview','POST',{revision:beforeImport.revision});
  assert(preview.native?.rows>0,'Review actual rejected rows instead of inventing accepted data.');
  assert((await guided.innerText()).includes(source.filename));
  await image('workbook-measurements-desktop.png');
  await guided.locator('[data-confirm]').check();await guided.locator('[data-action=import]').click();
  await guided.getByText('Native source retained:',{exact:false}).waitFor();
  const imported=await native('/intake/'+record.preparationId);
  record.importReceipt=imported.receipt;assert(record.importReceipt);await save();
  const replay=await native('/intake/'+record.preparationId+'/import','POST',{revision:record.importReceipt.revision,previewSha:record.importReceipt.previewSha});
  assert.deepEqual(replay,record.importReceipt);
  const originalBytes=await download(guided.locator('[data-action=original]'),'original-'+source.filename.replace(/[\\/:*?"<>|]/g,'_'));
  assert.equal(originalBytes.length,source.bytes);assert.equal(sha(originalBytes),source.sha256);
  const projected=await download(guided.locator('[data-action=derived]'),'selected-worksheet.csv');
  assert.equal(sha(projected),imported.value.lineage.derived.sha256);
  const lineage=JSON.parse(await download(guided.locator('[data-action=lineage]'),'worksheet-lineage.json'));
  assert.deepEqual(lineage,imported.value.lineage);
  const exported=JSON.parse(await download(guided.locator('[data-action=project]'),'complete-measurement-preparation.json'));
  assert(exported.editions.some(e=>e.revision===record.importReceipt.revision));
  const originalBinary=exported.originals.find(x=>x.sha256===source.sha256);
  assert.deepEqual(Buffer.from(originalBinary.data,'base64'),originalBytes);
  const working=JSON.parse(await download(guided.locator('[data-action=rescue]'),'unfinished-measurement-preparation.json'));
  assert.deepEqual(Buffer.from(working.working.originals[0].data,'base64'),originalBytes);
  await page.reload({waitUntil:'domcontentloaded'});await openView('measured-observations');
  const reopened=page.locator('.mi.mw-panel');await reopened.locator('[data-select]').selectOption(record.preparationId);
  await reopened.locator('[data-edit]').waitFor();assert((await reopened.innerText()).includes(source.filename));
  const after=await native('/intake/'+record.preparationId);
  assert.deepEqual(after.receipt,record.importReceipt);
  assert.deepEqual(after.value.lineage,lineage);
  // The complete native reader receives the exact exported history as a separate copy.
  if(!record.copyId){
    if(record.copySubmitted)throw Error('Recover the original complete-copy request from this browser preparation before continuing; do not create another copy.');
    record.copySubmitted=true;await save();
    const copiedResponse=page.waitForResponse(response=>{
      const request=response.request();if(request.method()!=='POST'||!new URL(response.url()).pathname.endsWith('/api/measurements/rpc'))return false;
      try{const body=request.postDataJSON();return body.path==='/intake/copy'&&body.method==='POST';}catch{return false;}
    },{timeout:30000});
    await reopened.locator('[data-project]').setInputFiles(join(root,'complete-measurement-preparation.json'));
    const response=await copiedResponse;assert(response.ok());const envelope=await response.json();assert(envelope.status<400);
    record.copyId=JSON.parse(envelope.body).id;await save();
    await reopened.getByText('Complete original history received as a separate native preparation.',{exact:false}).waitFor();
  }else await reopened.locator('[data-select]').selectOption(record.copyId);
  const copiedId=record.copyId;
  assert.notEqual(copiedId,record.preparationId);
  const copied=await native('/intake/'+copiedId+'/export');
  assert.deepEqual(copied.originals,exported.originals);
  assert.deepEqual(copied.origins[0].project,exported);
  record.copyId=copiedId;
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await image('workbook-measurements-phone.png');
  record.complete=true;record.completedAt=new Date().toISOString();
  record.visualInspection={state:'awaiting_producer_review',artifacts:record.artifacts.map(file=>({...file})),viewports:[{width:1440,height:1000},{width:390,height:844}],scope:'Open and LOOK at the captured screens and every recipient attachment in its normal viewer; record the producing owner’s actual observations and any repaired output.'};
  await save();return record;
}
