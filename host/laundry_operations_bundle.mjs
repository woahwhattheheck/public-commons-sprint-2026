// MIT. Complete laundry workbench, source files and same-record receiving package.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import E from './laundry_operations.cjs';
import H from './connected_sha256.cjs';
import Z from './connected_zip.cjs';
import {renderLaundryOperations} from './laundry_operations_view.mjs';
const host=dirname(fileURLToPath(import.meta.url));
async function operatingGuide(){try{return await readFile(join(host,'../docs/laundry-operations.md'),'utf8')}catch(e){if(e.code!=='ENOENT')throw e;return readFile(join(host,'LAUNDRY_OPERATIONS.md'),'utf8')}}
export async function laundryOperationsBundleFiles(value,{guide}={}){
 const record=E.validate(value),names=['laundry_operations.cjs','laundry_operations_view.mjs','laundry_operations_cli.mjs','laundry_operations_bundle.mjs','laundry_operations_page.mjs','connected_inline_payload.mjs','connected_gzip.cjs','connected_sha256.cjs','connected_zip.cjs','LAUNDRY_OPERATIONS_UI.md'];
 const sources=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(join(host,name),'utf8')])));sources['LAUNDRY_OPERATIONS.md']=await operatingGuide();
 const instructions=guide||sources['LAUNDRY_OPERATIONS.md']+'\n\n'+sources['LAUNDRY_OPERATIONS_UI.md'],files=E.exportFiles(record).map(f=>({name:f.name,content:f.content}));
 files.push({name:'START_HERE.md',content:instructions},{name:'Laundry_Operations_Workbench.html',content:renderLaundryOperations(record,{engineSource:sources['laundry_operations.cjs'],hashSource:sources['connected_sha256.cjs'],zipSource:sources['connected_zip.cjs'],guide:instructions,sourceFiles:sources})});
 for(const[name,content]of Object.entries(sources))files.push({name:'source/'+name,content});
 const manifest={schema:'commons.laundry-operations-files.v1',source_sha256:record.source_sha256,files:files.map(f=>({name:f.name,...H.sha256Utf8(f.content)}))};files.push({name:'Files.json',content:JSON.stringify(manifest,null,2)+'\n'});return {record,files,manifest};
}
export async function buildLaundryOperationsBundle(value,{out,guide}={}){
 if(!out)throw Error('Choose a new output directory.');const p=await laundryOperationsBundleFiles(value,{guide}),destination=resolve(out);await mkdir(destination);
 for(const f of p.files){const target=join(destination,f.name);await mkdir(dirname(target),{recursive:true});await writeFile(target,f.content,{encoding:'utf8',flag:'wx'})}
 const archive=Z.packStoredZip(p.files.map(f=>({name:f.name,data:Z.utf8(f.content)}))),zipPath=join(destination,'Easy_Laundry_Wash_Junkie_Complete_Preparation.zip');await writeFile(zipPath,archive,{flag:'wx'});
 return {directory:destination,summary:E.summary(p.record),files:p.manifest.files,zip:{path:zipPath,...H.sha256Bytes(archive)}};
}
