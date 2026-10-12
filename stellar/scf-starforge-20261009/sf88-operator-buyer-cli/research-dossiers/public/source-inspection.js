// MIT. Read selected original source bytes only when the analyst opens or downloads them.
const element=(tag,text,className)=>{
  const value=document.createElement(tag);if(text!==undefined)value.textContent=String(text);
  if(className)value.className=className;return value;
};
const size=bytes=>bytes<1024?bytes+' B':bytes<1024*1024?(bytes/1024).toFixed(1)+' KiB':(bytes/(1024*1024)).toFixed(2)+' MiB';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
  value=>value.toString(16).padStart(2,'0')).join('');
const route=(dossierId,selection,part,revision,parameters={})=>{
  const query=new URLSearchParams({revision:String(revision),...parameters});
  return '/api/dossiers/'+encodeURIComponent(dossierId)+'/retained-editions/'+encodeURIComponent(selection.editionId)+
    '/occurrences/'+encodeURIComponent(selection.key)+'/'+part+'?'+query;
};
async function originalBytes(api,path,expectedSha256,expectedBytes){
  const response=await api(path,{download:true}),bytes=new Uint8Array(await response.arrayBuffer());
  if(expectedBytes!==undefined&&bytes.length!==expectedBytes||await digest(bytes)!==expectedSha256)
    throw Object.assign(new Error('The selected original file changed.'),{code:'RESEARCH_SOURCE_FILE_CHANGED'});
  return {bytes,type:response.headers.get('content-type')??'application/octet-stream'};
}
function download(bytes,name,type){
  const url=URL.createObjectURL(new Blob([bytes],{type})),link=element('a');
  link.href=url;link.download=name;link.hidden=true;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function button(label,action,task){
  const value=element('button',label,'compact');value.type='button';
  value.addEventListener('click',()=>task(action));return value;
}
export function renderOriginalRecordControl({root,citation,dossierId,revision,api,task,notify}){
  const record=citation.originalRecord;
  if(!record||!citation.retained)return;
  root.append(button('Download original result record',async()=>{
    const value=await originalBytes(api,route(dossierId,citation,'record',revision,{sha256:record.sha256}),record.sha256,record.bytes);
    download(value.bytes,citation.editionId+'-'+citation.key+'-record.json',value.type);
    notify('Original result record downloaded.');
  },task));
}
/** Returns true when the source uses the explicit compact inspection contract. */
export function renderInspectedSource({filesRoot,excerpt,source,variant,dossierId,revision,api,task,notify}){
  const inspection=variant?variant.inspection:source.inspection;
  if(inspection?.schema!=='sf88-research-source-inspection-v1')return false;
  filesRoot.replaceChildren();filesRoot.hidden=false;
  const content=variant?variant.content:source.content,selection=inspection.selection;
  const files=inspection.files??[];
  excerpt.hidden=files.length>0;
  if(!files.length){
    excerpt.textContent=content===null||content===undefined?
      'Full structured content is available as a JSON download.':
      typeof content==='string'?content:JSON.stringify(content,null,2);
    excerpt.classList.toggle('typed-content',content!==null&&typeof content==='object');
    if(!inspection.complete)filesRoot.append(element('p','Preview · complete content '+size(inspection.bytes),'muted small'));
  }else{
    if(content?.summary)filesRoot.append(element('p',content.summary,'source-bundle-summary'));
    filesRoot.append(element('p',files.length+' original file'+(files.length===1?'':'s'),'muted small'));
  }
  if(!selection?.retained){
    filesRoot.append(element('p','Open this source through its original provider edition.','muted small'));
    return true;
  }
  for(const file of files){
    const row=element('article',undefined,'source-bundle-file'),heading=element('div',undefined,'source-bundle-file-heading');
    const details=element('div');details.append(element('strong',file.name),
      element('span',size(file.bytes)+' · '+(file.mediaType??'Original file'),'muted small'));
    const fileRoute=route(dossierId,selection,'file',revision,{name:file.name,sha256:file.sha256});
    const actions=element('div',undefined,'button-row');
    actions.append(button('Download',async()=>{
      const value=await originalBytes(api,fileRoute,file.sha256,file.bytes);
      download(value.bytes,file.name.split('/').at(-1),value.type);notify('Downloaded '+file.name+'.');
    },task));
    const readable=file.encoding==='utf8'||/^(text\/|application\/(json|xml))/.test(file.mediaType??'')||
      /\.(md|txt|csv|tsv|tab|json|xml|html|svg|py|js|mjs|css)$/i.test(file.name);
    if(readable){
      let opened=false;
      actions.append(button('Read text',async()=>{
        const prior=row.querySelector('pre');
        if(opened){prior?.remove();opened=false;return;}
        const value=await originalBytes(api,fileRoute,file.sha256,file.bytes);
        let text;
        try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(value.bytes);}
        catch{notify('Download this file to open its original text encoding.');return;}
        row.append(element('pre',text,'source-bundle-file-text'));opened=true;
      },task));
    }
    heading.append(details,actions);row.append(heading);filesRoot.append(row);
  }
  filesRoot.append(button(files.length?'Download content JSON':'Download complete content',async()=>{
    const value=await originalBytes(api,route(dossierId,selection,'content',revision,{sha256:inspection.sha256}),
      inspection.sha256,inspection.bytes);
    download(value.bytes,selection.editionId+'-'+selection.key+'-content.'+
      (inspection.representation==='text'?'txt':'json'),value.type);
    notify('Complete source content downloaded.');
  },task));
  return true;
}
