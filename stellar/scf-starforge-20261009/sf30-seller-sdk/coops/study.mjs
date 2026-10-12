// MIT. Versioned coastal studies select existing source editions without changing their physical basis.
import {stable,jsonBytes} from '../stellar-expert/store.mjs';
import {fault,text,hashBytes} from './provider.mjs';
import {rowSelection,iterateEditionRows} from './domain.mjs';
import {mappingValue} from './exports.mjs';
export const STUDY_SCHEMA='stellar-forge.coops-coastal-study.v1';
export const STUDY_LIMITS=Object.freeze({members:64,stations:5,years:5,returnBytes:1024*1024*1024,chunkBytes:1024*1024,previewRows:500});
export const STUDY_REQUIRED_COLUMNS=['editionId','recordId','sourcePageSha256','sourceRecord','stationId','product','timestamp','timeZone','datum','units','unit','value','valueType','quality','flags'];
export const studyDigest=value=>hashBytes(Buffer.from(stable(value)));
const SHA=/^[a-f0-9]{64}$/,ID=/^[a-z0-9-]{8,100}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function exact(value,keys,label){if(!plain(value)||Object.keys(value).some(k=>!keys.includes(k)))throw fault('COOPS_STUDY_INPUT','Use the declared '+label+' fields.');}
export function studyInput(input){
 exact(input,['studyId','expectedStudyRevision','expectedPreviewSha256','name','project','question','owner','table','mappingId','basisPolicy','members','note'],'study');
 const result={name:text(input.name,'a study name',200),project:text(input.project??'','the actual project reference',500,true),
  question:text(input.question,'the receiving engineering question',6000),owner:text(input.owner,'the responsible study team',300),
  table:input.table,mappingId:input.mappingId,basisPolicy:input.basisPolicy??'uniform_requests',
  note:text(input.note??'','the study selection note',12000,true)};
 if(!['observations','predictions'].includes(result.table))throw fault('COOPS_STUDY_TABLE','Keep observations and predictions in separate model-input studies.');
 if(typeof result.mappingId!=='string'||!/^mapping-[a-f0-9]{24}$/.test(result.mappingId))throw fault('COOPS_STUDY_MAPPING','Choose a saved receiving mapping for this study.');
 if(!['uniform_requests','mixed_native'].includes(result.basisPolicy))throw fault('COOPS_STUDY_BASIS','Choose uniform requests or explicitly separated native bases.');
 if(!Array.isArray(input.members)||input.members.length<1||input.members.length>STUDY_LIMITS.members)throw fault('COOPS_STUDY_MEMBERS','Select one to 64 exact source-edition windows.');
 result.members=input.members.map(m=>{
  exact(m,['editionId','beginDate','endDate','products'],'source member');
  if(!SHA.test(m.editionId??''))throw fault('COOPS_STUDY_EDITION','Choose an exact retained edition ID.');
  return {editionId:m.editionId,...(m.beginDate?{beginDate:m.beginDate}:{}),...(m.endDate?{endDate:m.endDate}:{}),...(m.products?{products:m.products}:{})};
 });
 if(input.studyId!==undefined&&(!ID.test(input.studyId)||!input.studyId.startsWith('study-')))throw fault('COOPS_STUDY_ID','Use the original saved study identity.');
 if(input.studyId!==undefined&&(!Number.isSafeInteger(input.expectedStudyRevision)||input.expectedStudyRevision<1))throw fault('COOPS_STUDY_REVISION','Keep the exact study revision opened by the operator.');
 if(input.studyId===undefined&&input.expectedStudyRevision!==undefined)throw fault('COOPS_STUDY_REVISION','A new study has no preceding saved revision.');
 return result;
}
export function findStudy(state,id,revision){
 const current=(state.studies??[]).find(s=>s.id===id);
 const found=revision===undefined?current:[current,...(current?.history??[])].find(s=>s?.revision===revision);
 if(!found)throw fault('COOPS_STUDY_SELECTION','Choose an exact retained study revision.',404);
 return found;
}
export async function prepareStudy(store,input,{mapping,annotations=[]}={}){
 const value=studyInput(input);
 if(!mapping||mapping.id!==value.mappingId)throw fault('COOPS_STUDY_MAPPING_PIN','The original selected mapping revision must be retained before preparation.',409);
 const normal=mappingValue(mapping),fields=new Set(normal.columns.map(c=>c.source));
 if(mapping.table!==value.table)throw fault('COOPS_STUDY_MAPPING','Choose a mapping for the selected observation or prediction table.');
 for(const field of STUDY_REQUIRED_COLUMNS)if(!fields.has(field))throw fault('COOPS_STUDY_PROVENANCE','The study mapping must retain '+field+'. Review the mapping before preparing this study.');
 const members=[],editions=new Map(),sources=new Map(),warnings=[],errors=[],seen=new Set(),stations=new Set(),bases=new Set();
 const warn=(code,message,memberIds=[])=>warnings.push({id:studyDigest({code,memberIds}).slice(0,24),code,message,memberIds});
 for(let index=0;index<value.members.length;index++){
  const selected=value.members[index],edition=await store.edition(selected.editionId);
  if(edition.id!==selected.editionId||edition.schema!=='stellar-forge.coops-edition.v1')throw fault('COOPS_STUDY_SOURCE','The selected retained source edition changed.',409);
  const products=selected.products??edition.query.products.filter(p=>value.table==='predictions'?p==='predictions':p!=='predictions');
  const selection=rowSelection(edition,{...selected,products,table:value.table});
  if(selection.products.some(p=>value.table==='predictions'?p!=='predictions':p==='predictions'))throw fault('COOPS_STUDY_PRODUCT','Select only products from this study’s separate table.');
  const memberId='member-'+studyDigest({editionId:edition.id,selection}).slice(0,24);
  if(seen.has(memberId))throw fault('COOPS_STUDY_DUPLICATE','The same exact source window was selected twice.');
  seen.add(memberId);stations.add(edition.query.stationId);
  const basis={units:edition.query.units,timeZone:edition.query.timeZone,datum:edition.query.datum,
    predictionInterval:value.table==='predictions'?edition.query.predictionInterval:null};
  bases.add(stable(basis));
  const relevant=edition.coverage.filter(t=>t.kind==='metadata'||selection.products.includes(t.product)&&(!t.beginDate||t.beginDate<=selection.endDate)&&(!t.endDate||t.endDate>=selection.beginDate));
  const sourceComplete=relevant.every(t=>['COMPLETE','UNAVAILABLE'].includes(t.state));
  const member={id:memberId,index,editionId:edition.id,editionSha256:hashBytes(jsonBytes(edition)),sourceSha256:edition.sourceSha256,
   stationId:edition.query.stationId,stationName:edition.stationMetadata?.name??edition.profile.label,profile:edition.profile,
   selection,basis,sourceComplete,originalEditionComplete:edition.complete,
   unavailableRequests:relevant.filter(t=>t.state==='UNAVAILABLE').map(t=>({id:t.id,resource:t.resource??null,product:t.product??null,reason:t.reason??null})),
   unfinishedRequests:relevant.filter(t=>!['COMPLETE','UNAVAILABLE'].includes(t.state)).map(t=>({id:t.id,state:t.state,url:t.url,error:t.error??null})),
   stationMetadata:edition.stationMetadata,metadataUnavailable:edition.metadataUnavailable,
   originalCoverage:edition.summary,coverageScope:'Original coverage describes the complete source edition. The released row totals describe only this member’s selected window.'};
  members.push(member);editions.set(edition.id,edition);
  for(const receipt of [...edition.pages,...(edition.failedResponses??[])]){
   if(!SHA.test(receipt.sha256??'')||!Number.isSafeInteger(receipt.bytes)||receipt.bytes<0)throw fault('COOPS_STUDY_SOURCE','An original response receipt is incomplete.',409);
   const prior=sources.get(receipt.sha256);if(prior&&prior.bytes!==receipt.bytes)throw fault('COOPS_STUDY_SOURCE','One source hash has contradictory byte counts.',409);
   sources.set(receipt.sha256,{sha256:receipt.sha256,bytes:receipt.bytes});
  }
  if(!sourceComplete)warn('unfinished_source','This window retains unfinished original source requests. A release cannot imply complete observations.',[memberId]);
  if(member.unavailableRequests.length)warn('unavailable_source','Some selected data or shared station metadata was unavailable; exact outcomes and original bodies remain in the source package.',[memberId]);
  if(edition.query.timeZone!=='gmt')warn('native_local_time','Local source timestamps retain their declared basis. No UTC or daylight-time conversion is inferred.',[memberId]);
  if(member.metadataUnavailable?.length)warn('missing_station_context','Some advertised station or datum resources are unavailable. Review the retained original station evidence.',[memberId]);
 }
 if(stations.size>STUDY_LIMITS.stations)throw fault('COOPS_STUDY_STATIONS','Select at most five distinct station IDs in one receiving study.');
 const first=members.map(m=>m.selection.beginDate).sort()[0],last=members.map(m=>m.selection.endDate).sort().at(-1);
 const ceiling=new Date(first+'T00:00:00Z');ceiling.setUTCFullYear(ceiling.getUTCFullYear()+STUDY_LIMITS.years);
 if(last>=ceiling.toISOString().slice(0,10))throw fault('COOPS_STUDY_YEARS','Keep one study within five calendar years; retain a separate study for the next period.');
 if(stations.size>1)warn('station_vertical_reference','The same named tidal datum at different stations is not proof of a common physical vertical reference. Values remain station-specific; no cross-station subtraction or vertical conversion is supplied.',members.map(m=>m.id));
 if(bases.size>1){
  if(value.basisPolicy==='uniform_requests')errors.push({code:'mixed_request_basis',message:'Selected units, time bases, datum labels or prediction intervals differ. Select matching requests or explicitly retain mixed native bases.'});
  else warn('mixed_native_basis','This long-form delivery contains different native bases. Its station/product/datum/unit/time columns must accompany every value.',members.map(m=>m.id));
 }
 const overlaps=[];
 for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++){
  const a=members[i],b=members[j],products=a.selection.products.filter(p=>b.selection.products.includes(p));
  if(a.stationId===b.stationId&&stable(a.basis)===stable(b.basis)&&products.length&&a.selection.beginDate<=b.selection.endDate&&b.selection.beginDate<=a.selection.endDate)
   overlaps.push({left:a.id,right:b.id,stationId:a.stationId,products,beginDate:a.selection.beginDate>b.selection.beginDate?a.selection.beginDate:b.selection.beginDate,endDate:a.selection.endDate<b.selection.endDate?a.selection.endDate:b.selection.endDate});
 }
 if(overlaps.length)errors.push({code:'overlapping_source_windows',message:'Two selected members cover the same station, product, native basis and date. Narrow their windows or select one edition; no duplicate source is discarded automatically.',overlaps});
 const sourceBytes=[...sources.values()].reduce((n,x)=>n+x.bytes,0);
 if(sourceBytes>STUDY_LIMITS.returnBytes)errors.push({code:'source_package_capacity',message:'Original response bodies alone exceed the 1 GiB delivery-file limit. Choose a narrower set of complete source editions.'});
 const selection={schema:STUDY_SCHEMA,...value,members,mapping:structuredClone(mapping),
  annotations:structuredClone(annotations.filter(a=>editions.has(a.editionId))),
  source:{editionIds:[...editions.keys()],responseCount:sources.size,responseBytes:sourceBytes,stationIds:[...stations],beginDate:first,endDate:last},
  warnings,errors,method:'Ordered original rows in explicit nonoverlapping member windows; values, flags, precision, station-specific datum and time basis remain unchanged. No resampling, interpolation or datum conversion.'};
 const sha256=studyDigest(selection);
 return {schema:'stellar-forge.coops-study-preview.v1',valid:errors.length===0,sha256,selection,warnings,errors};
}
export function studySaveRecord(prior,id,prepared,createdAt){
 if(!prepared.valid)throw fault('COOPS_STUDY_REVIEW','Resolve the listed study selection errors before saving.',422,{errors:prepared.errors});
 return {id,revision:(prior?.revision??0)+1,sha256:prepared.sha256,selection:prepared.selection,
  createdAt:prior?.createdAt??createdAt,updatedAt:createdAt,history:prior?[...(prior.history??[]),Object.fromEntries(Object.entries(prior).filter(([k])=>k!=='history'))]:[]};
}
export async function studyEditions(store,study){
 const found=new Map();
 for(const member of study.selection.members){
  if(found.has(member.editionId))continue;
  const edition=await store.edition(member.editionId);
  if(hashBytes(jsonBytes(edition))!==member.editionSha256||edition.sourceSha256!==member.sourceSha256)throw fault('COOPS_STUDY_SOURCE_CHANGED','The selected immutable source edition changed.',409);
  found.set(edition.id,edition);
 }
 return found;
}
export async function* iterateStudyRows(store,study){
 const editions=await studyEditions(store,study);
 for(const member of study.selection.members)for await(const row of iterateEditionRows(store,editions.get(member.editionId),member.selection))yield{memberId:member.id,row};
}
export async function studyRows(store,study,{offset=0,limit=100}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>STUDY_LIMITS.previewRows)throw fault('COOPS_STUDY_ROWS','Use a nonnegative offset and one to 500 rows.');
 const rows=[];let seen=0,more=false;
 for await(const item of iterateStudyRows(store,study)){
  if(seen++<offset)continue;
  if(rows.length===limit){more=true;break;}rows.push(item);
 }
 return {schema:'stellar-forge.coops-study-rows.v1',studyId:study.id??null,revision:study.revision??null,sha256:study.sha256,offset,limit,rows,nextOffset:more?offset+rows.length:null,
  note:'Original member order and response order; rows are not globally time-sorted or resampled.'};
}
export function studyReview(study,input,id,createdAt){
 if(study.revision!==input.studyRevision||study.sha256!==input.studySha256)throw fault('COOPS_STUDY_REVISION','Review the exact selected study revision and digest.',409);
 if(!['reviewed','follow_up'].includes(input.status))throw fault('COOPS_STUDY_REVIEW','Choose reviewed or follow_up.');
 const acknowledged=input.acknowledgedWarnings;
 if(!Array.isArray(acknowledged)||new Set(acknowledged).size!==acknowledged.length||acknowledged.some(id=>!study.selection.warnings.some(w=>w.id===id)))throw fault('COOPS_STUDY_REVIEW','Select only warning IDs from this exact study.');
 if(input.status==='reviewed'&&study.selection.warnings.some(w=>!acknowledged.includes(w.id)))throw fault('COOPS_STUDY_REVIEW','Record each original basis/coverage warning before marking this study reviewed.');
 return{id,studyId:study.id,studyRevision:study.revision,studySha256:study.sha256,status:input.status,
  actor:text(input.actor,'the actual reviewing operator',200),note:text(input.note,'the study review note',12000),acknowledgedWarnings:[...acknowledged],createdAt};
}
export function selectedStudyReview(state,study,id){
 const matching=(state.studyReviews??[]).filter(r=>r.studyId===study.id&&r.studyRevision===study.revision&&r.studySha256===study.sha256),review=matching.find(r=>r.id===id);
 if(matching.at(-1)?.id!==id)throw fault('COOPS_STUDY_REVIEW_CHANGED','A later decision exists for this study revision. Review its current decision before preparing another delivery.',409);
 if(!review||review.status!=='reviewed'||review.studyId!==study.id||review.studyRevision!==study.revision||review.studySha256!==study.sha256)throw fault('COOPS_STUDY_REVIEW','Choose a retained reviewed decision for the exact study revision.',409);
 return review;
}
