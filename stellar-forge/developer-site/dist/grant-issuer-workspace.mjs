// MIT. Complete issuer programme controls inside the original submission handover.
import {MAX_ISSUER_BYTES,issuerContexts,selectedIssuerContext,issuerWorkingSelection,issuerClone as clone,
  issuerComparison} from './grant-issuer-core.mjs';
import {receiveIssuerProgrammeFile,stageIssuerProgramme,retainIssuerProgramme,selectIssuerProgramme,
  reopenIssuerProgramme,receiveIssuerPlanning,issuerOriginal} from './grant-issuer-source.mjs';
import {emptyHandover} from './grant-handover-core.mjs';
import {fileBytes} from './grant-handover-source.mjs';
const node=(tag,text,cls)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=String(text);if(cls)item.className=cls;return item;};
const label=value=>value===null||value===undefined||value===''?'Unstated':String(value).replaceAll('_',' ');
function details(title,...children){const item=node('details');item.append(node('summary',title),...children);return item;}
function table(headings,rows){
  const wrap=node('div',undefined,'plan-scroll'),result=node('table'),thead=node('thead'),head=node('tr'),tbody=node('tbody');
  for(const heading of headings)head.append(node('th',heading));thead.append(head);
  for(const row of rows){const tr=node('tr');for(const value of row){const td=node('td');td.append(value instanceof Node?value:node('span',value??'Unstated'));tr.append(td);}tbody.append(tr);}
  result.append(thead,tbody);wrap.append(result);return wrap;
}
function field(title,value,change,area=false){
  const wrap=node('label',undefined,'field'),input=node(area?'textarea':'input');
  if(area)input.rows=4;else input.type='text';
  input.setAttribute('aria-label',title);input.value=value??'';input.autocomplete='off';
  input.addEventListener('input',()=>change(input.value));wrap.append(node('span',title),input);return wrap;
}
function selector(title,value,choices,change){
  const wrap=node('label',undefined,'field'),select=node('select');select.setAttribute('aria-label',title);
  for(const [id,title]of choices){const option=node('option',title);option.value=id;select.append(option);}
  select.value=value??'';select.addEventListener('change',()=>change(select.value));wrap.append(node('span',title),select);return wrap;
}
let lastReceived=null;
export function renderIssuerProgrammes(root,context){
  const {getDraft,setDraft,touch,work,render,status,download}=context;
  const current=()=>getDraft();
  const selected=()=>{const draft=current();draft.handover||=emptyHandover();draft.handover.selection.issuerDraft=issuerWorkingSelection(draft.handover.selection);return draft.handover.selection;};
  const edit=change=>{change(selected().issuerDraft);touch();};
  const replace=(draft,message)=>{setDraft(draft);touch();render();if(message)status(message);};
  const button=(title,action,cls='')=>{const value=node('button',title,cls);value.type='button';value.addEventListener('click',()=>work(action));return value;};
  const completeFile=(file,title='Download complete original issuer case')=>button(title,()=>{
    download(fileBytes(current(),file.sha256),file.name,'application/zip');status('Downloaded '+file.originalName+' with all original case sources.');
  });
  async function stagedSource(){
    const input=issuerWorkingSelection(current().handover?.selection);
    if(!input.file)throw new Error('Open the complete original issuer Operations handover.');
    if(lastReceived?.sha256===input.file.sha256)return lastReceived;
    lastReceived=await receiveIssuerProgrammeFile(fileBytes(current(),input.file.sha256),{filename:input.file.originalName,receivedAt:input.receivedAt});
    return lastReceived;
  }
  const stageTable=document=>table(['Field','Retained observation'],[
    ['Observed stage',label(document.stage)],['Proposed track',label(document.proposalTrack)],
    ['Issuer-selected track',label(document.issuerTrack)],['Issued amount (USD)',label(document.award?.amountUsd)],
    ['Issuer reference',label(document.issuer.reference)],['Original date',label(document.issuer.issuedOn)],
    ['Round',label(document.round.label)],['Full-submission deadline',label(document.round.deadlineOn)],
    ['Deadline source',label(document.round.deadlineBasis)],
  ]);
  function describe(received,container){
    container.replaceChildren();const edition=received.selectedTerms.edition,document=edition.document;
    container.append(node('h4',document.title),stageTable(document),
      node('p','Saved interpretation by '+edition.actor+' · edition '+edition.revision+' · '+edition.savedAt,'muted'),
      node('p','Selected native plan revision '+received.document.program.planRevision+' · '+received.terms.length+' retained terms editions · '+
        received.commissioning.length+' commissioning records · '+received.document.sources.length+' original sources.','muted'));
    const comparison=details('Proposal and issuer terms from the saved native comparison',
      table(['Field','Proposal','Issued','Observation'],edition.comparison.differences.map(row=>[
        row.field,typeof row.proposed==='object'?JSON.stringify(row.proposed):row.proposed,
        typeof row.issued==='object'?JSON.stringify(row.issued):row.issued,row.state])));
    container.append(comparison,details('Complete selected issuer terms',node('pre',JSON.stringify(document,null,2),'source-text')));
    const messages=details('Original correspondence ('+received.correspondence.length+')');
    for(const row of received.correspondence){
      const original=row.edition.selected.find(part=>part.path==='original'),inspection=row.edition.inspection,meta=inspection.metadata||{};
      const article=node('article',undefined,'card');
      article.append(node('h4',meta.subject||inspection.original.filename),
        table(['Original field','Value'],[['From',label(meta.from)],['To',label(meta.to)],['Date',label(meta.date)],['Message identity',label(meta.messageId)]]));
      for(const part of inspection.textParts||[]){
        const text=node('pre',part.text??'','source-text');
        article.append(details('Message part '+part.path+' · '+part.mediaType,text));
      }
      for(const part of row.edition.selected)article.append(button(part.path==='original'?'Download original message':('Download selected attachment: '+part.source.filename),()=>{
        const file=issuerOriginal(received,part.source.id);download(file.bytes,file.metadata.filename,file.metadata.mediaType);
        status('Downloaded the exact original '+file.metadata.filename+'.');
      }));
      if((inspection.warnings||[]).length)article.append(details('Recorded source decoding observations',node('pre',JSON.stringify(inspection.warnings,null,2),'source-text')));
      article.append(node('p',original.source.bytes+' original bytes · SHA-256 '+original.source.sha256,'code'));messages.append(article);
    }
    container.append(messages);
    const history=details('Complete terms editions and historical plan selections',
      table(['Terms identity','Edition','Observed stage','Author','Native plan','Saved'],received.terms.map(row=>[
        row.edition.id,row.edition.revision,label(row.edition.document.stage),row.edition.actor,row.edition.source.plan.revision,row.edition.savedAt])));
    for(const row of received.terms)history.append(details(row.edition.document.title+' · edition '+row.edition.revision,
      node('pre',JSON.stringify({document:row.edition.document,comparison:row.edition.comparison,
        previous:row.edition.previous,source:row.edition.source.case},null,2),'source-text')));
    container.append(history);
    const commissions=details('Reviewed terms-to-plan commissioning',
      table(['Terms edition','Native plan','Basis','Operator','Saved'],received.commissioning.map(row=>[
        row.edition.terms.id+' / '+row.edition.terms.revision,row.edition.selectedPlan.revision,
        label(row.edition.preview.inputs.basis),row.edition.actor,row.edition.savedAt])));
    for(const row of received.commissioning)commissions.append(details(row.edition.id,
      node('pre',JSON.stringify({reviewStatement:row.edition.reviewStatement,reason:row.edition.preview.inputs.reason,
        amendment:row.edition.amendment,selectedPlan:{revision:row.edition.selectedPlan.revision,contentSha256:row.edition.selectedPlan.contentSha256}},null,2),'source-text')));
    container.append(commissions);
    const originals=details('All original sources ('+received.document.sources.length+')');
    originals.append(table(['Original file','Kind','Bytes','Original observation'],received.document.sources.map(metadata=>[
      button(metadata.filename,()=>{const original=issuerOriginal(received,metadata.id);download(original.bytes,metadata.filename,metadata.mediaType);}),
      metadata.kind,metadata.bytes,metadata.observedAt])));
    container.append(originals);
  }
  const value=current(),contexts=issuerContexts(value),selection=value.handover?.selection||{},input=issuerWorkingSelection(selection);
  const section=node('section',undefined,'card grant-issuer');section.dataset.issuerProgramme='v1';
  section.append(node('h3','Issuer programme and selected native plan'),
    node('p','Receive the complete issuer case exported from Grant Operations. Keep the original correspondence, saved terms interpretations and reviewed plan commissioning with this application. Select the context to carry into the next prepared edition.'));
  const picker=node('label',undefined,'field'),fileInput=node('input');fileInput.type='file';fileInput.accept='.zip,application/zip';fileInput.dataset.issuerProgrammeFile='native';
  picker.append(node('span','Complete original issuer Operations ZIP'),fileInput);
  fileInput.addEventListener('change',()=>work(async()=>{
    const file=fileInput.files?.[0];if(!file)return;
    if(file.size>MAX_ISSUER_BYTES)throw new Error('Receive the complete original issuer handover up to 32 MiB.');
    const result=await stageIssuerProgramme(current(),new Uint8Array(await file.arrayBuffer()),{filename:file.name});
    lastReceived=result.received;replace(result.draft,'Opened the original issuer programme. Review its retained stage, source and plan, then record this context.');
  }));
  const incoming=details('Receive an original issuer programme',picker,
    field('Issuer context title',input.title,value=>edit(s=>{s.title=value;})),
    field('Issuer context operator',input.actor,value=>edit(s=>{s.actor=value;})),
    field('Issuer source URL',input.sourceUrl,value=>edit(s=>{s.sourceUrl=value;})),
    field('Issuer context reception note',input.note,value=>edit(s=>{s.note=value;}),true));
  if(input.file){
    incoming.open=true;
    const preview=node('div');
    incoming.append(node('p',input.file.originalName+' · '+input.file.bytes+' bytes','muted'),
      completeFile(input.file),button('Review original programme',async()=>{describe(await stagedSource(),preview);status('Opened the complete original issuer source and native-plan history.');}),
      button('Record issuer programme',async()=>{
        const result=await retainIssuerProgramme(current());lastReceived=result.received;
        replace(result.draft,'Retained the issuer programme and selected it for the next prepared edition.');
      },'primary'),
      button('Clear working issuer file',()=>{edit(s=>{s.file=null;});lastReceived=null;render();status('Cleared the working issuer selection. Saved original bytes and history remain available.');}),preview);
  }
  section.append(incoming);
  section.append(selector('Issuer programme for next prepared edition',selection.issuerProgrammeId||'',
    [['','No issuer programme selected'],...contexts.map(row=>[row.id,row.body.title+' · '+label(row.body.document.stage)+' · terms '+row.body.selection.revision])],
    id=>work(()=>replace(selectIssuerProgramme(current(),id||null),'Selected the issuer context for the next prepared edition.'))));
  const currentContext=selectedIssuerContext(value);
  if(currentContext){
    const body=currentContext.body,card=node('article',undefined,'card'),review=node('div');
    card.append(node('h4',body.title),stageTable(body.document),
      node('p','Original case '+body.programme.name+' · version '+body.programme.version+' · native plan revision '+body.plan.revision,'muted'),
      node('p',body.note),button('Review retained programme and sources',async()=>{
        lastReceived=await reopenIssuerProgramme(current(),currentContext.id);describe(lastReceived,review);
        status('Reopened the complete retained issuer case and exact native source history.');
      }),completeFile(body.file),
      button('Receive selected native plan',async()=>{
        const result=await receiveIssuerPlanning(current(),currentContext.id);
        replace(result,'Received native plan revision '+body.plan.revision+'. Continue its budget and application update through Planning edition.');
      }),
      details('Application and native plan selections',node('pre',JSON.stringify(issuerComparison(value,currentContext),null,2),'source-text')),review);
    section.append(card);
  }
  if(contexts.length){
    const history=details('Retained issuer programme receptions ('+contexts.length+')');
    history.append(table(['Context','Observed stage','Terms edition','Native plan','Received'],
      contexts.map(row=>[row.body.title,label(row.body.document.stage),row.body.selection.revision,row.body.plan.revision,row.body.receivedAt])));
    section.append(history);
  }
  section.append(node('p','Preparing an edition freezes the selected issuer context alongside its exact answers and native planning selection. The complete editable draft retains the original ZIP, so another operator can reopen every message, terms edition and commissioned plan.','muted'));
  root.append(section);
}
