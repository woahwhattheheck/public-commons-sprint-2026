// MIT. Selected-version acceptance in the existing private document workspace.
export function installDocumentComparison({root,documentAPI,busy,node,button,pre,keyValues,notice,workspaceId}){
 const panel=node('section',null,{class:'card'}),title=node('h2','Compare selected document versions'),
 help=node('p','Open the complete source and target captures for a selected migration cohort. Review exact content and mapped fields, record dispositions, and download a complete package that another operator can reopen.'),
 tools=node('div',null,{class:'toolbar'}),sourceFile=node('input',null,{type:'file',accept:'.json,application/json'}),deliveryFile=node('input',null,{type:'file',accept:'.json,application/json'}),
 selection=node('textarea',null,{rows:12,spellcheck:'false','aria-label':'Selected document pairs and field mapping'}),
 inventory=node('p','No complete comparison source is open.'),status=node('p','Open a source package or the authored example.'),results=node('div'),reviewer=node('input',null,{type:'text',maxlength:200,placeholder:'Reviewer name','aria-label':'Reviewer name'});
 const sourceLabel=node('label','Open complete comparison source '),deliveryLabel=node('label','Reopen complete receiving package ');
 sourceLabel.append(sourceFile);deliveryLabel.append(deliveryFile);
 let workspace=null,generation=0,originalText=null,originalSelection=null,source=null,report=null,reviewText=null,reviewFingerprint=null,outputs=null;
 const workingDecisions=new Map(),rowControls=new Map(),bytes=s=>new TextEncoder().encode(s).length;
 function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type:type+';charset=utf-8'}));const a=node('a',null,{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function current(){if(!source)throw Error('Open a complete selected cohort first.');if(selection.value===originalSelection)return originalText;return JSON.stringify({...source,selectionText:selection.value},null,2)+'\n';}
 function rememberRows(){for(const [key,v]of rowControls)workingDecisions.set(key,{key,decision:v.choice.value,note:v.note.value});}
 function changed(){rememberRows();generation++;report=null;outputs=null;reviewText=null;reviewFingerprint=null;rowControls.clear();results.replaceChildren(node('p','Preview the current selection before recording dispositions.'));status.textContent='Selection changed. The complete original captures remain retained.';}
 selection.addEventListener('input',changed);
 function loadSource(text){if(bytes(text)>64*1024*1024)throw Error('Complete selected source limit is64 MiB.');const p=JSON.parse(text);if(p.schema!=='stellar-forge.document-comparison-source.v1'||typeof p.selectionText!=='string'||!Array.isArray(p.members))throw Error('Select the complete original comparison source.');workingDecisions.clear();reviewer.value='';rowControls.clear();source=p;originalText=text;originalSelection=p.selectionText;selection.value=p.selectionText;changed();inventory.textContent=p.members.length+' full capture members retained. All member bytes and selected identities are checked during preview.';}
 function originalPairFile(pairKey,side,contentOnly){
 const p=JSON.parse(current()),selected=JSON.parse(p.selectionText).pairs.find(x=>x.key===pairKey),name=selected?.[side+'Member'];
 if(!name)throw Error('This selected side has no observed capture.');
 const member=p.members.find(x=>x.name===name);if(!member)throw Error('Original capture is absent.');
 const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Uint8Array.from(atob(member.contentBase64),c=>c.charCodeAt(0)));
 if(!contentOnly){download(name,raw);return;}
 const capture=JSON.parse(raw),body=capture.reads.find(x=>x.role==='content')?.body,metadata=capture.reads.find(x=>x.role==='selected-before')?.body;
 if(!body||!metadata)throw Error('Complete original content is absent.');
 const version=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Uint8Array.from(atob(metadata.contentBase64),c=>c.charCodeAt(0)))).entry;
 const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(body.contentBase64),c=>c.charCodeAt(0))],{type:body.mediaType??'application/octet-stream'})),
 a=node('a',null,{href:url,download:side+'-'+version.name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function reviewChanged(){rememberRows();outputs=null;reviewText=null;reviewFingerprint=null;}
 reviewer.addEventListener('input',reviewChanged);
 function renderReport(value,savedReview=null){
  rememberRows();if(savedReview){workingDecisions.clear();for(const d of savedReview.decisions)workingDecisions.set(d.key,d);}
  report=value;results.replaceChildren();rowControls.clear();
  results.append(keyValues([['Selected',value.counts.selected],['Matching',value.counts.matched],['Need review',value.counts.reviewRequired],['Not observed',value.counts.notObserved],['Complete source SHA-256',value.source.sha256]]),node('p',value.scopeNote));
  const table=node('table'),head=node('thead'),hr=node('tr');for(const h of ['Pair / document','Observed result','Disposition','Review note'])hr.append(node('th',h));head.append(hr);table.append(head);const body=node('tbody'),saved=workingDecisions;
  for(const row of value.rows){
   const tr=node('tr'),name=node('td'),observation=node('td'),choiceCell=node('td'),noteCell=node('td'),choice=node('select',null,{'aria-label':'Disposition for '+row.label}),note=node('textarea',null,{rows:2,maxlength:4000,'aria-label':'Reason for '+row.label});
   name.append(node('strong',row.label),node('p',row.key));observation.append(node('p',row.status),node('p','Content: '+row.content.status));
   for(const [key,label,enabled]of [['UNREVIEWED','Unreviewed',true],['ACCEPT_MATCH','Accept observed match',row.status==='MATCH'],['ACCEPT_EXCEPTION','Accept documented exception',row.status==='REVIEW_REQUIRED'],['REJECT','Reject / return for correction',true]]){const option=node('option',label,{value:key});option.disabled=!enabled;choice.append(option);}
   choice.value=saved.get(row.key)?.decision??'UNREVIEWED';note.value=saved.get(row.key)?.note??'';choice.addEventListener('change',reviewChanged);note.addEventListener('input',reviewChanged);
   choiceCell.append(choice);noteCell.append(note);tr.append(name,observation,choiceCell,noteCell);body.append(tr);rowControls.set(row.key,{choice,note});
   const details=node('details'),summary=node('summary','Inspect full source and target observations');details.append(summary,pre({source:row.source,target:row.target,content:row.content,fields:row.fields}));
const files=node('div',null,{class:'toolbar'});
for(const side of ['source','target'])if(row[side+'Capture'])
 files.append(button('Download '+side+' capture',()=>originalPairFile(row.key,side,false)),
 button('Open '+side+' document file',()=>originalPairFile(row.key,side,true)));
details.append(files);const detailRow=node('tr'),detailCell=node('td',null,{colspan:'4'});detailCell.append(details);detailRow.append(detailCell);body.append(detailRow);
  }
  table.append(body);const scroll=node('div');scroll.style.overflowX='auto';scroll.append(table);results.append(scroll,node('p',value.method.consistency),node('p',value.method.scope));
  if(savedReview){reviewer.value=savedReview.reviewer;reviewText=JSON.stringify(savedReview,null,2)+'\n';reviewFingerprint=fingerprint();}
 }
 const fingerprint=()=>JSON.stringify({reviewer:reviewer.value,decisions:[...rowControls].map(([key,v])=>({key,decision:v.choice.value,note:v.note.value}))});
 async function preview(){
  const text=current(),epoch=++generation,result=await documentAPI('comparison-preview',{sourceText:text});
  if(epoch!==generation||text!==current())throw Error('Selected source changed while comparing; preview the current edition.');
  outputs=null;reviewText=null;reviewFingerprint=null;renderReport(result.report);status.textContent='Complete selected captures compared. Review each retained observation.';
 }
 async function prepareOutputs(){
  if(!report)throw Error('Preview the complete current selection first.');
  const text=current(),epoch=generation,frozen=fingerprint(),state=JSON.parse(frozen),anyReviewed=state.decisions.some(d=>d.decision!=='UNREVIEWED');
  if(anyReviewed&&reviewer.value.trim()==='')throw Error('Name the reviewer before recording dispositions.');
  if(frozen!==reviewFingerprint){reviewText=null;if(anyReviewed){const reportText=JSON.stringify(report,null,2)+'\n',digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(reportText)),reportSha256=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
   if(epoch!==generation||text!==current()||frozen!==fingerprint())throw Error('Review changed during preparation.');
   reviewText=JSON.stringify({schema:'stellar-forge.document-comparison-review.v1',sourceSha256:report.source.sha256,reportSha256,reviewer:reviewer.value,reviewedAt:new Date().toISOString(),decisions:state.decisions},null,2)+'\n';}reviewFingerprint=frozen;}
  const result=await documentAPI('comparison-delivery',{sourceText:text,reviewText});
  if(epoch!==generation||text!==current()||frozen!==fingerprint())throw Error('Source or review changed during export; export the current edition.');
  outputs=result;return result;
 }
 function workingDraft(){
 rememberRows();if(!source)throw Error('Open the complete original source before saving work.');
 return JSON.stringify({schema:'stellar-forge.document-comparison-working.v1',sourceText:originalText,selectionText:selection.value,reviewer:reviewer.value,decisions:[...workingDecisions.values()]},null,2)+'\n';
}
function reopenWorking(text){
 if(bytes(text)>96*1024*1024)throw Error('Working package limit is96 MiB.');
 const v=JSON.parse(text),keys=new Set(),choices=new Set(['UNREVIEWED','ACCEPT_MATCH','ACCEPT_EXCEPTION','REJECT']);
 if(v.schema!=='stellar-forge.document-comparison-working.v1'||typeof v.sourceText!=='string'||typeof v.selectionText!=='string'||bytes(v.selectionText)>1024*1024||typeof v.reviewer!=='string'||v.reviewer.length>200||!Array.isArray(v.decisions)||v.decisions.length>100)throw Error('Select the complete bounded working package.');
 for(const d of v.decisions){if(!d||typeof d.key!=='string'||!d.key||d.key.length>200||keys.has(d.key)||!choices.has(d.decision)||typeof d.note!=='string'||d.note.length>4000)throw Error('Invalid saved working disposition.');keys.add(d.key);}
 loadSource(v.sourceText);selection.value=v.selectionText;reviewer.value=v.reviewer;for(const d of v.decisions)workingDecisions.set(d.key,d);
 status.textContent='Working source, unfinished selection and review notes restored. Compare the current source before exporting a reviewed package.';
 results.replaceChildren(node('p',v.decisions.length+' unfinished dispositions retained. They are working text, not accepted results.'),pre(v.decisions));
}
const workingFile=node('input',null,{type:'file',accept:'.json,application/json'}),workingLabel=node('label','Reopen unfinished working package ');
workingLabel.append(workingFile);
workingFile.addEventListener('change',()=>busy('Reopen working comparison',async()=>{const file=workingFile.files[0];if(!file)return;const epoch=++generation;if(file.size>96*1024*1024)throw Error('Working package limit is96 MiB.');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());if(epoch!==generation)return;reopenWorking(text);workingFile.value='';}));
 tools.append(button('Download unfinished working package',()=>download('comparison-working.json',workingDraft())),button('Open authored comparison',async()=>{const epoch=++generation,r=await documentAPI('comparison-example',{});if(epoch!==generation)return;loadSource(r.sourceText);await preview();}),
 button('Compare complete selected source',preview),
 button('Download full comparison source',()=>download('comparison-source.json',current())),
 button('Download reviewed receiving package',async()=>{const r=await prepareOutputs();download('comparison-delivery.json',r.deliveryText);status.textContent='Complete source, observations and current dispositions downloaded. Reopen the package independently.';}),
 button('Download readable report',async()=>{const r=await prepareOutputs();download('comparison-report.html',r.html,'text/html');}),
 button('Download selected-pair CSV',async()=>{const r=await prepareOutputs();download('comparison-pairs.csv',r.pairsCSV,'text/csv');}),
 button('Download all mapped fields CSV',async()=>{const r=await prepareOutputs();download('comparison-fields.csv',r.fieldsCSV,'text/csv');}));
 sourceFile.addEventListener('change',()=>busy('Open complete comparison source',async()=>{const file=sourceFile.files[0];if(!file)return;const epoch=++generation;if(file.size>64*1024*1024)throw Error('Complete source limit is64 MiB.');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());if(epoch!==generation)return;loadSource(text);await preview();sourceFile.value='';}));
 deliveryFile.addEventListener('change',()=>busy('Independently reopen comparison delivery',async()=>{const file=deliveryFile.files[0];if(!file)return;const epoch=++generation;if(file.size>128*1024*1024)throw Error('Receiving package limit is128 MiB.');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer()),r=await documentAPI('comparison-receive',{deliveryText:text});if(epoch!==generation)return;loadSource(r.sourceText);renderReport(r.report,r.review);reviewText=r.reviewText;outputs={...r,deliveryText:text};status.textContent='Full original source and each report observation reproduced from the received package.';deliveryFile.value='';}));
 panel.append(title,help,sourceLabel,deliveryLabel,workingLabel,tools,node('h3','Selected pairs and field mapping'),selection,inventory,node('label','Reviewer for current dispositions'),reviewer,status,results);root.append(panel);
 return{render(){const id=workspaceId();if(id!==workspace){workspace=id;generation++;source=null;originalText=null;originalSelection=null;report=null;outputs=null;reviewText=null;reviewFingerprint=null;selection.value='';reviewer.value='';workingDecisions.clear();rowControls.clear();results.replaceChildren();inventory.textContent='No complete comparison source is open in this workspace.';status.textContent='Open its complete source or receiving package. Browser memory does not replace the downloaded original.';}}};
}
