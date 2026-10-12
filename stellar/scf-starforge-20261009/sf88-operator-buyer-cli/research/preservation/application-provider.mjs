// MIT. The original preservation workbench owns its native source and lifecycle.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../../distribution/runtime-workspace/application-provider.mjs';
import {preservationApplication,preparePreservationApplication,preservationStartup} from './application.mjs';

export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'research-preservation-workbench',order:1120,appendPort:false,
  catalog({common}){return [preservationApplication(common)];},
  async prepare(type,settings,context){
    const original=await preparePreservationApplication(settings,context);
    return {args:original.args,inputs:original.inputs,createDirectories:original.createDirectories};
  },
  resourceKey(type,settings,{hash}){return hash({family:'preservation-workbench',directory:settings.directory});},
  matchRequest(request){return !request.pythonCommand&&request.command==='preservation-workspace'&&
    Array.isArray(request.args)&&request.args[0]==='--python'&&request.args[2]==='workbench'&&request.args[3]==='serve';},
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      let value;try{value=JSON.parse(text);}catch{return null;}
      if(value?.schema!=='stellar-forge.preservation-workbench-launch.v1'||value.status!=='PRESERVATION_WORKBENCH_READY')return null;
      return ()=>preservationStartup(request,text);
    },{lineLimit:65536});
  },
};
