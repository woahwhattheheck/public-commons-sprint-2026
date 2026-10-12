// MIT. Portfolio client over the original merchant connection, coordinator lease and admitted client writers.
import {openMerchantFileClient} from './retained-download.mjs';
import {createAccountingMaintenanceClient} from './accounting-maintenance-client.mjs';
import {PORTFOLIO_TOOL_PREFIX,portfolioHostRequest,portfolioOperationMatches,portfolioWireHash,portfolioCommand} from './accounting-portfolio-contract.mjs';
export {portfolioHostRequest as accountingPortfolioRequest,portfolioCommand as accountingPortfolioCommand} from './accounting-portfolio-contract.mjs';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),copy=value=>structuredClone(value);
const SHA=/^[a-f0-9]{64}$/;
const fail=(code,message)=>Object.assign(new Error(message),{code:'ACCOUNTING_PORTFOLIO_CLIENT_'+code});
function need(ok,message,code='ARGUMENTS'){if(!ok)throw fail(code,message);}
function envelope(value){
  need(plain(value)&&SHA.test(value.workspaceId??'')&&Number.isSafeInteger(value.revision)&&value.revision>=1,
    'The original accounting response has no complete workspace identity.','REPLY');return value;
}
export function createAccountingPortfolioClient({workspace,call}={}){
  need(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspace??'')&&typeof call==='function',
    'Provide the original configured workspace alias and structured MCP call.');
  const maintenance=createAccountingMaintenanceClient({workspace,call}),pending=new Set();
  let closed=false,transitioning=false,closePromise;
  const accepting=()=>need(!closed&&!transitioning,'This caller is draining or closed.','CLOSED');
  async function tracked(work){
    accepting();const promise=Promise.resolve().then(work);pending.add(promise);
    try{return await promise;}finally{pending.delete(promise);}
  }
  function invoke(name,args={},options){
    need(plain(args)&&!Object.hasOwn(args,'workspace'),'Use this client’s selected workspace alias.');
    return tracked(async()=>{
      const value=await call(name,{...copy(args),workspace},options);
      need(plain(value),'The merchant returned no structured result.','REPLY');
      return name.startsWith(PORTFOLIO_TOOL_PREFIX)?envelope(value):value;
    });
  }
  async function transition(work,permanent=false){
    accepting();transitioning=true;
    try{await Promise.allSettled([...pending]);const result=await work();if(permanent)closed=true;return result;}
    finally{transitioning=false;}
  }
  function finish(work){
    if(!closePromise){
      const attempt=transition(work,true);closePromise=attempt;
      attempt.catch(()=>{if(closePromise===attempt)closePromise=null;});
    }
    return closePromise;
  }
  async function all(fetch,view){
    const items=[];let offset=0,workspaceId,revision,total,observationSha256,source,header;
    for(;;){
      const result=await fetch({offset,limit:50,...(workspaceId?{workspaceId,expectedRevision:revision}:{}),
        ...(observationSha256?{observationSha256}:{}),
        ...(source?{clientWorkspaceId:source.clientWorkspaceId,expectedClientRevision:source.clientRevision}:{})});
      const page=result.page;envelope(result);
      need(plain(page)&&page.view===view&&Array.isArray(page.items)&&page.offset===offset&&
        Number.isSafeInteger(page.total)&&page.total>=0&&Number.isSafeInteger(page.limit)&&page.limit>=1&&page.limit<=50,
        'The original page is incomplete.','PAGE');
      if(!header){const {page,...value}=result;header=copy(value);}
      workspaceId??=result.workspaceId;revision??=result.revision;total??=page.total;
      if(result.observationSha256!==undefined){
        need(SHA.test(result.observationSha256),'The original client observation has no complete digest.','PAGE');
        observationSha256??=result.observationSha256;
      }
      if(result.source!==undefined){
        need(SHA.test(result.source?.clientWorkspaceId??'')&&Number.isSafeInteger(result.source?.clientRevision)&&result.source.clientRevision>=1,
          'The original client source has no complete workspace identity.','PAGE');
        source??=copy(result.source);
      }
      need(result.workspaceId===workspaceId&&result.revision===revision&&page.total===total&&
        (observationSha256===undefined||result.observationSha256===observationSha256)&&
        (!source||result.source?.clientWorkspaceId===source.clientWorkspaceId&&result.source?.clientRevision===source.clientRevision),
        'An original coordinator or client changed between pages. Reopen the current selection.','OBSERVATION_CHANGED');
      need(page.items.length<=page.limit,'The original page exceeded its selected size.','PAGE');
      items.push(...page.items);offset+=page.items.length;
      need(offset<=total&&(offset===total||page.items.length>0)&&
        (offset===total?page.nextOffset===null:page.nextOffset===offset),
        'The original page did not advance through the complete selection.','PAGE');
      if(offset===total)return {...header,workspaceId,revision,view,items,total};
    }
  }
  function commandReply(command,result,{completed=false}={}){
    need(result.workspaceId===command.originWorkspaceId&&result.commandId===command.id&&
      result.commandSha256===command.commandSha256&&result.clientWorkspaceId===command.clientWorkspaceId,
      'The reply belongs to another original child command.','COMMAND_BINDING');
    if(completed||result.found===true){
      need(plain(result.native)&&result.native.workspaceId===command.clientWorkspaceId&&
        result.native.requestId===command.nativeRequest.requestId&&result.native.revision===command.nativeRequest.revision+1,
        'The original child result differs from the saved native request.','COMMAND_BINDING');
    }else need(result.found===false,'The original child result has no resolved presence state.','COMMAND_BINDING');
    return result;
  }
  const client={
    workspace,
    open:options=>invoke('merchant_accounting_open',{},options),
    configuredSources:options=>invoke('merchant_accounting_sources',{},options),
    status:(args={},options)=>invoke(PORTFOLIO_TOOL_PREFIX+'status',args,options),
    source:(alias,args={},options)=>invoke(PORTFOLIO_TOOL_PREFIX+'source',{...args,alias},options),
    live:(args={},options)=>invoke(PORTFOLIO_TOOL_PREFIX+'live',args,options),
    client:(clientId,args={},options)=>invoke(PORTFOLIO_TOOL_PREFIX+'client',{...args,clientId},options),
    plan:(planId,args={},options)=>invoke(PORTFOLIO_TOOL_PREFIX+'plan',{...args,planId},options),
    received:(receivedId,args={},options)=>invoke(PORTFOLIO_TOOL_PREFIX+'received',{...args,receivedId},options),
    operation:(requestId,options)=>invoke(PORTFOLIO_TOOL_PREFIX+'operation',{requestId},options),
    async command(commandId,args={},options){
      const result=await invoke(PORTFOLIO_TOOL_PREFIX+'command',{...args,commandId},options);
      const command=portfolioCommand(result.command);
      need(command.id===commandId&&command.originWorkspaceId===result.workspaceId,
        'The original command belongs to another coordinator.','COMMAND_BINDING');
      return result;
    },
    async result(commandOrId,options){
      const command=typeof commandOrId==='string'?null:copy(portfolioCommand(commandOrId));
      const result=await invoke(PORTFOLIO_TOOL_PREFIX+'result',{commandId:command?.id??commandOrId,
        ...(command?{workspaceId:command.originWorkspaceId}:{})},options);
      if(command)return commandReply(command,result);
      need(result.commandId===commandOrId&&SHA.test(result.commandSha256??'')&&
        SHA.test(result.clientWorkspaceId??'')&&typeof result.found==='boolean','The original command result has no complete identity.','COMMAND_BINDING');
      return result;
    },
    async executeCommand(value,options){
      const command=copy(portfolioCommand(value));
      const result=await invoke(PORTFOLIO_TOOL_PREFIX+'execute_command',{
        workspaceId:command.originWorkspaceId,commandId:command.id,expectedCommandSha256:command.commandSha256},options);
      return commandReply(command,result,{completed:true});
    },
    preview:(input,selection={},options)=>{
      need(plain(selection)&&!Object.hasOwn(selection,'input'),'Pass the complete native calendar input separately from its observation.');
      return invoke(PORTFOLIO_TOOL_PREFIX+'preview',{...selection,input},options);
    },
    allStatus:(view,args={},options)=>all(page=>client.status({...args,...page,view},options),view),
    allSource:(alias,view,args={},options)=>all(page=>client.source(alias,{...args,...page,view},options),view),
    allLive:(view='clients',args={},options)=>all(page=>client.live({...args,...page,view},options),view),
    allClient:(clientId,view='commissions',args={},options)=>all(page=>client.client(clientId,{...args,...page,view},options),view),
    allPlan:(planId,view,args={},options)=>all(page=>client.plan(planId,{...args,...page,view},options),view),
    allReceived:(receivedId,view,args={},options)=>all(page=>client.received(receivedId,{...args,...page,view},options),view),
    async prepare(action,input,selection={},options){
      need(plain(selection)&&!Object.hasOwn(selection,'input')&&!Object.hasOwn(selection,'action'),
        'Pass the original action and native input separately from its source selection.');
      const result=await invoke(PORTFOLIO_TOOL_PREFIX+'prepare',{...selection,action,input},options);
      const prepared=portfolioHostRequest(result.prepared);
      need(result.workspaceId===prepared.input.workspaceId&&result.revision===prepared.input.revision,
        'The preparation response belongs to another workspace revision.','REQUEST_BINDING');
      return prepared;
    },
    async execute(prepared,options){
      const original=copy(portfolioHostRequest(prepared));
      const result=await invoke(PORTFOLIO_TOOL_PREFIX+'execute',{prepared:original},options);
      need(result.workspaceId===original.input.workspaceId&&result.requestId===original.input.requestId&&
        result.revision===original.input.revision+1,
        'The committed result differs from the original prepared request.','REQUEST_BINDING');
      return result;
    },
    async reconcile(prepared,options){
      const original=copy(portfolioHostRequest(prepared));
      const result=await invoke(PORTFOLIO_TOOL_PREFIX+'reconcile',{prepared:original},options);
      need(result.workspaceId===original.input.workspaceId&&result.requestId===original.input.requestId&&result.requestSha256===original.requestSha256&&
        ['COMMITTED','NOT_FOUND'].includes(result.status),'The recovery response belongs to another original request.','REQUEST_BINDING');
      if(result.status==='COMMITTED'){
        const saved=portfolioOperationMatches(original,result.operation);
        need(portfolioWireHash(result.result)===portfolioWireHash(saved),
          'The recovery result and its saved operation differ.','REQUEST_BINDING');
      }
      return result;
    },
    registerFileRead:readId=>{accepting();return maintenance.registerFileRead(readId);},
    releaseFile:(readId,options)=>maintenance.releaseFile(readId,options),
    drainFileReads:()=>transition(()=>maintenance.drainFileReads()),
    async *fileChunks(selection,options){
      accepting();need(selection?.kind==='portfolio','Choose the original portfolio file kind.');
      const iterator=maintenance.fileChunks(copy(selection),options);
      try{for(;;){accepting();const next=await iterator.next();if(next.done)return;yield next.value;}}
      finally{await iterator.return?.();}
    },
    async fileInfo(selection,{signal}={}){
      for await(const chunk of client.fileChunks(selection,{chunkBytes:1,signal}))return copy(chunk.file);
      throw fail('FILE_REPLY','The original file did not return its identity.');
    },
    async download(selection,{expectedSha256,output,chunkBytes,signal}={}){
      accepting();
      const {downloadAccountingMaintenanceFile}=await import('./accounting-maintenance-cli.mjs');
      return downloadAccountingMaintenanceFile({client,selection:copy(selection),expectedSha256,output,chunkBytes,signal});
    },
    disconnect(){
      return finish(()=>maintenance.drainFileReads());
    },
    closeWorkspace(options){
      return finish(()=>maintenance.closeWorkspace(options));
    },
  };
  return Object.freeze(client);
}
export async function connectAccountingPortfolioClient({workspace,maxResponseBytes=128*1024*1024,...options}={}){
  const connection=await openMerchantFileClient({...options,maximumResponseBytes:maxResponseBytes,errorPrefix:'ACCOUNTING_PORTFOLIO',clientName:'starforge-accounting-portfolio'});
  return Object.freeze({...createAccountingPortfolioClient({workspace,call:connection.call}),endpoint:connection.endpoint});
}
