// MIT — Private operator desk over the original durable event-feed subscriber.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes,timingSafeEqual,randomUUID } from 'node:crypto';
import { openSubscription } from './subscriber.mjs';
import { need,safeCode } from '../node/store.mjs';

const equal=(left,right)=>typeof left==='string'&&Buffer.byteLength(left)===Buffer.byteLength(right)&&
  timingSafeEqual(Buffer.from(left),Buffer.from(right));
export async function serveWorkspace({directory,port=0}) {
  need(Number.isInteger(port)&&port>=0&&port<=65535,'FEED_WORKSPACE_PORT_INVALID');
  const subscription=await openSubscription(directory);
  const access=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  const controller=new AbortController();
  let origin,job=null,running=Promise.resolve(),closing=false;
  const html=await readFile(new URL('./workspace.html',import.meta.url));
  const send=(res,status,body,type='application/json; charset=utf-8')=>{
    res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
    res.end(type.startsWith('application/json')?JSON.stringify(body):body);
  };
  const start=(kind,action)=>{
    need(job?.state!=='RUNNING'&&!closing,'FEED_WORKSPACE_BUSY');
    job={id:randomUUID(),kind,state:'RUNNING',startedAt:new Date().toISOString()};
    const original=job;
    running=Promise.resolve().then(action).then(result=>{
      original.state='COMPLETE';original.result=result;original.finishedAt=new Date().toISOString();
    }).catch(error=>{
      original.state='ERROR';original.error=safeCode(error?.code,'EVENT_FEED_OPERATION_FAILED');
      original.finishedAt=new Date().toISOString();
    });
    return {id:job.id,kind,state:job.state};
  };
  const server=createServer(async(req,res)=>{
    try {
      need(req.headers.host===new URL(origin).host,'FEED_WORKSPACE_HOST_INVALID');
      const url=new URL(req.url,origin);
      const cookies=String(req.headers.cookie??'').split(';').map(value=>value.trim());
      const cookie=cookies.find(value=>value.startsWith('starforge_event_feed='))?.slice(21);
      if(req.method==='GET'&&url.pathname==='/'&&equal(url.searchParams.get('access'),access)) {
        res.writeHead(303,{'Location':'/','Set-Cookie':'starforge_event_feed='+access+'; HttpOnly; SameSite=Strict; Path=/',
          'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return;
      }
      if(!equal(cookie,access)){send(res,403,{error:'OPEN_WORKSPACE_LAUNCH_ADDRESS'});return;}
      if(req.method==='GET'&&url.pathname==='/'){send(res,200,html,'text/html; charset=utf-8');return;}
      if(req.method==='GET'&&url.pathname==='/api/state'){
        send(res,200,{subscription:subscription.inspect({limit:50}),job,csrf});return;
      }
      if(req.method==='POST'&&['/api/sync','/api/recover','/api/export'].includes(url.pathname)){
        need(req.headers.origin===origin&&equal(req.headers['x-feed-csrf'],csrf),'FEED_WORKSPACE_REQUEST_INVALID');
        let length=0;const chunks=[];
        for await(const chunk of req){length+=chunk.length;need(length<=8192,'FEED_WORKSPACE_BODY_LIMIT');chunks.push(chunk);}
        const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};
        const result=url.pathname==='/api/sync'
          ?start('sync',()=>subscription.collect({signal:controller.signal}))
          :url.pathname==='/api/recover'
            ?start('recover',()=>subscription.recover({signal:controller.signal}))
            :start('export',()=>subscription.exportEvents(body.destination));
        send(res,202,result);return;
      }
      send(res,404,{error:'FEED_WORKSPACE_ROUTE_NOT_FOUND'});
    }catch(error){
      if(!res.headersSent)send(res,400,{error:safeCode(error?.code,'FEED_WORKSPACE_REQUEST_FAILED')});
      else res.end();
    }
  });
  try {
    await new Promise((resolve,reject)=>{
      server.once('error',reject);server.listen(port,'127.0.0.1',resolve);
    });
  }catch(error){subscription.close();throw error;}
  origin='http://127.0.0.1:'+server.address().port;
  return {url:origin+'/?access='+access,server,
    async close(){
      if(closing)return;closing=true;controller.abort();
      await running;
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
      subscription.close();
    }};
}
