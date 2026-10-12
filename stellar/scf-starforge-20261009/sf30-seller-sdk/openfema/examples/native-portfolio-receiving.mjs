#!/usr/bin/env node
// MIT. One original OpenFEMA source → portfolio → merchant → portable workspace journey.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,lstat,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gunzipSync,gzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {startOpenFemaWorkspace,readReleaseRuntime} from '../workspace.mjs';
import {openOpenFemaWorkspace} from '../core.mjs';
import {inspectWorkspaceArchive,restoreWorkspaceArchive} from '../exports.mjs';
import {initializeOpenFemaWorkspaceMerchant} from '../merchant-setup.mjs';
import {openOpenFemaClient,inspectOpenFemaFiles,downloadOpenFemaFiles,reopenOpenFemaFiles} from '../mcp-client.mjs';
import {openFemaWorkspaceTools} from '../mcp-protocol.mjs';
import {startMerchantMcp} from '../../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import {MCP_VERSION} from '../../../../../stellar-forge/mcp-paid-agent/http-tools.mjs';
import {readApplicationProviders} from '../../../distribution/runtime-workspace/application-providers.mjs';

const OPERATION='SCF-OPENFEMA-PORTFOLIO-3BDA-20261012';
const ORIGINAL_SHA='580f2b88274a9d74070d03b636840863a11ab3c21270da9d8a63840524b58077';
const ORIGINAL_COUNTS={declarations:2,applicants:43,projects:195};
const ORIGINAL_TOTALS={projectCostMinor:'80564020435',federalObligatedMinor:'75367061958',
  totalObligatedMinor:'75367061958',mitigationMinor:'1504887726'};
const TABLES=['projects','applicants','disasters','declarations','categories','issues'];
const sourceDirectory=fileURLToPath(new URL('../',import.meta.url));
const sourceRoot=resolve(sourceDirectory,'../../../..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const bytes=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const fail=(code,message)=>Object.assign(new Error(message),{code});
const now=()=>new Date().toISOString();
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const equal=(a,b)=>assert.deepEqual(stable(a),stable(b));
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function privateFile(path,body){await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temporary=path+'.'+process.pid+'.tmp';await writeFile(temporary,body,{mode:0o600});await rename(temporary,path);}
async function immutable(path,body){if(await exists(path)){assert.equal(sha(await readFile(path)),sha(body),'Retained receiving file changed: '+path);return;}
  await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,body,{mode:0o600,flag:'wx'});}
async function ownedJSON(path){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||
  process.platform!=='win32'&&(info.uid!==process.getuid()||(info.mode&0o077)))throw fail('RECEIVING_PRIVATE_INPUT','Select an owned private original input file.');
  return json(await readFile(path));}
function options(args){
  const allowed=new Set(['--bundle','--directory','--source-ref','--terms-file','--release-runtime','--inbox','--intent-ids-file','--chromium','--playwright']);
  if(args.includes('--help'))return null;
  const out={};for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||out[args[i]]!==undefined||!args[i+1]||args[i+1].startsWith('--'))
    throw fail('RECEIVING_OPTIONS','Use supported option/value pairs; see --help.');out[args[i]]=args[i+1];}
  for(const key of ['--bundle','--directory','--source-ref'])if(!out[key])throw fail('RECEIVING_OPTIONS','Missing '+key);
  if(!/^[a-f0-9]{40}$/.test(out['--source-ref']))throw fail('RECEIVING_SOURCE','Pin the complete original source commit.');
  if(Boolean(out['--chromium'])!==Boolean(out['--playwright']))throw fail('RECEIVING_BROWSER','Supply both existing browser executable and Playwright module, or neither.');
  if(Boolean(out['--inbox'])!==Boolean(out['--intent-ids-file']))throw fail('RECEIVING_BUYER','Supply the original inbox and its exact completed intent selection together.');
  return out;
}
function acceptance(value){if(value?.ok!==true)throw Object.assign(fail(value?.native?.error??'RECEIVING_NATIVE_REJECTED',
  value?.native?.message??'The original native owner rejected this operation.'),{original:value});return value.native;}
async function childJSON(argv,{directory,output,env=process.env}){
  const result=await new Promise((yes,no)=>{
    const child=spawn(process.execPath,argv,{cwd:directory,env,stdio:['ignore','pipe','pipe']});
    const stdout=[],stderr=[];let count=0;
    child.stdout.on('data',b=>{count+=b.length;if(count>64*1024*1024)child.kill('SIGTERM');else stdout.push(b);});
    child.stderr.on('data',b=>stderr.push(b));
    child.once('error',no);child.once('exit',(code,signal)=>yes({code,signal,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)}));
  });
  await privateFile(output+'.stdout.json',result.stdout);await privateFile(output+'.stderr.txt',result.stderr);
  if(result.code!==0)throw Object.assign(fail('RECEIVING_CLI','The original CLI failed; read its retained stdout/stderr.'),{exitCode:result.code,signal:result.signal});
  return json(result.stdout);
}
async function main(args=process.argv.slice(2),{testnet}={}){
  if(testnet!==undefined&&(!testnet||typeof testnet.purchase!=='function'||typeof testnet.inboxDirectory!=='string'||!testnet.selection))
    throw fail('RECEIVING_COMMISSIONER','Use the original host commissioning adapter with its retained selection.');
  const o=options(args);
  if(!o){console.log('native-portfolio-receiving.mjs --bundle ORIGINAL_JSON_OR_GZIP --directory PRIVATE_RECEIVING_ROOT --source-ref COMMIT\n  [--terms-file ORIGINAL_PUBLIC_TERMS_JSON --release-runtime ORIGINAL_RUNTIME_JSON]\n  [--inbox ORIGINAL_SF88_INBOX --intent-ids-file ORIGINAL_COMPLETED_IDS_JSON]\n  [--chromium EXISTING_EXECUTABLE --playwright EXISTING_PLAYWRIGHT_MODULE]\nThe terms file is {origin,path,payment}. Existing buyer intents are received through their original engine.');return;}
  const directory=resolve(o['--directory']),workspace=join(directory,'workspace'),restoredDirectory=join(directory,'restored-workspace');
  await mkdir(directory,{recursive:true,mode:0o700});
  const rootInfo=await lstat(directory);assert.ok(rootInfo.isDirectory()&&!rootInfo.isSymbolicLink());
  if(process.platform!=='win32')assert.equal(rootInfo.mode&0o077,0,'Receiving root must be private.');
  const inputFile=resolve(o['--bundle']),transport=await readFile(inputFile);
  const original=transport[0]===31&&transport[1]===139?gunzipSync(transport):transport;
  assert.equal(sha(original),ORIGINAL_SHA,'This operation receives the exact complete retained DR4724 source.');
  const bundle=json(original),bundlePath=join(directory,'input','OpenFEMA_DR4724_Original_Source.json');
  await immutable(bundlePath,original);
  const terms=o['--terms-file']?await ownedJSON(resolve(o['--terms-file'])):null;
  if(terms)assert.ok(terms.origin&&terms.path&&terms.payment,'Use the existing original public payment terms.');
  const releaseRuntime=o['--release-runtime']?await readReleaseRuntime(resolve(o['--release-runtime'])):{port:0};
  const intentIds=o['--intent-ids-file']?await ownedJSON(resolve(o['--intent-ids-file'])):null;
  if(intentIds)assert.ok(Array.isArray(intentIds)&&intentIds.length&&intentIds.every(x=>typeof x==='string'));
  if(testnet&&(o['--inbox']||o['--intent-ids-file']))throw fail('RECEIVING_BUYER_SELECTION','Select the commissioned new purchase or an existing inbox.');
  const inboxDirectory=testnet?resolve(testnet.inboxDirectory):o['--inbox']?resolve(o['--inbox']):undefined;
  if(testnet&&!terms)throw fail('RECEIVING_COMMISSIONED_TERMS','The native commissioner supplies the original seller terms and runtime.');
  const selection={operation:OPERATION,sourceRef:o['--source-ref'],originalSourceSha256:ORIGINAL_SHA,
    originalSourceBytes:original.length,terms:terms?{sha256:sha(await readFile(resolve(o['--terms-file'])))}:null,
    runtime:releaseRuntime,inboxDirectory:inboxDirectory??null,intentIds,...(testnet?{commissioning:testnet.selection}:{})};
  await immutable(join(directory,'receiving-selection.json'),bytes(selection));
  const reportFile=join(directory,'native-portfolio-receiving.json');
  let previousReport=null;
  if(await exists(reportFile)){previousReport=json(await readFile(reportFile));equal(previousReport.selection,selection);if(previousReport.state==='COMPLETE'){console.log(JSON.stringify({state:'COMPLETE',reused:true,report:reportFile,...previousReport.summary}));return previousReport;}}
  const report=previousReport??{schema:'stellar-forge.openfema-native-receiving.v1',state:'RUNNING',selection,startedAt:now(),
    sourceDirectory,node:process.version,checks:[],steps:{},outputs:[]};
  report.state='RUNNING';report.attempts=(report.attempts??0)+1;delete report.error;delete report.failedAt;
  const remember=async(name,value)=>{report.steps[name]=value;await privateFile(reportFile,bytes(report));};
  const check=async(name,details={})=>{report.checks.push({name,completedAt:now(),...details});await privateFile(reportFile,bytes(report));
    console.log(JSON.stringify({operation:OPERATION,step:name,state:'COMPLETE',...details}));};
  const output=async(name,body)=>{const path=join(directory,'artifacts',name);await privateFile(path,body);
    const item={name,path,bytes:body.length,sha256:sha(body)};report.outputs=report.outputs.filter(x=>x.name!==name);report.outputs.push(item);return item;};
  let session=null,mcp=null,client=null,browser=null;let endpoint=null,environment=null;let currentWorkspace=workspace;
  const consoleFile=join(directory,'connection','console-url.txt'),connectionFile=join(directory,'connection','openfema.json');
  const merchantDirectory=join(directory,'merchant-host'),merchantConfig=join(merchantDirectory,'merchant-mcp.json');
  let workspaceId;
  async function launch(originalDirectory){
    currentWorkspace=originalDirectory;
    session=await startOpenFemaWorkspace({directory:originalDirectory,inboxDirectory,releaseRuntime});
    const schema=session.app.schema();if(workspaceId)assert.equal(schema.workspaceId,workspaceId);else workspaceId=schema.workspaceId;
    await privateFile(consoleFile,Buffer.from(session.url+'\n'));
    await immutable(connectionFile,bytes({schema:'stellar-forge.openfema-workspace-connection.v1',workspaces:{
      dr4724:{label:'Original DR4724 Public Assistance portfolio',workspaceId,consoleUrlFile:consoleFile,
        sourcePackages:{original:{path:bundlePath,sha256:ORIGINAL_SHA,label:'Complete original DR4724 source'}}}}}));
    if(!await exists(merchantConfig))await initializeOpenFemaWorkspaceMerchant({directory:merchantDirectory,connection:connectionFile,name:'OpenFEMA original native receiving'});
    else assert.equal((await ownedJSON(merchantConfig)).openFemaWorkspaceConnection,connectionFile);
    environment={...process.env,MCP_ACCESS_TOKEN:randomBytes(32).toString('base64url')};
    mcp=await startMerchantMcp({configPath:merchantConfig,port:0,environment});
    endpoint=mcp.url;
    client=await openOpenFemaClient({workspace:'dr4724',url:endpoint,environment});
    return {workspaceId,workspaceRevision:session.app.store.read().revision};
  }
  async function stop(){if(mcp){const owned=mcp;mcp=null;await owned.close();}if(session){const owned=session;session=null;await owned.close();}}
  async function api(path,body){const response=await fetch(session.origin+path,{method:body===undefined?'GET':'POST',redirect:'error',
    headers:{Authorization:'Bearer '+session.token,Origin:session.origin,...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const raw=Buffer.from(await response.arrayBuffer());if(!response.ok)throw Object.assign(fail('RECEIVING_HTTP_'+response.status,
      'Original workspace HTTP operation failed.'),{body:raw.toString('utf8')});return json(raw);}
  async function action(suffix,action,payload){
    const operationId='original-'+ORIGINAL_SHA.slice(0,16)+'-'+suffix;
    const requestPath=join(directory,'requests',suffix+'.json');let request;
    if(await exists(requestPath)){request=await ownedJSON(requestPath);equal({action:request.action,payload:request.payload,operationId:request.operationId},{action,payload,operationId});}
    else{request={action,payload,operationId,expectedRevision:acceptance(await client.call('view')).revision};await immutable(requestPath,bytes(request));}
    const response=acceptance(await client.action(action,payload,{operationId,expectedRevision:request.expectedRevision}));
    assert.equal(response.operationId,operationId);
    return {request,response,result:response.result};
  }
  const fileOptions=(kind,id,more={})=>({workspace:'dr4724',url:endpoint,environment,kind,id,expectedWorkspaceId:workspaceId,...more});
  async function receive(kind,id,name){
    const selected=await inspectOpenFemaFiles(fileOptions(kind,id));
    const received=await downloadOpenFemaFiles(fileOptions(kind,id,{directory:join(directory,'received',name),
      chunkSize:32768,expectedManifestSha256:selected.manifestSha256}));
    const reopened=await reopenOpenFemaFiles({directory:received.directory,expectedManifestSha256:selected.manifestSha256});
    assert.equal(reopened.state,'COMPLETE');assert.equal(reopened.files,selected.manifest.files.length);
    return {manifest:selected.manifest,manifestSha256:selected.manifestSha256,received,reopened};
  }
  async function merchantJourney(releaseId,suffix,{dataset}={}){
    const completed=report.steps[suffix+'-journey'];
    if(completed){assert.equal(completed.releaseId,releaseId);return completed;}
    const runSuffix=suffix+'-receiving-'+report.attempts;
    const inspected=(await action(runSuffix+'-inspect','release.inspect',{releaseId})).result;
    const activated=inspected.selection.active===releaseId?inspected:(await action(runSuffix+'-activate','release.activate',{releaseId,expectedGeneration:inspected.selection.generation})).result;
    const started=(await action(runSuffix+'-start','release.start',{releaseId,expectedGeneration:activated.selection.generation})).result;
    const runtime=started.publisher.releases.runtime,listener=runtime.observed?.listener;
    let result,primaryError;
    try{
      if(typeof listener!=='string'||!/^http:\/\/127\.0\.0\.1:[1-9][0-9]*\/?$/.test(listener))throw fail('RECEIVING_LISTENER','The original SF82 child did not return its loopback listener.');
      const health=await fetch(new URL('/_seller/health',listener),{redirect:'error'});assert.equal(health.status,200);
      const healthBody=json(Buffer.from(await health.arrayBuffer()));
      const originalRoute=inspected.release.routes.find(r=>r.method==='GET'&&r.path===terms.path)??inspected.release.routes[0];
      const requested=new URL(originalRoute.path,listener);requested.search='limit=2';
      const response=await fetch(requested,{redirect:'error'});
      const body=Buffer.from(await response.arrayBuffer()),headers=Object.fromEntries(response.headers);
      assert.equal(response.status,402,'The selected paid dataset returns its original challenge before payment.');
      assert.ok(headers['payment-required']||body.length,'Original payment challenge has a complete body or header.');
      await output(suffix+'-challenge.json',bytes({status:response.status,headers,bodyBase64:body.toString('base64'),bodySha256:sha(body),
        releaseId,digest:inspected.release.digest,route:originalRoute.path,mode:runtime.observed.mode}));
      if(testnet&&suffix==='original-seller'){
        assert.ok(dataset&&dataset.snapshot===inspected.release.dataset.baselineSnapshot);
        const purchased=await testnet.purchase({releaseId,digest:inspected.release.digest,dataset,
          listener,route:originalRoute.path,workspaceId,sourceSha256:ORIGINAL_SHA});
        assert.ok(Array.isArray(purchased.intentIds)&&purchased.intentIds.length===1);
        assert.equal(purchased.snapshot,dataset.snapshot);assert.equal(purchased.rows,195);
        const selectedIntents=purchased.intentIds;
        const inspectedBuyer=(await action('buyer-inspect','buyer.inspect',{intentIds:selectedIntents})).result;
        const received=(await action('buyer-receive','buyer.receive',{intentIds:selectedIntents})).result;
        assert.equal(received.dataset.snapshot,dataset.snapshot);assert.equal(received.dataset.rows,195);
        const files=await receive('receipt',received.id,'original-customer');
        assert.equal(files.reopened.files,5);
        await remember('customer',{commissioning:purchased,inspected:inspectedBuyer,received,files});
        await check('New OpenFEMA testnet purchase and all five original customer files',{
          intentIds:selectedIntents,transaction:purchased.transaction,snapshot:purchased.snapshot,
          rows:purchased.rows,receiptId:received.id,manifestSha256:received.manifestSha256});
      }
      result={releaseId,digest:inspected.release.digest,mode:runtime.observed.mode,
        health:healthBody,challengeStatus:response.status,challengeSha256:sha(body)};
    }catch(error){primaryError=error;throw error;}
    finally{
      try{
        const stopped=(await action(runSuffix+'-stop','release.stop',{releaseId})).result;
        assert.ok(['STOPPED','NO_OWNED_PROCESS'].includes(stopped.nativeResult.state));
        if(result){result.selection=stopped.selection;result.stopped=stopped.nativeResult.state;}
      }catch(error){if(primaryError)primaryError.merchantStopError={code:error.code??error.name,message:error.message};else throw error;}
    }
    await remember(suffix+'-journey',result);return result;
  }
  async function browserJourney(){
    if(!o['--playwright'])return {state:'AWAITING_EXISTING_BROWSER',arguments:['--playwright','--chromium']};
    const module=await import(pathToFileURL(resolve(o['--playwright'])).href);
    const chromium=module.chromium??module.default?.chromium;if(!chromium)throw fail('RECEIVING_BROWSER_MODULE','The selected existing module does not export Chromium.');
    const browserTmp=join(directory,'browser-private');await mkdir(browserTmp,{recursive:true,mode:0o700});
    browser=await chromium.launch({executablePath:resolve(o['--chromium']),headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],
      env:{...process.env,TMPDIR:browserTmp}});
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    const page=await context.newPage(),errors=[],screens=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(session.url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#connection')?.textContent==='Workspace open');
    assert.equal(await page.locator('#navigation button').count(),7);
    const section=async name=>{await page.locator('#navigation [data-section="'+name+'"]').click();};
    await section('portfolios');await page.locator('#portfolio-table tbody tr').first().waitFor();
    const countText=await page.locator('#portfolio-table .pagination').innerText();assert.ok(countText.includes('195'));
    await page.locator('#portfolio-table [data-command="record"]').first().click();
    await page.locator('#record-dialog[open]').waitFor();assert.ok((await page.locator('#record-body').innerText()).length>100);
    await page.locator('#close-record').click();
    await page.locator('#table-search').fill('4724');await page.locator('#table-form button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('#portfolio-table .pagination')?.textContent.includes('195'));
    for(const table of TABLES){await page.locator('[data-command="table"][data-table="'+table+'"]').click();
      await page.waitForFunction(()=>document.querySelector('#portfolio-table')?.textContent?.trim().length>0);}
    for(const name of ['sources','review','changes','publication','customer','handover']){await section(name);assert.ok((await page.locator('#main').innerText()).length>100);}
    await section('portfolios');await page.locator('[data-command="table"][data-table="projects"]').click();
    await page.locator('#portfolio-table tbody tr').first().waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Desktop has horizontal page overflow.');
    const desktop=join(directory,'artifacts','portfolio-desktop.png');await page.screenshot({path:desktop,fullPage:true});screens.push(desktop);
    await page.setViewportSize({width:390,height:844});await section('sources');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile has horizontal page overflow.');
    const mobile=join(directory,'artifacts','portfolio-mobile.png');await page.screenshot({path:mobile,fullPage:true});screens.push(mobile);
    assert.deepEqual(errors,[]);
    await context.close();await browser.close();browser=null;
    for(const path of screens){const body=await readFile(path);report.outputs.push({name:path.split('/').at(-1),path,bytes:body.length,sha256:sha(body)});}
    return {state:'COMPLETE',sections:7,tables:6,recordDialog:true,retainedSearch:'4724',desktop:1440,mobile:390,pageErrors:errors,screens};
  }
  try{
    await launch(workspace);
    await remember('launch',{workspaceId,sourceRef:o['--source-ref']});
    const catalogResponse=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+environment.MCP_ACCESS_TOKEN,
      'Content-Type':'application/json','MCP-Protocol-Version':MCP_VERSION},
      body:JSON.stringify({jsonrpc:'2.0',id:991,method:'tools/list',params:{}})});
    assert.equal(catalogResponse.status,200);const catalog=json(Buffer.from(await catalogResponse.arrayBuffer()));
    assert.equal(catalog.id,991);assert.ok(!catalog.error);
    const advertised=catalog.result.tools.map(t=>t.name),originalTools=openFemaWorkspaceTools(name=>name);
    for(const name of originalTools)assert.ok(advertised.includes(name),'Missing original tool '+name);
    const applications=await readApplicationProviders({sourceRoot});
    const originalApplication=applications.catalog.find(x=>x.id==='openfema-public-assistance');assert.ok(originalApplication);
    await output('native-catalog.json',bytes({protocol:MCP_VERSION,openfemaTools:originalTools,totalMerchantTools:advertised.length,
      application:originalApplication,applicationProvider:applications.sources.find(s=>s.id==='openfema-public-assistance')??null}));
    await check('Original merchant MCP and Applications catalogs',{openfemaTools:originalTools.length,totalMerchantTools:advertised.length});
    const imported=await action('source-import','source.import',{sourcePackage:'original'}),edition=imported.result;
    assert.match(edition.id,/^[a-f0-9]{64}$/);
    const repeated=acceptance(await client.action('source.import',{sourcePackage:'original'},imported.request));
    assert.equal(repeated.reused,true);assert.equal(repeated.result.id,edition.id);
    const sourceCounts={},rawRows={};for(const kind of Object.keys(ORIGINAL_COUNTS)){
      rawRows[kind]=[];for await(const row of session.app.capture.rows(edition.id,kind))rawRows[kind].push(row);
      sourceCounts[kind]=rawRows[kind].length;assert.equal(sourceCounts[kind],edition.datasets[kind].rowCount);
      for(const row of rawRows[kind]){assert.match(row.sourcePageSha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(row.sourceRow)&&row.sourceRow>=0);}
    }
    equal(sourceCounts,ORIGINAL_COUNTS);
    const originalReceipts=Object.values(edition.datasets).flatMap(d=>[d.metadataReceipt,d.fieldsReceipt,d.metadataEndReceipt,...d.pages]);
    for(const receipt of originalReceipts){const retained=await session.app.store.object(receipt.sha256);assert.equal(sha(retained),receipt.sha256);assert.equal(retained.length,receipt.bytes);}
    await output('original-edition.json',bytes(edition));
    await check('Complete original source import and exact operation retry',{editionId:edition.id,counts:sourceCounts,originalResponses:originalReceipts.length,
      originalResponseBytes:originalReceipts.reduce((n,r)=>n+r.bytes,0),sourceSha256:edition.sourceSha256});
    const built=await action('portfolio-create','portfolio.create',{name:'DR4724 complete Public Assistance portfolio',editionId:edition.id,
      criteria:{name:'DR4724 complete Public Assistance portfolio',disasters:['4724'],includeUnjoined:true,
        note:'Original complete source receiving and analyst portfolio commissioning.'}});
    const portfolioId=built.result.portfolio.id,beforeId=built.result.version.id;
    const before=await session.app.version(beforeId);
    for(const [key,value]of Object.entries(ORIGINAL_TOTALS))assert.equal(before.portfolio.summary[key],value,key);
    assert.equal(before.portfolio.projects.length,195);assert.equal(before.portfolio.summary.includedProjects,195);
    const tables={};for(const table of TABLES){const result=acceptance(await client.call('rows',{versionId:beforeId,table,offset:0,limit:1000}));
      tables[table]=result;assert.equal(result.total,before.portfolio[table].length);assert.equal(result.rows.length,result.total);}
    await output('initial-portfolio.json',bytes(before));await output('all-six-tables.json',bytes(tables));
    const selected=before.portfolio.projects.find(p=>p.included&&p.federalObligated.minor!==null);assert.ok(selected);
    const review=await action('review-selected-project','review.save',{portfolioId,versionId:beforeId,annotation:{
      subject:selected.subject,status:'reviewed',disposition:'exclude',priority:'normal',owner:'Original receiving operator',
      note:'Receiving exercise: exclude this selected original project from this saved analytical portfolio. The full FEMA source remains retained.'}});
    const afterId=review.result.version.id,after=await session.app.version(afterId);
    assert.equal(after.portfolio.summary.includedProjects,194);
    for(const [key,field]of Object.entries({projectCostMinor:'projectCost',federalObligatedMinor:'federalObligated',
      totalObligatedMinor:'totalObligated',mitigationMinor:'mitigation'}))
      assert.equal(after.portfolio.summary[key],(BigInt(before.portfolio.summary[key])-BigInt(selected[field].minor??'0')).toString());
    const changed=(await action('compare-reviewed-version','portfolio.compare',{beforeVersionId:beforeId,afterVersionId:afterId})).result;
    assert.equal(changed.summary.added,0);assert.equal(changed.summary.removed,0);assert.equal(changed.summary.changed,1);
    const accepted=(await action('accept-reviewed-version','review.accept',{portfolioId,versionId:afterId,
      note:'Original DR4724 source and the single explicit portfolio exclusion were inspected together.'})).result;
    assert.equal(accepted.sha256,after.record.sha256);
    await output('reviewed-portfolio.json',bytes(after));await output('portfolio-comparison.json',bytes(changed));
    await remember('portfolio',{portfolioId,beforeVersionId:beforeId,afterVersionId:afterId,beforeSha256:before.record.sha256,
      afterSha256:after.record.sha256,reviewedSubject:selected.subject,originalSummary:before.portfolio.summary,reviewedSummary:after.portfolio.summary,comparison:changed.summary});
    await check('All six exact-value tables and retained review/version comparison',{portfolioId,beforeVersionId:beforeId,afterVersionId:afterId,originalTotals:ORIGINAL_TOTALS});
    const datasets=[];
    for(const [suffix,versionId]of [['complete',beforeId],['reviewed',afterId]]){
      const dataset=(await action('dataset-'+suffix,'dataset.prepare',{versionId,table:'projects',name:'DR4724 '+suffix+' project register'})).result;
      const query=(await action('query-'+suffix,'dataset.query',{datasetId:dataset.id,query:'limit=250'})).result;
      assert.equal(query.schema,'stellar-forge.dataset-page.v1');assert.equal(query.dataset.snapshot,dataset.snapshot);
      assert.equal(query.page.total,195);assert.equal(query.rows.length,195);assert.equal(query.page.nextCursor,null);
      assert.ok(query.rows.every(r=>typeof r.federalObligated==='string'),'Dataset exact amounts remain decimal strings.');
      await output('dataset-'+suffix+'-page.json',bytes(query));datasets.push(dataset);
    }
    await remember('datasets',datasets);
    await check('Native dataset packages and original query engine',{datasets:datasets.map(d=>({id:d.id,snapshot:d.snapshot,rows:d.rows}))});
    const exports=[];
    for(const format of ['json','csv','html']){
      const item=(await action('export-'+format,'export.create',{versionId:afterId,table:'projects',format})).result;
      const returned=await session.app.exported(item.id);assert.equal(sha(returned.bytes),item.sha256);assert.equal(returned.bytes.length,item.bytes);
      await output(item.name,returned.bytes);exports.push(item);
    }
    const sourceExport=(await action('source-export','source.export',{editionId:edition.id})).result;
    const originalExport=await session.app.exported(sourceExport.id),exportedBundle=json(originalExport.bytes);
    await output('OpenFEMA_Original_Source_Edition.json.gz',gzipSync(originalExport.bytes));
    // A second store receives exactly the exported original acquisition with all connector receipts.
    const roundtrip=await openOpenFemaWorkspace({directory:join(directory,'source-roundtrip')});
    try{const same=await roundtrip.capture.importBundle(exportedBundle);assert.equal(same.id,edition.id);assert.equal(same.sourceSha256,edition.sourceSha256);
      equal(same.datasets,edition.datasets);const again=await roundtrip.capture.importBundle(exportedBundle);assert.equal(again.id,same.id);
    }finally{await roundtrip.close();}
    await check('Full source export/import roundtrip and three complete portfolio formats',{editionId:edition.id,exports:exports.map(x=>({id:x.id,format:x.format,bytes:x.bytes,sha256:x.sha256}))});
    // Persist one real partial transfer, close both original listeners, and resume the same original source files.
    const selectionSource=await inspectOpenFemaFiles(fileOptions('source',edition.id));
    const transferDirectory=join(directory,'received','original-source');
    let resumed,localSource;
    if(report.steps.sourceReceiving){
      equal(report.steps.sourceReceiving.manifest,selectionSource.manifest);
      resumed=report.steps.sourceReceiving.resumed;
      localSource=await reopenOpenFemaFiles({directory:transferDirectory,expectedManifestSha256:selectionSource.manifestSha256});
    }else{
      const controller=new AbortController();let paused=null;
      try{await downloadOpenFemaFiles(fileOptions('source',edition.id,{directory:transferDirectory,chunkSize:4096,
        expectedManifestSha256:selectionSource.manifestSha256,signal:controller.signal,
        onProgress:progress=>{if(!paused){paused=progress;controller.abort(fail('RECEIVING_EXPECTED_PAUSE','Resume the same original source transfer after its owner reopens.'));}}}));
        throw fail('RECEIVING_PAUSE_MISSING','The original transfer did not retain its intended partial checkpoint.');
      }catch(error){if(!controller.signal.aborted)throw error;}
      assert.ok(paused);
      await remember('sourcePartial',{manifestSha256:selectionSource.manifestSha256,directory:transferDirectory,progress:paused});
      await stop();await launch(workspace);
      const reopenedBefore=await session.app.version(beforeId),reopenedAfter=await session.app.version(afterId);
      assert.equal(reopenedBefore.record.sha256,before.record.sha256);assert.equal(reopenedAfter.record.sha256,after.record.sha256);
      resumed=await downloadOpenFemaFiles(fileOptions('source',edition.id,{directory:transferDirectory,chunkSize:32768,
        expectedManifestSha256:selectionSource.manifestSha256}));
      assert.equal(resumed.state,'COMPLETE');assert.ok(resumed.resumedBytes>0);
      localSource=await reopenOpenFemaFiles({directory:transferDirectory,expectedManifestSha256:selectionSource.manifestSha256});
      assert.equal(localSource.state,'COMPLETE');
      await remember('sourceReceiving',{resumed,localSource,manifest:selectionSource.manifest});
    }
    const portfolioReceiving=await receive('portfolio',afterId,'reviewed-portfolio');
    const reportReceiving=await receive('export',exports.find(x=>x.format==='html').id,'portfolio-report');
    await remember('fileReceiving',{portfolio:portfolioReceiving,report:reportReceiving});
    await check('Original MCP source transfer resumes after native owner reopen',{files:localSource.files,bytes:localSource.bytes,
      resumedBytes:resumed.resumedBytes,manifestSha256:localSource.manifestSha256});
    const releases=[];
    if(terms){
      for(const [i,dataset]of datasets.entries()){
        const release=(await action('stage-'+i,'release.prepare',{datasetId:dataset.id,origin:terms.origin,path:terms.path,payment:terms.payment})).result;
        const inspected=(await action('staged-inspect-'+i,'release.inspect',{releaseId:release.id})).result;
        assert.equal(inspected.release.digest,release.digest);assert.equal(inspected.release.dataset.baselineSnapshot,dataset.snapshot);releases.push(release);
      }
      const native=await merchantJourney(releases.at(-1).id,'original-seller',{dataset:datasets.at(-1)});await remember('originalPublisher',native);
      await check('Original SF82 staging, selected generation and actual HTTP challenge',{releases:releases.length,releaseId:native.releaseId,mode:native.mode,challengeStatus:native.challengeStatus});
    }else await remember('originalPublisher',{state:'AWAITING_ORIGINAL_TERMS',arguments:['--terms-file','--release-runtime']});
    if(intentIds){
      const inspected=(await action('buyer-inspect','buyer.inspect',{intentIds})).result;
      const received=(await action('buyer-receive','buyer.receive',{intentIds})).result;
      const files=await receive('receipt',received.id,'original-customer');
      assert.equal(files.reopened.files,5);await remember('customer',{inspected,received,files});
      await check('Original completed buyer intents and all five customer files',{receiptId:received.id,intentIds,manifestSha256:received.manifestSha256});
    }else if(!testnet) await remember('customer',{state:'AWAITING_ORIGINAL_INBOX_SELECTION',arguments:['--inbox','--intent-ids-file']});
    await remember('browser',await browserJourney());
    if(report.steps.browser.state==='COMPLETE')await check('Original desktop and mobile operator interface',{sections:7,tables:6});
    const beforeArchive=await session.app.view();
    const savedArchive=join(directory,'artifacts','OpenFEMA_Complete_Workspace.zip');
    const archive=await exists(savedArchive)?{bytes:await readFile(savedArchive)}:await session.app.archive();
    const inspected=inspectWorkspaceArchive(archive.bytes);
    assert.equal(inspected.manifest.workspaceId,workspaceId);
    equal(inspected.state.portfolioVersions.map(v=>[v.id,v.sha256]),beforeArchive.versions.map(v=>[v.id,v.sha256]));
    const archiveOutput=await output('OpenFEMA_Complete_Workspace.zip',archive.bytes);
    await remember('archive',{...archiveOutput,workspaceId,manifestSha256:inspected.manifestSha256,revision:inspected.manifest.revision});
    await output('OpenFEMA_Workspace_Manifest.json',bytes(inspected.manifest));
    await stop();
    const cliView=await childJSON([join(sourceDirectory,'cli.mjs'),'view','--workspace',workspace],
      {directory:sourceRoot,output:join(directory,'artifacts','cli-original-view')});
    assert.equal(cliView.workspaceId,workspaceId);assert.equal(cliView.selectedVersionId,afterId);
    const cliInspect=await childJSON([join(sourceDirectory,'cli.mjs'),'inspect-backup','--archive',archiveOutput.path],
      {directory:sourceRoot,output:join(directory,'artifacts','cli-inspect-backup')});
    assert.equal(cliInspect.archiveSha256,inspected.archiveSha256);
    const restored=await restoreWorkspaceArchive({bytes:archive.bytes,directory:restoredDirectory});
    const repeatedRestore=await restoreWorkspaceArchive({bytes:archive.bytes,directory:restoredDirectory});
    assert.equal(repeatedRestore.reused,true);assert.equal(restored.workspaceId,workspaceId);
    assert.equal(restored.releaseMappings.length,releases.length);
    await launch(restoredDirectory);
    const restoredView=await session.app.view();assert.equal(restoredView.workspaceId,workspaceId);assert.equal(restoredView.restoredFrom.complete,true);
    equal(restoredView.versions.map(v=>[v.id,v.sha256]),beforeArchive.versions.map(v=>[v.id,v.sha256]));
    equal(restoredView.reviews,beforeArchive.reviews);equal(restoredView.acceptances,beforeArchive.acceptances);
    assert.equal((await session.app.version(afterId)).record.sha256,after.record.sha256);
    for(const dataset of datasets){const query=(await action('restored-query-'+dataset.id,'dataset.query',{datasetId:dataset.id,query:'limit=250'})).result;
      assert.equal(query.dataset.snapshot,dataset.snapshot);assert.equal(query.rows.length,195);}
    for(const mapping of restored.releaseMappings){
      const old=restoredView.releases.find(r=>r.id===mapping.fromReleaseId),next=restoredView.releases.find(r=>r.id===mapping.toReleaseId);
      assert.ok(old&&next);assert.equal(old.digest,mapping.fromDigest);assert.equal(next.digest,mapping.toDigest);
      assert.equal(next.restoredFromReleaseId,old.id);assert.equal(next.snapshot,old.snapshot);
      assert.equal(next.dataset.datasetDirectory,join(restoredDirectory,next.relativePublisherDirectory,'dataset'));
      const inspection=(await action('restored-inspect-'+next.id,'release.inspect',{releaseId:next.id})).result;
      assert.equal(inspection.release.digest,next.digest);
      const nativeTerms=await session.app.releaseTerms(next.id);equal({origin:nativeTerms.origin,path:nativeTerms.path,payment:nativeTerms.payment},terms);
      const oldPrefix=old.relativePublisherDirectory+'/releases/releases/'+old.id+'/';
      for(const item of inspected.manifest.files.filter(x=>x.path.startsWith(oldPrefix)))
        assert.equal(sha(await readFile(join(restoredDirectory,item.path))),item.sha256,'Historical native release bytes changed.');
    }
    if(restored.releaseMappings.length){
      const selectedMapping=restored.releaseMappings.find(x=>x.fromReleaseId===releases.at(-1).id);
      await remember('restoredPublisher',await merchantJourney(selectedMapping.toReleaseId,'restored-seller'));
    }
    const restoredFiles=await receive('portfolio',afterId,'restored-reviewed-portfolio');
    assert.equal(restoredFiles.manifestSha256,portfolioReceiving.manifestSha256);
    await remember('restoration',{...restored,sourceArchive:archiveOutput,originalRevision:inspected.manifest.revision,
      reopenedRevision:restoredView.revision,originalVersionHashes:beforeArchive.versions.map(v=>({id:v.id,sha256:v.sha256})),
      retainedOldReleaseHashes:releases.map(r=>({id:r.id,digest:r.digest})),restoredPortfolioTransfer:restoredFiles.reopened});
    await check('Complete workspace ZIP relocation, all native releases and exact retained reopen',{workspaceId,
      archiveSha256:inspected.archiveSha256,files:inspected.manifest.files.length,releaseMappings:restored.releaseMappings.length,
      publisherRelocations:restored.nativePublisherRelocations?.length??0});
    await stop();
    const cliRestored=await childJSON([join(sourceDirectory,'cli.mjs'),'rows','--workspace',restoredDirectory,
      '--version',afterId,'--table','projects','--limit','1000'],{directory:sourceRoot,output:join(directory,'artifacts','cli-restored-projects')});
    assert.equal(cliRestored.total,195);assert.equal(cliRestored.rows.length,195);
    report.state='COMPLETE';report.completedAt=now();report.summary={workspaceId,editionId:edition.id,sourceSha256:edition.sourceSha256,
      counts:sourceCounts,originalTotals:ORIGINAL_TOTALS,portfolioId,beforeVersionId:beforeId,afterVersionId:afterId,
      nativeDatasets:datasets.length,nativeReleases:releases.length,restoredReleases:restored.releaseMappings.length,
      mcpTools:originalTools.length,receivedOriginalFiles:localSource.files,archiveSha256:inspected.archiveSha256,
      browser:report.steps.browser.state,customer:report.steps.customer?.received?.id??null};
    await privateFile(reportFile,bytes(report));
    console.log(JSON.stringify({operation:OPERATION,state:'COMPLETE',report:reportFile,...report.summary}));return report;
  }catch(error){
    report.state='FAILED';report.failedAt=now();report.error={code:error.code??error.name,message:error.message,stack:error.stack};
    await privateFile(reportFile,bytes(report)).catch(()=>{});
    console.error(JSON.stringify({operation:OPERATION,state:'FAILED',report:reportFile,error:report.error}));
    throw error;
  }finally{
    if(browser)await browser.close().catch(()=>{});
    await stop();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(()=>{process.exitCode=1;});
export {main};
