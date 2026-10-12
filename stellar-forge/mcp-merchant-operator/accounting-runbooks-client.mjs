// MIT. Typed client over the original merchant MCP connection and accounting lease.
import {openMerchantFileClient} from './retained-download.mjs';
import {createAccountingMaintenanceClient} from './accounting-maintenance-client.mjs';
import {RUNBOOK_TOOL_PREFIX,runbookHostRequest,runbookOperationMatches,runbookWireHash} from './accounting-runbooks-contract.mjs';
export {runbookHostRequest as accountingRunbookRequest} from './accounting-runbooks-contract.mjs';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),copy=value=>structuredClone(value);
const SHA=/^[a-f0-9]{64}$/;
const fail=(code,message)=>Object.assign(new Error(message),{code:'ACCOUNTING_RUNBOOK_CLIENT_'+code});
function need(ok,message,code='ARGUMENTS'){if(!ok)throw fail(code,message);}
function envelope(value){
  need(plain(value)&&SHA.test(value.workspaceId??'')&&Number.isSafeInteger(value.revision)&&value.revision>=1,
    'The original accounting response has no complete workspace identity.','REPLY');return value;
}
export function createAccountingRunbooksClient({workspace,call}={}){
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
      return name.startsWith(RUNBOOK_TOOL_PREFIX)?envelope(value):value;
    });
  }
  async function transition(work,permanent=false){
    accepting();transitioning=true;
    try{await Promise.allSettled([...pending]);return await work();}
    finally{transitioning=false;if(permanent)closed=true;}
  }
  async function all(fetch,view){
    const items=[];let offset=0,workspaceId,revision,total;
    for(;;){
      const result=await fetch({offset,limit:50,...(workspaceId?{workspaceId,expectedRevision:revision}:{})});
      const page=result.page;envelope(result);
      need(plain(page)&&page.view===view&&Array.isArray(page.items)&&page.offset===offset&&
        Number.isSafeInteger(page.total)&&page.total>=0&&Number.isSafeInteger(page.limit)&&page.limit>=1&&page.limit<=50,
        'The original page is incomplete.','PAGE');
      workspaceId??=result.workspaceId;revision??=result.revision;total??=page.total;
      need(result.workspaceId===workspaceId&&result.revision===revision&&page.total===total,
        'The original workspace changed between pages. Reopen the current selection.','OBSERVATION_CHANGED');
      need(page.items.length<=page.limit,'The original page exceeded its selected size.','PAGE');
      items.push(...page.items);offset+=page.items.length;
      need(offset<=total&&(offset===total||page.items.length>0)&&
        (offset===total?page.nextOffset===null:page.nextOffset===offset),
        'The original page did not advance through the complete selection.','PAGE');
      if(offset===total)return {workspaceId,revision,view,items,total};
    }
  }
  const client={
    workspace,
    open:options=>invoke('merchant_accounting_open',{},options),
    configuredSources:options=>invoke('merchant_accounting_sources',{},options),
    status:(args={},options)=>invoke(RUNBOOK_TOOL_PREFIX+'status',args,options),
    sources:(args={},options)=>invoke(RUNBOOK_TOOL_PREFIX+'sources',args,options),
    book:(runbookId,args={},options)=>invoke(RUNBOOK_TOOL_PREFIX+'book',{...args,runbookId},options),
    cycle:(cycleId,args={},options)=>invoke(RUNBOOK_TOOL_PREFIX+'cycle',{...args,cycleId},options),
    operation:(requestId,options)=>invoke(RUNBOOK_TOOL_PREFIX+'operation',{requestId},options),
    allStatus:(view,options)=>all(page=>client.status({...page,view},options),view),
    allSources:(view,args={},options)=>all(page=>client.sources({...args,...page,view},options),view),
    allBook:(runbookId,view,args={},options)=>all(page=>client.book(runbookId,{...args,...page,view},options),view),
    allCycle:(cycleId,view,args={},options)=>all(page=>client.cycle(cycleId,{...args,...page,view},options),view),
    async prepare(action,input,selection={},options){
      need(plain(selection)&&!Object.hasOwn(selection,'input')&&!Object.hasOwn(selection,'action'),
        'Pass the original action and native input separately from its source selection.');
      const result=await invoke(RUNBOOK_TOOL_PREFIX+'prepare',{...selection,action,input},options);
      const prepared=runbookHostRequest(result.prepared);
      need(result.workspaceId===prepared.input.workspaceId&&result.revision===prepared.input.revision,
        'The preparation response belongs to another workspace revision.','REQUEST_BINDING');
      return prepared;
    },
    async execute(prepared,options){
      const original=copy(runbookHostRequest(prepared));
      const result=await invoke(RUNBOOK_TOOL_PREFIX+'execute',{prepared:original},options);
      need(result.workspaceId===original.input.workspaceId&&result.requestId===original.input.requestId&&
        result.revision===original.input.revision+1,
        'The committed result differs from the original prepared request.','REQUEST_BINDING');
      return result;
    },
    async reconcile(prepared,options){
      const original=copy(runbookHostRequest(prepared));
      const result=await invoke(RUNBOOK_TOOL_PREFIX+'reconcile',{prepared:original},options);
      need(result.workspaceId===original.input.workspaceId&&result.requestId===original.input.requestId&&result.requestSha256===original.requestSha256&&
        ['COMMITTED','NOT_FOUND'].includes(result.status),'The recovery response belongs to another original request.','REQUEST_BINDING');
      if(result.status==='COMMITTED'){
        const saved=runbookOperationMatches(original,result.operation);
        need(runbookWireHash(result.result)===runbookWireHash(saved),
          'The recovery result and its saved operation differ.','REQUEST_BINDING');
      }
      return result;
    },
    registerFileRead:readId=>maintenance.registerFileRead(readId),
    releaseFile:(readId,options)=>maintenance.releaseFile(readId,options),
    drainFileReads:()=>transition(()=>maintenance.drainFileReads()),
    async *fileChunks(selection,options){
      accepting();need(selection?.kind==='runbooks','Choose the original runbooks file kind.');
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
      if(!closePromise)closePromise=transition(()=>maintenance.drainFileReads(),true);return closePromise;
    },
    closeWorkspace(options){
      if(!closePromise)closePromise=transition(()=>maintenance.closeWorkspace(options),true);return closePromise;
    },
  };
  return Object.freeze(client);
}
export async function connectAccountingRunbooksClient({workspace,...options}={}){
  const connection=await openMerchantFileClient({...options,errorPrefix:'ACCOUNTING_RUNBOOK',clientName:'starforge-accounting-runbooks'});
  return Object.freeze({...createAccountingRunbooksClient({workspace,call:connection.call}),endpoint:connection.endpoint});
}
