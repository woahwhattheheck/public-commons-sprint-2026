// MIT. Islandora operator workflow over the retained OAI migration desk.
const STEPS=['Migration','Records','Files and parents','Target returns','Workbench','Handover'];
const STATES={DRAFT:'Draft',REVIEW:'Needs review',READ_TARGET:'Receive target records',PREPARED:'Prepared',READY:'Reviewed',RUNNING:'Running',INSPECTING:'Reading target',CONTINUE:'Continue saved work',COMPLETE:'Complete',CREATE:'Create',UPDATE:'Update',UNCHANGED:'Current'};
const text=value=>value===null||value===undefined?'':typeof value==='string'?value:JSON.stringify(value);
const label=value=>STATES[value]||String(value||'').replaceAll('_',' ').toLowerCase();
const date=value=>{if(!value)return '—';const d=new Date(value);return Number.isNaN(d.valueOf())?'Date unavailable':d.toLocaleString('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
const clone=value=>JSON.parse(JSON.stringify(value));
let sequence=0;
function el(tag,attrs={},...children){
 const node=document.createElement(tag);
 for(const [name,value] of Object.entries(attrs)){
  if(value===undefined||value===null)continue;
  if(name.startsWith('on'))node.addEventListener(name.slice(2),value);
  else if(name==='class')node.className=value;
  else if(name in node)node[name]=value;
  else node.setAttribute(name,value);
 }
 for(const child of children.flat(Infinity))if(child!==undefined&&child!==null)node.append(child instanceof Node?child:document.createTextNode(String(child)));
 return node;
}
const p=value=>el('p',{},value);
const pre=value=>el('pre',{},typeof value==='string'?value:JSON.stringify(value,null,2));
const opt=(value,name)=>el('option',{value},name);
function field(name,control,help=''){
 control.id ||= 'islandora-field-'+(++sequence);
 return el('div',{},el('label',{htmlFor:control.id},name),control,help?el('p',{class:'muted'},help):null);
}
function select(items,current,change){
 const node=el('select',{onchange:event=>change(event.target.value)},...items.map(([value,name])=>opt(value,name)));
 node.value=current??'';return node;
}
function input(value,change,attrs={}){
 return el('input',{value:value??'',...attrs,oninput:event=>change(event.target.value)});
}
function area(value,change,attrs={}){
 return el('textarea',{value:value??'',rows:4,...attrs,oninput:event=>change(event.target.value)});
}
function checkbox(value,change,name){
 const node=el('input',{type:'checkbox',checked:!!value,onchange:event=>change(event.target.checked)});
 return el('label',{class:'islandora-check'},node,el('span',{},name));
}
function table(headers,rows){
 return el('div',{class:'table',tabIndex:0,role:'region','aria-label':headers.join(', ')},
  el('table',{},el('thead',{},el('tr',{},...headers.map(name=>el('th',{scope:'col'},name)))),
  el('tbody',{},...rows.map(row=>el('tr',{},...row.map(value=>el('td',{},value)))))));
}
const card=(title,...children)=>el('section',{},el('h2',{},title),...children);
const details=(title,...children)=>el('details',{},el('summary',{},title),...children);
const query=(path,values)=>path+'?'+new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined&&v!==null));
function jsonObject(value,name){
 let parsed;try{parsed=JSON.parse(value||'{}');}catch{throw Error(name+' must be valid JSON.');}
 if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw Error(name+' must be an object.');
 return parsed;
}
async function file64(file){
 if(!file)throw Error('Select the complete original file.');
 if(file.size>32*1024*1024)throw Error('Use the native Islandora command for files larger than 32 MiB.');
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
 for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
 return btoa(binary);
}
function manifestRows(value,kind){
 let rows;
 if(value.trimStart().startsWith('[')||value.trimStart().startsWith('{')){
  const parsed=JSON.parse(value);
  rows=Array.isArray(parsed)?parsed:(parsed[kind]||parsed.files||parsed.entries||parsed.relations);
 }else{
  const lines=[];let row=[],cell='',quoted=false,afterQuote=false;
  value=value.replace(/^\uFEFF/,'');
  for(let i=0;i<value.length;i++){
   const c=value[i];
   if(quoted){if(c==='"'&&value[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;afterQuote=true;}else cell+=c;continue;}
   if(c==='"'){if(cell||afterQuote)throw Error('A manifest CSV quote is misplaced.');quoted=true;continue;}
   if(afterQuote&&!['\r','\n',','].includes(c))throw Error('A quoted manifest CSV cell has trailing characters.');
   if(c===','||c==='\n'||c==='\r'){
    row.push(cell);cell='';afterQuote=false;
    if(c!==','){if(c==='\r'&&value[i+1]==='\n')i++;if(row.some(v=>v!==''))lines.push(row);row=[];}
   }else cell+=c;
  }
  if(quoted)throw Error('The manifest contains an unfinished quoted CSV cell.');
  if(cell||afterQuote||row.length){row.push(cell);if(row.some(v=>v!==''))lines.push(row);}
  const names=lines.shift();
  if(!names?.length||names.some(v=>!v)||new Set(names).size!==names.length)throw Error('Use unique, nonempty manifest column names.');
  rows=lines.map((values,index)=>{if(values.length!==names.length)throw Error('Manifest row '+(index+1)+' does not match its header.');return Object.fromEntries(names.map((name,i)=>[name,values[i]]));});
 }
 if(!Array.isArray(rows)||!rows.length)throw Error('The manifest must contain a complete array or CSV of records.');
 const required=kind==='assets'?['identifier','path']:['child','parent'];
 rows.forEach((row,i)=>{if(!row||typeof row!=='object'||required.some(k=>typeof row[k]!=='string'||!row[k].trim()))throw Error('Manifest row '+(i+1)+' needs '+required.join(' and ')+'.');});
 return rows;
}

export function createIslandoraDesk({get,action,onState=async()=>{}}){
 let host,context={},active=false,epoch=0,timer=null,busy=false;
 let state={items:[],capabilities:[],running:false},job=null,jobId='',step='Migration';
 let selectedBuild='',selectedIdentifier='',kind='',search='',offset=0,notice='',noticeError=false;
 const drafts=new Map(),recordDrafts=new Map(),uploads=new Map(),logs=new Map();
 const api=(name,values={})=>get(query('/api/islandora/'+name,values));
 const call=(name,payload={})=>action('islandora.'+name,payload);
 const supports=name=>state.capabilities?.includes(name);
 const currentDraft=()=>{
  const key=jobId||'new:'+selectedBuild;
  if(!drafts.has(key))drafts.set(key,{label:'',host:'',username:'',content_type:'islandora_object',subdelimiter:'|',
   baseline:'',advanced:'{}',plan:null,inventory:null,assetRoot:'',reviewer:'',reviewNote:'',operator:'',handoverNote:'',
   workbench:'',python:'',returnHost:'',returnKind:'target',logRun:'',manifestPage:{assets:0,relationships:0}});
  return drafts.get(key);
 };
 const saveNotice=(message,error=false)=>{notice=message;noticeError=error;const node=host?.querySelector('[data-islandora-notice]');if(node){node.textContent=message;node.classList.toggle('islandora-error',error);node.hidden=!message;if(error)node.focus({preventScroll:true});}};
 async function reload(){state=await api('state');job=jobId?state.items.find(item=>item.id===jobId)||await api('job',{id:jobId}):null;}
 function btn(name,fn,{primary=false,disabled=false,refresh=true,message=''}={}){
  return el('button',{type:'button',class:primary?'primary':'',disabled,
   onclick:()=>void perform(fn,{refresh,message})},name);
 }
 async function perform(fn,{refresh=true,message=''}={}){
  if(busy)return;
  busy=true;saveNotice('Working…');
  const disabled=[...host.querySelectorAll('button,input,select,textarea')].map(node=>[node,node.disabled]);
  disabled.forEach(([node])=>node.disabled=true);
  host.setAttribute('aria-busy','true');
  let complete=false;
  try{await fn();if(refresh){await reload();await onState();}complete=true;saveNotice(message);}
  catch(error){saveNotice(error.message||String(error),true);}
  finally{
   busy=false;host?.removeAttribute('aria-busy');
   disabled.forEach(([node,was])=>{if(node.isConnected)node.disabled=was;});
   if(active&&complete){try{await paint();}catch(error){saveNotice(error.message||String(error),true);}}
  }
 }
 function download(path,values,name){return el('a',{class:'button',href:query(path,values)},name);}
 function metrics(values){return el('div',{class:'metrics'},...Object.entries(values).map(([name,value])=>el('div',{class:'metric'},el('b',{},value),el('span',{},name))));}
 function jobHeader(){
  const selected=select([['','New migration'],...state.items.map(item=>[item.id,item.label+' · '+label(item.status)])],jobId,value=>{
   void perform(async()=>{jobId=value;selectedIdentifier='';offset=0;step=value?'Records':'Migration';},{message:'',refresh:true});
  });
  const head=card('Islandora migration',p('Map a reviewed source dataset, receive the current target records, and operate the retained native Workbench batches.'),
   el('div',{class:'actions'},download('/download/islandora-guide',{},'Operator guide')),
   field('Migration',selected),el('div',{class:'islandora-statusline','aria-live':'polite'},
    job?job.label+' · '+(state.running?'Native work running':label(job.status))+' · '+job.target.host:'Choose a reviewed dataset to begin.'));
  if(job)head.append(metrics(Object.fromEntries(Object.entries(job.counts||{}).map(([key,value])=>[label(key),value]))),
   el('div',{class:'actions'},btn('Refresh migration',async()=>{},{}),
    download('/download/islandora',{job:job.id},'Download complete package')));
  return head;
 }
 async function paint(){
  if(!active||!host)return;
  const turn=++epoch;
  const body=el('div',{class:'islandora-desk'});
  const message=el('div',{'data-islandora-notice':'',class:'note'+(noticeError?' islandora-error':''),role:noticeError?'alert':'status',
   'aria-live':noticeError?'assertive':'polite',tabIndex:-1,hidden:!notice},notice);
  body.append(message,jobHeader());
  if(job)body.append(el('div',{class:'islandora-steps',role:'tablist','aria-label':'Migration steps'},
   ...STEPS.map(name=>el('button',{type:'button',role:'tab','aria-selected':step===name,
    'aria-controls':'islandora-step-panel',tabIndex:step===name?0:-1,disabled:busy,
    onclick:()=>void perform(async()=>{step=name;},{refresh:false}),
    onkeydown:event=>{const at=STEPS.indexOf(name);let next;
     if(event.key==='ArrowRight')next=(at+1)%STEPS.length;else if(event.key==='ArrowLeft')next=(at+STEPS.length-1)%STEPS.length;
     else if(event.key==='Home')next=0;else if(event.key==='End')next=STEPS.length-1;else return;
     event.preventDefault();step=STEPS[next];void paint().then(()=>host.querySelector('[role=tab][aria-selected=true]')?.focus()).catch(error=>saveNotice(error.message||String(error),true));
    }},name))));
  const main=el('div',{id:'islandora-step-panel',role:'tabpanel',tabIndex:0});body.append(main);
  if(!job||step==='Migration')await migration(main);
  else if(step==='Records')await records(main);
  else if(step==='Files and parents')await associations(main);
  else if(step==='Target returns')await receiving(main);
  else if(step==='Workbench')await workbench(main);
  else if(step==='Handover')await handover(main);
  if(!active||turn!==epoch)return;
  host.replaceChildren(body);
 }
 async function prepareDraft(){
  if(job){
   const draft=currentDraft();
   if(!draft.plan){
    draft.plan=clone(job.crosswalk);draft.constants=JSON.stringify(draft.plan.constants||{},null,2);
    draft.label=job.label;draft.host=job.target.host;draft.username=job.target.username||'';draft.baseline=job.baseline||'';
    draft.content_type=job.target.content_type;draft.subdelimiter=job.target.subdelimiter;
    draft.advanced=JSON.stringify(Object.fromEntries(Object.entries(job.target).filter(([k])=>!['host','username','content_type','subdelimiter'].includes(k))),null,2);
   }
   if(!draft.inventory)draft.inventory=await api('inventory',{build:job.buildId});
   return draft;
  }
  selectedBuild ||=context.selectedBuild||context.builds?.[0]?.id||'';
  const draft=currentDraft();
  if(selectedBuild&&!draft.plan){
   const [inventory,plan]=await Promise.all([api('inventory',{build:selectedBuild}),api('default-plan',{build:selectedBuild})]);
   draft.inventory=inventory;draft.plan=plan;draft.constants=JSON.stringify(plan.constants||{},null,2);
  }
  return draft;
 }
 function crosswalk(draft,locked){
  const plan=draft.plan;
  if(!plan)return p('Choose a reviewed native dataset to configure the field crosswalk.');
  const fields=el('div',{class:'islandora-rules'});
  plan.fields.forEach((rule,index)=>{
   const mode=select([['single','Single value'],['first','First value'],['join','Join as text'],['repeat','Repeated field'],['lookup','Controlled value lookup']],rule.mode||'single',value=>{rule.mode=value;void paint().catch(error=>saveNotice(error.message||String(error),true));});
   const remove=btn('Remove mapping',async()=>{plan.fields.splice(index,1);},{refresh:false,disabled:locked});
   const row=el('fieldset',{disabled:locked,class:'islandora-rule'},el('legend',{},'Field '+(index+1)),
    el('div',{class:'formgrid'},field('Source column',select(draft.inventory.columns.map(name=>[name,name]),rule.source,value=>rule.source=value)),
     field('Target Drupal field',input(rule.target,value=>rule.target=value,{placeholder:'field_identifier'})),
     field('Repeated-value handling',mode),checkbox(rule.required,value=>rule.required=value,'Required target value')));
   if(rule.mode==='join')row.append(field('Text separator',area(rule.separator??'\n\n',value=>rule.separator=value,{rows:2})));
   if(rule.mode==='lookup'){
    rule._lookupText ??=JSON.stringify(rule.lookup||{},null,2);
    row.append(field('Controlled value lookup',area(rule._lookupText,value=>rule._lookupText=value,{class:'code',rows:5}),
     'Map each original value to the target term or entity value, for example {"Text":"target term ID"}.'));
   }
   if(rule.mode==='first')row.append(p('This rule uses only the first source value. Choose a repeated or joined field when the full list belongs in the target.'));
   row.append(remove);fields.append(row);
  });
  fields.append(btn('Add field mapping',async()=>{plan.fields.push({source:draft.inventory.columns[0]||'',target:'',mode:'single',required:false});},{refresh:false,disabled:locked}));
  return el('div',{},fields,el('fieldset',{disabled:locked},
   el('div',{class:'formgrid'},
    field('Exact source identifier field',input(plan.identifierField||'',value=>plan.identifierField=value,{placeholder:'Optional target field machine name'}),'Stores the original OAI identifier separately from target node IDs.'),
    field('Target title length',input(plan.titleLimit??255,value=>plan.titleLimit=Number(value),{type:'number',min:1,step:1}))),
   field('Constant target values',area(draft.constants,value=>draft.constants=value,{class:'code',rows:4}),
    'Use a JSON object of target field names and their constant values.'),
   p('Map access policy, embargo end date, and file or media type to their own target fields. A rights statement supplies descriptive rights metadata; each target access field remains an explicit mapping.')));
 }
 function readPlan(draft){
  const plan=clone(draft.plan);
  plan.fields=plan.fields.map(rule=>{if(rule.mode==='lookup')rule.lookup=jsonObject(rule._lookupText??'{}','Controlled value lookup');delete rule._lookupText;return rule;});
  plan.constants=jsonObject(draft.constants,'Constant target values');
  if(!Number.isInteger(Number(plan.titleLimit))||Number(plan.titleLimit)<1)throw Error('Use a positive whole-number target title length.');
  return plan;
 }
 function targetConfig(draft){
  return {...jsonObject(draft.advanced,'Additional Workbench settings'),content_type:draft.content_type,
   subdelimiter:draft.subdelimiter,username:draft.username};
 }
 async function migration(root){
  const draft=await prepareDraft();
  const written=!!job?.runs?.some(run=>!run.check&&run.task!=='export_csv');
  const locked=written||state.running;
  const sourceChoice=select([['','Choose a native dataset'],...(context.builds||[]).map(build=>[build.id,build.rowCount+' records · '+build.id.slice(0,12)])],job?.buildId||selectedBuild,value=>{
   void perform(async()=>{selectedBuild=value;context.selectBuild?.(value);},{refresh:false});
  });sourceChoice.disabled=!!job||state.running;
  const body=card(job?'Migration settings and crosswalk':'Create a migration',field('Reviewed native dataset',sourceChoice));
  if(context.loadMoreBuilds&&!job)body.append(btn('Load more native datasets',context.loadMoreBuilds,{refresh:false}));
  if(!selectedBuild&&!job){
   body.append(p('Approve a retained OAI edition and build its native dataset in Projection before starting the migration.'));
   if(context.goProjection)body.append(btn('Open Projection',context.goProjection,{refresh:false}));
   root.append(body);return;
  }
  const target=el('fieldset',{disabled:state.running},
   el('div',{class:'formgrid'},
    field('Migration name',input(draft.label,value=>draft.label=value,{placeholder:'Repository collection migration',disabled:!!job})),
    field('Islandora base URL',input(draft.host,value=>draft.host=value,{type:'url',placeholder:'https://repository.example.edu',disabled:written||!!job?.baseline})),
    field('Drupal content type',input(draft.content_type,value=>draft.content_type=value,{disabled:written})),
    field('Repeated-value delimiter',input(draft.subdelimiter,value=>draft.subdelimiter=value,{disabled:written})),
    field('Workbench username',input(draft.username,value=>draft.username=value,{autoComplete:'off'})),
    field('Completed baseline',select([['','First migration to this target'],...state.items.filter(item=>item.status==='COMPLETE').map(item=>[item.id,item.label+' · '+item.target.host])],draft.baseline,value=>draft.baseline=value))));
  target.querySelector('select').disabled=!!job||state.running;
  body.append(target,details('Additional Workbench settings',field('Target settings',area(draft.advanced,value=>draft.advanced=value,{class:'code',rows:5,disabled:state.running}),
   'Add or update supported Workbench settings as JSON, such as per-field text formats or configured reference views. Saved settings remain until assigned their intended replacement values.')));
  if(job){
   if(written)body.append(p('This operated migration retains its host, content type, and delimiter. Runtime settings, including the Workbench username, can be updated.'));
   else body.append(p('A prepared first migration can be assigned to its actual installation before native target changes. Its existing source and reviewed record work stay in this workspace.'));
   body.append(btn('Save target settings',async()=>{
    const result=await call('configure',{id:jobId,host:draft.host,config:targetConfig(draft)});
    draft.host=result.target.host;draft.returnHost=result.target.host;draft.username=result.target.username||'';draft.content_type=result.target.content_type;draft.subdelimiter=result.target.subdelimiter;
    draft.advanced=JSON.stringify(Object.fromEntries(Object.entries(result.target).filter(([key])=>!['host','username','content_type','subdelimiter'].includes(key))),null,2);
    recordDrafts.clear();
   },{disabled:state.running||!supports('configure'),message:'Target settings are saved. Review the current migration before native execution.'}));
  }
  if(draft.inventory)body.append(details('Source column examples',table(draft.inventory.columns,draft.inventory.examples.map(row=>draft.inventory.columns.map(name=>row[name])))));
  body.append(el('h3',{},'Field crosswalk'),crosswalk(draft,locked));
  if(written)body.append(p('This migration has target-changing native runs. Create its next edition from the completed baseline to revise the crosswalk.'));
  else body.append(btn(job?'Save crosswalk and rebuild review':'Create complete migration',async()=>{
   const plan=readPlan(draft);let result;
   if(job)result=await call('rebuild',{id:job.id,plan});
   else result=await call('create',{buildId:selectedBuild,label:draft.label,host:draft.host,
    config:targetConfig(draft),plan,baseline:draft.baseline||null});
   jobId=result.id;job=result;selectedIdentifier='';offset=0;step='Records';recordDrafts.clear();
  },{primary:true,disabled:state.running,message:'The complete source dataset is prepared for record review.'}));
  root.append(body);
 }
 function recordDraft(row){
  const key=jobId+'\n'+row.identifier;
  if(!recordDrafts.has(key))recordDrafts.set(key,{overrides:clone(row.overrides||{}),choices:clone(row.choices||{}),assets:row.assets.map(asset=>asset.path),parents:row.parents.join('\n')});
  return recordDrafts.get(key);
 }
 async function records(root){
  const title=card('Complete record review',p('Review mapped values, retained source changes, and current target values for every identifier. Filters and pages cover the complete migration.'),
   el('div',{class:'formgrid'},
    field('Record state',select([['','All records'],...['REVIEW','READ_TARGET','CREATE','UPDATE','UNCHANGED'].map(value=>[value,label(value)])],kind,value=>{kind=value;offset=0;void perform(async()=>{},{refresh:false});})),
    field('Source identifier search',input(search,value=>search=value,{type:'search',placeholder:'Full identifier or substring',onkeydown:event=>{if(event.key==='Enter'){offset=0;void perform(async()=>{},{refresh:false});}}}))),
   btn('Search records',async()=>{offset=0;},{refresh:false}));
  root.append(title);
  let page=await api('records',{job:jobId,kind,query:search,offset,limit:100});
  if(offset&&offset>=page.total){offset=Math.max(0,Math.floor((page.total-1)/100)*100);page=await api('records',{job:jobId,kind,query:search,offset,limit:100});}
  title.append(table(['Source identifier','Title','Decision','Target node','Review'],page.items.map(row=>[
   row.identifier,(row.overrides?.title??row.desired?.title)||'Title needs review',label(row.state),row.nodeId||'Awaiting native creation',
   btn('Open record',async()=>{selectedIdentifier=row.identifier;},{refresh:false})])),
   el('div',{class:'pager'},p((page.items.length?offset+1:0)+'–'+(offset+page.items.length)+' of '+page.total+' records'),
    btn('Previous',async()=>{offset=Math.max(0,offset-100);},{disabled:offset===0,refresh:false}),
    btn('Next',async()=>{offset=page.next;},{disabled:page.next===null,refresh:false})));
  if(selectedIdentifier)await recordDetail(root,selectedIdentifier);
 }
 async function recordDetail(root,identifier){
  const row=await api('record',{job:jobId,identifier}),draft=recordDraft(row);
  const fields=Object.keys(row.desired),conflicts=new Map((row.conflicts||[]).map(conflict=>[conflict.field,conflict]));
  const required=new Set(['title',...job.crosswalk.fields.filter(rule=>rule.required).map(rule=>rule.target)]);
  const tableRows=fields.map(name=>{
   const enabled=Object.prototype.hasOwnProperty.call(draft.overrides,name);
   const control=area(enabled?draft.overrides[name]:row.desired[name],value=>{if(Object.prototype.hasOwnProperty.call(draft.overrides,name))draft.overrides[name]=value;},
    {rows:2,disabled:!enabled,required:required.has(name),maxLength:name==='title'?Number(job.crosswalk.titleLimit||255):undefined});
   const override=el('div',{},checkbox(enabled,value=>{if(value)draft.overrides[name]=control.value;else delete draft.overrides[name];control.disabled=!value;},'Use staff value'),control);
   const decision=conflicts.has(name)||draft.choices[name]?select([['','Choose a conflict decision'],['source','Apply reviewed source value'],['target','Keep current target value']],draft.choices[name]||'',value=>{if(value)draft.choices[name]=value;else delete draft.choices[name];}):p('No conflicting change');
   const errors=(row.mappingErrors||[]).filter(error=>error.field===name).map(error=>p(error.issue+(error.values?' · '+text(error.values):'')));
   return[name,el('div',{},p(text(row.desired[name])),...errors),row.before?text(row.before[name]):'First source edition',
    row.target?text(row.target[name]):row.nodeId?'Receive current target values':'New target record',override,decision];
  });
  const form=el('form',{onsubmit:event=>{event.preventDefault();void perform(async()=>{
   await call('edit',{id:jobId,identifier,overrides:draft.overrides,choices:draft.choices});
   recordDrafts.delete(jobId+'\n'+identifier);
  },{message:'The record decision is saved. The complete migration counts are updated.'});}},
   table(['Target field','Mapped source value','Previous source','Current target','Staff override','Conflict decision'],tableRows));
  if(row.sourceStatus==='deleted')form.append(field('Explicit source withdrawal',select([['','Choose withdrawal handling'],['keep','Keep the current target record'],['unpublish','Unpublish the target record']],draft.choices.$withdrawal||'',value=>{if(value)draft.choices.$withdrawal=value;else delete draft.choices.$withdrawal;})));
  form.append(el('button',{type:'submit',class:'primary',disabled:state.running},'Save complete record decision'));
  const body=card('Selected record',el('h3',{class:'islandora-identifier'},identifier),p(label(row.state)+(row.nodeId?' · Target node '+row.nodeId:'')),form,
   details('Complete original projected metadata',table(['Source column','Original value'],Object.entries(row.source||{}))),
   details('Current file and parent associations',
    table(['Original file','Media type','Role','Receiving'],(row.assets||[]).map(asset=>[asset.name,asset.mediaType,asset.role,asset.verifiedAt?'Received '+date(asset.verifiedAt):'Awaiting target inspection'])),
    p(row.parents.length?row.parents.join('\n'):'No parent associations'),
    btn('Edit files and parents',async()=>{step='Files and parents';},{refresh:false})));
  root.append(body);
 }
 function manifestPanel(kindName,draft){
  const isAsset=kindName==='assets',key=jobId+':'+kindName,selected=uploads.get(key);
  const file=el('input',{type:'file',accept:'.json,.csv,application/json,text/csv',onchange:event=>{const value=event.target.files[0];if(value)uploads.set(key,{file:value,rows:null});}});
  const body=card(isAsset?'Original files':'Parent relationships',
   p(isAsset?'The manifest ties each source identifier to its original local file. The selected asset directory belongs to the machine running this console.':'The manifest names complete source identifiers in child and parent columns. Parent links resolve through the actual returned target node IDs.'),
   field('Complete JSON or CSV manifest',file),selected?p('Selected: '+selected.file.name+' · '+selected.file.size.toLocaleString('en-US')+' bytes'):null);
  if(isAsset)body.append(field('Original asset directory',input(draft.assetRoot,value=>draft.assetRoot=value,{placeholder:'/absolute/original-files'})));
  body.append(el('div',{class:'actions'},
   btn('Preview complete manifest',async()=>{
    const item=uploads.get(key);if(!item)throw Error('Select the complete manifest file.');
    if(item.file.size>32*1024*1024)throw Error('Use the native manifest command for a file larger than 32 MiB.');
    item.rows=manifestRows(await item.file.text(),kindName);draft.manifestPage[kindName]=0;
   },{refresh:false}),
   btn(isAsset?'Attach original files':'Save parent relationships',async()=>{
    const item=uploads.get(key);if(!item)throw Error('Select the complete manifest file.');
    const bodyBase64=await file64(item.file);
    if(isAsset&&!draft.assetRoot.trim())throw Error('Enter the directory containing these original files.');
    await call(isAsset?'attach':'relationships',{id:jobId,bodyBase64,...(isAsset?{assetRoot:draft.assetRoot}:{})});
    recordDrafts.clear();
   },{primary:true,disabled:state.running||(isAsset&&!!job.runs?.length),message:isAsset?'The original files and their hashes are retained in this migration.':'The parent graph is saved against original source identifiers.'})));
  if(selected?.rows){
   const page=draft.manifestPage[kindName]||0,rows=selected.rows,headers=[...new Set(rows.flatMap(row=>Object.keys(row)))];
   body.append(table(headers,rows.slice(page,page+100).map(row=>headers.map(name=>text(row[name])))),
    el('div',{class:'pager'},p((page+1)+'–'+Math.min(page+100,rows.length)+' of '+rows.length+' manifest rows'),
     btn('Previous manifest rows',async()=>{draft.manifestPage[kindName]=Math.max(0,page-100);},{disabled:page===0,refresh:false}),
     btn('Next manifest rows',async()=>{draft.manifestPage[kindName]=page+100;},{disabled:page+100>=rows.length,refresh:false})));
  }
  body.append(details('Manifest columns',pre(isAsset?'identifier,path,sha256,mediaType,mediaUse,role,sourceURL\nUse the exact source identifier and a path relative to the asset directory. mediaType is the actual Drupal media type. role is primary or supplemental. sha256 can check the original file against an existing manifest.':'child,parent\nUse one source-identifier relationship per row. Repeated child identifiers can name multiple parents.')));
  return body;
 }
 async function associations(root){
  const draft=currentDraft();
  root.append(metrics({'Original files':job.assetCount||0,'Parent links':job.relationshipCount||0}));
  root.append(manifestPanel('assets',draft),manifestPanel('relationships',draft));
  if(!selectedIdentifier){root.append(p('Open a record in Records to correct its selected files and parents.'),btn('Open complete record review',async()=>{step='Records';},{refresh:false}));return;}
  const row=await api('record',{job:jobId,identifier:selectedIdentifier}),record=recordDraft(row);
  const selected=card('Correct selected record associations',el('h3',{class:'islandora-identifier'},row.identifier));
  selected.append(...row.assets.map(asset=>checkbox(record.assets.includes(asset.path),value=>{
   if(value)record.assets=[...new Set([...record.assets,asset.path])];else record.assets=record.assets.filter(path=>path!==asset.path);
  },asset.name+' · '+asset.mediaType+' · '+asset.role)));
  selected.append(field('Complete parent identifier list',area(record.parents,value=>record.parents=value,{rows:5}),
   'Use one complete source identifier per line. An empty list removes this record’s current parent selections.'));
  selected.append(btn('Save selected associations',async()=>{
   await call('associations',{id:jobId,identifier:row.identifier,assets:record.assets,parents:record.parents.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)});
   recordDrafts.delete(jobId+'\n'+row.identifier);
  },{primary:true,disabled:state.running||!supports('associations'),message:'Selected original files and parent relationships are saved.'}));
  root.append(selected);
 }
 async function receiving(root){
  const draft=currentDraft();draft.returnHost ||=job.target.host;
  const key=jobId+':return',selected=uploads.get(key);
  const file=el('input',{type:'file',accept:'.csv,text/csv',onchange:event=>{const value=event.target.files[0];if(value)uploads.set(key,{file:value});}});
  const body=card('Receive actual target records',
   p('Receive the unchanged native target CSV or source-to-node map. Original node IDs are checked against the saved source-to-target mapping.'),
   field('Returned target host',input(draft.returnHost,value=>draft.returnHost=value,{type:'url'})),
   field('Return contents',select([['target','Current target field values'],['map','Source identifiers and native node IDs']],draft.returnKind,value=>draft.returnKind=value)),
   field('Original native CSV',file),selected?p('Selected: '+selected.file.name):null,
   btn('Receive original target CSV',async()=>{await call('receive',{id:jobId,host:draft.returnHost,kind:draft.returnKind,bodyBase64:await file64(uploads.get(key)?.file)});recordDrafts.clear();},
    {primary:true,disabled:state.running,message:'The original target return is retained and matched to this migration.'}),
   el('div',{class:'actions'},
    btn('Receive the retained Workbench node map',async()=>{await call('import-native-map',{id:jobId});recordDrafts.clear();},{disabled:state.running,message:'The native source-to-node map has been received.'}),
    btn('Inspect current nodes, media and files',async()=>{await call('inspect-target',{id:jobId});step='Workbench';},{disabled:state.running||!supports('inspect_target'),message:'Target inspection is running in the original migration worker.'})));
  body.append(p('Target inspection receives node status, parent relationships and media, and checks the retained originals against their actual target files. It uses the target username and the password already supplied to the server environment.'));
  if(job.receiving)body.append(details('Latest retained CSV return',table(['Return','Value'],Object.entries(job.receiving).map(([key,value])=>[key,key==='at'?date(value):text(value)]))));
  root.append(body);
 }
 async function workbench(root){
  const draft=currentDraft(),running=state.running,reviewed=!!job.review;
  const body=card('Native Islandora Workbench',
   p('Prepare the current complete migration, run the installed original Workbench, and receive its actual results. Each batch keeps its original input files, process result and log.'),
   el('div',{class:'formgrid'},
    field('Installed Workbench script',input(draft.workbench,value=>draft.workbench=value,{placeholder:'/absolute/islandora_workbench/workbench'})),
    field('Workbench Python executable',input(draft.python,value=>draft.python=value,{placeholder:'Use the server Python when empty'}))),
   p('Set the target username in Migration. Start this console from an environment containing ISLANDORA_WORKBENCH_PASSWORD so the native process can authenticate.'),
   el('div',{class:'actions'},
    btn('Prepare current native batches',async()=>{await call('prepare',{id:jobId});},{primary:true,disabled:running,message:'Native batch inputs are prepared from the current saved migration.'}),
    btn('Inspect current target',async()=>{await call('inspect-target',{id:jobId});},{disabled:running||!supports('inspect_target'),message:'Target inspection has started.'}),
    btn('Stop current native work',async()=>{await call('stop');},{disabled:!running,message:'A stop request was sent to the current native worker.'})));
  if(state.workerError)body.append(el('p',{class:'note islandora-error'},state.workerError));
  if(job.nativeReceiving)body.append(card('Latest target receiving',metrics({'Received nodes':job.nativeReceiving.nodes||0,'Matched original files':job.nativeReceiving.matchedFiles||0}),p('Received '+date(job.nativeReceiving.at))));
  const batches=job.batches||[];
  body.append(table(['Native batch','Task','Rows','Inputs','Execution'],batches.map(batch=>[
   batch.name,batch.task,batch.rows,el('div',{class:'actions'},
    download('/download/islandora-input',{job:jobId,batch:batch.name,kind:'csv'},'CSV'),
    download('/download/islandora-input',{job:jobId,batch:batch.name,kind:'config'},'Configuration')),
   el('div',{class:'actions'},
    btn('Check',()=>runBatch(batch,true),{disabled:running,message:'The native Workbench check is running.'}),
    btn('Run batch',()=>runBatch(batch,false),{primary:true,disabled:running||(!reviewed&&batch.task!=='export_csv'),message:'The native Workbench batch is running.'}))
  ])));
  async function runBatch(batch,check){
   if(!draft.workbench.trim())throw Error('Select the installed original Workbench script.');
   await call('start',{id:jobId,batch:batch.name,workbench:draft.workbench,python:draft.python||null,check});
  }
  if(!batches.length)body.append(p('Prepare the native batches to see the exact create, update, target-read, file and parent tasks for this migration.'));
  if(!reviewed)body.append(p('Complete the record decisions and staff review in Handover to run target-changing batches. Target exports and native checks remain available for receiving and preparation.'));
  root.append(body);
  const runs=job.runs||[];
  const history=card('Native execution history',table(['Started','Batch','Mode','Status','Process / exit','Saved inputs','Log'],[...runs].reverse().map(run=>[
   date(run.startedAt),run.batch,run.check?'Input check':'Native task',label(run.status),
   run.exitCode===undefined?(run.pid?'Process '+run.pid:'Starting'):'Exit '+run.exitCode,
   run.inputs?el('div',{class:'actions'},
    download('/download/islandora-run-input',{job:jobId,run:run.id,kind:'csv'},'CSV'),
    download('/download/islandora-run-input',{job:jobId,run:run.id,kind:'config'},'Configuration'),
    download('/download/islandora-run-input',{job:jobId,run:run.id,kind:'preparedConfig'},'Prepared configuration')):'Earlier run',
   btn('Open log',async()=>{draft.logRun=run.id;},{refresh:false})
  ])));
  root.append(history);
  if(draft.logRun&&runs.some(run=>run.id===draft.logRun))await showLog(history,draft.logRun);
 }
 async function showLog(root,runId){
  const key=jobId+':'+runId,retained=logs.get(key)||{text:'',offset:0};
  const value=await api('log',{job:jobId,run:runId,offset:retained.offset,bytes:65536});
  if(value.reset)retained.text='';
  retained.text+=value.text;retained.offset=value.next;logs.set(key,retained);
  root.append(el('h3',{},'Retained native log'),pre(retained.text||'The native process has not written output yet.'),
   el('div',{class:'actions'},btn('Read next log bytes',async()=>{},{refresh:false,disabled:!value.running&&value.next>=value.size}),
    download('/download/islandora-log',{job:jobId,run:runId},'Download complete original log')),
   p(retained.offset.toLocaleString('en-US')+' of '+value.size.toLocaleString('en-US')+' log bytes received.'));
 }
 async function handover(root){
  const draft=currentDraft(),unresolved=(job.counts.REVIEW||0)+(job.counts.READ_TARGET||0);
  const review=card('Review the complete migration',
   p('Save the staff decision for the current mapped records, original files, parent choices and current target changes. Editing the migration returns it to review.'),
   metrics({'Records needing review':unresolved,'Original files':job.assetCount||0,'Parent links':job.relationshipCount||0}),
   field('Reviewing operator',input(draft.reviewer,value=>draft.reviewer=value)),
   field('Migration review note',area(draft.reviewNote,value=>draft.reviewNote=value,{rows:4})),
   btn('Save complete migration review',async()=>{
    await call('review',{id:jobId,operator:draft.reviewer,note:draft.reviewNote});
   },{primary:true,disabled:state.running||unresolved>0,message:'The complete migration review is saved for native execution.'}));
  if(job.review)review.append(p('Reviewed by '+job.review.reviewer+' · '+date(job.review.at)),p(job.review.note));
  const finish=card('Receive and finish the handover',
   p('Finish after the native node IDs, current field values, parent links and original files have been received for the complete migration. The finished migration can become the baseline for its next source edition.'),
   field('Receiving operator',input(draft.operator,value=>draft.operator=value)),
   field('Handover note',area(draft.handoverNote,value=>draft.handoverNote=value,{rows:4})),
   el('div',{class:'actions'},
    btn('Inspect complete target receiving',async()=>{await call('inspect-target',{id:jobId});step='Workbench';},{disabled:state.running||!supports('inspect_target'),message:'The original worker is receiving current target state.'}),
    btn('Finish received migration',async()=>{await call('finish',{id:jobId,operator:draft.operator,note:draft.handoverNote});},{primary:true,disabled:state.running,message:'The complete received migration is finished.'}),
    download('/download/islandora',{job:jobId},'Download complete migration package')));
  if(job.handover)finish.append(p('Received by '+job.handover.operator+' · '+date(job.handover.at)),p(job.handover.note));
  root.append(review,finish);
 }
 async function poll(){
  if(!active)return;
  try{
   if(!busy){
    const wasRunning=state.running,previous=job?.updatedAt;await reload();
    const status=host.querySelector('.islandora-statusline');
    if(status&&job)status.textContent=job.label+' · '+(state.running?'Native work running':label(job.status))+' · '+job.target.host;
    const editing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
    if(!editing&&((wasRunning&&!state.running)||state.running&&['Workbench','Target returns','Handover'].includes(step)&&job?.updatedAt!==previous)){
     await onState();await paint();
    }
   }
  }catch(error){saveNotice(error.message||String(error),true);}
  finally{if(active)timer=setTimeout(poll,2500);}
 }
 return {
  async render(container,options={}){
   host=container;context=options;active=true;clearTimeout(timer);
   if(!document.querySelector('link[data-islandora-style]'))document.head.append(el('link',{rel:'stylesheet',href:'/islandora.css','data-islandora-style':''}));
   await reload();await paint();timer=setTimeout(poll,2500);
  },
  leave(){active=false;epoch++;clearTimeout(timer);}
 };
}
