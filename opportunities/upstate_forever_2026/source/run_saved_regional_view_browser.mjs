#!/usr/bin/env node
/** Operate the original regional opening and existing scientific desks with Playwright. */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join, relative, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const {values:args}=parseArgs({options:{
 'url-file':{type:'string'},url:{type:'string'},opening:{type:'string'},
 workspace:{type:'string'},output:{type:'string'},'browser-channel':{type:'string'},'browser-executable':{type:'string'},
 'skip-transfer':{type:'boolean',default:false},'task-timeout-seconds':{type:'string',default:'1800'},
 headed:{type:'boolean',default:false},video:{type:'boolean',default:false},
 help:{type:'boolean',default:false}
}});
if(args.help){
 process.stdout.write('Usage: node source/run_saved_regional_view_browser.mjs --url-file PRIVATE_URL_FILE --opening regional-workflow-opening.json [--workspace CURRENT_OPERATOR_WORKSPACE_KEY] [--output DIRECTORY] [--video] [--headed] [--skip-transfer] [--task-timeout-seconds 1800] [--browser-channel NAME | --browser-executable PATH]\nOpens actual retained regional, profile and optional native experiment/decision records through the existing operator controls. Saves the original view, reopens it in a fresh browser, retains the prior browser draft, and backs up/restores the native workspace. Private operator URL and token are redacted from the journal.\n');
 process.exit(0);
}
const output=resolve(args.output||join('artifacts','regional-opening',new Date().toISOString().replace(/[:.]/g,'-')));
const journal={schema:'upstate.regional-saved-view-browser-journey/v1',prepared_by:'TokenJunkieLabs engineering',started_at:new Date().toISOString(),status:'running',steps:[],screenshots:[],downloads:[],browser_errors:[]};
let browser,context,page,privateURL='',origin='',capability='',snapshot=null;
const snapshots=new Map();
const same=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(same):Object.fromEntries(Object.keys(value).sort().map(key=>[key,same(value[key])])):value;
const canonical=value=>JSON.stringify(same(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
function requireValue(value,message){if(!value)throw Error(message);}
function browserRuntime(){
 requireValue(!(args['browser-channel']&&args['browser-executable']),'Choose a browser channel or an explicit executable path.');
 return {kind:args['browser-executable']?'executable':args['browser-channel']?'channel':'bundled',
  executable_path:args['browser-executable']?resolve(args['browser-executable']):null,
  channel:args['browser-channel']||null,headless:!args.headed};
}
function redact(value){
 let result=String(value);
 for(const secret of [privateURL,capability,origin].filter(Boolean))result=result.split(secret).join('[private operator]');
 return result.replace(/#token=[^\s"'<>]+/g,'#token=[redacted]');
}
function bodyOf(response){
 if(response.request().method()==='GET')return Object.fromEntries(new URL(response.url()).searchParams);
 try{return response.request().postDataJSON()||{};}catch{return {};}
}
function matches(path,criteria={}){return response=>new URL(response.url()).pathname===path&&Object.entries(criteria).every(([key,value])=>bodyOf(response)[key]===value);}
async function nativeJSON(response,label){
 requireValue(response.ok(),label+' returned HTTP '+response.status());
 const value=await response.json();requireValue(!value.error,label+': '+redact(value.error?.message||value.error||''));return value;
}
async function observe(response){
 const path=new URL(response.url()).pathname;
 if(!response.ok()||!path.startsWith('/api/'))return;
 try{
  const value=await response.json();
  if(path==='/api/state'&&value.workspace_key){snapshot=value;snapshots.set(value.workspace_key,value);}
 }catch{}
}
async function shot(name,focus){
 if(focus)await page.locator(focus).first().scrollIntoViewIfNeeded();
 const path=join(output,name+'.png');await page.screenshot({path,fullPage:!focus,animations:'disabled'});
 const bytes=await readFile(path);journal.screenshots.push({path:relative(output,path),bytes:bytes.length,sha256:sha(bytes)});
}
async function step(name,details={}){
 journal.steps.push({name,completed_at:new Date().toISOString(),...details});
 await writeFile(join(output,'journey.json'),JSON.stringify(journal,null,2)+'\n');
}
async function changeWorkspace(id){
 if(await page.locator('#workspace-select').inputValue()!==id){
  const pending=page.waitForResponse(async response=>{
   if(new URL(response.url()).pathname!=='/api/state'||!response.ok())return false;
   try{return (await response.json()).workspace_key===id;}catch{return false;}
  });
  await page.locator('#workspace-select').selectOption(id);
  const value=await nativeJSON(await pending,'Original workspace');snapshots.set(id,value);snapshot=value;
 }
 let current=snapshots.get(id);
 if(!current){
  const pending=page.waitForResponse(async response=>{
   if(new URL(response.url()).pathname!=='/api/state'||!response.ok())return false;
   try{return (await response.json()).workspace_key===id;}catch{return false;}
  });
  await page.reload({waitUntil:'domcontentloaded'});current=await nativeJSON(await pending,'Original workspace');
  snapshots.set(id,current);snapshot=current;
 }
 return current;
}
async function chooseWorkspace(opening){
 await page.locator('#workspace-select').waitFor({state:'visible'});
 const options=await page.locator('#workspace-select option').evaluateAll(nodes=>nodes.filter(node=>node.value&&!node.disabled).map(node=>node.value));
 if(args.workspace){
  requireValue(options.includes(args.workspace),'The requested current operator workspace is absent.');
  const value=await changeWorkspace(args.workspace);
  requireValue(value.data?.project?.id===opening.workspace_id,'The chosen workspace belongs to a different native project.');
  return value;
 }
 const preferred=options.includes(opening.operator_workspace_key)?opening.operator_workspace_key:null;
 const ordered=[preferred,await page.locator('#workspace-select').inputValue(),...options].filter((id,index,list)=>id&&list.indexOf(id)===index);
 for(const id of ordered){const value=await changeWorkspace(id);if(value.data?.project?.id===opening.workspace_id)return value;}
 throw Error('The prepared native project is absent from the original operator workspace choices.');
}
async function journey(selectedStep){
 if(!await page.locator('.operating-journey').isVisible())await page.locator('[data-view="journey"]').click();
 await page.locator('.operating-journey').waitFor({state:'visible'});
 if(selectedStep)await page.locator('.journey-steps [data-action="journey-step"][data-step="'+selectedStep+'"]').click();
}
async function returnToJourney(selectedStep){
 const button=page.locator('.journey-rail [data-action="journey-home"]');
 if(await button.isVisible())await button.click();else await journey();
 await journey(selectedStep);
}
async function selectionVisible(opening){
 await page.waitForFunction(({profile,selection})=>{
  const field=document.querySelector('[data-journey-regional-slot] [data-journey-field="profile_id"]');
  const context=document.querySelector('[data-regional-field="selection"]');
  return field?.value===profile&&context?.value===selection;
 },{profile:opening.profile_id,selection:opening.watershed_export_id});
 await page.waitForFunction(id=>document.querySelector('[data-journey-regional-slot]')?.textContent.includes(id),opening.watershed_report_id);
}
async function saveDownload(selector,name){
 const pending=page.waitForEvent('download');await page.locator(selector).click();const download=await pending;
 const path=join(output,'exports',name||basename(download.suggestedFilename()));await download.saveAs(path);
 const bytes=await readFile(path);journal.downloads.push({path:relative(output,path),bytes:bytes.length,sha256:sha(bytes)});
 return {path,bytes};
}

async function exportSelected(name){
 const exported=await saveDownload('.operating-journey > header [data-action="journey-export"]',name);
 return JSON.parse(exported.bytes.toString('utf8'));
}
function verifyView(actual,expected,label){
 requireValue(actual.project_id===expected.project_id,label+' changed the native project.');
 requireValue(canonical(actual.selection)===canonical(expected.selection),label+' changed scientific selections or native models.');
 requireValue(canonical(actual.regional)===canonical(expected.regional),label+' changed saved watershed, experiment or decision selections.');
 requireValue(actual.notes===expected.notes,label+' changed the saved working notes.');
}
async function waitNativeTask(id){
 const seconds=Number(args['task-timeout-seconds']);
 requireValue(Number.isFinite(seconds)&&seconds>0,'Choose a positive native task timeout.');
 const until=Date.now()+seconds*1000;
 while(Date.now()<until){
  const response=await page.request.get(origin+'/api/task?id='+encodeURIComponent(id),{headers:{Authorization:'Bearer '+capability},maxRedirects:0});
  const task=await nativeJSON(response,'Original queued task');
  requireValue(task.id===id,'The task reader returned another retained operation.');
  if(task.state==='complete')return task;
  if(['failed','interrupted','cancelled'].includes(task.state))throw Error('Original '+task.action+' is '+task.state+': '+redact(task.error?.message||'open its retained task for continuation'));
  await page.waitForTimeout(1200);
 }
 throw Error('Original native task remains active after the selected observation period; task '+id+' is retained in this workspace.');
}
async function closeDetail(){
 const dialog=page.locator('#detail-dialog');
 if(await dialog.isVisible())await dialog.locator('[data-action="detail-close"]').click();
}
async function queueOriginalForm(action){
 const pending=page.waitForResponse(matches('/api/actions',{action}));
 await page.locator('#form-submit').click();
 const task=await nativeJSON(await pending,'Original '+action+' queue request');
 await step('Queue original '+action,{task_id:task.id,operation_id:task.operation_id});
 return waitNativeTask(task.id);
}
async function continueNativeSavedView(opening){
 await journey('reopen');
 requireValue(await page.locator('[data-action="journey-save-view"]').count()===1,'The current native Save view integration is required.');
 const beforeSave=await exportSelected('before-native-save.json');
 const saveResponse=page.waitForResponse(matches('/api/operator-session',{workspace:journal.operator_workspace_key}));
 await page.locator('[data-action="journey-save-view"]').click();
 const session=await nativeJSON(await saveResponse,'Original project view save');
 requireValue(session.schema==='upstate.operator-session/v1'&&session.project_id===opening.workspace_id,'The native project save returned another project.');
 verifyView(session.journey,beforeSave,'Native Save view');
 await page.getByText('Selected analysis and notes saved in this workspace.',{exact:true}).waitFor({state:'visible'});
 await step('Save regional science and notes inside original workspace',{revision:session.revision,saved_at:session.saved_at});
 await shot('09-native-saved-project-view','.operating-journey');

 const draftNotes=(beforeSave.notes?beforeSave.notes+'\n\n':'')+'Working regional discussion retained in this browser; selected watersheds: '+opening.selected_huc12s.join(', ')+'.';
 await page.locator('[data-journey-field="notes"]').fill(draftNotes);
 const browserDraft=await exportSelected('retained-browser-draft.json');
 await page.locator('[data-action="journey-open-saved-view"]').click();
 await page.getByText('Saved project view opened. The prior browser view is retained.',{exact:true}).waitFor({state:'visible'});
 const opened=await exportSelected('opened-native-project-view.json');verifyView(opened,session.journey,'Open saved project view');
 await journey('reopen');await page.locator('[data-action="journey-swap-browser-view"]').click();
 await page.waitForFunction(notes=>document.querySelector('[data-journey-field="notes"]')?.value===notes,draftNotes);
 const returnedDraft=await exportSelected('returned-browser-draft.json');verifyView(returnedDraft,browserDraft,'Return to browser draft');
 await journey('reopen');await page.locator('[data-action="journey-swap-browser-view"]').click();
 await page.waitForFunction(notes=>document.querySelector('[data-journey-field="notes"]')?.value===notes,session.journey.notes);
 await step('Switch saved project view and retained browser draft',{saved_notes_preserved:true,browser_notes_preserved:true});
 await shot('10-return-to-saved-view','.operating-journey');

 const firstPage=page;
 const clean=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 try{
  page=await clean.newPage();page.setDefaultTimeout(60000);
  page.on('pageerror',error=>journal.browser_errors.push(redact(error.message)));
  page.on('response',response=>{void observe(response);});
  const firstState=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state'&&response.ok());
  await page.goto(privateURL,{waitUntil:'domcontentloaded'});
  await nativeJSON(await firstState,'Fresh browser native workspace');
  await page.locator('#workspace-select').waitFor({state:'visible'});
  await changeWorkspace(journal.operator_workspace_key);await journey('inputs');await selectionVisible(opening);
  const fresh=await exportSelected('fresh-browser-native-view.json');verifyView(fresh,session.journey,'Fresh browser native reopen');
  await step('Open project-saved view in a fresh browser',{workspace_key:journal.operator_workspace_key,project_id:fresh.project_id,models:fresh.selection.models});
  await shot('11-fresh-browser-reopen','[data-journey-regional-slot]');
 }finally{await clean.close();page=firstPage;}

 if(args['skip-transfer'])return;
 await journey('reopen');
 await page.locator('[data-action="journey-backup"]').click();
 await page.locator('#form-dialog [name="include_intermediates"]').check();
 const backup=await queueOriginalForm('workspace.backup');
 requireValue(backup.result?.project_id===opening.workspace_id,'The native backup changed the original project.');
 const ticket=(backup._downloads||[]).find(row=>row.filename.toLowerCase().endsWith('.zip'));
 requireValue(ticket,'The original completed backup has no retained ZIP download.');
 // The live detail panel refreshes this same completed task and supplies its authenticated URL.
 await page.waitForFunction(url=>[...document.querySelectorAll('#detail-body a[download]')].some(node=>node.getAttribute('href')===url+'?download=1'),ticket.url);
 const download=page.waitForEvent('download');
 await page.locator('#detail-body a[download]').evaluateAll((nodes,url)=>{const chosen=nodes.find(node=>node.getAttribute('href')===url+'?download=1');if(!chosen)throw Error('Original backup download is absent.');chosen.click();},ticket.url);
 const received=await download,archive=join(output,'exports',basename(ticket.filename));
 await received.saveAs(archive);
 const bytes=await readFile(archive);
 requireValue(bytes.length===ticket.bytes&&sha(bytes)===ticket.sha256,'The downloaded native workspace archive differs from its original ticket.');
 journal.downloads.push({path:relative(output,archive),bytes:bytes.length,sha256:sha(bytes)});
 await step('Download complete original workspace archive',{task_id:backup.id,bytes:bytes.length,sha256:sha(bytes)});
 await closeDetail();await journey('reopen');
 await page.locator('[data-action="journey-restore"]').click();
 await page.locator('#form-dialog input[name="restore_file"]').setInputFiles(archive);
 const restored=await queueOriginalForm('workspace.restore');
 requireValue(restored.result?.identity==='MATCH'&&restored.result?.workspace_key,'The native restore did not complete its original identity check.');
 const restoredKey=restored.result.workspace_key;
 requireValue(restoredKey!==journal.operator_workspace_key,'Native restore did not register a separate receiving workspace.');
 await page.locator('#detail-body [data-action="workspace-select"][data-id="'+restoredKey+'"]').waitFor({state:'visible'});
 await page.locator('#detail-body [data-action="workspace-select"][data-id="'+restoredKey+'"]').click();
 await page.waitForFunction(key=>document.querySelector('#workspace-select')?.value===key,restoredKey);
 await journey('inputs');await selectionVisible(opening);
 const restoredView=await exportSelected('restored-native-project-view.json');verifyView(restoredView,session.journey,'Restored native project view');
 journal.restored_workspace_key=restoredKey;
 await step('Open restored native regional workspace',{workspace_key:restoredKey,archive_sha256:restored.result.archive_sha256,project_id:restoredView.project_id,profile_id:restoredView.selection.profile_id,regional:restoredView.regional});
 await shot('12-restored-native-regional-workspace','[data-journey-regional-slot]');
}

async function main(){
 journal.browser_runtime=browserRuntime();
 await mkdir(join(output,'exports'),{recursive:true});
 requireValue(args.opening,'Supply the original regional-workflow-opening.json receipt.');
 const opening=JSON.parse(await readFile(resolve(args.opening),'utf8'));
 requireValue(opening.schema==='upstate.regional-workflow-opening/v1'&&opening.workspace_id&&opening.profile_id&&opening.watershed_export_id,'Choose the original prepared regional opening receipt.');
 privateURL=(args['url-file']?await readFile(resolve(args['url-file']),'utf8'):args.url||process.env.ECO_OPERATOR_URL||'').trim();
 let parsed;try{parsed=new URL(privateURL);}catch{throw Error('Supply the original private operator URL via --url-file, --url or ECO_OPERATOR_URL.');}
 requireValue(['http:','https:'].includes(parsed.protocol),'Use the original HTTP or HTTPS operator URL.');
 origin=parsed.origin;capability=new URLSearchParams(parsed.hash.slice(1)).get('token')||'';
 requireValue(capability,'Use the original operator startup URL including its private capability fragment.');
 browser=await chromium.launch({headless:!args.headed,
  ...(args['browser-channel']?{channel:args['browser-channel']}:{ }),
  ...(args['browser-executable']?{executablePath:resolve(args['browser-executable'])}:{ })});
 context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,...(args.video?{recordVideo:{dir:join(output,'video'),size:{width:1440,height:1000}}}:{})});
 page=await context.newPage();page.setDefaultTimeout(60000);
 page.on('pageerror',error=>journal.browser_errors.push(redact(error.message)));
 page.on('response',response=>{void observe(response);});
 const firstState=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state'&&response.ok());
 await page.goto(privateURL,{waitUntil:'domcontentloaded'});
 const initial=await nativeJSON(await firstState,'Initial operator workspace');snapshots.set(initial.workspace_key,initial);snapshot=initial;
 const selected=await chooseWorkspace(opening);journal.workspace_id=opening.workspace_id;journal.operator_workspace_key=selected.workspace_key;
 journal.opening={...opening};await journey('study');
 await page.locator('[data-journey-regional-slot] [data-journey-import]').setInputFiles(resolve(args.opening));
 await selectionVisible(opening);
 const nativeProfile=selected.data.profiles.find(row=>row.id===opening.profile_id);
 requireValue(nativeProfile,'The original saved profile is absent.');
 if(opening.profile_table_sha256)requireValue(nativeProfile.table_summary?.sha256===opening.profile_table_sha256,'The opening profile table hash changed.');
 await step('Import original regional opening',{profile_id:opening.profile_id,watershed_export_id:opening.watershed_export_id,watershed_report_id:opening.watershed_report_id,selected_huc12s:opening.selected_huc12s});
 await shot('01-regional-scientific-opening','[data-journey-regional-slot]');
 const selectionRead=page.waitForResponse(matches('/api/watershed-context/export',{export_id:opening.watershed_export_id}));
 await page.locator('[data-action="journey-regional-selection"]').click();
 const saved=await nativeJSON(await selectionRead,'Original saved watershed selection');
 await page.locator('select[name="wc-selection"]').waitFor({state:'visible'});
 await page.waitForFunction(id=>document.querySelector('select[name="wc-selection"]')?.value===id,opening.watershed_export_id);
 for(const huc12 of opening.selected_huc12s)await page.locator('[data-wc-rows] [data-wc-huc="'+huc12+'"]').waitFor({state:'visible'});
 requireValue(saved?.report_id===opening.watershed_report_id,'The watershed desk did not open the original saved report.');
 requireValue(canonical([...saved.huc12s].sort())===canonical([...opening.selected_huc12s].sort()),'The watershed desk changed saved HUC membership.');
 await step('Open exact original watershed selection',{report_sha256:saved.report_sha256,source_fingerprint:saved.source_fingerprint});
 await shot('02-saved-watershed-selection','[data-wc-rows]');
 await returnToJourney('inputs');await selectionVisible(opening);
 const inspected=page.waitForResponse(matches('/api/profile-workbench/inspect',{profile_id:opening.profile_id}));
 await page.locator('[data-journey-regional-slot] [data-action="journey-regional-profile"]').click();
 const profile=await nativeJSON(await inspected,'Original profile');
 await page.waitForFunction(id=>document.querySelector('[data-pw-main]')?.textContent.includes(id),opening.profile_id);
 requireValue(profile.profile_id===opening.profile_id,'Profile workbench opened another profile.');
 requireValue(profile.table?.sha256===nativeProfile.table_summary?.sha256,'Profile workbench changed the original table identity.');
 await step('Open retained scientific profile',{profile_id:profile.profile_id,table_sha256:profile.table.sha256,source_collection_id:profile.profile.source_collection_id,biophysical_source_id:profile.profile.biophysical_source_id});
 await shot('03-original-profile-workbench','[data-pw-main]');
 await returnToJourney('inputs');await selectionVisible(opening);
 const gridId=await page.locator('[data-journey-regional-slot] [data-journey-field="grid_id"]').inputValue();
 if(gridId){
  const grid=selected.data.grids.find(row=>row.id===gridId);requireValue(grid,'The journey selected an absent native grid.');
  await step('Retain actual model geography',{grid_id:grid.id,source_collection_id:grid.spec?.source_collection_id,reporting_area:grid.spec?.reporting_area,model_domain:grid.spec?.model_domain,grid:grid.grid});
  await shot('04-native-model-geography','[data-journey-regional-slot]');
 }
 if(opening.experiment_id){
  await journey('study');
  await page.waitForFunction(id=>document.querySelector('[data-regional-field="experiment"]')?.value===id,opening.experiment_id);
  const inspection=page.waitForResponse(matches('/api/experiments/inspect',{experiment_id:opening.experiment_id}));
  await page.locator('[data-action="journey-regional-experiment"]').click();
  const experiment=await nativeJSON(await inspection,'Original native experiment');
  requireValue(experiment.id===opening.experiment_id,'Experiments opened a different saved experiment.');
  await page.waitForFunction(()=>location.hash==='#experiments');
  await step('Open original native experiment',{experiment_id:experiment.id,state:experiment.state,selection:experiment.selection,models:experiment.models});
  await shot('05-original-native-experiment');
  await returnToJourney('study');
  const configurationRead=page.waitForResponse(matches('/api/robust-workbench/experiment',{experiment_id:opening.experiment_id}));
  await page.locator('[data-action="journey-regional-prepare-decision"]').click();
  const prepared=await nativeJSON(await configurationRead,'Native experiment decision configuration');
  await page.locator('#rw-editor').waitFor({state:'visible'});
  requireValue(prepared.experiment_id===opening.experiment_id,'Decision preparation opened a different experiment.');
  const title=await page.locator('#rw-title').inputValue();
  const retainedTitle=title+' · regional operator preparation';
  await page.locator('#rw-title').fill(retainedTitle);
  await step('Open explicit native decision configuration',{experiment_id:prepared.experiment_id,source:prepared.configuration.source,metric_units:prepared.configuration.metrics.map(row=>({id:row.id,units:row.units})),candidate_ids:prepared.configuration.candidates.map(row=>row.id),profile_ids:prepared.configuration.profiles.map(row=>row.id)});
  await shot('06-native-decision-preparation','#rw-editor');
  await returnToJourney('study');
  await page.locator('[data-action="journey-regional-prepare-decision"]').click();
  await page.locator('#rw-editor').waitFor({state:'visible'});
  await page.waitForFunction(title=>document.querySelector('#rw-title')?.value===title,retainedTitle);
  await step('Reopen same experiment preparation with draft retained',{experiment_id:opening.experiment_id});
  await returnToJourney('study');
 }
 if(opening.decision_study_id){
  await journey('study');
  const decisionRead=page.waitForResponse(matches('/api/robust-workbench/study',{study_id:opening.decision_study_id,revision:opening.decision_revision}));
  await page.locator('[data-action="journey-regional-decision"]').click();
  const decision=await nativeJSON(await decisionRead,'Saved decision revision');
  requireValue(decision.id===opening.decision_study_id&&decision.revision===opening.decision_revision,'The saved decision opened another revision.');
  await page.locator('#rw-editor').waitFor({state:'visible'});
  await step('Open exact saved decision revision',{study_id:decision.id,revision:decision.revision,sha256:decision.sha256});
  await shot('07-retained-decision-revision','#rw-editor');
  await returnToJourney('inputs');
 }
 await journey('inputs');await selectionVisible(opening);
 const exported=await saveDownload('.operating-journey [data-action="journey-export"]','regional-journey-selections.json');
 const selections=JSON.parse(exported.bytes.toString('utf8'));
 requireValue(selections.schema==='upstate.operating-journey/v1'&&selections.project_id===opening.workspace_id,'The journey export changed the original project.');
 requireValue(selections.selection.profile_id===opening.profile_id&&selections.regional?.export_id===opening.watershed_export_id,'The journey export lost its profile or saved watershed selection.');
 requireValue(selections.regional.report_sha256===saved.report_sha256&&canonical(selections.regional.huc12s)===canonical(saved.huc12s),'The exported journey changed the retained regional identities.');
 const notes=await saveDownload('.operating-journey [data-action="journey-notes"]','regional-operating-notes.md');
 requireValue(notes.bytes.toString('utf8').includes(opening.watershed_export_id),'The operating notes lost the saved regional selection identity.');
 await step('Export original journey selections and operating notes');
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('#workspace-select').waitFor({state:'visible'});
 await chooseWorkspace(opening);await journey('inputs');
 await page.locator('[data-journey-regional-slot] [data-journey-import]').setInputFiles(exported.path);
 await page.getByText('Journey selections opened in this original project.',{exact:true}).waitFor({state:'visible'});
 await selectionVisible(opening);
 const reopened=await saveDownload('.operating-journey [data-action="journey-export"]','regional-journey-reopened.json');
 const reopenedValue=JSON.parse(reopened.bytes.toString('utf8'));
 requireValue(canonical(reopenedValue.selection)===canonical(selections.selection)&&canonical(reopenedValue.regional)===canonical(selections.regional),'Reopening the exported journey changed its native or regional selections.');
 await step('Reload and reimport original journey selections',{profile_id:reopenedValue.selection.profile_id,regional:reopenedValue.regional});
 await shot('08-reopened-regional-journey','[data-journey-regional-slot]');
 await continueNativeSavedView(opening);
 requireValue(journal.browser_errors.length===0,'The native browser journey recorded a page exception; inspect journey.json and its screenshot.');
 journal.status='complete';
}
try{await main();}
catch(error){
 journal.status='failed';journal.error=redact(error?.stack||error);process.exitCode=1;
 if(page&&!page.isClosed())try{await shot('failure-state');}catch{}
}
finally{
 if(context)await context.close().catch(()=>{});
 if(args.video&&page?.video()){
  try{const original=await page.video().path(),named=join(output,'regional-opening.webm');await rename(original,named);journal.video=relative(output,named);}
  catch(error){journal.video_error=redact(error.message);}
 }
 if(browser)await browser.close().catch(()=>{});
 journal.finished_at=new Date().toISOString();await mkdir(output,{recursive:true});
 await writeFile(join(output,'journey.json'),JSON.stringify(journal,null,2)+'\n');
 process.stdout.write(JSON.stringify({status:journal.status,output,workspace_id:journal.workspace_id||null,profile_id:journal.opening?.profile_id||null,error:journal.error?redact(journal.error.split('\n')[0]):null})+'\n');
}
