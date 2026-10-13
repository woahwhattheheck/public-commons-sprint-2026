/** Original-host lifecycle binding. TokenJunkieLabs. */
import {attachScenarioAnalysis} from './scenario_analysis.mjs';

export function attachScenarioAnalysisExtension(host) {
  const desk=attachScenarioAnalysis(host);
  let node=null,pending=null;
  const workspace=()=>host.getState()?.workspace_key;
  async function applyPending(){
    const request=pending;
    if(!node||!request)return;
    if(request.workspace!==workspace()){pending=null;return;}
    pending=null;
    await desk.dispatch({dataset:{action:'analysis-open',id:request.id}});
  }
  async function open(id,options={}){
    if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('Choose an original saved scenario analysis.');
    const selectedWorkspace=options.workspace_key||workspace();
    if(!selectedWorkspace||selectedWorkspace!==workspace())throw Error('Open the saved scenario analysis in its original workspace.');
    if(!(host.getState()?.data?.scenario_analyses||[]).some(row=>row.id===id))throw Error('This saved analysis is absent from the current workspace.');
    const request={id,workspace:selectedWorkspace};
    pending=request;
    try{await host.navigate('scenario-analysis');}
    catch(error){if(pending===request)pending=null;throw error;}
    if(workspace()!==selectedWorkspace){if(pending===request)pending=null;throw Error('The workspace changed while opening its saved analysis.');}
    if(node&&pending===request)await applyPending();
    return {workspace_key:selectedWorkspace,analysis_id:id};
  }
  return {
    mount(element) {
      node=element;
      node.innerHTML=desk.render();
      desk.mount(node);
      applyPending().catch(error=>host.toast?.(error.message||String(error)));
    },
    update() { if(node)desk.update(); },
    detach() { node=null;desk.detach(); },
    dispatch:button=>desk.dispatch(button),
    create:request=>desk.create(request),
    createForSourceAreas:request=>desk.createForSourceAreas(request),
    open
  };
}
