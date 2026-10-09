import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {reconcile} from './reconcile.mjs';
import {fetchBatch} from './paypal.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const FIXTURE=JSON.parse(await readFile(resolve(ROOT,'fixtures/payout_batch.json'),'utf8'));
const PUBLIC={
 '/':'index.html', '/app.js':'app.js', '/styles.css':'styles.css'
};
const TYPES={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
function safeJson(value){return JSON.stringify(value,(key,val)=>typeof val==='bigint'?val.toString():val);}
function respond(res,status,body,type='application/json; charset=utf-8'){
  const content=typeof body==='string'?body:safeJson(body);
  res.writeHead(status,{
    'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'X-Frame-Options':'DENY'
  });res.end(content);
}
async function jsonBody(request){
  let body='';for await(const chunk of request){
    body+=chunk.toString('utf8');
    if(Buffer.byteLength(body)>16_384)throw new Error('request too large');
  }
  const parsed=JSON.parse(body||'{}');
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('invalid request object');
  return parsed;
}
function exportCSV(result,cases){
  const cells=[['batch_id','item_id','status','currency','amount','receiver_masked','review_status','flags','evidence_sha256']];
  for(const item of result.items){
    cells.push([result.id,item.itemId,item.status,item.currency,item.amount,item.receiver,cases.get(item.caseId)?.state||'open',item.flags.join(';'),result.evidenceHash]);
  }
  const esc=value=>`"${String(value??'').replace(/"/g,'""')}"`;
  return cells.map(row=>row.map(esc).join(',')).join('\n')+'\n';
}
export async function createServer({fixture=FIXTURE}={}){
  let result=reconcile([fixture],{source:'fixture'});const cases=new Map();let version=1;
  let busy=false;const audit=[];
  function refresh(next){
    const old=result;result=next;version++;
    const knownIds=new Set(next.items.map(x=>x.caseId));
    for(const id of [...cases.keys()]){
      if(!knownIds.has(id)||old.evidenceHash!==next.evidenceHash)cases.delete(id);
    }
  }
  return http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url||'/', 'http://127.0.0.1');
      if(req.method==='GET'&&url.pathname==='/api/report')return respond(res,200,{...result,version,model:'locally-trained Multinomial Naive Bayes',cases:Object.fromEntries(cases),audit:audit.slice(-40)});
      if(req.method==='GET'&&url.pathname==='/api/export.csv'){
        return respond(res,200,exportCSV(result,cases),'text/csv; charset=utf-8');
      }
      if(req.method==='POST'&&url.pathname==='/api/load-demo'){
        if(busy)return respond(res,409,{error:'sync in progress'});
        refresh(reconcile([fixture],{source:'fixture'}));return respond(res,200,{ok:true,version});
      }
      if(req.method==='POST'&&url.pathname==='/api/sync'){
        if(busy)return respond(res,409,{error:'sync in progress'});
        // Reserve the one sync slot before awaiting any potentially streamed request body.
        busy=true;
        try{
          const body=await jsonBody(req);
          if(typeof body.batchId!=='string')return respond(res,400,{error:'batchId string required'});
          const pages=await fetchBatch(body.batchId);
          refresh(reconcile(pages,{source:'PayPal sandbox read-only API'}));
          return respond(res,200,{ok:true,version});
        }finally{busy=false;}
      }
      if(req.method==='POST'&&url.pathname==='/api/decision'){
        // A sync can replace the reviewed evidence after this handler accepts a decision.
        if(busy)return respond(res,409,{error:'sync in progress; review after refreshed evidence'});
        const body=await jsonBody(req);
        // The sync may have started while a partially sent decision body was read.
        if(busy)return respond(res,409,{error:'sync in progress; review after refreshed evidence'});
        if(!Number.isSafeInteger(body.version)||body.version!==version)return respond(res,409,{error:'stale report version; refresh and review again'});
        if(!['acknowledged','escalated','open'].includes(body.state))return respond(res,400,{error:'invalid review state'});
        const item=result.items.find(x=>x.caseId===body.caseId);
        if(!item)return respond(res,404,{error:'case not found'});
        const now=new Date().toISOString();
        const prior=cases.get(item.caseId)?.state||'open';
        const event={caseId:item.caseId,batchId:result.id,itemId:item.itemId,from:prior,to:body.state,at:now,evidenceHash:result.evidenceHash};
        cases.set(item.caseId,{state:body.state,changedAt:now,evidenceHash:result.evidenceHash});
        audit.push(event);if(audit.length>100)audit.shift();
        version++;
        return respond(res,200,{ok:true,version,event});
      }
      if(req.method==='GET'&&Object.hasOwn(PUBLIC,url.pathname)){
        const filename=PUBLIC[url.pathname];
        const ext=filename.slice(filename.lastIndexOf('.'));
        const content=await readFile(resolve(ROOT,'public',filename),'utf8');
        return respond(res,200,content,TYPES[ext]);
      }
      respond(res,404,{error:'not found'});
    }catch(error){
      // Fail closed. No provider responses/secrets forwarded to browser.
      const message=String(error?.message||'unexpected error').slice(0,160);
      respond(res,message.startsWith('PayPal')?502:400,{error:message});
    }
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=await createServer();
  const port=Number(process.env.PORT||8787);
  server.listen(port,'127.0.0.1',()=>console.log(`DisburseLens fixture UI: http://127.0.0.1:${port}`));
}
