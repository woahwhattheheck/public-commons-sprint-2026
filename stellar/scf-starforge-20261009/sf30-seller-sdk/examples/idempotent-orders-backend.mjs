// MIT. Runnable local merchant example with actual durable order mutations.
// The example backend owns business idempotency; SF30 still owns payment handling.
import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, openSync, closeSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalOperationJSON } from '../upstream-idempotency.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const KEY = /^sf30_[a-f0-9]{64}$/;
const headers = {'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'};
function send(res,status,body) {res.writeHead(status,headers);res.end(typeof body==='string'?body:JSON.stringify(body));}
function authorized(value,expected) {
  if(typeof value!=='string')return false;
  const a=Buffer.from(value),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}

export async function startOrderBackend({stateDir,port=8426,authorization=process.env.MERCHANT_BACKEND_AUTH}={}) {
  if(typeof stateDir!=='string'||resolve(stateDir)!==stateDir||typeof authorization!=='string'||!authorization||
      !Number.isInteger(port)||port<0||port>65535)throw new TypeError('Private stateDir, backend authorization and valid port required');
  const info=lstatSync(stateDir);
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0||realpathSync(stateDir)!==stateDir)throw new TypeError('Private canonical backend directory required');
  const path=join(stateDir,'merchant.sqlite');
  try{closeSync(openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600));}
  catch(error){if(error.code!=='EEXIST')throw error;}
  const dbInfo=lstatSync(path);
  if(!dbInfo.isFile()||dbInfo.isSymbolicLink()||(dbInfo.mode&0o077)!==0)throw new TypeError('Private backend database required');
  const {DatabaseSync}=await import('node:sqlite');
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS orders(operation_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,
      order_id TEXT NOT NULL UNIQUE,response TEXT NOT NULL);`);
  const snapshot=()=>({orders:db.prepare('SELECT COUNT(*) AS n FROM orders').get().n});
  const server=createServer((req,res)=>{
    Promise.resolve().then(async()=>{
      if(!authorized(req.headers.authorization,authorization))return send(res,401,{error:'BACKEND_AUTH_REQUIRED'});
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.method==='GET'&&url.pathname==='/v1/orders'&&!url.search)return send(res,200,snapshot());
      if(req.method==='GET'&&url.pathname.startsWith('/v1/operations/')&&!url.search) {
        const key=url.pathname.slice('/v1/operations/'.length);
        if(!KEY.test(key))return send(res,400,{error:'OPERATION_KEY_INVALID'});
        const row=db.prepare('SELECT response FROM orders WHERE operation_key=?').get(key);
        if(!row)return send(res,404,{error:'ORDER_NOT_FOUND'});
        return send(res,200,{status:201,headers,bodyBase64:Buffer.from(row.response).toString('base64')});
      }
      if(req.method!=='POST'||url.pathname!=='/v1/orders'||url.search)return send(res,404,{error:'NOT_FOUND'});
      const operationKey=req.headers['idempotency-key'];
      if(!KEY.test(operationKey??''))return send(res,400,{error:'BACKEND_IDEMPOTENCY_KEY_REQUIRED'});
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))return send(res,415,{error:'JSON_REQUIRED'});
      let size=0;const chunks=[];
      for await(const part of req){size+=part.length;if(size>1048576)return send(res,413,{error:'ORDER_TOO_LARGE'});chunks.push(part);}
      let body;
      try{body=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{return send(res,400,{error:'ORDER_JSON_INVALID'});}
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='quantity,sku'||
          typeof body.sku!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(body.sku)||!Number.isInteger(body.quantity)||body.quantity<1||body.quantity>1000) {
        return send(res,422,{error:'ORDER_FIELDS_INVALID'});
      }
      const requestHash=sha(canonicalOperationJSON(body));
      db.exec('BEGIN IMMEDIATE');
      let existing,response;
      try{
        existing=db.prepare('SELECT request_hash,response FROM orders WHERE operation_key=?').get(operationKey);
        if(existing&&existing.request_hash!==requestHash){db.exec('ROLLBACK');return send(res,409,{error:'BACKEND_OPERATION_CONFLICT'});}
        if(existing)response=existing.response;
        else{
          const orderId=randomUUID();
          response=JSON.stringify({orderId,sku:body.sku,quantity:body.quantity,state:'RECORDED'});
          db.prepare('INSERT INTO orders(operation_key,request_hash,order_id,response) VALUES(?,?,?,?)').run(operationKey,requestHash,orderId,response);
        }
        db.exec('COMMIT');
      }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
      return send(res,201,response);
    }).catch(()=>{if(!res.headersSent)send(res,500,{error:'BACKEND_OPERATION_FAILED'});else res.destroy();});
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});
  let closing;
  const close=()=>closing??=new Promise((done,fail)=>{
    server.close(error=>{db.close();error?fail(error):done();});server.closeIdleConnections?.();
  });
  return {server,url:`http://127.0.0.1:${server.address().port}`,snapshot,close};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=new Map();
  try{
    for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!['--state-dir','--port'].includes(key)||args.has(key)||!process.argv[i+1])throw new TypeError('Usage: node idempotent-orders-backend.mjs --state-dir PRIVATE_DIRECTORY [--port 8426]');args.set(key,process.argv[i+1]);}
    const session=await startOrderBackend({stateDir:args.has('--state-dir')?resolve(args.get('--state-dir')):undefined,port:Number(args.get('--port')??8426)});
    process.stdout.write(JSON.stringify({url:session.url,product:'local-example-order-backend',orders:session.snapshot().orders})+'\n');
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>session.close().catch(()=>{process.exitCode=1;}));
  }catch(error){process.stderr.write(error instanceof TypeError?error.message+'\n':'ORDER_BACKEND_START_FAILED\n');process.exitCode=1;}
}
