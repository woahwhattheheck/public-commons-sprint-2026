// MIT. One additive browser for the original accounting Store source-change controller.
// Retained commands use the server's original IDs; this page owns no provider or journal engine.
const API='/api/source-changes',SCHEMA='stellar-forge.accounting-source-change.v1';
const REQUEST_LIMIT=32*1024*1024,RESPONSE_LIMIT=96*1024*1024,PAGE=50;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const $=id=>document.getElementById(id),clone=value=>structuredClone(value);
const canonical=value=>JSON.stringify(sort(value));
function sort(value){if(Array.isArray(value))return value.map(sort);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])]));return value;}
const equal=(a,b)=>canonical(a)===canonical(b),utf8=value=>new TextEncoder().encode(value);
async function digest(value){const bytes=typeof value==='string'?utf8(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function check(ok,message){if(!ok)throw new Error(message);}
function validBinding(v){return v&&typeof v.workspaceId==='string'&&v.workspaceId.length>0&&typeof v.sourcesSha256==='string'&&SHA.test(v.sourcesSha256);}
const state={binding:null,key:null,catalog:null,cache:null,db:null,busy:false,mismatch:false,dirty:false,draft:null,detail:null,reviews:[],nextOffset:0,accountPage:0,selection:'',snapshot:null};
const blank=binding=>({key:canonical(binding),binding:clone(binding),version:0,draft:null,pending:null,selectedChangeId:'',operator:'',lastOutcome:null});
function node(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;}
function notice(message,tone='info'){$('notice').textContent=message;$('notice').dataset.tone=tone;$('notice').hidden=!message;}
function errorText(error){return String(error?.message||error).slice(0,2500);}
function scopeFailure(actual){state.mismatch=true;$('owner-warning').hidden=false;$('owner-warning').textContent='The responding workspace differs from this browser record. Its requests remain frozen under their original scope. Reload the page to open the current workspace; use Other browser workspaces to download the preserved record.\nOriginal: '+canonical(state.binding)+'\nResponding: '+canonical(actual);availability();}
function assertBinding(actual){if(!validBinding(actual)||!equal(actual,state.binding)){scopeFailure(actual??null);throw new Error('The workspace/source identity changed; the original request is preserved.');}}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('stellar-forge-accounting-source-changes',1);r.onupgradeneeded=()=>{r.result.createObjectStore('scopes',{keyPath:'key'});r.result.createObjectStore('commands',{keyPath:['scope','kind','id']});};r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result);};r.onerror=()=>reject(r.error||new Error('Browser persistence is unavailable.'));r.onblocked=()=>reject(new Error('Close an older source-change tab before opening this browser store.'));});}
function readCache(key){return new Promise((resolve,reject)=>{const tx=state.db.transaction('scopes','readonly'),r=tx.objectStore('scopes').get(key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});}
function scopeKeys(){return new Promise((resolve,reject)=>{const tx=state.db.transaction('scopes','readonly'),r=tx.objectStore('scopes').getAllKeys();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
/** Browser CAS and immutable command publication share one IndexedDB transaction. */
function persist(change,command=null){const expected=state.cache.version,key=state.key,binding=clone(state.binding);
 return new Promise((resolve,reject)=>{const tx=state.db.transaction(command?['scopes','commands']:['scopes'],'readwrite'),store=tx.objectStore('scopes');let next,issue;
 const fail=e=>{issue=e;try{tx.abort();}catch{}};
 const r=store.get(key);r.onerror=()=>fail(r.error);r.onsuccess=()=>{try{const old=r.result??blank(binding);check(equal(old.binding,binding),'The saved browser scope changed.');check(old.version===expected,'Another tab updated this browser record. Download any unsaved draft, then reload the page before continuing.');
 next=change(clone(old));check(next.key===key&&equal(next.binding,binding),'Keep the original browser scope.');next.version=old.version+1;next.updatedAt=new Date().toISOString();
 if(command){const commands=tx.objectStore('commands'),c=commands.get([key,command.kind,command.id]);c.onerror=()=>fail(c.error);c.onsuccess=()=>{try{if(c.result)check(c.result.bodySha256===command.bodySha256&&equal(c.result.body,command.body)&&c.result.path===command.path,'This browser command ID already belongs to different original bytes.');else commands.add({scope:key,...clone(command)});store.put(next);}catch(e){fail(e);}};}else store.put(next);
 }catch(e){fail(e);}};
 tx.oncomplete=()=>{state.cache=next;resolve(next);};tx.onerror=()=>reject(issue||tx.error||new Error('The browser could not retain this request; nothing new was dispatched.'));tx.onabort=()=>reject(issue||tx.error||new Error('The browser could not retain this request; nothing new was dispatched.'));});}
async function jsonResponse(response){const type=response.headers.get('content-type')||'';check(/^application\/json(?:\s*;|$)/i.test(type),'The server returned an unreadable response. The original request is retained.');
 const declared=Number(response.headers.get('content-length'));check(!Number.isFinite(declared)||declared<=RESPONSE_LIMIT,'This response exceeds the browser receiving limit. Keep the original request and use the existing full operating backup or CLI.');
 const reader=response.body?.getReader();let bytes;
 if(reader){const chunks=[];let count=0;try{while(true){const r=await reader.read();if(r.done)break;count+=r.value.length;if(count>RESPONSE_LIMIT){await reader.cancel();throw new Error('This complete response exceeds the 96 MiB browser limit. Use the original full operating backup or CLI.');}chunks.push(r.value);}}finally{reader.releaseLock();}bytes=new Uint8Array(count);let i=0;for(const chunk of chunks){bytes.set(chunk,i);i+=chunk.length;}}
 else{bytes=new Uint8Array(await response.arrayBuffer());check(bytes.length<=RESPONSE_LIMIT,'This response exceeds the browser receiving limit.');}
 let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('The response body is incomplete or unreadable. The original request is retained.');}
 return {data,bytes};}
async function request(path,{body,expected=state.binding,raw=false}={}){
 const text=body===undefined?undefined:JSON.stringify(body);if(text!==undefined)check(utf8(text).length<=REQUEST_LIMIT,'The complete source-change command exceeds 32 MiB.');
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),120000);let response,parsed;
 try{response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:text,cache:'no-store',credentials:'same-origin',redirect:'error',signal:abort.signal});parsed=await jsonResponse(response);}
 catch(error){throw new Error(error.name==='AbortError'?'The response timed out. Keep and reconcile the original request.':errorText(error));}finally{clearTimeout(timer);}
 const data=parsed.data;if(expected){if(!validBinding(data?.binding)||!equal(data.binding,expected)){scopeFailure(data?.binding??null);throw new Error('The response does not name the original workspace and source scope. Its outcome remains unknown.');}}
 if(data?.reopenRequired===true&&state.catalog)state.catalog.reopenRequired=true;
 if(!response.ok){const e=new Error(String(data?.message||'The original source-change request did not return success.'));e.status=response.status;
 if(data?.schema===SCHEMA&&validBinding(data.binding)&&equal(data.binding,expected)&&typeof data.error==='string'&&['unknown','not_found','rejected'].includes(data.outcome)){e.bound=true;e.envelope=data;}
 throw e;}return raw?parsed:data;
}
async function catalog(){const value=await request(API,{expected:null});check(value?.schema===SCHEMA&&validBinding(value.binding)&&Array.isArray(value.plans)&&Array.isArray(value.changes)&&Array.isArray(value.contexts),'The original source-change catalog is incomplete.');
 if(state.binding)assertBinding(value.binding);state.catalog=value;return value;}
function pending(){return state.cache?.pending??null;}
async function act(work){if(state.busy)return;state.busy=true;availability();try{await work();}catch(error){notice(errorText(error),'error');}finally{state.busy=false;availability();}}
function availableWrite(){check(!state.mismatch,'Reopen the matching original workspace before continuing this browser record.');check(!state.catalog?.reopenRequired,'Reopen the original workspace before another mutation.');}
function availability(){
 const p=pending(),base=state.busy||state.mismatch||!state.cache,blocked=base||Boolean(p)||Boolean(state.catalog?.reopenRequired);
 for(const el of document.querySelectorAll('input,select,textarea'))el.disabled=blocked;
 for(const el of document.querySelectorAll('button'))el.disabled=base;
 for(const id of ['inspect','save-draft','prepare','apply','read-change','more-sources'])$(id).disabled=blocked;
 $('refresh').disabled=state.busy||!state.db;
 $('foreign-scope').disabled=state.busy||!state.db;$('download-foreign').disabled=state.busy||!$('foreign-scope').value;
 $('download-pending').disabled=state.busy||!p;$('download-draft').disabled=state.busy||!state.draft;
 $('continue-request').disabled=base||!p||Boolean(state.catalog?.reopenRequired);
 $('read-outcome').disabled=base||!p;
 $('return-review').disabled=base||!p?.release||Boolean(state.catalog?.reopenRequired);
 $('return-review').hidden=!p?.release;
 $('inspect').disabled=blocked||!selectedPlan()?.baselineAvailable;
 $('prepare').disabled=blocked||!state.draft?.inspection?.predecessor?.eligible||Boolean(state.detail);
 $('save-draft').disabled=blocked||!state.draft||Boolean(state.detail);
 $('read-change').disabled=blocked||!$('saved-change').value;
 const d=state.detail,canApply=d?.record?.phase==='PREPARED'&&!d.record.intent&&d.current.predecessorEligible;
 $('apply').disabled=blocked||!canApply;
 for(const el of $('apply-form').querySelectorAll('input,textarea'))el.disabled=blocked||!canApply;
 $('resume').hidden=!d?.record?.intent||d.record.phase==='COMPLETED';
 $('resume').disabled=blocked||!d?.record?.intent;
 $('download-handoff').disabled=base||!d;
 $('accounts-previous').disabled=base||state.accountPage===0;
 $('accounts-next').disabled=base||((state.accountPage+1)*PAGE>=filteredAccounts().length);
 $('reopen-warning').hidden=!state.catalog?.reopenRequired;
 $('revision').textContent=state.catalog?'Workspace revision '+state.catalog.revision:'';
 $('draft-state').textContent=state.dirty?'Unsaved browser edits':state.draft?'Browser draft retained':'';
}
function markDirty(){if(pending()||state.busy||state.mismatch||!state.draft||state.detail)return;state.dirty=true;availability();}
function selectedPlan(){return state.catalog?.plans.find(p=>p.kind+':'+p.id===$('plan').value)??null;}
function options(select,rows,placeholder,value){select.replaceChildren(node('option',placeholder));select.firstChild.value='';for(const row of rows){const o=node('option',row.label);o.value=row.value;select.append(o);}if(rows.some(row=>row.value===value))select.value=value;}
function renderCatalog(){const old=$('plan').value||state.draft?.kind+':'+state.draft?.planId;
 options($('plan'),state.catalog.plans.map(p=>({value:p.kind+':'+p.id,label:(p.kind==='qbo'?'QuickBooks':'Xero')+' · '+p.name+' · '+p.company+(p.eligible?'':' · comparison only')})),'Choose an original plan',old);
 state.selection=$('plan').value;
 options($('saved-change'),state.catalog.changes.map(r=>({value:r.id,label:r.name+' · '+r.phase+' · '+r.id.slice(0,8)})),'Choose a retained review',state.detail?.record.id||state.cache.selectedChangeId);
 $('scope').textContent='Workspace '+state.binding.workspaceId+'\nSources '+state.binding.sourcesSha256;
 renderTargets();availability();}
function renderTargets(){const plan=selectedPlan(),previous=$('target').value;const rows=!plan?[]:plan.kind==='xero'?state.catalog.contexts.map(c=>({value:'context:'+c.id+':'+c.sha256,label:c.name+' · '+c.tenantId+' · '+c.createdAt})):state.reviews.filter(r=>r.kind==='quickbooks'&&SHA.test(r.previewSha256||'')).map(r=>({value:'review:'+r.id+':'+r.previewSha256,label:r.id.slice(0,8)+' · '+r.state+' · '+String(r.target?.realmId||r.selection?.realmId||'retained QuickBooks source')}));
 if(plan?.kind==='qbo')rows.push({value:'snapshot',label:'Import an original normalized company snapshot'});
 options($('target'),rows,'Choose a retained newer source',previous);$('snapshot-panel').hidden=$('target').value!=='snapshot';
 $('plan-status').textContent=plan?(plan.blockers.length?plan.blockers.join(' '):'The original plan currently permits an unused-plan replacement.'):'';
 $('more-sources').hidden=plan?.kind!=='qbo'||state.nextOffset===null;
}
async function loadSources(reset=false){const offset=reset?0:state.nextOffset;if(offset===null)return;const data=await request(API+'/sources?offset='+offset+'&limit=50');check(Array.isArray(data.reviews)&&(data.nextOffset===null||Number.isSafeInteger(data.nextOffset)&&data.nextOffset>offset),'The original source page did not return a usable continuation.');
 if(reset)state.reviews=[];const seen=new Set(state.reviews.map(r=>r.id+':'+r.previewSha256));for(const row of data.reviews){const key=row.id+':'+row.previewSha256;if(!seen.has(key)){state.reviews.push(row);seen.add(key);}}state.nextOffset=data.nextOffset;renderTargets();}
function target(){const value=$('target').value,plan=selectedPlan();check(plan,'Choose the original plan.');
 if(plan.kind==='xero'){const c=state.catalog.contexts.find(r=>'context:'+r.id+':'+r.sha256===value);check(c,'Choose a retained Xero context.');return {kind:'xero-context',id:c.id,sha256:c.sha256};}
 if(value==='snapshot'){check(state.snapshot,'Choose the complete normalized QuickBooks snapshot JSON.');return {kind:'qbo-snapshot',snapshot:clone(state.snapshot.value)};}
 const r=state.reviews.find(r=>'review:'+r.id+':'+r.previewSha256===value&&r.kind==='quickbooks');check(r,'Choose a retained QuickBooks review.');return {kind:'qbo-review',id:r.id,sha256:r.previewSha256};}
function identities(el,pairs){el.replaceChildren();for(const [label,value]of pairs){el.append(node('dt',label),node('dd',typeof value==='string'?value:canonical(value??null)));}}
function currentComparison(){return state.detail?{comparison:state.detail.review.comparison,source:state.detail.review.source}:state.draft?.inspection??null;}
function filteredAccounts(){const c=currentComparison()?.comparison;if(!c)return [];const filter=$('account-filter').value,q=$('account-search').value.toLowerCase().trim();return c.accounts.filter(r=>(filter==='all'||filter==='changed'&&r.change!=='unchanged'||filter==='used'&&r.usedBy.length||filter==='unavailable'&&r.usedBy.length&&!r.after?.eligible)&&(!q||[r.id,r.before?.name,r.after?.name,r.before?.code,r.after?.code].some(v=>String(v??'').toLowerCase().includes(q))));}
function accountText(row){if(!row)return 'Absent from this edition';return [row.code?row.code+' · '+row.name:row.name,row.id,row.status+' / '+(row.eligible?'eligible':'unavailable'),row.type,row.currency,row.reasons?.join('; ')].filter(Boolean).join('\n');}
function renderComparison(){const value=currentComparison();$('comparison-panel').hidden=!value;if(!value)return;const c=value.comparison,s=value.source;
 identities($('source-identities'),[['Before company',s.before.company],['Before source SHA-256',c.beforeSha256||s.before.sha256],['After company',s.after.company],['After source SHA-256',c.afterSha256||s.after.sha256],['Comparison SHA-256',c.sha256]]);
 $('comparison-summary').replaceChildren();for(const [key,label]of [['added','Added accounts'],['removed','Removed accounts'],['changed','Changed accounts'],['usedUnavailable','Used and unavailable']]){const box=node('div');box.append(node('strong',c.summary[key]??0),node('span',label));$('comparison-summary').append(box);}
 const company=$('company-changes');company.replaceChildren();if(!c.companyChanges.length)company.append(node('p','Company fields are unchanged.','muted'));else for(const row of c.companyChanges)company.append(node('p',row.field+': '+canonical(row.before)+' → '+canonical(row.after)));
 const rows=filteredAccounts();state.accountPage=Math.min(state.accountPage,Math.max(0,Math.ceil(rows.length/PAGE)-1));const body=$('accounts-table').querySelector('tbody');body.replaceChildren();
 for(const row of rows.slice(state.accountPage*PAGE,(state.accountPage+1)*PAGE)){const tr=node('tr');for(const text of [row.id,row.change+(row.fields.length?'\n'+row.fields.join(', '):''),accountText(row.before),accountText(row.after),row.usedBy.map(u=>u.sourceId+' / '+u.side).join('\n')||'No selected-plan use'])tr.append(node('td',text));body.append(tr);}
 $('accounts-page').textContent=rows.length?(state.accountPage*PAGE+1)+'–'+Math.min(rows.length,(state.accountPage+1)*PAGE)+' of '+rows.length:'No accounts match this filter';availability();
}

function editable(parent,label,value,set,{multiline=false,type='text',required=false,list=null,max=2000,wide=false}={}){
 const wrap=node('label',label,wide?'sc-wide':''),input=node(multiline?'textarea':'input');
 if(!multiline)input.type=type;else input.rows=2;
 input.value=value??'';input.required=required;input.maxLength=max;if(list)input.setAttribute('list',list);
 if(label.includes('Amount'))input.inputMode='decimal';
 input.addEventListener('input',()=>{if(state.busy||pending()||state.mismatch)return;set(input.value);markDirty();});
 wrap.append(input);parent.append(wrap);return input;
}
function renderDraft(){const d=state.draft,shown=Boolean(d)&&!state.detail;$('mapping-panel').hidden=!shown;if(!d)return;
 $('successor-name').value=d.successor.name??'';$('txn-date').value=d.successor.txnDate??'';$('doc-number').value=d.successor.docNumber??'';
 $('valuation-basis').value=d.successor.valuationBasis??'';$('rationale').value=d.rationale??'';$('valuation-confirmed').checked=Boolean(d.valuationConfirmed);
 $('txn-label').hidden=d.kind!=='qbo';$('doc-label').hidden=d.kind!=='qbo';$('valuation-label').hidden=d.kind!=='xero';
 $('txn-date').required=d.kind==='qbo';$('valuation-basis').required=d.kind==='xero';
 const currency=d.inspection.source.after.company.baseCurrency,before=d.inspection.source.before.company.baseCurrency;
 $('currency-note').textContent=before===currency?'All displayed values remain explicit '+currency+' amounts. Review the original valuation basis.':'Company base currency changed from '+before+' to '+currency+'. Enter and review every amount in '+currency+'; no exchange rate is inferred.';
 const list=$('account-options');list.replaceChildren();for(const a of d.inspection.accounts.filter(a=>a.eligible)){const option=node('option');option.value=d.kind==='qbo'?a.id:a.code;option.label=[a.code,a.name,a.id].filter(Boolean).join(' · ');list.append(option);}
 const root=$('economic-rows');root.replaceChildren();const rows=d.kind==='qbo'?d.successor.rows:d.successor.entries;
 for(const row of rows){const card=node('section',undefined,'sc-economic'),id=d.kind==='qbo'?row.rowId:row.componentId;card.dataset.sourceId=id;
 card.append(node('h3',d.kind==='xero'&&row.decision==='exclude'?'Original exclusion':'Original included row'),node('p',id,'mono'));
 if(d.kind==='xero'&&row.decision==='exclude'){card.append(node('p',row.reason,'excluded'));root.append(card);continue;}
 const grid=node('div',undefined,'sc-row-grid');
 if(d.kind==='xero')editable(grid,'Journal date',row.date,v=>row.date=v,{type:'date',required:true});
 editable(grid,'Amount in '+currency,row.amount,v=>row.amount=v,{required:true,max:100});
 editable(grid,d.kind==='qbo'?'Debit account ID':'Debit account code',d.kind==='qbo'?row.debitAccount.value:row.debitAccountCode,v=>{if(d.kind==='qbo')row.debitAccount.value=v;else row.debitAccountCode=v;},{required:true,list:'account-options',max:240});
 editable(grid,d.kind==='qbo'?'Credit account ID':'Credit account code',d.kind==='qbo'?row.creditAccount.value:row.creditAccountCode,v=>{if(d.kind==='qbo')row.creditAccount.value=v;else row.creditAccountCode=v;},{required:true,list:'account-options',max:240});
 if(d.kind==='xero')editable(grid,'Valuation note',row.valuationNote,v=>row.valuationNote=v,{required:true,multiline:true,wide:true});
 editable(grid,'Description',row.description,v=>row.description=v,{multiline:true,wide:true});
 card.append(grid);root.append(card);
 }availability();
}
function collectDraft(){check(state.draft,'Inspect the original source editions first.');const d=clone(state.draft);d.successor.name=$('successor-name').value.trim();d.successor.actor=$('operator').value.trim();d.rationale=$('rationale').value.trim();d.valuationConfirmed=$('valuation-confirmed').checked;
 if(d.kind==='qbo'){d.successor.txnDate=$('txn-date').value;d.successor.docNumber=$('doc-number').value.trim()||null;}else d.successor.valuationBasis=$('valuation-basis').value.trim();return d;}
function validateDraft(d){check(d.successor.name&&d.successor.actor&&d.rationale,'Provide the operator, successor name and source-change reason.');check(d.valuationConfirmed,'Confirm the complete base-currency valuation and mapping review.');
 const eligible=new Set(d.inspection.accounts.filter(a=>a.eligible).map(a=>d.kind==='qbo'?a.id:a.code));
 const original=d.kind==='qbo'?d.inspection.defaults.rows:d.inspection.defaults.entries,rows=d.kind==='qbo'?d.successor.rows:d.successor.entries;
 check(rows.length===original.length&&rows.every((r,i)=>d.kind==='qbo'?r.rowId===original[i].rowId:r.componentId===original[i].componentId&&r.decision===original[i].decision&&(r.decision!=='exclude'||r.reason===original[i].reason)),'Keep every original included row and exclusion unchanged.');
 for(const r of rows){if(d.kind==='xero'&&r.decision==='exclude')continue;const debit=d.kind==='qbo'?r.debitAccount.value:r.debitAccountCode,credit=d.kind==='qbo'?r.creditAccount.value:r.creditAccountCode;
 check(eligible.has(debit)&&eligible.has(credit),'Choose eligible accounts from the retained target chart for every included row.');
 check(typeof r.amount==='string'&&r.amount.trim(),'Enter an explicit amount for every included row.');}
 check(d.inspection.predecessor.eligible,'This original plan must be continued through its existing native reconciliation before replacement.');
}
async function inspectSources(){
 availableWrite();check(!pending(),'Continue the retained request first.');if(state.dirty&&!confirm('Replace this unsaved browser draft with a fresh source comparison?'))return;
 const p=selectedPlan(),selected=target();check(p?.baselineAvailable,'This older plan has no retained chart baseline. Use its original accounting page.');
 await catalog();const value=await request(API+'/inspect',{body:{binding:clone(state.binding),kind:p.kind,planId:p.id,target:selected}});
 check(value.kind===p.kind&&value.planId===p.id&&value.predecessor?.id===p.id&&SHA.test(value.comparison?.sha256||'')&&Array.isArray(value.accounts)&&value.defaults&&value.source,'The returned comparison does not identify the selected original plan and sources.');
 const current=state.catalog.plans.find(row=>row.kind===p.kind&&row.id===p.id);check(current&&current.sha256===value.predecessor.sha256,'The original plan changed during inspection. Refresh and compare its current retained source.');
 const draft={binding:clone(state.binding),kind:p.kind,planId:p.id,target:clone(selected),inspection:clone(value),successor:{...clone(value.defaults),id:crypto.randomUUID(),createdAt:new Date().toISOString(),actor:$('operator').value.trim()},rationale:'',valuationConfirmed:false,snapshotFile:selected.kind==='qbo-snapshot'?clone(state.snapshot.meta):null};
 await persist(c=>({...c,draft,selectedChangeId:'',operator:$('operator').value.trim()}));
 state.draft=clone(draft);state.detail=null;state.dirty=false;state.accountPage=0;renderDraft();renderComparison();renderDetail();notice('The actual before/after sources are compared. Review the preserved rows, target accounts and explicit values.');
}
async function saveDraft(){availableWrite();check(!pending(),'Keep the exact pending request unchanged.');const d=collectDraft();await persist(c=>({...c,draft:d,operator:$('operator').value.trim()}));state.draft=d;state.dirty=false;notice('The complete browser draft is retained under this workspace and source scope.');}
function renderPending(){const p=pending();$('pending-panel').hidden=!p;if(!p)return;
 $('pending-kind').textContent=p.kind;$('pending-description').textContent=p.kind==='prepare'?'This exact source and successor request was saved before dispatch. Read its retained review or continue the unchanged request.':'The original application ID is retained. Read or continue its cancellation and same successor before preparing another application.';
 identities($('pending-identity'),[['Request ID',p.id],['Source-change review',p.changeId],['Body SHA-256',p.bodySha256],['Browser retained at',p.createdAt]]);
 $('pending-outcome').textContent=p.lastMessage||'No authoritative completed outcome has been received.';
 $('return-review').textContent=p.kind==='prepare'?'Return to source and mapping draft':'Return to retained review';
 availability();
}
function renderDetail(){const d=state.detail;$('review-panel').hidden=!d;if(!d)return;const r=d.record;
 identities($('review-identity'),[['Review ID',r.id],['Original plan',r.planId],['Successor plan',r.successorId],['Preview SHA-256',r.previewSha256],['Comparison SHA-256',r.comparisonSha256],['Review operator',r.actor],['Review created',r.createdAt],['Review origin',r.binding],['Current reopened scope',d.binding],...(r.intent?[['Application ID',r.intent.id],['Application operator',r.intent.actor],['Application note',r.intent.note]]:[])]);
 const phase={PREPARED:'Exact successor preview retained. The predecessor has not been cancelled by this source change.',APPLYING:'Original application retained. Read or resume its same request.',CANCELLED_PENDING_SUCCESSOR:'The original predecessor is cancelled. Continue this same retained application to create its successor.',COMPLETED:'Original unused plan cancelled and the exact successor is retained. Continue native delivery on the original accounting page.'};
 $('review-status').textContent=(phase[r.phase]||r.phase)+(d.current.successorStatus?'\nSuccessor status: '+d.current.successorStatus:'');
 $('review-blockers').hidden=!d.current.blockers?.length||r.phase==='COMPLETED';$('review-blockers').textContent=(d.current.blockers||[]).join('\n');
 $('native-request').textContent=JSON.stringify(d.review.request,null,2);$('native-preview').textContent=JSON.stringify(d.review.plan,null,2);
 $('retained-source').textContent=JSON.stringify({source:d.review.source,predecessor:d.review.predecessor},null,2);
 $('apply-form').hidden=r.phase!=='PREPARED'||Boolean(r.intent);
 $('open-successor').hidden=r.phase!=='COMPLETED'||!d.current.successorExists;$('open-successor').href=r.kind==='qbo'?'/qbo.html':'/xero.html';$('open-successor').textContent='Open '+(r.kind==='qbo'?'QuickBooks':'Xero')+' · successor '+r.successorId;
 $('mapping-panel').hidden=true;availability();
}
function validateDetail(data,id){assertBinding(data?.binding);check(data?.schema===SCHEMA&&data.record?.id===id&&['qbo','xero'].includes(data.record.kind)&&UUID.test(data.record.planId||'')&&UUID.test(data.record.successorId||'')&&SHA.test(data.record.previewSha256||'')&&data.review?.request?.id===data.record.successorId&&data.current&&data.review.comparison?.sha256===data.record.comparisonSha256,'The response does not bind the exact retained review and successor.');return data;}
function samePrepare(detail,p){const r=detail.record,b=p.body;check(r.id===b.id&&r.kind===b.kind&&r.planId===b.planId&&r.successorId===b.successor.id&&r.predecessorSha256===b.predecessorSha256&&r.comparisonSha256===b.comparisonSha256&&r.name===b.successor.name&&r.actor===b.successor.actor&&r.rationale===b.rationale,'The returned review does not match the original prepared source and successor identity.');
 for(const key of ['id','createdAt','name','actor',...(b.kind==='qbo'?['txnDate','docNumber','rows']:['entries','valuationBasis'])])check(equal(detail.review.request[key]??null,b.successor[key]??null),'The returned native request changed the original '+key+' field.');}
function sameApplication(detail,p){const r=detail.record;check(r.id===p.changeId&&r.successorId===p.successorId&&r.previewSha256===p.previewSha256,'The application returned a different review or successor.');
 check(r.intent?.id===p.id,'The original application ID has not been confirmed.');if(p.kind==='apply')check(r.intent.requestSha256===p.bodySha256,'The retained application body identity differs from the original command.');}
async function retainCommand(kind,changeId,body,{successorId,previewSha256}={}){
 availableWrite();check(!pending(),'An original browser request already needs receiving.');
 const p={kind,changeId,id:body.id,body:clone(body),bodySha256:await digest(canonical(body)),path:kind==='prepare'?API+'/prepare':API+'/'+changeId+'/'+kind,createdAt:new Date().toISOString(),successorId:successorId??body.successor?.id,previewSha256:previewSha256??null,lastMessage:'Original request retained before dispatch.',release:null};
 check(utf8(JSON.stringify(p.body)).length<=REQUEST_LIMIT,'The complete source-change request exceeds 32 MiB.');
 await persist(c=>({...c,pending:p,draft:state.draft?clone(state.draft):c.draft,operator:$('operator').value.trim()}),p);state.dirty=false;renderPending();return p;
}
async function validatePending(p){check(p&&['prepare','apply','resume'].includes(p.kind)&&UUID.test(p.id||'')&&UUID.test(p.changeId||'')&&equal(p.body?.binding,state.binding)&&p.body.id===p.id,'The saved browser request is not a complete command for this scope.');
 const path=p.kind==='prepare'?API+'/prepare':API+'/'+p.changeId+'/'+p.kind;check(p.path===path&&await digest(canonical(p.body))===p.bodySha256,'The exact saved request bytes or route changed. Keep the original browser record for recovery.');if(p.kind==='prepare')check(p.id===p.changeId,'The original prepare UUID differs from its review.');}
async function acceptDetail(data,p){validateDetail(data,p.changeId);if(p.kind==='prepare')samePrepare(data,p);else sameApplication(data,p);
 const completed=p.kind==='prepare'||data.record.phase==='COMPLETED';
 await persist(c=>{check(c.pending?.id===p.id&&c.pending.bodySha256===p.bodySha256,'Keep the exact original pending command.');return {...c,selectedChangeId:data.record.id,pending:completed?null:{...c.pending,release:null,lastMessage:'Original intent '+p.id+' is retained. Current phase: '+data.record.phase+'.'},lastOutcome:{kind:p.kind,requestId:p.id,requestSha256:p.bodySha256,changeId:data.record.id,phase:data.record.phase,receivedAt:new Date().toISOString()}};});
 state.detail=clone(data);state.dirty=false;renderPending();renderDraft();renderComparison();renderDetail();
 notice(completed?(p.kind==='prepare'?'The exact successor preview is retained. Review it before applying the unused-plan replacement.':'The original cancellation and exact successor are complete. The full source-change handoff is ready.'):'The application is retained but not complete. Continue its same request ID.');
}
function missing(error){return error?.bound===true&&error.status===404&&error.envelope?.error==='SOURCE_CHANGE_NOT_FOUND'&&error.envelope.outcome==='not_found'&&error.envelope.reopenRequired===false;}
function rejection(error,p){const e=error?.envelope,c=e?.command;return p.kind==='apply'&&error?.bound===true&&e.outcome==='rejected'&&e.reopenRequired===false&&c?.state==='rejected'&&c.id===p.id&&c.requestSha256===p.bodySha256;}
async function rememberUnknown(p,error){await persist(c=>{check(c.pending?.id===p.id&&c.pending.bodySha256===p.bodySha256,'The pending browser request changed in another tab.');return {...c,pending:{...c.pending,release:null,lastMessage:errorText(error)}};});renderPending();}
async function verifyRejection(p,error){if(!rejection(error,p))return false;await catalog();if(state.catalog.reopenRequired)return false;
 const detail=validateDetail(await request(API+'/'+p.changeId),p.changeId),r=detail.record.rejections?.find(r=>r.id===p.id&&r.requestSha256===p.bodySha256&&r.state==='rejected');
 if(detail.record.intent||!r)return false;
 await persist(c=>({...c,pending:{...c.pending,release:{kind:'apply-rejected',requestId:p.id,requestSha256:p.bodySha256},lastMessage:r.message}}));state.detail=detail;renderDetail();renderPending();notice('The original application was explicitly rejected before intent creation. Its exact terminal receipt is retained. Review the reason before returning to the retained preview.','error');return true;
}
async function sendPending(){
 const p=clone(pending());await validatePending(p);await catalog();availableWrite();
 try{const data=await request(p.path,{body:p.body});await acceptDetail(data,p);}
 catch(error){if(await verifyRejection(p,error))return;await rememberUnknown(p,error);throw error;}
}
async function reconcilePending(){
 const p=clone(pending());await validatePending(p);await catalog();
 try{const data=await request(API+'/'+p.changeId);validateDetail(data,p.changeId);
 if(p.kind==='apply'&&!data.record.intent){const r=data.record.rejections?.find(r=>r.id===p.id&&r.requestSha256===p.bodySha256&&r.state==='rejected');
 if(r&&!data.reopenRequired){await persist(c=>({...c,pending:{...c.pending,release:null,lastMessage:r.message+' Continue the unchanged original request to receive its bound terminal rejection.'}}));state.detail=data;renderDetail();renderPending();notice('A matching terminal rejection is retained. Continue the unchanged original request to receive and verify its explicit bound rejection before returning to review.','error');return;}
 throw new Error('No matching retained intent or terminal rejection has been received. Keep the exact original application request.');}
 await acceptDetail(data,p);
 }catch(error){
 if(p.kind==='prepare'&&missing(error)){await catalog();if(!state.catalog.reopenRequired){await persist(c=>({...c,pending:{...c.pending,release:{kind:'prepare-not-found',requestId:p.id},lastMessage:'A fresh matching workspace and the original bound not-found response establish that this review was not admitted.'}}));renderPending();notice('The original prepare is not retained in this matching workspace. You can continue the unchanged request or explicitly return to its source and mapping draft.');return;}}
 await rememberUnknown(p,error);throw error;}
}
async function returnToReview(){
 const p=clone(pending());await validatePending(p);check(p.release,'Read the authoritative original outcome before releasing the pending browser request.');await catalog();availableWrite();
 if(p.release.kind==='prepare-not-found'){try{await request(API+'/'+p.changeId);throw new Error('The original review now exists. Read its retained outcome.');}catch(error){if(!missing(error))throw error;}await catalog();availableWrite();}
 else{check(p.kind==='apply','Only a rejected before-intent application can return to review.');const detail=validateDetail(await request(API+'/'+p.changeId),p.changeId);check(!detail.record.intent&&detail.record.rejections?.some(r=>r.id===p.id&&r.requestSha256===p.bodySha256&&r.state==='rejected'),'The exact terminal before-intent rejection is not present.');state.detail=detail;}
 await persist(c=>({...c,pending:null,lastOutcome:{kind:p.kind,requestId:p.id,requestSha256:p.bodySha256,phase:p.release.kind,receivedAt:new Date().toISOString()}}));
 if(p.kind==='prepare'){state.detail=null;state.draft=clone(state.cache.draft);state.draft.successor.id=crypto.randomUUID();state.draft.successor.createdAt=new Date().toISOString();state.draft.valuationConfirmed=false;state.dirty=true;renderDraft();renderComparison();renderDetail();}
 else{for(const id of ['unused','no-external','mapping-confirmed'])$(id).checked=false;renderDetail();}
 renderPending();notice('The original request remains in the browser command history. Review the fields before issuing a new request ID.');
}

async function prepareReview(){
 availableWrite();check(!pending(),'Continue the original pending request first.');const d=collectDraft();validateDraft(d);state.draft=d;
 const body={binding:clone(state.binding),id:crypto.randomUUID(),kind:d.kind,planId:d.planId,target:clone(d.target),predecessorSha256:d.inspection.predecessor.sha256,comparisonSha256:d.inspection.comparison.sha256,rationale:d.rationale,valuationConfirmed:true,successor:clone(d.successor)};
 await retainCommand('prepare',body.id,body);await sendPending();
}
async function applyReview(){
 availableWrite();check(!pending(),'Continue the original request first.');const d=state.detail;check(d?.record.phase==='PREPARED'&&!d.record.intent&&d.current.predecessorEligible,'Read the current unused predecessor and exact retained preview first.');
 const actor=$('operator').value.trim(),note=$('approval-note').value.trim();check(actor&&note,'Provide the approving operator and receiving note.');
 check($('unused').checked&&$('no-external').checked&&$('mapping-confirmed').checked,'Confirm unused state, no external import and the exact mapping review.');
 const body={binding:clone(state.binding),id:crypto.randomUUID(),previewSha256:d.record.previewSha256,revision:d.revision,actor,note,unusedConfirmed:true,noExternalImport:true,mappingConfirmed:true};
 await retainCommand('apply',d.record.id,body,{successorId:d.record.successorId,previewSha256:d.record.previewSha256});await sendPending();
}
async function resumeReview(){
 availableWrite();check(!pending(),'Continue the existing browser request first.');const d=state.detail;check(d?.record.intent&&d.record.phase!=='COMPLETED','Read the original retained application first.');
 const body={binding:clone(state.binding),id:d.record.intent.id};
 await retainCommand('resume',d.record.id,body,{successorId:d.record.successorId,previewSha256:d.record.previewSha256});await sendPending();
}
async function readSelected(){
 check(!pending(),'Read the original pending outcome before selecting another review.');check(!state.dirty,'Save or download the current browser draft before opening another retained review.');
 const id=$('saved-change').value;check(UUID.test(id),'Choose a retained source-change review.');await catalog();const detail=validateDetail(await request(API+'/'+id),id);
 await persist(c=>({...c,selectedChangeId:id}));state.detail=detail;state.accountPage=0;renderComparison();renderDetail();renderDraft();notice('Read the original retained review, current predecessor and successor.');
}
function saveBytes(bytes,filename,type='application/json'){const url=URL.createObjectURL(new Blob([bytes],{type})),a=node('a');a.href=url;a.download=filename;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function saveJSON(value,name){saveBytes(JSON.stringify(value,null,2)+'\n',name);}
function readCommand(scope,kind,id){return new Promise((resolve,reject)=>{const tx=state.db.transaction('commands','readonly'),r=tx.objectStore('commands').get([scope,kind,id]);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});}
async function browserRecord(key){const cache=await readCache(key);check(cache,'The selected original browser scope is not retained.');const latest=cache.lastOutcome?.requestId?await readCommand(key,cache.lastOutcome.kind,cache.lastOutcome.requestId):null;
 return {schema:'stellar-forge.accounting-source-change-browser.v1',binding:cache.binding,browser:cache,lastCompletedCommand:latest,instructions:'These are exact original browser records, not a server backup. Reopen the matching original workspace to reconcile a pending command. A different restored workspace must read its retained review and explicitly resume the existing application ID.'};}
async function downloadHandoff(){const id=state.detail?.record.id;check(UUID.test(id||''),'Read a retained source-change review first.');await catalog();
 const {data,bytes}=await request(API+'/'+id+'/download',{raw:true});check(data?.schema==='stellar-forge.accounting-source-change-handoff.v1'&&data.changeId===id&&Array.isArray(data.files)&&SHA.test(data.sha256||''),'The download does not identify the complete original source-change handoff.');
 const {sha256,...body}=data;check(await digest(canonical(body))===sha256,'The complete handoff identity did not match its original contents.');
 saveBytes(bytes,'source-change-'+id+'.json');notice('Downloaded the complete retained source/review/current-plan handoff. Any original native request withheld by its existing export gate is explicitly listed in that file.');
}
async function renderForeign(){const keys=await scopeKeys(),rows=[];for(const key of keys){if(key===state.key)continue;try{const binding=JSON.parse(key);if(validBinding(binding))rows.push({value:key,label:binding.workspaceId+' / '+binding.sourcesSha256.slice(0,12)});}catch{}}
 options($('foreign-scope'),rows,'Choose an original browser scope','');$('other-scopes').hidden=!rows.length;availability();}
async function loadSnapshot(){
 check(!pending(),'Keep the original pending snapshot unchanged.');const file=$('snapshot').files?.[0];if(!file){state.snapshot=null;return;}
 check(file.size>0&&file.size<=REQUEST_LIMIT,'Choose one nonempty normalized snapshot within the 32 MiB complete-command limit.');
 const bytes=new Uint8Array(await file.arrayBuffer());check(bytes.length===file.size,'The selected snapshot file changed.');
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes).replace(/^\uFEFF/,''));}catch{throw new Error('Choose the complete original normalized QuickBooks snapshot as valid UTF-8 JSON.');}
 check(value&&typeof value==='object'&&!Array.isArray(value),'The original normalized snapshot must be a JSON object.');
 state.snapshot={value,meta:{filename:file.name,bytes:file.size,sha256:await digest(bytes)}};
 $('snapshot-note').textContent=file.name+' · '+file.size.toLocaleString()+' bytes · SHA-256 '+state.snapshot.meta.sha256+'. The original validator checks its complete company and retained response identities.';
}
for(const id of ['successor-name','txn-date','doc-number','valuation-basis','rationale','valuation-confirmed','operator'])$(id).addEventListener('input',markDirty);
$('inspect-form').addEventListener('submit',event=>{event.preventDefault();act(inspectSources);});
$('prepare-form').addEventListener('submit',event=>{event.preventDefault();act(prepareReview);});
$('apply-form').addEventListener('submit',event=>{event.preventDefault();act(applyReview);});
$('save-draft').addEventListener('click',()=>act(saveDraft));
$('continue-request').addEventListener('click',()=>act(sendPending));
$('read-outcome').addEventListener('click',()=>act(reconcilePending));
$('return-review').addEventListener('click',()=>act(returnToReview));
$('resume').addEventListener('click',()=>act(resumeReview));
$('read-change').addEventListener('click',()=>act(readSelected));
$('saved-change').addEventListener('change',availability);
$('refresh').addEventListener('click',()=>act(async()=>{await catalog();await loadSources(true);renderCatalog();notice('The matching current workspace was refreshed. Browser drafts and pending requests retain their original identities.');}));
$('more-sources').addEventListener('click',()=>act(()=>loadSources(false)));
$('plan').addEventListener('change',()=>{if(state.busy||pending())return;state.selection=$('plan').value;renderTargets();availability();});
$('target').addEventListener('change',()=>{$('snapshot-panel').hidden=$('target').value!=='snapshot';});
$('snapshot').addEventListener('change',()=>act(loadSnapshot));
for(const id of ['account-filter','account-search'])$(id).addEventListener('input',()=>{state.accountPage=0;renderComparison();});
$('accounts-previous').addEventListener('click',()=>{state.accountPage=Math.max(0,state.accountPage-1);renderComparison();});
$('accounts-next').addEventListener('click',()=>{state.accountPage++;renderComparison();});
$('download-pending').addEventListener('click',()=>act(async()=>{const p=clone(pending());await validatePending(p);saveJSON({schema:'stellar-forge.accounting-source-change-browser-command.v1',binding:state.binding,command:p},'source-change-request-'+p.id+'.json');}));
$('download-draft').addEventListener('click',()=>act(async()=>{const draft=state.detail?state.draft:collectDraft();check(draft,'There is no original browser draft.');saveJSON({schema:'stellar-forge.accounting-source-change-browser-draft.v1',binding:state.binding,draft},'accounting-source-change-draft.json');}));
$('download-handoff').addEventListener('click',()=>act(downloadHandoff));
$('foreign-scope').addEventListener('change',availability);
$('download-foreign').addEventListener('click',()=>act(async()=>{const key=$('foreign-scope').value;check(key&&key!==state.key,'Choose the retained original browser scope.');const value=await browserRecord(key);saveJSON(value,'accounting-original-browser-scope.json');notice('Downloaded that scope without assigning its source or request to this workspace.');}));
window.addEventListener('beforeunload',event=>{if(state.dirty&&!pending()){event.preventDefault();event.returnValue='';}});
async function boot(){
 state.db=await openDB();const value=await catalog();state.binding=clone(value.binding);state.key=canonical(state.binding);
 state.cache=await readCache(state.key)??blank(state.binding);check(equal(state.cache.binding,state.binding),'The browser record names another original scope.');
 state.draft=state.cache.draft?clone(state.cache.draft):null;$('operator').value=state.cache.operator||state.draft?.successor.actor||'';
 await loadSources(true);renderCatalog();renderForeign().catch(error=>notice(errorText(error),'error'));
 if(state.draft){const t=state.draft.target;if(t.kind==='qbo-snapshot'){state.snapshot={value:clone(t.snapshot),meta:clone(state.draft.snapshotFile)};$('target').value='snapshot';$('snapshot-panel').hidden=false;$('snapshot-note').textContent='Complete snapshot recovered from this scope’s saved browser draft.';}else if(t.kind==='qbo-review')$('target').value='review:'+t.id+':'+t.sha256;else $('target').value='context:'+t.id+':'+t.sha256;}
 renderDraft();renderComparison();renderPending();
 if(pending()){await validatePending(pending());notice('Recovered the exact original browser request. Read its retained outcome or continue it unchanged.');}
 else if(state.cache.selectedChangeId){try{state.detail=validateDetail(await request(API+'/'+state.cache.selectedChangeId),state.cache.selectedChangeId);renderDetail();renderComparison();renderDraft();}catch(error){notice('The selected review could not be read: '+errorText(error),'error');}}
 else notice('Select an original plan and retained source edition. Requests are saved in this browser before any source-change mutation.');
}
act(boot);
