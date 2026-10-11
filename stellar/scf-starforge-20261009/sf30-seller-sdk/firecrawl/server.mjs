// MIT. Private industrial research desk. No API key or signer enters the browser.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {ResearchWorkspace} from './research.mjs';
import {exportEdition} from './exports.mjs';
import {need} from './contract.mjs';
const staticRoot=fileURLToPath(new URL('./static/',import.meta.url));
const contentTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
async function body(req){
  need(req.headers['content-type']?.split(';')[0]==='application/json','JSON_REQUIRED');
  let size=0;const parts=[];
  for await(const part of req){size+=part.length;need(size<=65536,'REQUEST_TOO_LARGE');parts.push(part);}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
}
export async function startResearchDesk({settings,port=0}){
  const workspace=await ResearchWorkspace.open(settings),token=randomBytes(32).toString('hex');
  const active=new Set();let closing=false,origin;
  const server=createServer((req,res)=>{
    if(closing){res.writeHead(503);res.end();return;}
    if(active.size>=8){json(res,503,{error:'WORKSPACE_BUSY'});return;}
    const task=dispatch(req,res);active.add(task);task.finally(()=>active.delete(task)).catch(()=>{});
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  async function dispatch(req,res){
    res.setHeader('cache-control','no-store');
    res.setHeader('x-content-type-options','nosniff');
    res.setHeader('referrer-policy','no-referrer');
    res.setHeader('content-security-policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      need(req.headers.host===new URL(origin).host,'WORKSPACE_HOST_INVALID');
      const url=new URL(req.url,origin),path=url.pathname;
      if(!path.startsWith('/api/')){
        need(req.method==='GET','METHOD_INVALID');
        const name=({'/':'index.html','/app.js':'app.js','/app.css':'app.css'})[path];need(name,'NOT_FOUND');
        const bytes=await readFile(join(staticRoot,name));res.writeHead(200,{'content-type':contentTypes[name.slice(name.lastIndexOf('.'))]});res.end(bytes);return;
      }
      const supplied=req.headers['x-workspace-token'];
      need(typeof supplied==='string'&&supplied.length===token.length&&timingSafeEqual(Buffer.from(supplied),Buffer.from(token)),'WORKSPACE_AUTH_REQUIRED');
      need(!req.headers.origin||req.headers.origin===origin,'WORKSPACE_ORIGIN_INVALID');
      const data=req.method==='POST'?await body(req):null;
      need(['GET','POST'].includes(req.method),'METHOD_INVALID');
      if(path==='/api/state'&&req.method==='GET'){
        json(res,200,{...workspace.store.list({offset:Number(url.searchParams.get('offset')??0),limit:30}),
          policy:workspace.policy,paymentConfigured:!!settings.operatorProfile&&!!settings.sellerClient});return;
      }
      if(path==='/api/captures'&&req.method==='GET'){json(res,200,workspace.store.captures({offset:Number(url.searchParams.get('offset')??0),limit:100}));return;}
      if(path==='/api/queries'&&req.method==='POST'){json(res,200,workspace.saveQuery(data));return;}
      const query=/^\/api\/queries\/([a-f0-9-]{36})(?:\/(prepare|collect|inspect|review))?$/.exec(path);
      if(query){
        const[,id,action]=query;
        if(!action&&req.method==='GET'){json(res,200,workspace.store.detail(id));return;}
        if(action==='prepare'&&req.method==='POST'){json(res,200,await workspace.prepare(id,data));return;}
        if(action==='collect'&&req.method==='POST'){json(res,200,await workspace.collect(id));return;}
        if(action==='inspect'&&req.method==='GET'){json(res,200,await workspace.inspect(id));return;}
        if(action==='review'&&req.method==='GET'){json(res,200,await workspace.review(id));return;}
      }
      if(path==='/api/annotations'&&req.method==='POST'){json(res,200,workspace.store.annotate(data));return;}
      if(path==='/api/collections'&&req.method==='POST'){json(res,200,workspace.store.saveCollection(data));return;}
      const collection=/^\/api\/collections\/([a-f0-9-]{36})(?:\/(freeze))?$/.exec(path);
      if(collection){
        if(!collection[2]&&req.method==='GET'){json(res,200,workspace.store.collection(collection[1]));return;}
        if(collection[2]==='freeze'&&req.method==='POST'){
          const edition=workspace.store.freezeCollection(collection[1],data.expectedRevision,data.expectedSelectionSha256);
          json(res,200,{id:edition.id,sha256:edition.sha256});return;
        }
      }
      const download=/^\/api\/editions\/([a-f0-9-]{36})$/.exec(path);
      if(download&&req.method==='GET'){
        const output=exportEdition(workspace.store.edition(download[1]),url.searchParams.get('format')??'json');
        res.writeHead(200,{'content-type':output.type,'content-disposition':'attachment; filename="research-'+download[1]+'.'+output.extension+'"'});res.end(output.bytes);return;
      }
      if(path==='/api/compare'&&req.method==='POST'){json(res,200,workspace.compare(data.left,data.right));return;}
      need(false,'NOT_FOUND');
    }catch(error){
      const code=typeof error.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(error.code)?error.code:'WORKSPACE_REQUEST_FAILED';
      if(!res.headersSent)json(res,code.includes('AUTH')?401:code==='NOT_FOUND'?404:code.includes('STALE')||code.includes('CHANGED')?409:400,{error:code});
      else res.destroy();
    }
  }
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
  catch(error){workspace.close();throw error;}
  origin='http://127.0.0.1:'+server.address().port;
  let closingPromise;
  return {origin,url:origin+'/#'+token,token,workspace,close:()=>closingPromise??=(async()=>{
    closing=true;const stopped=new Promise(resolve=>server.close(resolve));server.closeIdleConnections();
    await Promise.allSettled([...active]);server.closeIdleConnections();await stopped;workspace.close();
  })()};
}
