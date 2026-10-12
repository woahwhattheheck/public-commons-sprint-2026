// Complete same-page continuation for the original PMTiles Florence receiving operation.
// The native caller owns its page, browser, server, source and workspace lease.
import {readFile,open,mkdir,rename,link,unlink,mkdtemp} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,isAbsolute,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const SCHEMA='commons.pmtiles-browser-receiving/v1';
const SOURCE={
 app:{path:'/app.js',blob:'c722bb42012a23bbbbace5cc303d884fcdb852ec'},
 html:{path:'/',blob:'02dfc89835f1fd2eb8d1fe78ef356ba7791dfd28'}
};
const FIELDS={editionId:'editionId',expectedVersion:'expectedVersion',name:'editionName',
 notes:'editionNotes',style:'styleResource',archivesText:'archives',spriteText:'sprite',
 glyphsText:'glyphs',decisionsText:'decisions',viewText:'view'};
const SIDE=['reviewer','reviewNote','exportDirectory','packageDirectory','packageDestination',
 'compareEditionId','compareEditionVersion','openEditionId','openEditionVersion','layerFilter'];
function need(value,code,detail=''){if(!value){const error=new Error(code+(detail?': '+detail:''));error.code=code;throw error;}}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
const json=value=>JSON.stringify(canonical(value));
const equal=(a,b)=>json(a)===json(b);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
const safeError=error=>({code:error?.code??'PMTILES_BROWSER_FAILED',message:String(error?.message??error)});
async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function descriptor(path){const bytes=await readFile(path);return {path:resolve(path),bytes:bytes.length,sha256:sha(bytes)};}
async function syncDirectory(path){const handle=await open(dirname(path),'r');try{await handle.sync();}finally{await handle.close();}}
async function writeTemporary(path,bytes){
 const temporary=path+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;return temporary;}
 catch(error){await handle?.close().catch(()=>{});await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});throw error;}
}
async function immutable(path,value){
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),temporary=await writeTemporary(path,bytes);
 try{
  try{await link(temporary,path);await syncDirectory(path);}
  catch(error){if(error.code!=='EEXIST')throw error;const prior=await readFile(path);need(prior.equals(bytes),'PMTILES_BROWSER_INPUT_CHANGED',path);}
 }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 return descriptor(path);
}
async function saved(path,value){
 const temporary=await writeTemporary(path,Buffer.from(JSON.stringify(value,null,2)+'\n'));
 try{await rename(temporary,path);await syncDirectory(path);}
 finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function fromEdition(value){return {editionId:value.id,expectedVersion:value.version,name:value.name,notes:value.notes,
 style:value.style,archivesText:JSON.stringify(value.archives,null,2),spriteText:JSON.stringify(value.sprite,null,2),
 glyphsText:JSON.stringify(value.glyphs,null,2),decisionsText:JSON.stringify(value.layerDecisions,null,2),viewText:JSON.stringify(value.view,null,2)};}
function baseDraft(value){const result={...value};delete result.viewText;return result;}
function locationMatches(value,view,tolerance=0.00002){
 if(!value||!view||!Array.isArray(view.center))return false;
 const lon=((value.longitude+180)%360+360)%360-180;
 return Math.abs(lon-view.center[0])<=tolerance&&Math.abs(value.latitude-view.center[1])<=tolerance&&Math.abs(value.zoom-view.zoom)<=0.002;
}
function stateIdentity(state){const value={...state};delete value.preview;return value;}
function fieldsIdentity(snapshot){return {draft:snapshot.draft,pending:snapshot.saved?.pending??null,uploads:snapshot.saved?.uploads??[],closedRequests:snapshot.saved?.closedRequests??[]};}

/**
 * Continue the page already opened on the original Florence vector release.
 * Returns exact native comparison/observation downloads and desktop/390px views.
 * A completed continuation reopens its saved files; it does not create a release.
 */
export async function exercisePMTilesPreview({page,releaseId,outputDirectory}){
 need(page&&typeof page.locator==='function'&&!page.isClosed(),'PMTILES_BROWSER_PAGE_REQUIRED');
 need(typeof releaseId==='string'&&releaseId.length>0,'PMTILES_BROWSER_RELEASE_REQUIRED');
 need(typeof outputDirectory==='string'&&isAbsolute(outputDirectory),'PMTILES_BROWSER_DIRECTORY_REQUIRED');
 const directory=resolve(outputDirectory);await mkdir(directory,{recursive:true,mode:0o700});
 const helper=await descriptor(fileURLToPath(import.meta.url)),origin=new URL(page.url()).origin;
 const nativeRead=async path=>{
  const result=await page.evaluate(async selected=>{
   const target=new URL(selected,location.origin);
   if(target.origin!==location.origin)throw new Error('The selected native URL changed its workspace origin.');
   const token=sessionStorage.getItem('pmtiles.token:'+location.origin)||document.querySelector('#token')?.value||'';
   const response=await fetch(target,{cache:'no-store',headers:token?{Authorization:'Bearer '+token}:{}});
   const text=await response.text();let value;try{value=JSON.parse(text);}catch{return {status:response.status,error:'Non-JSON original response'};}
   return {status:response.status,value};
  },path);
  need(result.status===200,'PMTILES_BROWSER_NATIVE_READ',path+' HTTP '+result.status);
  return result.value;
 };
 async function snapshot(){
  return page.evaluate(({fields,side})=>{
   const savedKeys=Object.keys(localStorage).filter(k=>k.startsWith('pmtiles.browser.v1:'+location.origin+':'));
   const draft={};for(const [key,id] of Object.entries(fields)){const value=document.getElementById(id)?.value;draft[key]=key==='expectedVersion'?Number(value):value;}
   const workspace=document.querySelector('#identity')?.textContent??'';
   const savedKey=savedKeys.find(key=>{try{return JSON.parse(localStorage.getItem(key))?.schema==='pmtiles.browser.v1'&&JSON.parse(localStorage.getItem(key))?.draft?.editionId===draft.editionId;}catch{return false;}});
   const saved=savedKey?JSON.parse(localStorage.getItem(savedKey)):null;
   const inputs=Object.fromEntries(side.map(id=>[id,document.getElementById(id)?.value??'']));
   const layers=[...document.querySelectorAll('#layerControls input[type=checkbox]')].map(input=>({
    id:input.dataset.layerId,visible:input.checked,note:input.closest('.layerRow')?.querySelector('input[type=text]')?.value??''
   }));
   const detailState=[...document.querySelectorAll('details')].filter(x=>x.id==='comparisonPanel'||x.querySelector(':scope > label > #view')||x.contains(document.querySelector('#view'))).map(x=>({id:x.id||'style-assets',open:x.open}));
   return {draft,savedKey,saved,workspace,inputs,layers,selectedRelease:document.querySelector('#release')?.value??'',
    details:detailState,scroll:{x:scrollX,y:scrollY},viewport:{width:innerWidth,height:innerHeight},
    featureSelection:document.querySelector('#featureSelect')?.value??'',mapLocation:document.querySelector('#mapLocation')?.textContent??''};
  },{fields:FIELDS,side:SIDE});
 }
 await page.locator('#workspace').waitFor({state:'visible',timeout:30000});
 const currentState=await nativeRead('/api/state');
 need(currentState.preview?.alive&&currentState.preview.releaseId===releaseId,'PMTILES_BROWSER_ORIGINAL_PREVIEW_REQUIRED');
 need(currentState.currentRelease===releaseId,'PMTILES_BROWSER_ORIGINAL_PUBLICATION_CHANGED');
 const release=await nativeRead('/api/releases/'+encodeURIComponent(releaseId));
 need(release.id===releaseId&&release.workspaceId===currentState.id,'PMTILES_BROWSER_RELEASE_CHANGED');
 need(typeof release.previousReleaseId==='string'&&release.previousReleaseId,'PMTILES_BROWSER_PREDECESSOR_REQUIRED');
 const edition=await nativeRead('/api/editions/'+encodeURIComponent(release.editionId)+'/'+release.editionVersion);
 const precedingRelease=await nativeRead('/api/releases/'+encodeURIComponent(release.previousReleaseId));
 const precedingEdition=await nativeRead('/api/editions/'+encodeURIComponent(precedingRelease.editionId)+'/'+precedingRelease.editionVersion);
 need(edition.id===release.editionId&&edition.version===release.editionVersion&&precedingRelease.workspaceId===currentState.id,'PMTILES_BROWSER_EDITION_CHANGED');
 const manifestPath=currentState.preview.path.replace(/style\.json$/,'manifest.json');
 const manifest=await nativeRead(manifestPath);
 need(manifest.release.id===releaseId&&manifest.release.manifestSha256===release.manifestSha256&&
  manifest.edition.sourceDigest===edition.sourceDigest&&manifest.review.reviewSha256===release.reviewSha256,'PMTILES_BROWSER_MANIFEST_CHANGED');
 need(manifest.review.previousReleaseId===precedingRelease.id,'PMTILES_BROWSER_REVIEW_PREDECESSOR_CHANGED');
 need(manifest.sources.some(row=>row.header&&Array.isArray(row.metadata?.vector_layers)&&row.metadata.vector_layers.length),'PMTILES_BROWSER_ORIGINAL_VECTOR_METADATA_REQUIRED');
 const source={};
 for(const [name,pin] of Object.entries(SOURCE)){
  const response=await page.request.get(new URL(pin.path,origin).href,{timeout:30000});
  need(response.ok(),'PMTILES_BROWSER_SOURCE_READ',pin.path+' HTTP '+response.status());
  const bytes=await response.body();need(gitBlob(bytes)===pin.blob,'PMTILES_BROWSER_SERVED_SOURCE_CHANGED',pin.path);
  source[name]={path:pin.path,blob:pin.blob,bytes:bytes.length,sha256:sha(bytes)};
 }
 const input={schema:SCHEMA,workspaceId:currentState.id,releaseId,manifestSha256:release.manifestSha256,
  edition:{id:edition.id,version:edition.version,sourceDigest:edition.sourceDigest},
  precedingReleaseId:precedingRelease.id,precedingEdition:{id:precedingEdition.id,version:precedingEdition.version,sourceDigest:precedingEdition.sourceDigest},
  reviewSha256:release.reviewSha256,runtimeSha256:release.runtimeSha256,source,helper:{bytes:helper.bytes,sha256:helper.sha256}};
 const inputPath=join(directory,'input.json');await immutable(inputPath,input);const inputSha256=sha(Buffer.from(json(input)));
 const completePath=join(directory,'browser-result.json'),completed=await readJson(completePath);
 if(completed){
  need(completed.schema===SCHEMA&&completed.status==='COMPLETED'&&completed.inputSha256===inputSha256,'PMTILES_BROWSER_RESULT_CHANGED');
  for(const file of completed.files){need(isAbsolute(file.path)&&!relative(directory,file.path).startsWith('..'),'PMTILES_BROWSER_OUTPUT_PATH_CHANGED');
   const actual=await descriptor(file.path);need(actual.bytes===file.bytes&&actual.sha256===file.sha256,'PMTILES_BROWSER_OUTPUT_CHANGED',file.path);}
  return {...completed,reused:true};
 }
 const baselinePath=join(directory,'original-browser-state.json');
 let baseline=await readJson(baselinePath);
 if(!baseline){baseline=await snapshot();need(baseline.saved?.workspaceId===currentState.id,'PMTILES_BROWSER_DRAFT_WORKSPACE_CHANGED');await immutable(baselinePath,baseline);}
 else need(baseline.saved?.workspaceId===currentState.id,'PMTILES_BROWSER_DRAFT_WORKSPACE_CHANGED');
 const attemptDirectory=await mkdtemp(join(directory,'attempt-'));
 const attempt={schema:SCHEMA,inputSha256,startedAt:new Date().toISOString(),phase:'PREPARING',files:[],restored:false};
 const attemptPath=join(attemptDirectory,'attempt.json');
 const update=async value=>{Object.assign(attempt,value);await saved(attemptPath,attempt);};
 const observedErrors=[],unexpectedWrites=[],responseErrors=[];
 const onPageError=error=>observedErrors.push(String(error.message??error));
 const onRequest=request=>{const url=new URL(request.url());if(url.origin===origin&&url.pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(request.method()))unexpectedWrites.push({method:request.method(),path:url.pathname});};
 const onResponse=response=>{const url=new URL(response.url());if(url.origin===origin&&response.status()>=400&&(/\/preview\//.test(url.pathname)||url.pathname.startsWith('/runtime/')))responseErrors.push({status:response.status(),path:url.pathname.replace(/\/preview\/[^/]+\//,'/preview/<original-session>/')});};
 page.on('pageerror',onPageError);page.on('request',onRequest);page.on('response',onResponse);
 const transitionPath=join(directory,'draft-transition.json'),viewStatePath=join(directory,'original-native-view.json');
 let draftTransition=await readJson(transitionPath),priorNativeView=await readJson(viewStatePath);
 if(draftTransition)need(draftTransition.inputSha256===inputSha256,'PMTILES_BROWSER_DRAFT_TRANSITION_CHANGED');
 if(priorNativeView)need(priorNativeView.inputSha256===inputSha256,'PMTILES_BROWSER_RETAINED_VIEW_CHANGED');
 let selectedDraft=null,transientDraft=false,mainError=null,result=null,initialObservation=null;
 const assertPending=async()=>{
  const value=await snapshot();need(equal(value.saved?.pending??null,baseline.saved?.pending??null),'PMTILES_BROWSER_PENDING_CHANGED');
  need(equal(value.saved?.uploads??[],baseline.saved?.uploads??[]),'PMTILES_BROWSER_UPLOAD_CHANGED');
  return value;
 };
 async function ready(){
  await page.waitForFunction(id=>{
   const node=document.querySelector('#mapStatus');
   return node?.dataset.releaseId===id&&node.dataset.state==='ready'&&document.querySelectorAll('#layerControls input[type=checkbox]').length>0;
  },releaseId,{timeout:60000});
  need(await page.locator('#mapErrors .errorRow').count()===0,'PMTILES_BROWSER_MAP_ERROR');
 }
 async function download(button,name,validate){
  const target=join(attemptDirectory,name),event=page.waitForEvent('download',{timeout:30000});
  await button.click();const item=await event;await item.saveAs(target);
  const failure=await item.failure();need(!failure,'PMTILES_BROWSER_DOWNLOAD_FAILED',failure??'');
  const bytes=await readFile(target);let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{need(false,'PMTILES_BROWSER_DOWNLOAD_NOT_JSON',name);}
  await validate(value);const file=await descriptor(target);attempt.files.push(file);await update({});
  return {value,file,suggestedFilename:item.suggestedFilename()};
 }
 const validateObservation=value=>{
  need(value.schema==='starforge.pmtiles-map-observation.v1'&&value.workspaceId===input.workspaceId,'PMTILES_BROWSER_OBSERVATION_WORKSPACE_CHANGED');
  need(equal(value.release,release)&&equal(value.edition,edition)&&value.review?.reviewSha256===input.reviewSha256,'PMTILES_BROWSER_OBSERVATION_RELEASE_CHANGED');
  need(equal(value.originalSources,manifest.sources),'PMTILES_BROWSER_ORIGINAL_SOURCES_CHANGED');
  need(value.native.selection?.snapshot===release.manifestSha256&&value.native.selection?.editionId===edition.id,'PMTILES_BROWSER_NATIVE_SELECTION_CHANGED');
  need(value.native.state?.loaded&&value.native.state?.idle&&value.native.state?.errorCount===0,'PMTILES_BROWSER_NATIVE_MAP_NOT_READY');
  need(Array.isArray(value.native.layers)&&Array.isArray(value.native.sources),'PMTILES_BROWSER_NATIVE_INVENTORY_MISSING');
 };
 const observation=name=>download(page.locator('#downloadObservation'),name,validateObservation);
 async function openAssets(){
  const details=page.locator('details').filter({has:page.locator('#view')});
  if(!(await details.evaluate(node=>node.open)))await details.locator(':scope > summary').click();
 }
 async function fillDraft(target,{allowViewOnly=false}={}){
  await assertPending();const actual=(await snapshot()).draft;
  need(actual.editionId===target.editionId&&actual.expectedVersion===target.expectedVersion,'PMTILES_BROWSER_DRAFT_SELECTION_CHANGED');
  if(allowViewOnly)need(equal(baseDraft(actual),baseDraft(target)),'PMTILES_BROWSER_UNRELATED_DRAFT_CHANGED');
  draftTransition={schema:SCHEMA,inputSha256,before:actual,target,phase:'PREPARED'};await saved(transitionPath,draftTransition);
  await openAssets();
  for(const [key,id] of Object.entries(FIELDS)){
   if(['editionId','expectedVersion'].includes(key)||allowViewOnly&&key!=='viewText')continue;
   const locator=page.locator('#'+id),value=String(target[key]??'');
   if(await locator.inputValue()!==value){if(key==='style')await locator.selectOption(value);else await locator.fill(value);}
  }
  need(equal((await snapshot()).draft,target),'PMTILES_BROWSER_DRAFT_RESTORE_FAILED');
  draftTransition={...draftTransition,phase:'COMPLETED'};await saved(transitionPath,draftTransition);
 }
 async function openSaved(id,version,expectedDraft=null){
  await assertPending();
  await page.locator('#openEditionId').fill(id);await page.locator('#openEditionVersion').fill(String(version));
  const read=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/editions/'+encodeURIComponent(id)+'/'+version&&response.request().method()==='GET',{timeout:30000});
  await page.locator('#openExactEdition').click();const response=await read;
  need(response.ok(),'PMTILES_BROWSER_EDITION_READ_FAILED');
  await page.waitForFunction(({id,version,expected,fields})=>{
   if(document.querySelector('#editionId')?.value!==id||Number(document.querySelector('#expectedVersion')?.value)!==version)return false;
   return !expected||Object.entries(fields).every(([key,input])=>key==='expectedVersion'?Number(document.getElementById(input)?.value)===expected[key]:document.getElementById(input)?.value===String(expected[key]??''));
  },{id,version,expected:expectedDraft,fields:FIELDS},{timeout:30000});
 }
 function validRestorationCandidate(value){
  if(equal(value,baseline.draft))return true;
  if(draftTransition?.inputSha256===inputSha256&&Object.keys(FIELDS).every(key=>
   equal(value[key],draftTransition.before[key])||equal(value[key],draftTransition.target[key])))return true;
  const accepted=[fromEdition(edition),selectedDraft].filter(Boolean);
  return accepted.some(row=>equal(value,row)||transientDraft&&equal(baseDraft(value),baseDraft(row)));
 }
 async function restore(){
  if(page.isClosed())throw Object.assign(new Error('The original caller page closed before restoring its draft.'),{code:'PMTILES_BROWSER_OWNER_PAGE_CLOSED'});
  const current=await assertPending();
  need(validRestorationCandidate(current.draft),'PMTILES_BROWSER_UNRELATED_DRAFT_CHANGED','The original operator draft has an independent edit.');
  if(current.draft.editionId===edition.id&&current.draft.expectedVersion===edition.version){
   if(selectedDraft)await fillDraft(selectedDraft);
   if(baseline.draft.editionId!==edition.id||baseline.draft.expectedVersion!==edition.version)await openSaved(baseline.draft.editionId,baseline.draft.expectedVersion,baseline.draft);
  }
  const afterOpen=await snapshot();
  need(equal(afterOpen.draft,baseline.draft),'PMTILES_BROWSER_ORIGINAL_DRAFT_CHANGED');
  for(const layer of baseline.layers){
   const control=page.locator('#layerControls').getByLabel(layer.id,{exact:true});
   if(await control.count()&&await control.isChecked()!==layer.visible)await control.setChecked(layer.visible);
  }
  for(const id of SIDE){const locator=page.locator('#'+id);if(await locator.inputValue()!==baseline.inputs[id])await locator.fill(baseline.inputs[id]);}
  if(baseline.selectedRelease&&await page.locator('#release').inputValue()!==baseline.selectedRelease)await page.locator('#release').selectOption(baseline.selectedRelease);
  for(const detail of baseline.details){
   const locator=detail.id==='style-assets'?page.locator('details').filter({has:page.locator('#view')}):page.locator('#'+detail.id);
   if(await locator.count()&&await locator.evaluate(node=>node.open)!==detail.open)await locator.locator(':scope > summary').click();
  }
  if(page.viewportSize()&&(page.viewportSize().width!==baseline.viewport.width||page.viewportSize().height!==baseline.viewport.height))await page.setViewportSize(baseline.viewport);
  if(initialObservation||priorNativeView){await page.locator('#restoreMapView').click();
   await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await ready();}
  await page.evaluate(value=>scrollTo(value.x,value.y),baseline.scroll);
  const final=await snapshot();
  need(equal(fieldsIdentity(final),fieldsIdentity(baseline)),'PMTILES_BROWSER_ORIGINAL_WORK_CHANGED');
  need(equal(final.layers,baseline.layers),'PMTILES_BROWSER_LAYER_NOTES_CHANGED');
  await update({restored:true,restoredAt:new Date().toISOString()});
  return final;
 }
 try{
  await update({phase:'INSPECTING_ORIGINAL_RELEASE'});
  const entering=await assertPending(),earlier=await readJson(join(directory,'active-draft.json'));
  if(earlier){need(earlier.inputSha256===inputSha256,'PMTILES_BROWSER_ACTIVE_DRAFT_CHANGED');selectedDraft=earlier.selectedDraft;transientDraft=true;}
  if(priorNativeView||!equal(entering.draft,baseline.draft)){
   need(validRestorationCandidate(entering.draft),'PMTILES_BROWSER_INCOMPLETE_DRAFT_CHANGED');
   await ready();await restore();
   await update({phase:'INSPECTING_ORIGINAL_RELEASE',restored:false});
  }
  selectedDraft=null;transientDraft=false;
  await ready();
  initialObservation=await observation('original-map-inspection.json');
  need(locationMatches(initialObservation.value.native.location,initialObservation.value.native.originalView),'PMTILES_BROWSER_INITIAL_VIEW_CHANGED');
  const viewIdentity={schema:SCHEMA,inputSha256,originalView:initialObservation.value.native.originalView,
   layers:initialObservation.value.native.layers.map(row=>({id:row.id,visible:row.visible})),
   sources:initialObservation.value.native.sources.map(row=>({id:row.id,type:row.type}))};
  await immutable(viewStatePath,viewIdentity);priorNativeView=viewIdentity;
  need(equal((await snapshot()).layers,baseline.layers),'PMTILES_BROWSER_ORIGINAL_LAYER_CHOICES_CHANGED');
  const expectedLayers=initialObservation.value.native.layers,expectedSources=initialObservation.value.native.sources;
  need(expectedSources.some(row=>row.type==='vector'&&row.loaded===true),'PMTILES_BROWSER_VECTOR_SOURCE_NOT_LOADED');
  const sourceDetails=await page.locator('#mapSources').innerText();
  for(const row of manifest.sources)need(sourceDetails.includes(row.sourceId)&&sourceDetails.includes(row.sha256),'PMTILES_BROWSER_SOURCE_DETAILS_MISMATCH',row.sourceId);
  const originalLayerIds=manifest.sources.flatMap(row=>(row.metadata?.vector_layers??[]).map(layer=>layer.id));
  const renderedLayerIds=await page.locator('#mapSources [data-source-layer]').evaluateAll(nodes=>nodes.map(node=>node.dataset.sourceLayer));
  need(originalLayerIds.every(id=>renderedLayerIds.includes(id)),'PMTILES_BROWSER_VECTOR_METADATA_NOT_RENDERED');
  await page.locator('#release').selectOption(releaseId);
  await page.waitForFunction(({id,sha})=>{const text=document.querySelector('#releaseDetails')?.textContent??'';return text.includes(id)&&text.includes(sha);},{id:releaseId,sha:release.manifestSha256},{timeout:30000});
  const selection=await download(page.locator('#releaseDetails').getByRole('button',{name:'Download release selection',exact:true}),'published-release-selection.json',value=>{
   need(value.schema==='starforge.pmtiles-release-selection.v1'&&value.workspaceId===input.workspaceId,'PMTILES_BROWSER_RELEASE_SELECTION_CHANGED');
   need(equal(value.release,release)&&equal(value.edition,edition)&&equal(value.previous?.release,precedingRelease)&&equal(value.previous?.edition,precedingEdition),'PMTILES_BROWSER_PREDECESSOR_SELECTION_CHANGED');
  });
  const nativeDraft=fromEdition(edition);
  selectedDraft=await page.evaluate(({key,id,version,native})=>{
   const retained=localStorage.getItem(key+':draft:'+encodeURIComponent(id)+':version:'+version)??localStorage.getItem(key+':draft:'+id);
   if(retained){const value=JSON.parse(retained);if(value.expectedVersion===version)return value;}
   return native;
  },{key:baseline.savedKey,id:edition.id,version:edition.version,native:nativeDraft});
  await saved(join(directory,'active-draft.json'),{schema:SCHEMA,inputSha256,selectedDraft});
  await openSaved(edition.id,edition.version,selectedDraft);
  transientDraft=true;
  if(!equal(selectedDraft,nativeDraft))await fillDraft(nativeDraft);
  await openAssets();
  if(!(await page.locator('#comparisonPanel').evaluate(node=>node.open)))await page.locator('#comparisonPanel > summary').click();
  await page.locator('#compareEditionId').fill(precedingEdition.id);
  await page.locator('#compareEditionVersion').fill(String(precedingEdition.version));
  const leftRead=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/editions/'+encodeURIComponent(precedingEdition.id)+'/'+precedingEdition.version,{timeout:30000});
  await page.locator('#compareEditions').click();need((await leftRead).ok(),'PMTILES_BROWSER_PREDECESSOR_READ_FAILED');
  await page.waitForFunction(({before,after})=>!document.querySelector('#downloadComparison')?.disabled&&document.querySelector('#comparisonStatus')?.textContent.includes(before+' → '+after),
   {before:precedingEdition.id+' v'+precedingEdition.version,after:edition.id+' v'+edition.version},{timeout:30000});
  const predecessorComparison=await download(page.locator('#downloadComparison'),'preceding-published-edition-comparison.json',value=>{
   need(value.schema==='starforge.pmtiles-edition-comparison.v1'&&value.workspaceId===input.workspaceId&&value.publishedReleaseId===null,'PMTILES_BROWSER_COMPARISON_IDENTITY_CHANGED');
   need(equal(value.before,precedingEdition)&&equal(value.after,edition),'PMTILES_BROWSER_PREDECESSOR_COMPARISON_CHANGED');
   const fields=['name','notes','style','archives','sprite','glyphs','layerDecisions','view'];
   need(equal(value.changedFields,fields.filter(key=>!equal(precedingEdition[key],edition[key]))),'PMTILES_BROWSER_COMPARISON_FIELDS_CHANGED');
  });
  const publicationRead=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/releases/'+encodeURIComponent(releaseId),{timeout:30000});
  await page.locator('#comparePublished').click();need((await publicationRead).ok(),'PMTILES_BROWSER_CURRENT_PUBLICATION_READ_FAILED');
  await page.waitForFunction(({id,version})=>!document.querySelector('#downloadComparison')?.disabled&&document.querySelector('#comparisonStatus')?.textContent.includes(id+' v'+version+' → '+id+' v'+version),{id:edition.id,version:edition.version},{timeout:30000});
  const publishedComparison=await download(page.locator('#downloadComparison'),'current-published-edition-comparison.json',value=>{
   need(value.schema==='starforge.pmtiles-edition-comparison.v1'&&value.workspaceId===input.workspaceId&&value.publishedReleaseId===releaseId,'PMTILES_BROWSER_PUBLISHED_COMPARISON_CHANGED');
   need(equal(value.before,edition)&&equal(value.after,edition)&&value.changedFields.length===0,'PMTILES_BROWSER_CURRENT_PUBLICATION_CHANGED');
  });
  await update({phase:'MAP_LAYER_AND_VIEW'});
  const selectedLayer=expectedLayers.find(row=>row.visible&&row.source&&expectedSources.some(source=>source.id===row.source&&source.type==='vector'));
  need(selectedLayer,'PMTILES_BROWSER_VISIBLE_VECTOR_LAYER_REQUIRED');
  await page.locator('#layerFilter').fill(selectedLayer.id);
  const filtered=await page.locator('#layerControls .layerRow:not([hidden])').evaluateAll(nodes=>nodes.map(node=>node.dataset.layerId));
  need(filtered.includes(selectedLayer.id),'PMTILES_BROWSER_LAYER_FILTER_FAILED');
  const checkbox=page.locator('#layerControls').getByLabel(selectedLayer.id,{exact:true});
  await checkbox.setChecked(!selectedLayer.visible);
  await page.waitForFunction(({id,visible})=>{const rows=[...document.querySelectorAll('#layerControls input[type=checkbox]')];return rows.find(row=>row.dataset.layerId===id)?.checked===visible;},{id:selectedLayer.id,visible:!selectedLayer.visible},{timeout:10000});
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await ready();
  const toggled=await observation('changed-layer-inspection.json');
  need(toggled.value.native.layers.find(row=>row.id===selectedLayer.id)?.visible===!selectedLayer.visible,'PMTILES_BROWSER_NATIVE_LAYER_UNCHANGED');
  await checkbox.setChecked(selectedLayer.visible);
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await page.locator('#layerFilter').fill(baseline.inputs.layerFilter);
  await ready();
  await page.locator('#fitMap').click();
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await ready();
  await page.locator('#captureView').click();
  await page.waitForFunction(()=>{
   try{const value=JSON.parse(document.querySelector('#view')?.value),text=document.querySelector('#mapLocation')?.textContent??'',actual=text.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if(!actual||!Array.isArray(value.center)||value.center.length!==2||!value.center.every(Number.isFinite)||!Number.isFinite(value.zoom))return false;
    const lon=((actual[0]+180)%360+360)%360-180;
    return Math.abs(lon-value.center[0])<0.00002&&Math.abs(actual[1]-value.center[1])<0.00002&&Math.abs(actual[2]-value.zoom)<0.002;
   }catch{return false;}
  },null,{timeout:10000});
  const captured=JSON.parse(await page.locator('#view').inputValue());
  const fitObservation=await observation('captured-archive-bounds-view.json');
  need(locationMatches(fitObservation.value.native.location,captured),'PMTILES_BROWSER_CAPTURED_VIEW_CHANGED');
  await page.locator('#restoreMapView').click();
  await ready();
  await page.waitForFunction(view=>{
   const text=document.querySelector('#mapLocation')?.textContent??'',numbers=text.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
   if(!numbers||numbers.length<3)return false;
   const lon=((numbers[0]+180)%360+360)%360-180;
   return Math.abs(lon-view.center[0])<0.00002&&Math.abs(numbers[1]-view.center[1])<0.00002&&Math.abs(numbers[2]-view.zoom)<0.002;
  },initialObservation.value.native.originalView,{timeout:30000});
  await fillDraft(nativeDraft,{allowViewOnly:true});
  await update({phase:'ORIGINAL_VECTOR_FEATURES'});
  await page.locator('#map').scrollIntoViewIfNeeded();
  const points=[[0.5,0.5],[0.4,0.5],[0.6,0.5],[0.5,0.4],[0.5,0.6],[0.35,0.35],[0.65,0.35],[0.35,0.65],[0.65,0.65]],probes=[];
  const existingFeature=initialObservation.value.native.feature,currentLocation=initialObservation.value.native.location;
  if(existingFeature&&Math.abs(existingFeature.longitude-currentLocation.longitude)<0.000001&&Math.abs(existingFeature.latitude-currentLocation.latitude)<0.000001)points.shift();
  for(const [fx,fy] of points){
   const before=await page.locator('#featureLocation').innerText(),box=await page.locator('#map').boundingBox();
   need(box&&box.width>100&&box.height>100,'PMTILES_BROWSER_MAP_SIZE_INVALID');
   await page.mouse.click(box.x+box.width*fx,box.y+box.height*fy);
   await page.waitForFunction(previous=>{const text=document.querySelector('#featureLocation')?.textContent??'';return text&&text!==previous;},before,{timeout:15000});
   const count=Number((await page.locator('#featureCount').innerText()).match(/^\d+/)?.[0]??0);
   probes.push({fraction:[fx,fy],location:await page.locator('#featureLocation').innerText(),renderedFeatures:count});
   if(count>0)break;
  }
  need(probes.at(-1)?.renderedFeatures>0,'PMTILES_BROWSER_NO_ORIGINAL_VECTOR_FEATURE',JSON.stringify(probes));
  const featureCount=probes.at(-1).renderedFeatures,featureIndex=featureCount>1?1:0;
  await page.locator('#featureSelect').selectOption(String(featureIndex));
  const geometry=page.locator('#featureDetails details').filter({has:page.getByText('Original feature geometry',{exact:true})});
  if(await geometry.count()&&!(await geometry.evaluate(node=>node.open)))await geometry.locator(':scope > summary').click();
  const featureObservation=await observation('original-vector-feature-inspection.json');
  const nativeFeature=featureObservation.value.native.feature?.features?.[featureIndex];
  need(nativeFeature&&nativeFeature.source&&nativeFeature.sourceLayer&&nativeFeature.geometry&&nativeFeature.properties,'PMTILES_BROWSER_ORIGINAL_FEATURE_INCOMPLETE');
  need(expectedLayers.some(row=>row.id===nativeFeature.layerId&&row.source===nativeFeature.source),'PMTILES_BROWSER_FEATURE_SOURCE_CHANGED');
  need(originalLayerIds.includes(nativeFeature.sourceLayer),'PMTILES_BROWSER_FEATURE_ARCHIVE_LAYER_CHANGED');
  const featureText=await page.locator('#featureDetails').innerText();
  need(featureText.includes(nativeFeature.source)&&featureText.includes(nativeFeature.sourceLayer),'PMTILES_BROWSER_FEATURE_DETAILS_CHANGED');
  const propertyRows=await page.locator('#featureDetails table tbody tr').evaluateAll(rows=>rows.map(row=>({key:row.querySelector('th')?.textContent,value:row.querySelector('td')?.textContent})));
  need(equal(propertyRows,Object.entries(nativeFeature.properties).map(([key,value])=>({key,value:typeof value==='string'?value:JSON.stringify(value)}))),'PMTILES_BROWSER_FEATURE_PROPERTIES_CHANGED');
  need(equal(featureObservation.value.native.layers.map(row=>({id:row.id,visible:row.visible})),expectedLayers.map(row=>({id:row.id,visible:row.visible}))),'PMTILES_BROWSER_LAYER_RESTORE_FAILED');
  need(locationMatches(featureObservation.value.native.location,initialObservation.value.native.originalView),'PMTILES_BROWSER_RELEASED_VIEW_NOT_RESTORED');
  await update({phase:'DESKTOP_AND_NARROW'});
  const screenshot=async(name)=>{
   const path=join(attemptDirectory,name);await page.screenshot({path,fullPage:false});const file=await descriptor(path);attempt.files.push(file);return file;
  };
  await page.locator('#previewPanel').scrollIntoViewIfNeeded();
  const desktop=await screenshot('desktop-map.png');
  await page.locator('#featureDetails').scrollIntoViewIfNeeded();const featureScreen=await screenshot('desktop-original-feature.png');
  await page.setViewportSize({width:390,height:844});await ready();
  await page.locator('#previewPanel').scrollIntoViewIfNeeded();
  const width=await page.evaluate(()=>{
   const viewport=innerWidth,scroll=document.documentElement.scrollWidth;
   const overflowing=[...document.querySelectorAll('body *')].filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&(r.left< -1||r.right>viewport+1);}).slice(0,20).map(node=>({tag:node.tagName,id:node.id,className:typeof node.className==='string'?node.className:'',width:node.getBoundingClientRect().width}));
   return {viewport,scrollWidth:scroll,bodyWidth:document.body.scrollWidth,mapWidth:document.querySelector('#map')?.getBoundingClientRect().width,overflowing};
  });
  const narrow=await screenshot('narrow-390-map.png');
  need(width.scrollWidth<=width.viewport+1&&width.bodyWidth<=width.viewport+1,'PMTILES_BROWSER_NARROW_OVERFLOW',JSON.stringify(width));
  await page.setViewportSize(baseline.viewport);await ready();
  await fillDraft(selectedDraft);transientDraft=false;
  await openSaved(baseline.draft.editionId,baseline.draft.expectedVersion,baseline.draft);
  need(equal((await snapshot()).draft,baseline.draft),'PMTILES_BROWSER_RETAINED_DRAFT_NOT_REOPENED');
  const restored=await restore();
  const finalState=await nativeRead('/api/state'),finalRelease=await nativeRead('/api/releases/'+encodeURIComponent(releaseId));
  need(equal(stateIdentity(finalState),stateIdentity(currentState))&&equal(finalRelease,release),'PMTILES_BROWSER_NATIVE_WORKSPACE_CHANGED');
  need(finalState.preview?.alive&&finalState.preview.releaseId===releaseId,'PMTILES_BROWSER_NATIVE_PREVIEW_CHANGED');
  need(!observedErrors.length&&!responseErrors.length,'PMTILES_BROWSER_PAGE_ERROR',JSON.stringify({page:observedErrors,responses:responseErrors}));
  need(!unexpectedWrites.length,'PMTILES_BROWSER_UNEXPECTED_NATIVE_WRITE',JSON.stringify(unexpectedWrites));
  const facts={schema:SCHEMA,inputSha256,workspaceId:input.workspaceId,releaseId,edition:input.edition,
   precedingReleaseId:input.precedingReleaseId,precedingEdition:input.precedingEdition,originalSources:manifest.sources.map(row=>({sourceId:row.sourceId,resourceId:row.resourceId,bytes:row.bytes,sha256:row.sha256,vectorLayerIds:(row.metadata?.vector_layers??[]).map(layer=>layer.id)})),
   layer:{id:selectedLayer.id,originalVisible:selectedLayer.visible,changedVisible:!selectedLayer.visible,restoredVisible:selectedLayer.visible},
   capturedView:captured,releasedView:initialObservation.value.native.originalView,feature:{selectedIndex:featureIndex,count:featureCount,source:nativeFeature.source,sourceLayer:nativeFeature.sourceLayer,layerId:nativeFeature.layerId,id:nativeFeature.id,probes},
   comparisons:{predecessor:predecessorComparison.file,currentPublished:publishedComparison.file,releaseSelection:selection.file},
   widths:width,restoredDraftSha256:sha(Buffer.from(json(restored.draft))),originalDraftSha256:sha(Buffer.from(json(baseline.draft))),
   preservedPending:restored.saved?.pending?.input?.requestId??null,pageErrors:observedErrors,responseErrors,unexpectedWrites,
   screenshots:{desktop,feature:featureScreen,narrow}};
  const factsFile=await immutable(join(attemptDirectory,'native-browser-outcome.json'),facts);attempt.files.push(factsFile);
  await update({phase:'COMPLETED',completedAt:new Date().toISOString()});
  result={schema:SCHEMA,status:'COMPLETED',inputSha256,workspaceId:input.workspaceId,releaseId,edition:input.edition,
   precedingReleaseId:input.precedingReleaseId,reviewSha256:input.reviewSha256,manifestSha256:input.manifestSha256,
   outcome:factsFile,files:[await descriptor(baselinePath),...attempt.files],completedAt:attempt.completedAt};
 }catch(error){mainError=error;await update({phase:'FAILED',error:safeError(error)}).catch(()=>{});}
 finally{
  if(!attempt.restored){try{await restore();}catch(error){mainError=mainError?new AggregateError([mainError,error],'PMTiles browser work failed and the original draft needs its retained recovery.'):error;
   await update({phase:'RESTORATION_FAILED',restoreError:safeError(error)}).catch(()=>{});}}
  page.off('pageerror',onPageError);page.off('request',onRequest);page.off('response',onResponse);
 }
 if(mainError)throw mainError;
 need(result&&attempt.restored,'PMTILES_BROWSER_CONTINUATION_INCOMPLETE');
 await saved(completePath,result);return result;
}
