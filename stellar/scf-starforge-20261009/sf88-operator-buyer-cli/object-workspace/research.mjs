// MIT. Attach the existing Object Buyer to the original Research listener.
import {isAbsolute,resolve} from 'node:path';
import {need} from '../node/store.mjs';
import {ResearchWorkspaceClient,readResearchConnectionFile} from '../research-dossiers/workspace-client.mjs';
import {researchConnection,researchWorkspaceId} from '../research-dossiers/workspace-protocol.mjs';
import {researchObjectWorkspaceId} from '../research-dossiers/object-reference.mjs';

export function objectResearchConnection({stateDirectory,connectionFile=null,directory=null}={}) {
  need((connectionFile===null)===(directory===null),'OBJECT_RESEARCH_CONNECTION_AND_DIRECTORY_REQUIRED');
  const configured=connectionFile!==null;
  if(configured)for(const path of [connectionFile,directory])
    need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'OBJECT_RESEARCH_ABSOLUTE_PATH_REQUIRED');
  const objectWorkspaceId=researchObjectWorkspaceId(stateDirectory);
  const client=configured?new ResearchWorkspaceClient({connectionFile,directory}):null;
  const active=new Set(),controllers=new Set();let closed=false;
  function state(){return {configured,objectWorkspaceId,researchWorkspaceId:configured?researchWorkspaceId(directory):null};}
  async function open({session,sessionId,configurationSha256,snapshot,bytes,sha256},{signal}={}) {
    need(configured&&!closed,'OBJECT_RESEARCH_NOT_CONFIGURED');
    need(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(session??'')&&
      /^[a-f0-9-]{36}$/.test(sessionId??'')&&
      [configurationSha256,snapshot,sha256].every(value=>/^[a-f0-9]{64}$/.test(value??''))&&
      Number.isSafeInteger(bytes)&&bytes>=0,'OBJECT_RESEARCH_ORIGINAL_SELECTION_REQUIRED');
    const controller=new AbortController(),abort=()=>controller.abort();
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    controllers.add(controller);
    const work=(async()=>{
      const status=await client.status({signal:controller.signal});
      need(status.objects?.configured===true&&status.objects.workspaceId===objectWorkspaceId,
        'OBJECT_RESEARCH_SOURCE_MISMATCH');
      // Reread the maintained private startup record, retaining the same workspace and instance.
      const selected=researchConnection(await readResearchConnectionFile(connectionFile));
      need((!selected.workspaceId||selected.workspaceId===status.workspaceId)&&
        (!selected.instanceId||selected.instanceId===status.instanceId),'OBJECT_RESEARCH_CONNECTION_CHANGED');
      need(!controller.signal.aborted&&!closed,'OBJECT_RESEARCH_OPEN_STOPPED');
      const hash=new URLSearchParams({token:selected.token,view:'pipelines',object:session,objectSession:sessionId});
      return {mode:'ORIGINAL_OBJECT_RESEARCH',workspaceId:status.workspaceId,objectWorkspaceId,
        session,sessionId,configurationSha256,snapshot,bytes,sha256,
        url:selected.origin+'/#'+hash.toString(),processingConfigured:status.pipelines?.configured===true};
    })();
    active.add(work);
    try{return await work;}
    finally{active.delete(work);controllers.delete(controller);signal?.removeEventListener('abort',abort);}
  }
  let closing;
  return {state,open,close(){return closing??=(async()=>{
    closed=true;for(const controller of controllers)controller.abort();
    await Promise.allSettled([...active]);await client?.close();
  })();}};
}
