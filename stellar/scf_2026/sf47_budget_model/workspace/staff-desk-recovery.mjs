import {staffDeskStorageKey} from './staff-session.mjs';

// Earlier unscoped copies remain untouched until the operator explicitly opens one.
export function mountEarlierStaffDesk({root,staffContext,title,readCopy,openCopy,describeCopy,
  downloadCopy,isBusy=()=>false,setDeskBusy=()=>{},filename='earlier-financial-desk.json'}){
  if(!staffContext?.installationId||!staffContext?.staffId)return {dispose(){}};
  staffDeskStorageKey('sf47.earlier-copy',staffContext);
  let active=true,busy=false,selected=null;
  if(!document.querySelector('link[data-staff-recovery-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/staff-recovery.css';
    link.dataset.staffRecoveryStyle='true';document.head.append(link);
  }
  const panel=document.createElement('details');panel.className='staff-earlier-desk';
  const heading=document.createElement('summary');heading.textContent='Earlier local '+title.toLowerCase()+' copy';
  const description=document.createElement('p');
  description.textContent='This desk saves work for '+(staffContext.displayName||staffContext.staffId)+
    ' in this installation. Inspect an earlier browser copy before choosing to open it here. Its original copy remains available.';
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const actions=document.createElement('div');actions.className='staff-recovery-actions';
  const inspect=document.createElement('button'),open=document.createElement('button'),download=document.createElement('button');
  for(const button of [inspect,open,download])button.type='button';
  inspect.textContent='Inspect earlier copy';open.textContent='Open this copy';download.textContent='Download complete earlier copy';
  actions.append(inspect,open,download);panel.append(heading,description,status,actions);root.before(panel);
  function controls(){
    for(const button of [inspect,open,download])button.disabled=busy;
    open.disabled=busy||selected===null;download.disabled=busy||selected===null;
  }
  const alive=()=>active&&panel.isConnected&&root.isConnected;
  async function perform(action,editing=false){
    if(!alive()||busy)return;
    if(isBusy()){status.textContent='Finish the current desk operation, then inspect or open the earlier copy.';return;}
    busy=true;if(editing)setDeskBusy(true);controls();
    try{await action();}
    catch(error){if(alive()){status.textContent=error.message||String(error);status.setAttribute('role','alert');}}
    finally{if(editing)setDeskBusy(false);busy=false;if(alive())controls();}
  }
  inspect.addEventListener('click',()=>void perform(async()=>{
    const found=await readCopy();if(!alive())return;
    selected=found===null||found===undefined?null:structuredClone(found);
    status.setAttribute('role','status');
    status.textContent=selected===null?'No earlier local copy was found for this case.':
      describeCopy?describeCopy(selected):'The complete earlier copy is available. Download it or open it as an editable desk.';
  }));
  download.addEventListener('click',()=>void perform(async()=>{
    if(selected===null)return;
    const captured=structuredClone(selected);
    if(downloadCopy)await downloadCopy(captured);
    else{
      const blob=new Blob([JSON.stringify(captured,null,2)+'\n'],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
    }
    if(alive()){status.setAttribute('role','status');status.textContent='Downloaded the complete selected earlier copy, including its retained original request.';}
  }));
  open.addEventListener('click',()=>void perform(async()=>{
    if(selected===null)return;
    const captured=structuredClone(selected);
    await openCopy(captured);
    if(alive()){status.setAttribute('role','status');status.textContent='Opened the selected copy in this operator’s desk. The earlier copy remains unchanged.';}
  },true));
  controls();
  return {dispose(){active=false;selected=null;panel.remove();}};
}
