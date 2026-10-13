// MIT. Source-owned Turbolong operations entry in the original Applications workspace.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {turbolongOperationsApplication,prepareTurbolongOperationsApplication,turbolongOperationsStartup,TURBOLONG_OPERATIONS_READY_SCHEMA} from './application.mjs';
export default {
 schema:APPLICATION_PROVIDER_SCHEMA,id:'turbolong-operations',order:1160,appendPort:false,
 catalog({common}){return [turbolongOperationsApplication(common)];},
 prepare(type,settings,context){return prepareTurbolongOperationsApplication(settings,context);},
 matchRequest(request){return !request.pythonCommand&&request.command==='stellar-turbolong-operations'&&request.args?.[0]==='serve';},
 createObserver(request,directory){
  return observeApplicationStartup(request,directory,text=>{
   if(!text.startsWith('{')||text.length>65536)return null;
   let value;try{value=JSON.parse(text);}catch{return null;}
   if(value?.schema!==TURBOLONG_OPERATIONS_READY_SCHEMA)return null;
   return ()=>turbolongOperationsStartup(request,text);
  });
 }
};
