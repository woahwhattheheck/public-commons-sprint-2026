// MIT. Complete case/source export and receiving in the original Support desk.
const BASE='/api/case-packages';
const add=(parent,tag,text,className='')=>{
  const node=document.createElement(tag);if(text!==undefined)node.textContent=text;
  if(className)node.className=className;parent.append(node);return node;
};
const humanBytes=value=>{
  const n=Number(value);if(!Number.isFinite(n))return String(value??'');
  const units=['B','KiB','MiB','GiB','TiB'];let x=n,i=0;while(x>=1024&&i<units.length-1){x/=1024;i++;}
  return (i?x.toFixed(x<10?2:1):String(x))+' '+units[i];
};
const short=value=>typeof value==='string'?value.slice(0,12):'';
const when=value=>value?new Date(value).toLocaleString():'';
const query=value=>new URLSearchParams(Object.entries(value).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>[k,String(v)])).toString();
const operationId=kind=>kind+'-'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+'-'+crypto.randomUUID().slice(0,8);
const fileName=value=>typeof value==='string'&&value.length>0&&!/^[\\/]/.test(value)&&!/^[A-Za-z]:/.test(value)&&
  !/[\\\x00-\x1f\x7f]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const errorMessage=problem=>problem.detail??problem.message??String(problem);
async function request(path,value,method=value===undefined?'GET':'POST') {
  const response=await fetch(BASE+path,{method,cache:'no-store',credentials:'same-origin',
    headers:value===undefined?{}:{'content-type':'application/json'},
    ...(value===undefined?{}:{body:JSON.stringify(value)})});
  let result;try{result=await response.json();}catch{throw Error('The original package response could not be read. Reopen its retained operation.');}
  if(!response.ok)throw Object.assign(new Error(result.detail??result.error??'Package operation failed.'),result,{status:response.status});
  return result;
}

/** caseContext and saveCase are the original Case desk's current selection and
 * atomic save. onOpenCase retains its normal draft-transition handling. */
export function mountCasePackageDesk({root,caseContext=()=>null,saveCase=null,onOpenCase=async()=>false}={}) {
  if(!root)throw Error('Supply the existing package panel root.');
  const abort=new AbortController();let destroyed=false,busy=false,background=null,catalog=null,
    operations=[],inputs=[],currentOperation=null,currentSelection=null,currentManifest=null,
    localFiles=null,localManifest=null,selectedBundle=null,inventorySection='files',inventoryOffset=0,
    inventoryNext=null,inventorySerial=0,listSerial=0,pollTimer=null,activeTab=0,pending=null,
    operationOffset=0,operationNext=null,inputOffset=0,inputNext=null;
  const originKey=()=>catalog?'sf74-case-package-pending:'+catalog.directory:null;
  root.replaceChildren();root.id='case-packages';
  const panel=add(root,'section',undefined,'card cp-desk');panel.setAttribute('aria-label','Complete case packages');
  const heading=add(panel,'div',undefined,'section-heading'),title=add(heading,'div');
  add(title,'p','Merchant delivery','eyebrow');add(title,'h2','Complete case packages');
  add(title,'p','Transfer the saved case, its history and every original source attachment.');
  const refreshButton=add(heading,'button','Refresh','secondary');refreshButton.type='button';
  const status=add(panel,'p','Connecting to original package storage…','status');status.id='cp-status';
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const tabs=add(panel,'div',undefined,'cp-tabs');tabs.setAttribute('role','tablist');
  const tabNames=['Export and receive','Operations','Package contents','Receiving and MCP'],tabButtons=[],pages=[];
  function switchTab(index) {
    activeTab=index;tabButtons.forEach((button,i)=>{button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;});
    pages.forEach((page,i)=>{page.hidden=i!==index;});if(index===2&&currentSelection)void act(()=>loadInventory());
  }
  for(const [i,name]of tabNames.entries()) {
    const button=add(tabs,'button',name,'secondary');button.type='button';button.setAttribute('role','tab');
    button.id='cp-tab-'+i;button.setAttribute('aria-controls','cp-page-'+i);
    button.addEventListener('click',()=>switchTab(i),{signal:abort.signal});tabButtons.push(button);
    const page=add(panel,'section',undefined,'cp-page');page.id='cp-page-'+i;page.setAttribute('role','tabpanel');
    page.setAttribute('aria-labelledby',button.id);pages.push(page);
  }
  function say(text,bad=false) {status.textContent=text;status.classList.toggle('error',bad);}
  function actionButton(parent,label,callback,{id,secondary=true}={}) {
    const node=add(parent,'button',label,secondary?'secondary':'');node.type='button';if(id)node.id=id;
    node.addEventListener('click',()=>void act(callback),{signal:abort.signal});return node;
  }
  function field(parent,label,{id,type='text',value='',multiline=false,placeholder=''}={}) {
    const wrap=add(parent,'label',undefined,'cp-field');add(wrap,'span',label);
    const node=add(wrap,multiline?'textarea':'input');node.id=id;node.name=id;node.value=value;
    if(!multiline)node.type=type;else node.rows=4;
    if(placeholder)node.placeholder=placeholder;return node;
  }
  function select(parent,label,id,options=[]) {
    const wrap=add(parent,'label',undefined,'cp-field');add(wrap,'span',label);
    const node=add(wrap,'select');node.id=id;for(const[value,text]of options){const item=add(node,'option',text);item.value=value;}
    return node;
  }
  function table(parent,headers,rows) {
    parent.replaceChildren();const scroll=add(parent,'div',undefined,'cp-table-scroll'),node=add(scroll,'table');
    const head=add(node,'thead'),tr=add(head,'tr');for(const header of headers)add(tr,'th',header);
    const body=add(node,'tbody');
    if(!rows.length){const line=add(body,'tr');const cell=add(line,'td','No matching retained records.');cell.colSpan=headers.length;}
    for(const row of rows){const line=add(body,'tr');row.forEach(value=>{const cell=add(line,'td');
      if(value instanceof Node)cell.append(value);else cell.textContent=value===undefined||value===null?'':String(value);});}
  }
  function link(label,url) {const node=document.createElement('a');node.textContent=label;node.href=url;node.setAttribute('download','');return node;}
  function controls() {
    panel.dataset.busy=String(busy);
    for(const node of panel.querySelectorAll('button[data-cp-mutation]'))node.disabled=busy||!catalog||
      Boolean(pending&&!['cp-resume-pending','cp-pause-operation'].includes(node.id));
    for(const node of panel.querySelectorAll('input,select,textarea'))node.disabled=busy||!catalog;
    refreshButton.disabled=busy;
    remoteReceive.disabled=busy||!catalog||!remoteSelection||Boolean(pending);
    pauseOperation.disabled=busy||!catalog||!currentOperation?.runningHere;
    openReceived.disabled=busy||!catalog||currentOperation?.state!=='COMPLETE'||!['receive','remote'].includes(currentOperation?.request?.kind);
    previous.disabled=busy||inventoryOffset===0;next.disabled=busy||inventoryNext===null;
    previousOperations.disabled=busy||operationOffset===0;nextOperations.disabled=busy||operationNext===null;
    previousInputs.disabled=busy||inputOffset===0;nextInputs.disabled=busy||inputNext===null;
  }
  async function act(callback) {
    if(destroyed||busy)return;busy=true;controls();
    try{await callback();}catch(problem){if(!destroyed)say(errorMessage(problem),true);}
    finally{busy=false;if(!destroyed)controls();}
  }
  const mutation=node=>{node.dataset.cpMutation='true';return node;};
  const ownerRow=add(pages[0],'div',undefined,'cp-grid');
  const actor=field(ownerRow,'Operator',{id:'cp-actor',placeholder:'Name responsible for this transfer'});
  const caseSummary=add(ownerRow,'p','Open an original case to export it.','cp-summary');caseSummary.id='cp-case-summary';
  const exportCard=add(pages[0],'section',undefined,'cp-box');add(exportCard,'h3','Export complete saved case');
  add(exportCard,'p','The export includes the selected revision, every retained case revision and all source-bundle editions, including unassigned attachments.');
  const exportId=field(exportCard,'Export operation ID',{id:'cp-export-id',value:operationId('case-export')});
  const exportActions=add(exportCard,'div',undefined,'cp-actions');
  mutation(actionButton(exportActions,'Save and export complete case',exportCurrent,{id:'cp-export',secondary:false}));
  const localCard=add(pages[0],'section',undefined,'cp-box');add(localCard,'h3','Receive a complete package folder');
  add(localCard,'p','Choose the folder containing case-source-package.json. Original members stream to private storage and are verified against that exact manifest.');
  const localId=field(localCard,'Input ID',{id:'cp-input-id',value:operationId('package-input')});
  const choose=field(localCard,'Complete package folder',{id:'cp-local-files',type:'file'});
  choose.multiple=true;choose.setAttribute('webkitdirectory','');choose.setAttribute('directory','');
  const localSummary=add(localCard,'p','Select a complete package folder.','cp-summary');localSummary.id='cp-local-summary';
  const uploadProgress=add(localCard,'progress');uploadProgress.max=1;uploadProgress.value=0;uploadProgress.hidden=true;uploadProgress.setAttribute('aria-label','Original files uploaded');
  const localActions=add(localCard,'div',undefined,'cp-actions');
  mutation(actionButton(localActions,'Upload and inspect originals',uploadAndInspect,{id:'cp-upload',secondary:false}));
  const remoteCard=add(pages[0],'section',undefined,'cp-box');add(remoteCard,'h3','Receive from an existing Handoffs source');
  const remoteGrid=add(remoteCard,'div',undefined,'cp-grid');
  const remoteProfile=select(remoteGrid,'Configured source','cp-remote-profile');
  const remoteExport=field(remoteGrid,'Original export ID',{id:'cp-remote-export'});
  const remoteId=field(remoteGrid,'Receiving operation ID',{id:'cp-remote-id',value:operationId('package-remote')});
  const remoteInfo=add(remoteCard,'div',undefined,'cp-summary');let remoteSelection=null;
  const remoteActions=add(remoteCard,'div',undefined,'cp-actions');
  actionButton(remoteActions,'Inspect remote package',inspectRemote,{id:'cp-remote-inspect'});
  const remoteReceive=mutation(actionButton(remoteActions,'Download and receive complete package',receiveRemote,{id:'cp-remote-receive',secondary:false}));
  remoteReceive.disabled=true;
  const pendingBox=add(pages[0],'section',undefined,'cp-box');pendingBox.hidden=true;
  add(pendingBox,'h3','Original request awaiting response reconciliation');
  const pendingText=add(pendingBox,'pre',undefined,'cp-pre');
  mutation(actionButton(pendingBox,'Resume the original request',()=>submit(pending.request),{id:'cp-resume-pending'}));

  const opHeader=add(pages[1],'div',undefined,'cp-actions');
  actionButton(opHeader,'Refresh operations',refresh,{id:'cp-refresh-operations'});
  const operationList=add(pages[1],'div');
  const operationPages=add(pages[1],'div',undefined,'cp-actions');
  const previousOperations=actionButton(operationPages,'Previous operations',()=>{operationOffset=Math.max(0,operationOffset-100);return refreshLists();});
  const nextOperations=actionButton(operationPages,'More operations',()=>{if(operationNext!==null){operationOffset=operationNext;return refreshLists();}});
  const operationPageSummary=add(operationPages,'span');
  const opDetails=add(pages[1],'section',undefined,'cp-box');opDetails.hidden=true;
  const opTitle=add(opDetails,'h3','Retained operation'),opSummary=add(opDetails,'p',undefined,'cp-summary');
  const opProgress=add(opDetails,'pre',undefined,'cp-pre');opProgress.id='cp-operation-progress';
  const opActions=add(opDetails,'div',undefined,'cp-actions');
  mutation(actionButton(opActions,'Resume original operation',()=>resumeOperation(),{id:'cp-run-operation',secondary:false}));
  const pauseOperation=mutation(actionButton(opActions,'Pause this process’s operation',()=>pauseCurrent(),{id:'cp-pause-operation'}));
  const openReceived=mutation(actionButton(opActions,'Open received case',()=>openCurrent(),{id:'cp-open-received'}));
  actionButton(opActions,'View original package contents',()=>openOperationSource(),{id:'cp-view-operation-package'});
  const inputsHeading=add(pages[1],'h3','Received package inputs');const inputList=add(pages[1],'div');
  const inputPages=add(pages[1],'div',undefined,'cp-actions');
  const previousInputs=actionButton(inputPages,'Previous inputs',()=>{inputOffset=Math.max(0,inputOffset-100);return refreshLists();});
  const nextInputs=actionButton(inputPages,'More inputs',()=>{if(inputNext!==null){inputOffset=inputNext;return refreshLists();}});
  const inputPageSummary=add(inputPages,'span');

  const inventoryControls=add(pages[2],'div',undefined,'cp-grid');
  const sourceSelect=select(inventoryControls,'Retained package','cp-source');
  const sectionSelect=select(inventoryControls,'Inventory','cp-inventory-section',[
    ['files','Complete package files'],['sourceBundles','Every native source bundle'],['revisions','Original case history']]);
  const inventorySearch=field(inventoryControls,'Find in this inventory',{id:'cp-inventory-search',placeholder:'Filename, SHA, original revision'});
  const inventorySummary=add(pages[2],'p','Choose a retained package.','cp-summary');inventorySummary.id='cp-inventory-summary';
  const inventoryActions=add(pages[2],'div',undefined,'cp-actions');
  actionButton(inventoryActions,'Refresh inventory',()=>{inventoryOffset=0;return loadInventory();},{id:'cp-refresh-inventory'});
  mutation(actionButton(inventoryActions,'Inspect complete package',inspectSelected,{id:'cp-inspect-selected'}));
  mutation(actionButton(inventoryActions,'Receive into this case desk',receiveSelected,{id:'cp-receive-selected',secondary:false}));
  actionButton(inventoryActions,'Download complete folder',downloadFolder,{id:'cp-download-folder'});
  const inventoryTable=add(pages[2],'div');const inventoryPages=add(pages[2],'div',undefined,'cp-actions');
  const previous=actionButton(inventoryPages,'Previous members',()=>{inventoryOffset=Math.max(0,inventoryOffset-100);return loadInventory();});
  const next=actionButton(inventoryPages,'More members',()=>{if(inventoryNext!==null){inventoryOffset=inventoryNext;return loadInventory();}});
  const bundleTitle=add(pages[2],'p',undefined,'cp-summary');bundleTitle.hidden=true;
  const backToBundles=actionButton(pages[2],'Back to source bundles',()=>{selectedBundle=null;inventorySection='sourceBundles';sectionSelect.value='sourceBundles';inventoryOffset=0;return loadInventory();});
  backToBundles.hidden=true;
  const downloadProgress=add(pages[2],'p',undefined,'cp-summary');downloadProgress.id='cp-download-progress';

  const guide=add(pages[3],'div',undefined,'cp-guide');
  add(guide,'h3','Independent receiving');
  add(guide,'p','A completed receiving operation records the local case and source directory. Start the original Support application with those same directories to reopen it independently. The complete package also retains the original sender’s case-history snapshot and every original native archive.');
  const receivingGuide=add(guide,'pre',undefined,'cp-pre');receivingGuide.id='cp-receiving-guide';
  add(guide,'h3','Installed MCP access');
  add(guide,'p','The same package tools use the existing Support connection. Configure paths in the host file; tools select original IDs and Handoffs source aliases.');
  const mcpGuide=add(guide,'pre',undefined,'cp-pre');mcpGuide.id='cp-mcp-guide';
  add(guide,'p','Prepare an export with the current case revision, run its retained ID, inspect status, then read the complete manifest and original file ranges. On the receiving host, inspect the configured source/export and run one remote receiving operation with that exact manifest SHA.');
  const protocol=add(guide,'pre',[
    'merchant_case_package_prepare → merchant_case_package_run',
    'merchant_case_package_status / merchant_case_package_inventory',
    'merchant_case_package_export_manifest / merchant_case_package_export_file',
    'merchant_case_package_remote_inspect → prepare(kind: remote) → run',
    'merchant_case_package_open / merchant_case_package_original_file'
  ].join('\n'),'cp-pre');

  function refreshCase() {
    const value=caseContext();
    const who=typeof value?.actor==='string'?value.actor:value?.actor?.name??value?.actor?.label??'';
    if(!actor.value&&who)actor.value=who;
    caseSummary.textContent=value?.id?
      'Case '+value.id+' · saved revision '+short(value.revision)+(value.dirty?' · current draft has unsaved changes':' · saved'):
      'Open or save an original case in the Case desk.';
  }
  function savePending(value) {
    pending=value;const key=originKey();
    if(key)try{if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{}
    pendingBox.hidden=!value;pendingText.textContent=value?JSON.stringify(value.request,null,2):'';
  }
  function restorePending() {
    if(!originKey())return;
    try{const value=JSON.parse(sessionStorage.getItem(originKey())??'null');
      if(value?.request?.id&&value.directory===catalog.directory)savePending(value);}
    catch{}
  }
  const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
    value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
  function confirmOriginalStatus(value,submitted) {
    if(!value||value.id!==submitted.id||!value.request||typeof value.runningHere!=='boolean'||
      !['PREPARED','RUNNING','PAUSED','NEEDS_CONTINUATION','COMPLETE'].includes(value.state))
      throw Error('The original operation response is incomplete. Resume the retained request to reconcile it.');
    const expected={schema:'stellar-forge.merchant-case-package-operation.v1',id:submitted.id,
      kind:submitted.kind,actor:submitted.actor.trim()};
    if(submitted.kind==='export')Object.assign(expected,{caseId:submitted.caseId,revision:submitted.revision,exportId:submitted.id});
    else if(submitted.kind==='remote')Object.assign(expected,{profile:submitted.profile,exportId:submitted.exportId,
      manifestSha256:submitted.expectedManifestSha256});
    else Object.assign(expected,{source:submitted.source,manifestSha256:submitted.expectedManifestSha256});
    const actual={...value.request};delete actual.createdAt;
    if(submitted.kind==='remote') {
      if(typeof actual.endpoint!=='string'||!actual.endpoint)throw Error('The original remote endpoint binding is missing. Resume the retained request.');
      delete actual.endpoint;
    }
    if(canonical(actual)!==canonical(expected))
      throw Error('The response belongs to another request or source. The original input is retained for reconciliation.');
    return value;
  }
  function validateSubmitted(value) {
    const id=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
    const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
    if(!id(value.id))throw Error('Use 1–64 lowercase letters, digits, underscores or hyphens for the operation ID.');
    if(typeof value.actor!=='string'||!value.actor.trim()||new TextEncoder().encode(value.actor).length>200||/[\x00-\x1f\x7f]/.test(value.actor))
      throw Error('Use an operator name of at most 200 UTF-8 bytes without control characters.');
    if(value.kind==='export') {
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.caseId??'')||!sha(value.revision))
        throw Error('Choose the original saved case and its complete revision.');
    } else if(value.kind==='remote') {
      if(!id(value.profile)||!id(value.exportId)||!sha(value.expectedManifestSha256))
        throw Error('Inspect the configured source and original export before receiving.');
    } else if(['inspect','receive'].includes(value.kind)) {
      if(!value.source||!['input','operation'].includes(value.source.kind)||!id(value.source.id)||!sha(value.expectedManifestSha256))
        throw Error('Select the exact original package input and manifest.');
    } else throw Error('Choose an original export, inspection or receiving operation.');
  }
  function retainRejectedPreparation(value,problem,evidence) {
    const record={directory:catalog.directory,request:JSON.parse(JSON.stringify(value)),
      preparedAt:pending?.preparedAt??null,rejectedAt:new Date().toISOString(),
      error:{status:problem.status??null,code:problem.error??null,message:errorMessage(problem)},evidence};
    try{sessionStorage.setItem(originKey()+':rejected:'+value.id+':'+record.rejectedAt,JSON.stringify(record));}catch{}
    savePending(null);
  }
  async function reconcileRejectedPreparation(problem,value) {
    const codes=['CASE_PACKAGE_OPERATION_ID','CASE_PACKAGE_OPERATION_DIGEST','CASE_PACKAGE_OPERATOR',
      'CASE_PACKAGE_OPERATION_KIND','CASE_PACKAGE_OPERATION_CASE','CASE_PACKAGE_OPERATION_INPUT',
      'CASE_PACKAGE_SELECTION','CASE_PACKAGE_OPERATION_NOT_FOUND'];
    if(![404,422].includes(problem.status)||!codes.includes(problem.error))return;
    try {await request('/operations/'+encodeURIComponent(value.id));}
    catch(observed) {
      if(observed.status===404&&observed.error==='CASE_PACKAGE_OPERATION_NOT_FOUND')
        retainRejectedPreparation(value,problem,{kind:'native-rejection-and-original-operation-absent',
          observedAt:new Date().toISOString(),lookupCode:observed.error});
    }
  }
  async function submit(value) {
    if(!catalog)throw Error('Open the original package storage first.');
    try{validateSubmitted(value);}catch(problem){
      if(pending&&canonical(pending.request)===canonical(value))
        retainRejectedPreparation(value,problem,{kind:'original-preparation-input-validation'});
      throw problem;
    }
    if(pending&&canonical(pending.request)!==canonical(value))
      throw Error('Resume original request '+pending.request.id+' before preparing another package operation.');
    if(!pending)savePending({directory:catalog.directory,request:JSON.parse(JSON.stringify(value)),preparedAt:new Date().toISOString()});
    say('Opening original operation '+value.id+'…');
    let response;
    try{response=await request('/operations',pending.request);}
    catch(problem){await reconcileRejectedPreparation(problem,pending.request);throw problem;}
    const result=confirmOriginalStatus(response,pending.request);
    savePending(null);currentOperation=result;renderOperation();switchTab(1);
    if(value.kind==='export'&&exportId.value===value.id)exportId.value=operationId('case-export');
    if(value.kind==='remote'&&remoteId.value===value.id)remoteId.value=operationId('package-remote');
    operationOffset=0;await refreshLists();schedulePoll();
    say(result.state==='COMPLETE'?'Original operation complete.':'Original operation retained. Progress is available in Operations.');
    return result;
  }
  async function exportCurrent() {
    let value=caseContext();if(!value?.id&&!saveCase)throw Error('Save this original case before exporting.');
    if(saveCase){const saved=await saveCase();if(saved===false)throw Error('The current case save did not finish. Its draft is retained in the Case desk.');}
    value=caseContext();refreshCase();
    if(!value?.id||!value.revision||value.dirty||value.busy)throw Error('Finish saving the current original case, then export its complete saved revision.');
    await submit({id:exportId.value.trim(),kind:'export',actor:actor.value.trim(),caseId:value.id,revision:value.revision});
  }
  async function chooseFolder() {
    localFiles=null;localManifest=null;localSummary.textContent='Reading the selected original manifest…';
    const files=Array.from(choose.files??[]);
    if(!files.length){localSummary.textContent='Select a complete package folder.';return;}
    const mapped=new Map();
    for(const file of files) {
      const relative=file.webkitRelativePath?file.webkitRelativePath.split('/').slice(1).join('/'):file.name;
      if(!fileName(relative)||mapped.has(relative))throw Error('The folder has a duplicate or noncanonical member path.');
      mapped.set(relative,file);
    }
    const manifestFile=mapped.get('case-source-package.json');
    if(!manifestFile||manifestFile.size>64*1024*1024)throw Error('Choose the original folder with its bounded case-source-package.json manifest.');
    const bytes=await manifestFile.arrayBuffer(),manifestSha256=await digest(bytes);
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);let manifest;
    try{manifest=JSON.parse(text);}catch{throw Error('The original package manifest is not valid JSON.');}
    if(manifest.schema!=='stellar-forge.merchant-case-source-package.v1'||!Array.isArray(manifest.files))
      throw Error('Select an original complete case/source package.');
    const selected=new Map(),missing=[];
    for(const file of manifest.files) {
      if(!fileName(file.name)||selected.has(file.name))throw Error('The original inventory has a duplicate or invalid member name.');
      const original=mapped.get(file.name);
      if(!original||original.size!==Number(file.bytes))missing.push(file.name);
      else selected.set(file.name,original);
    }
    if(missing.length)throw Error('The folder is missing original members or their exact byte counts: '+missing.slice(0,6).join(', ')+(missing.length>6?' …':''));
    localFiles=selected;localManifest={manifest,text,manifestSha256};
    if(catalog)try {
      const last=JSON.parse(sessionStorage.getItem(originKey()+':input')??'null');
      if(last?.manifestSha256===manifestSha256&&typeof last.id==='string')localId.value=last.id;
    }catch{}
    localSummary.textContent=manifest.exportId+' · '+selected.size+' original package files · '+
      manifest.caseHistory.revisions.length+' saved case revisions · '+manifest.sourceBundles.length+
      ' source bundles · manifest '+manifestSha256;
    say('Original folder selected. Upload streams only its manifest-declared members.');
  }
  async function uploadAndInspect() {
    if(!localManifest||!localFiles)throw Error('Choose the original complete package folder first.');
    const id=localId.value.trim(),who=actor.value.trim(),selected=localManifest,files=localFiles;
    if(!who)throw Error('Name the receiving operator.');
    if(catalog)try{sessionStorage.setItem(originKey()+':input',JSON.stringify({id,manifestSha256:selected.manifestSha256}));}catch{}
    const begin=await fetch(BASE+'/inputs/'+encodeURIComponent(id)+'/manifest?'+query({actor:who,manifestSha:selected.manifestSha256}),
      {method:'PUT',credentials:'same-origin',headers:{'content-type':'application/json'},body:selected.text});
    const prepared=await begin.json();if(!begin.ok)throw Object.assign(new Error(prepared.detail??prepared.error),prepared);
    uploadProgress.hidden=false;uploadProgress.max=Math.max(files.size,1);uploadProgress.value=0;
    let complete=0;
    // The server's original acceptStream owns byte verification and create-only retention.
    for(const [name,file]of files) {
      say('Receiving '+(++complete)+'/'+files.size+': '+name);
      const response=await fetch(BASE+'/inputs/'+encodeURIComponent(id)+'/files?'+query({name}),
        {method:'PUT',credentials:'same-origin',headers:{'content-type':'application/octet-stream'},body:file});
      const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.detail??value.error),value);
      uploadProgress.value=complete;
    }
    currentSelection={kind:'input',id,manifestSha256:selected.manifestSha256};
    await refreshLists();await submit({id:operationId('package-inspect'),kind:'inspect',actor:who,
      source:{kind:'input',id},expectedManifestSha256:selected.manifestSha256});
  }
  async function inspectRemote() {
    remoteSelection=null;remoteInfo.textContent='Reading the original source manifest…';remoteReceive.disabled=true;
    const profile=remoteProfile.value,exportId=remoteExport.value.trim();
    const value=await request('/remote/inspect',{profile,exportId});
    if(profile!==remoteProfile.value||exportId!==remoteExport.value.trim())throw Error('The source selection changed. Inspect the selected export again.');
    remoteSelection={profile,exportId,manifestSha256:value.manifestSha256};
    remoteInfo.textContent=exportId+' · '+value.summary.revisions+' case revisions · '+value.summary.sourceBundles+
      ' native source bundles · '+value.summary.files+' files · '+humanBytes(value.summary.bytes)+' · '+value.manifestSha256;
    remoteReceive.disabled=busy||!catalog;
    say('Original remote package inspected. Its full manifest identity is retained for receiving.');
  }
  async function receiveRemote() {
    if(!remoteSelection||remoteSelection.profile!==remoteProfile.value||remoteSelection.exportId!==remoteExport.value.trim())
      throw Error('Inspect the exact selected original source/export before receiving.');
    await submit({id:remoteId.value.trim(),kind:'remote',actor:actor.value.trim(),profile:remoteSelection.profile,
      exportId:remoteSelection.exportId,expectedManifestSha256:remoteSelection.manifestSha256});
  }
  function selectedSource() {
    if(!currentSelection)throw Error('Select a retained package.');
    return {kind:currentSelection.kind,id:currentSelection.id};
  }
  async function inspectSelected() {
    await submit({id:operationId('package-inspect'),kind:'inspect',actor:actor.value.trim(),
      source:selectedSource(),expectedManifestSha256:currentSelection.manifestSha256});
  }
  async function receiveSelected() {
    await submit({id:operationId('package-receive'),kind:'receive',actor:actor.value.trim(),
      source:selectedSource(),expectedManifestSha256:currentSelection.manifestSha256});
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if(destroyed||!currentOperation||!['PREPARED','RUNNING'].includes(currentOperation.state))return;
    pollTimer=setTimeout(async()=>{
      if(destroyed)return;
      if(busy){schedulePoll();return;}
      try{
        const id=currentOperation.id,value=await request('/operations/'+encodeURIComponent(id));
        if(!destroyed&&currentOperation?.id===id) {
          const changed=value.state!==currentOperation.state;currentOperation=value;renderOperation();
          if(changed&&value.state==='COMPLETE')await refreshLists();
        }
      }catch(problem){if(!destroyed)say(errorMessage(problem),true);}
      schedulePoll();
    },2500);
  }
  function renderOperation() {
    if(!currentOperation){opDetails.hidden=true;return;}
    const value=currentOperation,receipt=value.result?.receiving??value.result,native=value.nativeReceiving;
    opDetails.hidden=false;opTitle.textContent=value.id;
    opSummary.textContent=value.request.kind+' · '+value.state+' · '+value.stage+
      (value.runningHere?' · owned by this process':' · retained operation');
    const progress={state:value.state,stage:value.stage,operator:value.request.actor,
      startedAt:value.observedState?.startedAt,completedAt:value.observedState?.completedAt,
      progress:value.observedState?.download??undefined,
      nativeStage:native?.stage,sourceBundlesReceived:native?.sourceBundles?.length,
      receivingCase:receipt?.case,
      sourceFilesVerified:receipt?.sourceFilesVerified,
      originalCaseHistory:receipt?.originalCaseHistory,
      lastError:value.observedState?.lastError??native?.lastError??null};
    opProgress.textContent=JSON.stringify(progress,null,2);
    pauseOperation.disabled=busy||!value.runningHere;
    openReceived.disabled=busy||value.state!=='COMPLETE'||!['receive','remote'].includes(value.request.kind);
  }
  async function viewOperation(id) {
    currentOperation=await request('/operations/'+encodeURIComponent(id));renderOperation();switchTab(1);schedulePoll();
  }
  async function resumeOperation() {
    if(!currentOperation)throw Error('Open an original retained operation.');
    currentOperation=await request('/operations/'+encodeURIComponent(currentOperation.id)+'/run',{});
    renderOperation();schedulePoll();say('The original operation was resumed or joined.');
  }
  async function pauseCurrent() {
    if(!currentOperation)throw Error('Open the original running operation.');
    currentOperation=await request('/operations/'+encodeURIComponent(currentOperation.id)+'/stop',{});
    renderOperation();schedulePoll();say('The original operation is paused with its retained checkpoints.');
  }
  async function openCurrent() {
    if(!currentOperation)throw Error('Open a completed receiving operation.');
    const result=await request('/operations/'+encodeURIComponent(currentOperation.id)+'/open',{});
    if(await onOpenCase(result.case.id)===false)return;
    refreshCase();say('Opened received case '+result.case.id+' at its current saved revision.');
  }
  async function openOperationSource() {
    if(!currentOperation)throw Error('Open a retained operation.');
    const operation=currentOperation,source=operation.request.kind==='inspect'?operation.request.source:
      {kind:'operation',id:operation.id};
    const manifestSha256=operation.request.manifestSha256??operation.result?.manifestSha256??
      operation.result?.receiving?.manifestSha256;
    if(!manifestSha256)throw Error('This original package has not published its completion manifest yet.');
    await setSource({...source,manifestSha256});switchTab(2);
  }
  function sourceOptions() {
    const previous=currentSelection?currentSelection.kind+':'+currentSelection.id:sourceSelect.value;
    sourceSelect.replaceChildren();const placeholder=add(sourceSelect,'option','Choose a retained package');placeholder.value='';
    const addSource=(kind,id,label,sha)=>{
      if(!sha)return;const option=add(sourceSelect,'option',label);option.value=kind+':'+id;option.dataset.manifestSha=sha;
    };
    for(const input of inputs)addSource('input',input.id,'Input · '+input.exportId+' · '+input.id,input.manifestSha256);
    for(const op of operations)if(['export','receive','remote'].includes(op.kind)&&op.state==='COMPLETE')
      addSource('operation',op.id,op.kind+' · '+op.id,op.manifestSha256);
    if(currentSelection&&!Array.from(sourceSelect.options).some(option=>option.value===previous))
      addSource(currentSelection.kind,currentSelection.id,'Selected · '+currentSelection.id,currentSelection.manifestSha256);
    sourceSelect.value=previous;
  }
  async function refreshLists() {
    const serial=++listSerial;const [op,input]=await Promise.all([
      request('/operations?'+query({offset:operationOffset,limit:100})),request('/inputs?'+query({offset:inputOffset,limit:100}))]);
    if(destroyed||serial!==listSerial)return;
    operations=op.rows;inputs=input.rows;operationNext=op.nextOffset;inputNext=input.nextOffset;
    operationPageSummary.textContent=(op.rows.length?op.offset+1:0)+'–'+(op.offset+op.rows.length)+' of '+op.total;
    inputPageSummary.textContent=(input.rows.length?input.offset+1:0)+'–'+(input.offset+input.rows.length)+' of '+input.total;
    table(operationList,['Operation','Kind','State','Operator','Created','Open'],operations.map(value=>{
      const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Open';
      button.addEventListener('click',()=>void act(()=>viewOperation(value.id)),{signal:abort.signal});
      return [value.id,value.kind,value.state,value.actor,when(value.createdAt),button];
    }));
    table(inputList,['Original export','Input ID','State','Operator','Contents'],inputs.map(value=>{
      const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='View originals';
      button.addEventListener('click',()=>void act(async()=>{await setSource({kind:'input',id:value.id,manifestSha256:value.manifestSha256});switchTab(2);}),{signal:abort.signal});
      return [value.exportId,value.id,value.state,value.actor,button];
    }));
    sourceOptions();controls();
  }
  async function refresh() {
    catalog=await request('/catalog');refreshCase();restorePending();
    const prior=remoteProfile.value;remoteProfile.replaceChildren();
    for(const source of catalog.remoteSources??[]){const option=add(remoteProfile,'option',source.label);option.value=source.key;}
    if(prior)remoteProfile.value=prior;
    receivingGuide.textContent=[
      'node server.mjs --cases-dir '+JSON.stringify(catalog.casesDirectory),
      '  --source-dir '+JSON.stringify(catalog.sourceDirectory),
      '  --package-dir '+JSON.stringify(catalog.directory)+' --port 8784',
      '',
      'CLI: node commissioning-cli.mjs inspect-package --from ORIGINAL_PACKAGE --sha256 ORIGINAL_MANIFEST_SHA',
      'CLI: node commissioning-cli.mjs receive-package --from ORIGINAL_PACKAGE --sha256 ORIGINAL_MANIFEST_SHA',
      '  --out NEW_PRIVATE_RECEIVING --cases-dir '+JSON.stringify(catalog.casesDirectory),
      '  --source-dir '+JSON.stringify(catalog.sourceDirectory)+' --request-id SAME_RECEIVING_ID --actor OPERATOR'
    ].join('\n');
    mcpGuide.textContent=JSON.stringify({schema:'stellar-forge.merchant-support-connection.v1',
      casesDirectory:catalog.casesDirectory,sourceDirectory:catalog.sourceDirectory,packagesDirectory:catalog.directory,
      packageSourcesFile:'/absolute/private/handoff-sources.json'},null,2);
    await refreshLists();say('Original package storage is available. Choose a saved case, complete folder or configured source.');
  }

  async function setSource(value) {
    if(!value||!['input','operation'].includes(value.kind)||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.id??'')||
      !/^[a-f0-9]{64}$/.test(value.manifestSha256??''))throw Error('Choose a retained original package identity.');
    currentSelection={kind:value.kind,id:value.id,manifestSha256:value.manifestSha256};
    currentManifest=null;selectedBundle=null;inventorySection='files';sectionSelect.value='files';inventoryOffset=0;
    sourceOptions();await loadInventory();
  }
  function memberUrl(name,{original=false,bundle=selectedBundle,source=currentSelection}={}) {
    if(!source)throw Error('Choose a retained original package.');
    return BASE+(original?'/original-files?':'/files?')+query({
      kind:source.kind,id:source.id,manifestSha:source.manifestSha256,name,
      ...(original?{bundleId:bundle.bundleId,bundleSha:bundle.manifestSha256}:{})});
  }
  function rowButton(label,callback) {
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=label;
    button.addEventListener('click',()=>void act(callback),{signal:abort.signal});return button;
  }
  function details(label,lines) {
    const node=document.createElement('details');add(node,'summary',label);
    const list=add(node,'div',undefined,'cp-file-list');
    for(const value of lines) {
      if(value instanceof Node)list.append(value);else add(list,'p',value);
    }
    return node;
  }
  async function loadInventory() {
    if(!currentSelection) {
      inventorySummary.textContent='Choose a retained original package.';inventoryTable.replaceChildren();return;
    }
    const selected={...currentSelection},serial=++inventorySerial;
    const section=selectedBundle?'originalFiles':sectionSelect.value;
    inventorySection=section;
    const value=await request('/inventory?'+query({kind:selected.kind,id:selected.id,manifestSha:selected.manifestSha256,
      section,offset:inventoryOffset,limit:100,q:inventorySearch.value.trim(),
      ...(selectedBundle?{bundleId:selectedBundle.bundleId,bundleSha:selectedBundle.manifestSha256}:{})}));
    if(destroyed||serial!==inventorySerial)return;
    inventoryOffset=value.offset;inventoryNext=value.nextOffset;
    inventorySummary.textContent=value.exportId+' · selected case '+value.case.id+' / '+short(value.case.revision)+
      ' · '+value.revisions+' retained revisions · '+value.sourceBundles+' source bundles / '+value.sourceFiles+
      ' original members · '+humanBytes(value.bytes)+' · manifest '+value.manifestSha256+
      ' · showing '+(value.rows.length?value.offset+1:0)+'–'+(value.offset+value.rows.length)+' of '+value.total;
    previous.disabled=busy||value.offset===0;next.disabled=busy||value.nextOffset===null;
    bundleTitle.hidden=!selectedBundle;backToBundles.hidden=!selectedBundle;
    bundleTitle.textContent=selectedBundle?'Original source bundle '+selectedBundle.bundleId+' · '+selectedBundle.manifestSha256:'';
    if(section==='files') {
      table(inventoryTable,['Original member','Role','Bytes','SHA-256','Download'],value.rows.map(file=>[
        file.name,file.role,humanBytes(file.bytes),file.sha256,link('Original file',memberUrl(file.name,{source:selected}))]));
    } else if(section==='sourceBundles') {
      table(inventoryTable,['Bundle / manifest','Retained editions / case revisions','Original members','Original archive','Open'],value.rows.map(bundle=>[
        details(short(bundle.bundleId)+' / '+short(bundle.manifestSha256),['Bundle: '+bundle.bundleId,'Manifest: '+bundle.manifestSha256]),
        details(bundle.editionIds.length+' editions / '+bundle.caseRevisions.length+' case revisions',
          bundle.editionIds.map(id=>'Edition: '+id).concat(bundle.caseRevisions.map(id=>'Case revision: '+id))),
        bundle.files,
        link(bundle.archive.name+' ('+humanBytes(bundle.archive.bytes)+')',memberUrl(bundle.archive.name,{source:selected})),
        rowButton('View every original member',async()=>{
          selectedBundle={bundleId:bundle.bundleId,manifestSha256:bundle.manifestSha256};
          inventoryOffset=0;inventorySearch.value='';await loadInventory();
        })]));
    } else if(section==='originalFiles') {
      const nativeBundle={...selectedBundle};
      table(inventoryTable,['Original path','Role','Bytes','SHA-256','Native source download'],value.rows.map(file=>[
        file.path,file.role,humanBytes(file.bytes),file.sha256,
        link('Original member',memberUrl(file.path,{original:true,bundle:nativeBundle,source:selected}))]));
      add(inventoryTable,'p','Individual source members open from the existing native source store after receiving. The complete original archive is available in the bundle inventory.','cp-note');
    } else {
      table(inventoryTable,['Original revision','Previous revision','Workspace / runtime','Retained original files'],value.rows.map(row=>[
        row.revision,row.previousRevision??'First retained revision',
        details(short(row.workspaceSha256)+(row.supportSha256?' / '+short(row.supportSha256):''),
          ['Workspace: '+row.workspaceSha256,'Runtime: '+(row.supportSha256??'Not recorded')]),
        details(row.files.length+' original files',row.files.map(name=>link(name,memberUrl(name,{source:selected}))))]));
    }
    controls();
  }
  async function downloadFolder() {
    if(!currentSelection)throw Error('Choose a retained complete package.');
    if(typeof window.showDirectoryPicker!=='function')
      throw Error('This browser has no folder writer. Use the individual original downloads or the installed MCP receiving tools for the complete package.');
    // Open the browser's existing directory chooser within this user gesture.
    const destination=await window.showDirectoryPicker({mode:'readwrite',id:'sf74-case-package'});
    const selected={...currentSelection},value=await request('/manifest?'+query({
      kind:selected.kind,id:selected.id,manifestSha:selected.manifestSha256}));
    if(value.manifestSha256!==selected.manifestSha256)throw Error('The selected original manifest changed.');
    currentManifest=value;const markerName='.case-package-download.json';
    const members=value.manifest.files;
    if(members.some(file=>file.name===markerName))throw Error('Use installed native receiving for this reserved browser-control filename.');
    let marker=null;
    try {
      const original=await (await destination.getFileHandle(markerName)).getFile();
      if(original.size>65536)throw Error('The folder control record exceeds its original size.');
      marker=JSON.parse(await original.text());
    } catch(problem) {if(problem.name!=='NotFoundError')throw problem;}
    if(marker) {
      if(marker.schema!=='stellar-forge.merchant-case-package-browser-download.v1'||
        marker.manifestSha256!==selected.manifestSha256||marker.exportId!==value.exportId)
        throw Error('Choose an empty folder or this exact package’s original download folder.');
    } else {
      for await(const entry of destination.values()) {
        void entry;throw Error('Choose an empty folder. Existing files will stay in their current directory.');
      }
      marker={schema:'stellar-forge.merchant-case-package-browser-download.v1',exportId:value.exportId,
        manifestSha256:selected.manifestSha256,startedAt:new Date().toISOString(),state:'DOWNLOADING'};
    }
    async function writeSmall(name,text) {
      const handle=await destination.getFileHandle(name,{create:true}),writer=await handle.createWritable();
      try{await writer.write(text);await writer.close();}catch(problem){await writer.abort().catch(()=>{});throw problem;}
    }
    async function targetFile(name) {
      if(!fileName(name))throw Error('The original member path is invalid.');
      const parts=name.split('/');let directory=destination;
      for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part,{create:true});
      return directory.getFileHandle(parts.at(-1),{create:true});
    }
    await writeSmall(markerName,JSON.stringify({...marker,state:'DOWNLOADING'},null,2)+'\n');
    let count=0,total=0;
    const ordered=members.concat([{name:'case-source-package.json',...value.manifestFile}]);
    try {
      for(const file of ordered) {
        if(destroyed)throw Error('The download view closed. Its original folder can be selected again.');
        downloadProgress.textContent='Writing '+(++count)+'/'+ordered.length+': '+file.name;
        const response=await fetch(memberUrl(file.name,{source:selected}),{
          cache:'no-store',credentials:'same-origin',signal:abort.signal});
        if(!response.ok) {
          let problem;try{problem=await response.json();}catch{}
          throw Error(problem?.detail??'The original member download did not complete.');
        }
        if(response.headers.get('x-content-sha256')!==file.sha256||
          Number(response.headers.get('content-length'))!==Number(file.bytes)||!response.body)
          throw Error('The original download identity or byte count differs from its manifest.');
        const handle=await targetFile(file.name),writer=await handle.createWritable(),reader=response.body.getReader();
        let written=0;
        try {
          for(;;) {
            const chunk=await reader.read();if(chunk.done)break;
            written+=chunk.value.byteLength;if(written>Number(file.bytes))throw Error('The original member exceeded its manifest size.');
            await writer.write(chunk.value);
          }
          if(written!==Number(file.bytes))throw Error('The original member ended before its complete bytes.');
          await writer.close();total+=written;
        } catch(problem) {await reader.cancel().catch(()=>{});await writer.abort().catch(()=>{});throw problem;}
        finally{reader.releaseLock();}
      }
      await writeSmall(markerName,JSON.stringify({...marker,state:'COMPLETE',completedAt:new Date().toISOString(),
        files:ordered.length,bytes:String(total)},null,2)+'\n');
      downloadProgress.textContent='Complete folder saved: '+ordered.length+' original files, '+humanBytes(total)+
        '. The original completion manifest was written last.';
      say('Saved the complete original package folder. Use Upload and inspect originals on the receiving desk.');
    } catch(problem) {
      downloadProgress.textContent='The original folder is retained. Select the same folder to write this exact package again; installed MCP receiving retains byte-range progress for large transfers.';
      throw problem;
    }
  }

  refreshButton.addEventListener('click',()=>void act(refresh),{signal:abort.signal});
  choose.addEventListener('change',()=>void act(chooseFolder),{signal:abort.signal});
  sectionSelect.addEventListener('change',()=>void act(async()=>{
    selectedBundle=null;inventoryOffset=0;await loadInventory();
  }),{signal:abort.signal});
  sourceSelect.addEventListener('change',()=>void act(async()=>{
    const option=sourceSelect.selectedOptions[0];if(!option?.value){currentSelection=null;currentManifest=null;await loadInventory();return;}
    const [kind,id]=option.value.split(':');await setSource({kind,id,manifestSha256:option.dataset.manifestSha});
  }),{signal:abort.signal});
  inventorySearch.addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();void act(async()=>{inventoryOffset=0;await loadInventory();});}
  },{signal:abort.signal});
  const invalidateRemote=()=>{remoteSelection=null;remoteInfo.textContent='Inspect this source/export to select its original manifest.';controls();};
  remoteProfile.addEventListener('change',invalidateRemote,{signal:abort.signal});
  remoteExport.addEventListener('input',invalidateRemote,{signal:abort.signal});
  window.addEventListener('focus',refreshCase,{signal:abort.signal});
  tabs.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const index=event.key==='Home'?0:event.key==='End'?tabButtons.length-1:
      (activeTab+(event.key==='ArrowRight'?1:-1)+tabButtons.length)%tabButtons.length;
    switchTab(index);tabButtons[index].focus();
  },{signal:abort.signal});
  switchTab(0);refreshCase();void act(refresh);
  return Object.freeze({
    refresh:()=>act(refresh),refreshCase,
    async openOperation(id){await act(()=>viewOperation(id));},
    destroy(){if(destroyed)return;destroyed=true;clearTimeout(pollTimer);abort.abort();inventorySerial++;listSerial++;root.replaceChildren();}
  });
}
