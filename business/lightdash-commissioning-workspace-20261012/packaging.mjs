import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

function handoverDirectory(workspace,id){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Use the original handover UUID.');return path.join(workspace.root,'handover',id);}
async function callPackager({workspace,appRoot,id,includeOperatorPrivate,python,inspect=false}){
  const destination=handoverDirectory(workspace,id),runtime=python??workspace.metadata().connection?.runtime?.python??'/usr/bin/python3';
  const args=[path.join(appRoot,'package.py'),'--workspace',workspace.root,'--app',appRoot,'--output',path.join(destination,'Lightdash_Commissioning_Handover.zip')];
  if(includeOperatorPrivate)args.push('--include-operator-private');if(inspect)args.push('--inspect-existing');
  const prefix=inspect?'inspect-'+crypto.randomUUID():'package';
  const stdout=await fs.open(path.join(destination,prefix+'.stdout.log'),'wx',0o600),stderr=await fs.open(path.join(destination,prefix+'.stderr.log'),'wx',0o600);
  let code;
  try{code=await new Promise((resolve,reject)=>{const child=spawn(runtime,args,{stdio:['ignore',stdout.fd,stderr.fd],shell:false,windowsHide:true});child.once('error',reject);child.once('close',(status,signal)=>status===null?reject(new Error('The original packaging process ended with signal '+signal)):resolve(status));});}
  finally{await stdout.close();await stderr.close();}
  if(code!==0)throw new Error((inspect?'Original archive inspection':'Handover packaging')+' exited '+code+'. The original operation and complete logs remain in '+destination+'.');
  return {id,...JSON.parse(await fs.readFile(path.join(destination,'result.json'),'utf8'))};
}
export async function inspectHandover({workspace,appRoot=path.dirname(fileURLToPath(import.meta.url)),id,python}={}){
  const directory=handoverDirectory(workspace,id),request=JSON.parse(await fs.readFile(path.join(directory,'request.json'),'utf8'));
  if(request.workspaceId!==workspace.metadata().id||request.id!==id)throw new Error('This handover belongs to another workspace.');
  return await callPackager({workspace,appRoot,id,includeOperatorPrivate:request.includeOperatorPrivate,python,inspect:true});
}
export async function createHandover({workspace,appRoot=path.dirname(fileURLToPath(import.meta.url)),id=crypto.randomUUID(),includeOperatorPrivate=false,python}={}){
  const directory=handoverDirectory(workspace,id);
  const source=await fs.readFile(path.join(appRoot,'source-manifest.json'));
  const request={schema:'lightdash.commissioning-handover-request.v1',id,workspaceId:workspace.metadata().id,includeOperatorPrivate,applicationSourceSha256:crypto.createHash('sha256').update(source).digest('hex')};
  try{await fs.mkdir(directory,{recursive:false,mode:0o700});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const retained=JSON.parse(await fs.readFile(path.join(directory,'request.json'),'utf8'));
    for(const key of Object.keys(request))if(retained[key]!==request[key])throw new Error('The original handover ID already names a different complete selection.');
    return await inspectHandover({workspace,appRoot,id,python});
  }
  await fs.writeFile(path.join(directory,'request.json'),JSON.stringify({...request,createdAt:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600});
  return await callPackager({workspace,appRoot,id,includeOperatorPrivate,python});
}
