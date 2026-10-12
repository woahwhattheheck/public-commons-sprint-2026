// MIT. Complete declared customer profile editor on the original request journal.
import { label, dateText, properties, technicalDetails, historyCard } from '/presentation.mjs';
export function createSupplierOrderProfileDesk({api,mutate,guard,message,getWorkspace,refreshWorkspace}){
  const $=id=>document.getElementById(id),clone=value=>JSON.parse(JSON.stringify(value)),json=value=>JSON.stringify(value,null,2);
  let selection=null,working=null,dirty=false,historyOffset=0,historyPage=null,sequence=0,historySequence=0,editorGeneration=0,conflictingRequest=null;
  const textFields={
    'profile-id':['id'],'profile-title-input':['title'],'profile-reference':['declaration','reference'],
    'profile-url':['declaration','url'],'profile-source-sha':['declaration','sourceSha256'],'profile-notes':['declaration','notes']
  };
  const flags={
    'profile-identity-fallback':['supplierIdentity','allowUniqueFallback'],'profile-response-inherit':['supplierIdentity','inheritOrderResponse'],
    'profile-invoice-tax':['validation','invoiceTaxRate'],'profile-invoice-delivery':['validation','invoiceDeliveryReference'],
    'profile-confirmation-warning':['validation','confirmationDeliveryWarning'],'profile-tracking-warning':['validation','dispatchTrackingWarning']
  };
  const nested=(value,path)=>path.reduce((row,key)=>row?.[key],value);
  const assign=(value,path,next)=>{let row=value;for(const key of path.slice(0,-1))row=row[key];row[path.at(-1)]=next;};
  const lines=value=>value.split(/\r?\n/).filter(line=>line!=='');
  const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
  function requireShape(p){
    if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('Select a complete profile JSON object.');
    for(const name of ['declaration','supplierIdentity','confirmation','serials','validation'])if(!p[name]||typeof p[name]!=='object'||Array.isArray(p[name]))throw new Error('The complete declaration needs its '+name+' object.');
    for(const [id,path]of Object.entries(textFields)){const value=nested(p,path);if(typeof value!=='string'&&!(value===null&&['profile-url','profile-source-sha'].includes(id)))throw new Error('Keep the complete '+($(id).closest('label')?.firstChild?.textContent?.trim()??label(path.at(-1)))+' value.');}
    for(const path of Object.values(flags))if(typeof nested(p,path)!=='boolean')throw new Error('Keep explicit Boolean profile settings.');
    for(const [name,value]of Object.entries({identity:p.supplierIdentity.partyIdTypes,currencies:p.validation.currencies,units:p.validation.units,parties:p.validation.invoiceParties}))if(!Array.isArray(value)||value.some(item=>typeof item!=='string'||!item.trim()))throw new Error('Keep the complete '+name+' array of exact strings.');
    if(!Array.isArray(p.validation.requiredFields)||!Number.isSafeInteger(p.revision)||!Number.isSafeInteger(p.orderIdMaximum))throw new Error('Keep complete required-field rules and integer profile revision/limit values.');
    if(!['cancel','reject'].includes(p.confirmation.negativeQuantity)||!['retain','require-complete'].includes(p.confirmation.omittedLines)||!['unite-number','opaque'].includes(p.serials.remarks))throw new Error('Select a supported explicit confirmation and serial interpretation.');
  }
  function fill(profile){
    requireShape(profile);working=clone(profile);
    for(const [id,path]of Object.entries(textFields))$(id).value=nested(working,path)??'';
    for(const [id,path]of Object.entries(flags))$(id).checked=nested(working,path);
    $('profile-revision').value=String(working.revision);$('profile-order-limit').value=String(working.orderIdMaximum);
    $('profile-identity-types').value=working.supplierIdentity.partyIdTypes.join('\n');
    $('profile-negative').value=working.confirmation.negativeQuantity;$('profile-omitted').value=working.confirmation.omittedLines;$('profile-serials').value=working.serials.remarks;
    $('profile-currencies').value=working.validation.currencies.join('\n');$('profile-units').value=working.validation.units.join('\n');
    for(const role of ['buyer','supplier','invoice'])$('profile-party-'+role).checked=working.validation.invoiceParties.includes(role);
    $('profile-required-fields').value=json(working.validation.requiredFields);$('profile-complete').textContent=json(working);
  }
  function collect(){
    if(!working)throw new Error('Open or create a complete profile first.');
    const value=clone(working);
    for(const [id,path]of Object.entries(textFields))assign(value,path,['profile-url','profile-source-sha'].includes(id)?($(id).value||null):$(id).value);
    for(const [id,path]of Object.entries(flags))assign(value,path,$(id).checked);
    for(const [id,key]of [['profile-revision','revision'],['profile-order-limit','orderIdMaximum']]){
      if(!/^[1-9][0-9]*$/.test($(id).value)||!Number.isSafeInteger(Number($(id).value)))throw new Error('Use a positive whole number for '+(key==='revision'?'the declared revision':'the order ID character limit')+'.');value[key]=Number($(id).value);
    }
    value.supplierIdentity.partyIdTypes=lines($('profile-identity-types').value);
    value.confirmation.negativeQuantity=$('profile-negative').value;value.confirmation.omittedLines=$('profile-omitted').value;value.serials.remarks=$('profile-serials').value;
    value.validation.currencies=lines($('profile-currencies').value);value.validation.units=lines($('profile-units').value);
    value.validation.invoiceParties=['buyer','supplier','invoice'].filter(role=>$('profile-party-'+role).checked);
    try{value.validation.requiredFields=JSON.parse($('profile-required-fields').value);}catch{throw new Error('Keep the complete required-field array as valid JSON.');}
    if(!Array.isArray(value.validation.requiredFields))throw new Error('Required-field rules must be a JSON array.');
    return value;
  }
  function render(){
    if(!selection)return;
    const summary=$('profile-current');summary.replaceChildren();
    summary.append(text('h3',selection.profile.title),text('p','Declaration revision '+selection.profile.revision+(selection.selectedAt?' · selected '+dateText(selection.selectedAt):'')),
      text('p',selection.profile.declaration.reference));
    const rules=document.createElement('div');properties(rules,[
      ['Negative confirmation quantities',selection.profile.confirmation.negativeQuantity==='cancel'?'Cancel that many ordered units':'Require review before changing quantities'],
      ['Omitted confirmation lines',selection.profile.confirmation.omittedLines==='retain'?'Keep the current line state':'Require every original order line'],
      ['Currencies',selection.profile.validation.currencies.length?selection.profile.validation.currencies:'Original document currencies'],
      ['Units',selection.profile.validation.units.length?selection.profile.validation.units:'Original document units']
    ]);summary.append(rules,technicalDetails('Profile identity and complete selection',selection),
      text('p',selection.canSelect?'Select the agreed declaration before receiving the first business document.':'This workspace uses the declaration selected with its business documents. Start an empty workspace to use a different interface.'));
    const configuration=$('profile-configuration');
    if(configuration.dataset.editable!==String(selection.canSelect)){configuration.open=selection.canSelect||dirty;configuration.dataset.editable=String(selection.canSelect);}
    if(dirty)configuration.open=true;
    $('profile-fields').disabled=!selection.canSelect;
    $('transport-order-id').maxLength=selection.profile.orderIdMaximum;
    for(const id of ['profile-from-standard','profile-from-unite','profile-load-file'])$(id).disabled=!selection.canSelect;
    $('profile-save').disabled=!selection.canSelect||!working;
    $('profile-editor-state').textContent=dirty?'Unsaved declaration edits are retained in this open editor.':'The displayed fields reflect the retained declaration.';
    $('profile-inline').textContent='Profile: '+selection.profile.title+' · revision '+selection.profile.revision;
    $('source-profile').textContent='Selected profile: '+selection.profile.title+' · revision '+selection.profile.revision;
  }
  function setWorkspace(workspace){
    if(!workspace?.profile)return;selection=clone(workspace.profile);if(!dirty)fill(selection.profile);render();
  }
  async function readCurrent({replace=false}={}){
    const number=++sequence,generation=editorGeneration,current=await api('/profile');if(number!==sequence)return;
    selection=current;
    if((replace||!working||!dirty)&&generation===editorGeneration){fill(current.profile);dirty=false;$('profile-reason').value='';editorGeneration++;}
    else if(replace&&generation!==editorGeneration)message('Newer declaration edits remain in the editor. Discard again only if you intend to replace them.');
    render();
  }
  async function open(){await readCurrent();if(!$('profile-dialog').open)$('profile-dialog').showModal();await history();}
  async function history(){
    const expected=++historySequence,page=await api('/profile/history?offset='+historyOffset+'&limit=20');if(expected!==historySequence)return;
    historyPage=page;const list=$('profile-history');list.replaceChildren();
    if(!page.items.length)list.append(text('p','The default Unite profile is active. Selecting a customer declaration or receiving a customer profile adds its history here.'));
    for(const operation of page.items){const item=operation.result?.profileSelection??operation.result?.profile?.sourceSelection;
      list.append(historyCard({title:(item?.profile?.title??'Customer profile received')+' · '+label(operation.state),
        at:item?.selectedAt??operation.updatedAt??operation.createdAt,reason:item?.reason??operation.request?.reason,
        rows:[['Declaration revision',item?.profile?.revision],['Interface reference',item?.profile?.declaration?.reference]],record:operation}));}
    $('profile-history-page').textContent=page.total?(page.offset+1)+'–'+(page.offset+page.items.length)+' of '+page.total:'0 explicit selections';
    $('profile-history-previous').disabled=page.offset===0;$('profile-history-next').disabled=page.offset+page.items.length>=page.total;
  }
  async function template(base){
    if(dirty)throw new Error('Use Discard edits before replacing the current declaration with another template.');
    await readCurrent();if(!selection.canSelect)throw new Error('Use an empty workspace for another declared interface.');
    if(dirty)throw new Error('Your newer declaration edits remain in the editor. Discard them explicitly before loading a template.');
    const generation=editorGeneration,value=await api('/profile/template?base='+base);
    if(generation!==editorGeneration||dirty)throw new Error('Your newer declaration edits remain in the editor; the template did not replace them.');
    fill(value);editorGeneration++;dirty=true;render();
    message('Complete the real customer interface reference, original source identity and agreed rules before selecting this declaration.');
  }
  async function save(){
    if(!selection?.canSelect)throw new Error('This workspace already retains its business profile.');
    const profile=collect(),reason=$('profile-reason').value;if(!reason.trim())throw new Error('Explain the reviewed profile selection.');
    working=clone(profile);$('profile-complete').textContent=json(profile);
    return mutate('profile-select','/profile',{profile,reason,expectedProfileSha256:selection.profileSha256,expectedSelectionRevision:selection.revision});
  }
  async function loadFile(){
    if(dirty)throw new Error('Use Discard edits before replacing the working declaration.');
    if(!selection?.canSelect)throw new Error('Use an empty workspace for another customer profile.');
    const file=$('profile-file').files[0];if(!file||file.size<1||file.size>32768)throw new Error('Select the complete declaration JSON of up to 32 KiB.');
    const generation=editorGeneration;let value;try{value=JSON.parse(await file.text());}catch{throw new Error('Select complete UTF-8 profile JSON.');}requireShape(value);
    if(generation!==editorGeneration||dirty||$('profile-file').files[0]!==file)throw new Error('The declaration or selected file changed while reading. Your newer edits remain.');
    fill(value);editorGeneration++;dirty=true;render();
  }
  function download(){
    if(!selection)throw new Error('Open the retained declaration first.');
    const blob=new Blob([json(selection.profile)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=selection.profile.id+'-r'+selection.profile.revision+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('open-profile').addEventListener('click',guard(open));
  $('profile-form').addEventListener('submit',guard(save));
  $('profile-fields').addEventListener('input',()=>{editorGeneration++;dirty=true;render();try{$('profile-complete').textContent=json(collect());}catch{}});
  $('profile-from-standard').addEventListener('click',guard(()=>template('standard')));$('profile-from-unite').addEventListener('click',guard(()=>template('unite')));
  $('profile-conflict-load').addEventListener('click',guard(()=>{
    if(!conflictingRequest)return;fill(conflictingRequest.body.profile);$('profile-reason').value=conflictingRequest.body.reason;
    editorGeneration++;dirty=true;render();message('The explicitly selected earlier declaration is open for review.');
  }));
  $('profile-discard').addEventListener('click',guard(()=>readCurrent({replace:true})));
  $('profile-load-file').addEventListener('click',guard(loadFile));$('profile-download').addEventListener('click',guard(download));
  $('profile-history-previous').addEventListener('click',guard(async()=>{historyOffset=Math.max(0,historyOffset-20);await history();}));
  $('profile-history-next').addEventListener('click',guard(async()=>{historyOffset+=historyPage?.items.length??20;await history();}));
  return{setWorkspace,open,isDirty:()=>dirty,
    async receiveResult(result,request){const generation=editorGeneration;let preserve=false;try{preserve=dirty&&(json(collect())!==json(request.body.profile)||$('profile-reason').value!==request.body.reason);}catch{preserve=dirty;}if(!preserve)dirty=false;await refreshWorkspace();preserve=preserve||generation!==editorGeneration;await readCurrent({replace:!preserve});await history();message(preserve?'The original declaration is selected. Your newer unsaved fields remain in the editor for review.':'The complete customer declaration is selected and retained in its original operation.');},
    async reviewRequest(request){
      conflictingRequest=clone(request);$('profile-conflict-json').textContent=json(request);$('profile-conflict').hidden=false;
      let newer=dirty;try{newer=dirty&&(json(collect())!==json(request.body.profile)||$('profile-reason').value!==request.body.reason);}catch{}
      if(!newer){fill(request.body.profile);$('profile-reason').value=request.body.reason;editorGeneration++;dirty=true;}
      await readCurrent();if(!$('profile-dialog').open)$('profile-dialog').showModal();
      message(newer?'Your newer declaration fields remain. Compare the complete earlier request below before choosing whether to load it.':'The earlier declaration remains in the editor. Compare the actual current selection before another save.');
    }
  };
}
