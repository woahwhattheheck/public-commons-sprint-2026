/** Source-bound CSV roster preparation for the original property selection.
 * This module never acquires a source, resolves a property identity, or writes a native case.
 */
export const SCHEMA="stellar-forge.property-roster-mapping.v1";
export const PREVIEW="stellar-forge.property-roster-preview.v1";
export const FIELDS=["key","address","city","state","zip","bbl","bin","buyerPropertyId","identityNote"];
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const need=(v,m)=>{if(!v)throw Error(m);};
export const clone=v=>JSON.parse(JSON.stringify(v));
export const canonical=v=>JSON.stringify(order(v));
function order(v){return Array.isArray(v)?v.map(order):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,order(v[k])])):v;}
const eq=(a,b)=>canonical(a)===canonical(b);
const hash=v=>typeof v==="string"&&/^[0-9a-f]{64}$/.test(v);
const safe=v=>typeof v==="string"&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(v);
const text=(v,n,max=4000)=>{need(typeof v==="string"&&v.length<=max,n+" must be complete text.");return v;};
function exact(v,keys,label){need(object(v)&&eq(Object.keys(v).sort(),[...keys].sort()),"Keep the complete "+label+" fields.");}
function source(v){
 exact(v,["id","filename","bytes","sha256","mediaType","sourceUrl","observedAt","nativeSourceId"],"original CSV descriptor");
 need(safe(v.id)&&safe(v.filename),"Use distinct safe source ID and filename.");
 need(Number.isSafeInteger(v.bytes)&&v.bytes>0&&v.bytes<=8*1024*1024&&hash(v.sha256),"Keep the exact original CSV bytes and SHA-256.");
 need(v.mediaType==="text/csv"||v.mediaType==="text/tab-separated-values","Select the actual CSV or TSV media type.");
 text(v.sourceUrl,"Original URL");
 if(v.sourceUrl){const u=new URL(v.sourceUrl);need(["http:","https:"].includes(u.protocol)&&u.hostname&&!u.username&&!u.password,"Use the original HTTP(S) source URL without credentials, or blank for a local source.");}
 need(typeof v.observedAt==="string"&&/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(v.observedAt)&&Number.isFinite(Date.parse(v.observedAt)),"Enter the actual timezone-qualified source observation.");
 need(v.nativeSourceId===null||typeof v.nativeSourceId==="string"&&v.nativeSourceId.length>0&&v.nativeSourceId.length<=100,"Retain an actual attached source ID, or null.");
 return clone(v);
}
/** One original logical record per row, physical source line locations retained.
 * Duplicate and blank headings are allowed because mappings use column ordinals.
 */
export function parseRoster(textValue,{delimiter=",",headerRow=1}={}){
 text(textValue,"Original delimited source",8*1024*1024);
 need([",","\t",";"].includes(delimiter),"Choose comma, tab or semicolon explicitly.");
 need(Number.isSafeInteger(headerRow)&&headerRow>=1&&headerRow<=100,"Select the original logical header record, from 1 to 100.");
 const input=textValue.charCodeAt(0)===0xfeff?textValue.slice(1):textValue;
 const records=[];let cells=[],cell="",quoted=false,closed=false,line=1,start=1,active=false;
 function pushCell(){cells.push(cell);cell="";closed=false;need(cells.length<=200,"The full source exceeds 200 columns.");}
 function pushRow(){pushCell();records.push({record:records.length+1,lineStart:start,lineEnd:line,cells});cells=[];active=false;need(records.length<=10000,"The full source exceeds 10,000 logical records.");}
 for(let i=0;i<input.length;i++){
  const c=input[i];active=true;
  if(quoted){
   if(c==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}
   else{cell+=c;if(c==="\n")line++;else if(c==="\r"&&input[i+1]!=="\n")line++;}
  }else if(c===delimiter){pushCell();}
  else if(c==="\r"||c==="\n"){
   pushRow();if(c==="\r"&&input[i+1]==="\n")i++;line++;start=line;
  }else if(c==='"'){
   need(cell===""&&!closed,"A quote occurs inside an unquoted source field at line "+line+".");quoted=true;
  }else{need(!closed,"Unexpected text follows a closing source quote at line "+line+".");cell+=c;}
 }
 need(!quoted,"The original source has an unfinished quoted field.");
 if(active||cells.length||cell!==""||closed)pushRow();
 need(records.length>=headerRow,"The selected header record is absent.");
 const header=records[headerRow-1];
 need(header.cells.length>0,"Select a complete original header.");
 const rows=records.slice(headerRow);
 for(const r of rows)need(r.cells.length<=header.cells.length,"Source record "+r.record+" exceeds the selected header width. Choose its actual header; no cells are discarded.");
 return {delimiter,headerRow,header:clone(header),preamble:clone(records.slice(0,headerRow-1)),rows:clone(rows),
  columns:header.cells.map((label,index)=>({index,label})),records:records.length};
}
function selection(value){
 need(value?.schema==="stellar-forge.property-commissioning-selection.v1"&&Array.isArray(value.properties)&&Array.isArray(value.templates)&&Array.isArray(value.sourceFiles),"Open the complete original property selection.");
 need(value.properties.length<=50&&value.templates.length<=3,"Keep the original scope of 50 properties and three templates.");
 return value;
}
export function createMapping(value,descriptor,table){
 selection(value);source(descriptor);
 const fields=Object.fromEntries(FIELDS.map(k=>[k,{kind:"literal",value:""}]));
 return {schema:SCHEMA,source:clone(descriptor),delimiter:table.delimiter,headerRow:table.headerRow,
  basis:clone(value),fields,inspection:{kind:"literal",value:"UNSELECTED"},
  template:{kind:"literal",value:null},
  rows:table.rows.map(r=>({record:r.record,action:"UNSELECTED",reason:""})),note:""};
}
function projection(spec,row,table,label){
 exact(spec,["kind",spec?.kind==="column"?"column":"value"],label+" mapping");
 need(spec.kind==="column"||spec.kind==="literal","Select an original column or literal for "+label+".");
 if(spec.kind==="literal")return text(spec.value,label,4000);
 need(Number.isSafeInteger(spec.column)&&spec.column>=0&&spec.column<table.columns.length,"Select the original "+label+" column.");
 need(spec.column<row.cells.length,"Source record "+row.record+" has no "+label+" cell. Missing and empty are different.");
 return row.cells[spec.column];
}
function classified(spec,row,table,allowed,label,nullable=false){
 if(spec?.kind==="literal"){
  exact(spec,["kind","value"],label);
  need(allowed.includes(spec.value)||(nullable&&spec.value===null),"Select an actual "+label+" value.");
  return spec.value;
 }
 exact(spec,["kind","column","values"],label);
 need(spec.kind==="values"&&Number.isSafeInteger(spec.column)&&spec.column>=0&&spec.column<table.columns.length&&object(spec.values),"Select an original column and exact value map for "+label+".");
 need(spec.column<row.cells.length,"Source record "+row.record+" has no "+label+" cell.");
 const value=row.cells[spec.column];need(own(spec.values,value),"Map the exact "+label+" source value "+JSON.stringify(value)+".");
 const mapped=spec.values[value];need(allowed.includes(mapped)||(nullable&&mapped===null),"The selected "+label+" value is unavailable.");return mapped;
}
export function compareRoster(before,after){
 const a=new Map(before.map(r=>[r.key,r])),b=new Map(after.map(r=>[r.key,r]));
 need(a.size===before.length&&b.size===after.length,"Property keys must be distinct.");
 return {added:after.filter(r=>!a.has(r.key)).map(r=>clone(r)),
  removed:before.filter(r=>!b.has(r.key)).map(r=>clone(r)),
  changed:after.filter(r=>a.has(r.key)&&!eq(a.get(r.key),r)).map(r=>({key:r.key,before:clone(a.get(r.key)),after:clone(r)})),
  unchanged:after.filter(r=>a.has(r.key)&&eq(a.get(r.key),r)).map(r=>r.key),
  orderChanged:!eq(before.map(r=>r.key),after.map(r=>r.key))};
}
export function prepareRoster(mapping,value,originalText,originalIdentity){
 exact(mapping,["schema","source","delimiter","headerRow","basis","fields","inspection","template","rows","note"],"mapping");
 need(mapping.schema===SCHEMA,"Use the original property roster mapping.");
 selection(value);need(eq(mapping.basis,value),"The property selection changed. Rebase the mapping explicitly before preparing it.");
 const descriptor=source(mapping.source);
 need(originalIdentity?.filename===descriptor.filename&&originalIdentity.bytes===descriptor.bytes&&originalIdentity.sha256===descriptor.sha256,"Select the complete original CSV that this mapping names.");
 const table=parseRoster(originalText,mapping);
 exact(mapping.fields,FIELDS,"property field mapping");
 need(Array.isArray(mapping.rows)&&mapping.rows.length===table.rows.length,"Give every source record an explicit disposition.");
 text(mapping.note,"Mapping note");
 const properties=[],excluded=[];
 const templates=value.templates.map(r=>r.id);
 for(let i=0;i<table.rows.length;i++){
  const row=table.rows[i],choice=mapping.rows[i];
  exact(choice,["record","action","reason"],"row disposition");
  need(choice.record===row.record&&["INCLUDE","EXCLUDE"].includes(choice.action),"Select INCLUDE or EXCLUDE for original record "+row.record+".");
  text(choice.reason,"Row disposition reason");need(choice.reason.trim(),"Record the inclusion or exclusion reason for source record "+row.record+".");
  if(choice.action==="EXCLUDE"){excluded.push({...clone(row),reason:choice.reason});continue;}
  need(properties.length<50,"The selected full roster exceeds the original 50-property scope.");
  const p=Object.fromEntries(FIELDS.map(k=>[k,projection(mapping.fields[k],row,table,k)]));
  need(p.key.trim()&&p.key.length<=200,"Retain a nonempty original local property key, at most 200 characters.");
  for(const k of FIELDS)need(p[k].length<=(k==="identityNote"?4000:k==="key"?200:500),"Property "+k+" exceeds its native text bound.");
  p.templateId=classified(mapping.template,row,table,templates,"template",true);
  p.inspection=classified(mapping.inspection,row,table,["UNSELECTED","REQUIRED","NOT_REQUIRED"],"inspection");
  p.sourceIds=[descriptor.id];properties.push(p);
 }
 need(properties.length>0,"Select at least one property; all excluded rows remain in the mapping.");
 need(new Set(properties.map(p=>p.key)).size===properties.length,"Duplicate original property keys require explicit source correction; no row is merged automatically.");
 const sourceIds=value.sourceFiles.filter(r=>r.id===descriptor.id||r.filename===descriptor.filename);
 need(sourceIds.every(r=>eq(r,descriptor)),"The selected source ID or filename already identifies different original metadata.");
 const sourceFiles=sourceIds.length?clone(value.sourceFiles):[...clone(value.sourceFiles),descriptor];
 need(sourceFiles.length<=100,"The complete original source inventory exceeds 100 files.");
 need(new Set(sourceFiles.map(r=>r.filename)).size===sourceFiles.length,"Use distinct original source filenames.");
 need(sourceFiles.reduce((n,r)=>n+r.bytes,0)<=24*1024*1024,"The full selected sources exceed 24 MiB.");
 const next={...clone(value),properties,sourceFiles};
 const known=new Set(properties.map(p=>p.key));
 const dangling=(next.examples||[]).flatMap(r=>r.propertyKeys.filter(k=>!known.has(k)).map(k=>({example:r.id,key:k})));
 need(!dangling.length,"The replacement removes properties used by customer examples: "+dangling.map(r=>r.example+" → "+r.key).join(", ")+". Correct those choices deliberately before applying.");
 return {schema:PREVIEW,mapping:clone(mapping),selection:next,comparison:compareRoster(value.properties,properties),table,
  excluded,findings:properties.flatMap(p=>[
   ...(!p.address.trim()||!p.state.trim()||!p.zip.trim()?[{key:p.key,message:"Original address/state/ZIP remains incomplete."}]:[]),
   ...(!p.identityNote.trim()?[{key:p.key,message:"The actual identity or unresolved-match basis remains unrecorded."}]:[]),
   ...(p.inspection==="UNSELECTED"?[{key:p.key,message:"Inspection requirement is unselected."}]:[]),
   ...(p.inspection==="REQUIRED"&&(!p.buyerPropertyId||!p.templateId)?[{key:p.key,message:"Required inspection lacks an actual buyer property or template."}]:[])
  ]),
  meaning:"Source preparation only. Exact supplied text is retained; no vendor identity match, approval, inspection or native save is established."};
}
export function applyRoster(preview,current,mapping,originalIdentity,originalText){
 need(preview?.schema===PREVIEW&&eq(preview.mapping,mapping)&&eq(mapping.basis,current),"Reprepare the complete roster against these exact original choices.");
 need(originalIdentity?.sha256===mapping.source.sha256&&originalIdentity.bytes===mapping.source.bytes&&originalIdentity.filename===mapping.source.filename,"The selected original source changed.");
 const recomputed=prepareRoster(mapping,current,originalText,originalIdentity);
 need(eq(recomputed,preview),"The reviewed projection differs from its complete source and choices.");
 return clone(recomputed.selection);
}
export function rebaseMapping(mapping,current){
 selection(current);need(mapping?.schema===SCHEMA,"Use the complete original mapping.");
 return {...clone(mapping),basis:clone(current)};
}
