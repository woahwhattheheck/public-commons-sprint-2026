// MIT. Selected property results into the ORIGINAL SF30 dataset/publisher contract.
import {canonical,sha256} from './propply.mjs';
import {pointer,PROPERTY_IDENTITY_MEANING} from './identity.mjs';
const need=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const clone=v=>JSON.parse(canonical(v));
const digest=v=>sha256(Buffer.from(canonical(v)));
const cell=v=>'"'+String(v).replaceAll('"','""')+'"';
export function preparePropertyResource({review,edition,fields,resource_key,name,rights,comparison=null,inspections=[],reports=[]}) {
  need(typeof resource_key==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(resource_key),'PROPERTY_RESOURCE_KEY','Choose a stable resource key for this merchant and receiving scope.');
  need(typeof name==='string'&&name.trim()&&name.length<=128,'PROPERTY_RESOURCE_NAME','Choose the customer-facing resource name.');
  need(object(rights)&&rights.approved===true,'PROPERTY_RESOURCE_RIGHTS','Record the parties’ actual selected resource, licence, hosting and payment authority before a merchant export.');
  for(const key of ['merchant','buyer','resource','licence','hosting','settlement','approved_by','note'])
    need(typeof rights[key]==='string'&&rights[key].trim()&&rights[key].length<=4000,'PROPERTY_RESOURCE_RIGHTS','Retain the actual '+key+' selection.');
  need(typeof rights.include_complete_vendor_response==='boolean','PROPERTY_RESOURCE_RIGHTS','Explicitly select whether the licence permits the complete original vendor response.');
  need(review.propply_response_sha256===edition.receipt.response_sha256,'PROPERTY_RESOURCE_REVIEW','The review and vendor edition must match.');
  const {identity_sha256,...reviewBody}=review;
  need(digest(reviewBody)===identity_sha256,'PROPERTY_RESOURCE_REVIEW','The selected identity review changed.');
  need(Array.isArray(fields)&&fields.length>0&&fields.length<=48,'PROPERTY_RESOURCE_FIELDS','Select one to forty-eight report fields for the licensed resource.');
  const columns=['property_id','report_id','relationship','rentcheck_property_id','hpd_rows_json','report_locator','hpd_source_sha256','propply_response_sha256'];
  const seen=new Set(columns);
  for(const item of fields){need(object(item)&&/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(item.name||'')&&!seen.has(item.name)&&!['constructor','prototype','__proto__'].includes(item.name),'PROPERTY_RESOURCE_FIELD','Give each selected field a unique native column name.');seen.add(item.name);pointer({},item.pointer);}
  columns.push(...fields.map(f=>f.name));
  const byId=new Map(edition.reports.map(r=>[r.report_id,r]));
  const rows=review.links.map(link=>{
    const source=byId.get(link.report_id);need(source,'PROPERTY_RESOURCE_REPORT','A selected report is missing.');
    return {property_id:link.property_id,report_id:link.report_id,relationship:link.relationship,
      rentcheck_property_id:canonical(link.property.rentcheck_property_id??null),
      hpd_rows_json:canonical(link.hpd_rows),report_locator:source.locator,
      hpd_source_sha256:review.hpd_source_sha256,propply_response_sha256:edition.receipt.response_sha256,
      ...Object.fromEntries(fields.map(f=>[f.name,canonical(pointer(source.raw,f.pointer))]))};
  });
  need(rows.length>0,'PROPERTY_RESOURCE_EMPTY','Review at least one explicit property link before exporting.');
  const csv=Buffer.from(columns.map(cell).join(',')+'\r\n'+rows.map(row=>columns.map(key=>cell(row[key])).join(',')).join('\r\n')+'\r\n');
  const config={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name,
    columns:Object.fromEntries(columns.map(key=>[key,{type:'string',nullable:false}])),
    filters:['property_id','relationship'],ranges:[],sorts:['property_id'],defaultLimit:25,maxLimit:50,
    maxRows:50,maxBytes:16*1024*1024};
  const source={schema:'tjlabs.property-resource-source/v1',resource_key,name,
    rights:clone(rights),field_selection:clone(fields),identity_review:clone(review),
    report_edition:{receipt:clone(edition.receipt),reports:review.links.map(link=>{const report=byId.get(link.report_id);return {report_id:report.report_id,locator:report.locator,meaning:report.meaning,selected_fields:fields.map(f=>({name:f.name,pointer:f.pointer,...pointer(report.raw,f.pointer)})),...(rights.include_complete_vendor_response?{raw:clone(report.raw)}:{})};}),
      complete_response_included:rights.include_complete_vendor_response},
    ...(rights.include_complete_vendor_response?{original_vendor_document:clone(edition.document)}:{}),
    comparison:comparison?{schema:'tjlabs.property-comparison-field-projection/v1',original_comparison_sha256:digest(comparison),previous_response_sha256:comparison.previous_response_sha256,current_response_sha256:comparison.current_response_sha256,previous_identity_sha256:comparison.previous_identity_sha256,current_identity_sha256:comparison.current_identity_sha256,selected_fields:comparison.selected_fields.filter(f=>fields.some(selected=>selected.pointer===f.pointer)),rows:comparison.rows.map(row=>({...clone(row),fields:row.fields.filter(f=>fields.some(selected=>selected.pointer===f.pointer))})),meaning:comparison.meaning}:null,inspections:clone(inspections),reports:reports.map(report=>({schema:report.schema,inspection_id:report.inspection_id,property_id:report.property_id,request_sha256:report.request_sha256,detail_response_sha256:report.detail_response_sha256,filename:report.filename,mime_type:report.mime_type,bytes:report.bytes,sha256:report.sha256,source_kind:report.source.kind,meaning:report.meaning})),
    meaning:PROPERTY_IDENTITY_MEANING,
    encoding:'Selected vendor values are JSON objects with separate present/value fields inside native string columns. Missing, null, zero and a vendor grade stay distinct.',
    boundaries:'HPD project participation remains source context. Vendor aggregates and inspection findings are separate observations. No tenant credentials, private account contract, or unselected report binary is published.',
    exact_csv:{bytes:csv.length,sha256:sha256(csv)}};
  return {resource_key,csv,config,source,rows,contract_selection_sha256:digest({resource_key,name,fields,columns:config.columns,filters:config.filters,sorts:config.sorts})};
}
