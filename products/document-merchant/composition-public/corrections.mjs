// MIT. Correct selected saved documents and purchase their replacements on the original host.
const $=id=>document.getElementById(id);
const node=(tag,text)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;return item;};
const copy=value=>structuredClone(value);
export function installDocumentCorrections({api,guard,start,onOpen}){
  let parent=null,selected=new Map(),draft=null,recordIndex=0,epoch=0,busy=false;
  function originalKey(value){return value?.id+'|'+value?.sourceSha256;}
  function selectedStatus(){
    $('correction-count').textContent=selected.size+' documents selected across saved pages';
    for(const id of ['correct-selected','repeat-selected'])$(id).disabled=busy||selected.size===0;
  }
  function observe(value){
    if(originalKey(value)!==originalKey(parent)){
      parent=value;selected.clear();draft=null;epoch++;$('correction-editor').hidden=true;
    }else parent=value;
    selectedStatus();
    const lineage=value.request?.correction,box=$('correction-lineage');box.replaceChildren();box.hidden=!lineage;
    if(lineage){
      box.append(node('strong',lineage.mode==='repeat'?'Repeat of saved documents':'Correction of saved documents'),
        node('p',lineage.reason),node('p','Original set: '+lineage.parent.id+' · '+lineage.documents.length+' selected documents'));
      const open=node('button','Open original document set');open.type='button';
      open.addEventListener('click',()=>guard(()=>onOpen(lineage.parent.id)));
      box.append(open);
    }
  }
  function checkbox(item){
    const label=node('label'),input=node('input');input.type='checkbox';input.checked=selected.has(item.id);
    input.setAttribute('aria-label','Select '+item.label+' for correction or repeat');
    input.addEventListener('change',()=>{if(input.checked)selected.set(item.id,item);else selected.delete(item.id);selectedStatus();});
    label.append(input,node('span',' Select'));return label;
  }
  function readDetails(){
    if(!draft)throw Error('Load the selected saved records first.');
    draft.id=$('correction-id').value.trim();draft.name=$('correction-name').value.trim();
    draft.reason=$('correction-reason').value.trim();return draft;
  }
  function fieldPath(parts){
    return parts.map((key,index)=>/^\d+$/.test(key)?'['+key+']':(index?'.':'')+key).join('');
  }
  function fields(){
    const root=$('correction-fields');root.replaceChildren();
    if(!draft)return;
    let count=0;
    const visit=(value,path)=>{
      if(value!==null&&typeof value==='object'){
        for(const key of Object.keys(value))visit(value[key],[...path,key]);return;
      }
      if(++count>500)return;
      const label=node('label',fieldPath(path)),input=node('input');
      input.type=typeof value==='boolean'?'checkbox':'text';input.disabled=draft.mode==='repeat'||busy;
      if(typeof value==='boolean')input.checked=value;else input.value=value===null?'null':String(value);
      input.addEventListener('change',()=>guard(async()=>{
        let next=input.type==='checkbox'?input.checked:input.value;
        if(typeof value==='number'){
          if(next.trim()===''||!Number.isFinite(Number(next))||
            Number.isInteger(Number(next))&&!Number.isSafeInteger(Number(next)))throw Error('Use an exact finite number for '+fieldPath(path)+'.');
          next=Number(next);
        }else if(value===null){try{next=JSON.parse(next);}catch{throw Error('Enter a JSON value for '+fieldPath(path)+'.');}
          if(next!==null&&typeof next==='object')throw Error('Edit structured values in the complete record editor.');}
        let target=draft.records[recordIndex];
        for(const key of path.slice(0,-1))target=target[key];
        Object.defineProperty(target,path.at(-1),{value:next,enumerable:true,writable:true,configurable:true});
        $('correction-record-json').value=JSON.stringify(draft.records[recordIndex],null,2);
      }));
      label.append(input);root.append(label);
    };
    visit(draft.records[recordIndex],[]);
    if(count>500)root.append(node('p','This record has more than 500 fields. The complete record editor below includes every field.'));
    $('correction-record-json').value=JSON.stringify(draft.records[recordIndex],null,2);
    $('correction-record-json').disabled=draft.mode==='repeat'||busy;
    $('correction-apply-json').disabled=draft.mode==='repeat'||busy;
  }
  function draw(){
    $('correction-editor').hidden=false;
    $('correction-editor-title').textContent=draft.mode==='repeat'?'Repeat selected documents':'Correct selected documents';
    $('correction-id').value=draft.id;$('correction-name').value=draft.name;$('correction-reason').value=draft.reason;
    $('correction-original').textContent=draft.parent.id+' · '+draft.documentIds.length+' documents · source SHA256 '+draft.parent.sourceSha256;
    const select=$('correction-record');select.replaceChildren();
    draft.records.forEach((record,index)=>{const option=node('option','Record '+(index+1));option.value=String(index);select.append(option);});
    recordIndex=0;select.value='0';fields();
    const templates=$('correction-templates');templates.replaceChildren();
    for(const [id,body]of Object.entries(draft.templates)){
      const details=node('details'),summary=node('summary','Template '+id),area=node('textarea');
      area.rows=14;area.spellcheck=false;area.value=body;area.disabled=draft.mode==='repeat'||busy;
      area.setAttribute('aria-label','Complete '+id+' template');
      area.addEventListener('input',()=>{draft.templates[id]=area.value;});
      details.append(summary,area);templates.append(details);
    }
    $('correction-editor').scrollIntoView({block:'start',behavior:'smooth'});
  }
  async function begin(mode){
    if(!parent||!selected.size)throw Error('Select the original documents first.');
    const original=parent,version=++epoch;
    busy=true;selectedStatus();
    try{
      const suffix='-'+(mode==='repeat'?'repeat':'fix')+'-'+Date.now().toString(36);
      const result=await api('correction-draft',{method:'POST',body:{
        id:original.id,sourceSha256:original.sourceSha256,documentIds:[...selected.keys()],
        newId:original.id.slice(0,64-suffix.length)+suffix,
        name:original.name.slice(0,175)+(mode==='repeat'?' — repeat':' — correction'),mode,
        reason:mode==='repeat'?'Repeat the selected saved documents.':'Correct the selected document source.'}});
      if(version!==epoch||originalKey(parent)!==originalKey(original))return;
      draft=result;busy=false;draw();
    }finally{busy=false;selectedStatus();}
  }
  function saveDraft(){
    const value=readDetails(),blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=value.id+'-draft.json';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('correct-selected').addEventListener('click',()=>guard(()=>begin('correction')));
  $('repeat-selected').addEventListener('click',()=>guard(()=>begin('repeat')));
  $('correction-select-page').addEventListener('click',()=>{
    for(const item of parent?.documents??[])selected.set(item.id,item);
    for(const input of $('document-rows').querySelectorAll('input[type="checkbox"]'))input.checked=true;
    selectedStatus();
  });
  $('correction-clear').addEventListener('click',()=>{
    selected.clear();for(const input of $('document-rows').querySelectorAll('input[type="checkbox"]'))input.checked=false;selectedStatus();
  });
  $('correction-record').addEventListener('change',()=>{recordIndex=Number($('correction-record').value);fields();});
  $('correction-apply-json').addEventListener('click',()=>guard(async()=>{
    if(!draft||draft.mode!=='correction')throw Error('Select a correction draft to edit its complete record.');
    const record=JSON.parse($('correction-record-json').value);
    if(!record||Array.isArray(record)||typeof record!=='object')throw Error('Retain the complete record object.');
    draft.records[recordIndex]=record;fields();
  }));
  $('correction-save-draft').addEventListener('click',()=>guard(async()=>saveDraft()));
  $('correction-import').addEventListener('change',()=>guard(async()=>{
    const file=$('correction-import').files[0];if(!file)return;
    if(file.size<1||file.size>32*1048576)throw Error('Select a complete correction draft of at most 32 MiB.');
    const value=JSON.parse(await file.text());
    if(value.schema!=='stellar-forge.document-correction-draft.v1'||!parent||
      value.parent?.id!==parent.id||value.parent?.sourceSha256!==parent.sourceSha256||
      !Array.isArray(value.records)||!value.records.length||!value.templates||!Array.isArray(value.documentIds))
      throw Error('Open the matching original document set and select its complete saved correction draft.');
    epoch++;draft=value;draw();
  }));
  $('correction-form').addEventListener('submit',event=>{event.preventDefault();guard(async()=>{
    if(busy)throw Error('The selected document source is still loading.');
    const value=copy(readDetails());
    if(originalKey(value.parent?{id:value.parent.id,sourceSha256:value.parent.sourceSha256}:null)!==originalKey(parent))
      throw Error('Reopen the original document set before preparing this correction.');
    busy=true;$('correction-stage').disabled=true;
    try{await start('correct',{id:value.id,draft:value});}
    finally{busy=false;$('correction-stage').disabled=false;}
  });});
  return Object.freeze({observe,checkbox,hide(){epoch++;parent=null;selected.clear();draft=null;$('correction-editor').hidden=true;}});
}
