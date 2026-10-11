// MIT. Retained source mapping, corrections and full-row reconciliation around auditTrace.
import {auditTrace, SCHEMA} from '../audit.mjs';
import {FIELDS, STAGES, CATEGORIES, DISPOSITIONS, ENUMS, plain, clone, stable, instant, readMapped} from './table.mjs';

const idOK=value => typeof value==='string' && value.length>0 && value.length<=256;
const noteOK=value => typeof value==='string' && value.trim().length>=3 && value.length<=4000;
const keyFor=(kind,row) => kind==='risks' ? JSON.stringify([row.nodeId,row.category]) : row.id;
const evidenceKey=value => stable(value);
const error=message => {throw new TypeError(message);};
export function createProject({id,title='Material trace review',asOf=new Date().toISOString()}={}) {
  if(!idOK(id) || !idOK(title) || !instant(asOf)) error('Project needs an ID, title and UTC review instant');
  return {schema:'oregon-deq.trace-workbench.v1',id,title,asOf,maxAgeDays:180,revision:0,dataRevision:0,imports:[],reviews:{},updatedAt:asOf};
}
export function applyCommand(state,command,{actor,now=new Date().toISOString()}={}) {
  if(!plain(command) || !idOK(actor) || !instant(now)) error('Command requires a named reviewer and timestamp');
  const next=clone(state), table=next.imports.find(item=>item.id===command.importId);
  const fields=FIELDS[table?.kind] || [];
  if(command.type==='options') {
    if(!idOK(command.title) || !instant(command.asOf) || !Number.isInteger(command.maxAgeDays) || command.maxAgeDays<1 || command.maxAgeDays>7300)
      error('Provide a title, UTC review instant and evidence age between 1 and 7300 days');
    next.title=command.title; next.asOf=command.asOf; next.maxAgeDays=command.maxAgeDays;
  } else if(command.type==='import') {
    const item=command.item;
    if(!plain(item) || !/^[a-f0-9]{64}$/.test(item.sha256) || !idOK(item.id) || !Object.hasOwn(FIELDS,item.kind) || next.imports.some(t=>t.id===item.id))
      error('Import identity or type is invalid');
    if(next.imports.length>=100) error('Maximum 100 retained imports per project');
    if(!Number.isInteger(item.rowCount) || item.rowCount<0 || item.rowCount>100000 || next.imports.reduce((sum,item)=>sum+item.rowCount,0)+item.rowCount>250000) error('Maximum 250,000 retained source rows per project');
    next.imports.push({...item,mapping:{},valueMaps:{},corrections:{},excluded:{},enabled:true});
  } else if(command.type==='mapping') {
    if(!table || !plain(command.mapping) || !plain(command.valueMaps || {})) error('Select an imported table and mapping');
    const mapping={},valueMaps={};
    for(const [field,column] of Object.entries(command.mapping)) {
      if(!fields.includes(field) || (column!=='' && !table.columns.includes(column))) error('Unknown field or source column');
      if(column!=='') mapping[field]=column;
    }
    for(const [field,values] of Object.entries(command.valueMaps || {})) {
      if(!Object.hasOwn(ENUMS,field) || !fields.includes(field) || !plain(values)) error('Value map must target an enumerated field');
      valueMaps[field]={};
      for(const [raw,value] of Object.entries(values)) {
        if(raw.length>256 || !ENUMS[field].includes(value)) error('Unknown destination value for '+field);
        Object.defineProperty(valueMaps[field],raw,{value,writable:true,enumerable:true,configurable:true});
      }
    }
    table.mapping=mapping;table.valueMaps=valueMaps;
  } else if(command.type==='correct') {
    if(!table || !Number.isInteger(command.row) || command.row<1 || command.row>table.rowCount || !plain(command.values) || !noteOK(command.reason))
      error('Correction needs a source row, values and a reason');
    const values={};
    for(const [field,value] of Object.entries(command.values)) {
      if(!fields.includes(field) || typeof value!=='string' || value.length>65536) error('Invalid correction field');
      values[field]=value;
    }
    table.corrections[command.row]=values;
    table.correctionNotes ??={}; table.correctionNotes[command.row]={reason:command.reason,actor,at:now};
  } else if(command.type==='exclude') {
    if(!table || !Number.isInteger(command.row) || command.row<1 || command.row>table.rowCount) error('Select a source row');
    if(command.excluded) {
      if(!noteOK(command.reason)) error('An excluded row needs its disposition reason');
      table.excluded[command.row]={reason:command.reason,actor,at:now};
    } else delete table.excluded[command.row];
  } else if(command.type==='enable') {
    if(!table || typeof command.enabled!=='boolean' || !noteOK(command.reason)) error('Change needs an import and reason');
    table.enabled=command.enabled; table.enabledNote={reason:command.reason,actor,at:now};
  } else if(command.type==='review') {
    if(!idOK(command.issueKey?.slice(0,256)) || command.issueKey.length>2048 || !['open','accepted-gap','resolved'].includes(command.status) || !noteOK(command.note))
      error('Review needs a current issue, status and note');
    next.reviews[command.issueKey]={status:command.status,note:command.note,actor,at:now,revision:state.revision,dataRevision:state.dataRevision};
  } else error('Unknown workbench command');
  if(command.type!=='review') next.dataRevision=(state.dataRevision || 0)+1;
  next.revision=state.revision+1; next.updatedAt=now;next.updatedBy=actor;
  return next;
}
export function deriveProject(state,tables) {
  const issues=[],rows=[], groups={products:new Map(),nodes:new Map(),links:new Map(),risks:new Map()}, pendingEvidence=[];
  const addIssue=(code,target,message,severity='warning',details={}) => {
    const key=JSON.stringify([code,target]);
    const issue={key,code,target,message,severity,...details,review:state.reviews[key] ? {...state.reviews[key],stale:state.reviews[key].dataRevision!==state.dataRevision} : null};
    issues.push(issue); return issue;
  };
  const evidence=(value,rowRef) => {
    let result=[];
    if(value.evidenceJson) {
      try { result=JSON.parse(value.evidenceJson); if(!Array.isArray(result)) throw new Error('Expected an array'); }
      catch(e) { addIssue('evidence_json',rowRef,'Evidence JSON must be an array: '+e.message,'error'); return []; }
    }
    if(value.source || value.observedAt) result.push({source:value.source,observedAt:value.observedAt});
    return result;
  };
  for(const config of state.imports) {
    const table=tables.get(config.id);
    if(!table || table.rows.length!==config.rowCount) {addIssue('missing_source',config.id,'Retained source could not be reopened','error');continue;}
    const mapped=Object.keys(config.mapping || {}).length>0;
    for(const row of table.rows) {
      const rowRef=JSON.stringify([config.id,row.number]);
      const tracked={importId:config.id,fileName:config.fileName,sha256:config.sha256,row:row.number,line:row.line,kind:config.kind,
        entityId:'',status:'included',reason:'',corrected:Object.keys(config.corrections?.[row.number] || {}).length>0};
      rows.push(tracked);
      if(!config.enabled || config.excluded?.[row.number]) {
        tracked.status='excluded'; tracked.reason=config.excluded?.[row.number]?.reason || config.enabledNote?.reason || 'Import disabled'; continue;
      }
      if(!mapped) {tracked.status='unmapped';tracked.reason='Confirm source-column mapping';continue;}
      const value=readMapped(row,table,config),kind=config.kind;
      let invalid='';
      const required=kind==='products'?['id','name','destinationNode']:kind==='nodes'?['id','stage']:kind==='links'?['id','productId','from','to']:kind==='risks'?['nodeId','category','disposition']:['targetKind','source','observedAt'];
      for(const field of required) if(!idOK(value[field])) invalid='Provide '+field+' (1–256 characters)';
      if(kind==='nodes' && !STAGES.includes(value.stage)) invalid='Map stage to one of the five material-chain stages';
      if(kind==='risks' && (!CATEGORIES.includes(value.category) || !DISPOSITIONS.includes(value.disposition))) invalid='Map the risk category and disposition';
      if(kind==='evidence' && (!['links','risks'].includes(value.targetKind) || (value.targetKind==='links'?!idOK(value.targetId):!idOK(value.nodeId)||!CATEGORIES.includes(value.category))))
        invalid='Evidence needs a link ID or a node/category risk target';
      if(invalid) {
        tracked.status='invalid';tracked.reason=invalid;
        addIssue('source_row',rowRef,invalid,'error',{importId:config.id,row:row.number});continue;
      }
      if(kind==='evidence') {
        tracked.entityId=value.targetKind==='links'?value.targetId:JSON.stringify([value.nodeId,value.category]);
        pendingEvidence.push({value,tracked,rowRef});continue;
      }
      const entityId=keyFor(kind,value);tracked.entityId=entityId;
      const record=kind==='products'?{id:value.id,name:value.name,destinationNode:value.destinationNode}:
        kind==='nodes'?{id:value.id,stage:value.stage,name:value.name,country:value.country,latitude:value.latitude,longitude:value.longitude}:
        kind==='links'?{id:value.id,productId:value.productId,from:value.from,to:value.to,evidence:evidence(value,rowRef)}:
        {nodeId:value.nodeId,category:value.category,disposition:value.disposition,evidence:evidence(value,rowRef)};
      const comparable={...record};delete comparable.evidence;
      const existing=groups[kind].get(entityId);
      if(existing) {
        existing.rows.push(tracked);
        if(stable(existing.comparable)!==stable(comparable)) existing.conflict=true;
        if(record.evidence) existing.record.evidence.push(...record.evidence);
      } else groups[kind].set(entityId,{record,comparable,rows:[tracked],conflict:false});
    }
    const pending=rows.filter(r=>r.importId===config.id && r.status==='unmapped').length;
    if(pending) addIssue('unmapped_table',config.id,pending+' rows await a confirmed column mapping','error',{importId:config.id});
  }
  for(const [kind,map] of Object.entries(groups)) for(const [id,group] of map) {
    if(group.conflict) {
      group.rows.forEach(row=>{row.status='conflict';row.reason='Source rows disagree for the same record identity';});
      addIssue('conflicting_record',JSON.stringify([kind,id]),'Resolve conflicting '+kind+' rows for '+id,'error',{kind,entityId:id,sourceRows:group.rows.map(r=>({importId:r.importId,row:r.row}))});
    } else if(group.rows.length>1) {
      group.rows.slice(1).forEach(row=>{row.status='contributed';row.reason='Same record fields; retained evidence is combined';});
    }
  }
  for(const {value,tracked,rowRef} of pendingEvidence) {
    const target=value.targetKind==='links'?value.targetId:JSON.stringify([value.nodeId,value.category]);
    const group=groups[value.targetKind].get(target);
    if(!group) {
      tracked.status='invalid';tracked.reason='Evidence target is absent';
      addIssue('orphan_evidence',rowRef,'Evidence target is absent','error',{importId:tracked.importId,row:tracked.row});
    } else {
      group.record.evidence.push({source:value.source,observedAt:value.observedAt});
      if(group.conflict) {tracked.status='conflict';tracked.reason='Evidence target has conflicting source rows';}
    }
  }
  const data={schema:SCHEMA,asOf:state.asOf};
  for(const [kind,map] of Object.entries(groups)) data[kind]=[...map.values()].map(group=>{
    const record=clone(group.record);
    if(record.evidence) record.evidence=[...new Map(record.evidence.map(e=>[evidenceKey(e),e])).values()];
    return record;
  });
  const nodeMap=new Map(data.nodes.map(n=>[n.id,n])), productMap=new Map(data.products.map(p=>[p.id,p]));
  const sourceRowsFor=(kind,id) => groups[kind].get(id)?.rows.map(r=>({importId:r.importId,row:r.row})) || [];
  const reportEvidence=(items,kind,id) => {
    let recent=0;
    for(let i=0;i<items.length;i++) {
      const item=items[i],target=JSON.stringify([kind,id,i]);
      if(!plain(item) || !idOK(item.source) || !instant(item.observedAt)) addIssue('incomplete_evidence',target,'Source and a valid UTC observation time are required','warning',{kind,entityId:id});
      else {
        const delta=Date.parse(state.asOf)-Date.parse(item.observedAt);
        if(delta<0) addIssue('future_evidence',target,'Observation is later than this review snapshot','warning',{kind,entityId:id});
        else if(delta>state.maxAgeDays*86400000) addIssue('old_evidence',target,'Observation exceeds the selected '+state.maxAgeDays+'-day age','warning',{kind,entityId:id});
        else recent++;
      }
    }
    return recent;
  };
  for(const p of data.products) if(!nodeMap.has(p.destinationNode) || nodeMap.get(p.destinationNode).stage!=='oregon-market')
    addIssue('destination',p.id,'Product needs a retained Oregon-market destination','error',{kind:'products',entityId:p.id,sourceRows:sourceRowsFor('products',p.id)});
  const recentLinks=new Set();
  for(const e of data.links) {
    if(!productMap.has(e.productId) || !nodeMap.has(e.from) || !nodeMap.has(e.to) || e.from===e.to)
      addIssue('link_endpoint',e.id,'Link has an absent product, absent facility or self-loop','error',{kind:'links',entityId:e.id,sourceRows:sourceRowsFor('links',e.id)});
    if(reportEvidence(e.evidence,'links',e.id)) recentLinks.add(e.id);
    else addIssue('undocumented_link',e.id,'Link has no recent source record at the selected review time','warning',{kind:'links',entityId:e.id});
  }
  const riskMap=new Map();
  for(const r of data.risks) {
    const id=JSON.stringify([r.nodeId,r.category]);
    riskMap.set(id,r);
    if(!nodeMap.has(r.nodeId)) addIssue('risk_node',id,'Risk assessment references an absent facility','error',{kind:'risks',entityId:id});
    reportEvidence(r.evidence,'risks',id);
  }
  const branches=[],usedNodes=new Set(),branchRiskIssues=new Map();
  for(const p of data.products) {
    const links=data.links.filter(e=>e.productId===p.id), incoming=new Map(),outgoing=new Map();
    for(const e of links) {
      if(!incoming.has(e.to)) incoming.set(e.to,[]);
      incoming.get(e.to).push(e);
      if(!outgoing.has(e.from)) outgoing.set(e.from,[]);
      outgoing.get(e.from).push(e);
    }
    const reached=new Set([p.destinationNode]),edgeIds=new Set(),queue=[p.destinationNode];
    for(let i=0;i<queue.length;i++) for(const e of incoming.get(queue[i]) || []) {
      edgeIds.add(e.id);
      if(!reached.has(e.from)) {reached.add(e.from);queue.push(e.from);}
    }
    reached.forEach(n=>usedNodes.add(n));
    const sourceConnected=new Set(),forward=[];
    for(const id of reached) if(nodeMap.get(id)?.stage==='extraction') {sourceConnected.add(id);forward.push(id);}
    for(let i=0;i<forward.length;i++) for(const e of outgoing.get(forward[i]) || []) {
      if(edgeIds.has(e.id) && !sourceConnected.has(e.to)) {sourceConnected.add(e.to);forward.push(e.to);}
    }
    const indegree=new Map([...reached].map(n=>[n,0]));
    for(const e of links) if(edgeIds.has(e.id)) indegree.set(e.to,(indegree.get(e.to)||0)+1);
    const ordered=[...reached].filter(n=>indegree.get(n)===0);
    for(let i=0;i<ordered.length;i++) for(const e of outgoing.get(ordered[i]) || []) if(edgeIds.has(e.id)) {
      const degree=indegree.get(e.to)-1;indegree.set(e.to,degree);if(degree===0) ordered.push(e.to);
    }
    const orderedSet=new Set(ordered),cyclicNodes=[...reached].filter(n=>!orderedSet.has(n));
    if(cyclicNodes.length) addIssue('cycle',p.id,'Upstream graph contains a cycle or a node downstream of a cycle','error',{productId:p.id,nodeIds:cyclicNodes});
    const disconnected=links.filter(e=>!edgeIds.has(e.id));
    for(const e of disconnected) addIssue('disconnected_branch',JSON.stringify([p.id,e.id]),'Product link does not lead to its selected destination','warning',{productId:p.id,kind:'links',entityId:e.id});
    const unexplained=[...reached].filter(id=>nodeMap.get(id)?.stage!=='extraction' && !(incoming.get(id)?.length));
    for(const id of unexplained) addIssue('untraced_branch',JSON.stringify([p.id,id]),'Upstream branch stops before an extraction record','warning',{productId:p.id,kind:'nodes',entityId:id});
    let missingRisks=0;
    for(const id of reached) for(const category of CATEGORIES) {
      const r=riskMap.get(JSON.stringify([id,category]));
      const valid=r && r.disposition!=='unknown' && r.evidence.some(e=>plain(e)&&idOK(e.source)&&instant(e.observedAt)&&Date.parse(e.observedAt)<=Date.parse(state.asOf)&&Date.parse(state.asOf)-Date.parse(e.observedAt)<=state.maxAgeDays*86400000);
      if(!valid) {
        missingRisks++;const riskKey=JSON.stringify([id,category]);
        if(!branchRiskIssues.has(riskKey)) branchRiskIssues.set(riskKey,addIssue('branch_risk',riskKey,'Upstream facility needs a recent '+category.replaceAll('_',' ')+' assessment','warning',{productIds:[],kind:'risks',entityId:riskKey,nodeId:id,category}));
        branchRiskIssues.get(riskKey).productIds.push(p.id);
      }
    }
    branches.push({productId:p.id,upstreamNodeIds:[...reached],upstreamLinkIds:[...edgeIds],allProductLinks:links.length,
      disconnectedLinks:disconnected.length,cyclicNodes,untracedEndpoints:unexplained,missingRiskPairs:missingRisks,
      recentSourceLinks:[...edgeIds].filter(id=>recentLinks.has(id)).length,
      extractionReachableNodes:[...sourceConnected]});
  }
  for(const n of data.nodes) if(!usedNodes.has(n.id)) addIssue('unassigned_facility',n.id,'Facility is outside every selected product destination graph','warning',{kind:'nodes',entityId:n.id});
  let audit=null;
  if(!issues.some(issue=>issue.severity==='error')) {
    try {audit=auditTrace(data,{maxAgeDays:state.maxAgeDays});}
    catch(e) {addIssue('original_audit_input',state.id,e.message,'error');}
  }
  const issueKeys=new Set(issues.map(i=>i.key));
  const carriedReviews=Object.entries(state.reviews).filter(([key])=>!issueKeys.has(key)).map(([key,review])=>({key,...review,state:'no-longer-present'}));
  const counts={sourceRows:rows.length,included:0,contributed:0,excluded:0,unmapped:0,invalid:0,conflict:0};
  rows.forEach(row=>counts[row.status]++);
  return {schema:'oregon-deq.trace-workbench.report.v1',projectId:state.id,revision:state.revision,asOf:state.asOf,maxAgeDays:state.maxAgeDays,
    data,audit,branches,rows,issues,carriedReviews,counts,
    summary:{products:data.products.length,facilities:data.nodes.length,links:data.links.length,riskAssessments:data.risks.length,
      errors:issues.filter(i=>i.severity==='error').length,warnings:issues.filter(i=>i.severity==='warning').length,
      reviewNotes:issues.filter(i=>i.review).length,openIssues:issues.filter(i=>!i.review || i.review.stale || i.review.status!=='accepted-gap').length}};
}

