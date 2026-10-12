// MIT. Import complete local source bundles into the selected original question.
const element=(tag,text,className)=>{
  const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);
  if(className)node.className=className;return node;
};
const size=bytes=>bytes<1024?bytes+' B':bytes<1024*1024?(bytes/1024).toFixed(1)+' KiB':(bytes/(1024*1024)).toFixed(2)+' MiB';
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const base64=bytes=>{
  let value='';for(let at=0;at<bytes.length;at+=32768)value+=String.fromCharCode(...bytes.subarray(at,at+32768));
  return btoa(value);
};
const decode=file=>{
  if(file.encoding==='utf8')return new TextEncoder().encode(file.content);
  const text=atob(file.content),bytes=new Uint8Array(text.length);
  for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);return bytes;
};
function download(bytes,name,type){
  const url=URL.createObjectURL(new Blob([bytes],{type})),link=element('a');
  link.href=url;link.download=name;link.hidden=true;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export function renderSourceBundleFiles(root,content){
  root.replaceChildren();
  const visible=content&&Array.isArray(content.files)&&content.files.length>0&&content.files.every(file=>
    file&&typeof file.name==='string'&&typeof file.content==='string'&&['utf8','base64'].includes(file.encoding));
  root.hidden=!visible;if(!visible)return false;
  if(content.summary)root.append(element('p',content.summary,'source-bundle-summary'));
  root.append(element('p',content.files.length+' original file'+(content.files.length===1?'':'s'),'muted small'));
  for(const file of content.files){
    const row=element('article',undefined,'source-bundle-file'),heading=element('div',undefined,'source-bundle-file-heading');
    const details=element('div');details.append(element('strong',file.name),element('span',size(file.bytes)+' · '+(file.mediaType??'Original file'),'muted small'));
    const button=element('button','Download','compact');button.type='button';
    button.addEventListener('click',()=>download(decode(file),file.name.split('/').at(-1),file.mediaType??'application/octet-stream'));
    heading.append(details,button);row.append(heading);
    const readable=file.encoding==='utf8'||/^(text\/|application\/(json|xml))/.test(file.mediaType??'')||
      /\.(md|txt|csv|tsv|tab|json|xml|html|svg|py|js|mjs|css)$/i.test(file.name);
    if(readable){
      const disclosure=element('details'),summary=element('summary','Read complete text');disclosure.append(summary);
      disclosure.addEventListener('toggle',()=>{
        disclosure.querySelector('pre')?.remove();
        if(disclosure.open){
          let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(decode(file));}
          catch{text='This original file uses another text encoding. Download it to open with the appropriate reader.';}
          disclosure.append(element('pre',text,'source-bundle-file-text'));
        }
      });row.append(disclosure);
    }
    root.append(row);
  }return true;
}
export function createSourceBundlePanel({root,openButton,api,task,notify,getDossier,isBusy,onReceived}){
  const $=id=>root.querySelector('#'+id),form=$('source-bundle-form');
  let reviewed=null,preparedText=null,editVersion=0,currentDossierId=null;
  const selectedMode=()=>form.querySelector('[name=sourceBundleMode]:checked').value;
  const invalidate=()=>{
    reviewed=null;preparedText=null;editVersion++;$('source-bundle-review').replaceChildren();
    $('source-bundle-receive').disabled=true;$('source-bundle-save-file').disabled=true;
  };
  const mode=()=>{
    invalidate();const folder=selectedMode()==='folder';
    $('source-bundle-original-fields').hidden=folder;$('source-bundle-folder-fields').hidden=!folder;
  };
  const fillQuestions=()=>{
    const selected=$('source-bundle-question').value,view=getDossier();
    $('source-bundle-question').replaceChildren(...(view?.questions??[]).map(question=>{
      const option=element('option',question.text);option.value=question.id;return option;
    }));
    if((view?.questions??[]).some(q=>q.id===selected))$('source-bundle-question').value=selected;
    $('source-bundle-empty').hidden=Boolean(view?.questions?.length);
    $('source-bundle-preview').disabled=isBusy()||!view?.questions?.length;
  };
  const originalFile=async(file,name=file.name)=>{
    const bytes=new Uint8Array(await file.arrayBuffer());
    return {name,bytes:bytes.length,sha256:await sha(bytes),encoding:'base64',
      mediaType:file.type||'application/octet-stream',content:base64(bytes)};
  };
  async function sourceText(){
    if(selectedMode()==='bundle'){
      const file=$('source-bundle-file').files[0];
      if(!file)throw new Error('Choose a source bundle file.');
      if(file.size>64*1024*1024)throw new Error('The source bundle exceeds 64 MiB.');
      return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
    }
    const manifestFile=$('source-bundle-manifest').files[0],selected=Array.from($('source-bundle-folder').files);
    if(!manifestFile||!selected.length)throw new Error('Choose the source manifest and its original folder.');
    if(manifestFile.size>1024*1024)throw new Error('The source manifest exceeds 1 MiB.');
    const manifestOriginal=await originalFile(manifestFile);
    const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(manifestOriginal)));
    if(manifest.schema!=='sf88-research-source-manifest-v1'||!Array.isArray(manifest.sources))
      throw new Error('Choose a research source manifest.');
    const wanted=new Set(manifest.sources.flatMap(source=>source.files??[])),available=new Map();
    for(const file of selected){
      const full=file.webkitRelativePath||file.name;
      const relative=file.webkitRelativePath?full.slice(full.indexOf('/')+1):full;
      if(available.has(relative))throw new Error('Two selected files have the same relative name: '+relative);
      available.set(relative,file);
    }
    let total=0;const files=[];
    for(const name of wanted){
      const file=available.get(name);if(!file)throw new Error('The selected folder is missing '+name);
      total+=file.size;if(total>48*1024*1024)throw new Error('The selected original files exceed 48 MiB.');
      files.push(await originalFile(file,name));
    }
    const rawText=JSON.stringify({schema:'sf88-research-source-bundle-v1',manifest,manifestOriginal,files})+'\n';
    if(new TextEncoder().encode(rawText).length>64*1024*1024)throw new Error('The complete source bundle exceeds 64 MiB.');
    return rawText;
  }
  function renderReview(result){
    const target=$('source-bundle-review');target.replaceChildren();
    target.append(element('h3',result.label),element('p',result.fileCount+' files · '+size(result.fileBytes)+
      ' · '+result.sources.length+' sources · '+result.findings.length+' findings','source-bundle-counts'));
    const terms=element('details');terms.append(element('summary','Source terms'),element('p',result.sourceTerms));target.append(terms);
    for(const source of result.sources){
      const row=element('article',undefined,'source-bundle-review-source');
      row.append(element('strong',source.title),element('p',source.fileCount+' files · '+
        (source.selected?'Selected evidence':'Available source')+' · '+source.classification,'muted small'));
      if(source.url||source.doi)row.append(element('p',source.doi||source.url,'muted small'));
      if(source.note)row.append(element('p',source.note));
      target.append(row);
    }
    for(const finding of result.findings){
      const row=element('details');row.append(element('summary',finding.title),element('p',finding.text),
        element('p','Sources: '+finding.sourceKeys.join(', '),'muted small'));target.append(row);
    }
    if(result.alreadyReceived)target.append(element('p','This complete bundle is already saved in this question. Import will reopen its current saved result.'));
  }
  $('source-bundle-preview').addEventListener('click',()=>task(async()=>{
    const version=editVersion,view=getDossier(),questionId=$('source-bundle-question').value;
    if(!view||!questionId)throw new Error('Add or select a research question first.');
    const rawText=await sourceText();
    const result=await api('/api/dossiers/'+encodeURIComponent(view.id)+'/source-bundles/preview',
      {method:'POST',body:{questionId,rawText}});
    if(version!==editVersion||getDossier()?.id!==view.id||$('source-bundle-question').value!==questionId)return;
    reviewed={...result,dossierId:view.id,questionId};preparedText=rawText;
    renderReview(result);updateBusy();notify('Source bundle ready: '+result.fileCount+' files and '+result.findings.length+' findings.');
  },form));
  form.addEventListener('submit',event=>{
    event.preventDefault();
    task(async()=>{
      if(!reviewed||!preparedText)throw new Error('Choose and preview the source bundle first.');
      const saved=reviewed,rawText=preparedText,version=editVersion;
      if(getDossier()?.id!==saved.dossierId||$('source-bundle-question').value!==saved.questionId)
        throw new Error('The selected research question changed. Preview the bundle for this question.');
      const view=await api('/api/dossiers/'+encodeURIComponent(saved.dossierId)+'/source-bundles/receive',
        {method:'POST',body:{questionId:saved.questionId,rawText,expectedRevision:saved.expectedRevision,
          expectedBundleSha256:saved.bundleSha256}});
      await onReceived(view);
      if(version===editVersion){root.close();invalidate();}
      notify(saved.fileCount+' original files and '+saved.findings.length+' findings saved together.');
    },form);
  });
  $('source-bundle-save-file').addEventListener('click',()=>{
    if(preparedText)download(new TextEncoder().encode(preparedText),'research-sources.json','application/json');
  });
  form.querySelectorAll('input,select').forEach(input=>input.addEventListener('change',
    ()=>input.name==='sourceBundleMode'?mode():invalidate()));
  function updateBusy(){
    $('source-bundle-preview').disabled=isBusy()||!getDossier()?.questions?.length;
    $('source-bundle-receive').disabled=isBusy()||!reviewed;
    $('source-bundle-save-file').disabled=isBusy()||!preparedText;
  }
  openButton.addEventListener('click',()=>{
    if(isBusy()||!getDossier())return;
    fillQuestions();root.showModal();updateBusy();
  });
  return {setDossier(view){
    if(view?.id!==currentDossierId){currentDossierId=view?.id??null;invalidate();}
    fillQuestions();updateBusy();
  },updateBusy};
}
