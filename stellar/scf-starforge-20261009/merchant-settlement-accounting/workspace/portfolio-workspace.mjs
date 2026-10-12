// MIT. Firm commissioning and close calendars over original client accounting workspaces.
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {runbookCanonical,runbookAssignment,RUNBOOK_PACKET_BYTES,ensureRunbookDirectory,readRunbookBytes,publishRunbookBlob} from './runbooks-workspace.mjs';
import {allocatePortfolioCalendar,normalizePortfolioStaff,portfolioDate} from './portfolio-schedule.mjs';

export const PORTFOLIO_SCHEMA='stellar-forge.accounting-client-portfolio.v1';
export const PORTFOLIO_PACKET_SCHEMA='stellar-forge.accounting-client-portfolio-packet.v1';
export const PORTFOLIO_PACKET_BYTES=64*1024*1024;
export const PORTFOLIO_EXPANDED_BYTES=256*1024*1024;
export const PORTFOLIO_REQUEST_BYTES=Math.ceil(PORTFOLIO_PACKET_BYTES*4/3)+100_000;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[a-f0-9]{64}$/;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value),now=()=>new Date().toISOString();
const need=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status,applied:false});};
const digest=value=>createHash('sha256').update(value).digest('hex');
const hash=value=>digest(Buffer.from(runbookCanonical(value)));
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const uid=(value,label)=>{need(typeof value==='string'&&UUID.test(value),'PORTFOLIO_ID','Choose a saved '+label+'.');return value;};
const key=(value,label)=>{need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value),'PORTFOLIO_ALIAS','Choose a declared '+label+'.');return value;};
const txt=(value,label,max=16000,empty=false)=>{need(typeof value==='string'&&(empty||value.trim())&&value.length<=max&&!value.includes('\0'),'PORTFOLIO_FIELD','Describe '+label+' within '+max+' characters.');return value;};
const exact=(left,right,code,message)=>need(left===right,code,message,409);
const empty=()=>({schema:PORTFOLIO_SCHEMA,firmEditions:[],latestFirmEditionId:null,clients:[],plans:[],commands:[],captures:[],received:[]});
const actionMap={save:['edition_saved','save'],create:['cycle_created','createCycle'],assign:['assignment_changed','assign'],
  work:['procedure_saved','saveWork'],submit:['preparation_submitted','submit'],review:['review_saved','review']};
const fields={
  save:['runbookId','expectedEditionId','name','client','description','steps','resources'],
  create:['runbookId','editionId','label','preparer','reviewer','dueDate','previousCycleId','sourceKind','sourceFileIds','sourceLabel','sourceNote','handoffId','accountantRevisionId','periodCloseId'],
  assign:['cycleId','expectedAssignmentSha256','preparer','reviewer','dueDate','note'],
  work:['cycleId','stepId','status','note','fileIds'],submit:['cycleId','note'],review:['cycleId','decision','note','acceptedExceptions']
};
const noUnknown=(value,allowed,label)=>{need(plain(value)&&Object.keys(value).every(name=>allowed.includes(name)),'PORTFOLIO_FIELDS','Use the declared '+label+' fields.');};
const sourceFields=['sourceKind','sourceFileIds','sourceLabel','sourceNote','handoffId','accountantRevisionId','periodCloseId'];
const stripCommand=row=>({id:row.id,clientId:row.clientId,commissionId:row.commissionId,alias:row.alias,action:row.action,target:row.target,
  planId:row.planId,rowId:row.rowId,createdAt:row.createdAt,actor:row.actor,originWorkspaceId:row.originWorkspaceId,
  nativeRequestId:row.nativeRequest.requestId,clientWorkspaceId:row.clientWorkspaceId,clientRevision:row.nativeRequest.revision,
  commandSha256:row.commandSha256,nativeRequestSha256:row.nativeRequestSha256});
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const csv=value=>'"'+String(value??'').replace(/^[\s]*[=+@-]|^[\t\r]/,"'$&").replace(/"/g,'""')+'"';

export class PortfolioWorkspace{
  constructor(runbooks,{withClient,clientAliases=[]}={}){
    need(runbooks&&typeof runbooks.mutate==='function','PORTFOLIO_HOST','Use the original accounting runbook controller.');
    need(withClient===undefined||typeof withClient==='function','PORTFOLIO_HOST','Use the original child-workspace admission.');
    need(Array.isArray(clientAliases)&&clientAliases.length<=15&&new Set(clientAliases).size===clientAliases.length,'PORTFOLIO_HOST','Declare up to 15 distinct client aliases.');
    clientAliases.forEach(alias=>key(alias,'client alias'));
    this.runbooks=runbooks;this.withClient=withClient;this.clientAliases=[...clientAliases];
  }
  get workspace(){return this.runbooks.workspace;}
  get workspaceId(){return this.runbooks.workspaceId;}
  get state(){const value=this.runbooks.state.portfolio;need(!value||value.schema===PORTFOLIO_SCHEMA,'PORTFOLIO_STATE','Open the original supported portfolio workspace.',409);return value??empty();}
  envelope(value={}){return this.runbooks.envelope(value);}
  async prior(kind,input,target=null){
    await this.workspace.tail;
    if(this.runbooks.state.operations.some(row=>row.id===input?.requestId))return this.runbooks.mutate('portfolio_'+kind,input,()=>{throw new Error('Retained portfolio operation vanished.');},target);
    return null;
  }
  mutate(kind,input,work,target=null){return this.runbooks.mutate('portfolio_'+kind,input,async(state,actor)=>{
    state.portfolio??=empty();return work(state.portfolio,actor);
  },target);}
  firm(){const row=this.state.firmEditions.find(row=>row.id===this.state.latestFirmEditionId);need(row,'PORTFOLIO_FIRM_REQUIRED','Save the firm standards and named capacity first.',409);return row;}
  clientRow(id){uid(id,'client');const value=this.state.clients.find(row=>row.id===id);need(value,'PORTFOLIO_CLIENT_NOT_FOUND','Choose a commissioned client.',404);return value;}
  commissionRow(id){const row=this.clientRow(id);return row.commissions.find(item=>item.id===row.latestCommissionId);}
  planRow(id){uid(id,'calendar');const value=this.state.plans.find(row=>row.id===id);need(value,'PORTFOLIO_PLAN_NOT_FOUND','Choose a saved close calendar.',404);return value;}
  commandRow(id){uid(id,'prepared request');const value=this.state.commands.find(row=>row.id===id);need(value,'PORTFOLIO_COMMAND_NOT_FOUND','Choose the original prepared request.',404);return value;}
  receivedRow(id){uid(id,'received portfolio');const value=this.state.received.find(row=>row.id===id);need(value,'PORTFOLIO_RECEIVED_NOT_FOUND','Choose a received portfolio.',404);return value;}
  async child(alias,fn){
    key(alias,'client alias');
    need(this.clientAliases.includes(alias)&&this.withClient,'PORTFOLIO_CLIENT_NOT_CONFIGURED','Configure this client alias on the original accounting host.',409);
    return this.withClient(alias,async runtime=>{
      need(runtime?.runbooks&&runtime.workspace,'PORTFOLIO_CLIENT_HOST','Use the original admitted client runbook controller.');
      await runtime.workspace.tail;
      exact(runtime.runbooks.workspaceId===this.workspaceId,false,'PORTFOLIO_SELF_REFERENCE','Use a separately held client workspace.');
      return fn(runtime);
    });
  }
  async view(){
    await this.workspace.tail;const state=this.state;
    return this.envelope({schema:PORTFOLIO_SCHEMA,clientAliases:clone(this.clientAliases),
      firm:state.latestFirmEditionId?clone(this.firm()):null,firmEditions:clone(state.firmEditions),
      clients:state.clients.map(row=>({...clone(row),commission:clone(row.commissions.find(item=>item.id===row.latestCommissionId))})),
      plans:state.plans.map(row=>({id:row.id,seriesId:row.seriesId,previousPlanId:row.previousPlanId,label:row.label,startDate:row.startDate,endDate:row.endDate,
        createdAt:row.createdAt,actor:row.actor,rows:row.rows.length,previewSha256:row.previewSha256,totals:clone(row.calendar.totals),conflicts:row.calendar.conflicts.length,
        superseded:state.plans.some(next=>next.previousPlanId===row.id)})),
      commands:state.commands.map(stripCommand),captures:clone(state.captures),received:clone(state.received)});
  }
  async client(id){await this.workspace.tail;return this.envelope({client:clone(this.clientRow(id))});}
  async plan(id){await this.workspace.tail;return this.envelope({plan:clone(this.planRow(id))});}
  async command(id){await this.workspace.tail;return this.envelope({command:clone(this.commandRow(id))});}
  operation(id){return this.runbooks.operation(id);}
  async source(alias){return this.child(alias,async({runbooks})=>{
    const view=await runbooks.view(),sources=await runbooks.sources();
    exact(view.revision,sources.revision,'PORTFOLIO_CLIENT_REVISION_CHANGED','The client changed while its source list was read. Refresh the original source.');
    return this.envelope({source:{alias,clientWorkspaceId:view.workspaceId,clientRevision:view.revision,
      runbooks:view.runbooks,cycles:view.cycles,files:view.files,handoffs:sources.handoffs,closes:sources.closes}});
  });}
  async live(){
    await this.workspace.tail;const selected=this.state.clients.map(row=>({id:row.id,commission:clone(this.commissionRow(row.id))}));
    const results=await Promise.all(selected.map(async selected=>{
      const commission=selected.commission;
      try{return await this.child(commission.alias,async({runbooks})=>{
        exact(runbooks.workspaceId,commission.clientWorkspaceId,'PORTFOLIO_CLIENT_CHANGED','The declared alias now opens a different client workspace.');
        const view=await runbooks.view(),book=view.runbooks.find(row=>row.id===commission.runbookId);
        need(book,'PORTFOLIO_RUNBOOK_CHANGED','The commissioned client procedure is absent.',409);
        return {clientId:selected.id,alias:commission.alias,name:commission.name,clientWorkspaceId:view.workspaceId,clientRevision:view.revision,
          commissionId:commission.id,commissionedEditionId:commission.editionId,latestEditionId:book.latestEditionId,
          cycles:view.cycles.filter(row=>row.runbookId===commission.runbookId),available:true};
      });}catch(error){return {clientId:selected.id,alias:commission.alias,name:commission.name,available:false,error:{code:error.code??'PORTFOLIO_CLIENT_UNAVAILABLE',message:error.message}};}
    }));
    return this.envelope({clients:results});
  }
  configure(input){return this.mutate('configured',input,(state,actor)=>{
    exact(input.expectedFirmEditionId??null,state.latestFirmEditionId,'PORTFOLIO_FIRM_CHANGED','Refresh the current firm edition before saving capacity.');
    need(state.firmEditions.length<200,'PORTFOLIO_FIRM_LIMIT','This workspace retains 200 firm editions.');
    const firm=input.firm;need(plain(firm),'PORTFOLIO_FIRM_REQUIRED','Describe the firm.');
    const edition={id:input.requestId,actor,createdAt:now(),name:txt(firm.name,'firm name',240),
      closeStandard:txt(firm.closeStandard??'','close standard',16000,true),
      reportingStandard:txt(firm.reportingStandard??'','reporting standard',16000,true),
      reportingCadence:txt(firm.reportingCadence??'','reporting cadence',4000,true),
      escalationNote:txt(firm.escalationNote??'','escalation instructions',16000,true),
      staff:normalizePortfolioStaff(input.staff)};
    state.firmEditions.push(edition);state.latestFirmEditionId=edition.id;return {firmEditionId:edition.id};
  });}
  async commission(input){
    const prior=await this.prior('commissioned',input);if(prior)return prior;
    const observed=await this.child(input.alias,async({runbooks})=>{
      exact(runbooks.workspaceId,input.clientWorkspaceId,'PORTFOLIO_CLIENT_CHANGED','Refresh the selected original client workspace.');
      exact(runbooks.workspace.state.revision,input.clientRevision,'PORTFOLIO_CLIENT_REVISION_CHANGED','Refresh the current client source before commissioning.');
      const book=runbooks.book(input.runbookId),edition=book.editions.find(row=>row.id===input.editionId);
      need(edition,'PORTFOLIO_EDITION_NOT_FOUND','Choose an exact saved client procedure edition.',404);
      return {clientWorkspaceId:runbooks.workspaceId,clientRevision:runbooks.workspace.state.revision,
        runbookId:book.id,editionId:edition.id,editionSha256:hash(edition)};
    });
    return this.mutate('commissioned',input,(state,actor)=>{
      const firm=this.firm();let client;
      if(input.clientId){client=this.clientRow(input.clientId);exact(input.expectedCommissionId,client.latestCommissionId,'PORTFOLIO_COMMISSION_CHANGED','Refresh the current client commission before saving.');}
      else{need(state.clients.length<200,'PORTFOLIO_CLIENT_LIMIT','Use up to 200 retained client commissions.');client={id:input.requestId,createdAt:now(),latestCommissionId:null,commissions:[]};}
      need(client.commissions.length<200,'PORTFOLIO_COMMISSION_LIMIT','This client retains 200 commissioning editions.');
      need(!state.clients.some(row=>row.id!==client.id&&this.commissionRow(row.id).alias===input.alias),'PORTFOLIO_ALIAS_IN_USE','This alias already belongs to another commissioned client.');
      const people=[input.preparerId,input.backupId,input.reviewerId];people.forEach(id=>key(id,'person'));
      need(people.every(id=>firm.staff.some(row=>row.id===id))&&input.preparerId!==input.backupId,'PORTFOLIO_STAFF','Choose a named preparer, a different backup, and a reviewer from the current firm edition.');
      need(['DISCOVERY','READY','ACTIVE'].includes(input.status),'PORTFOLIO_COMMISSION_STATUS','Choose discovery, ready, or active.');
      const commission={id:input.requestId,createdAt:now(),actor,firmEditionId:firm.id,alias:key(input.alias,'client alias'),...observed,
        name:txt(input.name,'client name',240),preparerId:input.preparerId,backupId:input.backupId,reviewerId:input.reviewerId,status:input.status};
      for(const field of ['scope','sourceGaps','reportingInstructions','escalationInstructions','readinessNote'])commission[field]=txt(input[field]??'',field,16000,true);
      if(input.sourcePacketId){const source=this.receivedRow(input.sourcePacketId);uid(input.sourceClientId,'received client');commission.receivedFrom={packetId:source.id,packetSha256:source.sha256,clientId:input.sourceClientId};}
      client.commissions.push(commission);client.latestCommissionId=commission.id;if(!input.clientId)state.clients.push(client);
      return {clientId:client.id,commissionId:commission.id};
    });
  }
  async preview(input){
    await this.workspace.tail;const firm=clone(this.firm()),baseRevision=this.workspace.state.revision;
    need(Array.isArray(input.rows)&&input.rows.length>0&&input.rows.length<=200,'PORTFOLIO_PLAN_ROWS','Describe one to 200 client periods.');
    const previous=input.previousPlanId?clone(this.planRow(input.previousPlanId)):null;
    if(previous)need(!this.state.plans.some(row=>row.previousPlanId===previous.id),'PORTFOLIO_PLAN_CHANGED','Revise the latest saved calendar in this series.',409);
    const currentPlans=this.state.plans.filter(row=>!this.state.plans.some(next=>next.previousPlanId===row.id)&&row.id!==previous?.id);
    const booked=currentPlans.flatMap(plan=>plan.calendar.allocations.map(row=>({...row,planId:plan.id})));
    const rows=[],groups=new Map();
    for(const inputRow of input.rows){
      need(plain(inputRow),'PORTFOLIO_PLAN_ROW','Describe every client period.');
      const commission=clone(this.commissionRow(inputRow.clientId));
      exact(inputRow.commissionId,commission.id,'PORTFOLIO_COMMISSION_CHANGED','Refresh the selected commissioning edition before planning.');
      const row={id:key(inputRow.id,'plan row'),clientId:inputRow.clientId,commissionId:commission.id,alias:commission.alias,name:commission.name,
        label:txt(inputRow.label,'period label',240),preparerId:inputRow.preparerId??commission.preparerId,backupId:inputRow.backupId??commission.backupId,
        reviewerId:inputRow.reviewerId??commission.reviewerId,closeDate:portfolioDate(inputRow.closeDate),reviewDate:portfolioDate(inputRow.reviewDate??inputRow.closeDate),
        preparationMinutes:inputRow.preparationMinutes,reviewMinutes:inputRow.reviewMinutes,backupMinutes:inputRow.backupMinutes??0,
        runbookId:commission.runbookId,editionId:commission.editionId,clientWorkspaceId:commission.clientWorkspaceId,
        cycleId:inputRow.cycleId??null,previousCycleId:inputRow.previousCycleId??null,source:inputRow.source?clone(inputRow.source):null};
      if(row.cycleId)uid(row.cycleId,'client period');if(row.previousCycleId)uid(row.previousCycleId,'previous client period');
      if(row.source){noUnknown(row.source,sourceFields,'original close source');need(['files','accountant'].includes(row.source.sourceKind),'PORTFOLIO_CLOSE_SOURCE','Choose original client files or an exact accountant handoff.');}
      rows.push(row);if(!groups.has(row.alias))groups.set(row.alias,[]);groups.get(row.alias).push(row);
    }
    for(const [alias,selected] of groups)await this.child(alias,async({runbooks})=>{
      for(const row of selected){
        exact(runbooks.workspaceId,row.clientWorkspaceId,'PORTFOLIO_CLIENT_CHANGED','The selected alias now opens a different client workspace.');
        const book=runbooks.book(row.runbookId),edition=book.editions.find(item=>item.id===row.editionId);
        need(edition,'PORTFOLIO_EDITION_NOT_FOUND','Choose an existing commissioned client edition.',404);
        row.clientRevision=runbooks.workspace.state.revision;row.editionSha256=hash(edition);
        if(row.previousCycleId)exact(runbooks.cycle(row.previousCycleId).runbookId,row.runbookId,'PORTFOLIO_PREVIOUS_PERIOD','Choose the previous period for this same client runbook.');
        if(row.cycleId){const cycle=runbooks.cycle(row.cycleId);exact(cycle.runbookId,row.runbookId,'PORTFOLIO_PERIOD_CHANGED','Choose a period of this commissioned runbook.');row.editionId=cycle.editionId;row.editionSha256=hash(cycle.edition);row.assignment=runbookAssignment(cycle);}
        if(row.source?.sourceKind==='files'){
          need(Array.isArray(row.source.sourceFileIds)&&row.source.sourceFileIds.length>0&&new Set(row.source.sourceFileIds).size===row.source.sourceFileIds.length,'PORTFOLIO_CLOSE_SOURCE','Select distinct original close files.');
          row.source.sourceFileIds.forEach(id=>runbooks.fileRow(id));
        }
        if(row.source?.sourceKind==='accountant'){
          const record=runbooks.accountant.row(row.source.handoffId);runbooks.accountant.revisionRow(record,row.source.accountantRevisionId);
          need(row.source.accountantRevisionId==='initial'||UUID.test(row.source.accountantRevisionId??''),'PORTFOLIO_CLOSE_SOURCE','Select the exact accountant handoff edition.');
        }
      }
    });
    const calendar=allocatePortfolioCalendar({staff:firm.staff,rows,startDate:input.startDate,endDate:input.endDate,booked});
    const value={label:txt(input.label,'calendar name',240),firmEditionId:firm.id,firm,startDate:input.startDate,endDate:input.endDate,
      previousPlanId:previous?.id??null,seriesId:previous?.seriesId??null,bookedPlanIds:currentPlans.map(row=>row.id),rows,calendar};
    return this.envelope({revision:baseRevision,preview:{...value,previewSha256:hash(value)}});
  }
  async schedule(input){
    const prior=await this.prior('scheduled',input);if(prior)return prior;
    const preview=(await this.preview(input)).preview;
    exact(input.expectedPreviewSha256,preview.previewSha256,'PORTFOLIO_PREVIEW_CHANGED','Refresh the complete calendar preview before saving this edition.');
    const exceptions=input.capacityExceptions??[];
    need(Array.isArray(exceptions)&&exceptions.length===preview.calendar.conflicts.length&&new Set(exceptions.map(row=>row.id)).size===exceptions.length,'PORTFOLIO_CAPACITY_REVIEW','Record an explicit handling note for every displayed capacity conflict.');
    for(const conflict of preview.calendar.conflicts){const entry=exceptions.find(row=>row.id===conflict.id);need(entry,'PORTFOLIO_CAPACITY_REVIEW','Account for every displayed capacity conflict.');txt(entry.note,'capacity handling note',4000);}
    return this.mutate('scheduled',input,(state,actor)=>{
      need(state.plans.length<1000,'PORTFOLIO_PLAN_LIMIT','This workspace retains 1000 calendar editions.');
      const plan={id:input.requestId,...clone(preview),seriesId:preview.seriesId??input.requestId,createdAt:now(),actor,capacityExceptions:clone(exceptions)};
      state.plans.push(plan);return {planId:plan.id,seriesId:plan.seriesId,previewSha256:plan.previewSha256};
    });
  }
  async prepare(input){
    const prior=await this.prior('command_prepared',input);if(prior)return prior;
    const commission=clone(this.commissionRow(input.clientId)),action=input.action;
    need(Object.hasOwn(actionMap,action),'PORTFOLIO_ACTION','Choose a native procedure, period, assignment, work, submission, or review action.');
    noUnknown(input.parameters,fields[action],'native '+action);uid(input.nativeRequestId,'native request');
    let parameters=clone(input.parameters),plan=null,row=null;
    if(input.planId){
      plan=clone(this.planRow(input.planId));row=plan.rows.find(row=>row.id===input.rowId);
      need(row&&row.clientId===input.clientId,'PORTFOLIO_PLAN_ROW','Choose a row for this client in the saved calendar.',409);
      exact(row.commissionId,commission.id,'PORTFOLIO_COMMISSION_CHANGED','Choose a calendar using this client commissioning edition.');
      if(action==='create'){
        need(!row.cycleId,'PORTFOLIO_PERIOD_EXISTS','This calendar row already selects an existing client period.',409);
        const existing=this.state.commands.filter(command=>command.action==='create'&&command.planSeriesId===plan.seriesId&&command.rowId===row.id);
        need(!existing.length||existing.some(command=>command.id===input.replacesCommandId),'PORTFOLIO_PERIOD_PREPARED','Continue the saved period request, or explicitly correct it using its original native UUID.',409);
        const people=new Map(plan.firm.staff.map(person=>[person.id,person.name]));
        const fixed={runbookId:row.runbookId,editionId:row.editionId,label:row.label,preparer:people.get(row.preparerId),
          reviewer:people.get(row.reviewerId),dueDate:row.closeDate,previousCycleId:row.previousCycleId};
        for(const [name,value] of Object.entries(fixed))if(Object.hasOwn(parameters,name))exact(parameters[name],value,'PORTFOLIO_PLAN_REQUEST_CHANGED','The prepared client period must use the selected calendar row.');
        parameters={...(row.source??{}),...parameters,...fixed};
      }else if(row.cycleId&&parameters.cycleId)exact(parameters.cycleId,row.cycleId,'PORTFOLIO_PLAN_PERIOD_CHANGED','Choose the client period selected by this calendar row.');
    }else need(input.rowId===undefined||input.rowId===null,'PORTFOLIO_PLAN_ROW','Select a calendar for the chosen row.');
    const [kind]=actionMap[action],target=['assign','work','submit','review'].includes(action)?uid(parameters.cycleId,'client period'):null;
    const replaces=input.replacesCommandId?clone(this.commandRow(input.replacesCommandId)):null;
    if(replaces){need(replaces.action===action&&replaces.target===target&&replaces.clientId===input.clientId&&replaces.nativeRequest.requestId===input.nativeRequestId,
      'PORTFOLIO_CORRECTION_BINDING','Keep the same client action, target and original native UUID when correcting an uncommitted request.',409);}
    if(target)delete parameters.cycleId;
    const nativeRequest={...parameters,workspaceId:input.clientWorkspaceId,revision:input.clientRevision,requestId:input.nativeRequestId,actor:txt(input.actor,'operator',160)};
    await this.child(commission.alias,async({runbooks})=>{
      exact(runbooks.workspaceId,commission.clientWorkspaceId,'PORTFOLIO_CLIENT_CHANGED','The commissioned alias now opens a different client workspace.');
      exact(nativeRequest.workspaceId,runbooks.workspaceId,'PORTFOLIO_CLIENT_CHANGED','Refresh the original client identity before preparing.');
      exact(nativeRequest.revision,runbooks.workspace.state.revision,'PORTFOLIO_CLIENT_REVISION_CHANGED','Refresh the current client source before preparing.');
      if(target){const cycle=runbooks.cycle(target);exact(cycle.runbookId,commission.runbookId,'PORTFOLIO_PERIOD_CHANGED','Choose a period for this commissioned runbook.');}
      if(action==='create')exact(nativeRequest.runbookId,commission.runbookId,'PORTFOLIO_RUNBOOK_CHANGED','Choose this commissioned client runbook.');
      if(action==='save')exact(nativeRequest.runbookId,commission.runbookId,'PORTFOLIO_RUNBOOK_CHANGED','Revise this commissioned client runbook.');
      if(replaces){try{await runbooks.operation(input.nativeRequestId);need(false,'PORTFOLIO_NATIVE_ALREADY_SAVED','The original client request is committed. Reconcile that saved command before preparing further work.',409);}catch(error){if(error.code!=='RUNBOOK_OPERATION_NOT_FOUND')throw error;}}
    });
    const nativeRequestSha256=hash({kind,target,input:nativeRequest});
    return this.mutate('command_prepared',input,async(state,actor)=>{
      need(state.commands.length<5000,'PORTFOLIO_COMMAND_LIMIT','This portfolio retains 5000 prepared client requests.');
      if(replaces){
        need(!state.commands.some(command=>command.replacesCommandId===replaces.id),'PORTFOLIO_CORRECTION_CHANGED','Correct the latest saved request in the original replacement chain.',409);
        await this.child(commission.alias,async({runbooks})=>{
          exact(runbooks.workspaceId,commission.clientWorkspaceId,'PORTFOLIO_CLIENT_CHANGED','Open the original client workspace.');
          try{await runbooks.operation(input.nativeRequestId);need(false,'PORTFOLIO_NATIVE_ALREADY_SAVED','Reconcile the committed original client request before preparing further work.',409);}
          catch(error){if(error.code!=='RUNBOOK_OPERATION_NOT_FOUND')throw error;}
        });
      }
      const reused=state.commands.find(command=>command.clientWorkspaceId===nativeRequest.workspaceId&&command.nativeRequest.requestId===nativeRequest.requestId);
      need(!reused||replaces&&reused.action===action&&reused.target===target,'PORTFOLIO_NATIVE_REQUEST_IN_USE','Continue the existing saved client request for this UUID, or select it explicitly for correction.',409);
      const value={id:input.requestId,originWorkspaceId:this.workspaceId,createdAt:now(),actor,clientId:input.clientId,commissionId:commission.id,
        alias:commission.alias,clientWorkspaceId:commission.clientWorkspaceId,action,kind,target,nativeRequest,nativeRequestSha256,
        planId:plan?.id??null,planSeriesId:plan?.seriesId??null,rowId:row?.id??null,replacesCommandId:replaces?.id??null};
      const command={...value,commandSha256:hash(value)};state.commands.push(command);
      return {commandId:command.id,commandSha256:command.commandSha256,nativeRequestId:command.nativeRequest.requestId,clientWorkspaceId:command.clientWorkspaceId};
    });
  }
  async result(id){
    await this.workspace.tail;const command=clone(this.commandRow(id)),{commandSha256,...contents}=command;
    exact(hash(contents),commandSha256,'PORTFOLIO_COMMAND_CHANGED','The saved original request changed.');
    return this.child(command.alias,async({runbooks})=>{
      exact(runbooks.workspaceId,command.clientWorkspaceId,'PORTFOLIO_CLIENT_CHANGED','Open the original client workspace for this request.');
      try{const retained=await runbooks.operation(command.nativeRequest.requestId);
        exact(retained.operation.kind,command.kind,'PORTFOLIO_NATIVE_REQUEST_CHANGED','The native UUID belongs to another action.');
        exact(retained.operation.requestSha256,command.nativeRequestSha256,'PORTFOLIO_NATIVE_REQUEST_CHANGED','The native UUID belongs to different request bytes.');
        return this.envelope({commandId:command.id,commandSha256,clientWorkspaceId:runbooks.workspaceId,found:true,native:retained.operation.result});
      }catch(error){if(error.code!=='RUNBOOK_OPERATION_NOT_FOUND')throw error;return this.envelope({commandId:command.id,commandSha256,clientWorkspaceId:runbooks.workspaceId,found:false});}
    });
  }
  async execute(id,input){
    return this.workspace.serial(async()=>{
    const command=clone(this.commandRow(id)),{commandSha256,...value}=command;
    exact(commandSha256,hash(value),'PORTFOLIO_COMMAND_CHANGED','The saved original client request changed.');
    exact(input.expectedCommandSha256,commandSha256,'PORTFOLIO_COMMAND_CHANGED','Select the exact prepared client request.');
    exact(command.originWorkspaceId,this.workspaceId,'PORTFOLIO_RECEIVED_COMMAND','Received requests remain with their original workspace; prepare a local request after receiving the client source.');
    return this.child(command.alias,async({runbooks})=>{
      exact(runbooks.workspaceId,command.clientWorkspaceId,'PORTFOLIO_CLIENT_CHANGED','Reopen the original client workspace for this saved request.');
      try{
        const retained=await runbooks.operation(command.nativeRequest.requestId);
        exact(retained.operation.kind,command.kind,'PORTFOLIO_NATIVE_REQUEST_CHANGED','This native UUID belongs to another action.');
        exact(retained.operation.requestSha256,command.nativeRequestSha256,'PORTFOLIO_NATIVE_REQUEST_CHANGED','This native UUID belongs to different request bytes.');
        return this.envelope({commandId:command.id,commandSha256,clientAlias:command.alias,clientWorkspaceId:runbooks.workspaceId,native:retained.operation.result,recovered:true});
      }catch(error){if(error.code!=='RUNBOOK_OPERATION_NOT_FOUND')throw error;}
      need(!this.state.commands.some(next=>next.replacesCommandId===command.id),'PORTFOLIO_COMMAND_REPLACED','Execute the latest reviewed correction; the historical request remains available for reconciliation.',409);
      const method=actionMap[command.action][1];
      const native=command.target?await runbooks[method](command.target,clone(command.nativeRequest)):await runbooks[method](clone(command.nativeRequest));
      return this.envelope({commandId:command.id,commandSha256,clientAlias:command.alias,clientWorkspaceId:runbooks.workspaceId,native,recovered:false});
    });
    });
  }
  async storage(){const root=await this.runbooks.storage('portfolio');await ensureRunbookDirectory(root);return root;}
  async capture(input){
    const prior=await this.prior('captured',input);if(prior)return prior;
    await this.workspace.tail;const snapshot=clone(this.state),baseRevision=this.workspace.state.revision;
    need(snapshot.latestFirmEditionId,'PORTFOLIO_FIRM_REQUIRED','Save the firm configuration before handing over the portfolio.',409);
    need(Array.isArray(input.clients)&&input.clients.length>0&&input.clients.length<=15&&new Set(input.clients.map(row=>row.clientId)).size===input.clients.length,'PORTFOLIO_CAPTURE_CLIENTS','Select distinct client workspaces and their complete period lists.');
    const packets=[];let expandedBytes=0,compressedBytes=0;
    for(const selection of input.clients){
      const commission=clone(this.commissionRow(selection.clientId));
      need(Array.isArray(selection.cycleIds)&&selection.cycleIds.length>0&&selection.cycleIds.length<=100&&new Set(selection.cycleIds).size===selection.cycleIds.length,'PORTFOLIO_CAPTURE_PERIODS','Select distinct complete client periods.');
      await this.child(commission.alias,async({runbooks})=>{
        exact(runbooks.workspaceId,commission.clientWorkspaceId,'PORTFOLIO_CLIENT_CHANGED','Reopen the original commissioned client workspace.');
        exact(selection.clientWorkspaceId,runbooks.workspaceId,'PORTFOLIO_CLIENT_CHANGED','Refresh the selected original client workspace.');
        exact(selection.clientRevision,runbooks.workspace.state.revision,'PORTFOLIO_CLIENT_REVISION_CHANGED','Refresh the client before capturing its complete handover.');
        const revision=runbooks.workspace.state.revision;
        need(selection.cycleIds.some(id=>runbooks.cycle(id).editionId===commission.editionId),'PORTFOLIO_CAPTURE_EDITION','Include a complete period using the commissioned procedure edition.');
        for(const cycleId of selection.cycleIds){
          const cycle=runbooks.cycle(cycleId);exact(cycle.runbookId,commission.runbookId,'PORTFOLIO_CAPTURE_PERIOD_CHANGED','Choose periods of this commissioned client runbook.');
          const file=await runbooks.packet(cycleId),compressed=gzipSync(file.bytes,{level:6});
          expandedBytes+=file.bytes.length;compressedBytes+=compressed.length;
          need(expandedBytes<=PORTFOLIO_EXPANDED_BYTES&&compressedBytes<=PORTFOLIO_PACKET_BYTES,'PORTFOLIO_PACKET_LIMIT','The complete selected client periods exceed the portfolio handover size. Retain separate complete portfolio captures.');
          packets.push({clientId:selection.clientId,alias:commission.alias,clientWorkspaceId:runbooks.workspaceId,clientRevision:revision,cycleId,
            authoringWorkspaceId:cycle.originWorkspaceId,receivedSource:cycle.readOnly===true,sourcePacketSha256:cycle.receivedPacket?.sha256??null,
            name:file.name,bytes:file.bytes.length,sha256:digest(file.bytes),compressedBytes:compressed.length,compressedSha256:digest(compressed),gzipBase64:compressed.toString('base64')});
        }
        exact(runbooks.workspace.state.revision,revision,'PORTFOLIO_CLIENT_REVISION_CHANGED','The client changed while its periods were being captured. Refresh and capture again.');
      });
    }
    const metadata={schema:PORTFOLIO_SCHEMA,firmEditions:snapshot.firmEditions,latestFirmEditionId:snapshot.latestFirmEditionId,
      clients:snapshot.clients,plans:snapshot.plans,commands:snapshot.commands};
    const payload={schema:PORTFOLIO_PACKET_SCHEMA,originWorkspaceId:this.workspaceId,asOfWorkspaceRevision:baseRevision,
      label:txt(input.label,'portfolio handover label',240),metadata,metadataSha256:hash(metadata),packets,expandedBytes};
    const packet={...payload,sha256:hash(payload)},bytes=json(packet);
    need(bytes.length<=PORTFOLIO_PACKET_BYTES,'PORTFOLIO_PACKET_LIMIT','The complete selected portfolio exceeds its 64 MiB portable packet size.');
    return this.mutate('captured',input,async(state,actor)=>{
      need(state.captures.length<1000,'PORTFOLIO_CAPTURE_LIMIT','This workspace retains 1000 portfolio captures.');
      const sha256=digest(bytes);await publishRunbookBlob(await this.storage(),sha256+'.json',bytes);
      const record={id:input.requestId,label:payload.label,createdAt:now(),actor,sha256,bytes:bytes.length,packetSha256:packet.sha256,
        originWorkspaceId:this.workspaceId,asOfWorkspaceRevision:baseRevision,clients:input.clients.map(row=>({clientId:row.clientId,cycleIds:clone(row.cycleIds)})),
        periodCount:packets.length,expandedBytes};
      state.captures.push(record);return {captureId:record.id,capture:clone(record)};
    });
  }
  async packet(id){
    await this.workspace.tail;uid(id,'portfolio capture');const row=this.state.captures.find(row=>row.id===id);
    need(row,'PORTFOLIO_CAPTURE_NOT_FOUND','Choose a complete saved portfolio capture.',404);
    const bytes=await readRunbookBytes(join(this.workspace.directory,'runbooks','portfolio',row.sha256+'.json'),row,PORTFOLIO_PACKET_BYTES);
    return {bytes,name:'client-portfolio-'+row.id+'.json',type:'application/json; charset=utf-8'};
  }
  decodePacket(bytes,{validateClients=false}={}){
    need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=PORTFOLIO_PACKET_BYTES,'PORTFOLIO_PACKET_LIMIT','Choose a complete portfolio packet within 64 MiB.');
    let packet;try{packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{need(false,'PORTFOLIO_PACKET_JSON','Choose a complete UTF-8 portfolio JSON packet.');}
    need(plain(packet)&&packet.schema===PORTFOLIO_PACKET_SCHEMA&&SHA.test(packet.sha256??''),'PORTFOLIO_PACKET','Choose a saved portfolio handover.');
    const {sha256,...payload}=packet;exact(hash(payload),sha256,'PORTFOLIO_PACKET_CHANGED','The portfolio handover changed.');
    txt(packet.originWorkspaceId,'original portfolio workspace',240);
    need(Number.isSafeInteger(packet.asOfWorkspaceRevision)&&packet.asOfWorkspaceRevision>=0,'PORTFOLIO_PACKET','The original portfolio revision is missing.');
    const metadata=packet.metadata;
    need(plain(metadata)&&metadata.schema===PORTFOLIO_SCHEMA&&SHA.test(packet.metadataSha256??''),'PORTFOLIO_PACKET','The complete firm and client metadata is missing.');
    exact(hash(metadata),packet.metadataSha256,'PORTFOLIO_PACKET_CHANGED','The saved firm and client metadata changed.');
    const limits={firmEditions:200,clients:200,plans:1000,commands:5000};
    for(const [field,maximum] of Object.entries(limits)){
      need(Array.isArray(metadata[field])&&metadata[field].length<=maximum,'PORTFOLIO_PACKET','The retained '+field+' collection is invalid.');
      need(metadata[field].every(row=>plain(row)&&UUID.test(row.id??''))&&new Set(metadata[field].map(row=>row.id)).size===metadata[field].length,'PORTFOLIO_PACKET','The retained '+field+' identities are invalid.');
    }
    need(metadata.firmEditions.some(row=>row.id===metadata.latestFirmEditionId),'PORTFOLIO_PACKET','The current firm edition is missing.');
    for(const firm of metadata.firmEditions){txt(firm.name,'firm name',240);normalizePortfolioStaff(firm.staff);}
    for(const client of metadata.clients){
      need(Array.isArray(client.commissions)&&client.commissions.length>0&&client.commissions.length<=200&&client.commissions.some(row=>row.id===client.latestCommissionId),'PORTFOLIO_PACKET','A complete commissioning history is missing.');
      for(const commission of client.commissions){
        uid(commission.id,'commissioning edition');key(commission.alias,'original client alias');uid(commission.runbookId,'client runbook');uid(commission.editionId,'procedure edition');
        txt(commission.clientWorkspaceId,'original client workspace',240);txt(commission.name,'client name',240);
      }
    }
    for(const command of metadata.commands){
      const {commandSha256,...contents}=command;
      need(Object.hasOwn(actionMap,command.action)&&SHA.test(commandSha256??'')&&plain(command.nativeRequest),'PORTFOLIO_PACKET','A retained native request is incomplete.');
      exact(hash(contents),commandSha256,'PORTFOLIO_COMMAND_CHANGED','A retained native request changed.');
      const [kind]=actionMap[command.action];exact(command.kind,kind,'PORTFOLIO_COMMAND_CHANGED','A native request kind changed.');
      exact(hash({kind:command.kind,target:command.target,input:command.nativeRequest}),command.nativeRequestSha256,'PORTFOLIO_COMMAND_CHANGED','Original native request bytes changed.');
    }
    need(Array.isArray(packet.packets)&&packet.packets.length>0&&packet.packets.length<=1500,'PORTFOLIO_PACKET','The complete selected client period packets are missing.');
    need(new Set(packet.packets.map(row=>row.clientId+'/'+row.cycleId)).size===packet.packets.length,'PORTFOLIO_PACKET','The handover repeats a client period.');
    let expanded=0;
    for(const row of packet.packets){
      uid(row.clientId,'packet client');uid(row.cycleId,'packet period');
      const client=metadata.clients.find(item=>item.id===row.clientId),commission=client?.commissions.find(item=>item.id===client.latestCommissionId);
      need(commission&&row.alias===commission.alias&&row.clientWorkspaceId===commission.clientWorkspaceId,'PORTFOLIO_PACKET','The client period does not belong to its commissioned workspace.');
      need(Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.bytes<=RUNBOOK_PACKET_BYTES&&Number.isSafeInteger(row.compressedBytes)&&row.compressedBytes>0&&row.compressedBytes<=PORTFOLIO_PACKET_BYTES&&SHA.test(row.sha256??'')&&SHA.test(row.compressedSha256??''),'PORTFOLIO_PACKET','A complete native client packet has invalid size or digest.');
      expanded+=row.bytes;need(expanded<=PORTFOLIO_EXPANDED_BYTES,'PORTFOLIO_PACKET_LIMIT','The complete expanded client packets exceed 256 MiB.');
      need(typeof row.gzipBase64==='string'&&row.gzipBase64.length<=Math.ceil(row.compressedBytes/3)*4,'PORTFOLIO_PACKET','The complete compressed client packet is missing.');
      if(validateClients){const native=this.unpackClient(row),parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(native));
        this.runbooks.validatePacket(parsed);exact(parsed.cycle.id,row.cycleId,'PORTFOLIO_PACKET_CHANGED','The original client period identity changed.');
        exact(parsed.runbookId,commission.runbookId,'PORTFOLIO_PACKET_CHANGED','The original client runbook identity changed.');
        // A received native packet preserves its first authoring workspace in full.
        exact(parsed.originWorkspaceId,row.authoringWorkspaceId,'PORTFOLIO_PACKET_CHANGED','The original client authoring workspace changed.');
        need(typeof row.receivedSource==='boolean'&&(row.receivedSource?row.sourcePacketSha256===row.sha256:row.authoringWorkspaceId===row.clientWorkspaceId&&row.sourcePacketSha256===null),
          'PORTFOLIO_PACKET_CHANGED','The client source or received-packet binding changed.');
      }
    }
    exact(expanded,packet.expandedBytes,'PORTFOLIO_PACKET_CHANGED','The complete expanded packet size changed.');return packet;
  }
  unpackClient(row){
    const compressed=Buffer.from(row.gzipBase64,'base64');
    need(compressed.toString('base64')===row.gzipBase64&&compressed.length===row.compressedBytes&&digest(compressed)===row.compressedSha256,'PORTFOLIO_PACKET_CHANGED','The complete compressed client packet changed.',409);
    const bytes=gunzipSync(compressed,{maxOutputLength:RUNBOOK_PACKET_BYTES});
    need(bytes.length===row.bytes&&digest(bytes)===row.sha256,'PORTFOLIO_PACKET_CHANGED','The complete original client packet bytes changed.',409);return bytes;
  }
  async receive(input){
    const prior=await this.prior('received',input);if(prior)return prior;
    need(typeof input.content==='string'&&input.content.length<=Math.ceil(PORTFOLIO_PACKET_BYTES/3)*4,'PORTFOLIO_PACKET_LIMIT','Select the complete portfolio packet within 64 MiB.');
    const bytes=Buffer.from(input.content,'base64');need(bytes.toString('base64')===input.content,'PORTFOLIO_PACKET','Send complete portfolio packet bytes.');
    const packet=this.decodePacket(bytes,{validateClients:true}),sha256=digest(bytes);
    return this.mutate('received',input,async(state,actor)=>{
      const existing=state.received.find(row=>row.sha256===sha256);if(existing)return {receivedId:existing.id,received:clone(existing),reused:true};
      need(state.received.length<1000,'PORTFOLIO_RECEIVED_LIMIT','This workspace retains 1000 complete received portfolios.');
      await publishRunbookBlob(await this.storage(),sha256+'.json',bytes);
      const record={id:input.requestId,label:packet.label,receivedAt:now(),actor,originWorkspaceId:packet.originWorkspaceId,
        asOfWorkspaceRevision:packet.asOfWorkspaceRevision,sha256,bytes:bytes.length,packetSha256:packet.sha256,metadataSha256:packet.metadataSha256,
        clients:packet.metadata.clients.length,periodCount:packet.packets.length};
      state.received.push(record);return {receivedId:record.id,received:clone(record),reused:false};
    });
  }
  async received(id){
    await this.workspace.tail;const record=clone(this.receivedRow(id));
    const bytes=await readRunbookBytes(join(this.workspace.directory,'runbooks','portfolio',record.sha256+'.json'),record,PORTFOLIO_PACKET_BYTES);
    const packet=this.decodePacket(bytes);
    return this.envelope({received:record,metadata:packet.metadata,packets:packet.packets.map(({gzipBase64,...row})=>row)});
  }
  async clientPacket(receivedId,clientId,cycleId){
    await this.workspace.tail;const record=clone(this.receivedRow(receivedId));
    const bytes=await readRunbookBytes(join(this.workspace.directory,'runbooks','portfolio',record.sha256+'.json'),record,PORTFOLIO_PACKET_BYTES),packet=this.decodePacket(bytes);
    const selected=packet.packets.find(row=>row.clientId===clientId&&row.cycleId===cycleId);
    need(selected,'PORTFOLIO_CLIENT_PACKET_NOT_FOUND','Choose a complete client period from this received portfolio.',404);
    return {bytes:this.unpackClient(selected),name:'client-close-'+uid(cycleId,'client period')+'.json',type:'application/json; charset=utf-8'};
  }
  async adopt(input){
    const prior=await this.prior('adopted',input);if(prior)return prior;
    const received=(await this.received(input.receivedId)),record=received.received,metadata=received.metadata;
    exact(input.expectedPacketSha256,record.sha256,'PORTFOLIO_PACKET_CHANGED','Choose the exact received portfolio before commissioning its local clients.');
    need(Array.isArray(input.bindings)&&input.bindings.length>0&&input.bindings.length<=15&&new Set(input.bindings.map(row=>row.sourceClientId)).size===input.bindings.length,'PORTFOLIO_RECEIVING_BINDINGS','Choose distinct received clients and their already-received local workspaces.');
    const sourceFirm=metadata.firmEditions.find(row=>row.id===metadata.latestFirmEditionId),local=[];
    for(const binding of input.bindings){
      const sourceClient=metadata.clients.find(row=>row.id===binding.sourceClientId),commission=sourceClient?.commissions.find(row=>row.id===sourceClient.latestCommissionId);
      need(commission,'PORTFOLIO_RECEIVING_CLIENT','Choose a client from this complete received portfolio.',404);uid(binding.clientId,'new local client');
      const packets=received.packets.filter(row=>row.clientId===sourceClient.id);
      need(packets.length,'PORTFOLIO_RECEIVING_CLIENT','This handover does not include complete native periods for the selected client.',409);
      await this.child(binding.alias,async({runbooks})=>{
        exact(runbooks.workspaceId,binding.clientWorkspaceId,'PORTFOLIO_CLIENT_CHANGED','Refresh the local receiving client workspace.');
        exact(runbooks.workspace.state.revision,binding.clientRevision,'PORTFOLIO_CLIENT_REVISION_CHANGED','Refresh the received local client periods.');
        const book=runbooks.book(commission.runbookId);
        need(book.editions.some(row=>row.id===commission.editionId),'PORTFOLIO_RECEIVING_EDITION','Receive the commissioned procedure edition into its original local client desk first.',409);
        for(const packet of packets){
          const cycle=runbooks.cycle(packet.cycleId);
          need(cycle.readOnly===true&&cycle.receivedPacket?.sha256===packet.sha256,'PORTFOLIO_RECEIVING_PERIOD','Receive every selected complete native period into this local client desk first.',409);
        }
        local.push({clientId:binding.clientId,sourceClientId:sourceClient.id,commission:{...clone(commission),id:binding.clientId,alias:key(binding.alias,'receiving client alias'),
          clientWorkspaceId:runbooks.workspaceId,clientRevision:runbooks.workspace.state.revision,
          preparerId:binding.preparerId??commission.preparerId,backupId:binding.backupId??commission.backupId,reviewerId:binding.reviewerId??commission.reviewerId,
          receivedFrom:{packetId:record.id,packetSha256:record.sha256,clientId:sourceClient.id,originalCommissionId:commission.id}}});
      });
    }
    return this.mutate('adopted',input,(state,actor)=>{
      need(state.clients.length+local.length<=200,'PORTFOLIO_CLIENT_LIMIT','Use a receiving portfolio with room for these clients.');
      if(input.adoptFirm===true){
        exact(input.expectedFirmEditionId??null,state.latestFirmEditionId,'PORTFOLIO_FIRM_CHANGED','Refresh the receiving firm before adopting its standards.');
        need(state.firmEditions.length<200,'PORTFOLIO_FIRM_LIMIT','This workspace retains 200 firm editions.');
        state.firmEditions.push({...clone(sourceFirm),id:input.requestId,actor,createdAt:now(),receivedFrom:{packetId:record.id,originalFirmEditionId:sourceFirm.id}});
        state.latestFirmEditionId=input.requestId;
      }
      const firm=this.firm(),aliases=new Set(state.clients.map(row=>this.commissionRow(row.id).alias));
      for(const selected of local){
        need(!state.clients.some(row=>row.id===selected.clientId)&&!aliases.has(selected.commission.alias),'PORTFOLIO_RECEIVING_CONFLICT','Choose a fresh local client identity and unused receiving alias.',409);
        aliases.add(selected.commission.alias);
        need(selected.commission.preparerId!==selected.commission.backupId&&[selected.commission.preparerId,selected.commission.backupId,selected.commission.reviewerId].every(id=>firm.staff.some(row=>row.id===id)),'PORTFOLIO_RECEIVING_STAFF','Adopt the source firm staff or declare the same people in the receiving firm.');
        selected.commission.actor=actor;selected.commission.createdAt=now();selected.commission.firmEditionId=firm.id;
        state.clients.push({id:selected.clientId,createdAt:now(),latestCommissionId:selected.commission.id,commissions:[selected.commission]});
      }
      return {receivedId:record.id,firmEditionId:firm.id,clients:local.map(row=>({clientId:row.clientId,sourceClientId:row.sourceClientId,commissionId:row.commission.id}))};
    });
  }
  async calendarCsv(id){
    await this.workspace.tail;const plan=clone(this.planRow(id)),staff=new Map(plan.firm.staff.map(row=>[row.id,row.name])),rows=new Map(plan.rows.map(row=>[row.id,row]));
    const output=[['Calendar','Date','Person','Role','Minutes','Client','Period','Close date','Review date','Plan ID','Plan row ID','Client ID','Client workspace ID','Commission ID','Runbook ID','Edition ID','Period ID']];
    for(const entry of plan.calendar.allocations){const row=rows.get(entry.rowId);output.push([plan.label,entry.date,staff.get(entry.staffId)??entry.staffId,entry.role,entry.minutes,row.name,row.label,
      row.closeDate,row.reviewDate,plan.id,row.id,row.clientId,row.clientWorkspaceId,row.commissionId,row.runbookId,row.editionId,row.cycleId??'']);}
    return {bytes:Buffer.from(output.map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n'),name:'client-portfolio-'+plan.id+'-calendar.csv',type:'text/csv; charset=utf-8'};
  }
  async print(id){
    await this.workspace.tail;const plan=clone(this.planRow(id));
    const sections=plan.rows.map(row=>'<section><h2>'+escape(row.name)+' — '+escape(row.label)+'</h2><p>Close '+escape(row.closeDate)+' · Review '+escape(row.reviewDate)+'</p><dl>'+
      ['clientId','clientWorkspaceId','commissionId','runbookId','editionId','cycleId'].map(field=>'<dt>'+escape(field)+'</dt><dd>'+escape(row[field])+'</dd>').join('')+'</dl><p>Preparer '+escape(row.preparerId)+' · Backup '+escape(row.backupId)+' · Reviewer '+escape(row.reviewerId)+'</p>'+
      '<table><thead><tr><th>Date</th><th>Person</th><th>Work</th><th>Minutes</th></tr></thead><tbody>'+
      plan.calendar.allocations.filter(entry=>entry.rowId===row.id).map(entry=>'<tr><td>'+escape(entry.date)+'</td><td>'+escape(plan.firm.staff.find(person=>person.id===entry.staffId)?.name??entry.staffId)+'</td><td>'+escape(entry.role)+'</td><td>'+entry.minutes+'</td></tr>').join('')+'</tbody></table></section>').join('');
    const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(plan.label)+'</title><style>body{font:15px system-ui,sans-serif;color:#181818;max-width:1100px;margin:32px auto;padding:0 20px}h1,h2{font-weight:600}section{break-inside:avoid;border-top:1px solid #bbb;margin-top:24px;padding-top:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px;text-align:left}dt{font-weight:600}dd{margin:0 0 8px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0}}</style></head><body><h1>'+escape(plan.label)+'</h1><p>'+escape(plan.firm.name)+' · '+escape(plan.startDate)+' to '+escape(plan.endDate)+'</p><p>Saved by '+escape(plan.actor)+' at '+escape(plan.createdAt)+'</p><p>Calendar '+escape(plan.id)+' · Firm edition '+escape(plan.firmEditionId)+'</p><h2>Firm close and reporting standard</h2><pre>'+escape([plan.firm.closeStandard,plan.firm.reportingStandard,plan.firm.reportingCadence,plan.firm.escalationNote].join('\n\n'))+'</pre>'+sections+
      '<h2>Capacity exceptions</h2><pre>'+escape(JSON.stringify({conflicts:plan.calendar.conflicts,handling:plan.capacityExceptions},null,2))+'</pre></body></html>';
    return {bytes:Buffer.from(html),name:'client-portfolio-'+plan.id+'.html',type:'text/html; charset=utf-8'};
  }
}
export async function handlePortfolioRequest(portfolio,{method,path,value}){
  const parts=path.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='portfolio')return null;
  if(path==='/api/portfolio'&&method==='GET')return {value:await portfolio.view()};
  if(path==='/api/portfolio/live'&&method==='GET')return {value:await portfolio.live()};
  if(path==='/api/portfolio/settings'&&method==='POST')return {value:await portfolio.configure(value)};
  if(path==='/api/portfolio/clients'&&method==='POST')return {value:await portfolio.commission(value)};
  if(path==='/api/portfolio/preview'&&method==='POST')return {value:await portfolio.preview(value)};
  if(path==='/api/portfolio/plans'&&method==='POST')return {value:await portfolio.schedule(value)};
  if(path==='/api/portfolio/commands'&&method==='POST')return {value:await portfolio.prepare(value)};
  if(path==='/api/portfolio/captures'&&method==='POST')return {value:await portfolio.capture(value)};
  if(path==='/api/portfolio/receive'&&method==='POST')return {value:await portfolio.receive(value)};
  if(path==='/api/portfolio/adopt'&&method==='POST')return {value:await portfolio.adopt(value)};
  if(parts.length===4&&method==='GET'){
    const reader={sources:'source',clients:'client',plans:'plan',commands:'command',operations:'operation',received:'received'}[parts[2]];
    if(reader)return {value:await portfolio[reader](parts[3])};
  }
  if(parts.length===5&&parts[2]==='commands'&&parts[4]==='result'&&method==='GET')return {value:await portfolio.result(parts[3])};
  if(parts.length===5&&parts[2]==='commands'&&parts[4]==='execute'&&method==='POST')return {value:await portfolio.execute(parts[3],value)};
  if(parts.length===5&&parts[2]==='captures'&&parts[4]==='packet'&&method==='GET')return {file:await portfolio.packet(parts[3])};
  if(parts.length===5&&parts[2]==='plans'&&method==='GET'){
    if(parts[4]==='calendar.csv')return {file:await portfolio.calendarCsv(parts[3])};
    if(parts[4]==='print')return {file:await portfolio.print(parts[3])};
  }
  if(parts.length===9&&parts[2]==='received'&&parts[4]==='clients'&&parts[6]==='cycles'&&parts[8]==='packet'&&method==='GET')
    return {file:await portfolio.clientPacket(parts[3],parts[5],parts[7])};
  need(false,'NOT_FOUND','This portfolio operation was not found.',404);
}
