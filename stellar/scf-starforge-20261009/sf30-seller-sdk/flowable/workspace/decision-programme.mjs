// MIT. Original DMN source and typed reference cases compiled to saved native programmes.
import {validateFlowableProgramme,FLOWABLE_PROGRAMME_SCHEMA} from './programme-core.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_DECISION_PROGRAMME_INVALID'});};
const key=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const text=(value,max=2000)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
function utf8(text){
 const encoded=encodeURIComponent(text),bytes=[];
 for(let i=0;i<encoded.length;i++){if(encoded[i]==='%'){bytes.push(parseInt(encoded.slice(i+1,i+3),16));i+=2;}else bytes.push(encoded.charCodeAt(i));}
 return bytes;
}
function base64(bytes){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let out='';
 for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2],n=(a<<16)|((b??0)<<8)|(c??0);
 out+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63]+(b===undefined?'=':alphabet[(n>>>6)&63])+(c===undefined?'=':alphabet[n&63]);}
 return out;
}
function variable(value){
 need(plain(value)&&Object.keys(value).every(k=>['name','type','value'].includes(k))&&text(value.name,300),'Retain named native input variables.');
 const v=value.value,t=value.type;
 if(t==='bigDecimal')need(typeof v==='string'&&v.length<=2048&&/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(v),'Use an exact plain decimal string for bigDecimal.');
 else if(t==='bigInteger')need(typeof v==='string'&&v.length<=2048&&/^-?(?:0|[1-9][0-9]*)$/.test(v),'Use an exact decimal integer string for bigInteger.');
 else if(t==='integer')need(Number.isInteger(v)&&v>=-2147483648&&v<=2147483647,'Use a signed 32-bit native integer.');
 else if(t==='long')need(Number.isSafeInteger(v),'Use safe numeric long values in this catalogue; use bigInteger strings for larger exact inputs.');
 else if(t==='boolean')need(typeof v==='boolean','Use a native boolean.');
 else if(t==='string')need(typeof v==='string'&&v.length<=100000,'Use complete native string input.');
 else need(false,'This typed reference compiler accepts string, boolean, integer, safe long, bigInteger and bigDecimal. Other native types remain available in the original decision review.');
}
/**
 * A source edition is a catalogue identity, not a fabricated native version selector.
 * Standalone DMN uploads and evaluations keep the original key/tenant latest-definition semantics.
 * Inspect the prepared native source before dispatch; the original workspace preserves its preimage.
 */
export function describeFlowableDecisionProgramme({catalogText,members,operation,tenantId,familyKeys}){
 need(typeof catalogText==='string'&&utf8(catalogText).length<=1024*1024&&key(operation),'Select a complete decision catalogue and stable operation key.');
 const catalog=JSON.parse(catalogText);
 need(catalog.schema==='stellar-forge.flowable-dmn-native-fixtures.v1'&&catalog.engineVersion==='8.0.0'&&
 catalog.nativeSourceRevision==='0779d68e5a3385b74d8acb8bc37901ff54513249'&&Array.isArray(catalog.families)&&
 catalog.families.length>0&&catalog.families.length<=20,'Use the maintained Flowable 8 decision catalogue contract.');
 need(tenantId===undefined||text(tenantId,200),'Select an actual native tenant, or omit it for the native default scope.');
 need(plain(members)&&Object.keys(members).length>0&&Object.keys(members).length<=500,'Retain the complete original members.');
 const sources=Object.entries(members).map(([name,member])=>{
  need(plain(member)&&typeof member.text==='string','Each decision source retains its complete UTF-8 text: '+name);
  const bytes=utf8(member.text);
  need(bytes.length===member.bytes&&bytes.length<=16*1024*1024&&base64(bytes)===member.contentBase64&&
   /^[a-f0-9]{64}$/.test(member.sha256??''),'The complete source text/byte identity differs: '+name);
  return{name,bytes:member.bytes,sha256:member.sha256,mediaType:member.mediaType??'application/octet-stream',contentBase64:member.contentBase64};
 });
 need(Object.values(members).filter(m=>m.text===catalogText).length===1,'Include the complete selected catalogue exactly once.');
 const sourceName=file=>{
  const names=[...new Set([file.path,file.filename].filter(name=>typeof name==='string'&&Object.hasOwn(members,name)))];
  need(names.length===1,'Select exactly one complete source by its declared path or filename: '+file.filename);return names[0];
 };
 const allKeys=new Set(),allIds=new Set();
 for(const family of catalog.families){
  need(plain(family)&&key(family.id)&&key(family.key)&&text(family.title,300)&&!allKeys.has(family.key)&&!allIds.has(family.id),
   'Select distinct named original decision families.');allKeys.add(family.key);allIds.add(family.id);
  need(Array.isArray(family.files)&&family.files.length>0&&family.files.length<=20&&
   Array.isArray(family.cases)&&family.cases.length>0&&family.cases.length<=50,'Retain each source edition and its typed cases.');
  const editions=new Set(),caseIds=new Set();
  for(const file of family.files){
   need(Number.isSafeInteger(file.edition)&&file.edition>0&&!editions.has(file.edition)&&text(file.filename,200)&&
    !/[/"\\\r\n]/.test(file.filename)&&/\.(dmn|dmn\.xml|dmn11|dmn11\.xml)$/.test(file.filename),
    'Keep unique edition numbers and original native DMN filenames.');editions.add(file.edition);
   const source=members[sourceName(file)];
   need(source&&source.bytes===file.bytes&&source.sha256===file.sha256,'The catalogue names a different full source: '+file.filename);
  }
  for(const item of family.cases){
   need(plain(item)&&key(item.id)&&!caseIds.has(item.id)&&['auto','decision','decisionService'].includes(item.mode)&&
    typeof item.singleResult==='boolean'&&Array.isArray(item.inputVariables)&&item.inputVariables.length<=100,'Retain distinct original typed decision cases.');caseIds.add(item.id);
   const names=new Set();for(const input of item.inputVariables){variable(input);need(!names.has(input.name),'A native variable name is repeated.');names.add(input.name);}
   need(Array.isArray(item.expectedByEdition)&&item.expectedByEdition.length===editions.size,'Keep one authored reference outcome per source edition.');
   const expected=new Set();for(const result of item.expectedByEdition){
    need(editions.has(result.edition)&&!expected.has(result.edition)&&text(result.reviewRoute,1000),'Keep unique edition-bound reference review routes.');expected.add(result.edition);
   }
  }
 }
 const selected=familyKeys??[...allKeys];
 need(Array.isArray(selected)&&selected.length>0&&new Set(selected).size===selected.length&&selected.every(k=>allKeys.has(k)),
  'Select distinct original decision family keys.');
 const steps=[],expectations=[];let previous;
 const add=(step,expectation)=>{steps.push({...step,...(previous?{after:[previous]}:{})});previous=step.key;expectations.push({stepKey:step.key,...expectation});};
 for(const familyKey of selected){
  const family=catalog.families.find(f=>f.key===familyKey);
  for(const file of [...family.files].sort((a,b)=>a.edition-b.edition)){
   const name=sourceName(file),source=members[name],prefix=family.id+'-v'+file.edition;
   const sourceIdentity={name,filename:file.filename,bytes:file.bytes,sha256:file.sha256};
   add({key:prefix+'-deploy',label:family.title+' · deploy source '+file.edition,kind:'decisionRelease',
    selection:{action:'deploy',...(tenantId===undefined?{}:{tenantId}),
     resource:{filename:file.filename,contentType:'application/xml',contentBase64:source.contentBase64}},
    note:'Retain the original native deployment receipt and exact source. This local source edition does not assert an engine version number.'},
    {kind:'decisionRelease',familyKey,edition:file.edition,source:sourceIdentity});
   for(const item of family.cases){
    const expected=item.expectedByEdition.find(v=>v.edition===file.edition);
    const selection={action:'evaluate',mode:item.mode,singleResult:item.singleResult,
     bodyText:JSON.stringify({decisionKey:family.key,...(tenantId===undefined?{}:{tenantId}),inputVariables:item.inputVariables,disableHistory:false})};
    add({key:prefix+'-'+item.id,label:family.title+' · '+item.id+' · source '+file.edition,kind:'decisionEvaluation',selection,
     note:'Review the current native key/tenant source against '+file.sha256+'. Authored reference reviewRoute: '+expected.reviewRoute+
      '. Preserve the original 201 result; history is not request attribution and a missing response does not permit another evaluation.'},
     {kind:'decisionEvaluation',familyKey,edition:file.edition,caseId:item.id,source:sourceIdentity,selection:copy(selection),expectedReviewRoute:expected.reviewRoute});
   }
  }
 }
 const programme={schema:FLOWABLE_PROGRAMME_SCHEMA,key:operation,label:'Decision commissioning · '+operation,
  note:'Complete authored DMN source editions and exact typed inputs, reviewed with the original native key/tenant selection and retained deployment and evaluation results.',
  sources,steps};
 validateFlowableProgramme(programme);
 need(utf8(JSON.stringify(programme)).length<=16*1024*1024,'The complete programme exceeds the original 16 MiB intake limit.');
 return{programme,expectations};
}
export function buildFlowableDecisionProgramme(input){return describeFlowableDecisionProgramme(input).programme;}
