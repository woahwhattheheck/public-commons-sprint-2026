export function createIssuerUI(C){
 const {A,E,esc,table,options,button,download,wire,now}=C;
 const ws=()=>C.workspace(),drafts=()=>C.drafts();
 let packageId='',policyId='',view='policies';
 function model(){
  const a=A.assessment(ws());if(!a.selected)return null;
  if(!policyId||!a.policies.some(p=>p.policyId===policyId))policyId=a.policies[0].policyId;
  const key=a.selectionFileId+':'+policyId,p=a.policies.find(p=>p.policyId===policyId);
  drafts().issuer??={};if(!drafts().issuer[key])drafts().issuer[key]={basis:p.current?a.dataBasis:null,review:p.review?JSON.parse(JSON.stringify(p.review)):A.draft(ws(),a.selectionFileId,policyId)};
  return {a,p,key,draft:drafts().issuer[key]};
 }
 function originalOptions(current){return options([['','Choose retained original'],...ws().supportingFiles.filter(f=>!f.purpose.startsWith('Issuer reference record')).map(f=>[f.id,f.filename+' · '+f.sha256.slice(0,12)])],current||'');}
 function mappedLabel(b){return b?b.sourceId+' · mapping '+b.mappingId+' · column '+(b.column+1)+': '+b.header:'No current mapped column';}
 function render(){
  const packs=A.packages(ws()),a=A.assessment(ws()),s=A.selection(ws());
  if(!packs.some(p=>p.file.id===packageId))packageId=s?.source.file.id||packs.at(-1)?.file.id||'';
  let out='<section class="panel"><h2>Issuer reference and owner decisions</h2><p>Keep published class-level accounting references separate from actual asset, book, movement and journal records. Receive the complete source carrier; select its edition, original PDF/workbooks and source-owner scope. Every policy decision links the actual selected source and returned-target header occurrence.</p><div class="toolbar"><label>Complete source JSON or saved Canvas<input id="issuer-input" type="file" accept=".json,.md,.txt,application/json,text/plain,text/markdown"></label>'+button('issuer-import','Retain complete issuer edition')+'</div><p class="muted">The complete original carrier and all members travel through Exit. A Canvas is decoded locally. Original PDF and native workbooks can be added under Exit files and selected below.</p></section>';
  if(!packs.length)return out;
  out+='<section class="panel"><h3>Select reference edition</h3><label>Retained source edition<select id="issuer-package">'+options(packs.map(p=>[p.file.id,p.file.filename+' · '+p.packet.edition+' / '+p.packet.revision+' · '+p.file.sha256.slice(0,12)]),packageId)+'</select></label>';
  const chosen=packs.find(p=>p.file.id===packageId);
  out+='<p class="id">Complete source SHA-256 '+esc(chosen.file.sha256)+'</p><div class="fields"><label>Source owner / reviewer<input id="issuer-actor" value="'+esc(drafts().issuerActor||'')+'"></label><label>Source scope, actual period and edition reason<textarea id="issuer-note" rows="4">'+esc(drafts().issuerNote||'')+'</textarea></label></div><fieldset><legend>Complete supporting originals for this selection</legend>'+ws().supportingFiles.filter(f=>!f.purpose.startsWith('Issuer reference record')).map(f=>'<label class="confirm"><input type="checkbox" data-issuer-original="'+esc(f.id)+'" '+((drafts().issuerOriginals||[]).includes(f.id)?'checked':'')+'> '+esc(f.filename)+' · '+esc(f.sha256.slice(0,16))+'</label>').join('')+'</fieldset><div class="toolbar">'+button('issuer-select','Save selected reference and scope')+button('issuer-original','Download complete source carrier')+button('issuer-reader','Download original source reader')+'</div><p>Saving a new selection preserves every earlier edition and starts its own policy decisions. The actual financial basis is reviewed after source and policy selections are finished.</p></section>';
  if(!s)return out;
  out+='<section class="panel"><h3>Current selection</h3><p>'+esc(s.value.actor)+' · '+esc(s.value.note)+'</p><p>'+a.referenceCounts.printedRows+' printed rows · '+a.referenceCounts.normalizedCells+' normalized values · '+a.referenceCounts.arithmeticChecks+' arithmetic checks · '+a.referenceCounts.arithmeticDifferences+' retained differences</p><div class="toolbar"><label>Reference view<select id="issuer-view">'+options([['policies','Policy and field choices'],['tables','Published tables and separate normalization'],['arithmetic','Every arithmetic check'],['history','Complete decision history']],view)+'</select></label>'+button('issuer-report','Download complete issuer report')+button('issuer-assessment','Download full decision JSON')+'</div></section>';
  if(view==='tables'){
   for(const t of s.source.tables){out+='<section class="panel"><h3>'+esc(t.id)+' · Note '+esc(t.note)+'</h3><p>Original printed tokens; annual movement dates remain absent.</p>'+table(['Section','Printed row','Published date',...t.column_labels],t.rows.map(r=>[esc(r.section),esc(r.label),esc(r.reported_date??'Not published'),...r.reported_tokens.map(esc)]))+'</section>';}
   for(const t of s.source.normalized.tables)out+='<section class="panel"><h3>'+esc(t.table_id)+' · separate numeric interpretation</h3>'+table(['Row','Column','Original','£000','GBP','Arithmetic-only value','Dash convention'],t.rows.flatMap(r=>r.values.map((v,i)=>[esc(r.label),esc(t.column_labels[i]),esc(v.original_token),esc(v.reported_thousands??'null'),esc(v.gbp??'null'),esc(v.table_arithmetic_thousands),esc(v.dash_interpretation||'')])) )+'</section>';
  }else if(view==='arithmetic'){
   out+='<section class="panel"><h3>Complete issuer arithmetic</h3><p>'+esc(s.source.arithmetic.notes.join(' '))+'</p>'+table(['Table','Check','Description','Calculated £000','Published £000','Difference £000','State'],s.source.arithmetic.checks.map(c=>[c.table_id,c.id,c.detail,c.left_thousands,c.published_thousands,c.difference_thousands,c.status].map(esc)))+'</section>';
  }else if(view==='history'){
   out+='<section class="panel"><h3>Every saved selection and policy edition</h3>'+table(['Kind','Original record','Reviewer','Decision'],[...a.selections.map(v=>['Source selection',v.file,v.actor,v.note]),...a.history.map(v=>['Policy '+v.review.policyId,v.file,v.review.actor,v.review.decision])].map(r=>r.map(esc)))+'<details><summary>Complete original selection/mapping bindings</summary><pre>'+esc(JSON.stringify({selections:a.selections,history:a.history},null,2))+'</pre></details></section>';
  }else{
   const m=model(),r=m.draft.review,spec=m.p.spec;
   out+='<section class="panel"><h3>Policy decision status</h3>'+table(['Policy','Source policy','Status','Saved editions'],a.policies.map(p=>['<button data-issuer-policy="'+esc(p.policyId)+'">'+esc(p.policyId)+'</button>',esc(p.spec.source_policy_summary),esc(p.state),String(p.editionCount)]))+'</section>';
   out+='<section class="panel"><h3>'+esc(spec.id)+' · '+esc(spec.source_policy_summary)+'</h3><p>Source section '+esc(spec.section)+' · printed pages '+esc(spec.printed_pages.join(', '))+' · '+esc(spec.effective_period)+'</p><p>'+esc(spec.owner_decision)+'</p><details><summary>Complete original policy values</summary><pre>'+esc(JSON.stringify(spec.original_values,null,2))+'</pre></details><div class="fields"><label>Disposition<select id="issuer-decision">'+options([['pending','Pending owner selection'],['selected','Explicit policy selection'],['not_applicable','Not applicable to selected scope']],r.status)+'</select></label><label>Reviewer<input id="issuer-reviewer" value="'+esc(r.actor)+'"></label></div><label>Actual policy decision, period, scope and reason<textarea id="issuer-decision-note" rows="5">'+esc(r.decision)+'</textarea></label><p><strong>'+(m.draft.basis===a.dataBasis?'Draft is based on the current selected mappings.':'Review the current mapping context before saving this draft.')+'</strong></p>'+button('issuer-current-basis','Review context and refresh chosen mapping bindings');
   out+='<h4>Original source and returned-target fields</h4><p>“Mapped” binds the exact current source ID, mapping edition and original column number. “Not used” needs an explicit reason. A missing field remains pending; no published policy automatically changes financial mappings.</p>'+table(['Role / financial field','Current actual mapping','Choice','Reason'],r.bindings.map((b,i)=>{const candidate=A.bindingOptions(ws(),b.field,b.role);return[esc(b.role)+' · '+esc(b.field),'<span class="id">'+esc(mappedLabel(candidate))+'</span>','<select data-issuer-binding="'+i+'">'+options([['pending','Pending'],...(candidate?[['mapped','Bind this exact mapped column']]:(b.state==='mapped'?[['mapped','Previous mapping absent — review required']]:[])),['not_used','Not used in this scope']],b.state)+'</select>','<textarea data-issuer-binding-reason="'+i+'" rows="2">'+esc(b.reason)+'</textarea>'];}));
   out+='<h4>Additional original accounting fields</h4><p>Retain the actual dictionary, workbook, policy or source extract under Exit files. Record its sheet, field/header occurrence, record or page locator. Unavailable input remains pending.</p>'+table(['Original field','Choice','Complete retained original','Exact locator','Reason'],r.additional.map((f,i)=>[esc(f.name),'<select data-issuer-additional="'+i+'">'+options([['pending','Pending'],['retained','Retained original'],['not_used','Not used in this scope']],f.state)+'</select>','<select data-issuer-file="'+i+'">'+originalOptions(f.fileId)+'</select>','<textarea data-issuer-locator="'+i+'" rows="2">'+esc(f.locator)+'</textarea>','<textarea data-issuer-extra-reason="'+i+'" rows="2">'+esc(f.reason)+'</textarea>']));
   out+='<label class="confirm"><input id="issuer-confirm" type="checkbox"> I have reviewed this original source policy, the selected mapping context and every saved disposition.</label><div class="toolbar">'+button('issuer-save-review','Save attributed policy decision')+button('issuer-draft','Download complete unfinished decision')+'</div><p>Saving preserves this full edition and invalidates an earlier financial-basis declaration through the existing supporting-source history. Review Financial basis after the selected source and all policy decisions are complete.</p></section>';
  }
  return out;
 }
 async function inflate(compressed,limit){
  if(typeof DecompressionStream!=='function')throw Error('This browser cannot decode the original Canvas. Choose its complete decoded JSON carrier.');
  const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')),reader=stream.getReader(),chunks=[];let n=0;
  try{while(true){const{done,value}=await reader.read();if(done)break;n+=value.length;if(n>limit)throw Error('The expanded source exceeds32 MiB.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const out=new Uint8Array(n);let at=0;for(const b of chunks){out.set(b,at);at+=b.length;}return out;
 }
 function wireAll(){
  const $=s=>document.querySelector(s),dirty=()=>{C.dirty();const confirm=$('#issuer-confirm');if(confirm)confirm.checked=false;};
  const input=(id,fn)=>{const n=$('#'+id);if(n)n.oninput=()=>{fn(n);dirty();};};
  const packs=A.packages(ws()),a=A.assessment(ws());
  wire('issuer-import',async()=>{
   const file=$('#issuer-input').files[0];if(!file)throw Error('Choose the complete issuer source carrier.');
   const raw=await C.fileText(file,E.LIMITS.supportingBytes),parsed=await A.parseInput(raw,inflate),at=now(),op=crypto.randomUUID();
   await C.change(meta=>{let result=A.attach(ws(),{...meta,at,filename:parsed.originalTransport?'Issuer_Accounting_Source.json':file.name,text:parsed.text});if(parsed.originalTransport)result=E.importSupportingFile(result.workspace,{operationId:op,expectedRevision:result.workspace.revision,at,filename:file.name,mimeType:'text/markdown',purpose:'Original issuer source transport; decoded complete source retained separately',base64:A.base64(raw)});return result;});
  });
  const packageControl=$('#issuer-package');if(packageControl)packageControl.onchange=()=>{packageId=packageControl.value;C.render();};
  input('issuer-actor',n=>drafts().issuerActor=n.value);input('issuer-note',n=>drafts().issuerNote=n.value);
  document.querySelectorAll('[data-issuer-original]').forEach(n=>n.onchange=()=>{drafts().issuerOriginals=[...document.querySelectorAll('[data-issuer-original]:checked')].map(x=>x.dataset.issuerOriginal);dirty();});
  wire('issuer-select',async()=>{const actor=$('#issuer-actor').value,note=$('#issuer-note').value,originalFileIds=[...document.querySelectorAll('[data-issuer-original]:checked')].map(x=>x.dataset.issuerOriginal),chosen=packageId;await C.change(meta=>A.select(ws(),{...meta,at:now(),packageFileId:chosen,actor,note,originalFileIds}));});
  wire('issuer-original',()=>{const p=packs.find(p=>p.file.id===packageId);download(p.file.filename,p.text,'application/json');});
  wire('issuer-reader',()=>{const p=packs.find(p=>p.file.id===packageId),file=p.by['EA_Accounting_Source_Reader.html'];if(!file)throw Error('This edition has no original reader.');download(file.path,file.content,'text/html;charset=utf-8');});
  const chooser=$('#issuer-view');if(chooser)chooser.onchange=()=>{view=chooser.value;C.render();};
  wire('issuer-report',()=>download('Issuer_Source_and_Policy_Report.html',A.reportHTML(ws()),'text/html;charset=utf-8'));
  wire('issuer-assessment',()=>download('Issuer_Policy_Assessment.json',JSON.stringify(A.assessment(ws()),null,2)+'\n'));
  document.querySelectorAll('[data-issuer-policy]').forEach(n=>n.onclick=()=>{policyId=n.dataset.issuerPolicy;C.render();});
  if(!a.selected||view!=='policies')return;
  const m=model(),r=m.draft.review;
  input('issuer-decision',n=>r.status=n.value);input('issuer-reviewer',n=>r.actor=n.value);input('issuer-decision-note',n=>r.decision=n.value);
  wire('issuer-current-basis',()=>{m.draft.basis=a.dataBasis;for(const b of r.bindings)if(b.state==='mapped'){const current=A.bindingOptions(ws(),b.field,b.role);if(current)b.binding=current;else{b.state='pending';b.binding=null;}}dirty();C.render();});
  document.querySelectorAll('[data-issuer-binding]').forEach(n=>n.onchange=()=>{const b=r.bindings[Number(n.dataset.issuerBinding)];b.state=n.value;b.binding=b.state==='mapped'?A.bindingOptions(ws(),b.field,b.role):null;dirty();});
  document.querySelectorAll('[data-issuer-binding-reason]').forEach(n=>n.oninput=()=>{r.bindings[Number(n.dataset.issuerBindingReason)].reason=n.value;dirty();});
  document.querySelectorAll('[data-issuer-additional]').forEach(n=>n.onchange=()=>{const b=r.additional[Number(n.dataset.issuerAdditional)];b.state=n.value;if(b.state!=='retained')b.fileId=null;dirty();C.render();});
  document.querySelectorAll('[data-issuer-file]').forEach(n=>n.onchange=()=>{const b=r.additional[Number(n.dataset.issuerFile)];b.fileId=n.value||null;if(b.fileId)b.state='retained';dirty();});
  document.querySelectorAll('[data-issuer-locator]').forEach(n=>n.oninput=()=>{r.additional[Number(n.dataset.issuerLocator)].locator=n.value;dirty();});
  document.querySelectorAll('[data-issuer-extra-reason]').forEach(n=>n.oninput=()=>{r.additional[Number(n.dataset.issuerExtraReason)].reason=n.value;dirty();});
  wire('issuer-draft',()=>download('Issuer_'+r.policyId+'_Draft.json',JSON.stringify({schema:'tjlabs.fixed-asset-issuer-draft.v1',workspaceId:ws().id,selectionFileId:a.selectionFileId,...m.draft},null,2)+'\n'));
  wire('issuer-save-review',async()=>{if(!$('#issuer-confirm').checked)throw Error('Review and confirm the complete policy and original field decisions.');if(m.draft.basis!==A.assessment(ws()).dataBasis)throw Error('Review the current source and returned-target mapping context first.');const review=JSON.parse(JSON.stringify(r)),next=JSON.parse(JSON.stringify(drafts()));delete next.issuer[m.key];await C.change(meta=>A.review(ws(),{...meta,at:now(),selectionFileId:a.selectionFileId,review}),next);});
 }
 return{render,wire:wireAll};
}
