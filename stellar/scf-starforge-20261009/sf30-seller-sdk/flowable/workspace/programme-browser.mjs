// MIT. Commissioning programme controls in the original industrial Flowable browser.
export function installProgrammeBrowser({api,write,busy,button,node,pre,keyValues,table,originalLink,notice,reload,openRecord,
 requireEngine,records,forEngine,detail}){
 const root=document.querySelector('[data-panel="programmes"]');
 const list=root.querySelector('#programme-records'),content=root.querySelector('#programme-current');
 let selected=null,current=null;
 const refresh=async()=>{await reload();};
 function operationButton(row){
  if(row.record)return button('Review native operation',()=>openRecord(row.record.kind,row.record.id));
  if(row.selected)return button('Resume saved preparation',async()=>{
   const result=await write('prepareProgrammeStep',row.selected.command);
   await refresh();await openRecord(result.operation.kind,result.operation.id);
  });
  return node('span','Waiting');
 }
 async function prepare(row,renew=false){
  const args=row.selected&&!row.record?row.selected.command:{
   id:current.record.id,expectedRevision:current.record.revision,stepKey:row.key,...(renew?{renew:true}:{})};
  const result=await write('prepareProgrammeStep',args);await refresh();
  await openRecord(result.operation.kind,result.operation.id);
 }
 async function open(id){
  selected=id;current=await api('readProgramme',{id});content.replaceChildren();
  const value=current,progress=value.progress;
  content.append(node('h2',value.label),keyValues([
   ['Programme',value.programmeKey],['Progress',progress.confirmed+' of '+progress.total+' native steps confirmed'],
   ['State',progress.state],['Saved revision',value.record.revision],
   ['Review',value.review?(value.review.decision+(value.review.current?'':' · source outcome changed')):'Awaiting review']]));
  if(value.note)content.append(node('p',value.note));
  const toolbar=node('div',null,{class:'toolbar'});
  toolbar.append(button('Refresh programme',refresh),
   originalLink(value.source,'Download complete programme',value.programmeKey+'.json'),
   button('Export complete workspace',async()=>{
    const result=await write('exportWorkspace',{label:value.label+' · complete programme handover'});
    await reload();await openRecord(result.kind,result.id);
   }));
  content.append(toolbar);
  const steps=node('div');content.append(steps);
  table(steps,[
   {label:'Step',render:row=>value.programme.steps.find(x=>x.key===row.key).label},
   {label:'Native action',render:row=>value.programme.steps.find(x=>x.key===row.key).selection.action},
   {label:'State',key:'state'},
   {label:'Dependencies',render:row=>row.waitingFor.length?row.waitingFor.join(', '):'Ready'},
   {label:'Operation',render:operationButton},
   {label:'Preparation',render:row=>row.ready?button(row.selected?'Prepare current review':'Prepare step',()=>prepare(row,Boolean(row.selected))):
    row.selected&&!row.record?button('Resume preparation',()=>prepare(row)):
    node('span',row.record?.dispatchedAt?'Use original operation review':'—')},
  ],progress.rows,{pageSize:30});
  const originals=node('details');originals.append(node('summary','Complete selected sources and operation plan'));
  for(const source of value.sources)originals.append(node('p',null),originalLink(source.reference,source.name,source.name.split('/').at(-1)));
  // The complete JSON remains available as its original source; the on-screen plan excludes base64 members.
  originals.append(pre({...value.programme,sources:value.programme.sources.map(({contentBase64,...item})=>item)}));
  content.append(originals);
  const review=node('form',null,{class:'panel'});
  review.append(node('h3','Record commissioning review'));
  const reviewer=node('input',null,{name:'reviewer',maxlength:'300',required:'',placeholder:'Reviewing operator'});
  const decision=node('select',null,{name:'decision'});
  decision.append(node('option','Request changes',{value:'changes-requested'}),node('option','Accept completed programme',{value:'accepted'}));
  const note=node('textarea',null,{name:'note',rows:'4',maxlength:'20000',required:'',placeholder:'Record the observed result and the customer handover decision.'});
  for(const[label,element]of [['Reviewer',reviewer],['Decision',decision],['Review note',note]]){
   const wrapper=node('label',label);wrapper.append(element);review.append(wrapper);
  }
  review.append(node('button','Save review',{type:'submit'}));
  review.addEventListener('submit',event=>{event.preventDefault();busy('Save programme review',async()=>{
   await write('reviewProgramme',{id:value.record.id,expectedRevision:value.record.revision,basisSha256:value.basisSha256,
    reviewer:reviewer.value,decision:decision.value,note:note.value});await refresh();notice('The commissioning review is saved with its selected native outcomes.');
  });});content.append(review);
  if(value.reviewHistory.length){
   const history=node('details');history.append(node('summary','Retained review history'),pre(value.reviewHistory));content.append(history);
  }
 }
 async function render(){
  table(list,[{label:'Programme',key:'label'},{label:'Saved state',key:'state'},
   {label:'Steps',render:item=>item.summary?.steps??'—'},
   {label:'Open',render:item=>button('Open programme',()=>open(item.id))}],forEngine(records('programme')),
   {empty:'Receive a complete programme to coordinate its original native operations.'});
  if(selected)await open(selected);
 }
 root.querySelector('#programme-import').addEventListener('submit',event=>{
  event.preventDefault();busy('Receive commissioning programme',async()=>{
   const file=event.target.elements.programme.files[0];if(!file)throw new Error('Select the complete programme JSON.');
   if(file.size>16*1024*1024)throw new Error('The complete programme JSON must be at most 16 MiB.');
   const result=await write('saveProgramme',{connectionId:requireEngine(),programmeText:await file.text()});
   await reload();await open(result.id);notice('The complete programme and original sources are saved.');
  });
 });
 return{render,open};
}
