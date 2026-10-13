/** Public CMS release/reviewer package. Zero dependencies; caller supplies SHA-256. */
export const VERSION = "source-release/1";
export const REVIEW_COLUMNS = ["release_id","facility_id","row_sha256","decision","reviewer","note"];
export function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k)+":"+stable(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function need(condition, message) { if (!condition) throw new Error(message); }

/** Explicit publisher/archive dates; omitted extensions preserve legacy release identities. */
export function normalizeEditionDates(metadata) {
  const object=value=>value&&typeof value==="object"&&!Array.isArray(value);
  need(object(metadata),"Source edition metadata required");
  const date=(value,label)=>{need(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,label+" needs YYYY-MM-DD");return value;};
  const attribution=(value,label)=>{
    need(object(value)&&Object.keys(value).every(k=>["note","source_url","source_member","source_sha256"].includes(k)),label+" needs an explicit source attribution");
    need(typeof value.note==="string"&&value.note.trim().length>0&&value.note.length<=4000,label+" needs the publisher wording or a clear explanation");
    need(typeof value.source_url==="string"&&/^https:\/\/[^/\s?#@]+(?:[/?#][^\s]*)?$/.test(value.source_url),label+" needs the exact public HTTPS source URL");
    const out={note:value.note,source_url:value.source_url};
    if(value.source_member!==undefined||value.source_sha256!==undefined){
      need(typeof value.source_member==="string"&&value.source_member.length>0&&!/^[\/\\]|^[A-Za-z]:|[\\\u0000-\u001f]/.test(value.source_member)&&!value.source_member.split("/").some(p=>!p||p==="."||p===".."),label+" needs an exact safe archive member");
      need(typeof value.source_sha256==="string"&&/^[a-f0-9]{64}$/.test(value.source_sha256),label+" archive member needs its original SHA-256");
      out.source_member=value.source_member;out.source_sha256=value.source_sha256;
    }
    return out;
  };
  const out={source_released:metadata.source_released===null?null:date(metadata.source_released,"Publication date")};
  let provenance;
  if(metadata.date_provenance!==undefined){
    need(object(metadata.date_provenance)&&Object.keys(metadata.date_provenance).length>0&&Object.keys(metadata.date_provenance).every(k=>["publication","archive"].includes(k)),"Use publication and/or archive date attribution");
    provenance={};for(const kind of ["publication","archive"])if(metadata.date_provenance[kind]!==undefined)provenance[kind]=attribution(metadata.date_provenance[kind],kind+" date");
  }
  need(out.source_released!==null||provenance?.publication,"Unknown publication date needs an explicit source attribution");
  if(metadata.archive_date!==undefined){
    out.archive_date=date(metadata.archive_date,"Archive date");
    need(typeof metadata.archive_date_meaning==="string"&&metadata.archive_date_meaning.trim()&&metadata.archive_date_meaning.length<=1000,"Archive date needs its actual publisher meaning");
    need(provenance?.archive,"Archive date needs an explicit source attribution");
    out.archive_date_meaning=metadata.archive_date_meaning;
  }else need(metadata.archive_date_meaning===undefined&&!provenance?.archive,"Archive meaning/attribution requires its separate archive date");
  if(provenance)out.date_provenance=provenance;
  return out;
}
export function editionDateSummary(metadata) {
  const parts=[metadata.source_released===null?"Publication date not supplied":"Published "+metadata.source_released];
  if(metadata.archive_date)parts.push("Archive "+metadata.archive_date+" ("+metadata.archive_date_meaning+")");
  if(metadata.source_modified)parts.push("Modified "+metadata.source_modified);
  if(metadata.captured_on)parts.push("Captured "+metadata.captured_on);
  return parts.join(" · ");
}

export function csv(rows, fields) {
  const cell = value => '"' + String(value ?? "").replaceAll('"','""') + '"';
  return [fields.map(cell).join(","), ...rows.map(row => fields.map(f=>cell(row[f])).join(","))].join("\r\n")+"\r\n";
}
export function parseCsv(text) {
  const rows=[];let row=[],cell="",quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
    else if(c==='"'){need(cell===""&&!closed,"Unexpected CSV quote");quoted=true;}
    else if(c===","){row.push(cell);cell="";closed=false;}
    else if(c==="\n"||c==="\r"){
      if(c==="\r"&&text[i+1]==="\n")i++;
      row.push(cell);rows.push(row);row=[];cell="";closed=false;
    }else{need(!closed,"Unexpected text after CSV quote");cell+=c;}
  }
  need(!quoted,"Unclosed CSV quote");
  if(cell!==""||row.length||closed){row.push(cell);rows.push(row);}
  if(!rows.length)return{fields:[],rows:[]};
  const fields=rows.shift();need(new Set(fields).size===fields.length,"Duplicate CSV header");
  return{fields,rows:rows.map((cells,i)=>{need(cells.length===fields.length,"CSV row "+(i+2)+" has wrong width");return Object.fromEntries(fields.map((f,j)=>[f,cells[j]]));})};
}
export function buildRelease(pageSources, metadata, sha256) {
  need(Array.isArray(pageSources)&&pageSources.length>0,"Original API pages required");
  need(typeof sha256==="function","SHA-256 function required");
  const pages=pageSources.map(p=>({...p,data:JSON.parse(p.text)})).sort((a,b)=>a.data.query.offset-b.data.query.offset);
  const first=pages[0].data, resources=first.query.resources, resource=resources?.[0]?.id;
  need(first.query.offset===0&&resources.length===1,"Start with offset zero and one resource");
  const fields=first.query.properties;
  need(Array.isArray(fields)&&fields.includes("facility_id")&&new Set(fields).size===fields.length,"Unique source fields required");
  need(Number.isSafeInteger(first.count)&&first.count>0,"Invalid provider result count");
  const conditions=stable(first.query.conditions);
  need(first.query.conditions.length===1&&first.query.conditions[0].property==="state"&&
    first.query.conditions[0].operator==="="&&first.query.conditions[0].value==="CA","This release requires the original California filter");
  const rows=[], seen=new Set(); let expectedOffset=0;
  const raw=pages.map(p=>{
    const d=p.data;
    need(d.count===first.count&&stable(d.query.resources)===stable(resources),"Provider count or resource changed across pages");
    need(stable(d.query.properties)===stable(fields)&&stable(d.query.conditions)===conditions,"Source fields or scope changed across pages");
    need(stable(d.schema)===stable(first.schema),"Source schema changed across pages");
    need(d.query.offset===expectedOffset&&Number.isSafeInteger(d.query.limit)&&d.query.limit>0,"Missing or overlapping page");
    need(Array.isArray(d.results)&&d.results.length===Math.min(d.query.limit,first.count-expectedOffset),"Incomplete original page");
    for(const r of d.results){
      need(stable(Object.keys(r).sort())===stable([...fields].sort()),"Unexpected source record fields");
      need(fields.every(f=>typeof r[f]==="string"),"Preserve original text fields");
      need(r.state==="CA"&&r.facility_id.length>0&&!seen.has(r.facility_id),"Wrong state or duplicated source facility ID");
      seen.add(r.facility_id);rows.push({...r});
    }
    expectedOffset+=d.results.length;
    return{path:p.path,source_url:p.source_url,offset:d.query.offset,rows:d.results.length,bytes:p.bytes,sha256:sha256(p.text)};
  });
  need(expectedOffset===first.count,"The original query has unread rows");
  rows.sort((a,b)=>a.facility_id<b.facility_id?-1:a.facility_id>b.facility_id?1:0);
  const releaseBasis={schema:VERSION,dataset_id:"xubh-q36u",resource_id:resource,scope:{state:"CA"},fields,rows};
  const release_id="cms-ca-"+sha256(stable(releaseBasis));
  const records=rows.map(row=>({facility_id:row.facility_id,row_sha256:sha256(stable(row)),original:row}));
  const countBy=field=>Object.fromEntries([...new Set(rows.map(r=>r[field]))].sort().map(value=>[value,rows.filter(r=>r[field]===value).length]));
  const manifest={schema:VERSION,release_id,dataset_id:"xubh-q36u",resource_id:resource,scope:{state:"CA"},
    captured_on:metadata.captured_on,source_modified:metadata.source_modified,...normalizeEditionDates(metadata),
    dataset_url:metadata.dataset_url,dictionary_url:metadata.dictionary_url,row_count:rows.length,field_count:fields.length,
    key:{field:"facility_id",type:"text",meaning:"CMS facility identifier; preserved exactly including leading zeroes"},
    fields,original_pages:raw,records_sha256:sha256(stable(records)),data_csv_sha256:sha256(csv(rows,fields))};
  const review=records.map(r=>({release_id,facility_id:r.facility_id,row_sha256:r.row_sha256,decision:"UNREVIEWED",reviewer:"",note:""}));
  const fieldsOut=Object.fromEntries(fields.map(f=>[f,{...first.schema[resource].fields[f],preserved_type:"string"}]));
  return {manifest,records,fields:fieldsOut,review,summary:{release_id,row_count:rows.length,field_count:fields.length,
    hospital_types:countBy("hospital_type"),counties:countBy("countyparish"),
    rating_blank:rows.filter(r=>r.hospital_overall_rating==="").length,
    rating_not_available:rows.filter(r=>r.hospital_overall_rating==="Not Available").length}};
}
export function applyReview(release, input) {
  need(input&&input.schema==="source-review/1"&&input.release_id===release.manifest.release_id,"Review belongs to a different release");
  need(Array.isArray(input.decisions)&&input.decisions.length===release.records.length,"A reviewer return must contain one decision per original record");
  const ids=new Set(),source=new Map(release.records.map(r=>[r.facility_id,r]));
  const decisions=input.decisions.map(r=>{
    need(r&&typeof r==="object","Invalid reviewer row");
    need(!ids.has(r.facility_id)&&source.has(r.facility_id),"Unknown or repeated reviewer facility");
    ids.add(r.facility_id);
    need(r.release_id===release.manifest.release_id&&r.row_sha256===source.get(r.facility_id).row_sha256,"Reviewer row source changed");
    need(["UNREVIEWED","ACCEPT","CHECK"].includes(r.decision),"Unknown review decision");
    need(typeof r.reviewer==="string"&&r.reviewer.length<=200&&typeof r.note==="string"&&r.note.length<=3000,"Invalid reviewer identity/note");
    need(r.decision==="UNREVIEWED"||r.reviewer.trim(),"Enter a reviewer for a completed decision");
    need(r.decision!=="CHECK"||r.note.trim(),"Explain a CHECK decision");
    return Object.fromEntries(REVIEW_COLUMNS.map(k=>[k,r[k]]));
  }).sort((a,b)=>a.facility_id<b.facility_id?-1:a.facility_id>b.facility_id?1:0);
  return {schema:"source-review/1",release_id:release.manifest.release_id,decisions,
    summary:Object.fromEntries(["UNREVIEWED","ACCEPT","CHECK"].map(s=>[s,decisions.filter(d=>d.decision===s).length]))};
}
export function compareReleases(before, after) {
  need(before.manifest.dataset_id===after.manifest.dataset_id&&stable(before.manifest.scope)===stable(after.manifest.scope),"Compare the same dataset and query scope");
  const prior=new Map(before.records.map(r=>[r.facility_id,r])), next=new Map(after.records.map(r=>[r.facility_id,r]));
  const fields=[...new Set([...before.manifest.fields,...after.manifest.fields])];
  const changes=[];
  for(const id of [...new Set([...prior.keys(),...next.keys()])].sort()){
    const a=prior.get(id),b=next.get(id);
    if(!a||!b){changes.push({facility_id:id,change:a?"REMOVED":"ADDED",field:"",before:a?stable(a.original):"",after:b?stable(b.original):""});continue;}
    for(const field of fields)if(a.original[field]!==b.original[field])
      changes.push({facility_id:id,change:"FIELD_CHANGED",field,before:a.original[field]??"",after:b.original[field]??""});
  }
  return{schema:"source-diff/1",before_release_id:before.manifest.release_id,after_release_id:after.manifest.release_id,
    added_fields:after.manifest.fields.filter(f=>!before.manifest.fields.includes(f)),
    removed_fields:before.manifest.fields.filter(f=>!after.manifest.fields.includes(f)),changes};
}
