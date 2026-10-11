import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {reconcile} from './reconcile.mjs';
import {fetchBatch} from './paypal.mjs';
import {exportCasebook,planCasebookRestore,reviewFields} from './casebook.mjs';
import {analyzeSnapshots} from '../longitudinal/analysis.mjs';
import {renderCSV,renderHTML} from '../longitudinal/render.mjs';
import {createObservationWorkspace,identifyObservation,makeObservation,appendAudit,
  MAX_OBSERVATIONS,MAX_SNAPSHOT_BYTES} from './observations.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const FIXTURE=JSON.parse(await readFile(resolve(ROOT,'fixtures/payout_batch.json'),'utf8'));
const ORIGINAL_FIXTURE_HASH=reconcile([FIXTURE]).evidenceHash;
const PUBLIC={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css'};
const TYPES={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const MUTATIONS=new Set(['/api/casebook/preview','/api/casebook/restore','/api/load-demo',
  '/api/sync','/api/decision','/api/select','/api/observations/import','/api/observations/remove']);
function fail(message,status=400){const error=new Error(message);error.status=status;throw error;}
function safeJson(value){return JSON.stringify(value,(key,val)=>typeof val==='bigint'?val.toString():val);}
function respond(res,status,body,type='application/json; charset=utf-8'){
  const content=typeof body==='string'?body:safeJson(body);
  res.writeHead(status,{
    'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'
  });res.end(content);
}
async function jsonBody(request,limit=16_384){
  if(request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')fail('application/json request required');
  const chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>limit)fail('request too large',413);chunks.push(chunk);}
  let parsed;try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{fail('request must contain valid JSON');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail('invalid request object');
  return parsed;
}
function exportCSV(result,cases,observationId){
  const cells=[['observation_id','batch_id','item_id','status','currency','amount','receiver_masked',
    'review_status','owner','note','changed_at','flags','evidence_sha256']];
  for(const item of result.items){
    const review=cases.get(item.caseId);
    cells.push([observationId,result.id,item.itemId,item.status,item.currency,item.amount,item.receiver,
      review?.state||'open',review?.owner||'',review?.note||'',review?.changedAt||'',item.flags.join(';'),result.evidenceHash]);
  }
  const esc=value=>{
    let text=String(value??'');if(/^[\s]*[=+@-]/.test(text)||/^[\t\r]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  return cells.map(row=>row.map(esc).join(',')).join('\n')+'\n';
}
function exampleSnapshot(fixture){
  const time=fixture.batch_header?.time_created;
  const capturedAt=typeof time==='string'&&Number.isFinite(Date.parse(time))?new Date(time).toISOString():'2026-10-09T09:00:00.000Z';
  return {schema:'disburselens-payout-snapshot/v1',source:'fictional example',capturedAt,pages:[fixture]};
}

export async function createServer({fixture=FIXTURE,dataDirectory}={}){
  const demo=exampleSnapshot(fixture);
  const workspace=await createObservationWorkspace({directory:dataDirectory,initialSnapshot:demo});
  let busy=false,closing=false;
  const current=()=>workspace.state.observations.find(row=>row.id===workspace.state.selectedId);
  function findObservation(id){
    if(typeof id!=='string'||!/^[0-9a-f]{64}$/.test(id))fail('valid observation ID required');
    const observation=workspace.state.observations.find(row=>row.id===id);
    if(!observation)fail('Observation not found',404);return observation;
  }
  function metadata(observation){
    const report=workspace.report(observation.id),caseCounts={open:0,acknowledged:0,escalated:0};
    for(const item of report.items)caseCounts[observation.cases[item.caseId]?.state??'open']++;
    return {id:observation.id,batchId:report.id,source:report.source,capturedAt:observation.snapshot.capturedAt,
      evidenceHash:report.evidenceHash,importedAt:observation.importedAt,itemCount:report.items.length,caseCounts};
  }
  function versionCheck(value){
    if(!Number.isSafeInteger(value)||value!==workspace.state.version)fail('stale report version; refresh and review again',409);
  }
  function viewCheck(url){
    if(url.searchParams.has('observationId')||url.searchParams.has('version')){
      versionCheck(Number(url.searchParams.get('version')));
      if(url.searchParams.get('observationId')!==workspace.state.selectedId)fail('Selected observation changed; refresh before exporting',409);
    }
  }
  function reportView(){
    const observation=current();return {...workspace.report(),version:workspace.state.version,
      observationId:observation.id,observation:metadata(observation),storage:workspace.status(),
      model:'locally-trained Multinomial Naive Bayes',cases:observation.cases,audit:observation.audit.slice(-40),
      historyDropped:observation.historyDropped};
  }
  function caseView(caseId){
    const observation=current(),report=workspace.report(),item=report.items.find(row=>row.caseId===caseId);
    if(!item)fail('case not found',404);
    const original=observation.snapshot.pages.flatMap(page=>page.items).find(row=>row.payout_item_id===item.itemId);
    const review=observation.cases[item.caseId];
    return {schema:'disburselens-case-review/v1',observationId:observation.id,version:workspace.state.version,
      observation:metadata(observation),item,
      sourceRecord:{itemId:original.payout_item_id,senderItemId:original.payout_item?.sender_item_id??'',
        transactionStatus:original.transaction_status??null,receiverMasked:item.receiver,
        currency:original.payout_item?.amount?.currency??null,amount:original.payout_item?.amount?.value??null,
        note:String(original.payout_item?.note||''),scoredNote:item.note,scoredCharacterLimit:320},
      review:{state:review?.state??'open',...reviewFields(review??{}),changedAt:review?.changedAt??null,evidenceHash:report.evidenceHash},
      history:observation.audit.filter(event=>event.caseId===item.caseId),historyDropped:observation.historyDropped};
  }
  async function save(next){next.version=workspace.state.version+1;await workspace.commit(next);}
  async function selectSnapshot(snapshot){
    const {id}=identifyObservation(snapshot),next=structuredClone(workspace.state);
    const existing=next.observations.find(row=>row.id===id);
    if(!existing){
      if(next.observations.length>=MAX_OBSERVATIONS)fail('Workspace has 128 saved observations; export and remove an older observation before adding another',409);
      next.observations.push(makeObservation(snapshot));
    }
    next.selectedId=id;await save(next);
    return {ok:true,version:workspace.state.version,observationId:id,reused:!!existing};
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const port=server.address()?.port;
      const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]);
      if(!hosts.has(req.headers.host)||(req.headers.origin&&!hosts.has(req.headers.origin.replace(/^http:\/\//,''))))
        return respond(res,403,{error:'local same-origin request required'});
      const url=new URL(req.url||'/','http://127.0.0.1');
      if(req.method==='GET'&&url.pathname==='/api/report')return respond(res,200,reportView());
      if(req.method==='GET'&&url.pathname==='/api/observations'){
        return respond(res,200,{version:workspace.state.version,selectedId:workspace.state.selectedId,storage:workspace.status(),
          observations:workspace.state.observations.map(metadata).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt)||b.importedAt.localeCompare(a.importedAt))});
      }
      if(req.method==='GET'&&url.pathname==='/api/compare'){
        const before=findObservation(url.searchParams.get('from')),after=findObservation(url.searchParams.get('to'));
        const staleHours=url.searchParams.has('staleHours')?Number(url.searchParams.get('staleHours')):24;
        const format=url.searchParams.get('format')??'json';
        if(!['json','csv','html'].includes(format))fail('Comparison format must be json, csv or html');
        const comparison={...analyzeSnapshots({before:before.snapshot,after:after.snapshot,staleHours}),baselineId:before.id,followupId:after.id};
        if(format==='json')return respond(res,200,comparison);
        res.setHeader('Content-Disposition',`attachment; filename="DisburseLens-comparison-${before.id.slice(0,8)}-${after.id.slice(0,8)}-${staleHours}h.${format}"`);
        return respond(res,200,format==='csv'?renderCSV(comparison):renderHTML(comparison),format==='csv'?'text/csv; charset=utf-8':'text/html; charset=utf-8');
      }
      const observationDownload=/^\/api\/observations\/([0-9a-f]{64})\.json$/.exec(url.pathname);
      if(req.method==='GET'&&observationDownload){
        const observation=findObservation(observationDownload[1]);
        res.setHeader('Content-Disposition',`attachment; filename="DisburseLens-observation-${observation.id.slice(0,12)}.json"`);
        return respond(res,200,observation.snapshot);
      }
      const caseMatch=/^\/api\/cases\/([0-9a-f]{16})(\.json)?$/.exec(url.pathname);
      if(req.method==='GET'&&caseMatch){
        viewCheck(url);
        if(caseMatch[2])res.setHeader('Content-Disposition',`attachment; filename="DisburseLens-case-${caseMatch[1]}.json"`);
        return respond(res,200,caseView(caseMatch[1]));
      }
      if(req.method==='GET'&&url.pathname==='/api/export.csv'){
        viewCheck(url);res.setHeader('Content-Disposition','attachment; filename="DisburseLens-review.csv"');
        return respond(res,200,exportCSV(workspace.report(),new Map(Object.entries(current().cases)),current().id),'text/csv; charset=utf-8');
      }
      if(req.method==='GET'&&url.pathname==='/api/casebook.json'){
        viewCheck(url);res.setHeader('Content-Disposition','attachment; filename="DisburseLens-casebook.json"');
        return respond(res,200,exportCasebook({result:workspace.report(),cases:new Map(Object.entries(current().cases)),version:workspace.state.version}));
      }
      if(req.method==='POST'&&MUTATIONS.has(url.pathname)){
        if(closing)fail('Workspace is closing',503);
        if(busy)fail('workspace update in progress; review after refreshed evidence',409);
        // Reserve before reading streamed bodies, provider reads or durable writes.
        // Every operation retains its reviewed report version through that await.
        busy=true;
        try{
          const limit=url.pathname==='/api/observations/import'?MAX_SNAPSHOT_BYTES+1024:
            url.pathname.startsWith('/api/casebook/')?262144+1024:16384;
          const body=await jsonBody(req,limit);versionCheck(body.version);
          if(url.pathname==='/api/load-demo')return respond(res,200,await selectSnapshot(demo));
          if(url.pathname==='/api/observations/import')return respond(res,200,await selectSnapshot(body.snapshot));
          if(url.pathname==='/api/sync'){
            if(typeof body.batchId!=='string')fail('batchId string required');
            const pages=await fetchBatch(body.batchId);
            const snapshot={schema:'disburselens-payout-snapshot/v1',source:'PayPal sandbox read-only API',capturedAt:new Date().toISOString(),pages};
            return respond(res,200,await selectSnapshot(snapshot));
          }
          if(url.pathname==='/api/select'){
            findObservation(body.observationId);const next=structuredClone(workspace.state);next.selectedId=body.observationId;await save(next);
            return respond(res,200,{ok:true,version:workspace.state.version,observationId:next.selectedId});
          }
          if(url.pathname==='/api/observations/remove'){
            findObservation(body.observationId);
            if(workspace.state.observations.length===1)fail('Keep at least one observation; load another source before removing this one',409);
            const next=structuredClone(workspace.state);next.observations=next.observations.filter(row=>row.id!==body.observationId);
            if(next.selectedId===body.observationId)next.selectedId=[...next.observations].sort((a,b)=>b.snapshot.capturedAt.localeCompare(a.snapshot.capturedAt)||b.importedAt.localeCompare(a.importedAt))[0].id;
            await save(next);return respond(res,200,{ok:true,version:workspace.state.version,observationId:next.selectedId,removedId:body.observationId});
          }
          const result=workspace.report(),observation=current(),cases=new Map(Object.entries(observation.cases)),now=new Date().toISOString();
          if(url.pathname.startsWith('/api/casebook/')){
            const plan=planCasebookRestore(body.casebook,{result,cases,version:workspace.state.version,
              expectedVersion:body.version,now,legacyFixtureEvidenceHash:ORIGINAL_FIXTURE_HASH});
            if(url.pathname==='/api/casebook/preview')return respond(res,200,plan.summary);
            const changes=plan.summary.changes;
            if(changes.length){
              const next=structuredClone(workspace.state),record=next.observations.find(row=>row.id===observation.id);
              record.cases=Object.fromEntries(plan.nextCases);
              appendAudit(record,changes.map(change=>({
                ...change,batchId:result.id,itemId:result.items.find(item=>item.caseId===change.caseId).itemId,
                ...reviewFields(record.cases[change.caseId]),observationId:record.id,at:now,evidenceHash:result.evidenceHash,via:'casebook_import'
              })));
              await save(next);
            }
            return respond(res,200,{ok:true,version:workspace.state.version,changed:changes.length,counts:plan.summary.counts});
          }
          if(url.pathname==='/api/decision'){
            if(!['acknowledged','escalated','open'].includes(body.state))fail('invalid review state');
            const item=result.items.find(row=>row.caseId===body.caseId);if(!item)fail('case not found',404);
            const previous=cases.get(item.caseId),from=previous?.state??'open',fields=reviewFields(body,previous??{});
            if(from===body.state&&fields.owner===(previous?.owner??'')&&fields.note===(previous?.note??''))
              return respond(res,200,{ok:true,version:workspace.state.version,unchanged:true});
            const next=structuredClone(workspace.state),record=next.observations.find(row=>row.id===observation.id);
            const event={caseId:item.caseId,batchId:result.id,itemId:item.itemId,observationId:record.id,from,to:body.state,
              ...fields,previousOwner:previous?.owner??'',previousNote:previous?.note??'',at:now,evidenceHash:result.evidenceHash,via:'local_review'};
            record.cases[item.caseId]={state:body.state,...fields,changedAt:now,evidenceHash:result.evidenceHash};
            appendAudit(record,[event]);await save(next);
            return respond(res,200,{ok:true,version:workspace.state.version,event});
          }
        }finally{busy=false;}
      }
      if(req.method==='GET'&&Object.hasOwn(PUBLIC,url.pathname)){
        const filename=PUBLIC[url.pathname],ext=filename.slice(filename.lastIndexOf('.'));
        return respond(res,200,await readFile(resolve(ROOT,'public',filename),'utf8'),TYPES[ext]);
      }
      respond(res,404,{error:'not found'});
    }catch(error){
      const status=Number.isInteger(error?.status)?error.status:String(error?.message||'').startsWith('PayPal')?502:400;
      const message=error?.code?'Local workspace I/O failed; refresh and check local storage':String(error?.message||'unexpected error').slice(0,180);
      if(!res.headersSent)respond(res,status,{error:message});else res.destroy();
    }
  });
  const close=server.close.bind(server);
  server.close=function(callback){
    closing=true;
    close(async error=>{
      try{await workspace.close();}catch(storageError){error??=storageError;}
      if(callback)callback(error);else if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')server.emit('error',error);
    });return server;
  };
  server.once('error',()=>{void workspace.close().catch(()=>{});});
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);let dataDirectory=process.env.DISBURSELENS_DATA_DIR||undefined;
  if(args.length){
    if(args.length!==2||args[0]!=='--data-dir'||!args[1].trim())throw new Error('Usage: node src/server.mjs [--data-dir private-local-directory]');
    dataDirectory=args[1];
  }
  const port=Number(process.env.PORT||8787);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an integer from 1 to 65535');
  const server=await createServer({dataDirectory});
  server.on('error',()=>{console.error('DisburseLens server could not keep its local listener open');process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`DisburseLens merchant workspace: http://127.0.0.1:${port} (${dataDirectory?'persistent local storage':'memory storage'})`));
  let stopping=false;
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
    if(stopping)return;stopping=true;server.close(error=>{if(error){console.error('DisburseLens could not close its local workspace cleanly');process.exitCode=1;}});
  });
}
