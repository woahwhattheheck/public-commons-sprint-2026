// MIT. Europe PMC operator on the original Research listener.
const $=id=>document.getElementById(id), root='/api/europe-pmc', PAGE=30;
const tokenKey='research-dossiers-session:'+location.origin;
const state={token:'',workspace:null,selection:null,ns:null,queryId:null,query:null,operation:null,record:null,
  offset:0,next:null,comparisonOffset:0,comparisonNext:null,comparison:null,dossiers:[],dossier:null,busy:false,
  view:'query',poll:null,drafts:new Map(),fallback:new Map(),pending:new Map(),receipts:new Map(),db:null};
const terms='Europe PMC REST API: https://europepmc.org/RestfulWebService . Original provider, bibliographic, abstract and linked full-text rights remain with their respective sources; retain each record licence and attribution. Public availability does not grant a blanket licence for every record or linked document.';
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
 value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const clone=value=>structuredClone(value), guid=()=>crypto.randomUUID(), now=()=>new Date().toISOString();
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;};
const clear=node=>node.replaceChildren();
const button=(text,action,cls)=>{const node=el('button',text,cls);node.type='button';node.addEventListener('click',()=>task(action));return node;};
const detail=(title,value)=>{const node=el('details'),summary=el('summary',title);node.append(summary,el('pre',typeof value==='string'?value:JSON.stringify(value,null,2)));return node;};
const fields=value=>{const box=el('dl',undefined,'native-fields');for(const[name,item]of Object.entries(value))box.append(el('dt',name),el('dd',typeof item==='object'?JSON.stringify(item):item??'Not supplied'));return box;};
function show(message,error=false){$('notice').hidden=!message;$('notice').textContent=message;$('notice').className=error?'error':'success';}
function view(name){state.view=name;for(const key of ['query','records','comparison','receiving','history','pending'])$(key+'-panel').hidden=key!==name;
 for(const node of document.querySelectorAll('[data-view]'))node.setAttribute('aria-selected',String(node.dataset.view===name));}
function actor(){const value=$('actor').value.trim();if(!value)throw new Error('Enter the operator name before saving.');return value;}
async function sha(bytes){const value=bytes instanceof Blob?await bytes.arrayBuffer():bytes instanceof ArrayBuffer?bytes:new TextEncoder().encode(bytes);
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function download(name,body,type='application/json'){const blob=body instanceof Blob?body:new Blob([typeof body==='string'?body:JSON.stringify(body,null,2)+'\n'],{type});
 const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function response(path,{method='GET',body,binary,selection=state.selection?.library}={}){
 const url=new URL(path,location.origin);if(url.origin!==location.origin)throw new Error('The request must use this Research listener.');
 const headers={Authorization:'Bearer '+state.token,...(path.startsWith(root)&&selection?{'X-Europe-Pmc-Selection':selection}:{})};
 if(binary)headers['Content-Type']='application/octet-stream';else if(body!==undefined)headers['Content-Type']='application/json';
 const result=await fetch(url,{method,headers,body:binary??(body===undefined?undefined:JSON.stringify(body)),credentials:'omit',redirect:'error',cache:'no-store'});
 if(!result.ok){let value={};try{value=await result.json();}catch{}const error=Object.assign(new Error(value.error||'HTTP_'+result.status),{code:value.error||'HTTP_'+result.status,status:result.status});
 if(result.status===401){$('connect').hidden=false;show('Open the original Research connection.',true);}throw error;}return result;
}
async function api(path,options){return (await response(path,options)).json();}
async function file(path,name,selection){const result=await response(path,{selection});const blob=await result.blob();download(name,blob);return {bytes:blob.size,sha256:await sha(blob)};}
async function task(work){if(state.busy)return;state.busy=true;document.documentElement.setAttribute('aria-busy','true');
 try{return await work();}catch(error){show(error.message||String(error),true);console.error(error.code||error.message);}
 finally{state.busy=false;document.documentElement.removeAttribute('aria-busy');}}
function openDatabase(){return new Promise((accept,reject)=>{const request=indexedDB.open('research-europe-pmc-v1',1);
 request.onupgradeneeded=()=>{for(const name of ['drafts','pending','receipts'])request.result.createObjectStore(name,{keyPath:'key'});};
 request.onsuccess=()=>accept(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close another browser tab upgrading literature storage.'));});}
function transaction(store,mode,work){if(!state.db)return Promise.reject(new Error('Browser storage is unavailable; download the retained browser work before closing.'));
 return new Promise((accept,reject)=>{const tx=state.db.transaction(store,mode),value=work(tx.objectStore(store));tx.oncomplete=()=>accept(value?.result);
 tx.onerror=()=>reject(tx.error||new Error('Browser storage failed.'));tx.onabort=()=>reject(tx.error||new Error('Browser storage was interrupted.'));});}
const fullKey=(kind,id,ns=state.ns)=>ns+'|'+kind+'|'+id;
const writes=new Map();
async function serializeWrite(key,action){const previous=writes.get(key)??Promise.resolve(),work=previous.catch(()=>{}).then(action);
 writes.set(key,work);try{return await work;}finally{if(writes.get(key)===work)writes.delete(key);}}
async function commit(store,value){return serializeWrite(value.key,()=>transaction(store,'readwrite',target=>target.put(value)));}
function keepDraft(id,value){const key=fullKey('draft',id),draft={key,ns:state.ns,id,editVersion:guid(),updatedAt:now(),value:clone(value)};
 state.drafts.set(key,draft);state.fallback.set(key,{kind:'drafts',record:draft});
 commit('drafts',draft).then(()=>{if(state.fallback.get(key)?.record.editVersion===draft.editVersion)state.fallback.delete(key);})
 .catch(error=>{show('The full draft remains in this tab: '+error.message,true);});return draft;}
function getDraft(id){return state.drafts.get(fullKey('draft',id))??null;}
async function removeDraft(draft){if(!draft||state.drafts.get(draft.key)?.editVersion!==draft.editVersion)return;
 const removed=await serializeWrite(draft.key,async()=>{
  if(state.drafts.get(draft.key)?.editVersion!==draft.editVersion)return false;
  const saved=await transaction('drafts','readwrite',store=>{const request=store.get(draft.key);
   request.onsuccess=()=>{if(!request.result||request.result.editVersion===draft.editVersion)store.delete(draft.key);};return request;});
  return !saved||saved.editVersion===draft.editVersion;
 });
 if(removed&&state.drafts.get(draft.key)?.editVersion===draft.editVersion){state.drafts.delete(draft.key);
  if(state.fallback.get(draft.key)?.record.editVersion===draft.editVersion)state.fallback.delete(draft.key);}}
async function loadBrowser(){for(const name of ['drafts','pending','receipts']){let rows=[];try{rows=await transaction(name,'readonly',store=>store.getAll());}
 catch(error){show(error.message,true);}
 const map=name==='drafts'?state.drafts:name==='pending'?state.pending:state.receipts;for(const row of rows??[])if(!state.fallback.has(row.key))map.set(row.key,row);}
 for(const {kind,record}of state.fallback.values())(kind==='drafts'?state.drafts:kind==='pending'?state.pending:state.receipts).set(record.key,record);
 renderPendingCount();}
function renderPendingCount(){$('pending-count').textContent=[...state.pending.values()].filter(row=>row.ns===state.ns).length;}
async function savePending(row){state.pending.set(row.key,row);state.fallback.set(row.key,{kind:'pending',record:row});
 await commit('pending',row);if(state.fallback.get(row.key)?.record===row)state.fallback.delete(row.key);renderPendingCount();}
async function executePending(row){if(row.ns!==state.ns)throw new Error('Reopen this request’s original library before continuing it.');
 row={...row,status:'DISPATCHING',lastAttemptAt:now()};await savePending(row);
 let result;try{result=await api(row.path,{method:'POST',body:row.body,binary:row.binary,selection:row.selection});}
 catch(error){await savePending({...row,status:error.status?'FAILED':'UNKNOWN',error:error.message}).catch(()=>{});throw error;}
 const receipt={key:fullKey('receipt',row.id,row.ns),ns:row.ns,id:row.id,path:row.path,intent:row.intent,completedAt:now(),result};
 state.receipts.set(receipt.key,receipt);state.fallback.set(receipt.key,{kind:'receipts',record:receipt});
 await commit('receipts',receipt);state.fallback.delete(receipt.key);
 await transaction('pending','readwrite',store=>store.delete(row.key));state.pending.delete(row.key);state.fallback.delete(row.key);renderPendingCount();return result;
}
async function perform(path,body,{intent=path,binary=null,id=body?.requestId??'epmc-'+guid()}={}){
 const comparable=clone(body??null);if(comparable)delete comparable.requestId;
 const signature=canonical({path,body:comparable,binary:binary?{bytes:binary.size,sha256:await sha(binary)}:null});
 const old=[...state.pending.values()].find(row=>row.ns===state.ns&&row.intent===intent&&!['FAILED','CANCELLED'].includes(row.status));
 if(old){if(old.signature!==signature)throw new Error('Resolve the saved request for this action before sending changed input. Open Saved requests.');return executePending(old);}
 const selected=state.selection?.library,payload=body?clone(body):undefined;
 const row={key:fullKey('pending',id),ns:state.ns,id,intent,signature,path,body:payload??null,binary,selection:selected,status:'PREPARED',createdAt:now()};
 await savePending(row);return executePending(row);
}
async function exportBrowser(){const rows={schema:'stellar-forge.europe-pmc-browser-recovery.v1',createdAt:now(),workspaceId:state.workspace?.id,
 drafts:[...state.drafts.values()],receipts:[...state.receipts.values()],pending:[]};
 for(const row of state.pending.values()){const copy={...row};if(copy.binary){copy.binaryBase64=await base64(copy.binary);delete copy.binary;}rows.pending.push(copy);}
 download('Europe_PMC_Browser_Recovery.json',rows);}
addEventListener('beforeunload',event=>{if(state.fallback.size){event.preventDefault();event.returnValue='';}});
async function switchNamespace(workspace){const selected=workspace.selection.library,ns=workspace.id+':'+selected;
 if(state.ns!==ns){state.ns=ns;state.selection=workspace.selection;state.queryId=null;state.query=null;state.operation=null;state.record=null;state.offset=0;await loadBrowser();}
 state.workspace=workspace;state.selection=workspace.selection;}
function setSelect(node,items,value){node.replaceChildren();for(const row of items){const option=el('option',row.label);option.value=row.value;node.append(option);}
 if(items.some(row=>row.value===value))node.value=value;}
async function refresh({append=false,retainView=true}={}){
 const data=await api(root+(append?'?offset='+state.workspace.nextOffset+'&limit='+PAGE:'?limit='+PAGE),{selection:append?state.selection?.library:null});
 if(append){data.operations=[...state.workspace.operations,...data.operations];}const previousNamespace=state.ns,previousView=state.view;await switchNamespace(data);
 if(previousNamespace!==state.ns){await openQuery(null);if(retainView)view(previousView);}
 $('connection').textContent='Workspace '+data.id.slice(4,12)+' · revision '+data.revision;
 $('subtitle').textContent=data.receiving?'Received copy · '+data.receiving.archiveSha256.slice(0,12):'Saved source searches in the original Research workspace';
 renderLists();
 if(state.operation){try{state.operation=await api(root+'/operations/'+encodeURIComponent(state.operation.plan.id));}catch(error){show(error.message,true);}}
 renderOperation();if(state.view==='records'&&state.operation?.operation.phase==='READY')await loadRecords();
 if(state.view==='history')await renderHistory();if(state.view==='pending')renderPending();
 schedulePoll();if(!retainView)view('query');
}
function renderLists(){
 clear($('queries'));for(const query of state.workspace.queries){const node=button(query.title,()=>openQuery(query.id),'side-item');
 node.append(el('small','Revision '+query.revision+' · '+query.selection.pageSize+' per page'));if(query.id===state.queryId)node.classList.add('selected');$('queries').append(node);}
 if(!state.workspace.queries.length)$('queries').append(el('p','No saved searches yet.','empty'));
 clear($('editions'));for(const item of state.workspace.operations){const node=button(item.plan.payload.label,()=>openOperation(item.plan.id),'side-item');
 node.append(el('small',item.operation.phase+(item.interrupted?' · interrupted':'')+(item.plan.payload.pagination.parent?' · continuation':'')));
 if(item.plan.id===state.operation?.plan.id)node.classList.add('selected');$('editions').append(node);}
 $('more-editions').hidden=state.workspace.nextOffset===null;
 const choices=state.workspace.queries.flatMap(query=>query.versions.map(version=>({value:query.id+':'+version.revision,label:version.title+' · revision '+version.revision})));
 setSelect($('run-query'),choices,$('run-query').value);
 const editions=state.workspace.operations.filter(row=>row.operation.phase==='READY').map(row=>({value:row.plan.id,label:row.plan.payload.label}));
 setSelect($('compare-before'),editions,$('compare-before').value);setSelect($('compare-after'),editions,$('compare-after').value||editions.at(-1)?.value);
}
function queryDraftId(){return 'query:'+(state.queryId??'new');}
function queryInput(){return {id:state.queryId,expectedRevision:Number($('query-form').dataset.baseRevision??0),title:$('query-title').value,
 selection:{query:$('query-text').value,pageSize:Number($('page-size').value),maxPages:Number($('max-pages').value),synonym:$('synonyms').checked},sourceTerms:$('source-terms').value};}
function saveQueryDraft(){if(!state.ns)return;keepDraft(queryDraftId(),queryInput());$('query-draft-status').textContent='Full draft retained in this browser.';}
async function openQuery(queryId=null){state.queryId=queryId;state.query=queryId?await api(root+'/queries/'+encodeURIComponent(queryId)):null;
 const draft=getDraft(queryDraftId()),value=draft?.value??{id:queryId,expectedRevision:state.query?.revision??0,title:state.query?.title??'',
 selection:state.query?.selection??{query:'',pageSize:100,maxPages:1000,synonym:false},sourceTerms:state.query?.sourceTerms??terms};
 $('query-form').dataset.baseRevision=value.expectedRevision;$('query-title').value=value.title;$('query-text').value=value.selection.query;
 $('page-size').value=value.selection.pageSize;$('max-pages').value=value.selection.maxPages;$('synonyms').checked=value.selection.synonym;$('source-terms').value=value.sourceTerms;
 $('query-version').textContent=queryId?'Saved revision '+state.query.revision:'New saved search';$('query-draft-status').textContent=draft?'Draft based on revision '+value.expectedRevision:'';
 clear($('query-conflict'));$('query-conflict').hidden=!state.query||state.query.revision===value.expectedRevision;
 if(!$('query-conflict').hidden){$('query-conflict').append(el('p','The saved search has changed. Your complete draft still uses revision '+value.expectedRevision+'.'),
 detail('Current saved definition',state.query),button('Keep this draft on current revision',async()=>{$('query-form').dataset.baseRevision=state.query.revision;saveQueryDraft();await openQuery(queryId);}));}
 renderLists();view('query');
}
async function saveQuery(){const draft=getDraft(queryDraftId())??keepDraft(queryDraftId(),queryInput()),value=clone(draft.value);
 const input={requestId:'epmc-query-'+guid(),actor:actor(),expectedRevision:value.expectedRevision,title:value.title,selection:value.selection,sourceTerms:value.sourceTerms};
 if(value.id)input.id=value.id;
 try{const result=await perform(root+'/queries',input,{intent:draft.key+':'+draft.editVersion});await removeDraft(draft);await refresh();await openQuery(result.id);
 show('Saved search revision '+result.revision+'.');}
 catch(error){if(error.code?.includes('CONFLICT')&&state.queryId)await openQuery(state.queryId);throw error;}}
async function prepare(mode){const selected=$('run-query').value.split(':'),label=$('edition-label').value.trim();
 if(!selected[0]||!label)throw new Error('Select a saved revision and name the source edition.');
 const input={requestId:'epmc-edition-'+guid(),actor:actor(),queryId:selected[0],queryRevision:Number(selected[1]),label,mode};
 const result=await perform(root+'/operations',input,{intent:'prepare:'+selected.join(':')+':'+mode+':'+label});
 state.operation=result;await refresh();await openOperation(result.plan.id);
 if(mode==='live'){await start();}else show('File intake prepared. Add the original pages in cursor order.');}
async function openOperation(id){state.operation=await api(root+'/operations/'+encodeURIComponent(id));state.record=null;state.offset=0;
 renderLists();renderOperation();if(state.operation.operation.phase==='READY'){view('records');await loadRecords();}else view('query');schedulePoll();}
function coverageBox(coverage){const box=el('div',undefined,'coverage');box.append(el('strong',coverage.complete?'Complete retained search':coverage.parent?'Retained continuation part':'Partial retained search'));
 box.append(fields({Records:coverage.uniqueRecords,Pages:coverage.pages,'Reported total':coverage.reportedTotals.join(', '),
 'Stopping boundary':coverage.stopReason,'Original bytes':coverage.rawBytes,'Next cursor':coverage.nextCursorMark??'Provider exhausted'}));
 if(coverage.issues.length)box.append(detail('Coverage and consistency notes',coverage.issues));box.append(el('p',coverage.consistency));return box;}
function renderOperation(){const node=$('operation');clear(node);node.hidden=!state.operation;$('file-intake').hidden=!state.operation||state.operation.plan.payload.mode!=='documents'||state.operation.operation.phase==='READY';
 if(!state.operation)return;const {plan,operation,running,interrupted,boundary}=state.operation;
 node.append(el('h3',plan.payload.label),fields({Status:operation.phase+(interrupted?' · previous owner ended':''),Pages:operation.pages,
 'Query revision':plan.payload.query.revision,'Plan SHA256':plan.sha256,'Edition SHA256':operation.editionSha256??'Not yet sealed'}));
 if(operation.error)node.append(el('p',operation.error,'danger-text'));
 if(plan.payload.pagination.parent)node.append(detail('Original continuation binding',plan.payload.pagination.parent));
 if(boundary)node.append(detail('Next original page retained for continuation',boundary));
 const actions=el('div',undefined,'actions');
 if(plan.payload.mode==='live'&&operation.phase!=='READY')actions.append(button(running?'Inspect current acquisition':'Continue this acquisition',start));
 if(running)actions.append(button('Stop after retained pages',stop));
 if(!running&&operation.pages>0&&operation.phase!=='READY')actions.append(button('Seal retained partial edition',async()=>{
   await perform(root+'/operations/'+plan.id+'/seal',{expectedPlanSha256:plan.sha256},{intent:'seal:'+plan.id});await refresh();await openOperation(plan.id);}));
 if(operation.phase==='READY'){actions.append(button('Open records',async()=>{view('records');await loadRecords();}));
 if(!operation.coverage.terminal)actions.append(button('Continue from original next cursor',continueEdition));}
 node.append(actions);
}
async function start(){const selected=state.operation;if(!selected)return;await perform(root+'/operations/'+selected.plan.id+'/start',{expectedPlanSha256:selected.plan.sha256},{intent:'start:'+selected.plan.id});await refresh();schedulePoll();}
async function stop(){const selected=state.operation;if(!selected)return;await perform(root+'/operations/'+selected.plan.id+'/stop',{}, {intent:'stop:'+selected.plan.id});await refresh();}
async function continueEdition(){const old=state.operation,label=prompt('Name the next retained part',old.plan.payload.label+' · next part');if(!label)return;
 const result=await perform(root+'/operations/'+old.plan.id+'/continue',{requestId:'epmc-part-'+guid(),actor:actor(),label,
 expectedPlanSha256:old.plan.sha256,expectedEditionSha256:old.operation.editionSha256},{intent:'continue:'+old.plan.id+':'+label});
 await refresh();await openOperation(result.plan.id);if(result.plan.payload.mode==='live')await start();}
function schedulePoll(){clearTimeout(state.poll);state.poll=null;if(!state.workspace?.active.length&&!state.operation?.running)return;
 state.poll=setTimeout(async()=>{if(state.busy){schedulePoll();return;}try{await refresh();}catch(error){show(error.message,true);}},2000);}
function addPage(){const box=el('div',undefined,'page-input'),fileInput=el('input');fileInput.type='file';fileInput.accept='.json,application/json';
 const urlInput=el('input');urlInput.type='url';urlInput.placeholder='Original Europe PMC core JSON page URL';
 const fileLabel=el('label','Original JSON page'),urlLabel=el('label','Original page URL');fileLabel.append(fileInput);urlLabel.append(urlInput);
 box.append(fileLabel,urlLabel,button('Remove this page',()=>box.remove()));$('page-files').append(box);}
async function base64(blob){const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
async function importPages(){if(!state.operation)throw new Error('Prepare an original file intake first.');const packet=$('packet-file').files[0];let selected;
 if(packet){if(packet.size>48*1024*1024)throw new Error('The source packet exceeds48MiB.');selected=JSON.parse(await packet.text());
 if(selected.schema!=='stellar-forge.europe-pmc-import.v1')throw new Error('Select the complete Europe PMC import packet.');}
 else {const pages=[];for(const node of $('page-files').children){const inputs=node.querySelectorAll('input'),original=inputs[0].files[0],url=inputs[1].value.trim();
 if(!original||!url)throw new Error('Each page needs its original JSON file and source URL.');if(original.size>16*1024*1024)throw new Error('Each original page is limited to16MiB.');
 pages.push({url,bodyBase64:await base64(original),retainedAt:now(),provenance:{source:'operator-file-intake',filename:original.name,bytes:original.size,sha256:await sha(original)}});}
 selected={pages};}
 const input={expectedPlanSha256:state.operation.plan.sha256,stopReason:selected.stopReason??($('stop-reason').value||null),
 ...(selected.documents?{documents:selected.documents}:{pages:selected.pages})};
 const id=state.operation.plan.id;await perform(root+'/operations/'+id+'/import',input,{intent:'import:'+id});await refresh();await openOperation(id);show('Original pages retained and source edition sealed.');}
async function loadRecords(){const selected=state.operation;if(!selected||selected.operation.phase!=='READY'){clear($('records'));$('records').append(el('p','Open a completed source edition.','empty'));return;}
 const query=new URLSearchParams({offset:String(state.offset),limit:String(PAGE),search:$('record-filter').value});
 const result=await api(root+'/operations/'+selected.plan.id+'/records?'+query);state.next=result.nextOffset;
 clear($('coverage'));$('coverage').append(coverageBox(result.coverage));
 if(selected.plan.payload.pagination.parent)$('coverage').append(button('Inspect complete continuation chain',async()=>{
   const chain=await api(root+'/operations/'+selected.plan.id+'/chain');$('coverage').append(detail('Retained query chain',chain));}));
 clear($('records'));for(const row of result.items){const node=button(row.title,()=>openRecord(row.id),'record-card');node.append(el('small',row.id+' · '+(row.doi??'No DOI')+' · '+(row.review?.decision??'Unreviewed')));$('records').append(node);}
 if(!result.items.length)$('records').append(el('p','No records match this retained edition.','empty'));
 $('record-page').textContent=(result.total?state.offset+1:0)+'–'+Math.min(state.offset+PAGE,result.total)+' of '+result.total;
 $('previous-records').disabled=state.offset===0;$('next-records').disabled=state.next===null;
 if(state.record)await openRecord(state.record.id);await renderSources();
}
async function renderSources(){clear($('source-pages'));if(!state.operation)return;const id=state.operation.plan.id,count=state.operation.operation.pages;
 const control=el('div',undefined,'actions'),number=el('input');number.type='number';number.min='1';number.max=String(count);number.value='1';number.setAttribute('aria-label','Original page number');
 const target=el('div'),inspect=async()=>{const index=Number(number.value)-1;if(!Number.isInteger(index)||index<0||index>=count)throw new Error('Select an original page from1 to'+count+'.');
 const source=await api(root+'/operations/'+id+'/source?index='+index+'&descriptor=true');clear(target);
 target.append(el('strong','Page '+(index+1)),fields({Source:source.url,Kind:source.kind,Bytes:source.bodyBytes,SHA256:source.bodySha256}),
 detail('Original observation and provenance',source),button('Download exact page JSON',()=>file(root+'/operations/'+id+'/source?index='+index,'Europe_PMC_Original_Page_'+(index+1)+'.json')));};
 control.append(el('span',count+' original pages'),number,button('Inspect selected original page',inspect));$('source-pages').append(control,target);
 if(count)await inspect();
 if(state.operation.boundary)$('source-pages').append(button('Download retained boundary page',()=>file(root+'/operations/'+id+'/source?index=0&boundary=true','Europe_PMC_Boundary_Page.json')));
}
async function openRecord(key){const result=await api(root+'/operations/'+state.operation.plan.id+'/records?key='+encodeURIComponent(key)+'&limit=1'),row=result.items[0];
 if(!row)throw new Error('The retained record is unavailable.');state.record=row;const container=$('record-detail');clear(container);
 container.append(el('h3',row.title),fields({Identity:row.id,DOI:row.doi??null,Authors:row.authors.join('; '),Published:row.publishedAt,
 Licence:row.metadata.licence,'Open access':row.metadata.openAccess}),el('h4','Original abstract'),el('div',row.content||'No abstract supplied.','abstract'));
 const link=el('a','Open original Europe PMC record');link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';container.append(link);
 container.append(detail('Complete native core record',row.metadata.europePmc),detail('Original source occurrences and variants',{occurrences:row.metadata.sourceOccurrences,variants:row.metadata.variants}));
 const draftId='record:'+state.operation.plan.id+':'+row.id,retained=getDraft(draftId),value=retained?.value??{operationId:state.operation.plan.id,
 editionSha256:state.operation.operation.editionSha256,recordKey:row.id,expectedRevision:row.review?.revision??0,decision:row.review?.decision??'uncertain',note:row.review?.note??''};
 const form=el('form'),decision=el('select'),note=el('textarea');decision.setAttribute('aria-label','Metadata triage decision');note.setAttribute('aria-label','Complete metadata triage note');note.rows=8;
 for(const option of ['include','exclude','uncertain','follow-up']){const node=el('option',option);node.value=option;decision.append(node);}decision.value=value.decision;note.value=value.note;
 let base=value.expectedRevision;
 const snapshot=()=>({...value,expectedRevision:base,decision:decision.value,note:note.value});
 const save=()=>keepDraft(draftId,snapshot());decision.addEventListener('change',save);note.addEventListener('input',save);
 const decisionLabel=el('label','Metadata triage'),noteLabel=el('label','Operator note');decisionLabel.append(decision);noteLabel.append(note);
 form.append(el('h4','Edition-bound metadata triage'),el('p','These operator decisions describe the retained records. Eligibility screening and scientific judgements remain with the review team.'),
 decisionLabel,noteLabel,el('p','Draft base revision '+base+' · saved review revision '+(row.review?.revision??0),'status'));
 if(base!==(row.review?.revision??0))form.append(detail('Current saved review',row.review),button('Keep draft on current review revision',async()=>{
 base=row.review?.revision??0;save();await openRecord(row.id);}));
 const submit=el('button','Save record decision','primary');submit.type='submit';form.append(submit,button('Discard this record draft',async()=>{await removeDraft(getDraft(draftId));await openRecord(row.id);}));
 form.addEventListener('submit',event=>{event.preventDefault();task(async()=>{const draft=getDraft(draftId)??save();
 try{await perform(root+'/reviews',{requestId:'epmc-review-'+guid(),actor:actor(),...draft.value},{intent:draft.key+':'+draft.editVersion});
 await removeDraft(draft);await loadRecords();show('Record decision saved with its original edition.');}
 catch(error){if(error.code?.includes('CONFLICT'))await openRecord(row.id);throw error;}});});
 container.append(form);if(row.review)container.append(detail('Complete review history',row.review.history));
}
async function compare(){const before=$('compare-before').value,after=$('compare-after').value;if(!before||!after)throw new Error('Select two complete retained editions.');
 const params=new URLSearchParams({before,after,offset:String(state.comparisonOffset),limit:String(PAGE),status:$('compare-status').value});
 const result=await api(root+'/comparison?'+params);state.comparison=result;state.comparisonNext=result.nextOffset;
 clear($('comparison-summary'));$('comparison-summary').append(fields(result.counts),el('p',result.queryScopeChanged?
 'The approved query scope changed. Added or absent records can follow from that search change.':'The query and synonym scope are unchanged.'),
 el('p',result.meaning),detail('Exact source selections and coverage',{before:result.before,after:result.after}));
 clear($('comparison'));for(const item of result.items){const node=el('article',undefined,'diff-card');node.append(el('h3',item.title),el('strong',item.status),el('p',item.key));
 for(const change of item.changes){const block=el('div',undefined,'diff-values');block.append(detail('Earlier · '+change.path,change.before??null),detail('Later · '+change.path,change.after??null));node.append(block);}
 if(item.before)node.append(detail('Earlier complete native record',item.before));if(item.after)node.append(detail('Later complete native record',item.after));$('comparison').append(node);}
 $('comparison-page').textContent=(result.total?state.comparisonOffset+1:0)+'–'+Math.min(state.comparisonOffset+PAGE,result.total)+' of '+result.total;
 $('previous-comparison').disabled=state.comparisonOffset===0;$('next-comparison').disabled=result.nextOffset===null;view('comparison');
}
async function exportComparison(){if(!state.comparison)await compare();const before=$('compare-before').value,after=$('compare-after').value,status=$('compare-status').value;
 let offset=0,all=[],first;do{const result=await api(root+'/comparison?'+new URLSearchParams({before,after,status,offset:String(offset),limit:'100'}));
 first??=result;if(first.before.sha256!==result.before.sha256||first.after.sha256!==result.after.sha256)throw new Error('The comparison source changed.');
 all.push(...result.items);offset=result.nextOffset;}while(offset!==null);
 download('Europe_PMC_Complete_Comparison.json',{...first,items:all,nextOffset:null});}
async function receiving(){view('receiving');clear($('receiving-edition'));if(!state.operation||state.operation.operation.phase!=='READY'){
 $('receiving-edition').append(el('p','Open a completed source edition.'));return;}
 $('receiving-edition').append(el('h3',state.operation.plan.payload.label),fields({Records:state.operation.operation.coverage.uniqueRecords,SHA256:state.operation.operation.editionSha256}));
 $('receive-label').value||=state.operation.plan.payload.label;
 state.dossiers=[];let offset=0,snapshot=null;
 do{const params=new URLSearchParams({offset:String(offset),limit:'100'});if(snapshot)params.set('snapshot',snapshot);
 const result=await api('/api/dossiers?'+params);snapshot??=result.snapshot;if(result.snapshot!==snapshot)throw new Error('The dossier inventory changed; refresh the receiving selection.');
 state.dossiers.push(...(result.items??result.dossiers??[]));offset=result.nextOffset;}while(offset!==null);
 setSelect($('receive-dossier'),state.dossiers.map(row=>({value:row.id,label:row.title})),$('receive-dossier').value);await selectDossier();renderReceipts();
}
async function selectDossier(){const id=$('receive-dossier').value;if(!id){state.dossier=null;return;}
 state.dossier=await api('/api/dossiers/'+encodeURIComponent(id)+'/metadata');
 setSelect($('receive-question'),state.dossier.questions.map(row=>({value:row.id,label:row.text})),$('receive-question').value);
 $('receive-revision').textContent='Original dossier revision '+state.dossier.revision;}
async function receive(){const selected=state.operation;if(!selected||selected.operation.phase!=='READY'||!state.dossier)throw new Error('Select a complete source edition, dossier and question.');
 const input={requestId:'epmc-receive-'+guid(),actor:actor(),dossierId:state.dossier.id,questionId:$('receive-question').value,label:$('receive-label').value,
 expectedRevision:state.dossier.revision,expectedPlanSha256:selected.plan.sha256,expectedEditionSha256:selected.operation.editionSha256};
 try{const result=await perform(root+'/operations/'+selected.plan.id+'/receive',input,{intent:'receive:'+selected.plan.id+':'+input.dossierId+':'+input.questionId});
 state.dossier=result.dossier;await refresh();await selectDossier();renderReceipts();show('Received all '+result.receipt.records+' native records in dossier revision '+result.receipt.revision+'.');}
 catch(error){if(error.code==='REVISION_CONFLICT')await selectDossier();throw error;}}
function renderReceipts(){clear($('receipts'));for(const receipt of state.operation?.receipts??[])$('receipts').append(detail('Received revision '+receipt.revision,receipt));}
async function renderHistory(){clear($('receiving-context'));if(state.workspace.receiving)$('receiving-context').append(detail('Original receiving context',state.workspace.receiving));
 const result=await api(root+'/history');clear($('history'));for(const event of result.events.toReversed())$('history').append(detail('Revision '+event.revision+' · '+event.kind+' · '+event.actor,event));}
async function exportWorkspace(){const input={requestId:'epmc-export-'+guid(),actor:actor()},receipt=await perform(root+'/exports',input,{intent:'workspace-export:'+state.workspace.revision});
 const result=await response(root+'/exports/'+encodeURIComponent(receipt.requestId)),blob=await result.blob();
 if(blob.size!==receipt.bytes||await sha(blob)!==receipt.sha256)throw new Error('The retained workspace archive does not match its receipt.');
 download(receipt.filename,blob);show('Complete workspace downloaded: '+receipt.bytes+' bytes.');}
async function restore(){const original=$('restore-file').files[0];if(!original)throw new Error('Select the complete workspace file.');
 if(original.size>128*1024*1024)throw new Error('The complete receiving file exceeds128MiB.');const id='epmc-restore-'+guid(),hash=await sha(original);
 const path=root+'/restore?'+new URLSearchParams({requestId:id,actor:actor(),sha256:hash});
 await perform(path,null,{intent:'restore:'+hash,binary:original,id});await refresh();view('history');await renderHistory();show('Opened a separate received copy; the original library remains available.');}
function renderPending(){clear($('pending'));const rows=[...state.pending.values()].filter(row=>row.ns===state.ns);
 for(const row of rows){const node=el('article',undefined,'pending-item');node.append(el('h3',row.intent),fields({Request:row.id,Status:row.status,Created:row.createdAt,Error:row.error??null}),
 detail('Complete original input',row.body??{binaryBytes:row.binary?.size,path:row.path}),button('Continue this exact request',async()=>{await executePending(row);await refresh();renderPending();show('Original request reconciled.');}));
 if(['PREPARED','FAILED'].includes(row.status))node.append(button(row.status==='PREPARED'?'Remove unsent request':'Archive failed request',async()=>{
 await transaction('pending','readwrite',store=>store.delete(row.key));state.pending.delete(row.key);state.fallback.delete(row.key);renderPendingCount();renderPending();}));
 $('pending').append(node);}
 if(!rows.length)$('pending').append(el('p','No unresolved requests in this selected library.','empty'));
 const receipts=[...state.receipts.values()].filter(row=>row.ns===state.ns);for(const row of receipts.toReversed())$('pending').append(detail('Completed · '+row.intent,row));}
async function connect(){const supplied=new URL($('connection-url').value,location.origin);if(supplied.origin!==location.origin)throw new Error('Open this workbench on the supplied Research listener first.');
 const token=new URLSearchParams(supplied.hash.slice(1)).get('token');if(!token)throw new Error('The connection URL has no token.');
 state.token=token;try{sessionStorage.setItem(tokenKey,token);}catch{}await refresh();$('connect').hidden=true;await openQuery();}
for(const node of document.querySelectorAll('[data-view]'))node.addEventListener('click',()=>task(async()=>{view(node.dataset.view);
 if(node.dataset.view==='records')await loadRecords();if(node.dataset.view==='receiving')await receiving();}));
$('refresh').addEventListener('click',()=>task(()=>refresh()));$('connect-button').addEventListener('click',()=>task(connect));
$('new-query').addEventListener('click',()=>task(()=>openQuery()));$('query-form').addEventListener('submit',event=>{event.preventDefault();task(saveQuery);});
for(const id of ['query-title','query-text','page-size','max-pages','synonyms','source-terms'])$(id).addEventListener('input',saveQueryDraft);
$('discard-query').addEventListener('click',()=>task(async()=>{await removeDraft(getDraft(queryDraftId()));await openQuery(state.queryId);}));
$('run-live').addEventListener('click',()=>task(()=>prepare('live')));$('prepare-files').addEventListener('click',()=>task(()=>prepare('documents')));
$('add-page').addEventListener('click',addPage);$('import-pages').addEventListener('click',()=>task(importPages));$('more-editions').addEventListener('click',()=>task(()=>refresh({append:true})));
$('record-search').addEventListener('submit',event=>{event.preventDefault();state.offset=0;task(loadRecords);});
$('previous-records').addEventListener('click',()=>task(async()=>{state.offset=Math.max(0,state.offset-PAGE);await loadRecords();}));
$('next-records').addEventListener('click',()=>task(async()=>{state.offset=state.next??state.offset;await loadRecords();}));
for(const node of document.querySelectorAll('[data-download]'))node.addEventListener('click',()=>task(()=>{if(!state.operation)throw new Error('Open a source edition.');
 const format=node.dataset.download;return file(root+'/operations/'+state.operation.plan.id+'/files/'+format,{edition:'Europe_PMC_Source_Edition.json',ris:'Europe_PMC_Records.ris',csv:'Europe_PMC_Records.csv',review:'Europe_PMC_Review.json'}[format]);}));
$('compare-button').addEventListener('click',()=>task(async()=>{state.comparisonOffset=0;await compare();}));
$('previous-comparison').addEventListener('click',()=>task(async()=>{state.comparisonOffset=Math.max(0,state.comparisonOffset-PAGE);await compare();}));
$('next-comparison').addEventListener('click',()=>task(async()=>{state.comparisonOffset=state.comparisonNext??state.comparisonOffset;await compare();}));
$('export-comparison').addEventListener('click',()=>task(exportComparison));$('receive-dossier').addEventListener('change',()=>task(selectDossier));
$('receive-button').addEventListener('click',()=>task(receive));$('history-button').addEventListener('click',()=>task(async()=>{view('history');await renderHistory();}));
$('pending-button').addEventListener('click',()=>{view('pending');renderPending();});$('export-browser').addEventListener('click',()=>task(exportBrowser));
$('export-workspace').addEventListener('click',()=>task(exportWorkspace));$('restore-workspace').addEventListener('click',()=>task(restore));
$('actor').addEventListener('input',()=>{try{localStorage.setItem('research-europe-pmc-actor', $('actor').value);}catch{}});
try{$('actor').value=localStorage.getItem('research-europe-pmc-actor')??'';state.token=sessionStorage.getItem(tokenKey)??'';}catch{}
const hash=new URLSearchParams(location.hash.slice(1));if(hash.get('token')){state.token=hash.get('token');try{sessionStorage.setItem(tokenKey,state.token);}catch{}history.replaceState(null,'',location.pathname);}
try{state.db=await openDatabase();}catch(error){show(error.message,true);}
addPage();await task(async()=>{if(!state.token){$('connect').hidden=false;return;}await refresh();$('connect').hidden=true;await openQuery();});
