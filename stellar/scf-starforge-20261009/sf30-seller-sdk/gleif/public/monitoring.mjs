// SPDX-License-Identifier: MIT
// Original company-research desk: explicit source mapping, same saved operation.
export function mountMonitoring({root,api,execute,request,getState,escape,notice}) {
  const e=escape;
  root.innerHTML='<h2>Prepare Monitoring counterparties</h2><p>Choose one original source edition and review the exact LegalEntity mapping. This prepares a private handover file for the existing Monitoring application.</p>'+
    '<form data-monitoring-form><label>Original source edition<select name="captureId" required></select></label>'+
    '<label>Company selection<select name="selection"><option value="included">Included shortlist for this edition</option><option value="all">All records in this edition</option></select></label>'+
    '<div class="two"><label>Stable Monitoring portfolio key<input name="portfolioKey" required maxlength="128" placeholder="Use the same key for later editions"></label><label>Portfolio title<input name="title" required maxlength="160" value="GLEIF research counterparties"></label></div>'+
    '<fieldset><legend>Optional fields to copy</legend><p>Name and LEI are always included. Full original fields and address roles remain in the project and mapping companion.</p>'+
    '<label><input type="checkbox" name="aliases"> Alternate and former names, distinguished by source type</label>'+
    '<label><input type="checkbox" name="registrationNumber"> Registration number, with original authority retained separately</label>'+
    '<label><input type="checkbox" name="entityStatus"> Entity status (ACTIVE or INACTIVE)</label>'+
    '<label><input type="checkbox" name="addresses"> Legal and headquarters address text</label></fieldset>'+
    '<div class="toolbar"><button type="submit">Review field mapping</button><button type="button" data-prepare disabled>Prepare complete Monitoring handover</button></div></form>'+
    '<div data-preview aria-live="polite"></div><div class="toolbar"><button data-prev type="button" hidden>Previous companies</button><button data-next type="button" hidden>Next companies</button></div>';
  const form=root.querySelector('[data-monitoring-form]'),panel=root.querySelector('[data-preview]'),prepare=root.querySelector('[data-prepare]');
  const field=name=>form.elements.namedItem(name);
  let workspace=null,preview=null,previewInput=null,turn=0,page=0;
  const values=()=>({captureIds:[field('captureId').value],selection:field('selection').value,
    portfolioKey:field('portfolioKey').value,title:field('title').value,
    fields:['aliases','registrationNumber','entityStatus','addresses'].filter(name=>field(name).checked)});
  const slot=()=>workspace+'/monitoring-portfolio-draft';
  const save=()=>{if(workspace)localStorage.setItem(slot(),JSON.stringify(values()));};
  const invalidate=()=>{turn++;preview=null;previewInput=null;prepare.disabled=true;panel.textContent='Review the current mapping before preparing.';};
  form.addEventListener('input',()=>{save();invalidate();});
  form.addEventListener('change',()=>{save();invalidate();});
  function render() {
    if(!preview)return;
    const rows=preview.entities.slice(page*50,page*50+50);
    panel.innerHTML='<h3>'+e(preview.options.title)+'</h3><p>'+preview.count+' original companies · portfolio '+e(preview.options.portfolioKey)+
      ' · schema LegalEntity</p><p>'+e(preview.interpretation)+'</p><div class="scroll"><table><thead><tr><th>Company / original LEI</th><th>Exact copied properties</th></tr></thead><tbody>'+
      rows.map(row=>'<tr><td>'+e(row.caption)+'<small>'+e(row.properties.leiCode[0])+'</small></td><td><pre>'+e(JSON.stringify(row.properties,null,2))+'</pre></td></tr>').join('')+
      '</tbody></table></div><p>Companies '+(page*50+1)+'–'+Math.min((page+1)*50,preview.count)+' of '+preview.count+'. The handover contains every selected record, eight complete attachments, original source pages and all prior research history.</p>'+
      '<p>Open the spreadsheet-safe CSV when using spreadsheet software. Receive the full handover in Monitoring → Counterparties; keep each application’s private connection separate.</p>';
    root.querySelector('[data-prev]').hidden=page===0;root.querySelector('[data-next]').hidden=(page+1)*50>=preview.count;
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();const input=values(),snapshot=JSON.stringify(input),id=workspace,generation=++turn;
    const current=()=>id===workspace&&generation===turn&&JSON.stringify(values())===snapshot;
    prepare.disabled=true;panel.textContent='Reading the original source and review versions…';
    try{const result=await api('/api/monitoring-preview',{method:'POST',body:input});if(!current())return;
      if(result.workspaceId!==workspace)throw Error('The returned preview belongs to another research project.');
      preview=result;previewInput=input;page=0;render();prepare.disabled=false;
    }catch(error){if(current()){panel.textContent=error.message;notice(error.message,true);}}
  });
  prepare.addEventListener('click',async()=>{
    if(!preview||JSON.stringify(values())!==JSON.stringify(previewInput))return;
    const input={...previewInput,expectedPreviewSha256:preview.previewSha256},id=workspace,generation=turn;
    prepare.disabled=true;
    try{await execute(request('monitoring.prepare',input));if(id===workspace&&generation===turn)notice('The complete Monitoring handover uses the original saved request. Its files appear under customer files when complete.');}
    catch(error){if(id===workspace&&generation===turn){prepare.disabled=false;notice(error.message,true);}}
  });
  root.querySelector('[data-prev]').addEventListener('click',()=>{if(page>0){page--;render();}});
  root.querySelector('[data-next]').addEventListener('click',()=>{if(preview&&(page+1)*50<preview.count){page++;render();}});
  return {refresh(state){
    if(!state)return;
    const changed=workspace!==state.workspace.id,old=field('captureId').value;workspace=state.workspace.id;
    const complete=state.captures.filter(value=>value.state==='COMPLETE');
    field('captureId').replaceChildren(...complete.map(value=>new Option(value.plan.query+' · '+value.createdAt,value.id)));
    if(complete.some(value=>value.id===old))field('captureId').value=old;
    if(changed){
      turn++;preview=null;previewInput=null;prepare.disabled=true;
      let draft;try{draft=JSON.parse(localStorage.getItem(slot())??'null');}catch{}
      if(draft){for(const name of ['selection','portfolioKey','title'])if(typeof draft[name]==='string')field(name).value=draft[name];
        if(complete.some(value=>value.id===draft.captureIds?.[0]))field('captureId').value=draft.captureIds[0];
        for(const name of ['aliases','registrationNumber','entityStatus','addresses'])field(name).checked=draft.fields?.includes(name)??false;}
    }
    if(preview&&JSON.stringify(values())!==JSON.stringify(previewInput))invalidate();
  }};
}
