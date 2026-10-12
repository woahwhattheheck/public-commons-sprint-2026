// MIT. Commissioning in the original Timescale workspace and operation journal.
import { identity, fault, stamp, digest } from '../publisher/files.mjs';
import { uuid, hash, only, checkText, projectionContract, nativeTarget, sameNativeTarget } from './contracts.mjs';
import { selectNativeTable, compareNativeTables } from './commissioning-tables.mjs';
import { renderCommissioningReport } from './commissioning-report.mjs';
const SCHEMA='stellar-forge.timescale-commissioning.v1';
const RECEIPT='stellar-forge.timescale-commissioning-change.v1';
const ACTIONS=['create','edit','bind-source','import-table','compare','observe','decide','complete','reopen'];
const STATES=['OPEN','HANDED_OVER'];
const DECISIONS=['NOT_RUN','PASS','FAIL','DEFERRED','NOT_APPLICABLE'];
const clone=value=>structuredClone(value);
const text=(value,label,max=8000,empty=false)=>checkText(value,label,max,empty);
function fail(code,message,status=400){throw fault('TIMESCALE_COMMISSIONING_'+code,message,status);}
function integer(value,label,min=0){if(!Number.isSafeInteger(value)||value<min)fail('INTEGER','Provide '+label+'.');return value;}
function page(rows,{offset=0,limit=25}={}){integer(offset,'a page offset');integer(limit,'a page size',1);if(limit>100)fail('PAGE','Use at most 100 rows per page.');return {total:rows.length,offset,limit,next:offset+limit<rows.length?offset+limit:null,rows:rows.slice(offset,offset+limit)};}
function parsed(textValue){try{return JSON.parse(textValue.replace(/^\uFEFF/,''));}catch{fail('JSON','The complete original file must contain valid UTF-8 JSON.');}}
function originalFile(value,maximum){
  only(value,['filename','content','tableName']);
  const filename=text(value.filename,'the original filename',240);
  if(filename.includes('/')||filename.includes('\\')||filename==='.'||filename==='..')fail('FILENAME','Use the original basename without a directory.');
  if(typeof value.content!=='string'||Buffer.byteLength(value.content,'utf8')>maximum)fail('SOURCE_SIZE','The complete original file exceeds the supported transfer size.');
  const tableName=value.tableName===undefined||value.tableName===null?null:text(value.tableName,'the native table name',256);
  return {filename,content:value.content,tableName,bytes:Buffer.byteLength(value.content,'utf8'),sha256:digest(Buffer.from(value.content,'utf8'))};
}
function intake(original){
  const value=parsed(original.content),fields=value?.source_contract,criteria=value?.acceptance;
  if(!fields||typeof fields!=='object'||Array.isArray(fields)||!Object.keys(fields).length||Object.keys(fields).length>256||
      !Array.isArray(criteria)||!criteria.length||criteria.length>1000)
    fail('INTAKE','The intake needs source_contract fields and a complete acceptance array.');
  const contract=Object.fromEntries(Object.entries(fields).map(([name,row])=>{
    text(name,'a source-contract key',256);
    if(!row||typeof row!=='object'||Array.isArray(row)||!Object.hasOwn(row,'value'))fail('INTAKE_FIELD','Each original field needs description and value.');
    return [name,{description:text(row.description,'the source-field description',4000),value:clone(row.value),
      disposition:row.value===null?'PENDING':'PROVIDED',reason:''}];
  }));
  const seen=new Set(),acceptance=criteria.map(row=>{
    const id=text(row.id,'an acceptance criterion ID',128);
    if(seen.has(id))fail('CRITERION_DUPLICATE','Original acceptance criterion IDs must be unique.');seen.add(id);
    return {id,title:text(row.check??row.title,'the acceptance criterion',1000),
      condition:text(row.pass??row.condition,'the actual acceptance condition',16000),
      expectedSource:text(row.evidence??row.expectedSource??'','the expected source',8000,true),
      decision:'NOT_RUN',assessment:'',owner:'',references:[],assessedAt:null,contractRevision:null};
  });
  return {title:text(value.title??original.filename,'the commissioning title',128),contract,acceptance,
    originalFormat:typeof value.format==='string'?value.format:null};
}
function requestShape(input){
  const fields={create:['intake','title','owner'],edit:['contract','title','owner'],
    'bind-source':['selection'],'import-table':['source','role','title'],compare:['expectedSourceId','observedSourceId','mapping','title'],
    observe:['operationId','operationDigest','relevance'],decide:['criterionId','decision','assessment','owner','references'],
    complete:['disposition','statement','followUpOwner'],reopen:[]};
  if(!input||!ACTIONS.includes(input.action))fail('ACTION','Choose a commissioning action.');
  only(input,['requestId','expectedVersion','action','actor','note',...(input.action==='create'?[]:['commissioningId','expectedRevision']),...fields[input.action]]);
  uuid(input.requestId);text(input.actor,'the operator',128);text(input.note,'the purpose of this change');
  if(input.expectedVersion!==undefined)integer(input.expectedVersion,'the workspace version');
  if(input.action!=='create'){uuid(input.commissioningId);integer(input.expectedRevision,'the commissioning revision',1);}
}
function summary(item){return {id:item.id,title:item.title,owner:item.owner,status:item.status,revision:item.revision,
  digest:identity(item),contractRevision:item.contractRevision,createdAt:item.createdAt,updatedAt:item.updatedAt,
  criteria:item.acceptance.length,passed:item.acceptance.filter(x=>x.decision==='PASS').length,
  open:item.acceptance.filter(x=>!['PASS','NOT_APPLICABLE'].includes(x.decision)).length,
  sources:item.sources.length,comparisons:item.comparisons.length,observations:item.observations.length};}
function createTimescaleCommissioning(workspace){
  for(const name of ['exclusive','operations','status','operation','edition','getPlan','readRecord','retainRecord'])
    if(typeof workspace?.[name]!=='function')throw new TypeError('Use the original Timescale workspace with paged operations.');
  const workspaceId=uuid(workspace.settings.id);let cached=null;
  function scan(){
    const version=workspace.operations({kind:'commissioning',limit:1}).version;if(cached?.version===version)return cached;
    const histories=new Map();let offset=0;
    for(;;){
      const selected=workspace.operations({kind:'commissioning',offset,limit:100});
      if(selected.version!==version)fail('CHANGED','Reload the same commissioning history.',409);
      for(const row of selected.operations.rows){
        if(row.state!=='COMPLETE')continue;
        const result=row.data.result,item=result?.item;
        if(result?.schema!==RECEIPT||result.workspaceId!==workspaceId||result.requestId!==row.id||
            !item||item.schema!==SCHEMA||item.workspaceId!==workspaceId||result.commissioningId!==item.id||
            result.revision!==item.revision||result.digest!==identity(item)||!ACTIONS.includes(result.action)||
            !STATES.includes(item.status))fail('HISTORY_CHANGED','An original commissioning revision does not match its operation.',409);
        const rows=histories.get(item.id)??[];rows.push({operationId:row.id,...result});histories.set(item.id,rows);
      }
      if(selected.operations.next===null)break;offset=selected.operations.next;
    }
    const items=new Map();
    for(const [id,rows] of histories){
      rows.sort((a,b)=>a.revision-b.revision);let previous=null;
      for(const row of rows){
        if(row.revision!==(previous?.revision??0)+1||row.item.previousDigest!==(previous?identity(previous):null)||
            (!previous&&(row.action!=='create'||row.requestId!==id))||
            (previous&&(row.item.createdAt!==previous.createdAt||row.item.createdBy!==previous.createdBy)))
          fail('HISTORY_CHAIN','Keep the complete original commissioning revision history.',409);
        previous=row.item;
      }
      items.set(id,previous);
    }
    return cached={version,items,histories};
  }
  function current(id,revision){
    const ledger=scan(),item=ledger.items.get(uuid(id));
    if(!item)fail('NOT_FOUND','Select a retained commissioning project.',404);
    if(revision!==undefined&&item.revision!==revision)fail('REVISION_CHANGED','Reload this project before changing it; keep any original pending request.',409);
    return {ledger,item};
  }
  function list(options={}){
    only(options,['offset','limit','q','status']);const ledger=scan();
    if(options.status&&!STATES.includes(options.status))fail('STATE','Choose Open or Handed over.');
    const query=String(options.q??'').toLocaleLowerCase();
    const items=[...ledger.items.values()].filter(item=>(!options.status||item.status===options.status)&&
      (!query||[item.title,item.owner,item.id].some(v=>v.toLocaleLowerCase().includes(query))))
      .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id)).map(summary);
    return {schema:'stellar-forge.timescale-commissioning-list.v1',workspaceId,version:ledger.version,items:page(items,options)};
  }
  function item(id){
    const selected=current(id);
    return {schema:'stellar-forge.timescale-commissioning-detail.v1',workspaceId,version:selected.ledger.version,
      item:clone(selected.item),digest:identity(selected.item),history:selected.ledger.histories.get(id).map(row=>({
        requestId:row.requestId,revision:row.revision,action:row.action,actor:row.actor,note:row.note,at:row.at,digest:row.digest}))};
  }
  async function intakeFile(id){
    const selected=current(id),descriptor=selected.item.intake;
    const original=(await workspace.readRecord(descriptor.original)).data;
    if(original.schema!=='stellar-forge.timescale-commissioning-intake.v1'||original.filename!==descriptor.filename||
        typeof original.content!=='string'||digest(Buffer.from(original.content,'utf8'))!==descriptor.sha256||
        Buffer.byteLength(original.content,'utf8')!==descriptor.bytes)
      fail('INTAKE_CHANGED','The complete original intake no longer matches.',409);
    return {descriptor:clone(descriptor),original};
  }
  async function source(id,sourceId){
    const selected=current(id),descriptor=selected.item.sources.find(row=>row.id===uuid(sourceId));
    if(!descriptor)fail('SOURCE_NOT_FOUND','Choose a complete retained source in this project.',404);
    const record=(await workspace.readRecord(descriptor.original)).data;
    if(record.schema!=='stellar-forge.timescale-commissioning-source.v1'||record.filename!==descriptor.filename||
        digest(Buffer.from(record.content,'utf8'))!==descriptor.sha256||Buffer.byteLength(record.content,'utf8')!==descriptor.bytes)
      fail('SOURCE_CHANGED','The original source file does not match its retained identity.',409);
    const table=selectNativeTable(parsed(record.content),descriptor.tableName);
    if(identity(table)!==descriptor.tableDigest||table.rows.length!==descriptor.rows)
      fail('SOURCE_CHANGED','The complete selected native table has changed.',409);
    return {descriptor:clone(descriptor),original:record,table};
  }
  async function comparisonOriginal(id,comparisonId){
    const selected=current(id),descriptor=selected.item.comparisons.find(row=>row.id===uuid(comparisonId));
    if(!descriptor)fail('COMPARISON_NOT_FOUND','Select a retained complete comparison.',404);
    const record=(await workspace.readRecord(descriptor.original)).data;
    if(record.schema!=='stellar-forge.timescale-commissioning-comparison.v1'||identity(record)!==descriptor.digest)
      fail('COMPARISON_CHANGED','The original comparison no longer matches.',409);
    return {workspaceId,version:selected.ledger.version,descriptor:clone(descriptor),record};
  }
  async function comparison(id,comparisonId,{offset=0,limit=25}={}){
    const original=await comparisonOriginal(id,comparisonId),record=original.record;
    return {workspaceId,version:original.version,descriptor:original.descriptor,mode:record.mode,mapping:record.mapping,
      counts:record.counts,matches:record.matches,interpretation:record.interpretation,
      expectedOnly:page(record.expectedOnly,{offset,limit}),observedOnly:page(record.observedOnly,{offset,limit})};
  }
  async function context(id,{offset=0,limit=25,kind}={}){
    const selected=current(id),operations=workspace.operations({offset,limit,...(kind?{kind}: {})});
    if(operations.version!==selected.ledger.version)fail('CHANGED','Reload the source choices.',409);
    const status=workspace.status({offset,limit});
    return {workspaceId,version:status.version,commissioningId:id,commissioningRevision:selected.item.revision,
      operations:operations.operations,editions:status.editions,plans:status.plans,
      selection:selected.item.source?clone(selected.item.source.selection):null};
  }
  function changedContract(next){
    next.contractRevision++;
    next.acceptance=next.acceptance.map(row=>({...row,decision:'NOT_RUN',assessment:'',owner:'',references:[],assessedAt:null,contractRevision:null}));
    next.handover=null;
  }
  function reference(item,ref){
    only(ref,['kind','id']);
    if(!['comparison','observation','source'].includes(ref.kind))fail('REFERENCE','Choose a retained comparison, native observation or original source.');
    uuid(ref.id);
    const rows={comparison:item.comparisons,observation:item.observations,source:item.sources}[ref.kind];
    const selected=rows.find(row=>row.id===ref.id);
    if(!selected)fail('REFERENCE_NOT_FOUND','The assessment reference is not in this commissioning project.');
    if(selected.contractRevision!==item.contractRevision)fail('REFERENCE_SUPERSEDED','Use a source or observation retained for the current source contract.');
    return {kind:ref.kind,id:ref.id,digest:identity(selected)};
  }
  async function observe(item,input,actor,at){
    const row=workspace.operation(uuid(input.operationId));
    if(identity(row)!==hash(input.operationDigest))fail('OPERATION_CHANGED','Reopen the exact original native operation before recording it.',409);
    if(!['capture','review','prepare-refresh','refresh','verification','prepare-job','job-change','select-aggregate','extraction','remediation'].includes(row.kind))
      fail('OPERATION_KIND','Choose an original source, publication, native verification or assigned-work operation.');
    let target=null,editionId=null;
    if(row.kind==='capture'&&row.data.result?.editionId){
      const selected=await workspace.edition(row.data.result.editionId);target=nativeTarget(selected.value);editionId=selected.value.id;
    }else if(row.input?.planId){const plan=workspace.getPlan(row.input.planId);if(row.input.planDigest&&plan.digest!==row.input.planDigest)fail('PLAN_CHANGED','Keep the original native plan.');target=plan.data.target??null;}
    if(item.source&&target&&!sameNativeTarget(item.source.projection.target,target))fail('TARGET_CHANGED','The native outcome belongs to another database.');
    for(const value of [row.data.result?.native,row.data.dispatch?.before].filter(Boolean))await workspace.readRecord(value);
    return {id:input.requestId,contractRevision:item.contractRevision,operationId:row.id,operationDigest:identity(row),
      kind:row.kind,state:row.state,at,actor,relevance:text(input.relevance,'what this actual outcome establishes'),
      target,editionId,original:await workspace.retainRecord({schema:'stellar-forge.timescale-commissioning-observation.v1',operation:row})};
  }
  function command(input){
    input=clone(input);requestShape(input);
    // Bind the original UUID to the full file identity. Keep the file body once
    // in original content-addressed records, not in every status/history poll.
    const uploaded=input.action==='create'?originalFile(input.intake,1048576):input.action==='import-table'?originalFile(input.source,6291456):null;
    const journalInput=clone(input);
    if(uploaded){const {content,...descriptor}=uploaded;journalInput[input.action==='create'?'intake':'source']=descriptor;}
    return workspace.exclusive('commissioning',journalInput,async({signal})=>{
      signal.throwIfAborted();
      const actor=text(input.actor,'the operator',128),note=text(input.note,'the purpose of this change'),at=stamp();
      let next,previous=null;
      if(input.action==='create'){
        const file=uploaded,selected=intake(file);
        if(file.tableName!==null)fail('INTAKE_TABLE','The intake is a whole JSON document.');
        next={schema:SCHEMA,workspaceId,id:input.requestId,revision:1,previousDigest:null,
          createdAt:at,createdBy:actor,updatedAt:at,updatedBy:actor,title:text(input.title??selected.title,'the project title',128),
          owner:text(input.owner,'the technical owner',128),status:'OPEN',contractRevision:1,contract:selected.contract,
          intake:{filename:file.filename,bytes:file.bytes,sha256:file.sha256,format:selected.originalFormat,
            original:await workspace.retainRecord({schema:'stellar-forge.timescale-commissioning-intake.v1',filename:file.filename,content:file.content})},
          source:null,sources:[],comparisons:[],observations:[],acceptance:selected.acceptance,handover:null};
      }else{
        previous=current(input.commissioningId,input.expectedRevision).item;
        next={...clone(previous),revision:previous.revision+1,previousDigest:identity(previous),updatedAt:at,updatedBy:actor};
        if(previous.status==='HANDED_OVER'&&input.action!=='reopen')fail('REOPEN','Reopen this handed-over project before changing its retained decisions.',409);
        if(input.action==='edit'){
          only(input.contract,Object.keys(previous.contract));
          if(Object.keys(input.contract).length!==Object.keys(previous.contract).length)fail('CONTRACT_COMPLETE','Keep every original source-contract field.');
          const contract=Object.fromEntries(Object.entries(previous.contract).map(([key,row])=>{
            const value=input.contract[key];only(value,['value','disposition','reason']);
            if(!Object.hasOwn(value,'value')||!['PROVIDED','PENDING','NOT_APPLICABLE'].includes(value.disposition))fail('CONTRACT_FIELD','Select Provided, Pending or Not applicable for every field.');
            const reason=text(value.reason??'','the field explanation',4000,true);
            if(value.disposition==='NOT_APPLICABLE'&&!reason.trim())fail('CONTRACT_REASON','Explain why the selected field does not apply.');
            if(value.disposition==='PROVIDED'&&(value.value===null||value.value===undefined))fail('CONTRACT_VALUE','A provided field needs its actual value.');
            return [key,{description:row.description,value:clone(value.value),disposition:value.disposition,reason}];
          }));
          if(identity(contract)!==identity(previous.contract)){changedContract(next);next.source=null;}
          next.contract=contract;next.title=text(input.title,'the project title',128);next.owner=text(input.owner,'the technical owner',128);
        }else if(input.action==='bind-source'){
          const selected=await workspace.edition(uuid(input.selection?.editionId));
          if(selected.record.digest!==hash(input.selection.editionDigest))fail('EDITION_CHANGED','Select the exact retained source edition.',409);
          const projection=projectionContract(selected.value,input.selection),binding={selection:clone(input.selection),projection,at,actor};
          if(!previous.source||identity(previous.source.selection)!==identity(input.selection))changedContract(next);
          next.source=binding;
        }else if(input.action==='import-table'){
          if(!['BASELINE','OBSERVED'].includes(input.role))fail('ROLE','Choose Baseline or Observed.');
          if(next.sources.length>=256)fail('SOURCE_LIMIT','This commissioning project already contains 256 complete source files.');
          const file=uploaded,table=selectNativeTable(parsed(file.content),file.tableName);
          next.sources.push({id:input.requestId,contractRevision:next.contractRevision,role:input.role,title:text(input.title,'the source title',128),
            filename:file.filename,bytes:file.bytes,sha256:file.sha256,tableName:file.tableName,tableDigest:identity(table),
            rows:table.rows.length,columns:table.names,actor,at,
            original:await workspace.retainRecord({schema:'stellar-forge.timescale-commissioning-source.v1',filename:file.filename,content:file.content})});
        }else if(input.action==='compare'){
          const a=await source(next.id,input.expectedSourceId),b=await source(next.id,input.observedSourceId);
          if(a.descriptor.role!=='BASELINE'||b.descriptor.role!=='OBSERVED')fail('COMPARISON_ROLES','Compare one Baseline with one Observed source.');
          if(a.descriptor.contractRevision!==next.contractRevision||b.descriptor.contractRevision!==next.contractRevision)
            fail('SOURCE_SUPERSEDED','Retain the sources for this current source contract before comparing.');
          if(next.comparisons.length>=256)fail('COMPARISON_LIMIT','This project already retains 256 complete comparisons.');
          const compared=compareNativeTables(a.table,b.table,input.mapping),record={...compared,
            workspaceId,commissioningId:next.id,contractRevision:next.contractRevision,requestId:input.requestId,
            expectedSourceId:a.descriptor.id,observedSourceId:b.descriptor.id,
            expectedSourceDigest:a.descriptor.sha256,observedSourceDigest:b.descriptor.sha256,createdAt:at,actor};
          next.comparisons.push({id:input.requestId,contractRevision:next.contractRevision,title:text(input.title,'the comparison title',128),
            expectedSourceId:a.descriptor.id,observedSourceId:b.descriptor.id,matches:record.matches,counts:record.counts,
            digest:identity(record),original:await workspace.retainRecord(record),actor,at});
        }else if(input.action==='observe'){
          if(next.observations.length>=1024)fail('OBSERVATION_LIMIT','This project already retains 1024 native observations.');
          next.observations.push(await observe(next,input,actor,at));
        }else if(input.action==='decide'){
          const index=next.acceptance.findIndex(row=>row.id===input.criterionId);
          if(index<0||!DECISIONS.includes(input.decision))fail('DECISION','Choose an original criterion and a supported decision.');
          if(!Array.isArray(input.references)||input.references.length>64)fail('REFERENCES','Supply the selected original references.');
          const refs=input.references.map(ref=>reference(next,ref));
          if(new Set(refs.map(ref=>ref.kind+':'+ref.id)).size!==refs.length)fail('REFERENCE_DUPLICATE','Select each original reference once.');
          if(input.decision==='PASS'&&!refs.length)fail('ASSESSMENT_SOURCE','Select the actual source or outcome supporting this Pass assessment.');
          next.acceptance[index]={...next.acceptance[index],decision:input.decision,
            assessment:text(input.assessment,'the actual result and assessment'),owner:text(input.owner,'the acceptance owner',128),
            references:refs,assessedAt:at,assessedBy:actor,contractRevision:next.contractRevision};
        }else if(input.action==='complete'){
          if(!['ACCEPTED','WITH_OPEN_ITEMS'].includes(input.disposition))fail('HANDOVER','Choose Accepted or Handover with open items.');
          const open=next.acceptance.filter(row=>!['PASS','NOT_APPLICABLE'].includes(row.decision)).map(row=>row.id);
          const pending=Object.entries(next.contract).filter(([,row])=>row.disposition==='PENDING').map(([key])=>key);
          if(input.disposition==='ACCEPTED'&&(open.length||pending.length))fail('OPEN_ITEMS','Complete the outstanding acceptance/source fields or hand over with named open items.');
          const followUpOwner=text(input.followUpOwner??'','the follow-up owner',128,true);
          if(input.disposition==='WITH_OPEN_ITEMS'&&!followUpOwner.trim())fail('FOLLOW_UP_OWNER','Name the owner of the remaining work.');
          next.handover={at,actor,disposition:input.disposition,statement:text(input.statement,'the actual technical handover statement'),
            followUpOwner,openCriteria:open,pendingFields:pending,contractRevision:next.contractRevision};
          next.status='HANDED_OVER';
        }else if(input.action==='reopen'){
          if(previous.status!=='HANDED_OVER')fail('ALREADY_OPEN','This commissioning project is already open.');
          next.status='OPEN';next.handover=null;
        }
      }
      signal.throwIfAborted();
      return {schema:RECEIPT,workspaceId,requestId:input.requestId,action:input.action,actor,note,at,
        commissioningId:next.id,revision:next.revision,digest:identity(next),item:next};
    });
  }
  async function fullReport(id){
    const selected=item(id),currentItem=selected.item;
    const intakeRecord=(await intakeFile(id)).original,sources=[],comparisons=[],observations=[];
    for(const row of currentItem.sources){const value=await source(id,row.id);sources.push({descriptor:value.descriptor,original:value.original});}
    for(const row of currentItem.comparisons){const value=(await workspace.readRecord(row.original)).data;if(identity(value)!==row.digest)fail('COMPARISON_CHANGED','Keep the complete original comparison.',409);comparisons.push({descriptor:row,result:value});}
    for(const row of currentItem.observations){
      const value=(await workspace.readRecord(row.original)).data;
      if(identity(value.operation)!==row.operationDigest)fail('OPERATION_CHANGED','Keep the recorded original native outcome.',409);
      const nativeRecords=[];
      for(const reference of [value.operation.data.result?.native,value.operation.data.dispatch?.before].filter(Boolean))
        nativeRecords.push({reference,data:(await workspace.readRecord(reference)).data});
      observations.push({descriptor:row,result:value,nativeRecords});
    }
    if(workspace.operations({kind:'commissioning',limit:1}).version!==selected.version)fail('CHANGED','The project changed during report assembly; read this same project again.',409);
    return {schema:'stellar-forge.timescale-commissioning-report.v1',workspaceId,commissioningId:id,
      revision:currentItem.revision,digest:selected.digest,generatedAt:stamp(),complete:true,
      project:selected,revisions:clone(current(id).ledger.histories.get(id)),intake:intakeRecord,sources,comparisons,observations,
      meaning:'Technical commissioning and operator assessments for the selected source contract. Commercial acceptance and payment are recorded separately by the parties.'};
  }
  function publishReport(input){
    input=clone(input);only(input,['requestId','expectedVersion','commissioningId','expectedRevision','expectedDigest']);
    uuid(input.requestId);uuid(input.commissioningId);integer(input.expectedRevision,'the selected commissioning revision',1);hash(input.expectedDigest);
    return workspace.exclusive('commissioning-report',input,async()=>{
      const selected=current(input.commissioningId,input.expectedRevision);
      if(identity(selected.item)!==input.expectedDigest)fail('REVISION_CHANGED','Publish the selected complete commissioning revision.',409);
      const sourceBytes=selected.item.intake.bytes+selected.item.sources.reduce((bytes,source)=>bytes+source.bytes,0);
      if(sourceBytes>256000000)fail('REPORT_SIZE','The complete original source files already exceed 256,000,000 bytes. Export and receive the complete workspace with all source files and revisions.',413);
      const report=await fullReport(input.commissioningId);
      const documents=[{filename:'commissioning-'+selected.item.id+'-r'+selected.item.revision+'.json',type:'application/json',content:JSON.stringify(report,null,2)+'\n'},
        {filename:'commissioning-'+selected.item.id+'-r'+selected.item.revision+'.html',type:'text/html; charset=utf-8',content:renderCommissioningReport(report)}];
      // The original retained-file reader snapshots each complete Buffer. Apply
      // its actual default capacity before storing either report file. The full
      // source/history remains in the original portable-workspace export.
      for(const document of documents)if(Buffer.byteLength(document.content,'utf8')>256000000)
        fail('REPORT_SIZE','The complete report exceeds 256,000,000 bytes per file. Export and receive the complete original workspace to preserve every source and revision.',413);
      const files=[];
      for(const document of documents)files.push({filename:document.filename,type:document.type,
        bytes:Buffer.byteLength(document.content,'utf8'),sha256:digest(Buffer.from(document.content,'utf8')),
        original:await workspace.retainRecord({schema:'stellar-forge.timescale-commissioning-report-file.v1',...document})});
      return {schema:'stellar-forge.timescale-commissioning-report-export.v1',requestId:input.requestId,workspaceId,
        commissioningId:selected.item.id,revision:selected.item.revision,digest:input.expectedDigest,
        workspaceVersion:report.project.version,createdAt:report.generatedAt,files,complete:true};
    });
  }
  function reports(id,options={}){
    only(options,['offset','limit']);const selected=current(id),rows=[];let offset=0;
    for(;;){
      const page=workspace.operations({kind:'commissioning-report',offset,limit:100});
      if(page.version!==selected.ledger.version)fail('CHANGED','Reload the original report list.',409);
      for(const operation of page.operations.rows){
        const result=operation.data.result;
        if(operation.state!=='COMPLETE'||result?.commissioningId!==id)continue;
        if(result.schema!=='stellar-forge.timescale-commissioning-report-export.v1'||result.workspaceId!==workspaceId||
            result.requestId!==operation.id||result.complete!==true)fail('REPORT_CHANGED','The original report identity no longer matches.',409);
        rows.push({requestId:operation.id,createdAt:operation.created,revision:result.revision,digest:result.digest,files:clone(result.files)});
      }
      if(page.operations.next===null)break;offset=page.operations.next;
    }
    return {workspaceId,version:selected.ledger.version,commissioningId:id,reports:page(rows,options)};
  }
  async function reportFile(requestId,format='json'){
    const original=workspace.operation(uuid(requestId));
    if(original.kind!=='commissioning-report'||original.state!=='COMPLETE'||original.data.result?.complete!==true)
      fail('REPORT_NOT_COMPLETE','Select the completed original report request.',409);
    if(!['json','html'].includes(format))fail('FORMAT','Choose JSON or HTML.');
    const descriptor=original.data.result.files.find(row=>row.filename.endsWith('.'+format));
    if(!descriptor)fail('REPORT_FILE','The completed report does not contain this format.',404);
    const document=(await workspace.readRecord(descriptor.original)).data;
    if(document.schema!=='stellar-forge.timescale-commissioning-report-file.v1'||document.filename!==descriptor.filename||
        Buffer.byteLength(document.content,'utf8')!==descriptor.bytes||digest(Buffer.from(document.content,'utf8'))!==descriptor.sha256)
      fail('REPORT_CHANGED','The complete original report file has changed.',409);
    return {descriptor,content:document.content};
  }
  return Object.freeze({list,item,intakeFile,source,comparison,comparisonOriginal,context,command,fullReport,publishReport,reports,reportFile});
}
export { createTimescaleCommissioning, SCHEMA, ACTIONS, DECISIONS };
