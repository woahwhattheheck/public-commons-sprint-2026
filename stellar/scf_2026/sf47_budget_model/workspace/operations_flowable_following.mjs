// SPDX-License-Identifier: MIT
// Following editions use the original Source Desk working journal and native writer.
const clone=x=>structuredClone(x),plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const pretty=x=>JSON.stringify(x,null,2)+'\n';
const TEXT=['priorPreparationId','laterPreparationId','installationId','baseRevision','reviewer','note'];
const blank=()=>({priorPreparationId:'',laterPreparationId:'',installationId:'',baseRevision:'',reviewer:'',note:'',
 inventory:[],history:[],nextBefore:null,head:null,comparison:null,choices:{},prepared:null});
export function validateFlowableFollowingWork(value){
 if(value===undefined||value===null)return;
 if(!plain(value)||TEXT.some(k=>typeof value[k]!=='string')||!Array.isArray(value.inventory)||!Array.isArray(value.history)||
  !plain(value.choices)||Object.values(value.choices).some(x=>!['','KEEP_CURRENT','TAKE_LATER','USE_BASELINE','ACCEPT_LATER_SOURCE'].includes(x))||
  ['head','comparison','prepared'].some(k=>value[k]!==null&&!plain(value[k])))
  throw new Error('Keep the full following source review and unfinished choices in the original working copy.');
}
export function createFlowableFollowingDesk(p){
 const {ctx,w,needEdit,assertLive,command,retainedText,esc,header,table,hint,empty,button,detail,download,touch}=p;
 let epoch=0;
 const state=()=>w().following??(w().following=blank());
 const live=(owner,generation)=>{assertLive(owner);if(epoch!==generation)throw new Error('A different following source selection is active. The earlier read did not change it.');};
 const field=(label,key,value,choices)=>'<label class="'+(key==='note'?'source-desk-wide':'')+'"><span>'+esc(label)+'</span>'+
  (choices?'<select data-flowable-following-field="'+key+'" data-source-edit>'+choices.map(([v,t])=>'<option value="'+esc(v)+'"'+(String(value)===String(v)?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select>':
   key==='note'?'<textarea data-flowable-following-field="'+key+'" data-source-edit rows="5">'+esc(value)+'</textarea>':
   '<input data-flowable-following-field="'+key+'" data-source-edit value="'+esc(value)+'">')+'</label>';
 function invalidate(){state().prepared=null;w().prepared=null;w().preview=null;w().previewBasis=null;w().receivedDraftKey=null;touch();}
 function selectChanged(){epoch++;state().comparison=null;state().choices={};invalidate();}
 function selected(){
  const f=state(),base=f.history.find(x=>x.revision===Number(f.baseRevision));
  if(!f.head||f.head.id!==f.installationId||!base||base.id!==f.installationId)throw new Error('Read the actual current Installation and the selected historical revision first.');
  return{installationId:f.installationId,baseRevision:base.revision,expectedBaseSha256:base.sha256,
   expectedRevision:f.head.revision,expectedInstallationSha256:f.head.sha256};
 }
 function comparison(){const c=state().comparison?.comparison;if(!c)throw new Error('Compare both complete source editions and the original saved Installation first.');return c;}
 async function adopt(original,result,owner){
  assertLive(owner);const f=state();
  if(original.method==='following-compare'){
   const c=result.comparison;if(!c?.basisSha256||!Array.isArray(c.rows))throw new Error('Retain the complete original following comparison.');
   f.priorPreparationId=c.selection.priorPreparationId;f.laterPreparationId=c.selection.laterPreparationId;
   f.installationId=c.selection.installationId;f.baseRevision=String(c.selection.baseRevision);
   f.head=clone(c.native.current);f.comparison=clone(result);f.choices={};f.prepared=null;
   w().prepared=null;w().preview=null;w().previewBasis=null;epoch++;
  }else if(original.method==='following-prepare'){
   const c=result.comparison;if(!c?.basisSha256||!result.following||!result.installation?.document)throw new Error('Retain the whole following preparation and review.');
   const rows=['seed','bindings','commissioning'].map(kind=>{
    const file=result.files.find(x=>x.name==='later/source/'+kind+'.json');
    if(!file)throw new Error('Retain the full later '+kind+' source.');return{kind,file};
   });
   const texts=await Promise.all(rows.map(async x=>({...x,text:await retainedText(x.file,owner)})));assertLive(owner);
   const archive=result.files.find(x=>x.name==='later/source/flowable-workspace.ndjson'&&x.kind==='archive');
   if(!archive)throw new Error('Retain the full later original workspace archive.');
   for(const x of texts){w()[x.kind]=clone(x.file);w()[x.kind+'Text']=x.text;}
   w().archive=clone(archive);w().inspection={requestId:result.inspectionId,source:clone(result.source),files:[]};
   w().programmeChoice=result.source.programme.record.id+'@'+result.source.programme.record.revision;
   w().template={bindings:p.object(w().bindingsText,'Original later bindings'),restoredFrom:result.requestId};w().bindingRaw={};
   w().attachments=(result.source.attachments??[]).map(x=>{
    const file=result.files.find(y=>y.name==='later/'+x.name);if(!file)throw new Error('Keep the complete later attachment.');
    return{file:clone(file),name:x.name.replace(/^attachments\//,''),purpose:x.purpose};
   });
   f.priorPreparationId=c.selection.priorPreparationId;f.laterPreparationId=c.selection.laterPreparationId;
   f.installationId=c.selection.installationId;f.baseRevision=String(c.selection.baseRevision);f.head=clone(c.native.current);
   f.comparison={requestId:result.comparisonId,type:'following-compare',comparison:clone(c),files:[]};
   f.choices=clone(result.review.choices);f.reviewer=result.review.reviewer;f.note=result.review.note;f.prepared=clone(result);
   w().prepared=clone(result);w().preview=null;w().previewBasis=null;w().dirty=false;epoch++;
  }
 }
 function edit(target){
  const key=target.dataset.flowableFollowingField,choice=target.dataset.flowableFollowingChoice;
  if(key===undefined&&choice===undefined)return false;needEdit();const f=state();
  if(choice!==undefined){
   const c=comparison();
   if(choice!=='source-edition'&&!c.rows.some(x=>x.key===choice&&x.changed))throw new Error('Choose a field from the retained comparison.');
   const value=target.type==='checkbox'?(target.checked?'ACCEPT_LATER_SOURCE':''):target.value;
   const allowed=choice==='source-edition'?['','ACCEPT_LATER_SOURCE']:['','KEEP_CURRENT','TAKE_LATER','USE_BASELINE'];
   if(!allowed.includes(value))throw new Error('Choose an explicit original branch.');
   f.choices[choice]=value;invalidate();return true;
  }
  if(!TEXT.includes(key))throw new Error('Keep the original following field.');
  f[key]=target.value;
  if(['reviewer','note'].includes(key))invalidate();
  else{if(key==='installationId'){f.head=null;f.history=[];f.nextBefore=null;}selectChanged();}
  touch();return true;
 }
 async function action(key){
  if(!key.startsWith('following-'))return false;
  const f=state(),owner=w();
  if(key==='following-download'){
   await ctx.persistNow();assertLive(owner);download(pretty(f),'FLOWABLE_FOLLOWING_WORKING.json');return true;
  }
  if(key==='following-comparison-download'){download(pretty(comparison()),'FLOWABLE_FOLLOWING_COMPARISON.json');return true;}
  needEdit();
  if(key==='following-use-prior'||key==='following-use-later'){
   const saved=w().prepared;if(!saved||!['prepare','following-prepare'].includes(saved.type))throw new Error('Open a complete saved preparation first.');
   if(key.endsWith('later')&&saved.type!=='prepare')throw new Error('Prepare the later source through the existing complete input course.');
   f[key.endsWith('prior')?'priorPreparationId':'laterPreparationId']=saved.requestId;selectChanged();return true;
  }
  if(key==='following-inventory'){
   const generation=++epoch,value=await ctx.api('/api/operations/'+ctx.caseId+'/installations');live(owner,generation);
   if(!Array.isArray(value.installations))throw new Error('Keep the full original saved Installation list.');
   f.inventory=clone(value.installations);touch();await ctx.persistNow();return true;
  }
  if(key==='following-history'||key==='following-more'){
   if(!/^installation-[a-f0-9]{32}$/.test(f.installationId))throw new Error('Select the actual saved Installation.');
   const generation=++epoch,base='/api/operations/'+ctx.caseId+'/installations/'+f.installationId;
   const [head,page]=await Promise.all([ctx.api(base),ctx.api(base+'/history?limit=100'+(key.endsWith('more')&&f.nextBefore!==null?'&before='+f.nextBefore:''))]);live(owner,generation);
   if(head.id!==f.installationId||!Array.isArray(page.editions))throw new Error('Keep the original native Installation history.');
   f.head=clone(head);f.history=key.endsWith('more')?[...f.history,...clone(page.editions)]:clone(page.editions);
   f.nextBefore=page.nextBefore??null;f.comparison=null;f.choices={};invalidate();await ctx.persistNow();return true;
  }
  if(key==='following-compare'){
   const selection=selected();if(!f.priorPreparationId||!f.laterPreparationId)throw new Error('Select both complete saved preparation requests.');
   const generation=epoch;await ctx.refreshCase();live(owner,generation);
   await command('following-compare',{priorPreparationId:f.priorPreparationId,laterPreparationId:f.laterPreparationId,
    ...selection,expectedVersion:ctx.context().version});return true;
  }
  if(key==='following-prepare'){
   const c=comparison();
   if(f.choices['source-edition']!=='ACCEPT_LATER_SOURCE'||c.rows.filter(x=>x.changed).some(x=>!['KEEP_CURRENT','TAKE_LATER','USE_BASELINE'].includes(f.choices[x.key])))
    throw new Error('Review the full later source and choose every changed field explicitly.');
   if(!f.reviewer.trim()||!f.note.trim())throw new Error('Record the reviewer and the source/binding decision.');
   const s=c.selection;
   await command('following-prepare',{comparisonId:f.comparison.requestId,basisSha256:c.basisSha256,
    choices:clone(f.choices),reviewer:f.reviewer,note:f.note,
    installationId:s.installationId,baseRevision:s.baseRevision,expectedBaseSha256:s.expectedBaseSha256,
    expectedRevision:s.expectedRevision,expectedInstallationSha256:s.expectedInstallationSha256,expectedVersion:s.expectedVersion});return true;
  }
  throw new Error('Unknown original following source control.');
 }
 function render(){
  const f=state(),c=f.comparison?.comparison,pending=!!w().pending;
  const preparations=[...new Map([...(w().history??[]),...(w().requests??[])].filter(x=>['prepare','following-prepare'].includes(x.type??x.method)&&x.status==='COMPLETE').map(x=>[x.requestId,x])).values()];
  const prepOptions=(current,later=false)=>[['','Choose a complete saved preparation'],...new Set([current,...preparations.filter(x=>!later||(x.type??x.method)==='prepare').map(x=>x.requestId)].filter(Boolean))].map(x=>Array.isArray(x)?x:[x,x]);
  const cell=v=>v.present?detail('Complete value',v.value):'<em>Absent</em>';
  return '<section class="flowable-following">'+header('Following source edition','Retain both complete archives, compare the original saved history, and deliberately update the same Installation.',button('Download following working review','following-download'))+
   hint('Prepare the later workspace and customer bindings above without saving a new Installation. Open the prior preparation from saved requests. Select both here; their full source and native history remain unchanged.')+
   '<div class="source-desk-actions">'+button('Use open preparation as prior','following-use-prior','',!w().prepared||pending)+
   button('Use open preparation as later','following-use-later','',!w().prepared||w().prepared.type!=='prepare'||pending)+
   button('Read saved Installations','following-inventory','',pending)+'</div>'+
   '<div class="source-desk-fields">'+field('Prior complete preparation','priorPreparationId',f.priorPreparationId,prepOptions(f.priorPreparationId))+
   field('Later complete preparation','laterPreparationId',f.laterPreparationId,prepOptions(f.laterPreparationId,true))+
   field('Original saved Installation','installationId',f.installationId,[['','Choose the actual Installation'],...(f.installationId&&!f.inventory.some(x=>x.id===f.installationId)?[[f.installationId,f.installationId+' · selected original']]:[]),...f.inventory.map(x=>[x.id,(x.name||x.id)+' · current revision '+x.revision])])+
   field('Saved revision produced by the prior preparation','baseRevision',f.baseRevision,[['','Choose from retained history'],...(f.baseRevision&&!f.history.some(x=>String(x.revision)===f.baseRevision)?[[f.baseRevision,'Revision '+f.baseRevision+' · selected baseline']]:[]),...f.history.map(x=>[String(x.revision),'Revision '+x.revision+' · case version '+x.version])])+'</div>'+
   '<div class="source-desk-actions">'+button('Read current Installation and historical revisions','following-history','',!f.installationId||pending)+
   (f.nextBefore!==null?button('Read earlier revisions','following-more','',pending):'')+
   button('Compare original, current and later source','following-compare','',!f.head||!f.baseRevision||!f.priorPreparationId||!f.laterPreparationId||pending)+'</div>'+
   (f.head?detail('Complete current saved Installation and original authority',f.head):'')+
   (c?'<p>Comparison <code>'+esc(c.basisSha256)+'</code> · '+c.summary.changed+' changed editable fields · '+c.summary.conflicts+' concurrent differences</p>'+
    detail('Complete previous and later source editions',{prior:c.prior,later:c.later,lineage:c.lineage})+
    '<h5>Every selected source file</h5>'+table(['File','Change','Prior','Later'],c.sourceReview.files.map(x=>[esc(x.key),esc(x.status),x.before?x.before.bytes+' bytes<br><code>'+esc(x.before.sha256)+'</code>':'Absent',x.after?x.after.bytes+' bytes<br><code>'+esc(x.after.sha256)+'</code>':'Absent']))+
    '<h5>Original native operations</h5>'+table(['Programme step','Change','Original operation','Later operation'],c.sourceReview.operations.map(x=>[esc(x.key),esc(x.status),detail('Complete original operation',x.before),detail('Complete later operation',x.after)]))+
    detail('Full original and later programme state',{prior:c.sourceReview.priorProgramme,later:c.sourceReview.laterProgramme})+
    '<label class="source-desk-check"><input type="checkbox" data-flowable-following-choice="source-edition" data-source-edit'+(f.choices['source-edition']==='ACCEPT_LATER_SOURCE'?' checked':'')+'><span>I reviewed the complete later source, native outcomes and missing/changed files for this Installation.</span></label>'+
    '<h5>Explicit Installation field choices</h5>'+table(['Field','Saved baseline','Current saved','Later prepared','Use'],c.rows.filter(x=>x.changed).map(row=>[
     esc(row.label)+(row.conflict?'<br><strong>Concurrent changes</strong>':''),cell(row.baseline),cell(row.current),cell(row.later),
     '<select aria-label="'+esc(row.label)+' branch" data-flowable-following-choice="'+esc(row.key)+'" data-source-edit>'+
      [['','Choose explicitly'],['KEEP_CURRENT','Keep current'],['TAKE_LATER','Use later'],['USE_BASELINE','Use baseline']].map(([v,t])=>'<option value="'+v+'"'+(f.choices[row.key]===v?' selected':'')+'>'+t+'</option>').join('')+'</select>']))+
    detail('Unchanged original editable values',c.rows.filter(x=>!x.changed))+
    '<h5>Current native work and authority remain preserved</h5>'+hint('Existing work, acceptance checks, stage, assignments, Workshare, commercial terms, workflow and effort are not replaced by this source preparation. Use their original workflows for changes.')+
    table(['Protected field','Saved baseline','Current retained','Later supplied'],c.protectedFields.filter(x=>x.changed).map(x=>[esc(x.key),cell(x.baseline),cell(x.current),cell(x.later)]))+
    detail('Complete preserved native fields',c.protectedFields)+
    '<div class="source-desk-fields">'+field('Recorded reviewer','reviewer',f.reviewer)+field('Source and binding decision','note',f.note)+'</div>'+
    '<div class="source-desk-actions">'+button('Download full comparison','following-comparison-download')+
     button('Prepare chosen following edition','following-prepare','',pending)+'</div>'+
    hint('The prepared result opens above. Preview against the current original case, then open the reviewed draft and deliberately Save its next revision into the same Installation ID. A changed case or head requires a new comparison.') :
    empty('No following comparison yet. Current selections and unfinished decisions are retained in this original working copy.'))+'</section>';
 }
 return{render,edit,action,adopt,state,dispose(){epoch++;}};
}
