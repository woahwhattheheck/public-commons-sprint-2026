import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {makeAgent} from './agent.mjs';
import {DEMO,inputs} from './engine.mjs';
import {analyze} from './robustness/compare.mjs';
import {planWeek,inspectWeek,weekCsv,weekCalendar} from './weekly.mjs';
import {openHouseholdWorkspace,digest,WorkspaceError} from './workspace.mjs';
import {createRequestDetail,requestPackage,previewReview,reconcileReview} from './week-review.mjs';
import {createHouseholdMCP,PROTOCOL} from './mcp.mjs';
import {renderWeekReviewPage} from './week-review-page.mjs';
import {createTariffService} from './tariff-service.mjs';
import {createEnergyService} from './energy-service.mjs';
import {inspectTariff,tariffRowsCSV,tariffHTML} from './tariff-source.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url));
const LIMIT=100;
function respond(res,status,body,extra={}){
  res.writeHead(status,{'cache-control':'no-store','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',...extra});
  res.end(JSON.stringify(body));
}
async function readBody(req,limit=40000){
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)throw new WorkspaceError('JSON body too large.',413);chunks.push(chunk);}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
}
function acceptsHost(req,boundHost){
  if(!['127.0.0.1','::1','localhost'].includes(boundHost))return true;
  const actualPort=req.socket.localPort,raw=req.headers.host;
  if(typeof raw!=='string'||!Number.isInteger(actualPort))return false;
  const hosts=['127.0.0.1','localhost','[::1]'];
  const suffixes=actualPort===80?['',':80']:[`:${actualPort}`];
  return hosts.some(local=>suffixes.some(port=>raw.toLowerCase()===local+port));
}
export function start({port=Number(process.env.PORT||'4181'),host=process.env.HOST||'127.0.0.1',
  workspace=process.env.GRIDKIND_WORKSPACE||join(homedir(),'.local','share','gridkind')}={}){
  const capturedSources=Object.fromEntries(['engine.mjs','agent.mjs','robustness/compare.mjs','weekly.mjs','week-review.mjs','week-review-page.mjs','exact-inputs.js','tariff-source.mjs','tariff-service.mjs','energy-source.mjs','energy-service.mjs'].map(name=>[name,readFileSync(join(ROOT,name))]));
  const sourcePins=Object.fromEntries(Object.entries(capturedSources).map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')]));
  const reviewSources=Object.freeze(Object.fromEntries(['engine.mjs','weekly.mjs','exact-inputs.js','week-review.mjs'].map(name=>[name,capturedSources[name].toString('utf8')])));
  const store=openHouseholdWorkspace({directory:workspace,sourcePins});
  const clients=new Map();
  function browser(req,res){
    const raw=(req.headers.cookie||'').match(/(?:^|;\s*)gridkind_sid=([a-f0-9-]{36})(?:;|$)/)?.[1];
    const id=raw&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(raw)?raw:randomUUID();
    store.ensure(id);
    if(raw!==id)res.setHeader('set-cookie',`gridkind_sid=${id}; HttpOnly; SameSite=Strict; Max-Age=31536000; Path=/`);
    return id;
  }
  function current(id){
    const saved=store.current(id),old=clients.get(id);
    if(old&&old.householdId===saved.id&&old.storageRevision===saved.revision){clients.delete(id);clients.set(id,old);return old;}
    if(clients.size>=LIMIT)clients.delete(clients.keys().next().value);
    const generation=randomUUID();
    const next={agent:makeAgent({scenario:saved.scenario,initialRevision:saved.initialRevision,namespace:saved.id+':'+generation}),
      generation,householdId:saved.id,storageRevision:saved.revision,planRecordId:null};
    clients.set(id,next);return next;
  }
  function view(id){
    const live=current(id);
    return {...live.agent.view(),workspace:{...store.view(id),generation:live.generation,activePlanRecordId:live.planRecordId}};
  }
  function check(id,body,required=false){
    const live=current(id),expected=body?.context;
    if(required&&!expected)throw new WorkspaceError('Read the current household before changing its saved work.',409);
    if(expected&&(expected.generation!==live.generation||expected.householdId!==live.householdId))
      throw new WorkspaceError('The active household was reopened or changed. Refresh before repeating this action.',409);
    store.assertRevision(id,expected?.revision);
    return live;
  }
  function committed(id,live){live.storageRevision=store.current(id).revision;clients.set(id,live);}
  function action(id,body){
    const live=check(id,body),candidate=live.agent.fork(),before=candidate.view();
    const {action,command,input}=body;
    const operations={propose:()=>candidate.offer(input),approve:()=>candidate.approve(body.id),execute:()=>candidate.execute(body.id),cancel:()=>candidate.cancel(),say:()=>candidate.say(command,input)};
    if(!Object.hasOwn(operations,action))throw Error('Unknown action');
    const after=operations[action]();
    if(digest(before)===digest(after))return view(id);
    const isPlan=after.proposal&&after.proposal.id!==before.proposal?.id;
    const kind=isPlan?'plan':!after.proposal?'cancel':after.receipt&&!before.receipt?'execution':'approval';
    const record=store.mutate(id,body.context?.revision,ctx=>{
      if(isPlan)ctx.setScenario(after.scenario);
      return ctx.record({kind,scenario:after.scenario,state:after,parentId:live.planRecordId,
        name:body.label||(kind==='plan'?'Schedule proposal':kind==='approval'?'Approved exact plan':kind==='execution'?'Simulated schedule receipt':'Cleared current plan'),
        detail:{action,command:action==='say'?command:null}});
    });
    live.agent=candidate;
    if(isPlan)live.planRecordId=record.id;
    if(!after.proposal)live.planRecordId=null;
    committed(id,live);return view(id);
  }
  function compare(id,body){
    const live=check(id,body),state=live.agent.view();
    if(!state.proposal||typeof body?.proposalId!=='string'||body.proposalId!==state.proposal.id)
      throw new WorkspaceError('This proposal has changed. Reload the current plan before comparing tariffs.',409);
    const report=analyze({base:state.scenario,alternatives:body.alternatives});
    const record=store.mutate(id,body.context?.revision,ctx=>ctx.record({kind:'comparison',scenario:state.scenario,state,
      parentId:live.planRecordId,name:body.label||'Alternative tariff comparison',detail:{proposalId:state.proposal.id,report,alternatives:body.alternatives}}));
    committed(id,live);
    return {proposalId:state.proposal.id,report,recordId:record.id,workspace:view(id).workspace};
  }
  function weekAction(id,body){
    const live=check(id,body,true);
    if(body.action==='plan'){
      const report=planWeek(body.input);
      const record=store.mutate(id,body.context.revision,ctx=>ctx.record({kind:'week',
        scenario:live.agent.view().scenario,name:report.input.name,detail:{report}}));
      committed(id,live);
      return {record,state:view(id)};
    }
    if(body.action==='adopt-day'){
      const original=store.record(id,live.householdId,body.recordId);
      if(original.kind!=='week'||!Number.isInteger(body.dayIndex)||body.dayIndex<0||body.dayIndex>6)throw Error('Choose a saved day.');
      const report=inspectWeek(original.detail.report),day=report.days[body.dayIndex];
      if(day.status!=='planned')throw Error('Plan this day successfully before opening it in the daily workspace.');
      const scenario=inputs(report.input.days[body.dayIndex].scenario);
      const candidate=makeAgent({scenario,initialRevision:store.current(id).initialRevision,namespace:live.householdId+':'+live.generation});
      const record=store.mutate(id,body.context.revision,ctx=>{
        ctx.setScenario(scenario);
        return ctx.record({kind:'restore',scenario,state:candidate.view(),parentId:original.id,
          name:'Weekly inputs · '+day.date,detail:{fromRecordId:original.id,dayIndex:body.dayIndex,date:day.date}});
      });
      live.agent=candidate;live.planRecordId=null;committed(id,live);
      return {record,state:view(id)};
    }
    throw Error('Unknown weekly operation.');
  }
  function weekReviewAction(id,body){
    try{return performWeekReviewAction(id,body);}
    catch(error){
      const status=error instanceof WorkspaceError?error.status:([400,401,403,404,409,413].includes(error.status)?error.status:400);
      if(body?.action==='apply-return'&&[400,409].includes(status)){
        // This second owned read follows the rejected attempt. Another process may
        // have committed after the initial lookup but before our revision check.
        // A failed read supplies no absence marker; the browser retains uncertainty.
        try{
          const householdId=body.context?.householdId;
          const previous=store.weekReviewOutcome(id,householdId,body.requestId,body.response?.responseId);
          if(previous){
            const detail=previous.returnRecord.detail;
            if(digest({targetRecordId:body.targetRecordId,response:body.response,choices:body.choices??{}})===
              digest({targetRecordId:detail.targetId,response:detail.response,choices:detail.choices}))
              return {...previous,householdId,state:view(id),replayed:true};
          }else{
            error.reviewOutcome={status:'not_committed',householdId,requestId:body.requestId,
              responseId:body.response.responseId,targetRecordId:body.targetRecordId,
              responseSha256:digest(body.response),choicesSha256:digest(body.choices??{})};
          }
        }catch{}
      }
      throw error;
    }
  }
  function performWeekReviewAction(id,body){
    // Reconcile a completed same-response transaction before its stale revision
    // can reject a response-loss retry. The original visitor must still own that household;
    // new mutations below require the current selected household/generation/revision.
    const context=body?.context;
    if(!context||typeof context.householdId!=='string')
      throw new WorkspaceError('Read the original household before continuing this weekly review.',409);
    if(body.action==='apply-return'){
      const previous=store.weekReviewOutcome(id,context.householdId,body.requestId,body.response?.responseId);
      if(previous){
        const detail=previous.returnRecord.detail;
        if(digest({targetRecordId:body.targetRecordId,response:body.response,choices:body.choices??{}})!==
          digest({targetRecordId:detail.targetId,response:detail.response,choices:detail.choices}))
          throw new WorkspaceError('This response identity already has a different retained outcome. Reopen the original result or create a new response edition.',409);
        return {...previous,householdId:context.householdId,state:view(id),replayed:true};
      }
    }
    const live=check(id,body,true);
    if(body.action==='request'){
      const base=store.record(id,live.householdId,body.baseRecordId);
      if(base.kind!=='week')throw new WorkspaceError('Choose a saved weekly plan.');
      const detail=createRequestDetail(base,{recipient:body.recipient,message:body.message});
      const record=store.mutate(id,context.revision,ctx=>ctx.record({kind:'week-request',
        scenario:base.scenario,parentId:base.id,name:('Review · '+base.label).slice(0,100),detail}));
      committed(id,live);
      return {record,bundle:requestPackage(record),state:view(id)};
    }
    if(!['preview-return','apply-return'].includes(body.action))throw new WorkspaceError('Unknown weekly review operation.');
    const request=store.record(id,live.householdId,body.requestId);
    const target=store.record(id,live.householdId,body.targetRecordId);
    if(request.kind!=='week-request'||target.kind!=='week')throw new WorkspaceError('Choose an original review request and saved weekly target.');
    if(body.action==='preview-return')return {preview:previewReview(request,target,body.response),state:view(id)};
    const reconciled=reconcileReview(request,target,body.response,body.choices??{});
    const result=store.mutate(id,context.revision,ctx=>{
      // All reads, duplicate detection and both linked records share one commit.
      const originalRequest=ctx.readRecord(request.id),originalTarget=ctx.readRecord(target.id);
      if(originalRequest.sha256!==request.sha256||originalTarget.sha256!==target.sha256)
        throw new WorkspaceError('The selected weekly review source changed.',409);
      if(ctx.reviewOutcome(request.id,body.response.responseId))throw new WorkspaceError('This response was already applied. Reopen its retained outcome.',409);
      const returnRecord=ctx.record({kind:'week-return',scenario:target.scenario,
        parentId:request.id,name:('Review returned · '+target.label).slice(0,100),
        detail:{requestId:request.id,requestSha256:request.sha256,targetId:target.id,targetSha256:target.sha256,
          response:body.response,responseSha256:digest(body.response),choices:body.choices??{},decisions:reconciled.decisions}});
      const record=ctx.record({kind:'week',scenario:target.scenario,parentId:returnRecord.id,
        name:reconciled.report.input.name,detail:{report:reconciled.report,review:{
          requestId:request.id,requestSha256:request.sha256,returnId:returnRecord.id,returnSha256:returnRecord.sha256,
          targetId:target.id,targetSha256:target.sha256,responseId:body.response.responseId,responseSha256:digest(body.response)}}});
      return {returnRecord,record};
    });
    committed(id,live);
    return {...result,householdId:live.householdId,state:view(id),replayed:false};
  }
  const tariffs=createTariffService({store,check,view,committed});
  const energy=createEnergyService({store,check,view,committed});
  function workspaceAction(id,body){
    let live=check(id,body,true);
    if(body.action==='preview-import')return {preview:store.inspectImport(body.bundle)};
    if(body.action==='import'){
      const result=store.importHousehold(id,body.context.revision,body.bundle,body.name);
      clients.delete(id);return {state:view(id),imported:result};
    }
    let candidate=live.agent,replace=false,newPlanRecord=live.planRecordId;
    const result=store.mutate(id,body.context.revision,ctx=>{
      if(body.action==='create'){
        const scenario=inputs(body.input??DEMO);ctx.create(body.name,scenario);
        ctx.record({kind:'scenario',scenario,name:'Initial household inputs'});replace=true;return;
      }
      if(body.action==='select'){ctx.select(body.householdId);replace=true;return;}
      if(body.action==='rename'){ctx.rename(body.name);return;}
      if(body.action==='save'){
        const scenario=inputs(body.input),before=live.agent.view();
        if(digest(scenario)!==digest(before.scenario)){
          candidate=makeAgent({scenario,initialRevision:store.current(id).initialRevision,namespace:live.householdId+':'+live.generation});newPlanRecord=null;
        }
        ctx.setScenario(scenario);
        return ctx.record({kind:'scenario',scenario,state:candidate.view(),name:body.name,parentId:live.planRecordId});
      }
      if(body.action==='restore'||body.action==='adopt-tariff'){
        const original=ctx.readRecord(body.recordId);
        let scenario=original.scenario;
        if(body.action==='adopt-tariff'){
          if(original.kind!=='comparison'||!Number.isInteger(body.alternativeIndex))throw Error('Choose a saved tariff alternative.');
          const alternative=original.detail.report.alternatives[body.alternativeIndex];
          if(!alternative)throw Error('Saved tariff alternative not found.');
          scenario=inputs({...scenario,prices:alternative.ratesUsdPerKwh});
        }
        candidate=makeAgent({scenario,initialRevision:store.current(id).initialRevision,namespace:live.householdId+':'+live.generation});newPlanRecord=null;
        ctx.setScenario(scenario);
        return ctx.record({kind:'restore',scenario,state:candidate.view(),parentId:original.id,
          name:body.name||(body.action==='adopt-tariff'?'Selected alternative tariff':'Restored saved inputs'),
          detail:{fromRecordId:original.id,alternativeIndex:body.action==='adopt-tariff'?body.alternativeIndex:null}});
      }
      throw Error('Unknown household operation.');
    });
    if(replace)clients.delete(id);
    else{live.agent=candidate;live.planRecordId=newPlanRecord;committed(id,live);}
    return {state:view(id),record:result};
  }
  function assistantView(id,endpoint){
    const selected=store.current(id);
    return {householdId:selected.id,householdName:selected.name,endpoint,protocolVersion:PROTOCOL,
      grants:store.assistant.list(id,selected.id),state:view(id)};
  }
  function assistantAction(id,body){
    if(body.action==='create')return {grant:store.assistant.create(id,body,()=>check(id,body,true)),state:view(id)};
    if(body.action==='revoke')return {grant:store.assistant.revoke(id,body,()=>check(id,body,true)),state:view(id)};
    throw new WorkspaceError('Choose create or revoke for the original assistant connection.');
  }
  function artifact(grant,args){
    let filename,mimeType,text;
    if(args.format==='household'){
      const bundle=store.exportHousehold(grant.owner,grant.householdId);
      filename='gridkind-household-'+grant.householdId.slice(0,8)+'.json';mimeType='application/json';text=JSON.stringify(bundle,null,2)+'\n';
    }else{
      const saved=store.record(grant.owner,grant.householdId,args.recordId);
      if(args.format==='week_csv'||args.format==='week_calendar'){
        if(saved.kind!=='week')throw new WorkspaceError('Choose an original saved week.');
        const report=inspectWeek(saved.detail.report),csv=args.format==='week_csv';
        filename='gridkind-week-'+report.input.startDate+'-'+saved.id.slice(0,8)+(csv?'.csv':'.ics');
        mimeType=csv?'text/csv':'text/calendar';
        text=csv?weekCsv(report):weekCalendar(report,{recordId:saved.id,createdAt:saved.createdAt});
      }else{
        if(saved.kind!=='week-request')throw new WorkspaceError('Choose an original weekly review request.');
        const bundle=requestPackage(saved),html=args.format==='offline_review';
        filename='gridkind-week-review-'+saved.id+(html?'.html':'.json');mimeType=html?'text/html':'application/json';
        text=html?renderWeekReviewPage(bundle,reviewSources):JSON.stringify(bundle,null,2)+'\n';
      }
    }
    const bytes=Buffer.byteLength(text);
    if(bytes>8*1024*1024)throw new WorkspaceError('The complete artifact exceeds the MCP response limit. Download it through the original browser export.',413);
    return {filename,mimeType,text,bytes,sha256:createHash('sha256').update(text).digest('hex'),householdId:grant.householdId};
  }
  const mcp=createHouseholdMCP({
    access:store.assistant,state:view,
    history:(grant,args)=>store.history(grant.owner,{householdId:grant.householdId,offset:args.offset??0,limit:args.limit??20}),
    record:(grant,id)=>store.record(grant.owner,grant.householdId,id),
    exportArtifact:artifact,
    checkpoint:owner=>{const previous=clients.get(owner),snapshot=previous?{...previous}:null;return()=>{if(snapshot)clients.set(owner,snapshot);else clients.delete(owner);};},
    dispatch:(grant,name,args)=>{
      const id=grant.owner,{requestId,...body}=args;
      if(name==='gridkind_propose')return action(id,{action:'propose',context:body.context,input:body.input,label:body.label});
      if(name==='gridkind_cancel')return action(id,{action:'cancel',context:body.context});
      if(name==='gridkind_simulate')return action(id,{action:'execute',context:body.context,id:body.planId});
      if(name==='gridkind_save_scenario')return workspaceAction(id,{...body,action:'save'});
      if(name==='gridkind_compare_tariffs')return compare(id,body);
      if(name==='gridkind_plan_week')return weekAction(id,{...body,action:'plan'});
      if(name==='gridkind_adopt_day')return weekAction(id,{...body,action:'adopt-day'});
      if(name==='gridkind_review_request')return weekReviewAction(id,{...body,action:'request'});
      if(name==='gridkind_review_preview'||name==='gridkind_review_apply'){
        const {requestRecordId,...rest}=body;
        return weekReviewAction(id,{...rest,requestId:requestRecordId,action:name==='gridkind_review_preview'?'preview-return':'apply-return'});
      }
      throw new WorkspaceError('Unknown assistant operation.');
    }
  });
  const server=http.createServer(async(req,res)=>{
    let id;
    try{
      if(!acceptsHost(req,host))return respond(res,403,{error:'Loopback demo Host mismatch'});
      const url=new URL(req.url,'http://localhost'),path=url.pathname;
      if(path==='/mcp'){
        if(!['127.0.0.1','::1','localhost'].includes(host))return respond(res,403,{error:'Assistant access is supported only on the original loopback server.'});
        return await mcp.handle(req,res,{readBody,origin:'http://'+req.headers.host});
      }
      if(req.method==='GET'&&['/','/week','/energy','/energy.js','/energy.css','/tariffs','/tariffs.js','/tariffs.css','/week-ui.js','/week.css','/week-review.mjs','/weekly.mjs','/engine.mjs','/app.js','/exact-inputs.js','/households.js','/robustness-ui.js','/scenario-handoff.js','/assistant.js','/style.css'].includes(path)){
        const file=path==='/'?'index.html':path==='/week'?'week.html':path==='/tariffs'?'tariffs.html':path==='/energy'?'energy.html':path.slice(1);
        const mime=path==='/'||path==='/week'||path==='/tariffs'||path==='/energy'?'text/html; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
        res.writeHead(200,{'content-type':mime,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
        return res.end(await readFile(join(ROOT,file)));
      }
      if(!path.startsWith('/api/'))return respond(res,404,{error:'Not found'});
      id=browser(req,res);
      if(req.method==='GET'){
        if(path==='/api/assistant'){
          if(!['127.0.0.1','::1','localhost'].includes(host))throw new WorkspaceError('Assistant access requires the loopback server.',403);
          return respond(res,200,assistantView(id,'http://'+req.headers.host+'/mcp'));
        }
        if(path==='/api/energy')return respond(res,200,store.catalogue(id,{householdId:url.searchParams.get('householdId')||undefined,kind:url.searchParams.get('kind')||'energy-source',offset:Number(url.searchParams.get('offset')||0)}));
        if(path==='/api/energy/outcome'){
          const householdId=url.searchParams.get('householdId'),requestId=url.searchParams.get('requestId');
          const record=store.energyOutcome(id,householdId,requestId);
          return respond(res,200,{householdId,requestId,record});
        }
        if(path==='/api/energy/export'){
          const result=energy.exportRecord(id,url.searchParams.get('householdId')||store.current(id).id,url.searchParams.get('recordId'),url.searchParams.get('format'));
          res.writeHead(200,{'content-type':result.mime+'; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','content-disposition':'attachment; filename="gridkind-energy-'+url.searchParams.get('recordId')+'.'+result.suffix+'"'});
          return res.end(result.text);
        }
        if(path==='/api/tariffs')return respond(res,200,store.catalogue(id,{householdId:url.searchParams.get('householdId')||undefined,kind:url.searchParams.get('kind')||'tariff',offset:Number(url.searchParams.get('offset')||0)}));
        if(path==='/api/tariffs/export'){
          const record=store.record(id,url.searchParams.get('householdId')||store.current(id).id,url.searchParams.get('recordId'));
          if(record.kind!=='tariff')throw new WorkspaceError('Choose a saved tariff source.');
          const edition=inspectTariff(record.detail.edition),format=url.searchParams.get('format');
          let text,mime,extension;
          if(format==='source'){text=edition.source.csv;mime='text/csv';extension='original.csv';}
          else if(format==='csv'){text=tariffRowsCSV(edition);mime='text/csv';extension='rows.csv';}
          else if(format==='json'){text=JSON.stringify(edition,null,2)+'\n';mime='application/json';extension='json';}
          else if(format==='html'){text=tariffHTML(record);mime='text/html';extension='html';}
          else throw new WorkspaceError('Choose original source, normalized CSV, source JSON or HTML.');
          res.writeHead(200,{'content-type':mime+'; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',
            'x-frame-options':'DENY','referrer-policy':'no-referrer','content-disposition':'attachment; filename="gridkind-tariff-'+record.id+'.'+extension+'"'});
          return res.end(text);
        }
        if(path==='/api/state')return respond(res,200,view(id));
        if(path==='/api/workspace/history')return respond(res,200,store.history(id,{householdId:url.searchParams.get('householdId')||undefined,offset:Number(url.searchParams.get('offset')||0)}));
        if(path==='/api/workspace/record')return respond(res,200,store.record(id,url.searchParams.get('householdId')||store.current(id).id,url.searchParams.get('id')));
        if(path==='/api/week-review/export'){
          const record=store.record(id,url.searchParams.get('householdId')||store.current(id).id,url.searchParams.get('recordId'));
          if(record.kind!=='week-request')throw new WorkspaceError('Choose a saved weekly review request.');
          const format=url.searchParams.get('format');
          if(!['json','html'].includes(format))throw new WorkspaceError('Choose JSON or the offline review HTML.');
          const bundle=requestPackage(record);
          if(format==='json')return respond(res,200,bundle,{'content-disposition':'attachment; filename="gridkind-week-review-'+record.id+'.json"'});
          const body=renderWeekReviewPage(bundle,reviewSources);
          res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
            'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',
            'content-disposition':'attachment; filename="gridkind-week-review-'+record.id+'.html"'});
          return res.end(body);
        }
        if(path==='/api/week/export'){
          const record=store.record(id,url.searchParams.get('householdId')||store.current(id).id,url.searchParams.get('recordId'));
          if(record.kind!=='week')throw Error('Choose a saved weekly plan.');
          const format=url.searchParams.get('format');
          if(!['csv','ics'].includes(format))throw Error('Choose CSV or calendar export.');
          const report=inspectWeek(record.detail.report);
          const text=format==='csv'?weekCsv(report):weekCalendar(report,{recordId:record.id,createdAt:record.createdAt});
          res.writeHead(200,{'content-type':format==='csv'?'text/csv; charset=utf-8':'text/calendar; charset=utf-8',
            'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',
            'content-disposition':'attachment; filename="gridkind-week-'+report.input.startDate+'-'+record.id.slice(0,8)+'.'+format+'"'});
          return res.end(text);
        }
        if(path==='/api/workspace/export'){
          const bundle=store.exportHousehold(id,url.searchParams.get('householdId')||undefined);
          return respond(res,200,bundle,{'content-disposition':`attachment; filename="gridkind-household-${bundle.payload.household.id.slice(0,8)}.json"`});
        }
      }
      if(req.method!=='POST'||!['/api/action','/api/robustness','/api/workspace','/api/week','/api/week-review','/api/assistant','/api/tariffs','/api/energy'].includes(path))return respond(res,405,{error:'Unsupported operation'});
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return respond(res,403,{error:'Cross-origin disabled'});
      if(path==='/api/assistant'&&!['127.0.0.1','::1','localhost'].includes(host))throw new WorkspaceError('Assistant access requires the loopback server.',403);
      const body=await readBody(req,(path==='/api/tariffs'||path==='/api/energy')?8*1024*1024:path==='/api/workspace'?8*1024*1024:path==='/api/week-review'?256*1024:40000);
      // Resolve current selection after the complete request is read. Every UI
      // mutation carries its saved revision, active household and live generation.
      const result=path==='/api/energy'?energy.action(id,body):path==='/api/tariffs'?tariffs.action(id,body):path==='/api/assistant'?assistantAction(id,body):path==='/api/action'?action(id,body):path==='/api/robustness'?compare(id,body):path==='/api/week'?weekAction(id,body):path==='/api/week-review'?weekReviewAction(id,body):workspaceAction(id,body);
      return respond(res,200,result);
    }catch(error){
      const status=error instanceof WorkspaceError?error.status:([400,401,403,404,409,413].includes(error.status)?error.status:400);
      let state;
      if(status===409&&id){try{state=view(id);}catch{}}
      return respond(res,status,{error:error instanceof Error?error.message:'Invalid request',...(state?{state}:{}),...(error?.reviewOutcome?{reviewOutcome:error.reviewOutcome}:{}),...(error?.tariffOutcome?{tariffOutcome:error.tariffOutcome}:{}),...(error?.energyOutcome?{energyOutcome:error.energyOutcome}:{})});
    }
  });
  server.once('close',()=>{mcp.close();clients.clear();store.close();});
  server.once('error',()=>store.close());
  server.listen(port,host,()=>console.log(`GridKind household workspace: http://${host}:${server.address().port}\nSaved work: ${store.directory}`));
  return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Every option requires a value.');
    if(arg==='--workspace')options.workspace=resolve(args[++i]);
    else if(arg==='--port'){
      options.port=Number(args[++i]);
      if(!Number.isInteger(options.port)||options.port<0||options.port>65535)throw Error('Port must be an integer from 0 to 65535.');
    }
    else if(arg==='--host')options.host=args[++i];
    else throw Error('Usage: node server.mjs [--workspace DIRECTORY] [--port PORT] [--host HOST]');
  }
  start(options);
}
