/** Original-host lifecycle binding. TokenJunkieLabs. */
import {attachScenarioAnalysis} from './scenario_analysis.mjs';

export function attachScenarioAnalysisExtension(host) {
  const desk=attachScenarioAnalysis(host);
  let node=null;
  return {
    mount(element) {
      node=element;
      node.innerHTML=desk.render();
      desk.mount(node);
    },
    update() { if(node)desk.update(); },
    detach() { node=null;desk.detach(); },
    dispatch:button=>desk.dispatch(button),
    create:request=>desk.create(request),
    createForSourceAreas:request=>desk.createForSourceAreas(request)
  };
}
