// Public disclosure source handover. Original values remain bound to retained source.
export function createDisclosureDesk({sha256Utf8,utf8ByteLength,readCsv,writeCsv}) {
 const SCHEMA='commons.public-disclosure-handover.v1',MAX=64*1024*1024;
 const numericTokens=new WeakSet();
 const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const copy=x=>JSON.parse(JSON.stringify(x));
 const need=(x,m)=>{if(!x)throw new Error(m);};
 const hash=x=>sha256Utf8(typeof x==='string'?x:JSON.stringify(x)).sha256;
 const text=(x,n,max=10000)=>{need(typeof x==='string'&&x.length<=max&&!x.includes('\0'),n+' must be complete text.');return x;};
 const nonblank=(x,n,max)=>{text(x,n,max);need(x.trim(),n+' is required.');return x;};
 const instant=x=>{nonblank(x,'Retrieved/created time',64);need(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x)),'Use an explicit ISO time with timezone.');return x;};
 const sourceDate=x=>{text(x,'Source retrieval date',64);if(/^\d{4}-\d\d-\d\d$/.test(x)){need(new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x,'Invalid source retrieval date.');return x;}return instant(x);};
 const roles=['declaration','companyId','year','country','company','project','government','revenue','amount','amountUsd','currency','inKind','classification','updated'];
 const eitiMapping=Object.freeze({declaration:'eiti_id_declaration',companyId:'eiti_id_company',year:'year',country:'country_iso3',company:'company_name',project:'project_name',government:'gov_entity_name',revenue:'revenue_stream_name',amount:'payment_value',amountUsd:'payment_value_usd',currency:'currency_code',inKind:'payment_in_kind',classification:'gfs_code',updated:'last_updated'});
 const cell=(kind,raw)=>({kind,raw});
 const value=c=>c?.kind==='null'?null:c?.raw??null;
 const present=c=>c&&c.kind!=='null'&&c.raw!=='';
 function decimal(raw){
  if(typeof raw!=='string'||raw.length>2048)return null;
  const m=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw);
  if(!m)return null;const exponent=Number(m[5]||0);if(!Number.isInteger(exponent)||Math.abs(exponent)>1000)return null;
  const whole=m[2]||'',fraction=m[3]??m[4]??'';if(whole.length+fraction.length>1000)return null;
  let coefficient=BigInt((whole+fraction)||'0')*(m[1]==='-'?-1n:1n),scale=fraction.length-exponent;
  if(scale<0){coefficient*=10n**BigInt(-scale);scale=0;}
  return {coefficient:coefficient.toString(),scale};
 }
 function decimalText(v){
  let c=BigInt(v.coefficient),negative=c<0n;if(negative)c=-c;let s=c.toString();
  if(v.scale){s=s.padStart(v.scale+1,'0');s=s.slice(0,-v.scale)+'.'+s.slice(-v.scale);}
  return (negative?'-':'')+s;
 }
 function plus(a,b){const scale=Math.max(a.scale,b.scale);return {coefficient:(BigInt(a.coefficient)*10n**BigInt(scale-a.scale)+BigInt(b.coefficient)*10n**BigInt(scale-b.scale)).toString(),scale};}
 // JSON.parse checks grammar. A token pass then preserves every original numeric lexeme;
 // markers are chosen outside all decoded source strings, including escaped spellings.
 function losslessJson(content){
  if(content.charCodeAt(0)===0xfeff)content=content.slice(1);
  JSON.parse(content);
  const strings=new Set();for(let i=0;i<content.length;){if(content[i]==='"'){let j=i+1;while(j<content.length){if(content[j]==='\\'){j+=2;continue;}if(content[j++]==='"')break;}strings.add(JSON.parse(content.slice(i,j)));i=j;}else i++;}
  let prefix='__disclosure_number__';while([...strings].some(x=>x.startsWith(prefix)))prefix+='_';
  const numbers=[],parts=[];let i=0;
  while(i<content.length){
   if(content[i]==='"'){let j=i+1;while(j<content.length){if(content[j]==='\\'){j+=2;continue;}if(content[j++]==='"')break;}parts.push(content.slice(i,j));i=j;}
   else if(content[i]==='-'||/[0-9]/.test(content[i])){const m=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(content.slice(i));need(m&&m.index===0,'Malformed JSON number.');const n=numbers.push(m[0])-1;parts.push(JSON.stringify(prefix+n));i+=m[0].length;}
   else parts.push(content[i++]);
  }
  return JSON.parse(parts.join(''),(_,v)=>{if(typeof v==='string'&&v.startsWith(prefix)){const token={numericLexeme:numbers[Number(v.slice(prefix.length))]};numericTokens.add(token);return token;}return v;});
 }
 function nativeCell(v){
  if(v===null)return cell('null',null);
  if(typeof v==='string')return cell(v===''?'empty':'string',v);
  if(typeof v==='boolean')return cell('boolean',v?'true':'false');
  if(plain(v)&&numericTokens.has(v))return cell('number',v.numericLexeme);
  throw new Error('Detailed table cells must be scalar JSON values.');
 }
 function metaNumber(v){if(v===undefined||v===null)return null;const raw=plain(v)&&numericTokens.has(v)?v.numericLexeme:v;const n=Number(raw);need(Number.isSafeInteger(n)&&n>=0,'Invalid detailed-table count.');return n;}
 function table(format,content){
  need(utf8ByteLength(content)<=MAX,'One source exceeds 64 MiB UTF-8.');
  let headers,rows,coverage;
  if(format==='csv'){
   const parsed=readCsv(content,'Original public disclosure CSV');
   need(!parsed.errors.length,parsed.errors.map(x=>'Record '+x.record+', line '+x.line+': '+x.message).join('\n'));
   need(parsed.records.length,'The original CSV has no header.');
   headers=parsed.records[0].values;
   rows=parsed.records.slice(1).map(r=>({record:r.record,line:r.line,cells:r.values.map(v=>cell(v===''?'empty':'string',v))}));
   coverage={returnedRows:rows.length,filteredRows:null,next:null,complete:false,reason:'CSV carries no pagination metadata; review its declared scope and expected row count.'};
  }else{
   need(format==='datasette-json','Choose CSV or the original Datasette JSON response.');
   const doc=losslessJson(content);need(plain(doc)&&Array.isArray(doc.rows),'Use a complete Datasette rows response.');
   headers=Array.isArray(doc.columns)?doc.columns:doc.rows.length&&plain(doc.rows[0])?Object.keys(doc.rows[0]):null;
   need(Array.isArray(headers),'An empty object-row response needs original column metadata.');
   if(doc.ok!==undefined)need(doc.ok===true,'The original endpoint reported an unsuccessful response.');
   rows=doc.rows.map((row,index)=>{need(Array.isArray(row)||plain(row),'Invalid original table row.');if(plain(row))need(Object.keys(row).length===headers.length&&headers.every(k=>Object.prototype.hasOwnProperty.call(row,k)),'An object row omits or adds an original column.');return {record:index+1,line:null,jsonPointer:'/rows/'+index,cells:(Array.isArray(row)?row:headers.map(k=>row[k])).map(nativeCell)};});
   const filteredRows=metaNumber(doc.filtered_table_rows_count??doc.count),next=doc.next??doc.next_url??null;
   const nextValue=next===null?null:plain(next)&&numericTokens.has(next)?next.numericLexeme:next;
   need(nextValue===null||typeof nextValue==='string','Invalid original next-page cursor.');
   coverage={returnedRows:rows.length,filteredRows,next:nextValue,complete:doc.truncated!==true&&nextValue===null&&filteredRows===rows.length,truncated:doc.truncated===true,reason:nextValue!==null?'More original pages remain.':filteredRows===rows.length?'Original filtered count matches this complete response.':'Original filtered total is not available or differs; review scope.'};
  }
  need(headers.length>0&&headers.length<=256&&headers.every(h=>typeof h==='string'&&h.trim()&&!h.includes('\0')),'Each exact source header must be nonblank text.');
  need(new Set(headers).size===headers.length,'The source has duplicate header names; retain it and resolve the original ambiguity.');
  need(rows.length<=100000,'Use a complete selection of at most 100,000 rows.');
  for(const r of rows)need(r.cells.length===headers.length,'Original record '+r.record+' has '+r.cells.length+' cells for '+headers.length+' headers.');
  return {headers,rows,coverage};
 }
 function checkedMapping(mapping,headers,population='company-payments'){
  need(plain(mapping),'Supply the explicit source column mapping.');const out={};
  for(const role of roles){const name=mapping[role];if(name===undefined||name===null||name===''){out[role]=null;continue;}need(typeof name==='string'&&headers.includes(name),'Mapped '+role+' column is absent from the exact original headers.');out[role]=name;}
  for(const key of ['declaration','year','country','revenue','amount','currency'])need(out[key],'Map '+key+' before profiling.');
  if(population==='company-payments')need(out.companyId||out.company,'Map a company identity or its original name.');
  need(new Set(Object.values(out).filter(Boolean)).size===Object.values(out).filter(Boolean).length,'Each mapped role needs its own original column.');
  return out;
 }
 function create({title='Public disclosure handover',createdAt}){return {schema:SCHEMA,revision:0,title:nonblank(title,'Title',300),createdAt:instant(createdAt),snapshots:[],selected:null,reviews:[]};}
 function addSource(workspace,input){
  validate(workspace);need(plain(input),'Supply the complete original source and metadata.');
  const content=text(input.content,'Original source',MAX),format=input.format,parsed=table(format,content),mapping=checkedMapping(input.mapping,parsed.headers,input.population);
  const metadata={url:nonblank(input.url,'Source URL',4000),retrievedAt:sourceDate(input.retrievedAt),representation:input.representation,scope:nonblank(input.scope,'Exact source scope',3000),population:input.population,expectedRows:input.expectedRows??null,completenessNote:text(input.completenessNote??'','Scope note',4000)};
  need(/^https?:\/\//.test(metadata.url),'Retain the original public HTTP(S) source URL.');
  need(['http-response-text','retrieved-web-representation','operator-supplied-file'].includes(metadata.representation),'State the actual source representation.');
  need(['company-payments','government-revenues'].includes(metadata.population),'Select the original population.');
  if(metadata.expectedRows!==null)need(Number.isSafeInteger(metadata.expectedRows)&&metadata.expectedRows>=0,'Expected row count must be a nonnegative integer.');
  const identity=sha256Utf8(content),editionHash=hash({sourceSha256:identity.sha256,format,mapping,metadata});
  const existing=workspace.snapshots.find(s=>s.id==='snapshot-'+editionHash);
  if(existing)return {workspace:copy(workspace),snapshotId:existing.id,replayed:true};
  const snapshot={id:'snapshot-'+editionHash,format,content,identity,metadata,mapping};
  const next=copy(workspace);next.snapshots.push(snapshot);next.selected=snapshot.id;next.revision++;serialize(next);return {workspace:next,snapshotId:snapshot.id,replayed:false};
 }
 function validate(workspace,skipReviewTargets=false){
  need(plain(workspace)&&workspace.schema===SCHEMA&&Number.isSafeInteger(workspace.revision)&&workspace.revision>=0,'Open a complete disclosure handover workspace.');
  nonblank(workspace.title,'Title',300);instant(workspace.createdAt);need(Array.isArray(workspace.snapshots)&&workspace.snapshots.length<=100,'Too many or missing retained snapshots.');
  const seen=new Set();for(const s of workspace.snapshots){
   need(plain(s)&&plain(s.identity)&&plain(s.metadata)&&plain(s.mapping),'A retained source envelope is incomplete.');
   text(s.content,'Retained source',MAX);const actual=sha256Utf8(s.content);need(actual.sha256===s.identity.sha256&&actual.bytes===s.identity.bytes,'The retained original source has changed.');
   need(s.id==='snapshot-'+hash({sourceSha256:s.identity.sha256,format:s.format,mapping:s.mapping,metadata:s.metadata}),'The retained source mapping or provenance has changed.');
   need(!seen.has(s.id),'The workspace repeats a source edition.');seen.add(s.id);
   sourceDate(s.metadata.retrievedAt);nonblank(s.metadata.url,'Source URL',4000);need(/^https?:\/\//.test(s.metadata.url),'Retain an original HTTP(S) source URL.');need(['http-response-text','retrieved-web-representation','operator-supplied-file'].includes(s.metadata.representation),'Invalid retained representation.');nonblank(s.metadata.scope,'Original scope',3000);if(s.metadata.expectedRows!==null)need(Number.isSafeInteger(s.metadata.expectedRows)&&s.metadata.expectedRows>=0,'Invalid expected row count.');need(['company-payments','government-revenues'].includes(s.metadata.population),'The original population is invalid.');
  }need(workspace.selected===null||seen.has(workspace.selected),'The selected original source is absent.');
  const reviews=workspace.reviews??[];need(Array.isArray(reviews)&&reviews.length<=5000,'Invalid retained review register.');const reviewIds=new Set(),profiles=new Map();
  for(const review of reviews){
   need(plain(review)&&plain(review.target)&&['row','finding','repeated-key'].includes(review.target.kind),'Invalid original review target.');
   const snapshot=workspace.snapshots.find(x=>x.id===review.snapshotId);
   need(snapshot&&review.sourceSha256===snapshot.identity.sha256,'The review lost its original source snapshot.');
   nonblank(review.target.id,'Review target',200);need(review.id==='review-'+hash([review.snapshotId,review.target])&&!reviewIds.has(review.id),'Invalid or repeated review identity.');reviewIds.add(review.id);
   need(Array.isArray(review.history)&&review.history.length>0&&review.history.length<=1000,'Retain the complete review history.');
   let previous=null,previousTime=null;
   for(let i=0;i<review.history.length;i++){
    const event=review.history[i];need(plain(event)&&event.revision===i+1&&event.previousSha256===previous,'The saved review history is incomplete or reordered.');
    const {sha256,...facts}=event;need(sha256===hash(facts),'A saved review decision changed.');instant(event.at);
    need(previousTime===null||Date.parse(event.at)>=previousTime,'Review history time moved backwards.');previousTime=Date.parse(event.at);
    need(['open','accepted','needs-source-check','resolved'].includes(event.status),'Choose an explicit review status.');
    nonblank(event.owner,'Review owner',300);nonblank(event.note,'Review explanation',8000);previous=sha256;
   }
   if(!skipReviewTargets){
    if(!profiles.has(review.snapshotId))profiles.set(review.snapshotId,profile(workspace,review.snapshotId,true));
    resolveTarget(profiles.get(review.snapshotId),review.target);
   }
  }
  return workspace;
 }
 function select(workspace,id){validate(workspace);need(workspace.snapshots.some(s=>s.id===id),'Select a retained source.');const next=copy(workspace);next.selected=id;return next;}
 function profile(workspace,id=workspace.selected,skipReviewTargets=false){
  validate(workspace,skipReviewTargets);const s=workspace.snapshots.find(x=>x.id===id);need(s,'Select an original source before profiling.');
  const parsed=table(s.format,s.content),mapping=checkedMapping(s.mapping,parsed.headers,s.metadata.population),indices=Object.fromEntries(roles.map(role=>[role,mapping[role]===null?-1:parsed.headers.indexOf(mapping[role])]));
  const observations=[],groups=new Map(),totals=new Map(),issues=[],companies=new Set(),years=new Set(),declarations=new Set(),updated=new Set(),states={null:0,empty:0,string:0,number:0,boolean:0};
  const get=(r,role)=>indices[role]<0?null:r.cells[indices[role]];
  function issue(code,r,role,message){issues.push({code,observationId:r.id,record:r.record,line:r.line,role,column:mapping[role]??null,message});}
  for(const raw of parsed.rows){
   const r={id:s.identity.sha256+':'+raw.record,record:raw.record,line:raw.line,jsonPointer:raw.jsonPointer??null,cells:raw.cells,roles:Object.fromEntries(roles.map(role=>[role,get(raw,role)]))};
   for(const c of r.cells)states[c.kind]++;
   for(const role of ['declaration','year','country','revenue','amount','currency'])if(!present(r.roles[role]))issue('missing-value',r,role,'Original '+role+' is '+(r.roles[role]?.kind??'unmapped')+'.');
   for(const role of ['company','year','declaration','updated']){const c=r.roles[role];if(present(c))({company:companies,year:years,declaration:declarations,updated}[role]).add(c.raw);}
   const keyRoles=['country','declaration','companyId','company','year','project','government','revenue','currency','inKind','classification'];
   r.semanticKey=JSON.stringify(keyRoles.map(role=>{const c=r.roles[role];return [role,c===null?'unmapped':c.kind==='null'?'null':c.kind==='empty'?'empty':'value',value(c)];}));
   const same=groups.get(r.semanticKey)||[];same.push(r.id);groups.set(r.semanticKey,same);
   const currency=value(r.roles.currency),kind=value(r.roles.inKind),year=value(r.roles.year),declaration=value(r.roles.declaration);
   for(const amountRole of ['amount','amountUsd']){
    const c=r.roles[amountRole];if(!present(c))continue;
    const dec=decimal(c.raw);if(!dec){issue('invalid-decimal',r,amountRole,'Original value is not an exact supported decimal; it remains unchanged.');continue;}
    const unit=amountRole==='amountUsd'?'USD':currency;
    if(!unit){issue('unclassified-amount',r,amountRole,'A currency is required to place this value in a total.');continue;}
    const k=JSON.stringify([s.metadata.population,declaration,year,unit,kind,amountRole]);
    const t=totals.get(k)||{population:s.metadata.population,declaration,year,currency:unit,inKind:kind,amountRole,count:0,value:{coefficient:'0',scale:0}};
    t.value=plus(t.value,dec);t.count++;totals.set(k,t);
   }
   observations.push(r);
  }
  const repeatedKeys=[...groups.entries()].filter(([,ids])=>ids.length>1).map(([key,ids])=>({id:'group-'+hash([s.identity.sha256,key]),key,observationIds:ids,count:ids.length}));
  for(const g of repeatedKeys)issues.push({code:'repeated-semantic-key',record:null,observationId:null,role:null,column:null,message:g.count+' original observations share this business key; all remain present.',semanticKey:g.key,observationIds:g.observationIds});
  const coverage={...parsed.coverage,expectedRows:s.metadata.expectedRows,scope:s.metadata.scope};
  if(s.format==='csv'&&s.metadata.expectedRows!==null){coverage.complete=s.metadata.expectedRows===parsed.rows.length;coverage.reason=coverage.complete?'Returned rows match the explicitly declared count; the source scope is retained.':'Returned rows differ from the explicitly declared count.';}
  if(s.metadata.expectedRows!==null&&s.metadata.expectedRows!==parsed.rows.length)issues.push({code:'scope-count-mismatch',record:null,message:'Declared '+s.metadata.expectedRows+' rows; this retained source contains '+parsed.rows.length+'.'});
  for(const issue of issues)issue.id='finding-'+hash([s.identity.sha256,issue]);
  return {reviews:copy((workspace.reviews||[]).filter(r=>r.snapshotId===s.id)),schema:'commons.public-disclosure-profile.v1',snapshotId:s.id,sourceSha256:s.identity.sha256,sourceBytes:s.identity.bytes,metadata:copy(s.metadata),mapping:copy(mapping),headers:parsed.headers,coverage,counts:{rows:observations.length,companies:companies.size,declarations:declarations.size,years:years.size,repeatedKeys:repeatedKeys.length,issues:issues.length},cellStates:states,years:[...years].sort(),updatedValues:[...updated].sort(),observations,repeatedKeys,issues,totals:[...totals.values()].map(t=>({...t,exactTotal:decimalText(t.value)}))};
 }
 function resolveTarget(profile,target){
  const rows=target.kind==='row'?profile.observations:target.kind==='finding'?profile.issues:profile.repeatedKeys;
  const found=rows.find(row=>row.id===target.id);need(found,'The selected review target is absent from this exact original snapshot.');return found;
 }
 function recordReview(workspace,input){
  validate(workspace);need(plain(input)&&plain(input.target),'Select an original source target.');
  const p=profile(workspace,input.snapshotId),target={kind:input.target.kind,id:input.target.id};
  need(['row','finding','repeated-key'].includes(target.kind),'Choose a row, finding or repeated-key group.');resolveTarget(p,target);
  need(['open','accepted','needs-source-check','resolved'].includes(input.status),'Choose an explicit review status.');
  const owner=nonblank(input.owner,'Review owner',300),note=nonblank(input.note,'Review explanation',8000),at=instant(input.at);
  const id='review-'+hash([input.snapshotId,target]),next=copy(workspace);if(!next.reviews)next.reviews=[];
  let review=next.reviews.find(r=>r.id===id);
  if(!review){review={id,snapshotId:input.snapshotId,sourceSha256:p.sourceSha256,target,history:[]};next.reviews.push(review);}
  const previous=review.history.at(-1);
  if(previous&&previous.status===input.status&&previous.owner===owner&&previous.note===note)return {workspace:copy(workspace),reviewId:id,replayed:true};
  need(!previous||Date.parse(at)>=Date.parse(previous.at),'A new decision must follow its previous saved decision time.');
  const event={revision:review.history.length+1,at,status:input.status,owner,note,previousSha256:previous?.sha256??null};review.history.push({...event,sha256:hash(event)});next.revision++;serialize(next);return {workspace:next,reviewId:id,replayed:false};
 }
 function exportReviews(workspace,id=workspace.selected){
  const p=profile(workspace,id),rows=[['source_sha256','snapshot_id','review_id','target_kind','target_id','revision','at','status','owner','note','decision_sha256','previous_sha256']];
  for(const r of p.reviews)for(const e of r.history)rows.push([r.sourceSha256,r.snapshotId,r.id,r.target.kind,r.target.id,e.revision,e.at,e.status,e.owner,e.note,e.sha256,e.previousSha256]);
  return writeCsv(rows.map(row=>row.map(safe)));
 }
 function source(workspace,id=workspace.selected){validate(workspace);const s=workspace.snapshots.find(x=>x.id===id);need(s,'Original source absent.');return copy(s);}
 function serialize(workspace){validate(workspace);const raw=JSON.stringify(workspace);need(utf8ByteLength(raw)<=128*1024*1024,'Complete workspace exceeds 128 MiB. Preserve smaller complete source selections separately.');return raw;}
 function reopen(content){need(typeof content==='string'&&utf8ByteLength(content)<=128*1024*1024,'Open a complete workspace of at most 128 MiB.');const state=JSON.parse(content);validate(state);for(const s of state.snapshots)checkedMapping(s.mapping,table(s.format,s.content).headers,s.metadata.population);return state;}
 const safe=value=>{const s=value===null?'':String(value);return /^[\s\u0000-\u001f]*[=+\-@]/u.test(s)?"'"+s:s;};
 function exportObservations(workspace,id=workspace.selected){
  const p=profile(workspace,id),rows=[['source_sha256','source_record','source_line',...p.headers.flatMap(h=>[h,h+' [source type]'])]];
  for(const r of p.observations)rows.push([p.sourceSha256,String(r.record),r.line===null?'':String(r.line),...r.cells.flatMap(c=>[c.raw,c.kind])]);
  return writeCsv(rows.map(row=>row.map(safe)));
 }
 return {SCHEMA,eitiMapping,roles,utf8Bytes:utf8ByteLength,inspectSource:(format,content)=>{const p=table(format,content);return {headers:p.headers,coverage:p.coverage};},create,addSource,validate,select,profile,source,recordReview,exportReviews,serialize,reopen,decimal,decimalText,losslessJson,exportObservations};
}
