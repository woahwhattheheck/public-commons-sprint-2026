// MIT. Private operator for original retained DuckDB results and native VGI.
const $=selector=>document.querySelector(selector);
const body=document.body,content=$('#workspace-content');
const key='starforge-vgi:'+location.origin;
let capability=location.hash.slice(1)||sessionStorage.getItem(key+':capability')||'';
if(capability)sessionStorage.setItem(key+':capability',capability);
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
let state=null,view=sessionStorage.getItem(key+':view')||'catalog',selectedPublication=null,review=null,historyPage=null;
let busy=false;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const rows=(value,name)=>Array.isArray(value)?value:Array.isArray(value?.[name])?value[name]:[];
const readStored=(name,fallback)=>{try{return JSON.parse(sessionStorage.getItem(key+':'+name))??fallback;}catch{return fallback;}};
let pending=readStored('pending',[]),drafts=readStored('drafts',{});
if(!Array.isArray(pending))pending=[];
if(!object(drafts))drafts={};
function save(name,value){sessionStorage.setItem(key+':'+name,JSON.stringify(value));}
function nonce(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');}
function node(tag,attrs={},...children){const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(v==null)continue;if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='text')n.textContent=v;else if(k==='value')n.value=String(v);else if(k==='checked')n.checked=!!v;else if(k==='disabled')n.disabled=!!v;else n.setAttribute(k,String(v));}for(const c of children.flat(Infinity)){if(c!=null)n.append(c instanceof Node?c:document.createTextNode(String(c)));}return n;}
const p=(text,cls)=>node('p',{class:cls},text);
const code=text=>node('code',{},text??'');
const badge=text=>node('span',{class:'tag'},text??'');
function button(text,fn,opts={}){return node('button',{type:'button',onclick:()=>run(fn),...opts},text);}
function table(headers,data){return node('div',{class:'table-wrap'},node('table',{},node('thead',{},node('tr',{},headers.map(v=>node('th',{},v)))),node('tbody',{},data.map(row=>node('tr',{},row.map(cell=>node('td',{},cell)))))));}
function panel(title,...children){return node('section',{class:'panel'},node('h2',{},title),...children);}
function details(title,value){return node('details',{},node('summary',{},title),node('pre',{},typeof value==='string'?value:JSON.stringify(value,null,2)));}
function info(items){return node('dl',{},Object.entries(items).flatMap(([name,value])=>[node('dt',{},name),node('dd',{},value??'—')]));}
function field(label,element,note){return node('label',{},label,element,note?node('small',{},note):null);}
function input(id,value='',type='text',attrs={}){return node('input',{id,type,value,...attrs});}
function selection(id,list,current,placeholder){const el=node('select',{id},placeholder?node('option',{value:''},placeholder):null,list.map(([value,label])=>node('option',{value},label)));el.value=current??'';return el;}
function notice(text){$('#notice').textContent=text||'';}
function errorText(error){$('#error').hidden=false;$('#error').textContent=error.message||String(error);}
function clearError(){$('#error').hidden=true;$('#error').textContent='';}
async function run(fn){if(busy)return;busy=true;body.classList.add('busy');clearError();try{await fn();}catch(error){errorText(error);}finally{busy=false;body.classList.remove('busy');}}
function authHeaders(json=false){return {'X-DuckDB-Capability':capability,...(state?.workspace_id?{'X-DuckDB-Workspace-ID':state.workspace_id}:{}),...(json?{'Content-Type':'application/json'}:{})};}
async function get(path){const response=await fetch(path,{headers:authHeaders(),cache:'no-store'});const text=await response.text();let result;try{result=JSON.parse(text);}catch{throw new Error('The complete response could not be decoded. Refresh the original workspace.');}if(!response.ok){if(response.status===403&&result.error==='DUCKDB_OPERATOR_CAPABILITY_REQUIRED'){$('#connection').hidden=false;$('#main').hidden=true;}throw new Error(result.error||'Request failed ('+response.status+').');}return result;}
function persistPending(){save('pending',pending);}
async function sendRetained(item){item.state='SENDING';item.last_attempt=new Date().toISOString();persistPending();let response,text,result;
try{response=await fetch(item.path,{method:'POST',headers:authHeaders(true),body:item.body});text=await response.text();result=JSON.parse(text);}catch(error){item.state='AWAITING_REPLY';item.error='The complete reply was not received. Continue this same request from History and recovery.';persistPending();throw new Error(item.error);}
if(!response.ok){item.state='REVIEW_REQUIRED';item.error=result.error||'Request failed ('+response.status+').';item.status=response.status;persistPending();throw new Error(item.error+' Original request: '+item.id);}
pending=pending.filter(row=>row!==item);persistPending();return result;}
async function post(path,value){if(pending.filter(row=>row.workspace_id===state?.workspace_id).length>=32)throw new Error('Review retained requests before starting another operation.');const item={id:value.request_id||path.match(/^\/api\/requests\/([a-f0-9]{32})\/resume$/)?.[1]||nonce(),workspace_id:state?.workspace_id,path,body:JSON.stringify(value),created_at:new Date().toISOString(),state:'PREPARED'};pending.push(item);persistPending();return sendRetained(item);}
function draft(name,value){drafts[name]=value;save('drafts:'+state.workspace_id,drafts);}
function clearDraft(name){delete drafts[name];save('drafts:'+state.workspace_id,drafts);}
async function refresh({message='',render=true}={}){const next=await get('/api/vgi/state');if(state&&state.workspace_id!==next.workspace_id)throw new Error('The original workspace identity changed. Reopen its private launch URL.');if(!state){drafts=readStored('drafts:'+next.workspace_id,{});if(!object(drafts))drafts={};}state=next;$('#connection').hidden=true;$('#main').hidden=false;$('#warehouse-link').href='/#'+capability;$('#identity').replaceChildren(badge(state.runtime?.observed||'STOPPED'),node('span',{},'Workspace ',code(state.workspace_id)),node('span',{},'Service ',code(state.service_id)),node('span',{},'Revision '+state.revision));if(message)notice(message);if(render)renderView();}
function navigate(next){view=next;sessionStorage.setItem(key+':view',view);clearError();renderView();}
function renderView(){if(!state)return;for(const b of document.querySelectorAll('nav button'))b.setAttribute('aria-current',b.dataset.view===view?'page':'false');content.replaceChildren();({catalog:renderCatalog,publish:renderPublish,access:renderAccess,runtime:renderRuntime,recovery:renderRecovery}[view]||renderCatalog)();}
const short=value=>String(value??'').length>20?String(value).slice(0,12)+'…'+String(value).slice(-6):String(value??'');
function selectPublication(id){return async()=>{selectedPublication=await get('/api/vgi/publications/'+encodeURIComponent(id));view='catalog';renderView();};}
function renderCatalog(){const tables=rows(state.tables),publications=rows(state.publications);content.append(panel('Published catalog',node('div',{class:'metrics'},node('div',{class:'metric'},tables.filter(x=>x.active).length,node('small',{},'active tables')),node('div',{class:'metric'},publications.length,node('small',{},'retained publications'))),p('The running listener keeps its selected catalog heads. Restart it after selecting a new head. Existing continuation tokens keep their original publication while its table and principal remain active.','muted'),tables.length?table(['Table','State','Head revision','Publication','Actions'],tables.map(t=>[node('strong',{},t.name),badge(t.active?'ACTIVE':'RETIRED'),String(t.head_revision),code(short(t.publication_id)),node('div',{class:'actions'},button('Inspect',selectPublication(t.publication_id)),button(t.active?'Retire table':'Activate table',async()=>{await post('/api/vgi/activate',{request_id:nonce(),table_name:t.name,publication_id:t.publication_id,expected_head_revision:t.head_revision,active:!t.active});await refresh({message:'Saved table selection. Current policy applies to the next request.'});}))])):p('Review a complete export to publish the first table.','empty')));
if(publications.length)content.append(panel('Retained editions',table(['Table','Rows','Batches','Created','Source export',''],[...publications].reverse().map(item=>[item.table_name,String(item.rows),String(item.batch_count),item.created_at,code(short(item.source?.export_id)),button('Open edition',selectPublication(item.publication_id))]))));
if(selectedPublication){const v=selectedPublication,t=tables.find(x=>x.name===v.table_name);content.append(panel('Publication · '+v.table_name,info({'Publication':code(v.publication_id),'Source export':code(v.source?.export_id),'Rows':String(v.rows),'Read batches':String(v.batch_count),'Schema SHA-256':code(v.arrow_schema_sha256),'Reviewed selection':code(v.review_sha256)}),node('div',{class:'actions editor'},t?button('Select this retained edition',async()=>{await post('/api/vgi/activate',{request_id:nonce(),table_name:v.table_name,publication_id:v.publication_id,expected_head_revision:t.head_revision,active:true});await refresh({message:'Selected the retained edition. Restart the listener to expose its new catalog head.'});}):null,button('Download publication descriptor',()=>downloadJSON(v,'vgi-publication-'+v.publication_id+'.json'))),table(['Column','Arrow type','Original query type','Export encoding'],rows(v.arrow_columns).map((c,i)=>[c.name,c.type,v.query_columns?.[i]?.type||'',v.column_encodings?.[i]?JSON.stringify(v.column_encodings[i]):'Original export type'])),details('Original source members and meaning',v.source),details('Exact retained batch sequence',v.batches)));}}
function currentPublishDraft(){return {export_id:rows(state.buyer?.exports).at(-1)?.export_id||'',batch_rows:4096,table_name:'purchased_events',...drafts.publish};}
function retainPublish(){const d={export_id:$('#export-select')?.value||'',batch_rows:Number($('#batch-rows')?.value||4096),table_name:$('#publish-table')?.value||'purchased_events'};draft('publish',d);return d;}
function renderPublish(){const d=currentPublishDraft(),exports=rows(state.buyer?.exports).filter(x=>x.state==='COMPLETE'),queries=rows(state.buyer?.queries);
const query=selection('query-select',queries.map(q=>[q.query_id,q.name+' · revision '+q.revision]),drafts.query_id,'Select an existing saved query');
const queryForm=node('form',{onsubmit:e=>{e.preventDefault();run(async()=>{const q=queries.find(x=>x.query_id===query.value);if(!q)throw new Error('Select an existing saved query.');draft('query_id',q.query_id);const result=await post('/api/exports',{request_id:nonce(),query_id:q.query_id,expected_revision:q.revision,expected_views:state.buyer.views});const exported=result.result||result;draft('publish',{...d,export_id:exported.export_id||result.export_id});review=null;await refresh({message:'The original buyer retained its complete query export.'});});}},field('Saved original query',query,'The buyer executes the saved revision against these exact current view editions.'),details('Selected original view editions',state.buyer.views),node('button',{id:'prepare-query-export',class:'primary',disabled:!queries.length},'Prepare complete query export'));
content.append(panel('Prepare a result',p('Use an existing completed export, or execute a saved original query through the buyer. Source acquisition and payment remain in the existing buyer workflow.','muted'),queries.length?queryForm:p('Create a saved query in the original buyer workspace.','empty')));
const exportSelect=selection('export-select',exports.map(x=>[x.export_id,(x.query?.name||short(x.export_id))+' · '+x.rows+' rows · '+short(x.export_id)]),d.export_id,'Select a complete export');
const size=input('batch-rows',d.batch_rows,'number',{min:1,max:4096,step:1,required:''});
const alias=input('publish-table',d.table_name,'text',{pattern:'[A-Za-z][A-Za-z0-9_]{0,119}',maxlength:120,required:''});
for(const el of [exportSelect,size,alias])el.addEventListener('input',()=>{retainPublish();if(el!==alias)review=null;});
const reviewForm=node('form',{onsubmit:e=>{e.preventDefault();run(async()=>{const d=retainPublish();if(!d.export_id)throw new Error('Select a complete export.');review=await post('/api/vgi/review',{export_id:d.export_id,batch_rows:d.batch_rows});renderView();notice('Review captured the complete original export and selected read size.');});}},field('Complete original export',exportSelect),node('div',{class:'form-row'},field('Rows per input batch',size,'1–4096. Exact IPC byte limits may split a selected batch further.'),field('Published table name',alias,'Use a new name when the Arrow schema changes.')),node('button',{id:'review-export',class:'primary',disabled:!exports.length},'Review exact export'));
content.append(panel('Review and publish',reviewForm));
if(review){const v=review;content.append(panel('Reviewed result',info({'Export':code(v.export_id),'Rows':String(v.rows),'Review SHA-256':code(v.review_sha256),'Selected batch rows':String(v.limits?.input_batch_rows),'Maximum IPC bytes':String(v.limits?.ipc_batch_bytes)}),table(['Column','Query type','Published Arrow type'],rows(v.columns).map((c,i)=>[c.name,v.query_columns?.[i]?.type||c.type,v.arrow_columns?.[i]?.type||''])),details('Complete original encodings',v.column_encodings),details('Source editions, dictionary and file identities',v.source),details('Original Parquet row groups',v.parquet_row_groups),button('Publish retained result',async()=>{const d=retainPublish();if(d.export_id!==v.export_id||d.batch_rows!==v.limits.input_batch_rows)throw new Error('Review the currently selected export and batch size.');if(!/^[A-Za-z][A-Za-z0-9_]{0,119}$/.test(d.table_name))throw new Error('Enter a valid table name.');const t=rows(state.tables).find(x=>x.name.toLowerCase()===d.table_name.toLowerCase());const result=await post('/api/vgi/publish',{request_id:nonce(),table_name:d.table_name,export_id:v.export_id,review_sha256:v.review_sha256,expected_head_revision:t?.head_revision||0});selectedPublication=result.publication;review=null;clearDraft('publish');view='catalog';await refresh({message:'Published the complete retained result. Access and listener controls are available in their tabs.'});},{id:'publish-result',class:'primary'})));}}
function renderAccess(){const cfg=state.configuration||{},d=drafts.configuration||{expected_revision:state.revision,catalog_name:cfg.catalog_name,label:cfg.label,principals:(cfg.principals||[]).join('\n'),allow_local:cfg.allow_local};
const catalog=input('catalog-name',d.catalog_name,'text',{pattern:'[A-Za-z][A-Za-z0-9_]{0,119}',maxlength:120,required:''}),label=input('catalog-label',d.label,'text',{required:'',maxlength:1024}),principals=node('textarea',{id:'principals',rows:7,value:d.principals}),local=input('allow-local','', 'checkbox',{checked:d.allow_local});
function capture(){const next={expected_revision:d.expected_revision,catalog_name:catalog.value,label:label.value,principals:principals.value,allow_local:local.checked};draft('configuration',next);return next;}
for(const el of[catalog,label,principals,local])el.addEventListener('input',capture);
const form=node('form',{id:'configuration',onsubmit:e=>{e.preventDefault();run(async()=>{const d=capture(),names=d.principals.split(/\r?\n/).filter(x=>x.length);if(names.some(x=>x!==x.trim()))throw new Error('Use exact principal names without leading or trailing spaces.');await post('/api/vgi/configure',{request_id:nonce(),expected_revision:d.expected_revision,configuration:{catalog_name:d.catalog_name,label:d.label,principals:names,allow_local:d.allow_local}});clearDraft('configuration');await refresh({message:'Saved current access. Revocation applies at the next authenticated request and batch read.'});});}},field('Catalog name',catalog),field('Catalog label',label),field('Allowed authenticated principals',principals,'One exact provider-authenticated principal per line. Token values belong in the native server environment.'),node('label',{class:'check'},local,node('span',{},'Allow local standard-input clients on this host')),p('This draft was opened at service revision '+d.expected_revision+'.','muted'),node('div',{class:'actions'},node('button',{id:'save-configuration',class:'primary'},'Save catalog and access'),button('Reload current configuration',async()=>{clearDraft('configuration');await refresh();})));
content.append(node('div',{class:'grid'},panel('Current catalog and access',form),panel('Native authentication',p('The VGI SDK validates bearer tokens, JWTs and its original proxy grants before checking the current principal allowlist. Configure the provider in the environment that starts this private operator.','muted'),info({'Static bearer provider':state.installed_runtime?.authentication?.static_bearer_configured?'Configured':'Not configured','JWT provider':state.installed_runtime?.authentication?.jwt_configured?'Configured':'Not configured','Proxy proof mode':state.installed_runtime?.authentication?.proxy_proof_mode||'off'}),p('The operator never requests or stores a bearer token. Restart the operator process to select changed authentication environment values.','muted'),node('a',{href:'https://query.farm/vgi/',target:'_blank',rel:'noreferrer'},'Vendor authentication reference'))));}
function clientExample(){const r=state.runtime||{},t=r.catalog?.tables?.[0],fn=t?.function_name||'sf_result_PUBLICATION_ID';return ['from vgi.client import Client','import os','','with Client.from_http('+JSON.stringify(r.address||'http://127.0.0.1:8080')+',', '                      bearer_token=os.environ["RESULT_SERVICE_TOKEN"]) as client:', '    scan = client.table_scan_resumable(', '        function_name='+JSON.stringify(fn)+', schema_path=["results"])','    batch, resume_token = scan.next()','    scan.close()','','# A later process uses the unchanged original token.','with Client.from_http('+JSON.stringify(r.address||'http://127.0.0.1:8080')+',','                      bearer_token=os.environ["RESULT_SERVICE_TOKEN"]) as client:','    scan = client.table_scan_continue(resume_token=resume_token)','    # Read further batches with scan.next(); close when finished.','    scan.close()'].join('\n');}
function renderRuntime(){const r=state.runtime||{},d=drafts.listener||{host:r.request?.host||'127.0.0.1',port:r.request?.port??8080},host=input('listen-host',d.host,'text',{required:''}),port=input('listen-port',d.port,'number',{min:0,max:65535,step:1,required:''});
const running=r.observed==='RUNNING',external=r.observed==='EXTERNAL_OWNER';
const form=node('form',{onsubmit:e=>{e.preventDefault();run(async()=>{draft('listener',{host:host.value,port:Number(port.value)});await post('/api/vgi/start',{request_id:nonce(),expected_revision:state.revision,host:host.value,port:Number(port.value)});await refresh({message:'The original VGI listener is running at the recorded address.'});});}},node('div',{class:'form-row'},field('Listen address',host,'Exact numeric IPv4 or IPv6 address.'),field('Listen port',port,'0 selects an available port.')),node('div',{class:'actions'},node('button',{id:'start-service',class:'primary',disabled:running||external||!state.installed_runtime?.ready},'Start service'),button('Stop original listener',async()=>{if(!r.request_id)throw new Error('No original listener request is available.');await post('/api/vgi/stop',{request_id:r.request_id});await refresh({message:'The original listener and its request handlers are closed.'});},{id:'stop-service',disabled:external||!r.owned})));
content.append(node('div',{class:'grid'},panel('Listener',info({'Observed state':badge(r.observed||'STOPPED'),'Address':r.address||'—','Original request':code(r.request_id),'Selected revision':r.catalog?.revision??'—','Current service revision':state.revision,'Process ownership':r.owned?'This operator':external?'Another original process':'Closed'}),node('div',{class:'editor'},form),r.catalog&&r.catalog.revision!==state.revision?p('Current catalog or access changed after this listener selection. Current access is already enforced; stop and start to select the latest catalog heads.','muted'):null,external?p('Another original process holds the listener lifetime. Use its foreground or original managed operation to stop it.','muted'):null),panel('Installed native runtime',info({'Ready':state.installed_runtime?.ready?'Yes':'Install the selected vendor cohort','Python':state.installed_runtime?.python?.version?.join('.')||'Unavailable','SDK source':code(state.installed_runtime?.sdk_commit),'RPC source':code(state.installed_runtime?.rpc_commit)}),table(['Package','Installed','Expected'],Object.entries(state.installed_runtime?.packages||{}).map(([name,v])=>[name,v.installed||'Absent',v.expected])),details('Exact installed vendor source checks',state.installed_runtime?.sources))));
content.append(panel('Native client',p('The SDK owns the Arrow transport, authenticated identity and continuation token. Keep the exact token with the receiving application.','muted'),node('pre',{id:'client-example'},clientExample()),button('Save client example',()=>downloadText(clientExample(),'vgi-result-client.py','text/x-python')),r.catalog?details('Running catalog selection',r.catalog):null));}
function retainedRequests(){return pending.filter(row=>!row.workspace_id||row.workspace_id===state.workspace_id);}
function fileControls(record){
  return node('div',{class:'file-list'},rows(record.files).map(file=>
    node('div',{class:'file-row'},code(file.name),
      button('Download',()=>downloadOriginal(record.export_id,file)),
      node('small',{},String(file.bytes??file.size??'')+' bytes'))));
}
function renderRecovery(){
  const waiting=retainedRequests(),events=historyPage?.events||[];
  const cards=waiting.map(item=>{
    const controls=node('div',{class:'actions editor'},
      button('Continue same request',async()=>{
        await sendRetained(item);await refresh({message:'Received the original request result.'});
      }),
      button('Read committed operation',async()=>{
        const original=item.path.startsWith('/api/vgi/')?'/api/vgi/operations/':'/api/requests/';
        notice(JSON.stringify(await get(original+item.id),null,2));
      }),
      button('Dismiss local entry',async()=>{
        pending=pending.filter(x=>x!==item);persistPending();renderView();
        notice('Removed the selected browser entry. The original server operation remains retained.');
      }));
    return node('article',{class:'pending'},node('h3',{},item.path),
      info({'Request':code(item.id),'State':badge(item.state),'Created':item.created_at,'Last error':item.error||'—'}),
      details('Retained exact request',JSON.parse(item.body)),controls);
  });
  content.append(panel('Original request recovery',
    p('An interrupted reply retains the exact URL, body and request identity in this browser session. Continue that request before creating a replacement. A completed reply removes it from this list.','muted'),
    cards.length?node('div',{class:'stack'},cards):p('No interrupted browser requests.','empty')));
  const native=rows(state.buyer?.operations).filter(row=>!['COMPLETE','COMPLETED'].includes(row.state));
  if(native.length){
    content.append(panel('Original buyer operations',
      table(['Request','Route','State',''],native.map(item=>[
        code(item.request_id||item.id),item.route||item.operation||'',badge(item.state),
        button('Continue buyer operation',async()=>{
          await post('/api/requests/'+encodeURIComponent(item.request_id||item.id)+'/resume',{});
          await refresh({message:'Reopened the original buyer operation.'});
        })]))));
  }
  const historyControls=node('div',{class:'actions'},
    button('Read latest history',async()=>{
      historyPage=await get('/api/vgi/history?limit=50');renderView();
    }),
    historyPage?.next_before?button('Older events',async()=>{
      historyPage=await get('/api/vgi/history?limit=50&before='+historyPage.next_before);renderView();
    }):null);
  content.append(panel('Service history',historyControls,
    events.length?table(['Revision','At','Operation','Request','Result'],
      events.map(e=>[e.sequence,e.at,e.operation,code(e.request_id),details('Retained result',e.result)])):
      p('Read the retained service history.','muted')));
  const handoffs=rows(state.buyer?.handoffs),exports=rows(state.buyer?.exports);
  content.append(panel('Warehouse and source handover',
    p('The original warehouse backup retains the publication batches, current access, catalog history and native token signing key. Transfer original query export members alongside the warehouse when further source review is needed.','muted'),
    button('Create original warehouse handoff',async()=>{
      await post('/api/handoffs',{request_id:nonce()});
      await refresh({message:'The original warehouse handoff is retained with its complete file descriptors.'});
    },{id:'create-handoff',class:'primary'}),
    node('div',{class:'editor'},handoffs.map(h=>
      node('div',{},details('Handoff '+h.export_id,h),fileControls(h)))),
    table(['Original query export','Rows','Members'],exports.map(exp=>[
      code(short(exp.export_id)),String(exp.rows),fileControls(exp)]))));
}
function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=node('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function downloadText(text,name,type='text/plain'){saveBlob(new Blob([text],{type}),name);}
function downloadJSON(value,name){downloadText(JSON.stringify(value,null,2)+'\n',name,'application/json');}
async function downloadOriginal(id,file){const response=await fetch('/api/exports/'+encodeURIComponent(id)+'/file?name='+encodeURIComponent(file.name),{headers:authHeaders(),cache:'no-store'});if(!response.ok){let value;try{value=await response.json();}catch{}throw new Error(value?.error||'Original file could not be read.');}const blob=await response.blob();if(Number.isSafeInteger(file.bytes)&&blob.size!==file.bytes)throw new Error('The complete original file was not received.');saveBlob(blob,file.name.split('/').at(-1));}
for(const b of document.querySelectorAll('nav button'))b.addEventListener('click',()=>navigate(b.dataset.view));
$('#refresh').addEventListener('click',()=>run(()=>refresh({message:'Read the current original workspace.'})));
$('#connect-form').addEventListener('submit',e=>{e.preventDefault();capability=$('#capability').value;sessionStorage.setItem(key+':capability',capability);run(()=>refresh());});
if(capability)run(()=>refresh()).catch(errorText);else $('#connection').hidden=false;
