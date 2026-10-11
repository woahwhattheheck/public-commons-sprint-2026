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
import {openHouseholdWorkspace,digest,WorkspaceError} from './workspace.mjs';
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
  const sourcePins=Object.fromEntries(['engine.mjs','agent.mjs','robustness/compare.mjs'].map(name=>
    [name,createHash('sha256').update(readFileSync(join(ROOT,name))).digest('hex')]));
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
  const server=http.createServer(async(req,res)=>{
    let id;
    try{
      if(!acceptsHost(req,host))return respond(res,403,{error:'Loopback demo Host mismatch'});
      const url=new URL(req.url,'http://localhost'),path=url.pathname;
      if(req.method==='GET'&&['/','/app.js','/exact-inputs.js','/households.js','/robustness-ui.js','/scenario-handoff.js','/style.css'].includes(path)){
        const file=path==='/'?'index.html':path.slice(1);
        const mime=path==='/'?'text/html; charset=utf-8':path==='/style.css'?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
        res.writeHead(200,{'content-type':mime,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
        return res.end(await readFile(join(ROOT,file)));
      }
      if(!path.startsWith('/api/'))return respond(res,404,{error:'Not found'});
      id=browser(req,res);
      if(req.method==='GET'){
        if(path==='/api/state')return respond(res,200,view(id));
        if(path==='/api/workspace/history')return respond(res,200,store.history(id,{householdId:url.searchParams.get('householdId')||undefined,offset:Number(url.searchParams.get('offset')||0)}));
        if(path==='/api/workspace/record')return respond(res,200,store.record(id,url.searchParams.get('householdId')||store.current(id).id,url.searchParams.get('id')));
        if(path==='/api/workspace/export'){
          const bundle=store.exportHousehold(id,url.searchParams.get('householdId')||undefined);
          return respond(res,200,bundle,{'content-disposition':`attachment; filename="gridkind-household-${bundle.payload.household.id.slice(0,8)}.json"`});
        }
      }
      if(req.method!=='POST'||!['/api/action','/api/robustness','/api/workspace'].includes(path))return respond(res,405,{error:'Unsupported operation'});
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return respond(res,403,{error:'Cross-origin disabled'});
      const body=await readBody(req,path==='/api/workspace'?8*1024*1024:40000);
      // Resolve current selection after the complete request is read. Every UI
      // mutation carries its saved revision, active household and live generation.
      const result=path==='/api/action'?action(id,body):path==='/api/robustness'?compare(id,body):workspaceAction(id,body);
      return respond(res,200,result);
    }catch(error){
      const status=error instanceof WorkspaceError?error.status:400;
      let state;
      if(status===409&&id){try{state=view(id);}catch{}}
      return respond(res,status,{error:error instanceof Error?error.message:'Invalid request',...(state?{state}:{})});
    }
  });
  server.once('close',()=>{clients.clear();store.close();});
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
