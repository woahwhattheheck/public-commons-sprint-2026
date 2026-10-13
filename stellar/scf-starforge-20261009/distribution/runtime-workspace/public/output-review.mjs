// MIT. Read the complete carried output without contacting its original worker.
export function mountOutputReview(root, output, file) {
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const bytes=Uint8Array.from(atob(file.content),c=>c.charCodeAt(0));
  if(bytes.length!==output.bytes||file.id!==output.fileId)throw new Error('The complete carried output does not match its capture.');
  const review=output.review,rows=review.matches,decoder=new TextDecoder('utf-8');
  let page=0,offset=0;
  const section=el('section');section.className='procedure-output-review';
  const title=el('h4','Retained output review'),status=el('p'),identity=el('details');
  identity.append(el('summary','Original source identity'),el('pre',JSON.stringify({
    workspaceId:output.workspaceId,selection:output.selection,sourceId:output.sourceId,
    bytes:output.bytes,sha256:output.sha256,fileId:output.fileId},null,2)));
  const actions=el('div');actions.className='actions';
  function download(content,name,type){
    const url=URL.createObjectURL(new Blob(Array.isArray(content)?content:[content],{type})),link=el('a');
    link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function button(label,action,parent=actions){
    const n=el('button',label);n.type='button';n.addEventListener('click',action);parent.append(n);return n;
  }
  button('Download complete original output',()=>download(bytes,file.name,'application/octet-stream'));
  button('Download complete match index',()=>{
    const parts=[JSON.stringify({schema:'stellar-forge.runtime-output-review-export.v1',type:'selection',
      ...output,review:{...review,matches:undefined},coordinates:'zero-based original bytes; exclusive ends; contexts address the carried original output'})+'\n'];
    for(const row of rows)parts.push(JSON.stringify({type:'match',offset:row[0],endOffset:row[1],contextOffset:row[2],contextEndOffset:row[3]})+'\n');
    parts.push(JSON.stringify({type:'complete',matches:rows.length,endOffset:review.endOffset,complete:true})+'\n');
    download(parts,file.name+'.matches.jsonl','application/x-ndjson');
  });
  const list=el('ol'),pages=el('div');pages.className='actions';
  const previous=button('Previous matches',()=>{page--;render();},pages);
  const next=button('Next matches',()=>{page++;render();},pages);
  const range=el('p'),reader=el('pre'),navigation=el('form');navigation.className='actions';
  const label=el('label','Original byte offset'),jump=el('input');jump.type='text';jump.inputMode='numeric';jump.value='0';label.append(jump);
  const go=el('button','Open byte range');go.type='submit';navigation.append(label,go);
  const notice=el('p');notice.setAttribute('role','status');
  navigation.addEventListener('submit',event=>{
    event.preventDefault();const n=Number(jump.value);
    if(!/^(0|[1-9][0-9]*)$/.test(jump.value)||!Number.isSafeInteger(n)||n>bytes.length){notice.textContent='Choose a whole byte offset within the retained original.';return;}
    notice.textContent='';offset=n;renderBytes();
  });
  const byteActions=el('div');byteActions.className='actions';
  const before=button('Previous output bytes',()=>{offset=Math.max(0,offset-65536);renderBytes();},byteActions);
  const after=button('Next output bytes',()=>{offset=Math.min(bytes.length,offset+65536);renderBytes();},byteActions);
  function renderBytes(){
    let start=offset,end=Math.min(bytes.length,offset+65536);
    for(let n=0;start>0&&start<bytes.length&&(bytes[start]&192)===128&&n<3;n++)start--;
    for(let n=0;end<bytes.length&&(bytes[end]&192)===128&&n<3;n++)end++;
    jump.value=String(offset);range.textContent='Original bytes '+start+'–'+end+' of '+bytes.length+
      '. Text is decoded for reading; the original download preserves every byte.';
    reader.textContent=decoder.decode(bytes.subarray(start,end));before.disabled=offset===0;after.disabled=end>=bytes.length;
  }
  function render(){
    status.textContent='Exact query '+JSON.stringify(review.query)+' · '+rows.length+' complete overlapping matches · selected bytes 0–'+review.endOffset+
      ' · matches '+(rows.length?Math.min(page*100+1,rows.length):0)+'–'+Math.min((page+1)*100,rows.length);
    list.replaceChildren();list.start=page*100+1;
    for(const row of rows.slice(page*100,(page+1)*100)){
      const item=el('li');button('Open original bytes '+row[0]+'–'+row[1],()=>{offset=row[0];renderBytes();reader.focus();},item);
      item.append(el('pre',decoder.decode(bytes.subarray(row[2],row[3]))));list.append(item);
    }
    previous.disabled=page===0;next.disabled=(page+1)*100>=rows.length;
  }
  reader.tabIndex=0;reader.setAttribute('aria-label','Complete retained output byte reader');
  section.append(title,status,identity,actions,pages,list,el('h4','Read the retained original'),navigation,notice,range,byteActions,reader);
  root.append(section);render();renderBytes();
  return {element:section};
}
export function renderOutputReviewHTML(output,file) {
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const literal=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Retained output · '+escape(file.name)+'</title><style>body{font:16px system-ui;color:#171717;background:#fff;max-width:1100px;margin:1.5rem auto;padding:0 1rem}button,input{font:inherit;padding:.6rem;max-width:100%}button{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f3;padding:.8rem;max-height:32rem;overflow:auto}.actions{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0}label{display:grid;gap:.3rem}li{padding:.7rem 0}details{overflow-wrap:anywhere}</style>'+
    '<main id="review"></main><script>('+mountOutputReview.toString()+')(document.getElementById("review"),'+literal(output)+','+literal(file)+');<\/script></html>\n';
}
