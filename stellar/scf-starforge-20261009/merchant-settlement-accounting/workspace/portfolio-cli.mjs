// MIT. Portfolio commands over the original accounting workspace and request journal.
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openAccountingWorkspace} from './store.mjs';
import {AccountantWorkspace} from './accountant-workspace.mjs';
import {RunbookWorkspace,runbookCanonical} from './runbooks-workspace.mjs';
import {PortfolioWorkspace,handlePortfolioRequest,PORTFOLIO_PACKET_BYTES} from './portfolio-workspace.mjs';
import {inspectPortfolioConfiguration,openPortfolioClientPool} from './portfolio-connections.mjs';
import {openAccountingMaintenance} from './recovery-controller.mjs';
import {readRunbookInputFile,readRunbookInputJson,retainRunbookOutput,readRunbookResponse,runbookLoopbackUrl} from './runbooks-cli.mjs';

export const PORTFOLIO_HELP='Client portfolio — original accounting workspaces\n\n'+
'Use merchant-accounting-workspace portfolio, or node workspace/server.mjs portfolio.\n'+
'Choose --url http://127.0.0.1:8446 for the running host, or --config /private/operator.json\n'+
'--coordinator firm for the stopped original configured workspaces.\n\n'+
'  inspect --config FILE --coordinator ALIAS\n'+
'  status | live | source --alias CLIENT\n'+
'  client | plan | command | result | operation | received --id SAVED_ID\n'+
'  preview --input /private/calendar-input.json --out /private/calendar-preview.json\n'+
'  prepare --action configure|commission|schedule|prepare-command|capture|receive|adopt\n'+
'    --input /private/action.json --out /private/original-request.json [--file PACKET]\n'+
'  execute --prepared /private/original-request.json\n'+
'  reconcile --prepared /private/original-request.json\n'+
'  execute-command --id COMMAND --sha EXACT_COMMAND_SHA256\n'+
'  packet | calendar | print --id SAVED_ID --out FILE\n'+
'  client-packet --id RECEIVED_ID --client CLIENT_ID --cycle PERIOD_ID --out FILE\n\n'+
'The input describes the actual operator and native action. Prepare reads the current\n'+
'coordinator identity/revision, creates one UUID, and retains the exact original request\n'+
'before execution. Execute and reconcile use that same retained file. Client commands\n'+
'are durably prepared inside the coordinator and execute through the selected original\n'+
'client writer; result reads that child UUID without sending a mutation. Correcting an\n'+
'uncommitted client request selects its latest replacesCommandId and the same native UUID.\n'+
'Closed history remains retained. A native committed result is always reconciled first.\n\n'+
'Configure firm standards and whole-minute staff capacity; commission exact client\n'+
'procedure editions; preview the full staggered calendar; retain an explicit handling\n'+
'note for each visible capacity conflict when saving a calendar. Open each original\n'+
'client desk at /portfolio/clients/ALIAS/runbooks.html for close files and preparation.\n'+
'Capture carries complete original native period packets, the firm/client editions,\n'+
'calendar history and prepared requests. Receive retains that complete handover; download\n'+
'and receive each native period in its local client desk, then explicitly adopt local\n'+
'client bindings. Start fresh periods from their received editions and actual local files.\n'+
'All output paths must be new or contain these exact same complete bytes.\n';
const need=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status,applied:false});};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n'),hash=value=>createHash('sha256').update(Buffer.from(runbookCanonical(value))).digest('hex');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const actions={
  configure:{kind:'portfolio_configured',path:'/api/portfolio/settings'},
  commission:{kind:'portfolio_commissioned',path:'/api/portfolio/clients'},
  schedule:{kind:'portfolio_scheduled',path:'/api/portfolio/plans'},
  'prepare-command':{kind:'portfolio_command_prepared',path:'/api/portfolio/commands'},
  capture:{kind:'portfolio_captured',path:'/api/portfolio/captures'},
  receive:{kind:'portfolio_received',path:'/api/portfolio/receive'},
  adopt:{kind:'portfolio_adopted',path:'/api/portfolio/adopt'}
};
const flags={inspect:[],status:[],live:[],source:['--alias'],client:['--id'],plan:['--id'],command:['--id'],result:['--id'],operation:['--id'],received:['--id'],
  preview:['--input','--out'],prepare:['--action','--input','--out','--file'],execute:['--prepared'],reconcile:['--prepared'],'execute-command':['--id','--sha'],
  packet:['--id','--out'],calendar:['--id','--out'],print:['--id','--out'],'client-packet':['--id','--client','--cycle','--out']};
const required=(options,name)=>{need(typeof options[name]==='string'&&options[name].trim(),'PORTFOLIO_ARGUMENT','Provide '+name+'.');return options[name];};
const identifier=(options,name)=>{const value=required(options,name);need(UUID.test(value),'PORTFOLIO_ID','Choose the saved UUID for '+name+'.');return value;};
function parse(argv){
  const [command,...rest]=argv;need(Object.hasOwn(flags,command),'PORTFOLIO_ARGUMENT',PORTFOLIO_HELP);
  const allowed=new Set(['--url','--config','--coordinator',...flags[command]]),options={};
  for(let i=0;i<rest.length;i++){const name=rest[i];need(allowed.has(name)&&!Object.hasOwn(options,name)&&rest[i+1]&&!rest[i+1].startsWith('--'),'PORTFOLIO_ARGUMENT',PORTFOLIO_HELP);options[name]=rest[++i];}
  need(Boolean(options['--config'])===Boolean(options['--coordinator']),'PORTFOLIO_CONFIG_REQUIRED','Choose the existing configuration and coordinator alias together.');
  need(command==='inspect'?options['--config']&&!options['--url']:Boolean(options['--url'])!==Boolean(options['--config']),'PORTFOLIO_TARGET','Choose the running host or its stopped original configuration.');
  return {command,options};
}
export async function portfolioMain(argv,{signal}={}){
  if(!argv.length||argv.includes('--help')){process.stdout.write(PORTFOLIO_HELP);return;}
  const {command,options}=parse(argv),controller=signal?null:new AbortController();signal??=controller.signal;
  const stop=()=>controller?.abort();if(controller){process.once('SIGINT',stop);process.once('SIGTERM',stop);}
  let maintenance;
  try{
    signal.throwIfAborted();
    if(command==='inspect'){const binding=await inspectPortfolioConfiguration(options['--config'],options['--coordinator']);process.stdout.write(json(binding));return binding;}
    const url=options['--url']?runbookLoopbackUrl(options['--url']):null;
    if(!url){
      const binding=await inspectPortfolioConfiguration(options['--config'],options['--coordinator']),selected=binding.coordinator;
      const closeRuntime=async({workspace,pool})=>{await pool?.close();await workspace.close();};
      const openRuntime=async()=>{
        const workspace=await openAccountingWorkspace({directory:selected.directory,...selected.sources,expectedWorkspaceId:selected.workspaceId,expectedSourcesSha256:selected.sourcesSha256});
        let pool;
        try{const accountant=new AccountantWorkspace(workspace),runbooks=new RunbookWorkspace(workspace,accountant);
          pool=await openPortfolioClientPool({configPath:binding.configPath,coordinatorAlias:binding.coordinatorAlias,expectedPortfolioSha256:binding.sha256,coordinatorWorkspace:workspace});
          return {workspace,accountant,runbooks,pool,portfolio:new PortfolioWorkspace(runbooks,pool)};
        }catch(error){await closeRuntime({workspace,pool});throw error;}
      };
      maintenance=await openAccountingMaintenance({directory:selected.directory,...selected.recovery,openRuntime,closeRuntime});
    }
    const request=async(path,value,{file=false}={})=>{
      signal.throwIfAborted();
      if(maintenance){const admission=maintenance.enter();try{const result=await handlePortfolioRequest(admission.portfolio,{method:value===undefined?'GET':'POST',path,value});
          need(result,'NOT_FOUND','Choose a portfolio operation.',404);return file?result.file:result.value;
        }finally{admission.release();}}
      let response;
      try{response=await fetch(new URL(path,url),{method:value===undefined?'GET':'POST',redirect:'error',cache:'no-store',signal,
        ...(value===undefined?{}:{headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:JSON.stringify(value)})});}
      catch(error){if(signal.aborted)throw error;throw Object.assign(new Error('The original portfolio could not be reached. Keep the saved request for reconciliation.'),{code:'PORTFOLIO_HOST_UNREACHABLE',cause:error});}
      const bytes=await readRunbookResponse(response);
      if(!response.ok){let failure;try{failure=JSON.parse(bytes);}catch{}
        throw Object.assign(new Error(failure?.message??'The original host returned HTTP '+response.status+'.'),{code:failure?.error??'PORTFOLIO_REQUEST_FAILED',status:response.status,...(failure?.applied===false?{applied:false}:{})});}
      return file?{bytes,type:response.headers.get('content-type')}:JSON.parse(bytes);
    };
    const root='/api/portfolio',status=await request(root);let result;
    if(command==='status')result=status;
    else if(command==='live')result=await request(root+'/live');
    else if(command==='source'){const selected=required(options,'--alias');need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(selected),'PORTFOLIO_ALIAS','Choose a configured client alias.');result=await request(root+'/sources/'+selected);}
    else if(['client','plan','command','result','operation','received'].includes(command)){
      const id=identifier(options,'--id'),path={client:'/clients/',plan:'/plans/',command:'/commands/',result:'/commands/',operation:'/operations/',received:'/received/'}[command];
      result=await request(root+path+id+(command==='result'?'/result':''));
    }else if(command==='preview'){
      const input=await readRunbookInputJson(required(options,'--input'));result=await request(root+'/preview',input);
      if(options['--out'])result={file:await retainRunbookOutput(options['--out'],json(result)),previewSha256:result.preview.previewSha256};
    }else if(command==='prepare'){
      const action=required(options,'--action'),selected=actions[action];need(selected,'PORTFOLIO_ACTION','Choose one of the declared portfolio preparation actions.');
      const input=await readRunbookInputJson(required(options,'--input'));
      need(!['workspaceId','revision','requestId'].some(name=>Object.hasOwn(input,name)),'PORTFOLIO_ALREADY_PREPARED','Use an unbound action input or execute the original prepared file.');
      need(typeof input.actor==='string'&&input.actor.trim(),'PORTFOLIO_OPERATOR_REQUIRED','Name the operator in input.actor.');
      if(options['--file']){need(action==='receive'&&!Object.hasOwn(input,'content'),'PORTFOLIO_FILE_SELECTION','Select one complete received portfolio packet.');input.content=(await readRunbookInputFile(options['--file'],PORTFOLIO_PACKET_BYTES)).bytes.toString('base64');}
      Object.assign(input,{workspaceId:status.workspaceId,revision:status.revision,requestId:randomUUID()});
      const prepared={schema:'stellar-forge.accounting-portfolio-request.v1',action,...selected,target:null,input,requestSha256:hash({kind:selected.kind,target:null,input})};
      result={file:await retainRunbookOutput(required(options,'--out'),json(prepared)),workspaceId:input.workspaceId,revision:input.revision,requestId:input.requestId,
        action,path:selected.path,requestSha256:prepared.requestSha256};
    }else if(command==='execute'||command==='reconcile'){
      const prepared=await readRunbookInputJson(required(options,'--prepared')),selected=actions[prepared.action];
      need(selected&&prepared.schema==='stellar-forge.accounting-portfolio-request.v1'&&plain(prepared.input)&&prepared.target===null&&
        prepared.path===selected.path&&prepared.kind===selected.kind&&prepared.input.workspaceId===status.workspaceId&&
        prepared.requestSha256===hash({kind:selected.kind,target:null,input:prepared.input}),'PORTFOLIO_REQUEST_CHANGED','Use the exact original prepared portfolio request.',409);
      if(command==='execute')result=await request(selected.path,prepared.input);
      else{try{
        const current=await request(root+'/operations/'+prepared.input.requestId),operation=current.operation;
        need(operation.kind===selected.kind&&operation.target===null&&operation.requestSha256===prepared.requestSha256,'PORTFOLIO_REQUEST_CHANGED','This UUID belongs to different saved portfolio work.',409);
        result={status:'COMMITTED',workspaceId:status.workspaceId,currentRevision:current.revision,operation};
      }catch(error){if(error.code!=='RUNBOOK_OPERATION_NOT_FOUND')throw error;result={status:'NOT_FOUND',workspaceId:status.workspaceId,requestId:prepared.input.requestId,requestSha256:prepared.requestSha256};}}
    }else if(command==='execute-command'){
      const id=identifier(options,'--id'),sha=required(options,'--sha');need(/^[a-f0-9]{64}$/.test(sha),'PORTFOLIO_COMMAND_SHA','Select the exact saved command digest.');
      result=await request(root+'/commands/'+id+'/execute',{expectedCommandSha256:sha});
    }else{
      const id=identifier(options,'--id');
      const path=command==='packet'?root+'/captures/'+id+'/packet':command==='calendar'?root+'/plans/'+id+'/calendar.csv':command==='print'?root+'/plans/'+id+'/print':
        root+'/received/'+id+'/clients/'+identifier(options,'--client')+'/cycles/'+identifier(options,'--cycle')+'/packet';
      const file=await request(path,undefined,{file:true});result={file:await retainRunbookOutput(required(options,'--out'),file.bytes),type:file.type};
    }
    process.stdout.write(json(result));return result;
  }finally{try{await maintenance?.close();}finally{if(controller){process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)portfolioMain(process.argv.slice(2)).catch(error=>{
  process.stderr.write(JSON.stringify({error:error.code??'PORTFOLIO_COMMAND_FAILED',message:error.message,...(error.applied===false?{applied:false}:{})})+'\n');process.exitCode=1;
});
