import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {disclosure as model} from './disclosure.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=name=>fs.readFile(path.join(root,name),'utf8');
export async function buildDisclosureHtml(initial=null){
 if(initial?.workspace)model.reopen(JSON.stringify(initial.workspace));
 const [hash,csv,core,ui,css]=await Promise.all(['host/connected_sha256.cjs','tools/revenue_owner_console_20261010/lead_procurement_waterford_csv.mjs','disclosure_core.mjs','disclosure_ui.mjs','disclosure.css'].map(read));
 const csvBody=csv.replace(/import hashes from .*?;\n/,'').replaceAll('export const ','const ').replaceAll('export function ','function ');
 const bootstrap="const hashes=(()=>{const module={exports:{}},exports=module.exports;"+hash+";return module.exports;})();\nconst csv=(()=>{"+csvBody+";return {readMunicipalCsv,writeMunicipalCsv};})();\n"+core.replace('export function','function')+"\n"+ui.replace('export function','function')+"\nconst template='<!doctype html>\\n'+document.documentElement.outerHTML.replace(/(<script id=\"disclosure-state\" type=\"application\\/json\">)[\\s\\S]*?(<\\/script>)/,(_,a,b)=>a+'<!--DISCLOSURE_STATE-->'+b);const initial=JSON.parse(document.getElementById('disclosure-state').textContent);const model=createDisclosureDesk({...hashes,readCsv:csv.readMunicipalCsv,writeCsv:csv.writeMunicipalCsv});mountDisclosure({root:document.getElementById('disclosure-root'),model,initial,template});";
 const payload=JSON.stringify(initial).replace(/</g,'\\u003c');
 const html='<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Disclosure data handover</title><style>'+css+'</style></head><body><main id="disclosure-root"></main><script id="disclosure-state" type="application/json">'+payload+'</script><script>'+bootstrap.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
 if(model.utf8Bytes(html)>128*1024*1024)throw Error('Complete standalone reader exceeds 128 MiB.');return html;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [output,workspaceFile]=process.argv.slice(2);if(!output)throw Error('node build.mjs NEW_OUTPUT.html [WORKSPACE.json]');
 const workspace=workspaceFile?model.reopen(await fs.readFile(workspaceFile,'utf8')):null;
 const html=await buildDisclosureHtml(workspace?{workspace}:null);await fs.writeFile(output,html,{encoding:'utf8',flag:'wx'});
 process.stdout.write(output+'\n');
}
