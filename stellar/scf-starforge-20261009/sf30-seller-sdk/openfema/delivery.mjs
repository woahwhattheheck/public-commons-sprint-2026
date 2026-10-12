// MIT. Reviewed customer-schema projection and source reconciliation over native portfolios.
import {createHash} from 'node:crypto';
import {PORTFOLIO_SCHEMA,stable,decimalMinor,validateAnnotation,csv,fault,string,comparePortfolios} from './domain.mjs';

export const MAPPING_SCHEMA='stellar-forge.openfema-delivery-mapping.v1';
export const DELIVERY_SCHEMA='stellar-forge.openfema-project-delivery.v1';
export const RECONCILIATION_SCHEMA='stellar-forge.openfema-customer-reconciliation.v1';
const hash=value=>createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex');
const copy=value=>structuredClone(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const checked=(condition,message,code='OPENFEMA_DELIVERY')=>{if(!condition)throw fault(code,message);};
const scalar=value=>value===null||value===undefined?'':String(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const reviewDefaults={status:'open',disposition:'include',priority:'normal',owner:'',dueDate:'',note:'',applicantSourceId:''};
export const DELIVERY_FIELDS=Object.freeze({
  id:{kind:'text',label:'OpenFEMA GM project ID',meaning:'PublicAssistanceFundedProjectsDetails v2 gmProjectId; the original project identity.'},
  disasterNumber:{kind:'text',label:'Disaster number',meaning:'The exact disaster identity retained with this project.'},
  applicantId:{kind:'text',label:'Applicant ID',meaning:'Join within the same disaster; not the applicant table UUID.'},
  applicantName:{kind:'text',label:'Reviewed applicant name'},
  applicantMatch:{kind:'text',label:'Applicant join state'},
  state:{kind:'text',label:'State abbreviation'},county:{kind:'text',label:'County as published'},
  projectNumber:{kind:'text',label:'Project worksheet number'},projectTitle:{kind:'text',label:'Project title'},
  workCategory:{kind:'text',label:'Category of work'},categoryDescription:{kind:'text',label:'Category description'},
  projectSize:{kind:'text',label:'Project size'},projectStatus:{kind:'text',label:'Published project status'},
  processStep:{kind:'text',label:'Published process step'},declarationDate:{kind:'text',label:'Declaration date'},
  firstObligationDate:{kind:'text',label:'First obligation date'},fundedDate:{kind:'text',label:'Last obligation date'},
  incidentType:{kind:'text',label:'Incident type'},
  'projectCost.decimal':{kind:'usd',label:'Project cost (USD)',meaning:'Project cost excluding administrative costs; a separate measure.'},
  'federalObligated.decimal':{kind:'usd',label:'Federal obligations (USD)',meaning:'Federal project funding obligated to the recipient; a separate measure.'},
  'totalObligated.decimal':{kind:'usd',label:'Total obligations (USD)',meaning:'Total obligations including administrative amounts; a separate measure.'},
  'mitigation.decimal':{kind:'usd',label:'Mitigation (USD)',meaning:'Published mitigation amount, preserving negative adjustments; a separate measure.'},
  included:{kind:'boolean',label:'Included in portfolio totals'},conflict:{kind:'boolean',label:'Conflicting source identity'},
  sourcePageSha256:{kind:'text',label:'Original page SHA256'},sourceRow:{kind:'integer',label:'Original zero-based source row'},
  sourceUrl:{kind:'text',label:'Original source request URL'},
  'review.status':{kind:'text',label:'Analyst review status',owner:'review'},
  'review.disposition':{kind:'text',label:'Portfolio include/exclude decision',owner:'review'},
  'review.priority':{kind:'text',label:'Analyst priority',owner:'review'},
  'review.owner':{kind:'text',label:'Assigned analyst',owner:'review'},
  'review.dueDate':{kind:'text',label:'Analyst due date',owner:'review'},
  'review.note':{kind:'text',label:'Analyst working note',owner:'review'}
});
const stagingColumns=[
 ['gm_project_id','id'],['disaster_number','disasterNumber'],['applicant_id','applicantId'],
 ['applicant_name','applicantName'],['applicant_join','applicantMatch'],['state','state'],['county','county'],
 ['project_number','projectNumber'],['project_title','projectTitle'],['work_category','workCategory'],
 ['project_size','projectSize'],['published_status','projectStatus'],['process_step','processStep'],
 ['declaration_date','declarationDate'],['first_obligation_date','firstObligationDate'],['last_obligation_date','fundedDate'],
 ['project_cost_usd','projectCost.decimal'],['federal_obligated_usd','federalObligated.decimal'],
 ['total_obligated_usd','totalObligated.decimal'],['mitigation_usd','mitigation.decimal'],
 ['included_in_totals','included'],['source_conflict','conflict'],
 ['review_status','review.status'],['review_disposition','review.disposition'],['review_priority','review.priority'],
 ['review_owner','review.owner'],['review_due_date','review.dueDate'],['review_note','review.note'],
 ['source_page_sha256','sourcePageSha256'],['source_row','sourceRow'],['source_url','sourceUrl']
];
export function stagingMapping(){
  return {schema:MAPPING_SCHEMA,name:'OpenFEMA project staging and analyst review',
    target:{name:'TJLabs neutral project staging CSV',kind:'staging',reference:'OpenFEMA project staging schema v1',
      evidence:{name:'staging-schema.json',content:JSON.stringify({schema:'stellar-forge.openfema-staging-columns.v1',columns:stagingColumns.map(([column,source])=>({column,kind:DELIVERY_FIELDS[source].kind,source}))},null,2)}},
    columns:stagingColumns.map(([column,source])=>({column,source,required:['id','disasterNumber'].includes(source)})),
    customerKeyColumn:null,note:'Review and map these staging columns to the receiving system’s actual supplied schema. All selected source projects and their treatment remain in the delivery.'};
}
function columnName(value){const result=string(value,'destination column',200);checked(result===value,'Keep exact destination column names without surrounding whitespace.');checked(!['__proto__','prototype','constructor'].includes(result),'Choose a plain destination column name.');return result;}
export function validateMapping(input){
  checked(plain(input)&&input.schema===MAPPING_SCHEMA,'Choose an OpenFEMA customer delivery mapping.');
  checked(Object.keys(input).every(key=>['schema','name','target','columns','customerKeyColumn','note'].includes(key)),'Unknown delivery mapping field.');
  const target=input.target;
  checked(plain(target)&&['staging','customer_supplied'].includes(target.kind),'Identify a neutral staging schema or the actual customer-supplied schema.');
  checked(Object.keys(target).every(key=>['name','kind','reference','evidence'].includes(key)),'Unknown destination schema field.');
  checked(plain(target.evidence)&&typeof target.evidence.content==='string'&&target.evidence.content.length>0&&Buffer.byteLength(target.evidence.content,'utf8')<=2*1024*1024,'Retain the complete destination schema/header specification within 2 MiB.');
  checked(Object.keys(target.evidence).every(key=>['name','content'].includes(key)),'Keep the original destination schema name and complete text.');
  checked(Array.isArray(input.columns)&&input.columns.length>=2&&input.columns.length<=200,'Map between 2 and 200 destination columns.');
  const names=new Set(),sources=new Set();
  const columns=input.columns.map(value=>{
    checked(plain(value)&&Object.keys(value).every(key=>['column','source','required'].includes(key)),'Use column, source and required for each mapping.');
    const column=columnName(value.column),source=value.source??null;
    checked(!names.has(column),'Destination column appears twice: '+column);names.add(column);
    checked(source===null||own(DELIVERY_FIELDS,source),'Choose a declared native source or analyst field for '+column+'.');
    checked(typeof value.required==='boolean','Choose required true or false for '+column+'.');
    if(source){
      checked(!(DELIVERY_FIELDS[source].owner==='review'&&sources.has(source)),'Map each writable analyst field to one destination column: '+source+'.','OPENFEMA_DELIVERY_REVIEW_ALIAS');
      sources.add(source);
    }
    return {column,source,required:value.required};
  });
  for(const identity of ['id','disasterNumber']){
    const selected=columns.filter(value=>value.source===identity);
    checked(selected.length===1&&selected[0].required,'Map exactly one required '+identity+' column; receiving uses both original identities.');
  }
  let customerKeyColumn=input.customerKeyColumn??null;
  if(customerKeyColumn!==null){customerKeyColumn=columnName(customerKeyColumn);checked(names.has(customerKeyColumn),'The customer key column must be in the reviewed mapping.');}
  return {schema:MAPPING_SCHEMA,name:string(input.name,'mapping name',160),
    target:{name:string(target.name,'destination name',200),kind:target.kind,reference:string(target.reference,'destination schema reference',2000),
      evidence:{name:string(target.evidence.name,'destination schema filename',200),content:target.evidence.content}},
    columns,customerKeyColumn,note:string(input.note??'','mapping note',12000,{empty:true})};
}
export function mappingIdentity(mapping){
  const checked=validateMapping(mapping);
  return {mapping:checked,sha256:hash(checked),schemaSha256:hash(checked.target.evidence.content)};
}
const fieldValue=(project,source)=>{
  if(source===null)return '';
  if(source.startsWith('review.')){const key=source.slice(7);return project.annotation?.[key]??reviewDefaults[key]??'';}
  return source.split('.').reduce((value,key)=>value?.[key],project)??'';
};
const keyOf=(disaster,id)=>JSON.stringify([scalar(disaster),scalar(id)]);
function checkedPortfolio(portfolio){
  checked(plain(portfolio)&&portfolio.schema===PORTFOLIO_SCHEMA&&Array.isArray(portfolio.projects)&&plain(portfolio.summary),'Select the complete original saved portfolio.');
  const keys=new Set();
  for(const row of portfolio.projects){const key=keyOf(row.disasterNumber,row.id);checked(!keys.has(key),'The portfolio contains duplicate disaster/project identities.');keys.add(key);}
  return portfolio;
}
function valueEquivalent(left,right,kind){
  if(left===''||left===null||left===undefined||right===''||right===null||right===undefined)return scalar(left)===scalar(right);
  if(kind==='usd'){try{return decimalMinor(left)===decimalMinor(right);}catch{return false;}}
  if(kind==='boolean')return scalar(left)===scalar(right);
  return scalar(left)===scalar(right);
}
export function projectDelivery({portfolio,version,mapping,mappingReview,customerReconciliation=null,createdAt=new Date().toISOString()}){
  checkedPortfolio(portfolio);const identity=mappingIdentity(mapping);
  checked(plain(version)&&version.editionId===portfolio.editionId&&typeof version.id==='string','Bind delivery to its exact native portfolio version.');
  checked(plain(mappingReview)&&mappingReview.mappingSha256===identity.sha256&&typeof mappingReview.reviewer==='string'&&mappingReview.reviewer.trim()&&mappingReview.note?.trim(),'Review this exact destination mapping before creating its customer delivery.');
  const customerByKey=new Map();
  if(customerReconciliation){
    checked(customerReconciliation.schema===RECONCILIATION_SCHEMA&&customerReconciliation.mappingSha256===identity.sha256&&Array.isArray(customerReconciliation.rows),'Use the retained customer file reconciled against this exact mapping.');
    for(const row of customerReconciliation.rows)if(row.key&&row.status!=='DUPLICATE_CUSTOMER_ID')customerByKey.set(row.key,row);
  }
  const issues=[],rows=portfolio.projects.map(project=>{
    const customer=customerByKey.get(keyOf(project.disasterNumber,project.id));
    const values=Object.fromEntries(identity.mapping.columns.map(column=>{
      const value=column.source===null?(customer?.values[column.column]??''):fieldValue(project,column.source);
      if(column.required&&(value===''||value===null||value===undefined))issues.push({code:'REQUIRED_VALUE_MISSING',subject:project.subject,column:column.column,source:column.source});
      return [column.column,value];
    }));
    if(project.conflict)issues.push({code:'SOURCE_IDENTITY_CONFLICT',subject:project.subject});
    if(String(project.id).startsWith('unkeyed:'))issues.push({code:'SOURCE_PROJECT_ID_MISSING',subject:project.subject});
    return {key:keyOf(project.disasterNumber,project.id),subject:project.subject,projectId:project.id,disasterNumber:project.disasterNumber,
      included:project.included,values,valuesSha256:hash(values),source:{pageSha256:project.sourcePageSha256,row:project.sourceRow,url:project.sourceUrl??null},
      annotation:project.annotation?copy(project.annotation):null};
  });
  const columns=identity.mapping.columns.map(value=>value.column),targetCsv=csv(columns,rows.map(row=>row.values));
  const manifest={schema:DELIVERY_SCHEMA,createdAt,version:copy(version),editionId:portfolio.editionId,sourceSha256:portfolio.sourceSha256,
    sourceCompletedAt:portfolio.sourceCompletedAt,sourceScope:copy(portfolio.sourceScope),criteria:copy(portfolio.criteria),
    mapping:identity.mapping,mappingSha256:identity.sha256,schemaSha256:identity.schemaSha256,mappingReview:copy(mappingReview),
    summary:{rows:rows.length,included:rows.filter(row=>row.included).length,excluded:rows.filter(row=>!row.included).length,issues:issues.length,
      declarations:portfolio.declarations.length,applicants:portfolio.applicants.length,sourceProjectCount:portfolio.summary.sourceProjects,
      projectCostMinor:portfolio.summary.projectCostMinor,federalObligatedMinor:portfolio.summary.federalObligatedMinor,
      totalObligatedMinor:portfolio.summary.totalObligatedMinor,mitigationMinor:portfolio.summary.mitigationMinor,currency:'USD'},
    targetFile:{name:'projects-target.csv',bytes:Buffer.byteLength(targetCsv,'utf8'),sha256:hash(targetCsv),columns,encoding:'utf-8',recordSeparator:'CRLF',purpose:'Machine import using the reviewed destination mapping; values retain exact source text.'},
    rows,issues,methodology:copy(portfolio.methodology),
    receiving:'Match both original disaster number and gmProjectId. Customer rows with no source identity remain unlinked. A row absent from a selected source edition is not an instruction to delete it.',
    customerBase:customerReconciliation?{file:copy(customerReconciliation.file),summary:copy(customerReconciliation.summary),treatment:'Customer-owned mapped fields are preserved for exact unique identities; the complete original customer file and its unlinked rows accompany the delivery.'}:null,
    customerSchema:identity.mapping.target.kind==='customer_supplied'?'Operator-reviewed supplied schema':'Neutral staging schema for customer mapping review'};
  return {manifest,targetCsv,portfolio:copy(portfolio)};
}
export function parseCustomerCsv(content,{maxBytes=16*1024*1024,maxRows=250000}={}){
  checked(typeof content==='string'&&Buffer.byteLength(content,'utf8')<=maxBytes,'Receive the complete UTF-8 customer CSV within 16 MiB.');
  let text=content.charCodeAt(0)===0xfeff?content.slice(1):content;
  checked(!text.includes('\0'),'Customer CSV contains a NUL byte.');
  const records=[];let row=[],cell='',quoted=false,closed=false,started=false;
  const addCell=()=>{row.push(cell);cell='';closed=false;started=false;checked(row.length<=2000,'Customer CSV has too many columns.');};
  const addRow=()=>{addCell();records.push(row);row=[];checked(records.length<=maxRows+1,'Customer CSV has too many rows.');};
  for(let i=0;i<text.length;i++){
    const character=text[i];
    if(quoted){
      if(character==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}
      else cell+=character;
      continue;
    }
    if(closed&&character!==','&&character!=='\r'&&character!=='\n')throw fault('OPENFEMA_CUSTOMER_CSV','Unexpected characters after a quoted CSV cell.');
    if(character==='"'){checked(!started&&cell==='','A quote must begin a complete CSV cell.');quoted=true;started=true;continue;}
    if(character===','){addCell();continue;}
    if(character==='\r'||character==='\n'){if(character==='\r'&&text[i+1]==='\n')i++;addRow();continue;}
    cell+=character;started=true;
  }
  checked(!quoted,'The customer CSV ends inside a quoted value.');
  if(started||closed||cell.length||row.length)addRow();
  checked(records.length>0,'Receive a CSV with its complete header row.');
  const columns=records.shift().map(columnName);
  checked(new Set(columns).size===columns.length,'Customer CSV contains duplicate column names.');
  for(const [index,values]of records.entries())checked(values.length===columns.length,'Customer row '+(index+2)+' has a different number of cells from its header.');
  return {columns,rows:records.map((values,index)=>({rowNumber:index+2,values:Object.fromEntries(columns.map((column,i)=>[column,values[i]]))})),
    bytes:Buffer.byteLength(content,'utf8'),sha256:hash(content)};
}
export function reviewBaseline(row){
  return {...reviewDefaults,...Object.fromEntries(Object.keys(reviewDefaults).filter(key=>own(row.annotation||{},key)).map(key=>[key,row.annotation[key]])),subject:row.subject};
}
export function reconcileCustomer({delivery,csvText,filename='customer-projects.csv',createdAt=new Date().toISOString()}){
  checked(plain(delivery)&&delivery.schema===DELIVERY_SCHEMA&&Array.isArray(delivery.rows),'Choose the exact retained delivery used to prepare the customer file.');
  const identity=mappingIdentity(delivery.mapping);
  checked(identity.sha256===delivery.mappingSha256,'The retained destination mapping changed.');
  const parsed=parseCustomerCsv(csvText),mapping=identity.mapping;
  for(const column of mapping.columns)checked(parsed.columns.includes(column.column),'Customer CSV is missing mapped column '+column.column+'.');
  const idColumn=mapping.columns.find(value=>value.source==='id').column,disasterColumn=mapping.columns.find(value=>value.source==='disasterNumber').column;
  const source=new Map(delivery.rows.map(row=>[row.key,row]));
  checked(source.size===delivery.rows.length,'The retained delivery has duplicate project identities.');
  const groups=new Map(),unlinked=[];
  for(const row of parsed.rows){
    const id=row.values[idColumn],disaster=row.values[disasterColumn];
    if(!id||!disaster){unlinked.push({...row,status:'UNLINKED_CUSTOMER',customerKey:mapping.customerKeyColumn?row.values[mapping.customerKeyColumn]:null,reason:'The customer row does not provide both original source identifiers.'});continue;}
    const key=keyOf(disaster,id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
  }
  const rows=[...unlinked],seen=new Set(),proposals=[];
  for(const [key,customers]of groups){
    const original=source.get(key);
    if(customers.length>1){for(const customer of customers)rows.push({...customer,key,status:'DUPLICATE_CUSTOMER_ID',subject:original?.subject??null,reason:'More than one customer row uses the same disaster/project identity.'});seen.add(key);continue;}
    const customer=customers[0];seen.add(key);
    if(!original){rows.push({...customer,key,status:'NOT_OBSERVED_IN_SOURCE_EDITION',reason:'This customer identity is absent from the selected obligated-project source and portfolio scope.'});continue;}
    checked(hash(original.values)===original.valuesSha256,'An original exported row changed.');
    const differences=[],reviewChanges=[],customerFields={};let proposal=reviewBaseline(original),proposalError=null;
    for(const column of mapping.columns){
      const supplied=customer.values[column.column],prior=original.values[column.column];
      if(column.source===null){customerFields[column.column]=supplied;continue;}
      const definition=DELIVERY_FIELDS[column.source];
      if(!valueEquivalent(prior,supplied,definition.kind)){
        const change={column:column.column,source:column.source,kind:definition.kind,before:prior,customer:supplied};
        if(definition.owner==='review'){reviewChanges.push(change);proposal[column.source.slice(7)]=supplied;}
        else differences.push(change);
      }
    }
    if(reviewChanges.length){
      try{proposal=validateAnnotation(proposal);proposals.push({rowNumber:customer.rowNumber,key,subject:original.subject,annotation:proposal,
        originalAnnotation:reviewBaseline(original),reviewChanges,sourceDifferences:differences});}
      catch(error){proposalError=error.message;}
    }
    rows.push({...customer,key,subject:original.subject,status:proposalError?'REVIEW_INPUT_INVALID':differences.length?'SOURCE_DIFFERENCES':reviewChanges.length?'REVIEW_CHANGES':'MATCHED',
      differences,reviewChanges,proposalError,customerFields,source:original.source});
  }
  const sourceOnly=delivery.rows.filter(row=>!seen.has(row.key)).map(row=>({key:row.key,subject:row.subject,projectId:row.projectId,disasterNumber:row.disasterNumber,
    status:'SOURCE_ONLY',source:row.source,values:row.values,reason:'The selected source project is absent from this customer file; source and customer records remain separate.'}));
  rows.sort((a,b)=>a.rowNumber-b.rowNumber);
  const counts={MATCHED:0,REVIEW_CHANGES:0,SOURCE_DIFFERENCES:0,REVIEW_INPUT_INVALID:0,UNLINKED_CUSTOMER:0,DUPLICATE_CUSTOMER_ID:0,NOT_OBSERVED_IN_SOURCE_EDITION:0,SOURCE_ONLY:sourceOnly.length};
  for(const row of rows)counts[row.status]++;
  return {schema:RECONCILIATION_SCHEMA,createdAt,deliveryVersionId:delivery.version.id,editionId:delivery.editionId,sourceSha256:delivery.sourceSha256,
    mappingSha256:delivery.mappingSha256,mapping:copy(mapping),sourceScope:copy(delivery.sourceScope),criteria:copy(delivery.criteria),
    file:{name:string(filename,'customer CSV filename',240),bytes:parsed.bytes,sha256:parsed.sha256,columns:parsed.columns},
    summary:{customerRows:parsed.rows.length,sourceRows:delivery.rows.length,reviewProposals:proposals.length,counts},
    rows,sourceOnly,reviewProposals:proposals,
    treatment:'Source-field differences are review items. Only explicitly selected valid analyst-review proposals can create a new native portfolio version. Original customer cells and original source rows remain unchanged.'};
}
export function compareProjectDeliveries(before,after){
  checked(before?.manifest?.schema===DELIVERY_SCHEMA&&after?.manifest?.schema===DELIVERY_SCHEMA,'Choose two retained project deliveries.');
  const comparison=comparePortfolios(checkedPortfolio(before.portfolio),checkedPortfolio(after.portfolio));
  const reviewBySubject=portfolio=>new Map(portfolio.projects.map(project=>[project.subject,project.annotation??null]));
  const a=reviewBySubject(before.portfolio),b=reviewBySubject(after.portfolio),reviewChanges=[];
  for(const [subject,next]of b)if(a.has(subject)&&stable(a.get(subject))!==stable(next))reviewChanges.push({subject,before:a.get(subject),after:next});
  return {schema:'stellar-forge.openfema-delivery-comparison.v1',beforeVersionId:before.manifest.version.id,afterVersionId:after.manifest.version.id,
    beforeSourceSha256:before.manifest.sourceSha256,afterSourceSha256:after.manifest.sourceSha256,
    sameScope:comparison.sameScope,sameMapping:before.manifest.mappingSha256===after.manifest.mappingSha256,
    scopeMeaning:comparison.scopeMeaning,
    newlyObserved:comparison.added,notObserved:comparison.removed,sourceChanges:comparison.changed,reviewChanges,
    summary:{newlyObserved:comparison.added.length,notObserved:comparison.removed.length,sourceChanges:comparison.changed.length,reviewChanges:reviewChanges.length,
      beforeRows:before.manifest.rows.length,afterRows:after.manifest.rows.length,
      federalDeltaMinor:comparison.summary.federalDeltaMinor,projectCostDeltaMinor:comparison.summary.projectCostDeltaMinor,
      totalObligatedDeltaMinor:comparison.summary.totalObligatedDeltaMinor,mitigationDeltaMinor:comparison.summary.mitigationDeltaMinor,
      beforeMissing:comparison.summary.beforeMissing,afterMissing:comparison.summary.afterMissing},
    interpretation:'Absence describes these selected editions. It does not establish cancellation, completion, deletion, or an award. Amount changes remain separate exact source measures.'};
}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const htmlTable=(columns,rows)=>'<div class="table"><table><thead><tr>'+columns.map(column=>'<th>'+escape(column)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(column=>'<td>'+escape(typeof row[column]==='object'?JSON.stringify(row[column]):row[column])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
export function deliveryReport(kind,value){
  const isDelivery=kind==='delivery',isReconciliation=kind==='reconciliation';
  const heading=isDelivery?'Project data delivery':isReconciliation?'Customer source reconciliation':'Project edition comparison';
  const summary=value.summary;
  const body=isDelivery?'<h2>Reviewed destination</h2><p>'+escape(value.mapping.target.name)+' · '+escape(value.customerSchema)+'</p><p>'+escape(value.mapping.target.reference)+'</p><p>Reviewed by '+escape(value.mappingReview.reviewer)+' · '+escape(value.mappingReview.note)+'</p><h2>Complete mapped project register</h2>'+htmlTable(value.targetFile.columns,value.rows.map(row=>row.values))+'<h2>Source and mapping issues</h2><pre>'+escape(JSON.stringify(value.issues,null,2))+'</pre>':
    isReconciliation?'<h2>Complete customer register</h2>'+htmlTable(['rowNumber','status','subject','values','differences','reviewChanges','proposalError'],value.rows)+'<h2>Source projects absent from this customer file</h2>'+htmlTable(['projectId','disasterNumber','subject','reason'],value.sourceOnly)+'<h2>Analyst review proposals</h2>'+htmlTable(['rowNumber','subject','annotation','sourceDifferences'],value.reviewProposals):
    '<h2>Newly observed in the selected edition</h2>'+htmlTable(['id','disasterNumber','applicantId','projectTitle'],value.newlyObserved)+'<h2>Not observed in the selected edition</h2>'+htmlTable(['id','disasterNumber','applicantId','projectTitle'],value.notObserved)+'<h2>Original source changes</h2>'+htmlTable(['id','disasterNumber','fields','operationalChanges','federalDeltaMinor'],value.sourceChanges)+'<h2>Analyst review changes</h2>'+htmlTable(['subject','before','after'],value.reviewChanges);
  const meaning=isDelivery?[...Object.values(value.methodology),value.receiving]:[value.treatment||value.scopeMeaning,value.interpretation].filter(Boolean);
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+heading+'</title><style>body{margin:0;color:#181818;background:#fff;font:14px/1.55 system-ui,sans-serif}main{max-width:1600px;margin:auto;padding:32px}h1{font-size:28px}h2{font-size:20px;margin-top:30px}.table{overflow:auto;border:1px solid #bbb}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top;max-width:520px;overflow-wrap:anywhere}th{background:#eee;white-space:nowrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px;border:1px solid #ccc}p{max-width:1100px}@media print{main{padding:0}.table{overflow:visible}table{font-size:8px}}</style><main><p>OPENFEMA · PUBLIC ASSISTANCE · CUSTOMER DATA HANDOVER</p><h1>'+heading+'</h1><h2>Selected scope and complete counts</h2><pre>'+escape(JSON.stringify(summary,null,2))+'</pre>'+meaning.map(text=>'<p>'+escape(text)+'</p>').join('')+body+'<h2>Source and edition binding</h2><pre>'+escape(JSON.stringify({schema:value.schema,version:value.version??value.deliveryVersionId,editionId:value.editionId,sourceSha256:value.sourceSha256,sourceScope:value.sourceScope,criteria:value.criteria,mappingSha256:value.mappingSha256,sameScope:value.sameScope,sameMapping:value.sameMapping,beforeVersionId:value.beforeVersionId,afterVersionId:value.afterVersionId},null,2))+'</pre><p>Source: FEMA OpenFEMA. This product uses the original retained public datasets and does not carry FEMA endorsement.</p></main></html>';
}
