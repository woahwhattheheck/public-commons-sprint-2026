/* GWMA study desk, composed into the original authenticated operator. */
import {operationId, submissionIdentity} from './decision_transfer.mjs';

const SCHEMA='upstate.gwma-browser-draft/v1';
const ACTIONS=new Set(['gwma.study.save','gwma.mapping.save','gwma.intake','gwma.review.save','gwma.contract.save','gwma.plan.save','gwma.handover.build']);
const FIELDS=['result_id','sample_id','station_id','watershed','event_id','collected_at','timezone','weather','matrix','parameter','method','fraction','value','unit','qualifier','detected','mdl','rl','laboratory','batch_id','sample_type','replicate_id','qa_code','qa_note','latitude','longitude'];
const SCREENS=[['study','Study'],['intake','Sources & mapping'],['review','Review observations'],['contract','Analytical contract'],['plan','Workplan & scenarios'],['handover','Handover'],['operations','Saved operations']];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value));
const compact=value=>JSON.stringify(value);
const title=row=>row?.title||row?.label||row?.id||'';
const short=id=>String(id||'').slice(0,16);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const list=value=>String(value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const b64=bytes=>{let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value);};

export function csvHeaders(text){
  if(text.charCodeAt(0)===0xfeff)text=text.slice(1);
  const row=[];let field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else field+=c;continue;}
    if(c==='"'){if(field||closed)throw Error('The header contains an unexpected quotation mark. Retain the original file and correct its header mapping.');quoted=true;continue;}
    if(c===','){row.push(field);field='';closed=false;continue;}
    if(c==='\n'||c==='\r'){row.push(field);return finishHeaders(row);}
    if(closed&&c!==' '&&c!=='\t')throw Error('The CSV header contains content after a closing quote.');
    if(!closed)field+=c;
  }
  if(quoted)throw Error('The original CSV header has an unclosed quoted field.');
  row.push(field);return finishHeaders(row);
}
function finishHeaders(row){
  if(row.length)row[0]=row[0].replace(/^\uFEFF/,'');
  if(!row.length||row.some(x=>!x)||new Set(row).size!==row.length)throw Error('Use distinct, nonempty original CSV headers before mapping this source.');
  return row;
}

function freshDraft(workspace){
  return {schema:SCHEMA,workspace,screen:'study',selected:{study:'',mapping:'',batch:'',review:'',contract:'',plan:'',handover:''},
    forms:{
      study:{title:'',watersheds:'',laboratory:'',risk:'',study:'',notes:''},
      mapping:{title:'',profile:'mapped_csv',columns:{},constants:{}},
      intake:{title:'',source_uri:'',observation_id:'',mode:'file',file:null},
      review:{reviewer:'',decisions:{}},
      contract:{title:'',reviewer:'',model_name:'',model_version:'',input_schema:'',output_schema:'',rules:[],notes:''},
      plan:{title:'',laboratory:'',risk:'',study:'',decisions:[],tasks:[],scenarios:[]},
      handover:{title:'',batch_reviews:[],contract_id:'',plan_id:''}
    },page:{offset:0,limit:100,search:'',disposition:'all'},pending:null,receipts:[],updated_at:new Date().toISOString()};
}
function validateDraft(value,workspace){
  if(!plain(value)||value.schema!==SCHEMA||value.workspace!==workspace||!plain(value.forms)||!plain(value.selected))throw Error('This draft belongs to a different workspace or format.');
  const base=freshDraft(workspace);
  for(const name of Object.keys(base.forms))if(!plain(value.forms[name]))throw Error('The complete '+name+' draft is missing.');
  for(const [kind,id] of Object.entries(value.selected))if(typeof id!=='string')throw Error('The selected '+kind+' identity must be text.');
  if(!plain(value.forms.mapping.columns)||!plain(value.forms.mapping.constants)||!plain(value.forms.review.decisions))throw Error('The complete source mapping and reviewed decisions are required.');
  for(const [name,rows] of [['rules',value.forms.contract.rules],['decisions',value.forms.plan.decisions],['tasks',value.forms.plan.tasks],['scenarios',value.forms.plan.scenarios],['batch selections',value.forms.handover.batch_reviews]])if(!Array.isArray(rows)||rows.some(row=>!plain(row)))throw Error('The saved '+name+' must be complete records.');
  if(value.pending){
    const p=value.pending,q=p.request;
    if(!plain(q)||q.workspace!==workspace||!ACTIONS.has(q.action)||typeof q.operation_id!=='string'||!q.operation_id||!plain(q.payload)||typeof p.sha256!=='string')throw Error('The original retained operation is incomplete.');
  }
  if(!SCREENS.some(x=>x[0]===value.screen))value.screen='study';
  value.receipts=Array.isArray(value.receipts)?value.receipts:[];
  value.page={...base.page,...value.page};
  return value;
}

function createStorage(){
  let opening=null,queue=Promise.resolve();
  const memory=new Map();
  function db(){
    if(!globalThis.indexedDB)return Promise.reject(Error('Browser database is unavailable.'));
    if(!opening)opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('upstate-gwma-drafts-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||Error('Cannot open saved drafts.'));
      request.onblocked=()=>reject(Error('Another browser tab is upgrading the saved draft store.'));
    });
    return opening;
  }
  async function idb(mode,key,value){
    const connection=await db();
    return new Promise((resolve,reject)=>{
      const tx=connection.transaction('drafts',mode),store=tx.objectStore('drafts');
      const request=mode==='readonly'?store.get(key):store.put(value,key);
      let result;request.onsuccess=()=>{result=request.result;};
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||Error('Draft storage failed.'));tx.onabort=()=>reject(tx.error||Error('Draft storage was interrupted.'));
    });
  }
  return {
    async read(key){
      if(memory.has(key))return clone(memory.get(key));
      let value=null;
      try{value=await idb('readonly',key);}catch(_){}
      if(!value)try{value=JSON.parse(localStorage.getItem(key)||'null');}catch(_){}
      if(value)memory.set(key,clone(value));
      return value;
    },
    write(key,value){
      const saved=clone(value);memory.set(key,saved);
      const perform=async()=>{
        try{await idb('readwrite',key,saved);return {durable:true,method:'browser-database'};}
        catch(_){try{localStorage.setItem(key,JSON.stringify(saved));return {durable:true,method:'browser-storage'};}catch(error){return {durable:false,error:String(error?.message||error)};}}
      };
      const result=queue.then(perform,perform);queue=result.catch(()=>{});return result;
    }
  };
}

export function attachGWMAStudyWorkbench({getState,api,endpoint,toast=()=>{},showTask}){
  let root=null,frame=null,workspace=null,draft=null,catalog=null,generation=0,busy=false;
  let activePage=null,details=null,saveTimer=null,refreshing=null,taskReceiving=null,completedRefresh=null;
  let storageNotice='',lastTaskRefresh=0,seenTaskStamp='',rowRead=0,fileRead=0;
  const storage=createStorage(),key=ws=>'upstate-gwma:'+ws;
  const currentWorkspace=()=>getState()?.workspace_key;
  const current=(ws,gen=generation)=>!!root&&workspace===ws&&currentWorkspace()===ws&&generation===gen;
  const q=selector=>frame?.querySelector(selector);
  const url=(path,params={})=>endpoint(path,{workspace,...params});
  function status(message,error=false){
    const target=q('[data-gwma-status]');if(target){target.textContent=message;target.setAttribute('role',error?'alert':'status');target.classList.toggle('gwma-error',error);}
  }
  async function remember(){
    if(!draft||!workspace)return {durable:false};
    const ws=workspace;draft.updated_at=new Date().toISOString();
    const saved=await storage.write(key(ws),draft);
    if(current(ws)){storageNotice=saved.durable?'':'Browser storage is unavailable. Download the complete recovery draft before leaving this page.';const n=q('[data-gwma-storage]');if(n)n.textContent=storageNotice;}
    return saved;
  }
  function laterSave(){if(saveTimer)clearTimeout(saveTimer);saveTimer=setTimeout(()=>{saveTimer=null;remember();},180);}
  function fail(error){status(error?.message||String(error),true);}
  function setBusy(value){busy=value;for(const n of frame?.querySelectorAll('[data-gwma-mutation], [data-gwma-selection]')||[])n.disabled=value;}
  const all=kind=>catalog?.[kind]||[];
  const selectedStudy=()=>draft?.selected.study||'';
  const rowsFor=kind=>all(kind).filter(x=>!x.study_id||x.study_id===selectedStudy());
  function selectedExists(kind,id){return rowsFor(kind).some(x=>x.id===id);}
  function field(label,name,value='',opts={}){
    const help=opts.help?'<span class="gwma-help">'+escape(opts.help)+'</span>':'';
    const input=opts.multiline?'<textarea name="'+escape(name)+'" rows="'+(opts.rows||3)+'"'+(opts.required?' required':'')+'>'+escape(value)+'</textarea>':
      '<input name="'+escape(name)+'" value="'+escape(value)+'" type="'+(opts.type||'text')+'"'+(opts.required?' required':'')+(opts.readonly?' readonly':'')+'>';
    return '<label class="gwma-field"><span>'+escape(label)+'</span>'+input+help+'</label>';
  }
  function select(label,name,value,options,extra=''){
    return '<label class="gwma-field"><span>'+escape(label)+'</span><select name="'+escape(name)+'" '+extra+'>'+options.map(x=>'<option value="'+escape(x[0])+'"'+(String(x[0])===String(value)?' selected':'')+'>'+escape(x[1])+'</option>').join('')+'</select></label>';
  }
  function choose(kind,label,optional=false){
    const plural={study:'studies',mapping:'mappings',batch:'batches',review:'reviews',contract:'contracts',plan:'plans',handover:'handovers'}[kind];
    const rows=kind==='study'?all(plural):rowsFor(plural).filter(x=>kind!=='review'||x.batch_id===draft.selected.batch);
    return select(label,'selected.'+kind,draft.selected[kind],[['',optional?'None selected':'Select a saved '+kind],...rows.map(x=>[x.id,title(x)+' · '+short(x.id)])],'data-gwma-selection');
  }
  const button=(label,action,extra='')=>'<button type="button" data-gwma-action="'+action+'" '+extra+'>'+escape(label)+'</button>';
  const saveButton=(label,action)=>button(label,action,'data-gwma-mutation');
  const note=text=>'<p class="gwma-help">'+escape(text)+'</p>';
  const ids=()=>'<div class="gwma-selection">'+choose('study','Current study')+button('Open original study','open-study')+button('Load study into draft','copy-study')+button('Refresh saved editions','refresh')+'</div>';
  function section(title,body){return '<section class="gwma-section"><h3>'+escape(title)+'</h3>'+body+'</section>';}
  function table(headers,rows){
    return '<div class="gwma-table-wrap"><table><thead><tr>'+headers.map(x=>'<th scope="col">'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(cells=>'<tr>'+cells.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function studyScreen(){
    const f=draft.forms.study;
    const options=(catalog?.watersheds||catalog?.plan_template?.watersheds||[]).map(x=>typeof x==='string'?x:(x.name||x.title||x.code)).filter(Boolean);
    return section('Study and receiving owners',note('Save the study scope and named laboratory, risk and study owners. Each save creates a retained edition; prior studies and analytical inputs remain available.')+
      '<div class="gwma-grid">'+field('Study title','study.title',f.title,{required:true})+field('Watersheds — one exact name per line','study.watersheds',f.watersheds,{multiline:true,required:true})+
      field('Laboratory owner','study.laboratory',f.laboratory)+field('Risk owner','study.risk',f.risk)+field('Study owner','study.study',f.study)+'</div>'+
      (options.length?note('Published watershed names: '+options.join('; ')):'')+
      field('Scope and programme notes','study.notes',f.notes,{multiline:true})+saveButton('Save study edition','save-study'));
  }
  function mappingRows(){
    const f=draft.forms.mapping,headers=draft.forms.intake.file?.headers||[];
    const fields=Array.isArray(catalog?.fields)&&catalog.fields.length?catalog.fields.map(x=>typeof x==='string'?x:x.id||x.name||x.key):FIELDS;
    return table(['Canonical field','Original source column','Constant when not mapped'],fields.map(c=>{
      const options=[['','Not mapped'],...headers.map(h=>[h,h])];
      if(f.columns[c]&&!headers.includes(f.columns[c]))options.push([f.columns[c],f.columns[c]+' (retained mapping)']);
      return ['<code>'+escape(c)+'</code>',headers.length?select(c+' source column','mapping.columns.'+c,f.columns[c]||'',options):field(c+' source column','mapping.columns.'+c,f.columns[c]||''),field(c+' constant','mapping.constants.'+c,f.constants[c]||'')];
    }));
  }
  function intakeScreen(){
    const f=draft.forms.intake,m=draft.forms.mapping;
    const profiles=Array.isArray(catalog?.profiles)?catalog.profiles:[];
    const profileOptions=[['mapped_csv','Explicit CSV mapping'],...profiles.filter(p=>(p.id||p.profile)!=='mapped_csv').map(p=>[p.id||p.profile,p.title||p.label||p.id||p.profile])];
    return section('Original laboratory source',note('Retain the complete original file, exact result text, qualifiers and detection/reporting limits. Original result_id and internal row_id are separate identities. Repeated laboratory results remain separate occurrences.')+
      '<div class="gwma-grid">'+field('Intake title','intake.title',f.title,{required:true})+field('Original source URI or source reference','intake.source_uri',f.source_uri,{required:true})+
      select('Source selection','intake.mode',f.mode,[['file','Upload original CSV (up to 4 MiB)'],['retained','Remap a retained original observation'],['registered','Use an original registered source']])+'</div>'+
      '<label class="gwma-field"><span>Original CSV file</span><input type="file" data-gwma-file="csv" accept=".csv,text/csv">'+
      (f.file?'<span class="gwma-help">'+escape(f.file.filename)+' · '+f.file.bytes+' bytes · '+f.file.headers.length+' original columns retained</span>':'')+'</label>'+
      field('Original registered source collection ID','intake.source_collection_id',f.source_collection_id||'')+field('Original registered source ID','intake.source_id',f.source_id||'')+field('Retained source observation ID','intake.observation_id',f.observation_id,{help:'Use the complete original source already received by this workspace, including sources larger than the direct action limit.'})+
      (f.file?button('Download selected original CSV','download-csv'):'')+
      note('The browser reads only the header for mapping. Original bytes are submitted unchanged; the domain engine performs row parsing, identity, units and qualifier review.'))+
      section('Reviewed column mapping','<div class="gwma-grid">'+field('Mapping title','mapping.title',m.title,{required:true})+select('Published profile','mapping.profile',m.profile,profileOptions)+'</div>'+
      button('Apply selected profile fields','apply-profile')+note('A profile fills its published columns/constants for review. Constants and source columns are explicit; an original cell is never replaced silently.')+
      mappingRows()+saveButton('Save mapping edition','save-mapping'))+
      section('Receive the full selected batch',choose('mapping','Saved mapping for this intake')+
      '<div class="gwma-actions">'+button('Open original mapping','open-mapping')+button('Load mapping into draft','copy-mapping')+saveButton('Receive original source','intake')+'</div>');
  }

  function rowDecision(row){return draft.forms.review.decisions[row.row_id]||row.review||{row_id:row.row_id,disposition:row.disposition||'pending',reason:'',overrides:{}};}
  function reviewScreen(){
    const f=draft.forms.review,page=activePage;
    let content=choose('batch','Original batch')+choose('review','Saved review to continue',true)+
      field('Named reviewer','review.reviewer',f.reviewer,{required:true})+
      '<div class="gwma-actions">'+button('Load observation page','load-rows')+button('Open original batch','open-batch')+button('Open saved review','open-review')+'</div>'+
      note('Each laboratory occurrence has its own row identity. Review original values, qualifiers, detection limits and source lines before making a decision. An override is an explicit reviewed string; the source remains unchanged.');
    if(page){
      content+='<div class="gwma-pagebar"><span>Rows '+(page.total? page.offset+1:0)+'–'+Math.min(page.total,page.offset+page.rows.length)+' of '+page.total+'</span>'+
        button('Previous page','page-prev',page.offset<=0?'disabled':'')+button('Next page','page-next',page.next_offset===null||page.next_offset===undefined?'disabled':'')+
        select('Rows per page','page.limit',draft.page.limit,[[25,'25'],[50,'50'],[100,'100']])+'</div>';
      content+=table(['Source occurrence','Result and bounds','Review findings','Decision'],page.rows.map(row=>{
        const d=rowDecision(row),v=row.fields||{},a=row.assessment||{},issues=a.issues||[];
        return [
          '<strong>'+escape(v.sample_id||v.station_id||row.row_id)+'</strong><br><small>Row '+escape(row.source_line??row.source_record)+' · '+escape(row.row_id)+'</small><br>'+button('Full source & review','row-detail','data-row-id="'+escape(row.row_id)+'"'),
          '<strong>'+escape(v.parameter)+'</strong><br>'+escape(v.value)+' '+escape(v.unit)+'<br><small>'+escape([v.method,v.fraction,v.matrix].filter(Boolean).join(' · '))+
            '<br>Qualifier: '+escape(v.qualifier||'—')+' · Detected: '+escape(v.detected||'—')+'<br>MDL: '+escape(v.mdl||'—')+' · RL: '+escape(v.rl||'—')+
            '<br>'+escape(a.censoring||'')+(a.bound_operator?' · '+escape(a.bound_operator)+' '+escape(a.bound_value):'')+'</small>',
          issues.length?'<ul class="gwma-issues">'+issues.map(i=>'<li><strong>'+escape(i.code)+'</strong> '+escape(i.field)+': '+escape(i.message)+'</li>').join('')+'</ul>':'No recorded parsing issue',
          '<div data-review-row="'+escape(row.row_id)+'">'+select('Disposition','row.'+row.row_id+'.disposition',d.disposition,[['pending','Pending'],['accepted','Accepted'],['excluded','Excluded']])+
            field('Decision reason','row.'+row.row_id+'.reason',d.reason,{multiline:true,rows:2})+
            button('Edit explicit overrides','row-overrides','data-row-id="'+escape(row.row_id)+'"')+
            (Object.keys(d.overrides||{}).length?note(Object.keys(d.overrides).length+' reviewed field override(s)'):'')+'</div>'
        ];
      }));
    }else content+=note('Select a saved batch, then load its source observations. Complete data stays in the workspace; this screen pages through it.');
    content+=note(Object.keys(f.decisions).length+' changed row decision(s) retained in this draft. Saving carries forward the prior review and applies these explicit changes.')+saveButton('Save review edition','save-review');
    return section('Review original observations',content);
  }
  function repeatTable(kind,headers,rows,cells){
    return table([...headers,''],rows.map((row,i)=>[...cells(row,i),button('Remove','remove-'+kind,'data-index="'+i+'"')]));
  }
  function contractScreen(){
    const f=draft.forms.contract;
    const rules=repeatTable('rule',['Parameter / method / fraction / matrix','Units and factor','Censoring'],f.rules,(r,i)=>[
      field('Parameter','contract.rules.'+i+'.parameter',r.parameter)+field('Method','contract.rules.'+i+'.method',r.method)+field('Fraction','contract.rules.'+i+'.fraction',r.fraction)+field('Matrix','contract.rules.'+i+'.matrix',r.matrix),
      field('Original unit','contract.rules.'+i+'.from_unit',r.from_unit)+field('Output unit','contract.rules.'+i+'.to_unit',r.to_unit)+field('Exact decimal factor','contract.rules.'+i+'.factor',r.factor,{help:'A reviewed conversion factor; retain its exact decimal string.'}),
      note('Preserve bounds')]);
    return section('Versioned analytical contract',note('Record the named model and its explicit input/output schemas. Conversion rules match parameter, method, fraction, matrix and unit exactly. Bounds and censored observations remain explicit; this desk does not substitute zero, half a limit, or a publisher-derived result.')+
      '<div class="gwma-grid">'+field('Contract title','contract.title',f.title,{required:true})+field('Named reviewer','contract.reviewer',f.reviewer,{required:true})+
      field('Model name','contract.model_name',f.model_name,{required:true})+field('Model version','contract.model_version',f.model_version,{required:true})+'</div>'+
      field('Input schema','contract.input_schema',f.input_schema,{multiline:true,help:'Retain the explicit schema or its versioned reference.'})+
      field('Output schema','contract.output_schema',f.output_schema,{multiline:true,help:'Retain the explicit schema or its versioned reference.'})+
      rules+button('Add reviewed conversion rule','add-rule')+field('Scientific decisions and assumptions','contract.notes',f.notes,{multiline:true})+
      saveButton('Save analytical contract','save-contract')+choose('contract','Saved analytical contract',true)+button('Open complete contract','open-contract')+button('Load contract into draft','copy-contract'));
  }
  function planScreen(){
    const f=draft.forms.plan;
    const decisions=repeatTable('decision',['Decision','Responsibility and state'],f.decisions,(r,i)=>[
      field('Stable decision ID','plan.decisions.'+i+'.id',r.id)+field('Title','plan.decisions.'+i+'.title',r.title)+field('Decision note','plan.decisions.'+i+'.note',r.note,{multiline:true}),
      field('Owner','plan.decisions.'+i+'.owner',r.owner)+select('Status','plan.decisions.'+i+'.status',r.status,[['open','Open'],['resolved','Resolved'],['deferred','Deferred']])]);
    const tasks=repeatTable('task',['Task','Dependencies and duration'],f.tasks,(r,i)=>[
      field('Stable task ID','plan.tasks.'+i+'.id',r.id)+field('Title','plan.tasks.'+i+'.title',r.title)+field('Owner','plan.tasks.'+i+'.owner',r.owner),
      field('Earlier task IDs — one per line','plan.tasks.'+i+'.depends_on',Array.isArray(r.depends_on)?r.depends_on.join('\n'):r.depends_on,{multiline:true})+
      field('Duration in months','plan.tasks.'+i+'.duration_months',r.duration_months??'',{help:'Leave blank when the duration remains to be agreed; an unknown duration is retained as null.'})+field('Duration status','plan.tasks.'+i+'.duration_status',r.duration_status||'')+field('Duration basis','plan.tasks.'+i+'.duration_basis',r.duration_basis||'',{multiline:true})]);
    const scenarios=repeatTable('scenario',['Scenario and scientific basis','Cost and uncertainty'],f.scenarios,(r,i)=>[
      field('Stable scenario ID','plan.scenarios.'+i+'.id',r.id)+field('Title','plan.scenarios.'+i+'.title',r.title)+field('Control measure','plan.scenarios.'+i+'.control',r.control)+
      field('Model version','plan.scenarios.'+i+'.model_version',r.model_version)+field('Source strength','plan.scenarios.'+i+'.source_strength',r.source_strength),
      field('Cost — original decimal value','plan.scenarios.'+i+'.cost',r.cost)+field('Cost unit and basis','plan.scenarios.'+i+'.cost_unit',r.cost_unit)+
      field('Uncertainty','plan.scenarios.'+i+'.uncertainty',r.uncertainty,{multiline:true})+field('Scenario notes','plan.scenarios.'+i+'.notes',r.notes,{multiline:true})]);
    return section('Workplan, ownership and scenarios',button('Load complete source-linked workplan','load-plan-template')+field('Workplan title','plan.title',f.title,{required:true})+
      '<div class="gwma-grid">'+field('Laboratory owner','plan.laboratory',f.laboratory)+field('Risk owner','plan.risk',f.risk)+field('Study owner','plan.study',f.study)+'</div>'+
      '<h4>Reviewed programme decisions</h4>'+decisions+button('Add decision','add-decision')+
      '<h4>Work and dependencies</h4>'+tasks+button('Add task','add-task')+
      '<h4>Risk management scenarios</h4>'+note('Retain scientific source strength, model version, control, cost basis and uncertainty together. Scenario entries do not assert calculated risk or a procurement ranking.')+
      scenarios+button('Add scenario','add-scenario')+saveButton('Save workplan edition','save-plan')+
      choose('plan','Saved workplan',true)+button('Open complete workplan','open-plan')+button('Load workplan into draft','copy-plan'));
  }
  function handoverScreen(){
    const f=draft.forms.handover,batches=rowsFor('batches');
    const pairs=table(['Include original batch','Selected saved review'],batches.map(b=>{
      const pair=f.batch_reviews.find(x=>x.batch_id===b.id);
      const reviews=rowsFor('reviews').filter(x=>x.batch_id===b.id);
      return ['<label class="gwma-check"><input type="checkbox" data-handover-batch="'+escape(b.id)+'"'+(pair?' checked':'')+'><span>'+escape(title(b))+'<br><small>'+escape(b.id)+' · '+escape(b.row_count??b.counts?.rows??'')+' rows</small></span></label>',
        select('Review for '+title(b),'handover.review.'+b.id,pair?.review_id||'',[['','Original pending dispositions'],...reviews.map(r=>[r.id,title(r)||r.id])])];
    }));
    return section('Complete study handover',field('Handover title','handover.title',f.title,{required:true})+
      note('Select the complete original batches and explicit review editions. The saved handover includes original sources, reviewed observations, contract, workplan and source identities. It remains tied to those retained editions.')+
      pairs+select('Analytical contract','handover.contract_id',f.contract_id,[['','No contract selected'],...rowsFor('contracts').map(x=>[x.id,title(x)])])+
      select('Workplan and scenarios','handover.plan_id',f.plan_id,[['','No workplan selected'],...rowsFor('plans').map(x=>[x.id,title(x)])])+
      saveButton('Build complete handover','build-handover')+choose('handover','Saved handover',true)+button('Open handover manifest','open-handover')+downloadLinks([draft.pending,...draft.receipts].find(p=>p?.task?.result?.id===draft.selected.handover)?.task)+
      note('The completed original task supplies verified archive downloads. Open its task from Saved operations to receive those files.'));
  }
  function operationsScreen(){
    const p=draft.pending;
    let body=note('Saved operations retain their exact workspace, original payload and operation UUID. An interrupted response continues that same operation. A completed task remains retained while its refreshed catalogue is received.');
    if(p)body+='<dl class="gwma-facts"><dt>Action</dt><dd>'+escape(p.request.action)+'</dd><dt>Original operation</dt><dd>'+escape(p.request.operation_id)+'</dd><dt>Saved native task</dt><dd>'+escape(p.task_id||'Awaiting returned task')+'</dd><dt>State</dt><dd>'+escape(p.state)+'</dd></dl>'+downloadLinks(p.task)+
      '<div class="gwma-actions">'+button('Receive saved outcome','receive-operation')+(p.state==='not_found'?button('Retry original request','retry-operation'):'')+button('Open native task','show-pending')+button('Download original request','download-request')+
      (['failed','cancelled','interrupted','complete'].includes(p.state)?button('Acknowledge retained outcome','acknowledge-operation'):'')+'</div>';
    else body+=note('No unresolved operation is retained.');
    body+=table(['Original action','State','Operation',''],[...draft.receipts].reverse().map((r,i)=>[escape(r.request.action),escape(r.state),escape(r.request.operation_id),
      button('Open original task','show-receipt','data-index="'+(draft.receipts.length-1-i)+'"')+' '+button('Download saved receipt','download-receipt','data-index="'+(draft.receipts.length-1-i)+'"')]));
    body+='<div class="gwma-actions">'+button('Download complete recovery draft','download-draft')+'</div><label class="gwma-field"><span>Reopen saved recovery draft</span><input type="file" data-gwma-file="draft" accept=".json,application/json"></label>'+
      note('A recovery draft includes selected original source bytes and the exact pending request. Treat it with the same access controls as the source data.');
    return section('Original task receiving and recovery',body);
  }
  function render(){
    if(!frame||!draft)return;
    const screens={study:studyScreen,intake:intakeScreen,review:reviewScreen,contract:contractScreen,plan:planScreen,handover:handoverScreen,operations:operationsScreen};
    frame.innerHTML='<header class="gwma-header"><div><h2>Pathogen study workspace</h2><p>Original source, reviewed observations and complete study handover</p></div>'+button('Save recovery draft','download-draft')+'</header>'+
      '<p class="gwma-storage" data-gwma-storage role="status">'+escape(storageNotice)+'</p><div data-gwma-status role="status"></div>'+ids()+
      '<nav class="gwma-tabs" aria-label="Study workflow">'+SCREENS.map(([id,label])=>'<button type="button" data-gwma-screen="'+id+'" aria-current="'+(id===draft.screen?'page':'false')+'">'+label+'</button>').join('')+'</nav>'+
      '<div class="gwma-screen">'+screens[draft.screen]()+'</div><dialog class="gwma-dialog" data-gwma-dialog><div data-gwma-detail></div></dialog>';
    setBusy(busy);
  }
  function download(name,value,type='application/json'){
    const bytes=typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n';
    const address=URL.createObjectURL(new Blob([bytes],{type}));
    const link=document.createElement('a');link.href=address;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(address),30000);
  }
  function showDetail(label,value,editRow=null){
    const dialog=q('[data-gwma-dialog]'),target=q('[data-gwma-detail]');if(!dialog||!target)return;
    details={label,value:clone(value),editRow};
    let body='<header><h3>'+escape(label)+'</h3>'+button('Close','close-detail')+'</header>';
    if(editRow){
      const decision=rowDecision(editRow);
      body+=note('Each nonempty override replaces one normalized field only in this saved review. The complete original source remains unchanged. To retain an explicit empty string, check “Apply” and leave its value blank.')+
        table(['Apply','Canonical field','Reviewed replacement'],FIELDS.map(f=>[
          '<input type="checkbox" aria-label="Apply '+escape(f)+' override" data-override-enabled="'+f+'"'+(own(decision.overrides||{},f)?' checked':'')+'>',
          escape(f),'<input aria-label="Reviewed '+escape(f)+'" data-override-value="'+f+'" value="'+escape(decision.overrides?.[f]??editRow.fields?.[f]??'')+'">']))+
        button('Retain these overrides','save-overrides','data-row-id="'+escape(editRow.row_id)+'"');
    }else body+='<pre tabindex="0">'+escape(JSON.stringify(value,null,2))+'</pre>'+button('Download complete JSON','download-detail');
    target.innerHTML=body;dialog.showModal();
  }
  async function item(kind,id){
    if(!id)throw Error('Select a saved '+kind+' first.');
    return api(url('/api/gwma/item',{kind,id}));
  }
  async function showItem(kind){
    const ws=workspace,gen=generation,id=draft.selected[kind],result=await item(kind,id);
    if(current(ws,gen)&&draft.selected[kind]===id)showDetail('Saved '+kind+' · '+id,result);
  }
  async function loadRows(){
    const ws=workspace,gen=generation,read=++rowRead,batch=draft.selected.batch,review=draft.selected.review||'',offset=draft.page.offset,limit=Number(draft.page.limit)||100;
    if(!batch)throw Error('Select a saved original batch.');
    const result=await api(url('/api/gwma/rows',{batch_id:batch,...(review?{review_id:review}:{}),offset,limit}));
    if(!current(ws,gen)||batch!==draft.selected.batch||review!==(draft.selected.review||'')||offset!==draft.page.offset||limit!==Number(draft.page.limit)||read!==rowRead)return;
    if(!Array.isArray(result.rows)||!Number.isInteger(result.total))throw Error('The original row service did not return a complete page.');
    activePage=result;render();
  }
  async function refreshCatalog({draw=true}={}){
    const ws=workspace,gen=generation;
    const result=await api(url('/api/gwma/catalog'));
    if(!current(ws,gen))return false;
    for(const k of ['studies','mappings','batches','reviews','contracts','plans','handovers'])if(!Array.isArray(result[k]))throw Error('The saved '+k+' catalogue is incomplete.');
    catalog=result;
    if(draw)render();
    return true;
  }

  function required(value,label){if(typeof value!=='string'||!value.trim())throw Error(label+' is required.');return value;}
  function requireStudy(){return required(selectedStudy(),'Saved study');}
  function validateSelection(kind,id){
    required(id,'Saved '+kind);
    const plural={mapping:'mappings',batch:'batches',review:'reviews',contract:'contracts',plan:'plans',handover:'handovers'}[kind];
    if(!selectedExists(plural,id))throw Error('Choose a '+kind+' from the selected original study.');
    return id;
  }
  function payloadFor(action){
    const f=draft.forms,s=selectedStudy();
    if(action==='gwma.study.save')return {title:required(f.study.title,'Study title'),watersheds:list(f.study.watersheds),owners:{laboratory:f.study.laboratory,risk:f.study.risk,study:f.study.study},notes:f.study.notes};
    if(action==='gwma.mapping.save'){
      requireStudy();required(f.mapping.title,'Mapping title');
      // Explicit blanks can remove a published profile mapping. Do not drop them.
      return {study_id:s,title:f.mapping.title,profile:f.mapping.profile,columns:clone(f.mapping.columns),constants:clone(f.mapping.constants)};
    }
    if(action==='gwma.intake'){
      const value={mapping_id:validateSelection('mapping',draft.selected.mapping),title:required(f.intake.title,'Intake title'),source_uri:required(f.intake.source_uri,'Original source reference')};
      if(f.intake.mode==='retained')value.observation_id=required(f.intake.observation_id,'Original observation ID');
      else if(f.intake.mode==='registered'){value.source_collection_id=required(f.intake.source_collection_id,'Original source collection');value.source_id=required(f.intake.source_id,'Registered source ID');}
      else{if(!f.intake.file?.base64)throw Error('Select the complete original CSV.');value.csv_base64=f.intake.file.base64;value.filename=f.intake.file.filename;}
      return value;
    }
    if(action==='gwma.review.save'){
      const batch=validateSelection('batch',draft.selected.batch),reviewer=required(f.review.reviewer,'Named reviewer');
      const decisions=Object.values(f.review.decisions).map(d=>({row_id:d.row_id,disposition:d.disposition,reason:d.reason||'',overrides:clone(d.overrides||{})}));
      for(const d of decisions){if(!['accepted','excluded','pending'].includes(d.disposition))throw Error('Choose an explicit row disposition.');if(d.disposition!=='pending')required(d.reason,'Decision reason for '+d.row_id);}
      const out={batch_id:batch,reviewer,decisions};
      if(draft.selected.review){validateSelection('review',draft.selected.review);const r=rowsFor('reviews').find(x=>x.id===draft.selected.review);if(r.batch_id!==batch)throw Error('Choose the review for this original batch.');out.previous_review_id=r.id;}
      return out;
    }
    if(action==='gwma.contract.save'){
      requireStudy();const c=f.contract;
      const model={name:required(c.model_name,'Model name'),version:required(c.model_version,'Model version'),input_schema:required(c.input_schema,'Model input schema'),output_schema:required(c.output_schema,'Model output schema')};
      if(!c.rules.length)throw Error('Add the explicit measurement and unit contract.');
      return {study_id:s,title:required(c.title,'Contract title'),reviewer:required(c.reviewer,'Technical reviewer'),model,rules:c.rules.map(r=>({...clone(r),censoring:'preserve_bounds'})),notes:c.notes};
    }
    if(action==='gwma.plan.save'){
      requireStudy();const p=f.plan;
      return {study_id:s,title:required(p.title,'Workplan title'),owners:{...clone(p.extra_owners||{}),laboratory:p.laboratory,risk:p.risk,study:p.study},
        sources:clone(p.sources||[]),template_schema:p.template_schema||'',template_context:clone(p.template_context||{}),decisions:clone(p.decisions),tasks:p.tasks.map(t=>({...clone(t),depends_on:Array.isArray(t.depends_on)?t.depends_on:list(t.depends_on),duration_months:t.duration_months===null||String(t.duration_months??'').trim()===''?null:t.duration_months})),scenarios:clone(p.scenarios)};
    }
    if(action==='gwma.handover.build'){
      requireStudy();const h=f.handover;if(!h.batch_reviews.length)throw Error('Select at least one complete original batch.');
      for(const pair of h.batch_reviews){validateSelection('batch',pair.batch_id);if(pair.review_id){validateSelection('review',pair.review_id);const r=rowsFor('reviews').find(x=>x.id===pair.review_id);if(r.batch_id!==pair.batch_id)throw Error('Every review must belong to its selected batch.');}}
      const out={study_id:s,title:required(h.title,'Handover title'),batch_reviews:clone(h.batch_reviews)};
      if(h.contract_id)out.contract_id=validateSelection('contract',h.contract_id);
      if(h.plan_id)out.plan_id=validateSelection('plan',h.plan_id);
      return out;
    }
    throw Error('Choose an existing study action.');
  }
  function reviewKey(){return (draft.selected.batch||'')+'|'+(draft.selected.review||'');}
  function retainReviewDraft(){
    if(!draft.selected.batch)return;
    draft.review_drafts=draft.review_drafts||{};
    draft.review_drafts[reviewKey()]=clone(draft.forms.review);
  }
  function restoreReviewDraft(){
    const saved=draft.review_drafts?.[reviewKey()];
    draft.forms.review=saved?clone(saved):{reviewer:draft.forms.review.reviewer||'',decisions:{}};
    activePage=null;draft.page.offset=0;
  }
  function switchStudy(id){
    if(id===draft.selected.study)return;
    retainReviewDraft();
    draft.study_drafts=draft.study_drafts||{};
    const old=draft.selected.study||'';
    draft.study_drafts[old]={forms:clone(draft.forms),selected:clone(draft.selected),page:clone(draft.page),review_drafts:clone(draft.review_drafts||{})};
    const prior=draft.study_drafts[id];
    if(prior){draft.forms=clone(prior.forms);draft.selected=clone(prior.selected);draft.page=clone(prior.page);draft.review_drafts=clone(prior.review_drafts||{});}
    else{const base=freshDraft(workspace);draft.forms=base.forms;draft.selected=base.selected;draft.page=base.page;draft.review_drafts={};}
    draft.selected.study=id;activePage=null;
  }
  function setPath(object,parts,value){
    if(parts.some(x=>['__proto__','prototype','constructor'].includes(x)))throw Error('Unsupported field path.');
    let target=object;for(const p of parts.slice(0,-1)){if(!plain(target[p])&&!Array.isArray(target[p]))target[p]={};target=target[p];}
    target[parts.at(-1)]=value;
  }
  function inputChanged(event){
    const n=event.target;if(!draft||!n?.name)return;
    const name=n.name;
    if(name.startsWith('selected.')){
      if(event.type!=='change')return;
      if(busy){n.value=draft.selected[name.slice(9)]||'';return;}
      const kind=name.slice(9);
      if(kind==='study')switchStudy(n.value);
      else{
        if(kind==='batch'||kind==='review')retainReviewDraft();
        draft.selected[kind]=n.value;
        if(kind==='batch')draft.selected.review='';
        if(kind==='batch'||kind==='review')restoreReviewDraft();
      }
      laterSave();render();return;
    }
    if(name.startsWith('row.')){
      const parts=name.split('.'),id=parts[1],fieldName=parts[2],row=activePage?.rows.find(x=>x.row_id===id);if(!row)return;
      const d=clone(rowDecision(row));d.row_id=id;d[fieldName]=n.value;draft.forms.review.decisions[id]=d;
    }else if(name.startsWith('handover.review.')){
      const id=name.slice('handover.review.'.length),entry=draft.forms.handover.batch_reviews.find(x=>x.batch_id===id);
      if(entry){if(n.value)entry.review_id=n.value;else delete entry.review_id;}
    }else if(name==='page.limit'){
      draft.page.limit=Number(n.value);draft.page.offset=0;
      if(event.type==='change')loadRows().catch(fail);
    }else setPath(draft.forms,name.split('.'),n.value);
    laterSave();
  }
  async function copyItem(kind){
    const ws=workspace,gen=generation,id=draft.selected[kind],value=await item(kind,id);
    if(!current(ws,gen)||id!==draft.selected[kind])return;
    if(kind==='study')draft.forms.study={title:value.title,watersheds:value.watersheds.join('\n'),laboratory:value.owners?.laboratory||'',risk:value.owners?.risk||'',study:value.owners?.study||'',notes:value.notes||''};
    if(kind==='mapping')draft.forms.mapping={title:value.title,profile:value.profile,columns:clone(value.columns),constants:clone(value.constants)};
    if(kind==='contract')draft.forms.contract={title:value.title,reviewer:value.reviewer,model_name:value.model.name,model_version:value.model.version,input_schema:value.model.input_schema,output_schema:value.model.output_schema,rules:clone(value.rules),notes:value.notes||''};
    if(kind==='plan')loadPlan(value);
    await remember();render();status('Complete saved '+kind+' loaded into the editable draft.');
  }
  function loadPlan(value){
    draft.forms.plan={title:value.title||'',laboratory:value.owners?.laboratory||'',risk:value.owners?.risk||'',study:value.owners?.study||'',
      extra_owners:clone(value.owners||{}),decisions:clone(value.decisions||[]),tasks:clone(value.tasks||[]),scenarios:clone(value.scenarios||[]),
      sources:clone(value.sources||[]),template_schema:value.template_schema||value.schema||'',template_context:clone(value.template_context||Object.fromEntries(['watersheds','phase','phases','scope','authorization'].filter(k=>own(value,k)).map(k=>[k,value[k]])))};
  }
  async function verifyPending(p){
    if(!p||p.request.workspace!==workspace||!ACTIONS.has(p.request.action)||await submissionIdentity(p.request.action,p.request.payload)!==p.sha256)throw Error('The retained original request does not match its saved content identity.');
    return p;
  }
  async function acceptTask(p,task){
    if(!plain(task)||!task.id||!task.operation_id||task.workspace!==p.request.workspace||task.action!==p.request.action)throw Error('The returned task does not match this original workspace operation.');
    // Compare complete payload even when the queue returns the same UUID.
    if(!plain(task.payload)||await submissionIdentity(task.action,task.payload)!==p.sha256)throw Error('The returned task has different original study operands.');
    p.task_id=task.id;p.native_operation_id=task.operation_id;p.state=task.state;p.task=clone(task);p.received_at=new Date().toISOString();
    if(draft.pending===p)await remember();
    return task;
  }
  async function submit(action){
    if(busy)return;
    if(draft.pending){draft.screen='operations';render();throw Error('Receive or acknowledge the retained operation before starting another study action.');}
    const ws=workspace,gen=generation,payload=payloadFor(action);
    const formName={'gwma.study.save':'study','gwma.mapping.save':'mapping','gwma.intake':'intake','gwma.review.save':'review','gwma.contract.save':'contract','gwma.plan.save':'plan','gwma.handover.build':'handover'}[action];
    const frozenContext={selected:clone(draft.selected),form_name:formName,form:clone(draft.forms[formName])};
    setBusy(true);
    try{
      const sha=await submissionIdentity(action,payload);if(!current(ws,gen))return;
      const p={request:{workspace:ws,action,payload:clone(payload),operation_id:operationId()},sha256:sha,state:'prepared',created_at:new Date().toISOString(),context:frozenContext};
      draft.pending=p;await remember();
      if(!current(ws,gen))return;
      p.state='submitting';await remember();
      status('Submitting the original saved study operation…');
      try{
        const task=await api('/api/actions',{method:'POST',body:clone(p.request)});
        if(!current(ws,gen))return;
        await acceptTask(p,task);await finishOrShow(p);
      }catch(error){
        if(current(ws,gen)){if(!p.task_id)p.state='uncertain';p.last_error=error?.message||String(error);await remember();draft.screen='operations';render();status('The original request is retained. Receive its saved outcome: '+p.last_error,true);}
      }
    }finally{if(current(ws,gen))setBusy(false);}
  }
  async function finishOrShow(p){
    if(draft.pending!==p)return;
    if(p.state==='complete'){
      status('The task completed. Receiving its saved catalogue and original item…');
      // Commit completion effects only after both reads succeeded.
      const ws=workspace,gen=generation;
      const result=p.task?.result;
      const kind={'gwma.study.save':'study','gwma.mapping.save':'mapping','gwma.intake':'batch','gwma.review.save':'review','gwma.contract.save':'contract','gwma.plan.save':'plan','gwma.handover.build':'handover'}[p.request.action];
      if(!result?.id)throw Error('The completed task is missing its original result identity.');
      const nextCatalog=await api(url('/api/gwma/catalog'));
      const plural={study:'studies',mapping:'mappings',batch:'batches',review:'reviews',contract:'contracts',plan:'plans',handover:'handovers'}[kind];
      const record=kind==='study'?await api(url('/api/gwma/item',{kind,id:result.id})):nextCatalog[plural]?.find(row=>row.id===result.id);
      if(!current(ws,gen)||draft.pending!==p)return;
      for(const k of ['studies','mappings','batches','reviews','contracts','plans','handovers'])if(!Array.isArray(nextCatalog[k]))throw Error('The completed catalogue read is incomplete.');
      if(record?.id!==result.id)throw Error('The completed source record has a different identity.');
      catalog=nextCatalog;
      if(!p.completion_applied){
        const context=p.context,original=context?.selected;
        const sameStudy=original&&selectedStudy()===original.study;
        const sameForm=context&&compact(draft.forms[context.form_name])===compact(context.form);
        // A queued action may finish while the operator works on another draft.
        // Adopt its selection only when the original receiving context still fits.
        if(kind==='study'&&sameStudy&&sameForm){
          switchStudy(record.id);
          draft.forms.study={title:record.title,watersheds:record.watersheds.join('\n'),laboratory:record.owners?.laboratory||'',risk:record.owners?.risk||'',study:record.owners?.study||'',notes:record.notes||''};
        }else if(sameStudy&&record.study_id===selectedStudy()){
          if(kind==='review'){
            if(draft.selected.batch===p.request.payload.batch_id&&draft.selected.review===(p.request.payload.previous_review_id||'')&&sameForm){
              retainReviewDraft();draft.selected.review=record.id;
              draft.forms.review={reviewer:context.form.reviewer,decisions:{}};retainReviewDraft();activePage=null;
            }
          }else if(draft.selected[kind]===original[kind]){
            if(kind==='batch')retainReviewDraft();
            draft.selected[kind]=record.id;
            if(kind==='batch'){draft.selected.review='';restoreReviewDraft();}
          }
        }
        p.completion_applied=true;
      }
      p.result_id=record.id;p.result_kind=kind;
      const saved=await retainReceipt(p);
      if(!current(ws,gen))return;
      render();
      status(saved?'Saved '+kind+' '+short(record.id)+'. The complete original receipt is retained; continue the study workflow.':
        'The operation completed, but browser receipt storage is unavailable. Its original request remains pending; download the recovery draft and receive again.',!saved);
      if(saved)toast('GWMA '+kind+' saved');
    }else{render();status('Original task '+(p.task_id||'')+' is '+p.state+'.');}
  }
  async function retainReceipt(p){
    const ws=workspace,gen=generation;
    while(current(ws,gen)&&draft.pending===p){
      const before=compact(draft),candidate=clone(draft);
      candidate.receipts.push(clone(p));candidate.pending=null;candidate.updated_at=new Date().toISOString();
      const saved=await storage.write(key(ws),candidate);
      if(!saved.durable){
        // Preserve the unresolved receiving identity in both memory and fallback.
        const retained=current(ws,gen)?draft:JSON.parse(before);
        await storage.write(key(ws),retained);
        if(current(ws,gen))storageNotice='Browser storage is unavailable. Download the complete recovery draft before leaving this page.';
        return false;
      }
      if(!current(ws,gen)||draft.pending!==p)return true;
      // Inputs may change while storage commits. Save that newer complete draft
      // before clearing its pending identity; no later edit is replaced.
      if(compact(draft)!==before)continue;
      draft.receipts=candidate.receipts;draft.pending=null;draft.updated_at=candidate.updated_at;
      return true;
    }
    return false;
  }
  async function receiveOperation({replay=false}={}){
    if(!draft.pending)return;
    const p=draft.pending,ws=workspace,gen=generation;
    if(taskReceiving?.workspace===ws&&taskReceiving.generation===gen&&taskReceiving.pending===p)return taskReceiving.promise;
    const flight={workspace:ws,generation:gen,pending:p,promise:null};taskReceiving=flight;
    flight.promise=(async()=>{
      await verifyPending(p);
      let task=null;
      if(p.task_id)task=await api(url('/api/task',{id:p.task_id}));
      else{
        const state=await api(url('/api/state'));
        task=(state.tasks||[]).find(t=>t.operation_id===p.request.operation_id);
        if(!task&&replay){
          if(!current(ws,gen))return;
          // The original queue binds the complete request and resolves replay.
          task=await api('/api/actions',{method:'POST',body:clone(p.request)});
        }
      }
      if(!current(ws,gen)||draft.pending!==p)return;
      if(!task){p.state='not_found';await remember();render();status('No task was returned for this original operation. Choose Retry original request to resubmit the unchanged saved body.');return;}
      await acceptTask(p,task);await finishOrShow(p);
    })();
    try{return await flight.promise;}finally{if(taskReceiving===flight)taskReceiving=null;}
  }
  async function acknowledge(){
    const p=draft.pending;if(!p)return;
    await receiveOperation();if(draft.pending!==p)return;
    if(!['complete','failed','cancelled','interrupted'].includes(p.state))throw Error('Receive the original task outcome before acknowledging it.');
    if(p.state==='complete'&&!p.completion_applied){await finishOrShow(p);if(!p.completion_applied)return;}
    // Keep the whole exact original request and returned task, including downloads.
    const saved=await retainReceipt(p);render();status(saved?'Original outcome retained in Saved operations.':'Original outcome remains pending until receipt storage succeeds. Download the recovery draft.',!saved);
  }
  function downloadLinks(task){
    const rows=(task?._downloads||[]).filter(d=>d.workspace===workspace&&typeof d.url==='string'&&/^\/api\/file\/[A-Za-z0-9_-]+$/.test(d.url));
    return rows.length?'<ul class="gwma-downloads">'+rows.map(d=>'<li><a href="'+escape(d.url)+'" download>'+escape(d.label||d.filename)+'</a> <small>'+escape(d.filename)+' · '+escape(d.bytes)+' bytes · SHA-256 '+escape(d.sha256)+'</small></li>').join('')+'</ul>':'';
  }
  function showNativeTask(p){
    if(!p?.task_id)throw Error('The original native task has not returned yet.');
    if(typeof showTask==='function'){const ws=workspace,gen=generation;return showTask(p.task_id,true,()=>current(ws,gen));}
    else showDetail('Original task '+p.task_id,p.task||p);
  }
  async function selectFile(input){
    const file=input.files?.[0];if(!file)return;
    const ws=workspace,gen=generation,read=++fileRead,study=selectedStudy(),intakeForm=draft.forms.intake,originalDraft=draft,originalContent=compact(draft);
    if(input.dataset.gwmaFile==='csv'){
      if(file.size>4*1024*1024)throw Error('This original file exceeds 4 MiB. Receive it through the original source workflow, then use its observation or registered source ID.');
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(!current(ws,gen)||read!==fileRead||study!==selectedStudy()||intakeForm!==draft.forms.intake)return;
      const headers=csvHeaders(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      draft.forms.intake.file={filename:file.name,bytes:bytes.length,base64:b64(bytes),headers};
      if(!draft.forms.intake.title)draft.forms.intake.title=file.name;
      await remember();render();status('Complete original bytes and '+headers.length+' source headers retained.');
    }else{
      const originalText=await file.text();
      if(!current(ws,gen)||read!==fileRead)return;
      const value=validateDraft(JSON.parse(originalText),ws);
      if(value.pending&&await submissionIdentity(value.pending.request.action,value.pending.request.payload)!==value.pending.sha256)throw Error('The imported operation body does not match its original content identity.');
      if(!current(ws,gen)||read!==fileRead)return;
      if(draft!==originalDraft||compact(draft)!==originalContent)throw Error('The current draft changed while this recovery file was read. Review those edits, then select the file again.');
      if(draft.pending&&compact(draft.pending.request)!==compact(value.pending?.request))throw Error('Receive the current original operation before importing a different recovery draft.');
      draft=value;activePage=null;await remember();render();status('Complete original draft reopened. Receive any saved pending outcome before continuing.');
    }
  }

  async function handleAction(event){
    const buttonNode=event.target.closest('[data-gwma-action],[data-gwma-screen]');if(!buttonNode||!frame?.contains(buttonNode))return;
    event.preventDefault();
    if(buttonNode.dataset.gwmaScreen){draft.screen=buttonNode.dataset.gwmaScreen;await remember();render();return;}
    const action=buttonNode.dataset.gwmaAction;
    if(busy&&!['download-draft','download-request','close-detail','download-detail','show-pending'].includes(action))return;
    const mutations={'save-study':'gwma.study.save','save-mapping':'gwma.mapping.save',intake:'gwma.intake','save-review':'gwma.review.save','save-contract':'gwma.contract.save','save-plan':'gwma.plan.save','build-handover':'gwma.handover.build'};
    if(mutations[action])return submit(mutations[action]);
    if(action==='refresh')return refreshCatalog();
    if(action.startsWith('open-'))return showItem(action.slice(5));
    if(action.startsWith('copy-'))return copyItem(action.slice(5));
    if(action==='load-rows')return loadRows();
    if(action==='page-prev'){draft.page.offset=Math.max(0,draft.page.offset-Number(draft.page.limit));await remember();return loadRows();}
    if(action==='page-next'){if(activePage?.next_offset!=null){draft.page.offset=activePage.next_offset;await remember();return loadRows();}return;}
    if(action==='row-detail'||action==='row-overrides'){
      const row=activePage?.rows.find(x=>x.row_id===buttonNode.dataset.rowId);if(!row)return;
      return showDetail('Original observation '+row.row_id,{...row,draft_review:rowDecision(row)},action==='row-overrides'?row:null);
    }
    if(action==='save-overrides'){
      const row=activePage?.rows.find(x=>x.row_id===buttonNode.dataset.rowId);if(!row)return;
      const d=clone(rowDecision(row));d.row_id=row.row_id;d.overrides={};
      for(const f of FIELDS)if(q('[data-override-enabled="'+f+'"]')?.checked)d.overrides[f]=q('[data-override-value="'+f+'"]').value;
      draft.forms.review.decisions[row.row_id]=d;await remember();q('[data-gwma-dialog]').close();details=null;render();return;
    }
    if(action==='close-detail'){q('[data-gwma-dialog]')?.close();const n=q('[data-gwma-detail]');if(n)n.textContent='';details=null;return;}
    if(action==='download-detail'&&details)return download('GWMA_'+details.label.replace(/[^a-zA-Z0-9_-]+/g,'_')+'.json',details.value);
    if(action==='apply-profile'){
      const p=(catalog?.profiles||[]).find(x=>x.id===draft.forms.mapping.profile);if(!p)throw Error('Select an installed original source profile.');
      draft.forms.mapping.columns=clone(p.columns||{});draft.forms.mapping.constants=clone(p.constants||{});
      await remember();render();status(p.mapping_note||'Published field map loaded for explicit review.');return;
    }
    if(action==='load-plan-template'){
      if(!plain(catalog?.plan_template))throw Error('The installed study workplan template is not available.');
      loadPlan(catalog.plan_template);await remember();render();status('The complete source-linked workplan is loaded as an editable draft.');return;
    }
    if(action==='add-rule')draft.forms.contract.rules.push({parameter:'',method:'',fraction:'',matrix:'',from_unit:'',to_unit:'',factor:'1',censoring:'preserve_bounds'});
    else if(action==='add-decision')draft.forms.plan.decisions.push({id:'decision-'+operationId().slice(0,8),title:'',status:'open',owner:'',note:''});
    else if(action==='add-task')draft.forms.plan.tasks.push({id:'task-'+operationId().slice(0,8),title:'',depends_on:[],owner:'',duration_months:null,duration_status:'to_be_agreed',duration_basis:''});
    else if(action==='add-scenario')draft.forms.plan.scenarios.push({id:'scenario-'+operationId().slice(0,8),title:'',control:'',model_version:'',source_strength:'',cost:'',cost_unit:'',uncertainty:'',notes:''});
    else if(action.startsWith('remove-')){
      const collections={rule:draft.forms.contract.rules,decision:draft.forms.plan.decisions,task:draft.forms.plan.tasks,scenario:draft.forms.plan.scenarios};
      const collection=collections[action.slice(7)],i=Number(buttonNode.dataset.index);
      if(collection&&Number.isInteger(i)&&i>=0&&i<collection.length)collection.splice(i,1);
    }else if(action==='receive-operation')return receiveOperation();
    else if(action==='retry-operation')return receiveOperation({replay:true});
    else if(action==='acknowledge-operation')return acknowledge();
    else if(action==='show-pending')return showNativeTask(draft.pending);
    else if(action==='show-receipt')return showNativeTask(draft.receipts[Number(buttonNode.dataset.index)]);
    else if(action==='download-request'&&draft.pending)return download('GWMA_Original_Request_'+draft.pending.request.operation_id+'.json',draft.pending);
    else if(action==='download-receipt'){const p=draft.receipts[Number(buttonNode.dataset.index)];if(p)return download('GWMA_Operation_'+p.request.operation_id+'.json',p);return;}
    else if(action==='download-draft'){await remember();return download('GWMA_Recovery_'+workspace+'.json',draft);}
    else if(action==='download-csv'){
      const f=draft.forms.intake.file;if(f)return download(f.filename,Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0)),'text/csv');return;
    }else return;
    await remember();render();
  }
  function handleChange(event){
    if(event.target.matches('[data-gwma-file]')){selectFile(event.target).catch(fail);return;}
    if(event.target.matches('[data-handover-batch]')){
      const id=event.target.dataset.handoverBatch,rows=draft.forms.handover.batch_reviews,index=rows.findIndex(x=>x.batch_id===id);
      if(event.target.checked&&index<0)rows.push({batch_id:id});
      if(!event.target.checked&&index>=0)rows.splice(index,1);
      laterSave();return;
    }
    inputChanged(event);
  }
  function onClick(event){handleAction(event).catch(fail);}
  function onInput(event){try{inputChanged(event);}catch(error){fail(error);}}
  function onChange(event){try{handleChange(event);}catch(error){fail(error);}}
  function onDialogClose(event){
    if(event.target.matches?.('[data-gwma-dialog]')){const n=q('[data-gwma-detail]');if(n)n.textContent='';details=null;}
  }
  function onPageHide(){if(draft&&workspace){retainReviewDraft();storage.write(key(workspace),draft);}}
  async function initialize(ws,gen){
    try{
      const saved=await storage.read(key(ws));if(!current(ws,gen))return;
      draft=saved?validateDraft(saved,ws):freshDraft(ws);
      if(draft.pending)await verifyPending(draft.pending);
      if(!current(ws,gen))return;
      render();await refreshCatalog();
      if(draft.pending){status('An original study operation is retained. Receive its saved outcome in Saved operations.');receiveOperation().catch(fail);}
    }catch(error){if(current(ws,gen)){if(!draft)draft=freshDraft(ws);render();fail(error);}}
  }
  function mount(container){
    if(root===container&&workspace===currentWorkspace()){update();return;}
    detach();root=container;workspace=currentWorkspace();generation++;
    frame=document.createElement('div');frame.className='gwma-study';root.append(frame);
    frame.addEventListener('click',onClick);frame.addEventListener('input',onInput);frame.addEventListener('change',onChange);frame.addEventListener('close',onDialogClose,true);
    globalThis.addEventListener?.('pagehide',onPageHide);
    if(!workspace){frame.textContent='Select an existing scientific workspace to open the study desk.';return;}
    frame.textContent='Receiving saved study catalogue and original draft…';initialize(workspace,generation);
  }
  function update(){
    if(!root)return;
    if(currentWorkspace()!==workspace){const container=root;mount(container);return;}
    const p=draft?.pending;if(!p||busy||(taskReceiving?.workspace===workspace&&taskReceiving.generation===generation&&taskReceiving.pending===p))return;
    const task=(getState()?.tasks||[]).find(t=>t.id===p.task_id||t.operation_id===(p.native_operation_id||p.request.operation_id));
    if(!task)return;
    const stamp=[task.id,task.state,task.updated_at,task.result?.id].join('|');
    if(stamp===seenTaskStamp)return;
    seenTaskStamp=stamp;
    const ws=workspace,gen=generation;
    Promise.resolve().then(async()=>{
      if(!current(ws,gen)||draft.pending!==p)return;
      // The authoritative task route carries complete operands and downloads.
      await receiveOperation();
    }).catch(fail);
  }
  function detach(){
    if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}
    if(draft&&workspace){retainReviewDraft();storage.write(key(workspace),draft);}
    generation++;
    if(frame){frame.removeEventListener('click',onClick);frame.removeEventListener('input',onInput);frame.removeEventListener('change',onChange);frame.removeEventListener('close',onDialogClose,true);frame.remove();}
    globalThis.removeEventListener?.('pagehide',onPageHide);
    root=null;frame=null;workspace=null;draft=null;catalog=null;activePage=null;details=null;busy=false;seenTaskStamp='';rowRead++;fileRead++;taskReceiving=null;
  }
  return {mount,update,detach};
}
