// MIT. Source console extension of the original local publisher and scheduler.
import { readFile } from 'node:fs/promises';
import { startPostgresPublisherServer } from '../postgres/publisher/server.mjs';
import { openPostgresSchedule } from '../postgres/publisher/schedule.mjs';
import { prepareEurostatRelease, stageEurostatRelease, activateEurostatRelease } from './release.mjs';
import { need, fault } from './model.mjs';
async function body(req) {
  need(/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''),'JSON_REQUIRED',undefined,415);
  const chunks=[];let size=0;
  for await(const b of req){size+=b.length;need(size<=48*1024*1024,'EUROSTAT_REQUEST_TOO_LARGE',undefined,413);chunks.push(b);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch(e){if(e.code)throw e;throw fault('JSON_INVALID');}
}
export async function startEurostatServer({workspace,port=8468}={}) {
  const assets=await Promise.all([['mjs','text/javascript; charset=utf-8'],['css','text/css; charset=utf-8']].map(async([ext,type])=>
    ({path:'/eurostat.'+ext,bytes:await readFile(new URL('./public/eurostat.'+ext,import.meta.url)),type})));
  const schedule=await openPostgresSchedule({publisher:workspace.publisher});
  try{
    const service=await startPostgresPublisherServer({publisher:workspace.publisher,port,schedule,ownsPublisher:false,
      extension:{assets,head:'<link rel="stylesheet" href="/eurostat.css"><script type="module" src="/eurostat.mjs"></script>',
        async handle({req,url,send}){
          if(!url.pathname.startsWith('/api/eurostat/'))return false;
          const action=url.pathname.slice('/api/eurostat/'.length),get=k=>url.searchParams.get(k);
          let result;
          if(req.method==='GET'){
            if(action==='status')result=await workspace.status();
            else if(action==='capture'){const c=await workspace.capture(get('id'));result={capture:c.capture,captureSha256:c.captureSha256};}
            else if(action==='briefing'){
              const source=await workspace.publisher.source(),q=get('query')?source.config.queries[get('query')]:null;
              if(get('query'))need(q&&q.captureId===get('id'),'EUROSTAT_QUERY_CAPTURE_MISSING');
              const r=await workspace.briefing(get('id'),q?{selection:q.selection,includeMissing:q.includeMissing,review:q.review}:{});
              if(get('format')==='html'){send(200,Buffer.from(r.html),'text/html; charset=utf-8');return true;}
              if(get('format')==='csv'){send(200,Buffer.from(r.csv),'text/csv; charset=utf-8');return true;}
              result=r.report;
            }
            else if(action==='response'){const c=await workspace.capture(get('id'));send(200,c.body,'application/json');return true;}
            else if(action==='cells')result=await workspace.cells(get('id'),{offset:Number(get('offset')??0),limit:Number(get('limit')??100),
              selection:get('selection')?JSON.parse(get('selection')):{},includeMissing:get('includeMissing')!=='false'});
            else if(action==='compare')result=await workspace.compare(get('before'),get('after'),{offset:Number(get('offset')??0),limit:Number(get('limit')??100)});
            else if(action==='acquisition')result=await workspace.inspectAcquisition(get('id'));
            else if(action==='handover')result=await workspace.exportSources();
            else throw fault('EUROSTAT_ROUTE_NOT_FOUND',undefined,404);
          }else if(req.method==='POST'){
            const input=await body(req);
            if(action==='import'){need(typeof input.responseText==='string','EUROSTAT_RESPONSE_REQUIRED');
              result=await workspace.importCapture({...input,body:Buffer.from(input.responseText,'utf8')});}
            else if(action==='acquire')result=await workspace.acquire(input);
            else if(action==='query')result=await workspace.saveQuery(input);
            else if(action==='plan-template')result=await workspace.planTemplate(input);
            else if(action==='handover')result=await workspace.importSources(input);
            else if(action==='release-prepare')result=await prepareEurostatRelease({...input,publisher:workspace.publisher});
            else if(action==='release-stage')result=await stageEurostatRelease(input);
            else if(action==='release-activate')result=await activateEurostatRelease(input.releaseDirectory,input.id,input.options);
            else throw fault('EUROSTAT_ROUTE_NOT_FOUND',undefined,404);
          }else throw fault('METHOD_NOT_ALLOWED',undefined,405);
          send(200,result);return true;
        }}});
    schedule.start();
    let closing;
    return {...service,async close(){return closing??= (async()=>{await service.close();await schedule.close();await workspace.close();})();}};
  }catch(e){await schedule.close();throw e;}
}
