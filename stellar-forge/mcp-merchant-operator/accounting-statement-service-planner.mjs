// MIT. Plan the next exact native service period and prepare the original closing cycle.
import {createHash} from 'node:crypto';
import {accountingStatementSelection,accountingStatementPreview,connectAccountingStatementClient} from './accounting-statement-client.mjs';
import {prepareAccountingStatementCycle} from './accounting-statement-cycle.mjs';

const PREFIX='stellar-forge.accounting-statement-service';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const nativeDigest=value=>sha(JSON.stringify(value,null,2)+'\n');
const stamp=value=>typeof value==='string'?Date.parse(value):NaN;
const pick=(value,fields)=>Object.fromEntries(fields.map(key=>[key,value[key]??null]));
const fail=(code,message)=>Object.assign(new Error(message),{code:'ACCOUNTING_STATEMENT_SERVICE_'+code,status:409});
function need(ok,message,code='INPUT'){if(!ok)throw fail(code,message);}
function fields(value,allowed){need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key)),'Use the declared service-close fields.');}
function key(value,pattern,name){need(typeof value==='string'&&pattern.test(value),'Select the exact '+name+'.');return value;}
const problem=(code,message,statementIds=[])=>({code,message,statementIds});
const customerFields=['id','reference','name','version'];
const bindingFields=['id','orderRef','customerId','label','version','historyCount'];
const statementFields=['id','number','customerId','customerReference','customerName','runId','usageId','usageOpeningId','servicePeriod','createdAt','status','replacesId','supersededBy','requestId','previewSha256','from','until'];
const runFields=['id','name','status','createdAt','completedAt','reportSha256','period'];
const captureFields=['id','name','sha256','bytes','createdAt','sourceCreatedAt','sourceRevision','sourceSchema','orderCount','periodEligible','periodIdentity','periodIdentitySha256','pass','unavailableCode'];

async function allRuns(client,signal){
  const items=[];let offset=0,revision,total;
  for(;;){
    signal?.throwIfAborted();
    const result=await client.status({view:'runs',offset,limit:200},{requestSignal:signal}),page=result.page;
    need(page?.kind==='runs'&&Array.isArray(page.items)&&page.offset===offset&&Number.isSafeInteger(page.total)&&page.total>=0,
      'Read the complete original accounting-run inventory.','PAGE');
    revision??=result.revision;total??=page.total;
    need(revision===result.revision&&total===page.total,'The accounting runs changed during this read. Refresh the planner.','INVENTORY_CHANGED');
    items.push(...page.items);
    if(page.nextOffset===null){need(items.length===total,'The accounting-run inventory ended early.','PAGE');return {items,revision};}
    need(page.nextOffset===offset+page.items.length&&page.nextOffset>offset&&page.nextOffset<total,'The accounting-run page did not advance.','PAGE');
    offset=page.nextOffset;
  }
}
function index(rows,field,name){
  need(Array.isArray(rows),'Read the complete original '+name+'.','INVENTORY');
  const result=new Map();
  for(const row of rows){
    need(plain(row)&&typeof row[field]==='string'&&!result.has(row[field]),'The original '+name+' repeats an identity.','INVENTORY');
    result.set(row[field],row);
  }
  return result;
}
function capture(row){
  const result=pick(row,captureFields);
  need(row.schema==='stellar-forge.merchant-service-capture.v1'&&UUID.test(result.id)&&SHA.test(result.sha256)&&
    Number.isFinite(stamp(result.sourceCreatedAt))&&typeof result.periodEligible==='boolean',
    'Read the original retained service-capture catalogue.','CAPTURE');
  if(result.periodEligible){
    need(result.sourceSchema==='stellar-forge.sf101.api-pass-export.v1'&&result.orderCount===1&&plain(result.periodIdentity)&&
      SHA.test(result.periodIdentitySha256)&&nativeDigest(result.periodIdentity)===result.periodIdentitySha256&&plain(result.pass)&&
      Object.entries(result.periodIdentity).every(([name,value])=>result.pass[name]===value),
      'The capture catalogue differs from its original immutable pass identity.','CAPTURE');
  }else need(result.periodIdentity===null&&result.periodIdentitySha256===null&&result.pass===null,
    'An ineligible capture must retain its original source classification.','CAPTURE');
  return result;
}
function periodRecord(statement,captures){
  const p=statement.servicePeriod;
  if(!p)return null;
  const opening=captures.get(statement.usageOpeningId),closing=captures.get(statement.usageId);
  const complete=opening?.periodEligible&&closing?.periodEligible&&
    opening.periodIdentitySha256===closing.periodIdentitySha256&&opening.pass.orderRef===p.orderRef&&
    opening.sourceCreatedAt===p.from&&closing.sourceCreatedAt===p.until&&stamp(p.until)>stamp(p.from);
  return {...clone(statement),sourceMatches:Boolean(complete),periodIdentitySha256:complete?opening.periodIdentitySha256:null,
    openingCapture:opening?{id:opening.id,sha256:opening.sha256,createdAt:opening.sourceCreatedAt}:null,
    closingCapture:closing?{id:closing.id,sha256:closing.sha256,createdAt:closing.sourceCreatedAt}:null};
}
function coverage(periods){
  const ordered=[...periods].sort((a,b)=>stamp(a.servicePeriod.from)-stamp(b.servicePeriod.from)||
    stamp(a.servicePeriod.until)-stamp(b.servicePeriod.until)||a.id.localeCompare(b.id));
  const gaps=[],overlaps=[],boundaries=[];let frontier=null,cluster=null;
  const finish=()=>{if(cluster?.overlap)overlaps.push({from:cluster.from,until:cluster.until,statementIds:cluster.ids});};
  const endings=new Map();
  for(const row of ordered){
    const p=row.servicePeriod,from=stamp(p.from),until=stamp(p.until),previous=endings.get(from)??[];
    const other=previous.filter(item=>item.usageId!==row.usageOpeningId);
    if(other.length)boundaries.push({at:p.from,statementIds:[...other.map(item=>item.id),row.id],
      closingCaptureIds:[...new Set(other.map(item=>item.usageId))],openingCaptureId:row.usageOpeningId});
    if(!endings.has(until))endings.set(until,[]);endings.get(until).push(row);
    if(frontier&&from>stamp(frontier.until))gaps.push({from:frontier.until,until:p.from,
      precedingStatementIds:frontier.ids,followingStatementId:row.id});
    if(!frontier||until>stamp(frontier.until))frontier={until:p.until,ids:[row.id]};
    else if(until===stamp(frontier.until))frontier.ids.push(row.id);
    if(cluster&&from<stamp(cluster.until)){
      cluster.overlap=true;cluster.ids.push(row.id);if(until>stamp(cluster.until))cluster.until=p.until;
    }else{finish();cluster={from:p.from,until:p.until,ids:[row.id],overlap:false};}
  }
  finish();return {gaps,overlaps,boundaries};
}
function latestSuggestion(captures,current,unresolved,otherCustomer){
  let opening=null,basisStatementIds=[],basis='FIRST_CAPTURE',ambiguous=false;
  if(current.length){
    const last=current.reduce((value,row)=>Math.max(value,stamp(row.servicePeriod.until)),-Infinity),atEnd=current.filter(row=>stamp(row.servicePeriod.until)===last);
    const ids=[...new Set(atEnd.map(row=>row.usageId))];
    if(ids.length===1&&!unresolved.length){opening=captures.find(row=>row.id===ids[0])??null;basisStatementIds=atEnd.map(row=>row.id);basis='CURRENT_PERIOD';}
    else ambiguous=true;
  }else if(!unresolved.length&&!otherCustomer.length){
    const first=captures[0],atStart=first?captures.filter(row=>stamp(row.sourceCreatedAt)===stamp(first.sourceCreatedAt)):[];
    if(atStart.length===1)opening=first;else ambiguous=true;
  }
  else ambiguous=true;
  let closing=null;
  if(opening){
    const later=captures.filter(row=>stamp(row.sourceCreatedAt)>stamp(opening.sourceCreatedAt));
    if(later.length){
      const latest=stamp(later.at(-1).sourceCreatedAt),last=later.filter(row=>stamp(row.sourceCreatedAt)===latest);
      if(last.length===1)closing=last[0];else ambiguous=true;
    }
  }
  return {openingId:opening?.id??null,closingId:closing?.id??null,basis,basisStatementIds,
    state:ambiguous?'CHOOSE_CAPTURES':closing?(current.length?'NEXT_CAPTURE_AVAILABLE':'FIRST_PERIOD'):'NO_LATER_CAPTURE'};
}
function groupInventory(source){
  const customers=index(source.customers,'id','customers'),bindings=index(source.bindings,'orderRef','order assignments');
  const captures=index(source.captures,'id','service captures'),statements=index(source.statements,'id','statements'),groups=new Map(),unassigned=[];
  const byOrder=new Map(),cumulative=new Map();
  for(const statement of source.statements){
    need(UUID.test(statement.id)&&['RETAINED','SUPERSEDED','WITHDRAWN'].includes(statement.status),'Read the original statement status.','INVENTORY');
    if(statement.servicePeriod){
      need(Number.isFinite(stamp(statement.servicePeriod.from))&&Number.isFinite(stamp(statement.servicePeriod.until)),
        'The retained period has no original source dates.','INVENTORY');
      const order=statement.servicePeriod.orderRef;
      if(!byOrder.has(order))byOrder.set(order,[]);byOrder.get(order).push(periodRecord(statement,captures));
    }else if(statement.usageId){
      const original=captures.get(statement.usageId);
      if(original?.periodEligible){
        const key=statement.customerId+':'+original.periodIdentitySha256;
        if(!cumulative.has(key))cumulative.set(key,[]);cumulative.get(key).push(clone(statement));
      }
    }
  }
  for(const original of source.captures){
    if(!original.periodEligible)continue;
    const binding=bindings.get(original.pass.orderRef),customer=binding?customers.get(binding.customerId):null;
    if(!binding||!customer){unassigned.push({captureId:original.id,orderRef:original.pass.orderRef,name:original.name,sourceCreatedAt:original.sourceCreatedAt});continue;}
    const id=binding.id+':'+original.periodIdentitySha256;
    if(!groups.has(id))groups.set(id,{id,customer:clone(customer),binding:clone(binding),
      pass:clone(original.periodIdentity),planLabel:original.pass.planLabel,captures:[]});
    groups.get(id).captures.push(clone(original));
  }
  const rows=[];
  for(const row of groups.values()){
    row.captures.sort((a,b)=>stamp(a.sourceCreatedAt)-stamp(b.sourceCreatedAt)||a.sha256.localeCompare(b.sha256));
    row.periodIdentitySha256=row.captures[0].periodIdentitySha256;
    const sameOrder=byOrder.get(row.pass.orderRef)??[];
    row.history=sameOrder.filter(s=>s.customerId===row.customer.id&&s.periodIdentitySha256===row.periodIdentitySha256);
    row.otherCustomerHistory=sameOrder.filter(s=>s.customerId!==row.customer.id&&s.periodIdentitySha256===row.periodIdentitySha256);
    row.unresolvedHistory=sameOrder.filter(s=>s.customerId===row.customer.id&&!s.sourceMatches);
    row.cumulativeStatements=cumulative.get(row.customer.id+':'+row.periodIdentitySha256)??[];
    row.history.sort((a,b)=>stamp(b.servicePeriod.until)-stamp(a.servicePeriod.until)||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
    const current=row.history.filter(s=>s.status==='RETAINED');
    row.coverage=coverage(current);row.suggestion=latestSuggestion(row.captures,current,row.unresolvedHistory,row.otherCustomerHistory);
    row.warnings=[];
    if(row.coverage.gaps.length)row.warnings.push(problem('GAPS_IN_CURRENT_PERIODS',
      row.coverage.gaps.length+' interval(s) between current statements have no retained period statement.'));
    if(row.coverage.overlaps.length)row.warnings.push(problem('OVERLAPPING_CURRENT_PERIODS',
      'Some current statement periods overlap. Inspect their original ranges and correction history.',
      [...new Set(row.coverage.overlaps.flatMap(item=>item.statementIds))]));
    if(row.coverage.boundaries.length)row.warnings.push(problem('DIFFERENT_BOUNDARY_CAPTURES',
      'Adjacent periods use different capture identities at a shared source time.',
      [...new Set(row.coverage.boundaries.flatMap(item=>item.statementIds))]));
    if(row.unresolvedHistory.length)row.warnings.push(problem('UNRESOLVED_PERIOD_SOURCES',
      'Some saved period identities do not match this retained capture catalogue. Select and inspect the exact original captures.',
      row.unresolvedHistory.map(s=>s.id)));
    if(row.otherCustomerHistory.length)row.warnings.push(problem('PREVIOUS_CUSTOMER_PERIODS',
      'This pass also has period statements for a different customer. Review its assignment history and select the intended opening.',
      row.otherCustomerHistory.map(s=>s.id)));
    for(const statement of row.history){
      if(statement.supersededBy){
        const successor=statements.get(statement.supersededBy);
        if(!successor||successor.replacesId!==statement.id||successor.customerId!==statement.customerId)
          row.warnings.push(problem('LIFECYCLE_REFERENCE_CHANGED','A retained correction reference needs inspection.',[statement.id,statement.supersededBy]));
      }
    }
    row.counts={captures:row.captures.length,current:current.length,superseded:row.history.filter(s=>s.status==='SUPERSEDED').length,
      withdrawn:row.history.filter(s=>s.status==='WITHDRAWN').length,cumulative:row.cumulativeStatements.length};
    rows.push(row);
  }
  rows.sort((a,b)=>a.customer.name.localeCompare(b.customer.name)||a.customer.reference.localeCompare(b.customer.reference)||
    a.pass.orderRef.localeCompare(b.pass.orderRef)||a.periodIdentitySha256.localeCompare(b.periodIdentitySha256));
  return {rows,unassigned};
}
/** One coherent paged read. The native catalogue supplies every actual pass identity. */
export async function readAccountingStatementServicePlanner({client,signal}={}){
  need(client&&typeof client.allUsageCaptures==='function','Use the installed customer statement client with the retained capture catalogue.','CLIENT');
  signal?.throwIfAborted();const options={requestSignal:signal};
  const [customers,bindings,captures,statements,runs]=await Promise.all([
    client.allCustomers(options),client.allBindings({},options),client.allUsageCaptures(options),client.allStatements({},options),allRuns(client,signal)
  ]);
  const revision=customers.revision;
  need(Number.isSafeInteger(revision)&&revision>=1&&[bindings,captures,statements,runs].every(result=>result.revision===revision),
    'The original workspace changed during the planner read. Refresh it to receive one current catalogue.','INVENTORY_CHANGED');
  signal?.throwIfAborted();
  const source={workspace:client.workspace,endpoint:client.endpoint??null,revision,
    customers:customers.items.map(row=>pick(row,customerFields)),bindings:bindings.items.map(row=>pick(row,bindingFields)),
    captures:captures.items.map(capture),statements:statements.items.map(row=>pick(row,statementFields)),runs:runs.items.map(row=>pick(row,runFields))};
  const {rows,unassigned}=groupInventory(source);
  return {schema:PREFIX+'-planner.v1',...source,observedAt:new Date().toISOString(),inventorySha256:digest(source),rows,unassigned,
    counts:{customers:source.customers.length,passes:rows.length,captures:source.captures.length,
      nativeCaptures:source.captures.filter(row=>row.periodEligible).length,otherCaptures:source.captures.filter(row=>!row.periodEligible).length,
      unassignedCaptures:unassigned.length,readyPasses:rows.filter(row=>row.suggestion.closingId).length,
      passesWithHistoryNotes:rows.filter(row=>row.warnings.length).length}};
}
function verifyInventory(inventory){
  need(plain(inventory)&&inventory.schema===PREFIX+'-planner.v1'&&SHA.test(inventory.inventorySha256??''),'Use the complete original service planner inventory.','INVENTORY');
  const source=pick(inventory,['workspace','endpoint','revision','customers','bindings','captures','statements','runs']);
  need(digest(source)===inventory.inventorySha256,'The retained service planner inventory changed. Refresh it.','INVENTORY_CHANGED');
  // Derive groups again from the bound source; browser-supplied suggestions are never authoritative.
  return {...inventory,...groupInventory(source)};
}
function selectedWarnings(row,opening,closing,replacesId){
  const warnings=clone(row.warnings),from=stamp(opening.sourceCreatedAt),until=stamp(closing.sourceCreatedAt);
  const current=row.history.filter(s=>s.status==='RETAINED'&&s.id!==replacesId);
  const overlapping=current.filter(s=>stamp(s.servicePeriod.from)<until&&stamp(s.servicePeriod.until)>from);
  if(overlapping.length)warnings.push(problem('SELECTED_PERIOD_OVERLAPS',
    'The selected interval overlaps current statement(s): '+overlapping.map(s=>s.number).join(', ')+'.',
    overlapping.map(s=>s.id)));
  const same=current.filter(s=>s.usageOpeningId===opening.id&&s.usageId===closing.id);
  if(same.length)warnings.push(problem('SELECTED_PERIOD_ALREADY_RETAINED',
    'These exact opening and closing captures already appear in current statement(s): '+same.map(s=>s.number).join(', ')+'.',
    same.map(s=>s.id)));
  const earlier=current.filter(s=>stamp(s.servicePeriod.until)<=from).sort((a,b)=>stamp(b.servicePeriod.until)-stamp(a.servicePeriod.until));
  if(earlier.length){
    const last=earlier[0],end=stamp(last.servicePeriod.until);
    if(end<from)warnings.push(problem('GAP_BEFORE_SELECTED_PERIOD','A gap remains from '+last.servicePeriod.until+' to '+opening.sourceCreatedAt+'.',[last.id]));
    else if(last.usageId!==opening.id)warnings.push(problem('SELECTED_BOUNDARY_DIFFERS',
      'The selected opening has the same time as the preceding close and a different original capture identity.',[last.id]));
  }
  if(replacesId){
    const previous=row.history.find(s=>s.id===replacesId);
    if(previous.usageOpeningId!==opening.id||previous.usageId!==closing.id)
      warnings.push(problem('CORRECTION_CHANGES_CAPTURE_PAIR','This correction selects different source captures from '+previous.number+'.',[previous.id]));
  }
  return warnings;
}
/** Convert explicit choices to original statement selections; coverage notes remain visible. */
export function compileAccountingStatementServicePlan({inventory,choices}={}){
  inventory=verifyInventory(inventory);
  need(Array.isArray(choices)&&choices.length>0&&choices.length<=2000,'Select between one and 2,000 original service periods.');
  const rowsById=index(inventory.rows,'id','customer passes'),runs=index(inventory.runs,'id','completed runs'),seen=new Set();
  const rows=choices.map((choice,index)=>{
    fields(choice,['rowId','runId','usageOpeningId','usageId','replacesId','from','until']);
    const row=rowsById.get(choice.rowId);need(row,'Choose a current customer and immutable purchased pass.','PASS');
    const opening=row.captures.find(item=>item.id===choice.usageOpeningId),closing=row.captures.find(item=>item.id===choice.usageId);
    need(opening&&closing,'Select the original opening and closing captures for this purchased pass.','CAPTURE');
    need(stamp(closing.sourceCreatedAt)>stamp(opening.sourceCreatedAt),'Select a closing capture later than the opening.','PERIOD_ORDER');
    const run=runs.get(key(choice.runId,UUID,'completed accounting run'));need(run,'Choose a completed original accounting run.','RUN');
    const replacesId=choice.replacesId??null;
    if(replacesId)need(row.history.some(s=>s.id===replacesId&&s.status==='RETAINED'),
      'Select a current retained period statement for this same customer and purchased pass.','CORRECTION');
    const selection=accountingStatementSelection({customerId:row.customer.id,runId:run.id,usageId:closing.id,
      usageOpeningId:opening.id,replacesId,...(choice.from!==undefined||choice.until!==undefined?{from:choice.from,until:choice.until}:{})});
    const signature=JSON.stringify(selection);need(!seen.has(signature),'Each complete selected period appears once in this cycle.','DUPLICATE');seen.add(signature);
    return {index,rowId:row.id,customer:clone(row.customer),binding:clone(row.binding),pass:clone(row.pass),planLabel:row.planLabel,
      periodIdentitySha256:row.periodIdentitySha256,opening:clone(opening),closing:clone(closing),run:clone(run),selection,
      replaces:replacesId?clone(row.history.find(s=>s.id===replacesId)):null,
      warnings:selectedWarnings(row,opening,closing,replacesId)};
  });
  const content={schema:PREFIX+'-plan.v1',workspace:inventory.workspace,endpoint:inventory.endpoint,
    inventorySha256:inventory.inventorySha256,inventoryRevision:inventory.revision,observedAt:inventory.observedAt,rows,
    selections:rows.map(row=>clone(row.selection)),counts:{statements:rows.length,customers:new Set(rows.map(row=>row.customer.id)).size,
      corrections:rows.filter(row=>row.selection.replacesId).length,withNotes:rows.filter(row=>row.warnings.length).length}};
  return validateAccountingStatementServicePlan({...content,planSha256:digest(content)});
}
/** Validate a portable prepared selection before it enters the existing cycle engine. */
export function validateAccountingStatementServicePlan(plan){
  fields(plan,['schema','workspace','endpoint','inventorySha256','inventoryRevision','observedAt','rows','selections','counts','planSha256']);
  const {planSha256,...content}=plan;
  need(plan.schema===PREFIX+'-plan.v1'&&SHA.test(planSha256??'')&&digest(content)===planSha256&&
    SHA.test(plan.inventorySha256??'')&&Number.isSafeInteger(plan.inventoryRevision)&&plan.inventoryRevision>=1&&
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(plan.workspace??'')&&Array.isArray(plan.rows)&&plan.rows.length>0&&plan.rows.length<=2000&&
    Array.isArray(plan.selections)&&plan.rows.length===plan.selections.length&&Number.isFinite(stamp(plan.observedAt))&&
    (plan.endpoint===null||typeof plan.endpoint==='string')&&plain(plan.counts),
    'Use the complete saved service-close plan.','PLAN');
  const seen=new Set();
  plan.rows.forEach((row,index)=>{
    const selected=accountingStatementSelection(plan.selections[index]);
    need(row.index===index&&JSON.stringify(row.selection)===JSON.stringify(selected)&&JSON.stringify(plan.selections[index])===JSON.stringify(selected)&&
      row.customer?.id===selected.customerId&&row.binding?.customerId===selected.customerId&&row.pass?.orderRef===row.binding.orderRef&&
      row.rowId===row.binding.id+':'+row.periodIdentitySha256&&row.opening?.periodEligible===true&&row.closing?.periodEligible===true&&plain(row.pass)&&
      plain(row.opening.periodIdentity)&&plain(row.closing.periodIdentity)&&
      row.run?.id===selected.runId&&row.opening?.id===selected.usageOpeningId&&row.closing?.id===selected.usageId&&
      row.opening.periodIdentitySha256===row.periodIdentitySha256&&row.closing.periodIdentitySha256===row.periodIdentitySha256&&
      nativeDigest(row.pass)===row.periodIdentitySha256&&nativeDigest(row.opening.periodIdentity)===row.periodIdentitySha256&&
      nativeDigest(row.closing.periodIdentity)===row.periodIdentitySha256&&SHA.test(row.opening.sha256??'')&&SHA.test(row.closing.sha256??'')&&
      stamp(row.closing.sourceCreatedAt)>stamp(row.opening.sourceCreatedAt)&&Array.isArray(row.warnings),
      'The saved service-close row differs from its original selected customer, pass or captures.','PLAN');
    const signature=JSON.stringify(selected);need(!seen.has(signature),'Each original service selection appears once.','PLAN');seen.add(signature);
  });
  need(plan.counts.statements===plan.rows.length&&plan.counts.customers===new Set(plan.rows.map(row=>row.customer.id)).size&&
    plan.counts.corrections===plan.rows.filter(row=>row.selection.replacesId).length&&plan.counts.withNotes===plan.rows.filter(row=>row.warnings.length).length,
    'The saved service-close totals differ from its selected rows.','PLAN');
  return plan;
}
function checkPreview(planRow,preview){
  accountingStatementPreview(preview);const period=preview.draft.servicePeriod;
  need(period&&period.orderRef===planRow.pass.orderRef&&period.eventId===planRow.pass.eventId&&
    period.planId===planRow.pass.planId&&period.planSha256===planRow.pass.planSha256&&period.manifestSha256===planRow.pass.manifestSha256&&
    period.openingSource?.id===planRow.opening.id&&period.openingSource.sha256===planRow.opening.sha256&&
    period.closingSource?.id===planRow.closing.id&&period.closingSource.sha256===planRow.closing.sha256&&
    period.from===planRow.opening.sourceCreatedAt&&period.until===planRow.closing.sourceCreatedAt,
    'The current native period differs from the selected original pass or capture files. Refresh its sources.','PREVIEW_CHANGED');
  return preview;
}
/** The original cycle persists its request before the lazy native connection opens. */
export async function prepareAccountingStatementServiceCycle({plan,client:provided,...options}={}){
  validateAccountingStatementServicePlan(plan);
  need(options.workspace===plan.workspace&&(!plan.endpoint||new URL(options.url).href===plan.endpoint),
    'Prepare this service plan with its original merchant connection.','CONNECTION');
  const rows=new Map(plan.rows.map(row=>[JSON.stringify(row.selection),row]));let opened,failure;
  const connection=async()=>{
    if(!opened)opened=Promise.resolve(provided??connectAccountingStatementClient({url:options.url,workspace:options.workspace,
      tokenEnv:options.tokenEnv??'MCP_ACCESS_TOKEN',environment:options.environment??process.env,signal:options.signal}));
    const client=await opened;
    need(client.workspace===plan.workspace&&(!client.endpoint||client.endpoint===new URL(options.url).href),
      'The connected client belongs to another original merchant.','CONNECTION');
    return client;
  };
  const native={workspace:plan.workspace,endpoint:new URL(options.url).href,
    async open(request){return (await connection()).open(request);},
    async preview(selection,request){
      const row=rows.get(JSON.stringify(selection));need(row,'This prepared selection does not belong to the saved service plan.','PLAN');
      return checkPreview(row,await (await connection()).preview(selection,request));
    }};
  try{return await prepareAccountingStatementCycle({...options,selections:plan.selections,client:native});}
  catch(error){failure=error;throw error;}
  finally{
    if(opened&&!provided)try{await (await opened).disconnect();}
    catch(error){if(failure)failure.releaseError={code:error.code??'ERROR',message:error.message};else throw error;}
  }
}
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const readableDate=value=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(value))+' UTC';
function csvCell(value){
  let text=value===null||value===undefined?'':String(value);
  if(typeof value==='string'&&(/^\s*[=+@-]/.test(text)||/^[\t\r\n]/.test(text)))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function renderAccountingStatementServicePlanCsv(plan){
  validateAccountingStatementServicePlan(plan);
  const columns=['customerReference','customerName','orderRef','plan','openingAt','closingAt','openingCaptureId','closingCaptureId',
    'openingSha256','closingSha256','accountingRunId','replacesStatementId','historyNotes'];
  return [columns,...plan.rows.map(row=>[row.customer.reference,row.customer.name,row.pass.orderRef,row.planLabel,
    row.opening.sourceCreatedAt,row.closing.sourceCreatedAt,row.opening.id,row.closing.id,row.opening.sha256,row.closing.sha256,
    row.selection.runId,row.selection.replacesId,row.warnings.map(item=>item.message).join(' ')])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function renderAccountingStatementServicePlanHtml(plan){
  validateAccountingStatementServicePlan(plan);
  const rows=plan.rows.map(row=>'<tr><td>'+escape(row.customer.name)+'<small>'+escape(row.customer.reference)+'</small></td><td>'+
    escape(row.planLabel)+'<small>Order '+escape(row.pass.orderRef)+'</small></td><td>'+escape(readableDate(row.opening.sourceCreatedAt))+
    '<br>to '+escape(readableDate(row.closing.sourceCreatedAt))+'</td><td>'+escape(row.replaces?'Correct '+row.replaces.number:'New statement')+
    '</td><td>'+row.warnings.map(item=>'<p>'+escape(item.message)+'</p>').join('')+'</td></tr>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Service close plan</title><style>body{max-width:1180px;margin:32px auto;padding:0 20px;font:15px/1.55 Arial,sans-serif;color:#202020}h1{font-size:25px}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ccc;padding:12px}th{background:#f2f2f2}small{display:block;color:#555}pre{white-space:pre-wrap;overflow-wrap:anywhere}p{margin:5px 0 14px}details{margin:24px 0}@media print{body{max-width:none;margin:0}tr{break-inside:avoid}}</style></head><body>'+
    '<h1>Service close plan</h1><p>'+plan.counts.statements+' selected periods for '+plan.counts.customers+' customers. Original inventory observed '+
    escape(readableDate(plan.observedAt))+'.</p><p>Each period uses its selected original opening and closing captures. Prepare the complete native customer reviews, then issue the saved closing cycle.</p>'+
    '<table><thead><tr><th>Customer</th><th>Purchased pass</th><th>Selected source period</th><th>Statement</th><th>History notes</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<details><summary>Complete original selections and source references</summary><pre>'+escape(JSON.stringify(plan,null,2))+'</pre></details></body></html>';
}
