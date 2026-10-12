// MIT. Local authenticated HUD desk; all publication runs the original engines.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { fault } from '../postgres/publisher/files.mjs';
import { releaseFiles } from './contract.mjs';
import { openHudSourcePacket } from './release.mjs';

async function body(req,maximum=262144){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))throw fault('JSON_REQUIRED','Send application/json.',415);
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>maximum)throw fault('HUD_REQUEST_CAPACITY','The source request exceeds its intake limit.',413);chunks.push(chunk);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw fault('HUD_JSON_INVALID');}
}
export async function startHudServer({application,port=8458}={}){
  if(!application||!Number.isInteger(port)||port<0||port>65535)throw new TypeError('Open the HUD application and choose a local port.');
  const token=randomBytes(32).toString('hex');
  const assets=new Map(await Promise.all([
    ['/','index.html','text/html; charset=utf-8'],['/browser.mjs','browser.mjs','text/javascript; charset=utf-8'],
    ['/style.css','style.css','text/css; charset=utf-8']
  ].map(async([path,name,type])=>[path,{bytes:await readFile(new URL('./'+name,import.meta.url)),type}])));
  let origin,closing;
  const server=createServer((req,res)=>{
    const send=(status,value,type='application/json; charset=utf-8',name)=>{
      const output=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
      const headers={'content-type':type,'content-length':output.length,'cache-control':'no-store',
        'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
        'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
      if(name)headers['content-disposition']='attachment; filename="'+name.replace(/[^A-Za-z0-9._-]/g,'_')+'"';
      res.writeHead(status,headers);res.end(output);
    };
    const task=async()=>{
      if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')
        throw fault('HUD_LOCAL_ORIGIN_REQUIRED','Open the printed local HUD workspace address.',403);
      if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//'))throw fault('HUD_REQUEST_TARGET_INVALID');
      const url=new URL(req.url,origin),path=url.pathname;
      if(req.method==='GET'&&!url.search&&assets.has(path)){const asset=assets.get(path);return send(200,asset.bytes,asset.type);}
      const auth=req.headers.authorization??'',expected='Bearer '+token;
      if(auth.length!==expected.length||!timingSafeEqual(Buffer.from(auth),Buffer.from(expected)))
        throw fault('HUD_SESSION_REQUIRED','Open the original session link or enter its session key.',403);
      if(req.method==='GET'){
        if(path==='/api/status'){
          const params={};for(const key of ['limit','plansOffset','runsOffset','historyOffset'])if(url.searchParams.has(key))params[key]=Number(url.searchParams.get(key));
          return send(200,await application.status(params));
        }
        if(path==='/api/source-packet')return send(200,await application.sourcePacket(url.searchParams.get('releaseId')??undefined),'application/json; charset=utf-8','hud-public-source-packet.json');
        const p=await application.publisher();
        if(path==='/api/run')return send(200,await p.inspect(url.searchParams.get('id'),url.searchParams.get('query')??undefined));
        if(path==='/api/plan')return send(200,p.plan(Number(url.searchParams.get('id'))));
        if(path==='/api/buyer-offer')return send(200,await p.buyerOffer(url.searchParams.get('id'),url.searchParams.get('query')??''));
        if(path==='/api/source-file'){
          const file=await application.releaseFile(url.searchParams.get('releaseId'),url.searchParams.get('role'));
          return send(200,file.bytes,file.type,file.name);
        }
        throw fault('HUD_ROUTE_NOT_FOUND','The requested HUD page is unavailable.',404);
      }
      if(req.method!=='POST')throw fault('HUD_METHOD_NOT_ALLOWED','Use the requested workspace action.',405);
      const input=await body(req,['/api/import','/api/import-packet'].includes(path)?90*1024**2:262144);
      if(path==='/api/acquire')return send(201,await application.importRelease(input));
      if(path==='/api/import-packet'){
        const opened=openHudSourcePacket(input);
        return send(201,await application.importRelease(opened.metadata,{uploads:opened.uploads}));
      }
      if(path==='/api/import'){
        const uploads={};
        for(const item of releaseFiles(input.metadata?.fiscalYear)){
          const payload=input.uploads?.[item.role];
          if(typeof payload?.base64!=='string'||payload.base64.length>Math.ceil(item.maxBytes/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(payload.base64))
            throw fault('HUD_UPLOAD_INVALID','Upload the four original documents and their capture receipts.');
          const raw=Buffer.from(payload.base64,'base64');
          if(raw.toString('base64')!==payload.base64)throw fault('HUD_UPLOAD_ENCODING_INVALID');
          uploads[item.role]={raw,receipt:payload.receipt};
        }
        return send(201,await application.importRelease(input.metadata,{uploads}));
      }
      if(path==='/api/import/cancel')return send(200,application.cancelImport());
      if(path==='/api/import/discard')return send(200,await application.discardIncomplete(input.name));
      if(path==='/api/select')return send(200,await application.select(input));
      if(path==='/api/localities')return send(200,await application.localities(input));
      if(path==='/api/compare')return send(200,await application.comparison(input));
      if(path==='/api/export-selection'){
        const document=await application.exportSelection(input);
        return send(200,document,'application/json; charset=utf-8','hud-published-selection-'+document.release.fiscalYear+'.json');
      }
      if(path==='/api/publication-handoff')return send(200,await application.publicationHandoff(input.id),'application/json; charset=utf-8','hud-publication-handoff.json');
      if(path==='/api/plan')return send(201,await application.savePlan(input));
      if(path==='/api/extract'){const run=await application.extract(input.planId);return send(202,{id:run.id});}
      if(path==='/api/merchant/configure')return send(200,await application.configureMerchant(input));
      if(path==='/api/merchant/start')return send(200,await application.startMerchant(input));
      if(path==='/api/merchant/stop')return send(200,await application.stopMerchant());
      if(/^\/api\/releases\/(status|stage|activate|rollback|start|stop)$/.test(path))return send(200,await application.releaseLifecycle(path.split('/').at(-1),input));
      if(path==='/api/activate')return send(200,await application.activate(input));
      const actions={'/api/review':'review','/api/publish':'publish','/api/recover':'recover','/api/buyer-prepare':'prepareBuyer'};
      if(actions[path])return send(200,await application.operate(actions[path],input));
      if(path==='/api/cancel')return send(200,(await application.publisher()).cancel(input.id));
      throw fault('HUD_ROUTE_NOT_FOUND','The requested HUD action is unavailable.',404);
    };
    task().catch(error=>{
      if(!res.headersSent&&!res.destroyed)send([400,403,404,405,409,413,415,422,502].includes(error.status)?error.status:422,
        {error:error.code??'HUD_OPERATION_FAILED',message:error.code?error.message:'The operation could not complete. Reopen the same workspace and inspect its saved state.'});
      else if(!res.writableEnded)res.end();
    });
  });
  server.requestTimeout=180000;server.headersTimeout=15000;server.keepAliveTimeout=1000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;
  return {url:origin,sessionUrl:origin+'/#session='+token,token,server,application,close(){
    closing??=(async()=>{const stopping=new Promise((resolve,reject)=>{
      server.close(error=>error?reject(error):resolve());server.closeIdleConnections?.();
    });try{await application.close();}finally{await stopping;}})();return closing;
  }};
}
