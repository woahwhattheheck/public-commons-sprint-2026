// MIT. Portfolio operations reuse the original coordinator writer and admitted client workspaces.
import {createHash,randomUUID} from 'node:crypto';
import {PortfolioWorkspace,PORTFOLIO_SCHEMA,PORTFOLIO_PACKET_BYTES,PORTFOLIO_EXPANDED_BYTES} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/portfolio-workspace.mjs';
import {PORTFOLIO_TOOL_PREFIX,PORTFOLIO_HOST_REQUEST_SCHEMA,PORTFOLIO_ACTIONS,PORTFOLIO_INPUT_FIELDS,PORTFOLIO_PREVIEW_FIELDS,PORTFOLIO_FILE_SELECTORS,portfolioDefinitions,portfolioWireHash,portfolioHostBinding,portfolioHostRequest,portfolioOperationMatches,portfolioCommand} from './accounting-portfolio-contract.mjs';
export {portfolioDefinitions};
export const portfolioFileSelectors=PORTFOLIO_FILE_SELECTORS;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),copy=value=>structuredClone(value);
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[a-f0-9]{64}$/;
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>Object.assign(new Error(message),{code});
function need(ok,code,message){if(!ok)throw fail(code,message);}
function id(value,label){need(UUID.test(value??''),'PORTFOLIO_INVALID_ID','Choose the original '+label+' UUID.');return value;}
function page(items,args,view,project=value=>value){
  const offset=args.offset??0,limit=args.limit??50;
  need(Array.isArray(items)&&Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=50,
    'PORTFOLIO_INVALID_PAGE','Choose a nonnegative offset and 1–50 complete original records.');
  const selected=[];let bytes=2;
  for(let index=offset;index<items.length&&selected.length<limit;index++){
    const value=project(items[index]),size=Buffer.byteLength(JSON.stringify(value))+(selected.length?1:0);
    if(selected.length&&bytes+size>512*1024)break;
    selected.push(value);bytes+=size;
  }
  const next=offset+selected.length;
  return {view,items:copy(selected),offset,limit,total:items.length,nextOffset:next<items.length?next:null};
}
function firmHeader(row){if(!row)return null;const {staff,...head}=row;return {...copy(head),staffCount:staff.length};}
function clientHeader(row){
  const {commissions,...head}=row,commission=commissions.find(value=>value.id===row.latestCommissionId);
  return {...copy(head),commissionCount:commissions.length,commission:copy(commission)};
}
function commandHeader(row){
  const {nativeRequest,...head}=row;
  return {...copy(head),nativeRequestId:nativeRequest.requestId,clientRevision:nativeRequest.revision};
}
function planHeader(row){
  const {rows,calendar,firm,capacityExceptions,...head}=row;
  return {...copy(head),firm:firmHeader(firm),rowCount:rows.length,capacityExceptionCount:capacityExceptions.length,
    calendar:{schema:calendar.schema,method:calendar.method,startDate:calendar.startDate,endDate:calendar.endDate,
      totals:copy(calendar.totals),staffCount:calendar.staff.length,allocationCount:calendar.allocations.length,
      dayCount:calendar.days.length,conflictCount:calendar.conflicts.length}};
}
function sourceHeader(source){
  return {alias:source.alias,clientWorkspaceId:source.clientWorkspaceId,clientRevision:source.clientRevision,
    counts:Object.fromEntries(['runbooks','cycles','files','handoffs','closes'].map(key=>[key,source[key].length]))};
}
function liveHeader(row){
  if(!row.available)return copy(row);
  const {cycles,...head}=row;return {...copy(head),cycleCount:cycles.length};
}
export class MerchantPortfolio{
  constructor(runbooks,{withClient,clientAliases=[],readSource}={}){
    need(typeof readSource==='function','PORTFOLIO_CONFIGURATION_ERROR','Use the original host-configured portfolio file reader.');
    this.controller=new PortfolioWorkspace(runbooks,{withClient,clientAliases});
    this.workspace=runbooks.workspace;this.readSource=readSource;
  }
  async close(){await this.workspace.tail;}
  binding(args){
    if(args.workspaceId!==undefined)need(args.workspaceId===this.controller.workspaceId,'PORTFOLIO_WORKSPACE_CHANGED','Reopen this request in its original coordinator workspace.');
    if(args.expectedRevision!==undefined)need(args.expectedRevision===this.workspace.state.revision,'PORTFOLIO_OBSERVATION_CHANGED','The original coordinator changed between observations. Reopen its current selection.');
  }
  result(value={}){return this.controller.envelope(value);}
  async observed(args,work){
    const revision=this.workspace.state.revision;this.binding(args);
    const value=await work();
    need(this.workspace.state.revision===revision,'PORTFOLIO_OBSERVATION_CHANGED','The original coordinator changed while its client source was read. Refresh the complete selection.');
    return value;
  }
  observation(value,args){
    const observationSha256=portfolioWireHash(value);
    if(args.observationSha256!==undefined)need(args.observationSha256===observationSha256,'PORTFOLIO_CLIENT_OBSERVATION_CHANGED','A selected client changed between these complete pages. Reopen its current source.');
    return observationSha256;
  }
  async selectedFile(selected,{pinned=false}={}){
    need(plain(selected)&&Object.keys(selected).every(key=>['source','name','bytes','sha256'].includes(key))&&
      ALIAS.test(selected.source??'')&&typeof selected.name==='string'&&selected.name.trim()&&selected.name.length<=160&&
      !/[\\/\r\n\0"]/.test(selected.name)&&!['.','..'].includes(selected.name),'PORTFOLIO_SOURCE_REQUIRED','Choose a portfolioInputs alias and its original filename.');
    if(pinned)need(SHA.test(selected.sha256??'')&&Number.isSafeInteger(selected.bytes)&&selected.bytes>0,
      'PORTFOLIO_SOURCE_BINDING_REQUIRED','Keep the original packet SHA256 and byte count.');
    const bytes=Buffer.from(await this.readSource(selected.source,PORTFOLIO_PACKET_BYTES));
    need(bytes.length>0&&bytes.length<=PORTFOLIO_PACKET_BYTES,'PORTFOLIO_SOURCE_SIZE','Select the complete original portfolio packet within its native limit.');
    const actual=sha(bytes);
    need((selected.sha256===undefined||selected.sha256===actual)&&(selected.bytes===undefined||selected.bytes===bytes.length),
      'PORTFOLIO_SOURCE_CHANGED','The configured packet differs from the reviewed original file. Preserve this request or prepare the actual current file.');
    return {bytes,reference:{source:selected.source,name:selected.name,bytes:bytes.length,sha256:actual}};
  }
  async prepare(args){
    const route=PORTFOLIO_ACTIONS[args.action];
    need(route&&plain(args.input)&&Object.keys(args.input).every(key=>PORTFOLIO_INPUT_FIELDS[args.action].includes(key)),
      'PORTFOLIO_INVALID_REQUEST','Supply the operator and the selected native fields; preparation supplies coordinator identity, revision and request UUID.');
    const withFile=args.action==='receive';
    need(withFile?plain(args.file):args.file===undefined,'PORTFOLIO_INVALID_SELECTION','Only receiving selects a configured original portfolio packet.');
    const input={...copy(args.input),workspaceId:this.controller.workspaceId,requestId:args.requestId??randomUUID(),revision:this.workspace.state.revision};
    id(input.requestId,'request');
    const selected=withFile?await this.selectedFile(args.file):null;
    const nativeInput=selected?{...input,content:selected.bytes.toString('base64')}:input;
    const prepared={schema:PORTFOLIO_HOST_REQUEST_SCHEMA,action:args.action,kind:route.kind,target:null,input,
      ...(selected?{file:selected.reference}:{}),requestSha256:portfolioWireHash({kind:route.kind,target:null,input:nativeInput})};
    prepared.wireSha256=portfolioWireHash(portfolioHostBinding(prepared));portfolioHostRequest(prepared);
    return {workspaceId:input.workspaceId,revision:input.revision,prepared};
  }
  async reconcile(prepared){
    portfolioHostRequest(prepared);this.binding({workspaceId:prepared.input.workspaceId});
    try{
      const current=await this.controller.operation(prepared.input.requestId);
      const result=portfolioOperationMatches(prepared,current.operation);
      return this.result({status:'COMMITTED',requestId:prepared.input.requestId,requestSha256:prepared.requestSha256,
        operation:current.operation,result:copy(result)});
    }catch(error){
      if(error.code!=='RUNBOOK_OPERATION_NOT_FOUND')throw error;
      return this.result({status:'NOT_FOUND',requestId:prepared.input.requestId,requestSha256:prepared.requestSha256});
    }
  }
  async execute(prepared){
    let dispatched=false;
    try{
      const prior=await this.reconcile(prepared);
      if(prior.status==='COMMITTED')return {...prior.result,duplicate:true,currentRevision:prior.revision};
      const input=copy(prepared.input);
      if(prepared.file){const selected=await this.selectedFile(prepared.file,{pinned:true});input.content=selected.bytes.toString('base64');}
      need(portfolioWireHash({kind:prepared.kind,target:null,input})===prepared.requestSha256,
        'PORTFOLIO_HOST_REQUEST_CHANGED','The expanded original coordinator request differs from its saved native digest.');
      dispatched=true;return await this.controller[PORTFOLIO_ACTIONS[prepared.action].method](input);
    }catch(error){if(!dispatched)error.applied=false;throw error;}
  }
  async file(args){
    const {captureId,receivedId,clientId,cycleId,planId,file}=args;
    need([captureId,receivedId,planId].filter(Boolean).length===1,'PORTFOLIO_INVALID_DOWNLOAD','Choose one original capture, received client packet or saved calendar.');
    if(captureId){
      need(clientId===undefined&&cycleId===undefined&&file==='packet','PORTFOLIO_INVALID_DOWNLOAD','A capture selects its complete original portfolio packet.');
      return this.controller.packet(id(captureId,'capture'));
    }
    if(receivedId){
      need(file==='packet','PORTFOLIO_INVALID_DOWNLOAD','A received client selects its separate original packet.');
      if(clientId===undefined&&cycleId===undefined)return this.controller.receivedPacket(id(receivedId,'received portfolio'));
      return this.controller.clientPacket(id(receivedId,'received portfolio'),id(clientId,'client'),id(cycleId,'period'));
    }
    need(clientId===undefined&&cycleId===undefined,'PORTFOLIO_INVALID_DOWNLOAD','A saved calendar selects only its original calendar or printable report.');
    const method={'calendar.csv':'calendarCsv',print:'print'}[file];
    need(method,'PORTFOLIO_INVALID_DOWNLOAD','Choose calendar.csv or print for this calendar.');
    return this.controller[method](id(planId,'calendar'));
  }
  async call(operation,args){
    await this.workspace.tail;this.binding(args);
    const name=operation.slice(PORTFOLIO_TOOL_PREFIX.length),state=this.controller.state;
    switch(name){
      case 'status':{
        const view=args.view??'summary';
        const firm=args.firmEditionId?state.firmEditions.find(row=>row.id===args.firmEditionId):
          state.firmEditions.find(row=>row.id===state.latestFirmEditionId);
        if(args.firmEditionId!==undefined)need(view==='staff'&&firm,'PORTFOLIO_FIRM_NOT_FOUND','Choose an original firm edition for its staff view.');
        if(view==='summary')return this.result({schema:PORTFOLIO_SCHEMA,clientAliases:copy(this.controller.clientAliases),firm:firmHeader(firm),
          counts:{firmEditions:state.firmEditions.length,clients:state.clients.length,plans:state.plans.length,commands:state.commands.length,captures:state.captures.length,received:state.received.length},
          packetBytes:PORTFOLIO_PACKET_BYTES,expandedPacketBytes:PORTFOLIO_EXPANDED_BYTES});
        const entries={firm_editions:state.firmEditions,staff:firm?.staff??[],clients:state.clients,plans:state.plans,commands:state.commands,captures:state.captures,received:state.received}[view];
        need(entries,'PORTFOLIO_INVALID_VIEW','Choose an original portfolio collection.');
        const project=view==='firm_editions'?firmHeader:view==='clients'?clientHeader:view==='plans'?row=>({...planHeader(row),superseded:state.plans.some(next=>next.previousPlanId===row.id)}):view==='commands'?row=>{const successor=state.commands.find(next=>next.replacesCommandId===row.id);return {...commandHeader(row),replacedByCommandId:successor?.id??null,current:!successor};}:value=>value;
        return this.result({...(view==='staff'?{firm:firmHeader(firm)}:{}),page:page(entries,args,view,project)});
      }
      case 'source':{
        need(ALIAS.test(args.alias??''),'PORTFOLIO_INVALID_ALIAS','Choose a configured original client alias.');
        const selected=await this.observed(args,()=>this.controller.source(args.alias)),source=selected.source;
        if(args.clientWorkspaceId!==undefined)need(source.clientWorkspaceId===args.clientWorkspaceId,'PORTFOLIO_CLIENT_CHANGED','The alias now opens another original client workspace.');
        if(args.expectedClientRevision!==undefined)need(source.clientRevision===args.expectedClientRevision,'PORTFOLIO_CLIENT_OBSERVATION_CHANGED','The original client changed between these source pages.');
        const observationSha256=this.observation(source,args),view=args.view??'summary',header={source:sourceHeader(source),observationSha256};
        if(view==='summary'){need(args.handoffId===undefined,'PORTFOLIO_INVALID_SELECTION','Select a handoff only for its original return revisions.');return this.result(header);}
        let entries,project=value=>value;
        if(view==='revisions'){
          id(args.handoffId,'accountant handoff');const handoff=source.handoffs.find(row=>row.id===args.handoffId);
          need(handoff,'PORTFOLIO_HANDOFF_NOT_FOUND','Choose an actual handoff from this client.');
          entries=handoff.revisions;header.handoffId=handoff.id;
        }else{
          need(args.handoffId===undefined,'PORTFOLIO_INVALID_SELECTION','Select a handoff only for its original return revisions.');
          entries={runbooks:source.runbooks,cycles:source.cycles,files:source.files,handoffs:source.handoffs,closes:source.closes}[view];
          if(view==='handoffs')project=row=>{const {revisions,...head}=row;return {...head,revisionCount:revisions.length};};
        }
        need(entries,'PORTFOLIO_INVALID_VIEW','Choose the original client source collection.');
        return this.result({...header,page:page(entries,args,view,project)});
      }
      case 'live':{
        const observed=await this.observed(args,()=>this.controller.live());
        // Only host-generated availability errors are projected. Customer text,
        // work records and hashes remain exact through the original result layer.
        const clients=observed.clients.map(row=>row.available?row:{...row,error:{code:row.error?.code??'PORTFOLIO_CLIENT_UNAVAILABLE',message:'The original client could not be opened. Inspect its configured host and retained operation.'}});
        const observationSha256=this.observation(clients,args),view=args.view??'clients';
        if(view==='clients'){
          need(args.clientId===undefined,'PORTFOLIO_INVALID_SELECTION','Select a client only for its current periods.');
          return this.result({observationSha256,page:page(clients,args,view,liveHeader)});
        }
        need(view==='cycles','PORTFOLIO_INVALID_VIEW','Choose clients or one client’s periods.');
        const client=clients.find(row=>row.clientId===id(args.clientId,'client'));
        need(client,'PORTFOLIO_CLIENT_NOT_FOUND','Choose a commissioned client.');
        need(client.available,'PORTFOLIO_CLIENT_UNAVAILABLE','This client’s original workspace could not be opened.');
        return this.result({observationSha256,client:liveHeader(client),page:page(client.cycles,args,view)});
      }
      case 'client':{
        const {client}=await this.controller.client(id(args.clientId,'client')),view=args.view??'summary';
        if(view==='summary')return this.result({client:clientHeader(client)});
        need(view==='commissions','PORTFOLIO_INVALID_VIEW','Choose this client’s original commissioning editions.');
        return this.result({client:clientHeader(client),page:page(client.commissions,args,view)});
      }
      case 'plan':{
        const {plan}=await this.controller.plan(id(args.planId,'calendar')),view=args.view??'summary',header={plan:planHeader(plan)};
        if(view==='summary')return this.result(header);
        const entries={rows:plan.rows,staff:plan.calendar.staff,allocations:plan.calendar.allocations,days:plan.calendar.days,conflicts:plan.calendar.conflicts,capacity_exceptions:plan.capacityExceptions}[view];
        need(entries,'PORTFOLIO_INVALID_VIEW','Choose a complete original calendar collection.');
        return this.result({...header,page:page(entries,args,view)});
      }
      case 'command':{
        const result=await this.controller.command(id(args.commandId,'client command'));portfolioCommand(result.command);return result;
      }
      case 'result':return this.observed(args,()=>this.controller.result(id(args.commandId,'client command')));
      case 'received':{
        const selected=await this.observed(args,()=>this.controller.received(id(args.receivedId,'received portfolio'))),view=args.view??'summary';
        const header={received:copy(selected.received),metadata:{schema:selected.metadata.schema,latestFirmEditionId:selected.metadata.latestFirmEditionId,
          counts:{firmEditions:selected.metadata.firmEditions.length,clients:selected.metadata.clients.length,plans:selected.metadata.plans.length,commands:selected.metadata.commands.length,packets:selected.packets.length}}};
        if(view==='summary')return this.result(header);
        const entries={firm_editions:selected.metadata.firmEditions,clients:selected.metadata.clients,plans:selected.metadata.plans,commands:selected.metadata.commands,packets:selected.packets}[view];
        need(entries,'PORTFOLIO_INVALID_VIEW','Choose a complete received portfolio collection.');
        // Received originals remain complete, including every commissioning
        // edition and original command. Large individual rows are never split.
        return this.result({...header,page:page(entries,args,view)});
      }
      case 'operation':return this.controller.operation(id(args.requestId,'coordinator request'));
      case 'preview':{
        need(plain(args.input)&&Object.keys(args.input).every(key=>PORTFOLIO_PREVIEW_FIELDS.includes(key)),'PORTFOLIO_INVALID_REQUEST','Supply the original complete calendar selection.');
        return this.observed(args,()=>this.controller.preview(copy(args.input)));
      }
      case 'prepare':return this.prepare(args);
      case 'execute':return this.execute(args.prepared);
      case 'reconcile':return this.reconcile(args.prepared);
      case 'execute_command':{
        id(args.commandId,'client command');need(SHA.test(args.expectedCommandSha256??''),'PORTFOLIO_COMMAND_BINDING','Keep the exact saved original command SHA256.');
        return this.controller.execute(args.commandId,{expectedCommandSha256:args.expectedCommandSha256});
      }
      default:throw fail('PORTFOLIO_TOOL_NOT_FOUND','Choose an original portfolio operation.');
    }
  }
}
