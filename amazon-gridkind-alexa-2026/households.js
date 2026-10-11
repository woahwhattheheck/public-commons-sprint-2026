// Household navigation and retained decisions use the original server/planner.
// Imported historical results are rendered as data; applying inputs starts anew.
export function mountHouseholds({getState,isBusy,mutate,onProblem}){
  const $=id=>document.getElementById(id);
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const money=n=>Number.isFinite(n)?'$'+n.toFixed(4):'—';
  const hour=n=>Number.isInteger(n)?String(n).padStart(2,'0')+':00':'—';
  const date=value=>{const d=new Date(value);return Number.isFinite(d.valueOf())?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Saved record';};
  const kind={scenario:'Inputs',plan:'Plan',comparison:'Tariff comparison',approval:'Approval',execution:'Simulation',cancel:'Plan cleared',restore:'Restored inputs'};
  let key=null,householdId=null,page=null,detail=null,readRevision=0,importRevision=0,bundle=null,preview=null;
  function button(text,handler){const node=el('button',text,'secondary');node.type='button';node.dataset.mutates='true';node.onclick=handler;return node;}
  function download(value,filename){
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
    const link=el('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function read(path){const response=await fetch(path);const data=await response.json();if(!response.ok)throw Error(data.error||'Could not read saved work.');return data;}
  function status(text){$('workspace-status').textContent=text;}
  function renderHistory(){
    const list=$('household-history');list.replaceChildren();
    $('history-count').textContent=String(page?.total??0);
    for(const row of page?.records??[]){
      const item=el('button',undefined,'history-item');item.type='button';item.dataset.recordId=row.id;
      item.setAttribute('aria-pressed',String(detail?.id===row.id));
      item.append(el('span','#'+row.sequence+' / '+(kind[row.kind]||row.kind),'tag'),el('strong',row.label),el('span',date(row.createdAt)+(Number.isFinite(row.cost)?' · '+money(row.cost):''),'field-hint'));
      item.onclick=()=>openRecord(row.id);list.append(item);
    }
    $('history-newer').disabled=isBusy()||!page||page.offset===0;
    $('history-older').disabled=isBusy()||!page?.hasMore;
  }
  function table(headers,rows){
    const wrap=el('div',undefined,'saved-table-scroll'),table=el('table',undefined,'saved-table');
    const head=el('thead'),tr=el('tr');for(const title of headers)tr.append(el('th',title));head.append(tr);table.append(head);
    const body=el('tbody');for(const values of rows){const row=el('tr');for(const value of values)row.append(el('td',value));body.append(row);}table.append(body);wrap.append(table);return wrap;
  }
  function renderDetail(){
    const out=$('history-detail');out.replaceChildren();
    if(!detail){out.append(el('p','Open a saved record to inspect its inputs and result.','dim'));return;}
    out.append(el('div','#'+detail.sequence+' / '+(kind[detail.kind]||detail.kind),'tag'),el('h3',detail.label),el('p',date(detail.createdAt),'dim'));
    const scenario=detail.scenario;
    out.append(el('p',scenario.tasks.length+' loads · '+scenario.maxKw+' kW circuit limit','record-summary'));
    out.append(table(['Load','Window','Power'],scenario.tasks.map(t=>[t.label,hour(t.earliest)+'–'+hour(t.deadline),t.kw+' kW × '+t.hours+' h'])));
    const proposal=detail.state?.proposal;
    if(proposal){
      out.append(el('h4','Saved schedule'),el('p','Earliest feasible '+money(proposal.baseline?.cost)+' · Optimized '+money(proposal.optimized?.cost),'record-summary'));
      if(Array.isArray(proposal.optimized?.items))out.append(table(['Load','Start','End'],proposal.optimized.items.map(t=>[t.label,hour(t.start),hour(t.end)])));
      out.append(el('p','Recorded state: '+String(detail.state.status??detail.kind)+'. Plan '+proposal.id+'.','field-hint'));
    }
    if(detail.kind==='comparison'){
      out.append(el('h4','Saved alternative tariffs'));
      for(const [index,alt]of (detail.detail?.report?.alternatives??[]).entries()){
        const card=el('div',undefined,'saved-alternative');
        card.append(el('strong',alt.name),el('p','Keep schedule: '+money(alt.retainedScheduleCostUsd)+'\nReplan: '+money(alt.freshlyOptimizedCostUsd)+'\nOpportunity: '+money(alt.regretUsd),'record-summary'));
        if(Array.isArray(alt.moves)&&alt.moves.length)card.append(table(['Load','From','To'],alt.moves.map(m=>[m.label,hour(m.fromHour),hour(m.toHour)])));
        card.append(button('Use tariff '+(index+1)+' for a new plan',async()=>{
          const result=await mutate('adopt-tariff',{recordId:detail.id,alternativeIndex:index});
          if(result)status('Saved tariff applied to the household inputs. Plan and approve the new schedule.');
        }));out.append(card);
      }
    }
    const controls=el('div',undefined,'controls');
    controls.append(button('Use these saved inputs',async()=>{const result=await mutate('restore',{recordId:detail.id});if(result)status('Saved inputs reopened. Plan a fresh schedule to continue.');}));
    const exportButton=button('Download this record',()=>download(detail,'gridkind-record-'+detail.sequence+'.json'));delete exportButton.dataset.mutates;controls.append(exportButton);out.append(controls);
    const raw=el('details',undefined,'record-json');raw.append(el('summary','Inspect exact inputs and retained result'),el('pre',JSON.stringify(detail,null,2)));out.append(raw);
    out.append(el('p','Saved '+detail.sha256.slice(0,16)+'…','field-hint'));
    for(const b of out.querySelectorAll('[data-mutates]'))b.disabled=isBusy();
  }
  async function openRecord(id){
    const revision=++readRevision,home=householdId,generation=getState()?.workspace?.generation;
    try{
      const value=await read('/api/workspace/record?householdId='+encodeURIComponent(home)+'&id='+encodeURIComponent(id));
      if(revision!==readRevision||home!==householdId||generation!==getState()?.workspace?.generation)return;
      detail=value;renderHistory();renderDetail();$('history-detail').focus({preventScroll:true});
    }catch(error){onProblem(error);}
  }
  async function loadPage(offset){
    const revision=++readRevision,home=householdId,currentKey=key;
    try{
      const value=await read('/api/workspace/history?householdId='+encodeURIComponent(home)+'&offset='+offset);
      if(revision!==readRevision||home!==householdId||key!==currentKey)return;
      page=value;renderHistory();
    }catch(error){onProblem(error);}
  }
  function refresh(){
    const workspace=getState()?.workspace,disabled=isBusy()||!workspace;
    if(workspace){
      const next=workspace.selectedId+'/'+workspace.revision;
      if(next!==key){
        if(householdId!==workspace.selectedId){householdId=workspace.selectedId;detail=null;readRevision++;renderDetail();}
        key=next;page=workspace.history;
        const select=$('household-select');select.replaceChildren();
        for(const home of workspace.households){const option=el('option',home.name);option.value=home.id;option.selected=home.id===workspace.selectedId;select.append(option);}
        if(document.activeElement!==$('household-name'))$('household-name').value=workspace.selectedName;
        status(workspace.selectedName+' · '+workspace.history.total+' saved records. Opening another household retains a valid edited draft first.');
        renderHistory();
      }
      $('workspace-state').textContent=workspace.selectedName;
    }
    for(const id of ['household-select','household-name','household-create','household-rename','household-open','household-export','household-file'])$(id).disabled=disabled;
    $('household-import').disabled=disabled||!bundle||!preview;
    for(const b of $('history-detail').querySelectorAll('[data-mutates]'))b.disabled=disabled;
    $('history-newer').disabled=disabled||!page||page.offset===0;$('history-older').disabled=disabled||!page?.hasMore;
  }
  $('household-create').onclick=async()=>{const result=await mutate('create',{name:$('household-name').value.trim()||'New household'});if(result)status('New household created from the editor inputs. Plan its first schedule.');};
  $('household-rename').onclick=()=>mutate('rename',{name:$('household-name').value});
  $('household-open').onclick=async()=>{const result=await mutate('select',{householdId:$('household-select').value});if(result)status('Household reopened with its saved inputs and decision history. Plan a fresh schedule to continue.');};
  $('history-newer').onclick=()=>loadPage(Math.max(0,page.offset-page.limit));
  $('history-older').onclick=()=>loadPage(page.offset+page.limit);
  $('household-export').onclick=async()=>{
    if(isBusy())return;
    try{const data=await read('/api/workspace/export?householdId='+encodeURIComponent(householdId));download(data,'gridkind-household-'+data.payload.household.id.slice(0,8)+'.json');status('Complete household backup downloaded.');}
    catch(error){onProblem(error);}
  };
  $('household-file').onchange=async()=>{
    const revision=++importRevision,file=$('household-file').files?.[0];bundle=null;preview=null;refresh();
    if(!file)return;
    try{
      if(file.size>8*1024*1024)throw Error('Choose a household backup smaller than 8 MiB.');
      const candidate=JSON.parse(await file.text());
      if(revision!==importRevision)return;
      const data=await mutate('preview-import',{bundle:candidate});
      if(revision!==importRevision||!data)return;
      bundle=candidate;preview=data.preview;
      $('household-import-preview').textContent=preview.name+' · '+preview.records+' records · '+preview.plans+' plans · '+preview.comparisons+' tariff comparisons. Restore creates a separate household.';
    }catch(error){$('household-import-preview').textContent=error.message;onProblem(error);}
    finally{refresh();}
  };
  $('household-import').onclick=async()=>{
    if(!bundle||!preview)return;
    const result=await mutate('import',{bundle});
    if(result){bundle=null;preview=null;$('household-file').value='';$('household-import-preview').textContent='Backup restored. All saved records are available in the new household history.';refresh();}
  };
  return Object.freeze({refresh});
}
