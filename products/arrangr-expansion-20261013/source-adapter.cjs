'use strict';
const core=require('./expansion-core.cjs');
const FIELDS={
 users:['id','email','email_verified','created_at','status','organization_id','marketing_permission','name','deleted_at'],
 events:['id','user_id','organization_id','pilot_id','type','at','source_ref'],
 organizations:['id','name','domains','status'],
 subscriptions:['id','subscription_id','user_id','organization_id','status','currency','monthly_recurring_minor','observed_at','source_ref'],
 payments:['id','subscription_id','user_id','organization_id','currency','net_amount_minor','kind','paid_at','source_ref'],
 touches:['id','user_id','company_key','channel','at','outcome','source_ref','note'],
 suppressions:['id','scope','key','reason','at','until_at','source_ref']
};
function mapSource(table,text,mapping,identity){
 if(!FIELDS[table])throw Error('Choose an original source table');
 if(!mapping||typeof mapping.columns!=='object'||Array.isArray(mapping.columns))throw Error('Mapping requires a columns object: target field to original column');
 if(!identity||!identity.id||!identity.filename||!identity.sha256)throw Error('Original file identity is required');
 const parsed=core.parseCSV(text),allowed=new Set(FIELDS[table]);
 for(const [target,column] of Object.entries(mapping.columns)){
  if(!allowed.has(target))throw Error('Unknown target field '+target);
  if(!parsed.headers.includes(column))throw Error('Original source column missing: '+column);
 }
 for(const field of Object.keys(mapping.defaults||{}))if(!allowed.has(field))throw Error('Unknown default field '+field);
 const rows=parsed.rows.map((original,i)=>{
  const row={...(mapping.defaults||{})};
  for(const [target,column] of Object.entries(mapping.columns))row[target]=original[column];
  if(allowed.has('source_ref')&&!row.source_ref)row.source_ref='sha256:'+identity.sha256+':record:'+(i+1);
  return row;
 });
 return{rows,source:{
  id:identity.id,name:identity.filename,mode:mapping.mode||'append',
  original_filename:identity.filename,original_text:text,original_headers:parsed.headers,
  original_rows:parsed.rows,mapping:JSON.parse(JSON.stringify(mapping)),original:{sha256:identity.sha256,record_count:rows.length}
 }};
}
function receive(workspace,table,text,mapping,identity){
 const mapped=mapSource(table,text,mapping,identity);
 return core.importRows(workspace,table,mapped.rows,mapped.source);
}
module.exports={FIELDS,mapSource,receive};
