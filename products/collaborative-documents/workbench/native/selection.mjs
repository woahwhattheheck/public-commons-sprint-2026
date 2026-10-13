import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { sha, identity, requireValue, now, clone } from '../core/common.mjs';

export const SOURCE_ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
function packageAt(entry,name){
  let directory=dirname(entry);
  for(;;){const path=join(directory,'package.json');if(existsSync(path)){
    const body=readFileSync(path),value=JSON.parse(body);if(value.name===name)return {path,body,value};}
    const parent=dirname(directory);requireValue(parent!==directory,'RUNTIME_PACKAGE','The original installed package metadata could not be located.',409,{name});directory=parent;
  }
}
export async function inspectRuntime({sourceRoot=SOURCE_ROOT}={}){
  requireValue(realpathSync(sourceRoot)===realpathSync(SOURCE_ROOT),'RUNTIME_SOURCE_SELECTION','The original runtime module must execute from the selected component source.',409);
  requireValue(/^v24\./.test(process.version),'NODE_VERSION','This complete installed application requires Node24.',409);
  const sqlite=await import('node:sqlite');requireValue(typeof sqlite.DatabaseSync==='function','SQLITE_RUNTIME','This selected Node runtime has no original native SQLite API.',409);
  const packageBody=readFileSync(join(sourceRoot,'package.json')),lockBody=readFileSync(join(sourceRoot,'package-lock.json'));
  const pkg=JSON.parse(packageBody),lock=JSON.parse(lockBody),packages=[];
  requireValue(lock.lockfileVersion===3,'LOCKFILE_VERSION','Use the retained original npm lockfile version3.',409);
  for(const [name,version] of Object.entries(pkg.dependencies).sort(([a],[b])=>a.localeCompare(b))){
    requireValue(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version),'UNPINNED_PACKAGE','Direct native dependencies must have an exact selected version.',409,{name});
    const specifier=name==='@tiptap/pm'?'@tiptap/pm/model':name==='@tiptap/html'?'@tiptap/html/server':name;
    const modulePath=fileURLToPath(import.meta.resolve(specifier)),observed=packageAt(modulePath,name),locked=lock.packages['node_modules/'+name];
    requireValue(observed.value.version===version&&locked?.version===version,'RUNTIME_VERSION','An installed native package differs from its exact original selected lock.',409,{name,expected:version,actual:observed.value.version});
    packages.push({name,version,modulePath,packagePath:observed.path,moduleSha256:sha(readFileSync(modulePath)),packageJsonSha256:sha(observed.body),integrity:locked.integrity??null});
  }
  const schemaBody=readFileSync(join(sourceRoot,'reference/schema.mjs')),{SCHEMA_ID,FIELD_NAME}=await import('../reference/schema.mjs');
  const stable={nodeVersion:process.version,packageJson:{bytes:packageBody.length,sha256:sha(packageBody)},lockfile:{bytes:lockBody.length,sha256:sha(lockBody)},
    packages:packages.map(({modulePath,packagePath,...value})=>value),schemaSelection:{schemaId:SCHEMA_ID,field:FIELD_NAME,bytes:schemaBody.length,sha256:sha(schemaBody)}};
  return {schema:'tjlabs.tiptap-runtime-ready.v1',state:'ready',createdAt:now(),sourceRoot:resolve(sourceRoot),node:{executable:process.execPath,version:process.version},
    packageJson:stable.packageJson,lockfile:stable.lockfile,packages,schemaSelection:stable.schemaSelection,selectionSha256:identity(stable)};
}
export async function selectRuntime({sourceRoot=SOURCE_ROOT,runtimeReadyFile}={}){
  const observed=await inspectRuntime({sourceRoot});
  if(runtimeReadyFile){
    const ready=JSON.parse(readFileSync(runtimeReadyFile,'utf8'));
    requireValue(ready.schema===observed.schema&&ready.state==='ready'&&ready.selectionSha256===observed.selectionSha256,'RUNTIME_RECEIPT_CHANGED','The selected runtime no longer matches its original installed receipt.',409);
    requireValue(ready.node.executable===observed.node.executable&&ready.node.version===observed.node.version&&ready.sourceRoot===observed.sourceRoot,'RUNTIME_LOCATION_CHANGED','Use the retained runtime executable and source location, or run the original installer for this receiving host.',409);
    for(const row of ready.packages){const actual=observed.packages.find(p=>p.name===row.name);requireValue(actual&&actual.modulePath===row.modulePath&&actual.packagePath===row.packagePath,'RUNTIME_PACKAGE_LOCATION','The original selected package location changed.',409,{name:row.name});}
  }
  return observed;
}
export function publicSelection(selection){
  return {nodeVersion:selection.node.version,selectionSha256:selection.selectionSha256,packageJson:clone(selection.packageJson),lockfile:clone(selection.lockfile),
    schemaSelection:clone(selection.schemaSelection),packages:selection.packages.map(({name,version,integrity,moduleSha256,packageJsonSha256})=>({name,version,integrity,moduleSha256,packageJsonSha256}))};
}
