// The classification view shares the original workspace, revision and recovery path.
const copy = value => structuredClone(value);
const labels = {method:'Pay structures',roles:'Role classifications',roster:'Workforce editions',scenario:'Placement and cost'};
const groups = {method:'methods',roles:'roles',roster:'rosters',scenario:'scenarios'};
const fields = {
  method:[['id','Grade ID'],['label','Grade label'],['min','Minimum annual rate'],['reference','Market / reference annual rate'],['max','Maximum annual rate'],['reference_label','Reference label'],['source_ref','Source page / reference']],
  roles:[['id','Role ID'],['title','Job title'],['department','Department'],['grade_id','Proposed grade ID'],['current_grade_id','Current grade ID'],['native_job_id','Original workspace job ID'],['description','Job description','textarea'],['rationale','Classification basis','textarea'],['grade_override_rationale','Point-band override basis','textarea']],
  roster:[['id','Workforce row ID'],['role_id','Role ID'],['fte','FTE'],['annual_base_rate','Current annual full-time base rate'],['annual_incentive_rate','Current annual full-time incentive rate'],['credited_years','Credited prior experience in years'],['proposed_annual_base_rate','Explicit proposed full-time base rate'],['current_grade_id','Current grade ID'],['manager_id','Supervisor workforce row ID'],['source_ref','Source row / reference'],['placement_rationale','Explicit placement basis','textarea']]
};

function losslessJSON(text) {
  // Source numeric lexemes stay strings, including decimals beyond browser precision.
  let out='', quoted=false, escaped=false;
  for(let i=0;i<text.length;) {
    const c=text[i];
    if(quoted){out+=c;i++;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;out+=c;i++;continue;}
    if(c==='-'||/[0-9]/.test(c)){
      const match=text.slice(i).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
      if(match){out+=JSON.stringify(match[0]);i+=match[0].length;continue;}
    }
    out+=c;i++;
  }
  return JSON.parse(out.replace(/^\uFEFF/,''));
}

function csvRows(text) {
  text=text.replace(/^\uFEFF/,'');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)throw new Error('A CSV quote appears inside an unquoted cell.');quoted=true;continue;}
    if(c===','||c==='\n'||c==='\r'){
      row.push(cell);cell='';closed=false;
      if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];}
      continue;
    }
    if(closed)throw new Error('Unexpected characters follow a closed CSV field.');
    cell+=c;
  }
  if(quoted)throw new Error('The CSV ends inside a quoted field.');
  if(cell||row.length){row.push(cell);if(row.some(v=>v.trim()))rows.push(row);}
  const headers=rows.shift()||[];
  if(!headers.length||headers.some(h=>!h)||new Set(headers).size!==headers.length)throw new Error('CSV needs unique nonblank headers.');
  if(rows.length>25000)throw new Error('Import at most 25,000 rows.');
  if(rows.some(r=>r.length!==headers.length))throw new Error('A CSV row differs from its header width.');
  return {headers,rows:rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])))};
}

function fresh(kind) {
  const document={name:'',edition:'',basis:'',source_refs:[]};
  if(kind==='method')Object.assign(document,{mode:'explicit_grades',currency:'USD',rate_basis:'annual_fulltime',effective_date:'',effective_timing:'',grades:[],factors:[],score_bands:[]});
  else Object.assign(document,{rows:[]});
  if(kind==='roster')Object.assign(document,{data_kind:'',currency:'USD',rate_basis:'',as_of:''});
  if(kind==='scenario')return {method_id:'',roles_id:'',roster_id:'',baseline_method_id:'',config:{
    title:'',purpose:'',placement:'minimum_floor',period_start:'',period_end:'',day_basis:'actual_actual',
    include_incentives:false,allow_explicit_reductions:false,burden_pct:'0',burden_basis:'',
    minimum_manager_gap_pct:'0',experience_pct_per_year:'0',maximum_credited_years:'0',
    phases:[],incentive_rules:[]},texts:{},preview:null,previewInputs:null,supersedes:''};
  return {document,method_id:'',roles_id:'',supersedes:'',texts:{},original:null,mapping:{},edited_rows:false,page:0,selected:null};
}

function objectValue(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function objectRows(value,label){
  if(!Array.isArray(value)||value.length>25000||value.some(row=>!objectValue(row)))throw new Error(label+' must be an array of at most 25,000 row objects.');
  return value;
}
function sourceShape(kind,value){
  if(!objectValue(value))throw new Error('The editable document must be an object.');
  objectRows(value[kind==='method'?'grades':'rows'],kind==='method'?'Grades':'Source rows');
  return value;
}
function draftShape(kind,draft){
  if(!objectValue(draft)||!objectValue(draft.texts))throw new Error('The saved editor draft has an invalid structure.');
  if(kind==='scenario'){
    if(!objectValue(draft.config))throw new Error('The saved scenario configuration must be an object.');
    objectRows(draft.config.phases,'Implementation phases');objectRows(draft.config.incentive_rules,'Incentive rules');
  }else{
    sourceShape(kind,draft.document);
    if(!objectValue(draft.mapping))throw new Error('The saved column mapping must be an object.');
    if(draft.original&&(!objectValue(draft.original)||typeof draft.original.content!=='string'||!['csv','json'].includes(draft.original.format)))throw new Error('The original imported source is not a readable CSV or JSON record.');
  }
  return draft;
}

export function mountClassificationBridge(target, api) {
  const document=target.ownerDocument, win=document.defaultView, workspaceId=api.getState().workspace.id;
  let disposed=false,busy=false,loadSequence=0,data={methods:[],roles:[],rosters:[],scenarios:[]};
  let retained={tab:'method',actor:'',reviewer:'',drafts:Object.fromEntries(Object.keys(labels).map(k=>[k,fresh(k)])),opened:null,reviewNotes:''};
  let opened=null,inspectionPage=0,dbPromise=null,writeChain=Promise.resolve(),draftErrorShown=false;
  const cache=new Map(),disabled=new Map();
  const root=make('section',undefined,'classification'),notice=make('div',undefined,'notice');
  notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');root.setAttribute('aria-label','Classification and placement workspace');
  const style=make('style');
  style.textContent='.classification .cl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.classification .cl-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 18px}.classification .cl-tabs [aria-selected=true]{background:#24272b;color:#fff}.classification .cl-json{font:12px/1.5 ui-monospace,monospace;min-height:130px}.classification .cl-wide{grid-column:1/-1}.classification .cl-rows td{vertical-align:top}.classification .cl-rows td:first-child{max-width:220px;overflow-wrap:anywhere}.classification .cl-meta{font-size:12px;color:#5e646b;overflow-wrap:anywhere}.classification .cl-issues{border-left:3px solid #72777e;padding-left:14px}.classification .cl-metrics{display:flex;gap:24px;flex-wrap:wrap;margin:14px 0}.classification .cl-metric strong{display:block;font-size:21px}.classification details{margin:14px 0}.classification summary{cursor:pointer;font-weight:600}.classification .cl-source{font-size:12px;overflow-wrap:anywhere}.classification .cl-check{display:flex;align-items:center;gap:8px}.classification .cl-check input{width:auto}.classification .cl-record{border-top:1px solid #d9dde2;padding-top:16px;margin-top:16px}.classification .cl-internal{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.classification .cl-row-editor{border:1px solid #bcc3ca;background:#f7f8f9;padding:18px;margin:14px 0}.classification a{color:inherit;text-decoration:underline}.classification input,.classification select,.classification textarea{min-width:0;width:100%;box-sizing:border-box}.classification textarea{min-height:90px}.classification .cl-section{margin-top:20px}.classification table{min-width:640px}.classification .cl-json-export{white-space:pre-wrap;overflow-wrap:anywhere}.classification .cl-meta code{white-space:normal}@media(max-width:680px){.classification .cl-grid{grid-template-columns:1fr}.classification .actions{flex-wrap:wrap}.classification .cl-row-editor{padding:12px}.classification .cl-metric strong{font-size:18px}}';
  const contents=make('div');root.append(style,notice,contents);target.replaceChildren(root);
  for(const type of ['click','submit','input','change'])root.addEventListener(type,event=>event.stopPropagation());
  function make(tag,value,className){const node=document.createElement(tag);if(value!==undefined)node.textContent=String(value??'');if(className)node.className=className;return node;}
  function actions(...nodes){const div=make('div',undefined,'actions');div.append(...nodes.filter(Boolean));return div;}
  function panel(title){const div=make('section',undefined,'panel');if(title)div.append(make('h3',title));return div;}
  function hint(value){return make('p',value,'cl-meta');}
  function pre(value){return make('pre',typeof value==='string'?value:JSON.stringify(value,null,2),'code cl-json-export');}
  function label(title,control){const node=make('label',title);node.append(control);return node;}
  function show(message,error=false){if(disposed)return;notice.className='notice'+(error?' error':'');notice.textContent=message;}
  function input(title,value,change,type='text'){
    const control=make(type==='textarea'?'textarea':'input');if(type!=='textarea')control.type=type;
    control.value=value??'';control.setAttribute('aria-label',title);
    control.addEventListener('input',()=>{change(control.value);void persist();});
    return label(title,control);
  }
  function select(title,value,options,change){
    const control=make('select');control.setAttribute('aria-label',title);
    for(const [id,name]of options){const option=make('option',name);option.value=id;control.append(option);}
    control.value=value??'';control.addEventListener('change',()=>{change(control.value);void persist();});
    return label(title,control);
  }
  function check(title,value,change){
    const control=make('input');control.type='checkbox';control.checked=!!value;control.setAttribute('aria-label',title);
    control.addEventListener('change',()=>{change(control.checked);void persist();});
    const node=label('',control);node.className='cl-check';node.append(document.createTextNode(title));return node;
  }
  function button(title,work,primary=false){
    const control=make('button',title,primary?'primary':'');control.type='button';
    control.addEventListener('click',()=>perform(work));return control;
  }
  function details(title,content){const node=make('details');node.append(make('summary',title),content);return node;}
  function table(headers,rows){
    const wrap=make('div',undefined,'scroll cl-rows'),t=make('table'),head=make('thead'),tr=make('tr'),body=make('tbody');
    for(const title of headers){const th=make('th',title);th.scope='col';tr.append(th);}head.append(tr);t.append(head,body);
    for(const row of rows){const tr=make('tr');for(const value of row){const td=make('td');td.append(value?.nodeType?value:document.createTextNode(String(value??'—')));tr.append(td);}body.append(tr);}
    wrap.append(t);return wrap;
  }
  function money(value){if(value==null)return '—';const match=String(value).match(/^(-?)(\d+)(?:\.(\d+))?$/);if(!match)return String(value);return match[1]+match[2].replace(/\B(?=(\d{3})+(?!\d))/g,',')+(match[3]?'.'+match[3]:'');}
  function lock(){for(const control of root.querySelectorAll('button,input,select,textarea')){if(!disabled.has(control))disabled.set(control,control.disabled);control.disabled=true;}}
  async function perform(work){
    if(disposed||busy)return;busy=true;root.setAttribute('aria-busy','true');lock();
    try{await persist();await work();await persist();}
    catch(error){show(error.message||String(error),true);if(error.details)notice.append(pre(error.details));}
    finally{busy=false;root.removeAttribute('aria-busy');for(const [control,value]of disabled)control.disabled=value;disabled.clear();}
  }
  function draftDB(){
    if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const request=win.indexedDB.open('staff-market-classification-drafts',1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts');request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);});
    return dbPromise;
  }
  async function readDraft(){
    try{const db=await draftDB();const value=await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readonly'),request=tx.objectStore('drafts').get(workspaceId);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      if(value){
        const drafts={...retained.drafts};
        for(const kind of Object.keys(labels))if(value.drafts&&Object.hasOwn(value.drafts,kind)){
          const original=value.drafts[kind];
          try{drafts[kind]=draftShape(kind,original);}
          catch(error){drafts[kind]=fresh(kind);drafts[kind].recovery={message:error.message,retained:original};}
        }
        retained={...retained,...value,drafts};if(!labels[retained.tab]&&retained.tab!=='history')retained.tab='method';
      }}
    catch(error){show('Browser draft storage could not reopen: '+error.message,true);draftErrorShown=true;}
  }
  function persist(){
    if(disposed)return writeChain;const snapshot=copy(retained);
    writeChain=writeChain.catch(()=>{}).then(async()=>{const db=await draftDB();await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(snapshot,workspaceId);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Draft write interrupted'));});});
    writeChain.catch(error=>{if(!draftErrorShown){show('The browser draft could not be retained: '+error.message,true);draftErrorShown=true;}});
    return writeChain;
  }
  async function reload(){
    const sequence=++loadSequence,next=await api.request('/api/extensions/classification/state');
    if(disposed||sequence!==loadSequence||api.getState().workspace.id!==workspaceId)return;
    if(next.workspace_id!==workspaceId)throw new Error('Reopen classification from the selected workspace.');
    data=next;if(retained.opened)opened=await getDoc(retained.opened.kind,retained.opened.id,true);
    if(disposed||sequence!==loadSequence)return;render();
  }
  async function getDoc(kind,id,fresh=false){
    const key=kind+'/'+id;if(!fresh&&cache.has(key))return cache.get(key);
    const result=await api.request('/api/extensions/classification/document/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id));
    if(result.id!==id||result.kind!==kind)throw new Error('The selected original classification edition was not returned.');
    cache.set(key,result);return result;
  }
  async function call(action,payload){
    const result=await api.mutate('/api/extensions/classification/'+action,payload);
    await api.refresh(false);if(disposed||api.getState().workspace.id!==workspaceId)throw new Error('The active workspace changed; reopen its original saved request.');
    return result.result;
  }
  function operator(){const actor=retained.actor.trim();if(!actor)throw new Error('Enter the person recording this edition.');return actor;}
  function options(kind,filter=()=>true){return [['','Select a saved edition…'],...(data[groups[kind]]||[]).filter(filter).map(row=>[row.id,(row.name||row.id)+(row.edition?' · '+row.edition:'')+' · '+(row.latest_review?.outcome||'review pending')])];}
  function jsonField(title,draft,key,current){
    const value=Object.hasOwn(draft.texts,key)?draft.texts[key]:JSON.stringify(current??[],null,2);
    const node=input(title,value,v=>{draft.texts[key]=v;if(draft===retained.drafts.scenario)scenarioChanged();},'textarea');node.querySelector('textarea').className='cl-json';return node;
  }
  function originalJSON(raw,kind){
    let value=losslessJSON(raw);
    if(value?.root&&Array.isArray(value.documents)){if(value.root.kind!==kind)throw new Error('Select the matching editable document kind.');value=value.documents.find(row=>row.id===value.root.id);if(!value)throw new Error('The original export root is absent.');}
    if(value?.content){if(value.kind&&value.kind!==kind)throw new Error('Select the matching editable document kind.');value=value.content;}
    if(Array.isArray(value)&&kind!=='method')return {rows:value};
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('The input must contain an editable document.');
    return value;
  }
  function sourceDraft(kind){
    const draft=retained.drafts[kind],value=copy(draft.document);
    for(const key of ['source_refs',...(kind==='method'?['factors','score_bands']:[])])if(Object.hasOwn(draft.texts,key))value[key]=losslessJSON(draft.texts[key]);
    return value;
  }
  function rowList(kind,draft){return kind==='method'?draft.document.grades:draft.document.rows;}
  function edited(draft){if(draft.original)draft.edited_rows=true;}
  async function importFile(kind,file){
    if(!file)return;if(file.size>24*1024*1024)throw new Error('Import a source file no larger than 24 MiB.');
    const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
    const draft=retained.drafts[kind],format=kind==='method'||file.name.toLowerCase().endsWith('.json')?'json':'csv';
    let parsed,mapping={};
    try{
      if(format==='json')parsed=originalJSON(content,kind);
      else{const csv=csvRows(content);parsed={rows:csv.rows};mapping=Object.fromEntries(fields[kind].filter(([key])=>csv.headers.includes(key)).map(([key])=>[key,key]));}
      sourceShape(kind,parsed);
    }catch(error){
      draft.importIssue={message:error.message,original:{content,format,filename:file.name}};
      await persist();render();throw error;
    }
    draft.document={...draft.document,...parsed};draft.texts={};draft.page=0;draft.selected=null;draft.edited_rows=false;
    draft.original={content,format,filename:file.name};draft.mapping=mapping;delete draft.importIssue;
    await persist();render();show(file.name+' is loaded with its original bytes. Review the document and mapping before retaining the edition.');
  }
  function retainedDownload(title,value,filename){
    return button(title,()=>{const url=win.URL.createObjectURL(new Blob([value],{type:'application/octet-stream'})),link=make('a');link.href=url;link.download=filename;root.append(link);link.click();link.remove();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);});
  }
  function recoveryPanel(kind,draft){
    if(!draft?.recovery&&!draft?.importIssue)return null;
    const p=panel('Source draft recovery');
    for(const issue of [draft.recovery,draft.importIssue].filter(Boolean)){
      p.append(make('p',issue.message));
      const original=issue.original||issue.retained?.original;
      if(original&&typeof original.content==='string')p.append(retainedDownload('Download retained original file',original.content,original.filename||kind+'-original.txt'));
      if(Object.hasOwn(issue,'retained'))p.append(retainedDownload('Download complete retained draft',JSON.stringify(issue.retained,null,2),kind+'-retained-draft.json'));
    }
    p.append(hint('The original input remains available above. Correct it and import the revised file, or continue in the usable editor below.'));
    return p;
  }
  function importPanel(kind,draft){
    const p=panel('Load an editable source');const file=make('input');file.type='file';file.accept=kind==='method'?'.json':'.json,.csv';file.setAttribute('aria-label','Import '+labels[kind]);
    file.addEventListener('change',()=>perform(()=>importFile(kind,file.files?.[0])));p.append(file);
    p.append(hint(kind==='method'?'Load an editable pay structure, or add the published grades below. Rates remain annual full-time decimal strings.':'Load a complete editable JSON edition or a CSV table. Add the edition basis and confirm the original source columns.'));
    if(draft.original){p.append(hint('Original file: '+draft.original.filename+' · '+draft.original.format+(draft.edited_rows?' · derived row edits retained':'')));
      if(draft.original.format==='csv'){
        let parsed;try{parsed=csvRows(draft.original.content);}catch(error){p.append(make('p','The retained CSV needs correction: '+error.message),retainedDownload('Download original CSV for correction',draft.original.content,draft.original.filename||kind+'-original.csv'));return p;}
        const mapping=make('div',undefined,'cl-grid');
        for(const [key,title]of fields[kind])mapping.append(select(title+' column',draft.mapping[key]||'',[['','Unmapped'],...parsed.headers.map(x=>[x,x])],value=>{
          if(value)draft.mapping[key]=value;else delete draft.mapping[key];
          draft.document.rows=parsed.rows.map(row=>Object.fromEntries(Object.entries(draft.mapping).map(([dest,source])=>[dest,row[source]??''])));
          draft.edited_rows=false;draft.selected=null;render();
        }));
        p.append(details('Original CSV column mapping',mapping));
      }
    }
    return p;
  }
  function consumeRatings(row){
    let value=Object.hasOwn(row,'_ratings_text')?losslessJSON(row._ratings_text):row.ratings??[];
    if(typeof value==='string')value=losslessJSON(value);
    objectRows(value,'Point-factor ratings');row.ratings=copy(value);delete row._ratings_text;
    return row.ratings;
  }
  function rowEditor(kind,draft,index){
    const rows=rowList(kind,draft),row=rows[index],p=make('section',undefined,'cl-row-editor');if(!row)return p;
    p.append(make('h4',(kind==='method'?'Grade':kind==='roles'?'Role':'Workforce row')+' '+(row.id||String(index+1))));
    const grid=make('div',undefined,'cl-grid');
    for(const [key,title,type]of fields[kind])grid.append(input(title,typeof row[key]==='object'?JSON.stringify(row[key]):row[key],value=>{row[key]=value;edited(draft);},type||'text'));
    if(kind==='roles'){
      const refs=input('Role source references (JSON)',row._source_refs_text??JSON.stringify(row.source_refs||[],null,2),value=>{row._source_refs_text=value;edited(draft);},'textarea');grid.append(refs);
      const method=cache.get('method/'+draft.method_id)?.content;
      if(method?.mode==='point_factors'){
        const ratingBox=make('div',undefined,'cl-wide');ratingBox.append(make('h4','Evaluate the original point factors'));
        let ratings;try{ratings=consumeRatings(row);}catch(error){
          ratingBox.append(make('p','Correct the retained ratings before choosing factor levels: '+error.message),input('Point-factor ratings (JSON)',row._ratings_text??JSON.stringify(row.ratings??[],null,2),value=>{row._ratings_text=value;edited(draft);},'textarea'),button('Use corrected ratings',()=>{consumeRatings(row);edited(draft);render();}));
        }
        for(const factor of ratings?method.factors:[]){let rating=ratings.find(x=>x.factor_id===factor.id);if(!rating){rating={factor_id:factor.id,level_id:'',evidence:''};ratings.push(rating);}
          const group=panel(factor.label);group.append(hint(factor.definition),select('Level for '+factor.label,rating.level_id,[['','Select a defined level…'],...factor.levels.map(x=>[x.id,x.label+' · '+x.points+' points'])],value=>{rating.level_id=value;edited(draft);}),input('Job-content evidence for '+factor.label,rating.evidence,value=>{rating.evidence=value;edited(draft);},'textarea'));ratingBox.append(group);}
        grid.append(ratingBox);
      }else grid.append(input('Point-factor ratings (JSON)',row._ratings_text??JSON.stringify(row.ratings||[],null,2),value=>{row._ratings_text=value;edited(draft);},'textarea'));
    }
    p.append(grid,actions(button('Finish editing row',()=>{draft.selected=null;render();}),button('Remove this row',()=>{rows.splice(index,1);draft.selected=null;edited(draft);render();})));
    return p;
  }
  function rowsPanel(kind,draft){
    const rows=rowList(kind,draft),p=panel(kind==='method'?'Grade structure':kind==='roles'?'Role decisions':'Workforce input');
    const columns=fields[kind].slice(0,kind==='method'?6:5),pageSize=25,total=rows.length;
    draft.page=Math.max(0,Math.min(draft.page||0,Math.max(0,Math.ceil(total/pageSize)-1)));
    p.append(hint(total+' rows · '+(kind==='method'?'Minimum, published reference and maximum are separate values.':kind==='roles'?'Each title retains its job-content basis and selected grade.':'FTE multiplies the declared annual full-time rate once. Keep combined authorization groups as one planning row.')));
    p.append(table([...columns.map(x=>x[1]),'Edit'],rows.slice(draft.page*pageSize,(draft.page+1)*pageSize).map((row,offset)=>[...columns.map(([key])=>row[key]),button('Edit row',()=>{draft.selected=draft.page*pageSize+offset;render();})])));
    const previous=button('Previous rows',()=>{draft.page--;draft.selected=null;render();}),next=button('Next rows',()=>{draft.page++;draft.selected=null;render();});previous.disabled=draft.page===0;next.disabled=(draft.page+1)*pageSize>=total;
    p.append(actions(previous,next,button('Add '+(kind==='method'?'grade':kind==='roles'?'role':'workforce row'),()=>{
      const row=Object.fromEntries(fields[kind].map(([key])=>[key,'']));
      if(kind==='method')row.reference_label='Market / reference';
      if(kind==='roles'){row.source_refs=[];row.ratings=[];}
      rows.push(row);draft.selected=rows.length-1;draft.page=Math.floor((rows.length-1)/pageSize);edited(draft);render();
    })));
    if(draft.selected!==null)p.append(rowEditor(kind,draft,draft.selected));
    return p;
  }
  function historyRows(kind){
    const rows=data[groups[kind]]||[];
    return table(['Edition','State','Rows','Recorded','Open'],rows.map(row=>[
      [row.name,row.edition].filter(Boolean).join(' · '),row.latest_review?.outcome||'Review pending',row.rows,row.created_at,
      actions(button('Inspect / review',()=>openDocument(kind,row.id)),button('Use as draft',()=>editDocument(kind,row.id)))
    ]));
  }
  function sourceView(kind){
    const draft=retained.drafts[kind],value=draft.document,fragment=make('div');
    fragment.append(importPanel(kind,draft));const p=panel('Edition and source basis'),grid=make('div',undefined,'cl-grid');
    grid.append(input('Edition name',value.name,v=>value.name=v),input('Edition / fiscal year',value.edition,v=>value.edition=v));
    if(kind==='method'){
      grid.append(input('Effective calendar date, when specified',value.effective_date,v=>value.effective_date=v,'date'),
        input('Original effective timing / pay-period language',value.effective_timing,v=>value.effective_timing=v),input('Currency',value.currency,v=>value.currency=v),
        select('Classification method',value.mode,[['explicit_grades','Explicit reviewed grade assignments'],['point_factors','Defined point factors and score bands']],v=>{value.mode=v;render();}));
      p.append(hint('Rates are annual full-time amounts. Preserve the issuer’s reference label; a published market salary may differ from a range midpoint.'));
    }
    if(kind==='roles')grid.append(select('Original proposed pay structure',draft.method_id,options('method'),v=>{draft.method_id=v;void perform(async()=>{if(v)await getDoc('method',v);render();});}));
    if(kind==='roster')grid.append(select('Original role edition',draft.roles_id,options('roles'),v=>{draft.roles_id=v;}),
      select('Workforce source kind',value.data_kind,[['','Declare the source kind…'],['employee_rates','Individual employee rates'],['planning_cohort','Explicit aggregate planning cohorts']],v=>value.data_kind=v),
      select('Source rate declaration',value.rate_basis,[['','Confirm the original rate basis…'],['annual_fulltime','Annual full-time rates, multiplied by FTE']],v=>value.rate_basis=v),
      input('Workforce as-of date',value.as_of,v=>value.as_of=v,'date'),input('Currency',value.currency,v=>value.currency=v));
    p.append(grid,input('Source and decision basis',value.basis,v=>value.basis=v,'textarea'),details('Source URLs, pages and file identities',jsonField('Source references (JSON)',draft,'source_refs',value.source_refs)));
    if(kind==='method'&&value.mode==='point_factors')p.append(details('Defined factor levels and grade point bands',actions(
      jsonField('Factors with definitions, levels and points',draft,'factors',value.factors),
      jsonField('Inclusive score bands',draft,'score_bands',value.score_bands))));
    fragment.append(p,rowsPanel(kind,draft));
    fragment.append(actions(button('Retain '+labels[kind].toLowerCase()+' edition',()=>saveSource(kind),true),
      button('Start a new edition',()=>{retained.drafts[kind]=fresh(kind);render();})));
    if(draft.supersedes)fragment.append(hint('This draft is a new edition derived from '+draft.supersedes+'.'));
    const saved=panel('Saved '+labels[kind].toLowerCase());saved.append(historyRows(kind));fragment.append(saved);return fragment;
  }
  async function saveSource(kind){
    const draft=retained.drafts[kind],value=sourceDraft(kind);
    for(const row of value.rows||[]){
      if(Object.hasOwn(row,'_source_refs_text')){row.source_refs=losslessJSON(row._source_refs_text);delete row._source_refs_text;}
      if(Object.hasOwn(row,'_ratings_text')){row.ratings=losslessJSON(row._ratings_text);delete row._ratings_text;}
    }
    const payload={actor:operator(),document:value};
    if(kind==='roles')payload.method_id=draft.method_id;if(kind==='roster')payload.roles_id=draft.roles_id;
    if(draft.supersedes)payload.supersedes=draft.supersedes;
    if(draft.original)Object.assign(payload,draft.original,{mapping:Object.keys(draft.mapping).length?draft.mapping:null,edited_rows:!!draft.edited_rows});
    const result=await call('save_'+kind,payload);
    draft.supersedes=result.id;draft.document=copy(result.content);draft.texts={};draft.selected=null;
    await reload();await openDocument(kind,result.id);show('The complete original '+kind+' edition is retained. Record its source review below.');
  }
  async function editDocument(kind,id){
    const doc=await getDoc(kind,id,true),draft=fresh(kind);
    if(kind==='scenario'){draft.config=copy(doc.content.config);for(const [key,value]of Object.entries(doc.parents))draft[key+'_id']=value.id;}
    else{draft.document=copy(doc.content);draft.original=doc.original_input?{content:doc.original_input.content,format:doc.original_input.format,filename:doc.original_input.filename}:null;draft.mapping=copy(doc.original_input?.mapping||{});draft.edited_rows=!!draft.original;if(kind==='roles')draft.method_id=doc.parents.method.id;if(kind==='roster')draft.roles_id=doc.parents.roles.id;}
    draft.supersedes=id;retained.drafts[kind]=draft;retained.tab=kind;retained.opened=null;opened=null;
    if(kind==='roles')await getDoc('method',draft.method_id);await persist();render();
  }
  async function openDocument(kind,id){
    opened=await getDoc(kind,id,true);retained.opened={kind,id};inspectionPage=0;retained.reviewNotes='';retained.tab='history';await persist();render();
  }

  function scenarioPayload(){
    const draft=retained.drafts.scenario,config=copy(draft.config);
    if(Object.hasOwn(draft.texts,'incentive_rules'))config.incentive_rules=losslessJSON(draft.texts.incentive_rules);
    const payload={method_id:draft.method_id,roles_id:draft.roles_id,roster_id:draft.roster_id,config};
    if(draft.baseline_method_id)payload.baseline_method_id=draft.baseline_method_id;
    return payload;
  }
  function scenarioChanged(){
    const draft=retained.drafts.scenario;draft.preview=null;draft.previewInputs=null;
    const control=root.querySelector('[data-retain-scenario]');if(control)control.disabled=true;
    const status=root.querySelector('[data-scenario-preview-status]');if(status)status.textContent='The inputs changed. Calculate the current scenario to replace this previous preview.';
  }
  function scenarioView(){
    const draft=retained.drafts.scenario,config=draft.config,fragment=make('div'),p=panel('Select the exact source editions'),grid=make('div',undefined,'cl-grid');
    const change=work=>value=>{scenarioChanged();work(value);};
    grid.append(
      select('Proposed pay structure',draft.method_id,options('method'),change(v=>{draft.method_id=v;draft.roles_id='';draft.roster_id='';render();})),
      select('Role edition',draft.roles_id,options('roles',row=>row.parents?.method?.id===draft.method_id),change(v=>{draft.roles_id=v;draft.roster_id='';render();})),
      select('Workforce edition',draft.roster_id,options('roster',row=>row.parents?.roles?.id===draft.roles_id),change(v=>draft.roster_id=v))
    );
    p.append(grid,hint('Saved input editions remain available for drafting. Acceptance verifies the current review of every exact input edition.'));
    const decision=panel('Placement decision'),form=make('div',undefined,'cl-grid');
    form.append(input('Scenario title',config.title,change(v=>config.title=v)),
      select('Placement rule',config.placement,[
        ['minimum_floor','Bring base rates up to the proposed minimum'],
        ['range_position','Preserve position in the original pay range'],
        ['experience','Apply declared prior-experience credit'],
        ['manual','Use explicit reviewed proposed rates']
      ],change(v=>{config.placement=v;render();})),
      input('Cost period start',config.period_start,change(v=>config.period_start=v),'date'),
      input('Cost period end (inclusive)',config.period_end,change(v=>config.period_end=v),'date'),
      select('Annual proration',config.day_basis,[['actual_actual','Actual days / actual calendar year'],['actual_365','Actual days / 365']],change(v=>config.day_basis=v)),
      input('Incremental burden percent',config.burden_pct,change(v=>config.burden_pct=v)),
      input('Minimum supervisor base differential for review (%)',config.minimum_manager_gap_pct,change(v=>config.minimum_manager_gap_pct=v))
    );
    if(config.placement==='range_position')form.append(select('Original baseline pay structure',draft.baseline_method_id,options('method'),change(v=>draft.baseline_method_id=v)));
    if(config.placement==='experience')form.append(input('Minimum-rate increase per credited year (%)',config.experience_pct_per_year,change(v=>config.experience_pct_per_year=v)),input('Maximum years credited',config.maximum_credited_years,change(v=>config.maximum_credited_years=v)));
    decision.append(form,input('Purpose and placement decision basis',config.purpose,change(v=>config.purpose=v),'textarea'),input('Burden basis and included employer costs',config.burden_basis,change(v=>config.burden_basis=v),'textarea'));
    if(config.placement==='manual')decision.append(check('Allow explicit base-pay reductions in this proposed scenario',config.allow_explicit_reductions,change(v=>config.allow_explicit_reductions=v)),
      hint('Each workforce row must contain its proposed annual full-time base rate and placement rationale. Reductions and out-of-range proposals remain visible for review.'));
    else decision.append(hint('Automatic rules retain an existing base rate when it exceeds the calculated placement. Rates above the proposed maximum remain visible as exceptions.'));
    const phases=panel('Implementation phases');
    phases.append(hint('Each percentage is the cumulative share of the proposed change in effect from that date. Use increasing dates and nondecreasing shares.'));
    phases.append(table(['Effective date','Cumulative implementation (%)','Remove'],config.phases.map((phase,index)=>[
      input('Phase '+(index+1)+' effective date',phase.effective_date,change(v=>phase.effective_date=v),'date'),
      input('Phase '+(index+1)+' cumulative share',phase.share_pct,change(v=>phase.share_pct=v)),
      button('Remove phase',()=>{config.phases.splice(index,1);draft.preview=null;render();})
    ])));
    phases.append(button('Add implementation phase',()=>{config.phases.push({effective_date:'',share_pct:'100'});draft.preview=null;render();}));
    const incentives=panel('Incentive treatment');
    incentives.append(check('Include the current and proposed incentive rates in this cost scenario',config.include_incentives,change(v=>{config.include_incentives=v;render();})));
    if(config.include_incentives){
      incentives.append(hint('The workforce must declare each current annual full-time incentive rate, including an explicit zero when appropriate. A rule replaces the current incentive for its selected roles; multiple matching rules add together. Roles without a rule retain their current incentive.'));
      incentives.append(jsonField('Proposed incentive rules',draft,'incentive_rules',config.incentive_rules),
        details('Rule fields and source basis',pre({id:'stable-rule-id',label:'Incentive name',role_ids:['exact-role-id'],annual_flat_rate:'0',base_pct:'0',basis:'Original policy and eligibility basis'})));
    }
    fragment.append(p,decision,phases,incentives,actions(button('Calculate complete placement and cost',async()=>{
      const payload=scenarioPayload(),result=await call('preview_scenario',payload);
      draft.preview=result;draft.previewInputs=copy(payload);await reload();show('The full calculation is ready. Review all exceptions and source assumptions before retaining it.');
    },true),button('Start a new scenario',()=>{retained.drafts.scenario=fresh('scenario');render();})));
    if(draft.preview){
      const previewStatus=hint('Current preview uses the exact selected input editions and configuration.');previewStatus.dataset.scenarioPreviewStatus='';
      fragment.append(previewStatus,resultPanel(draft.preview));
      const retain=button('Retain this exact scenario',async()=>{
        const payload=scenarioPayload();
        if(!draft.preview)throw new Error('Calculate the current scenario before retaining it.');
        if(JSON.stringify(payload)!==JSON.stringify(draft.previewInputs))throw new Error('The scenario inputs changed. Calculate the current decision before retaining it.');
        const result=await call('save_scenario',{...payload,actor:operator(),expected_preview_sha256:draft.preview.preview_sha256,...(draft.supersedes?{supersedes:draft.supersedes}:{})});
        draft.supersedes=result.id;await reload();await openDocument('scenario',result.id);show('The exact scenario is retained with all input editions. Its review and accepted exports are below.');
      },true);retain.dataset.retainScenario='';fragment.append(retain);
    }
    const saved=panel('Saved placement and cost scenarios');saved.append(historyRows('scenario'));fragment.append(saved);return fragment;
  }
  function resultPanel(result){
    const p=panel('Calculated placement and cost'),totals=result.totals,metrics=make('div',undefined,'cl-metrics');
    for(const [title,value]of [['Workforce rows',totals.rows],['FTE',totals.total_fte],['Period incremental cost',money(totals.period_total)+' '+result.currency],['Full annual incremental cost',money(totals.annual_incremental_cost)+' '+result.currency],['Rows with review exceptions',totals.exception_rows]]){
      const metric=make('div',undefined,'cl-metric');metric.append(make('span',title),make('strong',value));metrics.append(metric);
    }
    p.append(metrics,hint('Source kind: '+result.data_kind+' · '+result.config.period_start+' through '+result.config.period_end+' inclusive.'),make('p',result.workforce_basis));
    const issues=[...(result.errors||[]).map(x=>'Error: '+x),...(result.warnings||[]).map(x=>'Review: '+x)];
    if(issues.length){const list=make('ul',undefined,'cl-issues');for(const issue of issues)list.append(make('li',issue));p.append(list);}
    p.append(table(['Period component','Amount ('+result.currency+')'],[
      ['Base-pay change',money(totals.period_base_delta)],['Incentive change',money(totals.period_incentive_delta)],
      ['Incremental burden',money(totals.period_burden)],['Rounding adjustment',money(totals.period_rounding_adjustment)],
      ['Total period incremental cost',money(totals.period_total)]
    ]),hint(result.rounding));
    p.append(details('Department totals',table(['Department','Rows','FTE','Period incremental cost','Full annual incremental cost'],result.departments.map(row=>[row.department,row.rows,row.fte,money(row.period_total),money(row.annual_incremental_cost)]))));
    p.append(details('Exact proration segments',table(['From','Through','Days','Annual denominator','Cumulative share (%)','Annual fraction'],result.segments.map(row=>[row.start,row.end,row.days,row.annual_day_denominator,row.share_pct,row.annual_fraction]))));
    if(result.relationships.length)p.append(details('Supervisor differential review',table(['Supervisor row','Subordinate row','Proposed base gap (%)','Review threshold (%)','Review exception'],result.relationships.map(row=>[row.manager_id,row.subordinate_id,row.base_gap_pct,row.requested_minimum_gap_pct,row.review_required?'Yes':'No']))));
    const rows=result.rows,size=25,maxPage=Math.max(0,Math.ceil(rows.length/size)-1);inspectionPage=Math.min(Math.max(0,inspectionPage),maxPage);
    p.append(make('h4','Complete workforce decisions'),hint('Rows '+(rows.length?inspectionPage*size+1:0)+'–'+Math.min(rows.length,(inspectionPage+1)*size)+' of '+rows.length));
    p.append(table(['Workforce row','Role / grade','FTE','Current base rate','Proposed base rate','Period incremental cost','Exceptions / errors','Calculation'],rows.slice(inspectionPage*size,(inspectionPage+1)*size).map(row=>[
      row.id,row.role_title+' / '+row.grade_id,row.fte,money(row.current_annual_base_rate),money(row.proposed_annual_base_rate),money(row.period_total),
      [...row.exceptions,...row.errors].join('; '),details('Original inputs and arithmetic',pre(row))
    ])));
    const previous=button('Previous decisions',()=>{inspectionPage--;render();}),next=button('Next decisions',()=>{inspectionPage++;render();});previous.disabled=inspectionPage===0;next.disabled=inspectionPage>=maxPage;p.append(actions(previous,next));
    return p;
  }
  function download(kind,id,title){
    const link=make('a',title);link.href='/api/extensions/classification/download/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id);link.setAttribute('download','');return link;
  }
  function inspection(doc){
    const p=panel('Original '+labels[doc.kind].toLowerCase()+' edition'),value=doc.content,latest=doc.reviews?.at(-1);
    p.append(make('h4',value.name||value.config?.title||doc.id),hint((value.edition?value.edition+' · ':'')+doc.created_at+' · recorded by '+doc.created_by),
      hint('Current review: '+(latest?.outcome||'Review pending')),hint('ID: '+doc.id+' · SHA-256 '+doc.sha256));
    const refs=Object.entries(doc.parents).map(([name,ref])=>[name,ref.id,ref.sha256,button('Open original input',()=>openDocument(ref.kind,ref.id))]);
    if(refs.length)p.append(details('Exact input editions',table(['Input','Original edition','Content identity','Open'],refs)));
    if(doc.kind==='scenario')p.append(resultPanel(value));
    else{
      p.append(make('p',value.basis));
      if(value.errors?.length||value.warnings?.length){const list=make('ul',undefined,'cl-issues');for(const issue of [...(value.errors||[]),...(value.warnings||[])])list.append(make('li',issue));p.append(list);}
      const rows=doc.kind==='method'?value.grades:value.rows,size=25;
      inspectionPage=Math.min(Math.max(0,inspectionPage),Math.max(0,Math.ceil(rows.length/size)-1));
      const columns=fields[doc.kind].slice(0,6);
      p.append(hint('Rows '+(rows.length?inspectionPage*size+1:0)+'–'+Math.min(rows.length,(inspectionPage+1)*size)+' of '+rows.length));
      p.append(table([...columns.map(x=>x[1]),'Full source row'],rows.slice(inspectionPage*size,(inspectionPage+1)*size).map(row=>[...columns.map(([key])=>row[key]),details('Inspect complete row',pre(row))])));
      const previous=button('Previous original rows',()=>{inspectionPage--;render();}),next=button('Next original rows',()=>{inspectionPage++;render();});previous.disabled=inspectionPage===0;next.disabled=(inspectionPage+1)*size>=rows.length;p.append(actions(previous,next));
      p.append(details('Complete method, sources and metadata',pre({...value,rows:undefined,grades:doc.kind==='method'?undefined:value.grades})));
    }
    if(doc.original_input)p.append(hint('Original imported file: '+doc.original_input.filename+' · SHA-256 '+doc.original_input.raw_sha256+(doc.original_input.edited_rows?' · explicit row edits retained in this edition':'')));
    const review=make('div',undefined,'cl-record');review.append(make('h4','Record the source / decision review'),input('Reviewer',retained.reviewer,v=>retained.reviewer=v),input('Review rationale and disposition of exceptions',retained.reviewNotes,v=>retained.reviewNotes=v,'textarea'));
    const record=async outcome=>{
      if(!retained.reviewer.trim())throw new Error('Enter the reviewer recording this decision.');
      await call('review',{kind:doc.kind,id:doc.id,expected_sha256:doc.sha256,reviewer:retained.reviewer.trim(),outcome,notes:retained.reviewNotes});
      await reload();show('The '+outcome.replaceAll('_',' ')+' review is recorded against the exact original edition.');
    };
    review.append(actions(button('Accept this edition',()=>record('accepted'),true),button('Request changes',()=>record('changes_requested'))));
    const downloads=actions(download(doc.kind,doc.id,'Editable source JSON'),button('Use as a new draft',()=>editDocument(doc.kind,doc.id)));
    if(doc.kind==='scenario'&&latest?.outcome==='accepted')downloads.append(download('scenario-csv',doc.id,'Accepted placement and cost CSV'),download('scenario-package',doc.id,'Accepted complete source package'));
    review.append(downloads);
    if(doc.reviews?.length)review.append(details('Review history',table(['Recorded','Reviewer','Outcome','Rationale'],doc.reviews.map(row=>[row.created_at,row.reviewer,row.outcome,row.notes]))));
    p.append(review);return p;
  }
  function historyView(){
    const fragment=make('div');if(opened)fragment.append(inspection(opened));
    for(const kind of Object.keys(labels)){const p=panel(labels[kind]);p.append(historyRows(kind));fragment.append(p);}
    return fragment;
  }
  function render(){
    if(disposed)return;
    const header=panel('Classification, placement and implementation cost'),grid=make('div',undefined,'cl-grid');
    grid.append(input('Person recording editions',retained.actor,v=>retained.actor=v));header.append(grid,hint('One workspace retains the classification method, job decisions, annual full-time workforce rates, cost assumptions and accepted outputs. Saved editions and calculation inputs remain individually reviewable.'));
    const tabs=make('div',undefined,'cl-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Classification workflow');
    for(const [key,title]of [...Object.entries(labels),['history','Review and exports']]){
      const control=button(title,()=>{retained.tab=key;render();});control.setAttribute('role','tab');control.setAttribute('aria-selected',retained.tab===key?'true':'false');control.setAttribute('aria-controls','classification-panel');tabs.append(control);
    }
    const body=make('div');body.id='classification-panel';body.setAttribute('role','tabpanel');const recovery=recoveryPanel(retained.tab,retained.drafts[retained.tab]);if(recovery)body.append(recovery);body.append(retained.tab==='history'?historyView():retained.tab==='scenario'?scenarioView():sourceView(retained.tab));
    contents.replaceChildren(header,tabs,body);if(busy)lock();
  }
  const ready=(async()=>{await readDraft();await reload();if(retained.drafts.roles.method_id)await getDoc('method',retained.drafts.roles.method_id);if(!disposed)render();})();
  return {ready,refresh:reload,destroy(){disposed=true;loadSequence++;writeChain.catch(()=>{}).then(()=>dbPromise?.then(db=>db.close()).catch(()=>{}));target.replaceChildren();}};
}
