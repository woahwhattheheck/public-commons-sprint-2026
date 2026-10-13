/** Complete original-CSV intake and source-bound edition comparison. */
import {stable,csv,parseCsv,buildRelease,REVIEW_COLUMNS,normalizeEditionDates} from "./release_core.mjs";
export const CSV_RELEASE_VERSION="source-release-csv/1";
export const TRANSFER_VERSION="source-release-transfer/1";
export const CMS_CANONICAL_FIELDS=["facility_id","facility_name","address","citytown","state","zip_code","countyparish","telephone_number","hospital_type","hospital_ownership","emergency_services","meets_criteria_for_birthing_friendly_designation","hospital_overall_rating","hospital_overall_rating_footnote","mort_group_measure_count","count_of_facility_mort_measures","count_of_mort_measures_better","count_of_mort_measures_no_different","count_of_mort_measures_worse","mort_group_footnote","safety_group_measure_count","count_of_facility_safety_measures","count_of_safety_measures_better","count_of_safety_measures_no_different","count_of_safety_measures_worse","safety_group_footnote","readm_group_measure_count","count_of_facility_readm_measures","count_of_readm_measures_better","count_of_readm_measures_no_different","count_of_readm_measures_worse","readm_group_footnote","pt_exp_group_measure_count","count_of_facility_pt_exp_measures","pt_exp_group_footnote","te_group_measure_count","count_of_facility_te_measures","te_group_footnote"];
const need=(condition,message)=>{if(!condition)throw Error(message);};
const object=value=>value&&typeof value==="object"&&!Array.isArray(value);
const same=(a,b)=>stable(a)===stable(b);
export function utf8Bytes(value){let n=0;for(const c of value){const p=c.codePointAt(0);n+=p<128?1:p<2048?2:p<65536?3:4;}return n;}
function date(value,name){need(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,name+" needs an explicit YYYY-MM-DD date");return value;}
function sourcePath(value){need(typeof value==="string"&&value.startsWith("original/")&&!value.includes("\\")&&!value.split("/").some(x=>!x||x==="."||x===".."),"Use an original/ relative source member");return value;}
function sourceURL(value){need(typeof value==="string"&&/^https:\/\/[^/\s?#@]+(?:[/?#][^\s]*)?$/.test(value),"Use the exact public HTTPS source URL");return value;}
export function normalizeCsvRequest(request,headers){
  need(object(request)&&request.schema==="source-csv-request/1","Use source-csv-request/1");
  need(request.dataset_id==="xubh-q36u"&&same(request.scope,{state:"CA"}),"Select the original CMS dataset and California scope");
  need(["official-original","derived-current-api-csv"].includes(request.origin),"State the actual original or derived CSV origin");
  need(typeof request.resource_id==="string"&&request.resource_id.trim()&&request.resource_id.length<=400,"Enter the actual source resource/edition identity");
  need(object(request.metadata),"Original edition metadata required");
  const m=request.metadata;
  date(m.captured_on,"Capture date");const editionDates=normalizeEditionDates(m);
  if(m.source_modified!==null&&m.source_modified!==undefined)date(m.source_modified,"Published modification date");
  sourceURL(m.dataset_url);sourceURL(m.source_url);
  if(m.dictionary_url)sourceURL(m.dictionary_url);
  need(Array.isArray(request.column_mapping)&&request.column_mapping.length>0,"Explicit original-header to known-field mapping required");
  const seenHeaders=new Set(),seenFields=new Set(),map=new Map();
  const mappings=request.column_mapping.map(row=>{
    need(object(row)&&typeof row.source_header==="string"&&headers.includes(row.source_header),"Mapped original header is absent");
    need(typeof row.field==="string"&&/^[a-z][a-z0-9_]*$/.test(row.field)&&CMS_CANONICAL_FIELDS.includes(row.field),"Map only to a known CMS field; other source columns remain retained under their original headers");
    need(!seenHeaders.has(row.source_header)&&!seenFields.has(row.field),"CSV mappings must be one-to-one");
    seenHeaders.add(row.source_header);seenFields.add(row.field);map.set(row.source_header,row.field);
    return{source_header:row.source_header,field:row.field};
  });
  need(seenFields.has("facility_id")&&seenFields.has("state"),"Explicit Facility ID and State mappings are required");
  const columns=headers.map(header=>({source_header:header,field:map.get(header)||"source_column:"+header,mapped:map.has(header)}));
  need(new Set(columns.map(c=>c.field)).size===columns.length,"Retained source columns collide");
  const parent=request.parent_release?{
    release_id:String(request.parent_release.release_id||""),
    data_csv_sha256:String(request.parent_release.data_csv_sha256||"")
  }:null;
  if(request.origin==="derived-current-api-csv")need(parent&&/^cms-ca-[a-f0-9]{64}$/.test(parent.release_id)&&/^[a-f0-9]{64}$/.test(parent.data_csv_sha256),"Derived-current input must retain its original release and CSV hash");
  return{schema:request.schema,dataset_id:request.dataset_id,scope:{state:"CA"},origin:request.origin,
    resource_id:request.resource_id,metadata:{captured_on:m.captured_on,source_modified:m.source_modified??null,
      ...editionDates,dataset_url:m.dataset_url,source_url:m.source_url,dictionary_url:m.dictionary_url||null,
      ...(m.archive_url?{archive_url:sourceURL(m.archive_url)}:{}),...(m.archive_member?{archive_member:String(m.archive_member)}:{})},
    column_mapping:mappings,columns,...(parent?{parent_release:parent}:{})};
}
export function buildCsvRelease(source,request,sha256){
  need(object(source)&&typeof source.text==="string"&&typeof sha256==="function","Original CSV text and SHA-256 function required");
  const originalPath=sourcePath(source.path),originalSHA=sha256(source.text),bytes=utf8Bytes(source.text);
  need(source.bytes===undefined||source.bytes===bytes,"Original CSV byte count differs");
  need(source.sha256===undefined||source.sha256===originalSHA,"Original CSV SHA differs");
  const hadBOM=source.text.charCodeAt(0)===0xfeff;
  const parsed=parseCsv(hadBOM?source.text.slice(1):source.text);
  need(parsed.fields.length>0&&parsed.fields.every(h=>h.length>0),"Original CSV has an empty header");
  need(parsed.rows.length>0,"Original CSV has no source records");
  const normalized=normalizeCsvRequest(request,parsed.fields),fields=normalized.columns.map(c=>c.field);
  if(normalized.origin==="derived-current-api-csv")need(normalized.parent_release.data_csv_sha256===originalSHA,"Derived CSV differs from its retained parent output");
  const full=parsed.rows.map((row,i)=>({source_record_number:i+2,original:Object.fromEntries(normalized.columns.map(c=>[c.field,row[c.source_header]]))}));
  const seen=new Set();
  for(const {original:r,source_record_number}of full){
    need(r.facility_id.length>0&&!seen.has(r.facility_id),"Empty or duplicate original facility ID at CSV record "+source_record_number);
    seen.add(r.facility_id);
  }
  const selected=full.filter(r=>r.original.state==="CA").sort((a,b)=>a.original.facility_id<b.original.facility_id?-1:a.original.facility_id>b.original.facility_id?1:0);
  need(selected.length>0,"Original CSV has no California rows for the selected scope");
  const rows=selected.map(r=>r.original);
  const basis={schema:CSV_RELEASE_VERSION,dataset_id:normalized.dataset_id,resource_id:normalized.resource_id,
    scope:normalized.scope,request:normalized,original_csv_sha256:originalSHA,fields,rows};
  const release_id="cms-ca-"+sha256(stable(basis));
  const records=selected.map(r=>({facility_id:r.original.facility_id,row_sha256:sha256(stable(r.original)),source_record_number:r.source_record_number,original:r.original}));
  const raw={path:originalPath,source_url:normalized.metadata.source_url,bytes,sha256:originalSHA,source_row_count:full.length,selected_row_count:rows.length,utf8_bom:hadBOM};
  const manifest={schema:CSV_RELEASE_VERSION,release_id,dataset_id:normalized.dataset_id,resource_id:normalized.resource_id,
    scope:normalized.scope,origin:normalized.origin,...normalized.metadata,request:normalized,source_headers:parsed.fields,
    row_count:rows.length,field_count:fields.length,source_row_count:full.length,
    key:{field:"facility_id",type:"text",meaning:"CMS facility identifier; preserved exactly including leading zeroes"},
    fields,original_csv:raw,records_sha256:sha256(stable(records)),data_csv_sha256:sha256(csv(rows,fields))};
  const fieldsOut=Object.fromEntries(normalized.columns.map(c=>[c.field,{description:c.source_header,preserved_type:"string",source_header:c.source_header,mapped:c.mapped}]));
  const countBy=field=>fields.includes(field)?Object.fromEntries([...new Set(rows.map(r=>r[field]))].sort().map(value=>[value,rows.filter(r=>r[field]===value).length])):{};
  const review=records.map(r=>({release_id,facility_id:r.facility_id,row_sha256:r.row_sha256,decision:"UNREVIEWED",reviewer:"",note:""}));
  return{manifest,records,fields:fieldsOut,review,summary:{release_id,row_count:rows.length,field_count:fields.length,
    source_row_count:full.length,selected_scope:{state:"CA"},retained_unmapped_columns:normalized.columns.filter(c=>!c.mapped),
    hospital_types:countBy("hospital_type"),counties:countBy("countyparish"),
    rating_blank:fields.includes("hospital_overall_rating")?rows.filter(r=>r.hospital_overall_rating==="").length:null,
    rating_not_available:fields.includes("hospital_overall_rating")?rows.filter(r=>r.hospital_overall_rating==="Not Available").length:null}};
}
export function makeTransfer(release,originals){
  return{schema:TRANSFER_VERSION,manifest:release.manifest,records:release.records,fields:release.fields,summary:release.summary,
    originals:originals.map(r=>({path:r.path,text:r.text}))};
}
export function receiveTransfer(packet,sha256){
  need(object(packet)&&packet.schema===TRANSFER_VERSION&&object(packet.manifest)&&Array.isArray(packet.originals),"Use a complete release transfer");
  const m=packet.manifest,descriptors=m.schema===CSV_RELEASE_VERSION?[m.original_csv]:m.original_pages;
  need(Array.isArray(descriptors)&&descriptors.length>0&&packet.originals.length===descriptors.length,"Original source inventory differs");
  const sourceMap=new Map();
  for(const r of packet.originals){sourcePath(r.path);need(typeof r.text==="string"&&!sourceMap.has(r.path),"Duplicate or missing original transfer source");sourceMap.set(r.path,r.text);}
  const sources=descriptors.map(d=>{const body=sourceMap.get(d.path);need(typeof body==="string"&&utf8Bytes(body)===d.bytes&&sha256(body)===d.sha256,"Original source differs: "+d.path);return{...d,text:body};});
  const rebuilt=m.schema===CSV_RELEASE_VERSION?buildCsvRelease(sources[0],m.request,sha256):buildRelease(sources,m,sha256);
  for(const key of ["manifest","records","fields","summary"])need(same(rebuilt[key],packet[key]),"Transfer "+key+" differs from its complete originals");
  return rebuilt;
}
export function compareEditions(before,after,sha256){
  const a=before.manifest,b=after.manifest;
  need(a.dataset_id===b.dataset_id&&same(a.scope,b.scope),"Compare the same original dataset and geographic scope");
  need(Array.isArray(a.fields)&&Array.isArray(b.fields),"Original field inventories required");
  const old=new Map(before.records.map(r=>[r.facility_id,r])),next=new Map(after.records.map(r=>[r.facility_id,r]));
  need(old.size===before.records.length&&next.size===after.records.length,"Original facility identifiers must be unique");
  const fields=[...new Set([...a.fields,...b.fields])],changes=[],facilities=[];
  let unchanged=0;
  for(const id of [...new Set([...old.keys(),...next.keys()])].sort()){
    const x=old.get(id),y=next.get(id);const beforeRow=x?.original||null,afterRow=y?.original||null;
    const names=[beforeRow?.facility_name,afterRow?.facility_name].filter(Boolean);
    const kind=!x?"ADDED":!y?"REMOVED":null;
    let touched=0;
    if(kind){
      changes.push({facility_id:id,facility_name:names.at(-1)||id,change:kind,field:"",
        before_present:!!x,after_present:!!y,before:x?stable(beforeRow):"",after:y?stable(afterRow):"",
        before_row_sha256:x?.row_sha256||"",after_row_sha256:y?.row_sha256||""});touched=1;
    }else{
      for(const field of fields){
        const ap=Object.hasOwn(beforeRow,field),bp=Object.hasOwn(afterRow,field);
        if(ap===bp&&beforeRow[field]===afterRow[field])continue;
        changes.push({facility_id:id,facility_name:names.at(-1)||id,change:!ap?"FIELD_ADDED":!bp?"FIELD_REMOVED":"FIELD_CHANGED",field,
          before_present:ap,after_present:bp,before:ap?beforeRow[field]:"",after:bp?afterRow[field]:"",
          before_row_sha256:x.row_sha256,after_row_sha256:y.row_sha256});touched++;
      }
    }
    if(touched)facilities.push({facility_id:id,facility_name:names.at(-1)||id,change:kind||"CHANGED",changed_items:touched,before:beforeRow,after:afterRow});
    else unchanged++;
  }
  const comparison_id="cms-diff-"+sha256(stable({before_release_id:a.release_id,after_release_id:b.release_id,changes}));
  changes.forEach((row,index)=>{row.change_id="change-"+sha256(stable({comparison_id,index,row}));});
  return{schema:"source-edition-comparison/1",comparison_id,dataset_id:a.dataset_id,scope:a.scope,
    before:{release_id:a.release_id,resource_id:a.resource_id,source_released:a.source_released,...(a.archive_date?{archive_date:a.archive_date,archive_date_meaning:a.archive_date_meaning}:{}),...(a.date_provenance?{date_provenance:a.date_provenance}:{}),captured_on:a.captured_on,origin:a.origin||"official-original-api",row_count:before.records.length,field_count:a.fields.length,original_sources:a.original_csv?[a.original_csv]:a.original_pages},
    after:{release_id:b.release_id,resource_id:b.resource_id,source_released:b.source_released,...(b.archive_date?{archive_date:b.archive_date,archive_date_meaning:b.archive_date_meaning}:{}),...(b.date_provenance?{date_provenance:b.date_provenance}:{}),captured_on:b.captured_on,origin:b.origin||"official-original-api",row_count:after.records.length,field_count:b.fields.length,original_sources:b.original_csv?[b.original_csv]:b.original_pages},
    summary:{added_facilities:facilities.filter(r=>r.change==="ADDED").length,removed_facilities:facilities.filter(r=>r.change==="REMOVED").length,
      changed_facilities:facilities.filter(r=>r.change==="CHANGED").length,unchanged_facilities:unchanged,changed_items:changes.length},
    added_fields:b.fields.filter(f=>!a.fields.includes(f)),removed_fields:a.fields.filter(f=>!b.fields.includes(f)),
    field_mapping:{before:a.request?.columns||a.fields.map(f=>({source_header:f,field:f,mapped:true})),
      after:b.request?.columns||b.fields.map(f=>({source_header:f,field:f,mapped:true}))},
    changes,facilities};
}
export const CHANGE_REVIEW_COLUMNS=["comparison_id","change_id","facility_id","field","decision","reviewer","note"];
export function newChangeReview(comparison){
  return{schema:"source-change-review/1",comparison_id:comparison.comparison_id,
    decisions:comparison.changes.map(r=>({comparison_id:comparison.comparison_id,change_id:r.change_id,facility_id:r.facility_id,field:r.field,decision:"UNREVIEWED",reviewer:"",note:""}))};
}
export function applyChangeReview(comparison,input){
  need(object(input)&&input.schema==="source-change-review/1"&&input.comparison_id===comparison.comparison_id,"Review belongs to another comparison");
  need(Array.isArray(input.decisions)&&input.decisions.length===comparison.changes.length,"Retain one review decision for every original change");
  const originals=new Map(comparison.changes.map(r=>[r.change_id,r])),seen=new Set();
  const decisions=input.decisions.map(r=>{
    need(object(r)&&originals.has(r.change_id)&&!seen.has(r.change_id),"Unknown or duplicate original change");seen.add(r.change_id);
    const original=originals.get(r.change_id);
    need(r.comparison_id===comparison.comparison_id&&r.facility_id===original.facility_id&&r.field===original.field,"Review source binding differs");
    need(["UNREVIEWED","ACCEPT","CHECK"].includes(r.decision),"Choose an original review decision");
    need(typeof r.reviewer==="string"&&r.reviewer.length<=200&&typeof r.note==="string"&&r.note.length<=3000,"Review name or note is invalid");
    need(r.decision==="UNREVIEWED"||r.reviewer.trim(),"A completed decision needs its reviewer");
    need(r.decision!=="CHECK"||r.note.trim(),"CHECK needs an explanation");
    return Object.fromEntries(CHANGE_REVIEW_COLUMNS.map(k=>[k,r[k]]));
  });
  const byID=new Map(decisions.map(r=>[r.change_id,r]));
  return{schema:"source-change-review/1",comparison_id:comparison.comparison_id,
    decisions:comparison.changes.map(r=>byID.get(r.change_id)),
    summary:Object.fromEntries(["UNREVIEWED","ACCEPT","CHECK"].map(v=>[v,decisions.filter(r=>r.decision===v).length]))};
}
export function comparisonCSV(comparison){return csv(comparison.changes,["change_id","facility_id","facility_name","change","field","before_present","before","after_present","after","before_row_sha256","after_row_sha256"]);}
