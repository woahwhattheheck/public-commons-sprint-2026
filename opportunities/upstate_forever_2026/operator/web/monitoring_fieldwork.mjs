/** Native Monitoring campaign to Implementation handoff on the original queue. */
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function attachMonitoringFieldwork(host) {
  let panel=null,workspace=null,generation=0;
  const busy=new Set();
  const selections=new Map(),results=new Map();
  const current=key=>host.getState()?.workspace_key===key;
  const resultFor=key=>results.get(key+':'+(selections.get(key)||''));
  async function refresh() {
    if(!panel||busy.has(workspace))return;
    const key=workspace,version=generation;
    const rows=await host.transport(key,'campaign.list',{});
    if(!panel||version!==generation||!current(key)||busy.has(key))return;
    const selected=selections.get(key)||'';
    panel.innerHTML='<h2>Campaign fieldwork</h2><p>Carry a saved campaign into Implementation with its original sites, calendar, planning costs, collected samples and source package.</p>'+
      '<label>Saved campaign <select data-monitoring-fieldwork-campaign><option value="">Choose a campaign</option>'+
      rows.map(row=>'<option value="'+escapeHTML(row.campaign_id)+'" data-revision="'+escapeHTML(row.id)+'"'+(row.campaign_id===selected?' selected':'')+'>'+
        escapeHTML(row.title)+' · revision '+escapeHTML(row.revision)+'</option>').join('')+'</select></label> '+
      '<button type="button" data-monitoring-fieldwork-send>Update fieldwork from this revision</button> '+
      '<button type="button" data-monitoring-fieldwork-open'+(resultFor(key)?'':' hidden')+'>Open saved fieldwork</button>'+
      '<p role="status" data-monitoring-fieldwork-status></p>';
    panel.querySelector('[data-monitoring-fieldwork-campaign]').onchange=event=>{
      selections.set(key,event.target.value);
      panel.querySelector('[data-monitoring-fieldwork-open]').hidden=!resultFor(key);
      panel.querySelector('[data-monitoring-fieldwork-status]').textContent='';
    };
    panel.querySelector('[data-monitoring-fieldwork-send]').onclick=()=>send().catch(error=>host.toast?.(error.message));
    panel.querySelector('[data-monitoring-fieldwork-open]').onclick=()=>open(resultFor(key)).catch(error=>host.toast?.(error.message));
  }
  async function open(result) {
    if(!result||!current(result.workspace_key))return;
    await host.openDesk('implementation','openSavedPlan',{
      workspace_key:result.workspace_key,plan_id:result.plan_id,revision:result.revision});
  }
  async function send() {
    if(!panel||busy.has(workspace))return;
    const choice=panel.querySelector('[data-monitoring-fieldwork-campaign]');
    const option=choice.selectedOptions[0],key=workspace,version=generation;
    if(!choice.value||!option?.dataset.revision)throw Error('Choose the saved campaign revision to carry into fieldwork.');
    const request={campaign_id:choice.value,expected_revision_id:option.dataset.revision};
    selections.set(key,choice.value);
    busy.add(key);
    const button=panel.querySelector('[data-monitoring-fieldwork-send]');
    button.disabled=true;choice.disabled=true;
    const status=panel.querySelector('[data-monitoring-fieldwork-status]');
    status.textContent='Retaining the selected campaign and its original source package…';
    try {
      const result=await host.transport(key,'campaign.fieldwork',request);
      results.set(key+':'+request.campaign_id,result);
      if(version!==generation||!panel||!current(key))return;
      const counts=result.counts||{},preserved=result.preserved_fieldwork_changes?.length||0;
      status.textContent='Saved '+(counts.sites||0)+' sites, '+(counts.visits||0)+' visits and '+
        (counts.activities||0)+' sample activities in fieldwork revision '+result.revision+
        (preserved?'. '+preserved+' fieldwork edits were preserved; the incoming campaign source remains attached.':'. The original campaign package is attached.');
      panel.querySelector('[data-monitoring-fieldwork-open]').hidden=false;
    } finally {
      busy.delete(key);
      if(button.isConnected)button.disabled=false;
      if(choice.isConnected)choice.disabled=false;
      if(version!==generation&&panel&&current(key))await refresh();
    }
  }
  async function mount(root,key) {
    generation++;workspace=key;
    panel?.remove();
    panel=root.ownerDocument.createElement('section');
    panel.className='monitoring-fieldwork-handoff';
    panel.setAttribute('aria-label','Campaign fieldwork');
    root.prepend(panel);
    try {await refresh();} catch(error) {if(panel)panel.textContent=error.message;}
  }
  function detach(){generation++;panel?.remove();panel=null;workspace=null;}
  return {mount,update:refresh,detach};
}
