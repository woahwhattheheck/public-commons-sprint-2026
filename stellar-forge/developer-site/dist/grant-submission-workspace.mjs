import {renderProductSources} from './grant-product-authoring-workspace.mjs';
// MIT. Uses the maintained application source and original shared IndexedDB drafts.
import {SCHEMA,ENVELOPE,MAX_BYTES,ANSWERS,REQUIREMENTS,OFFICIAL,makeSource,createDraft,validateDraft,
  retainVersion,restoreVersion,compareSource,receiveSource,useSourceAnswer,newField,rebuildField,
  outputText,measureText,fieldStatus,applicationOutput,importFormMap,exportFormMap,receivePlanningSource} from './grant-submission-core.mjs';
import {listDrafts,loadDraft,saveDraft} from './drafts.mjs';
import {MAX_PLAN_BYTES,receivePlanningFile,verifyPlanningSource} from './grant-plan-source.mjs';
import {renderPlanning} from './grant-plan-workspace.mjs';
import {readReviewerSource,retainSourceBundle,verifyHandover,createDraftEnvelope,
  openReviewerSourcePackage,createReviewerSourcePackage,reviewerSourceFromDraft,receiveReviewerSource} from './grant-handover-source.mjs';
import {renderHandover} from './grant-handover-workspace.mjs';
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=String(text);if(cls)value.className=cls;return value;};
const uid=()=>crypto.randomUUID();
const titleOf=id=>ANSWERS.find(x=>x[0]===id)?.[1]||id;
let publishedLabel='Current application reader';
let draft=null,published=null,publishedBundle=null,savedId=null,savedRevision=0,dirty=false,busy=false,selectedAnswer='project',selectedField=null,filePurpose='draft';
let currentStats=null,currentPreview=null,currentIssue=null,currentText=null;
let publishedRead=null;
const view=()=>$('view').value,format=()=>$('format').value;
const status=text=>{$('status').textContent=text;};
function fail(error){$('error').textContent=error.message||String(error);$('error').hidden=false;}
function clearError(){$('error').hidden=true;$('error').textContent='';}
async function work(action){
  if(busy)return;busy=true;clearError();$('workspace-root').inert=true;
  try{return await action();}catch(error){fail(error);}
  finally{$('workspace-root').inert=false;busy=false;}
}
function button(label,action,cls=''){const b=node('button',label,cls);b.type='button';b.addEventListener('click',()=>work(action));return b;}
function input(label,value,onChange,{type='text',placeholder='',area=false,className=''}={}){
  const wrap=node('label',undefined,'field'),caption=node('span',label),field=node(area?'textarea':'input',undefined,className);
  if(!area)field.type=type;field.value=value??'';field.placeholder=placeholder;field.autocomplete='off';
  field.addEventListener('input',()=>onChange(field.value));wrap.append(caption,field);return {wrap,field};
}
function select(label,value,options,onChange){
  const wrap=node('label',undefined,'field'),s=node('select');s.setAttribute('aria-label',label);
  for(const [key,text]of options){const option=node('option',text);option.value=key;s.append(option);}
  s.value=value;s.addEventListener('change',()=>onChange(s.value));wrap.append(node('span',label),s);return {wrap,field:s};
}
function link(label,url){const a=node('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function touch(message){dirty=true;if(draft)draft.updatedAt=new Date().toISOString();metadata();updateStats();if(message)status(message);}
function metadata(){
  const root=$('workspace-root');root.dataset.draftId=draft?.id||'';
  root.dataset.savedDraftId=savedId||'';root.dataset.savedDraftRevision=String(savedRevision);root.dataset.draftDirty=String(dirty);
  $('draft-meta').textContent=(savedId?'Browser revision '+savedRevision:'Local working draft')+(dirty?' · unsaved edits':'')+(draft?' · '+draft.versions.length+' retained versions':'');
}
function download(body,name,type='application/json'){
  const url=URL.createObjectURL(new Blob([body],{type})),a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
function filename(){return (draft?.title||'SCF submission').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'scf-submission';}
function hex(buffer){return Array.from(new Uint8Array(buffer),x=>x.toString(16).padStart(2,'0')).join('');}
async function sha(value,algorithm='SHA-256'){
  if(!crypto?.subtle)throw new Error('Open this workspace through its HTTPS or loopback host to read and retain source identities.');
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  return hex(await crypto.subtle.digest(algorithm,bytes));
}
async function verifySource(source){
  const bytes=new TextEncoder().encode(source.markdown),prefix=new TextEncoder().encode('blob '+bytes.length+'\0'),framed=new Uint8Array(prefix.length+bytes.length);
  framed.set(prefix);framed.set(bytes,prefix.length);
  if(bytes.length!==source.bytes||await sha(bytes)!==source.sha256||await sha(framed,'SHA-1')!==source.gitBlob)throw new Error('The complete application does not match its retained source edition. Reopen the original source or draft file.');
}
async function verifyDraft(value){return verifyHandover(value);}
async function envelope(value){return createDraftEnvelope(value);}
async function parseEnvelope(text){
  const value=JSON.parse(text);
  if(value.schema!==ENVELOPE||!value.draft||typeof value.sha256!=='string')throw new Error('Open the complete submission draft export.');
  if(await sha(JSON.stringify(value.draft))!==value.sha256)throw new Error('This draft file differs from its exported content. Reopen the original complete export.');
  return verifyDraft(value.draft);
}
async function boundedRead(url,maximum){
  const response=await fetch(url,{cache:'no-cache',credentials:'same-origin'});
  if(!response.ok)throw new Error('The current application source returned HTTP '+response.status+'. Reopen a retained draft or read the source again.');
  const reader=response.body?.getReader();if(!reader){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>maximum)throw new Error('The selected source exceeds the receiving limit.');return bytes;}
  const parts=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maximum){await reader.cancel();throw new Error('The selected source exceeds the receiving limit.');}parts.push(value);}}
  finally{reader.releaseLock();}
  const body=new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.length;}return body;
}
async function readPublished(signal){
  return readReviewerSource({baseUrl:document.baseURI,
    fetchImpl:(url,options)=>fetch(url,{...options,signal})});
}
function sourceReadControls(){
  const reading=publishedRead!==null;
  $('workspace-root').dataset.sourceReadState=reading?'reading':'idle';
  $('refresh-source').textContent=reading?'Cancel source read':'Read current source';
  $('refresh-source').setAttribute('aria-busy',String(reading));
  for(const element of document.querySelectorAll('[data-source-read-control]')){
    element.textContent=reading?'Cancel source read':'Read current source';
    element.setAttribute('aria-busy',String(reading));
  }
}
function cancelPublishedRead(message=''){
  const active=publishedRead;if(!active)return;
  publishedRead=null;active.controller.abort();sourceReadControls();
  if(message)status(message);
}
function sourceReadButton(){
  const value=node('button','Read current source');value.type='button';
  value.dataset.sourceReadControl='';
  value.addEventListener('click',()=>{
    if(publishedRead)cancelPublishedRead('Source read cancelled. Continue with the selected draft or open a source package.');
    else void refreshSource();
  });
  return value;
}
function retainPublishedBundle(value){
  return publishedBundle&&value.sources.some(source=>source.sha256===publishedBundle.bundle.body.applicationSha256)?
    retainSourceBundle(value,publishedBundle,{select:true}):value;
}

async function preserveWorking(){
  if(!draft||!dirty)return;
  const value=retainVersion(draft,'Before opening another draft');
  try{const record=await saveDraft({id:savedId,revision:savedRevision,input:value});savedId=record.id;savedRevision=record.revision;}
  catch(error){if(error.name!=='DraftConflictError')throw error;await saveDraft({revision:0,input:value});}
  draft=value;dirty=false;
}
async function save(copy=false){
  if(!draft)throw new Error('Open the current source or a complete retained draft first.');
  let value=retainVersion(draft,copy?'Separate working copy':'Saved submission version');
  if(copy){value.id=uid();value.title=draft.title+' copy';value.folder='SCF submission — '+value.title;value.updatedAt=new Date().toISOString();}
  const record=await saveDraft({id:copy?null:savedId,revision:copy?0:savedRevision,input:value});
  draft=record.input;savedId=record.id;savedRevision=record.revision;dirty=false;
  render();status('Saved browser revision '+savedRevision+' with all source editions and '+draft.versions.length+' versions.');
}
function chooseFile(purpose){cancelPublishedRead();filePurpose=purpose;$('file-input').accept=purpose==='plan'?'.json,.zip,application/json,application/zip':'.json,application/json';$('file-input').value='';$('file-input').click();}
async function readFile(file){
  if(!file)throw new Error('Choose a complete JSON file.');
  if(file.size>MAX_BYTES*2+65536)throw new Error('This encoded file exceeds the 32 MiB receiving allowance for a 16 MiB logical draft.');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
}
async function openFile(file){
  if(filePurpose==='plan'){
    if(!draft)throw new Error('Open the application first.');
    if(!file||file.size>MAX_PLAN_BYTES)throw new Error('Choose the complete native plan JSON or planning ZIP, at most 32 MiB.');
    const source=await receivePlanningFile(new Uint8Array(await file.arrayBuffer()),{filename:file.name});
    const next=receivePlanningSource(draft,source);draft=next;$('view').value='planning';touch();render();
    status(draft.planningUpdate?.status==='reviewing'?'Retained the incoming native plan. Review its changes against the current plan, edited answers and issuer fields.':'Received '+source.document.revisions.length+' native plan revisions. Review the complete budget and roadmap before applying the preview.');return;
  }
  const text=await readFile(file);
  if(filePurpose==='source'){
    const incoming=await openReviewerSourcePackage(text);
    const initial=draft?null:retainSourceBundle(createDraft(incoming.source,{id:uid()}),incoming);
    if(initial)await verifyDraft(initial);
    published=incoming.source;publishedBundle={bundle:incoming.bundle,objects:incoming.objects};
    publishedLabel='Source package: '+file.name;
    if(initial){draft=initial;savedId=null;savedRevision=0;dirty=true;}
    $('view').value='source';render();
    status(initial?'Opened all nine answers and four original source files. Save this application to continue.':'Opened the complete source package for comparison. Receive the selected edition to update untouched answers and keep your edits.');return;
  }
  if(filePurpose==='form'){
    if(!draft)throw new Error('Open the application first.');
    draft=importFormMap(draft,JSON.parse(text));selectedField=draft.fields[0]?.id??null;$('view').value='fields';touch();render();status('Received the form mapping and retained the preceding working version.');return;
  }
  const incoming=await parseEnvelope(text);
  await preserveWorking();draft=incoming;savedId=null;savedRevision=0;dirty=true;selectedField=draft.fields[0]?.id??null;
  render();status('Opened the complete draft, including '+draft.sources.length+' source editions and '+draft.versions.length+' versions. Save it in this browser to continue.');
}
async function copy(text){
  try{await navigator.clipboard.writeText(text);status('Copied '+measureText(text).words+' whitespace-counted words.');}
  catch{const box=node('textarea',undefined,'preview');box.value=text;box.readOnly=true;$('editor').prepend(box);box.focus();box.select();status('The complete text is selected. Use the browser copy command.');}
}
function updateStats(){
  if(!currentText||!currentStats)return;const text=outputText(currentText(),format()),counts=measureText(text);
  currentStats.textContent=counts.words.toLocaleString()+' whitespace-counted words · '+counts.characters.toLocaleString()+' Unicode characters · '+counts.utf16.toLocaleString()+' UTF-16 units · '+counts.utf8Bytes.toLocaleString()+' UTF-8 bytes';
  if(currentPreview)currentPreview.value=text;
  if(currentIssue&&view()==='fields'){
    const field=draft.fields.find(x=>x.id===selectedField);
    if(field){const review=fieldStatus(field,draft.form,format());currentIssue.replaceChildren(...review.issues.map(x=>node('p',x)));currentIssue.hidden=!review.issues.length;}
  }
}
function editorTools(getText){
  currentText=getText;const area=node('div'),row=node('div',undefined,'row');
  row.append(button('Copy current answer',()=>copy(outputText(getText(),format()))));
  currentStats=node('div',undefined,'counts');currentPreview=node('textarea',undefined,'preview');currentPreview.readOnly=true;currentPreview.setAttribute('aria-label','Exact text selected for copying');
  const detail=node('details'),summary=node('summary','Preview the exact text to copy');detail.append(summary,currentPreview);
  area.append(row,currentStats,detail);return area;
}
function nav(){
  const root=$('answer-nav');root.replaceChildren();
  if(!draft){$('source-summary').textContent='Open the current application or a retained draft.';return;}
  const src=draft.sources.find(x=>x.sha256===draft.currentSource);
  $('source-summary').replaceChildren(node('strong','Selected source edition'),node('div',src.gitBlob.slice(0,12)),node('div',src.bytes.toLocaleString()+' bytes · '+draft.sources.length+' retained editions'));
  for(const [id,title]of ANSWERS){
    const answer=draft.answers.find(x=>x.id===id),b=button(title,()=>{$('view').value='answers';selectedAnswer=id;render();$('editor').focus();},'nav-answer');
    b.dataset.grantAnswerId=id;b.setAttribute('aria-current',String(view()==='answers'&&selectedAnswer===id));
    b.append(node('span',measureText(outputText(answer.text,format())).words+' words'+(answer.text!==answer.baseText?' · edited':'')));root.append(b);
  }
  const planButton=button('Planning edition',()=>{$('view').value='planning';render();},'nav-answer');
  planButton.setAttribute('aria-current',String(view()==='planning'));
  planButton.append(node('span',(draft.planSources?.length||0)+' retained native planning files'));root.append(planButton);
  const productButton=button('Product sources',()=>{$('view').value='products';render();},'nav-answer');
  productButton.setAttribute('aria-current',String(view()==='products'));
  productButton.append(node('span',(draft.productSourceAuthoring?.selection.registrations.length||0)+' working declarations'));root.append(productButton);
  const handoverButton=button('Submission handover',()=>{$('view').value='handover';render();},'nav-answer');
  handoverButton.setAttribute('aria-current',String(view()==='handover'));
  handoverButton.append(node('span',(draft.handover?.editions.length||0)+' prepared editions · '+(draft.handover?.returns.length||0)+' observations'));root.append(handoverButton);
  if(draft.fields.length){root.append(node('h3','Form fields'));for(const field of draft.fields){
    const b=button(field.label||'Unlabeled field',()=>{$('view').value='fields';selectedField=field.id;render();},'nav-answer');
    b.dataset.grantFieldId=field.id;b.setAttribute('aria-current',String(view()==='fields'&&selectedField===field.id));root.append(b);
  }}
}
function answerView(root){
  const answer=draft.answers.find(x=>x.id===selectedAnswer);
  root.append(node('h2',titleOf(answer.id)),node('p','Edit this draft while the complete original source remains available in Source editions.','muted'));
  const edit=input('Draft answer',answer.text,value=>{answer.text=value;touch();},{area:true,className:'answer-input'});
  root.append(edit.wrap,editorTools(()=>answer.text));
  const note=input('Working note',answer.note,value=>{answer.note=value;touch();},{area:true});
  root.append(note.wrap,node('p','Working notes travel with the full draft. The answer copy and text export contain the selected answer text.','muted'));
  root.append(button('Create a form field from this answer',()=>{
    const field=newField(uid(),[answer.id],draft);draft.fields.push(field);selectedField=field.id;$('view').value='fields';touch();render();
  }));
}
function formProfile(root){
  const details=node('details'),summary=node('summary','Issuer form and source');details.append(summary);
  const grid=node('div',undefined,'grid');
  for(const [key,label,placeholder]of [['name','Issuer form name','Copy the name shown by the issuer'],['url','Issuer form URL','https://…'],['observedAt','Observed on','YYYY-MM-DD or a timestamp'],['notes','Form instructions and context','Keep the issuer wording or an exact source note']]){
    const item=input(label,draft.form[key],value=>{draft.form[key]=value;touch();},{placeholder,area:key==='notes'});grid.append(item.wrap);
  }
  details.append(grid,node('p','Record the actual issuer labels, prompts and limits. Keep a missing limit empty. The canonical answer headings are the manuscript structure.','muted'));
  const row=node('div',undefined,'row');
  row.append(button('Open recorded issuer form',()=>{const url=new URL(draft.form.url);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Complete the issuer HTTPS form URL.');window.open(url.href,'_blank','noopener,noreferrer');}),button('Open form map',()=>chooseFile('form')),button('Download form map',()=>download(JSON.stringify(exportFormMap(draft),null,2)+'\n',filename()+'-form-map.json')));
  details.append(row);root.append(details);
}
function fieldView(root){
  root.append(node('h2','Issuer form fields'));formProfile(root);
  root.append(button('Add field',()=>{const field=newField(uid());draft.fields.push(field);selectedField=field.id;touch();render();}));
  if(!draft.fields.length){root.append(node('p','Add fields from the actual form, or begin with an answer using the answer editor. Several canonical answers can be combined into one form field.','empty'));return;}
  const field=draft.fields.find(x=>x.id===selectedField)||draft.fields[0];selectedField=field.id;
  const heading=node('div',undefined,'row spread');heading.append(node('h3',field.label||'New form field'));
  const order=node('div',undefined,'row'),move=step=>{
    const from=draft.fields.findIndex(x=>x.id===field.id),to=from+step;if(to<0||to>=draft.fields.length)return;
    draft=retainVersion(draft,'Before reordering form fields');const row=draft.fields.splice(from,1)[0];draft.fields.splice(to,0,row);touch();render();
  };
  order.append(button('Move up',()=>move(-1)),button('Move down',()=>move(1)),button('Remove field',()=>{
    draft=retainVersion(draft,'Before removing form field '+(field.label||field.id));draft.fields=draft.fields.filter(x=>x.id!==field.id);selectedField=draft.fields[0]?.id??null;touch();render();
  }));heading.append(order);root.append(heading);
  const grid=node('div',undefined,'grid');
  grid.append(input('Exact issuer field label',field.label,value=>{field.label=value;touch();},{placeholder:'Copy the field label from the form'}).wrap,
    input('Field source URL, if different',field.sourceUrl,value=>{field.sourceUrl=value;touch();},{placeholder:draft.form.url||'https://…'}).wrap);
  root.append(grid,input('Exact issuer prompt and instructions',field.prompt,value=>{field.prompt=value;touch();},{area:true}).wrap);
  const choices=node('details'),summary=node('summary','Source answers for this field'),checks=node('div',undefined,'check-list');
  for(const [id,title]of ANSWERS){
    const label=node('label',undefined,'check-row'),checkbox=node('input');checkbox.type='checkbox';checkbox.checked=field.answerIds.includes(id);
    checkbox.addEventListener('change',()=>{field.answerIds=ANSWERS.map(x=>x[0]).filter(x=>x===id?checkbox.checked:field.answerIds.includes(x));touch();});
    label.append(checkbox,node('span',title));checks.append(label);
  }
  choices.append(summary,checks,node('p','Refreshing explicitly replaces this field text with the selected current draft answers. The preceding version stays in Saved versions.','muted'),button('Refresh text from selected answers',()=>{draft=rebuildField(draft,field.id);touch();render();}));root.append(choices);
  root.append(input('Complete field answer',field.text,value=>{field.text=value;touch();},{area:true,className:'answer-input'}).wrap);
  const limits=node('div',undefined,'grid');
  limits.append(input('Issuer word limit',field.wordLimit,value=>{field.wordLimit=value===''?null:Number(value);touch();},{type:'number',placeholder:'Not supplied'}).wrap,
    input('Issuer character limit',field.characterLimit,value=>{field.characterLimit=value===''?null:Number(value);touch();},{type:'number',placeholder:'Not supplied'}).wrap,
    select('Issuer character-count convention',field.characterMethod,[['unspecified','Not specified by issuer'],['characters','Unicode code points'],['utf16','UTF-16 units'],['utf8Bytes','UTF-8 bytes']],value=>{field.characterMethod=value;touch();}).wrap,
    input('Field observed on, if different',field.observedAt,value=>{field.observedAt=value;touch();},{placeholder:draft.form.observedAt||'YYYY-MM-DD or timestamp'}).wrap);
  root.append(limits,editorTools(()=>field.text));currentIssue=node('div',undefined,'issues');root.append(currentIssue);
  root.append(node('p','The counts describe the selected copy format. Word counts use whitespace. Match the form’s own counting rule when recording and checking a limit.','muted'));
}
function reviewView(root){
  root.append(node('h2','Required content'),node('p','Use the issuer criteria to review the complete answers. Each status and note is your saved editorial decision.'));
  const refs=node('div',undefined,'row');refs.append(link('Submission criteria',OFFICIAL.criteria),link('Budget guidance',OFFICIAL.budget),link('Official rules',OFFICIAL.rules));root.append(refs,node('p','Requirements source reviewed '+OFFICIAL.reviewedAt+'. The current application selects Open Track. Record any applicable issuer-specific condition in the corresponding answer.','muted'));
  for(const rule of REQUIREMENTS){
    const review=draft.reviews.find(x=>x.id===rule.id),card=node('section',undefined,'card');card.append(node('h3',rule.title),node('p',rule.detail));
    card.append(select('Your review',review.status,[['unreviewed','To review'],['covered','Covered in the answers'],['needs-edit','Answer needs editing'],['not-applicable','Not applicable to this application']],value=>{review.status=value;touch();}).wrap);
    const row=node('div',undefined,'choice-list');
    for(const id of review.answers)row.append(button(titleOf(id),()=>{$('view').value='answers';selectedAnswer=id;render();}));
    card.append(row,input('Review note and location of the supporting content',review.note,value=>{review.note=value;touch();},{area:true}).wrap);root.append(card);
  }
}
function reviewerFiles(bundle){
  const list=node('ul',undefined,'source-files');
  for(const file of bundle.body.files)list.append(node('li',file.originalName+' · '+file.bytes.toLocaleString()+' bytes'));
  return list;
}
function sourceView(root){
  root.append(node('h2','Source editions'),node('p','The full source text stays with its edition. Receiving another edition updates untouched answers and preserves edited answers against their original baselines. A source package carries all four reviewer files for comparison and receiving.'));
  root.append(button('Open source package',()=>chooseFile('source')),button('Author product sources',()=>{$('view').value='products';render();}));
  if(published){
    const card=node('section',undefined,'card');card.dataset.reviewerSourceBundleId=publishedBundle?.bundle.id||'';
    card.append(node('h3',publishedLabel),node('p',published.url,'code'),node('p',published.gitBlob,'code'),node('p',published.receivedAt,'muted'));
    if(publishedBundle)card.append(reviewerFiles(publishedBundle.bundle),button('Download source package',async()=>{
      download(await createReviewerSourcePackage({source:published,...publishedBundle}),'scf-reviewer-source-'+publishedBundle.bundle.id.slice(0,12)+'.json');
      status('Downloaded the complete application, source index, budget and companion.');
    }));
    if(published.sha256!==draft.currentSource)card.append(button('Receive source and keep edited answers',async()=>{
      draft=publishedBundle?await receiveReviewerSource(draft,{source:published,...publishedBundle}):receiveSource(draft,published);
      touch();render();status('Received the selected source. Edited answers, issuer fields, native planning and the preceding version remain available.');
    },'primary'));
    else {
      card.append(node('p','The selected answer source matches this edition.','muted'));
      if(publishedBundle&&draft.handover?.selection.bundleId!==publishedBundle.bundle.id)
        card.append(button('Use these four reviewer files',async()=>{
          draft=await receiveReviewerSource(draft,{source:published,...publishedBundle});touch();render();
          status('Selected the complete reviewer bundle and retained the previous working version.');
        }));
    }
    root.append(card);
    for(const change of compareSource(draft,published)){
      if(!change.sourceChanged&&!change.edited)continue;
      const detail=node('details'),summary=node('summary',change.title+' · '+(change.sourceChanged?(change.edited?'source and draft changed':'new source text'):'draft edited'));
      detail.append(summary,node('h4','Draft answer'),node('pre',change.draftText,'source-text'),node('h4','Original baseline'),node('pre',change.baseText,'source-text'),node('h4','Incoming source answer'),node('pre',change.text,'source-text'),
        button('Use current source for this answer',()=>{draft=retainPublishedBundle(useSourceAnswer(draft,change.id,published));touch();render();status('Selected the current source answer and retained the preceding full version.');}));
      root.append(detail);
    }
  }else root.append(sourceReadButton());
  for(const source of draft.sources){
    const details=node('details');details.append(node('summary','Retained source '+source.gitBlob.slice(0,12)+(source.sha256===draft.currentSource?' · selected':'')),
      node('p',source.url,'code'),node('p','SHA-256 '+source.sha256,'code'),node('p',source.bytes+' bytes · received '+source.receivedAt,'muted'),
      button('Download complete original source',()=>download(source.markdown,'scf-source-'+source.gitBlob.slice(0,12)+'.md','text/markdown;charset=utf-8')),node('pre',source.markdown,'source-text'));
    for(const bundle of (draft.handover?.bundles||[]).filter(row=>row.body.applicationSha256===source.sha256)){
      const files=node('section',undefined,'card');files.dataset.reviewerSourceBundleId=bundle.id;
      files.append(node('h3','Complete reviewer source '+bundle.id.slice(0,12)),node('p',bundle.body.receivedAt,'muted'),reviewerFiles(bundle));
      files.append(button('Review these source files',async()=>{
        const incoming=await reviewerSourceFromDraft(draft,bundle.id);
        published=incoming.source;publishedBundle={bundle:incoming.bundle,objects:incoming.objects};publishedLabel='Retained reviewer source';
        render();status('Opened the retained four-file edition for comparison.');
      }),button('Download retained source package',async()=>{
        download(await createReviewerSourcePackage(await reviewerSourceFromDraft(draft,bundle.id)),'scf-reviewer-source-'+bundle.id.slice(0,12)+'.json');
        status('Downloaded the selected four-file reviewer source edition.');
      }));
      details.append(files);
    }
    root.append(details);
  }
}
function planningView(root){
  renderPlanning(root,{node,button,input,select,link,touch,render,work,download,copy,uid,chooseFile,status,format,editorTools,
    getDraft:()=>draft,setDraft:value=>{draft=value;},
    showAnswer:id=>{selectedAnswer=id;$('view').value='answers';render();},
    showField:id=>{selectedField=id;$('view').value='fields';render();}});
}
function productSourcesView(root){
  renderProductSources(root,{node,button,input,select,link,touch,render,work,download,uid,status,retainVersion,
    getDraft:()=>draft,setDraft:value=>{draft=value;},save:()=>save(false),openFull:()=>chooseFile('draft'),
    showSource:()=>{$('view').value='source';render();},
    showSaved:()=>{$('view').value='saved';render();},
    showHistory:()=>{$('view').value='history';render();},
    exportFull:async()=>{download(await envelope(draft),filename()+'-product-author-project.json');
      status('Downloaded the complete application, original reviewer files, product declarations, imported source files and saved authoring versions.');}
  }).catch(fail);
}
function handoverView(root){
  renderHandover(root,{getDraft:()=>draft,setDraft:value=>{draft=value;},touch,work,render,status,download,copy,
    save:()=>save(false),openFull:()=>chooseFile('draft'),
    exportFull:async()=>{download(await envelope(draft),filename()+'-complete-draft.json');status('Downloaded the complete editable draft with every retained original file, version, prepared edition and observation.');}});
}
function historyView(root){
  root.append(node('h2','Saved versions'),node('p','Each version retains the complete working answers, issuer mapping, product declarations and review notes. Restoring one also keeps the current work as a preceding version.'));
  if(!draft.versions.length){root.append(node('p','Save a version to retain this working state.','empty'));return;}
  for(const version of [...draft.versions].reverse()){
    const card=node('article',undefined,'card');card.append(node('h3',version.label),node('p',version.savedAt+' · '+version.answers.length+' answers · '+version.fields.length+' form fields'+(version.productSourceSelection?' · '+version.productSourceSelection.registrations.length+' product declarations':''),'muted'),node('p',version.id,'code'),
      button('Restore this version',()=>{draft=restoreVersion(draft,version.id);touch();render();status('Restored the selected version and retained the previous working state.');}));
    root.append(card);
  }
}
async function savedView(root){
  root.append(node('h2','Browser drafts'),node('p','These records use the existing Stellar Forge draft store. A newer save in another tab is preserved by its original revision check.'));
  const cards=node('div');root.append(cards);
  try{
    const records=(await listDrafts()).filter(x=>x.name?.startsWith('SCF submission — '));
    if(!records.length)cards.append(node('p','No SCF submission drafts are saved in this browser yet.','empty'));
    for(const record of records){
      const card=node('article',undefined,'card');card.dataset.savedDraftId=record.id;card.append(node('h3',record.name),node('p','Revision '+record.revision+' · '+record.updatedAt,'muted'),
        button('Open this draft',async()=>{await preserveWorking();const current=await loadDraft(record.id);if(!current)throw new Error('This draft is no longer in the browser store.');await verifyDraft(current.input);draft=current.input;savedId=current.id;savedRevision=current.revision;dirty=false;$('view').value='answers';render();status('Opened browser revision '+savedRevision+' and all retained versions.');}));
      cards.append(card);
    }
  }catch(error){cards.append(node('p',error.message,'issues'));}
}
function render(){
  currentStats=currentPreview=currentIssue=currentText=null;metadata();nav();
  const root=$('editor');root.replaceChildren();root.classList.toggle('grant-handover',view()==='handover');
  root.classList.toggle('product-authoring',view()==='products');
  delete root.dataset.productSourceAuthoring;delete root.dataset.productSourceBundleId;
  if(!draft){root.append(node('h2','Open a retained application'),node('p','Read the current source, open a complete draft JSON, or select a saved browser draft.'),button('Open source package',()=>chooseFile('source')));
    if(view()==='saved')savedView(root);return;}
  $('draft-title').value=draft.title;
  $('copy-all').textContent=view()==='fields'?'Copy all form fields':'Copy all answers';
  ({answers:answerView,fields:fieldView,review:reviewView,source:sourceView,planning:planningView,products:productSourcesView,handover:handoverView,history:historyView,saved:savedView}[view()]||answerView)(root);updateStats();sourceReadControls();
}
async function refreshSource({initial=false}={}){
  cancelPublishedRead();
  const request={controller:new AbortController(),view:view(),draft,savedId,savedRevision};
  publishedRead=request;sourceReadControls();clearError();
  status('Reading the current application. Saved drafts and source packages remain available.');
  try{
    const received=await readPublished(request.controller.signal);
    if(publishedRead!==request)return;
    const sameSelection=draft===request.draft&&savedId===request.savedId&&
      savedRevision===request.savedRevision;
    published=received.source;publishedBundle={bundle:received.bundle,objects:received.objects};
    publishedLabel='Current application reader';
    if(!draft){draft=retainPublishedBundle(createDraft(published,{id:uid()}));dirty=false;}
    // A read started for another open draft may still supply a comparison,
    // but it cannot navigate the subsequently selected working application.
    if(!initial&&sameSelection&&view()===request.view)$('view').value='source';
    render();status('Read the current application edition. Compare its complete source before receiving it.');
  }catch(error){
    if(publishedRead===request&&error.name!=='AbortError')fail(error);
  }finally{
    if(publishedRead===request){publishedRead=null;sourceReadControls();}
  }
}
function printPacket(){
  if(!draft)return;const root=$('print-packet');root.replaceChildren(node('h1',draft.title));
  const src=draft.sources.find(x=>x.sha256===draft.currentSource);
  root.append(node('p','Source '+src.gitBlob+' · '+new Date().toISOString(),'print-meta'));
  const items=view()==='fields'?draft.fields.map(x=>({title:x.label||'Unlabeled form field',text:x.text})):draft.answers.map(x=>({title:titleOf(x.id),text:x.text}));
  for(const item of items)root.append(node('h2',item.title),node('pre',outputText(item.text,format()),'print-answer'));
}
$('draft-title').addEventListener('input',()=>{if(draft){draft.title=$('draft-title').value;draft.folder='SCF submission — '+draft.title;touch();}});
$('view').addEventListener('change',render);$('format').addEventListener('change',()=>{nav();updateStats();});
$('save').addEventListener('click',()=>work(()=>save(false)));$('save-copy').addEventListener('click',()=>work(()=>save(true)));
$('export-draft').addEventListener('click',()=>work(async()=>{if(!draft)throw new Error('Open a source or draft first.');download(await envelope(draft),filename()+'-complete-draft.json');status('Downloaded the complete draft with source files, native plans, product declarations, field mapping, saved versions, prepared editions and observations.');}));
$('import-draft').addEventListener('click',()=>chooseFile('draft'));
$('file-input').addEventListener('change',()=>work(()=>openFile($('file-input').files[0])));
$('refresh-source').addEventListener('click',()=>{
  if(publishedRead)cancelPublishedRead('Source read cancelled. Continue with the selected draft or open a source package.');
  else void refreshSource();
});
$('copy-all').addEventListener('click',()=>work(()=>copy(applicationOutput(draft,{format:format(),useFields:view()==='fields'}))));
$('export-answers').addEventListener('click',()=>work(()=>{const body=applicationOutput(draft,{format:format(),useFields:view()==='fields'});download(body,filename()+(view()==='fields'?'-form-fields':'-answers')+(format()==='markdown'?'.md':'.txt'),format()==='markdown'?'text/markdown;charset=utf-8':'text/plain;charset=utf-8');status('Downloaded the complete selected answer text.');}));
$('print').addEventListener('click',()=>{printPacket();window.print();});
window.addEventListener('beforeprint',printPacket);
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
render();
void refreshSource({initial:true});
