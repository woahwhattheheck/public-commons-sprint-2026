import {ISSUER_ROUTES,attachGrantIssuerContext} from './grant-issuer-context.mjs';
// MIT. Add the handover to the original submission/editor asset composition.
export const HANDOVER_OPERATION='SCF-SUBMISSION-HANDOVER-1B40-20261012';
export const HANDOVER_ROUTES=[
  ...ISSUER_ROUTES,
  ['/grant-handover-core.mjs',['grant-handover-core.mjs','text/javascript; charset=utf-8']],
  ['/grant-handover-source.mjs',['grant-handover-source.mjs','text/javascript; charset=utf-8']],
  ['/grant-handover-workspace.mjs',['grant-handover-workspace.mjs','text/javascript; charset=utf-8']],
];
export function attachGrantHandover(sourceIndex) {
  if(sourceIndex?.schema!=='stellar-forge.grant-reviewer-source-index.v1'||
    sourceIndex.submission_workspace?.draft_schema!=='stellar-forge.grant-submission-draft.v1')
    throw new Error('Attach handover to the complete original submission workspace.');
  const result=JSON.parse(JSON.stringify(sourceIndex));
  result.submission_workspace.handover={
    schema:'stellar-forge.grant-submission-handover.v1',
    prepared_schema:'stellar-forge.grant-prepared-submission.v1',
    source_bundle_schema:'stellar-forge.grant-reviewer-source-bundle.v1',
    observation_schema:'stellar-forge.grant-submission-return.v1',
    route:'/grant-submission.html',view:'handover',
    operation:HANDOVER_OPERATION,
    export_schema:'stellar-forge.grant-submission-export.v1',
    original_files:['/grant-data/application.md','/grant-data/source-index.json','/grant-data/budget.csv','/grant-data/product-and-finance.md'],
    guide:'https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/developer-site/GRANT_HANDOVER.md',
    meaning:'Exact source/evidence, prepared output and operator-recorded issuer observations inside the original editable draft. No automatic issuer action.',
  };
  return attachGrantIssuerContext(result);
}
export function registerGrantHandoverAssets(manifest) {
  if(manifest?.schema!=='stellar-forge.browser-assets.v1'||!Array.isArray(manifest.routes))
    throw new Error('Use the original complete browser asset declaration.');
  const result=JSON.parse(JSON.stringify(manifest));
  for(const [route,entry]of HANDOVER_ROUTES) {
    const current=result.routes.find(row=>row[0]===route);
    if(current&&JSON.stringify(current[1])!==JSON.stringify(entry))
      throw new Error('Reconcile the current selected source for '+route+'.');
    if(!current)result.routes.push([route,entry]);
  }
  result.routes.sort((a,b)=>a[0].localeCompare(b[0]));return result;
}
