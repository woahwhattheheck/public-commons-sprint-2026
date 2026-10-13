/**
 * Open the delivered geographic case through its original files and existing Operator.
 * No native model, Operator server, source import or queued mutation is started here.
 */
import {promises as fs, createReadStream, constants as fsConstants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {resolve,join,relative,isAbsolute,sep,extname,basename} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {operateGeographicReview} from './geographic_review_browser.mjs';

const CUTOFF=Date.parse('2026-10-13T14:00:00Z');
const INPUT='upstate.geographic-browser-input/v1', RESULT='upstate.geographic-browser-result/v1';
const now=()=>new Date().toISOString();
const canonical=value=>JSON.stringify(sort(value));
function sort(value){if(Array.isArray(value))return value.map(sort);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])]));return value;}
const equal=(a,b)=>canonical(a)===canonical(b);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function requireValue(ok,message){if(!ok)throw new Error(message);}
async function readJSON(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function atomic(file,value){const pending=file+'.'+randomUUID()+'.tmp';await fs.writeFile(pending,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(pending,file);}
async function fileHash(file){const hash=createHash('sha256');let bytes=0;for await(const part of createReadStream(file)){requireValue(Date.now()<CUTOFF,'The requested 14:00 UTC cutoff was reached');bytes+=part.length;hash.update(part);}return {bytes,sha256:hash.digest('hex')};}
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
 const check=()=>{requireValue(!stopped&&Date.now()<CUTOFF,'The requested 14:00 UTC cutoff or original process interruption was reached');};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 try{
  check();requireValue(argv.length===1&&isAbsolute(argv[0]),'Pass one absolute path to the complete receiving input JSON');
  const settings=await readJSON(argv[0]);
  const allowed=['schema','operation_id','restored_root','connection_file','output_directory','playwright_module','executable','state_file','archive_sha256','handover_id'];
  requireValue(settings.schema===INPUT&&Object.keys(settings).every(k=>allowed.includes(k)),'Select the complete geographic browser input');
  safeId(settings.operation_id);
  let originalState=null;
  if(settings.state_file){
   requireValue(isAbsolute(settings.state_file),'Use the original absolute receiving state path');
   originalState=await readJSON(settings.state_file);
   requireValue(originalState.schema==='upstate.geographic-headwaters-receiving/v1'&&originalState.state==='complete','Finish the same original geographic receiving operation before its browser course');
   settings.restored_root??=originalState.restored?.directory;
   settings.archive_sha256??=originalState.archive?.sha256;
   settings.handover_id??=originalState.handover?.id;
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
  requireValue(prepared.geography&&prepared.geography.model_domain_huc12s?.length&&record.scientific.state==='complete','Select the complete actual geographic course');
  const workspace=join(restored,'workspace');
  requireValue(equal(await readJSON(await regular(workspace,'workspace.json')),project),'The restored Workspace changed its original project');
  const runIds=[prepared.baseline_run_id,...prepared.alternative_run_ids].map(safeId);
  for(const key of ['id','source_collection_id','grid_id','profile_id','ensemble_id'])safeId(prepared[key]);
  safeId(record.delivery_id);
  if(settings.state_file){
   requireValue(isAbsolute(settings.state_file),'Use the original absolute receiving state path');
   const state=originalState;
   requireValue(state.archive?.sha256===settings.archive_sha256&&state.handover?.id===settings.handover_id,'The caller state selects another original archive or handover generation');
   requireValue(state.project_id===project.id&&state.ensemble_id===prepared.ensemble_id&&state.delivery_id===record.delivery_id&&state.prepared?.id===prepared.id,'The caller state names another geographic delivery');
  }
  const connection=await readJSON(settings.connection_file),operatorURL=new URL(connection.operator_url),token=new URLSearchParams(operatorURL.hash.slice(1)).get('token');
  requireValue(['http:','https:'].includes(operatorURL.protocol)&&!operatorURL.username&&!operatorURL.password&&token,'Use the exact existing operator startup URL with its capability');
  requireValue(!operatorURL.search&&['','/'].includes(operatorURL.pathname),'Use the existing operator root URL');
  secret=token;
  safeId(connection.workspace_key);
  if(connection.origin)requireValue(new URL(connection.origin).origin===operatorURL.origin,'The retained operator origin differs');
  const binding={schema:INPUT,operation_id:settings.operation_id,project_id:project.id,geographic_id:prepared.id,
   ensemble_id:prepared.ensemble_id,source_collection_id:prepared.source_collection_id,grid_id:prepared.grid_id,profile_id:prepared.profile_id,
   run_ids:runIds,delivery_id:record.delivery_id,review_id:record.review.review_id,handover_id:completion.id,
   archive_sha256:receiving.archive_sha256,operator_workspace:connection.workspace_key};
  const progressPath=join(output,'browser-progress.json');
  progress=await exists(progressPath)?await readJSON(progressPath):{schema:RESULT,binding,attempts:[],created_at:now()};
  requireValue(progress.schema===RESULT&&equal(progress.binding,binding),'This browser output belongs to a different original case');
  const id=now().replace(/[^0-9]/g,'')+'-'+randomUUID().slice(0,8);
  attempt={id,started_at:now(),state:'running',actions:[],files:[],opened:[],errors:[]};progress.attempts.push(attempt);
  const attemptRoot=join(output,'attempts',id);for(const part of ['media','downloads','records','private'])await fs.mkdir(join(attemptRoot,part),{recursive:true,mode:0o700});
  checkpoint=async()=>{progress.updated_at=now();await atomic(progressPath,progress);};await checkpoint();
  timer=setTimeout(stop,Math.max(1,CUTOFF-Date.now()));
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
  for(const id of runIds)requireValue(before.data.runs.some(x=>x.id===id),'The existing operator has another original native run');
  async function navigate(view){await closeDialog();await click('[data-view="'+view+'"]');}
  await navigate('geographic-headwaters');
  await waitFor(async()=>await page.locator('[data-geo-case="'+prepared.id+'"]').count()>0,'saved geographic case');
  await click('[data-geo-case="'+prepared.id+'"]');
  await page.locator('[data-geo-case-detail]').waitFor({state:'visible'});
  const saved=await api('/api/geographic-headwaters/case',{case_id:prepared.id});
  requireValue(equal(saved.case,prepared),'The saved operator case differs from the delivered geographic source');
  requireValue(saved._downloads?.length>0,'The original saved case has no native file tickets');
  await ticketDownloads('[data-geo-case-detail]',saved._downloads,'original-case-download');
  requireValue(saved._downloads.every(x=>downloadedURLs.has(new URL(x.url,operatorURL).pathname)),'Not every original case download control was exercised');
  await screenshot(page,'geographic-saved-case',1440);await screenshot(page,'geographic-saved-case',390);
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
  await checkpoint();await atomic(join(output,'result.json'),{schema:RESULT,binding,attempt,owner_direction:'2026-10-13.3',cutoff:'2026-10-13T14:00:00Z',automatic_resume:false});
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
