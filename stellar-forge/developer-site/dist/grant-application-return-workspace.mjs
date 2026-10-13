// MIT. Author-controlled returns inside the original submission workspace.
import * as returns from './grant-application-return.mjs';
import {MAX_BYTES, measureText} from './grant-submission-core.mjs';
import {newApplicationReturnWorking,validateApplicationReturnWorking} from './grant-application-return-working.mjs';
const clone=value=>structuredClone(value);
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);if(cls)el.className=cls;return el;};
const initial=newApplicationReturnWorking;
const need=(value,message)=>{if(!value)throw new Error(message);};

export function createApplicationReturnPanel({getDraft,commitDraft,work,download,exportDraft,exportOffline,status,onWorkingChange}){
  let state=initial(),preview=null,generation=0,root=null;
  const changed=()=>onWorkingChange();
  const act=(label,run)=>{const b=node('button',label);b.type='button';b.addEventListener('click',()=>work(run));return b;};
  const field=(label,key,{area=false}={})=>{
    const wrap=node('label',undefined,'field'),input=node(area?'textarea':'input');if(!area)input.type='text';
    input.value=state[key];input.autocomplete='off';input.addEventListener('input',()=>{state[key]=input.value;changed();});
    wrap.append(node('span',label),input);return wrap;
  };
  const safeName=value=>String(value||'application').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,90)||'application';
  function history(){return returns.listApplicationReturns(getDraft());}
  async function originalIssue(id){return returns.issuedDraftFor(getDraft(),id);}
  function originalsCard(container){
    const records=history();
    if(!records.issues.length){container.append(node('p','No editable copies have been issued from this application.','muted'));return;}
    const box=node('section',undefined,'return-history');box.append(node('h3','Issued copies'));
    for(const issue of [...records.issues].reverse()){
      const article=node('article',undefined,'card');article.dataset.applicationIssue=issue.id;
      article.append(node('h4',issue.label||'Editable application'),node('p',[issue.recipient,issue.at].filter(Boolean).join(' · '),'muted'));
      if(issue.note)article.append(node('p',issue.note));
      const controls=node('div',undefined,'row');
      controls.append(act('Download issued draft',async()=>download(await exportDraft(await originalIssue(issue.id)),safeName(issue.label)+'-issued-draft.json')),
        act('Download issued offline editor',async()=>{await exportOffline(await originalIssue(issue.id),safeName(issue.label)+'-issued-editor.html');status('Downloaded the exact issued editable application. Its recipient opens a separate browser draft.');}));
      article.append(controls);box.append(article);
    }
    if(records.adoptions.length){
      box.append(node('h3','Accepted returns'));
      for(const adoption of [...records.adoptions].reverse()){
        const article=node('article',undefined,'card');article.dataset.applicationAdoption=adoption.id;
        article.append(node('h4',adoption.label||'Accepted application changes'),node('p',[adoption.reviewer,adoption.at].filter(Boolean).join(' · '),'muted'));
        if(adoption.note)article.append(node('p',adoption.note));
        const controls=node('div',undefined,'row');
        for(const [branch,label]of [['baseline','Issued baseline'],['current','Author before acceptance'],['returned','Returned application'],['result','Accepted result']])
          controls.append(act('Download '+label.toLowerCase(),async()=>download(await returns.exportApplicationReturnBranch(getDraft(),adoption.id,branch),safeName(adoption.id)+'-'+branch+'.json')));
        article.append(controls);box.append(article);
      }
    }
    container.append(box);
  }
  function representation(value){return value===undefined?'Absent':value===null?'Absent':typeof value==='string'?value:JSON.stringify(value,null,2);}
  function comparisonCard(row){
    const details=node('details',undefined,'return-change');details.dataset.applicationReturnKey=row.key;
    if(row.status==='conflict')details.open=true;
    const title=node('summary',row.label+' · '+({'current-only':'Author changed','returned-only':'Colleague changed','same-change':'Same change','conflict':'Both changed',unchanged:'Unchanged'}[row.status]||row.status));
    details.append(title);
    const columns=node('div',undefined,'return-comparison');
    for(const [key,label]of [['baseline','Issued baseline'],['current','Current author version'],['returned','Returned version']]){
      const part=node('section');part.append(node('h4',label),node('pre',representation(row[key])));columns.append(part);
    }
    details.append(columns);
    if(row.status!=='unchanged'&&row.status!=='same-change'){
      const wrap=node('label',undefined,'field'),select=node('select');select.setAttribute('aria-label','Choice for '+row.label);
      for(const [value,label]of [['','Choose which complete value to keep'],['current','Keep current author value'],['returned','Use returned value']]){
        const option=node('option',label);option.value=value;select.append(option);
      }
      select.value=state.choices[row.key]||'';select.addEventListener('change',()=>{if(select.value)state.choices[row.key]=select.value;else delete state.choices[row.key];changed();updateApply();});
      wrap.append(node('span','Value to save'),select);details.append(wrap);
    }
    return details;
  }
  function unsettled(){return preview?.rows.filter(row=>row.status!=='unchanged'&&row.status!=='same-change'&&!state.choices[row.key])||[];}
  function updateApply(){
    if(!root||!preview)return;
    const pending=unsettled(),note=root.querySelector('[data-return-choice-count]'),apply=root.querySelector('[data-apply-application-return]');
    if(note)note.textContent=pending.length?pending.length+' changed values still need your choice.':'Every changed value has an explicit choice.';
    if(apply)apply.disabled=!!pending.length||!!preview.outOfScope.length;
  }
  async function compare(){
    need(state.raw,'Open the colleague’s complete returned draft or working JSON first.');
    const epoch=++generation,raw=state.raw,result=await returns.compareReturned(getDraft(),raw);
    if(epoch!==generation||raw!==state.raw)return;
    if(state.basisSha256!==result.basisSha256)state.choices={};
    state.basisSha256=result.basisSha256;state.selectedIssue=result.issue.id;preview=result;changed();draw();
    status(result.outOfScope.length?'The return also changed source or authority records. Read those differences before continuing.':'Compared the issued baseline, current author work and complete returned application. Choose the values to save.');
  }
  function pendingCard(container){
    const box=node('section',undefined,'card');box.append(node('h3','Receive a colleague’s application'),node('p','Select their complete draft or working JSON. Your current answers and saved browser identity stay selected while you review the return.'));
    const label=node('label',undefined,'field'),file=node('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','Returned application file');
    file.addEventListener('change',()=>work(async()=>{
      const selected=file.files[0];if(!selected)return;need(selected.size<=MAX_BYTES*2+65536,'Open the complete returned application within its 32 MiB receiving allowance.');
      const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await selected.arrayBuffer());
      generation++;state.raw=raw;state.filename=selected.name;state.choices={};state.basisSha256=null;state.selectedIssue=null;preview=null;changed();draw();
      status('Retained the complete returned file. Preview changes to compare it with this application.');
    }));label.append(node('span','Complete returned draft or working file'),file);box.append(label);
    if(state.raw){
      box.append(node('p',state.filename+' · '+measureText(state.raw).utf8Bytes.toLocaleString()+' original UTF-8 bytes','muted'));
      const controls=node('div',undefined,'row');controls.append(act('Preview returned changes',compare),
        act('Download original returned file',()=>download(state.raw,safeName(state.filename.replace(/\.json$/i,''))+'-original-return.json')));
      box.append(controls);
      if(state.basisSha256&&!preview)box.append(node('p','Your original file and choices are retained. Preview again to check them against the current author version.','muted'));
    }
    if(preview){
      box.append(node('h3','Return for '+(preview.issue.label||preview.issue.id)));
      if(preview.outOfScope.length){
        const warning=node('section',undefined,'issues');warning.append(node('h4','Other source and authority changes'),node('p','This return changed records outside the answer and form exchange. Keep the complete file and handle those changes through their original source or planning controls. Then return an answer-and-form copy against the unchanged issued source, or issue a new copy from the updated author application.'));
        for(const item of preview.outOfScope){const details=node('details');details.append(node('summary',item.label),node('h4','Issued record'),node('pre',representation(item.baseline)),node('h4','Returned record'),node('pre',representation(item.returned)));warning.append(details);}
        box.append(warning);
      }
      const changedRows=preview.rows.filter(row=>row.status!=='unchanged'),controls=node('div',undefined,'row');
      for(const [choice,label]of [['current','Keep all current author values'],['returned','Use all returned values']])
        controls.append(act(label,()=>{for(const row of changedRows)if(row.status!=='same-change')state.choices[row.key]=choice;changed();draw();}));
      if(changedRows.length)box.append(controls);
      else box.append(node('p','The editable answers and form match the current author version.'));
      for(const row of changedRows)box.append(comparisonCard(row));
      const unchanged=preview.rows.filter(row=>row.status==='unchanged');
      if(unchanged.length){const details=node('details');details.append(node('summary',unchanged.length+' unchanged values'));for(const row of unchanged)details.append(comparisonCard(row));box.append(details);}
      box.append(field('Reviewing author', 'reviewer'),field('Acceptance note','note',{area:true}));
      const count=node('p');count.dataset.returnChoiceCount='';box.append(count);
      const apply=act('Save chosen changes to original draft',async()=>{
        need(preview&&state.basisSha256===preview.basisSha256,'Preview the current original return before accepting it.');
        need(state.reviewer.trim(),'Enter the reviewing author.');
        const next=await returns.applyReturned(getDraft(),state.raw,{issueId:preview.issue.id,basisSha256:preview.basisSha256,choices:clone(state.choices),reviewer:state.reviewer,note:state.note,id:crypto.randomUUID(),at:new Date().toISOString()});
        await commitDraft(next);preview=null;changed();draw();
        status('Saved the accepted changes and complete branch history in the original application.');
      });apply.dataset.applyApplicationReturn='';box.append(apply);
    }
    container.append(box);
  }
  function draw(){
    if(!root?.isConnected)return;
    root.replaceChildren();root.classList.add('application-return');root.dataset.applicationReturnPanel='';
    const draft=getDraft();root.append(node('h2','Editable application returns'),node('p','Issue a complete copy for a colleague, keep working, and decide how their returned answers and form should join your current application.'));
    if(draft.applicationReturnContext){
      const incoming=node('section',undefined,'card');incoming.append(node('h3','You are editing an issued application'),node('p','Use the ordinary answer and issuer-form controls. Download the complete returned application when your edits are ready for its original author.'));
      incoming.append(act('Download complete returned application',async()=>{download(await exportDraft(getDraft()),safeName(getDraft().title)+'-returned-application.json');status('Downloaded the complete editable return for its original author.');}));
      root.append(incoming);
    }
    const issue=node('section',undefined,'card');issue.append(node('h3','Issue an editable copy'),field('Copy label','issueLabel'),field('Colleague or receiving team','recipient'),field('Instructions for this copy','issueNote',{area:true}));
    issue.append(act('Save and issue editable copy',async()=>{
      need(state.issueLabel.trim(),'Name the editable copy.');
      const result=await returns.createIssue(getDraft(),{id:crypto.randomUUID(),label:state.issueLabel,recipient:state.recipient,note:state.issueNote,at:new Date().toISOString()});
      await commitDraft(result.draft);state.selectedIssue=result.issue.id;preview=null;changed();draw();
      download(await exportDraft(result.issuedDraft),safeName(result.issue.label)+'-issued-draft.json');
      status('Saved the issued baseline in the original application and downloaded its complete editable copy.');
    }));root.append(issue);
    pendingCard(root);originalsCard(root);updateApply();
  }
  return {snapshot:()=>clone(state),restore(value){validateApplicationReturnWorking(value);state=value?clone(value):initial();preview=null;generation++;},
    render(element){root=element;draw();}};
}
