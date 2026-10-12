import {canonical,sha256} from './propply.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const has=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const need=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code});};
const clone=v=>JSON.parse(canonical(v));
export const PROPERTY_IDENTITY_MEANING=Object.freeze({
  hpd:'The retained HPD baseline has building-in-project records. Several rows may refer to the same building or BBL. Project participation is not a violation or inspection finding.',
  propply:'The vendor response reports property aggregates and source coverage at its retained source time. A missing value is unknown; it is not zero.',
  rentcheck:'The selected RentCheck property and inspection template belong to the receiving operator. An external property identifier is not inferred from HPD project membership.',
  join:'An operator reviews explicit links. Candidate matches neither change the source nor submit an inspection.',
});
export function pointer(value,path) {
  need(typeof path==='string'&&(path===''||path.startsWith('/')),'PROPERTY_LOCATOR','Use a JSON pointer to the original record.');
  if(path==='')return {present:true,value};
  const keys=path.slice(1).split('/').map(k=>{
    need(!/~(?![01])/u.test(k),'PROPERTY_LOCATOR','The source pointer has an invalid escape.');
    return k.replaceAll('~1','/').replaceAll('~0','~');
  });
  let current=value;
  for(const key of keys){
    if(current===null||typeof current!=='object'||!has(current,key))return {present:false,value:null};
    current=current[key];
  }
  return {present:true,value:clone(current)};
}
function identifier(value,kind) {
  if(value===null||value===undefined||value==='')return null;
  // Only canonical NYC numeric identifiers can become match candidates.
  // Raw values remain in the source; candidates still require an operator.
  const selected=typeof value==='string'?value.trim():Number.isSafeInteger(value)?String(value):'';
  if(!selected)return null;
  if(kind==='bbl')return /^\d{10}$/.test(selected)?selected:null;
  if(kind==='bin')return /^\d{7}$/.test(selected)?selected:null;
  return selected||null;
}
function field(row,name) { return name && has(row,name)?row[name]:null; }
export function inspectHpdIdentity({source_sha256,rows,columns}) {
  need(typeof source_sha256==='string'&&/^[a-f0-9]{64}$/.test(source_sha256),'HPD_SOURCE','Use the actual retained HPD source hash.');
  need(Array.isArray(rows)&&rows.every(object),'HPD_ROWS','Pass the original dataset parser’s complete HPD row objects.');
  need(object(columns)&&Object.keys(columns).every(k=>['project_id','building_id','bbl','bin','address'].includes(k)),'HPD_COLUMNS','Select named columns from the retained HPD dataset.');
  for(const name of Object.values(columns))need(typeof name==='string'&&name,'HPD_COLUMNS','Column selections must retain their actual source name.');
  return {source_sha256,columns:clone(columns),meaning:PROPERTY_IDENTITY_MEANING.hpd,
    rows:rows.map((row,index)=>({source_row:index+1,source_locator:'/rows/'+index,
      row_sha256:sha256(Buffer.from(canonical(row))),raw:clone(row),
      project_id:field(row,columns.project_id),building_id:field(row,columns.building_id),
      bbl:identifier(field(row,columns.bbl),'bbl'),bin:identifier(field(row,columns.bin),'bin'),
      address:field(row,columns.address)}))};
}
export function candidateHpdRows(baseline,{bbl,bin}) {
  const normalized={bbl:identifier(bbl,'bbl'),bin:identifier(bin,'bin')};
  // Address similarity is deliberately not an automatic identity link.
  const rows=baseline.rows.filter(row=>
    normalized.bbl && row.bbl===normalized.bbl || normalized.bin && row.bin===normalized.bin);
  return {candidates:rows.map(row=>({source_row:row.source_row,row_sha256:row.row_sha256,
    matches:[...(normalized.bbl && row.bbl===normalized.bbl?['bbl']:[]),
      ...(normalized.bin && row.bin===normalized.bin?['bin']:[])],
    project_id:row.project_id,building_id:row.building_id,bbl:row.bbl,bin:row.bin,address:row.address})),
    selected:[],requires_review:true,meaning:PROPERTY_IDENTITY_MEANING.join};
}
function opaque(value,name) {
  need(typeof value==='string'&&value.trim()&&value.length<=500&&!/[\u0000-\u001f]/.test(value),'PROPERTY_ID','Select '+name+' as its original text identity.');
  return value;
}
export function reviewPropertyLinks({baseline,reportEdition,properties,links,actor,note}) {
  need(Array.isArray(properties)&&properties.length>0&&properties.length<=50,'PROPERTY_SELECTION','Select between one and fifty properties.');
  const selected=new Map();
  for(const item of properties){
    need(object(item),'PROPERTY_SELECTION','Each selected property must be a complete selected record.');
    const id=opaque(item.id,'the local property identity');
    need(!selected.has(id),'PROPERTY_DUPLICATE','Selected property identities must be unique.');
    need(object(item.propply_address),'PROPERTY_SELECTION','Retain the address used in the original Propply request.');
    if(item.rentcheck_property_id!==null&&item.rentcheck_property_id!==undefined)opaque(item.rentcheck_property_id,'the RentCheck property ID');
    selected.set(id,item);
  }
  need(Array.isArray(links),'PROPERTY_LINKS','Review an explicit link list.');
  opaque(actor,'the reviewing operator');opaque(note,'the identity-review note');
  const usedReports=new Set(),usedProperties=new Set(),usedRows=new Map();
  const reports=new Map(reportEdition.reports.map(r=>[r.report_id,r]));
  const reviewed=links.map(link=>{
    need(object(link)&&Object.keys(link).every(k=>['property_id','report_id','hpd_rows','relationship','note'].includes(k)),'PROPERTY_LINK','Use only the original property/report/HPD-row link fields.');
    const property=selected.get(link.property_id),report=reports.get(link.report_id);
    need(property&&report,'PROPERTY_LINK_CHANGED','A reviewed property or report is no longer in the selected edition.');
    need(!usedProperties.has(link.property_id),'PROPERTY_LINK_DUPLICATE','Use at most one report for each selected property in this reviewed report edition.');
    need(['same_property','building_context','parcel_context'].includes(link.relationship),'PROPERTY_LINK_RELATIONSHIP','Specify whether this is the same property, building context or parcel context.');
    opaque(link.note,'the source-to-receiving identity explanation');
    usedReports.add(link.report_id);usedProperties.add(link.property_id);
    need(Array.isArray(link.hpd_rows),'PROPERTY_LINK_ROWS','Select the original HPD source row identities explicitly; an empty set is a retained unmatched property.');
    const uniqueRows=new Set();
    const hpd=link.hpd_rows.map(selectedRow=>{
      need(object(selectedRow)&&Number.isInteger(selectedRow.source_row)&&typeof selectedRow.row_sha256==='string','PROPERTY_LINK_ROW','Select an original source-row and hash pair.');
      const row=baseline.rows[selectedRow.source_row-1];
      need(row&&row.row_sha256===selectedRow.row_sha256,'PROPERTY_LINK_ROW_CHANGED','A selected HPD row differs from the retained source.');
      need(!uniqueRows.has(row.source_row),'PROPERTY_LINK_ROW_DUPLICATE','Do not repeat a source row within a property link.');
      uniqueRows.add(row.source_row);
      const earlier=usedRows.get(row.source_row)||[];
      usedRows.set(row.source_row,[...earlier,link.property_id]);
      return {source_row:row.source_row,row_sha256:row.row_sha256,source_locator:row.source_locator};
    });
    if(link.note!==undefined)opaque(link.note,'the property link note');
    return {property_id:property.id,property:clone(property),report_id:report.report_id,
      report_locator:report.locator,hpd_rows:hpd,relationship:link.relationship,note:link.note,state:hpd.length?'LINKED':'NO_HPD_MATCH'};
  });
  const value={schema:'tjlabs.property-identity-review/v1',
    hpd_source_sha256:baseline.source_sha256,
    propply_response_sha256:reportEdition.receipt.response_sha256,
    selected_properties_sha256:sha256(Buffer.from(canonical(properties))),
    actor,note,links:reviewed,
    repeated_hpd_context:[...usedRows].filter(([,ids])=>ids.length>1).map(([source_row,property_ids])=>({source_row,property_ids,meaning:'Shared source context; do not sum a building/parcel aggregate once per receiving unit.'})),
    unmatched_properties:properties.filter(p=>!usedProperties.has(p.id)).map(p=>p.id),
    unmatched_reports:reportEdition.reports.filter(r=>!usedReports.has(r.report_id)).map(r=>r.report_id),
    meaning:PROPERTY_IDENTITY_MEANING};
  return {...value,identity_sha256:sha256(Buffer.from(canonical(value)))};
}
export function comparePropertyEditions({previous,current,previousReview,currentReview,fields}) {
  need(Array.isArray(fields)&&fields.length>0&&fields.length<=64,'PROPERTY_COMPARISON_FIELDS','Select between one and sixty-four explicit report fields.');
  const names=new Set();
  for(const f of fields){need(object(f)&&typeof f.name==='string'&&f.name&&!names.has(f.name),'PROPERTY_COMPARISON_FIELD','Comparison field names must be unique.');names.add(f.name);pointer({},f.pointer);}
  const check=(edition,review)=>{
    need(review.propply_response_sha256===edition.receipt.response_sha256,'PROPERTY_REVIEW_CHANGED','The identity review belongs to a different report edition.');
    const {identity_sha256,...value}=review;
    need(identity_sha256===sha256(Buffer.from(canonical(value))),'PROPERTY_REVIEW_CHANGED','The selected identity review changed.');
  };
  check(previous,previousReview);check(current,currentReview);
  const prior=new Map(previousReview.links.map(l=>[l.property_id,l]));
  const latest=new Map(currentReview.links.map(l=>[l.property_id,l]));
  const priorReports=new Map(previous.reports.map(r=>[r.report_id,r]));
  const currentReports=new Map(current.reports.map(r=>[r.report_id,r]));
  const ids=[...new Set([...prior.keys(),...latest.keys()])].sort();
  const rows=ids.map(id=>{
    const before=prior.get(id),after=latest.get(id);
    const oldReport=before?priorReports.get(before.report_id):null;
    const newReport=after?currentReports.get(after.report_id):null;
    need((!before||oldReport)&&(!after||newReport),'PROPERTY_REPORT_MISSING','A reviewed report is missing from its original edition.');
    const sameIdentity=!before||!after||canonical(before.property)===canonical(after.property)&&before.relationship===after.relationship;
    const changed=fields.map(f=>{
      const left=oldReport?pointer(oldReport.raw,f.pointer):{present:false,value:null};
      const right=newReport?pointer(newReport.raw,f.pointer):{present:false,value:null};
      return {field:f.name,pointer:f.pointer,before:left,after:right,
        state:!sameIdentity?'IDENTITY_CHANGED':!left.present&&!right.present?'UNAVAILABLE':!left.present?'BECAME_AVAILABLE':!right.present?'BECAME_UNAVAILABLE':canonical(left.value)===canonical(right.value)?'UNCHANGED':'CHANGED'};
    });
    return {property_id:id,previous_report:before?.report_id??null,current_report:after?.report_id??null,
      previous_locator:oldReport?.locator??null,current_locator:newReport?.locator??null,
      state:!before?'ADDED_TO_REVIEW':!after?'REMOVED_FROM_REVIEW':!sameIdentity?'IDENTITY_CHANGED':'PAIRED',
      fields:changed};
  });
  return {schema:'tjlabs.property-report-comparison/v1',
    previous_response_sha256:previous.receipt.response_sha256,current_response_sha256:current.receipt.response_sha256,
    previous_identity_sha256:previousReview.identity_sha256,current_identity_sha256:currentReview.identity_sha256,
    selected_fields:clone(fields),rows,meaning:'Only the selected vendor fields are compared. Added/removed review membership does not establish that a property or condition was created, deleted or resolved.'};
}
