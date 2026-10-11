// MIT. Portable research editions contain original responses and attributable selections.
import {resultView,encoded,sha,need} from './contract.mjs';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=v=>{try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const csv=v=>{let text=String(v??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
export function selectedSources(edition){
  const rows=[];
  for(const capture of edition.manifest.captures){
    const raw=Buffer.from(capture.responseBase64,'base64');
    need(raw.length<=1048576&&sha(raw)===capture.responseSha256,'EDITION_SOURCE_BYTES_CHANGED');
    const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    for(const row of resultView(capture.query.operation,payload).rows){
      const note=capture.annotations[row.id];
      if(note?.selected)rows.push({...row,note:note.note,tags:note.tags,query:capture.query,
        responseSha256:capture.responseSha256,capturedAt:capture.created,kind:capture.kind});
    }
  }
  return rows;
}
export function exportEdition(edition,format){
  if(format==='json')return {type:'application/json',extension:'json',bytes:encoded(edition.manifest)};
  const rows=selectedSources(edition),c=edition.manifest.collection;
  if(format==='csv'){
    const columns=['query','group','title','url','description','date','note','tags','captured_at','response_sha256','content_sha256','capture_kind'];
    return {type:'text/csv; charset=utf-8',extension:'csv',bytes:Buffer.from('\ufeff'+[columns,...rows.map(r=>[r.query.title,r.group,r.title,r.url,r.description,r.date,r.note,r.tags.join('; '),r.capturedAt,r.responseSha256,r.contentSha256,r.kind])].map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n')};
  }
  if(format!=='html')throw Object.assign(new Error('EXPORT_FORMAT_INVALID'),{code:'EXPORT_FORMAT_INVALID'});
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'">'+
    '<title>'+escape(c.title)+'</title><style>body{max-width:960px;margin:40px auto;padding:0 24px;font:15px/1.6 system-ui;color:#202124;background:#fff}h1,h2{line-height:1.2}article{border-top:1px solid #d8d8d8;padding:24px 0}small{overflow-wrap:anywhere;color:#545454}pre{white-space:pre-wrap;border:1px solid #ddd;padding:12px}a{color:inherit}header{border-bottom:2px solid #333;padding-bottom:20px}</style>'+
    '<header><h1>'+escape(c.title)+'</h1><p>'+escape(c.description)+'</p><p>'+rows.length+' selected sources · collection revision '+c.revision+'</p><small>Edition '+escape(edition.id)+' · '+escape(edition.sha256)+'</small></header>'+
    (rows.length?rows.map(r=>'<article><small>'+escape(r.group)+' · '+escape(r.query.title)+' · '+escape(r.kind)+'</small><h2>'+
      (safe(r.url)?'<a href="'+escape(safe(r.url))+'" rel="noopener noreferrer">'+escape(r.title)+'</a>':escape(r.title))+
      '</h2><p>'+escape(r.description)+'</p><p>'+escape(r.note)+'</p><small>Captured '+escape(r.capturedAt)+' · response '+escape(r.responseSha256)+'</small>'+
      (typeof r.original.markdown==='string'?'<details><summary>Retained page text</summary><pre>'+escape(r.original.markdown)+'</pre></details>':'')+'</article>').join(''):'<p>No sources were selected for this edition.</p>')+
    '<footer><p>The JSON edition retains complete original provider responses and query settings. Merchant/buyer accounting is retained as originally observed. Provider credits are separate from Stellar payments.</p></footer></html>';
  return {type:'text/html; charset=utf-8',extension:'html',bytes:Buffer.from(html)};
}
