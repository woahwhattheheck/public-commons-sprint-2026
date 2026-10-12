import {DEFAULT_INPUT,DRAFT_SCHEMA,readInputFile,sourceSummary,reviewSetup,createPacket,
  installationGuide,commands,importDraft,MAX_FILE_BYTES} from './cocart-onboarding.mjs';
import {zipWorkspace} from './onboarding.mjs';
import {listDrafts,loadDraft,saveDraft} from './drafts.mjs';

const $=id=>document.getElementById(id);
const fields=['folder','label','workspaceDirectory','sdkModule','connectionFile','workspaceAlias','merchantDirectory'];
let input=structuredClone(DEFAULT_INPUT),draftId=null,savedRevision=0,editRevision=0,savedAtRevision=-1;
let activeStep=0,busy=false,fileSelection=null,runnerPromise=null;
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
const button=(text,action,className='button small')=>{const node=el('button',text,className);node.type='button';node.addEventListener('click',action);return node;};
function status(message){$('cocart-status').textContent=message;}
function failure(error){$('cocart-error').textContent=error.message||String(error);$('cocart-error').hidden=false;$('cocart-error').scrollIntoView({block:'nearest'});}
function clearError(){$('cocart-error').hidden=true;$('cocart-error').textContent='';}
async function work(action) {
  if(busy)return;
  busy=true;clearError();
  const controls=[...document.querySelectorAll('button,input,select')].map(node=>[node,node.disabled]);
  controls.forEach(([node])=>{node.disabled=true;});
  try{return await action();}catch(error){failure(error);}
  finally{controls.forEach(([node,disabled])=>{if(node.isConnected)node.disabled=disabled;});busy=false;}
}
function metadata(){
  const dirty=editRevision!==savedAtRevision;
  $('cocart-draft-meta').textContent=(draftId?'Saved edition '+savedRevision:'New local draft')+(dirty?' · unsaved changes':'');
}
function changed(message='Setup changed. Review the current packet before downloading.'){
  editRevision++;metadata();status(message);
  $('cocart-review').replaceChildren(el('p','The draft has changed. Review current draft to update this packet.','cocart-empty'));
}
function syncFields(){fields.forEach(field=>{$('cocart-'+field).value=input[field]||'';});metadata();}
function download(content,name,type) {
  const url=URL.createObjectURL(new Blob([content],{type})),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
}
const folder=()=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input.folder)?input.folder:'cocart-customer';
async function runner(){
  if(!runnerPromise)runnerPromise=fetch('/cocart-runner.mjs',{cache:'no-cache'}).then(async response=>{
    if(!response.ok)throw new Error('The setup runner did not load. Reload this page before exporting.');
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await response.arrayBuffer());
  }).catch(error=>{runnerPromise=null;throw error;});
  return runnerPromise;
}
function descriptionList(rows){
  const list=el('dl',undefined,'cocart-values');
  rows.filter(([,value])=>value!==null&&value!==undefined&&value!=='').forEach(([label,value])=>{
    const row=el('div');row.append(el('dt',label),el('dd',value));list.append(row);
  });return list;
}
function fileCard(file,{remove,alias,aliasChange}={}){
  const card=el('article',undefined,'cocart-file'),top=el('div',undefined,'cocart-file-top'),title=el('div');
  title.append(el('h4',file.name),el('small',file.kind.toUpperCase()+' · '+file.bytes.toLocaleString()+' original bytes'));top.append(title);
  if(remove)top.append(button('Remove',remove,'text-button'));card.append(top,el('code','SHA-256 '+file.sha256));
  const s=sourceSummary(file);
  if(['profile','receiving'].includes(file.kind))card.append(descriptionList([
    ['Merchant',s.merchant],['Store API',s.store],['Checkout',s.checkout],['Selected plugin',s.plugin],
    ['Saved product',s.productId],['Store total',s.currency&&s.total!==null?s.currency+' '+s.total:null],
    ['Native route',s.route],['Revision',s.revision],['Saved carts',s.carts],['Original objects',s.objects]
  ]));
  else if(file.kind==='handoff')card.append(descriptionList([['Merchant',s.merchant],['Order',s.order],['Attempt',s.attempt],['Saved product',s.productId],['Store total',s.currency+' '+s.total]]));
  else card.append(descriptionList([['Receiving store',s.store],['Receiving checkout',s.checkout],['Reason',s.reason]]));
  if(alias!==undefined){
    const row=el('div',undefined,'cocart-alias-row'),id='alias-'+file.kind+'-'+file.sha256.slice(0,12)+'-'+alias;
    const label=el('label','Merchant alias');label.htmlFor=id;
    const field=el('input',undefined,'cocart-alias');field.id=id;field.value=alias;field.maxLength=64;field.spellcheck=false;field.autocomplete='off';
    field.addEventListener('input',()=>{aliasChange(field.value);changed();});row.append(label,field);card.append(row);
  }
  return card;
}
function renderFiles(){
  $('cocart-primary').replaceChildren(input.primary?fileCard(input.primary,{remove:()=>{
    input.primary=null;changed('Original primary source removed from this draft.');renderFiles();
  }}):el('p','Import the original native file to review its merchant, product and receiving history.','cocart-empty'));
  const named=$('cocart-named-inputs');named.replaceChildren();
  for(const [key,label]of [['handoffs','Woo handoff'],['receivingInputs','Additional receiving']]){
    input[key].forEach((row,index)=>{
      const title=el('p',label+' '+(index+1),'small-label');
      named.append(title,fileCard(row.file,{alias:row.alias,aliasChange:value=>{row.alias=value;},
        remove:()=>{input[key].splice(index,1);changed();renderFiles();}}));
    });
  }
  $('cocart-transport').replaceChildren(...(input.transport?[fileCard(input.transport,{remove:()=>{input.transport=null;changed();renderFiles();}})]:[]));
}
function uniqueAlias(file,key){
  const base=file.name.replace(/\.json$/i,'').replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)||'input';
  let alias=/^[A-Za-z0-9]/.test(base)?base:'input-'+base,index=2;
  const used=new Set(input[key].map(x=>x.alias));
  if(key==='receivingInputs'&&input.primary?.kind==='receiving')used.add('original');
  while(used.has(alias))alias=base+'-'+index++;
  return alias;
}
function choose(kind,target,multiple=false){if(busy)return;fileSelection={kind,target};const picker=$('cocart-file-input');picker.multiple=multiple;picker.value='';picker.click();}
async function consumeFiles(files){
  const selected=fileSelection;if(!selected||!files.length)return;
  const received=[];
  for(const file of files){
    if(file.size>MAX_FILE_BYTES)throw new Error(file.name+' exceeds the native 64 MiB input limit.');
    received.push(await readInputFile(new Uint8Array(await file.arrayBuffer()),file.name,selected.kind));
  }
  if(selected.target==='primary')input.primary=received[0];
  else if(selected.target==='transport')input.transport=received[0];
  else for(const file of received)input[selected.target].push({alias:uniqueAlias(file,selected.target),file});
  changed('Imported '+received.length+' original file'+(received.length===1?'':'s')+' with exact byte hashes.');renderFiles();
}
function showStep(index,{focus=true}={}){
  activeStep=index;
  for(let i=0;i<4;i++)$('cocart-pane-'+i).hidden=i!==index;
  document.querySelectorAll('[data-step]').forEach(node=>{
    if(Number(node.dataset.step)===index)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');
  });
  if(index===3)renderCommands();
  if(focus)$(['cocart-input-heading','cocart-host-heading','cocart-review-heading','cocart-run-heading'][index]).focus();
}
function inputTable(review){
  const wrapper=el('div',undefined,'cocart-table-wrap'),table=el('table',undefined,'cocart-table'),head=el('thead'),tr=el('tr');
  ['Original input','Role / alias','Bytes','SHA-256'].forEach(value=>tr.append(el('th',value)));head.append(tr);table.append(head);
  const body=el('tbody');
  review.files.forEach(row=>{const tr=el('tr');[row.file.name,row.role+(row.alias?' / '+row.alias:''),row.file.bytes.toLocaleString(),row.file.sha256].forEach(value=>tr.append(el('td',value)));body.append(tr);});
  table.append(body);wrapper.append(table);return wrapper;
}
async function renderReview(){
  const revision=editRevision,snapshot=structuredClone(input),review=await reviewSetup(snapshot);
  if(revision!==editRevision)throw new Error('The draft changed during review. Review its current settings again.');
  const box=$('cocart-review'),check=el('div',undefined,'cocart-check');
  check.append(el('h4','Original files checked'),el('p',review.files.length+' files · '+review.totalBytes.toLocaleString()+' input bytes. Native Inspect uses the full original validators on the selected host.'));
  const s=review.summary;
  box.replaceChildren(check,descriptionList([
    ['Mode',snapshot.primary.kind==='receiving'?'Receive the same customer workspace':'Create from the saved merchant profile'],
    ['Customer label',snapshot.label],['Merchant',s.merchant],['Native checkout',s.checkout],
    ['Mapped product',s.productId],['Store total',s.currency&&s.total!==null?s.currency+' '+s.total:null],
    ['Stellar route',s.route],['Method',s.method],['Seller resource',s.resource],['Network',s.network],
    ['Asset',s.asset],['Recipient',s.recipient],['Exact atomic amount',s.atomic],['Timeout seconds',s.timeout],
    ['Mapping saved at',s.approvedAt],['Original revision',s.revision],['Original workspace version',s.workspaceVersion],
    ['Customer directory',snapshot.workspaceDirectory],['SDK',snapshot.sdkModule||'Original installed SDK 1.2.1'],
    ['Private connection',snapshot.connectionFile||'Not selected'],['Merchant agent',snapshot.merchantDirectory||'Not selected']
  ]),inputTable(review));
  if(!s.productId)box.append(el('p','This source has no saved product mapping. The original cart application remains available; import the product’s saved mapped profile before using its Stellar checkout comparison.','cocart-check'));
  status('Current source files and host settings reviewed. Download the complete setup packet or continue to its native commands.');
  return {snapshot,review};
}
async function packet(){
  const revision=editRevision,snapshot=structuredClone(input);
  const value=await createPacket(snapshot,await runner());
  if(revision!==editRevision)throw new Error('The draft changed while preparing the packet. Download the current draft again.');
  return value;
}
function renderCommands(){
  const box=$('cocart-commands');box.replaceChildren();
  commands(input).forEach(row=>{
    const article=el('article',undefined,'cocart-command'),header=el('div',undefined,'cocart-command-header');
    header.append(el('h4',row.title),button('Copy',()=>work(async()=>{
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard access is unavailable. Select and copy the command text.');
      await navigator.clipboard.writeText(row.command);status('Command copied.');
    }),'text-button'));article.append(header,el('pre',row.command));box.append(article);
  });
  $('cocart-managed-settings').replaceChildren(descriptionList([
    ['Application','CoCart customer workspace'],['Customer directory',input.workspaceDirectory||'Choose the private customer directory'],
    ['SDK module',input.sdkModule||'Use the original installed SDK'],['Merchant connection',input.connectionFile||'Leave empty'],
    ['Workspace alias',input.connectionFile?input.workspaceAlias:'Leave empty'],['Local port','0']
  ]));
}
async function refreshSaved(){
  try{
    const saved=await listDrafts(),select=$('cocart-saved'),previous=select.value;
    select.replaceChildren(new Option('Choose a CoCart draft',''));
    saved.filter(row=>row.id.startsWith('cocart-')).forEach(row=>select.append(new Option(row.name+' · '+row.updatedAt.slice(0,19).replace('T',' '),row.id)));
    select.value=saved.some(row=>row.id===previous)?previous:'';
  }catch(error){status(error.message);}
}
async function persist(asNew=false){
  const currentEdit=editRevision,selected=asNew||!draftId?'cocart-'+crypto.randomUUID():draftId;
  const result=await saveDraft({id:selected,revision:asNew?0:savedRevision,input:structuredClone(input)});
  draftId=result.id;savedRevision=result.revision;savedAtRevision=currentEdit;metadata();await refreshSaved();$('cocart-saved').value=draftId;
  status('Saved this CoCart draft in the existing local merchant draft store. Download a draft JSON for a portable copy.');
}
async function loadSelected(){
  const id=$('cocart-saved').value;if(!id)throw new Error('Choose a saved CoCart draft.');
  const result=await loadDraft(id);if(!result)throw new Error('This saved draft is no longer available.');
  const restored=await importDraft(JSON.stringify(result.input));
  input=restored;draftId=result.id;savedRevision=result.revision;editRevision++;savedAtRevision=editRevision;
  syncFields();renderFiles();renderCommands();showStep(0);status('Reopened the original local draft and verified its retained input bytes.');
}
function restore(inputValue){
  input=inputValue;draftId=null;savedRevision=0;editRevision++;savedAtRevision=-1;
  syncFields();renderFiles();renderCommands();showStep(0);status('Draft reopened with its original files and host selections. Save it here to create a local edition.');
}
fields.forEach(field=>$('cocart-'+field).addEventListener('input',event=>{input[field]=event.target.value;changed();}));
document.querySelectorAll('[data-step],[data-next]').forEach(node=>node.addEventListener('click',()=>work(async()=>{
  const index=Number(node.dataset.step??node.dataset.next);showStep(index);if(index===2)await renderReview();
})));
$('cocart-choose-primary').addEventListener('click',()=>choose($('cocart-input-kind').value,'primary'));
$('cocart-choose-transport').addEventListener('click',()=>choose('transport','transport'));
$('cocart-add-handoff').addEventListener('click',()=>choose('handoff','handoffs',true));
$('cocart-add-receiving').addEventListener('click',()=>choose('receiving','receivingInputs',true));
$('cocart-file-input').addEventListener('change',event=>{const files=[...event.target.files];work(()=>consumeFiles(files));});
$('cocart-save').addEventListener('click',()=>work(()=>persist(false)));
$('cocart-save-new').addEventListener('click',()=>work(()=>persist(true)));
$('cocart-load-saved').addEventListener('click',()=>work(loadSelected));
$('cocart-new').addEventListener('click',()=>{if(!busy)restore(structuredClone(DEFAULT_INPUT));});
$('cocart-download-draft').addEventListener('click',()=>{download(JSON.stringify(input,null,2)+'\n',folder()+'-draft.json','application/json');status('Complete editable draft downloaded with the original input bytes.');});
$('cocart-open-draft').addEventListener('click',()=>{$('cocart-draft-input').value='';$('cocart-draft-input').click();});
$('cocart-draft-input').addEventListener('change',event=>work(async()=>{
  const file=event.target.files[0];if(!file)return;
  if(file.size>140*1024*1024)throw new Error('Choose a complete CoCart draft within the 140 MiB browser limit.');
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
  restore(await importDraft(text));
}));
$('cocart-review-again').addEventListener('click',()=>work(renderReview));
$('cocart-download-guide').addEventListener('click',()=>work(async()=>{
  const {snapshot,review}=await renderReview();download(installationGuide(snapshot,review),folder()+'-INSTALL.md','text/markdown');status('Complete installation, Applications and operating handover guide downloaded.');
}));
$('cocart-download-packet').addEventListener('click',()=>work(async()=>{
  const value=await packet();download(value.zip(),value.summary.folder+'-setup.zip','application/zip');
  status('Complete setup ZIP downloaded: native input bytes, exact manifest, original-tool runner and full installation handover.');
}));
$('cocart-plugin-download').addEventListener('click',()=>work(async()=>{
  const tool=await runner(),guide=[
    '# Original CoCart profile companion','',
    'Use the complete selected Stellar Forge checkout or installed source package. This runner copies its original profile-export.php companion and original guides.',
    '',
    '~~~sh','TOOLKIT=/absolute/path/to/checkout-or-installed-package',
    'node cocart.mjs plugin --toolkit "$TOOLKIT" --out /absolute/new/profile-plugin','~~~','',
    'Install the emitted starforge-cocart-profile.php in wp-content/plugins and activate it alongside the selected WooCommerce, CoCart Community 4.9.7 and original SF104 plugins.',
    'The existing WooCommerce setup page prepares the complete SF104 plugin and seller/delivery connection. Keep that original release selected.',
    'Save the actual simple virtual product and its merchant mapping. On that product choose Download saved headless profile, then import the exact JSON into the CoCart customer setup page.',''
  ].join('\n');
  download(zipWorkspace([{path:'cocart-profile-setup/cocart.mjs',content:tool},{path:'cocart-profile-setup/INSTALL.md',content:guide}]),
    'cocart-profile-setup.zip','application/zip');status('Original profile companion preparation downloaded. Run Plugin with your selected toolkit, then export the saved Woo product profile.');
}));
syncFields();renderFiles();renderCommands();refreshSaved();
