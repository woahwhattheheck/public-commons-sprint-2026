// MIT. The configured supplier ORDER endpoint; private operator APIs remain separate.
import { createServer } from 'node:https';
import { authenticateTransport, transportTlsFiles } from './transport-config.mjs';
import { fail } from './core.mjs';

const MAX_XML=64*1024*1024,IDLE_MS=30000;
function reply(response,status,body,type='text/plain; charset=utf-8'){
  if(response.headersSent||response.destroyed||response.writableEnded)return;
  const bytes=Buffer.from(body);
  response.setTimeout(IDLE_MS,()=>response.destroy());
  response.once('finish',()=>response.setTimeout(0));
  response.writeHead(status,{'Content-Type':type,'Content-Length':String(bytes.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});
  response.end(status===204?undefined:bytes);
}
async function* originalBody(request){
  const length=request.headers['content-length'];
  if(length!==undefined&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)<1||Number(length)>MAX_XML))
    fail('ORDER_HTTPS_LENGTH_INVALID','Supply the complete original XML within 64 MiB.',413);
  let bytes=0;
  for await(const part of request){bytes+=part.length;if(bytes>MAX_XML)fail('ORDER_HTTPS_INPUT_TOO_LARGE','The original XML exceeds 64 MiB.',413);yield part;}
  if(!request.complete||!bytes||length!==undefined&&Number(length)!==bytes)fail('ORDER_HTTPS_INPUT_INCOMPLETE','The original HTTP entity is incomplete.',400);
}
export async function serveSupplierOrderHttpsIntake({workspace}={}){
  workspace.assertOpen();const configuration=workspace.transport.configuration,selected=configuration.intake;
  if(!selected)fail('ORDER_HTTPS_LISTENER_NOT_CONFIGURED','Declare the original HTTPS listener certificate, private key, host and port.',422);
  const channels=configuration.channels.filter(channel=>channel.incoming);
  if(!channels.length)fail('ORDER_HTTPS_INTAKE_NOT_CONFIGURED','Declare at least one incoming ORDER channel.',422);
  const tls=await transportTlsFiles(selected);
  let closing=false,closed=false,closePromise,stopped;
  const active=new Set(),sockets=new Set();
  const handle=async(request,response)=>{
    const idle=()=>request.destroy(Object.assign(new Error('The original HTTPS body stopped making progress.'),{code:'ORDER_HTTPS_INPUT_IDLE'}));
    request.setTimeout(IDLE_MS,idle);
    response.once('finish',()=>{if(!request.complete)request.destroy();});
    try{
      if(closing)fail('ORDER_HTTPS_CLOSING','The supplier intake is closing.',503);
      if(request.method!=='POST')fail('ORDER_HTTPS_METHOD_INVALID','This configured endpoint accepts an original XML POST.',405);
      if(active.size>8)fail('ORDER_HTTPS_BUSY','The original supplier intake is busy. Retry this same original document.',503);
      const channel=channels.find(item=>{const url=new URL(item.incoming.url);return request.headers.host===url.host&&request.url===url.pathname;});
      if(!channel)fail('ORDER_HTTPS_ROUTE_NOT_FOUND','Use the negotiated HTTPS supplier address.',404);
      if(!authenticateTransport(request.headers.authorization,channel.incoming.auth)){
        response.setHeader('WWW-Authenticate',channel.incoming.auth.type==='basic'?'Basic realm="supplier-orders", charset="UTF-8"':'Bearer realm="supplier-orders"');
        fail('ORDER_HTTPS_AUTH_REQUIRED','The configured supplier credential is required.',401);
      }
      const contentType=String(request.headers['content-type']??'').split(';')[0].trim().toLowerCase();
      if(!['application/xml','text/xml'].includes(contentType))fail('ORDER_HTTPS_XML_REQUIRED','Send the original raw XML entity.',415);
      if(request.headers['content-encoding']&&request.headers['content-encoding']!=='identity')fail('ORDER_HTTPS_ENCODING_UNSUPPORTED','Send the original uncompressed XML entity.',415);
      let messageId=null;
      if(channel.incoming.messageIdHeader){
        messageId=request.headers[channel.incoming.messageIdHeader];
        if(typeof messageId!=='string'||!messageId.trim()||messageId.length>1000||/[\r\n\0]/.test(messageId))
          fail('ORDER_HTTPS_MESSAGE_ID_REQUIRED','Retain the negotiated original message identity header.',400);
      }
      // Complete source custody precedes parsing and every successful HTTP reply.
      const file=await workspace.retain(originalBody(request),{name:'HTTPS_ORDER.xml',kind:'source',mimeType:contentType,maxBytes:MAX_XML});
      request.setTimeout(0);request.off('timeout',idle);
      const result=await workspace.transport.receive({channelId:channel.id,file,externalMessageId:messageId});
      response.setHeader('X-Supplier-Order-Transmission-Id',result.transmission.id);
      if(result.transmission.state==='RECEIVED'){
        const ack=channel.incoming.acknowledgment;reply(response,ack.statusCode,ack.body,ack.contentType);
      }else if(result.transmission.state==='REJECTED'){
        reply(response,422,JSON.stringify({error:result.transmission.error,transmissionId:result.transmission.id}),'application/json; charset=utf-8');
      }else{
        response.setHeader('Retry-After','5');reply(response,503,JSON.stringify({error:{code:'ORDER_HTTPS_RECEIVE_PENDING',message:'The original XML is retained; retry the same message after the original receiving operation becomes available.'},transmissionId:result.transmission.id}),'application/json; charset=utf-8');
      }
    }catch(error){
      const status=Number.isInteger(error.status)&&error.status>=400&&error.status<600?error.status:503;
      if(status===503)response.setHeader('Retry-After','5');
      // Native environment paths and credential material are never returned to a peer.
      reply(response,status,JSON.stringify({error:{code:error.code??'ORDER_HTTPS_RECEIVE_UNAVAILABLE',message:status>=500?'The original supplier receiving operation is temporarily unavailable. Retry this same message.':error.message}}),'application/json; charset=utf-8');
    }finally{request.off('timeout',idle);if(!response.headersSent&&(request.complete||request.destroyed))request.setTimeout(0);}
  };
  const server=createServer({...tls,minVersion:'TLSv1.2',maxHeaderSize:32768},(request,response)=>{
    const task=Promise.resolve().then(()=>workspace.owned(()=>handle(request,response)));active.add(task);
    void task.catch(error=>response.destroy(error)).finally(()=>active.delete(task));
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  server.requestTimeout=0;server.headersTimeout=30000;server.keepAliveTimeout=1000;
  server.on('clientError',(_error,socket)=>socket.destroy());
  server.on('tlsClientError',(_error,socket)=>socket.destroy());
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(selected.port,selected.host,()=>{server.off('error',reject);resolve();});});}
  catch(error){for(const socket of sockets)socket.destroy();throw error;}
  const close=()=>{
    if(closed)return Promise.resolve();if(closePromise)return closePromise;closing=true;
    const task=(async()=>{
      stopped??=new Promise((resolve,reject)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
      server.closeIdleConnections?.();
      // A lost HTTP reply does not cancel the original stored document operation.
      while(active.size)await Promise.allSettled([...active]);
      for(const socket of sockets)socket.destroy();
      await stopped;closed=true;
    })();
    closePromise=task.then(value=>{closePromise=null;return value;},error=>{closePromise=null;throw error;});return closePromise;
  };
  return{server,workspace,channels:channels.map(channel=>({id:channel.id,url:channel.incoming.url,sha256:channel.sha256})),get activeRequests(){return active.size;},close};
}
