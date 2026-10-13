#!/usr/bin/env node
/**
 * Source versions receiving chapter for the existing Measurements application.
 * Input is a complete ACTUAL retained portable workspace. All receiving edits
 * stay in a separately owned copy. No source row or publisher edition is invented.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {MeasurementWorkspace} from './workspace.mjs';
import {reconciliationCatalog,reconciliationGroup,reconciliationGroups,reconciliationReport,reconciliationCSV} from './source_reconciliation.mjs';
import {sourceReviewHTML} from '../web/source_reconciliation.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ordered=rows=>rows.map(row=>JSON.stringify(row)).sort();
const portableComparable=value=>({...value,createdAt:''});
const immutableTables=['imports','records','import_records','stations','mappings'];
const schema='upstate.source-versions-receiving/v1';
async function exists(file){try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function assertOwnedTree(directory){
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name),stat=await fs.lstat(file);
    assert(!stat.isSymbolicLink(),'Owned receiving paths cannot alias the original project: '+file);
    if(stat.isDirectory())await assertOwnedTree(file);
    else assert(stat.isFile()&&stat.nlink===1,'Owned receiving files cannot share another writable source inode: '+file);
  }
}
async function checkPriorService(root){
  const file=path.join(root,'service-session.json');
  if(!await exists(file))return;
  const previous=JSON.parse(await fs.readFile(file,'utf8'));
  if(previous.state==='stopped')return;
  assert(Number.isSafeInteger(previous.pid)&&previous.pid>0,'Retained receiving service has no verifiable process ID; inspect its original log.');
  let alive=true;
  try{process.kill(previous.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}
  assert(!alive,'An earlier owned receiving server may still be active at PID '+previous.pid+'. Preserve it and inspect service-session.json before resuming; no second server has started.');
}
async function exact(file,value){
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:json(value));
  await fs.mkdir(path.dirname(file),{recursive:true});
  try{await fs.writeFile(file,bytes,{flag:'wx'});}
  catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(await fs.readFile(file),bytes,'Retained output differs; use another owned output directory: '+file);}
  return bytes;
}
async function atomic(file,value){
  const pending=file+'.'+process.pid+'.'+randomUUID()+'.pending';
  const handle=await fs.open(pending,'wx');
  try{await handle.writeFile(json(value));await handle.sync();}
  catch(error){await handle.close();await fs.unlink(pending).catch(()=>{});throw error;}
  await handle.close();
  try{await fs.rename(pending,file);}
  catch(error){await fs.unlink(pending).catch(()=>{});throw error;}
}
async function regular(file,limit=128*1024*1024){
  const stat=await fs.lstat(file);assert(stat.isFile()&&!stat.isSymbolicLink(),'Use an original regular file: '+file);
  assert(stat.size<=limit,'Input exceeds the original 128 MiB receiving limit.');
  return fs.readFile(file);
}
function unchangedOriginals(original,current){
  for(const key of immutableTables)assert.deepEqual(ordered(current.tables[key]),ordered(original.tables[key]),'Original '+key+' changed');
  if(original.intake)assert.deepEqual(current.intake,original.intake,'Original guided-intake history changed');
}
async function snapshot(directory){
  const workspace=new MeasurementWorkspace(directory);
  try{return workspace.portable();}finally{workspace.close();}
}
function choose(workspace,options){
  const catalog=reconciliationCatalog(workspace);
  let selected;
  if(options.groupId)selected=reconciliationGroup(workspace,options.groupId).group;
  else{
    const first=reconciliationGroups(workspace,{mode:catalog.counts.conflicts?'conflicts':'all',limit:1}).groups[0];
    assert(first,'Supply a retained Measurements workspace with actual measurement records.');
    selected=reconciliationGroup(workspace,first.id).group;
  }
  let recordId=null;
  if(options.recordId){assert(selected.records.some(row=>row.id===options.recordId),'The requested record is outside this original group.');assert(selected.variant_count>1,'This actual group has no alternative version to select/reset.');recordId=options.recordId;}
  if(options.exerciseSelection==='first-retained'&&selected.variant_count>1&&!recordId)recordId=selected.records[0].id;
  return {catalog,group_id:selected.id,record_id:recordId,source_ids:[...new Set(selected.occurrences.map(row=>row.id))].slice(0,2),
    mode:selected.variant_count>1?'conflicts':'all',actual_variants:selected.variant_count,
    decision_course:recordId?'explicit receiving-copy selection then reset':selected.variant_count>1?'not requested; actual conflicting originals retained':'not applicable; supplied original group has one version'};
}

/** Prepare once or reopen the SAME owned receiving copy; input bytes are untouched. */
export async function prepareSourceVersionReceiving(options){
  assert(options.portableFile&&options.output&&options.reviewer?.trim()&&options.reason?.trim(),'Supply actual --portable, separately owned --output, --reviewer and --reason.');
  assert(!options.recordId||options.groupId,'An explicit record requires its exact --group-id.');
  assert(!options.exerciseSelection||options.exerciseSelection==='first-retained','Use --exercise-selection first-retained only for an explicit temporary receiving exercise.');
  const source=await fs.realpath(path.resolve(options.portableFile)),raw=await regular(source);
  const portable=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  assert.equal(portable.format,'upper-savannah-measurements');assert.equal(portable.version,1);
  assert(portable.tables?.imports?.length&&portable.tables?.records?.length,'The input must contain actual retained source bodies and measurement records.');
  const requested=path.resolve(options.output);
  await fs.mkdir(path.dirname(requested),{recursive:true});
  const parent=await fs.realpath(path.dirname(requested)),root=path.join(parent,path.basename(requested));
  assert(!(source===root||source.startsWith(root+path.sep)),'Keep the original input outside the owned receiving output.');
  if(await exists(root)){assert((await fs.lstat(root)).isDirectory()&&!(await fs.lstat(root)).isSymbolicLink(),'The receiving output must be its own directory.');assert(await exists(path.join(root,'selection.json')),'Refusing a non-owned existing output directory.');}
  else await fs.mkdir(root);
  await assertOwnedTree(root);
  await checkPriorService(root);
  const reaches=options.reachesFile?await regular(await fs.realpath(options.reachesFile)):null;
  if(reaches)assert(Array.isArray(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(reaches))),'Use the original complete reaches.json array.');
  const selection={schema,source_file:source,source_sha256:hash(raw),source_bytes:raw.length,
    reviewer:options.reviewer.trim(),reason:options.reason.trim(),group_id:options.groupId||null,record_id:options.recordId||null,
    exercise_selection:options.exerciseSelection||null,reaches_sha256:reaches?hash(reaches):null,
    note:'Receiving-copy decisions are demonstrations attributed below, not a new publisher edition or customer scientific selection.'};
  await exact(path.join(root,'selection.json'),selection);
  await exact(path.join(root,'original-workspace.json'),raw);
  const directory=path.join(root,'owned-workspace');
  await fs.mkdir(directory,{recursive:true});
  if(reaches){await exact(path.join(root,'original-reaches.json'),reaches);await exact(path.join(directory,'reaches.json'),reaches);}
  const workspace=new MeasurementWorkspace(directory);
  let plan,current;
  try{
    if(!workspace.summary().imports.length)workspace.receive(portable);
    current=workspace.portable();unchangedOriginals(portable,current);
    plan=choose(workspace,options);
    // Existing reports must already satisfy the maintained original evidence checks.
    for(const row of current.tables.exports.filter(row=>row.kind==='source-reconciliation'))reconciliationReport(workspace,row.id);
  }finally{workspace.close();}
  const planPath=path.join(root,'plan.json');
  if(await exists(planPath)){const prior=JSON.parse(await fs.readFile(planPath,'utf8'));assert.equal(prior.group_id,plan.group_id);assert.equal(prior.record_id,plan.record_id);plan=prior;}
  else await exact(planPath,plan);
  await exact(path.join(root,'original-catalogue.json'),plan.catalog);
  for(const s of portable.tables.imports){assert.equal(hash(s.content),s.sha);await exact(path.join(root,'originals',s.id+(s.kind==='usgs-daily'?'.geojson':'.csv')),s.content);}
  return {root,directory,portable,selection,plan,current};
}
async function phaseFile(root,patch){
  const file=path.join(root,'browser-progress.json');
  let prior={};if(await exists(file))prior=JSON.parse(await fs.readFile(file,'utf8'));
  if(patch){prior={...prior,...patch};await atomic(file,prior);}
  return prior;
}
async function captureDownload(page,root,name,click){
  const [download]=await Promise.all([page.waitForEvent('download'),click()]);
  const failure=await download.failure();assert.equal(failure,null,'Browser download failed');
  const temporary=path.join(root,name+'.download');
  await download.saveAs(temporary);
  const bytes=await fs.readFile(temporary);await exact(path.join(root,name),bytes);await fs.unlink(temporary);return bytes;
}
async function fetchJSON(page,endpoint,suffix){
  const response=await page.request.get(endpoint+'/api/measurement-workspace'+suffix);
  assert(response.ok(),'Original Measurements request failed: '+suffix+' ('+response.status()+')');
  return response.json();
}
async function ready(box,message){
  await box.locator('[data-msr-status]').filter({hasText:message}).waitFor();
  await box.locator('button[data-msr-action=refresh]:not([disabled])').waitFor();
}
async function openDesk(page,endpoint,plan){
  await page.goto(endpoint);
  await page.locator('[data-tab="source-review"]').click();
  const box=page.locator('.msr');await ready(box,'Original source');
  const filters=box.locator('form[data-msr-form=filters]');
  await filters.locator('[name=first]').selectOption(plan.source_ids[0]||'');
  await filters.locator('[name=second]').selectOption(plan.source_ids[1]||'');
  await filters.locator('[name=mode]').selectOption(plan.mode);
  await filters.getByRole('button',{name:'Compare retained sources',exact:true}).click();
  await ready(box,'Original source');
  for(let n=0;n<100000;n++){
    const button=box.locator('[data-msr-group="'+plan.group_id+'"]');
    if(await button.count()){await button.click();await ready(box,'Every original source');return box;}
    const next=box.locator('[data-msr-action=next]');
    assert(await next.isEnabled(),'The selected original group is absent from the applied original-source scope.');
    const old=await box.locator('[data-msr-group]').first().getAttribute('data-msr-group');
    await next.click();
    await page.waitForFunction(old=>document.querySelector('.msr [data-msr-group]')?.getAttribute('data-msr-group')!==old,old);
    await ready(box,'Original source');
  }
  throw Error('Original group paging did not terminate.');
}
async function decision(page,box,action,plan,selection,reason){
  const form=box.locator('form[data-msr-form=decision]');
  await form.locator('[name=action]').selectOption(action);
  if(action==='select')await form.locator('[name=record_id]').selectOption(plan.record_id);
  await form.locator('[name=reviewer]').fill(selection.reviewer);
  await form.locator('[name=reason]').fill(reason);
  await form.getByRole('button',{name:'Save explicit source decision',exact:true}).click();
  await ready(box,'Explicit source decision saved.');
}

/**
 * Run inside the original receiver's already-owned browser/server course.
 * page must serve the prepared owned-workspace, verified by its entire portable
 * state before any UI write. This never navigates a reserved local browser.
 */
export async function operateSourceVersionReceiving({page,endpoint,prepared}){
  const {root,directory,portable,selection,plan}=prepared;
  const expected=await snapshot(directory),actual=await fetchJSON(page,endpoint,'/portable');
  assert.deepEqual(portableComparable(actual),portableComparable(expected),'The page/server is not the prepared owned receiving copy; refusing UI writes.');
  unchangedOriginals(portable,actual);
  let phase=await phaseFile(root);
  const purpose='Receiving source-version comparison '+selection.source_sha256+' — '+selection.reason;
  const selectReason='Temporary receiving-copy selection; '+selection.reason;
  const resetReason='Return temporary receiving-copy selection to unresolved; '+selection.reason;
  const errors=[],onError=error=>errors.push(String(error));page.on('pageerror',onError);
  try{
    let box=await openDesk(page,endpoint,plan);
    // Recover a saved report after a lost acknowledgement before repeating a write.
    if(!phase.report_id){
      const saved=await fetchJSON(page,endpoint,'/reconciliation/reports');
      const matches=[];
      for(const row of saved.reports){const report=await fetchJSON(page,endpoint,'/reconciliation/reports/'+encodeURIComponent(row.id));if(report.reason===purpose&&report.reviewer===selection.reviewer)matches.push(report);}
      assert(matches.length<=1,'More than one matching receiving report exists; inspect original history before continuing.');
      if(matches.length)phase=await phaseFile(root,{report_id:matches[0].saved_export_id});
    }
    if(plan.record_id&&!phase.report_id){
      const current=(await fetchJSON(page,endpoint,'/reconciliation/groups/'+plan.group_id)).group;
      const accepted=current.selected_id===plan.record_id&&current.records.find(row=>row.id===plan.record_id)?.review?.reason===selectReason;
      if(!accepted)await decision(page,box,'select',plan,selection,selectReason);
      phase=await phaseFile(root,{selection_recorded:true});
    }
    if(!phase.report_id){
      const form=box.locator('form[data-msr-form=report]');
      await form.locator('[name=reviewer]').fill(selection.reviewer);
      await form.locator('[name=purpose]').fill(purpose);
      await form.getByRole('button',{name:'Save complete comparison report',exact:true}).click();
      await ready(box,'Complete comparison report saved');
      const saved=await fetchJSON(page,endpoint,'/reconciliation/reports');
      let report=null;
      for(const row of saved.reports){const value=await fetchJSON(page,endpoint,'/reconciliation/reports/'+encodeURIComponent(row.id));if(value.reason===purpose&&value.reviewer===selection.reviewer){assert(!report,'Receiving report identity is ambiguous');report=value;}}
      assert(report,'Original saved report was not returned.');
      phase=await phaseFile(root,{report_id:report.saved_export_id});
    }
    const retained=await fetchJSON(page,endpoint,'/reconciliation/reports/'+encodeURIComponent(phase.report_id));
    if(plan.record_id){
      assert.equal(retained.groups.find(row=>row.id===plan.group_id)?.selected_id,plan.record_id,'The historical report must retain the explicit source selection.');
      const current=(await fetchJSON(page,endpoint,'/reconciliation/groups/'+plan.group_id)).group;
      const reset=current.selected_id===null&&current.records.find(row=>row.id===plan.record_id)?.review?.reason===resetReason;
      if(!reset){assert.equal(current.selected_id,plan.record_id,'An independent selection changed the receiving copy; inspect it before resetting.');await decision(page,box,'unresolve',plan,selection,resetReason);}
      phase=await phaseFile(root,{selection_reset:true});
    }
    await box.locator('[data-msr-report="'+phase.report_id+'"]').click();await ready(box,'Retained historical comparison opened');
    await box.locator('details').evaluateAll(rows=>{for(const row of rows)row.open=true;});
    await page.setViewportSize({width:1365,height:1000});
    await box.locator('[data-msr-action=report-html]').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(root,'source-versions-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await box.locator('[data-msr-action=report-html]').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(root,'source-versions-390.png')});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Unexpected document-wide overflow at 390 px.');
    const downloads=[
      ['source-version-review.html','report-html'],
      ['source-version-review.json','report-json'],
      ['source-version-occurrences.csv','report-csv'],
      ['source-version-group.json','group-json']
    ];
    for(const [name,action] of downloads)await captureDownload(page,root,name,()=>box.locator('[data-msr-action="'+action+'"]').click());
    const report=JSON.parse(await fs.readFile(path.join(root,'source-version-review.json'),'utf8'));
    assert.deepEqual(report,retained);
    assert.equal(await fs.readFile(path.join(root,'source-version-review.html'),'utf8'),sourceReviewHTML(retained));
    assert.equal(await fs.readFile(path.join(root,'source-version-occurrences.csv'),'utf8'),reconciliationCSV(retained));
    for(const s of retained.sources){
      const button=box.locator('[data-msr-source="'+s.id+'"]');
      const name='download-original-'+s.id+(s.kind==='usgs-daily'?'.geojson':'.csv');
      let bytes;
      if(await button.count())bytes=await captureDownload(page,root,name,()=>button.click());
      else{
        const response=await page.request.get(endpoint+'/api/measurement-workspace/sources/'+encodeURIComponent(s.id)+'/original');
        assert(response.ok(),'Original report-source download failed: '+s.id);
        bytes=await response.body();await exact(path.join(root,name),bytes);
      }
      assert.equal(hash(bytes),s.sha,'Original browser/attachment-route download changed bytes');
    }
    let returned;
    if(await exists(path.join(root,'editable-workspace.json'))){
      returned=JSON.parse(await fs.readFile(path.join(root,'editable-workspace.json'),'utf8'));
      assert.deepEqual(portableComparable(await fetchJSON(page,endpoint,'/portable')),portableComparable(returned),'Current receiving state changed after its retained complete download.');
    }else{
      const full=await captureDownload(page,root,'editable-workspace.json',()=>box.locator('[data-msr-action=portable]').click());
      returned=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(full));
    }
    unchangedOriginals(portable,returned);
    box=await openDesk(page,endpoint,plan);
    await box.locator('[data-msr-report="'+phase.report_id+'"]').click();await ready(box,'Retained historical comparison opened');
    assert.deepEqual(await fetchJSON(page,endpoint,'/reconciliation/reports/'+phase.report_id),retained);
    if(plan.record_id)assert.equal((await fetchJSON(page,endpoint,'/reconciliation/groups/'+plan.group_id)).group.selected_id,null);
    await box.locator('details').evaluateAll(rows=>{for(const row of rows)row.open=true;});
    await box.locator('[data-msr-action=report-html]').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(root,'source-versions-reopened.png')});
    assert.deepEqual(errors,[],'Original application browser exceptions');
    await phaseFile(root,{browser_complete:true,report_id:phase.report_id});
    return {report:retained,portable:returned,phase,errors};
  }finally{page.off('pageerror',onError);}
}
async function coldReceive(prepared,report,portable){
  const dir=path.join(prepared.root,'cold-received');await fs.mkdir(dir,{recursive:true});
  if(prepared.selection.reaches_sha256)await exact(path.join(dir,'reaches.json'),await fs.readFile(path.join(prepared.root,'original-reaches.json')));
  const workspace=new MeasurementWorkspace(dir);
  try{
    if(!workspace.summary().imports.length)workspace.receive(portable);
    const current=workspace.portable();unchangedOriginals(portable,current);
    for(const key of ['reviews','selected_versions','exports'])assert.deepEqual(ordered(current.tables[key]),ordered(portable.tables[key]),'Cold receiving changed '+key);
    for(const event of portable.tables.events)assert(current.tables.events.some(row=>JSON.stringify(row)===JSON.stringify(event)),'Cold receiving lost original history');
    const reopened=reconciliationReport(workspace,report.saved_export_id);assert.deepEqual(reopened,report);
    await exact(path.join(prepared.root,'cold-reopened-report.json'),reopened);
    await exact(path.join(prepared.root,'cold-received-summary.json'),workspace.summary());
  }finally{workspace.close();}
}
async function finish(prepared,result){
  const root=prepared.root;
  assert.equal(hash(await regular(prepared.selection.source_file)),prepared.selection.source_sha256,'Original supplied snapshot changed during receiving.');
  const files=[];
  async function visit(dir,prefix=''){
    for(const entry of await fs.readdir(dir,{withFileTypes:true})){
      const relative=prefix+entry.name;
      if(entry.isDirectory()){if(relative==='originals')await visit(path.join(dir,entry.name),relative+'/');continue;}
      if(!entry.isFile()||relative.endsWith('.pending')||relative.endsWith('.download')||['COMPLETE.json','ATTACHMENTS.html','ATTACHMENTS.json','browser-progress.json'].includes(relative)||relative.startsWith('service-'))continue;
      const data=await fs.readFile(path.join(dir,entry.name));
      files.push({path:relative,bytes:data.length,sha256:hash(data),view:relative.endsWith('.png')?'image':relative.endsWith('.html')?'html':'complete text'});
    }
  }
  await visit(root);files.sort((a,b)=>a.path.localeCompare(b.path));
  const content='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Source versions receiving attachments</title><style>html{color-scheme:light;background:#fff;color:#171717;font:15px/1.5 system-ui}body{max-width:1100px;margin:30px auto;padding:0 20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:600px;overflow:auto}a{color:#164c77}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px;overflow-wrap:anywhere}img{max-width:100%}</style><h1>Source versions — complete receiving attachments</h1><p>Actual supplied workspace: '+esc(prepared.selection.source_sha256)+'. '+esc(prepared.plan.decision_course)+'. Original input and every retained publisher source are included. This index is an inspection aid, not a claim that a person has viewed the images.</p><p>Open the full HTML report, both layouts, reopened view, exact source files, occurrence CSV, complete report JSON and editable workspace. Continue editing from the cold-received database. Record actual visual findings in the original receiving operation.</p><table><thead><tr><th>Complete attachment</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>'+files.map(f=>'<tr><td><a href="'+esc(f.path)+'">'+esc(f.path)+'</a></td><td>'+f.bytes+'</td><td>'+esc(f.sha256)+'</td></tr>').join('')+'</tbody></table>'+ (await Promise.all(files.filter(f=>f.view==='complete text').map(async f=>'<details><summary>Read complete '+esc(f.path)+'</summary><pre>'+esc(await fs.readFile(path.join(root,f.path),'utf8'))+'</pre></details>'))).join('')+'</html>';
  await fs.writeFile(path.join(root,'ATTACHMENTS.html'),content);
  const index=Buffer.from(content);files.push({path:'ATTACHMENTS.html',bytes:index.length,sha256:hash(index),view:'html'});
  const manifest={schema:'upstate.source-versions-receiving-attachments/v1',source:prepared.selection,decision_course:prepared.plan.decision_course,files,visual_review:'Pending actual viewing by the producing worker; source/native assertions do not establish rendered acceptance.'};
  await fs.writeFile(path.join(root,'ATTACHMENTS.json'),json(manifest));
  const complete={schema,status:'COMPLETE_NATIVE_AND_BROWSER',source_sha256:prepared.selection.source_sha256,report_id:result.report.saved_export_id,counts:result.report.counts,decision_course:prepared.plan.decision_course,completed_at:new Date().toISOString(),attachment_manifest:'ATTACHMENTS.json',manifest_sha256:hash(json(manifest)),files,visual_review:manifest.visual_review};
  await exact(path.join(root,'COMPLETE.json'),complete);return complete;
}
async function startServer(directory){
  const root=path.dirname(directory),sessionFile=path.join(root,'service-session.json');
  await checkPriorService(root);await assertOwnedTree(directory);
  const child=spawn(process.execPath,[fileURLToPath(new URL('./cli.mjs',import.meta.url)),'serve','--workspace',directory,'--port','0'],{stdio:['ignore','pipe','pipe']});
  let stderr='',session={schema:'upstate.source-versions-receiving-service/v1',directory,pid:child.pid||null,started_at:new Date().toISOString(),state:'starting',endpoint:null};
  child.stderr.on('data',data=>{stderr+=data;});
  const readyPromise=new Promise((resolve,reject)=>{
      let out='';const timer=setTimeout(()=>reject(Error('Original Measurements service did not become ready: '+stderr)),20000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(Error('Original Measurements service exited '+code+': '+stderr));});
      child.stdout.on('data',data=>{out+=data;for(const line of out.split('\n')){let row;try{row=JSON.parse(line);}catch{continue;}if(row.ready&&row.port){clearTimeout(timer);resolve('http://127.0.0.1:'+row.port);break;}}});
    });
  readyPromise.catch(()=>{}); // Attach immediately; startup failures remain reported by the awaited original promise.
  try{
    if(child.pid)await atomic(sessionFile,session);
    const endpoint=await readyPromise;
    session={...session,endpoint,state:'running'};await atomic(sessionFile,session);
    return {child,endpoint,stderr:()=>stderr,sessionFile,session};
  }catch(error){
    if(child.pid&&child.exitCode===null)child.kill('SIGTERM');
    if(child.pid)await atomic(sessionFile,{...session,state:child.exitCode===null?'shutdown-unconfirmed':'stopped',error:String(error)});
    throw error;
  }
}
async function stopServer(service){
  if(service.child.exitCode!==null||service.child.signalCode!==null||!service.child.pid){
    await atomic(service.sessionFile,{...service.session,state:'stopped',stopped_at:new Date().toISOString()});return;
  }
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Owned receiving server has not acknowledged shutdown; preserve PID '+service.child.pid+' and inspect it before resuming.')),15000);
      service.child.once('exit',()=>{clearTimeout(timer);resolve();});
      service.child.kill('SIGTERM');
    });
    await atomic(service.sessionFile,{...service.session,state:'stopped',stopped_at:new Date().toISOString()});
  }catch(error){
    await atomic(service.sessionFile,{...service.session,state:'shutdown-unconfirmed',error:String(error)});throw error;
  }
}
export async function runSourceVersionReceiving(options){
  const prepared=await prepareSourceVersionReceiving(options),done=path.join(prepared.root,'COMPLETE.json');
  if(await exists(done)){
    const result=JSON.parse(await fs.readFile(done,'utf8'));
    assert.equal(hash(await fs.readFile(path.join(prepared.root,result.attachment_manifest))),result.manifest_sha256);
    for(const file of result.files)assert.equal(hash(await fs.readFile(path.join(prepared.root,file.path))),file.sha256);
    return result;
  }
  if(!options.playwright||!options.chromium)return {schema,status:'AWAITING_EXISTING_EQUIPPED_BROWSER',output:prepared.root,plan:prepared.plan,note:'The actual portable source is verified and copied. Supply the existing isolated Playwright module and Chromium executable to continue; no browser or scientific process started.'};
  const {chromium}=await import(pathToFileURL(path.resolve(options.playwright)).href);
  const service=await startServer(prepared.directory);
  let browser,result;
  try{
    browser=await chromium.launch({executablePath:path.resolve(options.chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const context=await browser.newContext({viewport:{width:1365,height:1000},acceptDownloads:true});
    const page=await context.newPage();result=await operateSourceVersionReceiving({page,endpoint:service.endpoint,prepared});
    const reportPage=await context.newPage();await reportPage.goto(pathToFileURL(path.join(prepared.root,'source-version-review.html')).href);
    await reportPage.locator('.msr-print').waitFor();
    await reportPage.locator('details').evaluateAll(rows=>{for(const row of rows)row.open=true;});
    const saved=await captureDownload(reportPage,prepared.root,'offline-report-download.json',()=>reportPage.locator('#download').click());
    assert.deepEqual(JSON.parse(saved.toString('utf8')),result.report);
    await reportPage.screenshot({path:path.join(prepared.root,'offline-report-desktop.png')});
    await reportPage.setViewportSize({width:390,height:844});await reportPage.screenshot({path:path.join(prepared.root,'offline-report-390.png')});
    await reportPage.close();await browser.close();browser=null;
  }finally{
    await browser?.close();
    await fs.writeFile(path.join(prepared.root,'service-stderr.log'),service.stderr());
    await stopServer(service);
  }
  await coldReceive(prepared,result.report,result.portable);
  const coldService=await startServer(path.join(prepared.root,'cold-received'));
  try{
    browser=await chromium.launch({executablePath:path.resolve(options.chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
    const page=await context.newPage(),box=await openDesk(page,coldService.endpoint,prepared.plan);
    await box.locator('[data-msr-report="'+result.report.saved_export_id+'"]').click();
    await ready(box,'Retained historical comparison opened');
    assert.deepEqual(await fetchJSON(page,coldService.endpoint,'/reconciliation/reports/'+result.report.saved_export_id),result.report);
    if(prepared.plan.record_id)assert.equal((await fetchJSON(page,coldService.endpoint,'/reconciliation/groups/'+prepared.plan.group_id)).group.selected_id,null);
    await box.locator('details').evaluateAll(rows=>{for(const row of rows)row.open=true;});
    await box.locator('[data-msr-action=report-html]').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(prepared.root,'cold-received-390.png')});
  }finally{await browser?.close();browser=null;await stopServer(coldService);}
  return finish(prepared,result);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const input={};for(let i=2;i<process.argv.length;i+=2){assert(process.argv[i].startsWith('--')&&process.argv[i+1]&&!process.argv[i+1].startsWith('--'),'Use --name value pairs.');const key=process.argv[i].slice(2);assert(!Object.hasOwn(input,key),'Repeated option: '+key);input[key]=process.argv[i+1];}
  const allowed=['portable','output','reviewer','reason','group-id','record-id','exercise-selection','reaches','playwright','chromium'];for(const key of Object.keys(input))assert(allowed.includes(key),'Unknown option: '+key);
  try{console.log(json(await runSourceVersionReceiving({portableFile:input.portable,output:input.output,reviewer:input.reviewer,reason:input.reason,groupId:input['group-id'],recordId:input['record-id'],exerciseSelection:input['exercise-selection'],reachesFile:input.reaches,playwright:input.playwright,chromium:input.chromium})));}
  catch(error){console.error(error.stack||String(error));process.exitCode=1;}
}
