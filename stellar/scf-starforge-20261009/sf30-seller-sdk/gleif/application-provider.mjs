// SPDX-License-Identifier: MIT
import { join } from 'node:path';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { GLEIF_SOURCE,inspectGleifSource,inspectGleifWorkspace } from './managed.mjs';
import { GleifClient } from './client.mjs';
import { SCHEMA,need } from './core.mjs';
function option(request,name,fallback) {const indexes=request.args.flatMap((v,i)=>v===name?[i]:[]);if(!indexes.length&&fallback!==undefined)return fallback;
  need(indexes.length===1&&typeof request.args[indexes[0]+1]==='string','GLEIF_APPLICATION_ARGUMENT');return request.args[indexes[0]+1];}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'gleif-research',order:1470,
  catalog({common,field}){return[{id:'gleif-research',command:'gleif',title:'GLEIF company research',terminal:false,requiredSource:GLEIF_SOURCE+'/cli.mjs',
    description:'Search official legal-entity records, review customer shortlists, compare source editions and deliver complete company research.',
    fields:[field('workspaceDirectory','Initialized company research project','path',true,'Create the private project once with gleif init.'),...common]}];},
  async prepare(_type,settings,{inputPath,runtimeDirectory}) {
    const workspace=await inspectGleifWorkspace(settings.workspaceDirectory),runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false}),source=await inspectGleifSource(join(runtime.sourceRoot,GLEIF_SOURCE));
    const inputs=[await inputPath(workspace.directory,'directory',false,true),await inputPath(join(workspace.directory,'workspace.json'),'file')];
    for(const file of source.files){const value=await inputPath(join(source.directory,file.path),'file');need(value.sha256===file.sha256&&value.bytes===file.bytes,'GLEIF_APPLICATION_SOURCE');inputs.push(value);}
    return {args:['serve','--workspace',workspace.directory,'--expected-workspace',workspace.workspaceIdentity,'--expected-source',source.sha256,'--startup-json'],inputs,createDirectories:[]};
  },
  resourceKey(_type,settings,{hash}){return hash({family:'gleif-research',directory:settings.workspaceDirectory});},
  matchRequest:request=>!request.pythonCommand&&request.command==='gleif',
  async verifyLaunch(request){const workspace=await inspectGleifWorkspace(option(request,'--workspace'),option(request,'--expected-workspace'));await inspectGleifSource(join(request.releaseDirectory,'source',GLEIF_SOURCE),option(request,'--expected-source'));return workspace;},
  createObserver(request,directory){return observeApplicationStartup(request,directory,line=>{
    if(!line.startsWith('{"schema":"'+SCHEMA+'.startup",'))return null;
    return async()=>{
      const value=JSON.parse(line),workspace=await inspectGleifWorkspace(option(request,'--workspace'),option(request,'--expected-workspace'));
      need(value.state==='READY'&&value.workspaceId===workspace.workspaceId&&value.workspaceIdentity===workspace.workspaceIdentity&&value.sourceIdentity?.sha256===option(request,'--expected-source'),'GLEIF_STARTUP');
      const client=await GleifClient.connect(value.connectionFile);
      try{need(client.binding.instanceId===value.instanceId&&client.binding.workspaceId===workspace.workspaceId&&value.url===client.binding.origin+'/#token='+client.binding.token,'GLEIF_STARTUP');
        const port=Number(option(request,'--port','0'));need(!port||Number(new URL(value.url).port)===port,'GLEIF_STARTUP_PORT');
        return {url:value.url,workspaceId:workspace.workspaceId,connectionFile:value.connectionFile,original:{schema:SCHEMA+'.startup',workspaceId:workspace.workspaceId,workspaceIdentity:workspace.workspaceIdentity,instanceId:value.instanceId,sourceSha256:value.sourceIdentity.sha256}};
      }finally{client.close();}
    };
  });}
};
