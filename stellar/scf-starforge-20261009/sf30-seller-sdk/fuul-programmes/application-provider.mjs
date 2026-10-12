// MIT. Source-owned Fuul programme registration in the original Applications workspace.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {fuulProgrammesApplication,prepareFuulProgrammesApplication,fuulProgrammesStartup,FUUL_PROGRAMMES_READY_SCHEMA} from './application.mjs';

export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'stellar-fuul-programmes',order:1130,appendPort:false,
  catalog({common}){return [fuulProgrammesApplication(common)];},
  prepare(type,settings,context){return prepareFuulProgrammesApplication(settings,context);},
  matchRequest(request){
    return !request.pythonCommand&&request.command==='stellar-fuul-programmes'&&request.args?.[0]==='serve';
  },
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{')||text.length>16384)return null;
      let value;try{value=JSON.parse(text);}catch{return null;}
      if(value?.schema!==FUUL_PROGRAMMES_READY_SCHEMA)return null;
      return ()=>fuulProgrammesStartup(request,text);
    });
  }
};
