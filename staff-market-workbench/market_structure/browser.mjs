// Compose the original source parser, workspace mutations and durable browser storage.
import {losslessJSON} from '/extensions/classification/browser.mjs';

const copy=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const tabs={sources:'1. Accepted analyses',decisions:'2. Proposed decisions',preview:'3. Preview and save',history:'4. Review and derive'};
const measures=[['p25','25th-percentile figure'],['p50','Median figure'],['p75','75th-percentile figure']];
const pageSize=25;
function freshDocument(){return {name:'',edition:'',basis:'',source_refs:[],analyses:[],currency:'',rate_basis:'',effective_date:'',effective_timing:'',date_basis:'',date_basis_note:'',source_use_note:'',grades:[],roles:[]};}
function freshDraft(){return {document:freshDocument(),original:null,edited_original:false,supersedes:null,preview:null,preview_inputs:null,grade_page:0,role_page:0,grade_selected:null,role_selected:null};}
function checkDocument(value){
  if(!object(value))throw new Error('The proposal must be an object.');
  for(const [field,max]of [['analyses',200],['grades',2000],['roles',25000],['source_refs',500]]){
    if(!Array.isArray(value[field])||value[field].length>max||value[field].some(row=>!object(row)))throw new Error(field+' must contain at most '+max+' row objects.');
  }
  return value;
}

export function mountMarketStructureBridge(target,api){
  const document=target.ownerDocument,win=document.defaultView,workspaceId=api.getState().workspace.id;
  const draftKey=workspaceId+':market_structure';
  let disposed=false,busy=false,loadSequence=0,proposalSequence=0,writeChain=Promise.resolve(),data={analyses:{items:[],next:null,total:0},proposals:{items:[],next:null,total:0}};
  let retained={schema:'staff-market.market-structure.draft/v1',workspace_id:workspaceId,tab:'sources',actor:'',reviewer:'',draft:freshDraft(),opened_id:null,review_notes:{},pending:null,last_result:null,recovered:null,failed_import:null};
  let opened=null,sourceDetail=null,sourceSearch='',proposalSearch='',previewPage=0,sourceErrors=new Map();
  const snapshots=new Map(),disabled=new Map();
  const root=make('section',undefined,'market-structure'),notice=make('div',undefined,'notice'),contents=make('div');
  root.setAttribute('aria-label','Market analysis to pay structure');
  notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
  const css=make('link');css.rel='stylesheet';css.href='/extensions/market_structure/browser.css';
  root.append(css,notice,contents);target.replaceChildren(root);
  for(const name of ['click','submit','input','change'])root.addEventListener(name,event=>event.stopPropagation());

  function make(tag,value,className){const node=document.createElement(tag);if(value!==undefined)node.textContent=String(value??'');if(className)node.className=className;return node;}
  function actions(...nodes){const out=make('div',undefined,'actions');out.append(...nodes.filter(Boolean));return out;}
  function panel(title){const out=make('div',undefined,'panel');out.append(make('h3',title));return out;}
  function hint(text){return make('p',text,'muted');}
  function detail(title,value){const node=make('details');node.append(make('summary',title));node.append(value instanceof win.Node?value:make('pre',JSON.stringify(value,null,2),'ms-json'));return node;}
  function show(message,error=false){notice.className='notice'+(error?' error':'');notice.textContent=message;}
  function button(label,action,primary=false){const node=make('button',label,primary?'primary':undefined);node.type='button';node.addEventListener('click',()=>perform(action));return node;}
  function input(label,value,set,{type='text',area=false,readonly=false,invalidate=true}={}){
    const node=make('label',label),control=make(area?'textarea':'input');
    if(!area)control.type=type;control.value=value??'';control.readOnly=readonly;
    control.addEventListener('input',()=>{set(control.value);if(invalidate)changed();else persist().catch(error=>show(error.message,true));});node.append(control);return node;
  }
  function option(label,value,choices,set){
    const node=make('label',label),control=make('select'),empty=make('option','Select…');empty.value='';control.append(empty);
    for(const entry of choices){const [key,title]=Array.isArray(entry)?entry:[entry,entry];const item=make('option',title);item.value=key;item.selected=key===value;control.append(item);}
    control.addEventListener('change',()=>{set(control.value);changed();render();});node.append(control);return node;
  }
  function table(headers,rows){
    const wrap=make('div',undefined,'scroll'),out=make('table'),head=make('thead'),tr=make('tr'),body=make('tbody');
    for(const title of headers)tr.append(make('th',title));head.append(tr);
    for(const row of rows){const tr=make('tr');for(const value of row){const td=make('td');td.append(value instanceof win.Node?value:document.createTextNode(String(value??'—')));tr.append(td);}body.append(tr);}
    out.append(head,body);wrap.append(out);return wrap;
  }
  function download(kind,id,label){const node=make('a',label);node.href='/api/extensions/market_structure/download/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id);return node;}
  function localDownload(value,name,type='application/json'){
    const blob=value instanceof win.Blob?value:new win.Blob([typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'],{type});
    const url=win.URL.createObjectURL(blob),node=make('a');node.href=url;node.download=name;node.click();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);
  }
  function identityLine(value){return make('p',value,'ms-identity');}
  function lock(){for(const node of root.querySelectorAll('button,input,select,textarea')){if(!disabled.has(node))disabled.set(node,node.disabled);node.disabled=true;}}
  function visible(){return !disposed&&api.getState().workspace.id===workspaceId;}
  function persist(){
    const snapshot=copy(retained);
    const pending=writeChain.catch(()=>{}).then(()=>api.drafts.write(draftKey,snapshot));
    writeChain=pending;return pending;
  }
  function changed(){
    retained.draft.preview=null;retained.draft.preview_inputs=null;
    if(retained.draft.original)retained.draft.edited_original=true;
    persist().catch(error=>show('The draft could not be saved: '+error.message,true));
  }
  async function perform(action){
    if(disposed||busy)return;
    busy=true;lock();
    try{await persist();await action();await persist();}
    catch(error){if(!disposed){show(error.message||String(error),true);if(error.details)notice.append(detail('Original response details',error.details));}}
    finally{busy=false;for(const[node,value]of disabled)node.disabled=value;disabled.clear();}
  }
  function requestDocument(){
    return {document:copy(retained.draft.document),
            ...(retained.draft.original?{original:copy(retained.draft.original),edited_original:retained.draft.edited_original}:{})};
  }
  async function commit(action,args){
    if(retained.pending)throw new Error('Resume the original pending request shown above before creating another mutation.');
    const operation=win.crypto.randomUUID(),path='/api/extensions/market_structure/'+action;
    retained.pending={action,workspace_id:workspaceId,operation_id:operation,path,
      body:{expected_revision:api.getState().workspace.revision,operation_id:operation,...copy(args)},created_at:new Date().toISOString()};
    await persist();
    return resumePending();
  }
  async function resumePending(){
    const pending=retained.pending;if(!pending)return;
    if(pending.workspace_id!==workspaceId)throw new Error('The pending operation belongs to another workspace.');
    let returned;
    try{returned=await api.mutate(pending.path,pending.body,pending);}
    catch(error){if(error.status&&error.status<500){retained.pending=null;await persist();}throw error;}
    const value=returned.result;
    retained.last_result={operation_id:pending.operation_id,action:pending.action,pending:copy(pending),value:copy(value),replayed:returned.replayed,applied:false};
    retained.pending=null;
    // Commit the actual response before any subsequent read or navigation can fail.
    await persist();
    await applyResult(pending,value);
    retained.last_result.applied=true;await persist();
    return value;
  }
  async function applyResult(pending,value){
    if(pending.action==='preview'){
      const original={document:pending.body.document,...(pending.body.original?{original:pending.body.original,edited_original:pending.body.edited_original}:{})};
      if(JSON.stringify(original)!==JSON.stringify(requestDocument())){show('The original preview returned. Your newer draft is retained; calculate that draft to continue.');return;}
      retained.draft.preview=value;retained.draft.preview_inputs=JSON.stringify(original);retained.tab='preview';previewPage=0;
    }else if(pending.action==='save_proposal'){
      retained.opened_id=value.id;retained.tab='history';retained.draft.supersedes={id:value.id,sha256:value.sha256};
      retained.draft.preview=null;retained.draft.preview_inputs=null;
      await persist();await reload(false);await openProposal(value.id,false);
    }else if(pending.action==='review'||pending.action==='derive'){
      retained.opened_id=pending.body.id;retained.tab='history';await persist();await reload(false);await openProposal(pending.body.id,false);
    }
    await persist();render();show('Original '+pending.action.replaceAll('_',' ')+' retained in this workspace.');
  }
  async function readDraft(){
    const row=await api.drafts.read(draftKey);if(!row)return;
    const value=row.value;
    try{
      if(!object(value)||value.schema!==retained.schema||value.workspace_id!==workspaceId||!object(value.draft))throw new Error('The retained draft has an unsupported workspace or shape.');
      checkDocument(value.draft.document);
      if(value.draft.original&&(!object(value.draft.original)||typeof value.draft.original.content!=='string'))throw new Error('The retained imported proposal has an invalid shape.');
      if(value.pending&&(!object(value.pending)||value.pending.workspace_id!==workspaceId||!object(value.pending.body)||typeof value.pending.operation_id!=='string'||value.pending.body.operation_id!==value.pending.operation_id))throw new Error('The retained pending operation has an invalid shape.');
      if(value.pending&&(!['preview','save_proposal','review','derive'].includes(value.pending.action)||value.pending.path!=='/api/extensions/market_structure/'+value.pending.action))throw new Error('The retained request does not identify the original native action.');
      retained={...retained,...value,review_notes:object(value.review_notes)?value.review_notes:{}};
      if(!tabs[retained.tab])retained.tab='sources';
      retained.draft={...freshDraft(),...value.draft};
    }catch(error){retained.recovered={message:error.message,value};await persist();show('A usable editor has been reopened; the complete original draft remains available below.',true);}
  }
  async function getSnapshot(id,fresh=false){
    if(!fresh&&snapshots.has(id))return snapshots.get(id);
    const value=await api.request('/api/extensions/market_structure/document/analysis/'+encodeURIComponent(id));
    if(!visible())throw new Error('The workspace changed while reading the source.');
    snapshots.set(id,value);sourceErrors.delete(id);return value;
  }
  async function loadSelections(){
    for(const ref of retained.draft.document.analyses){
      try{await getSnapshot(ref.analysis_id,true);}
      catch(error){sourceErrors.set(ref.analysis_id,error.message);}
      if(!visible())return;
    }
  }
  async function reload(renderNow=true){
    const sequence=++loadSequence;
    const next=await api.request('/api/extensions/market_structure/state');
    if(!visible()||sequence!==loadSequence)return;
    if(next.workspace_id!==workspaceId)throw new Error('The native result belongs to another workspace.');
    data=next;await loadSelections();
    const selectedId=retained.opened_id,selection=proposalSequence;
    if(selectedId){
      try{
        const nextOpened=await api.request('/api/extensions/market_structure/document/proposal/'+encodeURIComponent(selectedId));
        if(visible()&&sequence===loadSequence&&selection===proposalSequence&&retained.opened_id===selectedId)opened=nextOpened;
      }catch(error){if(visible()&&sequence===loadSequence&&selection===proposalSequence)show(error.message,true);}
    }
    if(visible()&&sequence===loadSequence&&renderNow)render();
  }
  async function more(kind){
    const group=kind==='analysis-page'?'analyses':'proposals',cursor=data[group].next;if(!cursor)return;
    const value=await api.request('/api/extensions/market_structure/document/'+kind+'/'+encodeURIComponent(cursor));
    if(!visible())return;
    const known=new Set(data[group].items.map(row=>row.id));
    data[group]={...value,items:[...data[group].items,...value.items.filter(row=>!known.has(row.id))]};render();
  }
  async function selectAnalysis(id){
    if(!visible())return;
    if(retained.draft.document.analyses.some(row=>row.analysis_id===id)){retained.tab='decisions';render();return;}
    if(retained.draft.document.analyses.length>=200)throw new Error('One proposal supports at most 200 original accepted analyses.');
    const snapshot=await getSnapshot(id,true),a=snapshot.analysis,review=snapshot.accepted_review;
    if(!review||review.outcome!=='accepted'||review.result_sha256!==a.result_sha256||a.errors.length)throw new Error('Accept the original exact analysis before adding it to this proposal.');
    retained.draft.document.analyses.push({analysis_id:id,expected_result_sha256:a.result_sha256,expected_review_id:review.id});
    changed();render();show('Accepted original analysis selected. Define its grade and role decisions explicitly.');
  }
  async function refreshSelection(id){
    const value=await getSnapshot(id,true),review=value.accepted_review;
    if(!review||review.outcome!=='accepted'||review.result_sha256!==value.analysis.result_sha256||value.analysis.errors.length)throw new Error('The current exact original analysis requires its native review.');
    const ref=retained.draft.document.analyses.find(row=>row.analysis_id===id);
    Object.assign(ref,{expected_result_sha256:value.analysis.result_sha256,expected_review_id:review.id});
    changed();render();
  }
  function removeAnalysis(id){
    const d=retained.draft.document;
    if(d.grades.some(row=>row.analysis_id===id)||d.roles.some(row=>row.analysis_id===id))throw new Error('Reassign or remove this analysis’s grade and role decisions before removing the source.');
    d.analyses=d.analyses.filter(row=>row.analysis_id!==id);changed();render();
  }
  function analysisLabel(id){const a=snapshots.get(id)?.analysis||data.analyses.items.find(row=>row.id===id);return a?(a.title+' · '+(a.job?.record?.title||a.job_title)):id;}
  function selectedOptions(){return retained.draft.document.analyses.map(ref=>[ref.analysis_id,analysisLabel(ref.analysis_id)]);}
  function snapshotView(snapshot){
    const a=snapshot.analysis,review=snapshot.accepted_review,p=panel(a.title);
    p.append(hint(a.job.record.title+' · '+a.currency+' · '+(a.target_date||'Original source dates')+' · '+a.source_mode),
      identityLine(a.id+' · '+a.result_sha256),
      table(['Original figure','Annualized accepted amount','Coverage'],Object.entries(a.consensus).map(([key,amount])=>[key,amount??'Unavailable',JSON.stringify(a.measure_coverage[key])])),
      hint(a.method),hint(a.basis_note));
    if(review)p.append(detail('Current original review',review));
    p.append(detail('Original job, selected matches, source values and date/aging factors',a));
    for(const source of snapshot.sources){
      const section=make('div',undefined,'ms-source');section.append(make('h4',(source.metadata.source_name||source.source_key)+' / '+source.edition),
        hint('Permitted use: '+(source.metadata.metadata?.permitted_use||'No permitted-use note was entered with this source.')),
        identityLine(source.id+' · '+source.raw_sha256),
        detail('Retained source metadata and mapping',source));
      const original=make('a','Download exact original file');original.href='/api/original/'+encodeURIComponent(source.id);section.append(original);p.append(section);
    }
    return p;
  }
  function sourcesView(){
    const wrap=make('div'),selected=panel('Selected original analyses'),d=retained.draft.document;
    const rows=d.analyses.map(ref=>{
      const snapshot=snapshots.get(ref.analysis_id),a=snapshot?.analysis,review=snapshot?.accepted_review;
      const current=review?.id===ref.expected_review_id&&review?.outcome==='accepted';
      return [analysisLabel(ref.analysis_id),a?.currency,a?.target_date||'Source dates',current?'Exact accepted review':sourceErrors.get(ref.analysis_id)||'Original review changed',
        actions(button('Inspect source',async()=>{sourceDetail=await getSnapshot(ref.analysis_id,true);render();}),
          button('Refresh selected review',()=>refreshSelection(ref.analysis_id)),button('Remove',()=>removeAnalysis(ref.analysis_id)))];
    });
    selected.append(rows.length?table(['Analysis / job','Currency','Date basis','Review','Source actions'],rows):hint('Select accepted analyses below. Each selected study remains individually identified.'));
    const p=panel('Original market analyses');
    const search=input('Filter loaded analyses',sourceSearch,value=>sourceSearch=value,{invalidate:false});search.querySelector('input').addEventListener('input',()=>renderSourceRowsOnly());
    p.append(search);const sourceRows=make('div');sourceRows.dataset.sourceRows='';p.append(sourceRows);
    function renderSourceRowsOnly(){
      const q=sourceSearch.toLowerCase(),filtered=data.analyses.items.filter(a=>(a.title+' '+a.job_title+' '+a.id).toLowerCase().includes(q));
      sourceRows.replaceChildren(table(['Analysis / job','Figures p25 / p50 / p75','Currency / date','Review','Select'],filtered.map(a=>{
        const accepted=a.latest_review?.outcome==='accepted'&&a.latest_review?.result_sha256===a.result_sha256&&!a.errors.length;
        const included=d.analyses.some(ref=>ref.analysis_id===a.id);
        const add=button(included?'Selected':'Add original analysis',()=>selectAnalysis(a.id));add.disabled=included||!accepted;
        return [a.title+' / '+a.job_title,[a.consensus.p25,a.consensus.p50,a.consensus.p75].map(v=>v??'—').join(' / '),
          a.currency+' / '+(a.target_date||'Source dates'),a.latest_review?.outcome||'Awaiting review',actions(add,button('Inspect',async()=>{sourceDetail=await getSnapshot(a.id,true);render();}))];
      })));
      sourceRows.append(hint(data.analyses.items.length+' of '+data.analyses.total+' original analyses loaded. The filter applies to these loaded records.'));
      if(data.analyses.next)sourceRows.append(button('Load next 50 original analyses',()=>more('analysis-page')));
    }
    renderSourceRowsOnly();wrap.append(selected,p);if(sourceDetail)wrap.append(snapshotView(sourceDetail));return wrap;
  }
  function editorPages(rows,key,renderRows){
    const p=make('div');retained.draft[key]=Math.max(0,Math.min(Number(retained.draft[key])||0,Math.max(0,Math.ceil(rows.length/pageSize)-1)));
    const offset=retained.draft[key]*pageSize;
    p.append(renderRows(rows.slice(offset,offset+pageSize),offset));
    const back=button('Previous rows',()=>{retained.draft[key]--;render();}),next=button('Next rows',()=>{retained.draft[key]++;render();});
    back.disabled=offset===0;next.disabled=offset+pageSize>=rows.length;
    p.append(actions(back,make('span',rows.length?(offset+1)+'–'+Math.min(offset+pageSize,rows.length)+' of '+rows.length:'0 rows'),next));return p;
  }
  function gradeEditor(row,index){
    const p=panel('Grade decision '+row.id),grid=make('div',undefined,'ms-grid');
    const set=(key,value)=>row[key]=value;
    grid.append(input('Grade ID',row.id,value=>set('id',value)),
      input('Grade label',row.label,value=>set('label',value)),
      option('Original anchor analysis',row.analysis_id,selectedOptions(),value=>set('analysis_id',value)),
      option('Reference choice',row.reference_mode,[['analysis_measure','Original accepted figure'],['entered','Explicit entered reference']],value=>set('reference_mode',value)),
      input('Reference label',row.reference_label,value=>set('reference_label',value)));
    if(row.reference_mode==='analysis_measure')grid.append(option('Original reference figure',row.reference_measure,measures,value=>set('reference_measure',value)));
    else if(row.reference_mode==='entered')grid.append(input('Entered reference annual rate',row.reference_amount,value=>set('reference_amount',value)));
    grid.append(option('Range choice',row.range_mode,[['analysis_measures','Limits from this original analysis'],['entered','Explicit entered limits'],['reference_percent','Explicit percentages around reference']],value=>set('range_mode',value)));
    if(row.range_mode==='analysis_measures')grid.append(option('Minimum figure',row.lower_measure,measures,value=>set('lower_measure',value)),option('Maximum figure',row.upper_measure,measures,value=>set('upper_measure',value)));
    else if(row.range_mode==='entered')grid.append(input('Minimum annual rate',row.minimum,value=>set('minimum',value)),input('Maximum annual rate',row.maximum,value=>set('maximum',value)));
    else if(row.range_mode==='reference_percent')grid.append(input('Percent below reference',row.below_pct,value=>set('below_pct',value)),input('Percent above reference',row.above_pct,value=>set('above_pct',value)));
    grid.append(option('Rounding',row.rounding,[['exact','Retain exact Decimal result'],['half_up_cents','Half-up to 0.01']],value=>set('rounding',value)));
    p.append(grid,input('Professional basis for the reference and range',row.rationale,value=>set('rationale',value),{area:true}),
      actions(button('Close grade editor',()=>{retained.draft.grade_selected=null;render();}),button('Remove grade',()=>{
        if(retained.draft.document.roles.some(role=>role.grade_id===row.id))throw new Error('Reassign this grade’s roles before removing the grade.');
        retained.draft.document.grades.splice(index,1);retained.draft.grade_selected=null;changed();render();
      })));
    const snapshot=snapshots.get(row.analysis_id);if(snapshot)p.append(detail('Original accepted figure and source basis',snapshotView(snapshot)));
    return p;
  }
  function roleEditor(row,index){
    const p=panel('Role decision '+row.id),grid=make('div',undefined,'ms-grid');
    grid.append(input('Proposed role ID',row.id,value=>row.id=value),
      option('Original analyzed job',row.analysis_id,selectedOptions(),value=>row.analysis_id=value),
      option('Proposed grade',row.grade_id,retained.draft.document.grades.map(grade=>[grade.id,grade.label||grade.id]),value=>row.grade_id=value));
    p.append(grid,input('Professional role-to-grade decision',row.rationale,value=>row.rationale=value,{area:true}));
    const job=snapshots.get(row.analysis_id)?.analysis.job;if(job)p.append(detail('Complete original job',job));
    p.append(actions(button('Close role editor',()=>{retained.draft.role_selected=null;render();}),button('Remove role',()=>{retained.draft.document.roles.splice(index,1);retained.draft.role_selected=null;changed();render();})));return p;
  }
  function decisionsView(){
    const wrap=make('div'),p=panel('Proposed method and date basis'),d=retained.draft.document,grid=make('div',undefined,'ms-grid');
    grid.append(input('Proposed structure name',d.name,value=>d.name=value),input('Edition label',d.edition,value=>d.edition=value),
      input('Currency from the selected analyses',d.currency,value=>d.currency=value),
      option('Rate basis',d.rate_basis,[['annual_fulltime','Annual full-time rates']],value=>d.rate_basis=value),
      input('Effective calendar date',d.effective_date,value=>d.effective_date=value,{type:'date'}),
      input('Effective timing when the date is not set',d.effective_timing,value=>d.effective_timing=value),
      option('Original comparison date basis',d.date_basis,[['common_target_date','One common accepted target date'],['retained_source_dates','Explicit retained source dates']],value=>d.date_basis=value));
    p.append(grid,input('Basis and scope of this proposed structure',d.basis,value=>d.basis=value,{area:true}),
      input('How the retained analysis dates apply to this proposal',d.date_basis_note,value=>d.date_basis_note=value,{area:true}),
      input('Source-use and delivery scope note',d.source_use_note,value=>d.source_use_note=value,{area:true}));
    if(retained.draft.supersedes)p.append(identityLine('New edition of '+retained.draft.supersedes.id+' · '+retained.draft.supersedes.sha256));
    const grades=panel('Explicit grade ranges');
    grades.append(hint('Select each grade’s original reference and range basis. The native preview keeps the source figure, unrounded calculation and chosen rounding.'),
      button('Add grade decision',()=>{
        d.grades.push({id:'grade-'+win.crypto.randomUUID(),label:'',analysis_id:'',reference_mode:'',reference_measure:'',
          reference_amount:'',reference_label:'',range_mode:'',lower_measure:'',upper_measure:'',minimum:'',maximum:'',
          below_pct:'',above_pct:'',rounding:'',rationale:''});
        retained.draft.grade_selected=d.grades.length-1;changed();render();
      }),
      editorPages(d.grades,'grade_page',(rows,offset)=>table(['Grade','Anchor analysis','Reference','Range','Open'],rows.map((row,i)=>[
        row.label||row.id,analysisLabel(row.analysis_id),row.reference_mode==='entered'?row.reference_amount:row.reference_measure,row.range_mode,
        button('Edit grade',()=>{retained.draft.grade_selected=offset+i;render();})]))));
    if(Number.isInteger(retained.draft.grade_selected)&&d.grades[retained.draft.grade_selected])grades.append(gradeEditor(d.grades[retained.draft.grade_selected],retained.draft.grade_selected));
    const roles=panel('Original jobs and proposed grades');
    roles.append(hint('Each role keeps its original Jobs record. Assign each native job once and record the professional grade decision.'),
      button('Add role decision',()=>{d.roles.push({id:'role-'+win.crypto.randomUUID(),analysis_id:'',grade_id:'',rationale:''});retained.draft.role_selected=d.roles.length-1;changed();render();}),
      editorPages(d.roles,'role_page',(rows,offset)=>table(['Proposed role','Original analysis / job','Selected grade','Open'],rows.map((row,i)=>[
        row.id,analysisLabel(row.analysis_id),row.grade_id,button('Edit role',()=>{retained.draft.role_selected=offset+i;render();})]))));
    if(Number.isInteger(retained.draft.role_selected)&&d.roles[retained.draft.role_selected])roles.append(roleEditor(d.roles[retained.draft.role_selected],retained.draft.role_selected));
    const importPanel=panel('Editable proposal');
    importPanel.append(hint('An editable JSON retains the original native analysis IDs and review hashes. It can reopen against this workspace or its complete native restore.'));
    const file=make('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','Import editable proposed structure');
    file.addEventListener('change',()=>perform(()=>importProposal(file.files?.[0])));importPanel.append(file,
      actions(button('Download current editable draft',()=>localDownload({schema:'staff-market.market-structure/v1',kind:'proposal',document:d,origin:{workspace_id:workspaceId}},'proposed-pay-structure-draft.json')),
        button('Start a new proposal draft',()=>{retained.recovered={message:'Previous editor retained when a new draft was started.',value:copy(retained.draft)};retained.draft=freshDraft();changed();render();})));
    if(retained.draft.original)importPanel.append(identityLine('Imported original: '+retained.draft.original.filename+' · '+(retained.draft.edited_original?'edited draft':'original imported document')),
      button('Download original imported bytes',()=>localDownload(retained.draft.original.content,retained.draft.original.filename||'original-proposal.json')));
    wrap.append(p,grades,roles,importPanel);return wrap;
  }
  async function importProposal(file){
    if(!file)return;if(file.size>16*1024*1024)throw new Error('Editable proposal import is limited to 16 MiB.');
    const bytes=await file.arrayBuffer();retained.failed_import={filename:file.name,bytes};await persist();
    const text=new win.TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),parsed=losslessJSON(text);
    const d=object(parsed)&&parsed.document?parsed.document:parsed;
    checkDocument(d);
    if(parsed.origin?.workspace_id&&parsed.origin.workspace_id!==workspaceId)throw new Error('The proposal refers to another original workspace. Restore that workspace or select the analyses here explicitly.');
    const draft=freshDraft();draft.document=copy(d);draft.original={filename:file.name,content:text};draft.edited_original=false;
    if(parsed.origin?.id&&parsed.origin?.sha256)draft.supersedes={id:parsed.origin.id,sha256:parsed.origin.sha256};
    retained.recovered={message:'Editor retained before importing the selected original file.',value:copy(retained.draft)};
    retained.draft=draft;retained.failed_import=null;sourceErrors.clear();await persist();await loadSelections();retained.tab='decisions';render();
  }
  function previewView(){
    const wrap=make('div'),p=panel('Review the complete proposed structure'),draft=retained.draft;
    p.append(hint('The native preview validates exact accepted studies, currencies, source dates and every role decision. Editing a decision invalidates this preview.'),
      button('Calculate complete proposal preview',()=>commit('preview',requestDocument()),true));
    const value=draft.preview;
    if(!value){p.append(hint('Calculate the current draft to inspect its explicit ranges and complete original sources.'));wrap.append(p);return wrap;}
    p.append(identityLine(value.preview_sha256),make('p',value.method.name+' · '+value.method.currency+' · '+value.method.grades.length+' grades · '+value.roles.rows.length+' original jobs'));
    for(const warning of value.warnings)p.append(hint(warning));
    const rows=value.grade_calculations,offset=previewPage*pageSize;
    p.append(table(['Grade','Original figures p25 / p50 / p75','Proposed min / reference / max','Unrounded min / reference / max','Rounding / adjustments'],
      rows.slice(offset,offset+pageSize).map(row=>[row.grade_id,Object.values(row.original_consensus).map(v=>v??'—').join(' / '),
        [row.result.min,row.result.reference,row.result.max].join(' / '),[row.unrounded.min,row.unrounded.reference,row.unrounded.max].join(' / '),
        row.rounding+' / '+Object.values(row.rounding_adjustments).join(' / ')])));
    const back=button('Previous grades',()=>{previewPage--;render();}),next=button('Next grades',()=>{previewPage++;render();});
    back.disabled=offset===0;next.disabled=offset+pageSize>=rows.length;p.append(actions(back,make('span',(offset+1)+'–'+Math.min(offset+pageSize,rows.length)+' of '+rows.length),next));
    p.append(detail('Complete role-to-grade decisions',value.roles),detail('Original studies, source metadata and accepted reviews',value.inputs),
      detail('Complete submitted and normalized decisions',value));
    const save=button('Save proposed structure',()=>{
      if(draft.preview_inputs!==JSON.stringify(requestDocument()))throw new Error('Calculate the exact current draft again before saving.');
      return commit('save_proposal',{...requestDocument(),actor:retained.actor,expected_preview_sha256:value.preview_sha256,
        ...(draft.supersedes?{supersedes:draft.supersedes.id,expected_supersedes_sha256:draft.supersedes.sha256}:{})});
    },true);
    p.append(actions(save));wrap.append(p);return wrap;
  }
  async function openProposal(id,renderNow=true){
    const selection=++proposalSequence;
    const value=await api.request('/api/extensions/market_structure/document/proposal/'+encodeURIComponent(id));
    if(!visible()||selection!==proposalSequence)return;
    if(value.id!==id)throw new Error('The original selected proposal was not returned.');
    opened=value;retained.opened_id=id;retained.tab='history';await persist();if(renderNow)render();
  }
  async function editProposal(id){
    await openProposal(id,false);const prior=retained.draft,original=opened.content.original_input;
    const draft=freshDraft();draft.document=copy(opened.content.submitted_document);
    draft.supersedes={id:opened.id,sha256:opened.sha256};
    if(original){draft.original={filename:original.filename,content:original.content};draft.edited_original=original.edited_document;}
    retained.recovered={message:'Previous editor retained before reopening this saved proposal as a new edition.',value:copy(prior)};
    retained.draft=draft;retained.tab='decisions';await persist();await loadSelections();render();
  }
  function proposalView(proposal){
    const p=panel(proposal.content.method.name+' / '+(proposal.content.document.edition||'Proposed edition'));
    const latest=proposal.reviews.at(-1),derivation=proposal.derivation;
    p.append(identityLine(proposal.id+' · '+proposal.sha256),hint('Recorded by '+proposal.created_by+' at '+proposal.created_at),
      make('p',proposal.content.method.currency+' · '+proposal.content.method.grades.length+' grades · '+proposal.content.roles.rows.length+' roles · '+(latest?.outcome||'Awaiting review')),
      detail('Exact grades and role decisions',proposal.content.document),detail('Original accepted analyses and source custody',proposal.content.inputs),
      detail('Current original-input review state',proposal.input_status));
    if(proposal.changes)p.append(detail('Complete changes from the previous proposal',proposal.changes));
    if(proposal.reviews.length)p.append(detail('Original proposal review history',proposal.reviews));
    const grid=make('div',undefined,'ms-grid'),reviewer=input('Person reviewing this proposal',retained.reviewer,value=>retained.reviewer=value,{invalidate:false});
    reviewer.querySelector('input').addEventListener('input',()=>persist().catch(error=>show(error.message,true)));grid.append(reviewer);
    const notes=input('Review rationale',retained.review_notes[proposal.id]||'',value=>retained.review_notes[proposal.id]=value,{area:true,invalidate:false});
    p.append(grid,notes,actions(button('Accept proposed structure',()=>commit('review',{id:proposal.id,expected_sha256:proposal.sha256,outcome:'accepted',reviewer:retained.reviewer,notes:retained.review_notes[proposal.id]||''}),true),
      button('Request changes',()=>commit('review',{id:proposal.id,expected_sha256:proposal.sha256,outcome:'changes_requested',reviewer:retained.reviewer,notes:retained.review_notes[proposal.id]||''})),
      button('Use as a new proposal edition',()=>editProposal(proposal.id)),download('editable',proposal.id,'Editable proposal JSON')));
    if(latest?.outcome==='accepted')p.append(actions(download('accepted-csv',proposal.id,'Accepted decisions CSV'),
      download('accepted-package',proposal.id,'Complete accepted proposal JSON'),download('source-package',proposal.id,'Original source files and accepted proposal ZIP')));
    if(derivation){
      const section=panel('Derived native classification editions');
      section.append(hint('The retained proposal created these original method and role editions. Their native classification reviews remain visible in the existing workflow.'),
        table(['Kind','Exact native identity','Open'],['method','roles'].map(kind=>[kind,derivation[kind].id+' / '+derivation[kind].sha256,
          button('Open '+kind,()=>api.onOpenClassification(derivation[kind]))])),detail('Original derivation and accepted proposal review',derivation));p.append(section);
    }else if(latest?.outcome==='accepted')p.append(button('Create native method and role editions',()=>commit('derive',{id:proposal.id,expected_sha256:proposal.sha256,expected_review_id:latest.id,actor:retained.actor}),true));
    return p;
  }
  function historyView(){
    const wrap=make('div');if(opened)wrap.append(proposalView(opened));
    const p=panel('Saved proposed structures'),query=input('Filter loaded proposals',proposalSearch,value=>proposalSearch=value,{invalidate:false});
    p.append(query);const rows=make('div');p.append(rows);
    function updateRows(){
      const q=proposalSearch.toLowerCase(),filtered=data.proposals.items.filter(value=>(value.name+' '+value.edition+' '+value.id).toLowerCase().includes(q));
      rows.replaceChildren(table(['Proposal / edition','Scope','Review / derivation','Open'],filtered.map(value=>[
        value.name+' / '+value.edition,value.currency+' · '+value.grades+' grades · '+value.roles+' roles',
        (value.latest_review?.outcome||'Awaiting review')+(value.derivation?' / Derived':''),
        actions(button('Review and derive',()=>openProposal(value.id)),button('New edition',()=>editProposal(value.id)))])));
      rows.append(hint(data.proposals.items.length+' of '+data.proposals.total+' retained proposals loaded.'));
      if(data.proposals.next)rows.append(button('Load next 50 proposals',()=>more('proposal-page')));
    }
    query.querySelector('input').addEventListener('input',updateRows);updateRows();wrap.append(p);return wrap;
  }
  function recoveryView(){
    const wrap=make('div');
    if(retained.pending){const p=panel('Original request is retained');p.append(identityLine(retained.pending.operation_id),hint(retained.pending.action+' keeps its original body and expected revision.'),
      button('Resume original request',resumePending,true),detail('Original operation',retained.pending));wrap.append(p);}
    if(retained.last_result){const p=make('details');p.append(make('summary','Last native result'),identityLine(retained.last_result.operation_id),detail('Returned original result',retained.last_result));
      if(retained.last_result.applied===false)p.append(button('Reopen the returned native result',async()=>{await applyResult(retained.last_result.pending,retained.last_result.value);retained.last_result.applied=true;await persist();render();}));
      wrap.append(p);}
    if(retained.recovered){const p=panel('Retained editor recovery');p.append(hint(retained.recovered.message),button('Download complete original draft',()=>localDownload(retained.recovered.value,'retained-pay-structure-draft.json')),detail('Retained original draft',retained.recovered.value));wrap.append(p);}
    if(retained.failed_import){const p=panel('Original import retained for correction');p.append(hint(retained.failed_import.filename),button('Download exact imported bytes',()=>localDownload(new win.Blob([retained.failed_import.bytes]),retained.failed_import.filename,'application/octet-stream')));wrap.append(p);}
    return wrap;
  }
  function render(){
    if(!visible())return;
    const header=panel('Accepted market analyses to proposed pay structure'),actor=input('Person recording proposals',retained.actor,value=>retained.actor=value,{invalidate:false});
    header.append(actor,hint('Select exact accepted analyses, record explicit reference and range choices, assign original jobs, then review and derive ordinary classification editions.'));
    const nav=make('div',undefined,'ms-tabs');nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Pay-structure workflow');
    for(const[key,label]of Object.entries(tabs)){const control=button(label,()=>{retained.tab=key;render();});control.setAttribute('role','tab');control.setAttribute('aria-selected',retained.tab===key?'true':'false');nav.append(control);}
    const body=retained.tab==='sources'?sourcesView():retained.tab==='decisions'?decisionsView():retained.tab==='preview'?previewView():historyView();
    body.setAttribute('role','tabpanel');contents.replaceChildren(header,recoveryView(),nav,body);if(busy)lock();
  }
  const ready=(async()=>{
    await readDraft();await reload(false);
    if(retained.last_result?.applied===false&&retained.last_result.pending){
      try{await applyResult(retained.last_result.pending,retained.last_result.value);retained.last_result.applied=true;await persist();}
      catch(error){show('The original result is retained for reopen: '+error.message,true);}
    }
    render();
  })();
  return {ready,refresh:reload,selectAnalysis:async id=>{await ready;await perform(()=>selectAnalysis(id));},
    open:async id=>{await ready;await perform(()=>openProposal(id));},
    destroy(){disposed=true;loadSequence++;proposalSequence++;writeChain.catch(()=>{});target.replaceChildren();}};
}
