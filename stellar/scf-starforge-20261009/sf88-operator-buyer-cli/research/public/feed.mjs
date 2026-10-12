// MIT. Industrial feed panel mounted inside the original research workspace.
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
const pretty=v=>JSON.stringify(v,null,2),short=id=>id?.replace('https://openalex.org/','')??'Unidentified';
const state={contractId:null,view:'records',offset:0,q:'',status:'',beforeId:'',comparisonView:'changed',drafts:new Map()};
let generation=0;
const input=(value,type='text')=>{const n=node('input');n.type=type;if(type==='checkbox')n.checked=Boolean(value);else n.value=value??'';return n;};
function select(values,value){const n=node('select');for(const [id,label]of values.map(v=>Array.isArray(v)?v:[v,v])){const opt=node('option',label);opt.value=id;n.append(opt);}n.value=value??'';return n;}
function field(label,control){const n=node('label',label);control.setAttribute('aria-label',label);n.append(control);return n;}
function details(label,value){const d=node('details'),summary=node('summary',label);d.append(summary,node('pre',pretty(value)));return d;}
function table(heads,rows){const wrap=node('div',undefined,'table-wrap'),t=node('table'),head=node('thead'),tr=node('tr');for(const h of heads)tr.append(node('th',h));head.append(tr);const body=node('tbody');for(const values of rows){const row=node('tr');for(const value of values){const cell=node('td');cell.append(value instanceof Node?value:node('span',value??'—'));row.append(cell);}body.append(row);}t.append(head,body);wrap.append(t);return wrap;}
export async function renderFeed({api,download,container,editionId,catalog,current,notice}){
  const draw=++generation,active=()=>generation===draw&&current();
  async function perform(action,button){if(button)button.disabled=true;try{await action();}catch(e){notice(e.message??String(e));}finally{if(button&&button.isConnected)button.disabled=false;}}
  const button=(text,action)=>{const b=node('button',text);b.type='button';b.addEventListener('click',()=>void perform(()=>action(b),b));return b;};
  const reload=()=>renderFeed({api,download,container,editionId,catalog,current,notice});
  const data=await api('/api/feeds');if(!active())return;
  if(!data.contracts.some(c=>c.contract.id===state.contractId))state.contractId=data.contracts[0]?.contract.id??null;
  container.replaceChildren();container.append(node('h2','Scholarly metadata feed'),node('p','Map this retained edition to a receiving contract, resolve field exceptions, compare editions and freeze the complete delivery.'));
  const chooser=node('div',undefined,'toolbar'),choice=select(data.contracts.map(c=>[c.contract.id,c.contract.label+' · revision '+c.revision]),state.contractId),newId=input('openalex-metadata');
  choice.addEventListener('change',()=>{state.contractId=choice.value;state.offset=0;void perform(reload);});
  chooser.append(field('Saved contract',choice),field('New contract ID',newId),button('Create contract',async()=>{const c=structuredClone(data.defaultContract);c.id=newId.value;const saved=await api('/api/feeds/contracts',{method:'POST',data:{contract:c,expectedRevision:0}});state.contractId=saved.contract.id;state.offset=0;await reload();}));container.append(chooser);
  if(!state.contractId){container.append(node('p','Create a contract to start with the supplied OpenAlex field map.'));return;}
  const c=data.contracts.find(x=>x.contract.id===state.contractId);
  let draft=state.drafts.get(c.contract.id);if(!draft){draft={revision:c.revision,contract:structuredClone(c.contract)};state.drafts.set(c.contract.id,draft);}
  const context={contractId:c.contract.id,contractRevision:c.revision,editionId},params=new URLSearchParams({contract:c.contract.id,revision:c.revision,edition:editionId,view:state.view==='compare'?'records':state.view,offset:state.offset,limit:50,q:state.q,status:state.status});
  const p=await api('/api/feeds/preview?'+params);if(!active())return;
  const metrics=node('div',undefined,'metric-grid');
  for(const [label,value]of [['Output records',p.summary.outputRecords],['Source records',p.summary.sourceRecords],['Open exceptions',p.summary.openExceptions],['Review revision',p.reviewRevision]]){const m=node('div',undefined,'metric');m.append(node('strong',value),node('span',label));metrics.append(m);}container.append(metrics);
  container.append(node('p','Coverage '+p.edition.coverage.state+' · '+p.edition.coverage.pages+' retained pages · source '+p.sourceFingerprint.slice(0,16), 'muted'));
  const edit=node('details'),editSummary=node('summary','Edit field contract · '+c.contract.fields.length+' fields');edit.append(editSummary);
  const controls=node('div',undefined,'toolbar'),label=input(draft.contract.label),identity=input(draft.contract.identityField),scope=select([['all','All eligible source works'],['included','Only included research works']],draft.contract.selection),partial=input(draft.contract.allowPartial,'checkbox');
  label.addEventListener('input',()=>draft.contract.label=label.value);identity.addEventListener('input',()=>draft.contract.identityField=identity.value);scope.addEventListener('change',()=>draft.contract.selection=scope.value);partial.addEventListener('change',()=>draft.contract.allowPartial=partial.checked);
  controls.append(field('Contract label',label),field('Identity column',identity),field('Research selection',scope),field('Allow partial capture',partial));edit.append(controls,node('p','JSON Pointer paths use * for array elements. Missing and explicit null values stay distinct. Keep the identity column mapped directly from /id. Enum transformations use a JSON object of raw values to target values.','muted'));
  function renderFieldEditor(){
    const rows=draft.contract.fields.map((f,index)=>{
      const target=input(f.target),source=input(f.source),type=select(['string','number','integer','boolean','array','object','date','uri','any'],f.type),transform=select(['identity','trim','doi-key','flatten','enum'],f.transform),required=input(f.required,'checkbox'),nullable=input(f.nullable,'checkbox'),missing=select(['omit','null'],f.missing),values=node('textarea');
      values.rows=2;values.value=f.values?pretty(f.values):'';values.setAttribute('aria-label','Type mapping for '+f.target);
      for(const [key,control,event]of [['target',target,'input'],['source',source,'input'],['type',type,'change'],['transform',transform,'change'],['required',required,'change'],['nullable',nullable,'change'],['missing',missing,'change']]){control.setAttribute('aria-label',key+' for '+f.target);control.addEventListener(event,()=>f[key]=control.type==='checkbox'?control.checked:control.value);}
      values.addEventListener('change',()=>{try{if(values.value.trim())f.values=JSON.parse(values.value);else delete f.values;values.setCustomValidity('');}catch{values.setCustomValidity('Enter a JSON object for the vocabulary mapping.');values.reportValidity();}});
      return [target,source,type,transform,required,nullable,missing,values,button('Remove',async()=>{draft.contract.fields.splice(index,1);editor.replaceChildren(renderFieldEditor());})];
    });return table(['Target','Source pointer','Type','Transform','Required','Allow null','Absent value','Enum map',''],rows);
  }
  const editor=node('div',undefined,'feed-field-editor');editor.append(renderFieldEditor());edit.append(editor);
  const editActions=node('div',undefined,'actions');editActions.append(button('Add field',async()=>{draft.contract.fields.push({target:'field_'+(draft.contract.fields.length+1),source:'/display_name',type:'string',transform:'identity',required:false,nullable:true,missing:'omit'});editor.replaceChildren(renderFieldEditor());}),button('Save contract revision',async()=>{const saved=await api('/api/feeds/contracts',{method:'POST',data:{contract:draft.contract,expectedRevision:draft.revision}});state.drafts.delete(c.contract.id);notice('Saved contract revision '+saved.revision+'.');state.offset=0;await reload();}),button('Reload saved contract',async()=>{state.drafts.delete(c.contract.id);await reload();}));edit.append(editActions,details('Saved contract JSON',c));container.append(edit);
  const toolbar=node('div',undefined,'toolbar'),view=select([['records','Mapped records'],['exceptions','Field exceptions'],['omissions','Omitted occurrences'],['compare','Edition comparison']],state.view),search=input(state.q,'search'),status=select([['','All exception states'],['OPEN','Open'],['RESOLVED','Resolved'],['EXCLUDED','Excluded work']],state.status);
  view.addEventListener('change',()=>{state.view=view.value;state.offset=0;void perform(reload);});status.addEventListener('change',()=>{state.status=status.value;state.offset=0;void perform(reload);});
  search.placeholder='Search the complete selected table';toolbar.append(field('View',view),field('Find',search),button('Search',async()=>{state.q=search.value;state.offset=0;await reload();}));if(state.view==='exceptions')toolbar.append(field('Exception status',status));container.append(toolbar);
  const resolution=node('section',undefined,'feed-resolution');resolution.hidden=true;container.append(resolution);
  function resolveForm(ex){
    resolution.hidden=false;resolution.replaceChildren(node('h3',short(ex.workId)+' · '+ex.field),node('p',ex.code+' · page '+ex.source.page+', row '+ex.source.row),details('Original field and source',ex));
    const choices=ex.code==='DUPLICATE_CONFLICT'?[['keep-first','Keep first source occurrence']]:ex.code==='MISSING_WORK_ID'?[['exclude','Exclude unidentified source occurrence']]:[['replace','Replace with reviewed value'],['omit','Omit optional field'],['exclude','Exclude this work']];
    if(ex.resolution)choices.push(['clear','Clear saved resolution']);
    const action=select(choices,ex.resolution?.action??choices[0][0]),value=node('textarea'),note=node('textarea');
    value.rows=5;value.value=pretty(ex.resolution?.value??ex.raw.value);note.rows=3;note.value=ex.resolution?.note??'';
    const form=node('form');form.append(field('Decision',action),field('Replacement value as JSON',value),field('Decision note',note));const save=node('button','Save field decision');save.type='submit';
    form.append(save,button('Close review',async()=>resolution.hidden=true));
    form.addEventListener('submit',event=>{event.preventDefault();void perform(async()=>{await api('/api/feeds/resolve',{method:'POST',data:{...context,sourceFingerprint:p.sourceFingerprint,expectedRevision:p.reviewRevision,exceptionId:ex.id,action:action.value,note:note.value,...(action.value==='replace'?{value:JSON.parse(value.value)}:{})}});notice('Saved field decision.');await reload();},save);});
    resolution.append(form);resolution.scrollIntoView({block:'nearest'});
  }
  let page=p.page;
  if(state.view==='compare'){
    const before=select([['','Choose an earlier edition'],...catalog.editions.filter(e=>e.record?.id!==editionId&&(e.query?.entity??'works')==='works').map(e=>[e.record?.id??e.id,e.record?.label??e.label??e.id])],state.beforeId),changes=select(['changed','added','removed','unchanged'],state.comparisonView);
    before.addEventListener('change',()=>{state.beforeId=before.value;state.offset=0;void perform(reload);});changes.addEventListener('change',()=>{state.comparisonView=changes.value;state.offset=0;void perform(reload);});const comparisons=node('div',undefined,'toolbar');comparisons.append(field('Earlier edition',before),field('Changes',changes));container.append(comparisons);
    if(state.beforeId){const q=new URLSearchParams({contract:c.contract.id,revision:c.revision,edition:editionId,before:state.beforeId,view:state.comparisonView,offset:state.offset,limit:50,q:state.q});const comparison=await api('/api/feeds/compare?'+q);if(!active())return;page=comparison.page;container.append(node('p',comparison.summary.added+' added · '+comparison.summary.removed+' removed · '+comparison.summary.changed+' changed · '+comparison.summary.unchanged+' unchanged'),details('Comparison source and coverage',comparison.summary),table(['Work','Change detail'],page.rows.map(r=>[short(r.workId),details('Inspect change',r)])));}
    else page={rows:[],offset:0,total:0,limit:50,hasMore:false};
  }else if(state.view==='records'){
    const visible=c.contract.fields.filter(f=>f.target!==c.contract.identityField).slice(0,5).map(f=>f.target);
    container.append(table(['Work',...visible,'Open exceptions','Mapped record'],page.rows.map(r=>[short(r.workId),...visible.map(key=>{const value=r.data[key];return value===undefined?'Absent':value===null?'null':typeof value==='object'?JSON.stringify(value):String(value);}),r.openExceptions,details('Inspect mapped record',r.data)])));
  }
  else if(state.view==='exceptions')container.append(table(['Work','Field','Exception','State','Source','Review'],page.rows.map(e=>[short(e.workId),e.field,e.code,e.status,'page '+e.source.page+' / row '+e.source.row,button(e.resolution?'Review decision':'Resolve',async()=>resolveForm(e))])));
  else container.append(table(['Work','Reason','Source'],page.rows.map(r=>[short(r.workId),r.reason,details('Source occurrence',r.source)])));
  const pager=node('div',undefined,'pager'),previous=button('Previous',async()=>{state.offset=Math.max(0,state.offset-page.limit);await reload();}),next=button('Next',async()=>{state.offset+=page.limit;await reload();});previous.disabled=page.offset===0;next.disabled=!page.hasMore;pager.append(previous,node('span',page.total?String(page.offset+1)+'–'+Math.min(page.offset+page.limit,page.total)+' of '+page.total:'0 records'),next);container.append(pager);
  container.append(details('Field coverage and identity collisions',{fields:p.fieldStats,doiCollisions:p.doiCollisions}));
  const delivery=node('section'),beforeExport=select([['','Current edition only'],...catalog.editions.filter(e=>(e.record?.id??e.id)!==editionId).map(e=>[e.record?.id??e.id,'Compare with '+(e.record?.label??e.label??e.id)])],state.beforeId);
  delivery.append(node('h3','Freeze delivery'),node('p',p.summary.ready?'The current feed can be frozen with its source, contract and saved decisions.':'Resolve open exceptions and review the contract coverage setting to freeze this feed.'),field('Include comparison',beforeExport));
  const freeze=button('Freeze complete feed',async()=>{const release=await api('/api/feeds/freeze',{method:'POST',data:{...context,sourceFingerprint:p.sourceFingerprint,expectedReviewRevision:p.reviewRevision,...(beforeExport.value?{beforeId:beforeExport.value}:{})}});notice('Frozen '+release.id+' with '+release.summary.outputRecords+' feed records.');await reload();});freeze.disabled=!p.summary.ready;delivery.append(freeze);
  const releases=await api('/api/feeds/releases?'+new URLSearchParams({contract:c.contract.id,edition:editionId}));if(!active())return;
  for(const release of releases.releases){
    const card=node('section',undefined,'feed-release');card.append(node('h4',release.id),node('p',new Date(release.createdAt).toLocaleString()+' · '+release.summary.outputRecords+' records · contract revision '+release.contractRevision));
    const actions=node('div',undefined,'actions'),base='/api/feeds/releases/'+release.id;
    for(const [name,label]of [['feed.jsonl','JSONL'],['feed.csv','CSV'],['report.html','Report'],['manifest.json','Manifest'],['RECEIVING.md','Receiving guide']])actions.append(button(label,async()=>download(base+'/download/'+name,name)));
    actions.append(button('Complete delivery ZIP',async()=>download(base+'/bundle.zip',release.id+'.zip')));card.append(actions);delivery.append(card);
  }container.append(delivery);
}
