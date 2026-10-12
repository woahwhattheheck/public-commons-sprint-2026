// MIT. DBnomics source-owned Applications provider for the original saved project.
import { join } from 'node:path';
import { APPLICATION_PROVIDER_SCHEMA,applicationPreparation,observeApplicationStartup } from '../application-provider.mjs';
import { readJSON,need } from '../storage.mjs';
export default {
 schema:APPLICATION_PROVIDER_SCHEMA,id:'dbnomics',order:440,
 catalog({common,field}){return [{id:'dbnomics',command:'dbnomics',title:'DBnomics economic workspace',terminal:false,
  description:'Acquire exact economic series, review source revisions and analyst reports, publish datasets and receive original buyer pages.',
  fields:[field('workspaceDirectory','DBnomics project','path',true),field('create','Initialize a new project','boolean'),
   field('stateDirectory','Original target dataset state','path'),field('seller','Running seller origin','text'),
   field('resource','Existing HTTPS resource','text'),...common]}];},
 validateSettings(type,settings){need(Boolean(settings.seller)===Boolean(settings.resource),'APPLICATION_BUYER_ENDPOINT_PAIR_REQUIRED');},
 async prepare(type,settings,context){
  const {args,inputs,createDirectories,path,option}=applicationPreparation(settings,context.inputPath);
  const workspace=await path('workspaceDirectory','directory',Boolean(settings.create),true);
  args.push('serve');option('--workspace',settings.workspaceDirectory);
  let retained=null;
  if(workspace.exists)try{retained=await readJSON(join(settings.workspaceDirectory,'project.json'));}catch(e){if(e.code!=='ENOENT'||!settings.create)throw e;}
  if(settings.create&&!retained){args.push('--create');if(settings.stateDirectory){await path('stateDirectory','directory',true,true);option('--state',settings.stateDirectory);}}
  else{
   const original=retained??await readJSON(join(settings.workspaceDirectory,'project.json'));
   need(original.schema==='stellar-forge.dbnomics-project.v1'&&original.directory===settings.workspaceDirectory&&
    original.sourceFile===join(settings.workspaceDirectory,'source.json')&&
    original.publisherDirectory===join(settings.workspaceDirectory,'publisher')&&
    (!settings.stateDirectory||settings.stateDirectory===original.targetDirectory),'APPLICATION_DBNOMICS_BINDING_CHANGED');
   inputs.push(await context.inputPath(join(settings.workspaceDirectory,'project.json'),'file'));
   inputs.push(await context.inputPath(original.sourceFile,'file'));
   inputs.push(await context.inputPath(original.publisherDirectory,'directory',false,true));
  }
  option('--seller',settings.seller);option('--resource',settings.resource);return {args,inputs,createDirectories};
 },
 resourceKey(type,settings,{hash}){return hash({family:'dbnomics',directory:settings.workspaceDirectory});},
 matchRequest(request){return !request.pythonCommand&&request.command==='dbnomics';},
 createObserver(request,directory){return observeApplicationStartup(request,directory,text=>{
  const match=text.match(/"url"\s*:\s*"([^"]+)"/);return match?match[1]:null;
 });}
};
