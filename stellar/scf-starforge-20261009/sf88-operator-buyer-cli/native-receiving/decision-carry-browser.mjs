// Complete visible receiving of the original decision carry-forward workspace.
// All application writes use the shipped interface. Native JSON reads reconcile
// the original browser/native request IDs across interrupted sessions.
import {mkdir,readFile,open,rename,unlink,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname,join,relative} from 'node:path';
import {createRequire} from 'node:module';

const API='/api/reconciliation';
const ID32=/^[0-9a-f]{32}$/;
const ID64=/^[0-9a-f]{64}$/;
const need=(value,message)=>{if(!value)throw new Error(message);};
const canonical=value=>JSON.stringify(normalize(value));
function normalize(value){
  if(Array.isArray(value))return value.map(normalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])]));
  return value;
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fileIdentity(path){
  const info=await lstat(path);
  need(info.isFile()&&!info.isSymbolicLink(),'Keep the original regular receiving file: '+path);
  const hash=createHash('sha256');
  for await(const bytes of createReadStream(path))hash.update(bytes);
  return {bytes:info.size,sha256:hash.digest('hex')};
}
async function durableFile(path){
  const handle=await open(path,'r');
  try{await handle.sync();}finally{await handle.close();}
  await durableDirectory(dirname(path));
}
async function durableDirectory(path){
  const directory=await open(path,'r');
  try{await directory.sync();}finally{await directory.close();}
}
async function maybeJson(path){
  try{return JSON.parse(await readFile(path,'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function atomicJson(path,value){
  const temporary=path+'.pending-'+randomUUID();
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}
  finally{await handle.close();}
  try{await rename(temporary,path);}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  const directory=await open(dirname(path),'r');
  try{await directory.sync();}finally{await directory.close();}
}
function safeRelative(name){
  need(typeof name==='string'&&name.length>0&&!name.startsWith('/')&&
    !name.split('/').some(part=>!part||part==='.'||part==='..'||/[\\\u0000-\u001f]/.test(part)),
    'The complete handover contains an invalid relative file name.');
  return name;
}
async function regularParents(root,name){
  const pieces=safeRelative(name).split('/');
  let current=root;
  await mkdir(root,{recursive:true,mode:0o700});
  for(const piece of pieces.slice(0,-1)){
    current=join(current,piece);
    await mkdir(current,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    const info=await lstat(current);
    need(info.isDirectory()&&!info.isSymbolicLink(),'The receiving directory changed: '+current);
    await durableDirectory(current);
    await durableDirectory(dirname(current));
  }
  return join(root,...pieces);
}

/**
 * url is the original private local launch URL, including its capability fragment.
 * playwright is the installed Playwright module or its importable module path.
 * chromium is the existing complete Chrome/Chromium executable path.
 * Reuse outputDirectory and input verbatim when continuing this same operation.
 */
export async function runDecisionCarryBrowserReceiving({url,input,outputDirectory,playwright,chromium}){
  const launch=new URL(url);
  need(['http:','https:'].includes(launch.protocol)&&['127.0.0.1','localhost','[::1]'].includes(launch.hostname),
    'Use the original loopback workspace listener.');
  need(launch.hash.length>1,'Use the original private launch link.');
  need(ID32.test(input.workspace_id||''),'Missing original workspace_id');
  for(const key of ['pair_id','source_report_id','target_run_id'])need(ID64.test(input[key]||''),'Missing original '+key);
  need(/^[0-9a-f]{40}$/.test(input.source_commit||''),'Select the complete original source commit.');
  for(const key of ['operation_id','scope_basis','actor','reason'])need(typeof input[key]==='string'&&input[key].trim(),'Retain '+key);
  need(Buffer.byteLength(input.actor)<=240&&Buffer.byteLength(input.reason)<=16000&&Buffer.byteLength(input.scope_basis)<=16000,
    'Use the complete original engineering text within the product limits.');
  need(typeof chromium==='string'&&chromium.length>0,'Select the existing native Chromium executable.');

  const output=resolve(outputDirectory);
  await mkdir(output,{recursive:true,mode:0o700});
  const outputInfo=await lstat(output);
  need(outputInfo.isDirectory()&&!outputInfo.isSymbolicLink(),'Select the original regular receiving directory.');
  const recordPath=join(output,'decision-carry-browser.json');
  const prior=await maybeJson(recordPath);
  if(prior)need(prior.schema==='stellar-forge.decision-carry.browser-receiving.v1'&&canonical(prior.input)===canonical(input),
    'Continue the same complete browser receiving input and directory.');
  if(prior?.status==='COMPLETE'&&!prior.close_error&&prior.result){
    need(prior.result.download_directory===join(output,'handover')&&Array.isArray(prior.result.files)&&prior.result.files.length>0,
      'Reopen the original complete receiving directory.');
    for(const file of prior.result.files){
      const path=await regularParents(output,'handover/'+safeRelative(file.name));
      need(file.path===path,'The completed handover file path changed: '+file.name);
      const actual=await fileIdentity(path);
      need(actual.bytes===file.bytes&&actual.sha256===file.sha256,'The completed native handover file changed: '+file.name);
      await durableFile(path);
    }
    const manifest=await fileIdentity(join(output,'handover','manifest.json'));
    need(manifest.sha256===prior.result.manifest_sha256,'The completed native handover manifest changed.');
    return prior.result;
  }
  const journal=prior||{schema:'stellar-forge.decision-carry.browser-receiving.v1',input,
    started_at:new Date().toISOString(),status:'RUNNING',stages:[],requests:{},artifacts:{},downloads:{},
    originals:[],browser_errors:[],post_observations:[],
    download_mode:'Shipped individual-download fallback; optional file-picker APIs are disabled for unattended receiving.'};
  journal.attempts??=[];
  journal.attempts.push({started_at:new Date().toISOString(),prior_status:prior?.status||null});
  journal.status='RUNNING';delete journal.error;delete journal.close_error;
  let writes=Promise.resolve(),writeError=null,context,page;
  const persist=()=>{
    const next=writes.then(()=>atomicJson(recordPath,journal));
    writes=next.catch(error=>{writeError=error;});
    return next;
  };
  const stage=async(message,detail={})=>{
    journal.stages.push({at:new Date().toISOString(),message,...detail});
    await persist();process.stdout.write(message+'\n');
  };
  const sanitize=error=>String(error?.stack||error).split(launch.hash.slice(1)).join('[private capability]');
  const artifact=async(name,value)=>{
    const path=await regularParents(output,name);
    await atomicJson(path,value);
    const identity=await fileIdentity(path);
    journal.artifacts[name]={path:relative(output,path),...identity};
    await persist();return path;
  };
  const get=async(path)=>{
    need(path.startsWith('/api/'),'Read the original workspace API.');
    return page.evaluate(async({path,workspace})=>{
      const response=await fetch(path,{cache:'no-store',headers:{
        'X-DuckDB-Capability':sessionStorage.getItem('stellar_duckdb_capability')||'',
        'X-DuckDB-Workspace-ID':workspace}});
      const value=await response.json();
      if(!response.ok)throw new Error('Original read '+response.status+': '+JSON.stringify(value));
      return value;
    },{path,workspace:input.workspace_id});
  };
  const idle=async()=>{
    await page.locator('#main[aria-busy="false"]').waitFor({state:'attached',timeout:180000});
    const error=page.locator('#notice[data-level="error"]:visible');
    if(await error.count())throw new Error(await error.textContent());
    const storage=page.locator('#storage-notice:visible');
    if(await storage.count())throw new Error(await storage.textContent());
    await writes;if(writeError)throw writeError;
  };
  const click=async(locator)=>{
    await locator.click({timeout:30000});await idle();
  };
  const goto=async(selector,value)=>{
    const target=new URL('/reconciliation/carry-forward',launch);
    if(selector)target.searchParams.set(selector,value);
    target.hash=launch.hash;
    await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:60000});
    await idle();
    need((await page.locator('#workspace-id').textContent()).trim()===input.workspace_id,
      'The visible page belongs to a different workspace.');
  };
  const panel=label=>page.getByRole('heading',{name:label,exact:true}).locator('..');
  const jsonDetails=async(label,scope=page)=>{
    const direct=scope.locator('summary').filter({hasText:new RegExp('^'+label.replace(/[|\\{}()[\]^$+*?.-]/g,'\\$&')+'$')});
    need(await direct.count()===1,'Open exactly one original detail: '+label);
    const parent=direct.locator('..');
    if(await parent.getAttribute('open')===null)await direct.click();
    return JSON.parse(await parent.locator(':scope > pre').textContent());
  };
  const screenshot=async(name,target)=>{
    if(target)await target.scrollIntoViewIfNeeded();
    const widths=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    need(widths.document<=widths.viewport+2,'The shipped page has horizontal overflow at '+widths.viewport+' pixels.');
    const path=await regularParents(output,'screenshots/'+name);
    await page.screenshot({path,fullPage:false});
    journal.artifacts['screenshots/'+name]={path:'screenshots/'+name,...await fileIdentity(path),viewport:page.viewportSize()};
    await persist();
  };
  const download=async(locator,name,expected)=>{
    const known=journal.artifacts[name]||journal.downloads[name];
    const path=await regularParents(output,name);
    if(known){
      const actual=await fileIdentity(path);
      need(actual.bytes===known.bytes&&actual.sha256===known.sha256,'The completed receiving file changed: '+name);
      if(expected)need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'The retained file differs from the native export: '+name);
      await durableFile(path);
      return path;
    }
    const temporary=path+'.download-'+randomUUID();
    const event=page.waitForEvent('download',{timeout:180000});
    await locator.click({timeout:30000});
    const item=await event;
    await item.saveAs(temporary);
    const failure=await item.failure();
    need(!failure,'The original browser download failed: '+failure);
    await idle();
    const actual=await fileIdentity(temporary);
    if(expected)need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,
      'The complete downloaded file differs from the native manifest: '+name);
    await durableFile(temporary);
    await rename(temporary,path);
    await durableDirectory(dirname(path));
    const descriptor={path:name,suggested_filename:item.suggestedFilename(),...actual};
    if(expected)journal.downloads[name]=descriptor;else journal.artifacts[name]=descriptor;
    await persist();return path;
  };
  async function localRequests(){
    return page.evaluate(workspace=>new Promise((accept,reject)=>{
      const request=indexedDB.open('stellar_duckdb_reconciliation');
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('requests')){db.close();accept([]);return;}
        const transaction=db.transaction('requests','readonly'),all=transaction.objectStore('requests').getAll();
        all.onerror=()=>{db.close();reject(all.error);};
        all.onsuccess=()=>{const records=all.result.filter(record=>record.workspace_id===workspace&&record.context==='decision-carry');db.close();accept(records);};
      };
    }),input.workspace_id);
  }
  async function allOperations(family){
    const path=family==='export'?'/api/catalog/operations':API+'/operations';
    let offset=0,total=null;const out=[],seen=new Set();
    for(;;){
      need(!seen.has(offset),'The original request catalog repeated its cursor.');seen.add(offset);
      const result=await get(path+'?offset='+offset+'&limit=100');
      need(Array.isArray(result.operations)&&result.offset===offset&&Number.isSafeInteger(result.total),
        'Read the complete original request catalog.');
      if(total===null)total=result.total;
      need(total===result.total,'The original request catalog changed while reopening it.');
      out.push(...result.operations);
      if(result.next_offset===null||result.next_offset===undefined)break;
      need(Number.isSafeInteger(result.next_offset)&&result.next_offset>offset,'The original request continuation is invalid.');
      offset=result.next_offset;
    }
    need(out.length===total,'The complete original request catalog was not returned.');
    return out;
  }
  function normalizeRequest(record,family){
    const route=record.route||(family==='export'?null:API+'/'+record.kind);
    const body=record.body||(record.body_text?JSON.parse(record.body_text):null);
    return {...record,route,body,family,request_id:record.request_id};
  }
  async function matchingRequest(kind,matches){
    const family=kind==='exports'?'export':'reconciliation',route=API+'/'+kind,byId=new Map();
    for(const record of await localRequests()){
      const r=normalizeRequest(record,record.family);
      if(r.route===route&&matches(r.body))byId.set(r.request_id,r);
    }
    for(const record of await allOperations(family)){
      const row=normalizeRequest(record,family);
      if(row.route!==route&&record.kind!==kind)continue;
      const detailed=record.body?record:await get((family==='export'?'/api':API)+'/requests/'+record.request_id);
      const r=normalizeRequest(detailed,family);
      if(r.route===route&&matches(r.body))byId.set(r.request_id,{...byId.get(r.request_id),...r,native_record:true});
    }
    const selected=journal.requests[kind]?.request_id;
    if(selected){
      need(byId.has(selected),'The saved original '+kind+' request is missing from its native/browser journal.');
      return byId.get(selected);
    }
    need(byId.size<=1,'Several original '+kind+' requests match this receiving input; keep their actual identities for reconciliation.');
    return [...byId.values()][0]||null;
  }
  async function requestInUI(record){
    await click(page.locator('[data-screen="requests"]'));
    const retained=page.locator('[data-request-id="'+record.request_id+'"]');
    if(await retained.count()){
      // Its original prepared body can be continued even before native acceptance.
    }else if(record.family!=='export'){
      await goto('request_id',record.request_id);
    }else{
      const original=panel('Original export journal');
      for(;;){
        const row=original.locator('.record').filter({hasText:record.request_id});
        if(await row.count()){await click(row.getByRole('button',{name:'Inspect native record',exact:true}));break;}
        const next=original.getByRole('button',{name:'Next',exact:true});
        need(await next.isEnabled(),'The original export request is absent from the visible complete journal.');
        await click(next);
      }
    }
    let card=page.locator('[data-request-id="'+record.request_id+'"]');
    need(await card.count()===1,'The complete original request is not open in its browser card.');
    await click(card.getByRole('button',{name:'Inspect original request',exact:true}));
    card=page.locator('[data-request-id="'+record.request_id+'"]');
    const openSaved=card.getByRole('button',{name:'Open saved result',exact:true});
    if(await openSaved.count())await click(openSaved);
    else await click(card.getByRole('button',{name:'Continue original request',exact:true}));
  }
  async function mutation(kind,matches,activate){
    let record=await matchingRequest(kind,matches);
    if(record){
      journal.requests[kind]={request_id:record.request_id,route:record.route,family:record.family,body:record.body};
      await persist();await requestInUI(record);
    }else{
      await stage('Executing the original visible '+kind+' action.');
      await activate();
    }
    record=await matchingRequest(kind,matches);
    need(record&&record.native_record&&record.state==='COMPLETE'&&record.result,'The original '+kind+' request has not returned its completed native result.');
    journal.requests[kind]={request_id:record.request_id,route:record.route,family:record.family,body:record.body,
      native_state:record.state,result:record.result};
    await persist();return record.result;
  }

  async function candidateRow(candidate){
    await page.getByLabel('Finding',{exact:true}).selectOption(candidate.state);await idle();
    await page.getByLabel('Decision subject',{exact:true}).selectOption(candidate.kind);await idle();
    const catalog=panel('All earlier decisions');
    for(;;){
      const rows=catalog.locator('tbody tr');
      for(let i=0;i<await rows.count();i++){
        if((await rows.nth(i).locator('td').nth(1).textContent()).trim()===String(candidate.candidate_id))return rows.nth(i);
      }
      const next=catalog.getByRole('button',{name:'Next',exact:true});
      need(await next.isEnabled(),'The original candidate is absent from its visible catalog: '+candidate.candidate_id);
      await click(next);
    }
  }
  async function inspectOriginal(candidate,which){
    const subject=which==='source'?candidate.source_subject:candidate.target_subject;
    if(!subject)return;
    const row=subject.kind==='row',earlier=which==='source';
    const label=row?'Inspect original '+(earlier?'earlier':'later')+' row':
      'Inspect all '+(earlier?'earlier':'later')+' group rows';
    await click(page.locator('#candidate-inspection').getByRole('button',{name:label,exact:true}));
    const title=(earlier?'Earlier':'Later')+' original '+(row?'row':'group rows');
    const original=panel(title),pages=[];
    for(;;){
      const record=await jsonDetails(row?'Complete original row record':'Complete original row page and column definitions',original);
      pages.push(record);
      if(row||record.next_offset===null||record.next_offset===undefined)break;
      await click(original.getByRole('button',{name:'Next',exact:true}));
    }
    if(!row){
      need(pages.flatMap(record=>record.rows).length===pages[0].total,
        'The visible original group did not return all of its native rows.');
    }
    journal.originals=journal.originals.filter(record=>record.candidate_id!==candidate.candidate_id||record.which!==which);
    journal.originals.push({candidate_id:candidate.candidate_id,which,subject,pages});
    await persist();
  }

  let failure=null,result=null;
  try{
    const module=typeof playwright==='string'?createRequire(import.meta.url)(playwright):playwright;
    const engine=module?.chromium||module?.default?.chromium;
    need(engine&&typeof engine.launchPersistentContext==='function','Use the installed original Playwright module.');
    const profile=join(dirname(output),'decision-carry-profile-'+sha(Buffer.from(input.operation_id)).slice(0,20));
    await stage('Opening the original visible carry-forward workspace.');
    context=await engine.launchPersistentContext(profile,{executablePath:chromium,headless:true,acceptDownloads:true,
      viewport:{width:1280,height:900},args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
    // Exercise the product's supported individual-download branch. The API,
    // fetched response bodies, complete manifests and browser downloads stay real.
    await context.addInitScript(()=>{
      Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined});
      Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:undefined});
    });
    page=context.pages()[0]||await context.newPage();
    const priorErrorCount=journal.browser_errors.length;
    page.on('pageerror',error=>{
      journal.browser_errors.push({at:new Date().toISOString(),message:sanitize(error)});
      persist().catch(()=>{});
    });
    page.on('request',request=>{
      if(request.method()!=='POST')return;
      const path=new URL(request.url()).pathname;
      if(!path.startsWith('/api/'))return;
      const bodyText=request.postData();
      let body=null;try{body=JSON.parse(bodyText||'null');}catch{}
      journal.post_observations.push({at:new Date().toISOString(),route:path,
        request_id:body?.request_id||path.match(/\/requests\/([a-f0-9]{32})\/resume$/)?.[1]||null,body});
      persist().catch(()=>{});
    });
    await goto('source_report_id',input.source_report_id);
    need(await page.getByLabel('Saved pair',{exact:true}).inputValue()===input.pair_id,
      'The frozen report selected a different pair.');
    const identity=await get('/api/identity');
    need(identity.workspace_id===input.workspace_id,'The original native workspace identity changed.');
    const script=await page.request.get(new URL('/reconciliation/carry-forward.js',launch).href);
    need(script.ok(),'The complete served carry-forward interface source was unavailable.');
    journal.served_interface_sha256=sha(await script.body());
    await persist();

    const review=await mutation('carry-review',body=>body?.workspace_id===input.workspace_id&&
      body.source_report_id===input.source_report_id&&body.target_run_id===input.target_run_id&&body.scope_basis===input.scope_basis,
      async()=>{
        const direct=page.getByText('Open a later run by its complete identifier',{exact:true});
        if(await direct.locator('..').getAttribute('open')===null)await direct.click();
        await page.getByLabel('Complete later run identifier',{exact:true}).fill(input.target_run_id);
        await click(page.getByRole('button',{name:'Open later run',exact:true}));
        await page.getByLabel('Engineering basis',{exact:true}).fill(input.scope_basis);
        await click(page.getByRole('button',{name:'Create decision review',exact:true}));
      });
    need(review.pair_id===input.pair_id&&review.source_report_id===input.source_report_id&&
      review.target_run_id===input.target_run_id&&ID64.test(review.review_id),
      'The saved decision review differs from the selected original comparison.');
    await goto('review_id',review.review_id);
    const visibleReview=await jsonDetails('Complete immutable review record');
    need(canonical(visibleReview)===canonical(review),'The visible complete review differs from its original native result.');
    const reviewFile=await download(page.getByRole('button',{name:'Download complete review',exact:true}),'review.json');
    need(canonical(JSON.parse(await readFile(reviewFile,'utf8')))===canonical(review),'The complete browser review download changed.');
    const candidateFile=await download(page.getByRole('button',{name:'Download all candidates',exact:true}),'all-candidates.json');
    const candidateBundle=JSON.parse(await readFile(candidateFile,'utf8'));
    need(canonical(candidateBundle.review)===canonical(review)&&Array.isArray(candidateBundle.candidates),
      'The original complete candidate download did not retain its review.');
    const candidates=candidateBundle.candidates;
    need(candidates.length===review.summary.total&&new Set(candidates.map(row=>row.candidate_id)).size===candidates.length,
      'The original candidate download is incomplete or duplicates a sequence.');
    const eligible=candidates.filter(row=>row.state==='ELIGIBLE').sort((a,b)=>a.candidate_id-b.candidate_id);
    need(eligible.length===review.summary.eligible&&eligible.length>0,
      'This original engineering comparison did not contain the expected available decisions.');
    const actualStates={};
    for(const candidate of candidates)actualStates[candidate.state]=(actualStates[candidate.state]||0)+1;
    for(const [state,count] of Object.entries(review.summary.states||{}))
      need((actualStates[state]||0)===count,'The visible/native candidate counts differ for '+state);
    journal.review_id=review.review_id;journal.actual_candidate_states=actualStates;
    journal.selected_candidate_ids=eligible.map(row=>row.candidate_id);
    await stage('Reviewed the full immutable source meanings and every original candidate.',
      {review_id:review.review_id,total:candidates.length,eligible:eligible.length,states:actualStates});
    await screenshot('decision-review-desktop.png',panel('Saved decision review'));

    const representatives=new Map();
    for(const candidate of candidates){
      const key=candidate.kind+':'+candidate.state;
      if(!representatives.has(key))representatives.set(key,candidate);
    }
    for(const candidate of representatives.values()){
      const row=await candidateRow(candidate);
      await click(row.getByRole('button',{name:'Inspect',exact:true}));
      const visible=await jsonDetails('Complete candidate record',page.locator('#candidate-inspection'));
      need(canonical(visible)===canonical(candidate),'The visible candidate differs from its immutable original record.');
      await inspectOriginal(candidate,'source');await inspectOriginal(candidate,'target');
    }
    await artifact('original-subjects.json',journal.originals);
    if(representatives.size)await screenshot('original-decision-inspection.png',page.locator('#candidate-inspection'));

    const application=await mutation('carry-apply',body=>body?.workspace_id===input.workspace_id&&body.review_id===review.review_id&&
      body.review_sha256===review.review_sha256&&canonical(body.candidate_ids)===canonical(journal.selected_candidate_ids)&&
      body.actor===input.actor&&body.reason===input.reason,
      async()=>{
        await page.getByLabel('Finding',{exact:true}).selectOption('');await idle();
        await page.getByLabel('Decision subject',{exact:true}).selectOption('');await idle();
        await click(page.getByRole('button',{name:'Select all available decisions',exact:true}));
        need((await page.locator('#selection-panel .count').textContent()).trim()===eligible.length.toLocaleString()+' decisions selected',
          'The visible explicit selection is incomplete.');
        await click(page.getByRole('button',{name:'Inspect complete selection',exact:true}));
        const chosen=page.locator('#selection-review details');
        need(await chosen.count()===eligible.length,'The complete selected candidate review is incomplete.');
        for(let i=0;i<eligible.length;i++){
          const record=JSON.parse(await chosen.nth(i).locator('pre').textContent());
          need(canonical(record)===canonical(eligible[i]),'A selected original candidate differs from the reviewed record.');
        }
        await page.getByLabel('Engineer',{exact:true}).fill(input.actor);
        await page.getByLabel('Reason for this selection',{exact:true}).fill(input.reason);
        await click(page.getByRole('button',{name:'Apply selected decisions',exact:true}));
      });
    need(application.review_id===review.review_id&&application.source_report_id===input.source_report_id&&
      application.target_run_id===input.target_run_id&&application.prior_review_revision===review.target_review_revision&&
      canonical(application.selected_candidate_ids)===canonical(journal.selected_candidate_ids)&&
      application.applied.length===eligible.length,'The original application differs from the explicit complete selection.');
    await goto('application_id',application.application_id);
    need(canonical(await jsonDetails('Complete immutable application'))===canonical(application),
      'The original application did not reopen in the visible interface.');
    await download(page.getByRole('button',{name:'Download complete application',exact:true}),'application.json');
    const postsBeforeReload=journal.post_observations.length;
    await page.reload({waitUntil:'domcontentloaded',timeout:60000});await idle();
    need(canonical(await jsonDetails('Complete immutable application'))===canonical(application),
      'The original application changed after browser reload.');
    await goto('request_id',journal.requests['carry-apply'].request_id);
    await click(page.locator('[data-request-id="'+journal.requests['carry-apply'].request_id+'"]')
      .getByRole('button',{name:'Inspect original request',exact:true}));
    const nativeApply=await jsonDetails('Complete native request record',
      page.locator('[data-request-id="'+journal.requests['carry-apply'].request_id+'"]'));
    need(nativeApply.state==='COMPLETE'&&nativeApply.result?.application_id===application.application_id,
      'The reopened original request did not retain the same completed application.');
    await click(page.locator('[data-request-id="'+journal.requests['carry-apply'].request_id+'"]')
      .getByRole('button',{name:'Open saved result',exact:true}));
    need(journal.post_observations.length===postsBeforeReload,'Reopening the completed application unexpectedly posted another write.');
    journal.application_id=application.application_id;
    await page.setViewportSize({width:390,height:844});
    await screenshot('applied-selection-phone.png',panel('Applied selection'));
    await page.setViewportSize({width:1280,height:900});
    await stage('Applied the explicit available decisions and reopened the same original application and request.',
      {application_id:application.application_id,request_id:journal.requests['carry-apply'].request_id});

    const report=await mutation('report',body=>body?.workspace_id===input.workspace_id&&body.run_id===input.target_run_id&&
      body.expected_revision===application.review_revision&&body.before_run_id===review.source_run_id,
      async()=>{
        await click(page.locator('[data-screen="history"]'));
        await click(page.getByRole('button',{name:'Refresh current run',exact:true}));
        await click(page.getByRole('button',{name:'Freeze current target report',exact:true}));
      });
    need(report.run_id===input.target_run_id&&report.review_revision===application.review_revision&&
      Array.isArray(report.decision_carry_forward?.applied_here)&&
      report.decision_carry_forward.applied_here.includes(application.application_id),
      'The frozen target report did not retain the actual applied decision lineage.');
    need(canonical(await jsonDetails('Complete immutable report and saved queries'))===canonical(report),
      'The complete frozen report differs in the visible handover.');
    await download(page.getByRole('button',{name:'Download original report',exact:true}),'frozen-report.json');
    const exported=await mutation('exports',body=>body?.report_id===report.report_id,
      async()=>await click(page.getByRole('button',{name:'Prepare complete handover',exact:true})));
    need(ID64.test(exported.export_id),'The native handover did not return its original export identity.');
    const visibleExport=await jsonDetails('Complete original export manifest');
    need(canonical(visibleExport)===canonical(exported),'The visible complete export manifest differs from the native result.');
    const files=Array.isArray(exported.files)?exported.files:Object.entries(exported.files||{}).map(([name,file])=>({...file,name}));
    need(files.length>0&&new Set(files.map(file=>file.name)).size===files.length,'The native handover has no complete distinct file list.');
    for(const file of files)need(safeRelative(file.name)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&ID64.test(file.sha256),
      'The native handover contains an incomplete original file descriptor.');
    await artifact('original-export-record.json',exported);
    const exportPanel=panel('Complete portable handover');
    let downloaded=0;
    for(const file of files){
      let found=null;
      for(;;){
        const rows=exportPanel.locator('tbody tr');
        for(let i=0;i<await rows.count();i++){
          if((await rows.nth(i).locator('td').nth(0).textContent())===file.name){found=rows.nth(i);break;}
        }
        if(found)break;
        const next=exportPanel.getByRole('button',{name:'Next',exact:true});
        need(await next.isEnabled(),'The original handover table omitted '+file.name);
        await click(next);
      }
      await download(found.getByRole('button',{name:'Download',exact:true}),'handover/'+file.name,file);
      downloaded++;
      process.stdout.write('Received complete original file '+downloaded+'/'+files.length+': '+file.name+'\n');
    }
    const manifest=files.find(file=>file.name==='manifest.json');
    need(manifest,'The native receiving package did not include its original manifest.json.');
    await screenshot('complete-handover-desktop.png',exportPanel);
    need(journal.browser_errors.length===priorErrorCount,'The visible workflow encountered an uncaught browser error.');
    await stage('Downloaded every complete original handover file through the shipped interface.',
      {report_id:report.report_id,export_id:exported.export_id,files:files.length,manifest_sha256:manifest.sha256});
    result={schema:'stellar-forge.decision-carry.browser-result.v1',status:'COMPLETE',operation_id:input.operation_id,
      source_commit:input.source_commit,workspace_id:input.workspace_id,pair_id:input.pair_id,
      source_report_id:input.source_report_id,target_run_id:input.target_run_id,
      review_id:review.review_id,application_id:application.application_id,report_id:report.report_id,export_id:exported.export_id,
      request_ids:Object.fromEntries(Object.entries(journal.requests).map(([kind,record])=>[kind,record.request_id])),
      candidate_count:candidates.length,candidate_states:actualStates,selected_candidate_ids:journal.selected_candidate_ids,
      applied_count:application.applied.length,download_directory:join(output,'handover'),manifest_sha256:manifest.sha256,
      files:files.map(file=>({...file,path:join(output,'handover',file.name)})),
      served_interface_sha256:journal.served_interface_sha256,journal:recordPath,
      download_mode:journal.download_mode,completed_at:new Date().toISOString()};
    journal.result=result;
  }catch(error){
    failure=new Error(sanitize(error));journal.error=failure.message;journal.status='FAILED';
  }finally{
    if(context){
      try{await context.close();journal.browser_closed=true;}
      catch(error){journal.close_error=sanitize(error);journal.browser_closed=false;failure??=new Error(journal.close_error);}
    }
    await writes;
    if(!failure&&writeError)failure=writeError;
    if(!failure&&result){journal.status='COMPLETE';journal.completed_at=result.completed_at;}
    else journal.status='FAILED';
    try{await persist();}
    catch(error){failure??=new Error('The original browser closed but its receiving journal could not be saved: '+sanitize(error));}
  }
  if(failure)throw failure;
  return result;
}
