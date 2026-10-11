// MIT. Private Valyu research desk; original native commands own paid execution.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {ValyuWorkspace} from './workspace.mjs';
import {exportResearchEdition} from './research.mjs';
import {need} from './files.mjs';
const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/app.css':['app.css','text/css; charset=utf-8']};
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
async function requestBody(req,limit){
  need(req.headers['content-type']?.split(';')[0]==='application/json','JSON_REQUIRED');
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;need(size<=limit,'REQUEST_TOO_LARGE');chunks.push(chunk);}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
export async function startValyuDesk({settings,port=0}){
  need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'PORT_INVALID');
  const workspace=await ValyuWorkspace.open(settings),token=randomBytes(32).toString('hex');
  const active=new Set(),controllers=new Set();let closing=false,origin,closePromise;
  const server=createServer((req,res)=>{
    if(closing){json(res,503,{error:'WORKSPACE_CLOSING'});return;}
    if(active.size>=12){json(res,503,{error:'WORKSPACE_BUSY'});return;}
    const task=dispatch(req,res);active.add(task);task.finally(()=>active.delete(task)).catch(()=>{});
  });
  server.requestTimeout=60000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  async function dispatch(req,res){
    res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
    res.setHeader('referrer-policy','no-referrer');
    res.setHeader('content-security-policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      need(req.headers.host===new URL(origin).host,'WORKSPACE_HOST_INVALID');
      const url=new URL(req.url,origin),path=url.pathname;
      if(!path.startsWith('/api/')){
        const asset=assets[path];need(req.method==='GET'&&asset,'NOT_FOUND');
        const raw=await readFile(new URL('./static/'+asset[0],import.meta.url));
        res.writeHead(200,{'content-type':asset[1]});res.end(raw);return;
      }
      const supplied=req.headers['x-workspace-token'];
      need(typeof supplied==='string'&&Buffer.byteLength(supplied)===Buffer.byteLength(token)&&
        timingSafeEqual(Buffer.from(supplied),Buffer.from(token)),'WORKSPACE_AUTH_REQUIRED');
      need(!req.headers.origin||req.headers.origin===origin,'WORKSPACE_ORIGIN_INVALID');
      need(['GET','POST'].includes(req.method),'METHOD_INVALID');
      const data=req.method==='POST'?await requestBody(req,path==='/api/import-edition'?40*1024*1024:131072):null;
      if(path==='/api/state'&&req.method==='GET'){json(res,200,workspace.state({offset:Number(url.searchParams.get('offset')??0),limit:30}));return;}
      if(path==='/api/queries'&&req.method==='POST'){json(res,200,workspace.saveQuery(data));return;}
      if(path==='/api/editions'&&req.method==='GET'){json(res,200,workspace.store.listEditions({offset:Number(url.searchParams.get('offset')??0),limit:30}));return;}
      if(path==='/api/import-edition'&&req.method==='POST'){
        const edition=workspace.store.importEdition(data.manifest??data);
        json(res,200,{id:edition.id,sha256:edition.sha256});return;
      }
      if(path==='/api/annotations'&&req.method==='POST'){json(res,200,workspace.store.annotate(data));return;}
      if(path==='/api/compare'&&req.method==='POST'){json(res,200,workspace.store.compare(data.left,data.right,{editions:!!data.editions}));return;}
      const query=/^\/api\/queries\/([a-f0-9-]{36})(?:\/(prepare|review|execute|collect|inspect|duplicate))?$/.exec(path);
      if(query){
        const[,id,action]=query;
        if(!action&&req.method==='GET'){json(res,200,workspace.store.detail(id));return;}
        if(action==='duplicate'&&req.method==='POST'){json(res,200,workspace.store.duplicateQuery(id,data));return;}
        if(action==='prepare'&&req.method==='POST'){json(res,200,await workspace.prepare(id,data));return;}
        if(['review','inspect'].includes(action)&&req.method==='GET'){json(res,200,await workspace[action](id));return;}
        if(action==='collect'&&req.method==='POST'){json(res,200,await workspace.collect(id));return;}
        if(action==='execute'&&req.method==='POST'){
          const controller=new AbortController();controllers.add(controller);
          try{json(res,200,await workspace.execute(id,{signal:controller.signal}));}
          finally{controllers.delete(controller);}return;
        }
      }
      const capture=/^\/api\/captures\/([a-f0-9-]{36})(?:\/(freeze|body))?$/.exec(path);
      if(capture){
        const[,id,action]=capture;
        if(!action&&req.method==='GET'){json(res,200,workspace.store.captureView(id));return;}
        if(action==='freeze'&&req.method==='POST'){
          const edition=workspace.store.freeze(id,data);json(res,200,{id:edition.id,sha256:edition.sha256});return;
        }
        if(action==='body'&&req.method==='GET'){
          const c=workspace.store.capture(id);
          res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-disposition':'attachment; filename="valyu-delivery-'+id+'.json"'});
          res.end(c.raw);return;
        }
      }
      const edition=/^\/api\/editions\/([a-f0-9-]{36})(?:\/(export))?$/.exec(path);
      if(edition&&req.method==='GET'){
        const saved=workspace.store.edition(edition[1]);
        if(!edition[2]){json(res,200,workspace.store.editionView(edition[1]));return;}
        const output=exportResearchEdition(saved.manifest,url.searchParams.get('format')??'json');
        res.writeHead(200,{'content-type':output.type,'content-disposition':'attachment; filename="valyu-edition-'+edition[1]+'.'+output.extension+'"'});
        res.end(output.bytes);return;
      }
      need(false,'NOT_FOUND');
    }catch(error){
      const code=typeof error.code==='string'&&/^[A-Z0-9_]{1,120}$/.test(error.code)?error.code:'WORKSPACE_REQUEST_FAILED';
      if(!res.headersSent)json(res,code.includes('AUTH')?401:code.includes('NOT_FOUND')?404:code.includes('STALE')||code.includes('CHANGED')||code.includes('COLLISION')?409:400,{error:code});
      else res.destroy();
    }
  }
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
  catch(error){workspace.close();throw error;}
  origin='http://127.0.0.1:'+server.address().port;
  return {origin,url:origin+'/#'+token,token,workspace,close:()=>closePromise??=(async()=>{
    closing=true;for(const controller of controllers)controller.abort();
    const stopped=new Promise(resolve=>server.close(resolve));server.closeIdleConnections();
    await Promise.allSettled([...active]);server.closeIdleConnections();await stopped;workspace.close();
  })()};
}
