// MIT. Property panel on the ORIGINAL Socrata session and action transport.
const json=v=>JSON.stringify(v,null,2);
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;};
const short=s=>s?String(s).slice(0,16):'—';
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
function downloadJSON(name,value){const url=URL.createObjectURL(new Blob([json(value)+'\n'],{type:'application/json'}));const a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function table(columns,rows){const wrap=node('div',undefined,'table-scroll'),t=node('table'),head=node('thead'),tr=node('tr'),body=node('tbody');for(const x of columns)tr.append(node('th',x));head.append(tr);for(const r of rows){const line=node('tr');for(const c of r)line.append(node('td',c===null?'null':typeof c==='object'?json(c):c??'—'));body.append(line);}t.append(head,body);wrap.append(t);return wrap;}
export function createPropertyPanel({getState,perform,request,downloadFile,handle,notice,selectSection,selectPublisher}) {
  const root=document.getElementById('property-root'),controls=[],selectors=[],forms=[];
  let state=null,locked=true,working=false,pending=null,retainedRequests=[],cacheKey=null,storageError='',identity=null,loadGeneration=0,loadedRecord=null;
  const p=()=>getState()?.property??{id:null,revision:0};
  const workspaceCacheKey=()=>{const createdAt=getState()?.createdAt;return typeof createdAt==='string'&&createdAt?'starforge-property-request:'+createdAt:null;};
  function requireRecoveryWorkspace(key){if(!key||cacheKey!==key||workspaceCacheKey()!==key)throw Error('The opened workspace differs from this retained request. Reopen its original workspace before recovering it.');}
  const recordRows=group=>p()[group]||[];
  const button=(text,callback,{read=false,recovery=false}={})=>{const b=node('button',text);b.type='button';b.dataset.propertyControl=read?'read':'write';if(recovery)b.dataset.propertyRecovery='true';controls.push(b);b.addEventListener('click',()=>handle(callback));return b;};
  const status=node('p','Load the original workspace.','help'),pendingArea=node('section',undefined,'panel property-pending'),metrics=node('div',undefined,'metrics');
  root.append(metrics,pendingArea);
  const common=node('div',undefined,'panel form-grid');
  function field(label,{type='text',value='',required=true,placeholder='',group=null,multiple=false}={}){
    const wrap=node('label',label),e=node(type==='textarea'?'textarea':type==='select'?'select':'input');
    if(!['textarea','select'].includes(type))e.type=type;
    if(type==='textarea')e.rows=4;
    e.required=required;e.value=value;e.placeholder=placeholder;e.autocomplete='off';if(multiple)e.multiple=true;
    wrap.append(e);if(group){selectors.push({e,group});e.dataset.propertyGroup=group;}
    controls.push(e);return {wrap,e};
  }
  const actor=field('Reviewing operator'),note=field('Selection / source note',{type:'textarea'});common.append(actor.wrap,note.wrap);root.append(common,status);
  const nav=node('nav',undefined,'property-tabs');nav.setAttribute('aria-label','Property workflow');
  const areas={};
  for(const [id,label]of [['sources','Sources & requests'],['identity','Property identity'],['inspections','Inspections & reports'],['handover','Comparison & delivery']]){
    const b=button(label,()=>show(id),{read:true});b.dataset.tab=id;nav.append(b);
    areas[id]=node('section');areas[id].dataset.propertyTab=id;areas[id].hidden=id!=='sources';
  }
  root.append(nav,...Object.values(areas));
  function show(id){for(const [key,area]of Object.entries(areas))area.hidden=key!==id;for(const b of nav.querySelectorAll('button'))b.setAttribute('aria-current',b.dataset.tab===id?'page':'false');}
  function section(area,title,description){const panel=node('section',undefined,'panel');panel.append(node('h3',title));if(description)panel.append(node('p',description,'help'));area.append(panel);return panel;}
  function form(area,title,description,specs,submit,callback){
    const panel=section(area,title,description),f=node('form',undefined,'form-grid'),refs={};
    for(const [key,label,options]of specs){refs[key]=field(label,options);f.append(refs[key].wrap);}
    const b=node('button',submit,'primary');b.type='submit';b.dataset.propertyControl='write';controls.push(b);f.append(b);
    panel.append(f);forms.push(f);f.addEventListener('submit',event=>{event.preventDefault();handle(()=>callback(Object.fromEntries(Object.entries(refs).map(([k,v])=>[k,v.e.type==='checkbox'?v.e.checked:v.e.multiple?[...v.e.selectedOptions].map(x=>x.value):v.e.value])),refs));});
    return {panel,refs,form:f,submit:b};
  }
  function options(e,rows,{allowEmpty=false}={}){
    const chosen=new Set(e.multiple?[...e.selectedOptions].map(o=>o.value):[e.value]);e.replaceChildren();
    if(allowEmpty){const o=node('option','None');o.value='';e.append(o);}
    for(const row of rows){const o=node('option',row.label);o.value=row.value;o.selected=chosen.has(row.value);e.append(o);}
    if(!rows.length&&!allowEmpty){const o=node('option','No retained selection');o.value='';e.append(o);}
  }
  const selectionValue=(group,id)=>recordRows(group).find(r=>r.id===id);
  function reviewed(){if(!actor.e.value.trim()||!note.e.value.trim())throw Error('Enter the reviewing operator and source/selection note.');return {actor:actor.e.value,note:note.e.value};}
  function parse(text,label){try{return JSON.parse(text);}catch{throw Error(label+' must contain complete JSON.');}}
  const validRequest=value=>value&&value.schema==='tjlabs.property-browser-request/v1'&&
    typeof value.action==='string'&&value.action.startsWith('property.')&&
    value.input&&typeof value.input==='object'&&!Array.isArray(value.input)&&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value.input.key||'')&&
    /^[a-f0-9]{64}$/.test(value.input_sha256||'')&&Object.hasOwn(value,'accepted')&&
    (value.browser_completed===undefined||typeof value.browser_completed==='boolean');
  const sameRequest=(a,b)=>a.action===b.action&&a.input_sha256===b.input_sha256&&canonical(a.input)===canonical(b.input);
  const requestSlot=key=>cacheKey+':request:'+key;
  function parsedRequest(raw){
    const value=JSON.parse(raw);if(!validRequest(value))throw Error('A retained browser request has invalid identity.');return value;
  }
  function activeRequestKey(){
    const raw=localStorage.getItem(cacheKey);if(!raw)return null;
    const value=JSON.parse(raw);
    if(value?.schema==='tjlabs.property-browser-active/v1'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value.key||''))return value.key;
    if(validRequest(value))return value.input.key; // Earlier complete active record.
    throw Error('The retained active request could not be read safely.');
  }
  function cache(){
    if(!getState())return;
    const next=workspaceCacheKey();if(!next){storageError='Load the original saved workspace before recovering a property request.';return;}
    if(cacheKey&&cacheKey!==next&&pending){storageError='The opened workspace changed while an original request is retained. Reopen that workspace before recovering it.';return;}
    if(cacheKey!==next){cacheKey=next;retainedRequests=[];}
    if(working)return;
    try{
      const found=new Map(),prefix=cacheKey+':request:';
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;
        const value=parsedRequest(localStorage.getItem(key));
        if(key!==requestSlot(value.input.key))throw Error('A retained request filename and original key differ.');
        found.set(value.input.key,value);
      }
      const active=activeRequestKey(),legacyRaw=localStorage.getItem(cacheKey);
      if(legacyRaw){const legacy=JSON.parse(legacyRaw);if(validRequest(legacy)){
        const existing=found.get(legacy.input.key);
        if(existing&&!sameRequest(existing,legacy))throw Error('The original active request has conflicting retained input.');
        if(existing?.accepted!==null&&legacy.accepted!==null&&existing&&canonical(existing.accepted)!==canonical(legacy.accepted))throw Error('The original accepted response has conflicting retained copies.');
        if(!existing||existing.accepted===null&&legacy.accepted!==null)found.set(legacy.input.key,legacy);
      }}
      retainedRequests=[...found.values()].filter(v=>!v.browser_completed).sort((a,b)=>a.input.key.localeCompare(b.input.key));
      if(!pending)pending=retainedRequests.find(v=>v.input.key===active)||retainedRequests[0]||null;
      else{
        const retained=found.get(pending.input.key);
        if(retained&&!sameRequest(retained,pending))throw Error('The selected browser request changed in another window.');
        if(retained?.accepted!==null&&retained){
          if(pending.accepted!==null&&canonical(pending.accepted)!==canonical(retained.accepted))throw Error('The selected accepted response changed in another window.');
          pending.accepted=retained.accepted;
        }
      }
    }catch(error){storageError=error.message||'The original browser request could not be read. Keep its storage and use the original operation record to recover.';}
  }
  function persist(value){
    if(!cacheKey)throw Error('Load the original workspace first.');
    const source=value||pending;if(!validRequest(source))throw Error('Keep the complete original request before continuing.');
    const slot=requestSlot(source.input.key),raw=localStorage.getItem(slot),prior=raw?parsedRequest(raw):null;
    if(prior&&!sameRequest(prior,source))throw Error('The immutable request key belongs to different browser input.');
    if(prior?.accepted!==null&&prior){
      if(source.accepted!==null&&canonical(source.accepted)!==canonical(prior.accepted))throw Error('An original accepted response cannot be replaced.');
      source.accepted=prior.accepted;
    }
    if(!value&&source.accepted===null)throw Error('Only an acknowledged original request can be completed.');
    const saved={...source,browser_completed:!value||prior?.browser_completed===true};
    // Each exact request and accepted response has its own durable key. A second
    // window may change the convenience pointer, never overwrite this record.
    localStorage.setItem(slot,json(saved));
    if(canonical(parsedRequest(localStorage.getItem(slot)))!==canonical(saved))throw Error('The exact request was not retained by browser storage.');
    const active=activeRequestKey();
    if(value&&(!active||active===source.input.key))localStorage.setItem(cacheKey,json({schema:'tjlabs.property-browser-active/v1',key:source.input.key}));
    else if(!value&&active===source.input.key)localStorage.removeItem(cacheKey);
    retainedRequests=retainedRequests.filter(r=>r.input.key!==source.input.key);
    if(!saved.browser_completed)retainedRequests.push(saved);
  }
  async function peek(selectedCacheKey){
    requireRecoveryWorkspace(selectedCacheKey);
    const response=await request('/api/action',{method:'POST',body:JSON.stringify({action:'property.operation',payload:{key:pending.input.key}})});
    requireRecoveryWorkspace(selectedCacheKey);
    return response.result;
  }
  async function settle(){
    if(!pending||working) return;
    working=true;renderControls();
    try{
      const selectedCacheKey=cacheKey;requireRecoveryWorkspace(selectedCacheKey);
      const retainedRaw=localStorage.getItem(requestSlot(pending.input.key));
      if(retainedRaw){const retained=parsedRequest(retainedRaw);
        if(!sameRequest(retained,pending))throw Error('The retained request changed before recovery.');
        if(retained.accepted!==null){if(pending.accepted!==null&&canonical(retained.accepted)!==canonical(pending.accepted))throw Error('The retained accepted response changed before recovery.');pending.accepted=retained.accepted;}
      }
      if(await sha(pending.input)!==pending.input_sha256)throw Error('The complete retained property request changed.');
      const observed=await peek(selectedCacheKey),operation=observed.operation;
      if(operation&&(operation.action!==pending.action||operation.input_sha256!==pending.input_sha256))throw Error('The retained native key belongs to different input.');
      if(pending.accepted!==null){
        if(!operation||operation.state!=='DONE'||canonical(operation.result)!==canonical(pending.accepted))throw Error('An accepted response survives without its matching native operation. Keep it and reopen the original complete workspace; this page will not resubmit it.');
      }else if(operation?.state==='DONE'){
        pending.accepted=operation.result;persist(pending);
      }else{
        requireRecoveryWorkspace(selectedCacheKey);
        const result=await perform(pending.action,pending.input,{quiet:true});
        pending.accepted=result;persist(pending);
        const final=await peek(selectedCacheKey);
        if(final.operation?.state!=='DONE'||canonical(final.operation.result)!==canonical(result))throw Error('Save returned, but its exact native commitment is not available. Keep this request for the original recovery.');
      }
      requireRecoveryWorkspace(selectedCacheKey);
      const completed=pending;persist(null);pending=null;storageError='';
      notice(completed.action+' saved in the original property workspace.');
      render(getState());return completed.accepted;
    }catch(error){storageError=error.message;notice(error.message,'error');throw error;}
    finally{working=false;renderControls();renderPending();}
  }
  async function save(action,body){
    cache();if(working||locked)throw Error('Wait for the original workspace operation to finish.');
    if(pending||storageError)throw Error('Recover or export the retained original request first.');
    const selected={id:p().id,revision:p().revision,createdAt:getState().createdAt};
    working=true;renderControls();
    try{
      const input={...body,key:'property-'+crypto.randomUUID(),workspace_id:selected.id??null,expected_revision:selected.revision??0};
      const value={schema:'tjlabs.property-browser-request/v1',action,input,input_sha256:await sha(input),accepted:null};
      if(selected.id!==p().id||selected.revision!==p().revision||selected.createdAt!==getState().createdAt)throw Error('The original workspace changed while preparing this request. Review the current selection again.');
      pending=value;persist(value);renderPending();
    }catch(error){storageError=error.message;renderPending();throw error;}
    finally{working=false;renderControls();}
    return settle();
  }
  async function readRecord(group,id){
    if(!id)throw Error('Select an original saved record.');
    const r=await request('/api/action',{method:'POST',body:JSON.stringify({action:'property.get',payload:{group,id}})});
    return {record:r.result.record,workspace_id:r.result.workspace_id,revision:r.result.revision};
  }
  async function inspect(group,id){
    const generation=++loadGeneration,selected={id:p().id,revision:p().revision};
    const result=await readRecord(group,id);
    if(generation!==loadGeneration||selected.id!==p().id||selected.revision!==p().revision||result.workspace_id!==selected.id||result.revision!==selected.revision)return;
    loadedRecord=result.record;recordDetail.textContent=json(loadedRecord);recordPanel.open=true;
  }
  const baseline=form(areas.sources,'1. Pin the existing HPD source','Use a complete retained HPD edition. Project participation remains building-in-project context.',[
    ['edition_id','Retained HPD edition',{type:'select',group:'hpd_editions'}],
    ['project_id','Project ID source field',{value:'project_id',required:false}],
    ['building_id','Building ID source field',{value:'building_id',required:false}],
    ['bbl','BBL source field',{value:'bbl',required:false}],
    ['bin','BIN source field',{value:'bin',required:false}],
    ['address','Address source field',{required:false}],
  ],'Save baseline',async v=>save('property.baseline.save',{edition_id:v.edition_id,columns:Object.fromEntries(['project_id','building_id','bbl','bin','address'].filter(k=>v[k]).map(k=>[k,v[k]])),...reviewed()}));
  const propertySelection=form(areas.sources,'2. Select the receiving properties','Keep your own stable property ID, exact vendor request address, and actual RentCheck property ID. An unknown receiving ID can remain null until a later selected edition.',[
    ['name','Selection name',{}],
    ['properties','Complete property selection JSON',{type:'textarea',placeholder:'Each record: id, propply_address {address,state,zip,city?}, rentcheck_property_id (text or null), and optional bbl/bin.'}],
  ],'Save property selection',v=>save('property.selection.save',{name:v.name,properties:parse(v.properties,'Property selection'),...reviewed()}));
  propertySelection.panel.append(button('Download a blank selection structure',()=>downloadJSON('property-selection-structure.json',[{id:'',propply_address:{address:'',state:'',zip:'',city:''},rentcheck_property_id:null,bbl:null,bin:null}]),{read:true}));
  const propply=form(areas.sources,'3. Prepare a Propply report','Preparing makes no vendor request. A portfolio accepts at most 50 properties; a compliance report selects exactly one.',[
    ['selection_id','Saved property selection',{type:'select',group:'selections'}],
    ['report_action','Documented report',{type:'select'}],
    ['options','Single-report options JSON',{type:'textarea',value:'{}'}],
  ],'Prepare report request',v=>save('property.propply.prepare',{...v,options:parse(v.options,'Report options'),...reviewed()}));
  options(propply.refs.report_action.e,[{value:'portfolio_report',label:'Portfolio report · up to 50 addresses'},{value:'compliance_report',label:'Compliance report · one address'}]);
  const imported=form(areas.sources,'Retain an original local file','Select the original response, account contract or native report on this host. Its complete bytes and SHA-256 are verified and included in the private workspace package.',[
    ['path','Original absolute file path',{}],['sha256','Original full SHA-256',{}],
  ],'Retain exact file',v=>save('property.file.import',{...v,...reviewed()}));
  const nativeImport=form(areas.sources,'Attach an existing original response','Use only the complete response belonging to this exact prepared request. Imported evidence is labelled as an operator-provided original; this does not make a new vendor call.',[
    ['request_id','Prepared request',{type:'select',group:'requests'}],
    ['response_file','Retained complete response file',{type:'select',group:'files'}],
    ['response','Actual HTTP metadata JSON',{type:'textarea',placeholder:'Actual status, received_at, and non-secret returned headers.'}],
  ],'Attach original response',v=>{const r=selectionValue('requests',v.request_id);return save('property.request.import',{...v,response:parse(v.response,'HTTP metadata'),request_sha256:r.request_sha256,...reviewed()});});
  const requestCards=section(areas.sources,'Original requests','An issued request is never automatically repeated. Open its retained source or recover the same response. For an uncertain inspection create, read the actual inspection and reconcile it below.');
  const requests=node('div',undefined,'property-cards');requestCards.append(requests);
  const identitySelect=form(areas.identity,'Load one exact identity review','Choose the HPD baseline, original vendor edition, and the property selection used in that request. A candidate row remains a suggestion until you explicitly link it.',[
    ['baseline_id','HPD baseline',{type:'select',group:'baselines'}],['edition_id','Propply report edition',{type:'select',group:'propply_editions'}],['selection_id','Original property selection',{type:'select',group:'selections'}],
  ],'Load source identities',async v=>{
    const generation=++loadGeneration,bound={workspace_id:p().id,revision:p().revision,selection:{...v}};
    const results=await Promise.all([readRecord('baselines',v.baseline_id),readRecord('editions',v.edition_id),readRecord('selections',v.selection_id)]);
    if(generation!==loadGeneration||bound.workspace_id!==p().id||bound.revision!==p().revision||results.some(r=>r.workspace_id!==bound.workspace_id||r.revision!==bound.revision))return;
    if(results[1].record.vendor!=='propply'||!results[1].record.receipt?.successful)throw Error('This edition is not a successful original Propply response.');
    identity={...bound,baseline:results[0].record,edition:results[1].record,properties:results[2].record.properties,rows:[]};renderIdentity();
  });
  identitySelect.submit.dataset.propertyControl='read';
  for(const r of Object.values(identitySelect.refs))r.e.addEventListener('change',()=>{loadGeneration++;identity=null;renderIdentity();});
  const identityArea=section(areas.identity,'Reviewed links','The report and HPD row choices are explicit. Use building or parcel context when several receiving units share one source aggregate.');
  const identityRows=node('div'),identityStatus=node('p',undefined,'help');
  const identitySave=button('Save these reviewed links',async()=>{
    const selected=Object.fromEntries(Object.entries(identitySelect.refs).map(([k,v])=>[k,v.e.value]));
    if(!identity||identity.workspace_id!==p().id||identity.revision!==p().revision||canonical(selected)!==canonical(identity.selection))throw Error('Reload the exact current source selection before saving links.');
    const links=identity.rows.filter(x=>x.report.value).map(x=>{
      const numbers=x.hpd.value.trim()?x.hpd.value.split(',').map(x=>Number(x.trim())):[];
      if(numbers.some(n=>!Number.isSafeInteger(n)||n<1||n>identity.baseline.rows.length))throw Error('HPD source rows must be valid one-based row numbers from this baseline.');
      return {property_id:x.property.id,report_id:x.report.value,relationship:x.relationship.value,note:x.note.value,
        hpd_rows:numbers.map(n=>({source_row:n,row_sha256:identity.baseline.rows[n-1].row_sha256}))};
    });
    await save('property.identity.save',{...identity.selection,links,...reviewed()});
  });
  identityArea.append(identityStatus,identityRows,identitySave);
  function renderIdentity(){
    identityRows.replaceChildren();
    if(!identity){identityStatus.textContent='Load the original source identities.';identitySave.disabled=true;return;}
    identityStatus.textContent=identity.baseline.rows.length+' original HPD rows · '+identity.edition.reports.length+' vendor reports · property revision '+identity.revision;
    for(const property of identity.properties){
      const card=node('article',undefined,'property-card');card.append(node('h4',property.id),node('p',json(property),'mono'));
      const report=field('Original Propply report',{type:'select',required:false}),relationship=field('Source relationship',{type:'select'}),hpd=field('Reviewed HPD source row numbers',{required:false,placeholder:'Comma-separated original row numbers; leave empty for no HPD match'}),explanation=field('Identity explanation');
      options(report.e,identity.edition.reports.map(r=>({value:r.report_id,label:r.locator+' · '+(r.address||JSON.stringify(r.property)||r.report_id)})),{allowEmpty:true});report.e.value='';
      options(relationship.e,[{value:'',label:'Select a relationship'},{value:'same_property',label:'Same property'},{value:'building_context',label:'Building context'},{value:'parcel_context',label:'Parcel context'}]);
      const candidates=identity.baseline.rows.filter(r=>property.bbl&&String(r.bbl)===String(property.bbl)||property.bin&&String(r.bin)===String(property.bin));
      card.append(report.wrap,relationship.wrap,hpd.wrap,explanation.wrap);
      const detail=node('details');detail.append(node('summary',candidates.length+' exact BBL/BIN candidates · review required'),table(['Row','Project','Building','BBL','BIN','Address'],candidates.map(r=>[r.source_row,r.project_id,r.building_id,r.bbl,r.bin,r.address])));
      card.append(detail);identityRows.append(card);identity.rows.push({property,report:report.e,relationship:relationship.e,hpd:hpd.e,note:explanation.e});
    }
    renderControls();
  }
  const contract=form(areas.inspections,'Receiving account contract','Use the complete API contract actually supplied for this account. Public documentation does not establish production credentials, property fields, pagination or report locations. Credentials are configured on the host, never pasted here.',[
    ['source_file','Retained original account contract file',{type:'select',group:'files'}],
    ['contract','Account configuration and exact JSON locators',{type:'textarea'}],
  ],'Save reviewed account contract',v=>save('property.rentcheck.contract',{source_file:v.source_file,contract:parse(v.contract,'Account contract'),...reviewed()}));
  const nativeRead=form(areas.inspections,'Read actual templates or inspections','Each prepared read keeps the selected account, native ID and exact query. Collection paging is supplied explicitly from that account’s contract.',[
    ['contract_id','Saved account contract',{type:'select',group:'contracts'}],
    ['operation','Read operation',{type:'select'}],['resource_id','Native template / inspection ID',{required:false}],['query','Exact query JSON',{type:'textarea',value:'{}'}],
  ],'Prepare native read',v=>save('property.rentcheck.prepare',{...v,resource_id:v.resource_id||null,query:parse(v.query,'Query'),...reviewed()}));
  options(nativeRead.refs.operation.e,[{value:'templates',label:'List inspection templates · v1'},{value:'template',label:'Read one template · v1'},{value:'inspections',label:'List inspections · v2'},{value:'inspection',label:'Read one inspection · v1'}]);
  const create=form(areas.inspections,'Prepare one inspection','Use a saved source review and an actual retained template response. The complete create body must come from your account’s API contract. This prepares an original request; dispatch is a separate action.',[
    ['contract_id','Account contract',{type:'select',group:'contracts'}],['review_id','Saved property review',{type:'select',group:'reviews'}],
    ['property_id','Reviewed local property ID',{}],['template_request_id','Completed native template request',{type:'select',group:'template_requests'}],
    ['record_pointer','Template record JSON pointer',{required:false,placeholder:'Empty for a root template object; otherwise the exact returned record pointer'}],
    ['body','Complete create request body JSON',{type:'textarea'}],
  ],'Prepare inspection request',v=>save('property.inspection.prepare',{...v,body:parse(v.body,'Create body'),...reviewed()}));
  const bind=form(areas.inspections,'Reconcile the actual native inspection','A returned create ID requires its matching native detail. Explicit adoption of an existing inspection preserves the uncertain original request without claiming it created the inspection.',[
    ['prepared_request_id','Original prepared create request',{type:'select',group:'create_requests'}],
    ['detail_request_id','Completed native inspection detail read',{type:'select',group:'inspection_reads'}],
    ['inspection_id','Actual native inspection ID',{}],['mode','Evidence relationship',{type:'select'}],
  ],'Bind verified native inspection',v=>save('property.inspection.bind',{...v,...reviewed()}));
  options(bind.refs.mode.e,[{value:'RETURNED_CREATE',label:'The original create returned this ID'},{value:'ADOPT_EXISTING',label:'Explicitly adopt this observed existing inspection'}]);
  const report=form(areas.inspections,'Retain the original inspection report','Select a complete native export or a report file from the exact URL returned by the bound inspection. No undocumented download endpoint is assumed.',[
    ['binding_id','Saved native inspection binding',{type:'select',group:'bindings'}],['report_file','Complete retained report file',{type:'select',group:'files'}],
    ['filename','Original report filename',{}],['mime_type','Original content type',{}],
    ['kind','Source of this file',{type:'select'}],['url','Actually returned native report URL',{required:false}],['detail_response_sha256','Report-URL source response SHA-256',{required:false}],
  ],'Save original report association',v=>save('property.report.save',{binding_id:v.binding_id,report_file:v.report_file,filename:v.filename,mime_type:v.mime_type,source:{kind:v.kind,...reviewed(),...(v.kind==='RETURNED_NATIVE_URL'?{url:v.url,detail_response_sha256:v.detail_response_sha256}:{})}}));
  options(report.refs.kind.e,[{value:'OPERATOR_NATIVE_EXPORT',label:'Original export from the receiving account'},{value:'RETURNED_NATIVE_URL',label:'Exact URL returned by the bound inspection'}]);
  const compare=form(areas.handover,'Compare two real vendor editions','Review both editions against their own property identities. Missing values, null, zero and a changed receiving identity remain separate states.',[
    ['previous_review_id','Previous saved review',{type:'select',group:'reviews'}],['current_review_id','Current saved review',{type:'select',group:'reviews'}],
    ['fields','Named comparison fields and JSON pointers',{type:'textarea',placeholder:'Array of {name, pointer}. Choose actual portfolio or compliance-report fields.'}],
  ],'Save source comparison',v=>save('property.comparison.save',{...v,fields:parse(v.fields,'Comparison fields'),...reviewed()}));
  const deliver=form(areas.handover,'Prepare the merchant-controlled resource','The original publisher, release and buyer engines receive this exact native dataset. Record the parties’ actual licence, host and payment choices. Ordinary API billing is not evidence of a Stellar purchase.',[
    ['review_id','Saved property review',{type:'select',group:'reviews'}],['comparison_id','Selected comparison (optional)',{type:'select',group:'comparisons_optional',required:false}],
    ['binding_ids','Selected native inspection bindings',{type:'select',group:'bindings',multiple:true,required:false}],['report_ids','Selected original report files',{type:'select',group:'documents',multiple:true,required:false}],
    ['resource_key','Stable merchant resource key',{}],['name','Customer resource name',{}],['fields','Selected report field names and JSON pointers',{type:'textarea'}],
    ['merchant','Actual resource merchant',{}],['buyer','Actual independent buyer / receiving operator',{}],['resource','Approved resource scope',{type:'textarea'}],
    ['licence','Agreed source, display, retention and redistribution rights',{type:'textarea'}],['hosting','Selected host and deployment authority',{type:'textarea'}],['settlement','Selected payment path and terms',{type:'textarea'}],
    ['approved','The parties approved this exact resource and authority',{type:'checkbox',required:true}],
    ['include_complete_vendor_response','Include the complete original vendor response under those rights',{type:'checkbox',required:false}],
    ['include_inspection_report_files','Include selected original inspection report files under those rights',{type:'checkbox',required:false}],
    ['origin','Merchant public origin',{}],['path','Merchant dataset route',{value:'/data'}],['network','Original payment network',{}],['asset','Original asset identifier',{}],['amount','Price in atomic units',{}],['payTo','Merchant recipient',{}],['maxTimeoutSeconds','Original payment timeout, seconds',{type:'number',value:'60'}],
  ],'Export original merchant handover',v=>save('property.resource.export',{review_id:v.review_id,comparison_id:v.comparison_id||null,binding_ids:v.binding_ids,report_ids:v.report_ids,resource_key:v.resource_key,name:v.name,fields:parse(v.fields,'Resource fields'),
    rights:{approved:v.approved,merchant:v.merchant,buyer:v.buyer,resource:v.resource,licence:v.licence,hosting:v.hosting,settlement:v.settlement,approved_by:reviewed().actor,note:reviewed().note,include_complete_vendor_response:v.include_complete_vendor_response,include_inspection_report_files:v.include_inspection_report_files},
    origin:v.origin,path:v.path,payment:{scheme:'exact',network:v.network,asset:v.asset,amount:v.amount,payTo:v.payTo,maxTimeoutSeconds:Number(v.maxTimeoutSeconds)},...reviewed()}));
  const handovers=section(areas.handover,'Retained merchant and customer handovers','Use the existing publisher and buyer panel with this exact resource. The original HPD publisher remains separately available.');
  const resourceCards=node('div',undefined,'property-cards');handovers.append(resourceCards);
  handovers.append(button('Open complete private export & recovery',()=>selectSection('exports'),{read:true}));
  const originals=section(areas.handover,'Original files and saved records','Downloads are hash-checked against the original private workspace. API credentials are not stored in these files.');
  const recordForm=node('div',undefined,'form-grid'),recordGroup=field('Record kind',{type:'select'}),recordId=field('Saved record',{type:'select'});recordForm.append(recordGroup.wrap,recordId.wrap,button('Open selected record',()=>inspect(recordGroup.e.value,recordId.e.value),{read:true}));
  options(recordGroup.e,['baselines','selections','contracts','requests','editions','reviews','comparisons','bindings','documents','resources'].map(k=>({value:k,label:k})));
  function updateRecordIds(){loadGeneration++;options(recordId.e,recordRows(recordGroup.e.value).map(r=>({value:r.id,label:r.name||r.id})));loadedRecord=null;recordDetail.textContent='Select an original record.';}
  recordGroup.e.addEventListener('change',updateRecordIds);recordId.e.addEventListener('change',()=>{loadGeneration++;loadedRecord=null;});
  const recordPanel=node('details'),recordDetail=node('pre','Select an original record.');recordPanel.append(node('summary','Complete selected record'),recordDetail,button('Download selected record JSON',()=>{if(!loadedRecord)throw Error('Open the selected record first.');downloadJSON(loadedRecord.id+'.json',loadedRecord);},{read:true}));
  originals.append(recordForm,recordPanel);
  const filesArea=node('div',undefined,'property-files');originals.append(filesArea);
  function renderPending(){
    pendingArea.replaceChildren();pendingArea.hidden=!pending&&!storageError&&!retainedRequests.length;
    if(pending){pendingArea.append(node('h3',pending.accepted!==null?'Save acknowledged · retained receipt':'Original request retained'),node('p',pending.action+' · '+pending.input.key),node('p','The same request and exact inputs remain available through refresh or restart. Accepted replies are checked against the native operation before being cleared.','help'),
      button('Recover this same request',settle,{read:true,recovery:true}),button('Download retained request and receipt',()=>downloadJSON('property-original-request.json',pending),{read:true}));}
    const others=retainedRequests.filter(r=>r.input.key!==pending?.input.key);
    if(others.length){
      pendingArea.append(node('p','Other original requests retained by this browser:','help'));
      for(const saved of others)pendingArea.append(button(saved.action+' · '+saved.input.key,()=>{
        if(working||locked)throw Error('Wait for the current request to settle.');
        pending=saved;storageError='';cache();renderPending();renderControls();
      },{read:true}));
    }
    if(storageError)pendingArea.append(node('p',storageError,'error-detail'));
  }
  function selectionRows(group){
    if(group==='hpd_editions')return (state?.editions||[]).map(r=>({value:r.id,label:(r.description?.name||r.id)+' · '+r.rowCount+' source rows'}));
    if(group==='files')return (p().files||[]).map(r=>({value:r.file,label:r.file+' · '+r.bytes+' B'}));
    let rows;
    if(group==='propply_editions')rows=recordRows('editions').filter(r=>r.vendor==='propply');
    else if(group==='template_requests')rows=recordRows('requests').filter(r=>r.vendor==='rentcheck'&&['template','templates'].includes(r.operation)&&r.phase==='RETURNED');
    else if(group==='create_requests')rows=recordRows('requests').filter(r=>r.operation==='create_inspection');
    else if(group==='inspection_reads')rows=recordRows('requests').filter(r=>r.operation==='inspection'&&r.phase==='RETURNED');
    else rows=recordRows(group.replace('_optional',''));
    return rows.map(r=>({value:r.id,label:(r.name||r.filename||r.id)+(r.phase?' · '+r.phase:'')}));
  }
  function renderControls(external=locked){
    locked=external;
    const unavailable=locked||working||!!pending||!!storageError;
    const recoveryMismatch=!cacheKey||workspaceCacheKey()!==cacheKey;
    for(const e of controls){if(!e.isConnected)continue;e.disabled=e.dataset.propertyControl==='read'?locked||working||e.dataset.propertyRecovery==='true'&&recoveryMismatch:unavailable;}
    identitySave.disabled=unavailable||!identity||identity.workspace_id!==p().id||identity.revision!==p().revision;
    for(const b of pendingArea.querySelectorAll('button'))b.disabled=locked||working||b.dataset.propertyRecovery==='true'&&recoveryMismatch;
    for(const form of forms)for(const e of form.querySelectorAll('input,textarea,select'))e.disabled=unavailable;
  }
  function render(value){
    state=value;cache();
    for(const {e,group}of selectors)options(e,selectionRows(group),{allowEmpty:group.endsWith('_optional')});
    status.textContent='Original property workspace '+(p().id||'not yet initialized')+' · revision '+p().revision+'. '+(identity&&identity.revision!==p().revision?'Reload the saved source selection before changing its identity review.':'');
    metrics.replaceChildren();
    for(const [label,value]of [['HPD baselines',recordRows('baselines').length],['Vendor editions',recordRows('editions').length],['Verified inspections',recordRows('bindings').length],['Issued without response',recordRows('requests').filter(r=>r.phase==='ISSUED').length]]){const item=node('div');item.append(node('span',label),node('strong',value));metrics.append(item);}
    requests.replaceChildren();
    for(const r of [...recordRows('requests')].reverse()){
      const card=node('article',undefined,'property-card'),tools=node('div',undefined,'actions');
      card.append(node('h4',r.vendor+' · '+r.operation),node('p',r.id,'mono'),node('span',r.phase,'badge'),node('p','Original request SHA-256 '+r.request_sha256,'mono'));
      tools.append(button('Open original request',()=>inspect('requests',r.id),{read:true}));
      if(r.phase==='PREPARED')tools.append(button('Run this one vendor request',()=>save('property.request.run',{request_id:r.id,request_sha256:r.request_sha256})));
      if(r.phase==='ISSUED')tools.append(button('Recover retained response',()=>save('property.request.recover',{request_id:r.id})));
      if(r.edition_id)tools.append(button('Open original response edition',()=>inspect('editions',r.edition_id),{read:true}));
      card.append(tools);requests.append(card);
    }
    resourceCards.replaceChildren();
    for(const r of [...recordRows('resources')].reverse()){
      const card=node('article',undefined,'property-card');card.append(node('h4',r.name||r.id),node('p',r.id+' · snapshot '+short(r.snapshot),'mono'));
      const actions=node('div',undefined,'actions');actions.append(button('Use in original publisher & buyer',()=>selectPublisher(r.id),{read:true}));
      for(const file of r.files||[])actions.append(button('Download '+file.name,()=>downloadFile(file.file),{read:true}));
      card.append(actions);resourceCards.append(card);
    }
    filesArea.replaceChildren();
    for(const d of p().files||[]){const line=node('div',undefined,'property-file');line.append(node('span',d.file,'mono'),node('span',d.bytes+' B · '+short(d.sha256)),button('Download',()=>downloadFile(d.file),{read:true}));filesArea.append(line);}
    options(recordId.e,selectionRows(recordGroup.e.value));renderPending();renderControls();
  }
  renderPending();
  return {render,controls:renderControls,pending:()=>!!pending||!!storageError};
}
