import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Hdf5Workbench} from './controller.mjs';
import {MiB,fail,only,verifiedFile,same} from './custody.mjs';

const assets=new Map([['/',['public/index.html','text/html; charset=utf-8']],['/app.js',['public/app.js','text/javascript; charset=utf-8']],['/style.css',['public/style.css','text/css; charset=utf-8']]]);
function secureEqual(a,b){const left=Buffer.from(a??''),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
export async function serveHdf5({directory,python='python3',inputRoots=[],buyerWorkspace,port=0}={}){
  const workbench=new Hdf5Workbench({directory,python,inputRoots,buyerWorkspace});await workbench.start();
  const token=randomBytes(32).toString('base64url');let closing=false;const active=new Set(),sockets=new Set(),downloads=new Map();
  let address;
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
  async function handle(req,res){
    const host='127.0.0.1:'+address.port;
    if(req.headers.host!==host&&req.headers.host!=='localhost:'+address.port)fail('Use the original loopback listener.','HDF5_HOST',403);
    const url=new URL(req.url,'http://'+host);
    const reply=(status,value)=>{const data=Buffer.from(JSON.stringify(value));res.writeHead(status,{...headers,'content-type':'application/json; charset=utf-8','content-length':data.length,'connection':'close'});res.end(data);};
    const asset=assets.get(url.pathname);
    if(asset&&req.method==='GET'){
      const bytes=await readFile(new URL(asset[0],import.meta.url));res.writeHead(200,{...headers,'content-type':asset[1],'content-length':bytes.length,'connection':'close'});res.end(bytes);return;
    }
    if(req.headers.origin&&req.headers.origin!=='http://'+host&&req.headers.origin!=='http://localhost:'+address.port)fail('Request origin differs from this operator.','HDF5_ORIGIN',403);
    if(!secureEqual(req.headers.authorization,'Bearer '+token))fail('Open the original operator link or supply its host-private Bearer capability.','HDF5_AUTH',401);
    if(closing)fail('The operator is draining accepted work.','HDF5_CLOSING',409);
    if(url.pathname==='/api/launch'&&req.method==='GET')return reply(200,{schema:'stellar-forge.hdf5-launch.v1',directory:workbench.directory,pid:process.pid});
    if(url.pathname==='/api/upload'&&req.method==='POST'){
      const kind=url.searchParams.get('kind')??'source';if(!['source','packet'].includes(kind))fail('Choose source or packet upload.');
      const result=await workbench.upload(req,req.headers['x-content-sha256'],kind==='source'?256*MiB:512*MiB);return reply(201,result);
    }
    if(url.pathname==='/api/action'&&req.method==='POST'){
      if(!(req.headers['content-type']??'').startsWith('application/json'))fail('Use a JSON action body.');
      const chunks=[];let count=0;for await(const chunk of req){count+=chunk.length;if(count>MiB)fail('Action exceeds 1 MiB.','HDF5_REQUEST_TOO_LARGE',413);chunks.push(chunk);}
      const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      only(request,['action','payload']);
      return reply(200,await workbench.call(request.action,request.payload??{}));
    }
    if(url.pathname==='/api/artifact'&&['GET','HEAD'].includes(req.method)){
      const controller=new AbortController();downloads.set(controller,res);let original;
      const disconnected=()=>controller.abort(new Error('The original download connection closed.'));
      res.once('close',disconnected);res.setTimeout(120000,()=>res.destroy());
      try{
      const descriptor=url.searchParams.has('delivery')
        ? await workbench.call('delivery.artifact',{operation:url.searchParams.get('delivery')})
        : url.searchParams.has('publisherKind')
          ? await workbench.call('publisher.export',{kind:url.searchParams.get('publisherKind'),id:url.searchParams.get('publisherId')})
          : await workbench.call('artifact',{edition:url.searchParams.get('edition'),name:url.searchParams.get('name')});
      original=await verifiedFile(descriptor.path,descriptor,512*MiB,{signal:controller.signal});let start=0,end=original.bytes-1,status=200;
        if(req.headers.range){
          const match=/^bytes=([0-9]+)-([0-9]*)$/.exec(req.headers.range);if(!match)fail('Use one explicit byte range.','HDF5_RANGE',416);
          start=Number(match[1]);end=match[2]?Number(match[2]):end;
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=original.bytes)fail('Range exceeds the retained file.','HDF5_RANGE',416);status=206;
        }
        const length=original.bytes?end-start+1:0;
        res.writeHead(status,{...headers,'connection':'close','content-type':'application/octet-stream','content-length':length,'accept-ranges':'bytes',
          'etag':'"'+original.sha256+'"','x-content-sha256':original.sha256,
          'content-disposition':'attachment; filename="'+descriptor.name+'"',...(status===206?{'content-range':'bytes '+start+'-'+end+'/'+original.bytes}:{})});
        if(req.method==='HEAD'){res.end();return;}
        const buffer=Buffer.alloc(MiB);let position=start;
        while(position<=end&&!res.destroyed){
          controller.signal.throwIfAborted();
          const {bytesRead}=await original.handle.read(buffer,0,Math.min(buffer.length,end-position+1),position);if(!bytesRead)throw new Error('Retained file ended during delivery.');
          if(!res.write(buffer.subarray(0,bytesRead)))await new Promise((resolve,reject)=>{const done=()=>{res.off('close',closed);resolve();};const closed=()=>{res.off('drain',done);resolve();};res.once('drain',done);res.once('close',closed);});
          position+=bytesRead;
        }
        if(!same(original.info,await original.handle.stat({bigint:true})))throw new Error('Retained file changed during delivery.');
        res.end();
      }finally{res.off('close',disconnected);downloads.delete(controller);await original?.handle.close();}
      return;
    }
    return reply(404,{error:'HDF5_ROUTE',message:'Unknown original operator route.'});
  }
  const server=createServer((req,res)=>{
    if(active.size>=8){res.writeHead(503,{'connection':'close','content-type':'application/json'});res.end('{"error":"HDF5_BUSY"}');return;}
    const task=handle(req,res).catch(error=>{
      if(res.headersSent){res.destroy(error);return;}
      const data=Buffer.from(JSON.stringify({error:error.code??'HDF5_HTTP_ERROR',message:error.message}));
      res.writeHead(error.status??500,{...headers,'connection':'close','content-type':'application/json','content-length':data.length});res.end(data);
    }).finally(()=>active.delete(task));active.add(task);
  });
  server.requestTimeout=150000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});address=server.address();}
  catch(error){await workbench.close();throw error;}
  let closePromise,stopped;
  const close=()=>{
    closing=true;
    if(closePromise)return closePromise;
    const pending=(async()=>{
      stopped??=new Promise(resolve=>server.close(resolve));server.closeIdleConnections?.();
      for(const [controller,response] of downloads){controller.abort(new Error('The operator is closing this read-only download.'));response.destroy();}
      try{await Promise.allSettled([...active]);await workbench.close();}
      finally{server.closeAllConnections?.();await stopped;}
    })();
    closePromise=pending;void pending.catch(()=>{if(closePromise===pending)closePromise=null;});return pending;
  };
  return {schema:'stellar-forge.hdf5-launch.v1',url:'http://127.0.0.1:'+address.port+'/#'+token,origin:'http://127.0.0.1:'+address.port,
          token,directory:workbench.directory,pid:process.pid,workbench,close};
}
