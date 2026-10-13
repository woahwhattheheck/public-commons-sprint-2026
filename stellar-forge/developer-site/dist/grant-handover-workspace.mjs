import {renderIssuerProgrammes} from './grant-issuer-workspace.mjs';
// MIT. Handover controls for the original submission editor and draft store.
import {ANSWERS,REQUIREMENTS,MAX_BYTES,retainVersion,formSourceReview} from './grant-submission-core.mjs';
import {emptyHandover,emptySelection,handoverOf,EVIDENCE_KINDS,RETURN_KINDS,canonical,editionFileDescriptors} from './grant-handover-core.mjs';
import {
  fileBytes,stageOriginal,retainEvidence,prepareSubmission,recordIssuerReturn,
  comparePrepared,sourceReferences,originalDownload,preparedReport,verifyHandover,
} from './grant-handover-source.mjs';

const node=(tag,text,cls)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=String(text);if(cls)element.className=cls;return element;};
const clone=value=>JSON.parse(JSON.stringify(value));
const labelOf=value=>value.replaceAll('-',' ');
const kindLabel={source:'Cited original source','review-export':'Original colleague review export','operated-result':'Original operated result','issuer-instructions':'Original issuer instructions',other:'Other original evidence'};
const returnLabel={'submission-observation':'Operator observation of submission','issuer-acknowledgement':'Original issuer acknowledgement','issuer-message':'Original issuer message','operator-note':'Operator note'};
function valueLabel(value,options){return options.find(row=>row[0]===value)?.[1]||value;}
function table(heads,rows) {
  const result=node('table'),head=node('thead'),heading=node('tr'),body=node('tbody');
  for(const title of heads)heading.append(node('th',title));head.append(heading);
  for(const row of rows){const item=node('tr');for(const value of row){const cell=node('td');cell.append(value instanceof Node?value:node('span',value??''));item.append(cell);}body.append(item);}
  result.append(head,body);return result;
}
function details(title,...children){const result=node('details');result.append(node('summary',title),...children);return result;}
function textField(label,value,change,{area=false,placeholder=''}={}) {
  const wrap=node('label',undefined,'field'),field=node(area?'textarea':'input');
  if(!area)field.type='text';else field.rows=4;
  field.setAttribute('aria-label',label);field.value=value??'';field.autocomplete='off';field.placeholder=placeholder;
  field.addEventListener('input',()=>change(field.value));wrap.append(node('span',label),field);return wrap;
}
function selectField(label,value,choices,change) {
  const wrap=node('label',undefined,'field'),field=node('select');field.setAttribute('aria-label',label);
  for(const [id,text]of choices){const option=node('option',text);option.value=id;field.append(option);}
  field.value=value??'';field.addEventListener('change',()=>change(field.value));wrap.append(node('span',label),field);return wrap;
}
function checkbox(label,checked,change) {
  const wrap=node('label',undefined,'handover-check'),field=node('input');field.type='checkbox';field.checked=checked;
  field.addEventListener('change',()=>change(field.checked));wrap.append(field,node('span',label));return wrap;
}
function sourceLink(value) {
  if(typeof value!=='string'||!/^https:\/\//i.test(value))return node('span',value||'Not entered');
  const anchor=node('a',value);anchor.href=value;anchor.target='_blank';anchor.rel='noopener noreferrer';return anchor;
}
export function renderHandover(root,context) {
  const {getDraft,setDraft,touch,work,render,status,download,copy,exportFull,openFull,save}=context;
  const current=()=>getDraft();
  const selection=()=>{const draft=current();draft.handover ||=emptyHandover();return draft.handover.selection;};
  const edit=change=>{change(selection());touch();};
  const replace=(draft,message)=>{setDraft(draft);touch();render();if(message)status(message);};
  const button=(title,action,cls='')=>{const result=node('button',title,cls);result.type='button';result.addEventListener('click',()=>work(action));return result;};
  const originalButton=(draft,file,title='Download original file')=>button(title,()=>{
    const original=originalDownload(current(),file);download(original.bytes,original.name,original.mediaType);
    status('Downloaded the complete retained original: '+file.originalName+'.');
  });
  const takeFile=forReturn=>{
    const wrap=node('label',undefined,'field'),input=node('input');input.type='file';input.dataset.handoverFile=forReturn?'return':'evidence';
    wrap.append(node('span',forReturn?'Complete original returned file':'Complete original evidence file'),input);
    input.addEventListener('change',()=>work(async()=>{
      const file=input.files?.[0];if(!file)return;
      if(file.size>MAX_BYTES)throw new Error('The original file exceeds the existing 16 MiB complete-draft budget. Keep the current draft open and choose a supported original file.');
      const result=await stageOriginal(current(),new Uint8Array(await file.arrayBuffer()),{
        name:file.name,mediaType:file.type||'application/octet-stream',forReturn,
      });
      replace(result,'Retained the complete original bytes in this working draft. Record its description to include it in the handover.');
    }));
    return wrap;
  };
  const fileCard=file=>{
    const wrap=node('div',undefined,'card');
    if(!file){wrap.append(node('p','No file selected.','muted'));return wrap;}
    wrap.append(node('p',file.originalName),node('p',file.bytes+' bytes · '+file.mediaType,'muted'),
      node('p','SHA-256 '+file.sha256,'code'),originalButton(current(),file));
    return wrap;
  };
  const selectReturnEdition=id=>{
    let draft=current();const input=handoverOf(draft).selection.returnDraft;
    if(input.editionId===id)return;
    const hasWork=input.file||input.note||input.reference||input.sourceUrl||input.observedAt||input.supersedes;
    if(hasWork)draft=retainVersion(draft,'Before changing the issuer-observation edition');
    else draft=clone(draft);
    draft.handover ||=emptyHandover();
    draft.handover.selection.returnDraft={...emptySelection().returnDraft,editionId:id||null};
    replace(draft,hasWork?'Selected the prepared edition. The previous unfinished observation remains in the saved version.':'Selected the prepared edition for the observation.');
  };

  const draft=current(),value=handoverOf(draft),chosen=value.selection;
  root.classList.add('grant-handover');
  root.append(node('h2','Submission handover'),
    node('p','Keep the exact reviewer source, selected evidence and prepared output together. Attach an actual issuer reply or operator observation to that edition, then compare later edits while preserving the original.'),
    node('p',value.bundles.length+' source bundles · '+value.evidence.length+' evidence files · '+value.editions.length+' prepared editions · '+value.returns.length+' observations','muted'));
  const actions=node('div',undefined,'toolbar-row');
  actions.append(button('Save version',save),button('Download whole editable draft',exportFull),button('Open whole draft',openFull));
  root.append(actions);
  renderIssuerProgrammes(root,context);

  const sources=node('section',undefined,'card');sources.append(node('h3','Original reviewer files'),
    node('p','The original application, source index, budget and product-and-finance companion stay together. File digests identify received bytes; each descriptor says which identities were declared by the original index.'));
  if(!value.bundles.length)sources.append(node('p','This older draft retains the original application text. Its companion files have not been received. Read the current source, compare it, and receive a matching edition through Source editions.','muted'));
  const bundleChoices=[['','No particular current bundle selected'],...value.bundles.map(row=>[row.id,
    row.body.applicationSha256.slice(0,12)+' · received '+row.body.receivedAt])];
  sources.append(selectField('Current reviewer bundle',chosen.bundleId||'',bundleChoices,id=>edit(s=>{s.bundleId=id||null;})));
  for(const bundle of [...value.bundles].reverse()) {
    const list=table(['Original role','File','Identity'],bundle.body.files.map(file=>[
      labelOf(file.role),originalButton(draft,file,file.originalName),
      node('p',file.bytes+' bytes · '+file.sha256+'\n'+file.identityBasis,'code'),
    ]));
    sources.append(details(bundle.body.applicationSha256.slice(0,12)+' · '+bundle.body.receivedAt,
      node('p','Bundle '+bundle.id,'code'),list));
  }
  root.append(sources);

  const references=sourceReferences(draft);
  if(references.length) {
    const box=details('Citations declared in retained source indexes ('+references.length+')',
      node('p','These are original index entries. A citation becomes retained evidence when you select and record its complete original file; opening a link does not capture that file.'));
    const search=textField('Find an original citation','',value=>paint(value),{placeholder:'Title, source ID or URL'});
    const rows=node('div');
    const paint=query=>{
      rows.replaceChildren();
      for(const item of references.filter(row=>canonical(row.source).toLowerCase().includes(query.toLowerCase()))) {
        const source=item.source,entry=node('article',undefined,'card');
        entry.append(node('h4',source.label||source.id||'Original citation'));
        if(source.url)entry.append(sourceLink(source.url));
        entry.append(details('Complete original index entry',node('pre',JSON.stringify(source,null,2),'source-text')),
          button('Use this citation for an evidence file',()=>{
            edit(s=>{s.evidenceDraft.title=String(source.label||source.id||'Original source');s.evidenceDraft.kind='source';
              s.evidenceDraft.sourceUrl=typeof source.url==='string'?source.url:'';});
            render();status('Copied the original citation metadata. Select its complete original file to retain the evidence.');
          }));
        rows.append(entry);
      }
    };
    box.append(search,rows);paint('');root.append(box);
  }

  const evidence=node('section',undefined,'card');evidence.append(node('h3','Retain selected original evidence'),
    node('p','Use an original source, result, issuer instruction or complete colleague review export. The evidence remains a file with its original identity and your explicit associations.'));
  evidence.append(textField('Operator',chosen.actor,text=>edit(s=>{s.actor=text;})),
    textField('Evidence title',chosen.evidenceDraft.title,text=>edit(s=>{s.evidenceDraft.title=text;})),
    selectField('Evidence category',chosen.evidenceDraft.kind,EVIDENCE_KINDS.map(kind=>[kind,kindLabel[kind]]),kind=>edit(s=>{s.evidenceDraft.kind=kind;})),
    textField('Original source URL',chosen.evidenceDraft.sourceUrl,text=>edit(s=>{s.evidenceDraft.sourceUrl=text;})),
    textField('Source observation date or timestamp',chosen.evidenceDraft.observedAt,text=>edit(s=>{s.evidenceDraft.observedAt=text;}),{placeholder:'Leave empty if the original observation time is unknown'}),
    textField('What this original file supports',chosen.evidenceDraft.note,text=>edit(s=>{s.evidenceDraft.note=text;}),{area:true}),
    takeFile(false),fileCard(chosen.evidenceDraft.file));
  if(chosen.evidenceDraft.file)evidence.append(button('Clear working evidence file',()=>{edit(s=>{s.evidenceDraft.file=null;});render();status('Cleared the working file selection. Its original bytes remain retained.');}));
  const associations=details('Associate with original answers, fields or requirements');
  const targets=[...ANSWERS.map(([id,label])=>({kind:'answer',id,label})),
    ...draft.fields.map(row=>({kind:'field',id:row.id,label:row.label||'Unlabeled form field'})),
    ...REQUIREMENTS.map(row=>({kind:'requirement',id:row.id,label:row.title}))];
  for(const target of targets)associations.append(checkbox(labelOf(target.kind)+' · '+target.label,
    chosen.evidenceDraft.targets.some(row=>row.kind===target.kind&&row.id===target.id),checked=>edit(s=>{
      s.evidenceDraft.targets=s.evidenceDraft.targets.filter(row=>!(row.kind===target.kind&&row.id===target.id));
      if(checked)s.evidenceDraft.targets.push(target);
    })));
  evidence.append(associations,button('Record this evidence file',async()=>replace(await retainEvidence(current()),'Recorded the complete original evidence and selected it for the next prepared edition.'),'primary'));
  root.append(evidence);

  const retained=node('section',undefined,'card');retained.append(node('h3','Evidence for the next prepared edition'));
  if(!value.evidence.length)retained.append(node('p','No separate evidence files have been recorded yet.','muted'));
  for(const item of [...value.evidence].reverse()) {
    const body=item.body,card=node('article',undefined,'card');
    card.append(checkbox(body.title,chosen.evidenceIds.includes(item.id),checked=>edit(s=>{
      s.evidenceIds=s.evidenceIds.filter(id=>id!==item.id);if(checked)s.evidenceIds.push(item.id);
    })),node('p',kindLabel[body.kind]+' · recorded '+body.createdAt+' · '+body.file.bytes+' bytes','muted'),
      node('p',body.targets.length?body.targets.map(row=>labelOf(row.kind)+': '+row.label).join('; '):'No specific answer or field association was entered.'),
      details('Original evidence description',node('p','Evidence '+item.id,'code'),
        node('p','Original draft '+body.draftId+' · application '+body.applicationSha256,'code'),
        node('p','Operator '+(body.actor||'not entered')+' · original observation '+(body.observedAt||'not entered')),
        sourceLink(body.sourceUrl),node('pre',body.note,'source-text'),fileCard(body.file)));
    retained.append(card);
  }
  root.append(retained);

  const prepare=node('section',undefined,'card');prepare.append(node('h3','Freeze the exact prepared output'),
    node('p','A prepared edition retains the complete current answers, field mapping, planning selection, review notes and selected evidence. Its output remains unchanged as you continue working.'));
  prepare.append(textField('Prepared edition title',chosen.title,text=>edit(s=>{s.title=text;})),
    textField('Preparation note',chosen.note,text=>edit(s=>{s.note=text;}),{area:true}),
    selectField('Output to prepare',chosen.outputKind,[['answers','All nine canonical answers'],['fields','Current issuer form fields']],kind=>edit(s=>{s.outputKind=kind;})),
    selectField('Exact output format',chosen.format,[['plain','Plain text'],['markdown','Markdown']],format=>edit(s=>{s.format=format;})),
    button('Prepare this exact edition',async()=>{
      const result=await prepareSubmission(current());replace(result.draft,'Prepared edition '+result.edition.id.slice(0,12)+'. Record an actual submission or issuer observation separately.');
    },'primary'));
  const mapping=formSourceReview(draft),sourceSummary=node('details');
  sourceSummary.dataset.handoverFieldSources='';
  sourceSummary.append(node('summary','Issuer-field answer coverage and changed wording'),
    node('p','Current fields associate '+(ANSWERS.length-mapping.unmappedAnswerIds.length)+' of '+ANSWERS.length+' canonical answer areas. '+mapping.changedFieldIds.length+' fields have changed source answers; '+mapping.unreviewedFieldIds.length+' await their first source comparison.'),
    table(['Answer area','Mapped fields'],mapping.answers.map(row=>[row.title,row.fieldIds.map(id=>draft.fields.find(field=>field.id===id)?.label||id).join('; ')||'No association entered'])),
    node('p','Compare or edit the fields in Issuer form fields. Preparation retains this exact mapping with the selected text; it remains available after later source changes.','muted'));
  prepare.append(sourceSummary);
  root.append(prepare);

  const observe=node('section',undefined,'card');observe.append(node('h3','Record an actual issuer observation'),
    node('p','Attach the original returned file or record what you observed. The source observation time and your recording time remain separate. An operator note is labeled as an operator note.'));
  observe.append(selectField('Prepared edition',chosen.returnDraft.editionId||'',
    [['','Select a retained prepared edition'],...value.editions.map(row=>[row.id,(row.body.title||'Prepared submission')+' · '+row.body.createdAt+' · '+row.id.slice(0,12)])],
    selectReturnEdition),
    selectField('Observation category',chosen.returnDraft.kind,RETURN_KINDS.map(kind=>[kind,returnLabel[kind]]),kind=>edit(s=>{s.returnDraft.kind=kind;})),
    textField('Original observation date or timestamp',chosen.returnDraft.observedAt,text=>edit(s=>{s.returnDraft.observedAt=text;}),{placeholder:'Leave empty when the original source time is unknown'}),
    textField('Original issuer or submission URL',chosen.returnDraft.sourceUrl,text=>edit(s=>{s.returnDraft.sourceUrl=text;})),
    textField('Original issuer reference',chosen.returnDraft.reference,text=>edit(s=>{s.returnDraft.reference=text;})),
    textField('Actual observation or correction',chosen.returnDraft.note,text=>edit(s=>{s.returnDraft.note=text;}),{area:true}),
    takeFile(true),fileCard(chosen.returnDraft.file));
  if(chosen.returnDraft.file)observe.append(button('Clear working returned file',()=>{edit(s=>{s.returnDraft.file=null;});render();status('Cleared the working return-file selection. Its original bytes remain retained.');}));
  if(chosen.returnDraft.supersedes)observe.append(node('p','This will add a correction to observation '+chosen.returnDraft.supersedes+'. The original record stays unchanged.','code'));
  observe.append(button('Record this observation',async()=>{
    const result=await recordIssuerReturn(current());replace(result.draft,'Recorded the observation against its exact prepared edition. The frozen output is unchanged.');
  },'primary'));
  root.append(observe);

  const history=node('section');history.append(node('h3','Prepared editions and later work'));
  if(!value.editions.length)history.append(node('p','No output has been frozen yet.','muted'));
  for(const edition of [...value.editions].reverse()) {
    const body=edition.body,card=details((body.title||'Prepared submission')+' · '+body.createdAt+' · '+edition.id.slice(0,12));
    card.append(node('p',body.statusMeaning),node('p','Edition '+edition.id,'code'),
      node('p',body.output.kind+' · '+body.output.format+' · '+body.output.bytes+' bytes · SHA-256 '+body.output.sha256,'code'),
      node('p','Preparing operator: '+(body.actor||'not entered')),node('pre',body.note,'source-text'));
    const buttons=node('div',undefined,'toolbar-row');
    buttons.append(button('Copy frozen output',()=>copy(body.output.text)),
      button('Download frozen output',()=>download(body.output.text,'scf-prepared-'+edition.id.slice(0,16)+(body.output.format==='markdown'?'.md':'.txt'),
        body.output.format==='markdown'?'text/markdown;charset=utf-8':'text/plain;charset=utf-8')),
      button('Download prepared report and later comparison',async()=>{
        await verifyHandover(current());download(preparedReport(current(),edition.id),'scf-handover-'+edition.id.slice(0,16)+'.html','text/html;charset=utf-8');
      }),
      button('Use this edition for an observation',()=>selectReturnEdition(edition.id)));
    card.append(buttons,details('Complete frozen output',node('pre',body.output.text,'source-text')),
      details('Complete frozen authoring state',node('pre',JSON.stringify(body.snapshot,null,2),'source-text')));
    if(body.contextIssues.length)card.append(details('Recorded context observations',...body.contextIssues.map(issue=>node('p',issue,'issues'))));
    if(body.fieldIssues.length)card.append(details('Original field counts and observations',node('pre',JSON.stringify(body.fieldIssues,null,2),'source-text')));
    if(body.fieldSourceReview)card.append(details('Answer mapping and source comparison at preparation',node('pre',JSON.stringify(body.fieldSourceReview,null,2),'source-text')));
    const originalFiles=node('div');
    for(const file of editionFileDescriptors(draft,edition.id).filter(file=>file.role!=='issuer-observation'))
      originalFiles.append(originalButton(draft,file,(file.title||labelOf(file.sourceRole||file.role))+' · '+file.originalName));
    card.append(details('Frozen source and evidence files',originalFiles));
    const observations=value.returns.filter(row=>row.body.editionId===edition.id),recorded=node('div');
    if(!observations.length)recorded.append(node('p','No original issuer observation is recorded for this edition.','muted'));
    for(const row of observations) {
      const item=row.body,entry=node('article',undefined,'card');
      entry.append(node('h4',returnLabel[item.kind]),node('p','Recorded '+item.recordedAt+' · original observation '+(item.observedAt||'not entered')),
        node('p','Operator '+(item.actor||'not entered')+' · reference '+(item.reference||'not entered')),
        node('p',row.id+(item.supersedes?' · corrects '+item.supersedes:''),'code'),sourceLink(item.sourceUrl),node('pre',item.note,'source-text'));
      if(item.file)entry.append(fileCard(item.file));else entry.append(node('p','No original returned file was attached.','muted'));
      entry.append(button('Add a correction to this observation',()=>{
        let result=current();const pending=handoverOf(result).selection.returnDraft;
        if(pending.file||pending.note||pending.reference||pending.sourceUrl||pending.observedAt||pending.supersedes)
          result=retainVersion(result,'Before preparing an observation correction');
        else result=clone(result);
        result.handover ||=emptyHandover();result.handover.selection.returnDraft={
          editionId:edition.id,kind:item.kind,observedAt:item.observedAt,sourceUrl:item.sourceUrl,reference:item.reference,
          note:item.note,supersedes:row.id,file:item.file?clone(item.file):null,
        };
        replace(result,'Opened an explicit correction. Record it to add a new observation; the original remains intact.');
      }));
      recorded.append(entry);
    }
    card.append(details('Original observations and corrections ('+observations.length+')',recorded));
    const comparisonBox=details('Compare the present draft with this exact prepared edition');
    const comparisonBody=node('div');comparisonBox.append(comparisonBody);
    comparisonBox.addEventListener('toggle',()=>{
      if(!comparisonBox.open||comparisonBody.childNodes.length)return;
      const comparison=comparePrepared(current(),edition.id);
      comparisonBody.append(node('p',comparison.meaning),
        table(['Original item','Status'],comparison.outputItems.map(row=>[row.before?.label||row.after?.label||row.id,row.status])));
      for(const row of comparison.outputItems.filter(row=>row.status!=='unchanged'))
        comparisonBody.append(details(row.before?.label||row.after?.label||row.id,node('h4','Frozen output'),
          node('pre',row.before?.text??'(absent)','source-text'),node('h4','Current output'),node('pre',row.after?.text??'(absent)','source-text')));
      comparisonBody.append(details('Complete answer, field and authoring-context changes',node('pre',JSON.stringify({
        answers:comparison.answers,fields:comparison.fields,context:comparison.context,
      },null,2),'source-text')));
    });
    card.append(comparisonBox);history.append(card);
  }
  root.append(history,node('p','Use the original Download whole editable draft control for complete receiving. It includes every retained original byte, version, prepared edition and observation. Opening that file keeps the same draft identity and permits later edits.','muted'));
}
