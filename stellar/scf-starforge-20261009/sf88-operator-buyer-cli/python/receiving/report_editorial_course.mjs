/**
 * Complete report-editorial course on one caller-owned Playwright Page.
 * No browser launch, native owner, HTTP server, archive receiver, or external send.
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';

const SCHEMA='stellar-forge.report-editorial-course.v1';
const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const digest=x=>createHash('sha256').update(x).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
const check=(ok,message)=>{if(!ok)throw Error(message);};
const exists=async p=>{try{await fs.access(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const encoded=x=>Buffer.from(canonical(x)+'\n');
const same=(a,b)=>canonical(a)===canonical(b);
const stamp=()=>new Date().toISOString();
function completion(state){
  const screens=state.screens||[];
  state.visualReviewComplete=screens.length>0&&screens.every(s=>s.inspection?.viewed===true);
  state.complete=state.operatedComplete===true&&state.receiving?.operatedComplete===true&&state.visualReviewComplete;
  return state;
}
const editorial=d=>({title:d.title,introduction:d.introduction||'',sections:d.sections.map(s=>({title:s.title,note:s.note||''}))});
const nativeSections=d=>d.sections.map(s=>({query_name:s.query_name,query_revision:s.query_revision,parameters_text:s.parameters_text}));
const safeName=s=>{check(/^[a-zA-Z0-9_.-]+$/.test(s),'Invalid course artifact name.');return s;};

async function atomic(filename,body,{immutable=false}={}){
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(body);
  await fs.mkdir(path.dirname(filename),{recursive:true});
  if(immutable&&await exists(filename)){
    check((await fs.readFile(filename)).equals(bytes),'Retained file differs: '+path.basename(filename));
    return;
  }
  const temporary=filename+'.pending-'+randomUUID(),handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  if(immutable){
    try{await fs.link(temporary,filename);}
    catch(e){if(e.code!=='EEXIST')throw e;check((await fs.readFile(filename)).equals(bytes),'Concurrent retained file differs.');}
    finally{await fs.unlink(temporary).catch(()=>{});}
  }else await fs.rename(temporary,filename);
}
async function readJson(filename){return JSON.parse(await fs.readFile(filename,'utf8'));}
function verifyEditorial(value,definition){
  check(value&&typeof value.title==='string'&&value.title.trim()&&Buffer.byteLength(value.title)<=300,'Select a complete report title.');
  check(typeof value.introduction==='string'&&Buffer.byteLength(value.introduction)<=16000,'Select a complete introduction.');
  check(Array.isArray(value.sections)&&value.sections.length===definition.sections.length,'Select every original editorial section.');
  for(const section of value.sections){
    check(typeof section.title==='string'&&section.title.trim()&&Buffer.byteLength(section.title)<=300,'Select a complete section title.');
    check(typeof section.note==='string'&&Buffer.byteLength(section.note)<=8000,'Select a complete section note.');
  }
}
async function api(page,route,body){
  return page.evaluate(async({route,body})=>{
    const capability=sessionStorage.getItem('sf-analysis-capability');
    if(!capability)throw Error('The caller-owned original Analysis session is not open.');
    const response=await fetch(route,{method:body===undefined?'GET':'POST',cache:'no-store',
      headers:{'X-Analysis-Capability':capability,...(body===undefined?{}:{'Content-Type':'application/json'})},
      body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();let value;
    try{value=JSON.parse(text);}catch{throw Error('Original Analysis returned an unreadable response.');}
    return {ok:response.ok,status:response.status,value};
  },{route,body});
}
async function required(page,route,body){
  const result=await api(page,route,body);
  check(result.ok,'Original Analysis rejected '+route+': '+JSON.stringify(result.value));
  return result.value;
}
async function idle(page){
  await page.waitForFunction(()=>!document.body.inert,{},{timeout:30000});
}
async function authorReady(page){
  await page.locator('#workspace').filter({hasText:'Original workspace '}).waitFor({timeout:30000});
  await idle(page);
  check(!(await page.locator('#message').getAttribute('class')).split(' ').includes('error'),'Original author screen failed: '+await page.locator('#message').innerText());
}
async function recipientReady(page){
  await page.getByLabel('Your name',{exact:true}).waitFor({timeout:30000});
  check(!(await page.locator('#message').getAttribute('class')).split(' ').includes('error'),'Recipient screen failed: '+await page.locator('#message').innerText());
}
async function validatePackage(value){
  check(value?.issue?.schema==='stellar-forge.report-editorial-issue.v1','Incomplete original issue package.');
  check(digest(canonical(value.issue))===value.issue_sha256,'Original issue hash differs.');
  check(typeof value.source_json==='string'&&digest(value.source_json)===value.issue.source_sha256,'Original report hash differs.');
  const source=JSON.parse(value.source_json);
  check(same(source.report.definition,value.issue.definition),'Issued definition differs from the complete original report.');
  check(source.tables.length===value.issue.definition.sections.length,'A complete typed table is missing.');
  for(let i=0;i<source.tables.length;i++){
    const table=source.tables[i];
    check(table.ordinal===i&&Array.isArray(table.columns)&&Array.isArray(table.rows),'Original typed table structure differs.');
  }
  return source;
}
async function validateWorking(value,pkg){
  check(value.schema==='stellar-forge.report-editorial-working.v1'&&same(value.package,pkg),'Editable file lost its complete original package.');
  check(Array.isArray(value.editions)&&value.working&&Object.hasOwn(value,'pendingReturn'),'Editable review history is incomplete.');
}
async function validateReturn(value,pkg){
  check(value.schema==='stellar-forge.report-editorial-return.v1'&&value.issue_id===pkg.issue.id&&value.workspace_id===pkg.issue.workspace_id&&value.issue_sha256===pkg.issue_sha256&&value.source_sha256===pkg.issue.source_sha256,'Returned review source differs.');
  verifyEditorial(value.proposed,pkg.issue.definition);
  let previous=null;
  check(value.editions.length>0,'Returned edition history is empty.');
  for(const edition of value.editions){
    const body={...edition};delete body.sha256;
    check(edition.previous_sha256===previous&&digest(canonical(body))===edition.sha256,'Returned edition chain differs.');
    previous=edition.sha256;
  }
  const last=value.editions.at(-1);
  check(value.id===last.id&&same(value.proposed,last.proposed)&&value.reviewer===last.reviewer&&value.notes===last.notes,'Returned wording differs from its final edition.');
}
async function createCourse({page,outputDir,intent,inspectScreen}){
  check(page&&typeof page.goto==='function','Provide the existing caller-owned Page.');
  check(path.isAbsolute(outputDir),'Provide an absolute case-owned output directory.');
  check(intent&&/^[a-zA-Z0-9_.-]{8,128}$/.test(intent.operation_id),'Provide the original stable course operation ID.');
  check(/^[a-f0-9]{32}$/.test(intent.workspace_id)&&/^[a-f0-9]{32}$/.test(intent.job_id)&&/^[a-f0-9]{64}$/.test(intent.result_sha256),'Select the exact original workspace and completed report.');
  const url=new URL(page.url());
  check(['http:','https:'].includes(url.protocol)&&['127.0.0.1','[::1]','::1'].includes(url.hostname),'Use the original numeric-loopback Analysis Page.');
  const authorUrl=url.origin+'/report-reviews';
  await fs.mkdir(outputDir,{recursive:true});
  await atomic(path.join(outputDir,'intent.json'),encoded({schema:SCHEMA,intent}),{immutable:true});
  const checkpointPath=path.join(outputDir,'course.json');
  const state=await exists(checkpointPath)?await readJson(checkpointPath):{schema:SCHEMA,operation_id:intent.operation_id,workspace_id:intent.workspace_id,steps:{},artifacts:{},screens:[],started_at:stamp(),complete:false};
  check(state.schema===SCHEMA&&state.operation_id===intent.operation_id&&state.workspace_id===intent.workspace_id,'Course checkpoint belongs to another operation.');
  for(const [name,item]of Object.entries(state.artifacts)){
    const bytes=await fs.readFile(path.join(outputDir,safeName(name)));
    check(bytes.length===item.bytes&&digest(bytes)===item.sha256,'Retained original artifact differs: '+name);
  }
  const save=async()=>atomic(checkpointPath,encoded(state));
  const retain=async(name,body)=>{
    safeName(name);const bytes=Buffer.isBuffer(body)?body:Buffer.from(body);
    await atomic(path.join(outputDir,name),bytes,{immutable:true});
    state.artifacts[name]={bytes:bytes.length,sha256:digest(bytes)};await save();return path.join(outputDir,name);
  };
  const json=async(name,value)=>retain(name,encoded(value));
  const observe=async(name,value)=>{
    const raw=encoded(value),filename=safeName(name)+'-'+digest(raw)+'.json';
    await retain(filename,raw);return filename;
  };
  const download=async(name,click,validate,{beforePublish}={})=>{
    const filename=path.join(outputDir,safeName(name));
    if(await exists(filename)){
      const bytes=await fs.readFile(filename);await validate(bytes);
      await retain(name,bytes);return filename;
    }
    const waiting=page.waitForEvent('download',{timeout:30000});
    await click();const item=await waiting;
    const temporary=filename+'.download-'+randomUUID();
    await item.saveAs(temporary);
    check(await item.failure()===null,'The original browser download did not finish.');
    const bytes=await fs.readFile(temporary);await validate(bytes);
    if(beforePublish)await beforePublish(bytes);
    await retain(name,bytes);await fs.unlink(temporary);return filename;
  };
  const screen=async(name,width)=>{
    await page.setViewportSize({width,height:1000});await idle(page);
    const filename=safeName(name+'-'+width+'.png'),target=path.join(outputDir,filename);
    if(!await exists(target)){
      const temporary=target+'.pending-'+randomUUID();
      await page.screenshot({path:temporary,type:'png',fullPage:true,timeout:15000});
      await retain(filename,await fs.readFile(temporary));await fs.unlink(temporary);
    }else await retain(filename,await fs.readFile(target));
    let inspection=null;
    if(inspectScreen)inspection=await inspectScreen({path:target,name,width,page,operation_id:intent.operation_id});
    const item={name,width,file:filename,inspection:inspection??{viewed:false,pending:'Producing worker must personally inspect this exact screenshot.'}};
    state.screens=state.screens.filter(prior=>prior.file!==filename);state.screens.push(item);completion(state);await save();return item;
  };
  const openAuthor=async()=>{await page.goto(authorUrl,{waitUntil:'domcontentloaded',timeout:30000});await authorReady(page);const actual=await required(page,'/api/state');check(actual.workspace_id===intent.workspace_id,'The active native workspace changed.');};
  const openIssue=async id=>{
    let seen=new Set();
    for(;;){
      const rows=page.locator('#history > .panel');
      for(let i=0;i<await rows.count();i++){
        const button=rows.nth(i).getByRole('button',{name:'Open issue and returns',exact:true});
        await button.click();await idle(page);
        const shown=await page.locator('#selected').innerText();
        if(shown.includes(id))return;
      }
      const text=await page.locator('#history').innerText();check(!seen.has(text),'Issue history repeated without the selected issue.');seen.add(text);
      const older=page.locator('#history-older');check(await older.isEnabled(),'Original issue is absent from its complete history.');
      await older.click();await idle(page);
    }
  };
  const nativeSave=async(label,values)=>{
    const intentPath=path.join(outputDir,label+'-native-intent.json');
    let savedIntent;
    if(await exists(intentPath))savedIntent=await readJson(intentPath);
    else{
      const current=await required(page,'/api/reports/'+encodeURIComponent(state.report_name));
      verifyEditorial(values,current.definition);
      const request={id:randomUUID().replaceAll('-',''),expected_revision:current.definition.revision,
        title:values.title,introduction:values.introduction,sections:current.definition.sections.map((s,i)=>({
          ...nativeSections(current.definition)[i],title:values.sections[i].title,note:values.sections[i].note}))};
      savedIntent={schema:'stellar-forge.report-editorial-native-save.v1',operation_id:intent.operation_id,
        workspace_id:intent.workspace_id,label,report_name:state.report_name,before:current,request};
      await json(label+'-native-intent.json',savedIntent);
    }
    check(savedIntent.schema==='stellar-forge.report-editorial-native-save.v1'&&savedIntent.operation_id===intent.operation_id
      &&savedIntent.workspace_id===intent.workspace_id&&savedIntent.label===label&&savedIntent.report_name===state.report_name,'Native save intent belongs to another source.');
    const request=savedIntent.request;
    check(request.expected_revision===savedIntent.before.definition.revision&&/^[a-f0-9]{32}$/.test(request.id),'Native save revision identity differs.');
    check(request.title===values.title&&request.introduction===values.introduction
      &&same(request.sections.map(s=>({title:s.title,note:s.note})),values.sections)
      &&same(request.sections.map(({title,note,...q})=>q),nativeSections(savedIntent.before.definition)),'Native save source or selected wording differs.');
    await json(label+'-before.json',savedIntent.before);await json(label+'-request.json',request);
    const result=await required(page,'/api/reports/'+encodeURIComponent(state.report_name),request);
    await json(label+'-result.json',result);
    const received=await required(page,'/api/reports/'+encodeURIComponent(state.report_name)+'?revision='+result.revision);
    check(same(nativeSections(received.definition),request.sections.map(({title,note,...s})=>s)),'Native author save changed query/data selection.');
    const selectedPath=path.join(outputDir,label+'-definition.json');
    if(await exists(selectedPath)){
      const selected=await readJson(selectedPath);
      check(same(selected.definition,received.definition)&&selected.sha256===received.sha256,'Replayed author definition changed.');
      await observe(label+'-readback',received);return selected;
    }
    await json(label+'-definition.json',received);return received;
  };
  const recoverWork=async filename=>{
    await page.locator('#open-work').setInputFiles(path.join(outputDir,filename));await idle(page);
    check((await page.locator('#message').innerText()).includes('Author work reopened'),'The complete pending author work did not reopen.');
  };
  const recoverDispatch=async label=>{
    const filename=path.join(outputDir,label+'-dispatch.json');
    if(!await exists(filename))return null;
    const dispatch=await readJson(filename);
    check(dispatch.schema==='stellar-forge.report-editorial-dispatch.v1'&&dispatch.operation_id===intent.operation_id&&dispatch.workspace_id===intent.workspace_id&&dispatch.label===label,'Dispatch intent belongs to another course.');
    check(same(JSON.parse(dispatch.raw_request),dispatch.request)&&/^[a-f0-9]{32}$/.test(dispatch.request.id),'Original dispatched request differs.');
    check(dispatch.working.workspace_id===intent.workspace_id,'Pending working file belongs to another workspace.');
    if(label==='issue'){
      check(dispatch.route==='/api/report-reviews'&&same(dispatch.working.pendingIssue,dispatch.request),'Original issue request and working file differ.');
    }else{
      const pending=dispatch.working.pendingApply;
      check(pending&&dispatch.route==='/api/report-review-returns/'+pending.return_id+'/apply'&&same(pending.request,dispatch.request),'Original application and working file differ.');
    }
    await retain(label+'-request-body.json',Buffer.from(dispatch.raw_request));
    await json(label+'-request.json',dispatch.request);await json(label+'-working.json',dispatch.working);
    return dispatch;
  };
  const captureUi=async(label,routePath,click,{loseReply=false,beforeDispatch}={})=>{
    const routeUrl=authorUrl.slice(0,-'/report-reviews'.length)+routePath;
    let intercepted=false,handlerError=null;const activeRoutes=new Set();
    const handleRoute=async route=>{
      if(route.request().method()!=='POST'){await route.continue();return;}
      try{
        check(!intercepted,'The original UI dispatched this phase more than once.');intercepted=true;
        const request=route.request().postDataJSON();
        const originalWork=await page.evaluate(()=>JSON.parse(JSON.stringify(work)));
        await json(label+'-dispatch.json',{schema:'stellar-forge.report-editorial-dispatch.v1',operation_id:intent.operation_id,
          workspace_id:intent.workspace_id,label,route:routePath,raw_request:route.request().postData(),request,working:originalWork});
        await recoverDispatch(label);
        if(beforeDispatch)await beforeDispatch();
        const response=await route.fetch({timeout:30000});
        const raw=await response.body();let body;
        try{body=JSON.parse(raw.toString('utf8'));}catch{throw Error('Native application response is not JSON.');}
        await retain(label+'-response-body.json',raw);
        await json(label+'-response.json',{status:response.status(),ok:response.ok(),body});
        if(loseReply)await route.abort('failed');else await route.fulfill({response,body:raw});
      }catch(error){handlerError=error;await route.abort('failed').catch(()=>{});}
    };
    const handler=route=>{const pending=handleRoute(route);activeRoutes.add(pending);pending.finally(()=>activeRoutes.delete(pending));return pending;};
    await page.route(routeUrl,handler);
    try{await click();await idle(page);if(handlerError)throw handlerError;check(intercepted,'The selected native UI action was not dispatched.');}
    finally{await page.unroute(routeUrl,handler);await Promise.allSettled([...activeRoutes]);}
    return readJson(path.join(outputDir,label+'-response.json'));
  };
  for(const label of ['issue','stale-apply','accepted-apply'])await recoverDispatch(label);
  const onDialog=async dialog=>{if(dialog.type()==='beforeunload'||dialog.type()==='confirm')await dialog.accept();else await dialog.dismiss();};
  const sourceBytes=await fs.readFile(fileURLToPath(import.meta.url)),sourceSha=digest(sourceBytes);
  const sourceName='report_editorial_course-'+sourceSha+'.mjs';
  await retain(sourceName,sourceBytes);
  state.sourceHistory=state.sourceHistory||[];
  if(!state.sourceHistory.some(item=>item.sha256===sourceSha))state.sourceHistory.push({file:sourceName,bytes:sourceBytes.length,sha256:sourceSha});
  state.selectedSource={file:sourceName,bytes:sourceBytes.length,sha256:sourceSha};await save();
  page.on('dialog',onDialog);
  return {page,outputDir,intent,state,save,retain,json,observe,download,screen,openAuthor,openIssue,nativeSave,recoverWork,captureUi,
    close:()=>page.off('dialog',onDialog)};
}

async function selectRun(c){
  const {page,intent}=c;let seen=new Set();
  for(;;){
    if(await page.locator('#report-run option[value="'+intent.job_id+'"]').count()){
      await page.locator('#report-run').selectOption(intent.job_id);
      const sha=await page.locator('#report-run option:checked').getAttribute('data-sha');
      check(sha===intent.result_sha256,'The selected completed report hash changed.');return;
    }
    const options=await page.locator('#report-run').innerText();check(!seen.has(options),'Report history repeated.');seen.add(options);
    check(await page.locator('#runs-older').isEnabled(),'Selected original completed report is absent.');
    await page.locator('#runs-older').click();await idle(page);
  }
}
async function fillRecipient(page,intent,{unfinished=false}={}){
  await page.getByLabel('Your name',{exact:true}).fill(intent.reviewer);
  await page.getByLabel('Proposed report title',{exact:true}).fill(unfinished?'':intent.proposed.title);
  await page.getByLabel('Proposed introduction',{exact:true}).fill(intent.proposed.introduction);
  const titles=page.getByLabel('Proposed section title',{exact:true}),notes=page.getByLabel('Proposed section note',{exact:true});
  check(await titles.count()===intent.proposed.sections.length,'The complete issued section structure changed.');
  for(let i=0;i<intent.proposed.sections.length;i++){
    await titles.nth(i).fill(intent.proposed.sections[i].title);
    await notes.nth(i).fill(intent.proposed.sections[i].note);
  }
  await page.getByLabel('Message to the author',{exact:true}).fill(intent.reviewer_notes);
}
async function selectReturn(c,id){
  const {page}=c;let seen=new Set();
  for(;;){
    const rows=page.locator('#selected .toolbar').filter({has:page.getByRole('button',{name:'Download retained return',exact:true})});
    for(let i=0;i<await rows.count();i++){
      await rows.nth(i).getByRole('button',{name:'Compare with current report',exact:true}).click();await idle(page);
      const actual=await page.evaluate(()=>work.selectedReturn);
      if(actual===id)return;
    }
    const older=page.getByRole('button',{name:'Older returned reviews',exact:true});
    check(await older.count(),'The selected retained return is absent.');
    const text=await page.locator('#selected').innerText();check(!seen.has(text),'Return history repeated.');seen.add(text);
    await older.click();await idle(page);
  }
}
async function fillDecisions(c){
  const {page,intent}=c;
  const actual=await page.evaluate(()=>JSON.parse(JSON.stringify(preview)));
  await c.observe('comparison',actual);
  const rows=page.locator('#reconcile section.field');
  check(await rows.count()===actual.fields.length,'Reconciliation field count changed.');
  for(let i=0;i<actual.fields.length;i++){
    const field=actual.fields[i];
    const decision=intent.decisions[field.key]||(!field.reviewer_changed||field.status==='same'?{choice:'current'}:null);
    check(decision&&['current','returned','custom'].includes(decision.choice),'Select an explicit actual decision for '+field.key);
    check(field.target!==null||decision.choice==='current','A missing native section requires keeping its current structure.');
    await rows.nth(i).getByLabel('Editorial decision',{exact:true}).selectOption(decision.choice);
    if(decision.choice==='custom')await rows.nth(i).getByLabel('Resolved '+field.key,{exact:true}).fill(decision.text);
  }
  await page.getByLabel('Author decision note',{exact:true}).fill(intent.author_note);
  return actual;
}

/** All phases reuse the same exact issue, return and original save requests. */
export async function runEditorialReviewCourse(options){
  const c=await createCourse(options);const {page,intent,state}=c;
  try{
    await c.openAuthor();
    if(state.operatedComplete){completion(state);await c.save();return clone(state);}
    if(!state.steps.issue){
      const old=path.join(c.outputDir,'issue-request.json');
      if(await exists(old)){
        const request=await readJson(old);const result=await required(page,'/api/report-reviews',request);
        state.issue_id=result.issue.id;
      }else{
        await selectRun(c);await page.locator('#recipient').fill(intent.recipient);await page.locator('#instructions').fill(intent.instructions);
        const response=await c.captureUi('issue','/api/report-reviews',()=>page.locator('#issue').click());
        check(response.ok,'Original issue failed: '+JSON.stringify(response.body));state.issue_id=response.body.issue.id;
      }
      state.steps.issue=true;await c.save();
    }
    await c.openIssue(state.issue_id);
    const packagePath=await c.download('original-package.json',()=>page.getByRole('button',{name:'Download original report package',exact:true}).click(),async bytes=>validatePackage(JSON.parse(bytes)));
    const pkg=await readJson(packagePath),source=await validatePackage(pkg);
    check(pkg.issue.job_id===intent.job_id&&pkg.issue.result_sha256===intent.result_sha256&&pkg.issue.workspace_id===intent.workspace_id,'Issued source is not the selected original.');
    verifyEditorial(intent.proposed,pkg.issue.definition);verifyEditorial(intent.author_before,pkg.issue.definition);verifyEditorial(intent.author_after,pkg.issue.definition);
    check(intent.proposed.title!==pkg.issue.definition.title&&intent.author_before.title!==pkg.issue.definition.title&&intent.author_before.title!==intent.proposed.title,'Choose distinct reviewer and author title changes for the actual overlap.');
    state.report_name=pkg.issue.report_name;state.source_sha256=pkg.issue.source_sha256;await c.save();
    const htmlPath=await c.download('original-recipient.html',()=>page.getByRole('button',{name:'Download complete recipient HTML',exact:true}).click(),async bytes=>{
      check(bytes.toString('utf8').includes('id="review-state"'),'Complete recipient HTML is missing its original state.');
    });
    if(!state.steps.recipient){
      await page.goto(pathToFileURL(htmlPath).href,{waitUntil:'domcontentloaded',timeout:30000});await recipientReady(page);
      await c.screen('recipient-original',1440);await c.screen('recipient-original',390);
      const tables=page.locator('#editor > section.panel');
      check(await tables.count()===source.tables.length,'An original table is missing from the recipient.');
      for(let i=0;i<source.tables.length;i++){
        const section=tables.nth(i),table=source.tables[i];
        const query=section.locator('details');await query.locator('summary').click();
        check(JSON.parse(await query.locator('pre').innerText()).query_sha256===pkg.issue.definition.sections[i].query_sha256,'Rendered original query identity differs.');
        if(table.rows.length>50){
          await section.getByRole('button',{name:'Next rows',exact:true}).click();await idle(page);
          check(await section.locator('tbody tr').count()===Math.min(50,table.rows.length-50),'Next original table page has incorrect rows.');
          await c.screen('recipient-table-'+i+'-next',1440);
          await section.getByRole('button',{name:'Previous rows',exact:true}).click();await idle(page);
        }
      }
      await fillRecipient(page,intent,{unfinished:true});
      const workingPath=await c.download('unfinished-working.json',()=>page.locator('#save-json').click(),async bytes=>{
        const value=JSON.parse(bytes);await validateWorking(value,pkg);check(value.working.proposed.title==='','Unfinished title was not retained.');
      });
      const unfinishedHtml=await c.download('unfinished-recipient.html',()=>page.locator('#save-html').click(),async bytes=>check(bytes.toString('utf8').includes('review-state'),'Saved editable HTML is incomplete.'));
      await page.goto(pathToFileURL(unfinishedHtml).href,{waitUntil:'domcontentloaded',timeout:30000});await recipientReady(page);
      check(await page.getByLabel('Proposed report title',{exact:true}).inputValue()==='','The saved HTML lost unfinished wording.');
      await page.locator('#open-working').setInputFiles(workingPath);await idle(page);
      const returnedWorkingPath=path.join(c.outputDir,'returned-working.json');
      if(await exists(returnedWorkingPath)){
        await page.locator('#open-working').setInputFiles(returnedWorkingPath);await idle(page);
      }else{
        await fillRecipient(page,intent);
        await page.locator('#save-edition').click();await idle(page);
      }
      await c.screen('recipient-edited',1440);await c.screen('recipient-edited',390);
      const returnedPath=await c.download('attributed-return.json',()=>page.locator('#return-review').click(),async bytes=>validateReturn(JSON.parse(bytes),pkg),{
        beforePublish:async bytes=>{
          const actualReturn=JSON.parse(bytes);await idle(page);
          await c.download('returned-working.json',()=>page.locator('#save-json').click(),async workingBytes=>{
            const actualWorking=JSON.parse(workingBytes);await validateWorking(actualWorking,pkg);
            check(same(actualWorking.pendingReturn,actualReturn),'Complete browser working file lost its exact pending return.');
          });
        }
      });
      const returned=await readJson(returnedPath);state.return_id=returned.id;
      check(await exists(returnedWorkingPath),'The complete browser working file is missing before selected return publication.');
      check(same(returned.proposed,intent.proposed)&&returned.reviewer===intent.reviewer&&returned.notes===intent.reviewer_notes,'Returned choices changed.');
      await c.download('original-report.json',()=>page.locator('#original-json').click(),async bytes=>check(digest(bytes)===pkg.issue.source_sha256,'Original complete report bytes changed.'));
      await page.locator('#open-working').setInputFiles(returnedWorkingPath);await idle(page);
      const finalHtml=await c.download('complete-recipient.html',()=>page.locator('#save-html').click(),async bytes=>check(bytes.toString('utf8').includes(returned.id),'Final editable HTML lost its exact pending return.'));
      await page.goto(pathToFileURL(finalHtml).href,{waitUntil:'domcontentloaded',timeout:30000});await recipientReady(page);
      await c.download('reopened-return.json',()=>page.locator('#return-review').click(),async bytes=>check(same(JSON.parse(bytes),returned),'Reopening minted a different returned review.'));
      await c.screen('recipient-reopened',390);
      state.steps.recipient=true;await c.save();
    }
    await c.openAuthor();await c.openIssue(state.issue_id);
    if(!state.steps.author_before){
      await c.nativeSave('author-before',intent.author_before);state.steps.author_before=true;await c.save();
    }
    const returned=await readJson(path.join(c.outputDir,'attributed-return.json'));
    if(!state.steps.received){
      await page.getByLabel('Receive an attributed editorial return',{exact:true}).setInputFiles(path.join(c.outputDir,'attributed-return.json'));await idle(page);
      const actual=await required(page,'/api/report-review-returns/'+returned.id);
      check(same(actual.return,returned),'Native receiving changed the original returned edition.');
      await c.json('native-return.json',actual);state.steps.received=true;await c.save();
    }
    if(!state.steps.stale_review){
      if(await exists(path.join(c.outputDir,'stale-apply-request.json'))){
        await c.recoverWork('stale-apply-working.json');
        const request=await readJson(path.join(c.outputDir,'stale-apply-request.json'));
        await c.nativeSave('author-concurrent',intent.author_after);
        const status=await api(page,'/api/report-review-applies/'+request.id);
        if(!status.ok)await api(page,'/api/report-review-returns/'+state.return_id+'/apply',request);
      }else{
        await selectReturn(c,state.return_id);await fillDecisions(c);
        // Freeze the exact old pending request/preview BEFORE the concurrent
        // native save; a retry must not refresh this rejected comparison.
        await c.captureUi('stale-apply','/api/report-review-returns/'+state.return_id+'/apply',
          ()=>page.getByRole('button',{name:'Apply reviewed wording',exact:true}).click(),
          {beforeDispatch:()=>c.nativeSave('author-concurrent',intent.author_after)});
      }
      const request=await readJson(path.join(c.outputDir,'stale-apply-request.json'));
      const rejected=await required(page,'/api/report-review-applies/'+request.id);
      check(rejected.status==='NEEDS_REVIEW','Concurrent author work was not retained as an explicit rejected comparison.');
      await c.json('stale-apply-retained.json',rejected);
      // Recover the complete original pending working file; the UI must expose its real rejection.
      await c.recoverWork('stale-apply-working.json');
      await c.screen('author-rejected-current-comparison',1440);
      await page.getByRole('button',{name:'Reconcile a rejected save with current report',exact:true}).click();await idle(page);
      state.steps.stale_review=true;await c.save();
    }
    if(!state.steps.accepted){
      if(await exists(path.join(c.outputDir,'accepted-apply-request.json'))){
        await c.recoverWork('accepted-apply-working.json');
        const request=await readJson(path.join(c.outputDir,'accepted-apply-request.json'));
        let status=await api(page,'/api/report-review-applies/'+request.id);
        if(!status.ok||status.value.status!=='COMPLETE'){
          const replay=await api(page,'/api/report-review-returns/'+state.return_id+'/apply',request);
          check(replay.ok,'Original accepted application did not resume: '+JSON.stringify(replay.value));
        }
      }else{
        if(!await page.locator('#reconcile').isVisible())await selectReturn(c,state.return_id);
        await fillDecisions(c);
        await c.screen('author-reviewed-decisions',1440);await c.screen('author-reviewed-decisions',390);
        const response=await c.captureUi('accepted-apply','/api/report-review-returns/'+state.return_id+'/apply',()=>page.getByRole('button',{name:'Apply reviewed wording',exact:true}).click(),{loseReply:true});
        check(response.ok&&response.body.status==='COMPLETE','Original report save did not complete before the deliberately lost reply.');
      }
      const request=await readJson(path.join(c.outputDir,'accepted-apply-request.json'));
      const accepted=await required(page,'/api/report-review-applies/'+request.id);
      check(accepted.status==='COMPLETE','The original reviewed save is incomplete.');
      state.apply_id=request.id;state.saved_revision=accepted.definition.revision;
      await c.json('accepted-apply-native.json',accepted);
      const selected=await required(page,'/api/reports/'+encodeURIComponent(state.report_name)+'?revision='+state.saved_revision);
      check(same(nativeSections(selected.definition),nativeSections(accepted.preview.current_definition)),'Reviewed wording changed query/data identities.');
      const previousDefinitionPath=path.join(c.outputDir,'reviewed-definition.json');
      if(await exists(previousDefinitionPath)){
        const previous=await readJson(previousDefinitionPath);
        check(same(previous.definition,selected.definition)&&previous.sha256===selected.sha256,'Accepted historical definition changed.');
        await c.observe('accepted-definition-readback',selected);
      }else await c.json('reviewed-definition.json',selected);
      state.steps.accepted=true;await c.save();
    }
    if(!state.steps.later_author){
      const applied=await readJson(path.join(c.outputDir,'reviewed-definition.json'));
      const later={...editorial(applied.definition),introduction:intent.later_author_introduction};
      check(typeof later.introduction==='string'&&later.introduction!==applied.definition.introduction,'Select a distinct subsequent author introduction.');
      await c.nativeSave('author-later',later);state.steps.later_author=true;await c.save();
    }
    if(!state.steps.continued){
      await c.recoverWork('accepted-apply-working.json');
      await page.getByRole('button',{name:'Continue original application',exact:true}).click();await idle(page);
      const receipt=await required(page,'/api/report-review-applies/'+state.apply_id);
      const head=await required(page,'/api/reports/'+encodeURIComponent(state.report_name));
      const later=await readJson(path.join(c.outputDir,'author-later-definition.json'));
      check(receipt.status==='COMPLETE'&&receipt.definition.revision===state.saved_revision,'Continuation changed its original accepted revision.');
      check(same(head.definition,later.definition)&&head.sha256===later.sha256,'Same-request continuation overwrote subsequent author work.');
      await c.json('continued-original-application.json',receipt);await c.json('final-author-definition.json',head);
      await c.download('complete-author-working.json',()=>page.locator('#save-work').click(),async bytes=>{
        const value=JSON.parse(bytes);check(value.workspace_id===intent.workspace_id&&!value.pendingApply,'Completed author working file lost its actual outcome.');
      });
      await c.screen('author-continued-original-request',1440);await c.screen('author-continued-original-request',390);
      state.steps.continued=true;await c.save();
    }
    state.operatedComplete=true;state.operatedSource=clone(state.selectedSource);state.operated_at=stamp();delete state.error;completion(state);await c.save();return clone(state);
  }catch(error){
    state.complete=false;state.operatedComplete=false;state.error={name:error.name,message:error.message,at:stamp()};
    await c.save().catch(()=>{});
    try{await c.screen('interrupted-'+Date.now(),390);}catch(captureError){state.captureError={message:captureError.message};await c.save().catch(()=>{});}
    throw error;
  }finally{c.close();}
}

/** Invoke after the existing native owner has received the complete workspace. */
export async function reopenEditorialReviewCourse(options){
  const c=await createCourse(options);const {page,state,intent}=c;
  try{
    check(state.operatedComplete&&state.apply_id&&state.return_id,'Complete the same original editorial operation first.');
    await c.openAuthor();await c.openIssue(state.issue_id);
    const retained=await required(page,'/api/report-review-returns/'+state.return_id);
    check(same(retained,await readJson(path.join(c.outputDir,'native-return.json'))),'Received workspace changed its retained returned edition.');
    const apply=await required(page,'/api/report-review-applies/'+state.apply_id);
    check(same(apply,await readJson(path.join(c.outputDir,'continued-original-application.json'))),'Received workspace changed its original application.');
    const receivedPackage=await c.download('received-original-package.json',()=>page.getByRole('button',{name:'Download original report package',exact:true}).click(),async bytes=>{
      check(same(JSON.parse(bytes),await readJson(path.join(c.outputDir,'original-package.json'))),'Received native workspace lost its complete original report.');
    });
    const receivedHtml=await c.download('received-original-recipient.html',()=>page.getByRole('button',{name:'Download complete recipient HTML',exact:true}).click(),async bytes=>{
      const original=await fs.readFile(path.join(c.outputDir,'original-recipient.html'));
      check(bytes.equals(original),'Received recipient HTML differs from its exact original.');
    });
    const beforeReplay=await required(page,'/api/reports/'+encodeURIComponent(state.report_name));
    await c.observe('received-head-before-replay',beforeReplay);
    await c.recoverWork('accepted-apply-working.json');
    await page.getByRole('button',{name:'Continue original application',exact:true}).click();await idle(page);
    const head=await required(page,'/api/reports/'+encodeURIComponent(state.report_name));
    await c.observe('received-head-after-replay',head);
    check(same(head.definition,beforeReplay.definition)&&head.sha256===beforeReplay.sha256,'Reopened original request changed the received author head.');
    const continued=await required(page,'/api/report-review-applies/'+state.apply_id);
    check(same(continued,apply)&&continued.definition.revision===state.saved_revision,'Reopened continuation changed the original accepted receipt.');
    await c.screen('received-original-author-history',1440);await c.screen('received-original-author-history',390);
    await page.goto(pathToFileURL(receivedHtml).href,{waitUntil:'domcontentloaded',timeout:30000});await recipientReady(page);
    await c.screen('received-original-recipient',390);
    state.receiving={operatedComplete:true,source:clone(state.selectedSource),at:stamp(),workspace_id:intent.workspace_id,package:path.basename(receivedPackage),html:path.basename(receivedHtml)};
    completion(state);await c.save();return clone(state);
  }catch(error){
    state.receiving={operatedComplete:false,error:{name:error.name,message:error.message},at:stamp()};completion(state);await c.save().catch(()=>{});throw error;
  }finally{c.close();}
}

/** Record producing-worker observations after personally viewing these exact images. */
export async function recordEditorialScreenReview({outputDir,operation_id,observations}){
  check(path.isAbsolute(outputDir)&&Array.isArray(observations)&&observations.length>0,'Provide the retained course and actual image observations.');
  const filename=path.join(outputDir,'course.json'),state=await readJson(filename);
  check(state.schema===SCHEMA&&state.operation_id===operation_id,'Visual review belongs to another course.');
  for(const observation of observations){
    const screen=state.screens.find(s=>s.file===observation.file);
    check(screen&&observation.viewed===true&&Array.isArray(observation.findings),'Select an actual viewed course image and findings.');
    const selected=state.artifacts[screen.file],bytes=await fs.readFile(path.join(outputDir,safeName(screen.file)));
    check(selected&&bytes.length===selected.bytes&&digest(bytes)===selected.sha256&&observation.sha256===selected.sha256,'Viewed image identity differs from the selected original.');
    screen.inspection={viewed:true,findings:observation.findings,at:stamp(),sha256:selected.sha256};
  }
  completion(state);await atomic(filename,encoded(state));return clone(state);
}
