#!/usr/bin/env node
// MIT. One native receiving journey through the original application and MCP transport.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const usage='Use --application-config EXISTING_CONFIG --application-source ORIGINAL_COMPONENT --output PRIVATE_DIRECTORY [--source-root ORIGINAL_SOURCE] [--installed-cli ORIGINAL_NODE_ENTRY] [--resume]';
if(process.argv.slice(2).length===1&&['--help','-h'].includes(process.argv[2])){
  process.stdout.write(usage+'\nThe selected original source owns authorization, transport, provider discovery and CLI.\nAn installed CLI is invoked as a real original mcp-oauth child against the same owned receiving listeners.\n');
  process.exit(0);
}

const options=new Map();
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i];
  if(key==='--resume'&&!options.has(key)){options.set(key,true);continue;}
  const value=process.argv[++i];
  if(!['--application-config','--application-source','--output','--source-root','--installed-cli'].includes(key)||!value||options.has(key))
    throw new TypeError(usage);
  options.set(key,resolve(value));
}
for(const key of ['--application-config','--application-source','--output'])if(!options.has(key))throw new TypeError('Required '+key);
const sourceRoot=await realpath(options.get('--source-root')??resolve(dirname(fileURLToPath(import.meta.url)),'../../..'));
const ownRoot=resolve(sourceRoot,'stellar-forge/mcp-paid-agent');
const selectedRequire=createRequire(resolve(ownRoot,'package.json'));
const {generateKeyPair,exportJWK,SignJWT}=await import(pathToFileURL(selectedRequire.resolve('jose')).href);
const original=leaf=>import(pathToFileURL(resolve(ownRoot,leaf)).href);
const {createMcpToolHandler,MCP_VERSION}=await original('http-tools.mjs');
const {createOAuthResourceAuthorization}=await original('oauth-resource.mjs');
const {loadOAuthResourceHost}=await original('oauth-host.mjs');
const {discoverOAuthResource,probeOAuthResource}=await original('oauth-discovery.mjs');
const {createOAuthOperatorConfiguration,writeNewOAuthJson,main:oauthCli}=await original('oauth-resource-cli.mjs');
const installedCli=options.has('--installed-cli')?await realpath(options.get('--installed-cli')):null;
if(installedCli){
  const selectedEntry=await realpath(resolve(sourceRoot,'stellar/scf-starforge-20261009/distribution/cli.mjs'));
  if(installedCli!==selectedEntry)throw new TypeError('Installed CLI must belong to the selected original source edition');
  const specification=JSON.parse(await readFile(resolve(sourceRoot,'stellar/scf-starforge-20261009/distribution/distribution.json'),'utf8'));
  if(specification.commands?.['mcp-oauth']!=='stellar-forge/mcp-paid-agent/oauth-resource-cli.mjs')
    throw new TypeError('Select an original installed source that declares the mcp-oauth command');
}
const runNode=promisify(execFile);
const output=options.get('--output'),journalPath=resolve(output,'operation.json');
const resuming=options.get('--resume')===true;
if(!resuming)await mkdir(output,{mode:0o700,recursive:false});
const journal=resuming?JSON.parse(await readFile(journalPath,'utf8')):{schema:'stellar-forge.mcp-oauth-native-receiving.v1',operationId:'SCF-MCP-OAUTH-RESOURCE-0C7A-20261012',
  receivingId:randomUUID(),startedAt:new Date().toISOString(),pid:process.pid,completed:false,steps:[],requests:[]};
if(journal.operationId!=='SCF-MCP-OAUTH-RESOURCE-0C7A-20261012'||journal.completed)throw new TypeError('Select this incomplete original receiving operation');
if(resuming){
  (journal.resumeHistory??=[]).push({startedAt:new Date().toISOString(),pid:process.pid,previousFailure:journal.failure,source:journal.source});
  delete journal.failure;delete journal.failedAt;
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(condition,message)=>{if(!condition)throw new Error(message);};
async function save(){await writeFile(journalPath,JSON.stringify(journal,null,2)+'\n',{mode:0o600});}
async function step(name,run){
  let entry=journal.steps.find(row=>row.name===name);
  if(resuming&&entry?.completedAt)return entry.result;
  if(entry){(entry.attempts??=[]).push({startedAt:entry.startedAt,pid:journal.pid});entry.startedAt=new Date().toISOString();}
  else{entry={name,startedAt:new Date().toISOString()};journal.steps.push(entry);}
  await save();
  const result=await run();entry.result=result;entry.completedAt=new Date().toISOString();await save();
  process.stdout.write(JSON.stringify({operationId:journal.operationId,step:name,result})+'\n');return result;
}
let issuerServer,resourceServer,applicationHandle,access,authorization,resourcePort,issuerPort;
let signingKeys=[],keyRequests=0,hostEnabled=true,providerCalls=0,sequence=0;
const resource='https://merchant.oauth-receiving.test/mcp',issuer='https://issuer.oauth-receiving.test/oidc';
const jwksUri='https://issuer.oauth-receiving.test/oidc/jwks';
const response=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
const listen=async(server,port=0)=>{await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);done();});});return server.address().port;};
const stopServer=async server=>{if(!server?.listening)return;const done=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));server.closeAllConnections();await done;};
const safeHandler=handler=>(req,res)=>{Promise.resolve().then(()=>handler(req,res)).catch(()=>{if(!res.headersSent)response(res,500,{error:'NATIVE_HANDLER_FAILED'});else res.destroy();});};
const nativeFetch=globalThis.fetch;
async function receivingFetch(url,init={}){
  const target=new URL(url);
  const expected=target.origin===new URL(issuer).origin?issuerPort:target.origin===new URL(resource).origin?resourcePort:null;
  if(!expected)throw new Error('Receiving transport origin was not selected');
  // Each native receiving request owns its connection, as the SF31 public
  // transport does. A closed service cannot leave a pooled socket for reopen.
  const headers=new Headers(init.headers);headers.set('connection','close');
  return nativeFetch('http://127.0.0.1:'+expected+target.pathname+target.search,{...init,headers,redirect:'manual'});
}
async function rpc(token,method,params={},expectedStatus=200,extra={}){
  const id=++sequence,headers={accept:'application/json, text/event-stream','content-type':'application/json',
    'mcp-protocol-version':MCP_VERSION,...(token?{authorization:'Bearer '+token}:{}),...extra.headers};
  const res=await receivingFetch(resource+(extra.query??''),{method:'POST',headers,
    body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(10000)});
  const body=await res.json();
  const observation={method,tool:params.name??null,status:res.status,challenge:res.headers.get('www-authenticate'),
    resultError:body.result?.isError===true?body.result.structuredContent?.code:null};
  journal.requests.push(observation);
  need(res.status===expectedStatus,'Unexpected HTTP status for '+method);
  if(expectedStatus===200){need(body.id===id&&body.result&&body.result.isError!==true,'Original MCP result did not succeed');}
  return {body,observation};
}
async function grant(key,{subject,scope='mcp:read application:read',audience=resource,iss=issuer,expired=false,typ='at+jwt'}={}){
  const now=Math.floor(Date.now()/1000);
  return new SignJWT({scope,client_id:'native-receiving-client'}).setProtectedHeader({alg:'RS256',typ,kid:key.public.kid})
    .setIssuer(iss).setSubject(subject).setAudience(audience).setIssuedAt(expired?now-240:now)
    .setExpirationTime(expired?now-120:now+600).sign(key.privateKey);
}
const applicationModule=await import(pathToFileURL(resolve(options.get('--application-source'),'application.mjs')).href);
const {loadApplication}=await import(pathToFileURL(resolve(options.get('--application-source'),'configuration.mjs')).href);
let config,initial,subject,firstKey,secondKey,goodToken,baselineToken;
async function openResource({hostLoader=false,reusePort}={}){
  applicationHandle=await loadApplication(options.get('--application-config'));
  const app=applicationHandle.application;
  const tools=applicationModule.applicationTools(app,applicationHandle.context).tools;
  const provider={tools,async call(name,args,context){
    const principal=context?.authorization;
    need(principal&&Object.isFrozen(principal)&&Object.isFrozen(principal.scopes),'Verified immutable context must reach the original provider');
    need(!Object.hasOwn(principal,'token')&&!Object.hasOwn(principal,'claims'),'Raw access token must not reach the original provider');
    providerCalls++;
    return applicationModule.applicationTools(app,{subject:principal.subject}).call(name,args);
  }};
  if(hostLoader){
    access=await loadOAuthResourceHost({configPath:resolve(output,'resource.json'),fetchImpl:receivingFetch});
    authorization=access.transportOptions.authorization;
  }else{
    authorization=createOAuthResourceAuthorization(config,{fetchImpl:receivingFetch,
      authorize:({context})=>hostEnabled&&context.subject===subject});
    access={transportOptions:{authorization},wrap:handler=>(req,res)=>authorization.metadataHandler(req,res)?undefined:handler(req,res),close:()=>authorization.close()};
  }
  resourceServer=createServer(safeHandler(access.wrap(createMcpToolHandler(provider,{...access.transportOptions,
    serverName:'original-application-oauth-receiving',serverVersion:'1.0.0'}))));
  resourcePort=await listen(resourceServer,reusePort??0);
}
async function closeResource(){
  await access?.close();await stopServer(resourceServer);await applicationHandle?.close();
  resourceServer=null;access=null;applicationHandle=null;
}
function sourceSelection(rows){
  return rows.requests.map(row=>({intentId:row.intentId,bodySha256:row.bodySha256,state:row.state?.state??row.state?.status??null}));
}
try{
  const prepareRuntime=async()=>{
    applicationHandle=await loadApplication(options.get('--application-config'));subject=applicationHandle.context.subject;
    initial=await applicationHandle.application.requests(applicationHandle.context);
    need(initial.requests.length===4,'Use the four retained original request selections');
    const selected=sourceSelection(initial);need(selected.every(row=>row.bodySha256&&row.intentId),'Original request bindings missing');
    await applicationHandle.close();applicationHandle=null;
    for(const kid of ['receiving-original','receiving-rotated']){
      const pair=await generateKeyPair('RS256',{modulusLength:2048,extractable:true});
      const publicKey={...await exportJWK(pair.publicKey),kid,alg:'RS256',use:'sig'};
      signingKeys.push({privateKey:pair.privateKey,public:publicKey});
    }
    [firstKey,secondKey]=signingKeys;signingKeys=[firstKey];
    issuerServer=createServer((req,res)=>{
      if(req.url==='/oidc/jwks'){keyRequests++;return response(res,200,{keys:signingKeys.map(key=>key.public)});}
      if(req.url==='/.well-known/oauth-authorization-server/oidc')return response(res,200,{
        issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:jwksUri,
        response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
        code_challenge_methods_supported:['S256'],scopes_supported:['mcp:read','application:read','application:execute','offline_access'],
        client_id_metadata_document_supported:true,authorization_response_iss_parameter_supported:true});
      response(res,404,{error:'not_found'});
    });
    issuerPort=await listen(issuerServer);
    config=createOAuthOperatorConfiguration({resource,issuer,jwksUri,subjects:[subject],
      toolScopes:{stellar_requests:['application:read'],stellar_request_status:['application:read'],
        stellar_request_execute:['application:execute']}});
    config.jwksCooldownMs=0;
    if(resuming)need(JSON.stringify(JSON.parse(await readFile(resolve(output,'resource.json'),'utf8')))===JSON.stringify(config),'Original receiving configuration changed');
    else journal.configFile=await writeNewOAuthJson(resolve(output,'resource.json'),config);
    goodToken=await grant(firstKey,{subject});baselineToken=await grant(firstKey,{subject,scope:'mcp:read'});
    journal.runtimeSelection={sourceRoot,installedCli,joseEntry:selectedRequire.resolve('jose')};
    journal.source=await Promise.all(['oauth-resource.mjs','oauth-host.mjs','http-tools.mjs','oauth-discovery.mjs',
      'oauth-resource-cli.mjs'].map(async name=>{const bytes=await readFile(resolve(ownRoot,name));return {path:name,bytes:bytes.length,sha256:digest(bytes)};}));
    if(resuming)need(JSON.stringify(journal.inputs.selections)===JSON.stringify(selected),'Original retained selections changed before continuation');
    journal.inputs={applicationId:initial.applicationId,handoffId:initial.handoffId,selections:selected};
    return {applicationId:initial.applicationId,handoffId:initial.handoffId,originalSelections:selected,
      jwtImplementation:'jose6.2.12',algorithm:'RS256',privateKeys:'in-memory',issuerPid:process.pid};
  };
  if(resuming){
    const prepared=await prepareRuntime();journal.resumeHistory.at(-1).prepared=prepared;
    signingKeys=[firstKey,secondKey];goodToken=await grant(secondKey,{subject});
    await save();
  }else await step('retained-original-source-and-provider-keys',prepareRuntime);
  await openResource();
  await step('protected-resource-metadata-and-current-discovery',async()=>{
    const first=await rpc(null,'initialize',{protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{name:'receiving',version:'1.0.0'}},401);
    need(first.observation.challenge?.includes('resource_metadata=')&&first.observation.challenge.includes('scope="mcp:read"'),'Resource challenge must advertise metadata and minimum scope');
    const discovery=await discoverOAuthResource({resource,issuer,expectedAuthorizationServer:config.authorizationServers[0],
      trustedOrigins:[new URL(resource).origin,new URL(issuer).origin],fetchImpl:receivingFetch});
    need(discovery.compatible&&discovery.selectedIssuer===issuer&&discovery.keySet.usableKeyCount===1,'Original provider discovery failed');
    need(!discovery.supportedScopes.includes('offline_access'),'Refresh-token scope is not a resource requirement');
    journal.discovery=discovery;
    return {metadataUrl:discovery.metadataUrl,issuer:discovery.selectedIssuer,pkceS256:discovery.pkceS256,
      usableKeys:discovery.keySet.usableKeyCount,resourceScopes:discovery.supportedScopes,requests:discovery.observations.length};
  });
  await step('authorized-original-MCP-control-receiving',async()=>{
    const probe=await probeOAuthResource({config,token:baselineToken,fetchImpl:receivingFetch});
    need(probe.catalogComplete&&probe.toolCount===6&&probe.protocolVersion===MCP_VERSION,'Original MCP control receiving failed');
    need(providerCalls===0,'Listing tools must not call an application tool');
    journal.probe=probe;
    return {protocolVersion:probe.protocolVersion,toolCount:probe.toolCount,catalogComplete:probe.catalogComplete};
  });
  await step('complete-scope-and-token-authority-boundaries',async()=>{
    const before=providerCalls,scope=await rpc(baselineToken,'tools/call',{name:'stellar_requests',arguments:{}},403);
    need(scope.observation.challenge?.includes('scope="mcp:read application:read"'),'Challenge must contain every current required scope');
    const findings=[{name:'required-scopes',status:403}];
    const cases=[
      ['wrong-audience',await grant(firstKey,{subject,audience:'https://other.oauth-receiving.test/mcp'}),401],
      ['unconfigured-issuer',await grant(firstKey,{subject,iss:'https://unknown.oauth-receiving.test'}),401],
      ['expired-grant',await grant(firstKey,{subject,expired:true}),401],
      ['ID-token-type',await grant(firstKey,{subject,typ:'JWT'}),401],
      ['different-operator-subject',await grant(firstKey,{subject:'unassigned-receiving-subject'}),403],
    ];
    for(const [name,token,status] of cases){
      await rpc(token,'tools/list',{},status);findings.push({name,status});
    }
    const parts=goodToken.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
    await rpc(parts.join('.'),'tools/list',{},401);findings.push({name:'altered-signature',status:401});
    await rpc(goodToken,'tools/list',{},400,{query:'?access_token=disallowed-query-value'});findings.push({name:'query-token',status:400});
    need(providerCalls===before,'Rejected requests reached an original application tool');
    return {findings,providerCallsDuringRejections:0};
  });
  await step('verified-subject-enters-original-retained-application',async()=>{
    const result=await rpc(goodToken,'tools/call',{name:'stellar_requests',arguments:{}});
    const rows=result.body.result.structuredContent;
    need(JSON.stringify(sourceSelection(rows))===JSON.stringify(sourceSelection(initial)),'Original handoff selection changed');
    const outcome=await rpc(goodToken,'tools/call',{name:'stellar_request_status',arguments:{intentId:initial.requests[0].intentId}});
    journal.originalOutcome=outcome.body.result.structuredContent;
    return {subject,requests:rows.requests.length,providerCalls,selectedIntent:initial.requests[0].intentId,
      outcome:outcome.body.result.structuredContent};
  });
  await step('current-host-authority-rechecked-before-dispatch',async()=>{
    const before=providerCalls;hostEnabled=false;
    await rpc(goodToken,'tools/call',{name:'stellar_requests',arguments:{}},403);
    need(providerCalls===before,'Revoked current host authority reached the provider');
    hostEnabled=true;
    await rpc(goodToken,'tools/list');
    return {revokedStatus:403,providerCallsDuringRevocation:0,restoredCatalogStatus:200};
  });
  await step('native-JWKS-key-rotation',async()=>{
    signingKeys=[firstKey,secondKey];
    const rotated=await grant(secondKey,{subject});
    const before=keyRequests;
    await rpc(rotated,'tools/call',{name:'stellar_requests',arguments:{}});
    need(keyRequests===before+1,'Unknown configured-provider kid did not refresh the original JWKS resolver once');
    goodToken=rotated;
    return {newKeyId:secondKey.public.kid,keyRequests,providerCalls,keys:authorization.describe().authorizationServers[0].keys};
  });
  await step('owned-drain-and-same-state-host-reopen',async()=>{
    const port=resourcePort,old=authorization,firstGenerationCalls=providerCalls;
    await closeResource();need(old.describe().closed&&old.describe().activeRequests===0,'Original authorization did not drain');
    signingKeys=[secondKey];
    await openResource({hostLoader:true,reusePort:port});
    const oldToken=await grant(firstKey,{subject});
    await rpc(oldToken,'tools/list',{},401);
    const probe=await probeOAuthResource({config,token:goodToken,fetchImpl:receivingFetch});
    const restored=await rpc(goodToken,'tools/call',{name:'stellar_requests',arguments:{}});
    need(JSON.stringify(sourceSelection(restored.body.result.structuredContent))===JSON.stringify(sourceSelection(initial)),'Native source binding changed on reopen');
    return {reusedLocalPort:resourcePort,closedFirstAuthorization:true,reopenedThrough:'loadOAuthResourceHost',
      retiredKeyStatus:401,toolCount:probe.toolCount,originalRequests:restored.body.result.structuredContent.requests.length,
      firstGenerationCalls,providerCalls};
  });
  await step('original-fixed-token-mode-and-client-handover',async()=>{
    const fixed='original-fixed-operator-'+randomUUID(),fixedAccess=await loadOAuthResourceHost({bearerToken:fixed});
    const fixedProvider=applicationModule.applicationTools(applicationHandle.application,applicationHandle.context);
    const server=createServer(safeHandler(fixedAccess.wrap(createMcpToolHandler(fixedProvider,fixedAccess.transportOptions))));
    const port=await listen(server);
    try{
      const res=await fetch('http://127.0.0.1:'+port,{method:'POST',headers:{authorization:'Bearer '+fixed,
        accept:'application/json, text/event-stream','content-type':'application/json','mcp-protocol-version':MCP_VERSION},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
      const data=await res.json();need(res.status===200&&data.result.tools.length===6,'Original fixed-token transport changed');
    }finally{await fixedAccess.close();await stopServer(server);}
    const commands=[],configFile=resolve(output,'cli-resource.json');
    let receivingImport;
    if(installedCli){
      receivingImport=resolve(output,'original-receiving-fetch.mjs');
      const origins={[new URL(resource).origin]:resourcePort,[new URL(issuer).origin]:issuerPort};
      const preload=`// Private receiving transport: the selected original CLI still owns its command.\nconst origins=${JSON.stringify(origins)};\nconst nativeFetch=globalThis.fetch;\nglobalThis.fetch=(input,init={})=>{const url=new URL(input);const port=origins[url.origin];if(!port)throw new Error('Receiving origin was not selected');const headers=new Headers(init.headers);headers.set('connection','close');return nativeFetch('http://127.0.0.1:'+port+url.pathname+url.search,{...init,headers,redirect:'manual'});};\n`;
      await writeFile(receivingImport,preload,{mode:0o600,flag:'wx'});
    }
    async function cli(args){
      if(installedCli){
        const childEnv={...process.env,SCF_OAUTH_RECEIVING_TOKEN:goodToken,
          NODE_OPTIONS:[process.env.NODE_OPTIONS??'','--import',JSON.stringify(pathToFileURL(receivingImport).href)].filter(Boolean).join(' ')};
        let received;
        try{received=await runNode(process.execPath,[installedCli,'mcp-oauth',...args],
          {env:childEnv,encoding:'utf8',timeout:30000,maxBuffer:1048576,windowsHide:true});}
        catch(error){throw Object.assign(new Error('Selected original installed CLI failed for '+args[0]),{code:error.code??'INSTALLED_CLI_FAILED'});}
        need(!received.stdout.includes(goodToken)&&!received.stderr.includes(goodToken),'An installed CLI output retained the bearer token');
        const result=JSON.parse(received.stdout);
        commands.push({command:args[0],execution:'installed-child',result});
        return JSON.parse(await readFile(result.file,'utf8'));
      }
      const previousFetch=globalThis.fetch,previousWrite=process.stdout.write,previousExit=process.exitCode;
      const previousToken=process.env.SCF_OAUTH_RECEIVING_TOKEN,printed=[];
      globalThis.fetch=receivingFetch;process.env.SCF_OAUTH_RECEIVING_TOKEN=goodToken;
      process.stdout.write=(chunk,encoding,callback)=>{printed.push(Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk));
        if(typeof encoding==='function')encoding();else if(typeof callback==='function')callback();return true;};
      try{
        const result=await oauthCli(args);
        need(process.exitCode===previousExit,'Original CLI reported unsuccessful completion');
        commands.push({command:args[0],result:JSON.parse(printed.join(''))});return result;
      }finally{
        globalThis.fetch=previousFetch;process.stdout.write=previousWrite;
        if(previousToken===undefined)delete process.env.SCF_OAUTH_RECEIVING_TOKEN;else process.env.SCF_OAUTH_RECEIVING_TOKEN=previousToken;
      }
    }
    await cli(['init','--resource',resource,'--issuer',issuer,'--jwks',jwksUri,'--subject',subject,
      '--scope','mcp:read','--tool-scope','stellar_requests=application:read',
      '--tool-scope','stellar_request_status=application:read','--tool-scope','stellar_request_execute=application:execute',
      '--output',configFile]);
    await cli(['describe','--config',configFile,'--output',resolve(output,'cli-description.json')]);
    const discovery=await cli(['discover','--config',configFile,'--trusted-origin',new URL(resource).origin,
      '--trusted-origin',new URL(issuer).origin,'--output',resolve(output,'cli-discovery.json')]);
    need(discovery.compatible,'Original CLI discovery did not accept the receiving provider');
    const existing={mcpServers:{existing:{type:'http',url:'https://existing.operator.test/mcp'}},operatorPreference:'preserved'};
    await writeNewOAuthJson(resolve(output,'existing-client.json'),existing);
    const clients=await cli(['client-config','--config',configFile,'--name','stellar-application',
      '--merge',resolve(output,'existing-client.json'),'--output',resolve(output,'claude-code-mcp.json')]);
    need(JSON.stringify(clients.mcpServers.existing)===JSON.stringify(existing.mcpServers.existing)&&
      clients.operatorPreference===existing.operatorPreference,'Existing client configuration changed during merge');
    const probe=await cli(['probe','--config',configFile,'--token-env','SCF_OAUTH_RECEIVING_TOKEN',
      '--output',resolve(output,'cli-probe.json')]);
    need(probe.catalogComplete&&probe.toolCount===6,'Original CLI did not receive all original tools');
    for(const command of commands){
      const mode=(await stat(command.result.file)).mode&0o777;
      need(mode===0o600,'Original CLI output is not private');
      command.mode='0600';
    }
    need(!JSON.stringify(commands).includes(goodToken),'A receiving report retained the bearer token');
    journal.cli=commands;
    return {fixedTokenCatalogStatus:200,commands,client:'Claude Code',resource,catalogComplete:probe.catalogComplete,toolCount:probe.toolCount};
  });
  const final=authorization;
  await closeResource();await stopServer(issuerServer);issuerServer=null;
  need(final.describe().closed&&final.describe().activeRequests===0,'Final OAuth lifetime did not close');
  journal.completed=true;journal.closed={resource:true,issuer:true,originalApplication:true,authorization:true};
  journal.completedAt=new Date().toISOString();await save();
  process.stdout.write(JSON.stringify({operationId:journal.operationId,completed:true,steps:journal.steps.length,
    journal:journalPath,source:journal.source,closed:journal.closed})+'\n');
}catch(error){
  journal.failure={code:error.code??'NATIVE_RECEIVING_FAILED',message:error.message,stack:error.stack,
    cause:error.cause?{code:error.cause.code,message:error.cause.message}:undefined};
  process.exitCode=1;
  try{await closeResource();}catch(closeError){journal.resourceCloseFailure={code:closeError.code,message:closeError.message};}
  try{await stopServer(issuerServer);}catch(closeError){journal.issuerCloseFailure={code:closeError.code,message:closeError.message};}
  journal.failedAt=new Date().toISOString();await save();
  process.stderr.write(JSON.stringify({operationId:journal.operationId,completed:false,journal:journalPath,failure:journal.failure})+'\n');
}
