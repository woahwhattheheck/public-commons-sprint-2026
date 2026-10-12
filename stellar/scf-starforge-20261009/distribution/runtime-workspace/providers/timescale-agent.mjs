// MIT. Timescale in the original saved Applications lifecycle.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { timescaleAgentApplication, prepareTimescaleAgentApplication, timescaleAgentStartup } from '../application-timescale.mjs';
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'timescale-agent',order:1040,
  catalog({common}){return[timescaleAgentApplication(common)];},
  async prepare(_type,settings,{inputPath,runtimeDirectory}){
    const selected=await prepareTimescaleAgentApplication(settings,inputPath,runtimeDirectory);
    return{args:selected.args,inputs:selected.inputs,createDirectories:[]};
  },
  resourceKey(_type,settings,{hash}){return hash({family:'merchant-mcp',directory:settings.configurationFile});},
  matchRequest(request){return!request.pythonCommand&&request.command==='timescale-agent';},
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"stellar-forge.timescale-agent-workspace-startup.v1",'))return null;
      return()=>timescaleAgentStartup(request,text);
    });
  }
};
