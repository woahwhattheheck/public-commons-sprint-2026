// MIT. Source-owned Pollar partner entry in the original Applications workspace.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {pollarPartnerApplication,preparePollarPartnerApplication,pollarPartnerStartup,POLLAR_PARTNER_READY_SCHEMA} from './application.mjs';
export default {
 schema:APPLICATION_PROVIDER_SCHEMA,id:'pollar-partner',order:1150,appendPort:false,
 catalog({common}){return [pollarPartnerApplication(common)];},
 prepare(type,settings,context){return preparePollarPartnerApplication(settings,context);},
 matchRequest(request){return !request.pythonCommand&&request.command==='stellar-pollar-partner'&&request.args?.[0]==='serve';},
 createObserver(request,directory){
  return observeApplicationStartup(request,directory,text=>{
   if(!text.startsWith('{')||text.length>65536)return null;
   let value;try{value=JSON.parse(text);}catch{return null;}
   if(value?.schema!==POLLAR_PARTNER_READY_SCHEMA)return null;
   return ()=>pollarPartnerStartup(request,text);
  });
 }
};
