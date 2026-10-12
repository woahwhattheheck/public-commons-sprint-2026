// MIT. Human-readable reports retain complete original files and their source references.
import {sourceBundleFileBytes} from './source-bundles.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const md=value=>String(value??'').replace(/[\\\x60*_{}\[\]<>#+!|]/g,'\\$&');
const size=bytes=>bytes<1024?bytes+' B':bytes<1024*1024?(bytes/1024).toFixed(1)+' KiB':(bytes/(1024*1024)).toFixed(2)+' MiB';
const code=(value,language='text')=>{
  let width=3;for(const run of value.matchAll(/\x60+/g))width=Math.max(width,run[0].length+1);
  const marker='\x60'.repeat(width);
  return marker+language+'\n'+value+'\n'+marker;
};
export const hasOriginalFiles=content=>content!==null&&typeof content==='object'&&
  Array.isArray(content.files)&&content.files.length>0&&content.files.every(file=>
    file&&typeof file.name==='string'&&typeof file.content==='string'&&
    Number.isSafeInteger(file.bytes)&&file.bytes>=0&&typeof file.sha256==='string'&&
    /^[a-f0-9]{64}$/.test(file.sha256)&&['utf8','base64'].includes(file.encoding));
const rasterType=bytes=>{
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=6&&['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii')))return 'image/gif';
  if(bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp';
  return null;
};
function files(content){
  if(!hasOriginalFiles(content))return null;
  try{
    return content.files.map(file=>{
      const bytes=sourceBundleFileBytes(file);let text=null;
      const textual=file.encoding==='utf8'||/^(text\/|application\/(json|xml))/.test(file.mediaType??'')||
        /\.(md|txt|csv|tsv|tab|json|xml|html|svg|py|js|mjs|cjs|css|yaml|yml|toml|ini|log|sql|r|jl)$/i.test(file.name);
      if(textual)try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{}
      return {...file,base64:bytes.toString('base64'),text,raster:rasterType(bytes)};
    });
  }catch{return null;}
}

/** Complete file bodies appear once in the rendered file sections. */
export function reportSourceRecord(original,renderedContent){
  if(!original||typeof original!=='object'||!hasOriginalFiles(original.content)||
    !hasOriginalFiles(renderedContent))return original;
  const represented=new Map(renderedContent.files.map(file=>[file.name,file]));
  if(!original.content.files.every(file=>{
    const shown=represented.get(file.name);
    return shown&&['bytes','sha256','encoding','content'].every(key=>shown[key]===file[key]);
  }))return original;
  return {...original,content:{...original.content,files:original.content.files.map(file=>{
    const {content,...metadata}=file;
    return {...metadata,contentLocation:'Original file section in this source variant: '+file.name};
  })}};
}

export function originalFilesMarkdown(content){
  const retained=files(content);if(!retained)return null;
  const summary=typeof content.summary==='string'?content.summary:
    typeof content.description==='string'?content.description:'';
  const lines=summary?[summary,'']:[];
  lines.push('| Original file | Bytes | SHA-256 |','| --- | --- | --- |');
  for(const file of retained)lines.push('| '+md(file.name)+' | '+file.bytes+' | '+file.sha256+' |');
  lines.push('');
  for(const file of retained){
    lines.push('#### Original file: '+md(file.name),'',
      size(file.bytes)+' · '+md(file.mediaType??'application/octet-stream')+' · SHA-256 '+file.sha256,'');
    if(file.text!==null)lines.push(code(file.text),'');
    else lines.push('The complete original binary file is encoded below. The standalone HTML report also provides its direct download.','',
      code(file.base64,'base64'),'');
  }
  return lines.join('\n');
}

export function originalFilesHtml(content){
  const retained=files(content);if(!retained)return null;
  const summary=typeof content.summary==='string'?content.summary:
    typeof content.description==='string'?content.description:'';
  return (summary?'<div class="prose">'+escape(summary)+'</div>':'')+
    '<p class="muted">'+retained.length+' original file'+(retained.length===1?'':'s')+'</p>'+
    retained.map(file=>{
      const filename=file.name.split('/').at(-1),download='data:application/octet-stream;base64,'+file.base64;
      const image=file.raster?'<figure><img loading="lazy" alt="'+escape(file.name)+'" src="data:'+file.raster+
        ';base64,'+file.base64+'"><figcaption>'+escape(file.name)+'</figcaption></figure>':'';
      return '<details class="source-file"'+(file.raster?' open':'')+'><summary>'+escape(file.name)+
        ' <span class="muted">· '+size(file.bytes)+'</span></summary>'+
        '<p><a href="'+download+'" download="'+escape(filename)+'">Download original file</a></p>'+
        '<p class="muted file-identity">'+escape(file.mediaType??'application/octet-stream')+
        ' · '+file.bytes+' bytes · SHA-256 '+file.sha256+'</p>'+image+
        (file.text!==null?'<details class="file-text"><summary>Read complete text</summary><pre>'+escape(file.text)+'</pre></details>':'')+
        '</details>';
    }).join('');
}
