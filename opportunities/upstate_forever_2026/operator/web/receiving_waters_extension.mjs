import {attachReceivingWaters} from './receiving_waters.mjs';

/** Receiving-water workflow on the original operator's shared extension host. */
export function attachReceivingWatersExtension(context){
  const desk=attachReceivingWaters(context);
  let node=null,lastState=null,lastSummary=null;
  function summary(state){
    const data=state?.data||{},water=data.receiving_waters||data;
    return JSON.stringify({
      workspace:state?.workspace_key,
      catalogs:water.receiving_water_catalogs||[],
      plans:water.receiving_water_plans||[],
      analyses:water.receiving_water_analyses||[],
      monitoring:water.receiving_water_monitoring||[],
      runs:(data.runs||[]).map(row=>[row.id,row.state,row.selection]),
      profiles:(data.profiles||[]).map(row=>[row.id,row.title]),
      scenarios:(data.scenarios||[]).map(row=>[row.id,row.title||row.spec?.title]),
      tasks:(state?.tasks||[]).filter(row=>row.action?.startsWith('receiving.water.')).map(row=>[row.id,row.state,row.result,row.error])
    });
  }
  function paint(state=context.getState()){
    if(!node)return;
    lastState=state;lastSummary=summary(state);
    desk.detach();
    node.innerHTML=desk.render();
    desk.mount(node);
  }
  function mount(target,state=context.getState()){
    if(!target||typeof target.querySelector!=='function')throw Error('Receiving waters needs the original operator content element.');
    if(node&&node!==target)desk.detach();
    node=target;paint(state);
  }
  function update(state=context.getState()){
    if(!node||state===lastState)return;
    lastState=state;
    if(summary(state)!==lastSummary)paint(state);
  }
  function detach(){
    desk.detach();node=null;lastState=null;lastSummary=null;
  }
  return {
    mount,update,detach,dispatch:desk.dispatch,
    openPlan:desk.openPlan,openAnalysis:desk.openAnalysis,openCatalog:desk.openCatalog,
    createCatalog:desk.createCatalog,createPlan:desk.createPlan,analyze:desk.analyze,
    openDelivery:desk.openDelivery,
    taskActions:desk.taskActions,deliveryFields:desk.deliveryFields,deliverySelection:desk.deliverySelection
  };
}
