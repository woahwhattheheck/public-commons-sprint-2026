// MIT. Complete two-framework authoring programme. Publisher bytes stay in the original CASE engine.
export function createCASEProgramme({uuid,now,hash,encode,compare,delivery,inspectDelivery,inspectSource}) {
 const clone=v=>structuredClone(v),eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b),fail=m=>{throw Error(m)},object=v=>v&&typeof v==='object'&&!Array.isArray(v);
 const text=(v,n)=>{if(typeof v!=='string')fail(n+' must retain literal text.');};
 const keys=['framework-one','framework-two'],roundKeys=['round-one','round-two'];
 const source=label=>({text:'',origin:{label,locator:'operator-entered'}});
 const round=key=>({key,before:source('Baseline'),after:source('Candidate'),reviewer:'',notes:'',decisions:{},report:null,history:[],ui:{search:'',state:'',selectedKey:''}});
 const framework=key=>({key,label:key==='framework-one'?'Framework one':'Framework two',documentId:'',publisher:'',owner:'',purpose:'',selectionNote:'',rounds:roundKeys.map(round)});
 const state=()=>({title:'CASE commissioning programme',customer:'',workPackage:'',notes:'',frameworks:keys.map(framework),ui:{framework:'framework-one',round:'round-one',editionName:'',receivingNote:''}});
 const initial=()=>({schema:'commons.case-programme-working.v1',id:uuid(),sequence:0,createdAt:now(),...state(),editions:[],receiving:[],originals:[]});
 function validateState(w){
  for(const k of ['title','customer','workPackage','notes'])text(w[k],k);
  if(!Array.isArray(w.frameworks)||w.frameworks.length!==2)fail('Retain both framework slots.');
  w.frameworks.forEach((f,i)=>{if(f.key!==keys[i])fail('Framework slot identity differs.');for(const k of ['label','documentId','publisher','owner','purpose','selectionNote'])text(f[k],k);
   if(!Array.isArray(f.rounds)||f.rounds.length!==2)fail('Retain both staged rounds.');
   f.rounds.forEach((r,j)=>{if(r.key!==roundKeys[j]||!object(r.decisions)||!Array.isArray(r.history))fail('Invalid review round.');
    for(const side of ['before','after']){text(r[side]?.text,side);text(r[side]?.origin?.label,side+' label');text(r[side]?.origin?.locator,side+' locator');}
    text(r.reviewer,'Reviewer');text(r.notes,'Notes');if(!object(r.ui))fail('Missing round controls.');for(const k of ['search','state','selectedKey'])text(r.ui[k],k);
    for(const [k,d]of Object.entries(r.decisions)){if(!object(d)||!['','ACCEPT','INVESTIGATE','DEFER'].includes(d.choice))fail('Invalid decision '+k);text(d.note,'Decision note');}
    if(r.report!==null&&(!object(r.report)||r.report.schema!=='commons.case-edition-review.v1'))fail('Invalid retained comparison.');
    for(const h of r.history){if(!object(h)||!object(h.value)||!h.at)fail('Invalid earlier complete round.');const x=clone(h.value);x.history=[];validateState({...state(),frameworks:[{...framework(keys[0]),rounds:[{...x,key:roundKeys[0]},round(roundKeys[1])]},framework(keys[1])]});}
   });
  });
  if(!object(w.ui)||!keys.includes(w.ui.framework)||!roundKeys.includes(w.ui.round))fail('Invalid selected framework/round.');
  text(w.ui.editionName,'Edition name');text(w.ui.receivingNote,'Receiving note');return w;
 }
 function validate(w){if(w?.schema!=='commons.case-programme-working.v1'||typeof w.id!=='string'||!w.id||!Number.isSafeInteger(w.sequence)||w.sequence<0)fail('Not a complete CASE programme.');validateState(w);
  for(const k of ['editions','receiving','originals'])if(!Array.isArray(w[k]))fail('Missing '+k);
  const ids=new Set();for(const e of w.editions){if(!e.id||ids.has(e.id))fail('Repeated named edition.');ids.add(e.id);text(e.name,'Edition name');validateState(e.value);}
  for(const r of [...w.receiving,...w.originals]){text(r.text,'Complete original');if(!/^[a-f0-9]{64}$/.test(r.sha256)||!Number.isSafeInteger(r.bytes)||r.bytes<0)fail('Invalid original identity.');}
  return w;
 }
 function current(w,f=w.ui.framework,r=w.ui.round){const framework=w.frameworks.find(x=>x.key===f);const round=framework?.rounds.find(x=>x.key===r);if(!round)fail('Choose an existing framework and round.');return {framework,round};}
 function touch(w){w.sequence++;return w;}
 function snapshot(w){const v={};for(const k of ['title','customer','workPackage','notes','frameworks','ui'])v[k]=clone(w[k]);return v;}
 function archive(r){if(r.report){const v=clone(r);v.history=[];r.history.push({at:now(),value:v});r.report=null;r.decisions={};r.ui.selectedKey='';}}
 function edit(w,scope,k,value){text(value,k);const {framework:f,round:r}=current(w);
  if(scope==='programme'){if(!['title','customer','workPackage','notes'].includes(k))fail('Unknown programme field.');w[k]=value;}
  else if(scope==='framework'){if(!['label','documentId','publisher','owner','purpose','selectionNote'].includes(k))fail('Unknown framework field.');f[k]=value;}
  else if(scope==='round'){if(!['reviewer','notes'].includes(k))fail('Unknown review field.');r[k]=value;}
  else if(scope==='ui'){if(!['editionName','receivingNote'].includes(k))fail('Unknown working control.');w.ui[k]=value;}
  else if(scope==='round-ui'){if(!['search','state','selectedKey'].includes(k))fail('Unknown review control.');r.ui[k]=value;}
  else fail('Unknown editing scope.');return touch(w);
 }
 function editSource(w,side,k,value){if(!['before','after'].includes(side)||!['text','label','locator'].includes(k))fail('Unknown source field.');text(value,k);const r=current(w).round;archive(r);if(k==='text')r[side].text=value;else r[side].origin[k]=value;return touch(w);}
 function select(w,f,r){current(w,f,r);w.ui.framework=f;w.ui.round=r;return touch(w);}
 function decide(w,key,choice,note){const r=current(w).round;if(!r.report?.rows.some(x=>x.key===key))fail('Select a row from this exact comparison.');if(!['','ACCEPT','INVESTIGATE','DEFER'].includes(choice))fail('Choose a supported disposition.');text(note,'Decision note');r.decisions[key]={choice,note};return touch(w);}
 function signature(f,r){return JSON.stringify({documentId:f.documentId,before:r.before,after:r.after});}
 async function compareRound(w,fk=w.ui.framework,rk=w.ui.round){const {framework:f,round:r}=current(w,fk,rk),pin=signature(f,r),report=await compare(clone(r.before),clone(r.after),{hash});
  if(signature(f,r)!==pin)fail('Source changed while comparison was running. All writing is retained; compare the current selection.');
  if(f.documentId&&f.documentId!==report.basis.documentId)fail('Selected framework UUID differs from these complete packages.');
  if(r.report&&r.report.basisSha256!==report.basisSha256)archive(r);r.report=report;touch(w);return report;
 }
 async function makeDelivery(w,fk=w.ui.framework,rk=w.ui.round){const {framework:f,round:r}=current(w,fk,rk);if(!r.report)fail('Compare this round first.');const v=clone(r),expected=f.documentId;const decisions={};for(const[k,d]of Object.entries(v.decisions)){if(d.choice)decisions[k]=d;else if(d.note)fail('Choose a disposition for each entered decision note.');}
  const d=await delivery({before:v.before,after:v.after,review:{basisSha256:v.report.basisSha256,reviewer:v.reviewer,notes:v.notes,decisions}},{hash});if(expected&&d.report.basis.documentId!==expected)fail('Selected framework UUID differs.');return d;
 }
 function freeze(w,name){text(name,'Edition name');if(!name.trim())fail('Name the complete edition.');const e={id:uuid(),name,at:now(),value:snapshot(w)};w.editions.push(e);touch(w);return e;}
 function restore(w,id){const e=w.editions.find(x=>x.id===id);if(!e)fail('Select a retained edition.');const next=clone(w);freeze(next,'Before restoring '+e.name);Object.assign(next,clone(e.value));validate(next);next.sequence=w.sequence+1;Object.assign(w,next);return w;}
 async function raw(textValue,name,kind){text(textValue,'Original text');const b=encode(textValue);return{id:uuid(),at:now(),name,kind,text:textValue,bytes:b.length,sha256:await hash(b)};}
 async function verify(w){validate(w);for(const r of [...w.receiving,...w.originals])if(encode(r.text).length!==r.bytes||await hash(encode(r.text))!==r.sha256)fail('Retained original differs: '+r.name); const check=async s=>{for(const f of s.frameworks)for(const r of f.rounds){if(r.report&&!eq(await compare(r.before,r.after,{hash}),r.report))fail('Retained comparison differs from complete original sources.');for(const h of r.history)if(h.value.report&&!eq(await compare(h.value.before,h.value.after,{hash}),h.value.report))fail('Earlier comparison differs from its retained original sources.');}};await check(w);for(const e of w.editions)await check(e.value);return w;}
 async function receive(w,textValue,name){const receivingNote=w.ui.receivingNote;const item=await raw(textValue,name,'unclassified');item.note=receivingNote;item.status='RETAINED';item.error='';try{const v=parseCASEProgrammeJSON(textValue);item.schema=v.schema??'';if(v.schema==='commons.case-edition-delivery.v1'){const d=await inspectDelivery(v,{hash});item.kind='delivery';item.basisSha256=d.report.basisSha256;item.documentId=d.report.basis.documentId;item.status='REPRODUCED';}else if(v.schema==='commons.case-cold-reproduction.v1'){item.kind='native-reproduction';item.status='SUPPLIED_RECORD';}else if(v.schema==='commons.case-capture.v1'&&v.source){const s=await inspectSource(v.source,{hash});item.kind='capture';item.documentId=s.document.identifier;item.status='SOURCE_INSPECTED';}else{item.kind='record';item.status='SUPPLIED_RECORD';}}catch(e){item.status='NEEDS_ATTENTION';item.error=e.message;}w.receiving.push(item);touch(w);return item;}
 async function adoptReceiving(w,id){const item=w.receiving.find(x=>x.id===id);if(!item||item.kind!=='delivery'||item.status!=='REPRODUCED')fail('Select a fully reproduced pair delivery.');const {framework:f,round:r}=current(w),pin=JSON.stringify(r),d=await inspectDelivery(parseCASEProgrammeJSON(item.text),{hash});if(JSON.stringify(r)!==pin)fail('Current round changed during adoption; retain it and select again.');if(f.documentId&&f.documentId!==d.report.basis.documentId)fail('Received framework differs from the explicitly selected UUID.');freeze(w,'Before adopting '+item.name);Object.assign(r,{before:d.before,after:d.after,reviewer:d.review.reviewer,notes:d.review.notes,decisions:d.review.decisions,report:d.report});touch(w);}
 async function importProgramme(w,textValue,name){let incoming=parseCASEProgrammeJSON(textValue);if(incoming.schema==='commons.case-working.v1'){const old=incoming;incoming=initial();const r=current(incoming).round;for(const k of ['before','after','reviewer','notes','decisions'])r[k]=clone(old[k]);r.report=null;if(old.basisSha256){const report=await compare(r.before,r.after,{hash});if(report.basisSha256!==old.basisSha256)fail('Historical working review names another source pair.');r.report=report;}incoming.notes='Imported original single-pair working copy. Its complete history remains in the exact received original.';}await verify(incoming);const original=await raw(textValue,name,'programme');if(!w.originals.some(x=>x.sha256===original.sha256))w.originals.push(original);const e={id:uuid(),name:'Received '+name,at:now(),value:snapshot(incoming),originalSha256:original.sha256};w.editions.push(e);
  // Keep the full received graph in the immutable original; expose its named editions without replacing current writing.
  for(const old of incoming.editions)w.editions.push({...clone(old),id:uuid(),name:'Received '+name+' / '+old.name,originalSha256:original.sha256});
  for(const old of incoming.receiving)if(!w.receiving.some(x=>x.sha256===old.sha256&&x.name===old.name))w.receiving.push({...clone(old),id:uuid()});
  touch(w);return e;
 }
 function continuity(w){return w.frameworks.map(f=>{const a=f.rounds[0],b=f.rounds[1];return{key:f.key,documentId:f.documentId,observedDocumentIds:f.rounds.map(r=>r.report?.basis.documentId??null),baselineSame:a.report&&b.report?a.report.before.source.sha256===b.report.before.source.sha256:null,rounds:f.rounds.map(r=>({round:r.key,compared:!!r.report,basisSha256:r.report?.basisSha256??null,openRows:r.report?.rows.filter(x=>x.state!=='UNCHANGED'&&r.decisions[x.key]?.choice!=='ACCEPT').length??null}))};});}
 async function exportProgramme(w){await verify(w);const files={'programme-working.json':JSON.stringify(w,null,2)+'\n'},frameworks=[];for(const f of w.frameworks){const item={key:f.key,documentId:f.documentId,rounds:[]};for(const r of f.rounds){if(!r.report)continue;const d=await makeDelivery(w,f.key,r.key),p=f.key+'-'+r.key;files[p+'-delivery.json']=JSON.stringify(d,null,2)+'\n';files[p+'-review.json']=JSON.stringify(d.review,null,2)+'\n';files[p+'-before.json']=d.before.text;files[p+'-after.json']=d.after.text;item.rounds.push({key:r.key,documentId:d.report.basis.documentId,before:{bytes:d.before.bytes,sha256:d.before.sha256},after:{bytes:d.after.bytes,sha256:d.after.sha256},basisSha256:d.report.basisSha256,delivery:p+'-delivery.json',review:p+'-review.json'});}frameworks.push(item);}
  const selection={schema:'commons.case-programme-selection.v1',programmeId:w.id,customer:w.customer,workPackage:w.workPackage,title:w.title,frameworks,continuity:continuity(w),meaning:'Authored selection and review, not customer approval or native receiving completion.'};files['programme-selection.json']=JSON.stringify(selection,null,2)+'\n';const members=[];for(const[name,text]of Object.entries(files)){const b=encode(text);members.push({name,bytes:b.length,sha256:await hash(b)});}files['programme-manifest.json']=JSON.stringify({schema:'commons.case-programme-files.v1',files:members},null,2)+'\n';return files;
 }
 return{parse:parseCASEProgrammeJSON,initial,validate,verify,current,touch,edit,editSource,select,decide,compareRound,makeDelivery,freeze,restore,receive,adoptReceiving,importProgramme,continuity,exportProgramme,snapshot};
}
// Duplicate object keys reject. Numeric publisher tokens remain inside untouched source strings.
export function parseCASEProgrammeJSON(text) {
 const value=JSON.parse(text);let i=0;
 const ws=()=>{while(/[ \t\r\n]/.test(text[i]??'')&&i<text.length)i++;};
 function read(){ws();const c=text[i];if(c==='"'){const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')return JSON.parse(text.slice(start,i));}throw Error('Incomplete string.');}
 if(c==='{'){i++;ws();const seen=new Set();if(text[i]==='}'){i++;return;}for(;;){const key=read();if(typeof key!=='string'||seen.has(key))throw Error('Repeated JSON object key.');seen.add(key);ws();if(text[i++]!==':')throw Error('Object separator.');read();ws();if(text[i++]==='}')return;}}
 if(c==='['){i++;ws();if(text[i]===']'){i++;return;}for(;;){read();ws();if(text[i++]===']')return;}}
 const m=text.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);if(!m)throw Error('JSON token.');i+=m[0].length;}
 read();ws();if(i!==text.length)throw Error('Trailing JSON.');return value;
}
