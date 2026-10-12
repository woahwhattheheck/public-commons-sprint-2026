// MIT. Industrial operator UI. Access capability remains only in this document's memory.
const fragment=new URLSearchParams(location.hash.slice(1));let token=fragment.get('token')??'';
history.replaceState(null,'',location.pathname);
const $=selector=>document.querySelector(selector),main=$('#main'),status=$('#status');
let state=null,page='overview',epoch=0,selectedProfile=null,selectedProject=null,projectOffset=0,projectQuery='',poll=null,busy=0;
const clientId=crypto.randomUUID(),pendingKey='zotero-pending-actions-v1';
const pending=(()=>{try{return JSON.parse(sessionStorage.getItem(pendingKey)??'{}');}catch{return {};}})();
function persist(){sessionStorage.setItem(pendingKey,JSON.stringify(pending));}
function el(tag,text=null,attrs={}){
  const node=document.createElement(tag);
  if(text!==null)node.textContent=text;
  for(const [key,value]of Object.entries(attrs))if(value!==null&&value!==undefined){
    if(key==='class')node.className=value;else if(key==='value')node.value=value;else if(key==='checked')node.checked=!!value;else node.setAttribute(key,String(value));
  }
  return node;
}
function append(parent,...nodes){for(const node of nodes.flat())if(node!==null&&node!==undefined)parent.append(typeof node==='string'?document.createTextNode(node):node);return parent;}
function button(label,run,secondary=false){const node=el('button',label,{type:'button',class:secondary?'secondary':''});node.onclick=()=>act(run,node);return node;}
function field(label,type='text',value='',help=''){
  const wrap=el('label',null,{class:'field'+(type==='checkbox'?' check':'')});
  const node=type==='textarea'?el('textarea',null,{'aria-label':label}):type==='select'?el('select',null,{'aria-label':label}):
    el('input',null,{type,'aria-label':label});
  if(type==='checkbox')node.checked=!!value;else node.value=value??'';
  append(wrap,el('span',label),node,help?el('small',help):null);return {wrap,node};
}
function options(control,rows,selected){for(const row of rows){const option=el('option',row.label,{value:row.value});option.selected=row.value===selected;control.append(option);}}
function panel(title,...children){return append(el('section',null,{class:'panel'}),el('h2',title),...children);}
function row(...children){return append(el('div',null,{class:'row'}),children);}
function note(text){return el('div',text,{class:'notice'});}
function table(headers,rows){
  const table=el('table'),head=el('thead'),tr=el('tr');for(const h of headers)tr.append(el('th',h));head.append(tr);table.append(head);
  const body=el('tbody');for(const values of rows){const tr=el('tr');for(const value of values)tr.append(append(el('td'),value??''));body.append(tr);}table.append(body);
  return append(el('div',null,{class:'table'}),table);
}
function toast(text,error=false){status.textContent=text;status.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>status.style.display='none',error?12000:4500);}
function context(){return {epoch,workspaceId:state?.workspaceId,profile:selectedProfile,project:selectedProject};}
function current(c){return c.epoch===epoch&&c.workspaceId===state?.workspaceId&&c.profile===selectedProfile&&c.project===selectedProject;}
function check(c){if(!current(c))throw Object.assign(new Error('The workspace selection changed. Review the current selection before continuing.'),{code:'ZOTERO_UI_SELECTION_CHANGED'});}
async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function http(path,{method='GET',value,bytes,requestId,file=false}={}){
  if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Open the private connection URL supplied by this workspace.');
  const response=await fetch(path,{method,headers:{Authorization:'Bearer '+token,...((value!==undefined||bytes!==undefined)?{'Content-Type':'application/json'}:{}),
    ...(requestId?{'X-Zotero-Request-Id':requestId}:{})},body:bytes??(value!==undefined?JSON.stringify(value):undefined),cache:'no-store'});
  if(!response.ok){let data;try{data=await response.json();}catch{};throw Object.assign(new Error(data?.error??'Workspace request failed'),data??{});}
  if(file){
    const bytes=await response.arrayBuffer(),actual=await digest(bytes);
    if(actual!==response.headers.get('x-content-sha256'))throw new Error('The complete download did not match its source digest.');
    return {bytes,sha256:actual,name:response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]??'zotero-file.json'};
  }
  return response.json();
}
async function invoke(method,input={},requestId=null){return http('/api/invoke',{method:'POST',value:{method,input,requestId}});}
async function stable(action,method,input){
  const c=context(),hash=await digest(new TextEncoder().encode(JSON.stringify({method,input})));check(c);
  const key=state.workspaceId+':'+action;
  let retained=pending[key];
  if(!retained||retained.hash!==hash){retained={requestId:crypto.randomUUID(),method,input,hash};pending[key]=retained;persist();}
  const result=await invoke(method,input,retained.requestId);
  if(pending[key]?.requestId===retained.requestId){delete pending[key];persist();}
  check(c);return result;
}
async function act(run,node){
  if(node)node.disabled=true;busy++;
  try{await run();}catch(error){toast(error.message??String(error),true);}
  finally{busy--;if(node?.isConnected)node.disabled=false;}
}
async function refresh({render=true}={}){
  const c=context(),next=await http('/api/state');
  if(state&&!current(c))return;
  state=next;
  const profiles=state.records.profile.rows,projects=state.records.project.rows;
  if(!profiles.some(p=>p.id===selectedProfile))selectedProfile=profiles[0]?.id??null;
  if(!projects.some(p=>p.id===selectedProject))selectedProject=projects[0]?.id??null;
  $('#connection').textContent=state.workspaceId;
  if(render)await show(page);
  const active=state.records.capture.rows.some(c=>c.active);
  clearTimeout(poll);if(active)poll=setTimeout(()=>refresh({render:false}).catch(e=>toast(e.message,true)),2000);
}
async function show(name){
  page=name;epoch++;main.replaceChildren();
  for(const button of $('#navigation').children)button.setAttribute('aria-current',button.dataset.page===name?'page':'false');
  const c=context();
  await pages[name](c);
}
function heading(title,description){append(main,el('h1',title),el('p',description,{class:'muted'}));}
function detail(title,value){$('#detail-body').replaceChildren(el('h2',title),el('pre',typeof value==='string'?value:JSON.stringify(value,null,2)));$('#detail').showModal();}
function saveDownload(file){const blob=new Blob([file.bytes],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a',null,{href:url,download:file.name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Downloaded complete file · SHA-256 '+file.sha256);}
async function downloadRecord(input){saveDownload(await http('/api/download?'+new URLSearchParams(Object.entries(input).map(([k,v])=>[k,String(v)])),{file:true}));}
function profileSelector(){
  const select=field('Library profile','select');options(select.node,state.records.profile.rows.map(p=>({value:p.id,label:p.title+' · '+p.library.type+'/'+p.library.id+' · r'+p.revision})),selectedProfile);
  select.node.onchange=()=>{selectedProfile=select.node.value;epoch++;show(page).catch(e=>toast(e.message,true));};return select;
}
function projectSelector(){
  const select=field('Saved project','select');options(select.node,state.records.project.rows.map(p=>({value:p.id,label:p.title+' · r'+p.revision})),selectedProject);
  select.node.onchange=()=>{selectedProject=select.node.value;projectOffset=0;epoch++;show(page).catch(e=>toast(e.message,true));};return select;
}
const pages={
  async overview(){
    heading('Library editions and review','Capture or import original Zotero documents, review their changes, and deliver selected evidence into the maintained Research dossier.');
    if(state.transport?.mode==='local-protocol-exercise')main.append(note('Local protocol exercise · '+state.transport.sourceReference+'. This workspace is not reading a live Zotero library.'));
    const metrics=el('div',null,{class:'metrics'});
    for(const [kind,label]of [['profile','Library profiles'],['edition','Retained editions'],['project','Saved projects'],['handoff','Research handoffs']])
      metrics.append(append(el('div',null,{class:'metric'}),el('strong',String(state.records[kind].total)),el('span',label)));
    main.append(metrics,note('A completed API capture requires every collections/items page and its final version check. A retained document selection keeps its source boundaries visible.'));
    main.append(panel('Continue work',row(button('Libraries',()=>show('libraries')),button('Capture and intake',()=>show('capture')),button('Projects',()=>show('projects')),button('Research delivery',()=>show('research')))));
    const tasks=Object.entries(pending).filter(([k,r])=>k.startsWith(state.workspaceId+':')&&typeof r.method==='string');
    if(tasks.length)main.append(panel('Requests without a received browser answer',
      el('p','The original request UUID and reviewed input remain available. Reopening a saved result does not create a replacement action.'),
      table(['Method','Original request','Continue'],tasks.map(([k,r])=>[r.method,el('code',r.requestId),
        button('Recover original action',async()=>{await invoke(r.method,r.input,r.requestId);delete pending[k];persist();await refresh();},true)]))));
    main.append(panel('Source scope',el('p','Only Zotero Web API v3 reads are issued. Linked URLs, attachment files, and full text are not downloaded. Library keys are resolved from the selected environment variable on the host.'),
      el('p','Portable receiving retains the source pages, field values, project revisions, comparisons, and completed Research dossier histories. It does not contain API key values.')));
  },
  async libraries(){
    heading('Library profiles','Select the original Web API library identity, source terms, and optional collection view.');
    const existing=state.records.profile.rows.find(p=>p.id===selectedProfile)??null;
    const selection=profileSelector();
    main.append(row(selection.wrap,button('New profile',()=>{selectedProfile=null;epoch++;show('libraries');},true)));
    const current=selectedProfile?existing:null;
    const title=field('Profile title','text',current?.title??'');
    const type=field('Library type','select');options(type.node,[{value:'users',label:'User library'},{value:'groups',label:'Group library'}],current?.library.type??'users');
    const lib=field('Numeric library ID','text',current?.library.id??'','The numeric user/group ID is distinct from its display name.');
    const env=field('API key environment reference','text',current?.apiKeyEnv??'','Leave empty for a public library. Enter the environment variable name, never the key value.');
    const terms=field('Source and reuse terms','textarea',current?.sourceTerms??'','Retain the actual selected source rights and access conditions.');
    const scope=field('Collection keys','text',(current?.scope.collectionKeys??[]).join(', '),'Comma-separated original keys. Empty selects the complete retained library.');
    const descendants=field('Include descendant collections','checkbox',current?.scope.includeDescendants??true);
    const trash=field('Include Zotero trash metadata','checkbox',current?.includeTrashed??false);
    const limits=field('Native capture limits','textarea',JSON.stringify({timeoutMs:current?.timeoutMs??30000,maxPageBytes:current?.maxPageBytes??16777216,
      maxCaptureBytes:current?.maxCaptureBytes??67108864,maxItems:current?.maxItems??50000},null,2));
    const form=panel(current?'Edit selected profile · revision '+current.revision:'Create library profile',
      append(el('div',null,{class:'grid'}),title.wrap,type.wrap,lib.wrap,env.wrap),terms.wrap,scope.wrap,row(descendants.wrap,trash.wrap));
    const advanced=el('details');append(advanced,el('summary','Capture limits'),limits.wrap);form.append(advanced);
    form.append(button('Save library profile',async()=>{
      const definition={...(JSON.parse(limits.node.value)),title:title.node.value,library:{type:type.node.value,id:lib.node.value.trim()},
        apiKeyEnv:env.node.value.trim()||null,sourceTerms:terms.node.value,
        scope:{collectionKeys:scope.node.value.split(',').map(x=>x.trim()).filter(Boolean),includeDescendants:descendants.node.checked},
        includeTrashed:trash.node.checked};
      const result=await stable('profile-save','profile.save',{...(current?{id:current.id}:{}),expectedRevision:current?.revision??0,definition});
      selectedProfile=result.value.id;await refresh();toast('Library profile saved with its original revision history.');
    }));main.append(form);
    main.append(table(['Library','Version','Authentication','Action'],state.records.profile.rows.map(p=>[p.title+' · '+p.library.type+'/'+p.library.id,
      String(p.revision),p.apiKeyEnv?'Environment: '+p.apiKeyEnv:'Public read',button('History',async()=>detail(p.title,await invoke('record.history',{kind:'profile',id:p.id})),true)])));
  },
  async capture(){
    heading('Capture and original document intake','Retain the exact native pages before publishing a version-consistent edition.');
    main.append(button('Refresh capture progress',()=>refresh(),true));
    if(!selectedProfile){main.append(note('Create a library profile first.'));return;}
    const selected=profileSelector(),p=state.records.profile.rows.find(x=>x.id===selectedProfile);main.append(selected.wrap);
    main.append(panel('Read the selected Zotero library',
      el('p','The original collections and items are captured in order, followed by a library-version probe. Restarting after a source change preserves the earlier attempt.'),
      button('Start library capture',async()=>{await stable('capture-start','capture.prepare',{profileId:p.id,profileRevision:p.revision});await refresh();})));
    const file=field('Retained document set','file');file.node.accept='.json,application/json';
    const raw=field('Original API response kind','select');options(raw.node,[{value:'items',label:'Items response array'},{value:'collections',label:'Collections response array'}],'items');
    const source=field('Original response source reference','text','','Used when the selected file is an original API array instead of a document-set packet.');
    main.append(panel('Import existing source documents',file.wrap,raw.wrap,source.wrap,
      el('p','The original JSON array is retained unchanged inside a named document set. Imported documents remain a selection and do not claim a live complete-library capture.',{class:'muted'}),
      button('Import original documents',async()=>{
        const c=context(),selectedFile=file.node.files[0];if(!selectedFile)throw new Error('Select the original JSON file.');
        let bytes=new Uint8Array(await selectedFile.arrayBuffer());check(c);
        if(bytes.length>268435456)throw new Error('This document exceeds the 256 MiB intake limit.');
        const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        if(Array.isArray(value)){
          const hash=await digest(bytes);check(c);
          let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
          bytes=new TextEncoder().encode(JSON.stringify({schema:'stellar-forge.zotero-document-set.v1',library:p.library,
            sourceReference:source.node.value,documents:[{name:selectedFile.name.replace(/[^A-Za-z0-9._-]/g,'_'),kind:raw.node.value,
              sourceReference:source.node.value,bytes:bytes.length,sha256:hash,contentBase64:btoa(binary)}]}));
        }
        const hash=await digest(bytes);check(c);
        const k=state.workspaceId+':file-import',old=pending[k],identity=JSON.stringify({profileId:p.id,profileRevision:p.revision,hash});
        const req=old?.identity===identity?old.requestId:crypto.randomUUID();
        pending[k]={requestId:req,identity,file:true};persist();
        const result=await http('/api/import?'+new URLSearchParams({profileId:p.id,profileRevision:String(p.revision)}),
          {method:'POST',bytes,requestId:req});
        delete pending[k];persist();check(c);await refresh();toast('Original documents retained as '+result.value.id);
      })));
    main.append(table(['Capture / attempt','State','Retained progress','Actions'],state.records.capture.rows.map(c=>[
      append(el('div'),el('strong',c.profile.title),el('div',c.id,{class:'compact'}),el('div','Attempt '+c.attempt)),
      append(el('div'),el('span',c.displayStatus,{class:'tag'}),c.lastError?el('div',c.lastError,{class:'compact'}):null,
        c.notBefore?el('div','Next eligible read: '+c.notBefore,{class:'compact'}):null),
      (c.counts?.items??0)+' items · '+(c.counts?.collections??0)+' collections · '+c.documents.length+' pages',
      row(button('Inspect',()=>detail('Original capture',c),true),
        button('Resume',async()=>{await stable('capture-control:'+c.id,'capture.control',{id:c.id,operation:'resume'});await refresh();},true),
        button('Cancel',async()=>{await stable('capture-control:'+c.id,'capture.control',{id:c.id,operation:'cancel'});await refresh();},true),
        button('Restart source attempt',async()=>{await stable('capture-control:'+c.id,'capture.control',{id:c.id,operation:'restart'});await refresh();},true))
    ])));
  },
  async editions(){
    heading('Retained editions','Every edition keeps its source documents, library identity, object keys, and coverage statement.');
    main.append(table(['Edition','Coverage','Original objects','Actions'],state.records.edition.rows.map(e=>[
      append(el('div'),el('strong',e.label),el('code',e.id)),e.coverage.mode+(e.coverage.libraryVersion!==null?' · version '+e.coverage.libraryVersion:''),
      e.counts.items+' items · '+e.counts.collections+' collections',
      row(button('Source files',async()=>detail('Original retained source files',e.documents),true),
        button('Download complete edition',()=>downloadRecord({kind:'edition',id:e.id}),true),
        button('New project',async()=>{page='projects';await show('projects');const input=$('[aria-label="Selected edition"]');if(input)input.value=e.id;},true))
    ])));
    const edition=field('Edition for original document download','select');
    options(edition.node,state.records.edition.rows.map(e=>({value:e.id,label:e.label+' · '+e.id.slice(-12)})),state.records.edition.rows[0]?.id);
    const name=field('Original document filename','text','','Inspect the edition’s source-file list above; bytes are returned unchanged.');
    main.append(panel('Download an original page',edition.wrap,name.wrap,button('Download original document',()=>downloadRecord({kind:'edition',id:edition.node.value,role:'document',name:name.node.value}),true)));
  },
  async projects(c){
    heading('Projects and evidence decisions','Save a collection view, select exact item keys, and preserve findings against the chosen edition.');
    const chooser=projectSelector();main.append(row(chooser.wrap,button('New project',()=>{selectedProject=null;epoch++;show('projects');},true)));
    const p=state.records.project.rows.find(x=>x.id===selectedProject)??null;
    const title=field('Project title','text',p?.title??''),description=field('Project description','textarea',p?.description??'');
    const ed=field('Selected edition','select');options(ed.node,state.records.edition.rows.map(e=>({value:e.id,label:e.label+' · '+e.coverage.mode+' · '+e.id.slice(-12)})),p?.editionId??state.records.edition.rows[0]?.id);
    const collections=field('Project collection keys','text',(p?.scope.collectionKeys??[]).join(', '),'Changing edition or scope preserves prior project revisions. Missing finding sources must be reviewed explicitly.');
    const descend=field('Include descendants in project','checkbox',p?.scope.includeDescendants??true);
    const findings=field('Findings with original item keys','textarea',JSON.stringify(p?.findings??[],null,2));
    findings.node.classList.add('code');
    const edit=panel(p?'Edit project · revision '+p.revision:'Create project',title.wrap,description.wrap,ed.wrap,collections.wrap,descend.wrap);
    const advanced=el('details');append(advanced,el('summary','Reviewed findings'),el('p','Each finding has id, title, text, and an itemKeys array. The same original keys must be present in this selected view.'),findings.wrap);edit.append(advanced);
    edit.append(button('Save project revision',async()=>{
      const result=await stable('project-save','project.save',{...(p?{id:p.id}:{}),expectedRevision:p?.revision??0,title:title.node.value,
        description:description.node.value,editionId:ed.node.value,scope:{collectionKeys:collections.node.value.split(',').map(x=>x.trim()).filter(Boolean),
          includeDescendants:descend.node.checked},findings:JSON.parse(findings.node.value)});
      selectedProject=result.value.id;await refresh();toast('Project revision saved.');
    }));main.append(edit);
    if(!p)return;
    const view=await invoke('project.page',{id:p.id,revision:p.revision,offset:projectOffset,limit:50,query:projectQuery});check(c);
    const query=field('Find retained items','search',projectQuery);
    const search=button('Search',async()=>{projectQuery=query.node.value;projectOffset=0;await show('projects');},true);
    main.append(panel('Original library items',row(query.wrap,search),el('p',view.total+' items in this view · '+view.edition.coverage.mode,{class:'muted'})));
    const changes=new Map();
    const rows=view.items.map(item=>{
      const selected=field('Select item '+item.key,'checkbox',item.decision.selected);
      const classification=field('Classification for '+item.key,'select');options(classification.node,
        ['unreviewed','supports','contradicts','background'].map(x=>({value:x,label:x})),item.decision.classification);
      const note=field('Decision note for '+item.key,'textarea',item.decision.note);note.node.style.minHeight='70px';
      const save=()=>changes.set(item.key,{key:item.key,selected:selected.node.checked,classification:classification.node.value,note:note.node.value});
      selected.node.onchange=save;classification.node.onchange=save;note.node.oninput=save;
      return [append(el('div'),el('strong',item.title),el('div',item.itemType+' · '+item.key+' · v'+item.version,{class:'compact'}),
        el('div',item.creators.map(c=>c.name??[c.firstName,c.lastName].filter(Boolean).join(' ')).join('; '),{class:'compact'})),
        selected.wrap,classification.wrap,note.wrap,button('Original fields',async()=>{const whole=await invoke('edition.get',{id:p.editionId});detail(item.title,whole.items.find(r=>r.key===item.key));},true)];
    });
    main.append(table(['Original item','Selected','Classification','Decision note','Source'],rows));
    main.append(row(button('Save visible decision changes',async()=>{
      if(!changes.size)throw new Error('Change at least one visible item decision.');
      await stable('project-decisions:'+p.id,'project.decide',{projectId:p.id,expectedRevision:p.revision,changes:[...changes.values()]});await refresh();
    }),button('Previous items',async()=>{projectOffset=Math.max(0,projectOffset-50);await show('projects');},true),
      button('Next items',async()=>{if(view.nextOffset!==null){projectOffset=view.nextOffset;await show('projects');}},true),
      button('Full project history',async()=>detail(p.title,await invoke('record.history',{kind:'project',id:p.id})),true)));
    if(view.retiredDecisions.length)main.append(note(view.retiredDecisions.length+' decisions refer to items absent from this edition. Their prior source-bound decisions remain in history.'));
  },
  async compare(){
    heading('Edition comparison','Review exact field, creator, parent, and collection membership changes between retained editions.');
    const rows=state.records.edition.rows.map(e=>({value:e.id,label:e.label+' · '+e.id.slice(-12)+' · '+e.coverage.mode}));
    const before=field('Before edition','select'),after=field('After edition','select');options(before.node,rows,rows[1]?.value??rows[0]?.value);options(after.node,rows,rows[0]?.value);
    main.append(panel('Compare selected source editions',before.wrap,after.wrap,button('Create complete comparison',async()=>{
      await stable('comparison','edition.compare',{before:before.node.value,after:after.node.value});await refresh();
    })));
    main.append(table(['Original source pair','Items','Collections','Full result'],state.records.comparison.rows.map(c=>[
      append(el('div'),el('code',c.before),el('br'),el('code',c.after)),
      '+'+c.summary.itemsAdded+' / −'+c.summary.itemsRemoved+' / changed '+c.summary.itemsChanged,
      '+'+c.summary.collectionsAdded+' / −'+c.summary.collectionsRemoved+' / changed '+c.summary.collectionsChanged,
      row(button('Review changes',async()=>{const file=await http('/api/download?'+new URLSearchParams({kind:'comparison',id:c.id}),{file:true});detail('Exact source changes',JSON.parse(new TextDecoder().decode(file.bytes)));},true),
        button('Download',()=>downloadRecord({kind:'comparison',id:c.id}),true))
    ])));
  },
  async research(c){
    heading('Research delivery','Prepare a full source bundle for an original dossier question, review its exact digest, and recover the same handoff after interruption.');
    if(!state.researchWorkspaceId){main.append(note('Launch with --research-dir pointing to the existing Research workspace, or open Zotero from that workspace’s integrated control.'));return;}
    if(!selectedProject){main.append(note('Create a saved Zotero project before preparing a Research handoff.'));return;}
    main.append(projectSelector().wrap);
    const p=state.records.project.rows.find(p=>p.id===selectedProject),d=field('Original Research dossier','select');
    options(d.node,state.research.map(x=>({value:x.id,label:x.title+' · r'+x.revision})),state.research[0]?.id);
    const q=field('Original dossier question','select');
    const load=async()=>{
      q.node.replaceChildren();if(!d.node.value)return;
      const selected=d.node.value,meta=await invoke('research.get',{id:selected});check(c);if(d.node.value!==selected)return;
      options(q.node,meta.questions.map(x=>({value:x.id,label:x.text})),meta.questions[0]?.id);
    };d.node.onchange=()=>act(load);
    main.append(panel('Prepare selected project',d.wrap,q.wrap,el('p','Item decisions are carried as exact source occurrences. Raw Zotero pages and project lineage are included as an unselected custody source.'),
      button('Prepare Research source bundle',async()=>{
        await stable('handoff-prepare','research.prepare',{projectId:p.id,projectRevision:p.revision,dossierId:d.node.value,questionId:q.node.value});await refresh();
      })));
    await load();check(c);
    if(!state.research.length)main.append(note('Create the dossier and its question in the original Research application using this same directory. This workspace does not create a second dossier model.'));
    main.append(table(['Handoff','Source digest','State','Actions'],state.records.handoff.rows.map(h=>[
      append(el('div'),el('strong',h.projectId+' · r'+h.projectRevision),el('div',h.target.dossierId,{class:'compact'})),
      el('code',h.object.sha256),h.status,
      row(button('Review exact bundle',async()=>detail('Research source preview',await invoke('research.preview',{id:h.id})),true),
        button('Download full source bundle',()=>downloadRecord({kind:'handoff',id:h.id}),true),
        button(h.status==='RECEIVED'?'Recover received handoff':'Receive in original dossier',async()=>{
          const c=context(),preview=await invoke('research.preview',{id:h.id});check(c);
          const result=await stable('handoff-receive:'+h.id,'research.receive',{id:h.id,expectedDossierRevision:preview.expectedRevision});
          await refresh();toast('Original Research edition '+result.result.editionId+' is retained.');
        }),button('History',async()=>detail('Original handoff history',await invoke('record.history',{kind:'handoff',id:h.id})),true))
    ])));
  },
  async transfer(){
    heading('Independent receiving','Export complete native source/history and linked original Research dossier editions into a private, independently editable workspace.');
    main.append(panel('Export full workspace',el('p','Every retained original source object and record revision is included. Completed linked Research dossiers use their original full-history portable format. API key values and writer leases are absent.'),
      button('Download complete receiving packet',async()=>{
        const k=state.workspaceId+':export',op=pending[k]?.requestId??crypto.randomUUID();pending[k]={requestId:op,file:true};persist();
        const file=await http('/api/export?'+new URLSearchParams({requestId:op}),{file:true});saveDownload(file);delete pending[k];persist();
      })));
    const file=field('Complete workspace packet','file');file.node.accept='.json,application/json';
    const name=field('Receiving workspace name','text','second-operator','A new or already-owned receiving directory beneath this workspace. Letters, digits, underscore, and hyphen.');
    const output=el('div');
    main.append(panel('Receive and open independent workspace',file.wrap,name.wrap,button('Receive full packet',async()=>{
      const c=context(),selected=file.node.files[0],selectedName=name.node.value;if(!selected)throw new Error('Select the complete receiving packet.');
      const bytes=await selected.arrayBuffer(),hash=await digest(bytes);check(c);
      const k=state.workspaceId+':receive:'+selectedName,old=pending[k],op=old?.hash===hash?old.requestId:crypto.randomUUID();
      pending[k]={requestId:op,hash,file:true};persist();
      const result=await http('/api/receive?'+new URLSearchParams({name:selectedName}),{method:'POST',bytes,requestId:op});
      delete pending[k];persist();check(c);
      output.replaceChildren(note('Original identities and '+result.receipt.recordRevisions+' record revisions received. The independently opened workspace has its own live connection.'),
        el('a','Open receiving workspace',{href:result.connection.url,target:'_blank',rel:'noopener',class:'button'}));
    }),output));
    const reopen=field('Existing receiving workspace name','text','second-operator');
    const link=el('div');
    main.append(panel('Reopen the same received workspace',reopen.wrap,button('Open existing receiver',async()=>{
      const result=await http('/api/receiver/open',{method:'POST',value:{name:reopen.node.value}});
      link.replaceChildren(el('a','Open existing received workspace',{href:result.connection.url,target:'_blank',rel:'noopener',class:'button'}));
    },true),link));
  }
};
for(const [name,label]of [['overview','Overview'],['libraries','Libraries'],['capture','Capture and intake'],['editions','Editions'],
  ['projects','Projects'],['compare','Changes'],['research','Research delivery'],['transfer','Receiving']]){
  const b=button(label,()=>show(name),true);b.dataset.page=name;$('#navigation').append(b);
}
window.addEventListener('pagehide',()=>{token='';clearTimeout(poll);});
await refresh().catch(error=>{heading('Open the private workspace connection',error.message);toast(error.message,true);});
