// MIT. Add review rounds to the existing SCF reader and installed browser assets.
export const REVIEW_ROUND_OPERATION = 'SCF-SUBMISSION-REVIEW-ROUND-7108-20261012';
export const REVIEW_ROUND_ROUTES = [
  ['/grant-review-working-copy.mjs',['grant-review-working-copy.mjs','text/javascript; charset=utf-8']],
  ['/grant-review-round.html',['grant-review-round.html','text/html; charset=utf-8']],
  ['/grant-review-round.css',['grant-review-round.css','text/css; charset=utf-8']],
  ['/grant-review-round-core.mjs',['grant-review-round-core.mjs','text/javascript; charset=utf-8']],
  ['/grant-review-round-workspace.mjs',['grant-review-round-workspace.mjs','text/javascript; charset=utf-8']],
];
export function attachGrantReviewRounds({templateHtml,sourceIndex}){
  if(typeof templateHtml!=='string'||!templateHtml.includes('<nav aria-label="Primary">'))throw new Error('Retain the original grant reader and its primary navigation.');
  if(sourceIndex?.schema!=='stellar-forge.grant-reviewer-source-index.v1'||!sourceIndex.application?.sha256)throw new Error('Retain the original complete application source index.');
  const marker='data-grant-review-round="v1"';
  let html=templateHtml;
  if(!html.includes(marker))html=html.replace('<nav aria-label="Primary">','<nav aria-label="Primary"><a '+marker+' href="./grant-review-round.html">Review prepared draft</a>');
  const index=JSON.parse(JSON.stringify(sourceIndex));
  index.submission_review_round={
    schema:'stellar-forge.grant-review-round-integration.v1',route:'/grant-review-round.html',submission_route:'/grant-submission.html',
    application_sha256:index.application.sha256,application_git_blob:index.application.git_blob,
    draft_schema:'stellar-forge.grant-submission-draft.v1',draft_export_schema:'stellar-forge.grant-submission-export.v1',
    review_schema:'stellar-forge.grant-review-round.v1',review_export_schema:'stellar-forge.grant-review-round-export.v1',
    working_schema:'stellar-forge.grant-review-working-copy.v1',working_export_schema:'stellar-forge.grant-review-working-export.v1',
    operation:REVIEW_ROUND_OPERATION,
    guide:'https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/developer-site/GRANT_REVIEW_ROUNDS.md',
  };
  return {templateHtml:html,sourceIndex:index};
}
export function registerGrantReviewRoundAssets(manifest){
  if(manifest?.schema!=='stellar-forge.browser-assets.v1'||!Array.isArray(manifest.routes))throw new Error('Use the original browser asset declaration.');
  const result=JSON.parse(JSON.stringify(manifest));
  for(const [route,entry]of REVIEW_ROUND_ROUTES){
    const current=result.routes.find(x=>x[0]===route);
    if(current&&JSON.stringify(current[1])!==JSON.stringify(entry))throw new Error('Reconcile the existing review asset for '+route+'.');
    if(!current)result.routes.push([route,entry]);
  }
  result.routes.sort((a,b)=>a[0].localeCompare(b[0]));return result;
}
/** Apply through the current submission-page owner; preserve the complete editor body. */
export function attachReviewRoundToSubmission(templateHtml){
  if(typeof templateHtml!=='string'||!templateHtml.includes('<nav aria-label="Main navigation">'))throw new Error('Retain the original submission editor and its navigation.');
  const marker='data-submission-review-round="v1"';
  return templateHtml.includes(marker)?templateHtml:templateHtml.replace('<nav aria-label="Main navigation">','<nav aria-label="Main navigation"><a '+marker+' href="./grant-review-round.html">Review prepared draft</a>');
}
