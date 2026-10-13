// MIT. Complete saved-project desk on the original shared draft store.
export const SAVED_PROJECTS_OPERATION='SCF-SAVED-PROJECT-LIBRARY-5403-20261013';
export const SAVED_PROJECT_ROUTES=[
 ['/saved-projects.html',['saved-projects.html','text/html; charset=utf-8']],
 ['/saved-projects.mjs',['saved-projects.mjs','text/javascript; charset=utf-8']],
 ['/saved-projects.css',['saved-projects.css','text/css; charset=utf-8']],
 ['/saved-project-library.mjs',['saved-project-library.mjs','text/javascript; charset=utf-8']],
];
export function registerSavedProjectAssets(manifest){
 if(manifest?.schema!=='stellar-forge.browser-assets.v1'||!Array.isArray(manifest.routes))throw new Error('Use the original browser asset declaration.');
 const result=JSON.parse(JSON.stringify(manifest));
 for(const [route,entry]of SAVED_PROJECT_ROUTES){
  const existing=result.routes.find(row=>row[0]===route);
  if(existing&&JSON.stringify(existing[1])!==JSON.stringify(entry))throw new Error('Reconcile the existing saved-project asset '+route+'.');
  if(!existing)result.routes.push([route,entry]);
 }
 return result;
}
export function attachSavedProjects(templateHtml){
 if(typeof templateHtml!=='string')throw new Error('Use the complete original page.');
 if(templateHtml.includes('data-saved-projects="v1"'))return templateHtml;
 const match=/<nav\s+aria-label="(?:Primary|Main navigation|Workspace navigation)"[^>]*>/.exec(templateHtml);
 if(!match)throw new Error('Retain the original page navigation before attaching Saved projects.');
 return templateHtml.replace(match[0],match[0]+'<a data-saved-projects="v1" href="./saved-projects.html">Saved projects</a>');
}
