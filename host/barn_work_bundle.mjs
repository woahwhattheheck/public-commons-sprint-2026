import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import barn from './barn_work.cjs';
import zip from './connected_zip.cjs';
import hash from './connected_sha256.cjs';
import {renderBarnHTML} from './barn_work_view.mjs';
const directory=dirname(fileURLToPath(import.meta.url));
export async function barnBundleFiles(record){
 const names=['barn_work.cjs','barn_work_view.mjs','barn_work_cli.mjs','barn_work_bundle.mjs','connected_zip.cjs','connected_sha256.cjs','DAILY_BARN_WORK.md'];
 const source=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(join(directory,name),'utf8')])));
 const sourceFiles=Object.fromEntries(Object.entries(source).map(([name,content])=>['source/'+name,content]));
 const html=renderBarnHTML(record,{sourceFiles,engineSource:source['barn_work.cjs'],zipSource:source['connected_zip.cjs']});
 const files={...barn.files(record),'START_HERE.md':source['DAILY_BARN_WORK.md'],...sourceFiles,'Daily_Barn_Work.html':html};
 const manifest={version:'barn-work.files.v1',record_id:record.id,revision:record.revision,files:Object.entries(files).map(([name,content])=>({name,...hash.sha256Utf8(content)}))};
 files['Files.json']=JSON.stringify(manifest,null,2)+'\n';return {record,files,manifest};
}
export async function buildBarnBundle(record,{out}={}){
 if(!out)throw Error('Choose a new output directory.');const prepared=await barnBundleFiles(record),destination=resolve(out);
 const archive=zip.packStoredZip(Object.entries(prepared.files).map(([name,content])=>({name,data:zip.utf8(content)})));
 await mkdir(destination);for(const [name,content]of Object.entries(prepared.files)){const target=join(destination,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,content,{encoding:'utf8',flag:'wx'});}
 await writeFile(join(destination,'Daily_Barn_Work.zip'),archive,{flag:'wx'});return {directory:destination,record_id:record.id,revision:record.revision,files:prepared.manifest.files,archive:hash.sha256Bytes(archive)};
}
