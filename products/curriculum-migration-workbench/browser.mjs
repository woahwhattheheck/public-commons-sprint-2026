// MIT. Compose the original exact browser application with the managed command transport.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const SOURCE_PATHS=["CURRICULUM_COVERAGE.md","CURRICULUM_MIGRATION.md","LICENSE.OAK","README.md","SDK_GUIDE.md","cli.mjs","complete-receiving.mjs","curriculum-coverage.mjs","curriculum-migration-workbench-bootstrap.html","curriculum-migration-workbench.html","curriculum-migration.mjs","curriculum-panel.mjs","generate-sdk.mjs","initial-workspace.json","model.mjs","public-source.json.gz.json","run-receiving.py","styles.css","ui.js","zip.js"];
function replaceOne(source,before,after){
 if(source.split(before).length!==2)throw Error('Original managed browser anchor differs: '+before.slice(0,100));
 return source.replace(before,()=>after);
}
function functionReplace(source,name,next){
 const start=source.indexOf('function '+name+'('),asyncStart=source.slice(Math.max(0,start-6),start)==='async '?start-6:start;
 if(start<0)throw Error('Original function is missing: '+name);
 const nextFunction=source.indexOf('\nfunction ',start+1),nextAsync=source.indexOf('\nasync function ',start+1);
 const end=Math.min(...[nextFunction,nextAsync,source.indexOf('\nboot();',start+1)].filter(i=>i>=0));
 if(!Number.isFinite(end))throw Error('Original function end is absent: '+name);
 return source.slice(0,asyncStart)+next+source.slice(end);
}
function adaptedPanel(source){
 let panel=replaceOne(source,
  "export function mountCurriculumPlanner(container,{getWorkspace,onWorkspace,actor,now=()=>new Date().toISOString()})",
  "export function mountCurriculumPlanner(container,{getWorkspace,onWorkspace,actor,initialDraft,now=()=>new Date().toISOString()})");
 const init="  const root=doc.createElement('section');";
 panel=replaceOne(panel,init,"  if(initialDraft){selectedCase=initialDraft.selectedCase;selectedPlan=initialDraft.selectedPlan;draftMappings=JSON.parse(JSON.stringify(initialDraft.draftMappings||[]));draftNamespaces={...initialDraft.draftNamespaces};draftNote=initialDraft.draftNote||'';page=initialDraft.page||0;filter=initialDraft.filter||'all';}\n"+init);
 panel=replaceOne(panel,
  "return {refresh:render,destroy(){disposed=true;root.remove();style.remove();}};",
  "return {refresh:render,snapshot(){return JSON.parse(JSON.stringify({selectedCase,selectedPlan,draftMappings,draftNamespaces,draftNote,page,filter}));},destroy(){disposed=true;root.remove();style.remove();}};");
 return panel.replace("import {planCurriculumCase,decideCurriculumPlan,curriculumPortfolio,curriculumReviewRows} from './curriculum-migration.mjs';",
 "const {planCurriculumCase,decideCurriculumPlan,curriculumPortfolio,curriculumReviewRows}=Curriculum;")
 .replace('export function mountCurriculumPlanner','function mountCurriculumPlanner');
}
function adaptedUi(originalUi){
 let ui=functionReplace(originalUi,'save',"async function save(next,message='Saved'){return Managed.save(next,message);}");
 ui=functionReplace(ui,'exportWorkspace',"async function exportWorkspace(){return Managed.exportWorkspace();}");
 ui=functionReplace(ui,'receiveFile',"async function receiveFile(file){return Managed.receiveFile(file);}");
 ui=functionReplace(ui,'boot',"async function boot(){return Managed.boot();}");
 ui=replaceOne(ui,"function render(){","function render(){\n Managed.capture();");
 ui=replaceOne(ui,"else renderOverview();\n}","else renderOverview();\n Managed.restore();Managed.queueDraftSave();\n}");
 ui=replaceOne(ui,"  actor:()=>$('#engineer').value.trim(),","  actor:()=>$('#engineer').value.trim(),\n  initialDraft:Managed.panelDraft(),");
 ui=replaceOne(ui,"   save(next,'Curriculum migration plan and history saved.');","   return save(next,'Curriculum migration plan and history saved.');");
 ui=replaceOne(ui,"const lane=b.dataset.saveResponse;save(","const lane=b.dataset.saveResponse;return save(");
 ui=replaceOne(ui,"$('#compare').onclick=action(()=>{save(","$('#compare').onclick=action(()=>{return save(");
 ui=replaceOne(ui,"if(f)save(Model.addEdition","if(f)await save(Model.addEdition");
 ui=replaceOne(ui,"$('#create-case').onclick=action(()=>{const id=uid('case');save(","$('#create-case').onclick=action(async()=>{const id=uid('case');await save(");
 ui=replaceOne(ui,"contractId=$('#contract-edition').value;renderContracts();","contractId=$('#contract-edition').value;render();");
 ui=replaceOne(ui,
  "const body=JSON.parse(await f.text()),lane=input.dataset.responseFile;$('#'+lane+'-body').value=json(body);$('#'+lane+'-source').value=f.name;$('#'+lane+'-kind').value='operator-file';",
  "const lane=input.dataset.responseFile,bodyField=$('#'+lane+'-body'),sourceField=$('#'+lane+'-source'),kindField=$('#'+lane+'-kind'),loaded=await Managed.readFileText(f);Managed.assertContext(loaded.context);if(!input.isConnected||!bodyField.isConnected||!sourceField.isConnected||!kindField.isConnected)throw Error('The original response editor changed. Reopen this file in the intended case.');const body=JSON.parse(loaded.text);bodyField.value=json(body);sourceField.value=f.name;kindField.value='operator-file';Managed.queueDraftSave();");
 ui=replaceOne(ui,
  "if(f){$('#asset-name').value=f.name;$('#asset-content').value=await f.text();notice(",
  "if(f){const nameField=$('#asset-name'),bodyField=$('#asset-content'),loaded=await Managed.readFileText(f);Managed.assertContext(loaded.context);if(!nameField.isConnected||!bodyField.isConnected)throw Error('The original source editor changed. Reopen this file in the intended branch.');nameField.value=f.name;bodyField.value=loaded.text;Managed.queueDraftSave();notice(");
 ui=replaceOne(ui,
  "if(f)await save(Model.addEdition(workspace,JSON.parse(await f.text()),now()),'New contract edition received.');",
  "if(f){const loaded=await Managed.readFileText(f);Managed.assertContext(loaded.context);await save(Model.addEdition(workspace,JSON.parse(loaded.text),now()),'New contract edition received.');}");
 ui=replaceOne(ui,"const dialog=$('#new-dialog'),e=workspace.editions.at(-1);","const dialog=$('#new-dialog'),e=workspace.editions.at(-1),openingContext=Managed.captureContext();");
 ui=replaceOne(ui,"$('#create-case').onclick=action(async()=>{const id=uid('case');","$('#create-case').onclick=action(async()=>{Managed.assertContext(openingContext);const id=uid('case');");
 return ui;
}
export function composeManagedPage({originalHtml,originalUi,originalPanel,runtime,identity,sourceSha256}){
 if(!identity?.id||typeof identity.directory!=='string'||!sourceSha256)throw Error('Managed browser identity is required.');
 const config={storeId:identity.id,directory:identity.directory,sourceSha256,sourcePaths:SOURCE_PATHS};
 const embedded=JSON.stringify(config).replace(/</g,'\\u003c');
 let page=replaceOne(originalHtml,originalUi,adaptedUi(originalUi));
 const start=page.indexOf('const CurriculumPanel=(()=>{'),end=page.indexOf('\nconst STORAGE=',start);
 if(start<0||end<0)throw Error('Original curriculum panel envelope differs.');
 const panel='const CurriculumPanel=(()=>{'+adaptedPanel(originalPanel)+'\nreturn {mountCurriculumPlanner};})();';
 page=page.slice(0,start)+'const CURRICULUM_MANAGED_CONFIG='+embedded+';\n'+runtime+'\n'+panel+page.slice(end);
 const controls='<section id="managed-controls" aria-label="Managed workspace"><div class="managed-row"><strong id="managed-identity"></strong><label>Workspace branch<select id="managed-branches"></select></label><button id="managed-copy" type="button">Create working copy</button><button id="managed-reopen" type="button">Reopen current revision</button><button id="managed-recover" type="button">Recover original request</button></div><p id="managed-draft-status" role="status"></p><div class="managed-row"><button id="managed-inspect-current" type="button">Inspect current saved values</button><button id="managed-export-draft" type="button">Export retained forms</button><button id="managed-rebase-draft" type="button" hidden>Use retained form on this revision</button><button id="managed-discard-draft" type="button">Discard current form</button></div></section>';
 page=replaceOne(page,'<div class="stats">',controls+'<div class="stats">');
 page=replaceOne(page,'</style>','#managed-controls{border:1px solid #aaa;padding:12px;margin-top:16px;background:#f7f7f7}.managed-row{display:flex;align-items:end;gap:8px;flex-wrap:wrap}.managed-row label{flex:1;min-width:180px}.managed-row strong{flex-basis:100%;overflow-wrap:anywhere}#managed-draft-status{margin:12px 0;font-weight:500}button[hidden]{display:none}@media(max-width:650px){.managed-row{display:grid;grid-template-columns:minmax(0,1fr)}.managed-row label{min-width:0}#managed-controls{padding:10px}}\n</style>');
 page=replaceOne(page,'Files and operating data remain in this browser until you export them.','Saved operations remain in the selected managed store. Complete portable workspaces and the original standalone application can be exported.');
 if(page.includes('document.documentElement.outerHTML')||page.includes('localStorage.setItem(STORAGE'))throw Error('Managed page still exports live connection markup or writes a browser workspace.');
 return page;
}
export async function managedPage({sourceDirectory,store,sourceSha256}){
 const [originalHtml,originalUi,originalPanel,runtime]=await Promise.all([
  readFile(join(sourceDirectory,'curriculum-migration-workbench.html'),'utf8'),
  readFile(join(sourceDirectory,'ui.js'),'utf8'),
  readFile(join(sourceDirectory,'curriculum-panel.mjs'),'utf8'),
  readFile(new URL('./browser-runtime.js',import.meta.url),'utf8')
 ]);
 return composeManagedPage({originalHtml,originalUi,originalPanel,runtime,identity:store.identity,sourceSha256});
}
