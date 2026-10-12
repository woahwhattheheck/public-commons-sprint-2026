// MIT. Source-owned registration in the original Applications workspace.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {stellarIndexerApplication,prepareStellarIndexerApplication,stellarIndexerStartup,STELLAR_INDEXER_READY_SCHEMA} from './application.mjs';
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'stellar-client-indexer',order:1090,
  catalog({common}){return [stellarIndexerApplication(common)];},
  async prepare(type,settings,context){const original=await prepareStellarIndexerApplication(settings,context);
    return {...original,createDirectories:original.createDirectories??[]};},
  matchRequest(request){return !request.pythonCommand&&request.command==='stellar-indexer-workspace';},
  createObserver(request,directory){return observeApplicationStartup(request,directory,text=>{
    if(!text.startsWith('{"schema":"'+STELLAR_INDEXER_READY_SCHEMA+'",'))return null;
    return ()=>stellarIndexerStartup(request,text);
  });}
};
