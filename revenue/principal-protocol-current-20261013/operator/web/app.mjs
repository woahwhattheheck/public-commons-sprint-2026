// Principal Operations. Native contract results remain the source of truth.
import {prepareRequest,beginAttempt,finishAttempt,getRequest,listRequests,initializeJournal,saveView,markApplied,canonical,exportWorkingCopy,inspectWorkingCopy,restoreWorkingCopy,listWorkingCopyRestores,packWorkingFile,openWorkingFile} from './journal.mjs';
import * as Market from './market.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const labels={overview:'Overview',market:'Market & contract wiring',account:'Account positions',escrow:'Compliance recovery',events:'Contract event history',prepare:'Prepare operation',plans:'Prepared operations',observations:'Contract observations',sources:'Original source files',notes:'Working notes',transfer:'Export & receive',recovery:'Request recovery',settings:'Configuration'};
let token=sessionStorage.getItem('principal.operator.token')||'',state=null,boot=null,workspaceId=null,view={page:'overview',drafts:{}},localRequests=[],busyCount=0,tail=Promise.resolve(),viewTail=Promise.resolve(),generation=0,fileGeneration=0,workspaceFileGeneration=0,inspectGeneration=0,inspected=null,selectedRead=Promise.resolve(),pendingFileReads=0,pendingViewWrites=0,selectedReads=new Map();
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('token')){token=fragment.get('token');sessionStorage.setItem('principal.operator.token',token);history.replaceState(null,'',location.pathname+location.search);}
function node(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(className)e.className=className;return e;}
function asText(x){return x===undefined||x===null?'—':typeof x==='object'?JSON.stringify(x):String(x);}
function pretty(x){return JSON.stringify(x,null,2);}
function failure(code,message){return Object.assign(new Error(message),{code});}
function report(e){notice((e.code?e.code+': ':'')+(e.message||String(e)),'error');}
function notice(message,kind='info'){const e=$('#notice');e.hidden=!message;e.dataset.kind=kind;e.textContent=message;}
function handle(fn){return Promise.resolve().then(fn).catch(report);}
function button(text,fn,primary=false){const b=node('button',text,primary?'primary':'');b.type='button';b.addEventListener('click',()=>handle(fn));return b;}
function actions(...children){const e=node('div',undefined,'actions');e.append(...children);return e;}
function panel(title,...children){const e=node('section',undefined,'panel');if(title)e.append(node('h2',title));e.append(...children);return e;}
function json(title,data,open=false){const e=node('details');e.open=open;e.append(node('summary',title),node('pre',pretty(data)));return e;}
function definitions(values){const e=node('dl');for(const [k,v]of Object.entries(values))if(v!==undefined)e.append(node('dt',k),node('dd',asText(v)));return e;}
function empty(text){return node('p',text,'empty');}
function textInput(name,value='',type='text'){const e=node('input');e.type=type;e.name=name;e.value=value??'';return e;}
function field(form,label,name,{value='',type='text',required=false,help=null,rows=null}={}){const wrap=node('label',label),input=type==='textarea'?node('textarea'):textInput(name,value,type);input.name=name;if(type==='textarea')input.value=value??'';input.required=required;if(rows)input.rows=rows;if(help)wrap.append(node('small',help));wrap.append(input);form.append(wrap);return input;}
function badge(text){return node('span',text,'badge');}
function closeDialog(){$('#detail-dialog').close();}
$('#close-dialog').addEventListener('click',closeDialog);
function detail(title,...children){$('#detail-title').textContent=title;$('#detail-content').replaceChildren(...children);if(!$('#detail-dialog').open)$('#detail-dialog').showModal();}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function downloadJSON(value,name){downloadBlob(new Blob([pretty(value)+'\n'],{type:'application/json'}),name);}
function capture(form,key){const d={};for(const e of form.elements)if(e.name&&e.type!=='file'&&!['submit','button'].includes(e.type))d[e.name]=e.type==='checkbox'?e.checked:e.value;view.drafts??={};view.drafts[key]=d;return d;}
function draftForm(key){const f=node('form');f.dataset.draft=key;f.addEventListener('input',()=>{capture(f,key);handle(saveDraft);});return f;}
function saved(key,name,fallback=''){return Object.hasOwn(view.drafts?.[key]??{},name)?view.drafts[key][name]:fallback;}
function collect(){for(const f of $$('form[data-draft]'))capture(f,f.dataset.draft);return structuredClone(view);}
function saveDraft(){if(!workspaceId)return Promise.resolve();const id=workspaceId,v=structuredClone(view);pendingViewWrites++;const p=viewTail.then(()=>saveView(id,v));viewTail=p.catch(()=>{});p.finally(()=>pendingViewWrites--).catch(()=>{});return p;}
function trackFileRead(kind,promise){pendingFileReads++;selectedReads.set(kind,promise);promise.finally(()=>pendingFileReads--).catch(()=>{});return promise;}
function frozen(fn){const work=async()=>{collect();const shell=$('#shell'),dialog=$('#detail-dialog'),old=shell.inert,dialogOld=dialog.inert;shell.inert=true;dialog.inert=true;busyCount++;$('#busy').hidden=false;$('#busy').textContent='Working with the selected workspace…';try{await Promise.all([...selectedReads.values()]);await viewTail;return await fn();}finally{busyCount--;$('#busy').hidden=busyCount===0;shell.inert=old||!$('#access').hidden;dialog.inert=dialogOld;}};const run=()=>navigator.locks&&workspaceId?navigator.locks.request('principal-workspace-'+workspaceId,{mode:'exclusive'},work):work();const p=tail.then(run,run);tail=p.catch(()=>{});return p;}
async function response(path,{method='GET',body}={}){if(!token)throw failure('TOKEN_REQUIRED','Open this workspace with its operator token.');const headers={Authorization:'Bearer '+token};if(method!=='GET')headers['X-Principal-Workspace-ID']=workspaceId;if(body!==undefined)headers['Content-Type']='application/json';let r;try{r=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});}catch(e){throw failure('TRANSPORT_UNCERTAIN','The response was interrupted. Inspect the retained request before continuing.');}if(!r.ok){let p;try{p=await r.json();}catch{p={};}const e=failure(p.error?.code||'HTTP_'+r.status,p.error?.message||'The workspace could not complete the request.');e.status=r.status;e.details=p.error?.details;if(r.status===401){$('#access').hidden=false;$('#shell').inert=true;}throw e;}return r;}
async function read(path){return(await response(path)).json();}
async function refresh({initial=false}={}){const current=++generation;const [b,s]=await Promise.all([read('/api/bootstrap'),read('/api/state')]);if(current!==generation)return;if(b.workspace.id!==s.workspace.id)throw failure('WORKSPACE_CHANGED','Bootstrap and saved state selected different workspaces. Refresh before proceeding.');if(workspaceId&&workspaceId!==s.workspace.id)throw failure('WORKSPACE_CHANGED','The host now serves another workspace. Reload it before preparing new work.');boot=b;state=s;workspaceId=s.workspace.id;if(initial){const j=await initializeJournal(workspaceId);view=j.view&&typeof j.view==='object'?j.view:{};view.drafts??={};view.page??='overview';localRequests=j.requests;}else localRequests=await listRequests(workspaceId);$('#workspace-label').textContent=(state.workspace.name||'Principal workspace')+'\n'+workspaceId;$('#revision').textContent='Saved revision '+state.workspace.revision;$('#access').hidden=true;$('#shell').inert=false;paint();}
function resultEnvelope(r,record){if(r?.workspaceId!==workspaceId||r?.requestId!==record.id||!Number.isSafeInteger(r.revision))throw failure('RESPONSE_IDENTITY_MISMATCH','The native response does not match this retained request and workspace.');return r;}
async function retainedCurrent(original){const current=await getRequest(original.id);if(!current||current.intentSha256!==original.intentSha256||canonical(current.request)!==canonical(original.request))throw failure('REQUEST_CHANGED','The original retained request changed; inspect its current body.');return current;}
async function sendRecord(original){let record=await retainedCurrent(original);if(record.status==='COMPLETE'){const r=resultEnvelope(record.response,record);await refresh();notice('The original request was already completed. Its saved response is retained.');return r.result;}record=await beginAttempt(record,workspaceId);try{const r=resultEnvelope(await(await response('/api/command',{method:'POST',body:record.request})).json(),record);record=await finishAttempt(record,{response:r,status:'COMPLETE'});await markApplied(record,collect());await refresh();notice('Saved '+record.method+' at revision '+r.revision+'.');return r.result;}catch(e){if(record.status!=='COMPLETE'){const uncertain=!e.status||e.status>=500;await finishAttempt(record,{error:e,status:uncertain?'UNCERTAIN':'REJECTED'});localRequests=await listRequests(workspaceId);}throw e;}}
function command(method,args,{binding=null,before=null}={}){canonical(args);const selectedBinding=binding?structuredClone(binding):null;return frozen(async()=>{if(selectedBinding)assertCurrentBinding(selectedBinding);if(before)before();const record=await prepareRequest({workspaceId,revision:state.workspace.revision,method,args,label:method});return sendRecord(record);});}
async function recover(original){return frozen(async()=>{const record=await retainedCurrent(original);if(record.status==='COMPLETE'){await refresh();showRequest(record);return;}let r;try{r=await read('/api/request/'+encodeURIComponent(record.id));}catch(e){if(e.status===404){notice('No completed host record was returned for this original request. Inspect its complete body before an explicit same-request retry.');showRequest(record,true);return;}throw e;}resultEnvelope(r,record);const updated=await finishAttempt(record,{response:r,status:'COMPLETE'});await markApplied(updated,collect());await refresh();showRequest(updated);notice('Recovered the original host result for '+record.id+'.');});}
function showRequest(record,retry=false){detail('Original request '+record.id,definitions({Method:record.method,State:record.status,Created:record.createdAt,'Original revision':record.request?.expectedRevision}),json('Complete original body, attempts and response',record,true),actions(button('Check original host result',()=>recover(record)),...(retry?[button('Retry this exact original request',()=>frozen(()=>sendRecord(record)))]:[])));}
function go(page){collect();view.page=Object.hasOwn(labels,page)?page:'overview';view.offset=0;handle(saveDraft);paint();}
for(const b of $$('#navigation [data-page]'))b.addEventListener('click',()=>go(b.dataset.page));
$('#refresh').addEventListener('click',()=>handle(()=>frozen(async()=>{await saveDraft();await refresh();})));
$('#access-form').addEventListener('submit',e=>{e.preventDefault();token=e.currentTarget.elements.token.value.trim();sessionStorage.setItem('principal.operator.token',token);handle(()=>refresh({initial:!state}));});
function paint(){if(!state)return;const page=Object.hasOwn(labels,view.page)?view.page:'overview';$('#page-title').textContent=labels[page];for(const b of $$('#navigation [data-page]'))b.setAttribute('aria-current',b.dataset.page===page?'page':'false');const content=$('#content');content.replaceChildren();({overview:overview,market:market,account:account,escrow:escrow,events:events,prepare:prepare,plans:plans,observations:observations,sources:sources,notes:notes,transfer:transfer,recovery:recovery,settings:settings})[page](content);}
function table(rows,columns,{pageSize=50}={}){const outer=node('div'),wrap=node('div',undefined,'table-scroll'),t=node('table'),head=node('thead'),hr=node('tr'),body=node('tbody');for(const c of columns)hr.append(node('th',c.label));head.append(hr);const offset=Math.min(Math.max(0,Number(view.offset)||0),Math.max(0,Math.floor((rows.length-1)/pageSize)*pageSize));for(const row of rows.slice(offset,offset+pageSize)){const tr=node('tr');for(const c of columns){const cell=node('td',undefined,c.className);const v=c.value(row);cell.append(v instanceof Node?v:node('span',asText(v)));tr.append(cell);}body.append(tr);}t.append(head,body);wrap.append(t);outer.append(rows.length?wrap:empty('No saved records in this view.'));if(rows.length>pageSize){const p=node('div',undefined,'pager');const previous=button('Previous',()=>{collect();view.offset=offset-pageSize;paint();}),next=button('Next',()=>{collect();view.offset=offset+pageSize;paint();});previous.disabled=offset===0;next.disabled=offset+pageSize>=rows.length;p.append(previous,node('span',(offset+1)+'–'+Math.min(offset+pageSize,rows.length)+' of '+rows.length),next);outer.append(p);}return outer;}
const catalogue=()=>boot.catalogue??[];
const idOf=row=>row.id??row.planId??row.observationId??row.requestId;
const dataOf=row=>row.value??row.data??row.result;
function exact(x){if(typeof x==='string'&&/^-?\d+$/.test(x))return BigInt(x);if(Number.isSafeInteger(x))return BigInt(x);throw failure('EXACT_AMOUNT_REQUIRED','The native amount must retain exact integer text.');}
function units(x){try{const n=exact(x),sign=n<0n?'-':'',a=n<0n?-n:n;return sign+(a/10000000n)+'.'+(a%10000000n).toString().padStart(7,'0');}catch{return asText(x);}}
function observationBinding(row){return Market.observedBinding(row);}
function assertCurrentBinding(observed){const selected=Market.binding(state.config??boot.config??{},observed.contractKey,boot.capabilities?.apiSha256);if(!Market.sameBinding(observed,selected))throw failure('OBSERVATION_BINDING_CHANGED','This original selection uses another network, contract or code edition. Restore its exact configuration before preparing from it.');}
function dateLabel(value){try{const n=exact(value);if(n<0n||n>8640000000000n)return String(value)+' Unix seconds';return new Date(Number(n)*1000).toISOString();}catch{return asText(value);}}
function chooseAction(contract,method,params={},binding=null,recoveryCase=null){collect();const action=catalogue().find(a=>(a.contract===contract||a.contractKey===contract)&&a.method===method)||catalogue().find(a=>a.id===contract+'.'+method);if(!action)throw failure('ACTION_UNAVAILABLE','This installed source does not expose '+contract+'.'+method+'.');view.actionId=action.id;view.actionContexts??={};if(binding)view.actionContexts[action.id]={binding:structuredClone(binding),...(recoveryCase?{recoveryCase:structuredClone(recoveryCase)}:{})};view.drafts??={};view.drafts['action:'+action.id]={...(view.drafts['action:'+action.id]??{}),...params};view.page='prepare';view.offset=0;handle(saveDraft);paint();}
function prepare(host){const selection=node('select');selection.setAttribute('aria-label','Contract operation');for(const a of catalogue()){const o=node('option',(a.label??a.method??a.id)+' · '+a.contract+(a.readOnly?' · read':' · transaction'));o.value=a.id;selection.append(o);}selection.value=view.actionId??catalogue()[0]?.id??'';const action=catalogue().find(a=>a.id===selection.value);selection.addEventListener('change',()=>{collect();view.actionId=selection.value;handle(saveDraft);paint();});host.append(panel('Select operation',selection));if(!action){host.append(empty('No action catalogue was returned by this installed workspace.'));return;}const f=draftForm('action:'+action.id),description=node('p',action.description??'Prepare this exact callable operation against the saved network and contract bindings.');const originalContext=view.actionContexts?.[action.id];if(originalContext){f.append(panel('Original observation selection',json('Selected network, contract, source and original case',originalContext,true),button('Start a new operation in the current configuration',async()=>{delete view.actionContexts[action.id];delete view.drafts['action:'+action.id];await saveDraft();paint();})));}for(const spec of action.fields??[]){let v=saved(f.dataset.draft,spec.name,spec.default??'');if(spec.type==='bool'||spec.type==='boolean'){const wrap=node('label',spec.name),select=node('select');select.name=spec.name;for(const value of ['false','true']){const o=node('option',value);o.value=value;select.append(o);}select.value=String(v||false);wrap.append(select);f.append(wrap);}else{const isObject=/^(json|object|WrapperConfig|ManagerConfig|MarketConfig|Vec<Address>)$/i.test(spec.type??'');const input=field(f,spec.label??spec.name,spec.name,{value:typeof v==='object'?pretty(v):v,type:isObject?'textarea':'text',required:spec.required!==false,help:spec.description??spec.type});if(/^(i128|u64|u32|integer)$/.test(spec.type??'')){input.inputMode='numeric';input.pattern=spec.type==='i128'?'-?[0-9]+':'[0-9]+';}}}const submit=node('button',action.readOnly?'Read contract and retain result':'Prepare exact transaction','primary');submit.type='submit';f.append(actions(submit));f.addEventListener('submit',e=>{e.preventDefault();handle(async()=>{const raw=capture(f,f.dataset.draft),parameters={};for(const spec of action.fields??[]){const value=raw[spec.name];if(value===''&&spec.required===false)continue;parameters[spec.name]=spec.type==='bool'||spec.type==='boolean'?value==='true':/^(json|object|WrapperConfig|ManagerConfig|MarketConfig|Vec<Address>)$/i.test(spec.type??'')?JSON.parse(value):value;}const result=await command(action.readOnly?'observation.capture':'plan.prepare',{actionId:action.id,parameters},{binding:originalContext?.binding??null,before:()=>{if(originalContext?.recoveryCase)Market.currentCase(state,originalContext.recoveryCase);}});if(!action.readOnly){view.page='plans';await saveDraft();paint();}else detail('Complete contract observation',json('Original native result',result,true));});});host.append(panel(action.label??action.method,description,definitions({'Contract':action.contract,'Method':action.method,'Mode':action.readOnly?'Native read':'Prepared transaction'}),f,json('Installed action contract',action)));}
function plans(host){host.append(panel('Prepared operations',node('p','A prepared operation pins its complete parameters, selected contract, network and source account. Simulation and invocation are separate explicit actions.'),table([...(state.plans??[])].reverse(),[{label:'Plan',className:'identifier',value:r=>button(idOf(r),()=>showPlan(r))},{label:'Operation',value:r=>r.actionId??r.action?.id},{label:'State',value:r=>badge(r.status??r.state??'PREPARED')},{label:'Created',value:r=>r.createdAt},{label:'Contract',className:'identifier',value:r=>r.contractId??r.config?.contracts?.[r.action?.contract]?.id}])));}
function showPlan(row){const id=idOf(row);detail('Prepared operation '+id,definitions({'Action':row.actionId??row.action?.id,'State':row.status??row.state,'Created':row.createdAt}),json('Complete pinned plan, command and recorded outcomes',row,true),actions(button('Simulate this exact plan',async()=>{closeDialog();await command('plan.simulate',{planId:id});}),button('Invoke this prepared transaction',async()=>{closeDialog();await command('plan.execute',{planId:id});},true))); }
function observations(host){host.append(panel('Original contract observations',node('p','Every retained native result preserves its selected contract, parameters and source. Read a fresh observation from Prepare operation.'),table([...(state.observations??[])].reverse(),[{label:'Observation',className:'identifier',value:r=>button(idOf(r),()=>detail('Native observation',json('Complete original observation',r,true)))},{label:'Action',value:r=>r.actionId??r.method},{label:'Observed',value:r=>r.createdAt??r.observedAt},{label:'Contract',className:'identifier',value:r=>r.contractId??r.contract}])));}
function sources(host){const f=draftForm('source'),select=field(f,'Complete original source file','sourceFile',{type:'file'});select.removeAttribute('required');const status=node('p',undefined,'field-help'),save=node('button','Retain complete original source','primary');save.type='submit';let localFile=null;const update=()=>{const s=view.selectedSource;status.textContent=s?s.name+' · '+s.bytes+' bytes · SHA-256 '+s.sha256:'Select a file to retain its complete original bytes.';save.disabled=!s;};select.addEventListener('change',()=>{const file=select.files[0],g=++fileGeneration;localFile=file;view.selectedSource=null;update();status.textContent=file?'Reading the complete selected file…':'No source file selected.';selectedRead=trackFileRead('source',(async()=>{if(!file){await saveDraft();return;}const packed=await packWorkingFile(file);if(g!==fileGeneration||localFile!==file)return;view.selectedSource=packed;await saveDraft();if(status.isConnected)update();})());selectedRead.catch(report);});f.append(status,actions(save,button('Download retained selection',async()=>{if(!view.selectedSource)throw failure('SOURCE_REQUIRED','Select an original file.');downloadBlob(await openWorkingFile(view.selectedSource),view.selectedSource.name);}),button('Clear selection',async()=>{fileGeneration++;selectedRead=Promise.resolve();selectedReads.set('source',selectedRead);view.selectedSource=null;select.value='';localFile=null;await saveDraft();update();})));f.addEventListener('submit',e=>{e.preventDefault();handle(async()=>{const s=view.selectedSource;if(!s)throw failure('SOURCE_REQUIRED','Select a complete source file.');await openWorkingFile(s);await command('source.import',{name:s.name,type:s.type,contentBase64:s.data,bytes:s.bytes,sha256:s.sha256});});});update();host.append(panel('Retain original source',node('p','Retain source material, a native command result or a received project file. Original bytes remain downloadable.'),f));host.append(panel('Saved originals',table([...(state.files??[])].reverse(),[{label:'File',value:r=>r.name??r.filename},{label:'Bytes',value:r=>r.bytes},{label:'SHA-256',className:'identifier',value:r=>r.sha256},{label:'Saved',value:r=>r.createdAt},{label:'Open',value:r=>actions(button('Download original',async()=>downloadBlob(await(await response('/api/files/'+encodeURIComponent(idOf(r)))).blob(),r.name??r.filename??'source.bin')),button('Details',()=>detail('Original file',json('Complete retained receipt',r,true))))}])));}
function notes(host){const f=draftForm('note');field(f,'Related issue or record ID','subjectId',{value:saved('note','subjectId')});field(f,'Title','title',{value:saved('note','title'),required:true});field(f,'Working note','body',{value:saved('note','body'),type:'textarea',required:true});const submit=node('button','Save note','primary');submit.type='submit';f.append(actions(submit));f.addEventListener('submit',e=>{e.preventDefault();handle(()=>command('note.save',capture(f,'note')));});host.append(panel('Save working note',f));for(const r of [...(state.notes??[])].reverse())host.append(panel(r.title??'Working note',definitions({'Subject':r.subjectId,'Saved':r.createdAt}),node('p',r.body??r.content),json('Complete original note',r)));}
function settings(host){
 const cfg=state.config??boot.config??{},guided=draftForm('configuration-guided'),raw=draftForm('configuration');
 const input=field(raw,'Complete configuration','json',{value:saved('configuration','json',pretty(cfg)),type:'textarea',rows:22,required:true,help:'The complete editable configuration retains every field. Private signing material stays in the host’s original key store.'});
 const specs=[['Workspace name','name'],['RPC URL','network.rpcUrl'],['Network passphrase','network.passphrase'],['Source account address','sourceAccount.address'],['Signer alias','sourceAccount.alias'],['Installed Stellar executable','stellar.executable'],['Installed Python executable','stellar.python'],['Executable SHA-256','stellar.sha256'],['Recorded CLI version','stellar.version'],['CLI configuration directory','stellar.configDirectory']];
 for(const contract of Market.CONTRACTS)specs.push([contract+' contract ID','contracts.'+contract+'.id'],[contract+' WASM SHA-256','contracts.'+contract+'.wasmSha256']);
 const at=(obj,path)=>path.split('.').reduce((v,k)=>v?.[k],obj),put=(obj,path,value)=>{const keys=path.split('.');let p=obj;for(const k of keys.slice(0,-1)){if(!p[k]||typeof p[k]!=='object'||Array.isArray(p[k]))p[k]={};p=p[k];}p[keys.at(-1)]=value;};
 const fields=node('div',undefined,'field-grid');guided.append(fields);
 for(const [label,key]of specs)field(fields,label,key,{value:saved('configuration-guided',key,at(cfg,key)??'')});
 const checkLabel=node('label',undefined,'checkbox'),enabled=textInput('executionEnabled','','checkbox');enabled.checked=saved('configuration-guided','executionEnabled',cfg.executionEnabled===true)===true;checkLabel.append(enabled,node('span','Enable explicit invocation from prepared transactions'));guided.append(checkLabel);
 const useGuided=()=>{capture(guided,'configuration-guided');const next=JSON.parse(input.value||'{}');if(!next||typeof next!=='object'||Array.isArray(next))throw failure('CONFIG_OBJECT_REQUIRED','Keep a complete configuration object.');for(const [,key]of specs)put(next,key,guided.elements.namedItem(key).value);next.executionEnabled=enabled.checked;input.value=pretty(next);capture(raw,'configuration');return next;};
 guided.append(actions(button('Update complete configuration from these fields',async()=>{useGuided();await saveDraft();notice('Updated the complete configuration draft. Save it when ready.');}),button('Load these fields from complete JSON',async()=>{const next=JSON.parse(input.value);for(const [,key]of specs)guided.elements.namedItem(key).value=at(next,key)??'';enabled.checked=next.executionEnabled===true;capture(guided,'configuration-guided');await saveDraft();})));
 guided.addEventListener('submit',e=>{e.preventDefault();handle(async()=>{const config=useGuided();await command('config.save',{config});});});
 const submit=node('button','Save complete configuration','primary');submit.type='submit';raw.append(actions(submit,button('Use currently saved configuration',async()=>{input.value=pretty(cfg);capture(raw,'configuration');for(const [,key]of specs)guided.elements.namedItem(key).value=at(cfg,key)??'';enabled.checked=cfg.executionEnabled===true;capture(guided,'configuration-guided');await saveDraft();})));
 raw.addEventListener('submit',e=>{e.preventDefault();handle(()=>{capture(raw,'configuration');const config=JSON.parse(input.value);return command('config.save',{config});});});
 host.append(panel('Network & native operator',node('p','An incomplete configuration can be retained during commissioning. Each prepared operation requires the exact network, deployed contracts and native signer identity for its action.'),guided),panel('Complete configuration draft',raw),panel('Installed operator capabilities',json('Capabilities and source identity',boot.capabilities??boot,true)));
}
function nativeInspector(host){
 const form=node('form'),input=field(form,'Select complete native workspace JSON','packet',{type:'file'}),summary=node('p',undefined,'field-help'),submit=node('button','Inspect complete native workspace','primary');
 submit.type='submit';const current=()=>{summary.textContent=view.selectedWorkspace?view.selectedWorkspace.name+' · '+view.selectedWorkspace.bytes+' bytes · '+view.selectedWorkspace.sha256:'Select the complete workspace file exported by the native operator.';submit.disabled=!view.selectedWorkspace;};
 input.addEventListener('change',()=>{const file=input.files[0],g=++workspaceFileGeneration,id=workspaceId,selectedView=view;view.selectedWorkspace=null;current();summary.textContent=file?'Reading the complete selected workspace…':'No workspace selected.';const promise=(async()=>{if(!file){await saveDraft();return;}const packed=await packWorkingFile(file);if(g!==workspaceFileGeneration||id!==workspaceId||selectedView!==view||input.files[0]!==file)return;view.selectedWorkspace=packed;await saveDraft();if(summary.isConnected)current();})();trackFileRead('workspace',promise).catch(report);});
 form.append(summary,actions(submit,button('Download selected original',async()=>{if(!view.selectedWorkspace)throw failure('WORKSPACE_FILE_REQUIRED','Select a complete native workspace.');downloadBlob(await openWorkingFile(view.selectedWorkspace),view.selectedWorkspace.name);}),button('Clear selected workspace',async()=>{workspaceFileGeneration++;selectedReads.set('workspace',Promise.resolve());view.selectedWorkspace=null;input.value='';await saveDraft();current();})));
 form.addEventListener('submit',event=>{event.preventDefault();handle(async()=>{const selected=view.selectedWorkspace;if(!selected)throw failure('WORKSPACE_FILE_REQUIRED','Select the complete native workspace.');const file=await openWorkingFile(selected),packet=JSON.parse(await file.text());const result=await command('workspace.inspect',{packet});view.lastWorkspaceInspection={source:{name:selected.name,bytes:selected.bytes,sha256:selected.sha256},result};await saveDraft();paint();});});current();
 const card=panel('Inspect a native handover',node('p','Inspect all original files, requests, history and application source before receiving a workspace into a separate destination. The native receiving command preserves the original workspace identity and leaves the currently running workspace in place.'),form);
 if(view.lastWorkspaceInspection)card.append(json('Complete last native inspection',view.lastWorkspaceInspection,true));host.append(card);
}

async function validateView(v){if(!v||typeof v!=='object'||Array.isArray(v))throw failure('WORKING_VIEW_INVALID','Retain the complete working view.');if(v.drafts!==undefined&&(!v.drafts||typeof v.drafts!=='object'||Array.isArray(v.drafts)))throw failure('WORKING_VIEW_INVALID','Retain the complete form drafts.');for(const fields of Object.values(v.drafts??{}))if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.values(fields).some(x=>!['string','boolean'].includes(typeof x)))throw failure('WORKING_VIEW_INVALID','Keep original editable form values.');if(v.actionContexts!==undefined){if(!v.actionContexts||typeof v.actionContexts!=='object'||Array.isArray(v.actionContexts))throw failure('WORKING_VIEW_INVALID','Retain the original action contexts.');for(const context of Object.values(v.actionContexts)){const b=context?.binding;if(!b||typeof b!=='object'||['rpcUrl','passphrase','contractKey','contractId','wasmSha256','apiSha256'].some(key=>typeof b[key]!=='string'||!b[key]))throw failure('WORKING_VIEW_INVALID','Retain each original network, contract and source binding.');}}if(v.selectedSource)await openWorkingFile(v.selectedSource);if(v.selectedWorkspace)await openWorkingFile(v.selectedWorkspace);return v;}
function transfer(host){nativeInspector(host);host.append(panel('Complete native workspace',node('p','Download the saved native workspace with its original source files, plans, observations and full request history. Keep this with the browser working copy when handing over unfinished operator work.'),button('Download complete native workspace',async()=>{const r=await response('/api/export');downloadBlob(await r.blob(),'principal-workspace-'+workspaceId+'.json');},true)));
const local=panel('Browser working copy',node('p','Preserve unfinished fields, the complete selected file, original browser requests and prior restored views. The operator access token remains in this tab.'));local.append(button('Download complete browser working copy',()=>frozen(async()=>{const current=collect();await validateView(current);const packet=await exportWorkingCopy(workspaceId,{view:current});downloadJSON(packet,'principal-browser-'+workspaceId+'.json');}),true));const f=node('form'),input=field(f,'Select complete browser file','file',{type:'file'}),summary=node('div'),restore=button('Restore inspected working copy',()=>frozen(async()=>{if(!inspected)throw failure('INSPECTION_REQUIRED','Inspect this complete browser file first.');const packet=inspected,check=await inspectWorkingCopy(packet,workspaceId);await validateView(check.view);fileGeneration++;workspaceFileGeneration++;inspectGeneration++;await saveDraft();const result=await restoreWorkingCopy(packet,workspaceId);view=result.view;view.drafts??={};inspected=null;await refresh();notice('Restored the complete browser working copy. Imported requests remain available for explicit recovery.');}));restore.disabled=true;input.addEventListener('change',()=>{inspectGeneration++;inspected=null;restore.disabled=true;summary.replaceChildren();});const inspect=button('Inspect complete working copy',async()=>{const file=input.files[0];if(!file)throw failure('FILE_REQUIRED','Select a complete browser working copy.');const g=++inspectGeneration,id=workspaceId;const p=JSON.parse(await file.text()),r=await inspectWorkingCopy(p,id);await validateView(r.view);if(g!==inspectGeneration||id!==workspaceId)return;inspected=p;summary.replaceChildren(definitions({'Original workspace':r.workspaceId,'Requests':r.requests,'Additional requests':r.newRequests,'Retained original request files':r.files,'Earlier views':r.restores,'Selected unfinished source':r.view.selectedSource?.name}),json('Complete inspection',r));restore.disabled=false;});f.append(actions(inspect,restore),summary);local.append(f);host.append(local);const history=panel('Prior browser views',node('p','Each successful restore retains the complete preceding view.'));host.append(history);const id=workspaceId,g=generation;handle(async()=>{const rows=await listWorkingCopyRestores(id);if(g!==generation||id!==workspaceId||!history.isConnected)return;for(const row of rows)history.append(actions(node('span',row.restoredAt),button('Download complete prior view',()=>downloadJSON(row,'principal-prior-view-'+row.id+'.json'))));if(!rows.length)history.append(empty('No earlier restore views are retained.'));});}
function recovery(host){host.append(panel('Original browser requests',node('p','Check the native result of an interrupted request before continuing. Restored requests retain their original bodies and are handled explicitly.'),table(localRequests,[{label:'Request',className:'identifier',value:r=>button(r.id,()=>showRequest(r))},{label:'Method',value:r=>r.method},{label:'State',value:r=>badge(r.status)},{label:'Recovery',value:r=>r.needsExplicitRecovery?'Restored · explicit recovery':'Original browser request'},{label:'Created',value:r=>r.createdAt}])));host.append(panel('Native request history',table([...(state.requests??[])].reverse(),[{label:'Request',className:'identifier',value:r=>button(r.requestId??r.id,()=>detail('Native request record',json('Complete request and result',r,true)))},{label:'Method',value:r=>r.method??r.request?.method??r.envelope?.method},{label:'State',value:r=>r.status??r.state},{label:'Created',value:r=>r.createdAt}])));}
window.addEventListener('pagehide',()=>{inspectGeneration++;inspected=null;collect();handle(saveDraft);});
window.addEventListener('beforeunload',event=>{const pending=pendingFileReads>0||pendingViewWrites>0||busyCount>0;collect();handle(saveDraft);if(pending){event.preventDefault();event.returnValue='';}});
if(token)handle(()=>refresh({initial:true}));else{$('#access').hidden=false;$('#shell').inert=true;}


const currentAPI=()=>boot.capabilities?.apiSha256??state.apiSha256;
const currentBinding=key=>Market.binding(state.config??{},key,currentAPI());
function latestValue(contract,method,parameters={}){return Market.latest(state,currentAPI(),contract,method,parameters);}
function nativeCell(contract,method,parameters={},format=asText){
 const row=latestValue(contract,method,parameters);if(!row)return node('span','Not observed','muted');
 const wrap=node('div');wrap.append(node('span',format(row.value)),node('small',row.createdAt,'field-help'),button('Original result',()=>detail(contract+'.'+method,json('Complete native observation',row,true))));return wrap;
}
function operationButton(label,contract,method,parameters={}){const context=currentBinding(contract);return button(label,()=>chooseAction(contract,method,parameters,context));}
async function readSet(queries){
 const api=currentAPI(),selected=queries.map(([contract,method,parameters={}])=>({actionId:contract+'.'+method,parameters,binding:Market.binding(state.config,contract,api)}));
 for(let i=0;i<selected.length;i++){const q=selected[i];await command('observation.capture',{actionId:q.actionId,parameters:q.parameters},{binding:q.binding});notice('Retained original reading '+(i+1)+' of '+selected.length+'.');}
 return selected.length;
}
function reportButtons(){return actions(button('Download complete review JSON',()=>downloadJSON(Market.report(state,boot.capabilities),'principal-review-'+workspaceId+'.json')),button('Download readable review',()=>{const r=Market.report(state,boot.capabilities);downloadBlob(new Blob([Market.reportHTML(r)],{type:'text/html'}),'principal-review-'+workspaceId+'.html');}));}
function overview(host){
 const grid=node('div',undefined,'grid');
 for(const [label,count]of [['Configured contract bindings',Market.CONTRACTS.filter(k=>state.config?.contracts?.[k]?.id).length],['Saved contract observations',(state.observations??[]).length],['Recovery cases',Market.cases(state).length],['Retained contract events',(state.events??[]).length]])grid.append(panel(null,node('div',count,'metric'),node('div',label,'metric-label')));
 host.append(grid);
 const selected=panel('Selected market',definitions({'Workspace':state.workspace.name,'RPC':state.config?.network?.rpcUrl,'Network passphrase':state.config?.network?.passphrase,'Public source account':state.config?.sourceAccount?.address,'Explicit invocation enabled':state.config?.executionEnabled===true?'Yes':'No','Installed API source':currentAPI()}));
 selected.append(actions(button('Inspect market wiring',()=>go('market'),true),button('Open account positions',()=>go('account')),button('Open compliance recovery',()=>go('escrow'))));
 const programme=panel('Current source programme',node('p','Operate the selected SY, PT and YT contracts, read accrued yield, prepare manager claims and redemptions, and retain the issuer’s RecoveryEscrow review. Every operation is prepared against an explicit network, contract and code selection.'),definitions({'Original repository':Market.SOURCE.repository,'Original source commit':Market.SOURCE.baseCommit,'Implementation edition':Market.SOURCE.implementationEdition,'Installed API edition':boot.capabilities?.sourceEdition}),node('p','Saved readings are individual native observations with their own timestamps. Open the current contract readings when reviewing a new operation.','muted'),reportButtons());
 host.append(selected,programme);
 const pending=localRequests.filter(r=>['PENDING','RUNNING','UNCERTAIN'].includes(r.status));if(pending.length)host.append(panel('Retained requests',node('p',pending.length+' original browser requests need a result review.'),button('Open request recovery',()=>go('recovery'))));
}



function hasAction(contract,method){return catalogue().some(a=>a.id===contract+'.'+method);}
const accountingViews=[
 ['Manager accounting edition','principal_manager','accounting_edition',asText],
 ['Locked SY shares','principal_manager','locked_shares',asText],
 ['Managed backing · underlying atoms','principal_manager','backing_underlying',asText],
 ['Outstanding principal reserve · underlying atoms','principal_manager','principal_reserve',asText],
 ['Deposited underlying · cumulative atoms','principal_manager','total_deposited_underlying',asText],
 ['Principal paid · cumulative atoms','principal_manager','total_paid_principal',asText],
 ['Yield paid · cumulative atoms','principal_manager','total_paid_yield',asText],
 ['Paired-exit edition','principal_manager','recombination_edition',asText],
 ['SY returned by paired exits · cumulative shares','principal_manager','total_recombined_shares',asText],
 ['Returned SY value at exit · cumulative underlying atoms','principal_manager','total_recombined_underlying',asText],
 ['YT accounting edition','yt_token','accounting_edition',asText],
 ['Stored accounting rate','yt_token','accounting_rate',x=>Market.atomText(x,7)],
 ['YT notional reserve view · underlying atoms','yt_token','total_backing_credit',asText],
 ['Settled pending yield · underlying atoms','yt_token','total_pending',asText],
 ['Consumed yield · cumulative atoms','yt_token','total_claimed',asText],
 ['Recorded oracle samples','oracle_adapter','sample_count',asText],
 ['Inverse liability index · numerator','yt_token','inverse_index',asText],
 ['Reward denominator','yt_token','reward_scale',asText],
 ['Maximum supported oracle rate · scaled integer','yt_token','max_accounting_rate',asText]
];
function accounting(host){
 const selected=accountingViews.filter(([,c,m])=>hasAction(c,m));if(!selected.length)return;
 const grid=node('div',undefined,'grid');for(const [title,c,m,fmt]of selected)grid.append(panel(title,nativeCell(c,m,{},fmt),operationButton('Read current value',c,m)));
 host.append(panel('Accounting and managed backing',node('p','Each value comes from its own retained contract read. The stored accounting rate changes when the contract settles or updates its index. Read times can differ; this page does not combine them into a single ledger snapshot.'),button('Read all accounting values',()=>readSet(selected.map(([,c,m])=>[c,m])),true),grid));
 if(hasAction('yt_token','maturity_sample'))host.append(panel('Maturity settlement sample',node('p','Once fixed by settlement, this record identifies the first recorded oracle sample at or after maturity. Its source timestamp and ledger observation time remain visible in the original result.'),nativeCell('yt_token','maturity_sample'),operationButton('Read fixed maturity sample','yt_token','maturity_sample')));
 if(hasAction('oracle_adapter','get_sample')){
  const form=draftForm('oracle-history'),sequence=field(form,'Exact oracle sample sequence','sequence',{value:saved('oracle-history','sequence','1'),required:true,help:'Positive integer text, retained without numeric rounding.'}),submit=node('button','Read original oracle sample');submit.type='submit';form.append(submit);
  form.addEventListener('submit',e=>{e.preventDefault();handle(async()=>{capture(form,'oracle-history');const value=sequence.value.trim();if(!/^[1-9][0-9]*$/.test(value))throw failure('SAMPLE_SEQUENCE_REQUIRED','Use an exact positive sample sequence.');await readSet([['oracle_adapter','get_sample',{sequence:value}]]);});});
  host.append(panel('Recorded oracle history',form,nativeCell('oracle_adapter','get_sample',{sequence:saved('oracle-history','sequence','1').trim()}),operationButton('Find first sample at or after a timestamp','oracle_adapter','first_at_or_after')));
 }
}
function accountAccounting(host,selected){
 if(!hasAction('yt_token','yield_position'))return;
 const row=latestValue('yt_token','yield_position',{account:selected}),position=row?.value;
 const values=position&&typeof position==='object'?definitions({
  'YT balance · raw token units':position.balance,
  'YT notional reserve view · underlying atoms':position.backing_credit,
  'Settled pending yield · underlying atoms':position.pending,
  'Stored accounting rate':Market.atomText(position.current_rate,7),
  'Unsettled yield at the stored rate · underlying atoms':position.projected_yield,
  'Last settled factor':position.last_factor,
  'Current inverse index · numerator':position.inverse_index,
  'Last settled inverse index · numerator':position.last_inverse_index,
  'Stored earned fractional numerator':position.reward_remainder,
  'Fraction denominator':position.reward_scale
 }):empty('No yield position has been read for this account and exact deployment.');
 host.append(panel('Account yield accounting',node('p','This single contract result keeps balance, the notional reserve view, pending whole yield and the earned fractional numerator together. Ordinary transfers preserve earned whole and fractional yield with the original holder. Projected yield is the additional whole amount at the stored index; its original remainder and denominator remain visible. Claiming settles the current eligible rate and the manager measures the actual payout.'),button('Read complete yield position',()=>readSet([['yt_token','yield_position',{account:selected}]]),true),values,...(row?[json('Complete original accounting observation',row)]:[])));
}
function recoveryAccounting(host,escrowId){
 if(!hasAction('recovery_escrow','yield_recovery_count'))return;
 const queries=[['recovery_escrow','yield_recovery_count']];
 if(escrowId)queries.push(['yt_token','yield_position',{account:escrowId}]);
 const form=draftForm('yield-recovery-history'),sequence=field(form,'Exact yield recovery sequence','sequence',{value:saved('yield-recovery-history','sequence','1'),required:true}),submit=node('button','Read original yield recovery receipt');submit.type='submit';form.append(submit);
 form.addEventListener('submit',e=>{e.preventDefault();handle(async()=>{capture(form,'yield-recovery-history');const value=sequence.value.trim();if(!/^[1-9][0-9]*$/.test(value))throw failure('RECOVERY_SEQUENCE_REQUIRED','Use an exact positive recovery sequence.');await readSet([['recovery_escrow','yield_recovery_receipt',{sequence:value}]]);});});
 host.append(panel('Recovered yield ledger',node('p','Each receipt retains the original source account, issuer, YT amount, pending underlying, exact fractional numerator and recorded time. Separate issuer-authorized operations recover whole yield and the remaining earned fraction, including after the source account has transferred all YT.'),nativeCell('recovery_escrow','yield_recovery_count'),button('Read recovery count and escrow yield position',()=>readSet(queries)),form,nativeCell('recovery_escrow','yield_recovery_receipt',{sequence:saved('yield-recovery-history','sequence','1').trim()})));
}

function poolOperations(host){
 if(!hasAction('market_pool','quote_swap'))return;
 const value=latestValue('market_pool','reserves')?.value,configuration=latestValue('market_pool','configuration')?.value;
 const rows=value?[
 ['PT available to liquidity holders',value.reserve_pt],['SY available to liquidity holders',value.reserve_sy],
 ['Protocol SY fee claim',value.fee_sy],['Current creator SY fee claim',value.creator_sy],
 ['Liquidity shares · 4 decimals',Market.atomText(value.lp_supply,4)],['Local pause',value.paused],
 ]:[];
 const section=panel('PT / SY liquidity and exchange',node('p','Read the configured market before preparing an operation. Quotes retain the original oracle, wrapper rate, time and real reserves. A quote does not reserve a price.'),
  actions(operationButton('Read pool configuration','market_pool','configuration'),operationButton('Read real reserves and fees','market_pool','reserves'),operationButton('Read current pricing frame','market_pool','curve')),
  rows.length?table(rows,[{label:'Position',value:r=>r[0]},{label:'Amount or state',value:r=>r[1]}]):empty('No pool reserve observation has been retained for this deployment.'));
 if(configuration)section.append(json('Complete original market configuration',configuration));
 const f=draftForm('market:quote'),direction=node('select');direction.name='sy_in';direction.setAttribute('aria-label','Trade direction');
 for(const [id,label]of [['true','SY to PT'],['false','PT to SY']]){const o=node('option',label);o.value=id;direction.append(o);}
 direction.value=saved('market:quote','sy_in','true');f.append(direction);
 field(f,'Exact input atoms','amount_in',{value:saved('market:quote','amount_in',''),required:true,help:'PT uses original-rate notional atoms; SY uses the wrapper share atoms. Preserve exact integer text.'});
 const submit=node('button','Read and retain swap quote');submit.type='submit';f.append(submit);
 f.addEventListener('submit',event=>{event.preventDefault();handle(async()=>{const selected=capture(f,'market:quote'),parameters={sy_in:selected.sy_in==='true',amount_in:exact(selected.amount_in).toString()};
  await saveDraft();await command('observation.capture',{actionId:'market_pool.quote_swap',parameters},{binding:currentBinding('market_pool')});paint();
 });});
 section.append(f);
 const raw=view.drafts?.['market:quote'];let q=null;
 if(raw?.amount_in&&/^[0-9]+$/.test(raw.amount_in))q=latestValue('market_pool','quote_swap',{sy_in:raw.sy_in==='true',amount_in:exact(raw.amount_in).toString()});
 if(q?.value){const v=q.value;section.append(definitions({
  'Direction':v.sy_in?'SY to PT':'PT to SY','Input atoms':v.amount_in,'Gross output atoms':v.gross_amount_out,
  'Net output atoms':v.amount_out,'Total fee · SY atoms':v.total_fee,'Protocol · SY atoms':v.protocol_fee,
  'Current creator · SY atoms':v.creator_fee,'Fee tier · annualized basis points':v.fee_tier_bps,
  'Quote timestamp':dateLabel(v.frame?.sampled_at),'Remaining seconds':v.frame?.remaining,
  'Oracle reference · scaled integer':v.frame?.oracle_rate,'SY underlying value · scaled integer':v.frame?.sy_rate,
  'Pricing target · SY per PT scaled integer':v.frame?.target_price}),
  operationButton('Prepare this direction with explicit minimum and expiry','market_pool','swap',{from:state.config?.sourceAccount?.address??'',sy_in:v.sy_in,amount_in:String(v.amount_in),min_out:String(v.amount_out),expires:''}),
  json('Complete retained native quote',q),button('Download original quote',()=>downloadJSON(q,'principal-pool-quote-'+q.id+'.json')));}
 section.append(actions(
  operationButton('Add PT and SY liquidity','market_pool','add_liquidity'),
  operationButton('Remove actual liquidity','market_pool','remove_liquidity'),
  operationButton('Buy PT with underlying','router','buy_pt'),
  operationButton('Sell PT to underlying','router','sell_pt'),
  operationButton('Tokenize an explicit liquidity split','router','tokenize_liquidity'),
  operationButton('Claim current creator fees','market_pool','collect_creator_fees'),
  operationButton('Recover deauthorized LP backing','recovery_escrow','seize_lp')));
 section.append(node('p','Virtual balances influence quotes and cannot be withdrawn. Both swap directions charge SY fees. The current edition leaves existing tokenization and yield accounting unchanged. Paired pre-maturity exits are available from Account positions in the paired-exit source edition. YT selling and fee changes are not available.'));
 host.append(section);
}

function market(host){
 poolOperations(host);
 const cards=node('div',undefined,'grid');
 for(const [title,c,m,fmt]of [
  ['Oracle reference · USD per underlying','oracle_adapter','get_reference_value',x=>Market.atomText(x,7)],
  ['Oracle source timestamp','oracle_adapter','get_reference_timestamp',dateLabel],
  ['Market maturity','principal_manager','maturity',dateLabel],
  ['Maturity reached','principal_manager','is_mature',asText],
  ['SY custody · underlying raw units','sy_wrapper','total_underlying',asText],
  ['SY shares outstanding','sy_wrapper','total_shares',asText],
  ['PT total supply','pt_token','total_supply',x=>Market.atomText(x,Market.decimals(state,currentAPI(),'pt_token'))],
  ['YT total supply','yt_token','total_supply',x=>Market.atomText(x,Market.decimals(state,currentAPI(),'yt_token'))],
  ['Risk pause','risk_control','is_paused',asText],
  ['Circuit breaker limit · raw units','risk_control','get_cb_limit',asText],
  ['Circuit breaker volume · raw units','risk_control','get_cb_volume',asText]
 ])cards.append(panel(title,nativeCell(c,m,{},fmt),operationButton('Read current value',c,m)));
 host.append(cards);
 const queries=[['oracle_adapter','get_reference_value'],['oracle_adapter','get_reference_timestamp'],['principal_manager','maturity'],['principal_manager','is_mature'],['sy_wrapper','total_underlying'],['sy_wrapper','total_shares'],['sy_wrapper','exchange_rate'],['pt_token','decimals'],['pt_token','total_supply'],['yt_token','decimals'],['yt_token','total_supply'],['risk_control','is_paused'],['risk_control','get_cb_limit'],['risk_control','get_cb_volume']];
 host.prepend(panel('Market readings',node('p','Read each selected view through the installed native CLI. Complete results are saved separately as they arrive.'),button('Read all market values',()=>readSet(queries),true)));
 accounting(host);
 const topology=Market.topology(state,currentAPI());
 host.append(panel('Contract wiring',node('p','Compare observed contract getters with the selected deployment. Every match retains its own source observation; unobserved wiring remains visible.'),button('Read complete contract wiring',()=>readSet(topology.map(r=>[r.contract,r.method]))),table(topology,[{label:'Contract',value:r=>r.contract},{label:'Getter',value:r=>r.method},{label:'Expected',className:'identifier',value:r=>r.expected},{label:'Observed',className:'identifier',value:r=>r.observed},{label:'Result',value:r=>badge(r.status)}])));
 host.append(panel('Configured deployment',table(Market.CONTRACTS.map(contract=>({contract,...state.config?.contracts?.[contract]})),[{label:'Contract',value:r=>r.contract},{label:'Contract ID',className:'identifier',value:r=>r.id},{label:'WASM SHA-256',className:'identifier',value:r=>r.wasmSha256}]),button('Edit configuration',()=>go('settings')),reportButtons()));
}
function mintPreview(host,selected){
 if(!hasAction('principal_manager','preview_mint'))return;
 const key='mint-preview:'+selected,form=draftForm(key),shares=field(form,'Exact SY shares to split','sy_shares',{value:saved(key,'sy_shares',''),required:true,help:'Positive raw share atoms. The preview shows the exact issued notional and its difference from the original rate formula.'}),submit=node('button','Read mint preview');submit.type='submit';form.append(submit);
 form.addEventListener('submit',e=>{e.preventDefault();handle(async()=>{capture(form,key);const v=shares.value.trim();if(!/^[1-9][0-9]*$/.test(v))throw failure('SHARES_REQUIRED','Use exact positive SY share atoms.');await readSet([['principal_manager','preview_mint',{sy_shares:v}]]);});});
 const amount=saved(key,'sy_shares','').trim(),row=latestValue('principal_manager','preview_mint',{sy_shares:amount}),value=row?.value;
 const section=panel('Preview PT and YT issuance',node('p','Accounting edition 3 uses a conservative inverse index with an immutable denominator. Review both notional formulas and their exact integer difference before preparing the mint. A preview retains its own observation time; the eventual contract call evaluates its current eligible rate.'),form);
 if(value&&typeof value==='object'){
  section.append(definitions({'SY shares':value.sy_shares,'Valued underlying atoms':value.underlying,'Oracle rate · scaled integer':value.oracle_rate,'Inverse index':value.inverse_index,'Reward denominator':value.reward_scale,'Original-rate notional atoms':value.original_rate_notional,'Issued PT and YT atoms':value.issued_notional,'Issuance adjustment · notional atoms':value.issuance_adjustment}),json('Complete original mint preview',row),button('Prepare mint from this preview',()=>{const ctx=currentBinding('principal_manager');assertCurrentBinding(Market.observedBinding(row));chooseAction('principal_manager','mint',{from:selected,sy_shares:String(value.sy_shares)},ctx);}));
 }else section.append(empty('Read a preview for the exact share amount and deployment.'));
 host.append(section);
}

function recombinePreview(host,selected){
 if(!hasAction('principal_manager','preview_recombine'))return;
 const key='paired-exit:'+selected,form=draftForm(key),amount=field(form,'Equal PT and YT amount','amount',{value:saved(key,'amount',''),required:true,help:'Exact positive token atoms. The operation burns this amount of each token and returns current principal backing in SY.'});
 const submit=node('button','Read paired-exit quote');submit.type='submit';form.append(submit);
 form.addEventListener('submit',e=>{e.preventDefault();handle(async()=>{
  capture(form,key);const value=amount.value.trim();if(!/^[1-9][0-9]*$/.test(value))throw failure('PAIR_AMOUNT_REQUIRED','Use an exact positive amount held in both PT and YT.');
  await readSet([['principal_manager','preview_recombine',{from:selected,amount:value}]]);
 });});
 const raw=saved(key,'amount','').trim(),row=latestValue('principal_manager','preview_recombine',{from:selected,amount:raw}),q=row?.value;
 const section=panel('Exit a PT and YT pair before maturity',node('p','Return the pair’s current principal backing without a market trade. Earned yield stays with its original holder and remains claimable after all tokens are burned. Current PT and YT eligibility, fresh rates and complete backing are required.'),form);
 if(q&&typeof q==='object'){
  section.append(definitions({'PT and YT burned · each':q.amount,'SY shares returned':q.sy_shares,'Principal allowance · underlying atoms':q.underlying_allowance,'Returned SY value · underlying atoms':q.underlying_value,'Rounding retained in backing · underlying atoms':q.retained_rounding,'Earned yield kept for this holder · underlying atoms':q.pending_yield,'Earned fractional numerator kept':q.reward_remainder,'Oracle rate · scaled integer':q.oracle_rate,'Wrapper rate · scaled integer':q.sy_rate,'Sampled ledger timestamp':q.sampled_at,'Maturity timestamp':q.maturity}),
   node('p','The quote is one native observation. The exit evaluates rates and eligibility again; retain an explicit minimum and, for a Router route, an expiry. Returned SY is separate from previously earned yield.'),
   json('Complete original paired-exit quote',row));
  const assertAmount=value=>{if(amount.value.trim()!==String(value.amount)||saved(key,'amount','').trim()!==String(value.amount))throw failure('PAIR_QUOTE_CHANGED','Read a new quote for the edited pair amount.');};
  section.append(actions(button('Prepare direct Manager exit to SY',()=>{assertAmount(q);const b=Market.observedBinding(row);assertCurrentBinding(b);chooseAction('principal_manager','recombine',{from:selected,amount:String(q.amount),min_sy:String(q.sy_shares)},b);},true),
   button('Claim earned yield separately',()=>chooseAction('principal_manager','claim_yield',{from:selected},currentBinding('principal_manager'))),
   button('Read Router configuration and paired-exit quote',async()=>{assertAmount(q);assertCurrentBinding(Market.observedBinding(row));await readSet([['principal_manager','underlying_address'],['router','configuration'],['router','preview_recombine',{from:selected,amount:String(q.amount)}]]);})));
  const rq=latestValue('router','preview_recombine',{from:selected,amount:raw}),rc=latestValue('router','configuration'),mu=latestValue('principal_manager','underlying_address'),rv=rq?.value,config=rc?.value;
  const targets={manager:'principal_manager',sy:'sy_wrapper',pt:'pt_token',yt:'yt_token',oracle:'oracle_adapter',permissioning:'permissioning'};
  const matches=config&&rv&&Object.entries(targets).every(([field,contract])=>typeof config[field]==='string'&&config[field]===state.config?.contracts?.[contract]?.id)
   &&typeof mu?.value==='string'&&config.underlying===mu.value&&String(config.maturity)===String(rv.maturity)&&String(config.maturity)===String(q.maturity)&&String(rv.amount)===raw;
  if(matches){
   const select=(method,parameters)=>{assertAmount(rv);assertCurrentBinding(Market.observedBinding(row));const b=Market.observedBinding(rq);assertCurrentBinding(b);assertCurrentBinding(Market.observedBinding(rc));assertCurrentBinding(Market.observedBinding(mu));
    const current=latestValue('router','configuration')?.value;
    if(Market.canonical(current)!==Market.canonical(config)||current?.underlying!==mu.value||!Object.entries(targets).every(([field,contract])=>current[field]===state.config?.contracts?.[contract]?.id))throw failure('ROUTER_TARGET_CHANGED','Read the selected Router and its source contracts again.');
    chooseAction('router',method,parameters,b);
   };
   section.append(json('Complete bound Router configuration',rc),json('Complete original Router paired-exit quote',rq),
    definitions({'Router SY shares returned':rv.sy_shares,'Router returned underlying atoms':rv.underlying_value,'Underlying SAC selected by Router':config.underlying}),
    button('Prepare Router exit to SY with expiry',()=>select('recombine',{from:selected,amount:String(rv.amount),min_sy:String(rv.sy_shares),expires:''})));
   if(exact(rv.underlying_value)>0n)section.append(button('Prepare Router exit and unwrap to underlying',()=>select('recombine_underlying',{from:selected,amount:String(rv.amount),min_underlying:String(rv.underlying_value),expires:''})));
   else section.append(node('p','The Router quote returns SY that currently rounds to zero underlying atoms. Use the SY route; the original wrapper rejects a zero-value unwrap.'));
  }else section.append(node('p','Router shortcuts require its own original quote and configuration matching the selected Manager, SY, PT, YT, oracle, underlying SAC and permissioning contracts. Read those exact Router observations before preparing an atomic unwrap.'));
 }else section.append(empty('Read the quote for this exact account, pair amount and deployment.'));
 host.append(section);
}

function account(host){
 const f=draftForm('account-position'),input=field(f,'Public account or contract address','account',{value:saved('account-position','account',view.selectedAccount??state.config?.sourceAccount?.address??''),required:true});
 const submit=node('button','Read account positions','primary');submit.type='submit';f.append(submit);
 f.addEventListener('submit',e=>{e.preventDefault();handle(async()=>{
  const address=input.value.trim();if(!/^[GC][A-Z2-7]{55}$/.test(address))throw failure('ACCOUNT_REQUIRED','Use the full public address.');
  view.selectedAccount=address;capture(f,'account-position');await saveDraft();
  const q=[['sy_wrapper','balance_of',{account:address}],['pt_token','balance',{account:address}],['yt_token','balance',{account:address}],['pt_token','decimals'],['yt_token','decimals'],['yt_token','pending_claim',{account:address}],['yt_token','last_claimed_index',{account:address}],['yt_token','accrued_yield_index'],['permissioning','is_allowed',{account:address}]];
  if(hasAction('yt_token','yield_position'))q.push(['yt_token','yield_position',{account:address}]);
  for(const asset of ['pt_token','yt_token'])if(state.config?.contracts?.[asset]?.id)q.push(['permissioning','is_allowed_for_asset',{account:address,asset:state.config.contracts[asset].id}]);await readSet(q);
 });});
 host.append(panel('Select account',f));
 const selected=view.selectedAccount??saved('account-position','account','');if(!selected){host.append(empty('Select a public account to review its original contract readings.'));return;}
 const grid=node('div',undefined,'grid');
 for(const [label,c,m,fmt]of [['SY balance','sy_wrapper','balance_of',asText],['PT balance','pt_token','balance',v=>Market.atomText(v,Market.decimals(state,currentAPI(),'pt_token'))],['YT balance','yt_token','balance',v=>Market.atomText(v,Market.decimals(state,currentAPI(),'yt_token'))],['Stored accrued yield · underlying raw units','yt_token','pending_claim',asText],['Last accounted yield index','yt_token','last_claimed_index',asText],['Additional account eligibility','permissioning','is_allowed',asText]])grid.append(panel(label,nativeCell(c,m,{account:selected},fmt)));
 host.append(panel('Original account selection',node('p',selected,'identifier')),grid);
 accountAccounting(host,selected);
 mintPreview(host,selected);
 recombinePreview(host,selected);
 host.append(panel('Prepare account operations',node('p','Enter exact raw amounts in the operation form. The selected contracts evaluate current authorization, eligibility and available backing.'),actions(operationButton('Deposit underlying','sy_wrapper','deposit',{from:selected}),operationButton('Withdraw SY','sy_wrapper','withdraw',{from:selected,to:selected}),operationButton('Mint PT and YT','principal_manager','mint',{from:selected}),operationButton('Claim accrued yield','principal_manager','claim_yield',{from:selected}),operationButton('Redeem at maturity','principal_manager','redeem',{from:selected})),actions(operationButton('Transfer PT','pt_token','transfer',{from:selected}),operationButton('Transfer YT','yt_token','transfer',{from:selected}),operationButton('Review PT allowance','pt_token','allowance',{from:selected}),operationButton('Review YT allowance','yt_token','allowance',{from:selected}))));
 const rows=(state.observations??[]).filter(r=>Object.values(r.parameters??{}).includes(selected));
 host.append(panel('Original account observation history',table([...rows].reverse(),[{label:'Action',value:r=>r.actionId},{label:'Time',value:r=>r.createdAt},{label:'Status',value:r=>r.status},{label:'Review',value:r=>button('Open complete original',()=>detail('Account observation',json('Retained original',r,true)))}])));
}


function escrow(host){
 const cfg=state.config??{},escrowId=cfg.contracts?.recovery_escrow?.id,caller=cfg.sourceAccount?.address??'',caseRows=Market.cases(state);
 const sameId=caseRows.filter(r=>r.caseId===view.recoveryCaseId);
 const selected=caseRows.find(r=>r.key===view.recoveryCaseKey)??(sameId.length===1?sameId[0]:null);
 const basis=selected?.unique?{note:selected.note,value:selected.value}:selected?.tips.find(t=>t.note.id===view.recoveryBasisNoteId)??null;
 const main=panel('RecoveryEscrow',node('p','Record the issuer’s review, prepare the exact seize or maturity-finalization operation, and reconcile its original observations and retained events. Contract execution checks the underlying SAC’s current administrator and the target’s authorization.'),definitions({'Escrow contract':escrowId,'Configured signing account':caller}));
 main.append(actions(operationButton('Read underlying SAC address','recovery_escrow','underlying_address')));
 if(escrowId)main.append(button('Read escrow PT and YT balances',()=>readSet([['pt_token','balance',{account:escrowId}],['yt_token','balance',{account:escrowId}],['principal_manager','is_mature']])),definitions({'Original PT balance':latestValue('pt_token','balance',{account:escrowId})?.value,'Original YT balance':latestValue('yt_token','balance',{account:escrowId})?.value}));
 host.append(main);
 recoveryAccounting(host,escrowId);
 const startNew=async()=>{collect();view.recoveryCaseId=null;view.recoveryCaseKey=null;view.recoveryBasisNoteId=null;view.recoveryCopySource=null;view.newRecoveryCaseId=crypto.randomUUID();await saveDraft();paint();};
 const listing=table(caseRows,[{label:'Case',value:r=>button(r.caseId,()=>{collect();view.recoveryCaseId=r.caseId;view.recoveryCaseKey=r.key;view.recoveryBasisNoteId=null;view.offset=0;handle(saveDraft);paint();})},{label:'Original account',className:'identifier',value:r=>r.account},{label:'Escrow / network',value:r=>asText(r.binding?.contractId)+' · '+asText(r.binding?.passphrase)},{label:'History',value:r=>badge(r.status)},{label:'Review stage',value:r=>r.value?.stage??'Select and resolve original editions'},{label:'Editions / tips',value:r=>r.history.length+' / '+r.tips.length}]);
 host.append(panel('Recovery case register',button('Start a new case',startNew),listing));
 if(selected){
  const history=panel('Original case history',definitions({'Case':selected.caseId,'Account':selected.account,'Escrow':selected.binding?.contractId,'RPC':selected.binding?.rpcUrl,'History state':selected.status}),json('Every saved edition, parent link and conflict',selected,true));
  if(!selected.unique){
   history.append(node('p',selected.errors.length?'This original history has invalid ancestry. Review it and explicitly copy a selected basis to a new case.':'Select one current tip as the editable basis, then acknowledge all competing tips to save a merged edition.'));
   const choice=node('select');choice.setAttribute('aria-label','Recovery case resolution basis');const emptyChoice=node('option','Select an original tip');emptyChoice.value='';choice.append(emptyChoice);
   for(const item of selected.tips){const option=node('option',item.note.id+' · '+asText(item.value.stage)+' · '+asText(item.value.operator));option.value=item.note.id;choice.append(option);}
   choice.value=basis?.note.id??'';choice.addEventListener('change',()=>handle(async()=>{collect();view.recoveryBasisNoteId=choice.value||null;await saveDraft();paint();}));history.append(choice);
  }
  const copy=button('Copy selected basis to a new case in the current configuration',async()=>{
   if(!basis)throw failure('CASE_BASIS_REQUIRED','Select an original tip to copy.');Market.checkCase(basis.value);
   const binding=currentBinding('recovery_escrow');if(!Market.completeBinding(binding))throw failure('CONTRACT_BINDING_REQUIRED','Complete the current RecoveryEscrow configuration before copying.');
   collect();const id=crypto.randomUUID(),prior=basis.value,fields={};for(const k of ['account','operator','reason','review'])fields[k]=prior[k]??'';fields.stage='REVIEW';for(const k of ['fileIds','observationIds','planIds','eventIds'])fields[k]=(prior[k]??[]).join('\n');
   view.recoveryCopySource={caseId:selected.caseId,binding:structuredClone(selected.binding),account:selected.account,noteIds:selected.history.map(x=>x.note.id)};
   view.recoveryCaseId=null;view.recoveryCaseKey=null;view.recoveryBasisNoteId=null;view.newRecoveryCaseId=id;view.drafts??={};view.drafts['escrow-case:'+id+':new']=fields;
   await saveDraft();paint();notice('Copied the selected basis into a new editable case with every original source-note reference. Save it to retain the new case.');
  });copy.disabled=!basis;
  history.append(actions(copy,button('Download complete case history',()=>downloadJSON(selected,'principal-recovery-case-'+selected.caseId+'.json'))));host.append(history);
  if(!basis){host.append(reportButtons());return;}
 }
 if(!selected&&!view.newRecoveryCaseId)view.newRecoveryCaseId=crypto.randomUUID();
 const caseId=selected?.caseId??view.newRecoveryCaseId,prior=basis?.value??{},key='escrow-case:'+caseId+':'+(basis?.note.id??'new'),f=draftForm(key);
 // Preserve older complete drafts once; following editions get distinct editable keys.
 view.drafts??={};if(!view.drafts[key]&&selected?.unique&&view.drafts['escrow-case:'+caseId])view.drafts[key]=structuredClone(view.drafts['escrow-case:'+caseId]);
 for(const [label,name]of [['Affected public account','account'],['Reviewing operator','operator']]){const input=field(f,label,name,{value:saved(key,name,prior[name]??(name==='account'?view.selectedAccount??'':'')),required:true});if(name==='account'&&selected)input.readOnly=true;}
 if(selected){const retained=Object.entries(view.drafts).filter(([draftKey])=>draftKey.startsWith('escrow-case:'+caseId+':')&&draftKey!==key&&selected.history.some(item=>draftKey==='escrow-case:'+caseId+':'+item.note.id));if(retained.length)host.append(panel('Earlier unfinished case edits',node('p','Every earlier edit remains in the working copy. Choose a complete saved edit to copy into this selected basis, then review all current tips.'),...retained.map(([draftKey,fields])=>actions(button('Copy unfinished edit from '+draftKey.split(':').slice(2).join(':'),async()=>{collect();view.drafts[key]={...structuredClone(fields),account:prior.account};for(const k of Object.keys(view.drafts[key]))if(k.startsWith('ack:'))delete view.drafts[key][k];await saveDraft();paint();}),json('Complete unfinished fields',fields)))));}
 if(selected)f.append(node('p','The original account and contract binding stay fixed in this case. Use the explicit copy control to begin a new case for another account or deployment.','field-help'));
 if(!selected&&view.recoveryCopySource)f.append(json('Original history retained by this new case',view.recoveryCopySource,true));
 const select=node('select');select.name='stage';
 for(const v of ['REVIEW','SEIZURE_PREPARED','POSITIONS_HELD','FINALIZATION_PREPARED','RECONCILED','CLOSED']){const o=node('option',v.replaceAll('_',' '));o.value=v;select.append(o);}
 select.value=saved(key,'stage',prior.stage??'REVIEW');const wrap=node('label','Operator review stage');wrap.append(select);f.append(wrap);
 field(f,'Reason for this review','reason',{value:saved(key,'reason',prior.reason??''),type:'textarea',required:true,rows:3});
 field(f,'Complete review and decision record','review',{value:saved(key,'review',prior.review??''),type:'textarea',rows:6});
 for(const [label,name,records]of [['Original file IDs','fileIds',state.files],['Contract observation IDs','observationIds',state.observations],['Prepared operation IDs','planIds',state.plans],['Retained event IDs','eventIds',state.events]]){
  const input=field(f,label+' · one per line',name,{value:saved(key,name,(prior[name]??[]).join('\n')),type:'textarea',rows:3});
  const picker=node('select');picker.setAttribute('aria-label','Select '+label);const none=node('option','Select a retained original');none.value='';picker.append(none);
  for(const record of [...(records??[])].reverse()){const id=String(record.id??record.eventId),option=node('option',(record.name??record.actionId??record.type??id)+' · '+id);option.value=id;picker.append(option);}
  f.append(actions(picker,button('Add selected original',async()=>{if(!picker.value)return;const ids=input.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!ids.includes(picker.value))ids.push(picker.value);input.value=ids.join('\n');capture(f,key);await saveDraft();})));
 }
 const otherTips=selected?selected.tips.filter(t=>t.note.id!==basis.note.id):[];
 if(otherTips.length){const ack=panel('Acknowledge every competing tip',node('p','The new edition keeps the selected basis plus all acknowledged tips as parents. Review each complete original and record the resolution above.'));
  for(const item of otherTips){const name='ack:'+item.note.id,label=node('label'),input=textInput(name,'','checkbox');input.checked=saved(key,name,false)===true;input.required=true;label.append(input,node('span','I reviewed '+item.note.id+' · '+asText(item.value.stage)));ack.append(label,json('Complete competing edition '+item.note.id,item,true));}f.append(ack);}
 const save=node('button',otherTips.length?'Save merged case edition':'Save complete case edition','primary');save.type='submit';save.disabled=!!selected?.errors.length;f.append(save);
 f.addEventListener('submit',e=>{e.preventDefault();handle(async()=>{
  const raw=capture(f,key);
  if(otherTips.some(item=>raw['ack:'+item.note.id]!==true))throw failure('CASE_TIPS_UNREVIEWED','Review and acknowledge every competing tip before saving.');
  const value={schema:Market.CASE_SCHEMA,caseId,binding:prior.binding??currentBinding('recovery_escrow'),account:raw.account.trim(),operator:raw.operator,reason:raw.reason,review:raw.review,stage:raw.stage,previousNoteId:basis?.note.id??null,resolvedNoteIds:otherTips.map(item=>item.note.id)};
  if(!selected&&view.recoveryCopySource)value.sourceCase=structuredClone(view.recoveryCopySource);else if(prior.sourceCase)value.sourceCase=structuredClone(prior.sourceCase);
  for(const k of ['fileIds','observationIds','planIds','eventIds'])value[k]=raw[k].split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  Market.checkReferences(value,state);assertCurrentBinding(value.binding);
  await command('note.save',{subjectId:'recovery-case:'+caseId,title:'Recovery '+caseId+' · '+value.stage,body:pretty(value)},{binding:value.binding,before:()=>Market.checkReferences(value,state)});
  view.recoveryCaseId=caseId;view.recoveryCaseKey=Market.caseKey(value);view.recoveryBasisNoteId=null;view.recoveryCopySource=null;view.newRecoveryCaseId=null;await saveDraft();paint();
 });});
 host.append(panel(selected?(selected.unique?'Current recovery case':'Resolve competing case editions'):'New recovery case',definitions({'Case':caseId,'Selected original basis':basis?.note.id}),f));
 if(selected?.unique){
  const v=selected.value,ctx=v.binding,p=panel('Prepare from this case',node('p','Case stages are retained operator decisions. Inspect the original native result before recording a later stage.'));
  p.append(actions(...[['Seize SY','seize_sy'],['Seize PT','seize_pt'],['Seize YT','seize_yt'],['Recover settled yield','recover_yield'],['Recover earned fraction','recover_fraction'],['Finalize PT','finalize_pt'],['Finalize YT','finalize_yt'],['Finalize settled yield','finalize_yield']].filter(([,method])=>hasAction('recovery_escrow',method)).map(([label,method])=>button(label,()=>{Market.currentCase(state,{key:selected.key,noteId:selected.note.id});assertCurrentBinding(ctx);chooseAction('recovery_escrow',method,{caller,...((method.startsWith('seize')||method.startsWith('recover_'))?{account:v.account}:{})},ctx,{key:selected.key,noteId:selected.note.id});}))));
  p.append(button('Open retained event history',()=>go('events')));host.append(p);
 }
 host.append(reportButtons());
}
function events(host){
 const f=draftForm('event-query'),raw=field(f,'Complete original event query','query',{value:saved('event-query','query',pretty({contractKeys:['recovery_escrow'],startLedger:'',limit:'100',eventType:'contract'})),type:'textarea',rows:9,required:true,help:'Choose an exact start ledger or the original opaque continuation cursor. Limit is exact integer text.'});
 const previous=field(f,'Original previous page ID · for continuation','previousPageId',{value:saved('event-query','previousPageId','')});
 const submit=node('button','Read and retain event page','primary');submit.type='submit';f.append(submit);
 f.addEventListener('submit',e=>{e.preventDefault();handle(async()=>{
  capture(f,'event-query');const query=JSON.parse(raw.value),args={query};if(previous.value.trim())args.previousPageId=previous.value.trim();await command('event.capture',args);
 });});
 host.append(panel('Read original contract events',node('p','Each capture retains the full provider page and its original network, contract selection and continuation. Earlier pages remain available when the provider retention window changes.'),f,json('Installed event query contract',boot.capabilities?.events??{})));
 const pages=[...(state.eventPages??[])].reverse();
 host.append(panel('Captured event pages',table(pages,[{label:'Page',value:r=>button(r.id??r.pageId,()=>detail('Original event page',json('Complete retained page',r,true)))},{label:'Captured',value:r=>r.createdAt},{label:'Events',value:r=>r.eventCount??r.events?.length},{label:'Coverage',value:r=>r.coverage},{label:'Continuation',className:'identifier',value:r=>r.cursor??r.nextCursor},{label:'Reuse query',value:r=>button('Continue original query',async()=>{const next=r.nextQuery;if(!next)throw failure('CONTINUATION_UNAVAILABLE','This retained page has no prepared continuation. Inspect its original response and query.');view.drafts??={};view.drafts['event-query']={query:pretty(next),previousPageId:r.id??r.pageId};await saveDraft();paint();})}])));
 host.append(panel('Retained events',table([...(state.events??[])].reverse(),[{label:'Event ID',className:'identifier',value:r=>r.id??r.eventId},{label:'Ledger',value:r=>r.ledger},{label:'Contract',className:'identifier',value:r=>r.contractId},{label:'Event type',value:r=>r.type},{label:'Identity review',value:r=>r.identityConflict?'CONFLICT':'Retained'},{label:'Review',value:r=>button('Open original event',()=>detail('Contract event',json('Complete original event and page binding',r,true)))}]),reportButtons()));
}
