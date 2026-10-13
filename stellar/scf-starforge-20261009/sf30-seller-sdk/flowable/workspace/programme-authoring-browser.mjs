// MIT. Industrial authoring desk for complete Flowable source programmes.
import {createProgrammeDraft,validateProgrammeDraft,parseProgrammeDraft,serializeProgrammeDraft,programmeDraftCatalogue,
 addProgrammeDraftSources,renameProgrammeDraftSource,compileProgrammeDraft,refreshProgrammeCatalogueSources,programmeSourceSha256,programmeUtf8,PROGRAMME_DRAFT_LIMIT} from './programme-authoring.mjs';
import {openProgrammeDraftStore} from './programme-authoring-store.mjs';
export function installProgrammeAuthoring({root,node,button,busy,notice,table,pre,write,requireEngine,reload,openProgramme,workspaceId,decisionCompiler}){
 let draft=null,revision=0,version=0,savedVersion=0,store=null,scope=null,selectedPath='',preview=null;
 let saving=null,persistenceError=null,saveTimer=null;
 const status=node('p','Open a workspace to begin.',{class:'muted',role:'status','aria-live':'polite'});
 const shelf=node('div'),editor=node('div'),inventory=node('div'),familyPanel=node('div'),previewPanel=node('div');
 const controls=node('div',null,{class:'toolbar'}),fields=node('div',null,{class:'form-grid'});
 const formControls={},sourceControls={};
 function field(label,element,parent=fields){const wrap=node('label',label);wrap.append(element);parent.append(wrap);return element;}
 function input(key,label,max){
  const element=field(label,node('input',null,{maxlength:String(max)}));formControls[key]=element;
  element.addEventListener('input',()=>{draft[key]=element.value;changed();});return element;
 }
 function selectElement(values,value=''){
  const select=node('select');for(const[label,key]of values)select.append(node('option',label,{value:key}));
  select.value=value;return select;
 }
 function download(text,name,type='application/json'){
  const url=URL.createObjectURL(new Blob([text],{type})),link=node('a','Download',{href:url,download:name});
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function current(){if(!draft)throw new Error('Create or reopen a complete source draft.');return draft;}
 function updateStatus(message){
  status.textContent=message??(persistenceError?'Edits remain in this tab. '+persistenceError.message:
   version!==savedVersion?'Saving complete source draft…':'Complete source draft saved in this browser for this workspace.');
 }
 async function saveLoop(){
  if(!draft||!store||persistenceError||version===savedVersion)return;
  if(saving)return saving;
  saving=(async()=>{
   while(version!==savedVersion&&!persistenceError){
    const captured=version,selected=validateProgrammeDraft(draft),result=await store.save(selected,revision);
    revision=result.revision;savedVersion=captured;updateStatus();
   }
  })().catch(error=>{persistenceError=error;updateStatus();}).finally(()=>{saving=null;});
  return saving;
 }
 async function flush(){
  clearTimeout(saveTimer);saveTimer=null;await saveLoop();if(persistenceError)throw persistenceError;
  if(version!==savedVersion)throw new Error('Retain the complete draft before changing its saved edition.');
 }
 function changed(){
  if(store&&persistenceError?.code!=='PROGRAMME_DRAFT_CONFLICT')persistenceError=null;
  version++;preview=null;previewPanel.replaceChildren(node('p','Build a fresh preview after editing the source or configuration.',{class:'muted'}));
  updateStatus();clearTimeout(saveTimer);saveTimer=setTimeout(()=>{saveTimer=null;void saveLoop();},350);
 }
 function invalidateEditor(){preview=null;previewPanel.replaceChildren();}
 async function refreshShelf(){
  shelf.replaceChildren();if(!store)return;
  const rows=await store.list();table(shelf,[{label:'Source draft',key:'title'},{label:'Kind',key:'kind'},{label:'Updated',key:'updatedAt'},
   {label:'Open',render:row=>button('Reopen draft',async()=>{
    await flush();const found=await store.read(row.id);if(!found)throw new Error('The selected draft is no longer available.');
    draft=validateProgrammeDraft(found.draft);revision=found.revision;version=savedVersion=0;persistenceError=null;selectedPath='';invalidateEditor();renderEditor();updateStatus();
   })}],rows,{empty:'Create a draft or reopen a complete source-draft JSON.'});
 }
 function adopt(value,{newIdentity=false}={}){
  draft=validateProgrammeDraft(value);if(newIdentity)draft.id=crypto.randomUUID();
  revision=0;version=1;savedVersion=0;persistenceError=null;selectedPath='';invalidateEditor();renderEditor();updateStatus();
 }
 async function saveCopy(){
  current();if(saving)await saving;const copy=validateProgrammeDraft(draft);copy.id=crypto.randomUUID();
  adopt(copy);await flush();await refreshShelf();
 }
 async function loadExample(kind){
  const response=await fetch('./programme-'+kind+'.source-draft.json',{credentials:'same-origin'});
  if(!response.ok)throw new Error('The complete example source draft could not be opened ('+response.status+').');
  const value=parseProgrammeDraft(await response.text());if(draft)await flush();
  adopt(value,{newIdentity:true});await flush();await refreshShelf();
  notice('Original example sources loaded. Choose a distinct operation key and the actual native role identities before compiling.');
 }
 const newButton=button('New source programme',async()=>{
  if(draft)await flush();adopt(createProgrammeDraft(crypto.randomUUID()));await flush();await refreshShelf();
 });
 controls.append(newButton,button('Load process example',()=>loadExample('process')),button('Load case example',()=>loadExample('case')),button('Load decision example',()=>loadExample('decision')),button('Save a new copy',saveCopy),button('Reopen saved edition',async()=>{
  current();if(!store)throw new Error('Browser draft storage is unavailable. Download your current source draft.');
  if(saving)await saving;const found=await store.read(draft.id);if(!found)throw new Error('This draft has no saved edition. Save a new copy or download it.');
  if(version!==savedVersion&&!window.confirm('Replace the current unsaved edits with the complete saved edition? Download your current draft first if you need both.'))return;
  draft=validateProgrammeDraft(found.draft);revision=found.revision;version=savedVersion=0;persistenceError=null;selectedPath='';invalidateEditor();renderEditor();updateStatus();
 }),button('Download complete draft',()=>{
  download(serializeProgrammeDraft(current()),(draft.operation||draft.id)+'.source-draft.json');
 }),button('Refresh saved drafts',refreshShelf));
 const draftFile=field('Reopen complete source-draft JSON',node('input',null,{type:'file',accept:'.json,application/json'}),root);
 draftFile.addEventListener('change',()=>busy('Reopen complete source draft',async()=>{
  const file=draftFile.files[0];if(!file)return;
  if(file.size>PROGRAMME_DRAFT_LIMIT)throw new Error('The complete source draft must be at most 16 MiB.');
  const value=parseProgrammeDraft(await readSourceFile(file));if(draft)await flush();
  // A received file becomes a distinct local draft; it cannot overwrite a concurrent saved edition.
  adopt(value,{newIdentity:true});await flush();await refreshShelf();draftFile.value='';
 }));
 root.append(controls,status,shelf,editor);
 editor.append(node('h3','Programme configuration'),fields,familyPanel,node('h3','Complete source inventory'),inventory);
 input('title','Draft title',300);
 const kind=field('Programme kind',selectElement([['BPMN process','process'],['CMMN case','case'],['DMN decision','decision']]));
 formControls.kind=kind;kind.addEventListener('change',()=>{draft.kind=kind.value;draft.familyKeys=[];draft.migrateKeys=[];draft.delegationKey='';changed();renderFamilies();});
 input('operation','Stable operation key',80);input('tenantId','Native tenant ID (when applicable)',200);
 for(const role of ['operator','reviewer','specialist','approver']){
  const element=field(role[0].toUpperCase()+role.slice(1)+' identity',node('input',null,{maxlength:'200'}));formControls['role:'+role]=element;
  element.addEventListener('input',()=>{draft.roles[role]=element.value;changed();});
 }
 const catalogue=field('Original catalogue member',node('select'));formControls.catalogue=catalogue;
 catalogue.addEventListener('change',()=>{draft.catalogue=catalogue.value;changed();renderFamilies();});
 const sourceImport=node('div',null,{class:'panel'});editor.append(sourceImport);
 const prefix=field('Path prefix for selected files (optional)',node('input',null,{placeholder:'inputs'}),sourceImport);
 const files=field('Add complete UTF-8 source files',node('input',null,{type:'file',multiple:''}),sourceImport);
 const folder=field('Add a source folder',node('input',null,{type:'file',multiple:'',webkitdirectory:''}),sourceImport);
 const replaceWrap=node('label','Replace existing members at the same paths',{class:'checkbox-row'}),replace=node('input',null,{type:'checkbox'});
 replaceWrap.prepend(replace);sourceImport.append(replaceWrap,node('p','Folder intake removes only the selected outer folder. Nested paths remain intact. The catalogue references must match the inventory paths.',{class:'muted'}));
 async function readSourceFile(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  // Fatal decoding rejects damaged UTF-8; keeping the BOM preserves the selected original bytes.
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  const encoded=programmeUtf8(text);if(encoded.length!==bytes.length||encoded.some((value,index)=>value!==bytes[index]))throw new Error('The source could not be retained as exact UTF-8 text: '+file.name);
  return text;
 }
 async function importFiles(control,isFolder){
  current();const selected=[...control.files];if(!selected.length)return;
  if(selected.length>500||selected.reduce((sum,file)=>sum+file.size,0)>PROGRAMME_DRAFT_LIMIT)throw new Error('Select at most five hundred sources within the complete 16 MiB draft limit.');
  const incoming=[];
  for(const file of selected){
   let path=isFolder?file.webkitRelativePath.split('/').slice(1).join('/'):file.name;
   if(prefix.value.trim())path=prefix.value.trim().replace(/\/$/,'')+'/'+path;
   incoming.push({path,mediaType:/\.(?:json)$/i.test(path)?'application/json':/\.(?:xml|bpmn|cmmn|dmn)$/i.test(path)?'application/xml':'text/plain',text:await readSourceFile(file)});
  }
  draft=addProgrammeDraftSources(draft,incoming,{replace:replace.checked});selectedPath=incoming[0]?.path??selectedPath;changed();renderInventory();renderSource();renderFamilies();
  await flush();control.value='';replace.checked=false;await refreshShelf();
 }
 for(const[control,isFolder]of [[files,false],[folder,true]])control.addEventListener('change',()=>busy('Read complete source members',()=>importFiles(control,isFolder)));
 const sourceEditor=node('div',null,{class:'panel'});editor.append(sourceEditor);
 const sourcePath=field('Selected source path',node('input',null,{maxlength:'1000'}),sourceEditor);sourceControls.path=sourcePath;
 const sourceMedia=field('Media type',node('input',null,{maxlength:'200'}),sourceEditor);sourceControls.media=sourceMedia;
 const sourceIdentity=node('p','',{class:'muted source-identity'});sourceEditor.append(sourceIdentity);
 const sourceText=field('Complete original source text',node('textarea',null,{rows:'18',spellcheck:'false','aria-label':'Complete original source text'}),sourceEditor);sourceControls.text=sourceText;
 sourceText.addEventListener('input',()=>{const source=draft.files.find(file=>file.path===selectedPath);if(source){source.text=sourceText.value;sourceIdentity.textContent='Source edited; inspect its current identity before updating the catalogue.';changed();}});
 sourceText.addEventListener('blur',()=>{if(draft&&selectedPath===draft.catalogue)renderFamilies();});
 sourceMedia.addEventListener('input',()=>{const source=draft.files.find(file=>file.path===selectedPath);if(source){source.mediaType=sourceMedia.value;changed();}});
 sourceEditor.append(button('Inspect source identity',async()=>{
  const source=current().files.find(file=>file.path===selectedPath);if(!source)throw new Error('Select a source member.');
  const bytes=programmeUtf8(source.text);sourceIdentity.textContent=bytes.length+' UTF-8 bytes · SHA-256 '+await programmeSourceSha256(bytes);
 }),button('Apply source path',()=>{
  draft=renameProgrammeDraftSource(current(),selectedPath,sourcePath.value);selectedPath=sourcePath.value;changed();renderInventory();renderFamilies();renderSource();
 }),button('Download source member',()=>{
  const source=current().files.find(file=>file.path===selectedPath);if(!source)throw new Error('Select a source member.');
  download(source.text,source.path.split('/').at(-1),source.mediaType);
 }),button('Add empty source member',()=>{
  current();let n=1;while(draft.files.some(file=>file.path==='new-source-'+n+'.json'))n++;
  const path='new-source-'+n+'.json';draft=addProgrammeDraftSources(draft,[{path,mediaType:'application/json',text:''}]);selectedPath=path;changed();renderInventory();renderSource();renderFamilies();
 }),button('Remove selected source',()=>{
  current();if(!selectedPath)throw new Error('Select a source member.');
  draft.files=draft.files.filter(file=>file.path!==selectedPath);if(draft.catalogue===selectedPath)draft.catalogue='';
  for(const key of Object.keys(draft.inputs))if(draft.inputs[key]===selectedPath)delete draft.inputs[key];
  selectedPath='';changed();renderInventory();renderSource();renderFamilies();
 }));
 const compileToolbar=node('div',null,{class:'toolbar'});editor.append(compileToolbar,previewPanel);
 compileToolbar.append(button('Build complete programme preview',async()=>{
  current();await flush();const edition=version,result=await compileProgrammeDraft(draft,{decisionCompiler});
  if(edition!==version)throw new Error('The source changed during compilation. Build the current edition again.');
  preview={...result,version:edition};renderPreview();
 }),button('Download compiled programme',()=>{
  const value=currentPreview();download(value.programmeText,value.programme.key+'.programme.json');
 }),button('Save programme for native review',async()=>{
  const value=currentPreview(),connectionId=requireEngine();
  await flush();const result=await write('saveProgramme',{connectionId,programmeText:value.programmeText});
  await reload();await openProgramme(result.id);notice('The complete programme is saved for its original native operation reviews. Its editable source draft is retained.');
 }));
 function currentPreview(){current();if(!preview||preview.version!==version)throw new Error('Build a complete preview from the current source edition first.');return preview;}
 function renderInventory(){
  catalogue.replaceChildren(node('option','Select catalogue',{value:''}));
  for(const source of draft.files)catalogue.append(node('option',source.path,{value:source.path}));catalogue.value=draft.catalogue;
  table(inventory,[{label:'Member',key:'path'},{label:'Type',key:'mediaType'},
   {label:'Edit',render:source=>button('Open source',()=>{selectedPath=source.path;renderSource();})}],draft.files,{pageSize:15,empty:'Add the full catalogue, model editions and typed request sources.'});
 }
 function renderSource(){
  const source=draft.files.find(file=>file.path===selectedPath);
  sourceIdentity.textContent='';sourcePath.value=source?.path??'';sourceMedia.value=source?.mediaType??'';sourceText.value=source?.text??'';
  for(const control of [sourcePath,sourceMedia,sourceText])control.readOnly=!source;
 }
 function renderFamilies(){
  familyPanel.replaceChildren();if(!draft)return;
  const roleNames=draft.kind==='process'?['operator','reviewer']:draft.kind==='case'?['reviewer','specialist','approver']:[];
  for(const role of ['operator','reviewer','specialist','approver'])formControls['role:'+role].parentElement.hidden=!roleNames.includes(role);
  let catalogue;
  try{catalogue=programmeDraftCatalogue(draft);}catch(error){familyPanel.append(node('p',error.message,{class:'muted'}));return;}
  if(draft.kind==='case'){
   familyPanel.append(node('p','The complete case catalogue controls case families, scenarios and typed input members. Edit its original source to author a new course.',{class:'muted'}));return;
  }
  const families=catalogue.families.map(family=>({key:family.key??family.id,name:family.name??family.title??family.label??family.key??family.id}));
  familyPanel.append(node('h3','Selected families'));
  for(const family of families){
   if(typeof family.key!=='string')continue;
   const row=node('div',null,{class:'form-grid'}),choose=node('input',null,{type:'checkbox'});
   choose.checked=draft.familyKeys.includes(family.key);const label=node('label',String(family.name),{class:'checkbox-row'});label.prepend(choose);row.append(label);
   choose.addEventListener('change',()=>{
    draft.familyKeys=choose.checked?[...draft.familyKeys,family.key]:draft.familyKeys.filter(key=>key!==family.key);
    if(!choose.checked){draft.migrateKeys=draft.migrateKeys.filter(key=>key!==family.key);if(draft.delegationKey===family.key)draft.delegationKey='';}
    changed();renderFamilies();
   });
   if(draft.kind==='process'){
    const inputSelect=selectElement([['Select typed input source',''],...draft.files.map(file=>[file.path,file.path])],draft.inputs[family.key]??'');
    field('Typed input · '+family.name,inputSelect,row);inputSelect.addEventListener('change',()=>{draft.inputs[family.key]=inputSelect.value;changed();});
    const migrate=node('input',null,{type:'checkbox'});migrate.checked=draft.migrateKeys.includes(family.key);
    const migrateLabel=node('label','Migrate running work to source edition 2',{class:'checkbox-row'});migrateLabel.prepend(migrate);row.append(migrateLabel);
    migrate.addEventListener('change',()=>{
     if(migrate.checked&&!draft.familyKeys.includes(family.key)){migrate.checked=false;notice('Select this family before including its migration.');return;}
     draft.migrateKeys=migrate.checked?[...draft.migrateKeys,family.key]:draft.migrateKeys.filter(key=>key!==family.key);changed();
    });
   }
   familyPanel.append(row);
  }
  if(draft.kind==='process'){
   const select=selectElement([['First selected family',''],...families.filter(family=>draft.familyKeys.includes(family.key)).map(family=>[family.name,family.key])],draft.delegationKey);
   field('Family for human delegation',select,familyPanel);select.addEventListener('change',()=>{draft.delegationKey=select.value;changed();});
  }
  if(draft.kind==='decision')familyPanel.append(node('p','The original decision catalogue supplies the complete typed scenarios. Review the prepared native rule source and original result for each evaluation.',{class:'muted'}),
   button('Update catalogue model identities',async()=>{draft=await refreshProgrammeCatalogueSources(current());changed();renderSource();renderFamilies();await flush();notice('The catalogue now names the exact current model bytes. Review its typed cases and expected routes before compiling.');}));
 }
 function renderPreview(){
  const value=currentPreview();previewPanel.replaceChildren(node('h3',value.programme.label),
   node('p',value.programme.steps.length+' native steps · '+value.programme.sources.length+' complete sources · '+value.bytes+' bytes'),
   node('p','Complete programme SHA-256: '+value.sha256,{class:'muted source-identity'}));
  const rows=node('div');previewPanel.append(rows);
  table(rows,[{label:'Step',key:'key'},{label:'Operation',key:'label'},{label:'Kind',key:'kind'},
   {label:'Action',render:step=>step.selection.action},{label:'After',render:step=>(step.after??[]).join(', ')}],value.programme.steps,{pageSize:30});
  const complete=node('details');complete.append(node('summary','Complete operation selections and original source identities'),
   pre({...value.programme,sources:value.programme.sources.map(({contentBase64,...source})=>source)}));previewPanel.append(complete);
 }
 function renderEditor(){
  editor.hidden=!draft;if(!draft)return;
  for(const[key,element]of Object.entries(formControls))element.value=key.startsWith('role:')?(draft.roles[key.slice(5)]??''):(draft[key]??'');
  renderInventory();renderFamilies();renderSource();
 }
 async function render(){
  const next=workspaceId();if(!next){editor.hidden=true;return;}
  if(next!==scope){
   if(draft)await flush();store?.close();store=null;scope=null;
   try{store=await openProgrammeDraftStore(next);}catch(error){persistenceError=error;updateStatus();return;}
   scope=next;draft=null;revision=version=savedVersion=0;persistenceError=null;selectedPath='';invalidateEditor();renderEditor();
   updateStatus('Create or reopen a complete source draft. Drafts are kept for this workspace in this browser.');
  }
  try{await refreshShelf();}catch(error){persistenceError=error;updateStatus();}
 }
 window.addEventListener('beforeunload',event=>{if(draft&&version!==savedVersion){event.preventDefault();event.returnValue='';}});
 editor.hidden=true;
 return{render,flush};
}
