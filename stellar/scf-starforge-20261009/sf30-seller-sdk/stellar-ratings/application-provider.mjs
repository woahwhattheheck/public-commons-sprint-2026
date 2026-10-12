// MIT. Source-owned Stellar ratings registration in the original Applications workspace.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {stellarRatingsApplication,prepareStellarRatingsApplication,stellarRatingsStartup,STELLAR_RATINGS_READY_SCHEMA} from './application.mjs';

export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'stellar-ratings',order:1140,appendPort:false,
  catalog({common}){return [stellarRatingsApplication(common)];},
  prepare(type,settings,context){return prepareStellarRatingsApplication(settings,context);},
  matchRequest(request){
    return !request.pythonCommand&&request.command==='stellar-ratings'&&request.args?.[0]==='serve';
  },
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{')||text.length>16384)return null;
      let value;try{value=JSON.parse(text);}catch{return null;}
      if(value?.schema!==STELLAR_RATINGS_READY_SCHEMA)return null;
      return ()=>stellarRatingsStartup(request,text);
    });
  }
};
