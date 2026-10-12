#!/usr/bin/env node
// MIT. One complete Comic Relief portfolio customer journey over original native packets.
import assert from 'node:assert/strict';
import {open,readFile,mkdir,rename,link,unlink,lstat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

const OPERATION='scf-grant-portfolio-comic-relief-9b23-20261012';
const SCHEMA='stellar-forge.comic-relief-portfolio-journey.v1';
const SDK_PATH='stellar/scf-starforge-20261009/sf30-seller-sdk';
const TABLES=['entities','financial','links','decisions','candidates','changes','sources'];
const options=new Map();
for(let index=2;index<process.argv.length;index+=2){
  const key=process.argv[index],value=process.argv[index+1];
  assert(['--sdk','--native-inputs','--prepared','--output','--python','--chromium','--playwright-module','--source-commit'].includes(key)&&
    value&&!options.has(key),'Use the complete declared original job arguments.');
  options.set(key,value);
}
for(const key of ['--sdk','--native-inputs','--prepared','--output','--chromium','--playwright-module'])
  assert(options.has(key),'Missing '+key+' for the full original customer operation.');
const sdk=await realpath(resolve(options.get('--sdk'))),repo=resolve(sdk,'../../..');
assert.equal(join(repo,SDK_PATH),sdk,'Select the original complete repository source layout.');
const folder=resolve(options.get('--output')),privateRoot=join(folder,'private');
await mkdir(folder,{recursive:true,mode:0o700});await mkdir(privateRoot,{mode:0o700,recursive:true});
const python=options.get('--python')||process.env.SF30_GRANT_PORTFOLIO_PYTHON||'python3';
const environment={...process.env,PYTHONDONTWRITEBYTECODE:'1',SF30_XML_NODE:process.execPath,
  SF30_NDJSON_NODE:process.execPath,SF30_GRANT_PORTFOLIO_NODE:process.execPath};
const canonical=value=>{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
};
const encoded=value=>Buffer.from(JSON.stringify(canonical(value))+'\n');
const sha=data=>createHash('sha256').update(data).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
async function info(path){
  const before=await lstat(path);assert(before.isFile()&&!before.isSymbolicLink());
  const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);
  const after=await lstat(path);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);
  return {path:resolve(path),bytes:before.size,sha256:h.digest('hex')};
}
async function save(path,value,immutable=false){
  const bytes=Buffer.isBuffer(value)?value:encoded(value);
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  if(immutable&&await exists(path)){assert.deepEqual(await readFile(path),bytes,'Original saved input/output changed: '+path);return;}
  const pending=path+'.pending-'+randomUUID(),handle=await open(pending,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{
    if(immutable)await link(pending,path).catch(async error=>{
      if(error.code!=='EEXIST')throw error;assert.deepEqual(await readFile(path),bytes);
    });else await rename(pending,path);
    const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await unlink(pending).catch(()=>{});}
}
const inputsPath=resolve(options.get('--native-inputs')),preparedPath=resolve(options.get('--prepared'));
const inputs=await json(inputsPath),prepared=await json(preparedPath);
assert.equal(inputs.schema,'stellar-forge.comic-relief-native-inputs.v1');
assert.equal(inputs.operationId,OPERATION);assert.equal(inputs.nativeReceiving,'complete');
assert.equal(prepared.operationId,OPERATION);
assert.equal(inputs.binding.preparedSha256,(await info(preparedPath)).sha256);
assert.equal(inputs.sources.length,3);
for(const source of inputs.sources){
  const actual=await info(source.handoff.path);assert.equal(actual.sha256,source.handoff.sha256);
  assert.equal(actual.bytes,source.handoff.bytes);
}
const originalBinding={operationId:OPERATION,inputsSha256:(await info(inputsPath)).sha256,
  preparedSha256:inputs.binding.preparedSha256,sdk,
  selectedSourceCommit:options.get('--source-commit')||null};
await save(join(folder,'input-binding.json'),originalBinding,true);
const journalPath=join(folder,'product-journal.json');
let journal=await exists(journalPath)?await json(journalPath):{
  schema:SCHEMA,operationId:OPERATION,runId:randomUUID(),startedAt:new Date().toISOString(),
  binding:originalBinding,state:'RUNNING',phases:{},refs:{},resources:{closed:false}};
assert.deepEqual(journal.binding,originalBinding);
const checkpoint=()=>save(journalPath,journal);
await checkpoint();
const heartbeat=setInterval(()=>process.stdout.write(JSON.stringify({
  operationId:OPERATION,state:journal.state,phase:journal.activePhase||null,
  completedPhases:Object.keys(journal.phases).length})+'\n'),30000);
heartbeat.unref();
const children=new Set();let merchant,mcp,browser;
const consoles=new Map(),privateValues=new Set();
const safeMessage=error=>{
  let value=String(error?.message??error);
  for(const secret of [...privateValues].sort((a,b)=>b.length-a.length))if(secret)value=value.split(secret).join('[private connection]');
  return value.replace(/(https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/?)#[A-Za-z0-9_-]+/g,'$1#[private connection]');
};
async function processRun(command,args,{maximum=16*1024*1024,env=environment}={}){
  const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],env});children.add(child);
  const output=[],errors=[];let size=0,errorSize=0;
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>maximum)child.kill('SIGTERM');else output.push(chunk);});
  child.stderr.on('data',chunk=>{errorSize+=chunk.length;if(errorSize<=32768)errors.push(chunk);});
  try{
    const code=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',accept);});
    assert(size<=maximum,'The complete native reply exceeded the selected receiving limit.');
    if(code!==0)throw new Error('Original child exited '+code+': '+Buffer.concat(errors).toString().slice(-12000)+
      '\n'+Buffer.concat(output).toString().slice(-12000));
    return Buffer.concat(output);
  }finally{children.delete(child);}
}
const cli=(directory,args)=>processRun(process.execPath,[join(sdk,'grant-portfolio/cli.mjs'),
  '--python',python,'--workspace',directory,...args]).then(bytes=>JSON.parse(bytes));
const nativeImport=path=>import(pathToFileURL(path).href);
const {connectGrantPortfolio}=await nativeImport(join(sdk,'grant-portfolio/client.mjs'));
const {initializeGrantPortfolioMerchant}=await nativeImport(join(sdk,'grant-portfolio/merchant.mjs'));
const {downloadGrantPortfolioExport,receiveGrantPortfolioExport,inspectGrantPortfolioExport}=
  await nativeImport(join(sdk,'grant-portfolio/merchant-receiving.mjs'));
async function stopConsole(role){
  const current=consoles.get(role);if(!current)return;
  await current.client.dispose();
  if(current.child.exitCode===null&&current.child.signalCode===null)current.child.kill('SIGTERM');
  const code=await current.exit;consoles.delete(role);children.delete(current.child);
  assert(code===0||code===null,'The original console did not close cleanly.');
}
async function startConsole(role){
  if(consoles.has(role))return consoles.get(role).client;
  const directory=join(folder,'workspaces',role);
  await mkdir(dirname(directory),{recursive:true,mode:0o700});
  if(!await exists(join(directory,'workspace.json')))await cli(directory,['init']);
  const binding=await cli(directory,['binding']);
  if(journal.refs.workspaceIds?.[role])assert.equal(binding.workspaceId,journal.refs.workspaceIds[role]);
  else{journal.refs.workspaceIds??={};journal.refs.workspaceIds[role]=binding.workspaceId;await checkpoint();}
  const connection=join(privateRoot,role+'-'+randomUUID()+'.json');
  const selectedPort=journal.refs.ports?.[role]??0;
  const child=spawn(process.execPath,[join(sdk,'grant-portfolio/cli.mjs'),'--python',python,
    '--workspace',directory,'serve','--port',String(selectedPort),'--connection-file',connection,
    '--expected-binding',binding.sha256,'--startup-format','json'],{stdio:['ignore','pipe','pipe'],env:environment});
  children.add(child);
  let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-12000);});
  const exit=new Promise((accept,reject)=>{child.once('error',reject);child.once('exit',accept);});
  const lines=createInterface({input:child.stdout});
  let timer;
  try{
    const ready=await Promise.race([
      new Promise((accept,reject)=>{
        lines.on('line',line=>{try{
          const value=JSON.parse(line);
          if(value.schema==='stellar-forge.grant-portfolio-workspace-launch.v1')accept(value);
          else if(value.schema?.endsWith('.error'))reject(new Error(value.code+': '+value.message));
        }catch(error){if(error instanceof SyntaxError)return;reject(error);}});
      }),
      exit.then(code=>{throw new Error('Original console stopped before ready: '+code+' '+stderr);}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Original console did not announce readiness.')),90000);}),
    ]);
    clearTimeout(timer);
    privateValues.add(ready.console);privateValues.add(new URL(ready.console).hash.slice(1));
    assert.equal(ready.workspaceId,binding.workspaceId);assert.equal(ready.bindingSha256,binding.sha256);
    const client=await connectGrantPortfolio({consoleUrlFile:connection,timeoutMs:900000});
    assert.deepEqual(await client.launch(),ready);
    const state=await client.state();assert.equal(state.workspaceId,binding.workspaceId);
    journal.refs.ports??={};journal.refs.ports[role]=Number(new URL(ready.console).port);
    journal.refs.launches??={};journal.refs.launches[role]={workspaceId:state.workspaceId,bindingSha256:binding.sha256,
      sourceFiles:Object.keys(binding.source).length,python:binding.python,pid:ready.pid,port:journal.refs.ports[role]};
    environment[role==='source'?'GRANT_PORTFOLIO_SOURCE_URL':'GRANT_PORTFOLIO_'+role.toUpperCase()+'_URL']=ready.console;
    consoles.set(role,{client,child,exit,ready,directory,connection});await checkpoint();return client;
  }catch(error){clearTimeout(timer);child.kill('SIGTERM');await exit.catch(()=>{});children.delete(child);throw error;}
  finally{lines.close();}
}
async function stage(name,fn){
  if(journal.phases[name])return journal.phases[name].result;
  journal.activePhase=name;journal.state='RUNNING';await checkpoint();
  const result=await fn();
  journal.phases[name]={completedAt:new Date().toISOString(),result};delete journal.activePhase;await checkpoint();
  process.stdout.write(JSON.stringify({operationId:OPERATION,completed:name})+'\n');return result;
}
async function originalAction(client,key,action,payload,{send}={}){
  const selected=join(folder,'actions',key+'.input.json');
  let input;
  if(await exists(selected))input=await json(selected);
  else{
    input={operationId:'portfolio-'+journal.runId+'-'+key,action,payload:await payload(),
      expectedRevision:(await client.state()).revision};
    await save(selected,input,true);
  }
  assert.equal(input.action,action);
  let request;
  try{request=await client.request(input.operationId);}catch(error){
    if(error.status!==404)throw error;
    request=send?await send(input):await client.action(input);
  }
  if(request.state==='FAILED'){
    assert(request.error?.retryable===true,'Original action needs its exact source correction: '+JSON.stringify(request.error));
    request=await client.resume(input.operationId);
  }
  if(request.state==='RUNNING')request=await client.wait(input.operationId,{timeoutMs:3600000,pollMs:1000});
  assert.equal(request.state,'COMPLETED',JSON.stringify(request.error));
  await save(join(folder,'actions',key+'.result.json'),request,true);
  return request;
}
async function rows(client,portfolio,table){
  const all=[],digest=createHash('sha256');let pages=0;
  for await(const page of client.pages({portfolioId:portfolio.id,revision:portfolio.revision,table,limit:25})){
    assert.equal(page.snapshot,portfolio.snapshot);pages++;
    for(const row of page.rows){all.push(row);digest.update(encoded(row));}
  }
  assert.equal(all.length,portfolio.counts[table],table+' count');
  assert.equal(digest.digest('hex'),portfolio.tableSha256[table],table+' complete bytes');
  return {all,pages};
}
const ref=row=>({sourceId:row.sourceId,entityKey:row.entityKey,sha256:row.sha256});
async function startMerchant(){
  const {startMerchantMcp}=await nativeImport(join(repo,'stellar-forge/mcp-merchant-operator/serve.mjs'));
  const {openMerchantFileClient}=await nativeImport(join(repo,'stellar-forge/mcp-merchant-operator/retained-download.mjs'));
  const tokenPath=join(privateRoot,'merchant-token');
  if(!await exists(tokenPath))await save(tokenPath,Buffer.from(randomBytes(32).toString('base64url')),true);
  environment.GRANT_PORTFOLIO_MCP_TOKEN=(await readFile(tokenPath,'utf8')).trim();
  privateValues.add(environment.GRANT_PORTFOLIO_MCP_TOKEN);
  const connection=join(privateRoot,'merchant-connection.json');
  const files=Object.fromEntries(inputs.sources.map((source,index)=>['source-'+index,
    {path:source.handoff.path,sha256:source.handoff.sha256,label:source.key}]));
  await save(connection,{schema:'stellar-forge.grant-portfolio-connection.v1',workspaces:{
    portfolio:{workspaceId:journal.refs.workspaceIds.source,label:'Comic Relief original portfolio',
      consoleUrlEnv:'GRANT_PORTFOLIO_SOURCE_URL',files},
    receiver:{workspaceId:journal.refs.workspaceIds.receiver,label:'Original customer receiver',
      consoleUrlEnv:'GRANT_PORTFOLIO_RECEIVER_URL'},
  }},true);
  if(!journal.refs.merchantDirectory){
    // A bootstrap that never published a configuration owns no accepted merchant request.
    const directory=join(privateRoot,'merchant-'+randomUUID());
    const value=await initializeGrantPortfolioMerchant({directory,connection,name:'Comic Relief grant portfolio'});
    journal.refs.merchantDirectory=directory;journal.refs.merchantConfiguration=value.configuration;await checkpoint();
  }
  merchant=await startMerchantMcp({configPath:journal.refs.merchantConfiguration,
    port:journal.refs.merchantPort??0,tokenEnv:'GRANT_PORTFOLIO_MCP_TOKEN',environment});
  journal.refs.merchantPort=Number(new URL(merchant.url).port);await checkpoint();
  mcp=await openMerchantFileClient({url:merchant.url,tokenEnv:'GRANT_PORTFOLIO_MCP_TOKEN',environment,
    errorPrefix:'GRANT_PORTFOLIO',clientName:'comic-relief-original-portfolio',maximumResponseBytes:128*1024*1024});
  assert((await mcp.call('merchant_grant_portfolio_workspaces',{})).workspaces.some(x=>x.workspaceId===journal.refs.workspaceIds.source));
}
const tool=(name,args)=>mcp.call('merchant_grant_portfolio_'+name,args);
async function nativeFinancialRows(){
  const root=dirname(inputsPath),all=new Map();
  for(const source of inputs.sources){
    if(source.kind==='iati'){
      for(const collection of ['transactions','budgets']){
        const data=await json(join(root,'iati-'+collection+'-native-rows.json'));
        assert.equal(data.rowCount,data.rows.length);
        for(const row of data.rows)all.set(source.key+':'+collection+':'+row.row_id,row);
      }
    }else{
      const data=await json(join(root,source.key,'native-rows.json'));
      assert.equal(data.rowCount,source.grantCount);
      for(const row of data.rows)all.set(source.key+':grant:'+row.grant_id,row);
    }
  }
  return all;
}
function exactDecimal(value){
  const match=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);
  assert(match,'Keep the native decimal text.');
  let scale=(match[3]||'').length-Number(match[4]||0);
  assert(Number.isSafeInteger(scale)&&Math.abs(scale)<=10000,'Original decimal scale exceeds this receiving operation.');
  let integer=BigInt((match[1]==='-'?'-':'')+match[2]+(match[3]||''));
  if(scale<0){integer*=10n**BigInt(-scale);scale=0;}
  while(scale>0&&integer%10n===0n){integer/=10n;scale--;}
  return {integer,scale};
}
function decimalAdd(left,right){
  const scale=Math.max(left.scale,right.scale);
  return {integer:left.integer*10n**BigInt(scale-left.scale)+right.integer*10n**BigInt(scale-right.scale),scale};
}
function decimalEqual(left,right){
  const scale=Math.max(left.scale,right.scale);
  return left.integer*10n**BigInt(scale-left.scale)===right.integer*10n**BigInt(scale-right.scale);
}
async function financialReceiving(client,portfolio){
  const native=await nativeFinancialRows(),selectedSources=Object.fromEntries(
    Object.entries(journal.refs.sources).map(([key,value])=>[value.id,inputs.sources.find(s=>s.key===key)]));
  const {all,pages}=await rows(client,portfolio,'financial');
  const groups=new Map();
  let expected=0;
  for(const source of inputs.sources)if(portfolio.sources.includes(journal.refs.sources[source.key].id))
    expected+=source.kind==='iati'?source.report.counts.transactions+source.report.counts.budgets:source.grantCount*2;
  assert.equal(all.length,expected);
  for(const row of all){
    const source=selectedSources[row.sourceId];assert(source);
    const original=native.get(source.key+':'+(source.kind==='iati'?row.kind:'grant')+':'+row.originalId);assert(original);
    if(source.kind==='iati'){
      assert.deepEqual(row.original,original);
      assert.equal(row.value,original.value_decimal||null);assert.equal(row.eligible,original.financial_eligible==='true');
    }else{
      assert.equal(row.original.original_grant,original.original_grant);
      const field=row.kind==='award'?'amount_awarded':'amount_applied_for';
      assert.equal(row.value,original[field]===''?null:original[field]);assert.equal(row.currency,original.currency);
    }
    const dimensions={sourceId:row.sourceId,standard:row.standard,kind:row.kind,...row.dimensions};
    const key=sha(encoded(dimensions)),group=groups.get(key)||{dimensions,amount:{integer:0n,scale:0},included:0,excluded:0,missing:0};
    if(row.value===null||row.value==='')group.missing++;
    if(row.eligible&&row.value!==null&&row.value!==''){group.amount=decimalAdd(group.amount,exactDecimal(row.value));group.included++;}
    else group.excluded++;
    groups.set(key,group);
  }
  assert.equal(groups.size,portfolio.financialTotals.length);
  for(const total of portfolio.financialTotals){
    const actual=groups.get(total.id);assert(actual);assert.deepEqual(total.dimensions,actual.dimensions);
    assert.equal(total.includedRecords,actual.included);assert.equal(total.excludedRecords,actual.excluded);
    assert.equal(total.missingRecords,actual.missing);
    if(actual.included)assert(decimalEqual(exactDecimal(total.amount),actual.amount));else assert.equal(total.amount,null);
  }
  return {records:all.length,pages,groups:groups.size,originalNativeValuesMatched:true,exactDecimalGroupsMatched:true};
}
async function archiveFacts(path){
  const code=[
    'import sys,json,zipfile,hashlib',
    'with zipfile.ZipFile(sys.argv[1]) as z:',
    ' m=json.loads(z.read("manifest.json")); h=json.loads(z.read("history.json")); r=json.loads(z.read("requests.json"))',
    ' print(json.dumps({"manifest":m,"history":h,"requests":r,"historySha256":hashlib.sha256(z.read("history.json")).hexdigest()}))',
  ].join('\n');
  return JSON.parse(await processRun(python,['-B','-c',code,path],{maximum:128*1024*1024}));
}
async function browserReceiving(client,portfolio){
  const require=createRequire(import.meta.url);
  const {chromium}=require(resolve(options.get('--playwright-module')));
  const temp=join(privateRoot,'browser-tmp');await mkdir(temp,{recursive:true,mode:0o700});
  browser=await chromium.launch({executablePath:resolve(options.get('--chromium')),headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage'],env:{...environment,TMPDIR:temp}});
  const page=await browser.newPage({viewport:{width:1360,height:940}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(consoles.get('source').ready.console);
  await page.waitForFunction(()=>document.querySelector('#connection')?.textContent.includes('3 source editions'));
  await page.selectOption('#portfolio-select',portfolio.id);
  await page.waitForFunction(name=>[...document.querySelectorAll('label.field')].some(label=>
    label.querySelector('span')?.textContent==='Portfolio name'&&label.querySelector('input')?.value===name),portfolio.name);
  journal.refs.browserIntent??={baseRevision:portfolio.revision,
    notes:portfolio.notes+'\nOperator receiving: '+journal.runId};await checkpoint();
  const intent=journal.refs.browserIntent;
  const current=(await client.state()).portfolios.find(row=>row.id===portfolio.id);
  let actual=await client.portfolio(portfolio.id,{revision:current.revision});
  if(actual.notes!==intent.notes){
    assert.equal(actual.revision,intent.baseRevision,'Reopen the actual original browser edit before adding another.');
    await page.getByLabel('Portfolio scope and notes',{exact:true}).fill(intent.notes);
    await page.getByRole('button',{name:'Save revision',exact:true}).click();
    await page.waitForFunction(expected=>document.querySelector('#revision-select')?.value===String(expected),intent.baseRevision+1);
    actual=await client.portfolio(portfolio.id,{revision:intent.baseRevision+1});
  }
  assert.equal(actual.notes,intent.notes);
  await page.screenshot({path:join(folder,'portfolio-desktop.png'),fullPage:true});
  await page.locator('nav button[data-view="review"]').click();
  await page.getByRole('heading',{name:'Review records',exact:true}).waitFor();
  const filtered=await client.rows({portfolioId:actual.id,revision:actual.revision,table:'entities',
    search:prepared.coverage.organisationId,standard:'360giving',limit:50});
  assert(filtered.total>0);
  const filterReply=page.waitForResponse(reply=>{
    const selected=new URL(reply.url());
    return selected.pathname==='/api/rows'&&selected.searchParams.get('search')===prepared.coverage.organisationId&&
      selected.searchParams.get('standard')==='360giving'&&selected.searchParams.get('table')==='entities';
  });
  await page.getByPlaceholder('Search records',{exact:true}).fill(prepared.coverage.organisationId);
  await page.locator('.toolbar select').last().selectOption('360giving');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  const response=await filterReply;assert.equal(response.status(),200);
  assert.deepEqual(await response.json(),filtered);
  await page.waitForFunction(total=>document.querySelector('.pager')?.textContent.includes(' of '+total),filtered.total);
  await page.locator('nav button[data-view="ledger"]').click();
  await page.getByRole('heading',{name:'Financial ledger',exact:true}).waitFor();
  await page.getByRole('button',{name:'Open record',exact:true}).first().click();
  await page.locator('#detail-dialog[open]').waitFor();
  assert((await page.locator('#detail-content pre').first().textContent()).length>20);
  await page.locator('#close-detail').click();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:join(folder,'portfolio-mobile.png'),fullPage:true});
  await page.locator('nav button[data-view="history"]').click();
  await page.getByRole('heading',{name:'Revision history',exact:true}).waitFor();
  await page.selectOption('#revision-select','1');
  await page.waitForFunction(()=>document.querySelector('#content')?.textContent.includes('Revision 1'));
  assert.deepEqual(errors,[]);
  await browser.close();browser=null;
  return {portfolioId:actual.id,revision:actual.revision,snapshot:actual.snapshot,
    originalOperationId:actual.operationId,desktop:await info(join(folder,'portfolio-desktop.png')),
    mobile:await info(join(folder,'portfolio-mobile.png')),filteredRecords:filtered.total,pageErrors:errors};
}
async function cleanup(){
  if(browser){await browser.close();browser=null;}
  if(merchant){await merchant.close();merchant=null;mcp=null;}
  for(const role of [...consoles.keys()].reverse())await stopConsole(role);
  for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
}
try{
  if(journal.state==='COMPLETED'){
    const final=await info(journal.refs.customerFile.path);
    assert.equal(final.sha256,journal.refs.customerFile.sha256);assert.equal(final.bytes,journal.refs.customerFile.bytes);
    process.stdout.write(JSON.stringify({operationId:OPERATION,state:journal.state,result:join(folder,'product-result.json')})+'\n');
  }else{
    await stage('original-source-and-native-input-binding',async()=>{
      const manifest=await json(join(sdk,'grant-portfolio/source-files.json')),files=[];
      for(const path of manifest.files){const bytes=await readFile(join(sdk,path));files.push({path,bytes:bytes.length,
        sha256:sha(bytes),gitBlob:createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')});}
      const selected={schema:'stellar-forge.grant-portfolio-executed-source.v1',
        selectedSourceCommit:originalBinding.selectedSourceCommit,node:process.version,python,sdk,files};
      await save(join(folder,'executed-source.json'),selected,true);
      return {files:files.length,sourceSha256:sha(encoded(files)),packets:inputs.sources.map(x=>x.handoff)};
    });
    const client=await startConsole('source');
    await startConsole('receiver');await startMerchant();
    await stage('three-original-native-source-editions',async()=>{
      journal.refs.sources??={};
      for(let index=0;index<inputs.sources.length;index++){
        const input=inputs.sources[index],original=prepared.sources.find(x=>x.key===input.key);assert(original);
        const uploaded=(await tool('upload',{workspace:'portfolio',file:'source-'+index})).native;
        assert.equal(uploaded.sha256,input.handoff.sha256);
        const result=await originalAction(client,'source-'+index,'source.receive',async()=>({
          object:uploaded.sha256,standard:input.kind,label:original.label,
          coverage:{statement:(input.kind==='iati'?prepared.coverage.iati:prepared.coverage.giving)+' '+prepared.coverage.comparison,
            sourceUrl:original.sourceUrl,observedAt:journal.startedAt,license:prepared.coverage.licence},
          selection:input.kind==='iati'?{portfolioId:input.portfolioId,revision:input.revision}:{build:'original'},
        }));
        journal.refs.sources[input.key]={id:result.result.id,kind:input.kind,packetSha256:uploaded.sha256,
          counts:result.result.counts};await checkpoint();
      }
      assert.equal((await client.state()).sources.length,3);
      return journal.refs.sources;
    });
    const iati=inputs.sources.find(x=>x.kind==='iati'),earlier=inputs.sources.find(x=>x.key.endsWith('2015-2022')),
      following=inputs.sources.find(x=>x.key.endsWith('2022-2026'));assert(iati&&earlier&&following);
    await stage('saved-initial-portfolio-and-source-review',async()=>{
      const created=await originalAction(client,'initial-portfolio','portfolio.save',async()=>({
        name:'Comic Relief IATI and international grants',notes:prepared.coverage.iati+'\n'+prepared.coverage.giving+'\n'+prepared.coverage.comparison,
        sources:[journal.refs.sources[iati.key].id,journal.refs.sources[earlier.key].id],
        review:{status:'draft',reviewer:'9B23 native portfolio operator',note:'Review the declared source cohorts and original record references.'},
      }));
      const initial=created.result;journal.refs.portfolioId=initial.id;await checkpoint();
      const entities=(await rows(client,initial,'entities')).all;
      const a=entities.find(x=>x.kind==='organization'&&x.standard==='iati'&&x.originalId===prepared.coverage.organisationId);
      const b=entities.find(x=>x.kind==='organization'&&x.standard==='360giving'&&x.originalId===prepared.coverage.organisationId);
      const coverage=entities.find(x=>x.kind==='grant');assert(a&&b&&coverage,'Use the actual shared published organization identifier.');
      const decision=await originalAction(client,'original-review','review.save',async()=>({
        portfolioId:initial.id,expectedPortfolioRevision:initial.revision,reviewer:'9B23 native portfolio operator',
        decisions:[
          {type:'link',left:ref(a),right:ref(b),relation:'same-organization',disposition:'confirmed',
            rationale:'Both original publisher records identify Comic Relief as '+prepared.coverage.organisationId+'.'},
          {type:'record',record:ref(coverage),disposition:'coverage-only',
            rationale:'Retain this grant under its declared International 2015–2022 cohort for cross-standard reconciliation. '+prepared.coverage.comparison},
        ],
      }),{send:async input=>(await tool('action',{workspace:'portfolio',...input})).native});
      assert.equal(decision.result.counts.links,1);
      const repeated=(await tool('action',{workspace:'portfolio',...await json(join(folder,'actions/original-review.input.json'))})).native;
      assert.deepEqual(repeated,decision);
      journal.refs.reviewedRevision=decision.result.revision;await checkpoint();
      return {id:initial.id,initialRevision:initial.revision,reviewedRevision:decision.result.revision,
        decisions:decision.result.decisions.map(x=>({id:x.id,status:x.status,type:x.type}))};
    });
    await stage('following-coverage-revision',async()=>{
      const previous=await client.portfolio(journal.refs.portfolioId,{revision:journal.refs.reviewedRevision});
      const request=await originalAction(client,'following-coverage','portfolio.save',async()=>({
        id:previous.id,expectedPortfolioRevision:previous.revision,name:previous.name,notes:previous.notes,
        sources:[...previous.sources,journal.refs.sources[following.key].id],sourceReplacements:[],
        review:{status:'reviewed',reviewer:'9B23 native portfolio operator',
          note:'Added the distinct International 2022–2026 fund. All original source cohorts and the explicit organization/coverage reviews remain separately visible.'},
      }));
      assert.equal(request.result.sources.length,3);assert.equal(request.result.counts.links,1);
      assert(request.result.decisions.every(x=>x.status==='CURRENT'));
      assert.equal((await client.portfolio(previous.id,{revision:1})).sources.length,2);
      journal.refs.coverageRevision=request.result.revision;await checkpoint();
      return {id:request.result.id,revision:request.result.revision,snapshot:request.result.snapshot};
    });
    await stage('actual-desktop-mobile-operator-save-and-history',async()=>{
      const current=(await client.state()).portfolios.find(x=>x.id===journal.refs.portfolioId);
      const result=await browserReceiving(client,await client.portfolio(current.id,{revision:current.revision}));
      journal.refs.finalRevision=result.revision;await checkpoint();return result;
    });
    const portfolio=await client.portfolio(journal.refs.portfolioId,{revision:journal.refs.finalRevision});
    await stage('complete-native-financial-and-paged-table-receiving',async()=>{
      const tables={};
      for(const table of TABLES){const result=await rows(client,portfolio,table);tables[table]={rows:result.all.length,pages:result.pages};}
      const finances=await financialReceiving(client,portfolio);
      const full=(await tool('rows',{workspace:'portfolio',portfolioId:portfolio.id,revision:portfolio.revision,
        table:'entities',limit:25,expectedSnapshot:portfolio.snapshot})).native;
      assert.equal(full.snapshot,portfolio.snapshot);
      await save(join(folder,'financial-receiving.json'),{portfolioId:portfolio.id,revision:portfolio.revision,
        snapshot:portfolio.snapshot,tables,finances},true);
      return {tables,finances};
    });
    await stage('original-merchant-export-and-repeat-whole-file-receiving',async()=>{
      const request=await originalAction(client,'complete-export','portfolio.export',async()=>({
        portfolioId:portfolio.id,revision:portfolio.revision}));
      const input=await json(join(folder,'actions/complete-export.input.json'));
      if(!journal.refs.exportDescriptor){
        const value=await tool('export',{workspace:'portfolio',operationId:input.operationId,
          portfolioId:portfolio.id,revision:portfolio.revision,expectedRevision:input.expectedRevision});
        assert.equal(value.state,'MANIFEST_RETAINED');assert.equal(value.nativeExport.sha256,request.result.sha256);
        journal.refs.exportDescriptor=value;await checkpoint();
      }
      const selected=journal.refs.exportDescriptor,downloadOptions={url:merchant.url,client:mcp,
        exportId:selected.exportId,expectedManifestSha256:selected.manifestFile.sha256,
        directory:join(folder,'customer'),environment,tokenEnv:'GRANT_PORTFOLIO_MCP_TOKEN'};
      const inspected=await inspectGrantPortfolioExport(downloadOptions);
      assert.equal(inspected.manifest.nativeExport.sha256,request.result.sha256);
      const first=await downloadGrantPortfolioExport(downloadOptions),second=await downloadGrantPortfolioExport(downloadOptions);
      assert.equal(first.manifestSha256,second.manifestSha256);
      journal.refs.customerFile=await info(first.portfolioFile);await checkpoint();
      assert.equal(journal.refs.customerFile.sha256,request.result.sha256);
      return {exportId:selected.exportId,manifestSha256:selected.manifestFile.sha256,
        originalOperationId:input.operationId,file:journal.refs.customerFile};
    });
    await stage('original-customer-import-cold-cli-and-reexport',async()=>{
      let target=consoles.get('receiver').client;
      const targetInput=join(folder,'actions/customer-receive.input.json');
      if(!await exists(targetInput))await save(targetInput,{operationId:'portfolio-'+journal.runId+'-customer-receive',
        expectedRevision:(await target.state()).revision},true);
      const original=await json(targetInput),selected=journal.refs.exportDescriptor;
      const received=await receiveGrantPortfolioExport({target,...original,url:merchant.url,client:mcp,
        exportId:selected.exportId,expectedManifestSha256:selected.manifestFile.sha256,
        directory:join(folder,'customer'),environment,tokenEnv:'GRANT_PORTFOLIO_MCP_TOKEN',waitOptions:{timeoutMs:3600000,pollMs:1000}});
      assert.equal(received.state,'COMPLETED');assert.equal(received.request.result.snapshot,portfolio.snapshot);
      await save(join(folder,'actions/customer-receive.result.json'),received.request,true);
      await stopConsole('receiver');
      const cold=await cli(join(folder,'workspaces/receiver'),['portfolio','--id',portfolio.id,'--revision',String(portfolio.revision)]);
      assert.deepEqual(cold,portfolio);
      const cliOutput=join(folder,'reexport','cli-complete.zip');
      await mkdir(dirname(cliOutput),{recursive:true,mode:0o700});
      const cliSelection=['export','--portfolio-id',portfolio.id,'--revision',String(portfolio.revision),
        '--operation-id','portfolio-'+journal.runId+'-customer-cli-export','--out',cliOutput];
      const cliFirst=await cli(join(folder,'workspaces/receiver'),cliSelection);
      const cliAgain=await cli(join(folder,'workspaces/receiver'),cliSelection);
      assert.deepEqual(cliAgain,cliFirst);assert.equal(cliFirst.state,'COMPLETED');
      const cliFile=await info(cliOutput);assert.equal(cliFile.sha256,cliFirst.result.sha256);
      journal.refs.cliExport=cliFile;await checkpoint();
      target=await startConsole('receiver');
      for(let revision=1;revision<=portfolio.revision;revision++)
        assert.deepEqual(await target.portfolio(portfolio.id,{revision}),await client.portfolio(portfolio.id,{revision}));
      const exported=await originalAction(target,'customer-reexport','portfolio.export',async()=>({
        portfolioId:portfolio.id,revision:portfolio.revision}));
      await mkdir(join(folder,'reexport'),{mode:0o700,recursive:true});
      const file=await target.downloadExport(exported.result.sha256,join(folder,'reexport','portfolio.zip'),{bytes:exported.result.bytes});
      const before=await archiveFacts(journal.refs.customerFile.path),after=await archiveFacts(file.path);
      assert.equal(before.historySha256,after.historySha256);
      const completeRequests=new Set(after.requests.map(row=>JSON.stringify(canonical(row))));
      assert(before.requests.every(row=>completeRequests.has(JSON.stringify(canonical(row)))),'Keep every original origin-bound request through re-export.');
      for(const [name,expected]of Object.entries(before.manifest.files))if(name.startsWith('sources/')||name.startsWith('rows/'))
        assert.deepEqual(after.manifest.files[name],expected);
      await financialReceiving(target,portfolio);
      journal.refs.reexportFile=file;await checkpoint();
      return {receiverWorkspaceId:received.request.result.workspaceId,revision:portfolio.revision,
        snapshot:portfolio.snapshot,historySha256:after.historySha256,originalRequests:before.requests.length,
        retainedRequests:after.requests.length,reexport:file};
    });
    await stage('second-native-customer-receiving-and-owned-close',async()=>{
      // The saved re-export is received by another original workspace to exercise its retained foreign history.
      const target=await startConsole('second');
      const uploaded=await target.uploadFile(journal.refs.reexportFile.path,{sha256:journal.refs.reexportFile.sha256});
      const received=await originalAction(target,'second-customer-receive','portfolio.receive',async()=>({object:uploaded.sha256}));
      assert.equal(received.result.snapshot,portfolio.snapshot);assert.equal(received.result.historyCount,portfolio.revision);
      assert.deepEqual(await target.portfolio(portfolio.id,{revision:portfolio.revision}),portfolio);
      await stopConsole('second');await stopConsole('receiver');await stopConsole('source');
      const retained=await tool('manifest',{exportId:journal.refs.exportDescriptor.exportId});
      assert.equal(retained.manifestFile.sha256,journal.refs.exportDescriptor.manifestFile.sha256);
      const retainedBytes=await downloadGrantPortfolioExport({url:merchant.url,client:mcp,
        exportId:retained.exportId,expectedManifestSha256:retained.manifestFile.sha256,
        directory:join(folder,'customer'),environment,tokenEnv:'GRANT_PORTFOLIO_MCP_TOKEN'});
      assert.equal((await info(retainedBytes.portfolioFile)).sha256,journal.refs.customerFile.sha256);
      await merchant.close();merchant=null;mcp=null;
      journal.resources={closed:true,consoleProcessesClosed:true,merchantClosed:true,browserClosed:true};
      return {secondWorkspaceId:received.result.workspaceId,historyCount:received.result.historyCount,
        exportReadableAfterSourceClosed:true,resources:journal.resources};
    });
    await cleanup();
    journal.state='COMPLETED';journal.completedAt=new Date().toISOString();delete journal.error;await checkpoint();
    await save(join(folder,'product-result.json'),journal,true);
    process.stdout.write(JSON.stringify({operationId:OPERATION,state:journal.state,phases:Object.keys(journal.phases).length,
      result:join(folder,'product-result.json'),customer:journal.refs.customerFile,reexport:journal.refs.reexportFile,
      resources:journal.resources})+'\n');
  }
}catch(error){
  journal.state='FAILED';journal.error={message:safeMessage(error),code:error.code||null};
  await cleanup().catch(closeError=>{journal.closeError=safeMessage(closeError);});
  await checkpoint();process.stderr.write(JSON.stringify({operationId:OPERATION,state:'FAILED',
    phase:journal.activePhase,error:journal.error,result:journalPath})+'\n');process.exitCode=1;
}finally{clearInterval(heartbeat);}
