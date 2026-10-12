// MIT. Additive original-Research seam; all Dossier operations use the borrowed original store.
import {isAbsolute,resolve} from 'node:path';
import {startZoteroWorkspace} from '../../sf30-seller-sdk/zotero/server.mjs';
import {need} from '../../sf30-seller-sdk/zotero/contracts.mjs';

export function openZoteroResearchBridge({directory,dossierStore}={}) {
  need(isAbsolute(directory)&&resolve(directory)===directory,'ZOTERO_ABSOLUTE_DIRECTORY_REQUIRED');
  need(dossierStore&&typeof dossierStore.receiveSourceBundle==='function','ZOTERO_ORIGINAL_DOSSIER_STORE_REQUIRED');
  let child=null,opening=null,closing=false,closed=null;
  async function open(){
    need(!closing,'ZOTERO_RESEARCH_BRIDGE_CLOSING');
    if(child?.active)return status();
    if(child){await child.close();child=null;}
    need(!closing,'ZOTERO_RESEARCH_BRIDGE_CLOSING');
    if(!opening)opening=(async()=>{
      const created=await startZoteroWorkspace({directory,dossierStore});
      if(closing){await created.close();throw Object.assign(new Error('ZOTERO_RESEARCH_BRIDGE_CLOSING'),{code:'ZOTERO_RESEARCH_BRIDGE_CLOSING'});}
      child=created;return created;
    })();
    try{await opening;need(!closing,'ZOTERO_RESEARCH_BRIDGE_CLOSING');return status();}
    finally{opening=null;}
  }
  function status(){
    return {configured:true,active:child?.active===true&&!closing,
      ...(child?.active&&!closing?{workspaceId:child.workspace.identity.workspaceId,instanceId:child.instanceId,url:child.url}: {})};
  }
  async function close(){
    if(closed)return closed;closing=true;
    closed=(async()=>{
      const errors=[];
      try{await opening;}catch(error){if(error.code!=='ZOTERO_RESEARCH_BRIDGE_CLOSING')errors.push(error);}
      try{await child?.close();}catch(error){errors.push(error);}
      child=null;
      if(errors.length)throw new AggregateError(errors,'ZOTERO_RESEARCH_BRIDGE_CLOSE_FAILED');
    })();return closed;
  }
  return {open,status,close};
}
