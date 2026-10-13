/**
 * Complete issuer-reference intake on the original financial supporting-file writer.
 * No public aggregate row becomes a tenant asset, movement, journal or control.
 */
export function createIssuerAnnex(E,H){
 const PACKAGE='tjlabs.complete-source-carrier.v1',SELECTION='tjlabs.fixed-asset-issuer-selection.v1',REVIEW='tjlabs.fixed-asset-issuer-review.v1';
 const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>H.sha256Utf8(JSON.stringify(x)).sha256;
 const need=(ok,message)=>{if(!ok)throw Error(message);};
 const bytes=value=>{const a=[],b64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';need(typeof value==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'Choose complete Base64 bytes.');let bits=0,n=0;for(const c of value){if(c==='=')break;bits=(bits<<6)|b64.indexOf(c);n+=6;if(n>=8){n-=8;a.push((bits>>n)&255);}}return Uint8Array.from(a);};
 function base64(value){const a=typeof value==='string'?new TextEncoder().encode(value):value,b='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let out='';for(let i=0;i<a.length;i+=3){const n=(a[i]<<16)|((a[i+1]||0)<<8)|(a[i+2]||0);out+=b[(n>>>18)&63]+b[(n>>>12)&63]+(i+1<a.length?b[(n>>>6)&63]:'=')+(i+2<a.length?b[n&63]:'=');}return out;}
 const decode=value=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes(value));
 const json=value=>JSON.stringify(value,null,2)+'\n';
 const media=path=>path.endsWith('.json')?'application/json':path.endsWith('.csv')?'text/csv;charset=utf-8':path.endsWith('.html')?'text/html;charset=utf-8':'text/markdown;charset=utf-8';
 function packet(text){
  need(H.sha256Utf8(text).bytes<=E.LIMITS.supportingBytes,'The complete issuer packet exceeds32 MiB.');
  const p=JSON.parse(text);need(p.schema===PACKAGE&&Array.isArray(p.files)&&p.files.length>0&&p.files.length<=64,'Choose the complete source carrier with its original files.');
  const seen=new Set(),by={};
  for(const f of p.files){need(typeof f.path==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(f.path)&&!seen.has(f.path),'Every original annex member needs one safe unique filename.');seen.add(f.path);need(typeof f.content==='string','Retain every complete annex text member.');const actual=H.sha256Utf8(f.content);need(actual.bytes===f.bytes&&actual.sha256===f.sha256,'An original annex member changed: '+f.path);by[f.path]=f;}
  const read=name=>{need(by[name],'The complete original annex is missing '+name);return JSON.parse(by[name].content);};
  const integration=read('EA_Accounting_Integration.json'),matrix=read('EA_Policy_Data_Matrix.json'),index=read('EA_Accounting_Source_Index.json'),normalized=read('EA_Notes11_13_Normalized_Values.json'),arithmetic=read('EA_Notes11_13_Arithmetic.json');
  need(integration.schema==='tjlabs.ea-accounting-annex-integration.v1'&&matrix.schema==='tjlabs.ea-policy-data-matrix.v1'&&index.schema==='tjlabs.ea-accounting-source-index.v1','Retain the original issuer integration, policy and source contracts.');
  need(by[integration.original_contract_copy]?.sha256===integration.contract_sha256,'The original financial contract copy changed.');
  for(const name of integration.annex_files)need(by[name],'A declared annex member is absent: '+name);
  need(Array.isArray(matrix.rows)&&matrix.rows.length>0&&new Set(matrix.rows.map(r=>r.id)).size===matrix.rows.length,'Policy identities must be complete and unique.');
  for(const r of matrix.rows){need(typeof r.id==='string'&&Array.isArray(r.existing_domain_fields)&&Array.isArray(r.additional_original_annex_fields),'Keep complete policy-field definitions.');for(const f of r.existing_domain_fields){const[d,n]=f.split('.');need(E.DOMAINS[d]?.fields.some(v=>v.name===n),'Unknown original financial field '+f);}}
  const tables=p.files.filter(f=>f.path.endsWith('_Original_Tokens.json')).map(f=>JSON.parse(f.content));
  need(tables.length>0&&normalized.schema==='tjlabs.ea-public-reference-normalization.v1'&&arithmetic.schema==='tjlabs.ea-public-table-arithmetic.v1','Retain original-token tables, separate normalization and arithmetic.');
  return {packet:p,by,integration,matrix,index,normalized,arithmetic,tables,...H.sha256Utf8(text),text};
 }
 async function parseInput(text,inflateRaw){
  let decoded=text;
  if(!text.trimStart().startsWith('{')){
   const fences=[...text.matchAll(/\x60\x60\x60base64-deflate\s+([\s\S]*?)\x60\x60\x60/g)];
   need(fences.length===1,'Choose the complete issuer JSON or its one complete base64-deflate source Canvas.');
   need(typeof inflateRaw==='function','This runtime needs raw-DEFLATE support to open the original Canvas. Choose the complete decoded JSON source carrier.');
   const compressed=bytes(fences[0][1].replace(/\s/g,''));
   const out=await inflateRaw(compressed,E.LIMITS.supportingBytes);
   need(out.length<=E.LIMITS.supportingBytes,'The expanded complete annex exceeds32 MiB.');
   decoded=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(out);
  }
  return {...packet(decoded),originalTransport:text===decoded?null:text};
 }
 function records(ws,schema){const out=[];for(const file of ws.supportingFiles){if(file.purpose!=='Issuer reference record · '+schema)continue;const value=JSON.parse(decode(file.base64));need(value.schema===schema,'A retained issuer record has another schema.');out.push({file,value});}return out;}
 function packages(ws){return records(ws,PACKAGE).map(({file})=>({file,...packet(decode(file.base64))}));}
 function packageByFile(ws,fileId){const file=ws.supportingFiles.find(f=>f.id===fileId);need(file?.purpose==='Issuer reference record · '+PACKAGE,'Select a retained complete issuer source package.');return {file,...packet(decode(file.base64))};}
 function retained(ws,ids){need(Array.isArray(ids)&&new Set(ids).size===ids.length,'Select each complete supporting original once.');return ids.map(id=>{const f=ws.supportingFiles.find(f=>f.id===id);need(f,'The selected supporting original is absent.');return{id:f.id,filename:f.filename,bytes:f.bytes,sha256:f.sha256};});}
 function actor(value){need(typeof value==='string'&&value.trim().length>0&&value.length<=300,'Name the source owner or reviewer.');return value;}
 function note(value){need(typeof value==='string'&&value.trim().length>0&&value.length<=100000,'Describe the explicit source scope and decision.');return value;}
 function saveRecord(ws,meta,value,filename){return E.importSupportingFile(ws,{...meta,filename,mimeType:'application/json',purpose:'Issuer reference record · '+value.schema,base64:base64(json(value))});}
 function attach(ws,input){
  E.validateWorkspace(ws);const p=packet(input.text);
  const result=E.importSupportingFile(ws,{operationId:input.operationId,expectedRevision:input.expectedRevision,at:input.at,filename:input.filename||'Issuer_Accounting_Source.json',mimeType:'application/json',purpose:'Issuer reference record · '+PACKAGE,base64:base64(input.text)});
  return result;
 }
 function select(ws,input){
  const p=packageByFile(ws,input.packageFileId),value={schema:SELECTION,packageFileId:p.file.id,packageSha256:p.file.sha256,sourceEdition:p.packet.edition,sourceRevision:p.packet.revision,originals:retained(ws,input.originalFileIds),actor:actor(input.actor),note:note(input.note),at:input.at};
  return saveRecord(ws,{operationId:input.operationId,expectedRevision:input.expectedRevision,at:input.at},value,'Issuer_Source_Selection.json');
 }
 function selection(ws,id){
  const all=records(ws,SELECTION),selected=id?all.find(r=>r.file.id===id):all.at(-1);if(!selected)return null;
  const p=packageByFile(ws,selected.value.packageFileId);need(p.file.sha256===selected.value.packageSha256,'The selected complete issuer source differs.');for(const f of selected.value.originals){const actual=ws.supportingFiles.find(v=>v.id===f.id);need(actual?.sha256===f.sha256&&actual.bytes===f.bytes,'A selected supporting original differs.');}
  return {...selected,source:p};
 }
 function dataSelection(ws){
  const mappings=clone(ws.mappings),ids=new Set(Object.values(mappings).flatMap(o=>Object.values(o).map(m=>m.sourceId)));
  return {mappings,sources:ws.sources.filter(s=>ids.has(s.id)).map(s=>({id:s.id,sha256:s.sha256,role:s.role,domain:s.domain,filename:s.filename})),corrections:ws.corrections.filter(c=>ids.has(c.sourceId))};
 }
 function bindingOptions(ws,field,role){const[domain,name]=field.split('.'),m=ws.mappings[role]?.[domain],s=ws.sources.find(s=>s.id===m?.sourceId);if(!m||!s||m.columns[name]===undefined)return null;return {role,domain,field:name,sourceId:s.id,sourceSha256:s.sha256,mappingId:m.id,column:m.columns[name],header:s.headers[m.columns[name]],amount_multiplier:m.amount_multiplier};}
 function draft(ws,selectionId,policyId){
  const s=selection(ws,selectionId),p=s?.source.matrix.rows.find(r=>r.id===policyId);need(p,'Choose the original selected policy.');
  return {policyId,status:'pending',decision:'',actor:'',bindings:p.existing_domain_fields.flatMap(field=>['source','target'].map(role=>({field,role,state:'pending',reason:'',binding:null}))),additional:p.additional_original_annex_fields.map(name=>({name,state:'pending',fileId:null,locator:'',reason:''})),supportingFileIds:[]};
 }
 function validateReview(ws,s,review){
  const spec=s.source.matrix.rows.find(p=>p.id===review.policyId);need(spec,'This policy does not belong to the selected issuer source.');
  need(['pending','selected','not_applicable'].includes(review.status),'Choose an explicit policy decision.');actor(review.actor);note(review.decision);
  const expected=spec.existing_domain_fields.flatMap(field=>['source','target'].map(role=>role+':'+field));
  need(Array.isArray(review.bindings)&&review.bindings.length===expected.length&&new Set(review.bindings.map(b=>b.role+':'+b.field)).size===expected.length,'Retain every source and target policy-field decision.');
  for(const b of review.bindings){need(expected.includes(b.role+':'+b.field)&&['pending','mapped','not_used'].includes(b.state),'Choose each actual source/target field disposition.');if(b.state==='mapped'){need(JSON.stringify(b.binding)===JSON.stringify(bindingOptions(ws,b.field,b.role))&&b.binding!==null,'The selected original mapping changed; review '+b.role+' '+b.field);}else{need(b.binding===null,'An unbound policy field cannot retain a mapped target.');if(b.state==='not_used')note(b.reason);}}
  need(Array.isArray(review.additional)&&review.additional.length===spec.additional_original_annex_fields.length&&new Set(review.additional.map(a=>a.name)).size===review.additional.length,'Retain every requested additional source field.');
  for(const a of review.additional){need(spec.additional_original_annex_fields.includes(a.name)&&['pending','retained','not_used'].includes(a.state),'Choose each additional original-field disposition.');if(a.state==='retained'){retained(ws,[a.fileId]);note(a.locator);}else{need(a.fileId===null,'An unselected evidence field must not bind another file.');if(a.state==='not_used')note(a.reason);}}
  retained(ws,review.supportingFileIds);
 }
 function review(ws,input){
  E.validateWorkspace(ws);
  const previous=ws.operations.find(o=>o.id===input.operationId);
  if(previous){
   const file=ws.supportingFiles.find(f=>f.id===previous.supportingInputId);need(previous.kind==='import-supporting'&&file?.purpose==='Issuer reference record · '+REVIEW,'The original operation belongs to another source action.');
   const original=JSON.parse(decode(file.base64));need(original.selectionFileId===input.selectionFileId&&JSON.stringify(original.review)===JSON.stringify(input.review)&&original.at===input.at,'The original review request changed. Continue its exact selection, review and timestamp.');
   return E.importSupportingFile(ws,{operationId:input.operationId,expectedRevision:input.expectedRevision,at:input.at,filename:file.filename,mimeType:file.mimeType,purpose:file.purpose,base64:file.base64});
  }
  const s=selection(ws,input.selectionFileId);need(s,'Select an issuer edition first.');validateReview(ws,s,input.review);
  const value={schema:REVIEW,selectionFileId:s.file.id,selectionSha256:s.file.sha256,packageFileId:s.source.file.id,packageSha256:s.source.file.sha256,dataSelection:dataSelection(ws),dataBasis:hash(dataSelection(ws)),review:clone(input.review),supporting:retained(ws,input.review.supportingFileIds),at:input.at};
  return saveRecord(ws,{operationId:input.operationId,expectedRevision:input.expectedRevision,at:input.at},value,'Issuer_Policy_'+input.review.policyId+'_Review.json');
 }
 function assessment(ws){
  E.validateWorkspace(ws);const selections=records(ws,SELECTION),s=selection(ws),all=records(ws,REVIEW);
  if(!s)return{schema:'tjlabs.fixed-asset-issuer-assessment.v1',selected:false,ready:false,selections:selections.map(r=>({file:r.file.id,...r.value})),policies:[],history:all.map(r=>({file:r.file.id,...r.value}))};
  const basis=hash(dataSelection(ws));
  const policies=s.source.matrix.rows.map(spec=>{const editions=all.filter(r=>r.value.selectionFileId===s.file.id&&r.value.review.policyId===spec.id),last=editions.at(-1),v=last?.value,current=!!v&&v.dataBasis===basis;
   if(v){need(v.selectionSha256===s.file.sha256&&v.packageSha256===s.source.file.sha256,'A retained policy review changed its original source selection.');need(v.dataBasis===hash(v.dataSelection),'A retained policy review changed its original mapping selection.');}
   const pending=v?v.review.bindings.filter(b=>b.state==='pending').length+v.review.additional.filter(a=>a.state==='pending').length:spec.existing_domain_fields.length*2+spec.additional_original_annex_fields.length;
   return {policyId:spec.id,spec,reviewFileId:last?.file.id||null,review:v?.review||null,current,state:!v?'UNREVIEWED':!current?'STALE_MAPPING':v.review.status==='pending'||pending?'PENDING':v.review.status==='not_applicable'?'NOT_APPLICABLE':'SELECTED',pending,editionCount:editions.length,dataSelection:v?.dataSelection||null};
  });
  return {schema:'tjlabs.fixed-asset-issuer-assessment.v1',workspaceId:ws.id,revision:ws.revision,selected:true,ready:policies.every(p=>['SELECTED','NOT_APPLICABLE'].includes(p.state)),selectionFileId:s.file.id,selection:s.value,dataBasis:basis,policies,selections:selections.map(r=>({file:r.file.id,...r.value})),history:all.map(r=>({file:r.file.id,...r.value})),referenceCounts:{printedRows:s.source.tables.reduce((n,t)=>n+t.rows.length,0),normalizedCells:s.source.normalized.tables.reduce((n,t)=>n+t.rows.reduce((v,r)=>v+r.values.length,0),0),arithmeticChecks:s.source.arithmetic.checks.length,arithmeticDifferences:s.source.arithmetic.checks.filter(c=>c.status!=='MATCH').length},interpretation:'Issuer aggregate references and attributed policy/field decisions. Actual tenant identities, cutover dates, amount scales, complete population declarations and carrying equations remain explicitly selected in the original financial workspace.'};
 }
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function reportHTML(ws){
  const a=assessment(ws),s=selection(ws),table=(heads,rows)=>'<div class="table-wrap"><table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(typeof v==='object'?JSON.stringify(v,null,2):v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  let body='<h1>Issuer source and policy decisions</h1><p>'+esc(ws.title)+' · revision '+ws.revision+'</p><p>'+esc(a.interpretation||'No issuer reference is selected.')+'</p>';
  if(s){body+='<h2>Selected original edition</h2>'+table(['Source file','SHA-256','Edition','Reviewer','Scope'],[[s.source.file.filename,s.source.file.sha256,s.source.packet.edition,s.value.actor,s.value.note]])+'<h3>Selected supporting originals</h3>'+table(['Original','Bytes','SHA-256'],s.value.originals.map(f=>[f.filename,f.bytes,f.sha256]));
   for(const p of a.policies){body+='<section><h2>'+esc(p.policyId)+' · '+esc(p.state)+'</h2><p>'+esc(p.spec.source_policy_summary)+'</p><p>Source section '+esc(p.spec.section)+' · printed pages '+esc(p.spec.printed_pages.join(', '))+' · '+esc(p.spec.effective_period)+'</p>'+table(['Original policy values'],[[p.spec.original_values]])+'<p>'+esc(p.review?.actor||'Reviewer not recorded')+': '+esc(p.review?.decision||p.spec.owner_decision)+'</p>'+table(['Role','Field','Decision','Exact selected original mapping','Reason'],(p.review?.bindings||[]).map(b=>[b.role,b.field,b.state,b.binding,b.reason]))+table(['Additional original field','Decision','Original file','Exact locator','Reason'],(p.review?.additional||[]).map(f=>[f.name,f.state,f.fileId,f.locator,f.reason]))+'</section>';}
   body+='<h2>All published original tokens</h2>';
   for(const t of s.source.tables)body+='<section><h3>'+esc(t.id)+' · Note '+esc(t.note)+'</h3>'+table(['Section','Printed row','Published date',...t.column_labels],t.rows.map(r=>[r.section,r.label,r.reported_date,...r.reported_tokens]))+'</section>';
   body+='<h2>Separate normalized interpretations</h2>';for(const t of s.source.normalized.tables)body+=table(['Table','Original row','Column','Original token','Reported £000','GBP','Displayed-table arithmetic','Dash convention'],t.rows.flatMap(r=>r.values.map((v,i)=>[t.table_id,r.label,t.column_labels[i],v.original_token,v.reported_thousands,v.gbp,v.table_arithmetic_thousands,v.dash_interpretation])));
   body+='<h2>Every original arithmetic check</h2>'+table(['Table','Check','Description','Calculated £000','Published £000','Difference £000','State'],s.source.arithmetic.checks.map(c=>[c.table_id,c.id,c.detail,c.left_thousands,c.published_thousands,c.difference_thousands,c.status]))+'<p>'+esc(s.source.arithmetic.notes.join(' '))+'</p>';
  }
  body+='<h2>Complete selection and decision history</h2><details><summary>Every original saved selection and mapping-bound review</summary><pre>'+esc(json({selections:a.selections,history:a.history}))+'</pre></details>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Issuer source and policy decisions</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#202020;max-width:1240px;margin:28px auto;padding:0 20px}h1,h2,h3{line-height:1.25}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}.table-wrap{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}section{margin:28px 0}@media print{details>*{display:block}body{max-width:none;margin:0}.table-wrap{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}}</style></head><body>'+body+'</body></html>';
 }
 function handover(ws,basePacket){
  const out=basePacket||E.buildHandover(ws),a=assessment(ws),add=(path,type,text)=>out.files.push({path,type,text,...H.sha256Utf8(text)});
  add('issuer/assessment.json','application/json',json(a));add('issuer/Issuer_Source_and_Policy_Report.html','text/html;charset=utf-8',reportHTML(ws));
  for(const item of packages(ws))for(const f of item.packet.files)add('issuer/originals/'+item.file.id+'/'+f.path,media(f.path),f.content);
  const native=out.files.find(f=>f.path==='MANIFEST.json');out.files=out.files.filter(f=>f!==native);out.manifest={...out.manifest,issuerReference:{selected:a.selected,ready:a.ready,selectionFileId:a.selectionFileId||null},files:out.files.map(({text,base64,...f})=>f)};
  add('MANIFEST.json','application/json',json(out.manifest));return out;
 }
 return {textIdentity:H.sha256Utf8,PACKAGE,SELECTION,REVIEW,packet,parseInput,attach,select,review,selection,packages,draft,assessment,dataSelection,bindingOptions,reportHTML,handover,bytes,base64,decode};
}
