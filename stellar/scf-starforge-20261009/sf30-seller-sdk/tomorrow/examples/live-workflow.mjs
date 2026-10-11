#!/usr/bin/env node
/**
 * Supervised native Tomorrow.io operator workflow.
 *
 * Required: Node, an installed Playwright package, and a Chromium executable.
 * Run from a configured receiving host:
 *   node examples/live-workflow.mjs --workspace /absolute/weather-operation --run
 *
 * Optional flags:
 *   --browser /absolute/chromium
 *   --playwright-module /absolute/node_modules/playwright
 *   --explicit-proxy                  Use the configured HTTPS_PROXY CONNECT route.
 *   --headful                         Show Chromium on the receiving host.
 *   --single-process                  Use an existing compact cloud Chromium build.
 *   --keep-open                       Keep the same source process for inspection.
 *   --pause-after handover            Preserve live source memory before restart.
 *   --capture-layout /absolute/layout.png  Capture the configuration before acquisition.
 *
 * Without --run, use the printed phase commands on stdin. A failed phase leaves
 * this process, workspace and original edition available; it never starts a
 * replacement acquisition automatically. The two edition phases each review
 * one native Timeline request and one PNG tile request. Handover/reopen/import
 * use those saved editions and do not acquire another forecast.
 */
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {fork} from 'node:child_process';
import {createInterface} from 'node:readline';
import {WeatherWorkspace} from '../workspace.mjs';
import {startWeatherServer} from '../server.mjs';

const args=process.argv.slice(2);
const option=(name,fallback)=>{const index=args.indexOf(name);return index>=0?args[index+1]:fallback;};
const has=name=>args.includes(name);
const workspacePath=option('--workspace');
if(!workspacePath)throw new Error('Provide --workspace /absolute/weather-operation.');
const directory=resolve(workspacePath);
const plan={usage:{mode:'keyless-evaluation',retentionSeconds:0,exportRaw:false},
  ...(has('--explicit-proxy')?{transport:{mode:'explicit-connect',origin:'https://api.tomorrow.io',proxyEnv:'HTTPS_PROXY'}}:{})};
const exists=async path=>{try{await stat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};

if(has('--child')){
  const mode=option('--child');
  const workspace=mode==='create'
    ?await WeatherWorkspace.create(directory,{title:'Receiving weather operations',plan})
    :await WeatherWorkspace.open(directory);
  const running=await startWeatherServer({workspace});
  process.send?.({event:'ready',url:running.url,workspaceId:(await workspace.view()).workspaceId});
  process.on('message',async message=>{
    if(message?.action==='close'){
      try{await running.close();await workspace.close?.();process.send?.({event:'closed'});process.exit(0);}
      catch(error){process.send?.({event:'error',message:error.message});process.exit(1);}
    }
  });
}else{
  await mkdir(directory,{recursive:true,mode:0o700});
  const journalPath=join(directory,'operator-workflow.json');
  const journal=await exists(journalPath)?JSON.parse(await readFile(journalPath,'utf8')):{
    schema:'sf-tomorrow-live-operator/v1',
    operationId:'TOMORROW-OPERATOR-'+new Date().toISOString().replace(/[^0-9]/g,''),
    startedAt:new Date().toISOString(),phases:{},editions:[],events:[]};
  let workspace,running,browser,context,page,receiver,restored,closed=false,workId;
  let working=false;
  const pageErrors=[],children=new Set(),memory={};
  const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
  async function record(event,details={}){
    const receipt={at:new Date().toISOString(),event,...details};
    journal.events.push(receipt);
    if(journal.events.length>200)journal.events=journal.events.slice(-200);
    await writeFile(journalPath,JSON.stringify(journal,null,2)+'\n',{mode:0o600});
    emit(receipt);
  }
  const sleep=ms=>new Promise(resolveSleep=>setTimeout(resolveSleep,ms));
  function requireValue(condition,message){if(!condition)throw new Error(message);}
  function summary(view){
    return{workspaceId:view.workspaceId,revision:view.revision,workOrders:view.workOrders?.length||0,
      editions:(view.editions||[]).map(edition=>({
        id:edition.id,state:edition.state,rawAvailability:edition.rawAvailability,
        receivedAt:edition.resources?.timeline?.receivedAt,
        timelineSha256:edition.resources?.timeline?.sha256,
        tileSha256:edition.resources?.tile?.sha256
      })),decisions:view.decisions?.length||0};
  }
  async function browserJSON(path){
    const result=await page.evaluate(async path=>{
      const response=await fetch(path,{credentials:'same-origin'});
      return{status:response.status,body:await response.json()};
    },path);
    requireValue(result.status===200,'Local operator read '+path+' returned '+result.status+'.');
    return result.body;
  }
  async function quiet(){
    await page.waitForFunction(()=>document.getElementById('main')?.getAttribute('aria-busy')!=='true');
  }
  async function act(locator,path,{timeout=180000}={}){
    const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST',{timeout});
    await locator.click();
    const response=await responsePromise;
    const result=await response.json();
    requireValue(response.ok(),result.error?.message||('Operator action returned '+response.status()+'.'));
    await quiet();
    return result;
  }
  async function refresh(){
    await page.locator('#refresh-workspace').click();
    await quiet();
    return browserJSON('/api/workspace');
  }
  async function pickEdition(id,tab='Work plan'){
    await refresh();
    const select=page.locator('select[name="edition"]');
    await select.waitFor();
    if(await select.inputValue()!==id)await select.selectOption(id);
    await page.getByRole('tab',{name:tab,exact:true}).click();
    await quiet();
    return browserJSON('/api/editions/'+encodeURIComponent(id));
  }
  async function initialize(){
    const nativeState=await exists(join(directory,'versions'));
    // Native workspace versions are authoritative; the journal only resumes this UI example.
    if(nativeState)workspace=await WeatherWorkspace.open(directory);
    else workspace=await WeatherWorkspace.create(directory,{title:'Boston weather operations',plan});
    const view=await workspace.view();
    journal.workspaceId=view.workspaceId;
    running=await startWeatherServer({workspace});
    const require=createRequire(import.meta.url);
    const configured=option('--playwright-module',process.env.TOMORROW_PLAYWRIGHT_MODULE);
    const playwright=require(configured||'playwright');
    const browserPath=option('--browser',process.env.TOMORROW_BROWSER_EXECUTABLE);
    browser=await playwright.chromium.launch({
      ...(browserPath?{executablePath:browserPath}:{}),
      headless:!has('--headful'),
      args:['--no-sandbox','--no-zygote','--disable-gpu','--disable-dev-shm-usage',...(has('--single-process')?['--single-process']:[])],
      env:process.env
    });
    context=await browser.newContext({viewport:{width:1365,height:900},acceptDownloads:true});
    page=await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror',error=>pageErrors.push(error.message));
    const unauthorized=await fetch(new URL('/api/workspace',running.url));
    requireValue(unauthorized.status===401,'A new unconnected browser should require its session.');
    await page.goto(running.url,{waitUntil:'networkidle'});
    await page.locator('#new-work').waitFor();
    await quiet();
    const csrf=await page.evaluate(async()=>{
      const response=await fetch('/api/work',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      return response.status;
    });
    requireValue(csrf===403,'An authenticated mutation without the CSRF token must be rejected.');
    workId=journal.workId||(view.workOrders||[])[0]?.id;
    await record('ready',{workspaceId:view.workspaceId,sessionRequired:unauthorized.status,csrfRequired:csrf,
      commands:['setup','edition1','decision1','edition2','decision2','compare','handover','restart','receive','reconnect','run','status','quit']});
  }
  async function setup(){
    let view=await workspace.view();
    if(workId&&(view.workOrders||[]).some(work=>work.id===workId)){
      await refresh();await record('work-resumed',{workId});return;
    }
    requireValue(!(view.workOrders||[]).length,'This example requires a dedicated operator workspace.');
    await page.locator('#new-work').click();
    const start=new Date(Math.ceil(Date.now()/3600000)*3600000);
    const end=new Date(start.getTime()+6*3600000);
    const values={
      title:'Boston field operations',
      locationLabel:'Boston operating point',
      latitude:'42.3478',longitude:'-71.0466',
      startTime:start.toISOString(),endTime:end.toISOString(),
      timezone:'America/New_York',dailyStartHour:'0'
    };
    for(const[name,value]of Object.entries(values))await page.locator('[name="'+name+'"]').fill(value);
    await page.locator('select[name="units"]').selectOption('metric');
    const fields=new Set(['temperature','windGust','precipitationIntensity']);
    for(const input of await page.locator('input[name="nativeField"]').all())await input.setChecked(fields.has(await input.inputValue()));
    for(const input of await page.locator('input[name="timestep"]').all())await input.setChecked(await input.inputValue()==='1h');
    while(await page.locator('.rule-row').count())await page.locator('.rule-row').first().getByRole('button',{name:'Remove',exact:true}).click();
    for(const rule of [
      {label:'Review exposed work when gusts reach the configured cue',field:'windGust',value:'8'},
      {label:'Review rain-sensitive work when precipitation reaches the configured cue',field:'precipitationIntensity',value:'1'}
    ]){
      await page.getByRole('button',{name:'Add threshold',exact:true}).click();
      const row=page.locator('.rule-row').last();
      await row.locator('[name="ruleLabel"]').fill(rule.label);
      await row.locator('[name="ruleField"]').selectOption(rule.field);
      await row.locator('[name="ruleOperator"]').selectOption('gte');
      await row.locator('[name="ruleValue"]').fill(rule.value);
    }
    await page.locator('[name="tileEnabled"]').check();
    await page.locator('[name="tileZoom"]').fill('8');
    await page.locator('[name="tileField"]').fill('precipitationIntensity');
    await page.locator('[name="tileTime"]').fill(start.toISOString());
    const capture=option('--capture-layout');
    if(capture)await page.screenshot({path:resolve(capture),fullPage:true});
    await act(page.getByRole('button',{name:'Save work configuration',exact:true}),'/api/work');
    view=await workspace.view();
    requireValue(view.workOrders?.length===1,'The saved operator work plan was not found.');
    workId=view.workOrders[0].id;
    journal.workId=workId;
    journal.intent={workId,location:view.workOrders[0].location,window:view.workOrders[0].window,fields:[...fields],timesteps:['1h'],units:'metric'};
    await record('work-saved',{workId,window:journal.intent.window,fields:[...fields]});
  }
  async function edition(number){
    await setup();
    let view=await workspace.view();
    let id=journal.editions[number-1];
    if(!id){
      requireValue(number===1||journal.editions[number-2],'Prepare the first edition before the next edition.');
      await page.getByRole('tab',{name:'Request review',exact:true}).click();
      await page.locator('[name="editionLabel"]').fill('Operating review '+number);
      const result=await act(page.getByRole('button',{name:'Prepare new edition',exact:true}),'/api/work/'+encodeURIComponent(workId)+'/editions');
      id=result.id||result.edition?.id||result.editionId;
      requireValue(id,'The native workspace did not return an edition ID.');
      journal.editions[number-1]=id;
      await record('edition-prepared',{number,id});
    }
    let detail=await pickEdition(id,'Request review');
    if(['COMPLETE','PARTIAL','METADATA_ONLY'].includes(detail.edition.state)){
      memory['edition'+number]=detail;
      await record('edition-resumed',{number,id,state:detail.edition.state,rawAvailability:detail.edition.rawAvailability});
      return;
    }
    requireValue(['PREPARED','REVIEWED'].includes(detail.edition.state),
      'Edition '+id+' is '+detail.edition.state+'. Reopen this existing edition and use its recovery action before continuing.');
    const review=await act(page.getByRole('button',{name:'Review native request',exact:true}),'/api/editions/'+encodeURIComponent(id)+'/review');
    requireValue(review.providerCalls===2,'This workflow expects exactly the reviewed Timeline and PNG provider calls.');
    const requests=review.requests||[];
    requireValue(requests.some(request=>request.method==='POST'&&request.kind==='timeline')&&requests.some(request=>request.kind==='tile'),
      'The original review did not contain the expected native resources.');
    await record('native-review',{number,id,reviewSha256:review.reviewSha256,providerCalls:review.providerCalls,resources:requests.map(request=>request.kind)});
    await act(page.getByRole('button',{name:'Acquire reviewed forecast',exact:true}),'/api/editions/'+encodeURIComponent(id)+'/acquire');
    detail=await workspace.editionView(id);
    memory['edition'+number]=detail;
    requireValue(detail.edition.state==='COMPLETE','Native edition '+id+' completed as '+detail.edition.state+'. Inspect its original resource outcome before continuing.');
    requireValue(detail.rows?.length>0,'The native Timeline did not provide interval rows.');
    requireValue(detail.tile?.available===true,'The reviewed native PNG is unavailable.');
    await pickEdition(id,'Work plan');
    const image=page.locator('img.map-tile');
    await image.waitFor();
    await page.waitForFunction(()=>{const img=document.querySelector('img.map-tile');return img?.complete&&img.naturalWidth===256&&img.naturalHeight===256;});
    await record('edition-acquired',{number,id,state:detail.edition.state,returnedIntervals:detail.rows.length,
      receivedAt:detail.edition.resources?.timeline?.receivedAt,
      timelineSha256:detail.edition.resources?.timeline?.sha256,
      tileSha256:detail.edition.resources?.tile?.sha256,
      tile:{width:detail.tile.width,height:detail.tile.height}});
  }
  async function decide(number){
    const id=journal.editions[number-1];
    requireValue(id,'Acquire edition '+number+' first.');
    let detail=await pickEdition(id,'Work plan');
    if(detail.decisions?.length){await record('decision-resumed',{number,id,count:detail.decisions.length});return;}
    const row=detail.rows?.find(row=>row.withinWindow!==false&&row.fields?.some(field=>field.present&&field.value!==null));
    requireValue(row,'This edition has no available native interval for staff review.');
    const rowElement=page.locator('tbody tr').filter({hasText:row.startTime}).filter({has:page.getByRole('button',{name:'Review interval',exact:true})}).first();
    await rowElement.getByRole('button',{name:'Review interval',exact:true}).click();
    await page.locator('[name="assignee"]').fill('Internal operations reviewer');
    await page.locator('[name="decision"]').selectOption('REVIEW');
    const rules=(row.fields||[]).flatMap(field=>(field.rules||[]).filter(rule=>rule.triggered).map(rule=>rule.label||rule.id));
    const note='Internal operating review for '+row.startTime+'. '+(rules.length?'Matched configured cues: '+rules.join('; ')+'.':'No configured cue matched this returned interval. Review the planned work before dispatch.');
    await page.locator('[name="note"]').fill(note);
    const decision=await act(page.getByRole('button',{name:'Save interval decision',exact:true}),'/api/decisions');
    detail=await workspace.editionView(id);
    memory['edition'+number]=detail;
    requireValue(detail.decisions?.some(item=>item.id===decision.id||item.intervalId===row.id),'The source-linked staff decision was not retained.');
    await record('decision-saved',{number,id,intervalId:row.id,decision:'REVIEW',assignee:'Internal operations reviewer',matchedRuleCount:rules.length});
  }
  async function compare(){
    requireValue(journal.editions.length===2,'Acquire both original editions before comparison.');
    await pickEdition(journal.editions[1],'Edition changes');
    await page.locator('[name="before"]').selectOption(journal.editions[0]);
    await page.locator('[name="after"]').selectOption(journal.editions[1]);
    const expected='/api/compare';
    const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname===expected);
    await page.getByRole('button',{name:'Compare editions',exact:true}).click();
    const response=await responsePromise;
    const comparison=await response.json();
    requireValue(response.ok()&&comparison.comparable,'The original editions are not available for native comparison.');
    requireValue(comparison.rows?.length>0,'Native comparison did not return matching field/interval keys.');
    memory.comparison=comparison;
    await record('editions-compared',{beforeId:comparison.beforeId,afterId:comparison.afterId,rows:comparison.rows.length,
      changed:comparison.rows.filter(row=>typeof row.change==='number'&&row.change!==0).length,
      missingBefore:comparison.rows.filter(row=>row.beforePresent===false).length,
      missingAfter:comparison.rows.filter(row=>row.afterPresent===false).length});
  }
  async function handover(){
    requireValue(journal.editions.length===2,'Prepare both source-linked operating editions first.');
    await pickEdition(journal.editions[1],'Handover');
    for(const input of await page.locator('[name="exportEdition"]').all())await input.check();
    requireValue(await page.locator('[name="includeRaw"]').isDisabled(),'Evaluation handovers must keep the source attachment control unavailable.');
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download operating handover',exact:true}).click();
    const download=await downloadPromise;
    const path=join(directory,'weather-operations-handover.json');
    await download.saveAs(path);
    const bundle=JSON.parse(await readFile(path,'utf8'));
    requireValue(bundle.payload?.editions?.length===2,'The handover must contain both original editions.');
    requireValue(bundle.payload?.decisions?.length>=2,'The handover must carry the saved staff instructions.');
    requireValue((bundle.payload?.raw||[]).length===0,'Evaluation handovers must not contain raw source attachments.');
    journal.handover={path,sha256:bundle.sha256,editions:bundle.payload.editions.length,decisions:bundle.payload.decisions.length};
    const original=await workspace.view();
    journal.original=summary(original);
    await record('handover-downloaded',journal.handover);
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('tab',{name:'Work plan',exact:true}).click();
    await quiet();
    const layout=await page.evaluate(()=>({
      width:document.documentElement.clientWidth,
      contentWidth:document.documentElement.scrollWidth,
      sourceAttribution:!![...document.querySelectorAll('a')].find(link=>link.textContent==='Powered by Tomorrow.io'&&link.href==='https://www.tomorrow.io/'),
      mapWidth:document.querySelector('img.map-tile')?.naturalWidth||0
    }));
    requireValue(layout.contentWidth<=layout.width,'The narrow operator layout overflows the page.');
    requireValue(layout.sourceAttribution,'The source attribution link is missing.');
    requireValue(pageErrors.length===0,'The browser reported an application error: '+pageErrors.join('; '));
    await page.setViewportSize({width:1365,height:900});
    await record('browser-layout',{...layout,pageErrors:pageErrors.length});
  }
  async function startChild(mode,path){
    const child=fork(fileURLToPath(import.meta.url),['--child',mode,'--workspace',path,...(has('--explicit-proxy')?['--explicit-proxy']:[])],{
      stdio:['ignore','pipe','pipe','ipc'],env:process.env
    });
    children.add(child);
    const errors=[];
    child.stderr.on('data',chunk=>errors.push(String(chunk).slice(0,1000)));
    const ready=await new Promise((resolveReady,reject)=>{
      const timer=setTimeout(()=>reject(new Error('The receiving process did not report readiness.')),30000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error('Receiving process exited '+code+': '+errors.join(' ')));});
      child.on('message',message=>{if(message.event==='ready'){clearTimeout(timer);resolveReady(message);}else if(message.event==='error'){clearTimeout(timer);reject(new Error(message.message));}});
    });
    return{child,...ready};
  }
  async function restart(){
    requireValue(journal.handover&&journal.original,'Download the completed handover before reopening the source workspace.');
    if(!restored){
      await running.close();await workspace.close?.();
      restored=await startChild('open',directory);
    }
    await page.goto(restored.url,{waitUntil:'networkidle'});
    const view=await browserJSON('/api/workspace');
    requireValue(view.workspaceId===journal.workspaceId,'The original workspace identity changed on restart.');
    requireValue(view.editions?.length===2&&view.decisions?.length>=2,'The fresh process lost retained editions or staff decisions.');
    for(const edition of view.editions){
      const original=journal.original.editions.find(item=>item.id===edition.id);
      requireValue(original&&edition.resources?.timeline?.sha256===original.timelineSha256,'The restarted edition changed its original Timeline source reference.');
      requireValue(edition.rawAvailability==='EPHEMERAL_EXPIRED'||edition.state==='METADATA_ONLY','The fresh evaluation process should expose retained metadata and staff decisions.');
    }
    await pickEdition(journal.editions[1],'Work plan');
    await page.getByRole('heading',{name:'Saved staff work instructions',exact:true}).waitFor();
    requireValue(await page.getByText('Internal operations reviewer',{exact:true}).count()>0,'Staff instructions are not visible after evaluation source memory expires.');
    await record('original-process-reopened',summary(view));
  }
  async function receive(){
    requireValue(journal.handover,'Download the operating handover before opening the receiving workspace.');
    const receivingPath=join(directory,'receiving');
    if(!receiver)receiver=await startChild(await exists(receivingPath)?'open':'create',receivingPath);
    await page.goto(receiver.url,{waitUntil:'networkidle'});
    let view=await browserJSON('/api/workspace');
    requireValue(view.workspaceId!==journal.workspaceId,'The receiving customer requires its own workspace identity.');
    if(!view.editions?.length){
      const imported=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/import'&&response.request().method()==='POST');
      await page.locator('#import-file').setInputFiles(journal.handover.path);
      const response=await imported;const result=await response.json();
      requireValue(response.ok(),result.error?.message||'The native receiving import failed.');
      await quiet();
    }
    view=await browserJSON('/api/workspace');
    requireValue(view.editions?.length===2&&view.decisions?.length>=2,'The receiving workspace did not retain the full handover.');
    requireValue(journal.editions.every(id=>view.editions.some(edition=>edition.id===id)),'The receiving workspace changed an original edition identity.');
    await pickEdition(journal.editions[1],'Work plan');
    await page.getByRole('heading',{name:'Saved staff work instructions',exact:true}).waitFor();
    await record('receiving-workspace-imported',{...summary(view),sourceWorkspaceId:journal.workspaceId});
  }
  const phases={setup,edition1:()=>edition(1),decision1:()=>decide(1),edition2:()=>edition(2),decision2:()=>decide(2),compare,handover,restart,receive};
  async function phase(name){
    requireValue(phases[name],'Unknown phase '+name+'.');
    await phases[name]();journal.phases[name]={completedAt:new Date().toISOString()};
    await record('phase-complete',{phase:name});
  }
  async function run(){
    for(const name of Object.keys(phases)){
      await phase(name);
      if(option('--pause-after')===name){await record('paused-with-original-process',{after:name});return;}
    }
    await record('workflow-complete',{workspaceId:journal.workspaceId,editions:journal.editions,plannedProviderCalls:4,handover:journal.handover});
  }
  async function close(){
    if(closed)return;closed=true;
    for(const child of children){try{child.send({action:'close'});}catch{}}
    try{await browser?.close();}catch{}
    if(!restored){try{await running?.close();await workspace?.close?.();}catch{}}
    emit({event:'closed'});setTimeout(()=>process.exit(0),1000).unref();
  }
  process.once('SIGINT',()=>{void close();});
  process.once('SIGTERM',()=>{void close();});
  await initialize();
  const rl=createInterface({input:process.stdin,terminal:false});
  rl.on('line',async line=>{
    const command=line.trim();if(!command)return;
    if(command==='quit'){rl.close();await close();return;}
    if(command==='status'){emit({event:'status',operationId:journal.operationId,completed:Object.keys(journal.phases),editions:journal.editions,working,pageErrors});return;}
    if(command==='reconnect'&&!working){await page.goto((receiver||restored||running).url,{waitUntil:'networkidle'});await record('browser-reconnected');return;}
    if(working){emit({event:'busy',command});return;}
    working=true;
    try{if(command==='run')await run();else await phase(command);}
    catch(error){await record('phase-error',{phase:command,message:error.message});}
    finally{working=false;}
  });
  if(has('--run')){
    working=true;
    try{await run();if(!has('--keep-open')&&!option('--pause-after')){rl.close();await close();}}
    catch(error){await record('phase-error',{phase:'run',message:error.message});}
    finally{working=false;}
  }
}
