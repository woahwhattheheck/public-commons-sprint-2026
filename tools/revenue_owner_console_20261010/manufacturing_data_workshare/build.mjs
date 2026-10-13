import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import * as core from './data_readiness.mjs';
import {bundleDataDesk} from './bundle.mjs';
const here=dirname(fileURLToPath(import.meta.url));
export async function buildDataDesk({outputDirectory,config={}}){
 if(!outputDirectory)throw Error('Choose an output directory.');
 const [coreSource,comparisonSource,controller,style]=await Promise.all(['data_readiness.mjs','data_comparison.mjs','data_desk.mjs','data_desk.css'].map(name=>readFile(join(here,name),'utf8')));
 const title=String(config.title||'Manufacturing data preparation');
 const html=bundleDataDesk({coreSource,comparisonSource,controllerSource:controller,style,config,base64Utf8:source=>Buffer.from(source,'utf8').toString('base64')});
 const files=[{path:'data-desk.html',content:html},...Object.keys(core.FIELD_DEFINITIONS).map(kind=>({path:kind+'-template.csv',content:core.templateCSV(kind)}))];
 const source=[['data_readiness.mjs',coreSource],['data_comparison.mjs',comparisonSource],['data_desk.mjs',controller],['data_desk.css',style]];
 const identity=(path,content)=>({path,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')});
 const manifest={schema:'manufacturing-data-desk-build.v1',title,createdAt:new Date().toISOString(),source:source.map(([path,content])=>identity(path,content)),files:files.map(x=>identity(x.path,x.content)),config};
 const output=resolve(outputDirectory);await mkdir(output,{recursive:true});
 for(const file of files){
  const path=join(output,file.path);
  try{await writeFile(path,file.content,{flag:'wx'});}
  catch(error){if(error.code!=='EEXIST'||await readFile(path,'utf8')!==file.content)throw error;}
 }
 const manifestText=JSON.stringify(manifest,null,2)+'\n';
 // One build folder represents one complete edition. Never overwrite a different prior manifest.
 const manifestPath=join(output,'build-manifest.json');
 try{await writeFile(manifestPath,manifestText,{flag:'wx'});}
 catch(error){if(error.code!=='EEXIST')throw error;const prior=JSON.parse(await readFile(manifestPath,'utf8'));if(JSON.stringify(prior.source)!==JSON.stringify(manifest.source)||JSON.stringify(prior.files)!==JSON.stringify(manifest.files)||JSON.stringify(prior.config)!==JSON.stringify(config))throw error;return prior;}
 return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [output,configPath,...extra]=process.argv.slice(2);if(extra.length||!output)throw Error('Usage: node build.mjs OUTPUT_DIRECTORY [CUSTOMER_CONFIG.json]');
  const config=configPath?JSON.parse(await readFile(configPath,'utf8')):{};
  process.stdout.write(JSON.stringify(await buildDataDesk({outputDirectory:output,config}),null,2)+'\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
