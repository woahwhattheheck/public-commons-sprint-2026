// MIT. Native NetBox inventory operator desk. Provider effects stay in the original operator.
const $=(selector,root=document)=>root.querySelector(selector);
const clone=value=>structuredClone(value);
const tokenKey='netbox-migration-desk:access';
const cursorKey='netbox-migration-desk:selection';
const pendingKey='netbox-migration-desk:active-action';
const labels={primary_ip:'Primary addresses',sites:'Sites',racks:'Racks',devices:'Devices',interfaces:'Interfaces',ip_addresses:'IP addresses',route_targets:'Route targets',vrfs:'VRFs',vlans:'VLANs',prefixes:'Prefixes',cables:'Cables',cable_terminations:'Cable terminations',cable_endpoints:'Cable endpoint caches',cable_paths:'Cable paths',native_effects:'Native endpoint and path effects'};
const singular={primary_ip:'Primary address',sites:'Site',racks:'Rack',devices:'Device',interfaces:'Interface',ip_addresses:'IP address',route_targets:'Route target',vrfs:'VRF',vlans:'VLAN',prefixes:'Prefix',cables:'Cable'};
const catalogKinds={tenant:'tenants',device_type:'device_types',role:'roles',platform:'platforms',location:'locations',vrf:'vrfs',group:'vlan_groups',ipam_role:'ipam_roles',bundle:'cable_bundles'};
const fieldNames={primary_ip4:'Primary IPv4 address',primary_ip6:'Primary IPv6 address',key:'Source key',match_id:'Existing NetBox ID',device_type:'Device type',asset_tag:'Asset tag',u_height:'Height (U)',starting_unit:'Starting unit',desc_units:'Descending units',facility_id:'Facility ID',mgmt_only:'Management only',dns_name:'DNS name',mtu:'MTU',vrf:'VRF',primary:'Primary address',vid:'VLAN ID',rd:'Route distinguisher',enforce_unique:'Enforce unique prefixes and addresses',scope_site:'Site scope',ipam_role:'IPAM role',untagged_vlan:'Untagged VLAN',tagged_vlans:'Tagged VLANs',import_targets:'Import route targets',export_targets:'Export route targets',a_interface:'A interface',b_interface:'B interface',is_pool:'Address pool',mark_utilized:'Mark utilized',length_unit:'Length unit',cable_end:'Cable end',cable_connector:'Cable connector',cable_positions:'Cable positions'};
const S={token:'',boot:null,project:null,draft:null,baseDraft:null,baseRevision:null,dirty:false,conflict:false,
  tab:'sources',sourceIndex:0,preview:null,edition:null,result:null,corrections:null,activeAction:null,
  changeQuery:'',changeKind:'',changeAction:'',changePage:0,network:null,networkKind:'prefixes',networkQuery:'',networkPage:0,catalogLabels:new Map(),pollTimer:null,busy:0,mobileOpen:false};
const savedStorage=(store,key,fallback=null)=>{try{return JSON.parse(store.getItem(key))??fallback;}catch{return fallback;}};
const setStorage=(store,key,value)=>{try{value===null?store.removeItem(key):store.setItem(key,JSON.stringify(value));}catch{}};
const stable=value=>JSON.stringify(sortObject(value));
function sortObject(value){if(Array.isArray(value))return value.map(sortObject);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortObject(value[key])]));return value;}
const uid=()=>crypto.randomUUID();
const fmt=n=>new Intl.NumberFormat().format(Number(n)||0);
const title=value=>fieldNames[value]??String(value).replaceAll('_',' ').replace(/^\w/,x=>x.toUpperCase());
const short=value=>value?String(value).slice(0,12):'—';
const date=value=>{try{return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}catch{return value??'—';}};
const size=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':fmt(n)+' bytes';
const projectURL=(suffix='')=>'/api/projects/'+encodeURIComponent(S.project.id)+suffix;
const editionURL=(suffix='')=>projectURL('/editions/'+encodeURIComponent(S.edition.id)+suffix);
function h(tag,attributes={},...children){
  const element=document.createElement(tag);
  for(const [key,value]of Object.entries(attributes??{})){
    if(value===undefined||value===null||value===false)continue;
    if(key.startsWith('on')&&typeof value==='function')element.addEventListener(key.slice(2).toLowerCase(),event=>{try{Promise.resolve(value(event)).catch(reportError);}catch(error){reportError(error);}});
    else if(key==='class')element.className=value;
    else if(key==='text')element.textContent=value;
    else if(['value','checked','disabled','hidden','selected','readOnly','multiple'].includes(key))element[key]=value;
    else element.setAttribute(key,value===true?'':String(value));
  }
  for(const child of children.flat(Infinity))if(child!==null&&child!==undefined&&child!==false)element.append(child instanceof Node?child:document.createTextNode(String(child)));
  return element;
}
const button=(label,action,attributes={})=>h('button',{type:'button',onClick:action,...attributes},label);
const help=text=>h('p',{class:'help'},text);
const badge=state=>h('span',{class:'badge '+(state==='APPLIED'?'solid':state?.includes('WAIT')||state==='RUNNING'||state==='QUEUED'?'pending':'')},String(state??'DRAFT').replaceAll('_',' '));
const panel=(heading,content,actions=null,subtext=null)=>h('section',{class:'panel'},
  h('div',{class:'panel-header'},h('div',{},h('h2',{},heading),subtext&&help(subtext)),actions),content);
function announce(message){$('#announcements').textContent=message;}
function notice(message,details=null){
  const box=h('div',{class:'notice'},h('div',{},message,details&&h('pre',{},typeof details==='string'?details:JSON.stringify(details,null,2))),
    button('×',()=>box.remove(),{class:'quiet compact','aria-label':'Dismiss notification'}));
  $('#notices').append(box);announce(message);
  if(!details)setTimeout(()=>box.remove(),7000);
}
function reportError(error){
  if(error?.status===401||error?.status===403&&error?.code==='unauthorized'){login(error.message);return;}
  if(error?.status===409&&S.project&&['revision_conflict','project_revision_conflict','stale_revision'].includes(error.code)){S.conflict=true;render();}
  notice(error?.message??String(error),error?.details);
}
class ApiError extends Error{constructor(message,status,code,details){super(message);Object.assign(this,{status,code,details});}}
async function api(path,{method='GET',body=null,raw=false}={}){
  const headers={Authorization:'Bearer '+S.token,'X-Workspace-Token':S.token};
  if(body!==null&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
  let response;
  try{response=await fetch(path,{method,body,headers,cache:'no-store',credentials:'omit',redirect:'error'});}
  catch{throw new ApiError('The workspace connection was interrupted. Reopen the saved project or resume its saved action.',0,'connection_interrupted');}
  if(raw&&response.ok)return response;
  let result;try{result=await response.json();}catch{throw new ApiError('The workspace returned an unreadable response.',response.status,'invalid_response');}
  if(!response.ok||result.ok===false){const e=result.error??{};throw new ApiError(e.message??'The requested operation could not be completed.',response.status,e.code,e.details);}
  return result;
}
function intent(key,payload){
  const storageKey='netbox-migration-desk:request:'+key;
  const fingerprint=stable(payload),saved=savedStorage(sessionStorage,storageKey);
  const value=saved?.fingerprint===fingerprint?saved:{id:uid(),fingerprint};
  setStorage(sessionStorage,storageKey,value);return{id:value.id,done:()=>setStorage(sessionStorage,storageKey,null)};
}
async function post(path,payload,key=path){
  const request=intent(key,payload),result=await api(path,{method:'POST',body:{...payload,request_id:request.id}});
  request.done();return result;
}
function draftOf(project){return{label:project.label,tenant_id:project.tenant_id??null,source_notes:project.source_notes??'',mapping:clone(project.mapping)};}
function rememberSelection(){setStorage(localStorage,cursorKey,{project:S.project?.id,edition:S.edition?.id,tab:S.tab,sourceIndex:S.sourceIndex});}
function adoptProject(project,{keepDraft=true}={}){
  const same=S.project?.id===project.id;
  if(same&&keepDraft&&S.dirty){
    if(stable(draftOf(project))===stable(S.baseDraft)){S.baseRevision=project.revision;S.conflict=false;}
    else if(project.revision!==S.baseRevision)S.conflict=true;
  }else{S.draft=draftOf(project);S.baseDraft=clone(S.draft);S.baseRevision=project.revision;S.dirty=false;S.conflict=false;}
  S.project=project;
  if(S.boot){const summary={id:project.id,label:project.label,revision:project.revision,updated_at:project.updated_at,uploads_count:project.uploads.length,editions_count:project.editions.length};
    const index=S.boot.projects.findIndex(item=>item.id===project.id);if(index<0)S.boot.projects.unshift(summary);else S.boot.projects[index]=summary;}
  if(S.edition){const fresh=project.editions.find(item=>item.id===S.edition.id);if(fresh)S.edition={...S.edition,...fresh};}
  rememberSelection();
}
function markDirty(){
  S.dirty=stable(S.draft)!==stable(S.baseDraft);S.preview=null;
  const status=$('#save-state');if(status)status.textContent=S.dirty?'Unsaved mapping':'Saved';
  const save=$('#save-draft');if(save)save.disabled=!S.dirty||S.busy>0||S.conflict;
}
async function saveDraft(){
  if(!S.dirty)return;
  if(S.conflict)throw new ApiError('This project changed on another screen. Reload its saved mapping before saving.',409,'revision_conflict');
  const selectedProject=S.project.id,submitted=clone(S.draft);
  const mapping=clone(submitted.mapping);mapping.tenant_id=submitted.tenant_id;mapping.source_notes=submitted.source_notes;mapping.netbox_url=S.boot.connection.base_url;
  const result=await post(projectURL('/mapping'),{expected_revision:S.baseRevision,...submitted,mapping});
  if(S.project?.id!==selectedProject)return;
  const newerDraft=stable(S.draft)===stable(submitted)?null:clone(S.draft);
  adoptProject(result.project,{keepDraft:false});
  if(newerDraft){S.draft=newerDraft;markDirty();}
  announce(newerDraft?'Earlier changes saved; newer edits remain in your draft.':'Mapping saved.');
}
async function withBusy(action){
  S.busy++;document.body.classList.add('busy');render();
  try{return await action();}finally{S.busy--;if(!S.busy)document.body.classList.remove('busy');render();}
}
function closeDialog(){const dialog=$('#dialog');if(dialog.open)dialog.close();dialog.replaceChildren();}
function openDialog(heading,content,actions=[]){
  const dialog=$('#dialog');dialog.replaceChildren(h('div',{class:'dialog-header'},h('h2',{id:'dialog-title'},heading),button('×',closeDialog,{class:'quiet compact','aria-label':'Close dialog'})),
    h('div',{class:'dialog-content'},content),h('div',{class:'dialog-footer'},...actions));
  if(!dialog.open)dialog.showModal();setTimeout(()=>(dialog.querySelector('.dialog-content input,.dialog-content select,.dialog-content textarea')??dialog.querySelector('.dialog-footer button'))?.focus(),0);
}
function confirmAction(heading,content,label='Continue'){
  return new Promise(resolve=>{
    const dialog=$('#dialog');let resolved=false;
    const finish=value=>{if(resolved)return;resolved=true;closeDialog();resolve(value);};
    openDialog(heading,content,[button('Cancel',()=>finish(false)),button(label,()=>finish(true),{class:'primary'})]);
    dialog.addEventListener('close',()=>{if(!resolved){resolved=true;resolve(false);}},{once:true});
  });
}
function login(message=''){
  clearTimeout(S.pollTimer);
  $('#app').replaceChildren(h('main',{class:'login'},h('div',{class:'login-card'},
    h('div',{class:'eyebrow'},'Inventory migration'),h('h1',{},'Open operator workspace'),
    h('p',{class:'muted'},'Use the private access link from this workspace, or enter its access code.'),
    h('form',{onSubmit:async event=>{event.preventDefault();S.token=$('#access-code').value.trim();setStorage(sessionStorage,tokenKey,S.token);await bootstrap();}},
      h('label',{},'Workspace access code',h('input',{id:'access-code',type:'password',autocomplete:'off',required:true})),
      message&&h('p',{class:'error'},message),h('button',{type:'submit',class:'primary'},'Open workspace')))));
}
async function bootstrap(){
  const result=await api('/api/state');S.boot=result;
  const selected=savedStorage(localStorage,cursorKey,{});
  S.tab=['sources','mapping','review','delivery'].includes(selected.tab)?selected.tab:'sources';
  if(selected.project&&result.projects.some(item=>item.id===selected.project))await openProject(selected.project,{initial:true,edition:selected.edition});
  else if(result.projects.length)await openProject(result.projects[0].id,{initial:true});
  else render();
  const active=savedStorage(localStorage,pendingKey);
  if(active?.id){if(['FAILED','NOT_STARTED'].includes(active.state)){S.activeAction=active;setStorage(localStorage,pendingKey,null);render();}else await pollAction(active.id);}
}
async function openProject(id,{initial=false,edition=null}={}){
  if(!initial&&S.dirty)await saveDraft();
  const result=await api('/api/projects/'+encodeURIComponent(id));
  S.edition=null;S.result=null;S.corrections=null;S.preview=null;S.sourceIndex=0;S.mobileOpen=false;
  adoptProject(result.project,{keepDraft:false});
  const chosen=edition??result.project.editions.at(-1)?.id;
  if(chosen)await loadEdition(chosen,{renderAfter:false});
  render();
}
async function reloadProject(){
  if(S.dirty&&!await confirmAction('Reload the saved mapping',h('p',{},'Your unsaved mapping changes will be replaced by the latest saved project.'),'Reload saved project'))return;
  await openProject(S.project.id,{initial:true,edition:S.edition?.id});
}


function render(){
  if(!S.boot)return;
  const connection=S.boot.connection;
  const navigation=h('aside',{class:'sidebar'+(S.mobileOpen?' mobile-open':''),'aria-label':'Projects'},
    h('div',{class:'brand'},h('div',{class:'eyebrow'},'Operations'),h('div',{class:'brand-name'},'NetBox inventory desk')),
    h('div',{class:'sidebar-title'},h('span',{class:'eyebrow'},'Projects'),button('New',createProjectDialog,{class:'compact','aria-label':'New project',disabled:S.busy>0})),
    h('nav',{class:'project-list'},S.boot.projects.length?S.boot.projects.map(project=>button(
      [h('strong',{},project.label),h('small',{},fmt(project.uploads_count)+' files · '+fmt(project.editions_count)+' editions')],
      ()=>withBusy(()=>openProject(project.id)),{class:'project-button'+(S.project?.id===project.id?' selected':''),'aria-current':S.project?.id===project.id?'page':null,disabled:S.busy>0})):
      h('p',{class:'help'},'Create a project to retain source files and migration editions.')),
    h('div',{class:'sidebar-footer'},h('div',{class:'connection-label'},h('span',{class:'status-dot'}),'Native connection'),
      h('p',{class:'help break'},connection.base_url),h('p',{class:'help'},connection.branch?'Branch: '+connection.branch:'Default NetBox branch'),
      h('p',{class:'help'},connection.token_configured?'Provider token configured':'Configure the provider token before native review.')));
  const workspace=h('div',{class:'workspace'},
    h('header',{class:'topbar'},
      h('div',{class:'toolbar'},button('Projects',()=>{S.mobileOpen=!S.mobileOpen;render();},{class:'mobile-menu compact','aria-expanded':S.mobileOpen}),
        h('div',{class:'breadcrumbs'},'Inventory / ',h('strong',{},S.draft?.label||'Projects'))),
      h('div',{class:'topbar-actions'},S.project&&h('span',{id:'save-state',class:'help','aria-live':'polite'},S.dirty?'Unsaved mapping':'Saved'),
        S.project&&button('Save mapping',()=>withBusy(saveDraft),{id:'save-draft',disabled:!S.dirty||S.busy>0||S.conflict}))),
    h('main',{id:'main',tabindex:'-1'},S.project?renderProject():h('div',{class:'empty'},
      h('div',{class:'eyebrow'},'CSV to native inventory'),h('h1',{},'Bring an inventory into NetBox'),
      h('p',{},'Retain the source files, map their columns, review the native changes and carry the finished migration into a reusable handover.'),
      button('Create a project',createProjectDialog,{class:'primary'}))));
  $('#app').replaceChildren(h('div',{class:'shell'},navigation,workspace));
  $('#app').setAttribute('aria-busy',String(S.busy>0));
  if(S.busy)for(const control of document.querySelectorAll('#app input,#app select,#app textarea,#app button'))control.disabled=true;
}
function renderProject(){
  const tabs=[['sources','Source files'],['mapping','Mapping'],['review','Native review'],['delivery','Delivery']];
  return [
    h('div',{class:'page-heading'},h('div',{},h('div',{class:'eyebrow'},'Inventory migration'),
      h('h1',{},S.draft.label||'Untitled project'),h('p',{class:'subheading'},'Sources, native changes and delivery in one retained workspace.')),
      h('div',{class:'heading-actions'},badge(S.edition?.state??'DRAFT'),button('Refresh',()=>withBusy(refreshSelected),{disabled:S.busy>0}))),
    S.conflict&&h('div',{class:'banner',role:'alert'},h('div',{},h('strong',{},'The saved project changed.'),h('p',{},'Your mapping is still on this screen. Reload the saved project to review the newer version before saving.')),
      button('Reload saved project',reloadProject)),
    S.activeAction&&renderActionCard(),
    h('nav',{class:'tabs','aria-label':'Migration stages'},tabs.map(([id,label])=>button(label,()=>{S.tab=id;rememberSelection();render();},{class:'tab'+(S.tab===id?' active':''),'aria-current':S.tab===id?'page':null}))),
    S.tab==='sources'?renderSources():S.tab==='mapping'?renderMapping():S.tab==='review'?renderReview():renderDelivery()
  ];
}
async function refreshSelected(){
  const result=await api(projectURL());adoptProject(result.project);
  if(S.edition)await loadEdition(S.edition.id,{renderAfter:false});
}
function createProjectDialog(){
  const input=h('input',{id:'new-project-name',required:true,maxlength:'160',placeholder:'e.g. London inventory migration',autocomplete:'off'});
  const form=h('form',{onSubmit:async event=>{
    event.preventDefault();const label=input.value.trim();if(!label){input.reportValidity();return;}
    closeDialog();await withBusy(async()=>{if(S.dirty)await saveDraft();const result=await post('/api/projects',{label,tenant_id:null});
      S.edition=null;S.result=null;S.preview=null;adoptProject(result.project,{keepDraft:false});S.tab='sources';announce('Project created.');});
  }},h('label',{for:'new-project-name'},'Project name',input),help('Choose the target tenant and upload the source CSVs inside the project.'));
  openDialog('Create a project',form,[button('Cancel',closeDialog),button('Create project',()=>form.requestSubmit(),{class:'primary'})]);
}
function renderSources(){
  const uploadInput=h('input',{id:'csv-upload',type:'file',accept:'.csv,text/csv',multiple:true,
    onChange:event=>{const files=[...event.target.files];return withBusy(()=>uploadFiles(files));}});
  const drop=h('div',{class:'file-drop',onDragover:event=>{event.preventDefault();event.currentTarget.classList.add('dragging');},
    onDragleave:event=>event.currentTarget.classList.remove('dragging'),onDrop:event=>{event.preventDefault();event.currentTarget.classList.remove('dragging');const files=[...event.dataTransfer.files];return withBusy(()=>uploadFiles(files));}},
    h('h3',{},'Add source CSV files'),h('p',{class:'muted'},'Drop files here or choose them from this computer.'),h('label',{for:'csv-upload',class:'sr-only'},'Source CSV files'),uploadInput,
    help('The original bytes and headers are retained with the project. Use Mapping to choose which objects each file describes.'));
  const tenantLabel=S.draft.tenant_id?(S.catalogLabels.get('tenants:'+S.draft.tenant_id)||'Tenant #'+S.draft.tenant_id):'Select a tenant';
  const settings=h('div',{class:'panel-body'},h('div',{class:'form-grid wide'},
    h('label',{},'Project name',h('input',{value:S.draft.label,maxlength:'160',onInput:event=>{S.draft.label=event.target.value;markDirty();}})),
    h('div',{},h('label',{},'Target tenant'),h('div',{class:'inline-fields'},h('input',{class:'readonly-input',value:tenantLabel,readOnly:true,'aria-label':'Selected tenant'}),
      button('Choose',()=>chooseCatalogue('tenants',item=>{S.draft.tenant_id=item?.id??null;markDirty();render();},{allowClear:true}),{disabled:S.busy>0}))),
    h('label',{class:'wide'},'Source notes',h('textarea',{rows:'3',value:S.draft.source_notes,placeholder:'Source owner, inventory date, scope and useful handover context.',
      onInput:event=>{S.draft.source_notes=event.target.value;markDirty();}}))),
    help('Choose the customer tenant before checking the mapping. Review resolves it against the actual NetBox catalogue.'));
  const rows=S.project.uploads.map(upload=>h('tr',{},
    h('td',{},h('strong',{},upload.name),h('div',{class:'help'},fmt(upload.headers.length)+' columns · '+size(upload.bytes))),
    h('td',{},fmt(upload.row_count)),h('td',{class:'mono'},short(upload.sha256)),
    h('td',{},h('div',{class:'toolbar'},button('Preview',()=>sourcePreview(upload),{class:'compact'}),
      button('Map',()=>addSourceDialog(upload),{class:'compact'}),
      button('Download',()=>download(projectURL('/uploads/'+encodeURIComponent(upload.id)+'/download'),upload.name),{class:'compact'})))));
  return [
    panel('Project settings',settings),
    panel('Retained source files',h('div',{class:'panel-body'},drop,S.project.uploads.length?
      h('div',{class:'table-wrap'},h('table',{},h('thead',{},h('tr',{},['File','Rows','Source hash','Actions'].map(label=>h('th',{scope:'col'},label)))),h('tbody',{},rows))):
      h('p',{class:'help'},'No source files have been added yet.')),
      button('Open mapping',()=>{S.tab='mapping';rememberSelection();render();},{disabled:!S.project.uploads.length})),
    panel('Continue a received migration',h('div',{class:'panel-body'},
      h('p',{},'Restore its original handover archive to bring its files, native operation and recorded result into this project.'),
      button('Restore handover archive',restoreDialog,{disabled:S.busy>0})))
  ];
}
async function uploadFiles(files){
  if(!files.length)return;
  await saveDraft();
  for(const file of files){
    const payload={name:file.name,size:file.size,last_modified:file.lastModified,expected_revision:S.project.revision};
    const request=intent(projectURL('/uploads'),payload),form=new FormData();
    form.set('request_id',request.id);form.set('expected_revision',String(S.project.revision));form.set('file',file,file.name);
    const result=await api(projectURL('/uploads'),{method:'POST',body:form});request.done();adoptProject(result.project,{keepDraft:false});
  }
  notice(fmt(files.length)+' source file'+(files.length===1?'':'s')+' retained.');render();
}
async function sourcePreview(upload,offset=0){
  const result=await api(projectURL('/uploads/'+encodeURIComponent(upload.id))+'?offset='+offset+'&limit=50');
  const columns=upload.headers,rows=result.rows??[];
  openDialog(upload.name,h('div',{},h('p',{class:'muted'},fmt(result.total)+' source rows · '+fmt(columns.length)+' columns'),
    h('div',{class:'table-wrap source-preview'},h('table',{},h('thead',{},h('tr',{},h('th',{scope:'col'},'Row'),columns.map(name=>h('th',{scope:'col'},name)))),
      h('tbody',{},rows.map((row,index)=>h('tr',{},h('td',{},fmt(offset+index+1)),columns.map((name,column)=>h('td',{class:'value'},row[name]??row[column]??''))))))),
    h('div',{class:'pager'},h('span',{class:'help'},rows.length?'Rows '+fmt(offset+1)+'–'+fmt(offset+rows.length):'No rows'),
      h('div',{class:'pagination-buttons'},button('Previous',()=>sourcePreview(upload,Math.max(0,offset-50)),{disabled:offset===0}),
        button('Next',()=>sourcePreview(upload,offset+50),{disabled:offset+rows.length>=result.total})))),
    [button('Close',closeDialog),button('Map this file',()=>{closeDialog();addSourceDialog(upload);},{class:'primary'})]);
}
function sourceForFile(file){return S.project.uploads.find(upload=>upload.file===file);}

function newMapping(kind,upload){
  const headers=upload.headers,exact=name=>headers.includes(name)?{column:name}:null;
  const definition={kind,file:upload.file,key:exact('source_key')??exact('key')??{column:''},fields:{},links:{},catalog:{},many:{}};
  if(exact('match_id'))definition.match_id=exact('match_id');
  for(const field of Object.keys(S.boot.schema.fields[kind]??{}))if(exact(field))definition.fields[field]=exact(field);
  for(const field of Object.keys(S.boot.schema.links[kind]??{})){
    if(exact(field+'_key'))definition.links[field]={...exact(field+'_key'),by:'key'};
    else if(exact(field+'_id'))definition.links[field]={...exact(field+'_id'),by:'id'};
  }
  for(const field of Object.keys(S.boot.schema.many?.[kind]??{})){
    if(exact(field+'_keys'))definition.many[field]={...exact(field+'_keys'),by:'key',separator:';'};
    else if(exact(field+'_ids'))definition.many[field]={...exact(field+'_ids'),by:'id',separator:';'};
  }
  for(const field of S.boot.schema.catalog[kind]??[])if(!definition.links[field]&&exact(field+'_id'))definition.catalog[field]=exact(field+'_id');
  if(kind==='ip_addresses'&&exact('primary'))definition.primary=exact('primary');
  return definition;
}
function addSourceDialog(preselected=null){
  if(!S.project.uploads.length){S.tab='sources';render();notice('Add a source CSV before creating a mapping.');return;}
  const file=h('select',{'aria-label':'Source file'},S.project.uploads.map(upload=>h('option',{value:upload.id,selected:upload.id===preselected?.id},upload.name)));
  const kind=h('select',{'aria-label':'Native object kind'},S.boot.schema.kinds.map(value=>h('option',{value},labels[value]??title(value))));
  openDialog('Map a source file',h('div',{class:'form-grid'},h('label',{},'Source CSV',file),h('label',{},'Native object kind',kind),
    help('A file can describe more than one object kind. Columns whose names exactly match native fields will be filled in for your review.')),
    [button('Cancel',closeDialog),button('Add mapping',()=>{const upload=S.project.uploads.find(item=>item.id===file.value);
      S.draft.mapping.sources.push(newMapping(kind.value,upload));S.sourceIndex=S.draft.mapping.sources.length-1;S.tab='mapping';markDirty();closeDialog();rememberSelection();render();},{class:'primary'})]);
}
async function restoreDialog(){
  const input=h('input',{type:'file',accept:'.zip,application/zip',required:true,'aria-label':'Handover archive'});
  const form=h('form',{onSubmit:async event=>{
    event.preventDefault();const file=input.files[0];if(!file)return;
    closeDialog();await withBusy(async()=>{await saveDraft();const payload={name:file.name,size:file.size,last_modified:file.lastModified,expected_revision:S.project.revision};
      const request=intent(projectURL('/restore'),payload),data=new FormData();data.set('request_id',request.id);data.set('expected_revision',String(S.project.revision));data.set('file',file,file.name);
      const result=await api(projectURL('/restore'),{method:'POST',body:data});request.done();adoptProject(result.project,{keepDraft:false});
      await loadEdition(result.edition.id,{renderAfter:false});S.tab='delivery';rememberSelection();notice('The original migration edition was restored.');});
  }},h('label',{},'Original handover ZIP',input),help('The received operation and its original receipt are retained. Start a corrected draft when you are ready to revise its mapping.'));
  openDialog('Restore a migration handover',form,[button('Cancel',closeDialog),button('Restore archive',()=>form.requestSubmit(),{class:'primary'})]);
}



function mappingFields(definition){
  const kind=definition.kind,links=S.boot.schema.links[kind]??{};
  const hints={mode:'Native interface mode: access, tagged, tagged-all, or blank. Changing mode can clear native VLAN memberships.',
    rd:'Use the native route distinguisher when selecting a VRF whose name is shared.',
    prefix:'IPv4 or IPv6 network. NetBox stores the canonical network prefix.',
    scope_site:'Assign the prefix to an imported site or an existing Site ID.',
    a_interface:'Choose one original Interface for the cable A end.',
    b_interface:'Choose one original Interface for the cable B end.'};
  return [
    {name:'key',group:null,type:'text',required:true,hint:'Stable key used to link rows within this migration.'},
    {name:'match_id',group:null,type:'int',hint:'Existing native ID for a rename, move or correction.'},
    ...Object.entries(S.boot.schema.fields[kind]??{}).map(([name,type])=>({name,group:'fields',type,required:(S.boot.schema.required_new[kind]??[]).includes(name),
      hint:hints[name]??((S.boot.schema.required_new[kind]??[]).includes(name)?'Required when creating this object.':'')})),
    ...Object.entries(links).filter(([name])=>!Object.hasOwn(definition.catalog??{},name)).map(([name,target])=>({name,group:'links',type:'link',target,
      hint:hints[name]??'Match another imported source key or an existing native ID.'})),
    ...Object.entries(S.boot.schema.many?.[kind]??{}).map(([name,target])=>({name,group:'many',type:'membership',target,
      hint:'Complete membership list. Separate source keys or native IDs with a semicolon; select Blank → clear to remove all memberships.'})),
    ...(S.boot.schema.catalog[kind]??[]).filter(name=>!Object.hasOwn(links,name)||Object.hasOwn(definition.catalog??{},name)).map(name=>({name,group:'catalog',type:'int',catalogue:catalogKinds[name],
      hint:'Select an existing item from the native catalogue, or map an ID column.'})),
    ...(kind==='ip_addresses'?[{name:'primary',group:null,type:'bool',hint:'Set this address as its assigned device’s primary address.'}]:[])
  ];
}
function expressionOf(definition,field){return field.group?definition[field.group]?.[field.name]:definition[field.name];}
function setExpression(definition,field,expression){
  const parent=field.group?(definition[field.group]??={}):definition;
  if(expression===null)delete parent[field.name];else parent[field.name]=expression;
  markDirty();
}
function renderMapping(){
  const sources=S.draft.mapping.sources;
  if(!sources.length)return panel('Map the source inventory',h('div',{class:'empty'},h('h2',{},'Choose what each source file describes'),
    h('p',{},'Map inventory, route targets, VRFs, VLANs, prefixes, interfaces, addresses and cable endpoints. Relationships and memberships can use source keys across your files.'),
    button(S.project.uploads.length?'Add a source mapping':'Add source files',()=>S.project.uploads.length?addSourceDialog():(S.tab='sources',render()),{class:'primary'})));
  S.sourceIndex=Math.max(0,Math.min(S.sourceIndex,sources.length-1));
  const definition=sources[S.sourceIndex],upload=sourceForFile(definition.file);
  return [
    h('div',{class:'toolbar spread'},h('p',{class:'muted'},fmt(sources.length)+' source mappings · edits are saved with the project'),
      h('div',{class:'toolbar'},button('Add mapping',()=>addSourceDialog(),{disabled:S.busy>0}),
        button('Check source mapping',()=>withBusy(checkPreview),{class:'primary',disabled:S.busy>0||S.conflict}))),
    h('div',{class:'mapping-layout'},
      h('nav',{class:'mapping-sources','aria-label':'Source mappings'},sources.map((source,index)=>button([
        h('strong',{},labels[source.kind]??source.kind),h('small',{},sourceForFile(source.file)?.name??source.file)],
        ()=>{S.sourceIndex=index;rememberSelection();render();},{class:'source-button'+(index===S.sourceIndex?' active':''),'aria-current':index===S.sourceIndex?'page':null}))),
      panel(labels[definition.kind]??title(definition.kind),
        h('div',{},h('div',{class:'panel-body mapping-head'},h('p',{},h('strong',{},upload?.name??definition.file)),
          help(upload?fmt(upload.row_count)+' source rows · '+fmt(upload.headers.length)+' columns':'This mapping needs a retained source file.'),
          h('div',{class:'toolbar'},upload&&button('Preview source rows',()=>sourcePreview(upload),{class:'compact'}),
            button('Change source file',()=>changeSourceFile(definition),{class:'compact'}),
            button('Remove mapping',()=>removeMapping(S.sourceIndex),{class:'compact danger'}))),
          h('div',{class:'table-wrap'},h('table',{class:'map-table'},h('thead',{},h('tr',{},
            h('th',{scope:'col'},'Native field'),h('th',{scope:'col'},'Source expression'),h('th',{scope:'col'},'Conversion'))),
            h('tbody',{},mappingFields(definition).map(field=>renderField(definition,field,upload)))))))),
    S.preview&&renderPreview()
  ];
}

function renderField(definition,field,upload){
  const expression=expressionOf(definition,field),mode=expression?Object.hasOwn(expression,'column')?'column':'value':'none';
  const multiple=field.group==='many',reference=multiple||field.group==='links';
  const modeSelect=h('select',{'aria-label':title(field.name)+' source mode',onChange:event=>{
    const next=event.target.value;
    const value=next==='none'?null:next==='column'?{column:''}:{value:field.type==='bool'?false:multiple?[]:''};
    if(value&&reference)value.by=expression?.by??'key';
    if(value&&multiple)value.separator=expression?.separator??';';
    setExpression(definition,field,value);render();
  }},[['none','Not mapped'],['column','CSV column'],['value','Fixed value']].map(([value,label])=>h('option',{value,selected:value===mode},label)));
  let control=null;
  if(mode==='column')control=h('select',{'aria-label':title(field.name)+' CSV column',onChange:event=>{expression.column=event.target.value;markDirty();}},
    h('option',{value:'',selected:!expression.column},'Choose a column'),
    (upload?.headers??[]).map(column=>h('option',{value:column,selected:column===expression.column},column)),
    expression.column&&!upload?.headers.includes(expression.column)&&h('option',{value:expression.column,selected:true},expression.column+' (missing from file)'));
  if(mode==='value')control=field.type==='bool'?h('select',{'aria-label':title(field.name)+' fixed value',onChange:event=>{expression.value=event.target.value==='true';markDirty();}},
    h('option',{value:'false',selected:expression.value===false||String(expression.value)==='false'},'No / false'),
    h('option',{value:'true',selected:expression.value===true||String(expression.value)==='true'},'Yes / true')):
    h('input',{value:expression.value===null?'':Array.isArray(expression.value)?expression.value.join(expression.separator??';'):String(expression.value??''),
      'aria-label':title(field.name)+' fixed value',placeholder:multiple?(expression.by==='id'?'12;34':'source-key-a;source-key-b'):null,
      inputmode:field.type==='int'||field.type==='decimal'?'decimal':'text',
      onInput:event=>{expression.value=multiple&&event.target.value===''?[]:event.target.value;markDirty();}});
  const controls=[modeSelect,control];
  if(expression&&reference)controls.push(h('select',{'aria-label':title(field.name)+' reference type',onChange:event=>{expression.by=event.target.value;markDirty();render();}},
    h('option',{value:'key',selected:expression.by!=='id'},'By imported source key'),h('option',{value:'id',selected:expression.by==='id'},'By existing native ID')));
  const catalogue=field.catalogue??(reference&&expression?.by==='id'?field.target:null);
  if(mode==='value'&&catalogue)controls.push(button(multiple?'Add from NetBox':'Choose from NetBox',()=>chooseCatalogue(catalogue,item=>{
    if(multiple){
      const values=Array.isArray(expression.value)?expression.value:expression.value===null||expression.value===''?[]:String(expression.value).split(expression.separator??';').map(value=>value.trim());
      if(!values.some(value=>String(value)===String(item.id)))values.push(item.id);
      expression.value=values;
    }else expression.value=item.id;
    markDirty();render();
  }),{class:'compact','aria-label':(multiple?'Add ':'Choose ')+title(field.name)+' from NetBox'}));
  const selectedLabel=mode==='value'&&catalogue&&!multiple?S.catalogLabels.get(catalogue+':'+expression.value):null;
  return h('tr',{},h('td',{},h('span',{class:'field-label'},title(field.name),field.required&&h('span',{'aria-label':'Required for new objects'},' *')),
    field.hint&&h('p',{class:'field-hint'},field.hint)),
    h('td',{},h('div',{class:'mapping-control'},controls),selectedLabel&&help(selectedLabel)),
    h('td',{},h('div',{class:'field-hint'},field.type==='link'?'Relationship':multiple?'Complete membership list':title(field.type)),
      expression&&button(expressionSummary(expression),()=>expressionOptions(definition,field),{class:'compact','aria-label':title(field.name)+' conversion options'})));
}
function expressionSummary(expression){
  const labels=[];if(expression.blank==='null')labels.push('Blank → clear');else if(expression.blank==='empty')labels.push('Blank → empty');
  if(expression.trim===false)labels.push('Keep spaces');if(expression.lower)labels.push('Lowercase');
  if(expression.separator)labels.push('Separator '+expression.separator);
  if(expression.values&&Object.keys(expression.values).length)labels.push(fmt(Object.keys(expression.values).length)+' value rules');
  return labels.length?labels.join(' · '):'Options';
}
async function removeMapping(index){
  const source=S.draft.mapping.sources[index];
  if(!await confirmAction('Remove this mapping',h('p',{},'Remove the '+(labels[source.kind]??source.kind)+' mapping for '+(sourceForFile(source.file)?.name??source.file)+'? Its source CSV remains available.'),'Remove mapping'))return;
  S.draft.mapping.sources.splice(index,1);S.sourceIndex=Math.max(0,index-1);markDirty();render();
}
function changeSourceFile(definition){
  const select=h('select',{'aria-label':'Replacement source file'},S.project.uploads.map(upload=>h('option',{value:upload.file,selected:upload.file===definition.file},upload.name)));
  openDialog('Change the source file',h('div',{},h('label',{},'Retained CSV',select),
    help('The current column expressions will be preserved. Source checks identify columns missing from the selected file.')),
    [button('Cancel',closeDialog),button('Use this file',()=>{definition.file=select.value;markDirty();closeDialog();render();},{class:'primary'})]);
}



function expressionOptions(definition,field){
  const original=expressionOf(definition,field);if(!original)return;
  const expression=clone(original),multiple=field.group==='many';
  const blank=h('select',{'aria-label':'Blank value behavior'},[['omit','Leave unchanged / omit'],['null',multiple?'Clear every membership':'Clear with null'],['empty','Keep an empty text value']].map(([value,label])=>h('option',{value,selected:(expression.blank??'omit')===value},label)));
  const trim=h('input',{type:'checkbox',checked:expression.trim!==false,'aria-label':'Trim surrounding spaces'});
  const lower=h('input',{type:'checkbox',checked:expression.lower===true,'aria-label':'Convert text to lowercase'});
  const separator=multiple?h('input',{value:expression.separator??';',maxlength:1,'aria-label':'Membership separator'}):null;
  const pairs=Object.entries(expression.values??{}).map(([key,value])=>({key,type:value===null?'null':Array.isArray(value)?'array':typeof value,
    value:value===null?'':Array.isArray(value)?JSON.stringify(value):String(value)}));
  const rows=h('div',{class:'value-map'});
  const types=[['string','Text'],['number','Number'],['boolean','Boolean'],['null','Null'],...(multiple?[['array','JSON list']]:[])];
  const renderPairs=()=>rows.replaceChildren(...pairs.map((pair,index)=>h('div',{class:'pair'},
    h('input',{value:pair.key,placeholder:'Source value','aria-label':'Source value '+(index+1),onInput:event=>pair.key=event.target.value}),
    h('select',{'aria-label':'Replacement type '+(index+1),onChange:event=>{pair.type=event.target.value;renderPairs();}},
      types.map(([value,label])=>h('option',{value,selected:pair.type===value},label))),
    pair.type==='boolean'?h('select',{'aria-label':'Replacement value '+(index+1),onChange:event=>pair.value=event.target.value},
      h('option',{value:'false',selected:pair.value!=='true'},'false'),h('option',{value:'true',selected:pair.value==='true'},'true')):
      h('input',{value:pair.value,disabled:pair.type==='null',placeholder:pair.type==='array'?'["key-a","key-b"]':'Replacement value','aria-label':'Replacement value '+(index+1),onInput:event=>pair.value=event.target.value}),
    button('Remove',()=>{pairs.splice(index,1);renderPairs();},{class:'compact','aria-label':'Remove value rule '+(index+1)}))));
  renderPairs();
  openDialog(title(field.name)+' conversion',h('div',{},h('div',{class:'advanced-grid'},
    h('label',{},'When the source is blank',blank),
    multiple&&h('label',{},'One-character membership separator',separator),
    h('div',{class:'rule-options'},h('label',{class:'check'},trim,'Trim surrounding spaces'),h('label',{class:'check'},lower,'Convert text to lowercase'))),
    h('div',{class:'spacer'}),h('h3',{},'Explicit value replacements'),help('Translate source values into the values expected by NetBox. For example: In service → active. Blank handling is applied before these replacements.'),
    multiple&&help('A JSON list preserves each source key or native ID. An empty list clears all memberships.'),
    rows,button('Add value rule',()=>{pairs.push({key:'',type:'string',value:''});renderPairs();},{class:'compact'})),
    [button('Cancel',closeDialog),button('Apply options',()=>{
      const values=[];const used=new Set();
      for(const pair of pairs){
        if(used.has(pair.key))throw new Error('Each source value can have only one replacement.');used.add(pair.key);
        let value=pair.value;
        if(pair.type==='number'){if(pair.value.trim()===''||!Number.isFinite(Number(pair.value)))throw new Error('Enter a finite number for each numeric replacement.');value=Number(pair.value);}
        else if(pair.type==='boolean')value=pair.value==='true';
        else if(pair.type==='null')value=null;
        else if(pair.type==='array'){try{value=JSON.parse(pair.value);}catch{throw new Error('Enter a valid JSON list for each list replacement.');}if(!Array.isArray(value))throw new Error('A membership replacement must be a JSON list.');}
        values.push([pair.key,value]);
      }
      if(multiple){if(separator.value.length!==1||separator.value.charCodeAt(0)<32)throw new Error('Choose one printable membership separator.');expression.separator=separator.value;}
      expression.blank=blank.value;expression.trim=trim.checked;expression.lower=lower.checked;
      if(values.length)expression.values=Object.fromEntries(values);else delete expression.values;
      setExpression(definition,field,expression);closeDialog();render();
    },{class:'primary'})]);
}
async function chooseCatalogue(kind,onSelect,{allowClear=false}={}){
  let items=[],page=0,sequence=0,observed='';
  const query=h('input',{type:'search',placeholder:'Search the native catalogue','aria-label':'Catalogue search'});
  const results=h('div',{class:'catalogue-results','aria-live':'polite'});
  const status=h('p',{class:'help'});
  const pagination=h('div',{class:'pager'});
  const draw=()=>{
    const visible=items.slice(page*50,(page+1)*50);
    results.replaceChildren(...(visible.length?visible.map(item=>button([
      h('span',{},h('strong',{},item.label??item.record?.display??item.record?.name??'#'+item.id),
        h('small',{},catalogueContext(item.record))),h('code',{},'#'+item.id)],
      async()=>{S.catalogLabels.set(kind+':'+item.id,item.label??item.record?.display??'#'+item.id);closeDialog();await onSelect(item);},
      {class:'catalogue-choice','aria-label':'Select '+(item.label??item.record?.display??item.id)})):
      [h('p',{class:'empty'},'No catalogue items matched this search.')]));
    status.textContent=fmt(items.length)+' native catalogue items'+(observed?' · refreshed '+date(observed):'');
    pagination.replaceChildren(h('span',{class:'help'},visible.length?'Items '+fmt(page*50+1)+'–'+fmt(page*50+visible.length):''),
      h('div',{class:'pagination-buttons'},button('Previous',()=>{page--;draw();},{disabled:page===0}),
        button('Next',()=>{page++;draw();},{disabled:(page+1)*50>=items.length})));
  };
  const search=async()=>{
    const current=++sequence;const params=new URLSearchParams({kind,q:query.value.trim()});
    results.replaceChildren(h('p',{class:'loading'},'Reading the native catalogue…'));
    try{const result=await api('/api/catalogue?'+params.toString());if(current!==sequence||!$('#dialog').open)return;
      items=result.items??[];observed=result.observed_at;page=0;draw();}
    catch(error){if(current===sequence)results.replaceChildren(h('p',{class:'error'},error.message));}
  };
  const form=h('form',{class:'inline-fields',onSubmit:event=>{event.preventDefault();return search();}},query,h('button',{type:'submit'},'Search'));
  openDialog('Choose '+(kind==='tenants'?'a tenant':kind==='device_types'?'a device type':title(kind)),h('div',{},form,status,results,pagination),
    [allowClear&&button('Clear tenant selection',async()=>{closeDialog();await onSelect(null);}),button('Close',closeDialog)].filter(Boolean));
  await search();
}
function catalogueContext(record){
  if(!record)return'';
  const relation=value=>typeof value==='object'&&value?(value.display??value.name??value.model??'#'+value.id):value;
  return [record.manufacturer&&relation(record.manufacturer),record.model,record.site&&relation(record.site),record.device&&relation(record.device),
    record.tenant&&relation(record.tenant),record.vrf&&relation(record.vrf),record.group&&relation(record.group),record.vid&&'VLAN '+record.vid,
    record.rd,record.prefix,record.scope&&relation(record.scope),record.label,record.slug].filter(Boolean).join(' · ');
}
async function checkPreview(){
  if(!Number.isInteger(S.draft.tenant_id)||S.draft.tenant_id<=0){S.tab='sources';render();throw new Error('Choose the customer tenant in Project settings before checking the source mapping.');}
  await saveDraft();
  const result=await post(projectURL('/preview'),{expected_revision:S.project.revision});
  adoptProject(result.project,{keepDraft:false});S.preview=result.preview;
  announce(result.preview.ready?'Source mapping is ready to prepare.':fmt(result.preview.errors?.length)+' source issues need attention.');
}
function renderPreview(){
  const preview=S.preview,counts=preview.counts??{};
  return panel('Source mapping check',h('div',{},
    h('div',{class:'panel-body'},h('div',{class:'toolbar spread'},h('div',{},badge(preview.ready?'READY TO PREPARE':'SOURCE ISSUES'),
      h('p',{class:'help'},fmt(preview.row_count)+' compiled objects · project revision '+preview.revision)),
      button('Prepare native edition',()=>withBusy(prepareEdition),{class:'primary',disabled:!preview.ready||S.busy>0||S.dirty})),
      Object.keys(counts).length>0&&h('div',{class:'metrics'},Object.entries(counts).map(([kind,count])=>h('div',{class:'metric'},
        h('span',{},labels[kind]??title(kind)),h('strong',{},typeof count==='object'?JSON.stringify(count):fmt(count)))))),
    preview.errors?.length>0&&h('ul',{class:'error-list'},preview.errors.map(error=>h('li',{},
      h('strong',{},[error.source??(error.source_mapping?'Mapping '+error.source_mapping:'Source mapping'),error.kind&&labels[error.kind],error.row&&'row '+error.row].filter(Boolean).join(' · ')),
      h('p',{},error.error??error.message??JSON.stringify(error))))),
    preview.rows?.length>0&&h('details',{class:'native-meta'},h('summary',{},'Inspect compiled source objects ('+Math.min(preview.rows.length,100)+')'),
      help('These are the compiled source objects. Native review resolves them against the current NetBox inventory.'),
      h('pre',{class:'native-json'},JSON.stringify(preview.rows,null,2)))),
    null,'Preparing freezes this saved mapping and its exact source files as one native migration edition.');
}
async function prepareEdition(){
  if(!S.preview?.ready||S.dirty)throw new Error('Run the source mapping check on the saved mapping before preparing an edition.');
  const result=await post(projectURL('/prepare'),{expected_revision:S.project.revision,preview_sha256:S.preview.sha256});
  adoptProject(result.project,{keepDraft:false});await loadEdition(result.edition.id,{renderAfter:false});
  S.tab='review';S.preview=null;rememberSelection();notice('Native edition prepared. Review its current NetBox changes before applying.');
}


async function loadEdition(id,{renderAfter=true}={}){
  const result=await api(projectURL('/editions/'+encodeURIComponent(id)));
  adoptProject(result.project);S.edition=result.edition;S.result=result.result??null;S.network=result.network??null;S.corrections=result.corrections??null;
  S.changePage=0;S.networkPage=0;rememberSelection();
  const active=(result.actions??[]).find(action=>action.id===result.edition.active_action_id&&action.state!=='COMPLETE');
  if(active&&(!S.activeAction||S.activeAction.id!==active.id)){
    S.activeAction=active;retainAction();
    if(['QUEUED','RUNNING'].includes(active.state)){clearTimeout(S.pollTimer);S.pollTimer=setTimeout(()=>pollAction(active.id).catch(reportError),1500);}
  }
  if(renderAfter)render();
}
function selectedEditionControl(){
  if(!S.project.editions.length)return null;
  return h('div',{class:'toolbar spread'},h('label',{},'Migration edition',
    h('select',{'aria-label':'Migration edition',onChange:event=>withBusy(()=>loadEdition(event.target.value))},
      [...S.project.editions].reverse().map((edition,index)=>h('option',{value:edition.id,selected:edition.id===S.edition?.id},
        'Edition '+(S.project.editions.length-index)+' · '+String(edition.state??'PREPARED').replaceAll('_',' ')+' · '+short(edition.operation_id))))),
    S.edition&&h('p',{class:'help'},'Frozen from project revision '+S.edition.project_revision));
}
function metrics(counts={}){
  return h('div',{class:'metrics'},[['CREATE','Create'],['UPDATE','Update'],['KEEP','Keep']].map(([key,label])=>
    h('div',{class:'metric'},h('span',{},label),h('strong',{},fmt(counts[key])))),
    h('div',{class:'metric'},h('span',{},'Reviewed entries'),h('strong',{},fmt(Object.values(counts).reduce((sum,value)=>sum+(Number(value)||0),0)))));
}
function actionRunning(){return S.activeAction&&['QUEUED','RUNNING','CONNECTION_INTERRUPTED'].includes(S.activeAction.state);}

const networkColumns={
  route_targets:['name','description'],
  vrfs:['name','rd','enforce_unique','import_targets','export_targets'],
  vlans:['name','vid','status','site','group','ipam_role'],
  prefixes:['prefix','vrf','vlan','scope_site','status','is_pool','mark_utilized'],
  interfaces:['device','name','type','mode','vrf','untagged_vlan','tagged_vlans','cable'],
  ip_addresses:['address','vrf','interface','status','dns_name'],
  cables:['label','a_interface','b_interface','type','status','length','length_unit']
};
function networkValue(value){
  if(value===null||value===undefined)return '—';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(Array.isArray(value))return value.length?value.map(networkValue).join('; '):'None';
  if(typeof value==='object'){
    if(value.kind&&Object.hasOwn(value,'key'))return (singular[value.kind]??value.kind)+' / '+value.key;
    if(value.model&&Object.hasOwn(value,'id'))return value.model+' #'+value.id;
    return JSON.stringify(value);
  }
  return String(value);
}
function renderNetwork(){
  const network=S.network;
  if(!network||network.operation_id!==S.result?.operation_id)return null;
  const families=Object.keys(network.objects??{}),available=families.filter(kind=>network.objects[kind].length);
  if(!families.includes(S.networkKind)||(!network.objects[S.networkKind]?.length&&available.length))S.networkKind=available[0]??families[0];
  const redraw=()=>$('#network-results')?.replaceChildren(...renderNetworkRows());
  return panel('Network commissioning',h('div',{},
    h('div',{class:'panel-body'},
      h('p',{},'Review the routing, VLAN, addressing and physical connections produced by this native edition.'),
      h('p',{class:'help'},network.prefix_membership),
      h('div',{class:'toolbar'},
        h('select',{'aria-label':'Network object family',onChange:event=>{S.networkKind=event.target.value;S.networkPage=0;redraw();}},
          families.map(kind=>h('option',{value:kind,selected:kind===S.networkKind},(labels[kind]??title(kind))+' · '+fmt(network.counts[kind])))),
        h('input',{class:'search',type:'search',value:S.networkQuery,placeholder:'Find a network, interface, VLAN or endpoint','aria-label':'Search network commissioning',
          onInput:event=>{S.networkQuery=event.target.value;S.networkPage=0;redraw();}}))),
    h('div',{id:'network-results'},renderNetworkRows())));
}
function renderNetworkRows(){
  const network=S.network,kind=S.networkKind,needle=S.networkQuery.trim().toLowerCase();
  if(!network)return [];
  const selected=(network.objects[kind]??[]).filter(row=>!needle||JSON.stringify(row).toLowerCase().includes(needle));
  const limit=25,maxPage=Math.max(0,Math.ceil(selected.length/limit)-1);S.networkPage=Math.min(S.networkPage,maxPage);
  const start=S.networkPage*limit,rows=selected.slice(start,start+limit),columns=networkColumns[kind]??[];
  const groups=new Map((network.prefix_groups??[]).map(group=>[group.id,group]));
  const prefixCell=row=>{
    const group=groups.get(row.selected_prefix_group??row.prefix_group);
    if(!group)return h('span',{class:'muted'},kind==='ip_addresses'?'No selected prefix':'—');
    return h('span',{},h('strong',{},group.prefix),
      h('span',{class:'secondary-text'},group.vrf===null?'Global routing table':networkValue(group.vrf)),
      kind==='prefixes'&&h('span',{class:'secondary-text'},group.address_count+' addresses'));
  };
  const objectCell=row=>{
    const url=safeNativeURL(row.native_url);
    const provenance=row.source&&typeof row.source==='object'?row.source:null;
    return h('td',{},h('strong',{},row.key),
      row.native_id&&h('span',{class:'secondary-text'},url?h('a',{href:url,target:'_blank',rel:'noopener noreferrer'},'#'+row.native_id):'#'+row.native_id),
      provenance&&h('details',{class:'native-meta'},h('summary',{},'Source row '+(provenance.data_row??provenance.row??'—')),h('pre',{},JSON.stringify(provenance,null,2))),
      h('details',{class:'native-meta'},h('summary',{},'Complete native change'),h('h4',{},'Before'),h('pre',{},JSON.stringify(row.before,null,2)),
        h('h4',{},'After'),h('pre',{},JSON.stringify(row.after,null,2))));
  };
  const membership=['prefixes','ip_addresses'].includes(kind),nativeEffects=kind==='native_effects';
  const headings=['Source object','Change',...columns.map(title),...(membership?['Selected prefix']:[]),...(nativeEffects?['Native effect']:[])];
  const redraw=()=>$('#network-results')?.replaceChildren(...renderNetworkRows());
  return [
    h('div',{class:'table-wrap'},h('table',{class:'network-table'},h('thead',{},h('tr',{},headings.map(label=>h('th',{scope:'col'},label)))),
      h('tbody',{},rows.length?rows.map(row=>h('tr',{},objectCell(row),h('td',{},badge(row.action)),
        columns.map(field=>h('td',{},field==='vrf'&&row.after?.[field]===null?'Global routing table':networkValue(row.after?.[field]))),
        membership&&h('td',{},prefixCell(row)),
        nativeEffects&&h('td',{},labels[row.kind]??title(row.kind),h('span',{class:'secondary-text'},String(row.source??''))))):
        h('tr',{},h('td',{colspan:headings.length,class:'empty'},'No network objects match these filters.'))))),
    h('div',{class:'panel-body pager'},h('span',{class:'help'},rows.length?'Objects '+fmt(start+1)+'–'+fmt(start+rows.length)+' of '+fmt(selected.length):'0 objects'),
      h('div',{class:'pagination-buttons'},button('Previous',()=>{S.networkPage--;redraw();},{disabled:S.networkPage===0}),
        button('Next',()=>{S.networkPage++;redraw();},{disabled:S.networkPage>=maxPage}))),
    h('div',{class:'panel-body'},help('Build the report or handover in Delivery to download the complete network report, CSV and JSON.'))
  ];
}

function renderReview(){
  if(!S.edition)return panel('Prepare a native edition',h('div',{class:'empty'},h('h2',{},'Start with a checked source mapping'),
    h('p',{},'Save and check the mapping, then prepare an edition for native review.'),
    button('Open mapping',()=>{S.tab='mapping';render();},{class:'primary'})));
  const result=S.result,reviewed=Boolean(result?.review_digest),applied=result?.state==='APPLIED'||S.edition.state==='APPLIED';
  const controls=h('div',{class:'toolbar'},
    button(reviewed?'Refresh native review':'Review against NetBox',()=>withBusy(()=>startAction('review',{refresh:reviewed})),{class:reviewed?'':'primary',disabled:S.busy>0||Boolean(actionRunning())}),
    button('Apply reviewed changes',applyReviewed,{class:'primary',disabled:!reviewed||applied||S.busy>0||Boolean(actionRunning())}),
    button('Recover native result',()=>withBusy(()=>startAction('recover')),{disabled:S.busy>0||Boolean(actionRunning())}));
  return [
    selectedEditionControl(),
    panel('Native inventory changes',h('div',{class:'panel-body'},
      h('p',{},applied?'This edition has an applied native receipt. Its original object IDs and journal are retained.':
        reviewed?'Review the changes below. Apply uses this exact native review and the saved operation.':
        'Read the current NetBox inventory and catalogue to produce the changes for this frozen edition.'),
      controls,
      result&&h('div',{class:'spacer'}),
      result&&metrics(result.counts??S.edition.counts??{}),
      result&&h('div',{class:'detail-list'},h('dt',{},'Target tenant'),h('dd',{},result.tenant?.name??'No tenant selected'),
        h('dt',{},'NetBox'),h('dd',{},result.netbox_version??'—'),
        h('dt',{},'Result'),h('dd',{},badge(result.state??S.edition.state))))),
    result&&renderNetwork(),
    result&&panel('Object changes',h('div',{},changeFilters(),h('div',{id:'change-results'},renderChangeResults()))),
    result?.generated_components?.length>0&&panel('Device template components',h('div',{},result.generated_components.map(device=>
      h('details',{class:'component-card'},h('summary',{},device.device_key+' · '+Object.entries(device.component_counts??{}).map(([name,count])=>fmt(count)+' '+name.replaceAll('_',' ')).join(' · ')),
        h('pre',{},JSON.stringify(device.components,null,2))))),null,'These native template components are included in the review used for apply.'),
    result?.catalogue?.length>0&&panel('Native catalogue resolution',h('details',{class:'panel-body'},h('summary',{},'Inspect resolved catalogue and template values'),
      h('pre',{class:'native-json'},JSON.stringify(result.catalogue,null,2)))),
    panel('Edition and recovery',h('div',{class:'panel-body'},
      h('div',{class:'detail-list'},h('dt',{},'Operation'),h('dd',{},h('code',{},S.edition.operation_id)),
        h('dt',{},'Edition'),h('dd',{},h('code',{},S.edition.id)),
        h('dt',{},'Review'),h('dd',{},h('code',{},result?.review_digest??S.edition.review_digest??'Not reviewed')),
        h('dt',{},'Native journal'),h('dd',{},nativeJournal(result?.journal??S.edition.journal))),
      help('Recovery reads the original job and journal. It joins the same operation after a connection or host interruption.'),
      h('div',{class:'toolbar'},button('Start a corrected draft',startCorrectedDraft,{disabled:S.busy>0||Boolean(actionRunning())}),
        button('Open delivery',()=>{S.tab='delivery';rememberSelection();render();}))))
  ];
}
function nativeJournal(journal){
  if(!journal)return'No applied journal yet';
  const url=safeNativeURL(journal.url);return url?h('a',{href:url,target:'_blank',rel:'noopener noreferrer'},'Journal #'+journal.id):'#'+(journal.id??'—');
}
function safeNativeURL(value){
  if(!value)return null;
  try{const target=new URL(value,S.boot.connection.base_url),base=new URL(S.boot.connection.base_url);return['https:','http:'].includes(target.protocol)&&target.origin===base.origin?target.href:null;}catch{return null;}
}
function changeFilters(){
  const update=()=>{S.changePage=0;$('#change-results')?.replaceChildren(...renderChangeResults());};
  return h('div',{class:'panel-body toolbar'},
    h('input',{class:'search',type:'search',value:S.changeQuery,placeholder:'Find a key, name or native value','aria-label':'Search native changes',onInput:event=>{S.changeQuery=event.target.value;update();}}),
    h('select',{'aria-label':'Filter object kind',onChange:event=>{S.changeKind=event.target.value;update();}},
      h('option',{value:'',selected:!S.changeKind},'All object kinds'),[...new Set([...S.boot.schema.kinds,...(S.result?.changes??[]).map(change=>change.kind)])].map(kind=>h('option',{value:kind,selected:kind===S.changeKind},labels[kind]??kind))),
    h('select',{'aria-label':'Filter change type',onChange:event=>{S.changeAction=event.target.value;update();}},
      h('option',{value:'',selected:!S.changeAction},'All changes'),['CREATE','UPDATE','KEEP'].map(action=>h('option',{value:action,selected:action===S.changeAction},title(action.toLowerCase())))));
}
function fieldValues(value,other,{onlyChanged=false}={}){
  if(value===null||value===undefined)return h('span',{class:'muted'},'—');
  if(typeof value!=='object')return h('span',{class:'value'},String(value));
  const entries=Object.entries(value).filter(([key,item])=>!onlyChanged||stable(item)!==stable(other?.[key]));
  if(!entries.length)return h('span',{class:'muted'},'Unchanged');
  return h('dl',{class:'field-values'},entries.map(([key,item])=>[
    h('dt',{},title(key)),h('dd',{class:other&&stable(item)!==stable(other[key])?'changed-value':''},
      item===null?'null':typeof item==='object'?JSON.stringify(item):String(item))]));
}
function renderChangeResults(){
  const needle=S.changeQuery.toLowerCase().trim();
  const changes=(S.result?.changes??[]).filter(change=>(!S.changeKind||change.kind===S.changeKind)&&(!S.changeAction||change.action===S.changeAction)&&(!needle||JSON.stringify(change).toLowerCase().includes(needle)));
  const limit=25,maxPage=Math.max(0,Math.ceil(changes.length/limit)-1);S.changePage=Math.min(S.changePage,maxPage);
  const start=S.changePage*limit,rows=changes.slice(start,start+limit);
  const redraw=()=>$('#change-results')?.replaceChildren(...renderChangeResults());
  return [
    h('div',{class:'table-wrap'},h('table',{class:'change-table'},h('thead',{},h('tr',{},['Object','Change','Current inventory','Reviewed result'].map(label=>h('th',{scope:'col'},label)))),
      h('tbody',{},rows.length?rows.map(change=>h('tr',{},h('td',{},h('strong',{},change.key),h('span',{class:'secondary-text'},singular[change.kind]??change.kind),
        (change.original_id??resolvedObjectId(change))&&h('code',{},'#'+(change.original_id??resolvedObjectId(change))),
        change.field&&h('span',{class:'secondary-text'},title(change.field)),change.device&&h('span',{class:'secondary-text'},'Device: '+(typeof change.device==='object'?change.device.name??change.device.key??change.device.id??JSON.stringify(change.device):change.device))),h('td',{},badge(change.action)),
        h('td',{},fieldValues(change.before,change.after,{onlyChanged:change.action==='UPDATE'})),
        h('td',{},fieldValues(change.after,change.before,{onlyChanged:change.action==='UPDATE'})))):
        h('tr',{},h('td',{colspan:'4',class:'empty'},'No changes match these filters.'))))),
    h('div',{class:'panel-body pager'},h('span',{class:'help'},rows.length?'Objects '+fmt(start+1)+'–'+fmt(start+rows.length)+' of '+fmt(changes.length):'0 objects'),
      h('div',{class:'pagination-buttons'},button('Previous',()=>{S.changePage--;redraw();},{disabled:S.changePage===0}),
        button('Next',()=>{S.changePage++;redraw();},{disabled:S.changePage>=maxPage})))
  ];
}
async function applyReviewed(){
  const result=S.result;if(!result?.review_digest)throw new Error('Create a native review before applying changes.');
  const binding={review_digest:result.review_digest,expected_status_sha256:S.edition.status_sha256};
  if(!await confirmAction('Apply this native review',h('div',{},h('p',{},'Apply the reviewed inventory changes to '+S.boot.connection.base_url+'?'),
    metrics(result.counts),h('p',{class:'help'},'Tenant: '+(result.tenant?.name??'No tenant selected')+' · Operation '+S.edition.operation_id)),'Apply reviewed changes'))return;
  await withBusy(()=>startAction('apply',binding));
}
async function startCorrectedDraft(){
  if(S.dirty&&!await confirmAction('Start a corrected draft',h('p',{},'Replace the unsaved draft with this edition’s retained mapping and original CSVs?'),'Use this edition'))return;
  await withBusy(async()=>{
    const result=await post(editionURL('/draft'),{expected_revision:S.project.revision});
    adoptProject(result.project,{keepDraft:false});S.tab='mapping';S.sourceIndex=0;S.preview=null;rememberSelection();
    const warnings=result.source_draft?.warnings;
    notice('A corrected draft is ready to edit.',warnings?.length?warnings:null);
  });
}

function resolvedObjectId(change){return(S.result?.resolved??[]).find(row=>row.kind===change.kind&&row.key===change.key)?.id??null;}


function actionSelection(){
  return S.activeAction?{id:S.activeAction.id,project_id:S.activeAction.project_id,edition_id:S.activeAction.edition_id,
    kind:S.activeAction.kind,state:S.activeAction.state,payload:S.activeAction.payload??null,error:S.activeAction.error??null,related_action_id:S.activeAction.related_action_id??null}:null;
}
function retainAction(){setStorage(localStorage,pendingKey,['COMPLETE','FAILED','NOT_STARTED'].includes(S.activeAction?.state)?null:actionSelection());}
async function acceptActionResponse(response,{refreshEdition=true}={}){
  const previous=S.activeAction;
  S.activeAction={...response.action,payload:previous?.id===response.action.id?previous.payload:null};
  if(response.project?.id===S.project?.id){
    adoptProject(response.project);
    if(response.edition?.id===S.edition?.id)S.edition=response.edition;
    if(refreshEdition&&response.action.state==='COMPLETE'&&response.edition?.id===S.edition?.id)await loadEdition(S.edition.id,{renderAfter:false});
  }
  retainAction();render();
  if(['QUEUED','RUNNING'].includes(S.activeAction.state)){
    clearTimeout(S.pollTimer);S.pollTimer=setTimeout(()=>pollAction(S.activeAction.id).catch(reportError),1500);
  }else if(S.activeAction.state==='COMPLETE'){
    setStorage(localStorage,pendingKey,null);announce(title(S.activeAction.kind)+' completed.');
  }
}
async function startAction(kind,options={}){
  if(actionRunning())throw new Error('Join the saved action before starting another native action.');
  const payload={action:kind,expected_status_sha256:S.edition.status_sha256,...options};
  if(kind==='apply'&&!payload.review_digest)payload.review_digest=S.result?.review_digest??S.edition.review_digest;
  const path=editionURL('/actions'),request=intent(path,payload),body={...payload,request_id:request.id};
  S.activeAction={id:request.id,project_id:S.project.id,edition_id:S.edition.id,kind,state:'QUEUED',payload:body};
  retainAction();render();
  try{
    const response=await api(path,{method:'POST',body});request.done();await acceptActionResponse(response);
  }catch(error){
    S.activeAction.state='CONNECTION_INTERRUPTED';S.activeAction.error={message:error.message,code:error.code};retainAction();render();
    if(error.status&&error.status<500){
      try{await pollAction(request.id);}catch{}
      const rejected=['stale_native_status','review_digest_changed','active_action','review_required','review_digest','native_action','native_status','refresh'];
      if(S.activeAction?.id===request.id&&S.activeAction.absent&&rejected.includes(error.code)){
        S.activeAction.state='NOT_STARTED';S.activeAction.error={code:error.code,message:error.message,details:error.details};
        S.activeAction.related_action_id=error.details?.active_action_id??null;request.done();retainAction();
        await refreshSelected();render();
      }
    }
    throw error;
  }
}
async function pollAction(id){
  clearTimeout(S.pollTimer);
  let result;
  try{result=await api('/api/actions/'+encodeURIComponent(id));}
  catch(error){
    if(error.status===401){login(error.message);return;}
    const saved=savedStorage(localStorage,pendingKey);
    if(!S.activeAction||S.activeAction.id!==id)S.activeAction=saved?.id===id?saved:{id,state:'CONNECTION_INTERRUPTED'};
    S.activeAction.state='CONNECTION_INTERRUPTED';S.activeAction.error={message:error.message,code:error.code};
    if(error.status===404)S.activeAction.absent=true;
    retainAction();render();return;
  }
  await acceptActionResponse(result);
}
async function resumeAction(){
  const selected=S.activeAction??savedStorage(localStorage,pendingKey);if(!selected?.id)return;
  await withBusy(async()=>{
    let present;
    try{present=await api('/api/actions/'+encodeURIComponent(selected.id));}
    catch(error){
      if(error.status!==404)throw error;
      if(!selected.payload||!selected.project_id||!selected.edition_id)throw new Error('Reopen the original edition to inspect its native state before continuing.');
      const path='/api/projects/'+encodeURIComponent(selected.project_id)+'/editions/'+encodeURIComponent(selected.edition_id)+'/actions';
      const result=await api(path,{method:'POST',body:selected.payload});await acceptActionResponse(result);return;
    }
    await acceptActionResponse(present);
    if(['QUEUED','RUNNING','COMPLETE'].includes(present.action.state))return;
    const result=await api('/api/actions/'+encodeURIComponent(selected.id)+'/resume',{method:'POST',body:{request_id:selected.id}});
    await acceptActionResponse(result);
  });
}
function renderActionCard(){
  const action=S.activeAction,working=['QUEUED','RUNNING'].includes(action.state),complete=action.state==='COMPLETE',terminalFailure=['FAILED','NOT_STARTED'].includes(action.state);
  const labels={review:'Native review',apply:'Apply reviewed inventory',recover:'Recover native result','retry-current':'Continue original attempt',report:'Create delivery report',handover:'Build handover archive'};
  const same=action.project_id===S.project.id&&action.edition_id===S.edition?.id;
  return h('section',{class:'action-card','aria-label':'Saved migration action'},
    h('div',{class:'panel-header'},h('h2',{},labels[action.kind]??'Saved migration action'),badge(action.state)),
    h('div',{class:'action-body'},working&&h('div',{class:'progress-line','aria-hidden':'true'}),
      h('p',{},working?'The workspace is following this saved action. You can reopen this screen and join it.':
        complete?(action.result?.state&&!['REVIEWED','APPLIED','PREPARED','REPORTED','EXPORTED'].includes(action.result.state)?'The saved action returned '+String(action.result.state).replaceAll('_',' ')+'. Open the edition and recover its current native result.':'The saved action completed. Open the edition for its retained result and delivery files.'):
        terminalFailure?'This action ended before a native dispatch. Review the current edition and choose the corrected action.':'The original action is retained. Join it to inspect or continue the same attempt.'),
      action.error&&h('p',{class:'error'},typeof action.error==='string'?action.error:action.error.message??JSON.stringify(action.error)),
      h('div',{class:'toolbar'},
        !same&&action.project_id&&button('Open this edition',()=>withBusy(()=>openProject(action.project_id,{edition:action.edition_id}))),
        !working&&!complete&&!terminalFailure&&button('Join saved action',resumeAction,{class:'primary',disabled:S.busy>0}),
        working&&button('Refresh action',()=>pollAction(action.id),{disabled:S.busy>0}),
        terminalFailure&&action.related_action_id&&button('Join active edition action',()=>pollAction(action.related_action_id),{class:'primary',disabled:S.busy>0}),
        terminalFailure&&button('Refresh edition',()=>withBusy(refreshSelected),{disabled:S.busy>0}),
        (complete||terminalFailure)&&button('Dismiss',()=>{S.activeAction=null;setStorage(localStorage,pendingKey,null);render();},{class:'compact'})),
      h('details',{class:'native-meta'},h('summary',{},'Action reference'),h('code',{},action.id))));
}
function renderDelivery(){
  if(!S.edition)return panel('Delivery',h('div',{class:'empty'},h('h2',{},'Prepare a migration edition or restore a handover'),
    h('p',{},'Delivery keeps the native result, resolved object IDs and original source mapping together.'),
    h('div',{class:'toolbar'},button('Open mapping',()=>{S.tab='mapping';render();},{class:'primary'}),button('Restore handover',restoreDialog))));
  const result=S.result,ready=Boolean(result),applied=result?.state==='APPLIED'||S.edition.state==='APPLIED';
  const cards=[
    ['handover.zip','Complete handover','Original operation, source CSVs, mapping, native results and the portable workspace.'],
    ['report.html','Review and delivery report','Readable inventory changes and the recorded migration result.'],
    ['network.html','Network commissioning report','VRFs, VLANs, scoped prefixes, address assignments, cable endpoints and the original native effects.'],
    ['network.csv','Network commissioning table','Full before/after JSON and source row references for every selected network object and native cable effect.'],
    ['network.json','Network commissioning data','Typed objects and address-to-prefix groups within the explicitly reviewed VRF.'],
    ['result.json','Native result','The retained native review or applied receipt in its original JSON format.'],
    ['resolved.csv','Resolved object IDs','Native IDs and object URLs for the applied inventory.'],
    ['request.json','Frozen request','The exact source objects prepared for this migration edition.'],
    ['mapping.json','Source mapping','Column expressions and relationships used to prepare this edition.']
  ];
  return [
    selectedEditionControl(),
    panel('Migration delivery',h('div',{class:'panel-body'},h('p',{},applied?
      'This edition is applied. Build its handover and carry the complete migration into another workspace.':
      ready?'Build a handover from this reviewed edition. After apply, it also includes the native receipt and resolved object IDs.':'Review this edition against NetBox to make its report and handover available.'),
      h('div',{class:'toolbar'},
        button('Build handover',()=>withBusy(()=>startAction('handover')),{class:'primary',disabled:!ready||S.busy>0||Boolean(actionRunning())}),
        button('Create report',()=>withBusy(()=>startAction('report')),{disabled:!ready||S.busy>0||Boolean(actionRunning())}),
        button('Restore a handover',restoreDialog,{disabled:S.busy>0})),
      help('Create report and Build handover are retained local actions. Downloads use this workspace’s private authenticated connection.'))),
    h('section',{class:'downloads','aria-label':'Edition downloads'},cards.map(([file,heading,description])=>h('div',{class:'download-card'},
      h('h3',{},heading),h('p',{class:'muted'},description),
      button('Download '+file,()=>download(editionURL('/download/'+file),file),{
        disabled:S.busy>0||(file==='resolved.csv'&&!applied)||(['result.json','report.html','network.html','network.csv','network.json'].includes(file)&&!ready)})))),
    panel('Continue this inventory',h('div',{class:'panel-body'},
      h('p',{},'Start a corrected draft from this edition’s retained CSVs and mapping. Applied object IDs are carried into the draft so you can revise existing inventory.'),
      h('div',{class:'toolbar'},button('Start a corrected draft',startCorrectedDraft,{disabled:S.busy>0||Boolean(actionRunning())}),
        button('Open native review',()=>{S.tab='review';rememberSelection();render();})),
      S.corrections&&h('details',{class:'native-meta'},h('summary',{},'Correction details'),h('pre',{class:'native-json'},JSON.stringify(S.corrections,null,2))))),
    panel('Recorded result',h('div',{class:'panel-body'},h('div',{class:'detail-list'},
      h('dt',{},'State'),h('dd',{},badge(result?.state??S.edition.state)),
      h('dt',{},'Operation'),h('dd',{},h('code',{},S.edition.operation_id)),
      h('dt',{},'Native journal'),h('dd',{},nativeJournal(result?.journal??S.edition.journal)),
      h('dt',{},'Recorded'),h('dd',{},date(result?.recorded_at)),
      h('dt',{},'Receipt'),h('dd',{},h('code',{},result?.receipt_sha256??S.edition.receipt_sha256??'Available after apply')))))
  ];
}
async function download(path,fallback){
  const response=await api(path,{raw:true}),blob=await response.blob();
  const disposition=response.headers.get('Content-Disposition')??'';
  const match=disposition.match(/filename="([^"]+)"/),extended=disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  let selected=match?.[1]??fallback;
  if(extended){try{selected=decodeURIComponent(extended[1].trim().replace(/^"|"$/g,''));}catch{selected=fallback;}}
  const filename=selected.replace(/[\\/\u0000-\u001f]/g,'_');
  const url=URL.createObjectURL(blob),link=h('a',{href:url,download:filename});document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);announce(filename+' downloaded.');
}
window.addEventListener('beforeunload',event=>{if(S.dirty){event.preventDefault();event.returnValue='';}});
window.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&S.project){event.preventDefault();withBusy(saveDraft).catch(reportError);}
  if(event.key==='Escape'&&S.mobileOpen){S.mobileOpen=false;render();}
});
const fragment=new URLSearchParams(location.hash.slice(1)),access=fragment.get('token');
if(access){S.token=access;setStorage(sessionStorage,tokenKey,access);history.replaceState(null,'',location.pathname+location.search);}
else S.token=savedStorage(sessionStorage,tokenKey,'');
if(S.token)bootstrap().catch(reportError);else login();
