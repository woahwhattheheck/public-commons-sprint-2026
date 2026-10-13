// MIT. Source-bound CASE 1.1 inspection and edition comparison.
import {readExactJSON} from './source-json.mjs';
export const CASE_SOURCE_SCHEMA='commons.case-source.v1';
export const CASE_REVIEW_SCHEMA='commons.case-edition-review.v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TYPES=new Set(['isChildOf','isPeerOf','isPartOf','exactMatchOf','precedes','isRelatedTo','replacedBy','exemplar','hasSkillLevel','isTranslationOf']);
const own=(o,k)=>Object.hasOwn(o,k);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=(m)=>{throw Object.assign(Error(m),{code:'CASE_SOURCE_INVALID'});};
const esc=s=>s.replace(/~/g,'~0').replace(/\//g,'~1');
const pointer=(o,p)=>p===''?o:p.slice(1).split('/').reduce((v,k)=>v?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],o);
const str=(v,l,n=8192)=>{if(typeof v!=='string'||!v.trim()||v.length>n)fail(l+' must be nonempty text within '+n+' characters.');return v;};
const scalar=(v,e)=>typeof v==='number'?['number',e.number,e.exponent]:Array.isArray(v)?['array',v.map((x,i)=>scalar(x,e[i]))]:plain(v)?['object',Object.keys(v).sort().map(k=>[k,scalar(v[k],e[k])])]:[typeof v,v];
const same=(a,ae,b,be)=>JSON.stringify(scalar(a,ae))===JSON.stringify(scalar(b,be));
const date=v=>{
 if(typeof v!=='string')return false;
 const m=v.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|([+-])(\d\d):(\d\d))$/);
 if(!m)return false;const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number),days=[31,(y%4===0&&(y%100!==0||y%400===0))?29:28,31,30,31,30,31,31,30,31,30,31];
 return mo>=1&&mo<=12&&d>=1&&d<=days[mo-1]&&h<24&&mi<60&&s<60&&(!m[7]||Number(m[8])<24&&Number(m[9])<60)&&Number.isFinite(Date.parse(v));
};
function field(v,e,present=true){return !present?{present:false}:typeof v==='number'?{present:true,type:'number',coefficient:e.number,exponent:e.exponent,display:e.number+'e'+e.exponent}:{present:true,type:Array.isArray(v)?'array':v===null?'null':typeof v,display:typeof v==='string'?v:JSON.stringify(scalar(v,e))};}
function reference(link,p,role,ids,uris,expectedKinds=null,general=false){
 if(!plain(link)||typeof link.identifier!=='string'||typeof link.uri!=='string'||typeof link.title!=='string')return {pointer:p,role,state:'MALFORMED_REFERENCE',original:link??null};
 const targetType=own(link,'targetType')?link.targetType:'CASE';
 if(own(link,'targetType')&&(!general||typeof targetType!=='string'||targetType!=='CASE'&&!/^ext:[a-zA-Z0-9.\-_]+$/.test(targetType)))return {pointer:p,role,state:'MALFORMED_REFERENCE',original:link,reason:'Unsupported explicit targetType.'};
 if(!general&&!UUID.test(link.identifier))return {pointer:p,role,state:'MALFORMED_REFERENCE',original:link,reason:'Typed CASE link identifier is not a UUID.'};
 if(targetType!=='CASE')return {pointer:p,role,state:'EXTERNAL_DECLARED',targetType,identifier:link.identifier,uri:link.uri,title:link.title};
 const a=ids.get(link.identifier),b=uris.get(link.uri);
 if(a&&b&&a.key===b.key)return {pointer:p,role,state:expectedKinds&&!expectedKinds.includes(a.kind)?'LOCAL_KIND_CONFLICT':'LOCAL_RESOLVED',targetType,identifier:link.identifier,uri:link.uri,title:link.title,targetKey:a.key,targetKind:a.kind};
 if(a||b)return {pointer:p,role,state:'LOCAL_IDENTITY_CONFLICT',targetType,identifier:link.identifier,uri:link.uri,title:link.title,byIdentifier:a?.key??null,byURI:b?.key??null};
 return {pointer:p,role,state:'EXTERNAL_NOT_LOADED',targetType,identifier:link.identifier,uri:link.uri,title:link.title};
}
export async function sourceIdentity(text,hash){
 if(typeof text!=='string')fail('Complete source text is required.');
 const bytes=new TextEncoder().encode(text);
 if(bytes.length>1024*1024)fail('Each original CASE package is limited to 1 MiB.');
 return {bytes:bytes.length,sha256:await hash(bytes)};
}
export async function inspectCASESource(source,{hash}){
 if(!plain(source)||!plain(source.origin))fail('Source and its explicit origin are required.');
 str(source.origin.label,'Source label',256);str(source.origin.locator,'Source locator',8192);
 const identity=await sourceIdentity(source.text,hash);
 if(source.bytes!==undefined&&source.bytes!==identity.bytes||source.sha256!==undefined&&source.sha256!==identity.sha256)fail('Original source bytes do not match the supplied identity.');
 const {value,exact}=readExactJSON(source.text);
 if(!plain(value)||!plain(value.CFDocument))fail('A complete CFPackage with one CFDocument object is required.');
 const issues=[],records=[],ids=new Map(),uris=new Map();
 function issue(code,p,message){issues.push({code,pointer:p,message});}
 function add(entry,p,kind,required){
  if(!plain(entry))fail(p+' must be an object.');
  for(const k of required)if(!own(entry,k)||typeof entry[k]!=='string')issue('REQUIRED_FIELD',p+'/'+k,'CASE field must be present with string type.');
  if(typeof entry.identifier!=='string'||!UUID.test(entry.identifier))fail(p+'/identifier must be an exact CASE UUID. Original bytes remain in the selected source.');
  if(typeof entry.uri!=='string'||!entry.uri.length)fail(p+'/uri must be a nonempty original URI.');
  try{new URL(entry.uri);}catch{issue('URI_FORMAT',p+'/uri','URI is not an absolute URI.');}
  if(!date(entry.lastChangeDateTime))issue('TIMESTAMP_FORMAT',p+'/lastChangeDateTime','Original timestamp does not match the supported explicit-offset datetime form.');
  const key=kind+':'+entry.identifier;
  if(ids.has(entry.identifier))fail('Repeated original identifier '+entry.identifier+' at '+p+' and '+ids.get(entry.identifier).pointer+'.');
  if(uris.has(entry.uri))fail('Repeated original URI '+entry.uri+' at '+p+' and '+uris.get(entry.uri).pointer+'.');
  const row={key,kind,identifier:entry.identifier,uri:entry.uri,pointer:p,title:entry.title??entry.fullStatement??entry.description??entry.identifier,lastChangeDateTime:entry.lastChangeDateTime??null};
  ids.set(entry.identifier,row);uris.set(entry.uri,row);records.push(row);return row;
 }
 const list=(owner,k,p)=>{if(!own(owner,k))return[];if(!Array.isArray(owner[k]))fail(p+'/'+k+' must be an array when present.');return owner[k];};
 add(value.CFDocument,'/CFDocument','CFDocument',['identifier','uri','creator','title','lastChangeDateTime']);
 if(value.CFDocument.caseVersion!==undefined&&value.CFDocument.caseVersion!=='1.1')issue('DECLARED_CASE_VERSION','/CFDocument/caseVersion','Selected CASE consumer is 1.1; source declares another edition.');
 if(list(value,'CFItems','').length>5000||list(value,'CFAssociations','').length>8000)fail('Selected source exceeds 5,000 items or 8,000 associations.');
 list(value,'CFItems','').forEach((v,i)=>add(v,'/CFItems/'+i,'CFItem',['identifier','uri','fullStatement','lastChangeDateTime']));
 list(value,'CFAssociations','').forEach((v,i)=>add(v,'/CFAssociations/'+i,'CFAssociation',['identifier','uri','associationType','lastChangeDateTime']));
 const definitions=value.CFDefinitions??{};
 if(!plain(definitions))fail('CFDefinitions must be an object when present.');
 const definitionKinds={CFConcepts:['CFConcept','title','hierarchyCode'],CFSubjects:['CFSubject','title','hierarchyCode'],CFLicenses:['CFLicense','title','licenseText'],CFItemTypes:['CFItemType','title','description','hierarchyCode'],CFAssociationGroupings:['CFAssociationGrouping','title']};
 for(const [name,[kind,...required]]of Object.entries(definitionKinds))list(definitions,name,'/CFDefinitions').forEach((v,i)=>add(v,'/CFDefinitions/'+name+'/'+i,kind,['identifier','uri','lastChangeDateTime',...required]));
 list(value,'CFRubrics','').forEach((v,i)=>{
  const p='/CFRubrics/'+i;add(v,p,'CFRubric',['identifier','uri','lastChangeDateTime']);
  list(v,'CFRubricCriteria',p).forEach((c,j)=>{
   const cp=p+'/CFRubricCriteria/'+j;add(c,cp,'CFRubricCriterion',['identifier','uri','lastChangeDateTime']);
   if(c.rubricId!==undefined&&c.rubricId!==v.identifier)issue('PARENT_ID_CONFLICT',cp+'/rubricId','Criterion parent ID differs from its containing rubric.');
   list(c,'CFRubricCriterionLevels',cp).forEach((l,k)=>{
    const lp=cp+'/CFRubricCriterionLevels/'+k;add(l,lp,'CFRubricCriterionLevel',['identifier','uri','lastChangeDateTime']);
    if(l.rubricCriterionId!==undefined&&l.rubricCriterionId!==c.identifier)issue('PARENT_ID_CONFLICT',lp+'/rubricCriterionId','Level parent ID differs from its containing criterion.');
   });
  });
 });
 const references=[],associations=[];
 for(const row of records){
  const entry=pointer(value,row.pointer);
  const referenceKinds={subjectURI:['CFSubject'],conceptKeywordsURI:['CFConcept'],CFItemTypeURI:['CFItemType'],licenseURI:['CFLicense'],CFItemURI:['CFItem'],CFAssociationGroupingURI:['CFAssociationGrouping']};
  for(const name of Object.keys(referenceKinds)){
   if(!own(entry,name))continue;
   const vals=Array.isArray(entry[name])?entry[name]:[entry[name]];
   vals.forEach((v,i)=>references.push({...reference(v,row.pointer+'/'+name+(Array.isArray(entry[name])?'/'+i:''),name,ids,uris,referenceKinds[name]),ownerKey:row.key}));
  }
  if(row.kind==='CFAssociation'){
   if(!TYPES.has(entry.associationType)&&!(typeof entry.associationType==='string'&&/^ext:[a-zA-Z0-9.\-_]+$/.test(entry.associationType)))issue('ASSOCIATION_TYPE',row.pointer+'/associationType','Association type is not in the selected CASE 1.1 vocabulary or ext: form.');
   const origin=reference(entry.originNodeURI,row.pointer+'/originNodeURI','origin',ids,uris,['CFDocument','CFItem'],true),destination=reference(entry.destinationNodeURI,row.pointer+'/destinationNodeURI','destination',ids,uris,['CFDocument','CFItem'],true);
   references.push({...origin,ownerKey:row.key},{...destination,ownerKey:row.key});
   let sequence=null;
   if(own(entry,'sequenceNumber')){
    const number=pointer(exact,row.pointer+'/sequenceNumber');
    sequence=field(entry.sequenceNumber,number);
    if(typeof entry.sequenceNumber!=='number'||!number||BigInt(number.exponent)<0n||BigInt(number.exponent)>10n)issue('SEQUENCE_INT32',row.pointer+'/sequenceNumber','Sequence must be an exact int32.');
    else {const n=BigInt(number.number)*10n**BigInt(number.exponent);if(n< -2147483648n||n>2147483647n)issue('SEQUENCE_INT32',row.pointer+'/sequenceNumber','Sequence is outside int32.');}
   }
   associations.push({...row,type:entry.associationType,sequence,origin,destination});
  }
 }
 for(const r of references)if(['MALFORMED_REFERENCE','LOCAL_IDENTITY_CONFLICT','LOCAL_KIND_CONFLICT'].includes(r.state))issue(r.state,r.pointer,'Reference does not agree with the selected original local identity.');
 const edges=new Map();
 for(const a of associations)if(a.type==='isChildOf'&&a.origin.state==='LOCAL_RESOLVED'&&a.destination.state==='LOCAL_RESOLVED'){
  if(!edges.has(a.origin.targetKey))edges.set(a.origin.targetKey,[]);
  edges.get(a.origin.targetKey).push({to:a.destination.targetKey,association:a.key});
 }
 const done=new Set(),active=new Set(),cycles=new Set();
 function visit(k,trail){if(active.has(k)){const i=trail.indexOf(k);cycles.add(JSON.stringify(trail.slice(i).concat(k)));return;}if(done.has(k))return;active.add(k);for(const e of edges.get(k)??[])visit(e.to,trail.concat(k));active.delete(k);done.add(k);}
 for(const k of edges.keys())visit(k,[]);
 for(const c of cycles)issue('LOCAL_HIERARCHY_CYCLE','/CFAssociations','Selected isChildOf graph contains cycle '+JSON.parse(c).join(' → '));
 if(!value.CFItems?.length)issue('EMPTY_ITEM_COLLECTION','/CFItems','No items are present in this source. The published machine schema permits this; assess whether the selected edition is complete for its intended use.');
 const recognized=['CFDocument','CFItems','CFAssociations','CFDefinitions','CFRubrics','extensions'];
 for(const k of Object.keys(value))if(!recognized.includes(k))issue('UNRECOGNIZED_ROOT_FIELD','/'+esc(k),'Field retained unchanged; not interpreted by this consumer.');
 return {schema:CASE_SOURCE_SCHEMA,source:{origin:structuredClone(source.origin),...identity,text:source.text},document:{identifier:value.CFDocument.identifier,uri:value.CFDocument.uri,title:value.CFDocument.title??'',version:value.CFDocument.version??null,lastChangeDateTime:value.CFDocument.lastChangeDateTime??null,caseVersion:value.CFDocument.caseVersion??null},records,associations,references,issues,counts:{records:records.length,items:value.CFItems?.length??0,associations:associations.length,externalReferences:references.filter(v=>v.state.startsWith('EXTERNAL')).length},coverage:{collections:Object.fromEntries(recognized.map(k=>[k,own(value,k)?'PRESENT':'ABSENT'])),scope:'One complete selected CFPackage response or file; external referenced objects are not fetched.',validation:'Source identity and graph inspection; not 1EdTech certification or full schema conformance.'}};
}
function changes(a,ae,b,be){
 const result=[];for(const k of [...new Set([...Object.keys(a??{}),...Object.keys(b??{})])].sort()){
  const ap=!!a&&own(a,k),bp=!!b&&own(b,k);
  if(ap&&bp&&same(a[k],ae[k],b[k],be[k]))continue;
  result.push({field:k,before:field(a?.[k],ae?.[k],ap),after:field(b?.[k],be?.[k],bp)});
 }return result;
}
export async function compareCASEEditions(beforeSource,afterSource,{hash}){
 const before=await inspectCASESource(beforeSource,{hash}),after=await inspectCASESource(afterSource,{hash});
 if(before.document.identifier!==after.document.identifier)fail('Select two editions of the same original CFDocument identifier. Cross-framework alignment is a separate authored association, not an edition match.');
 const a=readExactJSON(beforeSource.text),b=readExactJSON(afterSource.text),am=new Map(before.records.map(r=>[r.key,r])),bm=new Map(after.records.map(r=>[r.key,r]));
 const rows=[];
 for(const key of [...new Set([...am.keys(),...bm.keys()])].sort()){
  const ar=am.get(key),br=bm.get(key),av=ar?pointer(a.value,ar.pointer):null,bv=br?pointer(b.value,br.pointer):null,ae=ar?pointer(a.exact,ar.pointer):null,be=br?pointer(b.exact,br.pointer):null;
  const diff=changes(av,ae,bv,be);
  rows.push({key,kind:(br??ar).kind,identifier:(br??ar).identifier,title:(br??ar).title,state:!ar?'ADDED':!br?'REMOVED':diff.length?'CHANGED':'UNCHANGED',before:ar??null,after:br??null,changes:diff});
 }
 const aTop={...a.value},bTop={...b.value},aExact={...a.exact},bExact={...b.exact};
 // Full root fields remain in an explicit package row; collection order and unknown extensions are not discarded.
 const packageChanges=changes(aTop,aExact,bTop,bExact);
 rows.push({key:'CFPackage:'+before.document.identifier,kind:'CFPackage',identifier:before.document.identifier,title:'Complete package fields and collection order',state:packageChanges.length?'CHANGED':'UNCHANGED',before:{pointer:''},after:{pointer:''},changes:packageChanges});
 const basis={before:{bytes:before.source.bytes,sha256:before.source.sha256},after:{bytes:after.source.bytes,sha256:after.source.sha256},documentId:before.document.identifier};
 const basisSha256=await hash(new TextEncoder().encode(JSON.stringify(basis)));
 return {schema:CASE_REVIEW_SCHEMA,basis,basisSha256,before,after,rows,summary:Object.fromEntries(['ADDED','REMOVED','CHANGED','UNCHANGED'].map(k=>[k,rows.filter(v=>v.state===k).length])),method:{matching:'Original kind + UUID. Changed UUIDs are removal/addition. No inferred equivalence.',numbers:'Lossless coefficient/exponent comparison with original numeric types; full original text retained.',references:'External references remain external/not loaded. Only contradictory observed local identity is a local conflict.',order:'Original arrays and package collection order remain comparison inputs.',acceptance:'Observed changes and supplied reviewer choices are separate; choices do not alter publisher source.'}};
}
export function applyCASEReview(report,input){
 if(report?.schema!==CASE_REVIEW_SCHEMA||!plain(input)||input.basisSha256!==report.basisSha256)fail('Review must name the exact two-source comparison.');
 str(input.reviewer,'Reviewer',256);if(typeof input.notes!=='string'||input.notes.length>20000)fail('Review notes must be text up to 20,000 characters.');
 if(!plain(input.decisions))fail('Review decisions must be an object.');
 const rows=new Map(report.rows.map(r=>[r.key,r])),decisions={};
 for(const [key,entry]of Object.entries(input.decisions)){
  if(!rows.has(key)||!plain(entry)||!['ACCEPT','INVESTIGATE','DEFER'].includes(entry.choice)||typeof entry.note!=='string'||entry.note.length>10000)fail('Invalid review decision '+key+'.');
  decisions[key]={choice:entry.choice,note:entry.note};
 }
 return {basisSha256:report.basisSha256,reviewer:input.reviewer,notes:input.notes,decisions,openRows:report.rows.filter(r=>r.state!=='UNCHANGED'&&decisions[r.key]?.choice!=='ACCEPT').map(r=>r.key),attribution:'Reviewer name is supplied text, not an authenticated signature.'};
}
export async function createCASEDelivery({before,after,review},{hash}){
 const report=await compareCASEEditions(before,after,{hash}),decisions=applyCASEReview(report,review);
 return {schema:'commons.case-edition-delivery.v1',before:report.before.source,after:report.after.source,report,review:decisions};
}
export async function inspectCASEDelivery(delivery,{hash}){
 if(delivery?.schema!=='commons.case-edition-delivery.v1')fail('Unsupported delivery schema.');
 const actual=await createCASEDelivery(delivery,{hash});
 if(JSON.stringify(actual)!==JSON.stringify(delivery))fail('Delivery does not reproduce from its complete original sources and review.');
 return actual;
}
export function caseChangeCSV(report,review=null){
 const quote=v=>'"'+String(v??'').replace(/^[\s]*[=+@-]/u,m=>"'"+m).replace(/"/g,'""')+'"';
 const rows=[['kind','identifier','state','title','changed_fields','review_choice','review_note','before_sha256','after_sha256'],...report.rows.map(r=>[r.kind,r.identifier,r.state,r.title,r.changes.map(c=>c.field).join(';'),review?.decisions?.[r.key]?.choice??'',review?.decisions?.[r.key]?.note??'',report.before.source.sha256,report.after.source.sha256])];
 return rows.map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
}
