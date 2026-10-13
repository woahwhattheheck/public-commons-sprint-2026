import {HANDOVER_ROUTES,attachGrantHandover} from './grant-handover.mjs';
// MIT. Connect the complete submission workspace to the existing grant composer.
export const SUBMISSION_OPERATION = 'SCF-SUBMISSION-WORKSPACE-22B705-20261012';
export const SUBMISSION_ROUTES = [
  ['/grant-operating-plan-core.mjs',['grant-operating-plan-core.mjs','text/javascript; charset=utf-8']],
  ['/grant-operating-plan-workspace.mjs',['grant-operating-plan-workspace.mjs','text/javascript; charset=utf-8']],
  ['/stellar/scf-starforge-20261009/distribution/discovery/catalog.mjs',['../../../stellar/scf-starforge-20261009/distribution/discovery/catalog.mjs','text/javascript; charset=utf-8']],
  ['/stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs',['../../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs','text/javascript; charset=utf-8']],
  ['/stellar/scf-starforge-20261009/distribution/discovery/operating-plan-return.mjs',['../../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan-return.mjs','text/javascript; charset=utf-8']],
  ["/grant-product-sources-core.mjs",["grant-product-sources-core.mjs","text/javascript; charset=utf-8"]],
  ["/grant-product-authoring-core.mjs",["grant-product-authoring-core.mjs","text/javascript; charset=utf-8"]],
  ["/grant-product-authoring-source.mjs",["grant-product-authoring-source.mjs","text/javascript; charset=utf-8"]],
  ["/grant-product-authoring-workspace.mjs",["grant-product-authoring-workspace.mjs","text/javascript; charset=utf-8"]],
  ["/grant-product-authoring.css",["grant-product-authoring.css","text/css; charset=utf-8"]],
  ...HANDOVER_ROUTES,
  ['/grant-submission.html',['grant-submission.html','text/html; charset=utf-8']],
  ['/grant-submission.css',['grant-submission.css','text/css; charset=utf-8']],
  ['/grant-submission-core.mjs',['grant-submission-core.mjs','text/javascript; charset=utf-8']],
  ['/grant-submission-workspace.mjs',['grant-submission-workspace.mjs','text/javascript; charset=utf-8']],
  ['/grant-plan-core.mjs',['grant-plan-core.mjs','text/javascript; charset=utf-8']],
  ['/grant-plan-source.mjs',['grant-plan-source.mjs','text/javascript; charset=utf-8']],
  ['/grant-plan-workspace.mjs',['grant-plan-workspace.mjs','text/javascript; charset=utf-8']],
  ['/grant-plan-update-core.mjs',['grant-plan-update-core.mjs','text/javascript; charset=utf-8']],
  ['/grant-plan-update-workspace.mjs',['grant-plan-update-workspace.mjs','text/javascript; charset=utf-8']],
];
export function attachGrantSubmission({templateHtml,sourceIndex}){
  if(typeof templateHtml!=='string'||!templateHtml.includes('<nav aria-label="Primary">'))throw new Error('Retain the existing application reader and its primary navigation.');
  if(sourceIndex?.schema!=='stellar-forge.grant-reviewer-source-index.v1'||!sourceIndex.application?.sha256)throw new Error('Retain the original complete application source index.');
  let html=templateHtml;
  const marker='data-grant-submission="v1"';
  if(!html.includes(marker))html=html.replace('<nav aria-label="Primary">','<nav aria-label="Primary"><a '+marker+' href="./grant-submission.html">Prepare submission</a>');
  const index=JSON.parse(JSON.stringify(sourceIndex));
  index.submission_workspace={
    schema:'stellar-forge.grant-submission-workspace.v1',
    route:'/grant-submission.html',application_route:'/grant-data/application.md',source_index_route:'/grant-data/source-index.json',
    application_sha256:index.application.sha256,application_git_blob:index.application.git_blob,
    draft_schema:'stellar-forge.grant-submission-draft.v1',export_schema:'stellar-forge.grant-submission-export.v1',
    form_map_schema:'stellar-forge.grant-form-map.v1',operation:SUBMISSION_OPERATION,
    planning:{source_schema:'stellar-forge.grant-plan-source.v1',review_schema:'stellar-forge.grant-plan-review.v1',update_schema:'stellar-forge.grant-plan-update.v1',target_schema:'stellar-forge.grant-plan-target.v1',native_schema:'stellar-forge.sf47-planning.v1',formats:['json','zip'],operation:'SCF-PLAN-SUBMISSION-INTEGRATION-7F5A-20261012'},
    product_sources:{schema:'stellar-forge.grant-product-authoring.v1',
      registration_schema:'stellar-forge.grant-product-registration.v1',
      route:'/grant-submission.html',view:'products',
      guide:'https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/developer-site/GRANT_PRODUCT_AUTHORING.md'},
    guide:'https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/developer-site/GRANT_SUBMISSION.md',
  };
  return {templateHtml:html,sourceIndex:attachGrantHandover(index)};
}
/** Preserve every current route and append the selected submission assets once. */
export function registerGrantSubmissionAssets(manifest){
  if(manifest?.schema!=='stellar-forge.browser-assets.v1'||!Array.isArray(manifest.routes))throw new Error('Use the original browser-assets declaration.');
  const result=JSON.parse(JSON.stringify(manifest));
  for(const [route,entry]of SUBMISSION_ROUTES){
    const current=result.routes.find(x=>x[0]===route);
    if(current&&JSON.stringify(current[1])!==JSON.stringify(entry))throw new Error('Reconcile the existing source for '+route+' before replacing it.');
    if(!current)result.routes.push([route,entry]);
  }
  result.routes.sort((a,b)=>a[0].localeCompare(b[0]));
  return result;
}
