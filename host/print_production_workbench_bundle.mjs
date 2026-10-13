// MIT. Complete print-production source, receiving application and operating record.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import E from './print_production_workbench.cjs';
import H from './connected_sha256.cjs';
import Z from './connected_zip.cjs';
import {renderPrintProductionWorkbench} from './print_production_workbench_view.mjs';
const host=dirname(fileURLToPath(import.meta.url));
export async function printProductionBundleFiles(value,{guide}={}){
 const record=E.validateRecord(value);for(const quote of record.quotes)E.verifyQuote(quote,H.sha256Utf8);const names=['print_production_workbench.cjs','print_production_workbench_view.mjs','print_production_workbench_cli.mjs','print_production_workbench_bundle.mjs','print_production_workbench_page.mjs','connected_inline_payload.mjs','connected_gzip.cjs','connected_sha256.cjs','connected_zip.cjs','PRINT_PRODUCTION_WORKBENCH_UI.md','PRINT_PRODUCTION_WORKBENCH.md'];
 const source=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(join(host,name),'utf8')])));
 const operating=guide||source['PRINT_PRODUCTION_WORKBENCH_UI.md']+'\n\n'+source['PRINT_PRODUCTION_WORKBENCH.md'];
 const files=E.exportFiles(record).map(f=>({name:f.name,content:f.content}));
 files.push({name:'START_HERE.md',content:operating},{name:'Print_Production_Workbench.html',content:renderPrintProductionWorkbench(record,{engineSource:source['print_production_workbench.cjs'],hashSource:source['connected_sha256.cjs'],zipSource:source['connected_zip.cjs'],guide:operating,sourceFiles:source})});
 for(const[name,content]of Object.entries(source))files.push({name:'source/'+name,content});
 const manifest={schema:'commons.print-production-files.v1',record_id:record.id,revision:record.revision,files:files.map(f=>({name:f.name,...H.sha256Utf8(f.content)}))};
 files.push({name:'Files.json',content:JSON.stringify(manifest,null,2)+'\n'});return {record,files,manifest};
}
export async function buildPrintProductionBundle(value,{out,guide}={}){
 if(!out)throw new Error('Choose a new output directory.');const prepared=await printProductionBundleFiles(value,{guide}),destination=resolve(out),archive=Z.packStoredZip(prepared.files.map(f=>({name:f.name,data:Z.utf8(f.content)})));
 await mkdir(destination);for(const file of prepared.files){const target=join(destination,file.name);await mkdir(dirname(target),{recursive:true});await writeFile(target,file.content,{encoding:'utf8',flag:'wx'})}
 const zipPath=join(destination,'Print_Production_Handover.zip');await writeFile(zipPath,archive,{flag:'wx'});
 return {directory:destination,revision:prepared.record.revision,files:prepared.manifest.files,zip:{path:zipPath,...H.sha256Bytes(archive)}};
}
