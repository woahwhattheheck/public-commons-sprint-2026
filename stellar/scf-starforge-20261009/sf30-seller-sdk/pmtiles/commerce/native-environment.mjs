// MIT. Own the original testnet facilitator and approved receiving transport.
// Composes the operated Huwise/39DA source: private Commons blob0932ce474416c5b7e23f1a3833e2a0c7e36ec739.
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import {createServer as createHttpServer,request as httpRequest} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {connect as netConnect} from 'node:net';
import {connect as tlsConnect} from 'node:tls';
import {openWorkspace} from '../../../sf88-operator-buyer-cli/workspace.mjs';
import {operation as originalOperation} from '../../../sf88-operator-buyer-cli/config.mjs';
import {privateDirectory,readJson,writeJson} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {createNativeFacilitator} from '../../../native-facilitator/runtime.mjs';
import {startFacilitatorServer} from '../../../native-facilitator/server.mjs';
import {need,clone,digest,hash} from '../model.mjs';
import {retainJson,fileDescriptor} from '../files.mjs';
import {fields,outputHash} from './model.mjs';

let processOwner=null;
const ENV=/^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENV=new Set(['HOME','home','CODEX_HOME','PATH','PWD','SHELL']);
const PROFILE_KEYS=['operator','signerModule','trustedPayer','buyerTransport','evidenceDir'];
function path(value){
  need(typeof value==='string'&&isAbsolute(value)&&!value.includes('\0'),
    'PMTILES_NATIVE_ENVIRONMENT_ABSOLUTE_PATH_REQUIRED');
  return resolve(value);
}
function port(value,{zero=false}={}){
  need(Number.isInteger(value)&&value>=(zero?0:1)&&value<=65535,'PMTILES_NATIVE_ENVIRONMENT_PORT_REQUIRED');
  return value;
}
function envName(value){
  need(typeof value==='string'&&ENV.test(value)&&!RESERVED_ENV.has(value),
    'PMTILES_NATIVE_ENVIRONMENT_NAME_INVALID');
  return value;
}
function origin(value){
  const selected=new URL(value);
  need(selected.protocol==='https:'&&!selected.username&&!selected.password&&!selected.search&&!selected.hash&&
    selected.pathname==='/'&&(!selected.port||selected.port==='443'),'PMTILES_NATIVE_ENVIRONMENT_HTTPS_ORIGIN_REQUIRED');
  return selected;
}
function endpoint(value){
  const selected=new URL(value);
  need(selected.protocol==='http:'&&selected.hostname==='127.0.0.1'&&selected.port&&
    !selected.username&&!selected.password&&!selected.search&&!selected.hash&&selected.pathname==='/',
    'PMTILES_NATIVE_ENVIRONMENT_LOCAL_FACILITATOR_REQUIRED');
  port(Number(selected.port));return selected;
}
async function selectedFile(filename,expected,{privateMode=false,limit=65536,signal}={}){
  filename=path(filename);outputHash(expected);
  const file=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await file.stat({bigint:true});
    need(before.isFile()&&before.size>=0n&&before.size<=BigInt(limit)&&await realpath(filename)===filename,
      'PMTILES_NATIVE_ENVIRONMENT_FILE_REQUIRED');
    if(privateMode&&process.platform!=='win32'){
      need((Number(before.mode)&0o077)===0&&(!process.getuid||Number(before.uid)===process.getuid()),
        'PMTILES_NATIVE_ENVIRONMENT_PRIVATE_FILE_REQUIRED');
    }
    const bytes=await file.readFile(),after=await file.stat({bigint:true});
    need(bytes.length===Number(before.size)&&bytes.length<=limit&&before.size===after.size&&
      before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,
      'PMTILES_NATIVE_ENVIRONMENT_FILE_CHANGED');
    need(hash(bytes)===expected,'PMTILES_NATIVE_ENVIRONMENT_FILE_HASH_CHANGED');
    return bytes;
  }finally{await file.close();}
}
export function validatePMTilesNativeEnvironmentSelection(value){
  value=clone(value);fields(value,['configuration','configurationSha256'],['configuration','configurationSha256']);
  value.configuration=path(value.configuration);outputHash(value.configurationSha256);return value;
}
function descriptor(value){
  value=clone(value);
  fields(value,['schema','operatorWorkspace','facilitatorConfiguration','facilitatorConfigurationSha256','tls','rpcTransport','ports'],
    ['schema','operatorWorkspace','facilitatorConfiguration','facilitatorConfigurationSha256','tls','rpcTransport']);
  need(value.schema==='starforge.pmtiles-native-environment.v1','PMTILES_NATIVE_ENVIRONMENT_SCHEMA_INVALID');
  value.operatorWorkspace=path(value.operatorWorkspace);
  value.facilitatorConfiguration=path(value.facilitatorConfiguration);outputHash(value.facilitatorConfigurationSha256);
  fields(value.tls,['certificate','certificateSha256','key','keySha256','ca','caSha256'],
    ['certificate','certificateSha256','key','keySha256','ca','caSha256']);
  for(const name of ['certificate','key','ca']){value.tls[name]=path(value.tls[name]);outputHash(value.tls[name+'Sha256']);}
  fields(value.rpcTransport,['mode','proxyEnv'],['mode','proxyEnv']);
  need(value.rpcTransport.mode==='environment-proxy','PMTILES_NATIVE_ENVIRONMENT_ORIGINAL_PROXY_REQUIRED');
  envName(value.rpcTransport.proxyEnv);
  value.ports=value.ports??{};fields(value.ports,['tls','proxy']);
  for(const name of ['tls','proxy'])if(value.ports[name]!==undefined)port(value.ports[name]);
  return value;
}
async function optional(filename){
  try{return await readJson(filename,65536);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function listen(server,selectedPort){
  return new Promise((accept,reject)=>{
    const failed=error=>{server.removeListener('listening',ready);reject(error);};
    const ready=()=>{server.removeListener('error',failed);accept(port(server.address().port));};
    server.once('error',failed);server.once('listening',ready);server.listen(port(selectedPort,{zero:true}),'127.0.0.1');
  });
}
function stopAdmission(server){
  if(!server)return Promise.resolve();
  return new Promise((accept,reject)=>{
    try{server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):accept());server.closeIdleConnections?.();}
    catch(error){if(error.code==='ERR_SERVER_NOT_RUNNING')accept();else reject(error);}
  });
}

/**
 * Call only inside the original owned native receiving process, after its other
 * providers close. The original MCP Buyer uses this process's environment; the
 * selected values therefore remain installed until the caller drains its seller
 * and Buyer, then awaits close(). Returned reports never contain those values.
 */
export async function startPMTilesNativeEnvironment({selection,commerce,buyerConfiguration,operatorProfile,
  directory,signal}){
  selection=validatePMTilesNativeEnvironmentSelection(selection);commerce=clone(commerce);
  buyerConfiguration=clone(buyerConfiguration);operatorProfile=operatorProfile===undefined?undefined:clone(operatorProfile);
  directory=path(directory);
  const inherited=Object.fromEntries(Object.entries(process.env).filter(([,value])=>value!==undefined));
  need(Object.values(inherited).every(value=>typeof value==='string'),'PMTILES_NATIVE_ENVIRONMENT_VALUES_INVALID');
  need(inherited.NODE_TLS_REJECT_UNAUTHORIZED!=='0','PMTILES_NATIVE_ENVIRONMENT_TLS_VERIFICATION_REQUIRED');
  signal?.throwIfAborted();
  const raw=await selectedFile(selection.configuration,selection.configurationSha256,{privateMode:true,signal});
  const selected=descriptor(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
  await privateDirectory(directory);await privateDirectory(selected.operatorWorkspace,{create:false});
  need(await realpath(directory)===directory&&await realpath(selected.operatorWorkspace)===selected.operatorWorkspace,
    'PMTILES_NATIVE_ENVIRONMENT_CANONICAL_DIRECTORY_REQUIRED');
  const active=await openWorkspace(['--dir',selected.operatorWorkspace],{accounting:true,environment:inherited});
  const profiled={...buyerConfiguration,...operatorProfile};
  for(const name of PROFILE_KEYS)need(digest(profiled[name]??null)===digest(active.config[name]??null),
    'PMTILES_NATIVE_ENVIRONMENT_ORIGINAL_BUYER_CHANGED');
  need(active.manifest.network==='stellar:testnet'&&commerce.payment.network==='stellar:testnet',
    'PMTILES_NATIVE_ENVIRONMENT_TESTNET_REQUIRED');
  const merchantOrigin=origin(commerce.origin),transport=active.config.buyerTransport;
  need(transport?.mode==='explicit-connect'&&origin(transport.origin).origin===merchantOrigin.origin,
    'PMTILES_NATIVE_ENVIRONMENT_ORIGINAL_BUYER_ORIGIN_CHANGED');
  const selectedOperation=originalOperation(profiled.operation),workspaceOperation=originalOperation(active.config.operation);
  need(selectedOperation.method==='GET'&&new URL(selectedOperation.url).origin===merchantOrigin.origin&&
    workspaceOperation.expect.scheme==='exact'&&
    ['scheme','network','asset','payTo'].every(name=>selectedOperation.expect[name]===workspaceOperation.expect[name])&&
    ['network','asset','payTo'].every(name=>commerce.payment[name]===workspaceOperation.expect[name])&&
    BigInt(selectedOperation.expect.maxAtomic)>=BigInt(commerce.mapAtomic)&&
    BigInt(selectedOperation.expect.maxAtomic)>=BigInt(commerce.operationsAtomic),
    'PMTILES_NATIVE_ENVIRONMENT_ORIGINAL_PAYMENT_TERMS_CHANGED');
  const proxyName=envName(transport.proxyEnv);
  need(proxyName!==selected.rpcTransport.proxyEnv,'PMTILES_NATIVE_ENVIRONMENT_PROXY_RECURSION');
  const rpc=origin(active.manifest.signer.rpcUrl),facilitatorUrl=endpoint(commerce.runtime.facilitator);
  need(commerce.runtime.allowLocalFacilitator===true,'PMTILES_NATIVE_ENVIRONMENT_LOCAL_FACILITATOR_REVIEW_REQUIRED');
  port(commerce.runtime.port);
  need(Number(facilitatorUrl.port)!==commerce.runtime.port,'PMTILES_NATIVE_ENVIRONMENT_PORT_COLLISION');
  const originalProxy=new URL(inherited[selected.rpcTransport.proxyEnv]);
  need(['http:','https:'].includes(originalProxy.protocol)&&!originalProxy.username&&!originalProxy.password&&
    !originalProxy.search&&!originalProxy.hash&&originalProxy.pathname==='/',
    'PMTILES_NATIVE_ENVIRONMENT_ORIGINAL_PROXY_INVALID');
  const facilitatorBytes=await selectedFile(selected.facilitatorConfiguration,
    selected.facilitatorConfigurationSha256,{privateMode:true,signal});
  const facilitatorConfig=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(facilitatorBytes));
  need(facilitatorConfig.network==='stellar:testnet'&&new URL(facilitatorConfig.rpcUrl).href===rpc.href&&
    typeof facilitatorConfig.payments?.maxAtomic==='string'&&/^[1-9][0-9]*$/.test(facilitatorConfig.payments.maxAtomic)&&
    BigInt(facilitatorConfig.payments.maxAtomic)>=BigInt(commerce.mapAtomic)&&
    BigInt(facilitatorConfig.payments.maxAtomic)>=BigInt(commerce.operationsAtomic),
    'PMTILES_NATIVE_ENVIRONMENT_FACILITATOR_SELECTION_CHANGED');
  const [certificateBytes,keyBytes,caBytes]=await Promise.all([
    selectedFile(selected.tls.certificate,selected.tls.certificateSha256,{signal}),
    selectedFile(selected.tls.key,selected.tls.keySha256,{privateMode:true,signal}),
    selectedFile(selected.tls.ca,selected.tls.caSha256,{limit:1048576,signal})]);
  const certificate=new X509Certificate(certificateBytes);
  need(certificate.checkHost(merchantOrigin.hostname)!==undefined&&certificate.checkPrivateKey(createPrivateKey(keyBytes)),
    'PMTILES_NATIVE_ENVIRONMENT_TLS_IDENTITY_CHANGED');
  need(caBytes.length>0,'PMTILES_NATIVE_ENVIRONMENT_CA_REQUIRED');
  envName(active.manifest.signer.secretEnv);
  need(typeof inherited[active.manifest.signer.secretEnv]==='string'&&inherited[active.manifest.signer.secretEnv],
    'PMTILES_NATIVE_ENVIRONMENT_ORIGINAL_PAYER_ENV_REQUIRED');
  need(Array.isArray(facilitatorConfig.signers)&&facilitatorConfig.signers.length>0,
    'PMTILES_NATIVE_ENVIRONMENT_ORIGINAL_FEE_SIGNER_REQUIRED');
  for(const signer of facilitatorConfig.signers){
    envName(signer.secretEnv);need(typeof inherited[signer.secretEnv]==='string'&&inherited[signer.secretEnv],
      'PMTILES_NATIVE_ENVIRONMENT_ORIGINAL_FEE_ENV_REQUIRED');
  }
  const workspaceManifest=await fileDescriptor(join(selected.operatorWorkspace,'workspace.json'),{limit:65536,signal});
  const binding={schema:'starforge.pmtiles-native-environment-input.v1',configuration:selection,
    selected,origin:merchantOrigin.origin,rpc:rpc.href,facilitatorUrl:facilitatorUrl.origin,
    merchantPort:commerce.runtime.port,buyerProfileSha256:digest(Object.fromEntries(PROFILE_KEYS.map(name=>[name,profiled[name]]))),
    payment:commerce.payment,mapAtomic:commerce.mapAtomic,operationsAtomic:commerce.operationsAtomic};
  const inputSha256=digest(binding);await retainJson(join(directory,'input.json'),binding);
  const saved=await optional(join(directory,'listeners.json'));
  if(saved){
    need(saved.inputSha256===inputSha256&&saved.facilitatorUrl===facilitatorUrl.origin,
      'PMTILES_NATIVE_ENVIRONMENT_RETAINED_LISTENERS_CHANGED');
    port(saved.tlsPort);port(saved.proxyPort);
    for(const name of ['tls','proxy'])if(selected.ports[name]!==undefined)
      need(saved[name+'Port']===selected.ports[name],'PMTILES_NATIVE_ENVIRONMENT_RETAINED_PORT_CHANGED');
  }
  const initialPorts=[commerce.runtime.port,Number(facilitatorUrl.port),saved?.tlsPort??selected.ports.tls,saved?.proxyPort??selected.ports.proxy].filter(v=>v!==undefined);
  need(new Set(initialPorts).size===initialPorts.length,'PMTILES_NATIVE_ENVIRONMENT_PORT_COLLISION');
  need(processOwner===null,'PMTILES_NATIVE_ENVIRONMENT_PROCESS_ALREADY_OWNED');
  const owner={inputSha256},changes=new Map(),sockets=new Set(),requests=new Set();
  const counters={merchantConnect:0,rpcConnect:0,refusedConnect:0,merchantRequests:0,responseStatus:{}};
  let facilitator,facilitatorHttp,tls,proxy,closePromise,ready=null;
  processOwner=owner;
  function setEnv(name,value){
    envName(name);need(typeof value==='string','PMTILES_NATIVE_ENVIRONMENT_VALUE_INVALID');
    if(!changes.has(name)){
      need(process.env[name]===inherited[name],'PMTILES_NATIVE_ENVIRONMENT_CONCURRENT_CHANGE');
      changes.set(name,{before:process.env[name],installed:value});
    }else changes.get(name).installed=value;
    process.env[name]=value;
  }
  function track(socket){
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});return socket;
  }
  async function close(){
    if(closePromise)return closePromise;
    closePromise=(async()=>{
      const errors=[],admission=[stopAdmission(proxy),stopAdmission(tls)];
      // Observe each owned listener promise even if the original facilitator rejects.
      for(const pending of admission)void pending.catch(()=>{});
      let native=null;
      try{
        if(facilitatorHttp)native=await facilitatorHttp.close();
        else if(facilitator)native=await facilitator.drain();
      }catch(error){errors.push(error);}
      finally{
        for(const request of requests)request.destroy();
        for(const socket of sockets)socket.destroy();
        const stopped=await Promise.allSettled(admission);
        for(const row of stopped)if(row.status==='rejected')errors.push(row.reason);
        for(const [name,value]of changes){
          if(process.env[name]!==value.installed){
            errors.push(Object.assign(new Error('Original native environment changed before release.'),{code:'PMTILES_NATIVE_ENVIRONMENT_CONCURRENT_CHANGE',environmentName:name}));
            continue;
          }
          if(value.before===undefined)delete process.env[name];else process.env[name]=value.before;
        }
      }
      if(native&&native.drained!==true)errors.push(Object.assign(new Error('The original facilitator drain is incomplete.'),{code:'PMTILES_NATIVE_ENVIRONMENT_DRAIN_INCOMPLETE'}));
      const result={schema:'starforge.pmtiles-native-environment-close.v1',inputSha256,origin:merchantOrigin.origin,
        facilitatorUrl:facilitatorUrl.origin,drained:errors.length===0,
        facilitator:{drained:native?.drained??null,httpDrained:native?.httpDrained??null},
        counters:clone(counters),closedAt:new Date().toISOString(),
        errors:errors.map(error=>({code:typeof error.code==='string'?error.code:'PMTILES_NATIVE_ENVIRONMENT_CLOSE_FAILED'}))};
      try{
        try{await writeJson(join(directory,'status.json'),{state:errors.length?'INTERRUPTED':'CLOSED',...result});}
        catch(error){errors.push(error);}
        if(errors.length)throw new AggregateError(errors,'The original native environment needs its retained continuation.');
        return result;
      }finally{
        // Keep the same owner through its final status write so a new startup
        // cannot be followed by this older lifetime's CLOSED observation.
        if(processOwner===owner)processOwner=null;
      }
    })();return closePromise;
  }
  try{
    setEnv(active.manifest.signer.secretEnv,inherited[active.manifest.signer.secretEnv]);
    for(const signer of facilitatorConfig.signers)setEnv(signer.secretEnv,inherited[signer.secretEnv]);
    setEnv(selected.rpcTransport.proxyEnv,inherited[selected.rpcTransport.proxyEnv]);
    for(const [name,value]of Object.entries(active.operatorEnvironment))setEnv(name,value);
    setEnv('NODE_EXTRA_CA_CERTS',selected.tls.ca);
    setEnv('SF36_OBSERVER_USE_SYSTEM_CA','1');
    const nodeOptions=inherited.NODE_OPTIONS??'';
    setEnv('NODE_OPTIONS',/(?:^|\s)--use-system-ca(?:\s|$)/.test(nodeOptions)?nodeOptions:(nodeOptions+' --use-system-ca').trim());
    signal?.throwIfAborted();
    facilitator=await createNativeFacilitator(facilitatorConfig,{environment:{...process.env}});
    signal?.throwIfAborted();
    facilitatorHttp=await startFacilitatorServer({facilitator,port:Number(facilitatorUrl.port)});
    need(new URL(facilitatorHttp.url).origin===facilitatorUrl.origin,'PMTILES_NATIVE_ENVIRONMENT_FACILITATOR_LISTENER_CHANGED');
    const readiness=await facilitator.probeReadiness(),status=facilitator.status();
    need(readiness.ready===true&&status.state==='ACCEPTING','PMTILES_NATIVE_ENVIRONMENT_FACILITATOR_NOT_READY');
    tls=createHttpsServer({key:keyBytes,cert:certificateBytes},(req,res)=>{
      if(![merchantOrigin.host.toLowerCase(),merchantOrigin.hostname.toLowerCase()+':443'].includes(String(req.headers.host??'').toLowerCase())||
        typeof req.url!=='string'||!/^\/(?!\/)/.test(req.url)){res.writeHead(421);res.end();return;}
      counters.merchantRequests++;
      const outgoing=httpRequest({hostname:'127.0.0.1',port:commerce.runtime.port,path:req.url,method:req.method,
        headers:req.headers,agent:false},incoming=>{
        const code=String(incoming.statusCode??502);
        counters.responseStatus[code]=(counters.responseStatus[code]??0)+1;
        res.writeHead(incoming.statusCode??502,incoming.headers);incoming.pipe(res);
        incoming.once('error',()=>res.destroy());
      });
      requests.add(outgoing);outgoing.once('close',()=>requests.delete(outgoing));
      outgoing.once('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
      req.once('aborted',()=>outgoing.destroy());
      res.once('close',()=>{if(!res.writableFinished)outgoing.destroy();});
      req.pipe(outgoing);
    });
    tls.on('connection',track);tls.on('tlsClientError',()=>{});
    tls.on('connect',(_request,socket)=>socket.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n'));
    const tlsPort=await listen(tls,saved?.tlsPort??selected.ports.tls??0);
    function bridgeRpc(socket,head){
      const upstream=track(originalProxy.protocol==='https:'
        ?tlsConnect({host:originalProxy.hostname,port:Number(originalProxy.port||443),servername:originalProxy.hostname})
        :netConnect({host:originalProxy.hostname,port:Number(originalProxy.port||80)}));
      upstream.once('error',()=>socket.destroy());upstream.once('close',()=>socket.destroy());
      socket.once('error',()=>upstream.destroy());socket.once('close',()=>upstream.destroy());
      upstream.setTimeout(30000,()=>{upstream.destroy();socket.destroy();});
      upstream.once(originalProxy.protocol==='https:'?'secureConnect':'connect',
        ()=>upstream.write('CONNECT '+rpc.hostname+':443 HTTP/1.1\r\nHost: '+rpc.hostname+':443\r\n\r\n'));
      let buffer=Buffer.alloc(0);
      const handshake=data=>{
        buffer=Buffer.concat([buffer,data]);
        if(buffer.length>16384){upstream.destroy();socket.destroy();return;}
        const end=buffer.indexOf('\r\n\r\n');if(end<0)return;
        upstream.removeListener('data',handshake);
        if(!/^HTTP\/1\.[01] 200(?: |\r)/.test(buffer.toString('latin1',0,end))){
          upstream.destroy();socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');return;
        }
        upstream.setTimeout(0);socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if(buffer.length>end+4)socket.write(buffer.subarray(end+4));if(head.length)upstream.write(head);
        socket.pipe(upstream);upstream.pipe(socket);
      };
      upstream.on('data',handshake);
    }
    proxy=createHttpServer((req,res)=>{res.writeHead(405);res.end();});
    proxy.on('connection',track);
    proxy.on('connect',(req,socket,head)=>{
      if(req.url===merchantOrigin.hostname+':443'&&!head.length){
        counters.merchantConnect++;
        const target=track(netConnect({host:'127.0.0.1',port:tlsPort},()=>{
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.pipe(target);target.pipe(socket);
        }));
        target.once('error',()=>socket.destroy());socket.once('error',()=>target.destroy());socket.once('close',()=>target.destroy());
      }else if(req.url===rpc.hostname+':443'&&!head.length){
        counters.rpcConnect++;bridgeRpc(socket,head);
      }else{counters.refusedConnect++;socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
    });
    const proxyPort=await listen(proxy,saved?.proxyPort??selected.ports.proxy??0);
    need(new Set([commerce.runtime.port,Number(facilitatorUrl.port),tlsPort,proxyPort]).size===4,
      'PMTILES_NATIVE_ENVIRONMENT_PORT_COLLISION');
    await retainJson(join(directory,'listeners.json'),{inputSha256,facilitatorUrl:facilitatorUrl.origin,tlsPort,proxyPort});
    setEnv(proxyName,'http://127.0.0.1:'+proxyPort);
    signal?.throwIfAborted();
    ready={schema:'starforge.pmtiles-native-environment-ready.v1',inputSha256,configurationSha256:selection.configurationSha256,
      origin:merchantOrigin.origin,facilitatorUrl:facilitatorUrl.origin,merchantPort:commerce.runtime.port,tlsPort,proxyPort,
      operatorWorkspace:selected.operatorWorkspace,workspaceManifestSha256:workspaceManifest.sha256,
      facilitatorConfigurationSha256:selected.facilitatorConfigurationSha256,
      tls:{certificateSha256:selected.tls.certificateSha256,keySha256:selected.tls.keySha256,caSha256:selected.tls.caSha256},
      rpc:rpc.href,proxyEnvironment:proxyName,rpcProxyEnvironment:selected.rpcTransport.proxyEnv,
      readiness:{ready:readiness.ready,state:status.state},startedAt:new Date().toISOString()};
    await writeJson(join(directory,'status.json'),{state:'READY',...ready});
    return {ready:clone(ready),environment:{...process.env},close};
  }catch(error){
    try{await close();}catch(closeError){throw new AggregateError([error,closeError],'Original native environment startup and cleanup failed.');}
    throw error;
  }
}
