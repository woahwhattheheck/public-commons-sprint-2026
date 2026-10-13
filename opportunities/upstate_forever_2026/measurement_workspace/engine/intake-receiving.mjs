#!/usr/bin/env node
/** Complete original station-file -> guided UI -> native import -> portable receiving.
 * Uses the eight original SCDES/WQP station rows already shipped in source_data.
 * No Tim observations, provider request, model run, or shared Workspace mutation.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MeasurementWorkspace} from './workspace.mjs';
import {inspectIntake,saveIntake,previewSavedIntake,importIntake,readIntake,exportIntakes,copyIntake} from './intake.mjs';
const options={};for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i].startsWith('--')||!process.argv[i+1])throw Error('Use --name value');options[process.argv[i].slice(2)]=process.argv[i+1];}
if(!options.output)throw Error('Supply a separately owned --output directory.');
const root=path.resolve(options.output),sourceRoot=fileURLToPath(new URL('../../',import.meta.url)),sourceFile=path.resolve(options.file||path.join(sourceRoot,'source_data/wqp_eight_20261013/wqp_eight_native.csv'));
const hash=x=>createHash('sha256').update(x).digest('hex'),raw=await fs.readFile(sourceFile),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
assert.equal(hash(raw),'21022c3f3b46fb0bae6e341cde74880ec2e395528592f9168742f53af60b533e','Use the unchanged original eight-station source.');
await fs.mkdir(root,{recursive:true});
const selection={operation:'ECO-GUIDED-MEASUREMENT-INTAKE-22B7-20261013',sourceFile,sourceSha:hash(raw),bytes:raw.length};
async function exact(file,value){const data=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');try{await fs.writeFile(file,data,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(await fs.readFile(file),data,'Existing complete output differs: '+file);}return data;}
await exact(path.join(root,'selection.json'),selection);
try{const done=JSON.parse(await fs.readFile(path.join(root,'COMPLETE.json'),'utf8'));for(const f of done.files)assert.equal(hash(await fs.readFile(path.join(root,f.path))),f.sha256);console.log(JSON.stringify(done));process.exit(0);}catch(e){if(e.code!=='ENOENT')throw e;}
const files=[];
const phasePath=path.join(root,'browser-progress.json');let phase={};try{phase=JSON.parse(await fs.readFile(phasePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
async function checkpoint(values){phase={...phase,...values};await fs.writeFile(phasePath+'.pending',JSON.stringify(phase,null,2)+'\n');await fs.rename(phasePath+'.pending',phasePath);}
async function keep(name,value){const b=await exact(path.join(root,name),value);files.push({path:name,bytes:b.length,sha256:hash(b)});}
let w=new MeasurementWorkspace(path.join(root,'native'));
try{
  const inspected=inspectIntake(w,{kind:'stations',text,mapping:{station:''}});
  assert.equal(inspected.rawRows,8);assert.equal(inspected.native,null);assert(inspected.missing.includes('station'));assert.equal(inspected.headers[0],'OrganizationIdentifier');
  const value={kind:'stations',label:'Original SCDES eight station locations',sourceName:path.basename(sourceFile),sourceSha:hash(raw),mapping:{station:''},reviewer:'Original source receiving exercise',note:'Verify the existing complete station file without generating measurements.',context:'Retained public WQP source, retrieved 2026-10-13; no Tim input.'};
  const first=saveIntake(w,{id:'original-eight-stations',expectedRevision:0,value,text});
  const corrected={...value,mapping:{station:'MonitoringLocationIdentifier'}};
  const second=saveIntake(w,{id:first.id,expectedRevision:1,value:corrected});
  assert.equal(saveIntake(w,{id:first.id,expectedRevision:0,value,text}).revision,1,'Lost first-save response must recover edition1, not adopt edition2.');
  const reviewed=previewSavedIntake(w,first.id,2);assert.equal(reviewed.native.rows,8);
  const receipt=importIntake(w,first.id,{revision:2,previewSha:reviewed.previewSha});
  assert.deepEqual(importIntake(w,first.id,{revision:2,previewSha:reviewed.previewSha}),receipt);
  assert.equal(w.summary().stations.length,8);
  const project=exportIntakes(w,first.id);
  const copied=copyIntake(w,{id:'original-eight-copy',project});assert.equal(copied.revision,2);
  saveIntake(w,{id:copied.id,expectedRevision:2,value:{...copied.value,note:'A later reviewer edition is retained.'}});
  assert.equal(copyIntake(w,{id:copied.id,project}).revision,2,'Lost copy response must not adopt a later edit.');
  assert.throws(()=>saveIntake(w,{id:copied.id,expectedRevision:2,value:{...copied.value,note:'An unseen stale overwrite must conflict.'}}),/changed/);
  await keep('native-preparation.json',project);
  let portable=w.portable();try{const prior=JSON.parse(await fs.readFile(path.join(root,'native-complete-workspace.json'),'utf8'));assert.deepEqual({...prior,createdAt:''},{...portable,createdAt:''});portable=prior;}catch(e){if(e.code!=='ENOENT')throw e;}await keep('native-complete-workspace.json',portable);
  const restored=new MeasurementWorkspace(path.join(root,'native-received'));
  try{
    if(!restored.summary().imports.length)restored.receive(portable);
    assert.equal(restored.summary().stations.length,8);
    assert.deepEqual(exportIntakes(restored),exportIntakes(w));
    assert.equal(restored.source(receipt.importId).content,text);
  }finally{restored.close();}
}finally{w.close();}
if(!options.playwright||!options.chromium)throw Error('Native source receiving is retained. Supply existing --playwright module and --chromium executable to finish the same browser course.');
const {chromium}=await import(pathToFileURL(path.resolve(options.playwright)).href);
const service=spawn(process.execPath,[fileURLToPath(new URL('./cli.mjs',import.meta.url)),'serve','--workspace',path.join(root,'browser-native'),'--port',String(phase.port||0)],{stdio:['ignore','pipe','pipe']});
let errors='';service.stderr.on('data',x=>{errors+=x;});
let browser;
try{
const endpoint=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Original server did not become ready: '+errors)),20000);service.once('error',error=>{clearTimeout(timer);reject(error);});service.once('exit',code=>{clearTimeout(timer);reject(Error('Original server exited '+code+': '+errors));});service.stdout.on('data',x=>{out+=x;const line=out.split('\n').find(v=>v.startsWith('{'));if(line){clearTimeout(timer);const v=JSON.parse(line);resolve('http://127.0.0.1:'+v.port);}});});
  await checkpoint({port:Number(new URL(endpoint).port)});
  const context=await chromium.launchPersistentContext(path.join(root,'browser-profile'),{executablePath:path.resolve(options.chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],viewport:{width:1365,height:1000},acceptDownloads:true});browser=context;
  const page=context.pages()[0]||await context.newPage();
  const browserErrors=[];page.on('pageerror',e=>browserErrors.push(String(e)));
  await page.goto(endpoint);const box=page.locator('.mi');
  await box.locator('[data-status]').filter({hasText:'Saved preparations loaded'}).waitFor();
  if(phase.id){await box.locator('[data-select]').selectOption(phase.id);await box.locator('[data-map=station]').waitFor();}
  else{
    await box.locator('[data-file-form] [name=kind]').selectOption('stations');
    await box.locator('[name=file]').setInputFiles(sourceFile);
    await box.getByRole('button',{name:'Open and inspect original',exact:true}).click();
    await box.locator('[data-map=station]').waitFor();
    await checkpoint({id:await box.locator('[data-select]').inputValue()});
  }
  if(!phase.initialSaved){
    await box.locator('[data-map=station]').selectOption('');
    await box.getByRole('button',{name:'Save preparation',exact:true}).click();
    await box.locator('[data-status]').filter({hasText:'Preparation saved'}).waitFor();
    await checkpoint({initialSaved:true});
  }
  const id=phase.id;
  await page.reload();await page.locator('.mi [data-select] option').nth(1).waitFor({state:'attached'});
  await page.locator('.mi [data-select]').selectOption(id);
  await page.locator('.mi [data-map=station]').waitFor();
  if(!phase.mapped){const currentMapping=await page.locator('.mi [data-map=station]').inputValue();if(currentMapping!==''){assert.equal(currentMapping,'MonitoringLocationIdentifier');assert.equal(await page.locator('.mi [name=reviewer]').inputValue(),'Original source receiving exercise');await checkpoint({mapped:true});}}
  await page.locator('.mi [data-map=station]').selectOption('MonitoringLocationIdentifier');
  await page.locator('.mi [name=reviewer]').fill('Original source receiving exercise');
  await page.locator('.mi').getByRole('button',{name:'Review mapped measurements',exact:true}).click();
  await page.locator('.mi [data-confirm]').waitFor();await checkpoint({mapped:true});
  await page.screenshot({path:path.join(root,'guided-intake-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(root,'guided-intake-390.png'),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Unexpected document-wide overflow at390px.');
  await page.locator('.mi [data-confirm]').check();
  await page.locator('.mi').getByRole('button',{name:'Import reviewed source',exact:true}).click();
  await page.locator('.mi [data-status]').filter({hasText:'Reviewed source imported'}).waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('.mi').getByRole('button',{name:'Download complete preparation',exact:true}).click()]);
  await download.saveAs(path.join(root,'browser-preparation.json'));
  const project=JSON.parse(await fs.readFile(path.join(root,'browser-preparation.json'),'utf8'));assert.equal(project.sources[0].text,text);assert(project.editions.length>=2);
  const [original]=await Promise.all([page.waitForEvent('download'),page.locator('.mi').getByRole('button',{name:'Download original',exact:true}).click()]);
  await original.saveAs(path.join(root,'browser-original.csv'));assert.deepEqual(await fs.readFile(path.join(root,'browser-original.csv')),raw);
  const response=await context.request.get(endpoint+'/api/measurement-workspace/portable');assert(response.ok());const portable=await response.json();assert.equal(portable.tables.stations.length,8);
  await fs.writeFile(path.join(root,'browser-complete-workspace.json'),JSON.stringify(portable,null,2)+'\n');
  await context.close();browser=null;
  const cold=await chromium.launchPersistentContext(path.join(root,'browser-profile'),{executablePath:path.resolve(options.chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],viewport:{width:390,height:844},acceptDownloads:true});browser=cold;const fresh=cold.pages()[0]||await cold.newPage();await fresh.goto(endpoint);
  await fresh.locator('.mi [data-select] option').nth(1).waitFor({state:'attached'});await fresh.locator('.mi [data-select]').selectOption(id);await fresh.locator('.mi [data-map=station]').waitFor();
  assert.equal(await fresh.locator('.mi [name=reviewer]').inputValue(),'Original source receiving exercise');
  await fresh.screenshot({path:path.join(root,'guided-intake-cold-reopen.png'),fullPage:true});
  await cold.close();browser=null;
  const received=new MeasurementWorkspace(path.join(root,'browser-received'));
  try{if(!received.summary().imports.length)received.receive(portable);assert.equal(received.summary().stations.length,8);assert.deepEqual(exportIntakes(received),portable.intake);}finally{received.close();}
  assert.deepEqual(browserErrors,[]);
  for(const name of ['guided-intake-desktop.png','guided-intake-390.png','guided-intake-cold-reopen.png','browser-preparation.json','browser-original.csv','browser-complete-workspace.json']){const b=await fs.readFile(path.join(root,name));files.push({path:name,bytes:b.length,sha256:hash(b)});}
  const result={...selection,status:'COMPLETE',completedAt:new Date().toISOString(),nativeStations:8,browserStations:8,browserErrors,files,visualReview:'Screenshots retained for actual human/agent visual inspection; automated checks alone do not claim that inspection.'};
  await exact(path.join(root,'COMPLETE.json'),result);console.log(JSON.stringify(result));
}finally{await browser?.close();service.kill('SIGTERM');await new Promise(resolve=>{if(service.exitCode!==null||service.signalCode!==null||!service.pid)resolve();else service.once('exit',resolve);});await fs.writeFile(path.join(root,'service-stderr-'+Date.now()+'.log'),errors,{flag:'wx'});}
