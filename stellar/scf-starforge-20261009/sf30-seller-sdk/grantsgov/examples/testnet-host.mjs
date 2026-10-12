// MIT. Original native facilitator and an existing HTTPS testnet host connection.
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { createNativeFacilitator } from '../../../native-facilitator/runtime.mjs';
import { startFacilitatorServer } from '../../../native-facilitator/server.mjs';

const requireValue=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
const integerPort=value=>Number.isInteger(value)&&value>=0&&value<=65535;
async function listen(server,port=0){
  await new Promise((resolve,reject)=>{
    const failed=error=>{server.removeListener('listening',ready);reject(error);};
    const ready=()=>{server.removeListener('error',failed);resolve();};
    server.once('error',failed);server.once('listening',ready);server.listen(port,'127.0.0.1');
  });
  return server.address().port;
}
async function stop(server,sockets){
  if(!server)return;
  const stopped=new Promise((resolve,reject)=>server.close(error=>{
    if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')reject(error);else resolve();
  }));
  server.closeIdleConnections?.();
  for(const socket of sockets)socket.destroy();
  await stopped;
}
function track(server,sockets){
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
}
function loopback(value){
  let url;try{url=new URL(value);}catch{requireValue(false,'TESTNET_RELEASE_LISTENER');}
  requireValue(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&
    !url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,'TESTNET_RELEASE_LISTENER');
  return url;
}

/**
 * Connect an existing TESTNET hostname/certificate and existing signer custody.
 * The caller injects that workspace's original named environment variables.
 * No account, signer, certificate, policy or payment operation is created here.
 *
 * A stable facilitatorPort lets the same saved native operation reuse its exact
 * staged runtime URL on a later process. The caller owns the operation journal.
 */
export async function openExistingTestnetHost({
  facilitatorConfig,publicOrigin,tlsKeyFile,tlsCertificateFile,
  proxyEnvironment,environment=process.env,facilitatorPort=0,tlsPort=0,proxyPort=0
}={}){
  requireValue(facilitatorConfig?.network==='stellar:testnet','TESTNET_HOST_NETWORK');
  requireValue([facilitatorPort,tlsPort,proxyPort].every(integerPort),'TESTNET_HOST_PORT');
  requireValue(typeof proxyEnvironment==='string'&&/^[A-Z][A-Z0-9_]{2,100}$/.test(proxyEnvironment),
    'TESTNET_PROXY_ENVIRONMENT');
  const origin=new URL(publicOrigin),rpc=new URL(facilitatorConfig.rpcUrl);
  requireValue(origin.protocol==='https:'&&!origin.username&&!origin.password&&!origin.port&&
    origin.pathname==='/'&&!origin.search&&!origin.hash&&origin.origin===publicOrigin,'TESTNET_HOST_ORIGIN');
  requireValue(rpc.protocol==='https:'&&!rpc.username&&!rpc.password&&!rpc.port,'TESTNET_HOST_RPC');
  const egressAddress=environment.HTTPS_PROXY??environment.https_proxy??environment.HTTP_PROXY??environment.http_proxy;
  requireValue(typeof egressAddress==='string'&&egressAddress.length>0,'ORIGINAL_EGRESS_PROXY_REQUIRED');
  const egress=new URL(egressAddress);
  requireValue(['http:','https:'].includes(egress.protocol)&&!egress.username&&!egress.password&&
    egress.pathname==='/'&&!egress.search&&!egress.hash,'ORIGINAL_EGRESS_PROXY_INVALID');
  const key=await readFile(tlsKeyFile),cert=await readFile(tlsCertificateFile);
  const previousEnvironment=environment[proxyEnvironment];
  const previousProcessEnvironment=process.env[proxyEnvironment];
  const hadEnvironment=Object.hasOwn(environment,proxyEnvironment);
  const hadProcessEnvironment=Object.hasOwn(process.env,proxyEnvironment);
  let facilitator,facilitatorServer,tlsServer,proxyServer,assignedProxy,closing,binding;
  let bindingRevision=0;
  const tlsSockets=new Set(),proxySockets=new Set(),tunnels=new Set();
  const counters={merchantConnect:0,rpcConnect:0,refusedConnect:0,requests:0,upstreamErrors:0};
  const exchanges=[];
  function trackTunnel(socket){
    tunnels.add(socket);socket.once('close',()=>tunnels.delete(socket));return socket;
  }
  function remember(value){
    if(exchanges.length<2000)exchanges.push(value);
  }
  async function bridgeRpc(socket,authority){
    const upstream=trackTunnel(egress.protocol==='https:'?
      tlsConnect({host:egress.hostname,port:Number(egress.port||443),servername:egress.hostname}):
      netConnect({host:egress.hostname,port:Number(egress.port||80)}));
    let pending=Buffer.alloc(0),established=false;
    const failed=()=>{counters.upstreamErrors++;socket.destroy();upstream.destroy();};
    upstream.once('error',failed);socket.once('error',()=>upstream.destroy());
    socket.once('close',()=>upstream.destroy());
    upstream.setTimeout(15000,failed);
    upstream.once(egress.protocol==='https:'?'secureConnect':'connect',()=>{
      upstream.write('CONNECT '+authority+' HTTP/1.1\r\nHost: '+authority+'\r\n\r\n');
    });
    const handshake=data=>{
      pending=Buffer.concat([pending,data]);
      if(pending.length>16384)return failed();
      const end=pending.indexOf('\r\n\r\n');if(end<0)return;
      upstream.removeListener('data',handshake);
      if(!/^HTTP\/1\.[01] 200(?: |\r)/.test(pending.toString('latin1',0,end))){
        counters.upstreamErrors++;upstream.destroy();socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');return;
      }
      established=true;upstream.setTimeout(0);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if(pending.length>end+4)socket.write(pending.subarray(end+4));
      pending=Buffer.alloc(0);socket.pipe(upstream);upstream.pipe(socket);
    };
    upstream.on('data',handshake);
    upstream.once('close',()=>{if(!established)socket.destroy();});
  }
  async function close(){
    if(closing)return closing;
    closing=(async()=>{
      binding=null;
      let drain,error;
      try{
        drain=facilitatorServer?await facilitatorServer.close():await facilitator?.drain();
      }catch(caught){error=caught;}
      for(const socket of tunnels)socket.destroy();
      const stopped=await Promise.allSettled([stop(proxyServer,proxySockets),stop(tlsServer,tlsSockets)]);
      if(assignedProxy){
        if(environment[proxyEnvironment]===assignedProxy){
          if(hadEnvironment)environment[proxyEnvironment]=previousEnvironment;else delete environment[proxyEnvironment];
        }
        if(process.env[proxyEnvironment]===assignedProxy){
          if(hadProcessEnvironment)process.env[proxyEnvironment]=previousProcessEnvironment;else delete process.env[proxyEnvironment];
        }
      }
      const failed=stopped.find(value=>value.status==='rejected');
      if(error)throw error;if(failed)throw failed.reason;
      return {state:(!facilitator||drain?.drained===true)?'CLOSED':'DRAINING',facilitator:drain,counters:{...counters},exchanges:[...exchanges]};
    })();
    return closing;
  }
  try{
    // The original backend owns RPC readiness, physical signer exclusivity,
    // fee limits, exact payment-profile checks and drain/release semantics.
    facilitator=await createNativeFacilitator(facilitatorConfig,{environment});
    facilitatorServer=await startFacilitatorServer({facilitator,port:facilitatorPort});
    tlsServer=createHttpsServer({key,cert},(req,res)=>{
      counters.requests++;
      const selected=binding;
      if(!selected){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"ORIGINAL_RELEASE_NOT_ATTACHED"}');return;}
      if(![origin.host,origin.host+':443'].includes(req.headers.host)){
        res.writeHead(421);res.end();return;
      }
      const event={method:req.method,path:(req.url??'').split('?')[0],
        paidHeaderPresent:typeof req.headers['payment-signature']==='string',binding:selected.revision};
      remember(event);
      const outbound=httpRequest({hostname:'127.0.0.1',port:Number(selected.listener.port),
        path:req.url,method:req.method,headers:req.headers,agent:false},incoming=>{
        event.status=incoming.statusCode;
        res.writeHead(incoming.statusCode??502,incoming.headers);incoming.pipe(res);
      });
      outbound.setTimeout(65000,()=>outbound.destroy(new Error('ORIGINAL_RELEASE_TIMEOUT')));
      outbound.once('error',()=>{
        counters.upstreamErrors++;event.status=502;
        if(!res.headersSent)res.writeHead(502);res.end();
      });
      req.once('aborted',()=>outbound.destroy());res.once('close',()=>outbound.destroy());req.pipe(outbound);
    });
    tlsServer.headersTimeout=10000;tlsServer.requestTimeout=70000;tlsServer.keepAliveTimeout=1000;
    track(tlsServer,tlsSockets);const actualTlsPort=await listen(tlsServer,tlsPort);
    proxyServer=createHttpServer((req,res)=>{res.writeHead(405);res.end();});
    track(proxyServer,proxySockets);
    proxyServer.on('connect',(req,socket,head)=>{
      trackTunnel(socket);
      if(req.url===origin.host+':443'&&!head.length){
        counters.merchantConnect++;
        const target=trackTunnel(netConnect({host:'127.0.0.1',port:actualTlsPort},()=>{
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.pipe(target);target.pipe(socket);
        }));
        target.once('error',()=>socket.destroy());socket.once('error',()=>target.destroy());
        socket.once('close',()=>target.destroy());
      }else if(req.url===rpc.host+':443'&&!head.length){
        counters.rpcConnect++;bridgeRpc(socket,req.url).catch(()=>socket.destroy());
      }else{
        counters.refusedConnect++;socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      }
    });
    proxyServer.headersTimeout=10000;proxyServer.requestTimeout=15000;
    assignedProxy='http://127.0.0.1:'+await listen(proxyServer,proxyPort);
    environment[proxyEnvironment]=assignedProxy;
    // Original buyer children inherit process.env; preserve the named original
    // proxy variable there as well when the caller supplied a detached map.
    process.env[proxyEnvironment]=assignedProxy;
    return {
      facilitatorUrl:facilitatorServer.url,proxyUrl:assignedProxy,
      async attachTransport({listener,settings}){
        requireValue(!closing,'TESTNET_HOST_CLOSED');
        requireValue(settings?.merchant?.origin===publicOrigin,'TESTNET_HOST_ORIGIN_CHANGED');
        requireValue(settings?.runtime?.facilitator===facilitatorServer.url,'TESTNET_FACILITATOR_URL_CHANGED');
        const selected={listener:loopback(listener),revision:++bindingRevision};
        binding=selected;
        return {close:async()=>{if(binding===selected)binding=null;}};
      },
      snapshot(){
        return {state:closing?'CLOSING':'OPEN',origin:publicOrigin,facilitatorUrl:facilitatorServer.url,
          proxyUrl:assignedProxy,listener:binding?.listener.origin??null,facilitator:facilitator.status(),
          counters:{...counters},exchanges:[...exchanges]};
      },
      close
    };
  }catch(error){await close().catch(()=>{});throw error;}
}
