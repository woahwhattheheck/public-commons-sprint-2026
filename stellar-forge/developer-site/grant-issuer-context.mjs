// MIT. Compose complete issuer receiving into the original application and exporter.
import {stageIssuerProgramme,retainIssuerProgramme,receiveIssuerPlanning} from './dist/grant-issuer-source.mjs';
export const ISSUER_OPERATION='SCF-ISSUER-PREPARED-APPLICATION-94FE-20261013';
export const ISSUER_PROFILE_SCHEMA='stellar-forge.grant-issuer-receiving-profile.v1';
export const ISSUER_ROUTES=[
  ['/grant-issuer-core.mjs',['grant-issuer-core.mjs','text/javascript; charset=utf-8']],
  ['/grant-issuer-source.mjs',['grant-issuer-source.mjs','text/javascript; charset=utf-8']],
  ['/grant-issuer-workspace.mjs',['grant-issuer-workspace.mjs','text/javascript; charset=utf-8']],
];
const need=(value,message)=>{if(!value)throw new Error(message);};
export function validateIssuerReceivingProfile(profile){
  need(profile&&typeof profile==='object'&&!Array.isArray(profile),'Use a complete issuer receiving profile.');
  const keys=['schema','title','actor','note','sourceUrl','receivePlan'];
  need(Object.keys(profile).every(key=>keys.includes(key))&&profile.schema===ISSUER_PROFILE_SCHEMA,
    'Use the documented issuer receiving profile.');
  for(const key of ['title','actor','note','sourceUrl'])need(typeof profile[key]==='string','Record issuer receiving '+key+' as text.');
  need(profile.title.trim()&&profile.actor.trim(),'Name the issuer context and its recording operator.');
  need(typeof profile.receivePlan==='boolean','Choose explicitly whether to receive the original case-selected native plan.');
  return JSON.parse(JSON.stringify(profile));
}
export async function receiveIssuerContext(draft,bytes,profile,{filename='issuer-programme.zip',at=new Date().toISOString(),planningOptions={}}={}){
  const selected=validateIssuerReceivingProfile(profile);
  const staged=await stageIssuerProgramme(draft,bytes,{filename,at,planningOptions});
  Object.assign(staged.draft.handover.selection.issuerDraft,{title:selected.title,actor:selected.actor,note:selected.note,sourceUrl:selected.sourceUrl});
  const retained=await retainIssuerProgramme(staged.draft,{at,planningOptions});
  if(selected.receivePlan)retained.draft=await receiveIssuerPlanning(retained.draft,retained.context.id,{at,planningOptions});
  return {...retained,planningReceived:selected.receivePlan};
}
export function attachGrantIssuerContext(sourceIndex){
  need(sourceIndex?.schema==='stellar-forge.grant-reviewer-source-index.v1'&&sourceIndex.submission_workspace?.handover,
    'Attach issuer receiving to the original complete submission handover.');
  const result=JSON.parse(JSON.stringify(sourceIndex));
  result.submission_workspace.handover.issuer_programmes={
    schema:'stellar-forge.grant-issuer-context.v1',
    native_bundle_schema:'stellar-forge.sf47-operations.v1.bundle',
    native_terms_schema:'stellar-forge.sf47-award-terms.v1',
    native_correspondence_schema:'stellar-forge.issuer-correspondence.receiving.v1',
    route:'/grant-submission.html',view:'handover',operation:ISSUER_OPERATION,
    guide:'https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/developer-site/GRANT_ISSUER_CONTEXT.md',
    original_files:['operations.json','planning.zip','award-terms-selection.json','award-terms.html','award-terms.csv','sources/*'],
    selection:'Complete original Operations case, explicitly selected terms edition and native case-selected planning revision.',
    receiving:'The original editable draft retains full message sources, terms history, commissioning, prepared context and manual answer edits.',
  };
  return result;
}
export function registerGrantIssuerAssets(manifest){
  need(manifest?.schema==='stellar-forge.browser-assets.v1'&&Array.isArray(manifest.routes),'Use the original browser asset declaration.');
  const result=JSON.parse(JSON.stringify(manifest));
  for(const [route,entry]of ISSUER_ROUTES){
    const existing=result.routes.find(row=>row[0]===route);
    need(!existing||JSON.stringify(existing[1])===JSON.stringify(entry),'Reconcile the current issuer route '+route+'.');
    if(!existing)result.routes.push([route,entry]);
  }
  result.routes.sort((a,b)=>a[0].localeCompare(b[0]));return result;
}
