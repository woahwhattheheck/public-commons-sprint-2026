// MIT. Complete offline customer review; the original shared decision model is injected.
export function renderGeoapifyCustomerReviewDocument(value,{runtimeBase64,title='Address review'}={}){
  if(typeof runtimeBase64!=='string'||!runtimeBase64.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(runtimeBase64))
    throw new Error('Use the complete encoded original customer review module.');
  const safe=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const data=JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src data:; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'+
    '<title>'+safe(title)+'</title><style>'+geoapifyCustomerReviewCSS()+'</style></head><body>'+
    '<main id="customer-review"><p>Opening the complete address review…</p></main>'+
    '<noscript>Enable JavaScript in a current desktop browser to review and save this complete offline file.</noscript>'+
    '<script id="customer-review-source" type="application/json">'+data+'</script>'+
    '<script id="customer-review-runtime" type="module" src="data:text/javascript;base64,'+runtimeBase64+'"></script></body></html>\n';
}
export function geoapifyCustomerReviewCSS(){return `
:root{font:15px/1.5 system-ui,sans-serif;color:#202224;background:#f4f4f3;color-scheme:light}
*{box-sizing:border-box}body{margin:0}main{max-width:1460px;margin:auto;padding:24px}
h1{font-size:25px;margin:0 0 8px}h2{font-size:19px;margin:0 0 12px}h3{font-size:16px;margin:0 0 8px}
p{margin:6px 0 12px}.quiet{color:#565a5d;font-size:13px}.bar,.filters,.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.bar{justify-content:space-between;margin-bottom:18px}.panel,article{border:1px solid #c8cbcd;background:white;padding:16px;margin-bottom:14px}
.grid{display:grid;grid-template-columns:minmax(270px,1fr) minmax(420px,2.2fr);gap:16px}
button,input,select,textarea{font:inherit;border:1px solid #8b9195;border-radius:2px;background:white;color:#202224;padding:7px 10px}
button{cursor:pointer;min-height:38px}button.primary{background:#303438;color:white;border-color:#303438}button:disabled{opacity:.55;cursor:default}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid #555;outline-offset:2px}
label{display:block;margin:10px 0 4px;font-weight:600}label input,label select,label textarea{display:block;width:100%;margin-top:5px;font-weight:400}
textarea{min-height:88px;resize:vertical}input[type=file]{max-width:100%}input[type=radio]{width:auto;display:inline;margin:0 8px 0 0}
fieldset{border:1px solid #bcc0c3;margin:12px 0;padding:12px}legend{font-weight:600;padding:0 6px}
.notice{border-left:4px solid #565d61;padding:10px 14px;background:white;white-space:pre-wrap;overflow-wrap:anywhere;min-height:45px;margin-bottom:16px}
.notice[data-error=true]{border:2px solid #303438}.facts{display:grid;grid-template-columns:minmax(110px,170px) minmax(0,1fr);gap:4px 12px;margin:0}
.facts dt{color:#565a5d}.facts dd{margin:0;overflow-wrap:anywhere}pre{font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:450px;overflow:auto;background:#f4f4f3;padding:12px}
details{margin:10px 0}summary{cursor:pointer;font-weight:600}.query{width:100%;text-align:left;display:block;margin:8px 0;padding:10px;overflow-wrap:anywhere}
.query[aria-current=true]{border:2px solid #303438;background:#efefed}.query span{display:block;font-size:12px;color:#565a5d}.candidate{padding:12px;border:1px solid #c8cbcd;margin:10px 0}
.candidate label{margin:0 0 8px}.candidate[data-selected=true]{border:2px solid #303438}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border:1px solid #c8cbcd;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#efefed}
[hidden]{display:none!important}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
@media(max-width:850px){main{padding:14px}.grid{grid-template-columns:1fr}.facts{grid-template-columns:120px 1fr}}
@media print{.actions,.filters,.bar button,input[type=file],#cr-open-panel{display:none!important}main{max-width:none;padding:0}.grid{display:block}.panel,article{break-inside:avoid}pre{max-height:none}.notice{display:none}}
`;}

export async function mountGeoapifyCustomerReview(root,{core,value,runtimeBase64,storage,document:doc=root.ownerDocument}={}){
  if(!root||!core)throw new Error('Use the original customer review model and document root.');
  const copy=v=>structuredClone(v),json=v=>JSON.stringify(v,null,2),now=()=>new Date().toISOString();
  let draft,busy=false,version=0,savedVersion=0,storageTimer=null,storageWarning=false,disposed=false,pendingRecovery=null;
  let editor={},forms={},searchIndex=new Map(),rows=[],filtered=[],selected=null,offset=0,sourceOffset=0;
  const listeners=[],pageSize=25,MAX_FILE=256*1024*1024;
  const on=(target,type,fn)=>{target.addEventListener(type,fn);listeners.push({target,type,fn});};
  const prune=()=>{for(let i=listeners.length-1;i>=0;i--){const e=listeners[i];if(e.target!==doc.defaultView&&e.target!==root&&!root.contains(e.target)){e.target.removeEventListener(e.type,e.fn);listeners.splice(i,1);}}};
  const node=(tag,text)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;};
  const part=name=>root.querySelector('[data-cr="'+name+'"]');
  const add=(parent,...children)=>{parent.append(...children);return parent;};
  const control=(name,label,work,{primary=false}={})=>{
    const b=node('button',label);b.type='button';b.dataset.cr=name;if(primary)b.className='primary';
    if(work)on(b,'click',()=>void run(work));return b;
  };
  const label=(title,input)=>add(node('label',title),input);
  const input=(name,type='text')=>{const e=node('input');e.type=type;e.dataset.cr=name;return e;};
  const select=(name,values)=>{const e=node('select');e.dataset.cr=name;for(const[value,title]of values){const o=node('option',title);o.value=value;e.append(o);}return e;};
  const details=(title,value)=>{const e=node('details'),pre=node('pre');e.append(node('summary',title),pre);let shown=false;on(e,'toggle',()=>{if(e.open&&!shown){pre.textContent=json(value);shown=true;}});return e;};
  const facts=pairs=>{const dl=node('dl');dl.className='facts';for(const[k,v]of pairs)dl.append(node('dt',k),node('dd',v===undefined||v===null?'—':typeof v==='object'?json(v):v));return dl;};
  function notice(message,error=false){const e=part('notice');e.textContent=message;e.dataset.error=String(error);}
  function key(){return 'geoapify-customer-review:'+String(draft?.project?.id??'')+':'+String(draft?.project?.projectSha256??'');}
  function remember(){
    if(disposed||pendingRecovery)return;
    try{if(storage)storage.setItem(key(),JSON.stringify({schema:'geoapify.customer-review-recovery.v1',draft,editor,forms,savedAt:now()}));}
    catch{if(!storageWarning){storageWarning=true;notice('This browser could not retain a recovery copy. Use Save working JSON or Save working HTML to keep the complete review.',true);}}
  }
  function scheduleRemember(){if(storageTimer!==null)clearTimeout(storageTimer);storageTimer=setTimeout(()=>{storageTimer=null;remember();},500);}
  function readForm(){
    if(!selected||!part('decision'))return;
    forms[selected.queryId]={action:part('action').value,candidateId:part('candidate').value,
      coordinateChoice:part('coordinate').value,reviewer:part('reviewer').value,note:part('note').value};
  }
  function viewEditor(){return {...editor,queryId:selected?.queryId??null,search:part('search')?.value??'',filter:part('filter')?.value??'all',offset,sourceOffset};}
  function changed(){readForm();editor=viewEditor();version++;renderCounts();scheduleRemember();}
  async function flush(){
    readForm();editor=viewEditor();draft=await core.saveWorking(draft,{editor:copy(editor),forms:copy(forms)});return draft;
  }
  function pendingFile(){return Boolean(part('file')?.files?.length);}
  function requireRetainedSelection(){if(pendingFile())throw new Error('Open or clear the selected file before saving. It is still in the file picker.');}
  async function run(work){
    if(busy||disposed)return;
    readForm();editor=viewEditor();busy=true;part('content').inert=true;renderControls();
    try{await work();}
    catch(error){notice(error?.message??String(error),true);}
    finally{busy=false;part('content').inert=Boolean(pendingRecovery);renderControls();}
  }
  function download(text,name,type='application/json'){
    const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name;
    doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function filename(suffix){const id=String(draft.project.id??'address-review').replace(/[^A-Za-z0-9_-]/g,'_');return id+suffix;}
  function choice(id){return draft.choices?.[id]??null;}
  function status(row){return choice(row.queryId)?'recorded':Object.hasOwn(forms,row.queryId)?'draft':'unreviewed';}
  function projectRows(){
    const queries=draft.project.queries??[];
    if(!Array.isArray(queries))throw new Error('The issued project must contain complete original query groups.');
    return queries;
  }
  function indexProject(){
    rows=projectRows();searchIndex=new Map(rows.map(row=>[row.queryId,
      [row.queryId,json(row.params),json(row.sourceRows),...row.candidates.map(c=>c.formatted??'')].join(' ').toLocaleLowerCase()]));
  }
  function renderCounts(){
    if(!draft)return;
    const n=Object.keys(draft.choices??{}).length,drafts=rows.filter(r=>status(r)==='draft').length;
    part('counts').textContent=rows.length+' original queries · '+n+' recorded choices · '+drafts+' unfinished forms · '+(version===savedVersion?'current working version saved':'working changes to save');
  }
  function renderControls(){for(const e of root.querySelectorAll('button,input,select,textarea'))e.disabled=busy;
    if(!busy){part('previous').disabled=offset===0;part('next').disabled=offset+pageSize>=filtered.length;
      part('clear-file').disabled=!pendingFile();part('open').disabled=!pendingFile();
      part('source-previous')&&(part('source-previous').disabled=sourceOffset===0);
      part('source-next')&&(part('source-next').disabled=!selected||sourceOffset+pageSize>=selected.sourceRows.length);
      part('remove-choice')&&(part('remove-choice').disabled=!selected||!choice(selected.queryId));
      if(part('action')?.value==='keep-source'){part('candidate').disabled=true;part('coordinate').disabled=true;}
      if(pendingRecovery)for(const e of part('content').querySelectorAll('button,input,select,textarea'))e.disabled=true;}
    part('content').inert=busy||Boolean(pendingRecovery);part('recovery-gate').hidden=!pendingRecovery;
  }
  function applyFilter(){
    const term=part('search').value.trim().toLocaleLowerCase(),filter=part('filter').value;
    filtered=rows.filter(row=>(!term||searchIndex.get(row.queryId).includes(term))&&(filter==='all'||status(row)===filter));
    offset=Math.min(Math.max(0,offset),Math.max(0,Math.floor((filtered.length-1)/pageSize)*pageSize));
    editor=viewEditor();renderList();
  }
  function renderList(){
    const list=part('queries');list.replaceChildren();prune();
    for(const row of filtered.slice(offset,offset+pageSize)){
      const b=control('',Object.values(row.params??{}).join(', ')||row.queryId,async()=>{await flush();selected=row;sourceOffset=0;editor.queryId=row.queryId;renderSelected();renderList();remember();});
      b.className='query';b.setAttribute('aria-current',String(selected?.queryId===row.queryId));
      b.append(node('span',status(row)+' · '+row.sourceRows.length+' original records · '+row.candidates.length+' candidates'));list.append(b);
    }
    if(!filtered.length)list.append(node('p','No queries match this filter.'));
    part('page').textContent=(filtered.length?offset+1:0)+'–'+Math.min(offset+pageSize,filtered.length)+' of '+filtered.length+' matching queries';
    renderCounts();renderControls();
  }
  function renderSources(){
    const target=part('originals');target.replaceChildren();prune();
    if(!selected)return;
    const originals=selected.sourceRows;
    sourceOffset=Math.min(Math.max(0,sourceOffset),Math.max(0,Math.floor((originals.length-1)/pageSize)*pageSize));
    target.append(node('p',(originals.length?sourceOffset+1:0)+'–'+Math.min(sourceOffset+pageSize,originals.length)+' of '+originals.length+' original records for this query.'));
    for(const row of originals.slice(sourceOffset,sourceOffset+pageSize)){
      const box=node('article');box.append(facts([['Source ordinal',row.ordinal],['Original business identity',row.identity]]),details('Complete original record',row));target.append(box);
    }
    const nav=node('div');nav.className='actions';
    nav.append(control('source-previous','Previous records',async()=>{sourceOffset=Math.max(0,sourceOffset-pageSize);renderSources();remember();}),
      control('source-next','Next records',async()=>{sourceOffset+=pageSize;renderSources();remember();}));target.append(nav);
  }
  function renderSelected(){
    const area=part('detail');area.replaceChildren();prune();
    if(!selected){area.append(node('p','Choose an original query to review every source record and candidate.'));return;}
    const recorded=choice(selected.queryId),baseline=selected.baselineDecision,working=forms[selected.queryId]??recorded??baseline??{};
    area.append(node('h2',Object.values(selected.params??{}).join(', ')||'Address query'),
      facts([['Query',selected.queryId],['Source records',selected.sourceRows.length],['Recorded choice',recorded?.action??'None']]),
      details('Issued source and original provider response',{queryId:selected.queryId,params:selected.params,responseSha256:selected.responseSha256,
        providerStatus:selected.providerStatus,baselineDecision:baseline,candidates:selected.candidates}));
    const originals=node('details');originals.open=true;originals.append(node('summary','Every original source record ('+selected.sourceRows.length+')'));
    const sourceArea=node('div');sourceArea.dataset.cr='originals';originals.append(sourceArea);area.append(originals);
    const form=node('form');form.dataset.cr='decision';
    const action=select('action',[['','Choose a decision'],['accept','Accept a provider candidate'],['keep-source','Keep original source']]);
    action.value=working.action??'';
    const candidates=select('candidate',[['','Choose a candidate'],...selected.candidates.map(c=>[c.id,(c.formatted??'Unformatted result')+' · confidence '+(c.confidence??'—')+(!c.location?' · no usable coordinates':'')])]);
    candidates.value=working.candidateId??'';
    const coordinate=select('coordinate',[['preserve-source','Preserve original coordinates'],['fill-missing','Use provider only where original coordinates are missing'],['use-provider','Use selected provider coordinates']]);
    coordinate.value=working.coordinateChoice??'preserve-source';
    const reviewer=input('reviewer');reviewer.maxLength=200;reviewer.value=working.reviewer??editor.reviewer??'';
    const note=node('textarea');note.dataset.cr='note';note.maxLength=4000;note.value=working.note??'';
    form.append(label('Decision',action),label('Provider candidate',candidates),label('Coordinate policy',coordinate),label('Your name',reviewer),label('Reason',note));
    form.append(node('p','Record choice saves this query’s decision. Typing alone keeps an unfinished form. Keeping the source always preserves its coordinates.'));
    const actions=node('div');actions.className='actions';
    actions.append(control('record','Record choice',async()=>{
      requireRetainedSelection();await flush();draft=await core.setChoice(draft,{queryId:selected.queryId,...forms[selected.queryId]});
      editor.reviewer=part('reviewer').value;version++;renderSelected();applyFilter();renderHistory();remember();notice('Choice recorded for all '+selected.sourceRows.length+' original records in this query.');
    },{primary:true}),
    control('remove-choice','Remove recorded choice',async()=>{
      requireRetainedSelection();await flush();draft=await core.clearChoice(draft,{queryId:selected.queryId,reviewer:part('reviewer').value,note:part('note').value});
      version++;renderSelected();applyFilter();renderHistory();remember();notice('Recorded choice removed. Its earlier history and unfinished form remain in the working file.');
    }));
    form.append(actions);area.append(form);on(form,'submit',event=>event.preventDefault());
    on(form,'input',()=>changed());on(form,'change',()=>{if(action.value==='keep-source')coordinate.value='preserve-source';changed();renderControls();});
    const candidatePanel=node('details');candidatePanel.append(node('summary','Complete candidate details ('+selected.candidates.length+')'));
    for(const c of selected.candidates){
      const card=node('article');card.className='candidate';
      card.append(node('h3',c.formatted??'Unformatted result'),facts([['Candidate',c.id],['Confidence',c.confidence],['Result type',c.resultType],['Match level',c.matchType],
        ['Provider coordinates',c.location],['Datasource',c.datasource],['Warnings',c.warnings]]),
        details('Source coordinates and displacement',c.sourceCoordinates),details('Complete original provider feature',c.raw));candidatePanel.append(card);
    }
    area.append(candidatePanel);renderSources();renderControls();
  }
  async function adopt(value,{fromRecovery=false,recovery}={}){
    let next;
    if(value?.draft){await core.inspectReturn(value,value.draft.project);value=value.draft;}
    if(value?.project){await core.inspectDraft(value);next=copy(value);}else next=await core.createDraft(value);
    if(fromRecovery)next=await core.saveWorking(next,{editor:recovery.editor,forms:recovery.forms});
    draft=next;forms=copy(draft.forms??{});editor=copy(draft.editor??{});indexProject();
    selected=rows.find(row=>row.queryId===editor.queryId)??null;
    offset=Number.isSafeInteger(editor.offset)?editor.offset:0;sourceOffset=Number.isSafeInteger(editor.sourceOffset)?editor.sourceOffset:0;
    part('search').value=typeof editor.search==='string'?editor.search:'';
    part('filter').value=['all','recorded','draft','unreviewed'].includes(editor.filter)?editor.filter:'all';
    part('return-reviewer').value=editor.returnReviewer??'';part('return-note').value=editor.returnNote??'';
    part('identity').replaceChildren(facts([['Review',draft.project.title],['For',draft.project.recipient],['Issued',draft.project.issuedAt],
      ['Frozen edition',draft.project.edition?.id],['Issued workspace revision',draft.project.workspaceRevision]]),
      details('Complete issued identity',{issueId:draft.project.id,sha256:draft.project.projectSha256,workspaceId:draft.project.workspaceId,
        intakeSha256:draft.project.intakeSha256,edition:draft.project.edition}));
    const invalid=draft.project.invalidRows??[];
    part('exceptions').replaceChildren();
    if(invalid.length)part('exceptions').append(details('Original source rows without an address query ('+invalid.length+')',invalid));
    version=fromRecovery?1:0;savedVersion=0;renderSelected();applyFilter();renderHistory();renderCounts();
  }
  function renderHistory(){
    part('history').replaceChildren(details('Complete recorded choice history ('+(draft.history?.length??0)+')',draft.history??[]),
      details('Current recorded choices',draft.choices??{}));
  }
  function csv(){
    const fields=['query_id','source_ordinal','source_identity','address_query','review_status','decision','candidate_id','coordinate_policy','reviewer','reason','source_record_json'];
    const cell=v=>{let s=v===undefined||v===null?'':String(v);if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    const output=[fields.map(cell).join(',')],byId=new Map(rows.map(row=>[row.queryId,row]));
    const originals=[...rows.flatMap(row=>row.sourceRows),...(draft.project.invalidRows??[])].sort((a,b)=>a.ordinal-b.ordinal);
    for(const original of originals){
      const row=byId.get(original.queryId),chosen=row?choice(row.queryId):null;
      output.push([row?.queryId??'',original.ordinal,original.identity,row?Object.values(row.params??{}).join(', '):'',
        row?status(row):'invalid-source',chosen?.action,chosen?.candidateId,chosen?.coordinateChoice,chosen?.reviewer,chosen?.note,JSON.stringify(original.source??original)].map(cell).join(','));
    }
    return output.join('\r\n')+'\r\n';
  }

  function detectRecovery(){
    pendingRecovery=null;
    try{
      const raw=storage?.getItem(key());if(!raw)return;
      const recovered=JSON.parse(raw);
      if(recovered.schema!=='geoapify.customer-review-recovery.v1'||recovered.draft?.project?.id!==draft.project.id||
        recovered.draft?.project?.projectSha256!==draft.project.projectSha256)return;
      const current={draft,editor,forms},previous={draft:recovered.draft,editor:recovered.editor,forms:recovered.forms};
      if(JSON.stringify(current)===JSON.stringify(previous))return;
      pendingRecovery=raw;
      part('recovery-message').textContent='A browser recovery copy from '+(recovered.savedAt??'an earlier session')+' is available for this issued review ('+
        Object.keys(recovered.draft.choices??{}).length+' recorded choices). Choose which complete version to use before editing.';
    }catch{notice('A browser recovery copy could not be read. Your displayed file remains complete; save working JSON to retain it.',true);}
  }
  async function recoverWorking(){
    requireRetainedSelection();
    if(!storage)throw new Error('Browser recovery storage is unavailable; open your saved working JSON.');
    if(version!==savedVersion)throw new Error('Save the displayed working review before recovering another version.');
    const raw=pendingRecovery??storage.getItem(key());if(!raw)throw new Error('No browser recovery copy exists for this issued review.');
    const recovered=JSON.parse(raw);
    if(recovered.schema!=='geoapify.customer-review-recovery.v1')throw new Error('This is not a complete browser recovery copy.');
    await core.inspectDraft(recovered.draft);
    if(recovered.draft.project.id!==draft.project.id||recovered.draft.project.projectSha256!==draft.project.projectSha256)throw new Error('The recovery copy belongs to another issued source.');
    await adopt(recovered.draft,{fromRecovery:true,recovery:recovered});pendingRecovery=null;
    remember();notice('Recovered complete working choices and unfinished forms. Save a working file to retain this version.');
  }

  root.replaceChildren();
  const top=node('header');top.className='bar';top.append(add(node('div'),node('h1','Address review'),node('p','Review the issued address matches. Save your work and return your recorded choices.')));
  root.append(top);const statusArea=node('div');statusArea.className='notice';statusArea.dataset.cr='notice';statusArea.setAttribute('role','status');statusArea.setAttribute('aria-live','polite');root.append(statusArea);
  const recoveryGate=node('section');recoveryGate.className='panel';recoveryGate.dataset.cr='recovery-gate';recoveryGate.hidden=true;
  const recoveryMessage=node('p');recoveryMessage.dataset.cr='recovery-message';recoveryGate.append(node('h2','Recover previous work'),recoveryMessage);
  const recoveryActions=node('div');recoveryActions.className='actions';recoveryActions.append(
    control('recover-pending','Recover browser draft',recoverWorking,{primary:true}),
    control('keep-displayed','Keep displayed file',async()=>{pendingRecovery=null;remember();notice('Displayed complete file selected. The browser recovery copy now follows this version.');}));
  recoveryGate.append(recoveryActions);root.append(recoveryGate);
  const content=node('div');content.dataset.cr='content';root.append(content);
  const identity=node('section');identity.className='panel';identity.dataset.cr='identity';content.append(identity);
  const openPanel=node('section');openPanel.className='panel';openPanel.id='cr-open-panel';openPanel.append(node('h2','Working file'));
  const file=input('file','file');file.accept='.json,application/json';file.setAttribute('aria-label','Complete working review JSON');
  const openActions=node('div');openActions.className='actions';openActions.append(file,
    control('open','Open working JSON',async()=>{
      const chosen=file.files?.[0];if(!chosen)throw new Error('Choose a complete working JSON file.');
      if(version!==savedVersion)throw new Error('Save the displayed working review before opening another file. Clear the file picker, save, then choose the file again.');
      if(chosen.size>MAX_FILE)throw new Error('The selected review exceeds the 256 MiB working-file limit.');
      const raw=await chosen.text();if(new TextEncoder().encode(raw).byteLength>MAX_FILE)throw new Error('The complete review exceeds the working-file limit.');
      const next=JSON.parse(raw);await adopt(next);file.value='';detectRecovery();remember();notice('Complete working file opened, including its original source, choices, unfinished forms and history.');
    }),
    control('clear-file','Clear file picker',async()=>{file.value='';notice('File picker cleared. The displayed working review is retained.');}),
    control('recover','Recover browser draft',recoverWorking));
  openPanel.append(openActions,node('p','Working JSON and HTML include the complete issued source, recorded choices, unfinished forms and history. Save before replacing the displayed review.'));
  const saveActions=node('div');saveActions.className='actions';
  saveActions.append(control('save-json','Save working JSON',async()=>{requireRetainedSelection();await flush();download(JSON.stringify(draft)+'\n',filename('-working.json'));savedVersion=version;remember();renderCounts();notice('Complete working JSON downloaded.');},{primary:true}),
    control('save-html','Save working HTML',async()=>{requireRetainedSelection();await flush();download(renderGeoapifyCustomerReviewDocument(draft,{runtimeBase64,title:draft.project.title??'Address review'}),filename('-working.html'),'text/html');savedVersion=version;remember();renderCounts();notice('Complete standalone working HTML downloaded.');}),
    control('save-csv','Export all source rows',async()=>{requireRetainedSelection();await flush();download(csv(),filename('-review.csv'),'text/csv');notice('Every original source row exported with its recorded choice. Complete original values remain in working JSON.');}));
  openPanel.append(saveActions);content.append(openPanel);
  const countArea=node('p');countArea.dataset.cr='counts';content.append(countArea);
  const grid=node('div');grid.className='grid';content.append(grid);const queryPanel=node('section');queryPanel.className='panel';queryPanel.append(node('h2','Original address queries'));
  const search=input('search','search');search.placeholder='Address, business, source record or query';search.setAttribute('aria-label','Search every original query and record');
  const filter=select('filter',[['all','All queries'],['unreviewed','Not reviewed'],['draft','Unfinished forms'],['recorded','Recorded choices']]);filter.setAttribute('aria-label','Review status');
  const filterForm=node('form');filterForm.className='filters';filterForm.append(search,filter,control('apply','Apply filter',async()=>{await flush();offset=0;applyFilter();remember();}));
  on(filterForm,'submit',event=>{event.preventDefault();void run(async()=>{await flush();offset=0;applyFilter();remember();});});
  queryPanel.append(filterForm);const queryList=node('div');queryList.dataset.cr='queries';queryPanel.append(queryList);
  const page=node('p');page.dataset.cr='page';queryPanel.append(page);const nav=node('div');nav.className='actions';
  nav.append(control('previous','Previous queries',async()=>{await flush();offset=Math.max(0,offset-pageSize);renderList();remember();}),
    control('next','Next queries',async()=>{await flush();offset+=pageSize;renderList();remember();}));queryPanel.append(nav);
  const detail=node('section');detail.className='panel';detail.dataset.cr='detail';grid.append(queryPanel,detail);
  const exceptions=node('section');exceptions.className='panel';exceptions.dataset.cr='exceptions';content.append(exceptions);
  const returnPanel=node('section');returnPanel.className='panel';returnPanel.append(node('h2','Return recorded choices'),node('p','The return includes your recorded choices, full original review, unfinished forms and history. The operator compares them with the current workspace before adoption.'));
  const returnReviewer=input('return-reviewer');returnReviewer.maxLength=200;const returnNote=node('textarea');returnNote.dataset.cr='return-note';returnNote.maxLength=4000;
  returnPanel.append(label('Your name for this return',returnReviewer),label('Return note',returnNote),
    control('return','Create complete return',async()=>{
      requireRetainedSelection();editor.returnReviewer=returnReviewer.value;editor.returnNote=returnNote.value;await flush();
      const returned=await core.createReturn(draft,{returnId:'return_'+crypto.randomUUID().replaceAll('-',''),returnedAt:now(),reviewer:returnReviewer.value,note:returnNote.value});
      download(JSON.stringify(returned)+'\n',filename('-'+returned.id+'.json'));remember();renderHistory();notice('Complete return downloaded. Send this JSON to the operator who issued the review. Save your working file to continue later.');
    },{primary:true}));
  for(const e of [returnReviewer,returnNote])on(e,'input',()=>{editor.returnReviewer=returnReviewer.value;editor.returnNote=returnNote.value;version++;renderCounts();scheduleRemember();});
  content.append(returnPanel);const history=node('section');history.className='panel';history.dataset.cr='history';content.append(history);
  on(file,'change',()=>{renderControls();notice(file.files?.length?'A local file is selected. Open it explicitly to replace the displayed review.':'File picker cleared.');});
  const unload=event=>{if(version!==savedVersion){remember();event.preventDefault();event.returnValue='';}};
  if(doc.defaultView)on(doc.defaultView,'beforeunload',unload);
  try{await adopt(value);detectRecovery();renderControls();notice('Complete issued review opened. Choose a query, record your choice, then save your working file.');}
  catch(error){content.inert=true;notice('The complete review could not be opened. '+error.message,true);throw error;}
  return {
    async snapshot(){if(busy)throw new Error('Wait for the active working-file operation.');return copy(await flush());},
    get state(){return {busy,dirty:version!==savedVersion,issueId:draft?.project?.id,queryId:selected?.queryId,choices:Object.keys(draft?.choices??{}).length};},
    destroy(){if(storageTimer!==null)clearTimeout(storageTimer);remember();disposed=true;for(const e of listeners)e.target.removeEventListener(e.type,e.fn);}
  };
}
