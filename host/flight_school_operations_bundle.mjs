// MIT. Complete flight-school application, source and original operational records.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import E from './flight_school_operations.cjs';
import H from './connected_sha256.cjs';
import Z from './connected_zip.cjs';
import {renderFlightSchoolOperations} from './flight_school_operations_view.mjs';
const host=dirname(fileURLToPath(import.meta.url));
async function readSource(name){try{return await readFile(join(host,name),'utf8');}catch(error){if(name!=='FLIGHT_SCHOOL_OPERATIONS.md'||error.code!=='ENOENT')throw error;return readFile(join(host,'..','docs','flight-school-operations.md'),'utf8');}}
export async function flightSchoolBundleFiles(value,{guide}={}){
 const record=E.validateRecord(value),names=['flight_school_operations.cjs','flight_school_operations_view.mjs','flight_school_operations_cli.mjs','flight_school_operations_bundle.mjs','flight_school_operations_page.mjs','connected_inline_payload.mjs','connected_gzip.cjs','connected_sha256.cjs','connected_zip.cjs','FLIGHT_SCHOOL_OPERATIONS_UI.md','FLIGHT_SCHOOL_OPERATIONS.md'];
 const source=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readSource(name)])));
 const operating=guide||source['FLIGHT_SCHOOL_OPERATIONS_UI.md']+'\n\n'+source['FLIGHT_SCHOOL_OPERATIONS.md'];
 const files=E.exportFiles(record).map(f=>({name:f.name,content:f.content}));
 files.push({name:'START_HERE.md',content:operating},{name:'Flight_School_Operations.html',content:renderFlightSchoolOperations(record,{engineSource:source['flight_school_operations.cjs'],hashSource:source['connected_sha256.cjs'],zipSource:source['connected_zip.cjs'],guide:operating,sourceFiles:source})});
 for(const[name,content]of Object.entries(source))files.push({name:'source/'+name,content});
 const manifest={schema:'commons.flight-school-files.v1',record_id:record.id,revision:record.revision,files:files.map(f=>({name:f.name,...H.sha256Utf8(f.content)}))};
 files.push({name:'Files.json',content:JSON.stringify(manifest,null,2)+'\n'});return {record,files,manifest};
}
export async function buildFlightSchoolBundle(value,{out,guide}={}){
 if(!out)throw Error('Choose a new output directory.');
 const prepared=await flightSchoolBundleFiles(value,{guide}),destination=resolve(out),archive=Z.packStoredZip(prepared.files.map(f=>({name:f.name,data:Z.utf8(f.content)})));
 await mkdir(destination);
 for(const file of prepared.files){const target=join(destination,file.name);await mkdir(dirname(target),{recursive:true});await writeFile(target,file.content,{encoding:'utf8',flag:'wx'});}
 const zipPath=join(destination,'Flight_School_Handover.zip');await writeFile(zipPath,archive,{flag:'wx'});
 return {directory:destination,revision:prepared.record.revision,files:prepared.manifest.files,zip:{path:zipPath,...H.sha256Bytes(archive)}};
}
