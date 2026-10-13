// MIT. Complete original Source Collection lifetime over a borrowed Grant owner.
import {InstallationSourceCollectionAgent,createInstallationSourceCollectionWorkingCopy}
  from './installation-source-collection-agent.mjs';
import {InstallationSourceCollectionStore} from './installation-source-collection-store.mjs';
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'SOURCE_COLLECTION_SESSION'});};
export const SOURCE_COLLECTION_ACTIONS=Object.freeze({
  start:'start',stage:'stage',edit:'edit',use_existing:'useExisting',clear_existing:'clearExisting',
  review:'review',receive:'receive',reconcile:'reconcile',retire_rejected:'retireRejected',refresh:'refresh',
});
export async function openInstallationSourceCollection({directory,workspaceDirectory,client,context,expectedSequence}){
  const store=await new InstallationSourceCollectionStore({directory,workspaceDirectory}).init();
  const workingCopy=await store.load();
  if(expectedSequence!==undefined)need(workingCopy.sequence===expectedSequence,
    'This complete working copy advanced. Open its current sequence and original requests before continuing.');
  const agent=new InstallationSourceCollectionAgent({workingCopy,client,
    context:{...context,workspaceDirectory},persist:(copy,expected)=>store.persist(copy,expected)});
  return {agent,store};
}
export async function initializeInstallationSourceCollection({directory,workspaceDirectory,client,context,
  workingCopy,originalBytes,caseId,draftId,name,staffContext=null}){
  let selected=workingCopy;
  if(selected===undefined){
    need(typeof caseId==='string'&&typeof draftId==='string','Choose the existing original case and source draft.');
    const [caseResponse,draftResponse]=await Promise.all([
      client.read('case',{caseId}),client.installationSources('detail',{caseId,draftId}),
    ]);
    const original=caseResponse.value?.program;
    need(original&&original.id===caseId&&typeof original.planId==='string'&&typeof original.createdAt==='string',
      'Read the complete original case identity, plan and creation time before starting its working copy.');
    selected=createInstallationSourceCollectionWorkingCopy({draft:draftResponse.value,
      scope:{caseId,planId:original.planId,createdAt:original.createdAt},staffContext,...(name===undefined?{}:{name})});
  }
  // Full original browser validation precedes persistence and any native mutation.
  new InstallationSourceCollectionAgent({workingCopy:selected,client,context:{...context,workspaceDirectory},
    persist:async()=>{throw new Error('Initial validation cannot write a native request.');}});
  const store=await InstallationSourceCollectionStore.create({directory,workspaceDirectory,workingCopy:selected,originalBytes});
  return openInstallationSourceCollection({directory,workspaceDirectory,client,context,expectedSequence:selected.sequence});
}
export async function performInstallationSourceCollection(agent,action,args={}){
  need(Object.hasOwn(SOURCE_COLLECTION_ACTIONS,action),'Choose an original source collection operation.');
  if(action==='start')return agent.start(args);
  if(action==='stage')return agent.stage(args.files);
  if(action==='edit')return agent.edit(args);
  if(action==='use_existing')return agent.useExisting(args.rowId,args.selection);
  if(action==='clear_existing')return agent.clearExisting(args.rowId);
  if(action==='receive')return agent.receive(args);
  if(action==='reconcile')return agent.reconcile(args);
  return agent[SOURCE_COLLECTION_ACTIONS[action]]();
}
