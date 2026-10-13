#!/usr/bin/env node
// Original Arches staff UI receiving. Existing installed browser only; no installs.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';

const SCHEMA='commons.arches-browser-receiving.v1';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const VIEWPORTS=[{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}];
function argsOf(argv){
  const out={'chromium-arg':[]};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];assert(flag.startsWith('--')&&i+1<argv.length,'Use --name value arguments.');
    const name=flag.slice(2),value=argv[++i];
    assert(['url','token-file','cohort','output','playwright','chromium','python','application','chromium-arg'].includes(name),'Unknown argument: '+flag);
    if(name==='chromium-arg')out[name].push(value);else{assert(out[name]===undefined,'Repeated argument: '+flag);out[name]=value;}
  }
  out.playwright??=process.env.ARCHES_PLAYWRIGHT;out.chromium??=process.env.ARCHES_CHROMIUM;out.python??=process.env.ARCHES_PYTHON;
  for(const key of ['url','token-file','cohort','output','playwright','chromium','python'])assert(out[key],'Required --'+key);
  out.application??=path.join(HERE,'arches_app.py');
  const u=new URL(out.url);
  assert(['http:','https:'].includes(u.protocol)&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/','Use the explicit existing loopback staff-service origin.');
  out.url=u.origin;
  for(const key of ['token-file','cohort','output','playwright','chromium','python','application'])assert(path.isAbsolute(out[key]),'Use an absolute --'+key+' path.');
  return out;
}
async function regular(filename,{privateFile=false}={}){
  const s=await fs.lstat(filename);assert(s.isFile()&&!s.isSymbolicLink(),'Expected a regular file: '+filename);
  if(privateFile){assert(s.nlink===1&&(s.mode&0o077)===0,'Staff token must be an owned private file.');if(process.getuid)assert(s.uid===process.getuid(),'Staff token owner differs.');}
  return s;
}
async function measured(filename){await regular(filename);const bytes=await fs.readFile(filename);return {bytes:bytes.length,sha256:hash(bytes)};}
async function jsonWrite(filename,value){const temp=filename+'.pending-'+crypto.randomUUID();await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(temp,filename);}
async function python(executable,script,argv,{cwd,env}={}){
  const child=spawn(executable,['-B','-c',script,...argv],{cwd,env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',overflow=false;
  child.stdout.on('data',b=>{stdout+=b;if(stdout.length>4*1024*1024){overflow=true;child.kill('SIGTERM');}});
  child.stderr.on('data',b=>{stderr+=b;if(stderr.length>1024*1024){overflow=true;child.kill('SIGTERM');}});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert(!overflow,'Original Python receiving output exceeded its bound.');
  assert(code===0,'Original Python receiving failed ('+code+'): '+stderr.slice(-6000));
  return JSON.parse(stdout);
}
const CSV_EDIT=String.raw`
import csv,json,pathlib,sys
source,destination,choice,reason=sys.argv[1:]
with open(source,encoding="utf-8",newline="") as f:
    reader=csv.DictReader(f);fields=reader.fieldnames;rows=list(reader)
if not fields or "decision" not in fields or "reason" not in fields or not rows:raise ValueError("Original complete review CSV required")
for row in rows:
    if None in row:raise ValueError("Original review CSV has excess columns")
    row["decision"]=choice;row["reason"]=reason
with open(destination,"x",encoding="utf-8",newline="") as f:
    writer=csv.DictWriter(f,fieldnames=fields,lineterminator="\n");writer.writeheader();writer.writerows(rows)
print(json.dumps({"rows":len(rows),"decision":choice,"columns":fields}))
`;
const COLD_RECEIVE=String.raw`
import hashlib,json,pathlib,sys,zipfile
app,workspace_archive,release_archive,destination,expected_file=sys.argv[1:]
sys.path.insert(0,str(pathlib.Path(app).parent))
from arches_workspace import Workspace,file_hash
from arches_source import loads_json,canonical_json,iter_resources
expected=json.loads(pathlib.Path(expected_file).read_text())
with zipfile.ZipFile(release_archive) as z:
    manifest=json.loads(z.read("MANIFEST.json"))
    members={m["path"]:m for m in manifest["members"]}
    if set(z.namelist())!=set(members)|{"MANIFEST.json"}:raise ValueError("Release membership changed")
    for name,m in members.items():
        data=z.read(name)
        if len(data)!=m["bytes"] or hashlib.sha256(data).hexdigest()!=m["sha256"]:raise ValueError("Release member differs")
    resources=[n for n in members if n.startswith("resources/") and n.endswith(".json")]
    if len(resources)!=1:raise ValueError("Original selected resource count differs")
    retained=loads_json(z.read(resources[0]).decode("utf-8"))
    original=loads_json(pathlib.Path(expected["before_source"]).read_text())["business_data"]["resources"][0]
    if canonical_json(retained)!=canonical_json(original):raise ValueError("Rejected incoming record changed the accepted original")
    contexts=json.loads(z.read("contexts.json"))
    if expected["before_snapshot"] not in contexts:raise ValueError("Original accepted context absent")
    downstream=json.loads(z.read("downstream.json"))
    if downstream["source_format"]!="business_data" or len(downstream["files"])!=1:raise ValueError("Original downstream envelope differs")
    member=downstream["files"][0]
    if member["context_snapshot"]!=expected["before_snapshot"] or member["resources"]!=1:raise ValueError("Original downstream context differs")
    target=pathlib.Path(destination).parent/"received-business-data.json"
    with target.open("xb") as out:out.write(z.read(member["path"]))
    if file_hash(target)!=(member["sha256"],member["bytes"]):raise ValueError("Original downstream bytes differ")
    with iter_resources(target,source_format="business_data") as stream:rows=list(stream)
    if stream.receipt is None or len(rows)!=1 or canonical_json(rows[0])!=canonical_json(retained):raise ValueError("Original StaticFile receiving changed the resource")
received=Workspace.restore(workspace_archive,destination)
cold=Workspace(received["root"])
if cold.status()!=expected["status"]:raise ValueError("Complete restored state changed")
record=cold.resource(expected["after_snapshot"],expected["graph_id"],expected["resource_id"])
if len(record["before"]["tiles"])!=2 or len(record["candidate"]["tiles"])!=3 or record["decision"]["decision"]!="reject":raise ValueError("Received original review history differs")
with cold.connect() as connection:
    exchanges=list(connection.execute("SELECT source_manifest FROM review_exchanges"))
    if len(exchanges)!=2:raise ValueError("Original two review CSV histories did not reopen")
    for (source,) in exchanges:
        source=json.loads(source)
        if file_hash(cold.root/source["path"])!=(source["sha256"],source["bytes"]):raise ValueError("Received original CSV differs")
for name in ("arches_source.py","arches_workspace.py","arches_review_exchange.py","arches_app.py","index.html"):
    if file_hash(pathlib.Path(received["application"])/name)!=file_hash(pathlib.Path(app).parent/name):raise ValueError("Received application differs from the executing original: "+name)
print(json.dumps({"received":received,"review_files":len(exchanges),"release_resources":len(resources),"downstream":member}))
`;

export async function receiveBrowser(options){
  const o={...options},output=path.resolve(o.output),knownSecrets=new Set(),started=new Date().toISOString();
  const redact=value=>{let s=String(value);for(const secret of knownSecrets)if(secret)s=s.split(secret).join('[REDACTED]');return s;};
  try{await fs.mkdir(output,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;assert((await fs.readdir(output)).length===0,'Existing receiving output must be reconciled; do not rerun a partially operated workspace.');}
  const outStat=await fs.lstat(output);assert(outStat.isDirectory()&&!outStat.isSymbolicLink(),'Use an owned private output directory.');if(process.getuid)assert(outStat.uid===process.getuid(),'Output owner differs.');
  await fs.chmod(output,0o700);const lock=await fs.open(path.join(output,'browser-receiving.lock'),'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid,started})+'\n');
  const result={schema:SCHEMA,started,complete:false,services_closed:false,workflow_complete:false,visual_review_complete:false,source_kind:'original publisher fixtures',phases:[],screenshots:[],downloads:[],csv_files:[],artifacts:[],browser_errors:[],layout_observations:[],owned_processes_closed:false};
  let browser,context,page,cold,coldClosed,coldDone=false,token,coldToken,queue=Promise.resolve(),eventCount=0;
  const allowedOrigins=new Set([o.url]);
  const shots=path.join(output,'screenshots'),downloads=path.join(output,'downloads'),temporary=path.join(output,'temporary');
  for(const d of [shots,downloads,temporary])await fs.mkdir(d,{mode:0o700});
  const env={...process.env,TMPDIR:temporary,PYTHONDONTWRITEBYTECODE:'1'};
  const log=entry=>{const record={at:new Date().toISOString(),...entry};queue=queue.then(()=>fs.appendFile(path.join(output,'browser-events.jsonl'),JSON.stringify(record)+'\n',{mode:0o600}));return queue;};
  const phase=async(name,detail={})=>{result.phases.push({phase:name,at:new Date().toISOString(),...detail});await queue;await jsonWrite(path.join(output,'browser-result.json'),result);process.stdout.write(JSON.stringify({event:'browser-phase',phase:name})+'\n');};
  const read=async(base,credential,route)=>{
    assert(route.startsWith('/')&&!route.startsWith('//'),'Original local read route required');
    const response=await fetch(base+route,{headers:{Authorization:'Bearer '+credential},redirect:'error',signal:AbortSignal.timeout(120000)});
    assert(response.ok,'Original read failed: '+route+' / '+response.status);return response.json();
  };
  const idle=async()=>{await page.waitForFunction(()=>!document.querySelector('#connect').disabled);await queue;};
  const shot=async(name,{focus}={})=>{
    for(const view of VIEWPORTS){
      await page.setViewportSize({width:view.width,height:view.height});
      await page.evaluate(()=>document.fonts.ready.then(()=>true));
      if(focus)await page.locator(focus).scrollIntoViewIfNeeded();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const filename=name+'-'+view.name+'.png',target=path.join(shots,filename);
      await page.screenshot({path:target,fullPage:true,animations:'disabled',mask:[page.locator('#token')]});
      const geometry=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,active:document.querySelector('section.active')?.id??null}));
      result.screenshots.push({file:'screenshots/'+filename,...await measured(target),viewport:{width:view.width,height:view.height},state:name});
      result.layout_observations.push({state:name,viewport:view.name,...geometry,horizontal_page_overflow:Math.max(geometry.document,geometry.body)>geometry.viewport+2});
    }
    await page.setViewportSize({width:1440,height:1000});await phase('rendered-'+name);
  };
  const selectTab=async name=>{await page.locator('[data-tab="'+name+'"]').click();await page.locator('#'+name+'.active').waitFor();};
  const responseFor=(route,method='POST')=>page.waitForResponse(r=>new URL(r.url()).pathname===route&&r.request().method()===method);
  const action=async(selector,route,{status=200}={})=>{
    const pending=responseFor(route);await page.locator(selector).click();const response=await pending;const body=await response.json();await idle();
    assert(response.status()===status,'Original UI action '+route+' returned '+response.status()+': '+JSON.stringify(body));return {body,request:response.request().postDataJSON()};
  };
  const download=async(selector,route,name)=>{
    const pendingDownload=page.waitForEvent('download'),pendingResponse=route?responseFor(route):null;
    await page.locator(selector).click();const item=await pendingDownload;
    assert(await item.failure()===null,'Original browser download failed');
    const target=path.join(downloads,name);await item.saveAs(target);const identity=await measured(target);
    const meta=pendingResponse?(await(await pendingResponse).json()):null;await idle();
    if(meta){assert(meta.sha256===identity.sha256&&meta.bytes===identity.bytes,'Original download identity differs from its service result');}
    const entry={file:'downloads/'+name,suggested_filename:item.suggestedFilename(),...identity,...(meta?{native:meta}:{})};result.downloads.push(entry);return {path:target,meta,identity};
  };
  const setReview=async(source,choice,name,reason)=>{
    const target=path.join(downloads,name);
    const edited=await python(o.python,CSV_EDIT,[source,target,choice,reason],{cwd:output,env});
    await fs.chmod(target,0o600);const identity={file:'downloads/'+name,...await measured(target),...edited};result.csv_files.push(identity);await log({event:'original-csv-filled',...identity});
    await page.locator('#reviewFile').setInputFiles(target);return {target,edited};
  };
  const preview=async(status=200)=>action('#previewReview','/api/review/preview',{status});
  const inspectCurrent=async()=>{
    await page.locator('[data-detail]').first().click();await page.locator('#detailPanel:not(.hidden)').waitFor();await idle();
    const text=await page.locator('#detailIssues').innerText();return text;
  };
  const openEdition=async snapshot=>{
    await selectTab('review');await page.locator('#editionSelect').selectOption(snapshot);
    const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/changes');await page.locator('#loadEdition').click();await pending;await idle();
  };
  const startCold=async(application,workspace)=>{
    const child=spawn(o.python,['-B',application,'serve','--workspace',workspace,'--port','0'],{cwd:path.dirname(application),env,stdio:['ignore','pipe','pipe']});
    cold=child;coldClosed=new Promise(resolve=>child.once('close',()=>{coldDone=true;resolve();}));let buffer='',stderr='',settled=false,timer;
    const ready=await new Promise((resolve,reject)=>{
      const fail=error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}};
      child.once('error',fail);child.once('exit',code=>fail(new Error('Owned restored staff service ended before READY: '+code)));
      child.stderr.on('data',b=>{stderr+=b.toString();if(stderr.length>65536){child.kill('SIGTERM');fail(new Error('Owned restored service error output exceeded its bound'));}});
      child.stdout.on('data',b=>{
        buffer+=b.toString();if(buffer.length>65536)return fail(new Error('Owned restored service READY exceeded its bound'));
        let newline;
        while((newline=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let value;try{value=JSON.parse(line);}catch{continue;}
          if(value.event==='ready'&&!settled){settled=true;clearTimeout(timer);resolve(value);}
        }
      });
      timer=setTimeout(()=>fail(new Error('Owned restored staff service did not become READY')),30000);
    });
    return ready;
  };
  try{
    for(const key of ['python','chromium'])o[key]=await fs.realpath(o[key]);
    for(const file of [o.python,o.chromium,o.application])await regular(file);
    await regular(o['token-file'],{privateFile:true});token=(await fs.readFile(o['token-file'],'utf8')).trim();assert(token.length>=32,'Original private staff credential is incomplete');knownSecrets.add(token);
    const cohortRoot=await fs.realpath(o.cohort),cohortFile=path.join(cohortRoot,'COHORT.json');await regular(cohortFile);
    const cohort=JSON.parse(await fs.readFile(cohortFile,'utf8'));
    assert(cohort.schema==='commons.flax-arches-two-edition-cohort.v1'&&cohort.source_format==='business_data','Use the original explicit two-edition publisher cohort.');
    const declared=new Map();
    for(const f of cohort.files){
      assert(typeof f.path==='string'&&!path.isAbsolute(f.path)&&!f.path.split('/').some(p=>p==='..'||p===''),'Unsafe original source member');
      const original=path.join(cohortRoot,f.path),real=await fs.realpath(original);
      assert(real.startsWith(cohortRoot+path.sep),'Original source escaped its retained cohort');
      const identity=await measured(original);assert(identity.sha256===f.sha256&&identity.bytes===f.bytes,'Original cohort bytes changed: '+f.path);
      assert(!declared.has(f.path),'Duplicate original cohort member');declared.set(f.path,original);
    }
    for(const profile of [cohort.editions.before,cohort.editions.after])for(const key of ['resources','graphs','collections','licenses'])for(const name of profile[key]??[])assert(declared.has(name),'Undeclared original source member: '+name);
    const initial=await read(o.url,token,'/api/status');
    assert(initial.snapshots.length===0&&initial.releases.length===0&&initial.revision===0,'Use a NEW empty original staff workspace; reconcile an existing run instead of importing again.');
    result.workspace_id=initial.workspace_id;result.source_cohort={...await measured(cohortFile),schema:cohort.schema,files:cohort.files};
    await fs.copyFile(cohortFile,path.join(output,'COHORT.json'));
    const require=createRequire(import.meta.url),pw=require(o.playwright);
    assert(pw.chromium?.launch,'Explicit installed Playwright Chromium interface required');
    let packageDirectory=path.dirname(require.resolve(o.playwright)),playwrightVersion=null;
    while(packageDirectory!==path.dirname(packageDirectory)){
      try{const packageInfo=JSON.parse(await fs.readFile(path.join(packageDirectory,'package.json'),'utf8'));if(['playwright','playwright-core'].includes(packageInfo.name)){playwrightVersion=packageInfo.version;break;}}catch(error){if(error.code!=='ENOENT')throw error;}
      packageDirectory=path.dirname(packageDirectory);
    }
    const version=/^(\d+)\.(\d+)\./.exec(playwrightVersion??'');assert(version&&(Number(version[1])>1||Number(version[1])===1&&Number(version[2])>=31),'Use an existing Playwright >=1.31 runtime; this driver never installs one.');
    result.runtime={node:process.version,playwright:playwrightVersion,playwright_path:o.playwright,chromium_path:o.chromium,python_path:o.python};
    browser=await pw.chromium.launch({headless:true,executablePath:o.chromium,args:o['chromium-arg']??[],env});
    result.runtime.browser=browser.version();
    context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,serviceWorkers:'block'});
    await context.route('**/*',route=>{const u=new URL(route.request().url());return allowedOrigins.has(u.origin)?route.continue():route.abort('blockedbyclient');});
    page=await context.newPage();page.setDefaultTimeout(120000);page.setDefaultNavigationTimeout(120000);
    page.on('pageerror',error=>{result.browser_errors.push({kind:'pageerror',message:redact(error.message)});});
    page.on('request',request=>{
      const u=new URL(request.url());if(!allowedOrigins.has(u.origin)||!['POST','PUT'].includes(request.method()))return;
      const event={event:'original-ui-request',sequence:++eventCount,method:request.method(),path:u.pathname};
      if(request.method()==='POST'){try{event.body=request.postDataJSON();}catch{event.body_unavailable=true;}}
      log(event).catch(()=>{});
    });
    await page.goto(o.url,{waitUntil:'domcontentloaded'});
    assert(await page.title(),'Original UI document title missing');
    await shot('access');
    await page.locator('#actor').fill('Publisher cohort browser commissioning');
    await page.locator('#connect').click();await idle();
    assert((await page.locator('#notice').innerText()).includes('token'),'The actual empty-credential error did not render');
    await shot('access-error');
    await page.locator('#token').fill(token);
    let releaseLoading,enteredLoading;
    const loadingSeen=new Promise(resolve=>{enteredLoading=resolve;}),loadingGate=new Promise(resolve=>{releaseLoading=resolve;});
    const loadingRoute=async route=>{enteredLoading();await loadingGate;await route.continue();};
    await page.route('**/api/status',loadingRoute,{times:1});
    const connected=responseFor('/api/status','GET');
    await page.locator('#connect').click();await loadingSeen;
    assert(await page.locator('#connect').isDisabled(),'Actual loading controls were not disabled');
    try{await shot('loading');}finally{releaseLoading();}
    await connected;await idle();await shot('empty-workspace');

    const receiveEdition=async(profile,parent,label)=>{
      await selectTab('receive');await page.locator('#scope').fill('publisher-group-original-cohort');
      await page.locator('#format').selectOption('business_data');await page.locator('#coverage').selectOption('complete');await page.locator('#parent').selectOption(parent??'');
      for(const [key,id] of [['resources','resourceFiles'],['graphs','graphFiles'],['collections','collectionFiles'],['licenses','licenseFiles']])
        await page.locator('#'+id).setInputFiles((profile[key]??[]).map(name=>declared.get(name)));
      await shot(label+'-receive-form');
      const received=await action('#receiveButton','/api/import',{status:201});
      await page.locator('#review.active').waitFor();await page.waitForFunction(()=>document.querySelectorAll('#changeTable [data-detail]').length===1);await idle();
      return received.body;
    };
    const first=await receiveEdition(cohort.editions.before,null,'baseline');result.before_snapshot=first.snapshot;
    const firstDetail=await read(o.url,token,'/api/edition?snapshot='+encodeURIComponent(first.snapshot));
    assert(firstDetail.resources===1&&firstDetail.blocking===0,'Original baseline source did not retain one nonblocking resource');
    await shot('baseline-review');
    await inspectCurrent();await shot('baseline-detail',{focus:'#detailPanel'});
    await page.locator('#sources summary').click();
    const originalRel=cohort.editions.before.resources[0],originalSpec=cohort.files.find(f=>f.path===originalRel);
    const originalDownload=await download('[data-source="'+originalSpec.sha256+'"]',null,'Original_Baseline_Resource.json');
    assert(originalDownload.identity.sha256===originalSpec.sha256&&originalDownload.identity.bytes===originalSpec.bytes,'UI original-source download changed');
    await page.locator('#kind').selectOption('removed');
    const filtered=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/changes');await page.locator('#filter').click();await filtered;await idle();
    assert((await page.locator('#changeTable').innerText()).includes('No changes'),'Actual empty filtered result missing');await shot('empty-filtered-review');
    await page.locator('#kind').selectOption('');
    const unfiltered=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/changes');await page.locator('#filter').click();await unfiltered;await idle();
    await page.locator('#selectPage').click();await page.waitForFunction(()=>document.querySelector('#selectionStatus').textContent==='1 selected');
    await page.locator('#clearSelection').click();await page.waitForFunction(()=>document.querySelector('#selectionStatus').textContent==='0 selected');
    const firstCSV=await download('#exportReview','/api/review/export','Baseline_Review.csv');
    await setReview(firstCSV.path,'approve','Baseline_Staff_Decisions.csv','Original publisher baseline: complete resource ownership and meaning sources reviewed.');
    const firstPreview=await preview();assert(firstPreview.body.selected===1&&firstPreview.body.decisions.approve===1,'Baseline CSV preview totals differ');
    await shot('baseline-csv-preview',{focus:'#reviewPreview'});
    const firstApplied=await action('#applyReview','/api/review/apply');assert(firstApplied.body.decisions_saved===1,'Baseline CSV decision not retained');
    await selectTab('releases');await page.locator('#releaseEdition').selectOption(first.snapshot);
    const firstRelease=await action('#publish','/api/release',{status:201});assert(firstRelease.body.resources===1,'Original baseline release count differs');
    result.before_release=firstRelease.body.release;await shot('baseline-release');

    const second=await receiveEdition(cohort.editions.after,firstRelease.body.release,'incoming');result.after_snapshot=second.snapshot;
    const changes=await read(o.url,token,'/api/changes?snapshot='+encodeURIComponent(second.snapshot));
    assert(changes.total===1&&changes.rows[0].kind==='changed'&&changes.rows[0].blocking,'Actual foreign-owned incoming tile was not blocked');
    const row=changes.rows[0],detail=await read(o.url,token,'/api/resource?'+new URLSearchParams({snapshot:second.snapshot,graph_id:row.graph_id,resource_id:row.resource_id}));
    assert(detail.before.tiles.length===2&&detail.candidate.tiles.length===3&&detail.issues.some(i=>i.code==='TILE_RESOURCE_MISMATCH'),'Actual original tile ownership evidence differs');
    await jsonWrite(path.join(output,'actual-resource-review.json'),detail);
    await shot('incoming-review');await inspectCurrent();
    assert((await page.locator('#detailIssues').innerText()).includes('TILE_RESOURCE_MISMATCH'),'Actual ownership issue did not reach staff UI');await shot('incoming-detail',{focus:'#detailPanel'});
    const secondCSV=await download('#exportReview','/api/review/export','Incoming_Review.csv');
    const beforeDenied=await read(o.url,token,'/api/status');
    await setReview(secondCSV.path,'approve','Blocked_Approval.csv','Exercise the actual retained source-contract approval boundary.');
    const blocked=await preview(409);assert(/source-contract issue/.test(blocked.body.error),'Unexpected blocked approval diagnostic');
    assert(equal(await read(o.url,token,'/api/status'),beforeDenied),'Rejected complete preview mutated the original workspace');await shot('blocked-approval-error',{focus:'#notice'});
    await setReview(secondCSV.path,'reject','Incoming_Staff_Decisions.csv','Retain the prior accepted record; the added original tile names another resource owner. Request a corrected publisher edition.');
    const acceptedPreview=await preview();assert(acceptedPreview.body.selected===1&&acceptedPreview.body.decisions.reject===1,'Incoming CSV rejection preview differs');
    await shot('incoming-csv-preview',{focus:'#reviewPreview'});

    // Deliberately lose only one successful local response. The original server
    // commits once; the real UI retains and replays its exact operation identity.
    let responseLost,releaseLost;const lostSeen=new Promise(resolve=>{releaseLost=resolve;});
    await page.route('**/api/review/apply',async route=>{
      try{
        const native=await route.fetch({maxRedirects:0}),body=await native.json(),request=route.request().postDataJSON();
        assert(native.status()===200&&body.decisions_saved===1,'Original review apply failed before controlled response loss');
        responseLost={request,body,status:native.status()};
        await jsonWrite(path.join(output,'original-lost-response.json'),responseLost);
        await route.abort('failed');releaseLost();
      }catch(error){releaseLost(error);await route.abort('failed').catch(()=>{});}
    },{times:1});
    await page.locator('#applyReview').click();const lostError=await lostSeen;if(lostError)throw lostError;await idle();
    const pending=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('arches-review-pending')));
    assert(pending?.path==='/api/review/apply'&&equal(pending.body,responseLost.request),'Original UI did not retain the exact uncertain operation');
    const committed=await read(o.url,token,'/api/status');
    await shot('retained-operation-error',{focus:'#notice'});
    await page.reload({waitUntil:'domcontentloaded'});
    const replay=responseFor('/api/review/apply');await page.locator('#connect').click();const replayResponse=await replay,replayed=await replayResponse.json();await idle();
    assert(replayResponse.status()===200&&equal(replayed,responseLost.body),'Original retained operation replay differs');
    assert(equal(await read(o.url,token,'/api/status'),committed),'Original replay introduced another mutation');
    assert(await page.evaluate(()=>sessionStorage.getItem('arches-review-pending'))===null,'Original replay did not settle its pending identity');
    await phase('same-original-ui-operation-recovered',{operation_id:pending.body.operation_id,result:replayed,controlled_response_loss:true});
    await openEdition(second.snapshot);await inspectCurrent();await shot('recovered-reviewed-resource',{focus:'#detailPanel'});
    await selectTab('releases');await page.locator('#releaseEdition').selectOption(second.snapshot);
    const finalRelease=await action('#publish','/api/release',{status:201});assert(finalRelease.body.resources===1,'Final original accepted release count differs');
    result.release=finalRelease.body.release;await shot('accepted-releases');
    const released=await download('[data-download="'+result.release+'"]','/api/export/release','Arches_Reviewed_Release.zip');
    const transfer=await download('#exportWorkspace','/api/export/workspace','Arches_Complete_Workspace.zip');
    const finalStatus=await read(o.url,token,'/api/status');
    const expected={status:finalStatus,before_source:declared.get(originalRel),before_snapshot:first.snapshot,after_snapshot:second.snapshot,graph_id:row.graph_id,resource_id:row.resource_id,release:result.release};
    const expectedPath=path.join(output,'cold-receiving-input.json');await jsonWrite(expectedPath,expected);
    const received=await python(o.python,COLD_RECEIVE,[o.application,transfer.path,released.path,path.join(output,'cold-receiver'),expectedPath],{cwd:output,env});
    await jsonWrite(path.join(output,'cold-receiving.json'),received);
    await phase('original-release-and-complete-workspace-received',received);
    const ready=await startCold(path.join(received.received.application,'arches_app.py'),received.received.root);
    await regular(ready.token_file,{privateFile:true});coldToken=(await fs.readFile(ready.token_file,'utf8')).trim();knownSecrets.add(coldToken);
    const coldUrl=new URL(ready.url);assert(['localhost','127.0.0.1','[::1]'].includes(coldUrl.hostname),'Owned restored service must be loopback');
    allowedOrigins.add(coldUrl.origin);
    await page.goto(ready.url,{waitUntil:'domcontentloaded'});await page.locator('#token').fill(coldToken);await page.locator('#actor').fill('Publisher cohort browser commissioning');
    const coldStatus=responseFor('/api/status','GET');await page.locator('#connect').click();await coldStatus;await idle();
    assert(equal(await read(ready.url,coldToken,'/api/status'),finalStatus),'Restored HTTP workspace identity differs');
    await shot('cold-reopened-workspace');await openEdition(second.snapshot);await inspectCurrent();await shot('cold-reopened-detail',{focus:'#detailPanel'});
    await selectTab('releases');await shot('cold-reopened-releases');
    const reopened=await download('[data-download="'+result.release+'"]','/api/export/release','Arches_Reopened_Release.zip');
    result.cold_receiving={workspace_id:ready.workspace,original_revision:finalStatus.revision,review_files:received.review_files,restored_application:received.received.application,reopened_release:reopened.identity};
    assert(result.browser_errors.length===0,'The actual browser emitted an unhandled page error; inspect browser-result.json.');
    result.workflow_complete=true;await phase('browser-workflow-complete',{visual_review_complete:false,screenshots:result.screenshots.length});
  }catch(error){result.error={name:error.name,message:redact(error.message)};throw error;}
  finally{
    if(cold&&!coldDone){
      if(cold.pid)cold.kill('SIGTERM');
      const timer=setTimeout(()=>{if(!coldDone&&cold.pid)cold.kill('SIGKILL');},5000);
      await coldClosed;clearTimeout(timer);
    }
    if(context)await context.close().catch(error=>{result.close_error=redact(error.message);});
    if(browser)await browser.close().catch(error=>{result.close_error=redact(error.message);});
    result.services_closed=!cold||coldDone;
    result.browser_closed=!browser||!browser.isConnected();
    result.owned_processes_closed=result.services_closed&&result.browser_closed;
    result.source_service_owner='caller; driver never stops the supplied original service';
    result.complete=result.workflow_complete&&result.owned_processes_closed&&!result.close_error;
    result.finished=new Date().toISOString();await queue;
    const review=['# Actual Arches browser images','',
      'Workflow completion does not establish visual approval. Open every image below and record the observed layout, text, controls and any corrections. Screenshots mask the staff credential.','',
      'Status: PENDING_IMAGE_REVIEW','',
      ...result.screenshots.map(s=>'- [ ] '+s.file+' — '+s.viewport.width+'×'+s.viewport.height+'; SHA-256 '+s.sha256),'',
      'Any horizontal_page_overflow observation or browser error must be resolved or explicitly explained against the viewed images. Keep complete images, original downloads, browser-events.jsonl and browser-result.json in the same final saved project.',''].join('\n');
    await fs.writeFile(path.join(output,'VISUAL_REVIEW.md'),review,{mode:0o600});
    // Publish only explicit receiving outputs. Never walk browser state, the
    // private cold workspace, token files or temporary runtime directories.
    try{
      const selected=new Map();
      for(const item of result.screenshots)selected.set(item.file,'screenshot');
      for(const item of [...result.downloads,...result.csv_files])selected.set(item.file,'download');
      for(const [file,kind] of [
        ['COHORT.json','receiving'],['actual-resource-review.json','receiving'],
        ['original-lost-response.json','receiving'],['cold-receiving.json','receiving'],
        ['received-business-data.json','receiving'],['VISUAL_REVIEW.md','receiving'],
        ['browser-events.jsonl','log']]){
        try{await regular(path.join(output,file));selected.set(file,kind);}catch(error){if(error.code!=='ENOENT')throw error;}
      }
      const root=await fs.realpath(output);
      for(const [relative,kind] of selected){
        assert(!path.isAbsolute(relative)&&!relative.split('/').some(p=>p==='..'||p===''),'Unsafe published browser output');
        const target=path.join(output,relative),actual=await fs.realpath(target);
        assert(actual.startsWith(root+path.sep),'Published browser output escaped its owned root');
        result.artifacts.push({path:relative,...await measured(target),kind});
      }
    }catch(error){result.artifact_error=redact(error.message);result.complete=false;}
    await jsonWrite(path.join(output,'browser-result.json'),result);
    await lock.close();
  }
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  receiveBrowser(argsOf(process.argv.slice(2))).then(result=>process.stdout.write(JSON.stringify({event:'browser-complete',complete:result.complete,services_closed:result.services_closed,workflow_complete:result.workflow_complete,visual_review_complete:false,screenshots:result.screenshots.length,owned_processes_closed:result.owned_processes_closed})+'\n')).catch(error=>{process.stderr.write('Arches browser receiving failed; inspect the retained private browser-result.json. '+error.name+'\n');process.exitCode=1;});
}
