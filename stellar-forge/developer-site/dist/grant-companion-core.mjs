// MIT. Complete source-driven reader for the maintained product and finance companion.
export const SOURCE_INDEX_SCHEMA = 'stellar-forge.grant-reviewer-source-index.v1';
export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const escapeHtml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const need = (value,message) => { if(!value) throw new Error(message); };
const slug = value => String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-') || 'section';

function destination(value) {
  const href=value.trim().replace(/^<([^<>]+)>$/,'$1');
  if(!href || /[\u0000-\u0020\u007f]/.test(href) || /^(?:javascript|data|vbscript):/i.test(href)) return null;
  if(/^[a-z][a-z0-9+.-]*:/i.test(href)) return /^(?:https?:\/\/|mailto:)/i.test(href)?href:null;
  if(href.startsWith('#')) return href;
  if(/^\.\/product-and-finance\.md(?:#|$)/.test(href)) return href.includes('#')?'#'+href.split('#').slice(1).join('#'):'#companion-top';
  if(href.startsWith('/')) return href;
  return './grant-data/'+href;
}

function inline(source, depth=0) {
  if(depth>12) return escapeHtml(source);
  let out='',i=0;
  while(i<source.length) {
    const rest=source.slice(i);
    if(source[i]==='\\' && i+1<source.length && /[\\\x60*{}\[\]()#+\-.!_|>~]/.test(source[i+1])) {out+=escapeHtml(source[i+1]);i+=2;continue;}
    if(source.charCodeAt(i)===96) {
      const fence=rest.match(/^\x60+/)[0],end=source.indexOf(fence,i+fence.length);
      if(end>=0) {let code=source.slice(i+fence.length,end).replace(/\n/g,' ');if(/^ .+ $/.test(code)&&code.trim())code=code.slice(1,-1);out+='<code>'+escapeHtml(code)+'</code>';i=end+fence.length;continue;}
    }
    const image=source[i]==='!'&&source[i+1]==='[',start=i+(image?1:0);
    if(source[start]==='[') {
      let level=1,close=start+1;
      for(;close<source.length;close++){if(source[close]==='\\'){close++;continue;}if(source[close]==='[')level++;if(source[close]===']'&&!--level)break;}
      if(level===0&&source[close+1]==='(') {
        let nested=1,end=close+2;
        for(;end<source.length;end++){if(source[end]==='\\'){end++;continue;}if(source[end]==='(')nested++;if(source[end]===')'&&!--nested)break;}
        if(nested===0) {
          const raw=source.slice(close+2,end).trim(),parts=raw.match(/^(<[^<>]+>|\S+?)(?:\s+["']([^"']*)["'])?$/),href=parts&&destination(parts[1]);
          if(href) {const label=source.slice(start+1,close);out+='<a href="'+escapeHtml(href)+'"'+(parts[2]?' title="'+escapeHtml(parts[2])+'"':'')+'>'+ (image?'Image: '+escapeHtml(label):inline(label,depth+1))+'</a>';i=end+1;continue;}
        }
      }
    }
    const auto=rest.match(/^<(https?:\/\/[^<>\s]+|mailto:[^<>\s]+)>/);
    if(auto) {out+='<a href="'+escapeHtml(auto[1])+'">'+escapeHtml(auto[1].replace(/^mailto:/,''))+'</a>';i+=auto[0].length;continue;}
    let emphasis=false;
    for(const [marker,tag] of [['**','strong'],['__','strong'],['~~','del'],['*','em'],['_','em']]) {
      if(!rest.startsWith(marker)||/\s/.test(source[i+marker.length]||''))continue;
      if(marker.includes('_')&&i>0&&/[\p{L}\p{N}]/u.test(source[i-1]))continue;
      const end=source.indexOf(marker,i+marker.length);
      if(end>i+marker.length&&!/\s/.test(source[end-1])) {out+='<'+tag+'>'+inline(source.slice(i+marker.length,end),depth+1)+'</'+tag+'>';i=end+marker.length;emphasis=true;break;}
    }
    if(emphasis)continue;
    if(source[i]==='\n'){out+='<br>';i++;continue;}
    out+=escapeHtml(source[i++]);
  }
  return out;
}

function cells(line) {
  let text=line.trim();if(text.startsWith('|'))text=text.slice(1);if(/(?<!\\)\|$/.test(text))text=text.slice(0,-1);
  const result=[];let current='',code=0;
  for(let i=0;i<text.length;i++) {
    if(text[i]==='\\'&&i+1<text.length){current+=text[i]+text[++i];continue;}
    if(text.charCodeAt(i)===96){let n=1;while(text.charCodeAt(i+n)===96)n++;if(!code)code=n;else if(code===n)code=0;current+=text.slice(i,i+n);i+=n-1;continue;}
    if(text[i]==='|'&&!code){result.push(current.trim());current='';}else current+=text[i];
  }
  result.push(current.trim());return result;
}
const fenceOf=line=>line.match(/^ {0,3}(\x60{3,}|~{3,})(.*)$/);
const headingOf=line=>line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
const listOf=line=>line.match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);
const separator=line=>/^\s*\|?[\s|:\-]+\|?\s*$/.test(line||'')&&cells(line||'').every(x=>/^:?-{3,}:?$/.test(x));
const rule=line=>/^ {0,3}(?:\*\s*){3,}$/.test(line)||/^ {0,3}(?:-\s*){3,}$/.test(line)||/^ {0,3}(?:_\s*){3,}$/.test(line);
function renderBlocks(lines,context) {
  const out=[];
  const begins=i=>!!headingOf(lines[i])||!!fenceOf(lines[i])||!!listOf(lines[i])||/^ {0,3}>/.test(lines[i])||rule(lines[i])||(lines[i].includes('|')&&separator(lines[i+1]));
  for(let i=0;i<lines.length;) {
    const line=lines[i];if(!line.trim()){i++;continue;}
    const fence=fenceOf(line);
    if(fence){const body=[];i++;const close=new RegExp('^ {0,3}'+(fence[1][0]==='~'?'~':'\\x60')+'{'+fence[1].length+',}\\s*$');while(i<lines.length&&!close.test(lines[i]))body.push(lines[i++]);if(i<lines.length)i++;const lang=fence[2].trim().split(/\s/)[0];out.push('<pre><code'+(/^[\w-]{1,40}$/.test(lang)?' class="language-'+escapeHtml(lang)+'"':'')+'>'+escapeHtml(body.join('\n')+(body.length?'\n':''))+'</code></pre>');context.codeBlocks++;continue;}
    const heading=headingOf(line);
    if(heading){const base=slug(heading[2]),n=(context.ids.get(base)||0)+1;context.ids.set(base,n);const id=n===1?base:base+'-'+n,level=Math.max(2,heading[1].length);context.headings.push({id,title:heading[2],level});out.push('<h'+level+' id="'+id+'">'+inline(heading[2])+'</h'+level+'>');i++;continue;}
    if(rule(line)){out.push('<hr>');i++;continue;}
    if(line.includes('|')&&separator(lines[i+1])){
      const headers=cells(line),align=cells(lines[i+1]),rows=[];i+=2;
      while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){rows.push(cells(lines[i]));i++;}
      const width=Math.max(headers.length,...rows.map(x=>x.length));while(headers.length<width)headers.push('');
      const attr=c=>align[c]?.startsWith(':')&&align[c]?.endsWith(':')?' class="align-center"':align[c]?.endsWith(':')?' class="align-right"':'';
      out.push('<div class="table-scroll" role="region" aria-label="'+escapeHtml(headers.join(' / ').replace(/[*\x60]/g,''))+'" tabindex="0"><table><thead><tr>'+headers.map((c,k)=>'<th scope="col"'+attr(k)+'>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+headers.map((_,k)=>'<'+(k===0?'th scope="row"':'td')+attr(k)+'>'+inline(row[k]||'')+'</'+(k===0?'th':'td')+'>').join('')+'</tr>').join('')+'</tbody></table></div>');context.tables++;continue;
    }
    if(/^ {0,3}>/.test(line)){const quote=[];while(i<lines.length&&/^ {0,3}>/.test(lines[i]))quote.push(lines[i++].replace(/^ {0,3}> ?/,''));out.push('<blockquote>'+renderBlocks(quote,context)+'</blockquote>');continue;}
    const list=listOf(line);
    if(list){
      const indent=list[1].length,ordered=/^\d/.test(list[2]),tag=ordered?'ol':'ul',items=[];
      while(i<lines.length){
        const item=listOf(lines[i]);if(!item||item[1].length!==indent||/^\d/.test(item[2])!==ordered)break;
        const part=[item[3]],number=ordered?Number.parseInt(item[2],10):null,cut=item[1].length+item[2].length+1;i++;
        while(i<lines.length){if(!lines[i].trim()){if(i+1<lines.length&&(/^\s*/.exec(lines[i+1])[0].length>indent)){part.push('');i++;continue;}break;}const next=listOf(lines[i]);if(next&&next[1].length===indent)break;if(/^\s*/.exec(lines[i])[0].length<=indent)break;const continuation=lines[i++];part.push(continuation.slice(Math.min(cut,/^\s*/.exec(continuation)[0].length)));}
        items.push('<li'+(ordered&&Number.isSafeInteger(number)?' value="'+number+'"':'')+'>'+renderBlocks(part,context)+'</li>');
        if(!lines[i]?.trim()&&listOf(lines[i+1]||'')?.[1].length===indent)i++;
      }
      out.push('<'+tag+'>'+items.join('')+'</'+tag+'>');continue;
    }
    const paragraph=[];do{paragraph.push(lines[i++]);}while(i<lines.length&&lines[i].trim()&&!begins(i));
    out.push('<p>'+inline(paragraph.map((x,k)=>x.replace(/ {2,}$/,'')+(k<paragraph.length-1?(/ {2,}$/.test(x)?'\n':' '):'')).join(''))+'</p>');
  }
  return out.join('\n');
}

/** Preserve the exact download source while rendering each original H2 as one chapter. */
export function parseCompanionMarkdown(markdown) {
  need(typeof markdown==='string'&&markdown.trim(),'Open the complete product and finance Markdown.');
  const lines=markdown.replace(/\r\n?/g,'\n').split('\n'),groups=[];let title='Product and financing',current=null,fence=null;
  for(const line of lines){
    const f=fenceOf(line);
    if(f){if(!fence)fence=f[1];else if(f[1][0]===fence[0]&&f[1].length>=fence.length&&!f[2].trim())fence=null;}
    const h=!fence&&!f?headingOf(line):null;
    if(h&&h[1].length===1&&groups.length===0&&!current){title=h[2];continue;}
    if(h&&h[1].length===2){if(current)groups.push(current);current={title:h[2],lines:[line]};}
    else {if(!current&&line.trim())current={title:'Overview',lines:['## Overview']};if(current)current.lines.push(line);}
  }
  if(current)groups.push(current);
  const context={ids:new Map(),headings:[],tables:0,codeBlocks:0};
  const chapters=groups.map((group,index)=>{const start=context.headings.length,html=renderBlocks(group.lines,context),headings=context.headings.slice(start);return {id:headings[0].id,title:group.title,ordinal:index+1,markdown:group.lines.join("\n"),html,headings};});
  need(chapters.length>0,'The complete companion needs at least one section.');
  return {title,markdown,chapters,tables:context.tables,codeBlocks:context.codeBlocks};
}

export function companionReaderMarkup(model,{sha256='',bytes=0}={}) {
  return '<header id="companion-top" class="reader-header"><p class="eyebrow">STELLAR FORGE · SCF APPLICATION</p><h1>Product and financing</h1><p class="reader-intro">Read the complete customer installations, funded work and delivery plan. Choose a chapter or search the full companion.</p><nav class="reader-actions" aria-label="Reader actions"><a href="./grant.html">Application</a><a href="./grant-submission.html">Prepare submission</a><button type="button" data-action="download-markdown">Download Markdown</button><button type="button" data-action="download-index">Source index</button><button type="button" data-action="offline">Save offline reader</button></nav><p class="source-edition">'+model.chapters.length+' chapters · '+model.tables+' tables · <span data-source-bytes>'+Number(bytes).toLocaleString('en-US')+'</span> source bytes<span class="source-hash"> · Edition <code>'+escapeHtml(sha256)+'</code></span></p></header>'+
    '<div class="reader-controls"><label for="companion-search">Search the complete companion</label><div class="search-row"><input id="companion-search" type="search" placeholder="Customer, product or delivery term" autocomplete="off"><button type="button" data-action="clear-search">Clear</button><button type="button" data-action="read-all" aria-pressed="false">Read all chapters</button><button type="button" data-action="print">Print chapter</button><button type="button" data-action="print-all">Print complete companion</button></div><p id="companion-status" role="status" aria-live="polite"></p></div>'+
    '<div class="reader-layout"><aside class="chapter-index"><h2>Chapters</h2><nav aria-label="Companion chapters"><ol>'+model.chapters.map(c=>'<li data-chapter-index="'+c.id+'"><a href="#'+c.id+'">'+escapeHtml(c.title)+'</a><p class="search-excerpt" hidden></p></li>').join('')+'</ol></nav><p data-no-results hidden>No chapters match. Try fewer words or clear the search.</p></aside><main id="companion-content" tabindex="-1">'+model.chapters.map(c=>'<section class="companion-chapter" data-chapter="'+c.id+'" aria-labelledby="'+c.id+'">'+c.html+'</section>').join('')+'<nav class="chapter-paging" aria-label="Chapter pages"><button type="button" data-action="previous">Previous chapter</button><span data-position></span><button type="button" data-action="next">Next chapter</button></nav></main></div>';
}

/** Shared interaction for the hosted reader and its self-contained offline export. */
export function activateCompanionReader(root,sourceFiles,onOfflineDownload=null,options={}) {
  const one=selector=>root.querySelector(selector),all=selector=>Array.from(root.querySelectorAll(selector));
  const chapters=all('[data-chapter]'),indices=all('[data-chapter-index]'),search=one('#companion-search'),status=one('#companion-status');
  const normal=value=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/\s+/g,' ').trim();
  const records=chapters.map((element,i)=>({element,index:indices[i],id:element.dataset.chapter,title:indices[i].querySelector('a').textContent,text:element.textContent.replace(/\s+/g,' ').trim()}));
  records.forEach(record=>record.search=normal(record.text));
  let selected=records.some(x=>x.id===options.reading?.chapter_id)?options.reading.chapter_id:records[0].id,showAll=!!options.reading?.show_all,matches=records.slice(),busy=false;
  search.value=options.reading?.query||'';
  const disposal=[];
  const listen=(target,type,handler)=>{target.addEventListener(type,handler);disposal.push(()=>target.removeEventListener(type,handler));};
  const report=message=>{status.textContent=message;};
  const download=(value,name,type)=>{const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);};
  function update(){
    const terms=normal(search.value).split(' ').filter(Boolean);matches=records.filter(x=>terms.every(term=>x.search.includes(term)));
    for(const record of records){const match=matches.includes(record);record.index.hidden=!match;const excerpt=record.index.querySelector('.search-excerpt');excerpt.hidden=!terms.length||!match;if(terms.length&&match){const at=Math.max(0,normal(record.text).indexOf(terms[0])-70);excerpt.textContent=(at?'…':'')+record.text.slice(at,at+190)+(record.text.length>at+190?'…':'');}}
    if(matches.length&&!matches.some(x=>x.id===selected))selected=matches[0].id;
    for(const record of records){record.element.hidden=!matches.includes(record)||(!showAll&&record.id!==selected);const a=record.index.querySelector('a');if(record.id===selected&&!showAll)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');}
    const at=matches.findIndex(x=>x.id===selected);one('[data-position]').textContent=matches.length?(showAll?matches.length+' chapters':(at+1)+' of '+matches.length):'No matching chapters';
    one('[data-action="previous"]').disabled=showAll||at<=0;one('[data-action="next"]').disabled=showAll||at<0||at>=matches.length-1;
    one('[data-action="print"]').disabled=matches.length===0;one('[data-action="print"]').textContent=showAll?'Print visible chapters':'Print chapter';one('[data-action="read-all"]').setAttribute('aria-pressed',String(showAll));one('[data-action="read-all"]').textContent=showAll?'Read one chapter':'Read all chapters';one('[data-no-results]').hidden=matches.length>0;
    report(terms.length?matches.length+' of '+records.length+' chapters match.':(showAll?'Reading all '+records.length+' chapters.':'Reading '+(records.find(x=>x.id===selected)?.title||'the companion')+'.'));
    options.onReading?.({chapter_id:selected,query:search.value,show_all:showAll});
  }
  function select(hash,focus=false){
    let id;try{id=decodeURIComponent(String(hash).replace(/^#/,''));}catch{return;}
    const record=records.find(x=>x.id===id||Array.from(x.element.querySelectorAll('[id]')).some(n=>n.id===id));
    if(!record)return;if(!matches.includes(record))search.value='';selected=record.id;showAll=false;update();
    const target=Array.from(record.element.querySelectorAll('[id]')).find(n=>n.id===id)||record.element;
    if(focus){target.scrollIntoView({block:'start'});one('#companion-content').focus({preventScroll:true});}
  }
  listen(root,'click',event=>{
    const link=event.target.closest('a[href^="#"]');if(!link)return;
    let id;try{id=decodeURIComponent(link.hash.slice(1));}catch{return;}
    const record=records.find(x=>x.id===id||Array.from(x.element.querySelectorAll('[id]')).some(n=>n.id===id));
    if(!record)return;event.preventDefault();try{history.replaceState(null,'',link.hash);}catch{}select(link.hash,true);
  });
  listen(search,'input',update);
  async function action(name){
    if(name==='clear-search'){search.value='';update();search.focus();return;}
    if(name==='read-all'){showAll=!showAll;update();return;}
    if(name==='previous'||name==='next'){const at=matches.findIndex(x=>x.id===selected),next=matches[at+(name==='next'?1:-1)];if(next){try{history.replaceState(null,'','#'+next.id);}catch{}select('#'+next.id,true);}return;}
    if(name==='download-markdown'){download(sourceFiles.markdown,'product-and-finance.md','text/markdown;charset=utf-8');report('Downloaded the complete original companion Markdown.');return;}
    if(name==='download-index'){download(sourceFiles.indexText,'source-index.json','application/json');report('Downloaded the complete original source index.');return;}
    if(name==='offline'&&onOfflineDownload){if(busy)return;busy=true;one('[data-action="offline"]').disabled=true;try{await onOfflineDownload();report('Saved the complete offline reader with its original Markdown and source index.');}catch(error){report(error.message||String(error));}finally{busy=false;one('[data-action="offline"]').disabled=false;}return;}
    if(name==='print'||name==='print-all'){document.documentElement.dataset.companionPrint=name==='print-all'?'all':'selection';window.print();}
  }
  all('button[data-action]').forEach(button=>listen(button,'click',()=>action(button.dataset.action).catch(error=>report(error.message||String(error)))));
  one('[data-action="offline"]').hidden=!onOfflineDownload;
  listen(window,'hashchange',()=>select(location.hash,true));listen(window,'afterprint',()=>{delete document.documentElement.dataset.companionPrint;});
  update();if(options.honorHash!==false&&location.hash)select(location.hash);
  return {select,chapterCount:records.length,getReading:()=>({chapter_id:selected,query:search.value,show_all:showAll}),destroy:()=>disposal.forEach(fn=>fn())};
}

export function standaloneCompanion(model,{css,indexText,sha256,bytes,applicationUrl,submissionUrl}){
  need(typeof css==='string'&&css.trim(),'Retain the complete companion stylesheet for offline reading.');
  const source={markdown:model.markdown,indexText};
  let markup=companionReaderMarkup(model,{sha256,bytes});
  if(applicationUrl)markup=markup.replace('href="./grant.html"','href="'+escapeHtml(applicationUrl)+'"');
  if(submissionUrl)markup=markup.replace('href="./grant-submission.html"','href="'+escapeHtml(submissionUrl)+'"');
  if(applicationUrl)markup=markup.replaceAll('href="./grant-data/','href="'+escapeHtml(applicationUrl.replace(/[^/]*$/,'')+'grant-data/'));
  const json=JSON.stringify(source).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
  const boot='('+activateCompanionReader.toString()+')(document,JSON.parse(document.getElementById("companion-source").textContent));';
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Product and financing — Stellar Forge</title><style>'+css.replace(/<\/style/gi,'<\\/style')+'</style></head><body><a class="skip-link" href="#companion-content">Skip to companion</a>'+markup+'<script id="companion-source" type="application/json">'+json+'</script><script>'+boot.replace(/<\/script/gi,'<\\/script')+'</script></body></html>\n';
}
