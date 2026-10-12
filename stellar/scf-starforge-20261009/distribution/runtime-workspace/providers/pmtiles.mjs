// MIT. Source-owned PMTiles Applications adapter on the original managed lifecycle.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../application-provider.mjs';
import {pmtilesApplication,preparePMTilesApplication,pmtilesApplicationStartup} from '../application-pmtiles.mjs';

export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'pmtiles',order:290,
  catalog({common}){return [pmtilesApplication(common)];},
  prepare(type,settings,context){return preparePMTilesApplication(settings,context);},
  resourceKey(type,settings,{hash}){return hash({family:'pmtiles-workspace',directory:settings.workspaceDirectory});},
  matchRequest(request){return !request.pythonCommand&&request.command==='pmtiles-workspace';},
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"stellar-forge.pmtiles-workspace-ready.v1",'))return null;
      return ()=>pmtilesApplicationStartup(request,directory,text);
    });
  },
};
