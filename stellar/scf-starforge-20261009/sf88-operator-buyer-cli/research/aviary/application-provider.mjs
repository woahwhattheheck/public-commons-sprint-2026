// MIT. Source-owned Aviary Applications entry calls the original workspace lifecycle.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../../distribution/runtime-workspace/application-provider.mjs';
import {aviaryApplication,prepareAviaryApplication,aviaryStartup} from './application.mjs';

export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'research-aviary',order:1100,
  catalog({common}){return [aviaryApplication(common)];},
  async prepare(type,settings,context){
    const original=await prepareAviaryApplication(settings,context);
    return {args:original.args,inputs:original.inputs,createDirectories:original.createDirectories};
  },
  resourceKey(type,settings,{hash}){return hash({family:'aviary',directory:settings.directory});},
  matchRequest(request){return !request.pythonCommand&&request.command==='aviary-workspace'&&
    Array.isArray(request.args)&&request.args[0]==='--python'&&request.args[2]==='managed';},
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      let value;try{value=JSON.parse(text);}catch{return null;}
      if(value?.schema!=='stellar-forge.aviary-workspace-launch.v1'||
        value.status!=='AVIARY_WORKSPACE_READY')return null;
      return ()=>aviaryStartup(request,text);
    },{lineLimit:32768});
  },
};
