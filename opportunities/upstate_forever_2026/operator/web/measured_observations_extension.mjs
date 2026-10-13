import {mountMeasuredChemistry} from './measured_chemistry.mjs';
import {mountCollectionPanel} from './measured_collections.mjs';
import {mountMeasurements} from './measured_observations.mjs';
/** Existing extension-host lifecycle, authenticated API and Workspace selection. */
export function createMeasuredObservations(host){
  const {api,getWorkspace}=host,chemistryMemory=new Map();
  let instance=null,collections=null,chemistry=null,root=null,key=null;
  const request=async(path,method='GET',payload)=>{
    const value=await api('/api/measurements/rpc',{method:'POST',body:{workspace:getWorkspace(),path,method,payload}});
    return {ok:value.status<400,status:value.status,type:value.content_type,text:async()=>value.body};
  };
  function mount(host){
    if(root===host&&key===getWorkspace()&&instance)return;
    suspend();root=host;key=getWorkspace();
    const outer=document.createElement('div');root.replaceChildren(outer);
    const binding=document.createElement('details');binding.className='mw-domain-binding';
    binding.style.cssText='padding:18px;background:#f3f3f3;border:1px solid #cecece;font:14px system-ui';
    binding.innerHTML='<summary>Bind an original native reach or HUC source</summary><p>Read IDs from a retained Workspace JSON/GeoJSON source. This does not infer station drainage relationships.</p><form style="display:grid;gap:8px"><label>Original workspace-relative source file <input name="source_path" required style="width:100%"></label><label>List field path, e.g. features <input name="items_path" style="width:100%"></label><label>ID field path, e.g. properties.HUC12 <input name="id_path" style="width:100%"></label><label>Name field path, optional <input name="name_path" style="width:100%"></label><button>Read original identifiers</button></form><p role="status"></p>';
    outer.append(binding);const chemistryHost=document.createElement('section');outer.append(chemistryHost);chemistry=mountMeasuredChemistry(chemistryHost,host,{memory:chemistryMemory});const collectionHost=document.createElement('section');outer.append(collectionHost);collections=mountCollectionPanel(collectionHost,{request,refresh:()=>instance?.refresh()});const component=document.createElement('div');outer.append(component);
    binding.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const status=binding.querySelector('[role=status]');try{const result=await api('/api/measurements/domain',{method:'POST',body:{workspace:getWorkspace(),...Object.fromEntries(new FormData(event.target))}});status.textContent=`${result.count} original identifiers registered; source SHA-256 ${result.source_sha256}`;await instance.refresh();}catch(error){status.textContent=error.message;}});
    instance=mountMeasurements(component,{transport:request,css:'/web/measured_observations.css'});
  }
  function suspend(){chemistry?.destroy();chemistry=null;collections?.destroy();collections=null;instance?.destroy();instance=null;root=null;key=null;}
  return {mount,update(){if(root&&key!==getWorkspace())mount(root);},suspend};
}
