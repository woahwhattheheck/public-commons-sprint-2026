// MIT. Render the installed supplier documentation using text-only DOM construction.
import { element, labelTable } from '/presentation.mjs';
const documents=Object.freeze({
  operator:{path:'/guide/operator.md',title:'Operator guide'},
  profiles:{path:'/guide/profiles.md',title:'Customer profiles'},
  transport:{path:'/guide/transport.md',title:'HTTPS configuration'},
  installation:{path:'/guide/installation.md',title:'Installation'},
  merchant:{path:'/guide/merchant.md',title:'Merchant client'}
});
const references=Object.freeze({'GUIDE.md':'operator','PROFILES.md':'profiles','TRANSPORT.md':'transport','SUPPLIER_ORDERS.md':'installation'});
const slug=value=>value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'section';
function link(text,destination){
  const basename=destination.split('#')[0].split('/').at(-1),known=destination.includes('mcp-merchant-operator/')?'merchant':references[basename];
  const target=known?'/guide?document='+known+(destination.includes('#')?'#'+destination.split('#')[1]:''):destination;
  const a=element('a',text);
  if(target.startsWith('#')||known)a.href=target;
  else{try{const url=new URL(target);if(!['https:','http:','mailto:'].includes(url.protocol))return element('span',text);
    a.href=url.href;if(url.protocol!=='mailto:'){a.target='_blank';a.rel='noopener';}}
    catch{const span=element('span');span.append(element('span',text),element('code',' (installed file: '+destination+')'));return span;}}
  return a;
}
function inline(parent,text){
  const tokens=/(\u0060[^\u0060]+\u0060|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\)|\*[^*\n]+\*)/g;let start=0;
  for(const match of text.matchAll(tokens)){
    parent.append(document.createTextNode(text.slice(start,match.index)));
    const token=match[0];
    if(token.startsWith('\u0060'))parent.append(element('code',token.slice(1,-1)));
    else if(token.startsWith('**'))parent.append(element('strong',token.slice(2,-2)));
    else if(token.startsWith('*'))parent.append(element('em',token.slice(1,-1)));
    else{const split=token.indexOf('](');parent.append(link(token.slice(1,split),token.slice(split+2,-1)));}
    start=match.index+token.length;
  }
  parent.append(document.createTextNode(text.slice(start)));
}
function cells(line){
  let text=line.trim();if(text.startsWith('|'))text=text.slice(1);if(text.endsWith('|'))text=text.slice(0,-1);
  const output=[],parts=[];let code=false,escaped=false;
  for(const char of text){
    if(escaped){parts.push(char);escaped=false;continue;}
    if(char==='\\'){escaped=true;continue;}if(char==='\u0060')code=!code;
    if(char==='|'&&!code){output.push(parts.join('').trim());parts.length=0;}else parts.push(char);
  }
  output.push(parts.join('').trim());return output;
}
const fence=line=>/^\s*(\u0060{3,}|~{3,})([\w+-]*)\s*$/.exec(line);
const item=line=>/^(\s*)([-+*]|\d+\.)\s+(.*)$/.exec(line);
const heading=line=>/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
const separator=line=>/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
function render(markdown,target,toc){
  const lines=markdown.replace(/\r\n?/g,'\n').split('\n'),ids=new Set();let i=0;
  const block=line=>Boolean(heading(line)||fence(line)||item(line)||/^\s*>/.test(line)||/^\s*(?:---+|\*\*\*+)\s*$/.test(line));
  function paragraph(parent,selected){const p=element('p');inline(p,selected.join(' ').trim());parent.append(p);}
  function listAt(indent){
    const first=item(lines[i]),ordered=/\d+\./.test(first[2]),list=element(ordered?'ol':'ul');
    if(ordered&&first[2]!=='1.')list.start=Number(first[2].slice(0,-1));
    while(i<lines.length){
      const match=item(lines[i]);if(!match||match[1].length!==indent||/\d+\./.test(match[2])!==ordered)break;
      const li=element('li'),texts=[match[3]];i++;
      while(i<lines.length&&lines[i].trim()&&!item(lines[i])&&!heading(lines[i])&&!fence(lines[i])){
        if(!/^\s+/.test(lines[i]))break;texts.push(lines[i].trim());i++;
      }
      inline(li,texts.join(' '));
      while(i<lines.length){if(!lines[i].trim()){let next=i+1;while(next<lines.length&&!lines[next].trim())next++;
          if(item(lines[next]??'')?.[1].length>indent)i=next;else break;}
        const nested=item(lines[i]);if(!nested||nested[1].length<=indent)break;li.append(listAt(nested[1].length));}
      list.append(li);
      if(!lines[i]?.trim()){let next=i;while(next<lines.length&&!lines[next].trim())next++;const following=item(lines[next]??'');
        if(following?.[1].length===indent)i=next;else break;}
    }
    return list;
  }
  while(i<lines.length){
    const line=lines[i];if(!line.trim()){i++;continue;}
    const h=heading(line);if(h){const node=element('h'+h[1].length),base=slug(h[2].replace(/[*\u0060]/g,''));let id=base,n=2;while(ids.has(id))id=base+'-'+n++;
      ids.add(id);node.id=id;inline(node,h[2]);target.append(node);
      if(h[1].length===2){const li=element('li');li.append(link(h[2].replace(/[*\u0060]/g,''),'#'+id));toc.append(li);}
      i++;continue;}
    const f=fence(line);if(f){const selected=[];i++;while(i<lines.length&&!new RegExp('^\\s*'+f[1][0]+'{'+f[1].length+',}\\s*$').test(lines[i]))selected.push(lines[i++]);
      if(i<lines.length)i++;const pre=element('pre'),code=element('code',selected.join('\n'));if(f[2])code.dataset.language=f[2];pre.append(code);target.append(pre);continue;}
    if(i+1<lines.length&&line.includes('|')&&separator(lines[i+1])){
      const table=element('table'),thead=element('thead'),tr=element('tr'),heads=cells(line);
      for(const name of heads){const th=element('th');inline(th,name);tr.append(th);}thead.append(tr);table.append(thead);
      const tbody=element('tbody');i+=2;
      while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){const row=element('tr'),values=cells(lines[i++]);for(let col=0;col<heads.length;col++){const td=element('td');inline(td,values[col]??'');row.append(td);}tbody.append(row);}
      table.append(tbody);const wrap=element('div',null,'table-wrap');wrap.append(table);target.append(wrap);labelTable(table);continue;
    }
    if(item(line)){target.append(listAt(item(line)[1].length));continue;}
    if(/^\s*>/.test(line)){const quote=element('blockquote'),selected=[];while(i<lines.length&&/^\s*>/.test(lines[i]))selected.push(lines[i++].replace(/^\s*>\s?/,''));paragraph(quote,selected);target.append(quote);continue;}
    if(/^\s*(?:---+|\*\*\*+)\s*$/.test(line)){target.append(element('hr'));i++;continue;}
    const selected=[line];i++;
    while(i<lines.length&&lines[i].trim()&&!block(lines[i])&&!(i+1<lines.length&&lines[i].includes('|')&&separator(lines[i+1])))selected.push(lines[i++]);
    paragraph(target,selected);
  }
}
async function openGuide(){
  const key=new URLSearchParams(location.search).get('document')??'operator',selected=documents[key];
  if(!selected)throw new Error('Choose one of the installed guides from the navigation.');
  document.title=selected.title+' · Supplier orders';
  for(const a of document.querySelectorAll('[data-guide]'))if(a.dataset.guide===key)a.setAttribute('aria-current','page');
  const response=await fetch(selected.path,{cache:'no-store',credentials:'omit'});
  if(!response.ok)throw new Error('The installed guide returned HTTP '+response.status+'.');
  const markdown=await response.text();if(!markdown.trim())throw new Error('The installed guide is empty.');
  const content=document.getElementById('guide-content');content.replaceChildren();render(markdown,content,document.getElementById('guide-contents'));
  document.getElementById('guide-source').href=selected.path;document.getElementById('guide-source').download=key+'.md';
  document.getElementById('guide-loading').hidden=true;document.getElementById('guide-layout').hidden=false;
  if(location.hash)document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
}
openGuide().catch(error=>{const notice=document.getElementById('guide-loading');notice.textContent='Unable to open this guide. '+error.message;notice.setAttribute('role','alert');});
