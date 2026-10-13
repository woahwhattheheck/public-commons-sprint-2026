/**
 * Open the delivered geographic case through its original files and existing Operator.
 * The original Operator serves this receiving course. No native model or source import is started here.
 * One original choice-document upload receives real file bytes; its receipt is retained without preparing that file.
 * Use an isolated cloud browser while the owner exclusively controls the local browser.
 * Optional programme_action=adopt_completed uses its existing completed-output Programme action.
 */
import {promises as fs, createReadStream, constants as fsConstants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {resolve,join,relative,isAbsolute,sep,extname,basename} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {operateGeographicReview} from './geographic_review_browser.mjs';
import {admitGeographicCourse,operateGeographicCourse,selectGeographicReceivingEdition} from './geographic_browser_course.mjs';
import {operateGeographicAllocation} from './geographic_allocation_browser.mjs';
import {operateGeographicProgramme} from './geographic_programme_browser.mjs';

// Current direction .4 renews the full delivery. A caller may request its own deadline.
let CUTOFF=Infinity;
const INPUT='upstate.geographic-browser-input/v1', RESULT='upstate.geographic-browser-result/v1';
const now=()=>new Date().toISOString();
const canonical=value=>JSON.stringify(sort(value));
function sort(value){if(Array.isArray(value))return value.map(sort);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])]));return value;}
const equal=(a,b)=>canonical(a)===canonical(b);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function requireValue(ok,message){if(!ok)throw new Error(message);}
async function readJSON(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function atomic(file,value){const pending=file+'.'+randomUUID()+'.tmp';await fs.writeFile(pending,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(pending,file);}
async function fileHash(file){const hash=createHash('sha256');let bytes=0;for await(const part of createReadStream(file)){requireValue(Date.now()<CUTOFF,'The caller’s requested receiving cutoff was reached');bytes+=part.length;hash.update(part);}return {bytes,sha256:hash.digest('hex')};}
async function exists(file){try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function member(value){requireValue(typeof value==='string'&&value&&!value.includes('\\')&&!isAbsolute(value)&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Use the original relative member path');return value;}
async function regular(root,name){const path=join(root,member(name));requireValue(await fs.realpath(path)===path&&(await fs.lstat(path)).isFile(),'Use a regular original file without path aliases: '+name);return path;}
async function verified(root,row){requireValue(row&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&/^[a-f0-9]{64}$/.test(row.sha256),'Original file descriptor is incomplete');const path=await regular(root,row.path);requireValue(equal(await fileHash(path),{bytes:row.bytes,sha256:row.sha256}),'Original member changed: '+row.path);return path;}
function safeId(value){requireValue(typeof value==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(value),'Use the actual retained native identifier');return value;}
function cleanURL(value){const u=new URL(value);return u.protocol+'//'+u.host+u.pathname;}
function within(root,path){const rel=relative(root,path);return rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel);}

async function main(argv){
 let context=null,lock=null,lockPath=null,timer=null,stopped=false,progress=null,output=null,attempt=null,checkpoint=null,secret='';
 const publicMessage=value=>secret?String(value).replaceAll(secret,'[private capability]'):String(value);
 const stop=()=>{stopped=true;if(context)context.close().catch(()=>{});};
 const check=()=>{requireValue(!stopped&&Date.now()<CUTOFF,'The caller’s requested cutoff or original process interruption was reached');};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 try{
  check();requireValue(argv.length===1&&isAbsolute(argv[0]),'Pass one absolute path to the complete receiving input JSON');
  const settings=await readJSON(argv[0]);
  const allowed=['schema','operation_id','restored_root','connection_file','output_directory','playwright_module','executable','state_file','archive_sha256','handover_id','completion_scope','programme_action','cutoff'];
  requireValue(settings.schema===INPUT&&Object.keys(settings).every(k=>allowed.includes(k)),'Select the complete geographic browser input');
  safeId(settings.operation_id);
  if(settings.cutoff!==undefined){requireValue(typeof settings.cutoff==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(settings.cutoff)&&Number.isFinite(Date.parse(settings.cutoff)),'Use a complete caller-requested cutoff timestamp with timezone');CUTOFF=Date.parse(settings.cutoff);}
  check();
  if(settings.programme_action!==undefined)requireValue(['inspect','adopt_completed'].includes(settings.programme_action),'Choose inspect or adopt_completed for the original Programme');
  let originalState=null,selectedState=null;
  if(settings.completion_scope!==undefined)requireValue(['reference','full_course'].includes(settings.completion_scope),'Use the actual saved reference or full-course scope');
  if(settings.state_file){
   requireValue(isAbsolute(settings.state_file),'Use the original absolute receiving state path');
   originalState=await readJSON(settings.state_file);
   selectedState=selectGeographicReceivingEdition(settings,originalState,{requireValue});
   settings.completion_scope??=selectedState.completion_scope;
   settings.restored_root??=selectedState.restored?.directory;
   settings.archive_sha256??=selectedState.archive?.sha256;
   settings.handover_id??=selectedState.handover?.id;
  }
  for(const key of ['restored_root','connection_file','output_directory','playwright_module','executable'])requireValue(typeof settings[key]==='string'&&isAbsolute(settings[key]),'Use the actual absolute '+key);
  const restored=await fs.realpath(settings.restored_root);
  output=resolve(settings.output_directory);
  requireValue(!within(restored,output)&&output!==restored&&!within(output,restored),'Keep browser media outside the delivered original case');
  await fs.mkdir(output,{recursive:true,mode:0o700});
  requireValue(await fs.realpath(output)===output,'Use the actual browser output directory without a path alias');
  const privateRoot=join(output,'private');await fs.mkdir(privateRoot,{recursive:true,mode:0o700});
  lockPath=join(privateRoot,'browser.lock');
  const lockRecord={schema:'upstate.geographic-browser-lock/v1',operation_id:settings.operation_id,host:hostname(),pid:process.pid,started_at:now()};
  try{lock=await fs.open(lockPath,'wx',0o600);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const prior=await readJSON(lockPath);requireValue(prior.host===hostname()&&prior.operation_id===settings.operation_id&&Number.isSafeInteger(prior.pid)&&prior.pid>0,'Another original browser process owns this output');
   let active=true;try{process.kill(prior.pid,0);}catch(e){if(e.code==='ESRCH')active=false;else throw e;}
   requireValue(!active,'The original browser process is already active');await fs.unlink(lockPath);lock=await fs.open(lockPath,'wx',0o600);
  }
  await lock.writeFile(canonical(lockRecord)+'\n');await lock.sync();
  const receiving=await readJSON(await regular(restored,'receiving-complete.json'));
  requireValue(receiving.schema==='upstate.scientific-workspace-receiving-completion/v1'&&receiving.result?.identity==='MATCH','Finish the original ordinary project restore first');
  requireValue(/^[a-f0-9]{64}$/.test(settings.archive_sha256||'')&&receiving.archive_sha256===settings.archive_sha256,'Select the exact original archive SHA from the native receiving result');
  const delivered=join(restored,'delivery');
  const completion=await readJSON(await regular(delivered,'handover-complete.json'));
  const record=await readJSON(await verified(delivered,completion.files.handover_record));
  requireValue(/^[a-f0-9]{64}$/.test(settings.handover_id||'')&&completion.id===settings.handover_id&&completion.identity.project_id===record.prepared.project_id,'Select the exact original handover ID from the native receiving result');
  for(const row of Object.values(completion.files))await verified(delivered,row);
  const prepared=record.prepared,project=receiving.result.project;
  requireValue(project.id===prepared.project_id&&record.scientific.workspace_id===project.id&&record.scientific.ensemble_id===prepared.ensemble_id,'The delivered source, project and native ensemble differ');
  requireValue(prepared.geography&&prepared.geography.model_domain_huc12s?.length&&record.scientific.state==='complete','Select the completed actual geographic report edition');
  const workspace=join(restored,'workspace');
  requireValue(equal(await readJSON(await regular(workspace,'workspace.json')),project),'The restored Workspace changed its original project');
  const runIds=[prepared.baseline_run_id,...prepared.alternative_run_ids].map(safeId);
  for(const key of ['id','source_collection_id','grid_id','profile_id','ensemble_id'])safeId(prepared[key]);
  safeId(record.delivery_id);
  const course=await admitGeographicCourse({workspace,record,readJSON,regular,equal,requireValue,safeId});
  requireValue(settings.completion_scope===undefined||settings.completion_scope===course.completion_scope,'The requested scope differs from the original archived report edition');
  if(settings.state_file){
   requireValue(isAbsolute(settings.state_file),'Use the original absolute receiving state path');
   const state=originalState;
   requireValue(selectedState.archive?.sha256===settings.archive_sha256&&selectedState.handover?.id===settings.handover_id,'The caller state selects another original archive or handover generation');
   requireValue(state.project_id===project.id&&state.ensemble_id===prepared.ensemble_id&&selectedState.delivery_id===record.delivery_id&&state.prepared?.id===prepared.id,'The caller state names another geographic delivery');
   requireValue(equal(selectedState.reference_basis,course.reference_basis),'The caller and original archive select different native reference progress');
  }
  const connection=await readJSON(settings.connection_file),operatorURL=new URL(connection.operator_url),token=new URLSearchParams(operatorURL.hash.slice(1)).get('token');
  requireValue(['http:','https:'].includes(operatorURL.protocol)&&!operatorURL.username&&!operatorURL.password&&token,'Use the exact existing operator startup URL with its capability');
  requireValue(!operatorURL.search&&['','/'].includes(operatorURL.pathname),'Use the existing operator root URL');
  secret=token;
  safeId(connection.workspace_key);
  if(connection.origin)requireValue(new URL(connection.origin).origin===operatorURL.origin,'The retained operator origin differs');
  const binding={schema:INPUT,operation_id:settings.operation_id,project_id:project.id,geographic_id:prepared.id,
   ensemble_id:prepared.ensemble_id,source_collection_id:prepared.source_collection_id,grid_id:prepared.grid_id,profile_id:prepared.profile_id,
   run_ids:runIds,completion_scope:course.completion_scope,course_state:course.course_state,
   planned_run_ids:course.planned_run_ids,completed_run_ids:course.completed_run_ids,pending_run_ids:course.pending_run_ids,
   native_progress:course.native_progress,reference_basis:course.reference_basis,
   delivery_id:record.delivery_id,review_id:record.review.review_id,handover_id:completion.id,
   archive_sha256:receiving.archive_sha256,operator_workspace:connection.workspace_key};
  if(settings.programme_action!==undefined)binding.programme_action=settings.programme_action;
  const progressPath=join(output,'browser-progress.json');
  progress=await exists(progressPath)?await readJSON(progressPath):{schema:RESULT,binding,attempts:[],created_at:now()};
  requireValue(progress.schema===RESULT&&equal(progress.binding,binding),'This browser output belongs to a different original case');
  const id=now().replace(/[^0-9]/g,'')+'-'+randomUUID().slice(0,8);
  attempt={id,started_at:now(),state:'running',actions:[],files:[],opened:[],errors:[]};progress.attempts.push(attempt);
  const attemptRoot=join(output,'attempts',id);for(const part of ['media','downloads','records','private'])await fs.mkdir(join(attemptRoot,part),{recursive:true,mode:0o700});
  checkpoint=async()=>{progress.updated_at=now();await atomic(progressPath,progress);};await checkpoint();
  if(Number.isFinite(CUTOFF)){const arm=()=>{const remaining=CUTOFF-Date.now();if(remaining<=0)stop();else timer=setTimeout(arm,Math.min(2147483647,remaining));};arm();}
  function action(kind,detail={}){check();attempt.actions.push({kind,at:now(),...detail});}
  async function artifact(path,role){const row={path:relative(output,path).split(sep).join('/'),...await fileHash(path),role};attempt.files.push(row);await checkpoint();return row;}
  async function saveRecord(name,value){const file=join(attemptRoot,'records',name+'.json');await atomic(file,JSON.parse(JSON.stringify(value,(key,item)=>key==='_downloads'?undefined:item)));await artifact(file,name);return file;}
  async function waitFor(predicate,label,ms=30000){const end=Math.min(Date.now()+ms,CUTOFF);while(Date.now()<end){check();if(await predicate())return;await new Promise(r=>setTimeout(r,150));}throw new Error('The current original control did not become ready: '+label);}
  await fs.access(settings.executable,fsConstants.X_OK);
  const imported=await import(pathToFileURL(settings.playwright_module).href),chromium=imported.chromium||imported.default?.chromium;
  requireValue(chromium?.launchPersistentContext,'Use the installed Playwright Chromium module');
  context=await chromium.launchPersistentContext(join(attemptRoot,'private','profile'),{
   executablePath:settings.executable,headless:true,acceptDownloads:true,viewport:{width:1440,height:1000}});
  context.setDefaultTimeout(30000);context.setDefaultNavigationTimeout(60000);
  const page=context.pages()[0]||await context.newPage();
  const pageErrors=[];context.on('page',p=>p.on('pageerror',e=>pageErrors.push({url:cleanURL(p.url()),message:publicMessage(e.message)})));
  page.on('pageerror',e=>pageErrors.push({url:cleanURL(page.url()),message:publicMessage(e.message)}));
  async function screenshot(target,label,width){
   check();await target.setViewportSize({width,height:1000});await target.evaluate(()=>document.fonts.ready);
   const file=join(attemptRoot,'media',label+'-'+width+'.png');await target.screenshot({path:file,fullPage:true});
   const overflow=await target.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
   const row=await artifact(file,'screen');attempt.opened.push({label,width,url:cleanURL(target.url()),overflow,file:row.path});await checkpoint();
  }
  async function click(selector){check();const item=page.locator(selector).first();await item.waitFor({state:'visible'});await item.click();action('click',{selector});}
  async function closeDialog(){const d=page.locator('#detail-dialog');if(await d.count()&&await d.evaluate(n=>n.open))await click('#detail-dialog [data-action="detail-close"]');}
  async function api(path,query={}){
   check();const u=new URL(path,operatorURL);u.search=new URLSearchParams({workspace:connection.workspace_key,...query}).toString();
   const response=await context.request.get(u.href,{headers:{Authorization:'Bearer '+token,'X-Workspace':connection.workspace_key}});
   requireValue(response.ok(),'The original operator read failed: '+path+' HTTP '+response.status());return response.json();
  }
  const downloadedFiles=new Map();
  async function download(target,label,expected=null){
   check();const [result]=await Promise.all([page.waitForEvent('download'),target.click()]);
   requireValue(!(await result.failure()),'Original download did not complete');
   const nativePath=await result.path(),hash=await fileHash(nativePath);
   if(expected)requireValue(hash.bytes===expected.bytes&&hash.sha256===expected.sha256,'Browser download differs from its original source ticket');
   const previous=downloadedFiles.get(hash.sha256);
   if(previous){await result.delete();action('download',{label,filename:result.suggestedFilename(),...hash,retained_file:previous.item.path});return previous;}
   const name=hash.sha256+'-'+basename(result.suggestedFilename()).replace(/[^a-zA-Z0-9._-]/g,'_');
   const file=join(attemptRoot,'downloads',name);
   try{await fs.link(nativePath,file);}catch(e){if(!['EXDEV','EPERM','EACCES','EOPNOTSUPP','ENOSYS'].includes(e.code))throw e;await result.saveAs(file);}
   await result.delete();
   const item=await artifact(file,label),saved={file,item};downloadedFiles.set(hash.sha256,saved);
   action('download',{label,filename:result.suggestedFilename(),...hash});return saved;
  }
  const downloadedURLs=new Set();
  async function ticketDownloads(container,tickets,label){
   await waitFor(async()=>await page.locator(container+' a[download]').count()>0,'original download controls');
   const links=await page.locator(container+' a[download]').all();
   for(let i=0;i<links.length;i++){
    const href=await links[i].getAttribute('href'),url=new URL(href,operatorURL);
    const ticket=tickets.find(x=>new URL(x.url,operatorURL).pathname===url.pathname);
    requireValue(url.origin===operatorURL.origin&&ticket,'The displayed download must match the original native ticket');
    if(!downloadedURLs.has(url.pathname)){await download(links[i],label,ticket);downloadedURLs.add(url.pathname);action('download_link',{path:url.pathname,label});}
   }
  }
  const opening=await verified(delivered,completion.files.opening_page),startURL=pathToFileURL(opening).href;
  await page.goto(startURL,{waitUntil:'load'});requireValue(await page.locator('#native-filter').count()===1,'Open the original populated geographic START_HERE');
  const tableRows=page.locator('[data-native-case]'),rowCount=await tableRows.count();requireValue(rowCount>0,'The original native comparison table is empty');
  await screenshot(page,'handover',1440);await screenshot(page,'handover',390);
  await saveRecord('original-full-course',course);
  await operateGeographicCourse({page,course,record,screenshot,action,requireValue,equal});
  await page.locator('#native-filter').fill('__no_original_case_matches__');
  await waitFor(async()=>await tableRows.evaluateAll(rows=>rows.every(r=>r.hidden)),'handover filter');
  await page.locator('#clear-filter').click();
  await waitFor(async()=>await tableRows.evaluateAll(rows=>rows.every(r=>!r.hidden)),'Clear retained comparisons');
  requireValue(await page.locator('#native-filter').inputValue()==='','Clear must reset the actual search field');
  action('handover_filter_clear',{rows:rowCount});await screenshot(page,'handover-clear',390);
  const descriptors=new Map();
  for(const row of [...Object.values(record.links.scientific),...Object.values(record.links.delivery),...record.links.figures,record.links.assumptions,record.links.selection,record.links.binding,record.links.native_report])
   descriptors.set(join(workspace,member(row.path)),row);
  for(const row of Object.values(completion.files))descriptors.set(join(delivered,member(row.path)),row);
  for(const report of record.course_snapshot?.joint_reports||[])for(const row of [report.index,report.archive]){await verified(workspace,row);descriptors.set(join(workspace,member(row.path)),row);}
  const primary=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>({href:n.getAttribute('href'),text:n.textContent.trim()})));
  const seen=new Set();
  for(const [index,item] of primary.entries()){
   check();if(!item.href||item.href.startsWith('#'))continue;
   const url=new URL(item.href,startURL);if(url.protocol!=='file:')continue;
   const path=fileURLToPath(url);requireValue(within(restored,path),'A delivered primary link escapes the original restored case');
   if(seen.has(path))continue;seen.add(path);
   const row=descriptors.get(path);
   if(row){const base=within(workspace,path)?workspace:delivered;await verified(base,row);}
   else await regular(restored,relative(restored,path).split(sep).join('/'));
   const extension=extname(path).toLowerCase();
   if(['.html','.htm','.svg','.png','.jpg','.jpeg','.pdf'].includes(extension)){
    const child=await context.newPage();try{
     // Click the original href in its own tab; original relative assets keep their delivered paths.
     await child.goto(startURL,{waitUntil:'load'});
     const actual=child.locator('a[href]').filter({hasText:item.text});
     const candidates=await actual.all();let chosen=null;
     for(const candidate of candidates)if(await candidate.getAttribute('href')===item.href){chosen=candidate;break;}
     requireValue(chosen,'The original handover link disappeared');
     await chosen.click();await child.waitForLoadState('load');
     requireValue(fileURLToPath(child.url().split('#')[0])===path,'The original handover link opened another member');
     await screenshot(child,'member-'+index,1440);
     if(extension!=='.pdf')await screenshot(child,'member-'+index,390);
     action('open_delivered_link',{path:relative(restored,path).split(sep).join('/'),label:item.text});
    }finally{await child.close();}
   }else{
    action('retained_working_attachment',{path:relative(restored,path).split(sep).join('/'),label:item.text,meaning:'Retained original working file; native operator downloads below remain independently hash-checked'});
   }
  }
  await operateGeographicReview({context,delivered,record,attemptRoot,artifact,screenshot,action,check,waitFor});
  await page.goto(operatorURL.href,{waitUntil:'domcontentloaded'});
  await waitFor(async()=>await page.locator('#workspace-select option[value="'+connection.workspace_key+'"]').count()>0,'existing operator workspace');
  await page.locator('#workspace-select').selectOption(connection.workspace_key);
  await waitFor(async()=>{const value=await api('/api/state');return value.workspace_key===connection.workspace_key&&value.data?.project?.id===project.id;},'same restored project');
  const before=await api('/api/state');await saveRecord('operator-before',before);
  requireValue(before.data.sources.some(x=>x.id===prepared.source_collection_id),'The existing operator has another source edition');
  for(const id of course.planned_run_ids)requireValue(before.data.runs.some(x=>x.id===id),'The existing operator omits an original planned native run');
  async function navigate(view){await closeDialog();await click('[data-view="'+view+'"]');}
  await navigate('geographic-headwaters');
  await waitFor(async()=>await page.locator('[data-geo-case="'+prepared.id+'"]').count()>0,'saved geographic case');
  await click('[data-geo-case="'+prepared.id+'"]');
  await page.locator('[data-geo-case-detail]').waitFor({state:'visible'});
  const saved=await api('/api/geographic-headwaters/case',{case_id:prepared.id});
  requireValue(equal(saved.case,prepared),'The saved operator case differs from the delivered geographic source');
  requireValue(saved._downloads?.length>0,'The original saved case has no native file tickets');
  await ticketDownloads('[data-geo-case-detail] > .geo-actions',saved._downloads,'original-case-download');
  requireValue(saved._downloads.every(x=>downloadedURLs.has(new URL(x.url,operatorURL).pathname)),'Not every original case download control was exercised');
  await screenshot(page,'geographic-saved-case',1440);await screenshot(page,'geographic-saved-case',390);
  await operateGeographicAllocation({page,workspace,prepared,saved,api,readJSON,regular,verified,equal,requireValue,check,waitFor,saveRecord,screenshot,action,ticketDownloads,downloadedURLs,context});
  await operateGeographicProgramme({page,prepared,record,completion,delivered,course,verified,mode:settings.programme_action||'inspect',api,readJSON,equal,requireValue,check,waitFor,saveRecord,screenshot,action,download,ticketDownloads,click,closeDialog,navigate});
  await click('[data-geo-edit="'+prepared.id+'"]');
  const title=page.locator('[data-sp-title]');
  await waitFor(async()=>await title.inputValue()===prepared.selection.title,'original geographic choices');
  const choiceDownload=await download(page.locator('[data-geo-save]'),'original-choices');
  const choices=await readJSON(choiceDownload.file);
  requireValue(choices.schema==='upstate.geographic-operator-selection/v1'&&choices.project_id===project.id,'The original downloaded choices belong to another project');
  if(prepared.selection.intakes?.length)requireValue(equal(JSON.parse(choices.payload.options.intakes||'[]'),prepared.selection.intakes),'The original optional intake point selectors were lost when reopening this geographic case');
  await title.fill(prepared.selection.title+' · browser receiving draft');
  await page.locator('[data-geo-reopen]').setInputFiles(choiceDownload.file);
  await waitFor(async()=>await title.inputValue()===prepared.selection.title,'reopen original choices');
  const second=await download(page.locator('[data-geo-save]'),'reopened-choices');
  requireValue(equal((await readJSON(second.file)).payload,choices.payload),'Choice save/reopen changed original selectors or assumptions');
  // Exercise the real upload endpoint once, holding only its actual response while a newer choice is made.
  // The uploaded JSON is the already downloaded choice document, not an asserted geographic source.
  // It is retained as a receipt and restored out of the selection before preview; no Prepare/Run is called.
  const openWorking=async()=>{const details=page.locator('[data-sp-working] details');if(!(await details.evaluate(n=>n.open)))await details.locator('summary').click();};
  await openWorking();
  const workingBefore=await download(page.locator('[data-sp-action="download-working"]'),'working-inputs-before');
  const originalWorking=await readJSON(workingBefore.file);
  requireValue(originalWorking.schema==='upstate.source-working-inputs/v1'&&originalWorking.selection.method==='geographic-headwaters','The complete original working choice was not exported');
  const intakeField='huc_polygons',intakeSelector='[data-sp-input="'+intakeField+'"]';
  const originalSelector=await page.locator(intakeSelector).inputValue();
  let uploaded=null,uploadProblem=null,releaseUpload,uploadSettled;
  const released=new Promise(resolve=>{releaseUpload=resolve;}),settled=new Promise(resolve=>{uploadSettled=resolve;});
  const uploadRoute='**/api/upload*';
  const holdActualUpload=async route=>{
   try{
    const response=await route.fetch({timeout:120000});
    requireValue(response.ok(),'The original upload endpoint returned '+response.status());
    uploaded=await response.json();requireValue(typeof uploaded.id==='string'&&uploaded.id,'The original upload has no retained identity');
    await released;await route.fulfill({response});
   }catch(error){uploadProblem=error;try{await route.abort();}catch{}}
   finally{uploadSettled();}
  };
  await page.route(uploadRoute,holdActualUpload);
  try{
   await page.locator('[data-sp-upload="'+intakeField+'"]').setInputFiles(choiceDownload.file);
   await waitFor(async()=>{if(uploadProblem)throw uploadProblem;return uploaded!==null;},'actual original upload receipt',120000);
   await title.fill(prepared.selection.title+' · retained newer draft');
   await page.locator(intakeSelector).selectOption('');
   releaseUpload();await settled;
   await waitFor(async()=>await page.locator('[data-sp-action="select-upload"]').count()>originalWorking.upload_receipts.filter(x=>x.result?.id).length,'late upload retained without replacing current choice');
   requireValue(await page.locator(intakeSelector).inputValue()===''&&await title.inputValue()===prepared.selection.title+' · retained newer draft','The late upload overwrote newer working choices');
  }finally{releaseUpload();await page.unroute(uploadRoute,holdActualUpload);}
  await openWorking();
  const retained=await download(page.locator('[data-sp-action="download-working"]'),'late-upload-retained');
  const retainedWorking=await readJSON(retained.file),receipt=retainedWorking.upload_receipts.find(row=>row.result?.id===uploaded.id);
  requireValue(receipt&&receipt.state==='retained'&&receipt.field===intakeField&&receipt.method==='geographic-headwaters','The full original late-upload receipt is missing');
  requireValue(receipt.bytes===choiceDownload.item.bytes&&equal(receipt.result,uploaded),'The upload receipt changed its original response or file size');
  const receiptSelector='[data-sp-upload-id="'+receipt.id+'"]';
  const receivedReceipt=await download(page.locator('[data-sp-action="download-upload"]'+receiptSelector),'original-upload-receipt');
  requireValue(equal(await readJSON(receivedReceipt.file),receipt),'The downloaded upload receipt differs from the retained original');
  await page.locator('[data-sp-action="select-upload"]'+receiptSelector).click();
  await waitFor(async()=>JSON.parse(await page.locator(intakeSelector).inputValue()).upload_id===uploaded.id,'explicit original upload selection');
  await screenshot(page,'source-intake-history',1440);await screenshot(page,'source-intake-history',390);

  const priorToInvalid=await download(page.locator('[data-geo-save]'),'choice-before-invalid-import');
  const priorPayload=(await readJSON(priorToInvalid.file)).payload;
  const invalidChoices=JSON.parse(JSON.stringify(choices));invalidChoices.payload.title='This invalid edition must never apply';invalidChoices.payload.options.seed={invalid:'whole number required'};
  await page.locator('[data-geo-reopen]').setInputFiles({name:'invalid-geographic-choice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalidChoices))});
  await waitFor(async()=>await page.locator('[data-geo-notice]').evaluate(node=>node.classList.contains('geo-error')),'complete invalid choice rejected');
  const afterInvalid=await download(page.locator('[data-geo-save]'),'choice-after-invalid-import');
  requireValue(equal((await readJSON(afterInvalid.file)).payload,priorPayload),'A malformed final option partially replaced the working choice');

  // A failed persistence attempt must leave the full live choice intact.
  const storageBlockedChoice=JSON.parse(JSON.stringify(choices));storageBlockedChoice.payload.title='Unretained choice must not become current';
  await page.evaluate(workspaceKey=>{
   if(window.__ecoOriginalStorageSetItem)throw new Error('An earlier original storage receiving step is still active');
   const original=Storage.prototype.setItem;window.__ecoOriginalStorageSetItem=original;
   Storage.prototype.setItem=function(key,value){
    if(this===sessionStorage&&String(key).endsWith(':'+workspaceKey))throw new DOMException('Receiving the original storage-failure path','QuotaExceededError');
    return original.call(this,key,value);
   };
  },originalWorking.workspace_key);
  try{
   await page.locator('[data-geo-reopen]').setInputFiles({name:'storage-blocked-geographic-choice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(storageBlockedChoice))});
   await waitFor(async()=>(await page.locator('[data-geo-notice]').textContent()).includes('could not be retained'),'storage failure preserves complete choice');
   const afterStorageFailure=await download(page.locator('[data-geo-save]'),'choice-after-storage-failure');
   requireValue(equal((await readJSON(afterStorageFailure.file)).payload,priorPayload),'A failed persistence attempt replaced live choices');
   await screenshot(page,'source-intake-storage-failure',1440);
  }finally{
   await page.evaluate(()=>{const original=window.__ecoOriginalStorageSetItem;if(original)Storage.prototype.setItem=original;delete window.__ecoOriginalStorageSetItem;});
  }

  await openWorking();
  await page.locator('[data-sp-working-file]').setInputFiles(workingBefore.file);
  await waitFor(async()=>await title.inputValue()===originalWorking.selection.title&&await page.locator(intakeSelector).inputValue()===originalSelector,'complete working file reopened');
  const recoveredWorkingFile=await download(page.locator('[data-sp-action="download-working"]'),'working-inputs-reopened');
  const recoveredWorking=await readJSON(recoveredWorkingFile.file);
  requireValue(equal(recoveredWorking.selection,originalWorking.selection)&&recoveredWorking.upload_receipts.some(row=>row.id===receipt.id),'Working reopen lost the complete original selection or later upload history');
  const newerPrior=recoveredWorking.input_history.findIndex(row=>row.selection.inputs?.[intakeField]?.upload_id===uploaded.id);
  requireValue(newerPrior>=0,'The replaced complete newer choice was not retained');
  await page.locator('[data-sp-action="restore-working"][data-sp-index="'+newerPrior+'"]').click();
  await waitFor(async()=>JSON.parse(await page.locator(intakeSelector).inputValue()).upload_id===uploaded.id,'earlier complete choice explicitly selected');
  await page.locator('[data-sp-working-file]').setInputFiles(workingBefore.file);
  await waitFor(async()=>await title.inputValue()===originalWorking.selection.title&&await page.locator(intakeSelector).inputValue()===originalSelector,'original working file selected again');

  await page.reload({waitUntil:'domcontentloaded'});await navigate('geographic-headwaters');
  await waitFor(async()=>await title.count()>0&&await title.inputValue()===originalWorking.selection.title,'cold reopened working choice');
  await openWorking();
  const coldWorkingFile=await download(page.locator('[data-sp-action="download-working"]'),'working-inputs-cold-reopen');
  const coldWorking=await readJSON(coldWorkingFile.file);
  requireValue(equal(coldWorking.selection,originalWorking.selection)&&coldWorking.upload_receipts.some(row=>row.id===receipt.id)&&coldWorking.input_history.length>=recoveredWorking.input_history.length,'Cold receiving changed the selected choice or lost original history');
  await screenshot(page,'source-intake-cold-reopen',1440);await screenshot(page,'source-intake-cold-reopen',390);
  await saveRecord('source-input-lifecycle',{original:originalWorking,late:retainedWorking,reopened:recoveredWorking,cold:coldWorking,upload:receipt,invalid_choice_left_selection_unchanged:true});
  action('source_input_lifecycle',{upload_id:uploaded.id,receipt_id:receipt.id,late_response_preserved_newer_choice:true,atomic_invalid_reopen:true,storage_failure_preserves_choice:true,history_reselected:true,cold_reopen:true});

  // Preview reads original geometry only. Do not click Prepare or Run in this receiving course.
  const [previewResponse]=await Promise.all([
   page.waitForResponse(response=>new URL(response.url()).pathname==='/api/geographic-headwaters/preview'&&response.request().method()==='POST'),
   click('[data-geo-preview-button]')]);
  requireValue(previewResponse.ok(),'The actual source-bound geographic preview failed');
  const currentPreview=await previewResponse.json();
  requireValue(equal(currentPreview.preview?.selection,prepared.selection),'The reopened geographic form changed an original selector or physical assumption');
  await saveRecord('reopened-native-preview',currentPreview);
  await waitFor(async()=>{const text=await page.locator('[data-geo-notice]').textContent();if(await page.locator('[data-geo-notice]').evaluate(n=>n.classList.contains('geo-error')))throw new Error(text);return text.includes('Original coverage and assumptions are open');},'actual original geographic preview',120000);
  await screenshot(page,'geographic-choices-preview',1440);await screenshot(page,'geographic-choices-preview',390);
  action('choices_save_edit_reopen_preview',{case_id:prepared.id});

  for(const [kind,id] of [['profiles',prepared.profile_id],['grids',prepared.grid_id],...runIds.map(id=>['runs',id])]){
   await closeDialog();await click('[data-geo-item="'+kind+'"][data-geo-id="'+id+'"]');
   await waitFor(async()=>await page.locator('#detail-dialog').evaluate(n=>n.open),'saved '+kind);
   const original=await api('/api/item',{kind,id});requireValue(original.id===id,'The native item selection changed');
   await saveRecord(kind+'-'+id,original);await screenshot(page,kind+'-'+id.slice(0,12),1440);await screenshot(page,kind+'-'+id.slice(0,12),390);
   if(kind==='runs'){
    const [logResponse]=await Promise.all([
     page.waitForResponse(response=>{const u=new URL(response.url());return u.pathname==='/api/run-log'&&u.searchParams.get('id')===id;}),
     click('#detail-dialog [data-action="run-log"]')]);
    requireValue(logResponse.ok(),'The original native log read failed');
    const log=await logResponse.json();await saveRecord('run-log-'+id,log);
    await page.locator('#native-log').waitFor({state:'visible'});
    await waitFor(async()=>await page.locator('#detail-title').textContent()==='Original native model log'&&(await page.locator('#native-log').textContent()).includes(log.text??log.content??''),'retained native log content');
    await screenshot(page,'run-log-'+id.slice(0,12),1440);
   }
  }
  await navigate('runs');
  for(const id of course.planned_run_ids){
   const retained=course.records.find(row=>row.path==='runs/'+id+'/run.json').value;
   const current=await api('/api/item',{kind:'runs',id});
   requireValue(equal(Object.fromEntries(Object.entries(current).filter(([key])=>key!=='_downloads')),retained),'The Operator changed an original planned native record');
   await saveRecord('planned-run-'+id,current);
   if(runIds.includes(id))continue;
   await closeDialog();await click('[data-action="item"][data-kind="runs"][data-id="'+id+'"]');
   await waitFor(async()=>await page.locator('#detail-dialog').evaluate(node=>node.open),'original sensitivity run');
   await screenshot(page,'planned-run-'+id.slice(0,12),1440);await screenshot(page,'planned-run-'+id.slice(0,12),390);
   action('planned_run_opened',{run_id:id,state:current.state,completion_scope:course.completion_scope});
  }
  await navigate('sources');await click('[data-action="item"][data-kind="sources"][data-id="'+prepared.source_collection_id+'"]');
  const sources=await api('/api/item',{kind:'sources',id:prepared.source_collection_id});
  await screenshot(page,'original-source-edition',1440);await screenshot(page,'original-source-edition',390);
  for(const entry of sources.entries){
   await closeDialog();await click('[data-action="item"][data-kind="sources"][data-id="'+prepared.source_collection_id+'"]');
   await click('[data-action="source-inspect"][data-collection="'+prepared.source_collection_id+'"][data-source="'+entry.id+'"]');
   const info=await api('/api/source-info',{collection:prepared.source_collection_id,source:entry.id});
   requireValue(info.source.id===entry.id,'The original source selection changed');
   await waitFor(async()=>await page.locator('#detail-title').textContent()===info.source.title,'selected original source details');
   await waitFor(async()=>await page.locator('#detail-dialog a[download]').evaluateAll((nodes,path)=>nodes.some(n=>new URL(n.href).pathname===path),new URL(info.download.url,operatorURL).pathname),'selected original source download');
   await screenshot(page,'source-'+entry.id.replace(/[^a-zA-Z0-9_-]/g,'_'),1440);
   await ticketDownloads('#detail-dialog',[info.download],'original-source-download');
  }
  await navigate('deliveries');
  await click('[data-action="item"][data-kind="deliveries"][data-id="'+record.delivery_id+'"]');
  const deliveryPacket=await api('/api/delivery-inspection',{delivery_id:record.delivery_id});
  requireValue(deliveryPacket.schema==='upstate.delivery-inspection/v1'&&deliveryPacket.delivery_id===record.delivery_id&&deliveryPacket.workspace_key===connection.workspace_key,'The current original delivery inventory is unavailable');
  const deliveredRecord=await readJSON(await regular(workspace,'deliveries/'+record.delivery_id+'/delivery-state.json'));
  requireValue(deliveryPacket.detail?.id===deliveredRecord.id&&deliveredRecord.state==='complete','The delivery browser and restored original record differ');
  requireValue(deliveredRecord.selection.baseline_run_id===runIds[0]&&equal(deliveredRecord.selection.scenario_run_ids,runIds.slice(1)),'The displayed delivery uses another original model comparison');
  await page.locator('[data-delivery-inspection]').waitFor({state:'visible'});
  await screenshot(page,'native-delivery',1440);await screenshot(page,'native-delivery',390);
  await page.locator('[data-delivery-inspection-files]').waitFor({state:'visible'});
  await page.locator('[data-delivery-inspection-size]').selectOption('250');
  const pageStates=new Set();
  while(true){
   check();
   const status=await page.locator('[data-delivery-inspection-files] [role="status"]').textContent();
   requireValue(!pageStates.has(status),'The original delivery file pagination did not advance');pageStates.add(status);
   await ticketDownloads('#detail-dialog',deliveryPacket.files,'native-delivery-download');
   const next=page.locator('[data-action="delivery-inspection-page"][data-direction="1"]');
   if(await next.isDisabled())break;
   await next.click();
   await waitFor(async()=>await page.locator('[data-delivery-inspection-files] [role="status"]').textContent()!==status,'next original delivery file page');
  }
  requireValue(deliveryPacket.files.every(x=>downloadedURLs.has(new URL(x.url,operatorURL).pathname)),'Not every original delivery file link was exercised');
  action('complete_delivery_downloads',{files:deliveryPacket.files.length,pages:pageStates.size,distinct_bodies:downloadedFiles.size});
  const after=await api('/api/state');await saveRecord('operator-after',after);
  for(const kind of ['sources','profiles','grids','scenarios','runs','deliveries']){
   const ids=value=>value.data[kind].map(x=>x.id).sort();
   requireValue(equal(ids(before),ids(after)),'The receiving course must preserve original '+kind+' identities');
  }
  await page.reload({waitUntil:'domcontentloaded'});await navigate('geographic-headwaters');
  await waitFor(async()=>await page.locator('[data-geo-case="'+prepared.id+'"]').count()>0,'same case after actual reload');
  await click('[data-geo-case="'+prepared.id+'"]');await screenshot(page,'geographic-reopened',1440);await screenshot(page,'geographic-reopened',390);
  await saveRecord('browser-errors',pageErrors);
  requireValue(!pageErrors.length,'An actual outgoing page raised a browser error; inspect retained diagnostics');
  attempt.state='browser_completed';attempt.completed_at=now();attempt.elapsed_seconds=(Date.parse(attempt.completed_at)-Date.parse(attempt.started_at))/1000;
  attempt.human_inspection='The producing worker must open and personally view these actual screens and every outgoing attachment. Automated capture is not visual acceptance.';
  await checkpoint();await atomic(join(output,'result.json'),{schema:RESULT,binding,attempt,owner_direction:'2026-10-13.4',cutoff:settings.cutoff??null,automatic_resume:false});
  process.stdout.write(JSON.stringify({state:'browser_completed',project_id:project.id,geographic_id:prepared.id,result:join(output,'result.json'),files:attempt.files.length,elapsed_seconds:attempt.elapsed_seconds})+'\n');
 }catch(error){
  if(attempt){attempt.state=stopped||Date.now()>=CUTOFF?'interrupted':'failed';attempt.ended_at=now();attempt.error={name:error.name,message:publicMessage(error.message)};
   try{await checkpoint();await atomic(join(output,'private','last-error.json'),{at:now(),message:publicMessage(error.message),stack:publicMessage(error.stack)});}catch{}}
  process.stderr.write(JSON.stringify({state:stopped||Date.now()>=CUTOFF?'interrupted':'failed',message:publicMessage(error.message),automatic_resume:false})+'\n');process.exitCode=stopped?130:1;
 }finally{
  if(timer)clearTimeout(timer);if(context)try{await context.close();}catch{}
  process.off('SIGTERM',stop);process.off('SIGINT',stop);
  if(lock){try{await lock.close();}catch{}try{await fs.unlink(lockPath);}catch{}}
 }
}
await main(process.argv.slice(2));
