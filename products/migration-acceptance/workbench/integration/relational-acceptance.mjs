// SPDX-License-Identifier: MIT
// Cross-object evidence over original completed dlt observations. No loader, target writer or approval.
import {canonical} from '../vendor/dlt/vendor/sling/migration/common.mjs';
import {comparePipeline} from '../vendor/dlt/pipeline/plan.mjs';
import {canonicalCell} from '../vendor/dlt/vendor/sling/migration/compare.mjs';
import {check,hash,json,columnType} from './chinook-native-input.mjs';
function unique(rows,key,label){const out=new Map();for(const row of rows){const id=key(row);check(!out.has(id),'Repeated '+label+': '+id);out.set(id,row);}return out;}
function integer(value){check(typeof value==='string'&&/^[+-]?\d+$/.test(value),'Keep exact original integer cells.');return BigInt(value);}
function cents(value){
  check(typeof value==='string','Money must be an original typed decimal string.');
  const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);check(m,'Invalid exact decimal control value.');
  const exponent=BigInt(m[4]||'0')-BigInt((m[3]||'').length)+2n;
  let n=BigInt(m[2]+(m[3]||''));check(exponent>=-100n&&exponent<=100n,'Control decimal exponent exceeds the declared reference domain.');
  if(exponent>=0)n*=10n**exponent;else{const d=10n**(-exponent);check(n%d===0n,'An amount exceeds the original two-place scale.');n/=d;}
  check(n<=9999999999n,'An amount exceeds NUMERIC(10,2).');return m[1]==='-'?-n:n;
}
function amount(n){const sign=n<0n?'-':'';n=n<0n?-n:n;return sign+(n/100n)+'.'+(n%100n).toString().padStart(2,'0');}
function key(row,columns){return JSON.stringify(columns.map(c=>row.canonical[c]));}
function same(a,b){return canonical(a)===canonical(b);}
function observedTables(binding,plan,observations,side){
  const streams=unique(observations.streams,x=>x.streamId,'native stream'),tables=new Map();
  for(const t of binding.tables){
    const selected=plan.acceptance.find(a=>a.table===t.nativeTable);check(selected,'Original native plan omitted a source table.');
    const stream=streams.get(selected.id);check(stream,'Original observations omitted a selected stream.');
    const population=stream[side];check(population?.source?.complete===true&&population.source.rowCount===population.rows.length,'Select a full completed original export.');
    const columns=unique(population.columns,c=>c.name,'observed column'),indices=new Map(population.columns.map((c,i)=>[c.name,i]));
    const rows=population.rows.map((cells,ordinal)=>{
      check(cells.length===population.columns.length,'Observed row width differs.');
      const values={},canonical={};
      for(const c of t.schema.columns){const name=side==='left'?c.name:t.fieldMap[c.name];check(columns.has(name),'Original mapped column is missing.');
        const cell=cells[indices.get(name)];canonical[c.name]=canonicalCell(cell,columnType(c).cellType);
        values[c.name]=cell.type==='null'?null:cell.value;
      }
      return {ordinal,values,canonical};
    });
    tables.set(t.originalTable,{mapping:t,source:population.source,rows});
  }
  check(streams.size===binding.tables.length,'Native observations contain an unselected business table.');return tables;
}
function relational(tables,side){
  const keys=[],relations=[],issues=[];
  for(const [name,t]of tables){
    const groups=new Map(),nullRows=[];
    for(const row of t.rows){if(t.mapping.schema.primaryKey.some(c=>row.values[c]===null)){nullRows.push(row.ordinal);continue;}
      const id=key(row,t.mapping.schema.primaryKey);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row.ordinal);}
    const duplicates=[...groups].filter(([,ordinals])=>ordinals.length>1).map(([id,ordinals])=>({key:JSON.parse(id),rowOrdinals:ordinals}));
    const record={table:name,primaryKey:t.mapping.schema.primaryKey,rowCount:t.rows.length,distinctNonNullKeys:groups.size,nullRows,duplicates};
    keys.push(record);if(nullRows.length||duplicates.length)issues.push({kind:'primary-key',side,...record});
    for(const fk of t.mapping.schema.foreignKeys){
      const parent=tables.get(fk.parentTable);check(parent,'Foreign key parent is outside complete selected objects.');
      const ordered=[...fk.columns].sort((a,b)=>a.sequence-b.sequence),childColumns=ordered.map(x=>x.child),parentColumns=ordered.map(x=>x.parent);
      check(childColumns.every(c=>t.mapping.schema.columns.some(x=>x.name===c))&&parentColumns.every(c=>parent.mapping.schema.columns.some(x=>x.name===c)),'Retain the exact original foreign key fields.');
      const parentKeys=new Set(parent.rows.filter(r=>parentColumns.every(c=>r.values[c]!==null)).map(r=>key(r,parentColumns)));
      const nullChildRows=[],missingParents=[];
      for(const row of t.rows){
        // SQLite MATCH SIMPLE semantics: any NULL in a composite child tuple skips reference.
        if(childColumns.some(c=>row.values[c]===null)){nullChildRows.push(row.ordinal);continue;}
        const id=key(row,childColumns);if(!parentKeys.has(id))missingParents.push({rowOrdinal:row.ordinal,primaryKey:JSON.parse(key(row,t.mapping.schema.primaryKey)),foreignKey:JSON.parse(id)});
      }
      const record={id:fk.id,childTable:name,parentTable:fk.parentTable,columns:ordered,onUpdate:fk.onUpdate,onDelete:fk.onDelete,match:fk.match,
        checkedNonNullRows:t.rows.length-nullChildRows.length,nullChildRows,missingParents};relations.push(record);
      if(missingParents.length)issues.push({kind:'foreign-key',side,...record});
    }
  }
  return {keys,relations,issues};
}
function controls(tables){
  const invoices=tables.get('Invoice'),lines=tables.get('InvoiceLine');check(invoices&&lines,'Complete original invoice and line populations required.');
  const byInvoice=new Map();
  for(const row of lines.rows){const id=JSON.stringify(row.canonical.InvoiceId);if(!byInvoice.has(id))byInvoice.set(id,[]);byInvoice.get(id).push(row);}
  const all=[],groups=new Map();
  function group(name,groupKey,header,extended,quantity,details){
    const id=JSON.stringify([name,groupKey]);let g=groups.get(id);
    if(!g){g={group:name,key:groupKey,invoiceCount:0,lineCount:0,quantity:0n,headerTotal:0n,extendedLineTotal:0n};groups.set(id,g);}
    g.invoiceCount++;g.lineCount+=details;g.quantity+=quantity;g.headerTotal+=header;g.extendedLineTotal+=extended;
  }
  for(const invoice of invoices.rows){
    check(invoice.values.InvoiceId!==null&&invoice.values.CustomerId!==null&&invoice.values.Total!==null&&typeof invoice.values.InvoiceDate==='string','Required invoice control value is absent.');
    const date=invoice.values.InvoiceDate;check(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date),'Original local timestamp representation changed.');
    const details=byInvoice.get(JSON.stringify(invoice.canonical.InvoiceId))||[];
    let extended=0n,quantity=0n;for(const line of details){check(line.values.UnitPrice!==null&&line.values.Quantity!==null,'Required line control value is absent.');const q=integer(line.values.Quantity);quantity+=q;extended+=cents(line.values.UnitPrice)*q;}
    const header=cents(invoice.values.Total),customer=integer(invoice.values.CustomerId).toString(),invoiceId=integer(invoice.values.InvoiceId).toString();
    all.push({InvoiceId:invoiceId,CustomerId:customer,InvoiceDate:date,BillingCountry:invoice.values.BillingCountry,
      rowOrdinal:invoice.ordinal,lineOrdinals:details.map(x=>x.ordinal),lineCount:details.length,quantity:quantity.toString(),headerTotal:amount(header),
      extendedLineTotal:amount(extended),difference:amount(header-extended),balanced:header===extended,unit:'UNSPECIFIED_REFERENCE_AMOUNT'});
    group('all',[],header,extended,quantity,details.length);
    group('customer',[customer],header,extended,quantity,details.length);
    group('billing-country',[invoice.values.BillingCountry],header,extended,quantity,details.length);
    group('calendar-year',[date.slice(0,4)],header,extended,quantity,details.length);
  }
  const grouped=[...groups.values()].map(g=>({...g,quantity:g.quantity.toString(),headerTotal:amount(g.headerTotal),extendedLineTotal:amount(g.extendedLineTotal),
    difference:amount(g.headerTotal-g.extendedLineTotal),unit:'UNSPECIFIED_REFERENCE_AMOUNT'})).sort((a,b)=>JSON.stringify([a.group,a.key]).localeCompare(JSON.stringify([b.group,b.key]),'en'));
  all.sort((a,b)=>{const x=integer(a.InvoiceId),y=integer(b.InvoiceId);return x<y?-1:x>y?1:a.rowOrdinal-b.rowOrdinal;});
  return {invoices:all,groups:grouped};
}
function sourceControlProjection(rows,kind){
  return rows.map(r=>kind==='invoice'?{InvoiceId:String(r.InvoiceId),CustomerId:String(r.CustomerId),InvoiceDate:r.InvoiceDate,BillingCountry:r.BillingCountry,
    lineCount:r.lineCount,quantity:String(r.quantity),headerTotal:r.headerTotal,extendedLineTotal:r.extendedLineTotal,difference:r.difference,balanced:r.balanced,unit:r.unit}:
    {group:r.group,key:r.group==='customer'?r.key.map(String):r.key,invoiceCount:r.invoiceCount,lineCount:r.lineCount,quantity:String(r.quantity),
      headerTotal:r.headerTotal,extendedLineTotal:r.extendedLineTotal,difference:r.difference,unit:r.unit});
}
function indexedDifferences(left,right,keyOf,kind){
  const a=new Map(),b=new Map();
  for(const x of left){const k=keyOf(x);check(!a.has(k),'Repeated source control key.');a.set(k,x);}
  for(const x of right){const k=keyOf(x);if(!b.has(k))b.set(k,[]);b.get(k).push(x);}
  const differences=[];for(const k of [...new Set([...a.keys(),...b.keys()])].sort()){
    const x=a.get(k),ys=b.get(k)||[];if(!x||ys.length!==1||!same(x,ys[0]))differences.push({kind,key:k,source:x??null,target:ys});}
  return differences;
}
function invoiceProjection(x){const {rowOrdinal,lineOrdinals,...rest}=x;return rest;}
/** Does not change consumer/cutover state. Caller retains this full report through source.retain. */
export function evaluateRelationalAcceptance({prepared,plan,observationsBytes,selectionBytes,job,workspaceInstanceId,projectId}){
  const binding=prepared.binding;check(binding?.schema==='definian.chinook-native-input.v1','Select the complete received original reference binding.');
  const {bindingSha256,...body}=binding;check(hash(Buffer.from(json(body)))===bindingSha256,'Original reference mapping changed.');
  check(typeof workspaceInstanceId==='string'&&workspaceInstanceId&&typeof projectId==='string'&&projectId,'Bind the actual original workspace and project.');
  check(job?.status==='complete'&&job.kind==='dlt_pipeline'&&job.projectId===projectId&&job.semanticPlanId===plan.planId,'Select an actually completed original native job for this plan/project.');
  const observedFile=job.files.find(f=>f.path==='artifacts/observations.json');check(observedFile,'Original job has no complete observation artifact.');
  check(Buffer.isBuffer(observationsBytes)&&observationsBytes.length===observedFile.bytes&&hash(observationsBytes)===observedFile.sha256,'Original complete observation bytes differ.');
  const observations=JSON.parse(observationsBytes.toString('utf8'));
  check(Buffer.isBuffer(selectionBytes)&&selectionBytes.length===job.selection.bytes&&hash(selectionBytes)===job.selection.sha256,'Original native selection bytes differ.');
  const selection=JSON.parse(selectionBytes.toString('utf8'));
  check(selection.jobId===job.id&&selection.projectId===projectId&&selection.planId===plan.planId&&same(selection.plan,plan),'Original job selection and complete native plan differ.');
  for(const [path,key]of [['controls/INVOICE_CONTROL_POPULATION.json','sourceInvoiceControls'],['controls/GROUPED_EXACT_CONTROLS.json','sourceGroupedControls']]){
    const d=prepared.files.find(f=>f.path===path);check(d&&d.raw.length===d.bytes&&hash(d.raw)===d.sha256&&same(JSON.parse(d.raw.toString('utf8')),prepared[key]),'Original source control bytes differ.');
  }
  check(observations.pipelinePlanId===plan.planId&&observations.streams.every(s=>s.native.commandId===job.id),'Observation/native selection differs.');
  check(plan.resources.length===11&&plan.acceptance.length===11,'Keep all eleven original loaded and expected objects.');
  for(const t of binding.tables){
    const r=plan.resources.find(r=>r.tableName===t.nativeTable),a=plan.acceptance.find(a=>a.table===t.nativeTable);
    check(r&&a&&r.format==='ndjson'&&same(r.fieldMap,t.fieldMap)&&same(r.primaryKey,t.schema.primaryKey.map(k=>t.fieldMap[k])),'Original object mapping or full primary key differs.');
    const expectedHints=t.schema.columns.map(c=>{const {cellType,...hint}=columnType(c);return {name:t.fieldMap[c.name],...hint,nullable:c.nullable&&!c.primaryKeyOrder};});
    check(same(r.columns,expectedHints)&&r.writeDisposition==='replace'&&r.maxTableNesting===0,'Original exact type hints or reference loading semantics differ.');
    check(a.columns.length===t.schema.columns.length&&t.schema.columns.every(c=>a.columns.some(x=>x.name===t.fieldMap[c.name]&&x.left===c.name&&x.right===t.fieldMap[c.name]&&x.cellType===columnType(c).cellType)),'Unreviewed business-column acceptance mapping.');
    const input=selection.inputs.find(x=>x.sourceId===r.sourceId),expected=selection.inputs.find(x=>x.sourceId===a.expectedSourceId);
    check(input&&input.sha256===t.source.sha256&&input.bytes===t.source.bytes&&expected&&expected.sha256===t.expected.sha256&&expected.bytes===t.expected.bytes,'Actual native input source/expected selection differs from original reference.');
    const stream=observations.streams.find(s=>s.streamId===a.id);check(stream,'Original selected stream is missing.');
    check(stream.left.source.sourceId===a.expectedSourceId&&stream.left.source.sha256===t.expected.sha256&&stream.left.source.bytes===t.expected.bytes,'Expected full export differs from original independent preparation.');
    const actual=job.files.find(f=>f.path===stream.right.source.path);
    check(actual&&actual.sha256===stream.right.source.sha256&&actual.bytes===stream.right.source.bytes,'Native export is not retained in this original job.');
  }
  const typed=comparePipeline(plan,observations); // Original full multiset/schema comparator remains authoritative.
  const left=observedTables(binding,plan,observations,'left'),right=observedTables(binding,plan,observations,'right');
  const l=relational(left,'source'),r=relational(right,'target'),lc=controls(left),rc=controls(right);
  const invoiceSource=sourceControlProjection(prepared.sourceInvoiceControls,'invoice'),groupSource=sourceControlProjection(prepared.sourceGroupedControls,'group');
  const invoiceLeft=lc.invoices.map(invoiceProjection),invoiceRight=rc.invoices.map(invoiceProjection);
  const sourceControlDifferences=[...indexedDifferences(invoiceSource,invoiceLeft,x=>x.InvoiceId,'source-invoice-control-binding'),
    ...indexedDifferences(groupSource,lc.groups,x=>JSON.stringify([x.group,x.key]),'source-group-control-binding')];
  const controlDifferences=[...indexedDifferences(invoiceLeft,invoiceRight,x=>x.InvoiceId,'invoice-control'),
    ...indexedDifferences(lc.groups,rc.groups,x=>JSON.stringify([x.group,x.key]),'group-control')];
  const findings=[...l.issues,...r.issues,...sourceControlDifferences,...controlDifferences,
    ...lc.invoices.filter(x=>!x.balanced).map(x=>({kind:'unbalanced-invoice',side:'source',...x})),
    ...rc.invoices.filter(x=>!x.balanced).map(x=>({kind:'unbalanced-invoice',side:'target',...x}))];
  const provenance={workspaceInstanceId,projectId,jobId:job.id,planEditionId:job.planId,planId:plan.planId,
    nativeSnapshotSha256:job.nativeSnapshotSha256,observations:observedFile,mappingSha256:bindingSha256,sourceOperationId:binding.sourceOperationId,
    sourceManifest:binding.sourceManifest,sourceCommit:binding.sourceCommit,phase:plan.phase,stage:job.stage};
  const exceptions=findings.map(f=>({exceptionId:'exception_'+hash(Buffer.from(json({provenance,finding:f}))),finding:f,disposition:null,owner:null,reason:null}));
  const report={schema:'definian.relational-acceptance.v1',provenance,originalTypedComparison:typed,
    source:{keys:l.keys,relations:l.relations,controls:lc},target:{keys:r.keys,relations:r.relations,controls:rc},
    sourceControlDifferences,controlDifferences,exceptions,
    status:typed.readyForCutover&&exceptions.length===0?'RECONCILED_FOR_REVIEW':'EXCEPTIONS_REQUIRE_REVIEW',
    accepted:false,cutoverApplied:false,meaning:'Complete reference evidence only. Original customer/operator decision, native cutover and rollback remain in the maintained product.',
    originalSourceMeaning:binding.sourceMeaning,decisions:binding.decisions,originalLineage:binding.originalLineage,originalTransformations:binding.originalTransformations};
  return {...report,reportSha256:hash(Buffer.from(json(report)))};
}
