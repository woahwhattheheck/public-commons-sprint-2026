#!/usr/bin/env node
// MIT. Receive configured startup through the original merchant entry points.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, copyFile, chmod, symlink, realpath} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomBytes, createHash} from 'node:crypto';
import {parseArgs} from 'node:util';

const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const operatorPath = root => join(root,'stellar-forge/mcp-merchant-operator');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function privateJson(path,value) {
  await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
}
async function timeout(promise,milliseconds,label) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(label+' timed out.')),milliseconds); timer.unref();
  })]); } finally { clearTimeout(timer); }
}
function commandEnvironment() {
  const environment={...process.env};
  // The receiving source is a real isolated copy. Its child entry points can
  // follow ordinary installed-package links without changing their identity.
  delete environment.NODE_OPTIONS;
  return environment;
}
async function subprocess(args,{input,environment=commandEnvironment()}={}) {
  const child=spawn(process.execPath,args,{env:environment,stdio:['pipe','pipe','pipe'],windowsHide:true});
  const output=[],errors=[];
  child.stdout.on('data',value=>output.push(value));child.stderr.on('data',value=>errors.push(value));
  const ended=new Promise((resolveRun,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolveRun({code,signal}));});
  child.stdin.end(input);
  try {
    const result=await timeout(ended,120000,'Original Node command');
    const stdout=Buffer.concat(output).toString('utf8'),stderr=Buffer.concat(errors).toString('utf8');
    if(result.code!==0)throw new Error('Original command exited '+result.code+': '+stderr);
    return {stdout,stderr};
  } finally { if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM'); }
}
async function probe(root,profile) {
  const program = [
    "import {registerHooks} from 'node:module';",
    "import {pathToFileURL} from 'node:url';",
    "const loaded=[];",
    "registerHooks({load(url,context,next){const value=next(url,context);if(url.startsWith('file:'))loaded.push({url,bytes:value.source==null?0:Buffer.byteLength(value.source)});return value;}});",
    "const started=performance.now();",
    "const module=await import(pathToFileURL(process.argv[1]).href);",
    "const imported=performance.now();",
    "const operator=new module.MerchantReleaseOperator({name:'Startup receiving',releaseStore:process.argv[2],exportsDirectory:process.argv[3],sources:{}});",
    "const tools=operator.tools;await operator.close();",
    "console.log(JSON.stringify({node:process.version,importMs:imported-started,totalMs:performance.now()-started,tools:tools.length,completeTools:module.MERCHANT_TOOLS.length,moduleCount:loaded.length,sourceBytes:loaded.reduce((sum,item)=>sum+item.bytes,0),loaded}));",
  ].join('\n');
  const result=await subprocess(['--input-type=module','-e',program,join(operatorPath(root),'operator.mjs'),join(profile,'releases'),join(profile,'exports')]);
  return JSON.parse(result.stdout.trim());
}
async function stdioJourney(args,expectedTools,version) {
  const child=spawn(process.execPath,args,{env:commandEnvironment(),stdio:['pipe','pipe','pipe'],windowsHide:true});
  const errors=[];child.stderr.on('data',value=>errors.push(value));
  const pending=new Map();let sequence=0;
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
    try {
      const value=JSON.parse(line), waiter=pending.get(value.id);
      if(waiter){pending.delete(value.id);waiter.resolve(value);}
    } catch(error) { for(const waiter of pending.values())waiter.reject(error);pending.clear(); }
  });
  const ended=new Promise((resolveRun,reject)=>{
    child.once('error',reject);
    child.once('exit',(code,signal)=>{
      for(const waiter of pending.values())waiter.reject(new Error('Stdio closed before its response.'));
      pending.clear();resolveRun({code,signal});
    });
  });
  async function rpc(method,params={}) {
    const id=++sequence;
    const response=new Promise((resolveReply,reject)=>pending.set(id,{resolve:resolveReply,reject}));
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    return timeout(response,30000,'Original stdio '+method);
  }
  try {
    const initialized=await rpc('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'configured-startup-receiving',version:'1'}});
    assert.equal(initialized.result.serverInfo.name,'starforge-merchant-operator');
    const tools=(await rpc('tools/list')).result.tools;
    assert.deepEqual(tools.map(value=>value.name),expectedTools);
    const call=await rpc('tools/call',{name:'merchant_opensearch_status',arguments:{workspace:'flights'}});
    assert.equal(call.result.isError,false);
    assert.equal(call.result.structuredContent.state,'CLOSED');
    const ping=await rpc('ping');assert.deepEqual(ping.result,{});
    child.stdin.end();
    const result=await timeout(ended,30000,'Original stdio shutdown');
    assert.equal(result.code,0,Buffer.concat(errors).toString('utf8'));
    return {tools:tools.length,workspace:call.result.structuredContent.state,exitCode:result.code};
  } finally {
    lines.close();child.stdin.end();
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
  }
}

export async function receiveConfiguredStartup({directory,source,baseline,exercise=true}={}) {
  directory=resolve(directory);
  await mkdir(directory,{recursive:true,mode:0o700});
  assert.equal(await realpath(directory),directory);
  const report={schema:'stellar-forge.configured-startup-receiving.v1',startedAt:new Date().toISOString(),node:process.version,stages:[]};
  const mark=stage=>{report.stages.push(stage);process.stderr.write('Configured startup: '+stage+' COMPLETE\n');};
  const scoped=await probe(sourceRoot,directory);report.startup=scoped;
  mark('SYNCHRONOUS_SCOPED_CONSTRUCTOR');
  if(baseline)report.baseline=await probe(resolve(baseline),directory);
  const {MERCHANT_TOOLS,MerchantReleaseOperator,openMerchantOperator}=await import('../operator.mjs');
  const {merchantToolFamily}=await import('../catalog.mjs');
  const {initializeOpenSearchWorkspaceMerchant,readMerchantConfig,writePrivate}=await import('../config.mjs');
  const {startMerchantMcp}=await import('../serve.mjs');
  const {MCP_VERSION}=await import('../../mcp-paid-agent/http-tools.mjs');
  assert.equal(MERCHANT_TOOLS.filter(value=>value.name.startsWith('merchant_opensearch_')).length,44);
  assert.equal(MERCHANT_TOOLS.filter(value=>value.name.startsWith('merchant_har_')).length,24);
  assert.equal(merchantToolFamily('merchant_opensearch_status'),'opensearchWorkspaces');
  assert.equal(merchantToolFamily('merchant_s3_status'),'s3Workspaces');
  if(exercise) {
    report.originalExercise=await (await import('../exercise.mjs')).exercise();
    assert.equal(report.originalExercise.result,'PASS');
    mark('ORIGINAL_MERCHANT_HTTP_SELLER_CUSTOMER_EXERCISE');
  }
  const profile=await mkdtemp(join(directory,'configured-'));
  const flightDirectory=join(profile,'flights'),objectDirectory=join(profile,'objects');
  await mkdir(flightDirectory,{mode:0o700});await mkdir(objectDirectory,{mode:0o700});
  const selectedSource=join(profile,'flights-source.json');
  await copyFile(resolve(source),selectedSource);await chmod(selectedSource,0o600);
  const openSearchConnection=join(profile,'opensearch.json'),s3Connection=join(profile,'s3.json');
  await privateJson(openSearchConnection,{schema:'stellar-forge.opensearch-workspace-connection.v1',workspaces:{flights:{directory:flightDirectory,sourceFile:selectedSource}}});
  await privateJson(s3Connection,{schema:'stellar-forge.s3-workspace-connection.v1',workspaces:{objects:{directory:objectDirectory}}});
  const initialized=await initializeOpenSearchWorkspaceMerchant({directory:join(profile,'operator'),connection:openSearchConnection,name:'Configured provider receiving'});
  const raw=JSON.parse(await readFile(initialized.configuration,'utf8'));
  const configuration=join(dirname(initialized.configuration),'merchant-multiple.json');
  raw.s3WorkspaceConnection=s3Connection;await writePrivate(configuration,raw);
  const config=await readMerchantConfig(configuration),operator=new MerchantReleaseOperator(config);
  const expectedTools=operator.tools.map(value=>value.name);
  assert.ok(expectedTools.includes('merchant_opensearch_deployment_adopt_client'));
  assert.ok(expectedTools.includes('merchant_s3_status'));
  assert.ok(!expectedTools.some(name=>name.startsWith('merchant_woo_')||name.startsWith('merchant_har_')||name.startsWith('merchant_tenderly_')));
  assert.equal(operator.maxRequestBytes,2097152);
  const status=await operator.status();
  assert.deepEqual(status.operator.providers.map(value=>value.name).sort(),['clientExports','opensearchWorkspaces','s3Workspaces'].sort());
  assert.equal(status.operator.opensearchWorkspaces.count,1);assert.equal(status.operator.s3Workspaces.count,1);
  report.configured={tools:expectedTools.length,families:status.operator.capabilities.families,providers:status.operator.providers,sourceSha256:digest(await readFile(selectedSource))};
  await operator.close();
  mark('ORIGINAL_CONFIG_READ_AND_PROVIDER_STATUS');
  const concurrent=await openMerchantOperator(configuration);
  const accepted=[concurrent.call('merchant_s3_status',{workspace:'objects'}),
    concurrent.call('merchant_opensearch_status',{workspace:'flights'}),
    concurrent.call('merchant_client_export_list',{limit:1})];
  const closing=concurrent.close(),received=await Promise.all(accepted);
  await closing;
  assert.equal(received[0].state,'CLOSED');assert.equal(received[1].state,'CLOSED');
  assert.deepEqual(received[2].entries,[]);
  await assert.rejects(concurrent.call('merchant_opensearch_status',{workspace:'flights'}),{code:'OPERATOR_CLOSING'});
  report.closeRecovery={acceptedReads:3,completedReads:received.length,closedNewCalls:true};
  mark('MULTI_PROVIDER_READS_DRAIN_DURING_CLOSE');
  const token=randomBytes(32).toString('hex');
  const server=await startMerchantMcp({configPath:configuration,port:0,environment:{MCP_ACCESS_TOKEN:token}});
  let id=0;
  async function rpc(method,params={}) {
    const response=await fetch(server.url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json','mcp-protocol-version':MCP_VERSION},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
    assert.equal(response.status,200);return response.json();
  }
  try {
    const initializedHttp=await rpc('initialize',{protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{name:'configured-startup-receiving',version:'1'}});
    assert.equal(initializedHttp.result.serverInfo.name,'starforge-merchant-operator');
    assert.ok(initializedHttp.result.instructions.includes('OpenSearch'));
    assert.ok(!initializedHttp.result.instructions.includes('For WooCommerce'));
    const tools=(await rpc('tools/list')).result.tools;
    assert.deepEqual(tools.map(value=>value.name),expectedTools);
    const original=await rpc('tools/call',{name:'merchant_s3_status',arguments:{workspace:'objects'}});
    assert.equal(original.result.isError,false);assert.equal(original.result.structuredContent.state,'CLOSED');
    report.http={tools:tools.length,instructionBytes:Buffer.byteLength(initializedHttp.result.instructions),workspace:original.result.structuredContent.state};
  } finally {await server.close();}
  mark('ORIGINAL_HTTP_SCOPED_CATALOG_AND_INSTRUCTIONS');
  report.stdio=await stdioJourney([join(operatorPath(sourceRoot),'stdio.mjs'),'--config',configuration],expectedTools,MCP_VERSION);
  mark('ORIGINAL_MERCHANT_STDIO_AND_OWNED_HOST_SHUTDOWN');
  const binDirectory=join(profile,'node_modules','.bin');await mkdir(binDirectory,{recursive:true,mode:0o700});
  const bin=join(binDirectory,'starforge');
  await symlink(join(sourceRoot,'stellar/scf-starforge-20261009/distribution/cli.mjs'),bin);
  report.distribution=await stdioJourney([bin,'merchant-mcp-stdio','--config',configuration],expectedTools,MCP_VERSION);
  mark('ORIGINAL_DISTRIBUTION_BIN_FORWARDING');
  report.state='COMPLETE';report.completedAt=new Date().toISOString();
  await writeFile(join(directory,'configured-startup-run.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=parseArgs({options:{directory:{type:'string'},source:{type:'string'},baseline:{type:'string'},'skip-exercise':{type:'boolean',default:false}}}).values;
  if(!args.directory||!args.source)throw new Error('Supply --directory and the original --source declaration.');
  const result=await receiveConfiguredStartup({...args,exercise:!args['skip-exercise']});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
