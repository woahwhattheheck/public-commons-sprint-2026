// MIT. Plain industrial controls; source values always render as text.
export function h(tag,attrs={},...children) {
  const e=document.createElement(tag);
  for(const[k,v]of Object.entries(attrs??{})){
    if(v===undefined||v===null||v===false)continue;
    if(k==='class')e.className=v;else if(k==='text')e.textContent=v;
    else if(k.startsWith('on')&&typeof v==='function')e.addEventListener(k.slice(2).toLowerCase(),v);
    else if(k==='value')e.value=String(v);else if(k==='checked'||k==='disabled'||k==='required'||k==='multiple')e[k]=Boolean(v);
    else e.setAttribute(k,v===true?'':String(v));
  }
  for(const child of children.flat(Infinity))if(child!==null&&child!==undefined&&child!==false)e.append(child instanceof Node?child:document.createTextNode(String(child)));
  return e;
}
export const cell=v=>v===null?'null':v===undefined?'—':typeof v==='object'&&Object.hasOwn(v,'state')?(v.state==='value'?v.value:v.state):typeof v==='object'?JSON.stringify(v):String(v);
export const short=(v,n=14)=>typeof v==='string'&&v.length>n?v.slice(0,n)+'…':cell(v);
export const button=(label,fn,options={})=>h('button',{type:'button',...options,onClick:fn},label);
export const detail=(title,value,open=false)=>h('details',{open},h('summary',{},title),h('pre',{},typeof value==='string'?value:JSON.stringify(value,null,2)));
export const note=(text,kind='note')=>h('p',{class:kind},text);
export function link(label,url){try{const u=new URL(url,location.origin);if(!['https:','http:'].includes(u.protocol))return h('span',{},label);return h('a',{href:u.href,target:'_blank',rel:'noopener noreferrer'},label);}catch{return h('span',{},label);}}
export const panel=(title,...children)=>h('section',{class:'panel'},h('h2',{},title),...children);
export const row=(...children)=>h('div',{class:'row'},...children);
export const grid=(...children)=>h('div',{class:'grid'},...children);
export function table(columns,rows,{empty='No retained records.'}={}) {
  if(!rows.length)return note(empty);
  return h('div',{class:'table-wrap',tabindex:'0'},h('table',{},h('thead',{},h('tr',{},columns.map(c=>h('th',{scope:'col'},c.label)))),h('tbody',{},rows.map(item=>h('tr',{},columns.map(c=>{const value=c.render?c.render(item):item[c.key];return h('td',{},value instanceof Node?value:cell(value));}))))));
}
export function field(label,name,{type='text',value='',options=[],required=false,help='',min,max,step,rows=4,placeholder='',multiple=false}={}) {
  let input;
  if(type==='select')input=h('select',{name,required,multiple},options.map(o=>{const v=typeof o==='string'?o:o.value,t=typeof o==='string'?o:o.label;const e=h('option',{value:v},t);e.selected=multiple?Array.isArray(value)&&value.includes(v):String(v)===String(value);return e;}));
  else if(type==='textarea'||type==='json')input=h('textarea',{name,rows,required,placeholder,spellcheck:'false'},value);
  else input=h('input',{name,type,value:type==='checkbox'?undefined:value,checked:type==='checkbox'&&Boolean(value),required,min,max,step,placeholder});
  return h('label',{class:type==='checkbox'?'check':'field'},h('span',{class:'field-label'},label),input,help? h('small',{},help):null);
}
export function values(form){return Object.fromEntries([...form.elements].filter(e=>e.name&&!e.disabled).map(e=>[e.name,e.type==='checkbox'?e.checked:e.multiple?[...e.selectedOptions].map(o=>o.value):e.value]));}
export function optional(v){return Object.fromEntries(Object.entries(v).filter(([,x])=>x!==''&&x!==undefined&&x!==null));}
export function number(v,{optional=false}={}){if(optional&&v==='')return undefined;const n=Number(v);if(!Number.isSafeInteger(n))throw new Error('Supply a whole number.');return n;}
export function json(v,label='JSON'){try{return JSON.parse(v);}catch{throw new Error('Use complete valid '+label+'.');}}
export const lines=v=>v.split(/[\n,]+/).map(x=>x.trim()).filter(Boolean);
export function form(title,controls,submit,{label='Save',description='',confirm=''}={}) {
  const status=h('div',{class:'form-status',role:'status'}),submitButton=h('button',{type:'submit'},label);
  const f=h('form',{onSubmit:async e=>{e.preventDefault();if(!f.reportValidity())return;if(confirm&&!window.confirm(confirm))return;submitButton.disabled=true;status.textContent='Working…';try{const result=await submit(values(f),f);status.replaceChildren(note('Completed.','success'),result===undefined?null:detail('Original result',result));}catch(error){status.replaceChildren(note((error.code?error.code+': ':'')+error.message,'error'));}finally{submitButton.disabled=false;}}},description?note(description):null,grid(controls),row(submitButton),status);
  return title?panel(title,f):f;
}
export function selectOptions(items,labelFn=x=>x.name??x.label??x.id){return items.map(x=>({value:typeof x==='string'?x:x.id,label:typeof x==='string'?x:cell(labelFn(x))+' · '+short(x.id)}));}
export function busy(handler,onError){return async e=>{const target=e?.currentTarget;if(target)target.disabled=true;try{return await handler(e);}catch(error){onError(error);}finally{if(target)target.disabled=false;}};}
