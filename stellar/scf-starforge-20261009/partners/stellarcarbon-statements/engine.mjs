// MIT. Customer assignment, dated statements and complete editable handover over original source editions.
import {SOURCE_SCHEMA,TABLES,KEYS,copy,need,plain,text,id,civilDate,dayOf,windowOf,inWindow,
  units,decimal,rowKey,receiveBackup,validateTables,sourceSummary} from './source.mjs';
export const WORKSPACE_SCHEMA = 'stellar-forge.stellarcarbon-workspace.v1';
export const STATEMENT_SCHEMA = 'stellar-forge.stellarcarbon-statement.v1';
export const HANDOVER_SCHEMA = 'stellar-forge.stellarcarbon-handover.v1';
export const now = () => new Date().toISOString();
export function newWorkspace({workspaceId,name,createdAt = now()}) {
  return {schema:WORKSPACE_SCHEMA,workspaceId:id(workspaceId),name:text(name,'workspace name',300),createdAt,
    revision:0,editions:[],customers:[],projects:[],assignments:[],statements:[],invoices:[],history:[],operations:[]};
}
export function validateWorkspace(value) {
  need(plain(value) && value.schema === WORKSPACE_SCHEMA,'WORKSPACE_SCHEMA','Choose a Stellarcarbon statements workspace.');
  id(value.workspaceId);
  need(Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    ['editions','customers','projects','assignments','statements','invoices','history','operations'].every(name=>Array.isArray(value[name])),
    'WORKSPACE_INVALID','The saved workspace is incomplete.');
  const editionIds = new Set();
  for (const source of value.editions) {
    need(source.schema === SOURCE_SCHEMA && !editionIds.has(source.id),'SOURCE_EDITION_INVALID','Keep distinct complete source editions.');
    editionIds.add(id(source.id));
    validateTables(source.tables,{format:source.format});
    if(source.format === 'native-backup') {
      const rebuilt = receiveBackup(source.files,source.metadata);
      need(JSON.stringify(rebuilt.tables) === JSON.stringify(source.tables),'SOURCE_CONTENT_CHANGED','The derived rows differ from the retained native files.');
    }
  }
  return value;
}
export function editionFor(state,editionId) {
  const edition = state.editions.find(row=>row.id === editionId);
  need(edition,'SOURCE_EDITION_NOT_FOUND','Choose a saved source edition.',404); return edition;
}
export function recordFor(rows,recordId,label) {
  const record = rows.find(row=>row.id === recordId);
  need(record,'RECORD_NOT_FOUND','Choose an existing '+label+'.',404); return record;
}
const stable = value => Array.isArray(value) ? value.map(stable) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
export const canonical = value => JSON.stringify(stable(value));
export function assignmentsFor(state,tx) {
  const priorities = {TRANSACTION:3,RECIPIENT:2,FUNDER:1};
  const candidates = state.assignments.filter(row=>row.active !== false &&
    (!row.fromDate || dayOf(tx.created_at) >= row.fromDate) &&
    (!row.beforeDate || dayOf(tx.created_at) < row.beforeDate) &&
    (row.kind === 'TRANSACTION' ? row.value === tx.hash : row.kind === 'RECIPIENT' ? row.value === tx.recipient : row.value === tx.funder));
  if(!candidates.length) return {status:'UNASSIGNED',customerId:null,projectId:null,assignmentIds:[]};
  const top = Math.max(...candidates.map(row=>priorities[row.kind]));
  const matches = candidates.filter(row=>priorities[row.kind] === top);
  const targets = new Set(matches.map(row=>row.customerId+':'+(row.projectId || '')));
  if(targets.size > 1) return {status:'CONFLICT',customerId:null,projectId:null,assignmentIds:matches.map(row=>row.id)};
  return {status:'ASSIGNED',customerId:matches[0].customerId,projectId:matches[0].projectId || null,assignmentIds:matches.map(row=>row.id)};
}
export function sourceIndex(state,editionId) {
  const source = editionFor(state,editionId);
  const retirements = new Map(source.tables.retirements.map(row=>[row.certificate_id,row]));
  const projects = new Map(source.tables.vcs_projects.map(row=>[row.id,row]));
  const allocationMap = new Map();
  for(const row of source.tables.sink_status) {
    const list = allocationMap.get(row.sinking_tx_hash) || [];
    list.push({...copy(row),retirement:copy(retirements.get(row.certificate_id))});
    allocationMap.set(row.sinking_tx_hash,list);
  }
  const contributions = source.tables.sinking_txs.map(tx=>{
    const allocations = allocationMap.get(tx.hash) || [];
    const filled = allocations.reduce((total,row)=>total+units(row.amount_filled),0n);
    const remaining = units(tx.carbon_amount)-filled;
    return {...copy(tx),assignment:assignmentsFor(state,tx),impactProject:copy(projects.get(tx.vcs_project_id) || null),
      allocations,allocated:decimal(filled),remaining:decimal(remaining),
      collectionStatus:remaining === 0n ? 'COMPLETE' : filled === 0n ? 'AWAITING_RETIREMENT' : 'PARTIAL',
      nativeFinalized:allocations.some(row=>row.finalized)};
  });
  return {source,contributions,retirements,projects};
}
function selectedTx(row,filter = {}) {
  if(filter.customerId && row.assignment.customerId !== filter.customerId) return false;
  if(filter.projectId && row.assignment.projectId !== filter.projectId) return false;
  if(filter.impactProjectId && row.vcs_project_id !== String(filter.impactProjectId)) return false;
  if(filter.assignmentStatus && row.assignment.status !== filter.assignmentStatus) return false;
  if(filter.status && row.collectionStatus !== filter.status) return false;
  if(filter.funder && row.funder !== filter.funder) return false;
  if(filter.recipient && row.recipient !== filter.recipient) return false;
  if(filter.fromDate && dayOf(row.created_at) < civilDate(filter.fromDate)) return false;
  if(filter.beforeDate && dayOf(row.created_at) >= civilDate(filter.beforeDate)) return false;
  const search = (filter.search || '').toLowerCase();
  return !search || [row.hash,row.toid,row.funder,row.recipient,row.memo_value || '',row.impactProject?.name || ''].some(value=>value.toLowerCase().includes(search));
}
function page(rows,{cursor = '',limit = 50} = {},key) {
  limit = Number(limit);
  need(Number.isInteger(limit) && limit >= 1 && limit <= 500,'INVALID_PAGE_LIMIT','Use a page size from 1 to 500.');
  if(cursor) need(/^\d+$/.test(String(cursor)),'INVALID_CURSOR','Use the original record cursor.');
  const ordered = [...rows].sort((a,b)=>BigInt(key(a)) < BigInt(key(b)) ? 1 : BigInt(key(a)) > BigInt(key(b)) ? -1 : 0);
  const selected = cursor ? ordered.filter(row=>BigInt(key(row)) < BigInt(String(cursor))) : ordered;
  const items = selected.slice(0,limit);
  return {items,total:ordered.length,limit,nextCursor:selected.length > limit ? key(items.at(-1)) : null};
}
export function contributionsPage(state,query = {}) {
  const index = sourceIndex(state,query.editionId || state.editions.at(-1)?.id);
  const rows = index.contributions.filter(row=>selectedTx(row,query));
  const result = page(rows,query,row=>row.toid);
  return {...result,editionId:index.source.id,totals:contributionTotals(rows)};
}
export function contributionDetail(state,editionId,hash) {
  const index = sourceIndex(state,editionId), row = index.contributions.find(tx=>tx.hash === hash);
  need(row,'CONTRIBUTION_NOT_FOUND','Choose a retained contribution.',404); return copy(row);
}
export function retirementRegister(state,query = {}) {
  const index = sourceIndex(state,query.editionId || state.editions.at(-1)?.id);
  const eligible = index.contributions.filter(row=>selectedTx(row,{customerId:query.customerId,projectId:query.projectId,impactProjectId:query.impactProjectId}));
  const byCertificate = new Map();
  for(const tx of eligible) for(const allocation of tx.allocations) {
    const list = byCertificate.get(allocation.certificate_id) || [];
    list.push({hash:tx.hash,toid:tx.toid,createdAt:tx.created_at,customerId:tx.assignment.customerId,projectId:tx.assignment.projectId,
      amount:allocation.amount_filled,finalized:allocation.finalized});
    byCertificate.set(allocation.certificate_id,list);
  }
  const rows = index.source.tables.retirements.filter(row=>
    (!query.fromDate || dayOf(row.retirement_date) >= civilDate(query.fromDate)) &&
    (!query.beforeDate || dayOf(row.retirement_date) < civilDate(query.beforeDate)) &&
    (!query.impactProjectId || row.vcs_project_id === String(query.impactProjectId)) &&
    (!query.beneficiary || row.retirement_beneficiary.startsWith(query.beneficiary)) &&
    (!(query.customerId || query.projectId) || byCertificate.has(row.certificate_id))
  ).map(row=> {
    const allocations = byCertificate.get(row.certificate_id) || [];
    return {...copy(row),allocations,attributedAmount:decimal(allocations.reduce((total,item)=>total+units(item.amount),0n)),
      impactProject:copy(index.projects.get(row.vcs_project_id) || null),
      blocks:copy(index.source.tables.retirement_from_block.filter(item=>item.retirement_id === row.certificate_id))};
  });
  const registerTotal = rows.reduce((total,row)=>total+units(row.vcu_amount),0n);
  const attributed = rows.reduce((total,row)=>total+units(row.attributedAmount),0n);
  return {editionId:index.source.id,rows,totals:{certificates:rows.length,certificateCarbon:decimal(registerTotal),attributedCarbon:decimal(attributed)}};
}
export function retirementsPage(state,query = {}) {
  const result = retirementRegister(state,query);
  return {...page(result.rows,query,row=>row.certificate_id),editionId:result.editionId,totals:result.totals};
}
export function retirementDetail(state,editionId,certificateId) {
  const index = sourceIndex(state,editionId);
  const row = retirementRegister(state,{editionId}).rows.find(row=>row.certificate_id === String(certificateId));
  need(row,'RETIREMENT_NOT_FOUND','Choose a retained retirement certificate.',404);
  return {...row,blocks:row.blocks.map(link=>({...link,block:copy(index.source.tables.minted_blocks.find(item=>item.serial_hash===link.block_hash) || null)}))};
}
export function contributionTotals(rows) {
  const assetTotals = {};
  for(const row of rows) for(const side of ['source','dest']) {
    const code = row[side+'_asset_code'], issuer = row[side+'_asset_issuer'], key = side+':'+code+':'+(issuer || '');
    const item = assetTotals[key] || {side,code,issuer,amount:0n};
    item.amount += units(row[side+'_asset_amount'],7); assetTotals[key] = item;
  }
  return {count:rows.length,carbon:decimal(rows.reduce((n,r)=>n+units(r.carbon_amount),0n)),
    allocated:decimal(rows.reduce((n,r)=>n+units(r.allocated),0n)),
    remaining:decimal(rows.reduce((n,r)=>n+units(r.remaining),0n)),
    complete:rows.filter(row=>row.collectionStatus==='COMPLETE').length,
    partial:rows.filter(row=>row.collectionStatus==='PARTIAL').length,
    unassigned:rows.filter(row=>row.assignment.status==='UNASSIGNED').length,
    conflicts:rows.filter(row=>row.assignment.status==='CONFLICT').length,
    assets:Object.values(assetTotals).map(item=>({...item,amount:decimal(item.amount,7)}))};
}
export function statementSpec(state,input) {
  need(plain(input),'STATEMENT_SPEC_REQUIRED','Enter the statement selection.');
  const source = editionFor(state,input.editionId), period = windowOf(input);
  const customerId = input.customerId || null, projectId = input.projectId || null;
  if(customerId) recordFor(state.customers,customerId,'customer');
  if(projectId) {
    const project = recordFor(state.projects,projectId,'customer project');
    need(!customerId || project.customerId === customerId,'PROJECT_CUSTOMER_MISMATCH','Choose a project for the selected customer.');
  }
  return {title:text(input.title,'statement title',300),editionId:source.id,...period,customerId,projectId,
    note:text(input.note || '','statement note',10000,true)};
}
export function prepareStatement(state,input) {
  const spec = statementSpec(state,input), index = sourceIndex(state,spec.editionId);
  const rows = index.contributions.filter(row=>selectedTx(row,spec));
  const register = retirementRegister(state,spec);
  const sourcePeriod = index.contributions.filter(row=>inWindow(row.created_at,spec));
  const usedHashes = new Set([...rows.map(row=>row.hash),...register.rows.flatMap(row=>row.allocations.map(item=>item.hash))]);
  const selected = index.contributions.filter(row=>usedHashes.has(row.hash));
  const assignmentIds = new Set(selected.flatMap(row=>row.assignment.assignmentIds));
  const customerIds = new Set([spec.customerId,...selected.map(row=>row.assignment.customerId)].filter(Boolean));
  const projectIds = new Set([spec.projectId,...selected.map(row=>row.assignment.projectId)].filter(Boolean));
  return {schema:STATEMENT_SCHEMA,spec,source:{id:index.source.id,format:index.source.format,importedAt:index.source.importedAt,
      metadata:copy(index.source.metadata),sha256:index.source.sha256 || null},
    customer:spec.customerId ? copy(recordFor(state.customers,spec.customerId,'customer')) : null,
    project:spec.projectId ? copy(recordFor(state.projects,spec.projectId,'customer project')) : null,
    contributionDateBasis:'created_at; inclusive fromDate and exclusive beforeDate',
    allocationDateBasis:'All retirement allocations attached to the selected contributions in this source edition, including later certificate dates.',
    retirementDateBasis:'retirement_date; inclusive fromDate and exclusive beforeDate, independently of contribution dates.',
    totals:contributionTotals(rows),retirementTotals:register.totals,
    coverage:{sourcePeriodTransactions:sourcePeriod.length,unassigned:sourcePeriod.filter(row=>row.assignment.status==='UNASSIGNED').length,
      conflictingAssignments:sourcePeriod.filter(row=>row.assignment.status==='CONFLICT').length},
    contributions:rows,retirements:register.rows,
    customerSnapshot:copy(state.customers.filter(row=>customerIds.has(row.id))),
    projectSnapshot:copy(state.projects.filter(row=>projectIds.has(row.id))),
    assignmentSnapshot:copy(state.assignments.filter(row=>assignmentIds.has(row.id)))};
}
function comparisonFields(table,before,after){
  const fields=[],representationChanges=[],fieldAvailabilityChanges=[];
  const carbonFields=new Set(['carbon_amount','amount_filled']);
  const assetFields=new Set(['source_asset_amount','dest_asset_amount']);
  const civilFields=new Set(table==='retirements'?['retirement_date','issuance_date','vintage_start','vintage_end']:table==='minted_blocks'?['vintage_start','vintage_end']:[]);
  const available=(row,name)=>Object.hasOwn(row,name)&&!(table==='sinking_txs'&&name==='contract_id'&&row.contract_id_reported===false);
  const comparable=(name,value)=>{
    if(value===null||value===undefined)return value;
    if(TABLES[table].includes(name)&&carbonFields.has(name))return units(String(value),3).toString();
    if(TABLES[table].includes(name)&&assetFields.has(name))return units(String(value),7).toString();
    if(civilFields.has(name)&&/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?)?$/.test(String(value)))return String(value).slice(0,10);
    return value;
  };
  for(const name of new Set([...Object.keys(before),...Object.keys(after)])){
    const left=available(before,name),right=available(after,name);
    const field={name,before:copy(before[name]??null),after:copy(after[name]??null)};
    if(left!==right){fieldAvailabilityChanges.push({...field,beforeAvailable:left,afterAvailable:right});continue;}
    if(!left||canonical(before[name])===canonical(after[name]))continue;
    if(canonical(comparable(name,before[name]))===canonical(comparable(name,after[name]))){representationChanges.push(field);continue;}
    if(table==='retirements'&&(name==='issuance_date'||name==='total_vintage_quantity')){
      field.category='instrument-metadata';
      field.sourcePlaceholder=name==='issuance_date'?dayOf(String(after[name]))==='0001-01-01':String(after[name])==='0';
      field.note=field.sourcePlaceholder?'The source reports a placeholder for this instrument field. Retired VCUs and allocation amounts retain their separate original values.':
        'The source reports changed instrument metadata. Retired VCUs and allocation amounts retain their separate original values.';
    }
    fields.push(field);
  }
  return {fields,representationChanges,fieldAvailabilityChanges};
}
export function compareEditions(state,beforeId,afterId) {
  const before = editionFor(state,beforeId), after = editionFor(state,afterId), tables = {};
  const coverageFor=(source,table)=>{
    const available=source.format==='native-backup'?Object.keys(TABLES):
      Array.isArray(source.metadata?.availableTables)?source.metadata.availableTables:
      source.format==='api-capture'?['sinking_txs','sink_status','retirements','retirement_from_block','vcs_projects']:Object.keys(source.tables);
    return {available:available.includes(table),scope:source.metadata?.viewScope||source.format};
  };
  for(const table of Object.keys(TABLES)) {
    const left = new Map(before.tables[table].map(row=>[rowKey(table,row),row]));
    const right = new Map(after.tables[table].map(row=>[rowKey(table,row),row]));
    const coverage={before:coverageFor(before,table),after:coverageFor(after,table)};
    const added = [], removed = [], changed = [], sourceDifferences=[];
    if(!coverage.before.available||!coverage.after.available){
      tables[table]={comparisonStatus:'unavailable',coverage,
        note:!coverage.before.available&&!coverage.after.available?'Neither source acquired this table.':!coverage.before.available?'The earlier source did not acquire this table.':'The later source did not acquire this table.',
        added,removed,changed,sourceDifferences,counts:{before:left.size,after:right.size,added:null,removed:null,changed:null,sourceDifferences:null}};
      continue;
    }
    for(const [key,row] of right) {
      if(!left.has(key)) added.push({key,after:copy(row)});
      else if(canonical(left.get(key)) !== canonical(row)) {
        const old=left.get(key),difference=comparisonFields(table,old,row);
        if(difference.fields.length)changed.push({key,before:copy(old),after:copy(row),fields:difference.fields});
        if(difference.representationChanges.length||difference.fieldAvailabilityChanges.length)
          sourceDifferences.push({key,before:copy(old),after:copy(row),representationChanges:difference.representationChanges,fieldAvailabilityChanges:difference.fieldAvailabilityChanges});
      }
    }
    for(const [key,row] of left) if(!right.has(key)) removed.push({key,before:copy(row)});
    tables[table] = {comparisonStatus:'available',coverage,note:'Typed values are compared within retained table populations. Original formatting and field availability changes remain in sourceDifferences.',added,removed,changed,sourceDifferences,counts:{before:left.size,after:right.size,added:added.length,removed:removed.length,changed:changed.length,sourceDifferences:sourceDifferences.length}};
  }
  const previous = sourceSummary(before), current = sourceSummary(after);
  const deltaAvailable=['sinking_txs','sink_status'].every(table=>tables[table].comparisonStatus==='available');
  return {schema:'stellar-forge.stellarcarbon-comparison.v1',beforeId,afterId,previous,current,
    deltaAvailable,delta:{carbon:deltaAvailable?decimal(units(current.carbon)-units(previous.carbon)):null,
      allocated:deltaAvailable?decimal(units(current.allocated)-units(previous.allocated)):null,
      remaining:deltaAvailable?decimal(units(current.remaining)-units(previous.remaining)):null},tables};
}
function saveRecord(rows,input,context,normalize) {
  const recordId = input.id ? id(input.id) : context.recordId, existing = rows.find(row=>row.id===recordId);
  if(existing) need(input.expectedVersion === existing.version,'STALE_RECORD','Reload the current record before saving.',409);
  const record = {...normalize(input),id:recordId,version:(existing?.version || 0)+1,
    createdAt:existing?.createdAt || context.at,updatedAt:context.at};
  if(existing) rows[rows.indexOf(existing)] = record; else rows.push(record);
  return record;
}
export function mutate(state,operation) {
  validateWorkspace(state);
  need(plain(operation) && plain(operation.value),'OPERATION_REQUIRED','Send one complete operation.');
  const requestId = id(operation.requestId,'request ID'), actor = text(operation.actor,'operator',300);
  const intent = operation.intentSha256 || canonical({action:operation.action,value:operation.value,actor});
  const previous = state.operations.find(row=>row.requestId === requestId);
  if(previous) {
    need(previous.intent === intent,'REQUEST_REUSED','This request ID belongs to another operation.',409);
    return {state,result:copy(previous.result),replayed:true};
  }
  need(operation.revision === state.revision,'STALE_WORKSPACE','Reload the workspace before saving this change.',409);
  const next = copy(state), value = operation.value, context = {recordId:id(operation.recordId || requestId),at:operation.at || now()};
  let result;
  if(operation.action === 'import') {
    const source = value.source;
    need(source?.schema === SOURCE_SCHEMA,'SOURCE_EDITION_REQUIRED','Import one complete original source edition.');
    validateTables(source.tables,{format:source.format});
    if(source.format==='native-backup') {
      const native = receiveBackup(source.files,source.metadata);
      need(canonical(native.tables)===canonical(source.tables),'SOURCE_CONTENT_CHANGED','Keep rows tied to their original native files.');
    }
    const existing = source.sha256 && next.editions.find(row=>row.sha256===source.sha256);
    if(existing) result = {edition:{id:existing.id,label:existing.label,...sourceSummary(existing)},alreadyPresent:true};
    else {
      const edition = {...copy(source),id:context.recordId,label:text(value.label,'source edition label',300),importedAt:context.at};
      next.editions.push(edition); result = {edition:{id:edition.id,label:edition.label,...sourceSummary(edition)}};
    }
  } else if(operation.action === 'customer') {
    result = {customer:saveRecord(next.customers,value,context,input=>({
      name:text(input.name,'customer name',300),reference:text(input.reference || '','customer reference',300,true),
      note:text(input.note || '','customer note',6000,true),
      merchantCustomerId:input.merchantCustomerId ? id(input.merchantCustomerId,'accounting customer ID') : null,
    }))};
  } else if(operation.action === 'project') {
    recordFor(next.customers,value.customerId,'customer');
    if(value.id) need(next.assignments.filter(row=>row.projectId===value.id).every(row=>row.customerId===value.customerId),
      'PROJECT_ASSIGNMENT_CUSTOMER','Keep this project with its assigned customer or update its assignments first.');
    result = {project:saveRecord(next.projects,value,context,input=>({
      customerId:input.customerId,name:text(input.name,'customer project name',300),
      reference:text(input.reference || '','project reference',300,true),note:text(input.note || '','project note',6000,true),
    }))};
  } else if(operation.action === 'assignment') {
    need(['TRANSACTION','RECIPIENT','FUNDER'].includes(value.kind),'ASSIGNMENT_KIND','Choose transaction, recipient or funder.');
    recordFor(next.customers,value.customerId,'customer');
    if(value.projectId) need(recordFor(next.projects,value.projectId,'customer project').customerId===value.customerId,
      'PROJECT_CUSTOMER_MISMATCH','The selected project belongs to another customer.');
    const selection = text(value.value,'source hash or address',160);
    need(value.kind==='TRANSACTION' ? /^[a-fA-F0-9]{64}$/.test(selection) : /^[GC][A-Z2-7]{55}$/.test(selection),
      'ASSIGNMENT_SOURCE_INVALID','Choose an original transaction hash or Stellar account/contract address.');
    if(value.fromDate) civilDate(value.fromDate); if(value.beforeDate) civilDate(value.beforeDate);
    if(value.fromDate && value.beforeDate) need(value.fromDate<value.beforeDate,'INVALID_PERIOD','The assignment end must follow its start.');
    result = {assignment:saveRecord(next.assignments,value,context,input=>({
      kind:input.kind,value:selection,customerId:input.customerId,projectId:input.projectId || null,
      fromDate:input.fromDate || null,beforeDate:input.beforeDate || null,active:input.active !== false,
      note:text(input.note || '','assignment note',3000,true),
    }))};
  } else if(operation.action === 'statement') {
    const report = prepareStatement(next,value), statementId = value.id ? id(value.id) : context.recordId;
    let statement = next.statements.find(row=>row.id === statementId);
    if(statement) need(value.expectedVersion === statement.versions.length,'STALE_STATEMENT','Reopen the current statement before revising it.',409);
    else { statement = {id:statementId,createdAt:context.at,versions:[]}; next.statements.push(statement); }
    const version = {version:statement.versions.length+1,createdAt:context.at,actor,...report};
    statement.versions.push(version); result = {statementId,version:{version:version.version,createdAt:version.createdAt,title:version.spec.title}};
  } else if(operation.action === 'invoice-link') {
    recordFor(next.statements,value.statementId,'statement');
    need(Number.isSafeInteger(value.statementVersion) && value.statementVersion>0,'INVOICE_STATEMENT_VERSION','Choose the saved statement edition.');
    const invoiceId = id(value.invoiceId,'invoice ID'), workspaceId = id(value.accountingWorkspaceId,'accounting workspace ID');
    const existing = next.invoices.find(row=>row.invoiceId===invoiceId && row.accountingWorkspaceId===workspaceId);
    if(existing) result = {invoice:copy(existing)};
    else { const link = {...copy(value),invoiceId,accountingWorkspaceId:workspaceId,id:context.recordId,createdAt:context.at,actor};
      next.invoices.push(link); result = {invoice:link}; }
  } else if(operation.action === 'settings') {
    next.name=text(value.name,'workspace name',300); result={name:next.name};
  } else throw Object.assign(new Error('Unknown workspace operation.'),{code:'UNKNOWN_OPERATION',status:404});
  next.revision++;
  next.history.push({requestId,action:operation.action,actor,at:context.at,revision:next.revision,recordId:context.recordId});
  next.operations.push({requestId,intent,result:copy(result),revision:next.revision});
  return {state:next,result:copy(result),replayed:false};
}
export function workspaceOverview(state) {
  return {schema:state.schema,workspaceId:state.workspaceId,name:state.name,revision:state.revision,
    editions:state.editions.map(source=>({id:source.id,label:source.label,format:source.format,importedAt:source.importedAt,
      metadata:copy(source.metadata),sha256:source.sha256,...sourceSummary(source)})),
    customers:copy(state.customers),projects:copy(state.projects),assignments:copy(state.assignments),
    statements:state.statements.map(row=>({id:row.id,createdAt:row.createdAt,versions:row.versions.map(version=>({
      version:version.version,createdAt:version.createdAt,title:version.spec.title,editionId:version.spec.editionId,
      customerId:version.spec.customerId,projectId:version.spec.projectId,fromDate:version.spec.fromDate,beforeDate:version.spec.beforeDate,
      totals:copy(version.totals),retirementTotals:copy(version.retirementTotals)}))})),
    invoices:copy(state.invoices),history:copy(state.history).reverse()};
}
export function statementVersion(state,statementId,version) {
  const statement = recordFor(state.statements,statementId,'statement');
  const selected = version ? statement.versions.find(row=>row.version===Number(version)) : statement.versions.at(-1);
  need(selected,'STATEMENT_VERSION_NOT_FOUND','Choose a saved statement version.',404); return copy(selected);
}
export function exportHandover(state) {
  validateWorkspace(state);
  return {schema:HANDOVER_SCHEMA,exportedAt:now(),workspace:copy(state)};
}
export function receiveHandover(value) {
  need(plain(value) && value.schema === HANDOVER_SCHEMA,'HANDOVER_SCHEMA','Choose the complete exported workspace JSON.');
  return copy(validateWorkspace(value.workspace));
}
export function invoiceDraftForStatement(state,statementId,value) {
  const report = statementVersion(state,statementId,value.statementVersion);
  need(report.customer?.merchantCustomerId,'ACCOUNTING_CUSTOMER_REQUIRED','Link this customer to an original accounting customer, then save a revised statement.');
  need(typeof value.amount==='string','INVOICE_AMOUNT_REQUIRED','Enter the agreed service fee as a decimal string.');
  const issueDate=civilDate(value.issueDate,'invoice date'),dueDate=civilDate(value.dueDate,'invoice due date');
  need(dueDate>=issueDate,'INVALID_INVOICE_DATES','The due date must follow the invoice date.');
  return {customerId:report.customer.merchantCustomerId,currency:copy(value.currency),issueDate,dueDate,
    sourceReference:'Stellarcarbon statement '+statementId+' version '+report.version+'; source '+report.spec.editionId,
    note:value.note || report.spec.note,lines:[{description:report.spec.title+' ('+report.spec.fromDate+' to before '+report.spec.beforeDate+')',
      quantity:'1',unitAmount:value.amount,discountAmount:'0',taxAmount:value.taxAmount || '0'}]};
}
