/* Complete customer column choices over the original Event workbook proposal. */
export const HANDOVER = 'stellar-forge.event-workbook-columns.v1';
export const MAX_EVENT_WORKBOOK_CHOICES_BYTES = 16*1024*1024;
export const CHOICE_STORAGE_WARNING = 'Browser choice storage is unavailable. Save the complete editable worksheet or download fitting complete choices to retain this exact work.';
export const TYPES = ['native','text','integer','number','decimal-text','boolean','date','datetime-utc','datetime-local','binary-base64'];
const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (ok,message) => { if (!ok) throw Error(message); };
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const hash = /^[a-f0-9]{64}$/, id = /^[a-f0-9]{32}$/;
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key)+':'+canonical(value[key])).join(',') + '}';
}
function text(value,label,max=1000000) {
  need(typeof value === 'string' && value.length <= max,label+' must retain complete text within its allowance.');
  return value;
}
function keys(value,allowed,message) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)),message);
}
export function sourceColumns(source) {
  need(plain(source) && ['report','query-export'].includes(source.kind) &&
    typeof source.id==='string' && id.test(source.id) && hash.test(source.sha256),
    'Retain the exact original worksheet source identity.');
  need(Array.isArray(source.columns) && source.columns.length>0 && source.columns.length<=16384,
    'Retain all complete new source columns.');
  return source.columns.map((item,index) => ({index,name:text(plain(item)?item.name:item,'Original source column',1000000)}));
}
export function context(value) {
  need(plain(value) && typeof value.workspace_id==='string' && value.workspace_id.length>0 &&
    value.workspace_id.length<=200 && /^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(value.programme),
    'Select the original customer workspace and programme.');
  const proposal=value.proposal;
  need(plain(proposal) && proposal.state==='WORKBOOK_COLUMN_CHOICES_REQUIRED' &&
    id.test(proposal.operation_id) && hash.test(proposal.review_sha256) &&
    Array.isArray(proposal.worksheets) && proposal.worksheets.length>0 && proposal.worksheets.length<=32,
    'Open the complete native worksheet-column proposal.');
  const seen=new Set();
  for(const sheet of proposal.worksheets) {
    need(plain(sheet) && Number.isSafeInteger(sheet.sheet) && sheet.sheet>=0 && sheet.sheet<32 &&
      !seen.has(sheet.sheet),'Retain distinct original worksheet indexes.');
    seen.add(sheet.sheet);text(sheet.name,'Worksheet name',124);sourceColumns(sheet.new_source);
    need(Array.isArray(sheet.original_columns) && sheet.original_columns.length>0 &&
      sheet.original_columns.length<=16384,'Retain every original worksheet column.');
    sheet.original_columns.forEach(column => columnShape(column));
  }
  return {workspace_id:value.workspace_id,programme:value.programme,proposal:clone(proposal)};
}
function columnShape(column) {
  keys(column,['source','source_index','header','type','null','null_text','precision'],'A worksheet column has unknown fields.');
  text(column.source,'Source column');text(column.header??column.source,'Excel heading');
  need(TYPES.includes(column.type??'native'),'Select an existing native conversion type.');
  need(['blank','text'].includes(column.null??'text'),'Choose blank or labelled null values.');
  text(column.null_text??'NULL','Null label');
  need(['preserve','excel-number'].includes(column.precision??'preserve'),'Choose the original precision handling.');
  if(own(column,'source_index')) need(Number.isSafeInteger(column.source_index)&&column.source_index>=0,
    'Retain the original report column ordinal.');
  return column;
}
function normalized(column) {
  columnShape(column);
  return {...clone(column),header:column.header??column.source,type:column.type??'native',
    null:column.null??'text',null_text:column.null_text??'NULL',precision:column.precision??'preserve'};
}
function sameContext(actual,expected) {
  need(canonical(context(actual))===canonical(context(expected)),
    'These choices belong to another workspace, programme, reviewed operation or complete worksheet source.');
}
export function initial(value) {
  const selected=context(value),columns={};
  for(const sheet of selected.proposal.worksheets) columns[String(sheet.sheet)]=sheet.original_columns.map(normalized);
  return {schema:HANDOVER,original:selected,columns};
}
export function reopen(value,selected) {
  keys(value,['schema','original','columns'],'Choose a complete Event workbook column handover.');
  need(value.schema===HANDOVER && plain(value.columns),'Choose a supported complete worksheet handover.');
  const original=context(value.original);if(selected) sameContext(original,selected);
  const indexes=original.proposal.worksheets.map(sheet=>String(sheet.sheet));
  need(indexes.every(index=>own(value.columns,index)) && Object.keys(value.columns).every(index=>/^(0|[1-9][0-9]*)$/.test(index)&&Number(index)<32),
    'Keep every unresolved worksheet and its complete selected column array.');
  const columns={};
  for(const index of Object.keys(value.columns)) {
    const selectedColumns=value.columns[index];
    need(Array.isArray(selectedColumns)&&selectedColumns.length<=16384,'Keep the complete selected worksheet column array.');
    columns[index]=selectedColumns.map(normalized);
  }
  return {schema:HANDOVER,original,columns};
}
export function serializeNativeJSON(value) {
  const pretty=JSON.stringify(value,null,2);need(typeof pretty==='string','Retain a complete JSON value.');
  if(utf8Length(pretty+'\n')<=MAX_EVENT_WORKBOOK_CHOICES_BYTES)return pretty+'\n';
  const compact=JSON.stringify(value)+'\n';
  need(utf8Length(compact)<=MAX_EVENT_WORKBOOK_CHOICES_BYTES,
    'The complete JSON exceeds the original 16 MiB return-file allowance. Keep this window open and save the complete editable worksheet to retain the full proposal and choices; no content has been removed.');
  return compact;
}
export function serializeChoices(value) {
  const selected=reopen(value),pretty=JSON.stringify(selected,null,2)+'\n';
  if(utf8Length(pretty)<=MAX_EVENT_WORKBOOK_CHOICES_BYTES)return pretty;
  const compact=JSON.stringify(selected)+'\n';
  need(utf8Length(compact)<=MAX_EVENT_WORKBOOK_CHOICES_BYTES,
    'The complete choices exceed the original 16 MiB return-file allowance. Keep this window open and save the complete editable worksheet to retain all work; no choices have been removed.');
  return compact;
}
function validUnicode(value) {
  for(let i=0;i<value.length;i++) { const c=value.charCodeAt(i);
    if(c>=0xd800&&c<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(c>=0xdc00&&c<=0xdfff)return false;
  } return true;
}
function utf8Length(value) {
  let bytes=0;for(const char of value){const cp=char.codePointAt(0);bytes+=cp<=0x7f?1:cp<=0x7ff?2:cp<=0xffff?3:4;}return bytes;
}
function literal(value,maximum) {
  return validUnicode(value)&&utf8Length(value)<=maximum&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value);
}
export function selectedOrdinal(source,column) {
  const labels=sourceColumns(source);
  if(source.kind==='report' && own(column,'source_index'))
    return labels[column.source_index]?.name===column.source ? column.source_index : -1;
  const found=labels.filter(row=>row.name===column.source);
  return found.length===1?found[0].index:-1;
}
export function chooseSource(source,column,index) {
  const selected=sourceColumns(source)[index];need(selected,'Select an actual original source column.');
  const result={...normalized(column),source:selected.name};
  if(source.kind==='report')result.source_index=index;else delete result.source_index;
  return result;
}
export function review(value) {
  const selected=reopen(value),issues=[];
  for(const sheet of selected.original.proposal.worksheets) {
    const columns=selected.columns[String(sheet.sheet)],headers=new Set();
    if(!columns.length)issues.push({sheet:sheet.sheet,column:null,message:'Keep at least one selected worksheet column.'});
    columns.forEach((column,index)=>{
      const add=message=>issues.push({sheet:sheet.sheet,column:index,message});
      if(selectedOrdinal(sheet.new_source,column)<0)add('Choose an available source column; the previous selection is absent or ambiguous.');
      if(!column.header.trim()||!literal(column.header,2000))add('Provide an XML-safe Excel heading within 2000 UTF-8 bytes.');
      const folded=column.header.toLowerCase();if(headers.has(folded))add('Choose distinct Excel headings.');headers.add(folded);
      if(!literal(column.null_text,1000))add('Keep the XML-safe null label within 1000 UTF-8 bytes.');
    });
  }
  return {ready:issues.length===0,issues,columns:clone(selected.columns),original:clone(selected.original),
    native_checks:{unicode_heading_uniqueness:'pending-native-casefold',source_conversions:'pending-native-complete-rows',definition:'pending-native-current-head'},
    instruction:'The original native WorkbookRefresh checks Unicode case-folded heading uniqueness, complete source-row conversions and the current definition before saving.'};
}
export function nativeColumns(value) {
  const result=review(value);
  need(result.ready,result.issues.map(row=>'Worksheet '+row.sheet+(row.column===null?'':' column '+(row.column+1))+': '+row.message).join('\n'));
  return result.columns;
}
export function replaceColumns(value,columns) {
  return reopen({...reopen(value),columns},value.original);
}
const escapeHTML=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function reviewHTML(value) {
  const saved=reopen(value),result=review(saved),e=escapeHTML,p=saved.original.proposal;
  const tables=saved.original.proposal.worksheets.map(sheet=>{
    const columns=saved.columns[String(sheet.sheet)];
    const original='<details><summary>Complete preceding worksheet columns</summary><pre>'+e(JSON.stringify(sheet.original_columns,null,2))+'</pre></details>';
    return '<section><h2>'+e(sheet.name)+' · worksheet '+sheet.sheet+'</h2><p>Source '+e(sheet.new_source.kind)+' / '+e(sheet.new_source.id)+'<br>SHA-256 '+e(sheet.new_source.sha256)+'</p><table><thead><tr><th>Position</th><th>Source and ordinal</th><th>Excel heading</th><th>Conversion</th><th>Null</th><th>Precision</th></tr></thead><tbody>'+
      columns.map((c,i)=>'<tr><td data-label="Position">'+(i+1)+'</td><td data-label="Source and ordinal">'+e(c.source)+(own(c,'source_index')?'<br>Report ordinal '+c.source_index:'')+'</td><td data-label="Excel heading">'+e(c.header)+'</td><td data-label="Conversion">'+e(c.type)+'</td><td data-label="Null">'+e(c.null==='blank'?'Blank':c.null_text)+'</td><td data-label="Precision">'+e(c.precision)+'</td></tr>').join('')+'</tbody></table>'+original+'</section>';
  }).join('');
  const indexes=new Set(saved.original.proposal.worksheets.map(sheet=>String(sheet.sheet)));
  const extra=Object.fromEntries(Object.entries(saved.columns).filter(([key])=>!indexes.has(key)));
  const additional=Object.keys(extra).length?'<section><h2>Other complete worksheet choices retained from this original action</h2><p>These selected arrays remain attached to the same reviewed operation. Their source and conversion validation stays with the original native workbook.</p><pre>'+e(JSON.stringify(extra,null,2))+'</pre></section>':'';
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Event workbook column review</title><style>:root{color-scheme:light;color:#202020;background:#fff;font:15px/1.5 system-ui}body{margin:0 auto;max-width:1200px;padding:24px}h1{font-size:26px}h2{font-size:20px}table{border-collapse:collapse;width:100%}th,td{padding:10px;border-bottom:1px solid #bbb;text-align:left;vertical-align:top;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{margin:24px 0}p{overflow-wrap:anywhere}@media(max-width:700px){body{padding:16px}table,tbody,tr,td{display:block}thead{display:none}tr{border-bottom:1px solid #888}td{border:0;padding:4px}td::before{content:attr(data-label)": ";font-weight:600;margin-right:8px}}@media print{body{max-width:none;padding:0}details{display:block}details>pre{display:block}tr{break-inside:avoid}}</style><body><h1>Complete Event workbook column review</h1><p>Customer workspace '+e(saved.original.workspace_id)+'<br>Programme '+e(saved.original.programme)+'<br>Original operation '+e(p.operation_id)+'<br>Review SHA-256 '+e(p.review_sha256)+'</p><p>'+e(result.ready?'All selected column references and form values are ready for original native conversion review.':'Unfinished choices: '+result.issues.length+' item(s) need review.')+'</p><ul>'+result.issues.map(row=>'<li>'+e('Worksheet '+row.sheet+(row.column===null?'':' / column '+(row.column+1))+': '+row.message)+'</li>').join('')+'</ul>'+tables+additional+'<p>'+e(result.instruction)+'</p></body></html>\n';
}
export function createEventWorkbookColumnReview(root,{onChange=()=>{},onMessage=()=>{},onEditableDownload=null}={}) {
  const doc=root.ownerDocument,el=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=String(text);return node;};
  let current=null,locked=false,page=0,activeSheet=null,cached=null,storageUnavailable=false,storageNotice=null;
  const size=20,controls=[];
  function addControl(node,disabled=false){node.disabled=locked||disabled;controls.push({node,disabled});return node;}
  function key(){const c=current.original;return 'sf-event-workbook-columns:'+c.workspace_id+':'+c.programme+':'+c.proposal.operation_id+':'+c.proposal.review_sha256;}
  function same(value){return current && canonical(context(value))===canonical(current.original);}
  function setStatus(text,error=false){
    if(storageUnavailable&&!text.includes(CHOICE_STORAGE_WARNING))text+=' '+CHOICE_STORAGE_WARNING;
    onMessage(text,error||storageUnavailable);
  }
  function snapshot(){need(current,'Open an original workbook-column proposal.');return reopen(current);}
  function persist(){
    const value=snapshot();storageUnavailable=false;
    try{const raw=JSON.stringify(value);localStorage.setItem(key(),raw);if(localStorage.getItem(key())!==raw)throw Error();}
    catch{storageUnavailable=true;}
    if(storageNotice){storageNotice.textContent=storageUnavailable?CHOICE_STORAGE_WARNING:'';storageNotice.hidden=!storageUnavailable;}
    onChange(clone(value.columns),{retained:!storageUnavailable});
    if(storageUnavailable)setStatus(CHOICE_STORAGE_WARNING,true);
  }
  function download(raw,name,type){const url=URL.createObjectURL(new Blob([raw],{type})),a=el('a');a.href=url;a.download=name;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  function perform(fn){try{const pending=fn();if(pending&&typeof pending.catch==='function')pending.catch(error=>setStatus(error.message,true));}catch(error){setStatus(error.message,true);}}
  function button(label,fn,disabled=false){const node=addControl(el('button',label),disabled);node.type='button';node.addEventListener('click',()=>perform(fn));return node;}
  function input(label,value,fn,{select=null,rows=0}={}) {
    const box=el('label',label),field=el(select?'select':rows?'textarea':'input');
    if(select)for(const [value,text]of select){const option=el('option',text);option.value=value;field.append(option);}
    field.value=value;if(rows)field.rows=rows;
    addControl(field);field.addEventListener(select?'change':'input',()=>perform(()=>fn(field.value)));
    box.append(field);return box;
  }
  function updateSummary(node){const r=review(current);node.textContent=r.ready?'Selected references and UTF-8/XML field values are ready for native review. The original native workbook will check Unicode heading uniqueness, complete source conversions and the current definition.':r.issues.length+' incomplete choice(s). '+r.issues.slice(0,4).map(x=>'Sheet '+x.sheet+(x.column===null?'':' column '+(x.column+1))+': '+x.message).join(' ');}
  function render(){
    root.replaceChildren();controls.length=0;storageNotice=null;if(!current)return;
    storageNotice=el('p',storageUnavailable?CHOICE_STORAGE_WARNING:'');storageNotice.className='notice';storageNotice.setAttribute('role','alert');storageNotice.hidden=!storageUnavailable;
    const sheets=current.original.proposal.worksheets;
    if(!sheets.some(s=>s.sheet===activeSheet))activeSheet=sheets[0].sheet;
    const sheet=sheets.find(s=>s.sheet===activeSheet),columns=current.columns[String(activeSheet)];
    page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(columns.length/size)-1)));
    const intro=el('p','Keep the complete customer worksheet choices while selecting the new source. Earlier headings, conversion types, null labels and precision stay editable. The original workbook performs the final complete-data review.');
    const toolbar=el('div');toolbar.className='row';
    toolbar.append(input('Worksheet',String(activeSheet),v=>{activeSheet=Number(v);page=0;render();},
      {select:sheets.map(s=>[String(s.sheet),s.name+' · index '+s.sheet])}),
      button('Download complete choices',()=>download(serializeChoices(snapshot()),'event-workbook-columns-'+current.original.proposal.operation_id+'.json','application/json')),
      button('Download complete readable review',()=>download(reviewHTML(snapshot()),'event-workbook-column-review-'+current.original.proposal.operation_id+'.html','text/html;charset=utf-8')));
    if(onEditableDownload)toolbar.append(button('Download complete editable worksheet',()=>onEditableDownload(snapshot(),{sheet:activeSheet,page})));
    const picker=addControl(el('input'));picker.type='file';picker.accept='.json,application/json';const pickLabel=el('label','Reopen complete choices');pickLabel.append(picker);
    const importButton=button('Open selected choices',()=>{const file=picker.files[0];need(file&&file.size>0&&file.size<=MAX_EVENT_WORKBOOK_CHOICES_BYTES,'Choose a complete column-choice file up to 16 MiB.');const before=canonical(current.original),workingBefore=canonical(current),selected=current.original;
      file.text().then(raw=>{const next=reopen(JSON.parse(raw),selected);need(!locked,'An original action started while the file was opening. Reopen these saved choices after it finishes.');need(current&&canonical(current.original)===before,'The original proposal changed while the file was opening.');need(canonical(current)===workingBefore,'The displayed choices changed while the file was opening. Select the saved file again to review replacement.');if(!confirm('Replace the displayed choices for this exact original proposal with this complete saved file?'))return;current=next;page=0;persist();render();setStatus('Opened every retained choice for this exact original worksheet source.');}).catch(error=>setStatus(error.message,true));});
    toolbar.append(pickLabel,importButton);root.append(intro,storageNotice,toolbar);
    if(cached){const bar=el('div');bar.className='row';bar.append(el('p','This browser retains a different complete choice set for the same proposal.'),button('Restore browser choices',()=>{if(!confirm('Replace the displayed choices with this browser’s complete saved choices for the same proposal?'))return;current=reopen(cached,current.original);cached=null;page=0;persist();render();}));root.append(bar);}
    const extra=Object.fromEntries(Object.entries(current.columns).filter(([index])=>!sheets.some(sheet=>String(sheet.sheet)===index)));
    if(Object.keys(extra).length){const retained=el('details');retained.append(el('summary','Other complete worksheet choices retained from this original action'),el('pre',JSON.stringify(extra,null,2)));root.append(retained);}
    const summary=el('p');summary.setAttribute('role','status');updateSummary(summary);root.append(summary);
    const source=el('details'),sourceTitle=el('summary','Complete new source and previous column definitions');source.append(sourceTitle,el('pre',JSON.stringify({source:sheet.new_source,original_columns:sheet.original_columns},null,2)));root.append(source);
    const status=el('p',(columns.length?'Columns '+(page*size+1)+'–'+Math.min(columns.length,(page+1)*size):'No selected columns')+' of '+columns.length+' · '+sourceColumns(sheet.new_source).length+' complete source columns');
    root.append(status);
    const choices=sourceColumns(sheet.new_source).map(row=>[String(row.index),row.name+' · source ordinal '+row.index]);
    for(let ordinal=page*size;ordinal<Math.min(columns.length,(page+1)*size);ordinal++){
      const column=columns[ordinal],box=el('fieldset'),legend=el('legend','Output column '+(ordinal+1)+' · '+(column.header||'Unfinished heading'));box.append(legend);
      const selected=selectedOrdinal(sheet.new_source,column),options=[['','Select an original source column'],...choices];
      if(selected<0)box.append(el('p','Previous source selection: '+column.source+(own(column,'source_index')?' / report ordinal '+column.source_index:'')+'. Select its intended replacement or remove this output column.'));
      const row=el('div');row.className='row';
      row.append(input('New source column',selected<0?'':String(selected),v=>{if(v==='')return;columns[ordinal]=chooseSource(sheet.new_source,column,Number(v));persist();render();},{select:options}),
        input('Excel heading',column.header,v=>{column.header=v;legend.textContent='Output column '+(ordinal+1)+' · '+(v||'Unfinished heading');persist();updateSummary(summary);}));
      const settings=el('div');settings.className='row';
      settings.append(input('Conversion',column.type,v=>{column.type=v;persist();updateSummary(summary);},{select:TYPES.map(t=>[t,t])}),
        input('Null values',column.null,v=>{column.null=v;persist();render();},{select:[['text','Use the complete null label'],['blank','Leave an empty Excel cell']]}),
        input('Precision',column.precision,v=>{column.precision=v;persist();updateSummary(summary);},{select:[['preserve','Preserve exact value as text when needed'],['excel-number','Use Excel numeric precision']]}));
      box.append(row,settings);
      if(column.null==='text')box.append(input('Complete null label',column.null_text,v=>{column.null_text=v;persist();updateSummary(summary);}));
      const actions=el('div');actions.className='row';actions.append(
        button('Move earlier',()=>{[columns[ordinal-1],columns[ordinal]]=[columns[ordinal],columns[ordinal-1]];page=Math.floor((ordinal-1)/size);persist();render();},ordinal===0),
        button('Move later',()=>{[columns[ordinal+1],columns[ordinal]]=[columns[ordinal],columns[ordinal+1]];page=Math.floor((ordinal+1)/size);persist();render();},ordinal===columns.length-1),
        button('Remove this output column',()=>{columns.splice(ordinal,1);persist();render();}));
      box.append(actions);root.append(box);
    }
    const footer=el('div');footer.className='row';footer.append(
      button('Earlier columns',()=>{page--;render();},page===0),
      button('Later columns',()=>{page++;render();},(page+1)*size>=columns.length),
      button('Add an output column',()=>{columns.push({source:'',header:'',type:'text',null:'text',null_text:'NULL',precision:'preserve'});page=Math.floor((columns.length-1)/size);persist();render();},columns.length>=16384),
      button('Restore this sheet’s original columns',()=>{if(!confirm('Replace every displayed choice in this worksheet with its complete original columns?'))return;current.columns[String(activeSheet)]=sheet.original_columns.map(normalized);page=0;persist();render();}));
    root.append(footer,el('p','Exact identifiers and payloads normally remain text. Decimal-text keeps the original decimal spelling; preserve retains values beyond Excel precision as text. The original native review checks actual complete rows for every selected conversion.'));
  }
  return {
    open(value,{columns=null}={}) {
      const selected=context(value);if(same(selected))return snapshot();
      let candidate=initial(selected);
      if(columns && Object.keys(columns).length) {
        candidate=replaceColumns(candidate,{...candidate.columns,...clone(columns)});
      }
      let retained=null;current=candidate;activeSheet=null;page=0;cached=null;storageUnavailable=false;
      try{const raw=localStorage.getItem(key());if(raw)retained=reopen(JSON.parse(raw),selected);}catch{}
      if(retained && canonical(retained.columns)!==canonical(candidate.columns))cached=retained;
      render();onChange(clone(current.columns));return snapshot();
    },
    clear(){current=null;cached=null;activeSheet=null;page=0;storageUnavailable=false;storageNotice=null;root.replaceChildren();controls.length=0;},
    lock(value){locked=!!value;for(const c of controls)c.node.disabled=locked||c.disabled;},
    selected(){return current?clone(current.original):null;},
    view(value){
      need(current,'Open the original worksheet before selecting its view.');
      if(value!==undefined){
        need(plain(value)&&Object.keys(value).length===2&&Number.isSafeInteger(value.sheet)&&Number.isSafeInteger(value.page)&&value.page>=0&&
          current.original.proposal.worksheets.some(sheet=>sheet.sheet===value.sheet),'Retain a valid original worksheet view.');
        activeSheet=value.sheet;page=value.page;render();
      }
      return {sheet:activeSheet,page};
    },
    snapshot,
    columns(){return nativeColumns(snapshot());},
    useColumns(value){current=replaceColumns(snapshot(),value);cached=null;page=0;persist();render();},
    download(){download(serializeChoices(snapshot()),'event-workbook-columns-'+current.original.proposal.operation_id+'.json','application/json');}
  };
}
