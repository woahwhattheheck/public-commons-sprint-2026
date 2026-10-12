// MIT. Small original-Research navigation control; no second Dossier state.
export function installZoteroResearchControl({container,open,status,onError=()=>{}}) {
  let disposed=false,busy=false,epoch=0;
  const section=document.createElement('section'),title=document.createElement('h2'),description=document.createElement('p');
  title.textContent='Zotero library sources';
  description.textContent='Capture or receive an original Zotero library edition, review its collection project, and return a complete source bundle to this Research workspace.';
  const button=document.createElement('button');button.type='button';button.textContent='Open Zotero library workspace';
  const target=document.createElement('div');
  section.append(title,description,button,target);container.append(section);
  button.onclick=async()=>{
    if(disposed||busy)return;busy=true;button.disabled=true;const selectedEpoch=epoch;
    try{
      const result=await open();
      if(disposed||selectedEpoch!==epoch)return;
      const url=new URL(result.url);
      if(!result.active||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||
        url.search||url.username||url.password||!/^#token=[a-f0-9]{64}$/.test(url.hash))throw new Error('Zotero workspace connection is not current.');
      const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener';link.textContent='Continue in Zotero workspace';
      target.replaceChildren(link);
    }catch(error){if(!disposed)onError(error);}finally{busy=false;if(!disposed)button.disabled=false;}
  };
  async function refresh(){
    const selectedEpoch=++epoch,result=await status();
    if(disposed||selectedEpoch!==epoch)return;
    section.hidden=!result.configured;target.replaceChildren();
  }
  return {refresh,profileChanged(){epoch++;target.replaceChildren();},dispose(){disposed=true;epoch++;target.replaceChildren();section.remove();}};
}
