// MIT. Server-only example: keep outside the client module graph.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const KEY=Symbol.for('tjlabs.bim.next.owner.v1');
function requirePath(value,name){if(typeof value!=='string'||!path.isAbsolute(value))throw Error(name+' must select an absolute host path');return value;}
async function privateText(file){
 const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0)throw Error('Select an original private regular file');
 return await fs.readFile(file,'utf8');
}
async function create(){
 const installation=requirePath(process.env.BIM_INSTALLATION,'BIM_INSTALLATION'),directory=requirePath(process.env.BIM_WORKSPACE,'BIM_WORKSPACE');
 const token=(await privateText(requirePath(process.env.BIM_TOKEN_FILE,'BIM_TOKEN_FILE'))).trim();
 const {createBimNextHandler}=await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(path.join(installation,'next-handler.mjs')).href);
 const {createProviders}=await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(path.join(installation,'providers/index.mjs')).href);
 const credentialFile=process.env.BIM_CREDENTIALS_FILE;
 const credentials=credentialFile?JSON.parse(await privateText(requirePath(credentialFile,'BIM_CREDENTIALS_FILE'))):{};
 const credentialResolver=async alias=>{const value=credentials[alias];if(!value)throw Object.assign(new Error('SERVER_CREDENTIAL_UNAVAILABLE'),{code:'SERVER_CREDENTIAL_UNAVAILABLE'});return value;};
 return await createBimNextHandler({directory,sourceDirectory:installation,token,adapters:await createProviders(),credentialResolver,apiPrefix:'/api/bim'});
}
export function bimOwner(){
 // One promise reserves the same SQLite owner through parallel route startup and
 // development hot reload. A rejected startup stays visible; no silent retry.
 return globalThis[KEY]??=(create());
}
export async function closeBimOwner(){
 const selected=globalThis[KEY];if(!selected)return;
 const owner=await selected;await owner.close();if(globalThis[KEY]===selected)delete globalThis[KEY];
}
