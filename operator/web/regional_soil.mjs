/** Regional soil desk using the existing source workbench controls and task queue. */
import {createSourceWorkbench} from './source_workbench.mjs';

export function createRegionalSoilDesk(host) {
  return createSourceWorkbench(host, {
    namespace:'regional-soil',
    storageKey:'upstate-regional-soil-v1',
    prepareAction:'regional-soil.prepare',
    composeAction:'regional-soil.compose',
    title:'Regional soil',
    description:'Capture the original 217-HUC soil domain, continue retained acquisition, then prepare K and coverage on the numeric 30 m land-cover grid. Completed sources stay with this study.'
  });
}
